//! Loopback TLS routes and browser DTO projection. No source/provider transport.
mod admission;
pub mod agents;
pub mod ai;
pub(crate) mod ai_account;
pub(crate) mod asset_reviews;
mod auth;
mod backup_settings;
pub mod contracts;
mod editing;
mod headers;
mod homebox_pinned_discovery;
mod homebox_pinned_files;
pub use homebox_pinned_files::PinnedHomeBoxFileBinding;
mod atlas_display_policy;
mod atlas_room_links;
mod atlas_scene;
mod browser_reads;
mod capture_claim;
mod geodata_documents;
mod geodata_original;
mod host_config;
mod intake;
mod media;
mod model_overview;
mod mutations;
mod native_geometry;
mod native_scene_association;
mod native_upload_admission;
mod offline_read_pack;
mod operation_events;
mod pages;
pub mod providers;
pub mod qualified_upload_plan;
mod quantity;
#[cfg(test)]
mod quantity_fixture;
#[cfg(test)]
mod quantity_http_healthy;
mod quantity_tool_admission;
mod quantity_worker;
mod query;
mod read_authority;
mod reads;
mod response;
mod response_layer;
mod stock_downloads;
mod stock_mutations;
mod stock_network_reads;
mod stock_reads;
mod upload;
mod upload_asset;
mod upload_batch;
pub mod upload_intake;
mod upload_outcomes;
use crate::{
    access as a,
    app::{Core, HomeAuthority, Reads, RequestPrincipal, capture_homes},
    domain as d,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Request, State},
    http::{HeaderValue, Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use browser_reads::{current, homes, items, rooms, scoped};
use headers::CheckedHeaders;
use read_authority::{authorized_read, authorized_read_phased, authorized_read_unlocked, evidence};
use response::{HttpFailure, ResponseIds, private_headers};
use response_layer::{response_adapter, static_file};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

/// Trusted startup selection only. Every session still requires its actual
/// original authenticated native identity and current capability checks.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum McpCommandProfile {
    #[default]
    ReadOnly,
    ExistingEditorCommands,
}

