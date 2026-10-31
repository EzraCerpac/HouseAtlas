//! Protected display policy for one exact selected scene; no native identity or write.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
pub(super) async fn read(
    State(host): State<Host>,
    Path((workspace_id, home_id, publication_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        authorized_read_phased(
            &host,
            &headers,
            &uri,
            &method,
            (Some(scope.clone()), false),
            |_, _, _| Ok(()),
            |(), _| {
                let policy = host
                    .atlas_display_policy
                    .as_deref()
                    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
                let overview = host
                    .model_overview
                    .as_deref()
                    .filter(|s| s.matches(&scope))
                    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
                let scene = host
                    .atlas_scene
                    .as_deref()
                    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
                if publication_id != overview.manifest.publication_id {
                    return Err(failure(StatusCode::CONFLICT));
                }
                let revision = scene.revision.clone();
                let query = format!(
                    "expectedSha256={}&expectedSemanticsSha256={}&expectedSelectionRevision={}",
                    policy.sha256(),
                    scene.semantics_sha256,
                    revision
                );
                if uri.query() != Some(query.as_str()) {
                    return Err(failure(StatusCode::CONFLICT));
                }
                overview
                    .read_original()
                    .map_err(|_| failure(StatusCode::CONFLICT))?;
                let bytes = policy
                    .read(scene, overview)
                    .map_err(|_| failure(StatusCode::CONFLICT))?;
                let digest = format!("sha-256=:{}:", STANDARD.encode(Sha256::digest(&bytes)));
                let len = bytes.len();
                let mut response = bytes.into_response();
                for (key, value) in [
                    ("content-type", "application/json".into()),
                    ("content-length", len.to_string()),
                    ("content-digest", digest),
                    ("x-atlas-selection-revision", revision),
                ] {
                    response.headers_mut().insert(
                        header::HeaderName::from_static(key),
                        header::HeaderValue::from_str(&value)
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                    );
                }
                // Repeat exact file/selection fences after response preparation and
                // before the outer phased owner performs final native Read release.
                policy
                    .read(scene, overview)
                    .map_err(|_| failure(StatusCode::CONFLICT))?;
                overview
                    .read_original()
                    .map_err(|_| failure(StatusCode::CONFLICT))?;
                Ok(response)
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
