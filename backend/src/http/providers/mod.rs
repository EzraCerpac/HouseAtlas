//! Root cached-read mounting; provider refresh and credential bridges are separate.
pub mod homebox_native;
pub mod homebox_reads;
pub mod homebox_stock;
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
    cached(
        host,
        headers,
        uri,
        method,
        Selection {
            workspace_id,
            home_id,
            source_instance_id,
            collection: Collection::Path(collection_id),
        },
    )
    .await
}
/// Query transport preserves opaque collection data without path normalization.
pub(super) async fn cached_homebox_query(
    State(host): State<Host>,
    Path((workspace_id, home_id, source_instance_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    cached(
        host,
        headers,
        uri,
        method,
        Selection {
            workspace_id,
            home_id,
            source_instance_id,
            collection: Collection::Query,
        },
    )
    .await
}
enum Collection {
    Path(String),
    Query,
}
struct Selection {
    workspace_id: String,
    home_id: String,
    source_instance_id: String,
    collection: Collection,
}
async fn cached(
    host: Host,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    selection: Selection,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id: selection.workspace_id,
                home_id: selection.home_id,
            }),
            false,
            |core, principal, home| {
                let collection_id = match selection.collection {
                    Collection::Path(value) => {
                        if uri.query().is_some() {
                            return Err(failure(StatusCode::FORBIDDEN));
                        }
                        value
                    }
                    Collection::Query => {
                        // At most four UTF-8 bytes and twelve percent-encoded
                        // bytes per permitted Unicode scalar, plus the key.
                        let value = super::query::one_utf8(
                            &uri,
                            "collection",
                            3 * 4096 * 4 + "collection=".len(),
                            4096 * 4,
                        )?;
                        if value.is_empty() || value.chars().count() > 4096 {
                            return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
                        }
                        value
                    }
                };
                let source = host
                    .homebox_cache_sources
                    .iter()
                    .find(|source| {
                        let partition = source.partition();
                        partition.workspace_id == home.scope.workspace_id
                            && partition.home_id == home.scope.home_id
                            && partition.source_instance_id == selection.source_instance_id
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

#[cfg(test)]
mod homebox_native_healthy;
