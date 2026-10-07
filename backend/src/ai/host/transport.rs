//! Real async HTTP transport. No automatic replay, proxy, redirect or billing fallback.
use crate::ai::{
    AiError, Cancellation, ConnectionSnapshot, PortFuture, RESPONSES_ENDPOINT,
    oauth::{ProtectedValue, RegistrationBinding},
    transport::{
        CredentialBoundaryRequest, CredentialBoundaryTransport, ResponseBody, ResponseHead,
        ResponseStream, TransportFuture, TransportIssue, TransportLimits,
    },
};
use reqwest::{Client, Response, header};
use std::{
    future::Future,
    net::SocketAddrV4,
    time::{Duration, Instant},
};

pub const SYNTHETIC_BEARER: &str = "houseatlas-synthetic-fixture";

/// Only the approved public route or an explicit token-free loopback fixture.
/// Selecting a route supplies no account, qualification or spending permission.
#[derive(Clone)]
pub enum HttpTarget {
    OpenAi,
    SyntheticLoopback(SocketAddrV4),
}
impl HttpTarget {
    pub(crate) fn responses(&self) -> Result<String, AiError> {
        match self {
            Self::OpenAi => Ok(RESPONSES_ENDPOINT.into()),
            Self::SyntheticLoopback(addr) if addr.ip().is_loopback() && addr.port() != 0 => {
                Ok(format!("http://{addr}/v1/responses"))
            }
            _ => Err(AiError::InvalidInput),
        }
    }
    pub(crate) fn models(&self) -> Result<String, AiError> {
        Ok(self.responses()?.replace("/v1/responses", "/v1/models"))
    }
}

/// A current same-registration credential lease; the selected runtime owns
/// encryption, refresh and lease exclusion. Never deserialize a lease from HTTP.
pub trait InferenceLease: Send + Sync {
    fn bearer(&self) -> &ProtectedValue;
    fn binding(&self) -> &RegistrationBinding;
    fn snapshot(&self) -> &ConnectionSnapshot;
}
pub trait InferenceSession<C>: Send + Sync {
    type Lease: InferenceLease;
    /// Validate original authority, current account-specific model, direct
    /// scope, eligibility, independent paid-use admission and observed runtime.
    /// Retain the selected credential session until the response reader drops.
    fn acquire<'a>(
        &'a self,
        context: &'a C,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Self::Lease>;
    fn revalidate<'a>(
        &'a self,
        context: &'a C,
        lease: &'a Self::Lease,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ()>;
}

pub struct HttpResponses<S> {
    client: Client,
    sessions: S,
    target: HttpTarget,
}
impl<S> HttpResponses<S> {
    pub fn new(sessions: S, target: HttpTarget) -> Result<Self, AiError> {
        target.responses()?;
        let client = client()?;
        Ok(Self {
            client,
            sessions,
            target,
        })
    }
}

/// Poll the accepted cancellation flag while I/O is pending, rather than only
/// at chunk boundaries. Dropping I/O closes local use, not the provider task.
pub(crate) async fn bounded<T>(
    cancel: &Cancellation,
    deadline: Instant,
    future: impl Future<Output = T>,
) -> Result<T, TransportIssue> {
    tokio::pin!(future);
    loop {
        if cancel.is_requested() {
            return Err(TransportIssue::StopRequested);
        }
        if Instant::now() >= deadline {
            return Err(TransportIssue::Unresolved);
        }
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) =>
                return Err(TransportIssue::Unresolved),
            _ = tokio::time::sleep(Duration::from_millis(20)) => {},
            result = &mut future => {
                if cancel.is_requested() { return Err(TransportIssue::StopRequested); }
                return Ok(result);
            }
        }
    }
}

