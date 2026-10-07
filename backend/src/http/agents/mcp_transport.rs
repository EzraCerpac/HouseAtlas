//! Bounded JSON Streamable HTTP, with actual AT11 POST authority on every POST.
//! This application-specific cookie/CSRF profile is Editor-only and read-only.
//! It does not advertise OAuth, SSE, server requests, or a new access grant.
use super::mcp::{self, OwnedAdapter};
use crate::{
    access as a,
    app::Access,
    domain as d,
    http::{
        CheckedHeaders, Host, HttpFailure, HttpResult, access_error, admission, evidence, failure,
        headers, intake,
    },
    transports::mcp as native,
};
use axum::{
    Json,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, TryLockError},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_SESSIONS: usize = 32;
const MAX_PER_COOKIE: usize = 4;
const MAX_HTTP_SESSION_ID_BYTES: usize = 128;
const SESSION_IDLE: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Copy)]
struct McpResponse;

pub(crate) fn is_mcp_response(response: &Response) -> bool {
    response.extensions().get::<McpResponse>().is_some()
}

pub(crate) fn matches_path(path: &str) -> bool {
    path.starts_with("/api/atlas/mcp/")
}

fn marked(mut response: Response) -> Response {
    response.extensions_mut().insert(McpResponse);
    response
}

/// The outer HTTP adapter also calls this for pre-route admission/header errors
/// on the MCP prefix, so those errors cannot become an Atlas browser error DTO.
pub(in crate::http) fn http_failure(error: HttpFailure) -> Response {
    let (code, message) = match error.status {
        StatusCode::UNAUTHORIZED => (-32001, "Authentication required"),
        StatusCode::FORBIDDEN => (-32003, "Request not permitted"),
        StatusCode::NOT_FOUND => (-32000, "MCP session or resource unavailable"),
        StatusCode::METHOD_NOT_ALLOWED => (-32600, "HTTP method not supported"),
        StatusCode::BAD_REQUEST
        | StatusCode::UNPROCESSABLE_ENTITY
        | StatusCode::UNSUPPORTED_MEDIA_TYPE
        | StatusCode::PAYLOAD_TOO_LARGE => (-32600, "Invalid MCP transport request"),
        _ => (-32603, "MCP transport unavailable"),
    };
    marked(
        (
            error.status,
            Json(json!({"jsonrpc":"2.0","error":{"code":code,"message":message}})),
        )
            .into_response(),
    )
}

fn protocol_response(bytes: Vec<u8>) -> Response {
    // MCP 2025-11-25 omits unidentified error IDs. The actual owner retains
    // known string/integer IDs; preserve its bounded reply bytes unchanged.
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    marked(response)
}

fn accepted() -> Response {
    marked(StatusCode::ACCEPTED.into_response())
}

struct Entry {
    adapter: OwnedAdapter,
    session: native::Session<native::NativeContext>,
    original: a::Principal,
    scope: d::Scope,
    cookie_binding: [u8; 32],
    last_used: Instant,
}

impl Drop for Entry {
    fn drop(&mut self) {
        // Ordinary host teardown, idle pruning, and closed-session removal end
        // only this protocol session; no provider or storage work is performed.
        self.session.close();
    }
}

#[derive(Default)]
pub(crate) struct TransportSessions {
    entries: BTreeMap<String, Arc<Mutex<Entry>>>,
}

impl TransportSessions {
    fn prune(&mut self, now: Instant) {
        self.entries.retain(|_, entry| match entry.try_lock() {
            Ok(mut entry) => {
                let keep = entry.session.state() != native::SessionState::Closed
                    && now.saturating_duration_since(entry.last_used) < SESSION_IDLE;
                if !keep {
                    entry.session.close();
                }
                keep
            }
            Err(TryLockError::WouldBlock) => true,
            Err(TryLockError::Poisoned(_)) => false,
        });
    }

