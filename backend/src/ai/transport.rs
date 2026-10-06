//! Tool-capable Responses decoding within an injected credential boundary.
//!
//! Protocol sources: official SIWC models/inference, preview limitations and
//! errors/recovery at developers.openai.com/siwc/token-sharing-open-source/;
//! reviewed against DevKit f723814abdccec135b519c451fb6e1992ee5e933.
//! This module has no HTTP client, token getter, credential storage or retry loop.
use super::{
    AiError, Cancellation, InferenceOutcome, InferencePort, PortFuture, ProviderDiagnostic,
    ResponsesRequest, Usage, connection::RESPONSES_ENDPOINT, responses::completed_event,
};
use serde_json::Value;
use std::{
    future::Future,
    io::{self, Write},
    pin::Pin,
    time::{Duration, Instant},
};

pub type TransportFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, TransportIssue>> + Send + 'a>>;

/// Certainty is supplied by the credential-owning transport, never inferred from
/// provider prose. A deadline after submission is unresolved, not a rejection.
#[derive(Debug, Clone, Copy)]
pub enum TransportIssue {
    BeforeSubmission(AiError),
    StopRequested,
    Unresolved,
}

/// No authorization header or credential leaves the selected runtime adapter.
pub struct CredentialBoundaryRequest<'a> {
    pub endpoint: &'static str,
    pub content_type: &'static str,
    pub accept: &'static str,
    pub request_id: &'a str,
    pub body: &'a [u8],
    pub deadline: Instant,
}

/// The only response header projection exposed to AI orchestration.
pub struct ResponseHead {
    pub http_status: u16,
    pub content_type: Option<String>,
    pub request_id: Option<String>,
}

pub struct ResponseStream<'a> {
    pub head: ResponseHead,
    pub body: Box<dyn ResponseBody + Send + 'a>,
}

/// Implementations bound allocation before producing a chunk and enforce the
/// deadline/cancel during pending I/O. Drop closes the local reader; it does not
/// prove upstream cancellation. None means a clean local end of stream.
pub trait ResponseBody {
    fn next_chunk<'a>(
        &'a mut self,
        cancel: &'a Cancellation,
        deadline: Instant,
        max_chunk_bytes: usize,
    ) -> TransportFuture<'a, Option<Vec<u8>>>;
}

/// This port owns account-specific credentials and revalidates current context,
/// grant, runtime and paid-use admission immediately before submission. It must
/// use the fixed endpoint, never switch billing paths, and never automatically
/// replay an inference whose submission/outcome is uncertain.
pub trait CredentialBoundaryTransport<C> {
    fn open<'a>(
        &'a self,
        context: &'a C,
        request: CredentialBoundaryRequest<'a>,
        cancel: &'a Cancellation,
        limits: TransportLimits,
    ) -> TransportFuture<'a, ResponseStream<'a>>;
}

#[derive(Debug, Clone, Copy)]
pub struct TransportLimits {
    pub max_request_bytes: usize,
    pub max_chunk_bytes: usize,
    pub max_stream_bytes: usize,
    pub max_event_bytes: usize,
    pub max_error_bytes: usize,
    pub max_events: usize,
    pub timeout: Duration,
}
impl Default for TransportLimits {
    fn default() -> Self {
        Self {
            max_request_bytes: 4 * 1024 * 1024,
            max_chunk_bytes: 64 * 1024,
            max_stream_bytes: 16 * 1024 * 1024,
            max_event_bytes: 4 * 1024 * 1024,
            max_error_bytes: 64 * 1024,
            max_events: 100_000,
            timeout: Duration::from_secs(180),
        }
    }
}
impl TransportLimits {
    fn valid(self) -> bool {
        self.max_request_bytes > 0
            && self.max_request_bytes <= 16 * 1024 * 1024
            && self.max_chunk_bytes > 0
            && self.max_chunk_bytes <= 1024 * 1024
            && self.max_stream_bytes > 0
            && self.max_stream_bytes <= 64 * 1024 * 1024
            && self.max_event_bytes > 0
            && self.max_event_bytes <= self.max_stream_bytes
            && self.max_error_bytes > 0
            && self.max_error_bytes <= 1024 * 1024
            && self.max_events > 0
            && self.max_events <= 1_000_000
            && !self.timeout.is_zero()
            && self.timeout <= Duration::from_secs(300)
    }
}

