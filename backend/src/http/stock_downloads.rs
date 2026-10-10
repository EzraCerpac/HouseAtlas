//! Host-qualified stock handles over the original managed Media composition.
use super::{CheckedHeaders, Host, HttpResult, authorized_read_unlocked, failure};
use crate::{
    app::{Access, Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store},
    domain::{self as d, stock as st},
    http::contracts::NativeContracts,
    media::{self as m, native::*, service::*},
    storage::{self as s, Contract},
    transports::mcp::{AssetDownloadPort, AssetDownloadRequest},
};
use axum::{
    extract::{Extension, Path, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, Uri},
    response::IntoResponse,
};
use serde_json::Value;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

struct RequestMediaAccess(NativeMediaAccess);
impl MediaAccessPort<RequestPrincipal> for RequestMediaAccess {
    type Grant = NativeOwnedGrant;
    fn authorize_owned_media(
        &self,
        p: &RequestPrincipal,
        descriptor: &OwnedDescriptor,
        metadata: &OwnedMediaMetadata,
        mode: DeliveryMode,
    ) -> m::MediaResult<Self::Grant> {
        self.0
            .authorize_owned_media(p.principal.retained(), descriptor, metadata, mode)
    }
    fn revalidate_owned_media(
        &self,
        p: &RequestPrincipal,
        grant: &Self::Grant,
        descriptor: &OwnedDescriptor,
        metadata: &OwnedMediaMetadata,
        mode: DeliveryMode,
    ) -> m::MediaResult<()> {
        self.0
            .revalidate_owned_media(p.principal.retained(), grant, descriptor, metadata, mode)
    }
}
struct Sessions<'a>(&'a Access);
impl st::AuthenticatedSessionPort<RequestPrincipal> for Sessions<'_> {
    fn authenticated_session_binding(&self, p: &RequestPrincipal) -> st::StockResult<[u8; 32]> {
        let access = self
            .0
            .lock()
            .map_err(|_| st::StockError::OwnerUnavailable)?;
        p.release(&access)
            .map_err(|_| st::StockError::AuthorityChanged)?;
        let binding = access
            .authenticated_session_binding(p.principal.principal())
            .map_err(|_| st::StockError::AuthorityChanged)?;
        p.release(&access)
            .map_err(|_| st::StockError::AuthorityChanged)?;
        Ok(binding)
    }
}
type MediaStore<'a> =
    NativeMediaStorage<'a, NativeContracts, ReadAuthority, NativeMediaRuntime<ServerRuntime>>;
type DownloadOwner<'a> = st::NativeAtlasAssetDownloads<
    'a,
    MediaStore<'a>,
    RequestMediaAccess,
    Sessions<'a>,
    st::NativeStockContract,
>;

