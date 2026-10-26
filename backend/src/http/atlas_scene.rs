//! One selected producer publication. Documentary overlays confer no native authority.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
fn selected<'a>(
    host: &'a Host,
    scope: &d::Scope,
) -> Result<
    (
        &'a crate::config::atlas_scene::ServerAtlasSceneSelection,
        &'a crate::config::model_overview::ServerModelOverviewSelection,
    ),
    HttpFailure,
> {
    let scene = host
        .atlas_scene
        .as_deref()
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let overview = host
        .model_overview
        .as_deref()
        .filter(|s| s.matches(scope))
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    scene
        .verify(overview)
        .map_err(|_| failure(StatusCode::CONFLICT))?;
    Ok((scene, overview))
}
pub(super) async fn descriptor(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move||{
        let _permit=headers.admission_permit()?;let scope=d::Scope{workspace_id,home_id};
        authorized_read_phased(&host,&headers,&uri,&method,(Some(scope.clone()),false),|_,_,_|Ok(()),|(),_|{
            let (scene,overview)=selected(&host,&scope)?;
            let manifest_sha256=overview.manifest_sha256.clone();
            let expected_query=format!("expectedManifestSha256={manifest_sha256}");
            if uri.query().is_some_and(|query|query!=expected_query){return Err(failure(StatusCode::CONFLICT));}
            let revision=scene.revision.clone();overview.read_original().map_err(|_|failure(StatusCode::CONFLICT))?;
            let p=&scene.value;let mut wire=json!({"profile":"houseatlas.unified-atlas-scene.v1","scope":p["scope"],"selection":{"revision":revision,"publicationId":p["publicationId"]},"publication":{"publicationId":p["publicationId"],"sourceRevisionId":p["sourceRevisionId"],"sourceSha256":p["sourceSha256"],"semanticsSha256":scene.semantics_sha256},"artifacts":[{"artifactId":"model","role":"model","contentType":"model/gltf-binary","bytes":overview.manifest.original.bytes,"sha256":overview.manifest.original.sha256,"href":format!("/api/atlas/models/v1/workspaces/{}/homes/{}/atlas/{}/artifacts/model?expectedSha256={}&expectedSelectionRevision={}",scope.workspace_id,scope.home_id,overview.manifest.publication_id,overview.manifest.original.sha256,revision)}]});
            if let Some(detail)=&overview.manifest.detail{wire["artifacts"].as_array_mut().ok_or_else(||failure(StatusCode::SERVICE_UNAVAILABLE))?.push(json!({"artifactId":"detail","role":"detail","contentType":"model/gltf-binary","bytes":detail.bytes,"sha256":detail.sha256,"href":format!("/api/atlas/models/v1/workspaces/{}/homes/{}/atlas/{}/artifacts/model-detail?expectedSha256={}&expectedSelectionRevision={}",scope.workspace_id,scope.home_id,overview.manifest.publication_id,detail.sha256,revision)}));}
            for key in ["frame","buildings","levels","rooms","occurrences","meshBindings","plans","overlayBindings","coverage"] {wire[key]=p[key].clone();}
            let (current,current_overview)=selected(&host,&scope)?;if current.revision!=revision||current_overview.manifest_sha256!=manifest_sha256{return Err(failure(StatusCode::CONFLICT));}
            current_overview.read_original().map_err(|_|failure(StatusCode::CONFLICT))?;
            let mut response=json_response(wire);response.headers_mut().insert("x-atlas-selection-revision",header::HeaderValue::from_str(&revision).map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?);
            response.headers_mut().insert("x-atlas-overview-manifest-sha256",header::HeaderValue::from_str(&manifest_sha256).map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?);
            if let Some(entry)=current.entry_building_id(){response.headers_mut().insert("x-atlas-entry-building-id",header::HeaderValue::from_str(entry).map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?);}
            Ok(response)
        })
    }).await.map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?
}
/// The overview GLB that every device loads.
pub(super) async fn model(
    State(host): State<Host>,
    path: Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    artifact(host, path, headers, uri, method, Artifact::Model).await
}
/// The optional unsimplified detail GLB of the same publication.
pub(super) async fn model_detail(
    State(host): State<Host>,
    path: Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    artifact(host, path, headers, uri, method, Artifact::Detail).await
}
#[derive(Clone, Copy)]
enum Artifact {
    Model,
    Detail,
}
async fn artifact(
    host: Host,
    Path((workspace_id, home_id, publication_id)): Path<(String, String, String)>,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    artifact: Artifact,
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
            |core, _, _| {
                let canonical = core.access.clone();
                let url = super::auth::url(&host, &uri);
                let observed =
                    evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
                let retained = crate::media::native::NativeMediaAccess::new(canonical.clone())
                    .authorize_request(
                        &observed,
                        &crate::media::types::Scope {
                            workspace_id: scope.workspace_id.clone(),
                            home_id: scope.home_id.clone(),
                        },
                    )
                    .map_err(|e| {
                        failure(
                            StatusCode::from_u16(e.status())
                                .unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
                        )
                    })?;
                Ok((canonical, retained))
            },
            |(canonical, retained), _| {
                let (scene, overview) = selected(&host, &scope)?;
                let revision = scene.revision.clone();
                let m = &overview.manifest;
                let pin = match artifact {
                    Artifact::Model => Some(&m.original),
                    Artifact::Detail => m.detail.as_ref(),
                };
                let Some(pin) = pin.filter(|_| publication_id == m.publication_id) else {
                    return Err(failure(StatusCode::NOT_FOUND));
                };
                let query = format!(
                    "expectedSha256={}&expectedSelectionRevision={}",
                    pin.sha256, revision
                );
                if uri.query() != Some(query.as_str()) {
                    return Err(failure(StatusCode::CONFLICT));
                }
                let bytes = match artifact {
                    Artifact::Model => overview.read_original(),
                    Artifact::Detail => overview
                        .read_detail()
                        .and_then(|bytes| bytes.ok_or_else(|| "Detail unavailable".into())),
                }
                .map_err(|_| failure(StatusCode::CONFLICT))?;
                let (current, _) = selected(&host, &scope)?;
                if current.revision != revision {
                    return Err(failure(StatusCode::CONFLICT));
                }
                let digest = format!("sha-256=:{}:", STANDARD.encode(Sha256::digest(&bytes)));
                let mut response = bytes.into_response();
                for (key, value) in [
                    ("content-type", "model/gltf-binary".into()),
                    ("content-length", pin.bytes.to_string()),
                    ("content-digest", digest),
                    ("x-atlas-selection-revision", revision),
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
