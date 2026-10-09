//! Explicit configured quantity actions. No request is issued by browsing.
use super::quantity_worker::FlowError;
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, intake, json_response,
};
use crate::{
    access as a, app::RequestPrincipal,
    config::providers::quantity_installation::OriginalQuantityConfigured,
    providers::homebox::write::stock as n,
};
use axum::{
    extract::{Request, State},
    http::{Method, StatusCode, Uri},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        mpsc::{self, SyncSender},
    },
    time::Instant,
};
use tokio::sync::oneshot;
use uuid::Uuid;
pub(super) type Reply = oneshot::Sender<Result<Value, FlowError>>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PreviewInput {
    pub source: a::SourceRef,
    pub quantity: u64,
    pub reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DispatchInput {
    pub preview_id: Uuid,
    pub request_digest: n::Digest,
    pub plan_digest: n::Digest,
    pub approval_receipt_id: Option<Uuid>,
}
pub(super) enum Command {
    Approve {
        principal: RequestPrincipal,
        body: Value,
        reply: Reply,
    },
    Dispatch {
        principal: RequestPrincipal,
        body: DispatchInput,
        reply: Reply,
    },
}
#[derive(Clone)]
struct Entry {
    sender: SyncSender<Command>,
    source: a::SourceRef,
    expires: Instant,
}
#[derive(Default)]
pub(super) struct Registry {
    entries: BTreeMap<Uuid, Entry>,
}
fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn invalid() -> super::HttpFailure {
    failure(StatusCode::UNPROCESSABLE_ENTITY)
}
fn scope(source: &a::SourceRef) -> a::Scope {
    a::Scope {
        workspace_id: source.workspace_id.clone(),
        home_id: source.home_id.clone(),
    }
}
fn configured(host: &Host, source: &a::SourceRef) -> Option<Arc<OriginalQuantityConfigured>> {
    if source.key.source_kind != a::SourceKind::HomeboxEntity {
        return None;
    }
    host.quantity_installations
        .iter()
        .find(|configuration| {
            let expected = configuration.descriptor();
            configuration.source().contains(source)
                && expected.scope.workspace_id.to_string() == source.workspace_id.as_str()
                && expected.scope.home_id.to_string() == source.home_id.as_str()
                && expected.target.source_instance_id.to_string()
                    == source.key.source_instance_id.as_str()
                && expected.target.collection_id.to_string() == source.key.collection_id
                && expected
                    .target
                    .resource_id
                    .is_some_and(|id| id.to_string() == source.key.external_id)
        })
        .cloned()
}
fn authorize(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    source: &a::SourceRef,
) -> Result<RequestPrincipal, super::HttpFailure> {
    let url = format!("{}{}", host.origin, uri);
    let evidence = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let principal = host
        .mcp_access
        .lock()
        .map_err(|_| unavailable())?
        .authorize(
            &evidence,
            &scope(source),
            if *method == Method::GET {
                a::Action::Read
            } else {
                a::Action::Mutate
            },
        )
        .map_err(access_error)?;
    Ok(RequestPrincipal::new(principal))
}
fn output(value: Value) -> HttpResult {
    if serde_json::to_vec(&value).map_err(|_| unavailable())?.len() > 1_048_576 {
        return Err(unavailable());
    }
    Ok(json_response(value))
}
async fn body(request: Request, maximum: usize) -> Result<Value, super::HttpFailure> {
    intake::metadata(&request, maximum as u64)?;
    let bytes = super::admission::body(request.into_body(), maximum).await?;
    intake::json(&bytes)
}
fn headers(request: &Request) -> Result<CheckedHeaders, super::HttpFailure> {
    request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(unavailable)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AvailabilityQuery {
    workspace_id: a::CanonicalId,
    home_id: a::CanonicalId,
    source_instance_id: a::CanonicalId,
    collection_id: String,
    external_id: String,
}
pub(super) async fn availability(State(host): State<Host>, request: Request) -> HttpResult {
    let headers = headers(&request)?;
    let mut fields = serde_json::Map::new();
    for (key, value) in
        url::form_urlencoded::parse(request.uri().query().ok_or_else(invalid)?.as_bytes())
    {
        if fields
            .insert(key.into_owned(), Value::String(value.into_owned()))
            .is_some()
        {
            return Err(invalid());
        }
    }
    let query: AvailabilityQuery =
        serde_json::from_value(Value::Object(fields)).map_err(|_| invalid())?;
    if query.collection_id.is_empty()
        || query.collection_id.len() > 4096
        || query.external_id.is_empty()
        || query.external_id.len() > 4096
    {
        return Err(invalid());
    }
    let source = a::SourceRef {
        workspace_id: query.workspace_id,
        home_id: query.home_id,
        key: a::SourceKey {
            source_instance_id: query.source_instance_id,
            collection_id: query.collection_id,
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: query.external_id,
        },
    };
    let principal = authorize(&host, &headers, request.uri(), request.method(), &source)?;
    let boundary = host.mcp_access.lock().map_err(|_| unavailable())?;
    principal
        .capture_source(&boundary, &source)
        .map_err(access_error)?;
    principal
        .capture_partition(&boundary, &source.partition())
        .map_err(access_error)?;
    // Informational GET cannot create a Mutation principal. Editor is the
    // native Access prerequisite for a later Mutate POST (boundary.rs), not
    // evidence of policy approval; preview still authorizes that actual POST.
    let selected = configured(&host, &source).filter(|selected| {
        selected.descriptor().authority.actor_id.to_string()
            == principal.principal.actor_id().as_str()
            && principal.principal.role() == a::Role::Editor
    });
    principal.release(&boundary).map_err(access_error)?;
    output(
        json!({"format":"atlas-homebox-quantity-availability/1","resolvedScope":scope(&source),"source":source,"state":if selected.is_some(){"available"}else{"unavailable"}}),
    )
}
pub(super) async fn preview(State(host): State<Host>, request: Request) -> HttpResult {
    let headers = headers(&request)?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let input: PreviewInput =
        serde_json::from_value(body(request, 16_384).await?).map_err(|_| invalid())?;
    if input.quantity > 9_007_199_254_740_991
        || input.reason.is_empty()
        || input.reason.len() > 2048
    {
        return Err(invalid());
    }
    let principal = authorize(&host, &headers, &uri, &method, &input.source)?;
    let selected =
        configured(&host, &input.source).ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    if selected.descriptor().authority.actor_id.to_string()
        != principal.principal.actor_id().as_str()
    {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    // A reviewed bound is a definite input refusal before capture or worker
    // admission. It must not be reported as an uncertain POST outcome.
    if selected
        .reviewed_policy()
        .get("maximum")
        .and_then(Value::as_u64)
        .is_some_and(|maximum| input.quantity > maximum)
    {
        return Err(invalid());
    }
    let id = Uuid::parse_str(&crate::app::new_id().map_err(|_| unavailable())?)
        .map_err(|_| unavailable())?;
    let (sender, inbox) = mpsc::sync_channel(4);
    let (reply, result) = oneshot::channel();
    {
        let mut registry = host
            .quantity_previews
            .try_lock()
            .map_err(|_| unavailable())?;
        if registry.entries.len() >= 16 {
            return Err(unavailable());
        }
        registry.entries.insert(
            id,
            Entry {
                sender,
                source: input.source.clone(),
                expires: Instant::now() + selected.descriptor().freshness,
            },
        );
    }
    let handle = tokio::runtime::Handle::current();
    let owner = host.core.clone();
    let registry = host.quantity_previews.clone();
    tokio::task::spawn_blocking(move || {
        let mut initial = Some(reply);
        let outcome = super::quantity_worker::Worker {
            core: owner,
            configured: selected,
            #[cfg(test)]
            tls_fixture: host.quantity_tls_fixture.clone(),
        }
        .run(input, principal, id, inbox, handle, &mut initial);
        if let Some(reply) = initial.take() {
            let _ = reply.send(outcome.map(|()| Value::Null));
        }
        if let Ok(mut registry) = registry.lock() {
            registry.entries.remove(&id);
        }
    });
    output(
        result
            .await
            .map_err(|_| unavailable())?
            .map_err(|_| unavailable())?,
    )
}
pub(super) async fn approval(State(host): State<Host>, request: Request) -> HttpResult {
    action(host, request, true).await
}
pub(super) async fn dispatch(State(host): State<Host>, request: Request) -> HttpResult {
    action(host, request, false).await
}
async fn action(host: Host, request: Request, approve: bool) -> HttpResult {
    let headers = headers(&request)?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let value = body(request, 4096).await?;
    let id: Uuid = serde_json::from_value(value.get("previewId").cloned().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let entry = host
        .quantity_previews
        .try_lock()
        .map_err(|_| unavailable())?
        .entries
        .get(&id)
        .filter(|entry| entry.expires > Instant::now())
        .cloned()
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let principal = authorize(&host, &headers, &uri, &method, &entry.source)?;
    let (reply, result) = oneshot::channel();
    let command = if approve {
        Command::Approve {
            principal,
            body: value,
            reply,
        }
    } else {
        if !value
            .as_object()
            .is_some_and(|object| object.contains_key("approvalReceiptId"))
        {
            return Err(invalid());
        }
        Command::Dispatch {
            principal,
            body: serde_json::from_value(value).map_err(|_| invalid())?,
            reply,
        }
    };
    entry.sender.try_send(command).map_err(|_| unavailable())?;
    output(
        result
            .await
            .map_err(|_| unavailable())?
            .map_err(|_| unavailable())?,
    )
}