    fn insert(&mut self, id: String, entry: Entry) -> Result<(), HttpFailure> {
        self.prune(Instant::now());
        if self.entries.len() >= MAX_SESSIONS || self.entries.contains_key(&id) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let count = self
            .entries
            .values()
            .filter(|existing| {
                // A busy entry counts conservatively. This method never waits
                // for an entry while holding the registry lock.
                match existing.try_lock() {
                    Ok(existing) => bool::from(
                        existing
                            .cookie_binding
                            .as_slice()
                            .ct_eq(entry.cookie_binding.as_slice()),
                    ),
                    Err(_) => true,
                }
            })
            .count();
        if count >= MAX_PER_COOKIE {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        self.entries.insert(id, Arc::new(Mutex::new(entry)));
        Ok(())
    }
}

struct Authenticated {
    original: a::Principal,
    access: Access,
    cookie_binding: [u8; 32],
}

/// Called only after genuine AT11 authorization succeeded. This digest binds
/// the protocol session to its existing credential; it does not authenticate.
fn cookie_binding(checked: &CheckedHeaders) -> Result<[u8; 32], HttpFailure> {
    let cookie = checked
        .cookie
        .as_deref()
        .ok_or_else(|| failure(StatusCode::UNAUTHORIZED))?;
    let mut values = cookie.split(';').map(str::trim).filter_map(|part| {
        let (name, value) = part.split_once('=').unwrap_or((part, ""));
        (name == a::SESSION_COOKIE).then_some(value)
    });
    let token = values
        .next()
        .ok_or_else(|| failure(StatusCode::UNAUTHORIZED))?;
    if values.next().is_some() {
        return Err(failure(StatusCode::UNAUTHORIZED));
    }
    // AT11 has already checked token format, origin, session, role and CSRF.
    Ok(Sha256::digest(token.as_bytes()).into())
}

struct Metadata {
    session_id: Option<String>,
}

fn accepts(value: &str, expected: &str) -> bool {
    value.split(',').any(|item| {
        let mut fields = item.trim().split(';');
        if !fields
            .next()
            .is_some_and(|kind| kind.trim().eq_ignore_ascii_case(expected))
        {
            return false;
        }
        // Honor an explicit zero quality value instead of claiming acceptance.
        for parameter in fields {
            if let Some((name, quality)) = parameter.trim().split_once('=')
                && name.trim().eq_ignore_ascii_case("q")
            {
                let Ok(quality) = quality.trim().parse::<f32>() else {
                    return false;
                };
                if !(0.0..=1.0).contains(&quality) || quality == 0.0 {
                    return false;
                }
            }
        }
        true
    })
}

fn metadata(request: &Request) -> Result<Metadata, HttpFailure> {
    // Existing strict Content-Type/Content-Length checks, followed by actual
    // streamed 64KiB intake and its existing ten-second deadline.
    intake::metadata(request, MAX_MESSAGE_BYTES as u64)?;
    let bad = || failure(StatusCode::BAD_REQUEST);
    let accept = headers::single(request.headers(), "accept")
        .map_err(|_| bad())?
        .ok_or_else(bad)?;
    if !accepts(&accept, "application/json") || !accepts(&accept, "text/event-stream") {
        return Err(bad());
    }
    protocol_headers(request.headers())
}

fn protocol_headers(headers: &HeaderMap) -> Result<Metadata, HttpFailure> {
    let bad = || failure(StatusCode::BAD_REQUEST);
    let session_id = single(headers, "mcp-session-id")?;
    if session_id.as_ref().is_some_and(|id| {
        id.is_empty()
            || id.len() > MAX_HTTP_SESSION_ID_BYTES
            || !id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    }) {
        return Err(bad());
    }
    let version = single(headers, "mcp-protocol-version")?;
    if version
        .as_deref()
        .is_some_and(|version| version != native::PROTOCOL_VERSION)
        || session_id.is_some() && version.as_deref() != Some(native::PROTOCOL_VERSION)
    {
        return Err(bad());
    }
    Ok(Metadata { session_id })
}

fn single(headers: &HeaderMap, name: &str) -> Result<Option<String>, HttpFailure> {
    headers::single(headers, name).map_err(|_| failure(StatusCode::BAD_REQUEST))
}

fn revalidate(access: &Access, original: &a::Principal) -> Result<(), HttpFailure> {
    access
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        .revalidate(original)
        .map(|_| ())
        .map_err(access_error)
}

fn port_failure(error: native::PortError) -> HttpFailure {
    failure(match error {
        native::PortError::Unauthenticated => StatusCode::UNAUTHORIZED,
        native::PortError::Forbidden => StatusCode::FORBIDDEN,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    })
}

fn handle(
    host: &Host,
    scope: d::Scope,
    auth: Authenticated,
    meta: Metadata,
    bytes: &[u8],
    runtime: &tokio::runtime::Handle,
) -> HttpResult {
    // Framing classification only; exact original bytes still go to the owner.
    // No server-to-client requests are advertised, so unsolicited JSON-RPC
    // responses are rejected at HTTP framing rather than answered as requests.
    let value = intake::json(bytes).map_err(|_| failure(StatusCode::BAD_REQUEST))?;
    let envelope = value
        .as_object()
        .ok_or_else(|| failure(StatusCode::BAD_REQUEST))?;
    if !envelope.get("method").is_some_and(Value::is_string) {
        return Err(failure(StatusCode::BAD_REQUEST));
    }

    if let Some(id) = meta.session_id {
        let shared = {
            let mut sessions = host
                .mcp
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            sessions.prune(Instant::now());
            sessions
                .entries
                .get(&id)
                .cloned()
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?
        };
        let (reply, closed) = {
            // Serialized handling; never hold the registry/Core/access locks
            // while awaiting the adapter. A busy entry consumes no wait queue.
            let mut entry = shared
                .try_lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            if entry.scope != scope
                || !bool::from(
                    entry
                        .cookie_binding
                        .as_slice()
                        .ct_eq(auth.cookie_binding.as_slice()),
                )
            {
                return Err(failure(StatusCode::FORBIDDEN));
            }
            // Init, ping and notifications do not resolve a PrincipalPort, so
            // revalidate the original before ALL protocol messages as well.
            revalidate(&auth.access, &entry.original)?;
            if entry.session.state() == native::SessionState::Closed {
                return Err(failure(StatusCode::NOT_FOUND));
            }
            let Entry {
                adapter, session, ..
            } = &mut *entry;
            let reply = runtime.block_on(adapter.handle(session, bytes));
            let closed = session.state() == native::SessionState::Closed;
            entry.last_used = Instant::now();
            revalidate(&auth.access, &entry.original)?;
            (reply, closed)
        };
        if closed {
            host.mcp
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                .entries
                .remove(&id);
        }
        return match reply {
            Some(bytes) => Ok(protocol_response(bytes)),
            None if !closed => Ok(accepted()),
            None => Err(failure(StatusCode::NOT_FOUND)),
        };
    }

    // A fresh HTTP protocol session starts with initialization only. Its
    // credential was already authenticated with real POST evidence/current CSRF.
    if envelope.get("method").and_then(Value::as_str) != Some("initialize") {
        return Err(failure(StatusCode::BAD_REQUEST));
    }
    revalidate(&auth.access, &auth.original)?;
    let (adapter, session) = runtime
        .block_on(mcp::bind_owned(host.core.clone(), auth.original.clone()))
        .map_err(port_failure)?;
    let mut entry = Entry {
        adapter,
        session,
        original: auth.original,
        scope,
        cookie_binding: auth.cookie_binding,
        last_used: Instant::now(),
    };
    let reply = runtime
        .block_on(entry.adapter.handle(&mut entry.session, bytes))
        .ok_or_else(|| failure(StatusCode::BAD_REQUEST))?;
    revalidate(&auth.access, &entry.original)?;
    if entry.session.state() != native::SessionState::AwaitingInitialized {
        // Preserve the owner's JSON-RPC request error; do not publish a session
        // identifier for failed initialization.
        return Ok(protocol_response(reply));
    }
    let id = crate::app::new_id().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let header_id =
        HeaderValue::from_str(&id).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    host.mcp
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        .insert(id, entry)?;
    let mut response = protocol_response(reply);
    response.headers_mut().insert("mcp-session-id", header_id);
    Ok(response)
}

async fn post_inner(host: Host, scope: d::Scope, request: Request) -> HttpResult {
    if request.uri().query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let selected = crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let capture_host = host.clone();
    let capture_checked = checked.clone();
    let capture_scope = scope.clone();
    let auth = tokio::task::spawn_blocking(move || {
        let _admitted = capture_checked.admission_permit()?;
        let core = capture_host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = format!("{}{}", capture_host.origin, uri.path());
        let observed = evidence(&capture_host.origin, &capture_checked, &uri, &url, &method)
            .map_err(access_error)?;
        // Preserve observed Method::Post. AT11 checks actual Origin + Cookie +
        // current CSRF and Editor membership; no fake GET or DTO principal.
        let original = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .authorize(&observed, &selected, a::Action::Mutate)
            .map_err(access_error)?;
        if !core.homes.iter().any(|home| home.scope == capture_scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        Ok(Authenticated {
            original,
            access: core.access.clone(),
            cookie_binding: cookie_binding(&capture_checked)?,
        })
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))??;
    // Authentication precedes session lookup, JSON metadata and actual body.
    let meta = metadata(&request)?;
    let bytes = admission::body(request.into_body(), MAX_MESSAGE_BYTES).await?;
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        handle(&host, scope, auth, meta, &bytes, &runtime)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(crate) async fn post(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> Response {
    match post_inner(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        request,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => http_failure(error),
    }
}

fn method_not_allowed() -> Response {
    let mut response = http_failure(failure(StatusCode::METHOD_NOT_ALLOWED));
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static("POST"));
    response
}

async fn unsupported_inner(host: Host, scope: d::Scope, request: Request) -> HttpResult {
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    checked
        .check_authority(&host.origin, request.uri())
        .map_err(access_error)?;
    if checked
        .origin
        .as_deref()
        .is_some_and(|origin| origin != host.origin)
        || checked
            .sec_fetch_site
            .as_deref()
            .is_some_and(|site| site != "same-origin")
    {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let meta = protocol_headers(request.headers())?;
    let method = request.method().clone();
    if !matches!(method, Method::GET | Method::HEAD) {
        // AT11 cannot issue an opaque principal from observed Method::Other.
        // DELETE/other unsupported methods therefore never inspect the registry,
        // disclose protocol-session existence, or replace their method evidence.
        // Optional client-directed protocol termination is unavailable.
        return Ok(method_not_allowed());
    }
    let selected = crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let uri = request.uri().clone();
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let auth = {
            let core = host
                .core
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let url = format!(
                "{}{}",
                host.origin,
                uri.path_and_query().map_or("/", |path| path.as_str())
            );
            // Preserve the actual observed GET or HEAD. AT11 performs genuine
            // cookie/origin/membership checks before ANY registry lookup.
            let observed =
                evidence(&host.origin, &checked, &uri, &url, &method).map_err(access_error)?;
            let original = core
                .access
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                .authorize(&observed, &selected, a::Action::Read)
                .map_err(access_error)?;
            if !core.homes.iter().any(|home| home.scope == scope) {
                return Err(failure(StatusCode::NOT_FOUND));
            }
            Authenticated {
                original,
                access: core.access.clone(),
                cookie_binding: cookie_binding(&checked)?,
            }
        };
        revalidate(&auth.access, &auth.original)?;
        if let Some(id) = meta.session_id {
            let shared = {
                let mut sessions = host
                    .mcp
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                sessions.prune(Instant::now());
                sessions
                    .entries
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?
            };
            let entry = shared
                .try_lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            if entry.scope != scope
                || !bool::from(
                    entry
                        .cookie_binding
                        .as_slice()
                        .ct_eq(auth.cookie_binding.as_slice()),
                )
            {
                return Err(failure(StatusCode::FORBIDDEN));
            }
            // This check also retains the original POST issuance provenance;
            // the fresh read handle never replaces its fixed NativeContext.
            revalidate(&auth.access, &entry.original)?;
            if entry.session.state() == native::SessionState::Closed {
                return Err(failure(StatusCode::NOT_FOUND));
            }
        }
        revalidate(&auth.access, &auth.original)?;
        Ok(method_not_allowed())
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

/// No SSE GET or session DELETE is supported by this JSON-only profile.
/// GET/HEAD authenticate with their genuine observed method before session
/// lookup; DELETE/other methods perform metadata checks and return 405 without
/// accessing protocol sessions. No tool or storage operation is dispatched.
pub(crate) async fn unsupported(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> Response {
    match unsupported_inner(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        request,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => http_failure(error),
    }
}
