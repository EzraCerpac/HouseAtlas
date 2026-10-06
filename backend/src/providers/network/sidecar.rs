//! Immutable retained sidecar payloads. This module performs no database writes.
//! AT07/AT51 must provide the durable store and stage-before-pointer transaction.
use super::{
    CompleteGenerationProposal,
    json::{bounded_json, canonical_json},
    model::*,
    validate_state,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const MAX_ROW_BYTES: usize = 10 * 1024 * 1024;
const MAX_PACKET_BYTES: usize = 16 * 1024 * 1024;
const MAX_ROWS: usize = 10_000;
pub const SIDECAR_FORMAT: &str = "houseatlas-network-sidecar/1";
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SidecarRow {
    pub partition_key: String,
    pub generation_id: String,
    pub sha256: String,
    pub body: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SidecarPacket {
    pub format: String,
    pub rows: Vec<SidecarRow>,
}
fn value<T: Serialize>(data: &T) -> Result<Value> {
    serde_json::to_value(data).map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))
}
fn digest(body: &str) -> String {
    format!("{:x}", Sha256::digest(body.as_bytes()))
}
pub fn partition_key(scope: &SourceScope) -> Result<String> {
    canonical_json(&value(scope)?)
}
/// Produce a validated immutable row. Identical replay may be retained; a row
/// with the same partition/generation ID and different bytes must not overwrite.
pub fn stage_row(
    source: &SourceRegistration,
    proposal: &CompleteGenerationProposal,
) -> Result<SidecarRow> {
    let state = proposal.state();
    validate_state(source, state, None)?;
    guard(state.cache.status == CacheStatus::Fresh && state.generation.is_some())?;
    let generation_id = state
        .cache
        .generation_id
        .clone()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    let body = canonical_json(&value(state)?)?;
    if body.len() > MAX_ROW_BYTES {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    Ok(SidecarRow {
        partition_key: partition_key(&source.scope)?,
        generation_id,
        sha256: digest(&body),
        body,
    })
}
pub fn validate_immutable_replay(
    existing: Option<&SidecarRow>,
    candidate: &SidecarRow,
) -> Result<()> {
    if let Some(existing) = existing {
        guard(existing == candidate)?;
    }
    Ok(())
}
fn exact(value: &Value, keys: &[&str]) -> Result<()> {
    let row = value
        .as_object()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    guard(row.len() == keys.len() && keys.iter().all(|key| row.contains_key(*key)))
}
// Flattened scope fields are checked explicitly because Serde's flatten cannot
// be combined reliably with deny_unknown_fields. Preserve frozen DTO shapes.
fn retained_shape(state: &Value) -> Result<()> {
    exact(state, &["cache", "generation"])?;
    exact(
        &state["cache"],
        &[
            "schemaVersion",
            "workspaceId",
            "homeId",
            "sourceInstanceId",
            "collectionId",
            "status",
            "lastSuccessfulFetchAt",
            "lastAttemptAt",
            "generationId",
            "consistency",
            "error",
        ],
    )?;
    let generation = &state["generation"];
    if generation.is_null() {
        return Ok(());
    }
    exact(
        generation,
        &[
            "schemaVersion",
            "workspaceId",
            "homeId",
            "sourceInstanceId",
            "collectionId",
            "sourceRevision",
            "sourceSnapshotAt",
            "retrievedAt",
            "inventory",
            "networkRelations",
            "observations",
            "linkReview",
            "provenance",
        ],
    )?;
    for key in ["groups", "devices", "interfaces", "segments", "links"] {
        for row in generation["inventory"][key]
            .as_array()
            .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?
        {
            exact(
                row,
                &[
                    "schemaVersion",
                    "workspaceId",
                    "homeId",
                    "sourceInstanceId",
                    "collectionId",
                    "sourceKind",
                    "externalId",
                    "sourceRevision",
                    "sourceSnapshotAt",
                    "retrievedAt",
                    "value",
                ],
            )?;
        }
    }
    for row in generation["networkRelations"]
        .as_array()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?
    {
        exact(
            row,
            &[
                "schemaVersion",
                "workspaceId",
                "homeId",
                "sourceInstanceId",
                "collectionId",
                "externalId",
                "kind",
                "from",
                "to",
                "medium",
                "sourceRevision",
                "sourceSnapshotAt",
                "retrievedAt",
                "vantage",
                "sourceConfidence",
                "evidenceBasis",
                "temporalStatus",
                "factAt",
                "notes",
            ],
        )?;
    }
    for row in generation["observations"]
        .as_array()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?
    {
        exact(
            row,
            &[
                "workspaceId",
                "homeId",
                "sourceInstanceId",
                "collectionId",
                "externalId",
                "sourceRevision",
                "sourceSnapshotAt",
                "retrievedAt",
                "factAt",
                "vantage",
                "value",
            ],
        )?;
    }
    Ok(())
}
fn decode_row(source: &SourceRegistration, row: &SidecarRow) -> Result<RetainedState> {
    guard(row.partition_key == partition_key(&source.scope)? && row.sha256 == digest(&row.body))?;
    let data = bounded_json(row.body.as_bytes(), MAX_ROW_BYTES)?;
    retained_shape(&data)?;
    let state: RetainedState =
        serde_json::from_value(data).map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?;
    guard(
        state.cache.status == CacheStatus::Fresh
            && state.generation.is_some()
            && state.cache.generation_id.as_deref() == Some(&row.generation_id),
    )?;
    validate_state(source, &state, None)?;
    Ok(state)
}
/// Reopen only the exact published generation pointer, cache metadata and relation
/// set. Failed/stale/revoked cache status may refer to the same immutable
/// successful row. Return internal retained state for subsequent revision checks;
/// the host must use provider.read/public_read or build_facet for public output.
pub fn reopen_sidecar(
    source: &SourceRegistration,
    published_cache: &CacheMetadata,
    published_relations: &[NetworkRelation],
    row: &SidecarRow,
    configured_review: Option<&LinkReview>,
) -> Result<RetainedState> {
    let staged = decode_row(source, row)?;
    let mut expected_cache = published_cache.clone();
    expected_cache.status = CacheStatus::Fresh;
    expected_cache.last_attempt_at = staged.cache.last_attempt_at.clone();
    expected_cache.error = None;
    guard(staged.cache == expected_cache)?;
    let generation = staged
        .generation
        .as_ref()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    guard(generation.network_relations == published_relations)?;
    let state = RetainedState {
        cache: published_cache.clone(),
        generation: staged.generation,
    };
    validate_state(source, &state, configured_review)?;
    Ok(state)
}
/// Validate the full retained packet before the storage owner imports any row.
/// Packet import/SQL transactions/export ordering belong to the durable store.
pub fn validate_sidecar_packet(
    packet: &SidecarPacket,
    sources: &[SourceRegistration],
) -> Result<Vec<RetainedState>> {
    guard(packet.format == SIDECAR_FORMAT)?;
    if packet.rows.len() > MAX_ROWS || canonical_json(&value(packet)?)?.len() > MAX_PACKET_BYTES {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for row in &packet.rows {
        guard(seen.insert((&row.partition_key, &row.generation_id)))?;
        let source = sources
            .iter()
            .find(|source| partition_key(&source.scope).is_ok_and(|key| key == row.partition_key))
            .ok_or_else(|| NetworkError::new(ErrorCode::WrongScope))?;
        result.push(decode_row(source, row)?);
    }
    Ok(result)
}
