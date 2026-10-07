//! Root cached-read mounting; provider refresh and credential bridges are separate.
pub mod homebox_reads;
pub mod network;

use super::{CheckedHeaders, Host, HttpResult, authorized_read, failure, json_response};
use crate::domain as d;
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};

pub(super) async fn cached_homebox(
    State(host): State<Host>,
    Path((workspace_id, home_id, source_instance_id, collection_id)): Path<(
        String,
        String,
        String,
        String,
    )>,
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
            false,
            |core, principal, home| {
                if uri.query().is_some() {
                    return Err(failure(StatusCode::FORBIDDEN));
                }
                let source = host
                    .homebox_cache_sources
                    .iter()
                    .find(|source| {
                        let partition = source.partition();
                        partition.workspace_id == home.scope.workspace_id
                            && partition.home_id == home.scope.home_id
                            && partition.source_instance_id == source_instance_id
                            && partition.collection_id == collection_id
                    })
                    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
                let value = homebox_reads::cached_partition(core, principal, home, source)?;
                Ok(json_response(value))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
