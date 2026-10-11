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
// Bound the complete retained lineage, not merely its current heads. Metadata
// preflight precedes every retained-byte read, including the proposed successor.
const MAX_HISTORY_VERSIONS: usize = 64;
struct HistoricalFloor<'a> {
    geometry: &'a s::Record,
    evidence: &'a s::Record,
    original: AssetRecord,
    derivative: AssetRecord,
}
fn history_metadata<'a>(
    snapshot: &'a s::Snapshot,
    scope: &s::Scope,
    selected: &Building<'a>,
    budget: &WorkBudget,
) -> MediaResult<BTreeMap<String, HistoricalFloor<'a>>> {
    let accepted = referenced_ids(&selected.identity.payload["evidenceIds"])?;
    let mut history = BTreeMap::new();
    let mut pairs = BTreeSet::new();
    for g in &snapshot.records {
        budget.check()?;
        if !active(g, scope) || g.record_type != s::RecordType::Geometry {
            continue;
        }
        let ids = referenced_ids(&g.payload["evidenceIds"])?;
        if ids.len() != 1 || !accepted.contains(&ids[0]) {
            continue;
        }
        let e = one(snapshot, scope, s::RecordType::Evidence, ids[0])?;
        let original_id = g.payload["originalAssetId"]
            .as_str()
            .ok_or(MediaError::InvalidInput)?;
        // Conservatively count accepted profile-shaped history before content
        // qualification. Other optional geometry supplies no mesh affordance.
        let Some(references) = e.payload["references"].as_array() else {
            continue;
        };
        if references.len() != 2 {
            continue;
        }
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
        need(
            history.len() < MAX_HISTORY_VERSIONS
                && original_id != derived_id
                && pairs.insert((original_id.to_owned(), derived_id.to_owned())),
        )?;
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
        let mut uses = 0;
        for record in &snapshot.records {
            budget.check()?;
            if active(record, scope)
                && record.record_type == s::RecordType::Identity
                && record.payload["kind"] == "location"
                && record.payload["evidenceIds"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id == &e.record_id))
            {
                uses += 1;
            }
        }
        need(uses == 1)?;
        need(
            history
                .insert(
                    g.record_id.clone(),
                    HistoricalFloor {
                        geometry: g,
                        evidence: e,
                        original,
                        derivative,
                    },
                )
                .is_none(),
        )?;
    }
    // A non-profile child cannot hide a recognized predecessor. Validate links
    // before content work; exact +1 versions and one child also rule out cycles.
    for record in &snapshot.records {
        budget.check()?;
        if active(record, scope)
            && record.record_type == s::RecordType::Geometry
            && record.payload["previousGeometryId"]
                .as_str()
                .is_some_and(|id| history.contains_key(id))
        {
            need(history.contains_key(&record.record_id))?;
        }
    }
    let mut predecessors = BTreeSet::new();
    for floor in history.values() {
        budget.check()?;
        if let Some(previous_id) = floor.geometry.payload["previousGeometryId"].as_str() {
            let previous = history.get(previous_id).ok_or(MediaError::Conflict)?;
            let version = previous.geometry.payload["geometryVersion"]
                .as_u64()
                .ok_or(MediaError::Conflict)?;
            need(
                version.checked_add(1) == floor.geometry.payload["geometryVersion"].as_u64()
                    && predecessors.insert(previous_id.to_owned()),
            )?;
        }
    }
    Ok(history)
}
fn available_history_slot(
    history: &BTreeMap<String, HistoricalFloor<'_>>,
    original_id: &str,
    derivative_id: &str,
) -> MediaResult<()> {
    need(
        history.len() < MAX_HISTORY_VERSIONS
            && !history.values().any(|floor| {
                floor.original.record_id == original_id
                    && floor.derivative.record_id == derivative_id
            }),
    )
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
    // Reserve against all accepted history, including retired versions, before
    // any original or derivative bytes are read. A full history stays readable
    // but cannot append a version that would exceed its bounded read capacity.
    available_history_slot(
        &history_metadata(snapshot, scope, &selected, budget)?,
        original_id,
        derivative_id,
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
    let history = history_metadata(snapshot, scope, &selected, budget)?;
    let mut qualified = BTreeMap::new();
    for (id, floor) in history {
        budget.check()?;
        let HistoricalFloor {
            geometry: g,
            evidence: e,
            original,
            derivative,
        } = floor;
        let original_bytes = vault.read_retained(&original, budget)?;
        let mesh_bytes = vault.read_retained(&derivative, budget)?;
        let mesh = mesh_derivative::qualify(&mesh_bytes, &original_bytes, budget)?;
        let lineage = mesh.lineage().clone();
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
                    id,
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
    // Metadata already established a complete, unambiguous bounded lineage.
    // Retained content qualification above remains mandatory for every version.
    let mut predecessors = BTreeSet::new();
    for (record, _) in qualified.values() {
        budget.check()?;
        if let Some(previous_id) = record.payload["previousGeometryId"].as_str() {
            predecessors.insert(previous_id.to_owned());
        }
    }
    let mut floors = Vec::new();
    for (id, (_, floor)) in qualified {
        if !predecessors.contains(&id) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn row(scope: &s::Scope, kind: s::RecordType, n: usize, payload: Value) -> s::Record {
        s::Record {
            schema_version: 1,
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            record_type: kind,
            record_id: id(n),
            revision: 1,
            lifecycle: s::Lifecycle::Active,
            created_at: "2026-10-11T00:00:00Z".into(),
            updated_at: "2026-10-11T00:00:00Z".into(),
            last_audit_id: id(9),
            payload,
        }
    }
    // Small metadata-only fixtures: no original/mesh bytes, native writes or
    // authentication. Successful custody and Stock are covered by the example.
    fn snapshot(versions: usize) -> (s::Scope, s::Snapshot) {
        let scope = s::Scope {
            workspace_id: id(2),
            home_id: id(3),
        };
        let mut snapshot = s::Snapshot::default();
        let evidence_ids: Vec<_> = (0..versions).map(|n| id(100 + n * 4)).collect();
        snapshot.records.push(row(
            &scope,
            s::RecordType::Identity,
            10,
            json!({"kind":"location","evidenceIds":evidence_ids}),
        ));
        snapshot.records.push(row(
            &scope,
            s::RecordType::LocationSemantics,
            11,
            json!({"atlasId":id(10),"reviewStatus":"accepted","semanticKind":"building"}),
        ));
        let media_scope = super::super::types::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        };
        for n in 0..versions {
            let evidence_id = id(100 + n * 4);
            let geometry_id = id(101 + n * 4);
            let original_id = id(102 + n * 4);
            let derivative_id = id(103 + n * 4);
            snapshot.records.push(row(
                &scope,
                s::RecordType::Evidence,
                100 + n * 4,
                json!({"references":[{"kind":"atlas-asset","assetId":original_id},{"kind":"atlas-asset","assetId":derivative_id}],"provenance":{"source":null,"evidenceBasis":"owner-report","uncertainty":{"status":"unknown"}}}),
            ));
            snapshot.records.push(row(
                &scope,
                s::RecordType::Geometry,
                101 + n * 4,
                json!({"producer":"magicplan","exportFormat":"usdz","originalAssetId":original_id,"coordinateUnits":"unknown","scale":null,"transform":null,"mappings":[],"geometryVersion":n+1,"previousGeometryId":n.checked_sub(1).map(|prior|id(101+prior*4)),"evidenceIds":[evidence_id]}),
            ));
            assert_eq!(snapshot.records.last().unwrap().record_id, geometry_id);
            for (offset, purpose, content_type) in [
                (102, "geometry-original", ContentType::Usdz),
                (103, "derived-preview", ContentType::AuthoredMesh),
            ] {
                let digest = sha256(format!("Synthetic absent blob {n}:{offset}").as_bytes());
                snapshot.records.push(row(
                    &scope,
                    s::RecordType::Asset,
                    offset + n * 4,
                    json!({"owner":"atlas","purpose":purpose,"storageKey":media_scope.storage_key(&digest).unwrap(),"sha256":digest,"byteSize":1,"contentType":content_type.as_str(),"sourceLicense":{"status":"unknown","reference":null},"availability":"available","previewPolicy":"download-only","evidenceIds":[]}),
                ));
            }
        }
        (scope, snapshot)
    }
    fn budget() -> WorkBudget {
        WorkBudget::new(Duration::from_secs(10), Default::default()).unwrap()
    }

    #[test]
    fn bounded_history_and_retired_pair_preflight() {
        let (scope, complete) = snapshot(MAX_HISTORY_VERSIONS);
        let selected = building(&complete, &scope, &id(10)).unwrap();
        let history = history_metadata(&complete, &scope, &selected, &budget()).unwrap();
        assert_eq!(history.len(), MAX_HISTORY_VERSIONS);
        assert_eq!(
            available_history_slot(&history, &id(900), &id(901)),
            Err(MediaError::Conflict)
        );

        let (_, short) = snapshot(2);
        let selected = building(&short, &scope, &id(10)).unwrap();
        let history = history_metadata(&short, &scope, &selected, &budget()).unwrap();
        // Version one is retired by version two, yet its custody pair remains
        // reserved. Fresh independent custody is eligible below capacity.
        assert_eq!(
            available_history_slot(&history, &id(102), &id(103)),
            Err(MediaError::Conflict)
        );
        assert_eq!(available_history_slot(&history, &id(900), &id(901)), Ok(()));

        let (_, overflow) = snapshot(MAX_HISTORY_VERSIONS + 1);
        let selected = building(&overflow, &scope, &id(10)).unwrap();
        assert!(matches!(
            history_metadata(&overflow, &scope, &selected, &budget()),
            Err(MediaError::Conflict)
        ));
        let (_, mut reused) = snapshot(3);
        let repeated = reused
            .records
            .iter_mut()
            .find(|r| r.record_id == id(109))
            .unwrap();
        repeated.payload["originalAssetId"] = json!(id(102));
        repeated.payload["geometryVersion"] = json!(1);
        repeated.payload["previousGeometryId"] = Value::Null;
        let evidence = reused
            .records
            .iter_mut()
            .find(|r| r.record_id == id(108))
            .unwrap();
        evidence.payload["references"] = json!([{"kind":"atlas-asset","assetId":id(102)},{"kind":"atlas-asset","assetId":id(103)}]);
        let selected = building(&reused, &scope, &id(10)).unwrap();
        assert!(matches!(
            history_metadata(&reused, &scope, &selected, &budget()),
            Err(MediaError::Conflict)
        ));

        // The empty local vault establishes read ordering: ordinary metadata
        // reaches missing-blob NotFound; invalid history fails before that read.
        let temporary = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temporary.path()).unwrap();
        let vault = AssetVault::open(&root.join("vault")).unwrap();
        assert!(matches!(
            floors(&short, &scope, &id(10), &vault, &budget()),
            Err(MediaError::NotFound)
        ));
        for invalid in [&overflow, &reused] {
            assert!(matches!(
                floors(invalid, &scope, &id(10), &vault, &budget()),
                Err(MediaError::Conflict)
            ));
        }
        drop(vault);
        temporary.close().unwrap();
    }
}
