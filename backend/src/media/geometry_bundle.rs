//! Native building association profile over existing frozen record bodies.
//! Pure selection is data, not authority. HTTP/Stock/Media own actual admission,
//! graph validation, transaction fences, custody and final revalidation.
use super::mesh_derivative::{self, MeshLineage};
use super::types::{AssetPurpose, AssetRecord, ContentType, sha256};
use super::{AssetVault, MediaError, MediaResult, WorkBudget};
use crate::{domain::stock as st, storage as s};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
fn need(ok: bool) -> MediaResult<()> {
    if ok {
        Ok(())
    } else {
        Err(MediaError::Conflict)
    }
}
fn active(record: &s::Record, scope: &s::Scope) -> bool {
    record.workspace_id == scope.workspace_id
        && record.home_id == scope.home_id
        && record.lifecycle == s::Lifecycle::Active
}
fn one<'a>(
    snapshot: &'a s::Snapshot,
    scope: &s::Scope,
    kind: s::RecordType,
    id: &str,
) -> MediaResult<&'a s::Record> {
    let mut records = snapshot
        .records
        .iter()
        .filter(|r| active(r, scope) && r.record_type == kind && r.record_id == id);
    let found = records.next().ok_or(MediaError::NotFound)?;
    need(records.next().is_none())?;
    Ok(found)
}
pub struct Building<'a> {
    pub identity: &'a s::Record,
    pub semantics: &'a s::Record,
}
pub fn building<'a>(
    snapshot: &'a s::Snapshot,
    scope: &s::Scope,
    id: &str,
) -> MediaResult<Building<'a>> {
    let identity = one(snapshot, scope, s::RecordType::Identity, id)?;
    need(identity.payload["kind"] == "location")?;
    let mut rows = snapshot.records.iter().filter(|r| {
        active(r, scope)
            && r.record_type == s::RecordType::LocationSemantics
            && r.payload["atlasId"] == id
            && r.payload["reviewStatus"] == "accepted"
    });
    let semantics = rows.next().ok_or(MediaError::NotFound)?;
    need(rows.next().is_none() && semantics.payload["semanticKind"] == "building")?;
    Ok(Building {
        identity,
        semantics,
    })
}
fn asset(row: &s::Record, purpose: AssetPurpose, content: ContentType) -> MediaResult<AssetRecord> {
    let projected = super::native::project_asset(row)?;
    need(
        projected.payload.purpose == purpose
            && projected.payload.content_type == content.as_str()
            && projected.payload.availability == super::types::Availability::Available
            && projected.payload.preview_policy == super::types::PreviewPolicy::DownloadOnly,
    )?;
    Ok(projected)
}
fn referenced_ids(value: &Value) -> MediaResult<Vec<&str>> {
    value
        .as_array()
        .ok_or(MediaError::InvalidInput)?
        .iter()
        .map(|v| v.as_str().ok_or(MediaError::InvalidInput))
        .collect()
}
fn guard(
    snapshot: &s::Snapshot,
    scope: &s::Scope,
    kind: s::RecordType,
    id: &str,
) -> MediaResult<Value> {
    let row = one(snapshot, scope, kind, id)?;
    Ok(
        json!({"target":{"authority":"atlas","recordType":kind,"recordId":id},"revision":{"kind":"atlas","value":row.revision}}),
    )
}
fn refs_match(evidence: &Value, original: &str, derived: &str) -> bool {
    evidence["references"]
        == json!([{"kind":"atlas-asset","assetId":original},{"kind":"atlas-asset","assetId":derived}])
}
fn geometry_profile(payload: &Value, original: &str, evidence: &str) -> bool {
    payload["producer"] == "magicplan"
        && payload["exportFormat"] == "usdz"
        && payload["originalAssetId"] == original
        && payload["coordinateUnits"] == "unknown"
        && payload["scale"].is_null()
        && payload["transform"].is_null()
        && payload["mappings"] == json!([])
        && payload["geometryVersion"].as_u64().is_some_and(|version| {
            (version == 1 && payload["previousGeometryId"].is_null())
                || (version > 1 && payload["previousGeometryId"].as_str().is_some())
        })
        && payload["evidenceIds"] == json!([evidence])
}
/// Binds the original complete three-child Stock intent to a fresh accepted
/// building and two actual committed custody records; no five-record atomicity.
pub fn qualify_association(
    snapshot: &s::Snapshot,
    scope: &s::Scope,
    building_id: &str,
    request: &st::ValidatedRequest,
    vault: &AssetVault,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    need(
        request.id() == st::OperationId::AtlasBatchExecute
            && request.children().len() == 3
            && request.context().workspace_id == scope.workspace_id
            && request.context().home_id == scope.home_id,
    )?;
    let children = request.children();
    let e = &children[0];
    let g = &children[1];
    let i = &children[2];
    need(
        e.id() == st::OperationId::AtlasEvidenceCreate
            && g.id() == st::OperationId::AtlasGeometryCreate
            && i.id() == st::OperationId::AtlasIdentityReplace
            && i.target()["recordId"] == building_id,
    )?;
    let selected = building(snapshot, scope, building_id)?;
    let evidence = e.target()["recordId"]
        .as_str()
        .ok_or(MediaError::InvalidInput)?;
    let original_id = g.payload()["originalAssetId"]
        .as_str()
        .ok_or(MediaError::InvalidInput)?;
    let references = e.payload()["references"]
        .as_array()
        .ok_or(MediaError::InvalidInput)?;
    need(references.len() == 2)?;
    let derivative_id = references[1]["assetId"]
        .as_str()
        .ok_or(MediaError::InvalidInput)?;
    need(
        original_id != derivative_id
            && refs_match(e.payload(), original_id, derivative_id)
            && geometry_profile(g.payload(), original_id, evidence)
            && e.payload()["supersedesEvidenceIds"] == json!([])
            && e.payload()["provenance"]["source"].is_null()
            && e.payload()["provenance"]["evidenceBasis"] == "owner-report"
            && e.payload()["provenance"]["uncertainty"]["status"] == "unknown",
    )?;
    let mut expected = selected.identity.payload.clone();
    let ids = expected["evidenceIds"]
        .as_array_mut()
        .ok_or(MediaError::InvalidInput)?;
    need(!ids.iter().any(|id| id == evidence))?;
    ids.push(json!(evidence));
    need(
        i.payload() == &expected
            && i.raw()["preconditions"]["target"]
                == json!({"kind":"atlas","value":selected.identity.revision}),
    )?;
    let original = asset(
        one(snapshot, scope, s::RecordType::Asset, original_id)?,
        AssetPurpose::GeometryOriginal,
        ContentType::Usdz,
    )?;
    let derived = asset(
        one(snapshot, scope, s::RecordType::Asset, derivative_id)?,
        AssetPurpose::DerivedPreview,
        ContentType::AuthoredMesh,
    )?;
    let source = vault.read_retained(&original, budget)?;
    let bytes = vault.read_retained(&derived, budget)?;
    mesh_derivative::qualify(&bytes, &source, budget)?;
    // A successor must name a currently qualified head in this exact building.
    // Explicit links, never labels or enumeration order, determine succession.
    let current = floors(snapshot, scope, building_id, vault, budget)?;
    let previous_id = g.payload()["previousGeometryId"].as_str();
    need(!current.iter().any(|floor| {
        floor.descriptor.geometry_id.as_str() != previous_id.unwrap_or("")
            && floor.original.record_id == original_id
            && floor.derivative.record_id == derivative_id
    }))?;
    let mut predecessor_guards = Vec::new();
    if let Some(previous_id) = g.payload()["previousGeometryId"].as_str() {
        let previous = current
            .iter()
            .find(|floor| floor.descriptor.geometry_id == previous_id)
            .ok_or(MediaError::Conflict)?;
        let previous_row = one(snapshot, scope, s::RecordType::Geometry, previous_id)?;
        let version = previous_row.payload["geometryVersion"]
            .as_u64()
            .ok_or(MediaError::Conflict)?;
        need(version.checked_add(1) == g.payload()["geometryVersion"].as_u64())?;
        for (kind, id) in [
            (s::RecordType::Geometry, previous_id),
            (
                s::RecordType::Evidence,
                previous.descriptor.evidence_id.as_str(),
            ),
            (
                s::RecordType::Asset,
                previous.descriptor.original_asset_id.as_str(),
            ),
            (
                s::RecordType::Asset,
                previous.descriptor.derivative_asset_id.as_str(),
            ),
        ] {
            predecessor_guards.push(guard(snapshot, scope, kind, id)?);
        }
    }
    let mut required = BTreeMap::new();
    for (kind, id) in [
        (s::RecordType::Identity, building_id),
        (
            s::RecordType::LocationSemantics,
            selected.semantics.record_id.as_str(),
        ),
        (s::RecordType::Asset, original_id),
        (s::RecordType::Asset, derivative_id),
    ] {
        required.insert(
            format!("{}:{id}", kind.as_str()),
            guard(snapshot, scope, kind, id)?,
        );
    }
    for ids in [
        &selected.identity.payload["evidenceIds"],
        &selected.semantics.payload["evidenceIds"],
    ] {
        for id in referenced_ids(ids)? {
            required.insert(
                format!("evidence:{id}"),
                guard(snapshot, scope, s::RecordType::Evidence, id)?,
            );
        }
    }
    for item in &predecessor_guards {
        required.insert(
            format!(
                "{}:{}",
                item["target"]["recordType"], item["target"]["recordId"]
            ),
            item.clone(),
        );
    }
    let supplied = request.raw()["preconditions"]["guards"]
        .as_array()
        .ok_or(MediaError::InvalidInput)?;
    need(required.values().all(|g| supplied.contains(g)))?;
    // Every child carries actual referenced prestate revisions. Newly created
    // evidence is the sole future reference and is checked by native Storage.
    let child_guards = |child: &st::ValidatedRequest| -> MediaResult<Vec<Value>> {
        child.raw()["preconditions"]["guards"]
            .as_array()
            .cloned()
            .ok_or(MediaError::InvalidInput)
    };
    for id in [original_id, derivative_id] {
        need(child_guards(e)?.contains(&guard(snapshot, scope, s::RecordType::Asset, id)?))?;
    }
    let geometry_guards = child_guards(g)?;
    need(
        geometry_guards.contains(&guard(snapshot, scope, s::RecordType::Asset, original_id)?)
            && predecessor_guards
                .iter()
                .all(|item| geometry_guards.contains(item)),
    )?;
    for id in referenced_ids(&selected.identity.payload["evidenceIds"])? {
        need(child_guards(i)?.contains(&guard(snapshot, scope, s::RecordType::Evidence, id)?))?;
    }
    budget.check()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloorDescriptor {
    pub key: String,
    pub export_label: String,
    pub original_sha256: String,
    pub derivative_sha256: String,
    pub geometry_id: String,
    pub geometry_revision: u64,
    pub evidence_id: String,
    pub evidence_revision: u64,
    pub original_asset_id: String,
    pub original_revision: u64,
    pub derivative_asset_id: String,
    pub derivative_revision: u64,
    pub original_license: super::types::SourceLicense,
    pub derivative_license: super::types::SourceLicense,
}
pub struct ResolvedFloor {
    pub descriptor: FloorDescriptor,
    pub original: AssetRecord,
    pub derivative: AssetRecord,
    pub lineage: MeshLineage,
}
pub fn floors(
    snapshot: &s::Snapshot,
    scope: &s::Scope,
    building_id: &str,
    vault: &AssetVault,
    budget: &WorkBudget,
) -> MediaResult<Vec<ResolvedFloor>> {
    let selected = building(snapshot, scope, building_id)?;
    let accepted = referenced_ids(&selected.identity.payload["evidenceIds"])?;
    let mut qualified = BTreeMap::new();
    for g in snapshot
        .records
        .iter()
        .filter(|r| active(r, scope) && r.record_type == s::RecordType::Geometry)
    {
        budget.check()?;
        let ids = referenced_ids(&g.payload["evidenceIds"])?;
        if ids.len() != 1 || !accepted.contains(&ids[0]) {
            continue;
        }
        let e = one(snapshot, scope, s::RecordType::Evidence, ids[0])?;
        let original_id = g.payload["originalAssetId"]
            .as_str()
            .ok_or(MediaError::InvalidInput)?;
        // Other optional geometry remains in the native graph; only this exact
        // qualified association profile supplies a mesh affordance.
        let Some(references) = e.payload["references"].as_array() else {
            continue;
        };
        if references.len() != 2 {
            continue;
        };
        let Some(derived_id) = references[1]["assetId"].as_str() else {
            continue;
        };
        if !refs_match(&e.payload, original_id, derived_id)
            || !geometry_profile(&g.payload, original_id, &e.record_id)
            || !e.payload["provenance"]["source"].is_null()
            || e.payload["provenance"]["evidenceBasis"] != "owner-report"
            || e.payload["provenance"]["uncertainty"]["status"] != "unknown"
        {
            continue;
        };
        let original = asset(
            one(snapshot, scope, s::RecordType::Asset, original_id)?,
            AssetPurpose::GeometryOriginal,
            ContentType::Usdz,
        )?;
        let derivative = asset(
            one(snapshot, scope, s::RecordType::Asset, derived_id)?,
            AssetPurpose::DerivedPreview,
            ContentType::AuthoredMesh,
        )?;
        need(original_id != derived_id)?;
        let original_bytes = vault.read_retained(&original, budget)?;
        let mesh_bytes = vault.read_retained(&derivative, budget)?;
        let mesh = mesh_derivative::qualify(&mesh_bytes, &original_bytes, budget)?;
        let lineage = mesh.lineage().clone();
        // A graph-linked floor may not be ambiguously asserted for two buildings.
        let uses = snapshot
            .records
            .iter()
            .filter(|r| {
                active(r, scope)
                    && r.record_type == s::RecordType::Identity
                    && r.payload["kind"] == "location"
                    && r.payload["evidenceIds"]
                        .as_array()
                        .is_some_and(|ids| ids.iter().any(|id| id == &e.record_id))
            })
            .count();
        need(uses == 1)?;
        let key = sha256(
            &serde_json::to_vec(&(
                selected.identity,
                selected.semantics,
                g,
                e,
                &original,
                &derivative,
            ))
            .map_err(|_| MediaError::Unavailable)?,
        );
        let descriptor = FloorDescriptor {
            key,
            export_label: lineage.floor_label.clone(),
            original_sha256: original.payload.sha256.clone(),
            derivative_sha256: derivative.payload.sha256.clone(),
            geometry_id: g.record_id.clone(),
            geometry_revision: g.revision,
            evidence_id: e.record_id.clone(),
            evidence_revision: e.revision,
            original_asset_id: original.record_id.clone(),
            original_revision: original.revision,
            derivative_asset_id: derivative.record_id.clone(),
            derivative_revision: derivative.revision,
            original_license: original.payload.source_license.clone(),
            derivative_license: derivative.payload.source_license.clone(),
        };
        need(
            qualified
                .insert(
                    g.record_id.clone(),
                    (
                        g,
                        ResolvedFloor {
                            descriptor,
                            original,
                            derivative,
                            lineage,
                        },
                    ),
                )
                .is_none(),
        )?;
    }
    // Validate the entire accepted lineage before selecting its heads. Missing,
    // foreign or unqualified predecessors and multiple successors fail closed.
    // Exact +1 versions rule out cycles without any timestamp/order heuristic.
    for record in snapshot
        .records
        .iter()
        .filter(|record| active(record, scope) && record.record_type == s::RecordType::Geometry)
    {
        budget.check()?;
        if record.payload["previousGeometryId"]
            .as_str()
            .is_some_and(|id| qualified.contains_key(id))
        {
            need(qualified.contains_key(&record.record_id))?;
        }
    }
    let mut predecessors = BTreeSet::new();
    for (record, _) in qualified.values() {
        budget.check()?;
        if let Some(previous_id) = record.payload["previousGeometryId"].as_str() {
            let (previous, _) = qualified.get(previous_id).ok_or(MediaError::Conflict)?;
            let version = previous.payload["geometryVersion"]
                .as_u64()
                .ok_or(MediaError::Conflict)?;
            need(
                version.checked_add(1) == record.payload["geometryVersion"].as_u64()
                    && predecessors.insert(previous_id.to_owned()),
            )?;
        }
    }
    let mut pairs = BTreeSet::new();
    let mut floors = Vec::new();
    for (id, (_, floor)) in qualified {
        if !predecessors.contains(&id) {
            need(
                floors.len() < 64
                    && pairs.insert((
                        floor.original.record_id.clone(),
                        floor.derivative.record_id.clone(),
                    )),
            )?;
            floors.push(floor);
        }
    }
    floors.sort_by(|a, b| a.descriptor.geometry_id.cmp(&b.descriptor.geometry_id));
    budget.check()?;
    Ok(floors)
}
pub fn view_key(
    snapshot: &s::Snapshot,
    scope: &s::Scope,
    budget: &WorkBudget,
) -> MediaResult<String> {
    struct Writer<'a>(Sha256, &'a WorkBudget);
    impl std::io::Write for Writer<'_> {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.1
                .check()
                .map_err(|_| std::io::Error::other("Read budget ended"))?;
            self.0.update(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut writer = Writer(Sha256::new(), budget);
    serde_json::to_writer(&mut writer, &(scope, snapshot)).map_err(|_| MediaError::Unavailable)?;
    Ok(format!("{:x}", writer.0.finalize()))
}
