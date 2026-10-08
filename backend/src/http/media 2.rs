//! Local owned originals through the actual native storage/access/media peers.
use super::{CheckedHeaders, Host, HttpResult, access_error, evidence, failure};
use crate::{
    app::{RequestPrincipal, Store},
    contracts::semantics,
    domain, media as m, storage,
};
use axum::{
    extract::{Extension, Path, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, Uri},
    response::IntoResponse,
};
use m::{
    native::{NativeMediaAccess, NativeMediaStorage, RetainedPrincipal},
    service::{
        DeliveryMode, MediaService, MediaStoragePort, OwnedDescriptor, ReadMethod, StoredAsset,
    },
};
use std::{sync::Mutex, time::Duration};
struct OwnedStore<'a>(&'a Mutex<Store>);
impl MediaStoragePort<RetainedPrincipal> for OwnedStore<'_> {
    fn read_owned_asset(
        &self,
        principal: &RetainedPrincipal,
        scope: &m::types::Scope,
        asset_id: &str,
    ) -> m::MediaResult<StoredAsset> {
        // Clone the actual private AT11 capability; no DTO or fresh issuance.
        let request = RequestPrincipal::from_retained(principal.clone());
        NativeMediaStorage::new(self.0).read_owned_asset(&request, scope, asset_id)
    }
}
struct CancelOnDrop(m::Cancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
fn media_error(error: m::MediaError) -> super::HttpFailure {
    failure(StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}
pub(super) async fn deliver(
    State(host): State<Host>,
    Path((workspace_id, home_id, digest, mode)): Path<(String, String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    let scope = domain::Scope {
        workspace_id,
        home_id,
    };
    crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let mode = match mode.as_str() {
        "preview" => DeliveryMode::Preview,
        "download" => DeliveryMode::Download,
        _ => return Err(failure(StatusCode::NOT_FOUND)),
    };
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let cancellation = m::Cancellation::default();
    let _cancel = CancelOnDrop(cancellation.clone());
    let budget = m::WorkBudget::new(Duration::from_secs(10), cancellation).map_err(media_error)?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        budget.check().map_err(media_error)?;
        let mut core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let access = NativeMediaAccess::new(core.access.clone());
        let native_scope = m::types::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        };
        let url = format!("{}{}", host.origin, uri.path());
        let observed =
            evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
        let principal = access
            .authorize_request(&observed, &native_scope)
            .map_err(media_error)?;
        if !core.homes.iter().any(|home| home.scope == scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        let request = RequestPrincipal::from_retained(principal.clone());
        let selected = storage::Scope {
            workspace_id: scope.workspace_id,
            home_id: scope.home_id,
        };
        let snapshot = core
            .store
            .get_mut()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .read_snapshot(&request, &selected)
            .map_err(|error| super::domain_error(crate::app::storage_error(error)))?;
        let mut descriptor = None;
        for record in &snapshot.records {
            if record.record_type != storage::RecordType::Asset {
                continue;
            }
            let candidate = OwnedDescriptor::AtlasAsset {
                asset_id: record.record_id.clone(),
            };
            let value = serde_json::to_value(&candidate)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            if semantics::canonical_digest(&value)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                == digest
            {
                descriptor = Some(candidate);
                break;
            }
        }
        let descriptor = descriptor.ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        let store = OwnedStore(&core.store);
        let service = MediaService::new(&store, &access, &core.vault);
        let read_method = if method == Method::HEAD {
            ReadMethod::Head
        } else {
            ReadMethod::Get
        };
        let delivered = service
            .deliver(
                &principal,
                &native_scope,
                &descriptor,
                read_method,
                mode,
                &budget,
            )
            .map_err(media_error)?;
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
        let current_access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        request.release(&current_access).map_err(access_error)?;
        budget.check().map_err(media_error)?;
        Ok(response)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn other() -> HttpResult {
    let mut response = failure(StatusCode::METHOD_NOT_ALLOWED).into_response();
    response.headers_mut().insert(
        axum::http::header::ALLOW,
        HeaderValue::from_static("GET, HEAD"),
    );
    Ok(response)
}