impl<C: Sync, S: InferenceSession<C>> CredentialBoundaryTransport<C> for HttpResponses<S> {
    fn open<'a>(
        &'a self,
        context: &'a C,
        request: CredentialBoundaryRequest<'a>,
        cancel: &'a Cancellation,
        limits: TransportLimits,
    ) -> TransportFuture<'a, ResponseStream<'a>> {
        Box::pin(async move {
            let before = TransportIssue::BeforeSubmission;
            if request.endpoint != RESPONSES_ENDPOINT
                || request.content_type != "application/json"
                || request.accept != "text/event-stream"
                || request.body.len() > limits.max_request_bytes
            {
                return Err(before(AiError::InvalidInput));
            }
            let wire: serde_json::Value =
                serde_json::from_slice(request.body).map_err(|_| before(AiError::InvalidInput))?;
            let model = wire
                .get("model")
                .and_then(serde_json::Value::as_str)
                .ok_or(before(AiError::InvalidInput))?;
            if wire.get("store") != Some(&serde_json::Value::Bool(false))
                || wire.get("stream") != Some(&serde_json::Value::Bool(true))
                || wire.get("background").is_some()
            {
                return Err(before(AiError::InvalidInput));
            }
            let lease = bounded(
                cancel,
                request.deadline,
                self.sessions.acquire(context, model, cancel),
            )
            .await
            .map_err(before_io)?
            .map_err(before)?;
            bounded(
                cancel,
                request.deadline,
                self.sessions.revalidate(context, &lease, cancel),
            )
            .await
            .map_err(before_io)?
            .map_err(before)?;
            if !lease.snapshot().can_infer() {
                return Err(before(AiError::ConnectionUnavailable));
            }
            let bearer = lease.bearer().expose_in_trusted_boundary();
            if matches!(self.target, HttpTarget::SyntheticLoopback(_)) && bearer != SYNTHETIC_BEARER
            {
                return Err(before(AiError::InvalidInput));
            }
            let mut auth = header::HeaderValue::from_str(&format!("Bearer {bearer}"))
                .map_err(|_| before(AiError::ConnectionUnavailable))?;
            auth.set_sensitive(true);
            let outgoing = self
                .client
                .post(self.target.responses().map_err(before)?)
                .header(header::AUTHORIZATION, auth)
                .header(header::CONTENT_TYPE, request.content_type)
                .header(header::ACCEPT, request.accept)
                .body(request.body.to_vec())
                .build()
                .map_err(|_| before(AiError::InvalidInput))?;
            // Recheck immediately before execute; every execute error is uncertain.
            bounded(
                cancel,
                request.deadline,
                self.sessions.revalidate(context, &lease, cancel),
            )
            .await
            .map_err(before_io)?
            .map_err(before)?;
            cancel.checkpoint().map_err(before)?;
            let response = bounded(cancel, request.deadline, self.client.execute(outgoing))
                .await?
                .map_err(|_| TransportIssue::Unresolved)?;
            let head = ResponseHead {
                http_status: response.status().as_u16(),
                content_type: response
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned),
                request_id: response
                    .headers()
                    .get("x-request-id")
                    .and_then(|v| v.to_str().ok())
                    .filter(|v| v.len() <= 256)
                    .map(str::to_owned),
            };
            Ok(ResponseStream {
                head,
                body: Box::new(HttpBody {
                    response,
                    sessions: &self.sessions,
                    context,
                    lease,
                    pending: Vec::new(),
                    offset: 0,
                    total: 0,
                    ceiling: limits.max_stream_bytes,
                }),
            })
        })
    }
}
struct HttpBody<'a, C, S: InferenceSession<C>> {
    response: Response,
    sessions: &'a S,
    context: &'a C,
    lease: S::Lease,
    pending: Vec<u8>,
    offset: usize,
    total: usize,
    ceiling: usize,
}
impl<C: Sync, S: InferenceSession<C>> ResponseBody for HttpBody<'_, C, S> {
    fn next_chunk<'a>(
        &'a mut self,
        cancel: &'a Cancellation,
        deadline: Instant,
        max_chunk_bytes: usize,
    ) -> TransportFuture<'a, Option<Vec<u8>>> {
        Box::pin(async move {
            if max_chunk_bytes == 0 {
                return Err(TransportIssue::Unresolved);
            }
            bounded(
                cancel,
                deadline,
                self.sessions.revalidate(self.context, &self.lease, cancel),
            )
            .await?
            .map_err(|_| TransportIssue::Unresolved)?;
            if self.offset == self.pending.len() {
                self.pending.clear();
                self.offset = 0;
                let Some(bytes) = bounded(cancel, deadline, self.response.chunk())
                    .await?
                    .map_err(|_| TransportIssue::Unresolved)?
                else {
                    return Ok(None);
                };
                self.total = self
                    .total
                    .checked_add(bytes.len())
                    .ok_or(TransportIssue::Unresolved)?;
                // Bound before copying the HTTP library's received chunk.
                if self.total > self.ceiling {
                    return Err(TransportIssue::Unresolved);
                }
                self.pending.extend_from_slice(&bytes);
            }
            bounded(
                cancel,
                deadline,
                self.sessions.revalidate(self.context, &self.lease, cancel),
            )
            .await?
            .map_err(|_| TransportIssue::Unresolved)?;
            let end = self
                .pending
                .len()
                .min(self.offset.saturating_add(max_chunk_bytes));
            let chunk = self.pending[self.offset..end].to_vec();
            self.offset = end;
            Ok(Some(chunk))
        })
    }
}

fn before_io(issue: TransportIssue) -> TransportIssue {
    match issue {
        TransportIssue::Unresolved => {
            TransportIssue::BeforeSubmission(AiError::ConnectionUnavailable)
        }
        other => other,
    }
}

pub(crate) fn client() -> Result<Client, AiError> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| AiError::ConnectionUnavailable)
}
