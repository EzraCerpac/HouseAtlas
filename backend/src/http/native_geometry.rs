//! Native custody first: two separately committed real assets, then one existing
//! atomic three-child Stock association. Reads never convert or import geometry.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, headers, intake,
    json_response, stock_mutations, stock_reads,
};
use crate::{
    access as a,
    app::{Core, RequestPrincipal, ServerRuntime},
    domain::{self as d, stock as st},
    media as m, storage as s,
};
use axum::{
    extract::{DefaultBodyLimit, Extension, FromRequest, Multipart, Path, Request, State},
    http::{HeaderValue, Method, StatusCode, Uri, header},
    response::IntoResponse,
};
use m::geometry_bundle as bundle;
use m::native::{NativeMediaAccess, NativeMediaStorage};
use m::service::{
    DeliveryMode, MediaAccessPort, MediaStoragePort, OwnedDescriptor, OwnedMediaMetadata,
};
use m::types::{AssetPurpose, ContentType, Scope as MediaScope};
use s::Contract;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn invalid() -> super::HttpFailure {
    failure(StatusCode::UNPROCESSABLE_ENTITY)
}
fn media_error(e: m::MediaError) -> super::HttpFailure {
    failure(StatusCode::from_u16(e.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}
fn private(mut response: axum::response::Response) -> axum::response::Response {
    for (name, value) in [
        (header::CACHE_CONTROL, "private, no-store"),
        (header::VARY, "Cookie, Origin"),
        (
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; sandbox",
        ),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
    ] {
        response
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
    response
}
fn snapshot(
    core: &Core,
    p: &RequestPrincipal,
    scope: &s::Scope,
) -> Result<s::Snapshot, super::HttpFailure> {
    let snapshot = core
        .store
        .lock()
        .map_err(|_| unavailable())?
        .read_snapshot(p, scope)
        .map_err(|e| super::domain_error(crate::app::storage_error(e)))?;
    super::contracts::NativeContracts
        .validate_snapshot(&snapshot)
        .map_err(|_| unavailable())?;
    stock_reads::capture_graph(&core.access, p, &snapshot).map_err(stock_reads::http_error)?;
    Ok(snapshot)
}
fn authorize(
    host: &Host,
    checked: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &d::Scope,
    action: a::Action,
) -> Result<RequestPrincipal, super::HttpFailure> {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let native = crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let core = host.core.lock().map_err(|_| unavailable())?;
    if !core.homes.iter().any(|h| h.scope == *scope) {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let url = format!("{}{}", host.origin, uri.path());
    let observed = evidence(&host.origin, checked, uri, &url, method).map_err(access_error)?;
    let issued = core
        .access
        .lock()
        .map_err(|_| unavailable())?
        .authorize(&observed, &native, action)
        .map_err(access_error)?;
    Ok(RequestPrincipal::new(issued))
}
struct CancelOnDrop(m::Cancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
fn budget(cancellation: m::Cancellation) -> Result<m::WorkBudget, super::HttpFailure> {
    m::WorkBudget::new(Duration::from_secs(10), cancellation).map_err(media_error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    schema_version: u8,
    request_id: String,
    idempotency_key: String,
    context: s::Scope,
    reason: String,
    filename: String,
    content_type: String,
    source_license: m::types::SourceLicense,
}
struct Input {
    metadata: Metadata,
    bytes: Vec<u8>,
}
async fn collect(
    field: &mut axum::extract::multipart::Field<'_>,
    maximum: usize,
) -> Result<Vec<u8>, super::HttpFailure> {
    let mut out = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(|_| invalid())? {
        if chunk.len() > maximum.saturating_sub(out.len()) {
            return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}
async fn read_input(mut request: Request, maximum: usize) -> Result<Input, super::HttpFailure> {
    if let Some(length) =
        headers::single(request.headers(), "content-length").map_err(access_error)?
        && (length.is_empty()
            || !length.bytes().all(|b| b.is_ascii_digit())
            || length.parse::<usize>().map_err(|_| invalid())? > maximum + 32_768)
    {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    headers::single(request.headers(), "content-type")
        .map_err(access_error)?
        .ok_or_else(|| failure(StatusCode::UNSUPPORTED_MEDIA_TYPE))?;
    DefaultBodyLimit::max(maximum + 32_768).apply(&mut request);
    let mut fields = Multipart::from_request(request, &())
        .await
        .map_err(|_| failure(StatusCode::UNSUPPORTED_MEDIA_TYPE))?;
    let metadata = {
        let mut field = fields
            .next_field()
            .await
            .map_err(|_| invalid())?
            .ok_or_else(invalid)?;
        if field.name() != Some("metadata") || field.file_name().is_some() {
            return Err(invalid());
        }
        let bytes = collect(&mut field, 16_384).await?;
        let raw = intake::json(&bytes)?;
        super::contracts::NativeContracts
            .validate_shape("scope", &raw["context"])
            .map_err(|_| invalid())?;
        crate::contracts::decode::<crate::contracts::License>(
            &serde_json::to_vec(&raw["sourceLicense"]).map_err(|_| invalid())?,
        )
        .map_err(|_| invalid())?;
        let metadata: Metadata = serde_json::from_value(raw).map_err(|_| invalid())?;
        if metadata.schema_version != 1
            || !m::types::is_uuid(&metadata.request_id)
            || !m::types::is_uuid(&metadata.idempotency_key)
            || metadata.reason.trim().is_empty()
            || metadata.reason.chars().count() > 1024
            || metadata.filename.is_empty()
            || metadata.filename.chars().count() > 255
            || metadata
                .filename
                .chars()
                .any(|c| c == '/' || c == '\\' || c <= '\u{1f}')
        {
            return Err(invalid());
        }
        metadata
    };
    let bytes = {
        let mut field = fields
            .next_field()
            .await
            .map_err(|_| invalid())?
            .ok_or_else(invalid)?;
        if field.name() != Some("file")
            || field.file_name() != Some(metadata.filename.as_str())
            || field.content_type() != Some(metadata.content_type.as_str())
        {
            return Err(invalid());
        }
        let bytes = collect(&mut field, maximum).await?;
        if bytes.is_empty() {
            return Err(invalid());
        }
        bytes
    };
    if fields.next_field().await.map_err(|_| invalid())?.is_some() {
        return Err(invalid());
    }
    Ok(Input { metadata, bytes })
}

pub(super) async fn original(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> HttpResult {
    custody(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        None,
        request,
    )
    .await
}
pub(super) async fn derivative(
    State(host): State<Host>,
    Path((workspace_id, home_id, original_id)): Path<(String, String, String)>,
    request: Request,
) -> HttpResult {
    custody(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        Some(original_id),
        request,
    )
    .await
}
async fn custody(
    host: Host,
    scope: d::Scope,
    original_id: Option<String>,
    request: Request,
) -> HttpResult {
    if request.uri().query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    if original_id
        .as_ref()
        .is_some_and(|id| !m::types::is_uuid(id))
    {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(unavailable)?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let h = host.clone();
    let c = checked.clone();
    let sc = scope.clone();
    let p = tokio::task::spawn_blocking(move || {
        let _permit = c.admission_permit()?;
        authorize(&h, &c, &uri, &method, &sc, a::Action::Mutate)
    })
    .await
    .map_err(|_| unavailable())??;
    let limit = if original_id.is_some() {
        m::mesh_derivative::MAX_MESH_BYTES.max(m::ifc_glb::MAX_BYTES)
    } else {
        m::MAX_BYTES
    };
    let input = tokio::time::timeout(Duration::from_secs(10), read_input(request, limit))
        .await
        .map_err(|_| failure(StatusCode::REQUEST_TIMEOUT))??;
    let cancellation = m::Cancellation::default();
    let _cancel = CancelOnDrop(cancellation.clone());
    let work = budget(cancellation)?;
    tokio::task::spawn_blocking(move || {
        let _permit=checked.admission_permit()?; work.check().map_err(media_error)?;
        let core=host.core.lock().map_err(|_|unavailable())?;
        let selected=s::Scope{workspace_id:scope.workspace_id.clone(),home_id:scope.home_id.clone()};
        if input.metadata.context != selected || !core.homes.iter().any(|h|h.scope == scope) {return Err(failure(StatusCode::FORBIDDEN));}
        let metadata=input.metadata; let content=ContentType::parse_owned(&metadata.content_type).map_err(media_error)?;
        let purpose=if original_id.is_some() {AssetPurpose::DerivedPreview} else {AssetPurpose::GeometryOriginal};
        if !content.supports_purpose(purpose) || original_id.is_none() && !matches!(content,ContentType::Usdz | ContentType::Ifc)
            || original_id.is_some() && !matches!(content,ContentType::AuthoredMesh | ContentType::IfcGlb) {return Err(invalid());}
        let source=if let Some(id)=&original_id {
            let owned=NativeMediaStorage::new(&core.store).read_owned_asset(&p,&MediaScope{workspace_id:scope.workspace_id.clone(),home_id:scope.home_id.clone()},id).map_err(media_error)?;
            if owned.record.payload != owned.manifest {return Err(unavailable());}
            Some(owned.record)
        } else {None};
        let runtime=ServerRuntime; let stages=m::staged_upload::NativeUploadStages::open(&core.vault,&runtime).map_err(media_error)?;
        let contracts=st::NativeStockContract::new().map_err(stock_reads::http_error)?;
        let admission=m::staged_upload::UploadAdmission{request_id:metadata.request_id.clone(),purpose,content_type:content,filename:metadata.filename.clone(),source_license:metadata.source_license.clone(),evidence_ids:vec![]};
        let mut staged=None;
        {
            let mut access=core.access.lock().map_err(|_|unavailable())?; p.release(&access).map_err(access_error)?;
            access.with_mutation_authorization::<super::HttpFailure>(p.principal.principal(),|guard| {
                let receipt=if let Some(source)=&source {
                    if content==ContentType::IfcGlb {
                        stages.stage_ifc_glb(guard,p.principal.retained(),admission,source,&input.bytes,&work)
                    } else {
                        stages.stage_mesh_derivative(guard,p.principal.retained(),admission,source,&input.bytes,&work)
                    }
                }
                    else {stages.stage_original(guard,p.principal.retained(),admission,&mut input.bytes.as_slice(),&work)}.map_err(media_error)?;
                let source_guards=source.as_ref().map(|r|vec![json!({"target":{"authority":"atlas","recordType":"asset","recordId":r.record_id},"revision":{"kind":"atlas","value":r.revision}})]).unwrap_or_default();
                let raw=json!({"schemaVersion":3,"commandId":"atlas.asset.create","requestId":metadata.request_id,"context":metadata.context,
                    "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
                    "payload":{"staged":receipt.staged,"purpose":purpose,"sourceLicense":metadata.source_license,"evidenceIds":[]},
                    "idempotencyKey":metadata.idempotency_key,"reason":metadata.reason,"preconditions":{"target":null,"guards":source_guards},"approvalReceiptId":null});
                // The complete native body is returned with the correlated
                // result on success. A lost response remains unknown custody.
                if serde_json::to_vec(&raw).map_err(|_|unavailable())?.len() > 16_384 {return Err(invalid());}
                let request=st::ValidatedRequest::parse(&contracts,raw).map_err(stock_reads::http_error)?;
                staged=Some(stages.bind_asset_plan(guard,p.principal.retained(),&receipt.staged.upload_token,&request,&work).map_err(media_error)?);
                Ok(())
            })?; p.release(&access).map_err(access_error)?;
        }
        let staged=staged.ok_or_else(unavailable)?;
        let raw=staged.request().raw().clone();
        let (result,release)=stock_mutations::execute_staged_asset(&host,&core,&p,raw.clone(),&staged,&contracts).map_err(stock_reads::http_error)?;
        let access=core.access.lock().map_err(|_|unavailable())?; p.release(&access).map_err(access_error)?; drop(access);
        if let Some(release)=release {release.mark_released();}
        // Exact durable consumed stages stay retained/charged. No guessed
        // retirement or repeat upload is performed by this route.
        Ok(private(json_response(json!({"schemaVersion":1,"originalRequest":raw,"result":result.wire,"association":"not-associated"}))))
    }).await.map_err(|_|unavailable())?
}

pub(super) async fn associate(
    State(host): State<Host>,
    Path((workspace_id, home_id, building_id)): Path<(String, String, String)>,
    request: Request,
) -> HttpResult {
    if !m::types::is_uuid(&building_id) || request.uri().query().is_some() {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let scope = d::Scope {
        workspace_id,
        home_id,
    };
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(unavailable)?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let h = host.clone();
    let c = checked.clone();
    let sc = scope.clone();
    let p = tokio::task::spawn_blocking(move || {
        let _permit = c.admission_permit()?;
        authorize(&h, &c, &uri, &method, &sc, a::Action::Mutate)
    })
    .await
    .map_err(|_| unavailable())??;
    intake::metadata(&request, 16_384)?;
    let bytes = super::admission::body(request.into_body(), 16_384).await?;
    let cancellation = m::Cancellation::default();
    let _cancel = CancelOnDrop(cancellation.clone());
    let work = budget(cancellation)?;
    tokio::task::spawn_blocking(move || {
        let _permit = checked.admission_permit()?;
        let raw = intake::json(&bytes)?;
        let contracts = st::NativeStockContract::new().map_err(stock_reads::http_error)?;
        let request = st::ValidatedRequest::parse(&contracts, raw.clone())
            .map_err(stock_reads::http_error)?;
        let core = host.core.lock().map_err(|_| unavailable())?;
        let selected = s::Scope {
            workspace_id: scope.workspace_id,
            home_id: scope.home_id,
        };
        let before = snapshot(&core, &p, &selected)?;
        bundle::qualify_association(
            &before,
            &selected,
            &building_id,
            &request,
            &core.vault,
            &work,
        )
        .map_err(media_error)?;
        let result = stock_mutations::execute_raw(&core, &p, raw, &contracts)
            .map_err(stock_reads::http_error)?;
        let access = core.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(access_error)?;
        // Server derives importedAt through the existing original Stock owner.
        // Both earlier custody commits remain independent of this atomic batch.
        Ok(private(json_response(result.wire)))
    })
    .await
    .map_err(|_| unavailable())?
}

pub(super) async fn descriptors(
    State(host): State<Host>,
    Path((workspace_id, home_id, building_id)): Path<(String, String, String)>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    read(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        building_id,
        None,
        checked,
        uri,
        method,
    )
    .await
}
pub(super) async fn mesh(
    State(host): State<Host>,
    Path((workspace_id, home_id, building_id, view_key, key)): Path<(
        String,
        String,
        String,
        String,
        String,
    )>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if !m::types::is_digest(&view_key) || !m::types::is_digest(&key) {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    read(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        building_id,
        Some((view_key, key)),
        checked,
        uri,
        method,
    )
    .await
}
async fn read(
    host: Host,
    scope: d::Scope,
    building_id: String,
    requested: Option<(String, String)>,
    checked: CheckedHeaders,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if !m::types::is_uuid(&building_id) || uri.query().is_some() {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let cancellation = m::Cancellation::default();
    let _cancel = CancelOnDrop(cancellation.clone());
    let work = budget(cancellation)?;
    let result = tokio::task::spawn_blocking(move || {
        let _permit = checked.admission_permit()?;
        let p = authorize(&host, &checked, &uri, &method, &scope, a::Action::Media)?;
        let core = host.core.lock().map_err(|_| unavailable())?;
        let selected = s::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        };
        let initial = snapshot(&core, &p, &selected)?;
        let view_key = bundle::view_key(&initial, &selected, &work).map_err(media_error)?;
        let floors = bundle::floors(&initial, &selected, &building_id, &core.vault, &work)
            .map_err(media_error)?;
        let access = NativeMediaAccess::new(core.access.clone());
        let media_scope = MediaScope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        };
        let mut grants = Vec::new();
        // Every offered pair carries current native record+manifest agreement
        // and a genuine fresh Media grant. No unassociated file is offered.
        for floor in &floors {
            for record in [&floor.original, &floor.derivative] {
                let stored = NativeMediaStorage::new(&core.store)
                    .read_owned_asset(&p, &media_scope, &record.record_id)
                    .map_err(media_error)?;
                if stored.record != *record || stored.manifest != record.payload {
                    return Err(unavailable());
                }
                let descriptor = OwnedDescriptor::AtlasAsset {
                    asset_id: record.record_id.clone(),
                };
                let metadata = OwnedMediaMetadata {
                    scope: media_scope.clone(),
                    asset_id: record.record_id.clone(),
                    revision: record.revision,
                    content_type: ContentType::parse_owned(&record.payload.content_type)
                        .map_err(media_error)?,
                    byte_size: record.payload.byte_size,
                    preview_policy: record.payload.preview_policy,
                };
                let grant = access
                    .authorize_owned_media(
                        p.principal.retained(),
                        &descriptor,
                        &metadata,
                        DeliveryMode::Download,
                    )
                    .map_err(media_error)?;
                grants.push((descriptor, metadata, grant));
            }
        }
        let mut response = if let Some((expected, key)) = requested {
            if expected != view_key {
                return Err(failure(StatusCode::CONFLICT));
            }
            let floor = floors
                .iter()
                .find(|f| f.descriptor.key == key)
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            let original = core
                .vault
                .read_retained(&floor.original, &work)
                .map_err(media_error)?;
            let bytes = core
                .vault
                .read_retained(&floor.derivative, &work)
                .map_err(media_error)?;
            let content = ContentType::parse_owned(&floor.derivative.payload.content_type)
                .map_err(media_error)?;
            match content {
                ContentType::AuthoredMesh => {
                    m::mesh_derivative::qualify(&bytes, &original, &work).map_err(media_error)?;
                }
                ContentType::IfcGlb => {
                    m::ifc_glb::qualify(&bytes, &original, &work).map_err(media_error)?;
                }
                _ => return Err(invalid()),
            }
            if bytes.len() > m::mesh_derivative::MAX_MESH_BYTES.max(m::ifc_glb::MAX_BYTES) {
                return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
            }
            let mut response = bytes.into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(content.as_str()),
            );
            response
        } else {
            let path = format!(
                "/api/atlas/geometry/v1/workspaces/{}/homes/{}/buildings/{building_id}",
                scope.workspace_id, scope.home_id
            );
            let offered=floors.iter().map(|f|json!({"floor":f.descriptor,"readPath":format!("{path}/frames/{view_key}/meshes/{}",f.descriptor.key)})).collect::<Vec<_>>();
            json_response(
                json!({"schemaVersion":1,"profile":"houseatlas.native-geometry.v2","scope":selected,"buildingId":building_id,"viewKey":view_key,"floors":offered,
                "physicalScale":"unknown","floorAlignment":"unknown","stageToHouseTransform":null}),
            )
        };
        let final_snapshot = snapshot(&core, &p, &selected)?;
        if final_snapshot != initial {
            return Err(failure(StatusCode::CONFLICT));
        }
        for (descriptor, metadata, grant) in grants {
            access
                .revalidate_owned_media(
                    p.principal.retained(),
                    &grant,
                    &descriptor,
                    &metadata,
                    DeliveryMode::Download,
                )
                .map_err(media_error)?;
        }
        let current = core.access.lock().map_err(|_| unavailable())?;
        p.release(&current).map_err(access_error)?;
        work.check().map_err(media_error)?;
        response.headers_mut().insert(
            "x-atlas-geometry-view",
            HeaderValue::from_str(&view_key).map_err(|_| unavailable())?,
        );
        Ok(private(response))
    });
    tokio::time::timeout(Duration::from_secs(15), result)
        .await
        .map_err(|_| failure(StatusCode::REQUEST_TIMEOUT))?
        .map_err(|_| unavailable())?
}
