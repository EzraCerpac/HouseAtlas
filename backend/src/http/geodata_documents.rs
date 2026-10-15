//! Exclusive explicit v2 dataset route selection. No source fetch or renderer.
use super::*;
use crate::{
    contracts::v2,
    media as m,
    storage::{self as s, geodata::GeodataStore},
};
use axum::{body::Body, http::HeaderValue};
use base64::Engine;
use std::time::Duration;
fn unavailable() -> HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn error(e: s::Error) -> HttpFailure {
    failure(match e.code {
        "forbidden" => StatusCode::FORBIDDEN,
        "not-found" => StatusCode::NOT_FOUND,
        "revision-conflict" | "identity-conflict" => StatusCode::CONFLICT,
        "invalid-contract" | "invalid-transition" => StatusCode::UNPROCESSABLE_ENTITY,
        "asset-unavailable" => StatusCode::NOT_FOUND,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    })
}
fn budget() -> Result<m::WorkBudget, HttpFailure> {
    m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
        .map_err(|_| unavailable())
}
fn selected(host: &Host) -> Result<Arc<Mutex<GeodataStore>>, HttpFailure> {
    host.geodata_dataset.clone().ok_or_else(unavailable)
}
fn principal(
    host: &Host,
    checked: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &s::Scope,
    write: bool,
) -> Result<a::Principal, HttpFailure> {
    let core = host.core.lock().map_err(|_| unavailable())?;
    if !core
        .homes
        .iter()
        .any(|h| h.scope.workspace_id == scope.workspace_id && h.scope.home_id == scope.home_id)
    {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let url = format!("{}{}", host.origin, uri.path());
    let request = evidence(&host.origin, checked, uri, &url, method).map_err(access_error)?;
    let scope = crate::app::access_scope(&d::Scope {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
    })
    .map_err(access_error)?;
    let principal = core
        .access
        .lock()
        .map_err(|_| unavailable())?
        .authorize(
            &request,
            &scope,
            if write {
                a::Action::Mutate
            } else {
                a::Action::Read
            },
        )
        .map_err(access_error)?;
    Ok(principal)
}
pub(super) fn router(host: Host) -> Router {
    // Selecting v2 selects this entire dataset route table. Legacy native core,
    // Stock, uploads, providers and AI endpoints are not composed alongside it.
    Router::new()
        .route("/api/atlas/documents/v2/workspaces/{workspace_id}/homes/{home_id}/documents",get(list).post(create).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/documents/v2/workspaces/{workspace_id}/homes/{home_id}/documents/{document_id}",get(get_document).post(mutate).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/documents/v2/workspaces/{workspace_id}/homes/{home_id}/documents/{document_id}/original",get(original).fallback(auth::session_head))
        .route("/api/atlas/homes",get(homes))
        .route("/api/atlas/auth/mode",get(auth::mode))
        .route("/api/atlas/auth/local",post(auth::local))
        .route("/api/atlas/auth/login",post(auth::login))
        .route("/api/atlas/auth/proxy",post(auth::proxy))
        .route("/api/atlas/auth/session",get(auth::session).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/auth/rotate",post(auth::rotate))
        .route("/api/atlas/auth/logout",post(auth::logout))
        .fallback(get(static_file))
        .layer(middleware::from_fn_with_state(host.clone(),response_adapter)).with_state(host)
}
async fn list(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
) -> HttpResult {
    let scope = s::Scope {
        workspace_id,
        home_id,
    };
    let mut cursor = None;
    let mut limit = 50;
    if let Some(query) = uri.query() {
        if query.len() > 8192 {
            return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
        }
        let mut seen = std::collections::BTreeSet::new();
        for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
            if !seen.insert(k.clone()) {
                return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
            }
            match k.as_ref() {
                "cursor" => cursor = Some(v.into_owned()),
                "limit" => {
                    limit = v
                        .parse()
                        .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?
                }
                _ => return Err(failure(StatusCode::UNPROCESSABLE_ENTITY)),
            }
        }
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let p = principal(&host, &checked, &uri, &Method::GET, &scope, false)?;
        let store = selected(&host)?;
        let value = store
            .lock()
            .map_err(|_| unavailable())?
            .list(&p, &scope, cursor.as_deref(), limit, &budget()?)
            .map_err(error)?;
        Ok(json_response(value))
    })
    .await
    .map_err(|_| unavailable())?
}
async fn get_document(
    State(host): State<Host>,
    Path((workspace_id, home_id, document_id)): Path<(String, String, String)>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let scope = s::Scope {
            workspace_id,
            home_id,
        };
        let p = principal(&host, &checked, &uri, &Method::GET, &scope, false)?;
        let store = selected(&host)?;
        let value = store
            .lock()
            .map_err(|_| unavailable())?
            .get(&p, &scope, &document_id, &budget()?)
            .map_err(error)?;
        Ok(json_response(value))
    })
    .await
    .map_err(|_| unavailable())?
}
async fn original(
    State(host): State<Host>,
    Path((workspace_id, home_id, document_id)): Path<(String, String, String)>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
) -> HttpResult {
    let revision = super::query::one_utf8(&uri, "expectedRevision", 64, 16)?
        .parse::<u64>()
        .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let scope = s::Scope {
            workspace_id,
            home_id,
        };
        let p = principal(&host, &checked, &uri, &Method::GET, &scope, false)?;
        let store = selected(&host)?;
        let (frame, bytes) = store
            .lock()
            .map_err(|_| unavailable())?
            .read_original(&p, &scope, &document_id, revision, &budget()?)
            .map_err(error)?;
        let frame_bytes = serde_jcs::to_vec(&frame).map_err(|_| unavailable())?;
        let mut response = Response::new(Body::from(bytes));
        let h = response.headers_mut();
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(
                frame["measuredContentType"]
                    .as_str()
                    .ok_or_else(unavailable)?,
            )
            .map_err(|_| unavailable())?,
        );
        h.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=\"geodata-original\""),
        );
        h.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&frame["asset"]["bytes"].to_string())
                .map_err(|_| unavailable())?,
        );
        h.insert(
            "x-atlas-document-frame",
            HeaderValue::from_str(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(frame_bytes),
            )
            .map_err(|_| unavailable())?,
        );
        h.insert(
            "content-digest",
            HeaderValue::from_str(&format!(
                "sha-256=:{}:",
                base64::engine::general_purpose::STANDARD.encode(hex_digest(
                    frame["asset"]["sha256"].as_str().ok_or_else(unavailable)?
                )?)
            ))
            .map_err(|_| unavailable())?,
        );
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("sandbox; default-src 'none'"),
        );
        private_headers(&mut response);
        Ok(response)
    })
    .await
    .map_err(|_| unavailable())?
}
fn hex_digest(s: &str) -> Result<Vec<u8>, HttpFailure> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| unavailable()))
        .collect()
}
async fn create(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> HttpResult {
    write(host, workspace_id, home_id, None, request).await
}
async fn mutate(
    State(host): State<Host>,
    Path((workspace_id, home_id, document_id)): Path<(String, String, String)>,
    request: Request,
) -> HttpResult {
    write(host, workspace_id, home_id, Some(document_id), request).await
}
async fn write(
    host: Host,
    workspace_id: String,
    home_id: String,
    document_id: Option<String>,
    request: Request,
) -> HttpResult {
    if request.uri().query().is_some() {
        return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
    }
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(unavailable)?;
    let uri = request.uri().clone();
    let scope = s::Scope {
        workspace_id,
        home_id,
    };
    let auth_host = host.clone();
    let auth_checked = checked.clone();
    let auth_uri = uri.clone();
    let auth_scope = scope.clone();
    let p = tokio::task::spawn_blocking(move || {
        let _admitted = auth_checked.admission_permit()?;
        principal(
            &auth_host,
            &auth_checked,
            &auth_uri,
            &Method::POST,
            &auth_scope,
            true,
        )
    })
    .await
    .map_err(|_| unavailable())??;
    let _permit = host
        .upload_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| failure(StatusCode::TOO_MANY_REQUESTS))?;
    // Base64 JSON envelope has an explicit bound; decoded original remains <=10MiB.
    let body = super::admission::body(request.into_body(), 14 * 1024 * 1024).await?;
    let input = v2::parse_value(&body).map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    tokio::task::spawn_blocking(move || {
        let _permit = _permit;
        let _admitted = checked.admission_permit()?;
        let store = selected(&host)?;
        let mut store = store.lock().map_err(|_| unavailable())?;
        let value = if let Some(id) = document_id {
            store
                .mutate_document(&p, &scope, &id, &input, &budget()?)
                .map_err(error)?
        } else {
            if !input.as_object().is_some_and(|o| {
                o.len() == 2 && o.contains_key("request") && o.contains_key("originalBase64")
            }) {
                return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(
                    input["originalBase64"]
                        .as_str()
                        .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?,
                )
                .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
            store
                .create_original(&p, &scope, &input["request"], &bytes, &budget()?)
                .map_err(error)?
        };
        Ok(json_response(value))
    })
    .await
    .map_err(|_| unavailable())?
}
