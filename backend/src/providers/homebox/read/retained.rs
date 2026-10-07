//! Native contract validation before reconstructing the reader's retained state.
use super::*;
use crate::storage;
use serde::de::DeserializeOwned;
use serde_json::Value;

fn invalid() -> PublishError {
    PublishError::InvalidRetainedState
}
fn field<T: DeserializeOwned>(row: &Value, key: &str) -> Result<T, PublishError> {
    serde_json::from_value(row.get(key).ok_or_else(invalid)?.clone()).map_err(|_| invalid())
}
fn validate<T: crate::contracts::Contract>(row: &Value) -> Result<(), PublishError> {
    crate::contracts::decode::<T>(&serde_json::to_vec(row).map_err(|_| invalid())?)
        .map(|_| ())
        .map_err(|_| invalid())
}
fn source(row: &Value) -> Result<SourceKey, PublishError> {
    if row["sourceKind"] != "homebox-entity" {
        return Err(invalid());
    }
    Ok(SourceKey {
        source_instance_id: field(row, "sourceInstanceId")?,
        collection_id: field(row, "collectionId")?,
        source_kind: "homebox-entity",
        external_id: field(row, "externalId")?,
    })
}
fn projection(row: Value) -> Result<Projection, PublishError> {
    validate::<crate::contracts::HomeboxProjection>(&row)?;
    let mut links = Vec::new();
    for link in row["nativeLinks"].as_array().ok_or_else(invalid)? {
        if link["kind"] != "homebox-native" {
            return Err(invalid());
        }
        links.push(NativeLink {
            kind: "homebox-native",
            intent: field(link, "intent")?,
            entity: SourceRef {
                workspace_id: field(&link["entity"], "workspaceId")?,
                home_id: field(&link["entity"], "homeId")?,
                key: source(&link["entity"]["key"])?,
            },
            href: field(link, "href")?,
            verified_route: field(link, "verifiedRoute")?,
        });
    }
    Ok(Projection {
        schema_version: 1,
        workspace_id: field(&row, "workspaceId")?,
        home_id: field(&row, "homeId")?,
        source: source(&row["source"])?,
        source_updated_at: field(&row, "sourceUpdatedAt")?,
        retrieved_at: field(&row, "retrievedAt")?,
        entity: field(&row, "entity")?,
        attachments: field(&row, "attachments")?,
        maintenance: field(&row, "maintenance")?,
        native_links: links,
    })
}
pub(super) fn previous(
    state: storage::CachePublicationState,
    scope: &SourceScope,
) -> Result<PreviousGeneration, PublishError> {
    if !state.network_relations.is_empty() {
        return Err(invalid());
    }
    let cache = match state.cache {
        None if state.homebox_entities.is_empty() => CacheStatus::empty(scope),
        None => return Err(invalid()),
        Some(cache) => {
            let row = serde_json::to_value(cache).map_err(|_| invalid())?;
            validate::<crate::contracts::CacheStatus>(&row)?;
            if row["consistency"] != CONSISTENCY {
                return Err(invalid());
            }
            let error = if row["error"].is_null() {
                None
            } else {
                let code: ErrorCode = field(&row["error"], "code")?;
                Some(CacheError {
                    code,
                    at: field(&row["error"], "at")?,
                    message: code.message(),
                })
            };
            CacheStatus {
                schema_version: 1,
                workspace_id: field(&row, "workspaceId")?,
                home_id: field(&row, "homeId")?,
                source_instance_id: field(&row, "sourceInstanceId")?,
                collection_id: field(&row, "collectionId")?,
                status: field(&row, "status")?,
                last_successful_fetch_at: field(&row, "lastSuccessfulFetchAt")?,
                last_attempt_at: field(&row, "lastAttemptAt")?,
                generation_id: field(&row, "generationId")?,
                consistency: CONSISTENCY,
                error,
            }
        }
    };
    if cache.scope() != *scope {
        return Err(PublishError::ScopeMismatch);
    }
    let quarantine = cache.quarantined();
    let entities = state
        .homebox_entities
        .into_iter()
        .map(projection)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PreviousGeneration::new(cache, entities, quarantine))
}
