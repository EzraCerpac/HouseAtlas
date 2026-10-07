//! Scoped cached HomeBox reads for the root's existing authorized-read wrapper.
use crate::{
    app::{Core, RequestPrincipal},
    config::providers::homebox::TrustedHomeBoxSource,
    contracts,
    domain::HomeSummary,
    http::contracts::NativeContracts,
    http::{HttpFailure, failure},
    lifecycle::providers::homebox_refresh::{HostError, ProviderAuthorityPort, ProviderPhase},
    providers::homebox::read,
    storage::{self, Contract},
};
use axum::http::StatusCode;
use serde_json::{Value, json};

/// Invoke inside authorized_read, which owns request admission and the final
/// original-principal release. Reading cache never starts a provider operation.
pub(in crate::http) fn cached_partition(
    core: &mut Core,
    principal: &RequestPrincipal,
    home: &HomeSummary,
    source: &TrustedHomeBoxSource,
) -> Result<Value, HttpFailure> {
    let partition = source.partition();
    if partition.workspace_id != home.scope.workspace_id || partition.home_id != home.scope.home_id
    {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let access_partition = serde_json::from_value(
        serde_json::to_value(&partition).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
    )
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    {
        let access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        principal
            .capture_partition(&access, &access_partition)
            .map_err(crate::http::access_error)?;
    }
    let snapshot = core
        .store
        .get_mut()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        .read_snapshot(principal, &partition.scope())
        .map_err(|error| crate::http::domain_error(crate::app::storage_error(error)))?;
    NativeContracts
        .validate_snapshot(&snapshot)
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let durable = snapshot
        .sources
        .iter()
        .find(|row| {
            row["sourceInstanceId"] == partition.source_instance_id
                && row["collectionId"] == partition.collection_id
        })
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let durable: storage::SourceRegistration = serde_json::from_value(durable.clone())
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if &durable != source.registration() {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    let entities = snapshot
        .homebox_entities
        .into_iter()
        .filter(|row| {
            row["source"]["sourceInstanceId"] == partition.source_instance_id
                && row["source"]["collectionId"] == partition.collection_id
        })
        .collect::<Vec<_>>();
    for row in &entities {
        contracts::decode::<contracts::HomeboxProjection>(
            &serde_json::to_vec(row).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        )
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        for attachment in row["attachments"]
            .as_array()
            .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?
        {
            if attachment["kind"] == "external-link"
                && !attachment["url"]
                    .as_str()
                    .is_some_and(|url| crate::domain::safe_web_url(url, false))
            {
                return Err(crate::http::domain_error(
                    crate::domain::DomainError::UpstreamIncomplete,
                ));
            }
        }
    }
    let cache = snapshot
        .caches
        .into_iter()
        .find(|row| {
            row["sourceInstanceId"] == partition.source_instance_id
                && row["collectionId"] == partition.collection_id
        })
        .unwrap_or(
            serde_json::to_value(read::CacheStatus::empty(&source.scope()))
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        );
    contracts::decode::<contracts::CacheStatus>(
        &serde_json::to_vec(&cache).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
    )
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    {
        let access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        principal
            .release(&access)
            .map_err(crate::http::access_error)?;
    }
    Ok(json!({"homeboxEntities":entities,"cache":cache}))
}

/// Explicit filtered provider read for a separately mounted, authorized route.
/// The root runs this local future with the original principal and supplies the
/// owner-approved credential bridge. This function has no Store/publication
/// argument: a filtered view cannot replace or freshen the complete cache.
pub async fn filtered_view<
    A: ProviderAuthorityPort,
    P: read::CredentialProvider,
    K: read::Clock,
>(
    authority: &mut A,
    principal: &RequestPrincipal,
    source: &TrustedHomeBoxSource,
    parent_ids: &[read::Uuid],
    credentials: P,
    clock: K,
) -> Result<read::FilteredView, HostError> {
    authority.revalidate(principal, source, ProviderPhase::Fetch)?;
    let mut reader = source
        .reader(credentials, clock)
        .map_err(HostError::Configuration)?;
    let view = reader
        .fetch_view(parent_ids)
        .await
        .map_err(|failed| HostError::Read(failed.error.code))?;
    authority.authorize_view(principal, source, &view)?;
    authority.revalidate(principal, source, ProviderPhase::Release)?;
    Ok(view)
}
