//! Pure current-head selection for durable scene associations. The caller still
//! owns authenticated disclosure and retained-byte Media qualification.
use crate::storage as s;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneHeadError {
    Unavailable,
    Conflict,
}

fn in_scope(row: &s::Record, scope: &s::Scope) -> bool {
    row.workspace_id == scope.workspace_id && row.home_id == scope.home_id
}
fn active(row: &s::Record, scope: &s::Scope) -> bool {
    in_scope(row, scope) && row.lifecycle == s::Lifecycle::Active
}
fn one<'a>(
    snapshot: &'a s::Snapshot,
    scope: &s::Scope,
    kind: s::RecordType,
    id: &str,
) -> Result<&'a s::Record, SceneHeadError> {
    let mut found = snapshot
        .records
        .iter()
        .filter(|row| active(row, scope) && row.record_type == kind && row.record_id == id);
    let row = found.next().ok_or(SceneHeadError::Unavailable)?;
    if found.next().is_some() {
        return Err(SceneHeadError::Conflict);
    }
    Ok(row)
}
fn semantics<'a>(
    snapshot: &'a s::Snapshot,
    scope: &s::Scope,
    id: &str,
) -> Result<&'a s::Record, SceneHeadError> {
    let mut found = snapshot.records.iter().filter(|row| {
        active(row, scope)
            && row.record_type == s::RecordType::LocationSemantics
            && row.payload["atlasId"] == id
            && row.payload["reviewStatus"] == "accepted"
    });
    let row = found.next().ok_or(SceneHeadError::Unavailable)?;
    if found.next().is_some() {
        return Err(SceneHeadError::Conflict);
    }
    Ok(row)
}
fn building(snapshot: &s::Snapshot, scope: &s::Scope, id: &str) -> Result<(), SceneHeadError> {
    if one(snapshot, scope, s::RecordType::Identity, id)?.payload["kind"] != "location"
        || semantics(snapshot, scope, id)?.payload["semanticKind"] != "building"
    {
        return Err(SceneHeadError::Unavailable);
    }
    Ok(())
}
fn place_in_building(
    snapshot: &s::Snapshot,
    scope: &s::Scope,
    building_id: &str,
    place_id: &str,
) -> Result<(), SceneHeadError> {
    if place_id == building_id {
        return Ok(());
    }
    if one(snapshot, scope, s::RecordType::Identity, place_id)?.payload["kind"] != "location" {
        return Err(SceneHeadError::Unavailable);
    }
    let kind = semantics(snapshot, scope, place_id)?.payload["semanticKind"]
        .as_str()
        .ok_or(SceneHeadError::Unavailable)?;
    if kind == "building" {
        return Err(SceneHeadError::Unavailable);
    }
    let mut parents = HashMap::new();
    for row in snapshot.records.iter().filter(|row| {
        active(row, scope)
            && row.record_type == s::RecordType::Relation
            && row.payload["kind"] == "location-membership"
            && row.payload["reviewStatus"] == "accepted"
    }) {
        let parent = row.payload["from"]["ref"]["recordId"]
            .as_str()
            .ok_or(SceneHeadError::Conflict)?;
        let child = row.payload["to"]["ref"]["recordId"]
            .as_str()
            .ok_or(SceneHeadError::Conflict)?;
        if parents
            .insert((child, row.payload["membershipKind"].as_str()), parent)
            .is_some()
        {
            return Err(SceneHeadError::Conflict);
        }
    }
    let direct = parents.get(&(place_id, Some("building"))).copied();
    if direct == Some(building_id) {
        return Ok(());
    }
    if kind == "floor" {
        return Err(SceneHeadError::Unavailable);
    }
    let floor = parents
        .get(&(place_id, Some("level")))
        .copied()
        .ok_or(SceneHeadError::Unavailable)?;
    if semantics(snapshot, scope, floor)?.payload["semanticKind"] != "floor"
        || parents.get(&(floor, Some("building"))).copied() != Some(building_id)
        || direct.is_some_and(|id| id != building_id)
    {
        return Err(SceneHeadError::Unavailable);
    }
    Ok(())
}

/// Pure current membership predicate for an independently authorized owner.
pub fn reviewed_scene_place(
    snapshot: &s::Snapshot,
    scope: &s::Scope,
    building_id: &str,
    place_id: &str,
) -> Result<(), SceneHeadError> {
    building(snapshot, scope, building_id)?;
    place_in_building(snapshot, scope, building_id, place_id)
}

