//! Mount API: bounded JSON intake, authenticated original context, no listener.
use super::{
    service::{HostApi, HostCommand},
    valid_id,
};
use crate::ai::{
    AiError, PortFuture, RunInput,
    runtime::{ConnectionActionRequest, ReviewInput},
};
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{Request, State},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::de::DeserializeOwned;
use serde_json::json;
use std::sync::Arc;

pub trait HttpAuthority: Send + Sync {
    type Context: Send + Sync;
    /// Resolve the original app session/principal before reading the body.
    /// Require actual Host/Origin, route/home, per-install bridge capability and
    /// current registration/epochs. Mutating routes additionally require the
    /// existing native CSRF/user-action boundary. Never trust actor IDs in JSON.
    fn authenticate<'a>(&'a self, head: &'a Parts, mutating: bool)
    -> PortFuture<'a, Self::Context>;
    /// Original authority and release headers must remain current after await.
    fn release(&self, context: &Self::Context) -> Result<(), AiError>;
}
struct Mount<H, G> {
    api: Arc<H>,
    gate: G,
}

/// Return a router for .nest("/api/atlas/ai", router(...)). The integrator owns
/// the app router, TLS listener and actual native authentication adapter.
pub fn router<H, G>(api: Arc<H>, gate: G) -> Router
where
    H: HostApi + 'static,
    G: HttpAuthority<Context = H::Context> + 'static,
{
    Router::new()
        .route("/run", post(endpoint::<H, G>))
        .route("/resume", post(endpoint::<H, G>))
        .route("/review", post(endpoint::<H, G>))
        .route("/requests/{id}/cancel", post(endpoint::<H, G>))
        .route("/requests/{id}", get(endpoint::<H, G>))
        .route("/connection", get(endpoint::<H, G>))
        .route("/models", get(endpoint::<H, G>))
        .route("/connection/actions", post(endpoint::<H, G>))
        .route("/connection/actions/{id}", get(endpoint::<H, G>))
        .with_state(Arc::new(Mount { api, gate }))
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelInput {
    request_id: String,
}
async fn endpoint<H, G>(State(mount): State<Arc<Mount<H, G>>>, request: Request) -> Response
where
    H: HostApi,
    G: HttpAuthority<Context = H::Context>,
{
    let result = handle(&mount, request).await;
    let mut response = match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => {
            let status = match error {
                AiError::InvalidInput | AiError::LimitReached => StatusCode::BAD_REQUEST,
                AiError::ConnectionUnavailable => StatusCode::FORBIDDEN,
                _ => StatusCode::SERVICE_UNAVAILABLE,
            };
            (status, Json(json!({"error":error}))).into_response()
        }
    };
    let headers = response.headers_mut();
    headers.insert(
        "cache-control",
        "private, no-store".parse().expect("static header"),
    );
    headers.insert(
        "x-content-type-options",
        "nosniff".parse().expect("static header"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        "same-origin".parse().expect("static header"),
    );
    response
}
async fn handle<H, G>(mount: &Mount<H, G>, request: Request) -> Result<serde_json::Value, AiError>
where
    H: HostApi,
    G: HttpAuthority<Context = H::Context>,
{
    let (head, body) = request.into_parts();
    let mutating = head.method == axum::http::Method::POST;
    let context = mount.gate.authenticate(&head, mutating).await?;
    let path = head.uri.path();
    let command = if mutating {
        if head
            .headers
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.split(';').next())
            .map(str::trim)
            != Some("application/json")
        {
            return Err(AiError::InvalidInput);
        }
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            to_bytes(body, 128 * 1024),
        )
        .await
        .map_err(|_| AiError::LimitReached)?
        .map_err(|_| AiError::LimitReached)?;
        match path {
            "/run" => HostCommand::Run(decode::<RunInput>(&bytes)?),
            "/resume" => HostCommand::Resume(decode::<ReviewInput>(&bytes)?),
            "/review" => HostCommand::Review(decode::<ReviewInput>(&bytes)?),
            _ if path.starts_with("/requests/") && path.ends_with("/cancel") => {
                let id = &path[10..path.len() - 7];
                let input = decode::<CancelInput>(&bytes)?;
                if input.request_id != id {
                    return Err(AiError::InvalidInput);
                }
                HostCommand::Cancel(input.request_id)
            }
            "/connection/actions" => {
                HostCommand::Action(decode::<ConnectionActionRequest>(&bytes)?)
            }
            _ => return Err(AiError::InvalidInput),
        }
    } else {
        match path {
            "/connection" => HostCommand::Connection,
            "/models" => HostCommand::Models,
            _ if path.starts_with("/requests/") => HostCommand::Status(path[10..].into()),
            _ if path.starts_with("/connection/actions/") => {
                HostCommand::ActionStatus(path[20..].into())
            }
            _ => return Err(AiError::InvalidInput),
        }
    };
    match &command {
        HostCommand::Status(id) | HostCommand::Cancel(id) | HostCommand::ActionStatus(id)
            if !valid_id(id) =>
        {
            return Err(AiError::InvalidInput);
        }
        _ => {}
    }
    let value = mount.api.call(&context, command).await?;
    mount.gate.release(&context)?;
    Ok(value)
}
fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, AiError> {
    serde_json::from_slice(bytes).map_err(|_| AiError::InvalidInput)
}