pub(super) struct Downloads<'a> {
    pub store: &'a Mutex<Store>,
    pub access: &'a Access,
    pub vault: &'a m::AssetVault,
    pub handles: Option<&'a st::AtlasDownloadHandles>,
}
impl<'a> Downloads<'a> {
    pub fn for_core(core: &'a Core, handles: Option<&'a st::AtlasDownloadHandles>) -> Self {
        Self {
            store: &core.store,
            access: &core.access,
            vault: &core.vault,
            handles,
        }
    }
    fn with_owner<T>(
        &self,
        operation: impl FnOnce(&mut DownloadOwner<'_>) -> st::StockResult<T>,
    ) -> st::StockResult<T> {
        let handles = self.handles.ok_or(st::StockError::OwnerUnavailable)?;
        let storage = NativeMediaStorage::new(self.store);
        let access = RequestMediaAccess(NativeMediaAccess::new(self.access.clone()));
        let sessions = Sessions(self.access);
        let service = MediaService::new(&storage, &access, self.vault);
        let contracts = st::NativeStockContract::new()?;
        operation(&mut st::NativeAtlasAssetDownloads::new(
            &service,
            &storage,
            &sessions,
            &contracts,
            handles.clone(),
        ))
    }
    pub fn validate_issued<W, G>(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<W, G>,
        data: &Value,
    ) -> st::StockResult<()> {
        self.with_owner(|owner| owner.validate_issued(p, prepared, data))
    }
    fn redeem(
        &self,
        p: &RequestPrincipal,
        token: &str,
        method: ReadMethod,
        budget: &m::WorkBudget,
    ) -> st::StockResult<MediaResponse> {
        self.with_owner(|owner| owner.redeem(p, token, method, budget))
    }
    fn resolve_availability(
        &self,
        p: &RequestPrincipal,
        token: &str,
        budget: &m::WorkBudget,
    ) -> st::StockResult<m::DownloadAvailability> {
        if self.handles.is_none() {
            return Ok(m::DownloadAvailability::Unbound);
        }
        self.with_owner(|owner| owner.resolve_availability(p, token, budget))
    }
}
impl<W, G> AssetDownloadPort<RequestPrincipal, W, G> for Downloads<'_> {
    fn download(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<W, G>,
        request: &AssetDownloadRequest,
    ) -> st::StockResult<st::OwnerResult> {
        if request.raw() != prepared.request().raw() {
            return Err(st::StockError::CorrelationMismatch);
        }
        self.with_owner(|owner| st::StockQueryPort::query(owner, p, prepared))
    }
}
/// Keep the original host allocations while managed Media performs file I/O.
struct DownloadOwners {
    store: Arc<Mutex<Store>>,
    access: Access,
    vault: Arc<m::AssetVault>,
}
impl DownloadOwners {
    fn capture(
        host: &Host,
        p: &RequestPrincipal,
        scope: &d::Scope,
    ) -> Result<Self, super::HttpFailure> {
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if !core.homes.iter().any(|home| home.scope == *scope) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let owners = Self {
            store: Arc::clone(&core.store),
            access: Arc::clone(&core.access),
            vault: Arc::clone(&core.vault),
        };
        let access = owners
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        p.release(&access).map_err(super::access_error)?;
        drop(access);
        Ok(owners)
    }
    fn downloads<'a>(&'a self, handles: &'a st::AtlasDownloadHandles) -> Downloads<'a> {
        Downloads {
            store: &self.store,
            access: &self.access,
            vault: &self.vault,
            handles: Some(handles),
        }
    }
    fn revalidate(
        &self,
        host: &Host,
        p: &RequestPrincipal,
        scope: &d::Scope,
    ) -> Result<(), super::HttpFailure> {
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if !Arc::ptr_eq(&self.store, &core.store)
            || !Arc::ptr_eq(&self.access, &core.access)
            || !Arc::ptr_eq(&self.vault, &core.vault)
            || !core.homes.iter().any(|home| home.scope == *scope)
        {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let access = self
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        p.release(&access).map_err(super::access_error)
    }
}
struct CancelOnDrop(m::Cancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

/// Owner-observed presentation budget, separate from the frozen stock result.
/// This authenticates and validates the real retained handle through Media;
/// neither this route nor its DTO renews or authorizes delivery.
pub(super) async fn availability(
    State(host): State<Host>,
    Path((workspace_id, home_id, token)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let cancellation = m::Cancellation::default();
    let _cancel = CancelOnDrop(cancellation.clone());
    let budget = m::WorkBudget::new(Duration::from_secs(10), cancellation)
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        authorized_read_unlocked(&host, &headers, &uri, &method, scope.clone(), |p| {
            let owners = DownloadOwners::capture(&host, p, &scope)?;
            let observed = owners
                .downloads(&host.atlas_download_handles)
                .resolve_availability(p, &token, &budget)
                .map_err(super::stock_reads::http_error)?;
            budget
                .check()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let response = super::json_response(
                serde_json::to_value(observed)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
            );
            owners.revalidate(&host, p, &scope)?;
            Ok(response)
        })
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(super) async fn redeem(
    State(host): State<Host>,
    Path((workspace_id, home_id, token)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let cancellation = m::Cancellation::default();
    let _cancel = CancelOnDrop(cancellation.clone());
    let budget = m::WorkBudget::new(Duration::from_secs(10), cancellation)
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        authorized_read_unlocked(&host, &headers, &uri, &method, scope.clone(), |p| {
            let owners = DownloadOwners::capture(&host, p, &scope)?;
            let snapshot = {
                let mut store = owners
                    .store
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let scope = s::Scope {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                };
                store
                    .read_snapshot(p, &scope)
                    .map_err(|error| super::domain_error(crate::app::storage_error(error)))?
            };
            NativeContracts
                .validate_snapshot(&snapshot)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            super::stock_reads::capture_graph(&owners.access, p, &snapshot)
                .map_err(super::stock_reads::http_error)?;
            p.seal_source_capture();
            let method = if method == Method::HEAD {
                ReadMethod::Head
            } else {
                ReadMethod::Get
            };
            let delivered = owners
                .downloads(&host.atlas_download_handles)
                .redeem(p, &token, method, &budget)
                .map_err(super::stock_reads::http_error)?;
            let mut response = delivered.body.into_response();
            *response.status_mut() = StatusCode::from_u16(delivered.status)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            for (name, value) in delivered.headers {
                response.headers_mut().insert(
                    HeaderName::from_static(name),
                    HeaderValue::from_str(&value)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                );
            }
            budget
                .check()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            owners.revalidate(&host, p, &scope)?;
            Ok(response)
        })
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