/// Returns the only chain head after current record/reference checks. `None`
/// means no reviewed association exists. No date, numeric version or UUID is
/// used as a head selector; ambiguous/inconsistent chains fail closed.
pub fn current_scene_head<'a>(
    snapshot: &'a s::Snapshot,
    scope: &s::Scope,
    building_id: &str,
) -> Result<Option<&'a s::Record>, SceneHeadError> {
    building(snapshot, scope, building_id)?;
    let rows: Vec<_> = snapshot
        .records
        .iter()
        .filter(|row| {
            in_scope(row, scope)
                && row.record_type == s::RecordType::SceneAssociation
                && row.payload["buildingId"] == building_id
                && row.payload["profile"] == "houseatlas.native-scene-association.v1"
        })
        .collect();
    if rows.is_empty() {
        return Ok(None);
    }
    let by_id: HashMap<_, _> = rows
        .iter()
        .map(|row| (row.record_id.as_str(), *row))
        .collect();
    if by_id.len() != rows.len() {
        return Err(SceneHeadError::Conflict);
    }
    let roots: Vec<_> = rows
        .iter()
        .filter(|row| row.payload["previousAssociationId"].is_null())
        .collect();
    if roots.len() != 1 {
        return Err(SceneHeadError::Conflict);
    }
    let mut children = HashMap::new();
    for row in &rows {
        if row.lifecycle != s::Lifecycle::Active {
            return Err(SceneHeadError::Unavailable);
        }
        if let Some(parent) = row.payload["previousAssociationId"].as_str() {
            let previous = by_id.get(parent).ok_or(SceneHeadError::Conflict)?;
            let next = previous.payload["associationVersion"]
                .as_u64()
                .ok_or(SceneHeadError::Conflict)?
                .checked_add(1)
                .ok_or(SceneHeadError::Conflict)?;
            if row.payload["associationVersion"].as_u64() != Some(next)
                || children.insert(parent, *row).is_some()
            {
                return Err(SceneHeadError::Conflict);
            }
        } else if row.payload["associationVersion"].as_u64() != Some(1) {
            return Err(SceneHeadError::Conflict);
        }
    }
    let mut visited = HashSet::new();
    let mut head = **roots.first().ok_or(SceneHeadError::Conflict)?;
    loop {
        if !visited.insert(head.record_id.as_str()) {
            return Err(SceneHeadError::Conflict);
        }
        match children.get(head.record_id.as_str()) {
            Some(next) => head = *next,
            None => break,
        }
    }
    if visited.len() != rows.len() {
        return Err(SceneHeadError::Conflict);
    }
    let documents = head.payload["sourceDocuments"]
        .as_array()
        .ok_or(SceneHeadError::Conflict)?;
    if documents
        .iter()
        .filter(|doc| doc["role"] == "primary-scene")
        .count()
        != 1
    {
        return Err(SceneHeadError::Conflict);
    }
    for doc in documents {
        let evidence_id = doc["evidenceId"].as_str().ok_or(SceneHeadError::Conflict)?;
        if doc["role"] == "primary-scene" {
            let identity = one(snapshot, scope, s::RecordType::Identity, building_id)?;
            let accepted = semantics(snapshot, scope, building_id)?;
            let current_member = [
                &identity.payload["evidenceIds"],
                &accepted.payload["evidenceIds"],
            ]
            .into_iter()
            .any(|ids| {
                ids.as_array().is_some_and(|members| {
                    members
                        .iter()
                        .any(|member| member.as_str() == Some(evidence_id))
                })
            });
            if !current_member {
                return Err(SceneHeadError::Unavailable);
            }
        }
        let asset_id = doc["originalAssetId"]
            .as_str()
            .ok_or(SceneHeadError::Conflict)?;
        let evidence = one(snapshot, scope, s::RecordType::Evidence, evidence_id)?;
        let asset = one(snapshot, scope, s::RecordType::Asset, asset_id)?;
        let refs = evidence.payload["references"]
            .as_array()
            .ok_or(SceneHeadError::Conflict)?;
        if evidence.revision
            != doc["evidenceRevision"]
                .as_u64()
                .ok_or(SceneHeadError::Conflict)?
            || refs.len() != 1
            || refs[0]["kind"] != "atlas-asset"
            || refs[0]["assetId"] != asset_id
            || asset.payload["purpose"] != "evidence-original"
            || asset.payload["contentType"] != "text/plain"
            || asset.payload["availability"] != "available"
            || asset.payload["sha256"] != doc["originalSha256"]
        {
            return Err(SceneHeadError::Unavailable);
        }
    }
    for floor in head.payload["sourceFloors"]
        .as_array()
        .ok_or(SceneHeadError::Conflict)?
    {
        let geometry_id = floor["nativeGeometryId"]
            .as_str()
            .ok_or(SceneHeadError::Conflict)?;
        let asset_id = floor["nativeOriginalAssetId"]
            .as_str()
            .ok_or(SceneHeadError::Conflict)?;
        let geometry = one(snapshot, scope, s::RecordType::Geometry, geometry_id)?;
        let asset = one(snapshot, scope, s::RecordType::Asset, asset_id)?;
        if geometry.revision
            != floor["nativeGeometryRevision"]
                .as_u64()
                .ok_or(SceneHeadError::Conflict)?
            || geometry.payload["originalAssetId"] != asset_id
            || asset.payload["purpose"] != "geometry-original"
            || asset.payload["availability"] != "available"
            || asset.payload["sha256"] != floor["nativeOriginalSha256"]
        {
            return Err(SceneHeadError::Unavailable);
        }
    }
    for room in head.payload["roomMappings"]
        .as_array()
        .ok_or(SceneHeadError::Conflict)?
    {
        for target in room["targets"].as_array().ok_or(SceneHeadError::Conflict)? {
            if let Some(place) = target["atlasPlaceId"].as_str() {
                place_in_building(snapshot, scope, building_id, place)?;
            }
        }
    }
    Ok(Some(head))
}
