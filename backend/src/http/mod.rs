//! Loopback TLS routes and browser DTO projection. No source/provider transport.
mod admission;
pub mod agents;
pub mod ai;
mod auth;
pub mod contracts;
mod editing;
mod headers;
mod intake;
mod media;
mod mutations;
mod pages;
pub mod providers;
pub mod qualified_upload_plan;
mod query;
mod reads;
mod response;
mod stock_mutations;
mod stock_reads;
mod upload;
mod upload_batch;
pub mod upload_intake;
use crate::{
    access as a,
    app::{Core, HomeAuthority, Reads, RequestPrincipal, capture_homes},
    domain as d,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Request, State},
    http::{Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use headers::CheckedHeaders;
use response::{HttpFailure, ResponseIds, private_headers};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Host {
    pub core: Arc<Mutex<Core>>,
    pub origin: String,
    pub files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
    homebox_cache_sources: Arc<Vec<crate::config::providers::homebox::TrustedHomeBoxSource>>,
    response_ids: Arc<ResponseIds>,
    pages: Arc<Mutex<pages::Pages>>,
    admission: Arc<admission::Admission>,
    mcp: Arc<Mutex<agents::mcp_transport::TransportSessions>>,
    // Same native Access owner; immutable configured scopes copied at startup.
    mcp_access: crate::app::Access,
    mcp_scopes: Arc<Vec<d::Scope>>,
}
impl Host {
    pub fn new(
        core: Core,
        origin: String,
        files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
        homebox_cache_sources: Vec<crate::config::providers::homebox::TrustedHomeBoxSource>,
    ) -> crate::storage::Result<Self> {
        Ok(Self {
            mcp_access: core.access.clone(),
            mcp_scopes: Arc::new(core.homes.iter().map(|home| home.scope.clone()).collect()),
            core: Arc::new(Mutex::new(core)),
            origin,
            files,
            homebox_cache_sources: Arc::new(homebox_cache_sources),
            response_ids: Arc::new(ResponseIds::new()?),
            pages: Arc::new(Mutex::new(pages::Pages::default())),
            admission: Arc::new(admission::Admission::default()),
            mcp: Arc::new(Mutex::new(
                agents::mcp_transport::TransportSessions::default(),
            )),
        })
    }
}
type HttpResult = Result<Response, HttpFailure>;
fn failure(status: StatusCode) -> HttpFailure {
    HttpFailure::for_status(status)
}
fn access_error(error: a::AccessError) -> HttpFailure {
    HttpFailure::for_status(
        StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
    )
}
fn domain_error(error: d::DomainError) -> HttpFailure {
    use crate::contracts::ApiErrorCode as C;
    let (status, code) = match error {
        d::DomainError::Unauthenticated => (StatusCode::UNAUTHORIZED, C::Unauthenticated),
        d::DomainError::Forbidden => (StatusCode::FORBIDDEN, C::Forbidden),
        d::DomainError::NotFound => (StatusCode::NOT_FOUND, C::NotFound),
        d::DomainError::InvalidContract => (StatusCode::UNPROCESSABLE_ENTITY, C::InvalidContract),
        d::DomainError::RevisionRequired { .. } => {
            (StatusCode::PRECONDITION_REQUIRED, C::RevisionRequired)
        }
        d::DomainError::RevisionConflict { .. } => {
            (StatusCode::PRECONDITION_FAILED, C::RevisionConflict)
        }
        d::DomainError::GuardConflict { .. } => (StatusCode::PRECONDITION_FAILED, C::GuardConflict),
        d::DomainError::IdentityConflict => (StatusCode::CONFLICT, C::IdentityConflict),
        d::DomainError::IdempotencyConflict => (StatusCode::CONFLICT, C::IdempotencyConflict),
        d::DomainError::InvalidTransition => (StatusCode::CONFLICT, C::InvalidTransition),
        d::DomainError::UpstreamIncomplete => {
            (StatusCode::SERVICE_UNAVAILABLE, C::UpstreamIncomplete)
        }
        d::DomainError::UpstreamUnavailable => {
            (StatusCode::SERVICE_UNAVAILABLE, C::UpstreamUnavailable)
        }
    };
    HttpFailure {
        status,
        code,
        current_revision: error.current_revision(),
    }
}
async fn response_adapter(State(host): State<Host>, mut request: Request, next: Next) -> Response {
    let mcp_path = agents::mcp_transport::matches_path(request.uri().path());
    let request_id = host.response_ids.next();
    let admitted = host.admission.admit();
    let checked = admitted.as_ref().map_err(Clone::clone).and_then(|permit| {
        let headers =
            CheckedHeaders::read(request.headers(), request.version()).map_err(access_error)?;
        headers
            .check_authority(&host.origin, request.uri())
            .map_err(access_error)?;
        Ok(headers.with_admission(permit.clone()))
    });
    // Keep admission through response construction even when route extraction
    // drops request extensions; blocking closures retain their separate clones.
    let _admitted = admitted;
    let mut response = if request.uri().path().contains('%') {
        failure(StatusCode::FORBIDDEN).into_response()
    } else {
        match checked {
            Ok(headers) => {
                request.extensions_mut().insert(headers);
                next.run(request).await
            }
            Err(error) => error.into_response(),
        }
    };
    if (response.status().is_client_error() || response.status().is_server_error())
        && !agents::is_stock_response(&response)
        && !agents::mcp_transport::is_mcp_response(&response)
    {
        let error = response
            .extensions()
            .get::<HttpFailure>()
            .cloned()
            .unwrap_or_else(|| HttpFailure::for_status(response.status()));
        let allow = response.headers().get(header::ALLOW).cloned();
        response = if mcp_path {
            agents::mcp_transport::http_failure(error)
        } else {
            error.response(request_id)
        };
        if let Some(allow) = allow {
            response.headers_mut().insert(header::ALLOW, allow);
        }
    }
    private_headers(&mut response);
    response
}
fn evidence<'a>(
    origin: &str,
    headers: &'a CheckedHeaders,
    uri: &Uri,
    url: &'a str,
    method: &Method,
) -> Result<a::RequestEvidence<'a>, a::AccessError> {
    headers.check_authority(origin, uri)?;
    Ok(a::RequestEvidence {
        method: match *method {
            Method::GET => a::Method::Get,
            Method::HEAD => a::Method::Head,
            Method::POST => a::Method::Post,
            _ => a::Method::Other,
        },
        url,
        origin: headers.origin.as_deref(),
        sec_fetch_site: headers.sec_fetch_site.as_deref(),
        referer: headers.referer.as_deref(),
        cookie: headers.cookie.as_deref(),
        authorization: headers.authorization.as_deref(),
        csrf: headers.csrf.as_deref(),
    })
}
fn authorized_read<T>(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: Option<d::Scope>,
    include_home_choices: bool,
    operation: impl FnOnce(&mut Core, &RequestPrincipal, &d::HomeSummary) -> Result<T, HttpFailure>,
) -> Result<T, HttpFailure> {
    // Caller-selected scope syntax has the same 404 contract on every read
    // route, before any session or data lookup. Trusted configured scopes are
    // still checked by the access boundary in capture_homes.
    if let Some(scope) = &scope {
        crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    }
    let mut core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let url = format!(
        "{}{}",
        host.origin,
        uri.path_and_query().map_or("/", |p| p.as_str())
    );
    let request = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let mut choices = {
        let mut access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if include_home_choices || scope.is_none() {
            capture_homes(&mut access, &request, &core.homes).map_err(access_error)?
        } else {
            let scope = scope
                .as_ref()
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            let principal = access
                .authorize(
                    &request,
                    &crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?,
                    a::Action::Read,
                )
                .map_err(access_error)?;
            let summary = core
                .homes
                .iter()
                .find(|home| home.scope == *scope)
                .cloned()
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            vec![crate::app::CapturedHome { summary, principal }]
        }
    };
    let selected = match scope {
        Some(scope) => choices
            .iter()
            .position(|choice| choice.summary.scope == scope),
        None => choices
            .iter()
            .position(|choice| choice.summary.scope == core.home.scope)
            .or_else(|| (!choices.is_empty()).then_some(0)),
    }
    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let selected = choices.remove(selected);
    let mut principal = RequestPrincipal::new(selected.principal);
    principal.home_choices = choices;
    let result = operation(&mut core, &principal, &selected.summary)?;
    let access = core
        .access
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    principal.release(&access).map_err(access_error)?;
    Ok(result)
}
fn query_view(
    core: &mut Core,
    principal: &RequestPrincipal,
    home: &d::HomeSummary,
) -> Result<d::CurrentOutput, HttpFailure> {
    let mut queries = d::Queries {
        store: Reads(
            core.store
                .get_mut()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        ),
        access: HomeAuthority {
            access: Arc::clone(&core.access),
            home: home.clone(),
        },
    };
    queries
        .current(
            principal,
            &home.scope,
            &crate::app::now().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
            &[],
        )
        .map_err(domain_error)
}
/// Deliberate narrow projection for AT10's browser wire proposal. Unimplemented
/// extension facts stay unknown/absent; the read-only graph excludes Network.
fn browser_view(view: d::CurrentOutput) -> Result<Value, HttpFailure> {
    let mut v = serde_json::to_value(view).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    for entry in v["entries"]
        .as_array_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?
    {
        browser_entry(entry);
    }
    Ok(v)
}
fn browser_entry(entry: &mut Value) {
    entry["key"] = Value::String(
        json!([
            entry["source"]["sourceInstanceId"],
            entry["source"]["collectionId"],
            entry["source"]["sourceKind"],
            entry["source"]["externalId"]
        ])
        .to_string(),
    );
    entry["aliases"] = json!([]);
    entry["mobility"] = json!("unknown");
    entry["networkBound"] = json!(false);
    entry["networkStates"] = json!([]);
    entry["networkRelations"] = json!([]);
}
fn browser_entries(entries: Vec<&d::CurrentEntry>) -> Result<Value, HttpFailure> {
    let mut values =
        serde_json::to_value(entries).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    for entry in values
        .as_array_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?
    {
        browser_entry(entry);
    }
    Ok(values)
}
fn json_response(v: Value) -> Response {
    Json(v).into_response()
}
async fn current(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            None,
            true,
            |core, principal, home| {
                Ok(json_response(browser_view(query_view(
                    core, principal, home,
                )?)?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn scoped(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
            true,
            |core, principal, home| {
                Ok(json_response(browser_view(query_view(
                    core, principal, home,
                )?)?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn rooms(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            None,
            true,
            |core, principal, home| {
                let view = query_view(core, principal, home)?;
                Ok(json_response(browser_entries(view.rooms(false))?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn items(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            None,
            true,
            |core, principal, home| {
                let view = query_view(core, principal, home)?;
                Ok(json_response(browser_entries(view.items(false))?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn homes(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = format!(
            "{}{}",
            host.origin,
            uri.path_and_query().map_or("/", |p| p.as_str())
        );
        let observed =
            evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
        let choices = {
            let mut access = core
                .access
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            capture_homes(&mut access, &observed, &core.homes).map_err(access_error)?
        };
        let response = json_response(
            serde_json::to_value(
                choices
                    .iter()
                    .map(|choice| &choice.summary)
                    .collect::<Vec<_>>(),
            )
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        );
        let access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        for choice in &choices {
            access.revalidate(&choice.principal).map_err(access_error)?;
        }
        Ok(response)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn static_file(State(host): State<Host>, uri: Uri) -> HttpResult {
    if uri.path() == "/favicon.ico" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let key = if uri.path() == "/" {
        "/index.html"
    } else {
        uri.path()
    };
    let (kind, bytes) = host
        .files
        .get(key)
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let mut response = bytes.clone().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        kind.parse()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
    );
    Ok(response)
}
pub fn router(host: Host) -> Router {
    router_with_ai(host, None)
}
/// The caller supplies an AI router bound to actual session and enrollment peers.
pub fn router_with_ai(host: Host, ai: Option<Router>) -> Router {
    let base = Router::new()
        .route("/api/atlas/providers/homebox/workspaces/{workspace_id}/homes/{home_id}/sources/{source_instance_id}/collections/{collection_id}/cached", get(providers::cached_homebox).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/providers/homebox/workspaces/{workspace_id}/homes/{home_id}/sources/{source_instance_id}/cached", get(providers::cached_homebox_query).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/mcp/workspaces/{workspace_id}/homes/{home_id}", post(agents::mcp_transport::post).get(agents::mcp_transport::unsupported).head(agents::mcp_transport::unsupported).delete(agents::mcp_transport::unsupported).fallback(agents::mcp_transport::unsupported))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/place", get(editing::place).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/places/{record_id}/evidence", post(upload::command))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/admission", get(agents::admission).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/invoke", get(agents::invoke).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/commands", post(stock_mutations::command))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}", get(stock_reads::record).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}/history", get(stock_reads::history).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/media/{workspace_id}/{home_id}/{digest}/{mode}", get(media::deliver).fallback(media::other))
        .route("/api/atlas/view", get(current))
        .route(
            "/api/atlas/homes/{workspace_id}/{home_id}/view",
            get(scoped),
        )
        .route("/api/atlas/rooms", get(rooms))
        .route("/api/atlas/items", get(items))
        .route("/api/atlas/homes", get(homes))
        .route("/api/atlas/auth/login", post(auth::login))
        .route(
            "/api/atlas/auth/session",
            get(auth::session)
                .head(auth::session_head)
                .fallback(auth::session_head),
        )
        .route("/api/atlas/auth/rotate", post(auth::rotate))
        .route("/api/atlas/auth/logout", post(auth::logout))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}/mutations", post(mutations::single))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/mutations", post(mutations::batch))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/view", get(reads::view).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/records", get(reads::records).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/homebox/entities", get(reads::homebox).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/network/relations", get(reads::network).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}", get(reads::record).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}/history", get(reads::history).head(auth::session_head).fallback(auth::session_head))
        .fallback(get(static_file));
    let base = match ai {
        Some(ai) => base.nest(
            "/api/atlas/v1/workspaces/{workspace_id}/homes/{home_id}/ai",
            ai.with_state::<Host>(()),
        ),
        None => base,
    };
    base.layer(middleware::from_fn_with_state(
        host.clone(),
        response_adapter,
    ))
    .with_state(host)
}