pub struct ResponsesAdapter<T> {
    transport: T,
    limits: TransportLimits,
}
impl<T> ResponsesAdapter<T> {
    pub fn new(transport: T, limits: TransportLimits) -> Result<Self, AiError> {
        if !limits.valid() {
            return Err(AiError::InvalidInput);
        }
        Ok(Self { transport, limits })
    }
}

impl<C: Sync, T: CredentialBoundaryTransport<C> + Sync> InferencePort<C> for ResponsesAdapter<T> {
    fn infer<'a>(
        &'a self,
        context: &'a C,
        request_id: &'a str,
        request: &'a ResponsesRequest,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, InferenceOutcome> {
        Box::pin(async move {
            if cancel.is_requested() {
                return Ok(stopped());
            }
            if request_id.is_empty() || request_id.len() > 256 {
                return Ok(failed(AiError::InvalidInput, empty_diagnostic()));
            }
            let mut writer = BoundedBody {
                bytes: Vec::new(),
                limit: self.limits.max_request_bytes,
                exceeded: false,
            };
            if serde_json::to_writer(&mut writer, request).is_err() {
                let reason = if writer.exceeded {
                    AiError::LimitReached
                } else {
                    AiError::InvalidInput
                };
                return Ok(failed(reason, empty_diagnostic()));
            }
            let deadline = Instant::now() + self.limits.timeout;
            let request = CredentialBoundaryRequest {
                endpoint: RESPONSES_ENDPOINT,
                content_type: "application/json",
                accept: "text/event-stream",
                request_id,
                body: &writer.bytes,
                deadline,
            };
            let mut stream = match self
                .transport
                .open(context, request, cancel, self.limits)
                .await
            {
                Ok(stream) => stream,
                Err(issue) => return transport_outcome(issue),
            };
            let diagnostic = head_diagnostic(&stream.head);
            if !(200..300).contains(&stream.head.http_status) {
                // The HTTP rejection is known even if its optional diagnostic
                // body cannot be read. Never turn it into unresolved inference.
                let mut error_body = Vec::new();
                while !cancel.is_requested() && Instant::now() < deadline {
                    match stream
                        .body
                        .next_chunk(cancel, deadline, self.limits.max_chunk_bytes)
                        .await
                    {
                        Ok(Some(chunk))
                            if chunk.len() <= self.limits.max_chunk_bytes
                                && error_body.len().saturating_add(chunk.len())
                                    <= self.limits.max_error_bytes =>
                        {
                            error_body.extend_from_slice(&chunk)
                        }
                        _ => break,
                    }
                }
                let value = serde_json::from_slice::<Value>(&error_body).ok();
                return Ok(provider_failed(diagnostic, value.as_ref()));
            }
            // The documented direct route may omit Content-Type; validate SSE.
            if stream.head.content_type.as_deref().is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_none_or(|mime| !mime.trim().eq_ignore_ascii_case("text/event-stream"))
            }) {
                return Ok(unresolved(AiError::InvalidProviderOutput, diagnostic));
            }
            let mut decoder = SseDecoder::new(self.limits, diagnostic);
            loop {
                if cancel.is_requested() {
                    return Ok(stopped());
                }
                if Instant::now() >= deadline {
                    return Err(AiError::ProviderUnavailable);
                }
                let chunk = match stream
                    .body
                    .next_chunk(cancel, deadline, self.limits.max_chunk_bytes)
                    .await
                {
                    Ok(chunk) => chunk,
                    Err(TransportIssue::StopRequested) => return Ok(stopped()),
                    // A response head already proves submission. A body reader
                    // cannot subsequently classify the attempt as not sent.
                    Err(_) => return Err(AiError::ProviderUnavailable),
                };
                if cancel.is_requested() {
                    return Ok(stopped());
                }
                if Instant::now() >= deadline {
                    return Err(AiError::ProviderUnavailable);
                }
                let Some(chunk) = chunk else {
                    return match decoder.finish() {
                        Ok(Some(outcome)) => Ok(outcome),
                        Ok(None) => Err(AiError::ProviderUnavailable),
                        Err(reason) => Ok(unresolved(reason, decoder.diagnostic)),
                    };
                };
                if chunk.len() > self.limits.max_chunk_bytes {
                    return Ok(unresolved(AiError::LimitReached, decoder.diagnostic));
                }
                match decoder.push(&chunk) {
                    Ok(Some(outcome)) => return Ok(outcome),
                    Ok(None) => {}
                    Err(reason) => return Ok(unresolved(reason, decoder.diagnostic)),
                }
            }
        })
    }
}

