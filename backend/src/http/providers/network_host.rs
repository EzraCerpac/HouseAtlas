//! Cached-only native Network read; this route has no transport/refresh command.
use crate::{
    access as a,
    app::ServerRuntime,
    domain as d,
    http::{CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response},
    providers::network as n,
    storage as s,
};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use s::Runtime;
use std::sync::Arc;

fn unavailable() -> super::super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn native_error(error: n::NetworkPublicationError<s::Error>) -> super::super::HttpFailure {
    match error {
        n::NetworkPublicationError::Network(error) => failure(match error.code {
            n::ErrorCode::Auth | n::ErrorCode::WrongScope => StatusCode::FORBIDDEN,
            n::ErrorCode::Timeout => StatusCode::GATEWAY_TIMEOUT,
            n::ErrorCode::InvalidSchema | n::ErrorCode::SizeLimit => StatusCode::BAD_GATEWAY,
            n::ErrorCode::Transport | n::ErrorCode::Upstream => StatusCode::SERVICE_UNAVAILABLE,
        }),
        n::NetworkPublicationError::Storage(error) => {
            super::super::domain_error(crate::app::storage_error(error))
        }
    }
}
pub(in crate::http) async fn cached(
    State(host): State<Host>,
    Path((workspace_id, home_id, source_instance_id)): Path<(String, String, String)>,
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
        let access_scope =
            crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
        let collection = super::super::query::one_utf8(
            &uri,
            "collection",
            3 * 4096 * 4 + "collection=".len(),
            4096 * 4,
        )?;
        if collection.is_empty() || collection.chars().count() > 4096 {
            return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
        }
        let mut core = host.core.lock().map_err(|_| unavailable())?;
        let url = format!(
            "{}{}",
            host.origin,
            uri.path_and_query().map_or("/", |path| path.as_str())
        );
        let request =
            evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
        // Fresh issuance is owned directly by the native disclosure. Never copy
        // a RequestPrincipal into a second issuer or reconstruct its grants.
        let principal = core
            .access
            .lock()
            .map_err(|_| unavailable())?
            .authorize(&request, &access_scope, a::Action::Read)
            .map_err(access_error)?;
        let binding = host
            .network_bindings
            .iter()
            .find(|binding| {
                let partition = binding.runtime().settings().configured_source().partition();
                partition.workspace_id.as_str() == scope.workspace_id
                    && partition.home_id.as_str() == scope.home_id
                    && partition.source_instance_id.as_str() == source_instance_id
                    && partition.collection_id == collection
            })
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        if !Arc::ptr_eq(binding.access().shared().as_existing(), &core.access) {
            return Err(unavailable());
        }
        let partition = binding
            .access()
            .partition_grant(
                &principal,
                &binding.runtime().settings().configured_source().partition(),
            )
            .map_err(access_error)?;
        let entities = binding
            .entities()
            .iter()
            .map(|reference| binding.access().source_grant(&principal, reference))
            .collect::<a::AccessResult<Vec<_>>>()
            .map_err(access_error)?;
        let now = ServerRuntime.now().map_err(|_| unavailable())?;
        let store = core.store.get_mut().map_err(|_| unavailable())?;
        let (facet, original) = binding
            .runtime()
            .read(
                store,
                binding.access().clone(),
                principal,
                partition,
                entities,
                &now,
            )
            .map_err(native_error)?;
        let value = serde_json::to_value(&facet).map_err(|_| unavailable())?;
        let released = binding
            .runtime()
            .disclose(store, &original, &now)
            .map_err(native_error)?;
        if released != facet {
            return Err(unavailable());
        }
        let response = json_response(value);
        original.revalidate().map_err(access_error)?;
        Ok(response)
    })
    .await
    .map_err(|_| unavailable())?
}