/// Native app session intake; adapters use the existing AT11 access and HTTP
/// authority/CSRF implementation, rather than reproducing that policy here.
pub trait ApplicationHttpAuthority: Send + Sync {
    type Context: Send + Sync;
    fn capture<'a>(&'a self, head: &'a Parts, mutating: bool) -> PortFuture<'a, Self::Context>;
    fn release(&self, context: &Self::Context) -> Result<(), AiError>;
}
pub struct AdmittedContext<C> {
    original: C,
    turn: crate::ai::runtime::RuntimeTurnBinding,
}
pub struct BridgeHttpGate<G, B> {
    pub application: G,
    pub bridge: B,
}
impl<G, B> HttpAuthority for BridgeHttpGate<G, B>
where
    G: ApplicationHttpAuthority,
    B: crate::ai::runtime::RuntimeBridgePort<G::Context> + Send + Sync,
{
    type Context = AdmittedContext<G::Context>;
    fn authenticate<'a>(
        &'a self,
        head: &'a Parts,
        mutating: bool,
    ) -> PortFuture<'a, Self::Context> {
        Box::pin(async move {
            let original = self.application.capture(head, mutating).await?;
            let capability = crate::ai::oauth::ProtectedValue::from_trusted_adapter(
                single_header(head, "x-houseatlas-installation")?.to_owned(),
            )?;
            let turn = self.bridge.admit(
                &original,
                &crate::ai::runtime::BridgeRequest {
                    origin: single_header(head, "origin")?,
                    host: single_header(head, "host")?,
                    installation_capability: &capability,
                    registration_id: single_header(head, "x-houseatlas-registration")?,
                    request_id: single_header(head, "x-houseatlas-request-id")?,
                    cancellation_epoch: single_header(head, "x-houseatlas-cancellation-epoch")?,
                },
            )?;
            Ok(AdmittedContext { original, turn })
        })
    }
    fn release(&self, context: &Self::Context) -> Result<(), AiError> {
        self.application.release(&context.original)
    }
}
fn single_header<'a>(head: &'a Parts, name: &str) -> Result<&'a str, AiError> {
    let mut values = head.headers.get_all(name).iter();
    let value = values.next().ok_or(AiError::ConnectionUnavailable)?;
    if values.next().is_some() {
        return Err(AiError::InvalidInput);
    }
    value.to_str().map_err(|_| AiError::InvalidInput)
}

/// Attach original request correlation after bounded JSON decode, before any
/// runner/action starts. Neither body IDs nor header IDs establish authority.
pub struct MountedHost<H>(pub H);
impl<H: HostApi> HostApi for MountedHost<H> {
    type Context = AdmittedContext<H::Context>;
    fn call<'a>(
        &'a self,
        context: &'a Self::Context,
        command: HostCommand,
    ) -> PortFuture<'a, serde_json::Value> {
        Box::pin(async move {
            let id = match &command {
                HostCommand::Run(input) => Some(input.request_id.as_str()),
                HostCommand::Resume(input) | HostCommand::Review(input) => {
                    Some(input.request_id.as_str())
                }
                HostCommand::Status(id)
                | HostCommand::Cancel(id)
                | HostCommand::ActionStatus(id) => Some(id.as_str()),
                HostCommand::Action(input) => Some(input.action_id.as_str()),
                _ => None,
            };
            if id.is_some_and(|id| id != context.turn.request_id) {
                return Err(AiError::InvalidInput);
            }
            self.0.call(&context.original, command).await
        })
    }
}

/// In-app same-origin session mounting, compatible with PR42's actual cookie
/// and X-Atlas-CSRF transport. Companion installation capabilities belong only
/// to BridgeHttpGate; this gate resolves registration/epochs on the server.
pub struct SessionHttpGate<G, A> {
    pub application: G,
    pub authority: A,
}
impl<G, A> HttpAuthority for SessionHttpGate<G, A>
where
    G: ApplicationHttpAuthority,
    A: super::HostAuthority<G::Context>,
{
    type Context = G::Context;
    fn authenticate<'a>(
        &'a self,
        head: &'a Parts,
        mutating: bool,
    ) -> PortFuture<'a, Self::Context> {
        Box::pin(async move {
            let context = self.application.capture(head, mutating).await?;
            let binding = self.authority.binding(&context)?;
            self.authority.revalidate(&context, &binding)?;
            Ok(context)
        })
    }
    fn release(&self, context: &Self::Context) -> Result<(), AiError> {
        self.application.release(context)?;
        let binding = self.authority.binding(context)?;
        self.authority.revalidate(context, &binding)
    }
}