struct BoundedBody {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}
impl Write for BoundedBody {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(io::Error::other("AI request byte limit reached"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn transport_outcome(issue: TransportIssue) -> Result<InferenceOutcome, AiError> {
    match issue {
        TransportIssue::BeforeSubmission(reason) => Ok(failed(reason, empty_diagnostic())),
        TransportIssue::StopRequested => Ok(stopped()),
        TransportIssue::Unresolved => Err(AiError::ProviderUnavailable),
    }
}
fn empty_diagnostic() -> ProviderDiagnostic {
    ProviderDiagnostic {
        http_status: None,
        code: None,
        parameter: None,
        request_id: None,
    }
}
fn head_diagnostic(head: &ResponseHead) -> ProviderDiagnostic {
    ProviderDiagnostic {
        http_status: Some(head.http_status),
        code: None,
        parameter: None,
        request_id: head.request_id.as_deref().and_then(structured_field),
    }
}
fn structured_field(value: &str) -> Option<String> {
    // Preserve bounded machine identifiers exactly; reject controls and prose.
    (!value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-./[]:".contains(&byte)))
    .then(|| value.to_owned())
}
fn stopped() -> InferenceOutcome {
    InferenceOutcome::Stopped {
        usage: Usage::default(),
    }
}
fn failed(reason: AiError, diagnostic: ProviderDiagnostic) -> InferenceOutcome {
    InferenceOutcome::Failed {
        reason,
        usage: Usage::default(),
        diagnostic,
    }
}
fn unresolved(reason: AiError, diagnostic: ProviderDiagnostic) -> InferenceOutcome {
    InferenceOutcome::Unresolved {
        reason,
        usage: Usage::default(),
        diagnostic,
    }
}
fn provider_failed(mut diagnostic: ProviderDiagnostic, value: Option<&Value>) -> InferenceOutcome {
    let error = value
        .and_then(|value| value.get("error"))
        .filter(|error| error.is_object());
    diagnostic.code = error
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .and_then(structured_field);
    diagnostic.parameter = error
        .and_then(|error| error.get("param"))
        .and_then(Value::as_str)
        .and_then(structured_field);
    let reason = match recovery_action(&diagnostic) {
        RecoveryAction::PauseForManageUsage => AiError::UsageLimitReached,
        RecoveryAction::InspectUnsupportedParameter => AiError::InvalidInput,
        RecoveryAction::CheckAccountScopeClient
        | RecoveryAction::CheckEligibility
        | RecoveryAction::RepairClientConfiguration
        | RecoveryAction::CheckMethodEndpoint => AiError::ConnectionUnavailable,
        RecoveryAction::PreserveCredentialsAndBackoff | RecoveryAction::InspectProviderFailure => {
            AiError::ProviderUnavailable
        }
    };
    InferenceOutcome::Failed {
        reason,
        usage: response_usage(value),
        diagnostic,
    }
}
fn response_usage(value: Option<&Value>) -> Usage {
    let usage = value.and_then(|value| value.get("usage"));
    let count = |name| {
        usage
            .and_then(|usage| usage.get(name))
            .and_then(Value::as_u64)
    };
    Usage {
        input_tokens: count("input_tokens"),
        output_tokens: count("output_tokens"),
        total_tokens: count("total_tokens"),
    }
}

/// Advice for a later deliberate action, never permission for automatic replay,
/// credit opt-in, credential deletion or guessed quota/reset information.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryAction {
    CheckAccountScopeClient,
    CheckEligibility,
    PauseForManageUsage,
    PreserveCredentialsAndBackoff,
    InspectUnsupportedParameter,
    RepairClientConfiguration,
    CheckMethodEndpoint,
    InspectProviderFailure,
}
pub fn recovery_action(diagnostic: &ProviderDiagnostic) -> RecoveryAction {
    match diagnostic.code.as_deref() {
        Some("invalid_client") => RecoveryAction::RepairClientConfiguration,
        Some("subscription_sharing_user_not_eligible") => RecoveryAction::CheckEligibility,
        Some("subscription_sharing_usage_limit_exceeded") => RecoveryAction::PauseForManageUsage,
        Some("subscription_sharing_unsupported_capability") => {
            RecoveryAction::InspectUnsupportedParameter
        }
        Some("subscription_sharing_route_not_supported") => RecoveryAction::CheckMethodEndpoint,
        Some(
            "subscription_sharing_invalid_user"
            | "chatpass_v2_scope_not_authorized"
            | "chatpass_v2_invalid_authorization_context",
        ) => RecoveryAction::CheckAccountScopeClient,
        Some(
            "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable",
        ) => RecoveryAction::PreserveCredentialsAndBackoff,
        _ => match diagnostic.http_status {
            Some(401 | 403) => RecoveryAction::CheckAccountScopeClient,
            Some(429) => RecoveryAction::PauseForManageUsage,
            Some(503) => RecoveryAction::PreserveCredentialsAndBackoff,
            Some(400) if diagnostic.parameter.is_some() => {
                RecoveryAction::InspectUnsupportedParameter
            }
            _ => RecoveryAction::InspectProviderFailure,
        },
    }
}

struct SseDecoder {
    limits: TransportLimits,
    diagnostic: ProviderDiagnostic,
    total_bytes: usize,
    event_count: usize,
    line: Vec<u8>,
    data: Vec<u8>,
    event_name: Option<String>,
    previous_cr: bool,
    first_line: bool,
    has_data_line: bool,
}
impl SseDecoder {
    fn new(limits: TransportLimits, diagnostic: ProviderDiagnostic) -> Self {
        Self {
            limits,
            diagnostic,
            total_bytes: 0,
            event_count: 0,
            line: Vec::new(),
            data: Vec::new(),
            event_name: None,
            previous_cr: false,
            first_line: true,
            has_data_line: false,
        }
    }
    fn push(&mut self, chunk: &[u8]) -> Result<Option<InferenceOutcome>, AiError> {
        self.total_bytes = self
            .total_bytes
            .checked_add(chunk.len())
            .ok_or(AiError::LimitReached)?;
        if self.total_bytes > self.limits.max_stream_bytes {
            return Err(AiError::LimitReached);
        }
        for &byte in chunk {
            if self.previous_cr && byte == b'\n' {
                self.previous_cr = false;
                continue;
            }
            self.previous_cr = byte == b'\r';
            if byte == b'\r' || byte == b'\n' {
                if let Some(outcome) = self.consume_line()? {
                    return Ok(Some(outcome));
                }
            } else {
                self.line.push(byte);
                if self.line.len().saturating_add(self.data.len()) > self.limits.max_event_bytes {
                    return Err(AiError::LimitReached);
                }
            }
        }
        Ok(None)
    }
    fn consume_line(&mut self) -> Result<Option<InferenceOutcome>, AiError> {
        let line = std::mem::take(&mut self.line);
        let line = if self.first_line {
            self.first_line = false;
            line.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&line)
        } else {
            &line
        };
        if line.is_empty() {
            return self.dispatch();
        }
        if let Some(content) = line.strip_prefix(b"data:") {
            if self.has_data_line {
                self.data.push(b'\n');
            }
            self.has_data_line = true;
            self.data
                .extend_from_slice(content.strip_prefix(b" ").unwrap_or(content));
            if self.data.len() > self.limits.max_event_bytes {
                return Err(AiError::LimitReached);
            }
        } else if let Some(content) = line.strip_prefix(b"event:") {
            let content = content.strip_prefix(b" ").unwrap_or(content);
            let name = std::str::from_utf8(content).map_err(|_| AiError::InvalidProviderOutput)?;
            self.event_name = structured_field(name);
            if self.event_name.is_none() {
                return Err(AiError::InvalidProviderOutput);
            }
        }
        Ok(None)
    }
    fn dispatch(&mut self) -> Result<Option<InferenceOutcome>, AiError> {
        let data = std::mem::take(&mut self.data);
        self.has_data_line = false;
        let name = self.event_name.take();
        if data.is_empty() {
            return Ok(None);
        }
        self.event_count += 1;
        if self.event_count > self.limits.max_events {
            return Err(AiError::LimitReached);
        }
        if data == b"[DONE]" {
            return Ok(None);
        }
        let value: Value =
            serde_json::from_slice(&data).map_err(|_| AiError::InvalidProviderOutput)?;
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or(AiError::InvalidProviderOutput)?;
        if name.as_deref().is_some_and(|name| name != kind) {
            return Err(AiError::InvalidProviderOutput);
        }
        match kind {
            "response.completed" => completed_event(&value).map(Some),
            "response.failed" => Ok(Some(provider_failed(
                self.diagnostic.clone(),
                value.get("response"),
            ))),
            "error" => {
                // Event errors may put code/param directly on the event.
                let wrapped = serde_json::json!({ "error": value.get("error").unwrap_or(&value) });
                Ok(Some(provider_failed(
                    self.diagnostic.clone(),
                    Some(&wrapped),
                )))
            }
            "response.incomplete" => Ok(Some(InferenceOutcome::Failed {
                reason: AiError::InvalidProviderOutput,
                usage: response_usage(value.get("response")),
                diagnostic: self.diagnostic.clone(),
            })),
            _ => Ok(None), // Deltas, reasoning and function arguments are not success.
        }
    }
    fn finish(&mut self) -> Result<Option<InferenceOutcome>, AiError> {
        // EOF can follow the last data line without a blank line. Every accepted
        // terminal still has to contain the full completed response.
        match self.consume_line()? {
            Some(outcome) => Ok(Some(outcome)),
            None => self.dispatch(),
        }
    }
}

#[cfg(test)]
mod healthy_example {
    use super::super::ToolDescriptor;
    use super::*;
    use serde_json::json;
    use std::task::{Context, Poll, Waker};

    struct SyntheticBody(std::collections::VecDeque<Vec<u8>>);
    impl ResponseBody for SyntheticBody {
        fn next_chunk<'a>(
            &'a mut self,
            _: &'a Cancellation,
            _: Instant,
            _: usize,
        ) -> TransportFuture<'a, Option<Vec<u8>>> {
            Box::pin(async move { Ok(self.0.pop_front()) })
        }
    }
    struct SyntheticTransport;
    impl CredentialBoundaryTransport<()> for SyntheticTransport {
        fn open<'a>(
            &'a self,
            _: &'a (),
            request: CredentialBoundaryRequest<'a>,
            _: &'a Cancellation,
            _: TransportLimits,
        ) -> TransportFuture<'a, ResponseStream<'a>> {
            Box::pin(async move {
                assert_eq!(request.endpoint, RESPONSES_ENDPOINT);
                let wire: Value = serde_json::from_slice(request.body).unwrap();
                assert_eq!(wire["store"], false);
                assert_eq!(wire["stream"], true);
                assert_eq!(wire["tools"][0]["name"], "houseatlas");
                let output = json!([
                    {"type":"reasoning","encrypted_content":"synthetic-reasoning"},
                    {"type":"function_call","namespace":"houseatlas","name":"atlas_records",
                     "call_id":"synthetic-call","arguments":"{\"commandId\":\"atlas.identity.get\"}"},
                    {"type":"message","role":"assistant","phase":"final_answer",
                     "content":[{"type":"output_text","text":"Synthetic résumé"}]}
                ]);
                let event = json!({"type":"response.completed","response":{
                    "status":"completed","output":output,
                    "usage":{"input_tokens":9,"output_tokens":4,"total_tokens":13}}});
                let stream = format!(
                    ": synthetic heartbeat\r\nevent: response.created\r\ndata: {{\"type\":\"response.created\"}}\r\n\r\nevent: response.completed\r\ndata: {event}\r\n\r\n"
                );
                Ok(ResponseStream {
                    head: ResponseHead {
                        http_status: 200,
                        content_type: Some("text/event-stream; charset=utf-8".into()),
                        request_id: Some("synthetic-provider-request".into()),
                    },
                    body: Box::new(SyntheticBody(
                        stream
                            .as_bytes()
                            .chunks(7)
                            .map(|chunk| chunk.to_vec())
                            .collect(),
                    )),
                })
            })
        }
    }
    #[test]
    fn healthy_tool_capable_completed_stream() {
        let adapter =
            ResponsesAdapter::new(SyntheticTransport, TransportLimits::default()).unwrap();
        let request = ResponsesRequest::new(
            "synthetic-account-model",
            vec![json!({"role":"user","content":"Read the synthetic identity"})],
            &[ToolDescriptor {
                name: "atlas_records".into(),
                description: "Synthetic authorized family".into(),
                parameters: json!({"type":"object"}),
            }],
        )
        .unwrap();
        let cancel = Cancellation::default();
        let mut future = adapter.infer(&(), "synthetic-request", &request, &cancel);
        let mut context = Context::from_waker(Waker::noop());
        let Poll::Ready(Ok(InferenceOutcome::Completed { output, usage })) =
            future.as_mut().poll(&mut context)
        else {
            panic!("healthy mock completes synchronously");
        };
        assert_eq!(usage.total_tokens, Some(13));
        assert_eq!(output[0]["encrypted_content"], "synthetic-reasoning");
        assert_eq!(output[1]["call_id"], "synthetic-call");
        assert_eq!(output[2]["phase"], "final_answer");
        assert_eq!(output[2]["content"][0]["text"], "Synthetic résumé");
    }
}
