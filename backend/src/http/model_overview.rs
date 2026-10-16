//! Selected owner overview reads; independent of native geometry custody.
use super::*;
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use sha2::{Digest, Sha256};

pub(super) fn availability(host: &Host, scope: &d::Scope) -> Value {
    let selected = host.model_overview.as_ref().filter(|s| s.matches(scope));
    let selected = selected.filter(|s| s.read_original().is_ok());
    json!({
        "profile": "houseatlas.model-overview-read.v1",
        "available": selected.is_some(),
        "publicationId": selected.map(|s| &s.manifest.publication_id),
        "manifestSha256": selected.map(|s| &s.manifest_sha256),
    })
}
fn selected<'a>(
    host: &'a Host,
    scope: &d::Scope,
) -> Result<&'a crate::config::model_overview::ServerModelOverviewSelection, HttpFailure> {
    host.model_overview
        .as_deref()
        .filter(|s| s.matches(scope))
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))
}
pub(super) async fn descriptor(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope { workspace_id, home_id };
        authorized_read_phased(&host, &headers, &uri, &method, (Some(scope.clone()), false), |_, _, _| Ok(()), |(), _| {
            let s = selected(&host, &scope)?;
            s.read_original().map_err(|_| failure(StatusCode::CONFLICT))?;
            if uri.query().is_some() { return Err(failure(StatusCode::NOT_FOUND)); }
            let m = &s.manifest;
            let href = format!(
                "/api/atlas/models/v1/workspaces/{}/homes/{}/overview/{}/original?expectedSha256={}",
                scope.workspace_id, scope.home_id, m.publication_id, m.original.sha256,
            );
            Ok(json_response(json!({
                "profile": "houseatlas.model-overview-read.v1",
                "scope": m.scope, "publicationId": m.publication_id,
                "manifestSha256": s.manifest_sha256, "label": m.label,
                "qualification": m.qualification, "frame": m.frame,
                "components": m.components, "sourceNote": m.source_note,
                "original": {"contentType": m.original.content_type,
                    "sha256": m.original.sha256, "bytes": m.original.bytes, "href": href},
            })))
        })
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn original(
    State(host): State<Host>,
    Path((workspace_id, home_id, publication_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        // Retain Read issuance through final release and separately issue the
        // native Media action against the actual same request and Access owner.
        authorized_read_phased(
            &host,
            &headers,
            &uri,
            &method,
            (Some(scope.clone()), false),
            |core, _, _| {
                let canonical = Arc::clone(&core.access);
                let url = format!(
                    "{}{}",
                    host.origin,
                    uri.path_and_query().map_or("/", |v| v.as_str())
                );
                let observed =
                    evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
                let access = crate::media::native::NativeMediaAccess::new(Arc::clone(&canonical));
                let native_scope = crate::media::types::Scope {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                };
                let retained = access
                    .authorize_request(&observed, &native_scope)
                    .map_err(|e| {
                        failure(
                            StatusCode::from_u16(e.status())
                                .unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
                        )
                    })?;
                Ok((canonical, retained))
            },
            |(canonical, retained), _| {
                let s = selected(&host, &scope)?;
                let m = &s.manifest;
                let expected_query = format!("expectedSha256={}", m.original.sha256);
                if publication_id != m.publication_id
                    || uri.query() != Some(expected_query.as_str())
                {
                    return Err(failure(StatusCode::NOT_FOUND));
                }
                let bytes = s
                    .read_original()
                    .map_err(|_| failure(StatusCode::CONFLICT))?;
                let frame = json!({
                    "profile": "houseatlas.model-overview-bytes.v1", "scope": m.scope,
                    "publicationId": m.publication_id, "manifestSha256": s.manifest_sha256,
                    "original": {"contentType": m.original.content_type,
                        "sha256": m.original.sha256, "bytes": m.original.bytes},
                });
                let frame = serde_jcs::to_vec(&frame)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let content_digest =
                    format!("sha-256=:{}:", STANDARD.encode(Sha256::digest(&bytes)));
                let mut response = bytes.into_response();
                for (key, value) in [
                    ("content-type", "model/gltf-binary".into()),
                    ("content-length", m.original.bytes.to_string()),
                    ("content-digest", content_digest),
                    ("x-atlas-model-frame", URL_SAFE_NO_PAD.encode(frame)),
                ] {
                    response.headers_mut().insert(
                        header::HeaderName::from_static(key),
                        header::HeaderValue::from_str(&value)
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                    );
                }
                let request = RequestPrincipal::from_retained(retained);
                let current = canonical
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                current
                    .authorize_storage(
                        request.principal.principal(),
                        &crate::app::access_scope(&scope)
                            .map_err(|_| failure(StatusCode::NOT_FOUND))?,
                        a::Capability::ReadAssetManifest,
                    )
                    .map_err(access_error)?;
                request.release(&current).map_err(access_error)?;
                Ok(response)
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