#[derive(Clone)]
pub struct Host {
    pub core: Arc<Mutex<Core>>,
    pub origin: String,
    pub files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
    homebox_cache_sources: Arc<Vec<crate::config::providers::homebox::TrustedHomeBoxSource>>,
    native_homebox_reads: Arc<Vec<providers::homebox_native::NativeHomeBoxReadBinding>>,
    native_homebox_list_pages: Arc<crate::providers::homebox::read::NativeListPages>,
    pinned_homebox_file_bindings: Arc<Vec<homebox_pinned_files::PinnedHomeBoxFileBinding>>,
    pinned_homebox_artifacts:
        Arc<Mutex<crate::media::homebox_pinned_artifacts::NativePinnedArtifactBroker>>,
    pinned_homebox_capture_requests: Arc<Mutex<homebox_pinned_files::CaptureRequests>>,
    network_bindings: Arc<Vec<crate::config::providers::network_host::NetworkBinding>>,
    atlas_download_handles: d::stock::AtlasDownloadHandles,
    response_ids: Arc<ResponseIds>,
    pages: Arc<Mutex<pages::Pages>>,
    admission: Arc<admission::Admission>,
    // Large bodies retain at most four original buffers, within global slots.
    upload_slots: Arc<tokio::sync::Semaphore>,
    mcp: Arc<Mutex<agents::mcp_transport::TransportSessions>>,
    mcp_command_profile: McpCommandProfile,
    // Same native Access owner; immutable configured scopes copied at startup.
    mcp_access: crate::app::Access,
    mcp_scopes: Arc<Vec<d::Scope>>,
    pub(crate) asset_reviews: Arc<Mutex<asset_reviews::ReviewRegistry>>,
    native_media_archive:
        Option<Arc<Mutex<crate::media::native_policy_archive::NativeMediaArchiveOwner>>>,
    operation_events: Arc<Mutex<operation_events::EventRegistry>>,
    quantity_installations:
        Arc<Vec<Arc<crate::config::providers::quantity_installation::OriginalQuantityConfigured>>>,
    quantity_previews: Arc<Mutex<quantity::Registry>>,
    #[cfg(test)]
    quantity_tls_fixture: Option<Arc<quantity_fixture::PrivateLoopbackQuantityTls>>,
    model_overview: Option<Arc<crate::config::model_overview::ServerModelOverviewSelection>>,
    offline_packs: Arc<Mutex<offline_read_pack::Registry>>,
    atlas_scene: Option<Arc<crate::config::atlas_scene::ServerAtlasSceneSelection>>,
    atlas_room_links: Option<Arc<crate::config::atlas_room_links::ServerAtlasRoomLinksSelection>>,
    atlas_display_policy:
        Option<Arc<crate::config::atlas_display_policy::ServerAtlasDisplayPolicySelection>>,
    full_geodata_identity: Option<crate::storage::FullGeodataIdentity>,
    geodata_dataset: Option<Arc<Mutex<crate::storage::geodata::GeodataStore>>>,
    loopback_local: bool,
    gateway: Option<Arc<crate::app::trusted_gateway::GatewaySocket>>,
    backup_folder: Option<Arc<std::path::PathBuf>>,
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
fn query_view(
    core: &mut Core,
    principal: &RequestPrincipal,
    home: &d::HomeSummary,
) -> Result<d::CurrentOutput, HttpFailure> {
    let mut store = core
        .store
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let mut queries = d::Queries {
        store: Reads(&mut store),
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
/// Match the installed Documents route selection to its original native owners.
/// The caller has already authorized the current/scoped view read.
fn source_documents_service_selected(host: &Host, core: &Core) -> Result<bool, HttpFailure> {
    let Some(identity) = &host.full_geodata_identity else {
        return Ok(false);
    };
    let store = core
        .store
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    Ok(store.matches_full_geodata_identity(identity)
        && store.full_geodata_belongs_to(&core.access, &core.vault))
}
/// Deliberate narrow projection for AT10's browser wire proposal. Unimplemented
/// extension facts stay unknown/absent; the read-only graph excludes Network.
fn browser_view(
    view: d::CurrentOutput,
    source_documents_available: bool,
) -> Result<Value, HttpFailure> {
    let mut v =
        serde_json::to_value(&view).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let entries = v["entries"]
        .as_array_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if entries.len() != view.entries.len() {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    for (entry, original) in entries.iter_mut().zip(&view.entries) {
        browser_entry(entry, original)?;
    }
    // Availability on this selected host, not a grant or a promise about any
    // individual Document. Its routes retain their own current authorization.
    v["sourceDocumentsService"] = serde_json::json!({
        "profile": "houseatlas.geodata-document-read.v2",
        "available": source_documents_available,
    });
    Ok(v)
}
fn browser_entry(entry: &mut Value, original: &d::CurrentEntry) -> Result<(), HttpFailure> {
    let object = entry
        .as_object_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let maintenance = object
        .get_mut("maintenance")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if maintenance.len() != original.maintenance.len() {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    for (item, retained) in maintenance.iter_mut().zip(&original.maintenance) {
        let cost = item
            .as_object_mut()
            .and_then(|item| item.get_mut("cost"))
            .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        *cost = retained
            .cost
            .as_ref()
            .map(|number| Value::String(number.to_string()))
            .unwrap_or(Value::Null);
    }
    let attachments = object
        .get_mut("attachments")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if attachments.len() != original.attachments.len() {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    for (item, retained) in attachments.iter_mut().zip(&original.attachments) {
        let item = item
            .as_object_mut()
            .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        match retained {
            d::CurrentAttachment::StoredFile { byte_size, .. } => {
                if item.get("kind").and_then(Value::as_str) != Some("stored-file") {
                    return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
                }
                let bytes = item
                    .get_mut("byteSize")
                    .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                *bytes = byte_size
                    .as_ref()
                    .map(|integer| Value::String(integer.as_number().to_string()))
                    .unwrap_or(Value::Null);
            }
            d::CurrentAttachment::ExternalLink { .. } => {
                if item.get("kind").and_then(Value::as_str) != Some("external-link") {
                    return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
                }
            }
        }
    }
    // Use the original retained Number representation before any Value reparse.
    // This browser read DTO is separate from canonical storage and stock wire.
    entry["entity"]["quantity"] = original
        .entity
        .quantity
        .as_ref()
        .map(|number| Value::String(number.to_string()))
        .unwrap_or(Value::Null);
    // Serialize the same ordered source tuple without allocating an intermediate
    // Value array or copying its strings for every browser entry.
    entry["key"] = Value::String(
        serde_json::to_string(&(
            &original.source.source_instance_id,
            &original.source.collection_id,
            original.source.source_kind,
            &original.source.external_id,
        ))
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
    );
    entry["aliases"] = json!([]);
    entry["mobility"] = json!("unknown");
    entry["networkBound"] = json!(false);
    entry["networkStates"] = json!([]);
    entry["networkRelations"] = json!([]);
    Ok(())
}
fn browser_entries(entries: Vec<&d::CurrentEntry>) -> Result<Value, HttpFailure> {
    let mut values =
        serde_json::to_value(&entries).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let serialized = values
        .as_array_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if serialized.len() != entries.len() {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    for (entry, original) in serialized.iter_mut().zip(&entries) {
        browser_entry(entry, original)?;
    }
    Ok(values)
}
fn json_response(v: Value) -> Response {
    Json(v).into_response()
}
pub fn router(host: Host) -> Router {
    router_with_ai(host, None)
}
/// The caller supplies an AI router bound to actual session and enrollment peers.
pub fn router_with_ai(host: Host, ai: Option<Router>) -> Router {
    if host.geodata_dataset.is_some() {
        return geodata_documents::router(host);
    }
    let base = Router::new()
        .route("/api/atlas/homebox/quantity/availability", get(quantity::availability).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/homebox/quantity/preview", post(quantity::preview).fallback(auth::post_only))
        .route("/api/atlas/homebox/quantity/approval", post(quantity::approval).fallback(auth::post_only))
        .route("/api/atlas/homebox/quantity/dispatch", post(quantity::dispatch).fallback(auth::post_only))
        .route("/api/atlas/retained-intent", post(operation_events::reconcile_intent).head(auth::post_only).fallback(auth::post_only))
        .route("/api/atlas/operation-events", get(operation_events::events).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/providers/homebox/workspaces/{workspace_id}/homes/{home_id}/sources/{source_instance_id}/collections/{collection_id}/cached", get(providers::cached_homebox).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/providers/homebox/workspaces/{workspace_id}/homes/{home_id}/sources/{source_instance_id}/cached", get(providers::cached_homebox_query).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/providers/network/workspaces/{workspace_id}/homes/{home_id}/sources/{source_instance_id}/cached", get(providers::network::cached).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/mcp/workspaces/{workspace_id}/homes/{home_id}", post(agents::mcp_transport::post).get(agents::mcp_transport::unsupported).head(agents::mcp_transport::unsupported).delete(agents::mcp_transport::unsupported).fallback(agents::mcp_transport::unsupported))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/place", get(editing::place).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/places/{record_id}/evidence", post(upload::command))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/native-places/{record_id}", get(native_upload_admission::place).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/native-places/{record_id}/evidence", post(upload::native_command))
        .route("/api/atlas/editing/v1/workspaces/{workspace_id}/homes/{home_id}/native-places/{record_id}/evidence/requests/{request_id}", get(upload_outcomes::inspect).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/admission", get(agents::admission).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/homebox-pinned-file", get(homebox_pinned_files::capture).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v4/workspaces/{workspace_id}/homes/{home_id}/homebox-pinned-file", get(homebox_pinned_files::capture_v4).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/media/pinned-homebox/{workspace_id}/{home_id}/{token}", get(homebox_pinned_files::redeem).head(homebox_pinned_files::redeem).fallback(auth::session_head))
        .route("/api/atlas/media/pinned-homebox/{workspace_id}/{home_id}/{token}/availability", get(homebox_pinned_files::availability).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/quantity-tool-admission", get(quantity_tool_admission::admission).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/homebox-pinned-file-admission", get(homebox_pinned_discovery::admission).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/invoke", get(agents::invoke).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/commands", post(stock_mutations::command))
        .route("/api/atlas/documents/v1/workspaces/{workspace_id}/homes/{home_id}/originals", post(geodata_original::command))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/assets", post(upload_asset::command))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/assets/{asset_id}/review-proof", post(asset_reviews::issue))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}", get(stock_reads::list).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}", get(stock_reads::record).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/records/{record_type}/{record_id}/history", get(stock_reads::history).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/geometry/v1/workspaces/{workspace_id}/homes/{home_id}/originals", post(native_geometry::original))
        .route("/api/atlas/geometry/v1/workspaces/{workspace_id}/homes/{home_id}/originals/{original_id}/derivative", post(native_geometry::derivative))
        .route("/api/atlas/geometry/v1/workspaces/{workspace_id}/homes/{home_id}/buildings/{building_id}/associations", post(native_geometry::associate))
        .route("/api/atlas/geometry/v1/workspaces/{workspace_id}/homes/{home_id}/buildings/{building_id}", get(native_geometry::descriptors).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/scene/v1/workspaces/{workspace_id}/homes/{home_id}/buildings/{building_id}/current", get(native_scene_association::current).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/scene/v1/workspaces/{workspace_id}/homes/{home_id}/buildings/{building_id}/head", get(native_scene_association::head).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/geometry/v1/workspaces/{workspace_id}/homes/{home_id}/buildings/{building_id}/frames/{view_key}/meshes/{key}", get(native_geometry::mesh).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/media/{workspace_id}/{home_id}/{digest}/{mode}", get(media::deliver).fallback(media::other))
        .route("/api/atlas/media/downloads/{workspace_id}/{home_id}/{token}", get(stock_downloads::redeem).fallback(media::other))
        .route("/api/atlas/media/downloads/{workspace_id}/{home_id}/{token}/availability", get(stock_downloads::availability).head(auth::session_head).fallback(media::other))
        .route("/api/atlas/view", get(current))
        .route(
            "/api/atlas/homes/{workspace_id}/{home_id}/view",
            get(scoped),
        )
        .route("/api/atlas/rooms", get(rooms))
        .route("/api/atlas/items", get(items))
        .route("/api/atlas/homes", get(homes))
        .route("/api/atlas/auth/login", post(auth::login))
        .route("/api/atlas/auth/mode", get(auth::mode))
        .route("/api/atlas/auth/local", post(auth::local))
        .route("/api/atlas/auth/proxy", post(auth::proxy))
        .route(
            "/api/atlas/auth/session",
            get(auth::session)
                .head(auth::session_head)
                .fallback(auth::session_head),
        )
        .route("/api/atlas/auth/rotate", post(auth::rotate))
        .route("/api/atlas/auth/logout", post(auth::logout))
        .route("/api/atlas/backup/v1/settings", get(backup_settings::read).post(backup_settings::write).head(auth::session_head).fallback(auth::session_head))
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
    let base = base
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/overview", get(model_overview::descriptor).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/overview/{publication_id}/original", get(model_overview::original).head(auth::session_head).fallback(auth::session_head));
    let base=base
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/atlas",get(atlas_scene::descriptor).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/atlas/{publication_id}/artifacts/model",get(atlas_scene::model).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/atlas/{publication_id}/artifacts/model-detail",get(atlas_scene::model_detail).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/atlas/{publication_id}/room-links",get(atlas_room_links::read).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/models/v1/workspaces/{workspace_id}/homes/{home_id}/atlas/{publication_id}/display-policy",get(atlas_display_policy::read).head(auth::session_head).fallback(auth::session_head));
    let base = base
        .route("/api/atlas/offline/v1/workspaces/{workspace_id}/homes/{home_id}/manifest", get(offline_read_pack::manifest).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/offline/v1/workspaces/{workspace_id}/homes/{home_id}/snapshots/{snapshot_id}/manifest", get(offline_read_pack::retained_manifest).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/offline/v1/workspaces/{workspace_id}/homes/{home_id}/snapshots/{snapshot_id}/resources/{sha256}", get(offline_read_pack::resource).head(auth::session_head).fallback(auth::session_head));
    let base = if host.full_geodata_identity.is_some() {
        base.merge(geodata_documents::full_routes())
    } else {
        base
    };
    base.layer(middleware::from_fn_with_state(
        host.clone(),
        response_adapter,
    ))
    .with_state(host)
}
