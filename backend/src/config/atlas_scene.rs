//! Bounded immutable companion for an existing private standard GLB selection.
//! Producer joins are documentary data, never native import or read authority.
use super::atlas_scene_footprint as footprint;
use super::model_overview::{Identity, ServerModelOverviewSelection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
const MAX_COMPANION: u64 = 12 * 1024 * 1024;
pub(super) fn invalid() -> String {
    "Unified Atlas publication is unavailable or inconsistent".into()
}
pub(super) fn need(ok: bool) -> Result<(), String> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|u| u.to_string() == s)
}
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)
}
fn nullable_text(s: &Option<String>, max: usize) -> bool {
    s.as_ref().is_none_or(|s| text(s, max))
}
fn nullable_uuid(s: &Option<String>) -> bool {
    s.as_ref().is_none_or(|s| uuid(s))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Scope {
    workspace_id: String,
    home_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Original {
    sha256: String,
    bytes: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Frame {
    units: String,
    up_axis: String,
    horizontal_axes: [String; 2],
    geometry_placement: String,
    physical_registration: (),
    /// Where the model stands on Earth, for the sun; absent when unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    geographic: Option<Geographic>,
}
/// Degrees; north is clockwise from the model's -Z to true north, seen from above.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Geographic {
    latitude: f64,
    longitude: f64,
    north_deg: f64,
}
impl Geographic {
    fn valid(&self) -> bool {
        let within = |v: f64, limit: f64| v.is_finite() && v.abs() <= limit;
        within(self.latitude, 90.) && within(self.longitude, 180.) && within(self.north_deg, 360.)
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Bounds {
    min: [f64; 3],
    max: [f64; 3],
}
pub(super) fn coordinate(v: f64) -> bool {
    v.is_finite() && v.abs() <= 1_000_000.
}
impl Bounds {
    fn valid(&self) -> bool {
        self.min.iter().chain(&self.max).all(|v| coordinate(*v))
            && (0..3).all(|i| self.min[i] <= self.max[i])
    }
    fn contains(&self, other: &Self) -> bool {
        (0..3).all(|i| self.min[i] <= other.min[i] && other.max[i] <= self.max[i])
    }
    fn point_contains(&self, point: [f64; 3]) -> bool {
        (0..3).all(|axis| {
            point[axis] >= self.min[axis] - 0.00001 && point[axis] <= self.max[axis] + 0.00001
        })
    }
    fn plan_contains(&self, p: &[f64; 2]) -> bool {
        p.iter().all(|v| coordinate(*v))
            && p[0] >= self.min[0]
            && p[0] <= self.max[0]
            && p[1] >= self.min[2]
            && p[1] <= self.max[2]
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Building {
    building_id: String,
    label: String,
    native_place_id: Option<String>,
    bounds: Bounds,
    level_ids: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Level {
    level_id: String,
    building_id: String,
    label: String,
    native_place_id: Option<String>,
    source_elevation_m: Option<f64>,
    elevation_basis: Option<String>,
    occurrence_ids: Vec<String>,
    bounds: Bounds,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NativeBinding {
    status: String,
    receipt_sha256: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Room {
    room_id: String,
    building_id: String,
    label: String,
    native_place_id: Option<String>,
    native_binding: NativeBinding,
    occurrence_ids: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GeometryBasis {
    kind: String,
    source_ref: Option<String>,
    note: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Occurrence {
    space_occurrence_id: String,
    room_id: String,
    building_id: String,
    level_id: String,
    bounds: Bounds,
    plan_feature_ids: Vec<String>,
    geometry_basis: GeometryBasis,
    /// Dimensions the model's owner measured; absent, never empty, when none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    measured_dimensions: Option<Vec<MeasuredDimension>>,
}
/// An owner-confirmed value the model carries beside its geometry. It labels
/// the room part; it never rescales or verifies the drawn outline.
#[derive(Deserialize, Serialize)]
#[serde(tag = "quantity", rename_all = "kebab-case", deny_unknown_fields)]
enum MeasuredDimension {
    Area {
        value: f64,
        unit: String,
        basis: String,
    },
    Length {
        value: f64,
        unit: String,
        basis: String,
        edge: MeasuredEdge,
    },
}
/// A wall by position in this companion: the outer-ring vertices of one of the
/// occurrence's room polygons where it starts and ends, walking in ring order.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MeasuredEdge {
    feature_id: String,
    polygon: usize,
    from: usize,
    to: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MeshBinding {
    artifact_id: String,
    node_index: usize,
    mesh_index: usize,
    primitive_indices: Vec<usize>,
    building_id: String,
    level_ids: Vec<String>,
    space_occurrence_id: Option<String>,
    role: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Polygon {
    outer: Vec<[f64; 2]>,
    holes: Vec<Vec<[f64; 2]>>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PlanFeature {
    feature_id: String,
    room_id: Option<String>,
    space_occurrence_id: Option<String>,
    role: String,
    polygons: Vec<Polygon>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Plan {
    plan_id: String,
    building_id: String,
    level_id: String,
    coordinates: String,
    feature_ids: Vec<String>,
    features: Vec<PlanFeature>,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Anchor {
    RoomSummary,
    SourcePosition { position: [f64; 3], basis: String },
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Overlay {
    publication_id: String,
    kind: String,
    source_revision: String,
    source_updated_at: Option<String>,
    retrieved_at: Option<String>,
    room_id: String,
    space_occurrence_id: Option<String>,
    native_place_id: Option<String>,
    record_ids: Vec<String>,
    anchor: Anchor,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Coverage {
    selectable_occurrences: Vec<String>,
    unselectable_occurrences: Vec<String>,
    exclusions: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Publication {
    profile: String,
    scope: Scope,
    publication_id: String,
    source_revision_id: String,
    source_sha256: String,
    original: Original,
    frame: Frame,
    buildings: Vec<Building>,
    levels: Vec<Level>,
    rooms: Vec<Room>,
    occurrences: Vec<Occurrence>,
    mesh_bindings: Vec<MeshBinding>,
    plans: Vec<Plan>,
    overlay_bindings: Vec<Overlay>,
    coverage: Coverage,
}
fn index<'a, T>(
    values: &'a [T],
    key: impl Fn(&'a T) -> &'a str,
    max: usize,
) -> Result<BTreeMap<&'a str, &'a T>, String> {
    need(values.len() <= max)?;
    let mut map = BTreeMap::new();
    for value in values {
        let k = key(value);
        need(id(k) && map.insert(k, value).is_none())?;
    }
    Ok(map)
}
fn unique(values: &[String], max: usize) -> bool {
    values.len() <= max
        && values.iter().all(|v| id(v))
        && values.iter().collect::<BTreeSet<_>>().len() == values.len()
}
fn same_ids(values: &[String], actual: impl Iterator<Item = String>) -> bool {
    values.iter().cloned().collect::<BTreeSet<_>>() == actual.collect()
}
// Struct serde enforces unknown fields; this also requires explicit nullable fields.
fn same_keys(input: &Value, typed: &Value) -> bool {
    match (input, typed) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && b.iter()
                    .all(|(k, v)| a.get(k).is_some_and(|a| same_keys(a, v)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_keys(a, b))
        }
        _ => true,
    }
}
/// The artifact a GLB is checked as. The companion pins the overview; the
/// optional detail is the same publication unsimplified, so it must draw the
/// same selectors within the same bounds, under its own larger work budget.
#[derive(Clone, Copy, PartialEq)]
enum Tier {
    Overview,
    Detail,
}
/// One area at most, one length per wall, each a positive value in its unit on
/// a room polygon this occurrence owns.
fn measured(
    o: &Occurrence,
    dimensions: &[MeasuredDimension],
    features: &BTreeMap<String, (&String, &PlanFeature)>,
) -> Result<(), String> {
    let value_ok = |v: f64| v.is_finite() && v > 0. && v <= 1_000_000.;
    let basis_ok = |b: &str| b == "owner-confirmed-measurement";
    need(!dimensions.is_empty() && dimensions.len() <= 1024)?;
    let (mut areas, mut walls) = (0, BTreeSet::new());
    for dimension in dimensions {
        match dimension {
            MeasuredDimension::Area { value, unit, basis } => {
                areas += 1;
                need(areas == 1 && value_ok(*value) && unit == "m2" && basis_ok(basis))?;
            }
            MeasuredDimension::Length {
                value,
                unit,
                basis,
                edge,
            } => {
                let (_, f) = features.get(&edge.feature_id).ok_or_else(invalid)?;
                let ring = f.polygons.get(edge.polygon).map(|p| p.outer.len());
                need(
                    value_ok(*value)
                        && unit == "m"
                        && basis_ok(basis)
                        && f.role == "room"
                        && o.plan_feature_ids.contains(&edge.feature_id)
                        && ring.is_some_and(|n| edge.from < n && edge.to < n)
                        && edge.from != edge.to
                        && walls.insert((&edge.feature_id, edge.polygon, edge.from, edge.to)),
                )?;
            }
        }
    }
    Ok(())
}
fn validate(value: &Value, glb: &[u8], tier: Tier) -> Result<(), String> {
    let p: Publication = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    need(same_keys(
        value,
        &serde_json::to_value(&p).map_err(|_| invalid())?,
    ))?;
    need(
        p.profile == "houseatlas.unified-atlas-publication.v1"
            && uuid(&p.scope.workspace_id)
            && uuid(&p.scope.home_id)
            && uuid(&p.publication_id)
            && id(&p.source_revision_id)
            && digest(&p.source_sha256)
            && digest(&p.original.sha256)
            && (tier == Tier::Detail
                || p.original.bytes == glb.len() as u64 && hash(glb) == p.original.sha256),
    )?;
    need(
        p.frame.units == "m"
            && p.frame.up_axis == "Y"
            && p.frame.horizontal_axes == ["X", "Z"]
            && p.frame.geometry_placement == "gltf-world-after-node-transforms-once"
            && p.frame.geographic.as_ref().is_none_or(Geographic::valid),
    )?;
    let plan_bytes = serde_json::to_vec(&value["plans"])
        .map_err(|_| invalid())?
        .len();
    let mut nonplan = value.clone();
    nonplan.as_object_mut().ok_or_else(invalid)?.remove("plans");
    need(
        plan_bytes <= 8 * 1024 * 1024
            && serde_json::to_vec(&nonplan).map_err(|_| invalid())?.len() <= 4 * 1024 * 1024
            // The detail is fetched on its own, after the scene, so only the
            // overview shares the first load's aggregate budget.
            && (tier == Tier::Detail
                || glb.len() + serde_json::to_vec(value).map_err(|_| invalid())?.len()
                    <= 64 * 1024 * 1024),
    )?;
    let buildings = index(&p.buildings, |b| &b.building_id, 128)?;
    let levels = index(&p.levels, |l| &l.level_id, 64)?;
    let rooms = index(&p.rooms, |r| &r.room_id, 2048)?;
    let occurrences = index(&p.occurrences, |o| &o.space_occurrence_id, 4096)?;
    need(
        !buildings.is_empty()
            && p.mesh_bindings.len() <= 8192
            && p.overlay_bindings.len() <= 8192
            && p.plans.len() <= 64,
    )?;
    for b in &p.buildings {
        need(
            text(&b.label, 128)
                && nullable_uuid(&b.native_place_id)
                && b.bounds.valid()
                && unique(&b.level_ids, 64)
                && same_ids(
                    &b.level_ids,
                    p.levels
                        .iter()
                        .filter(|l| l.building_id == b.building_id)
                        .map(|l| l.level_id.clone()),
                ),
        )?;
    }
    for l in &p.levels {
        let b = buildings.get(l.building_id.as_str()).ok_or_else(invalid)?;
        need(
            text(&l.label, 128)
                && nullable_uuid(&l.native_place_id)
                && l.bounds.valid()
                && b.bounds.contains(&l.bounds)
                && l.source_elevation_m.is_none_or(coordinate)
                && nullable_text(&l.elevation_basis, 256)
                && l.source_elevation_m.is_some() == l.elevation_basis.is_some()
                && unique(&l.occurrence_ids, 4096)
                && same_ids(
                    &l.occurrence_ids,
                    p.occurrences
                        .iter()
                        .filter(|o| o.level_id == l.level_id)
                        .map(|o| o.space_occurrence_id.clone()),
                ),
        )?;
    }
    for r in &p.rooms {
        need(
            buildings.contains_key(r.building_id.as_str())
                && text(&r.label, 128)
                && nullable_uuid(&r.native_place_id)
                && ["reviewed", "historical", "unmapped"]
                    .contains(&r.native_binding.status.as_str())
                && r.native_binding
                    .receipt_sha256
                    .as_ref()
                    .is_none_or(|s| digest(s))
                && unique(&r.occurrence_ids, 4096)
                && same_ids(
                    &r.occurrence_ids,
                    p.occurrences
                        .iter()
                        .filter(|o| o.room_id == r.room_id)
                        .map(|o| o.space_occurrence_id.clone()),
                ),
        )?;
        if r.native_binding.status == "reviewed" {
            need(r.native_place_id.is_some() && r.native_binding.receipt_sha256.is_some())?;
        }
        if r.native_binding.status == "unmapped" {
            need(r.native_place_id.is_none() && r.native_binding.receipt_sha256.is_none())?;
        }
    }
    for o in &p.occurrences {
        let r = rooms.get(o.room_id.as_str()).ok_or_else(invalid)?;
        let l = levels.get(o.level_id.as_str()).ok_or_else(invalid)?;
        need(
            r.building_id == o.building_id
                && l.building_id == o.building_id
                && o.bounds.valid()
                && l.bounds.contains(&o.bounds)
                && unique(&o.plan_feature_ids, 8192)
                && ["source-model", "owner-estimated-pick-proxy"]
                    .contains(&o.geometry_basis.kind.as_str())
                && nullable_text(&o.geometry_basis.source_ref, 256)
                && nullable_text(&o.geometry_basis.note, 1024),
        )?;
        if o.geometry_basis.kind == "owner-estimated-pick-proxy" {
            need(o.geometry_basis.source_ref.is_some() && o.geometry_basis.note.is_some())?;
        }
    }
    // A meshopt-compressed file is checked as its decoded plain GLB; the pins
    // above stay on the served bytes.
    let limits = match tier {
        Tier::Overview => super::atlas_scene_glb::OVERVIEW,
        Tier::Detail => super::atlas_scene_glb::DETAIL,
    };
    let expanded = super::atlas_scene_meshopt::expand(glb, limits.buffer_bytes())?;
    let glb = expanded.as_deref().unwrap_or(glb);
    let json_len = u32::from_le_bytes(
        glb.get(12..16)
            .ok_or_else(invalid)?
            .try_into()
            .map_err(|_| invalid())?,
    ) as usize;
    need(json_len <= 8 * 1024 * 1024)?;
    let gltf = crate::contracts::v2::parse_value(glb.get(20..20 + json_len).ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    need(gltf["asset"].get("minVersion").is_none_or(|v| v == "2.0"))?;
    let nodes = gltf["nodes"].as_array().ok_or_else(invalid)?;
    let meshes = gltf["meshes"].as_array().ok_or_else(invalid)?;
    let materials = super::atlas_scene_material::materials(&gltf, glb, 20 + json_len)?;
    let worlds = super::atlas_scene_glb::worlds(&gltf)?;
    let mut work = footprint::Work::default();
    let mut supports: BTreeMap<&str, footprint::Support> = BTreeMap::new();
    let mut footprints: BTreeMap<&str, Vec<footprint::Polygon>> = BTreeMap::new();
    let mut geometry_work = super::atlas_scene_glb::Work::new(materials, limits);
    let mut selectors = BTreeSet::new();
    let mut picks = BTreeSet::new();
    for m in &p.mesh_bindings {
        let b = buildings.get(m.building_id.as_str()).ok_or_else(invalid)?;
        need(
            m.artifact_id == "model"
                && !m.primitive_indices.is_empty()
                && m.primitive_indices.len() <= 8192
                && unique(&m.level_ids, 64)
                && ["structure", "roof", "slab", "room-pick", "context"].contains(&m.role.as_str()),
        )?;
        // Shared geometry is checked against the enclosing bounds of its declared
        // levels, not their intersection; it stays at its source position.
        let mut level_bounds: Option<Bounds> = None;
        for id in &m.level_ids {
            let level = levels.get(id.as_str()).ok_or_else(invalid)?;
            need(level.building_id == m.building_id)?;
            if let Some(bounds) = &mut level_bounds {
                for axis in 0..3 {
                    bounds.min[axis] = bounds.min[axis].min(level.bounds.min[axis]);
                    bounds.max[axis] = bounds.max[axis].max(level.bounds.max[axis]);
                }
            } else {
                level_bounds = Some(Bounds {
                    min: level.bounds.min,
                    max: level.bounds.max,
                });
            }
        }
        need(
            nodes
                .get(m.node_index)
                .is_some_and(|n| n.get("weights").is_none())
                && meshes
                    .get(m.mesh_index)
                    .is_some_and(|m| m.get("weights").is_none()),
        )?;
        need(
            nodes.get(m.node_index).and_then(|n| n["mesh"].as_u64()) == Some(m.mesh_index as u64),
        )?;
        let primitives = meshes
            .get(m.mesh_index)
            .and_then(|m| m["primitives"].as_array())
            .ok_or_else(invalid)?;
        for i in &m.primitive_indices {
            need(*i < primitives.len() && selectors.insert((m.node_index, m.mesh_index, *i)))?;
            let world = worlds.get(&m.node_index).ok_or_else(invalid)?;
            let geometry = super::atlas_scene_glb::positions(
                &gltf,
                glb,
                20 + json_len,
                &primitives[*i],
                world,
                &mut geometry_work,
                |point| {
                    b.bounds.point_contains(point)
                        && level_bounds
                            .as_ref()
                            .is_none_or(|bounds| bounds.point_contains(point))
                        && m.space_occurrence_id.as_ref().is_none_or(|id| {
                            occurrences
                                .get(id.as_str())
                                .is_some_and(|o| o.bounds.point_contains(point))
                        })
                },
            )?;
            if let Some(id) = &m.space_occurrence_id {
                let support = supports.entry(id.as_str()).or_default();
                support.begin(geometry.minimum_y);
                let mut positive = false;
                geometry.triangles(|triangle| {
                    positive |= support.triangle(triangle, &mut work)?;
                    Ok(())
                })?;
                need(positive)?;
            }
        }
        if let Some(id) = &m.space_occurrence_id {
            let o = occurrences.get(id.as_str()).ok_or_else(invalid)?;
            need(
                m.role == "room-pick"
                    && m.building_id == o.building_id
                    && m.level_ids == [o.level_id.clone()],
            )?;
            picks.insert(id.clone());
        } else {
            need(m.role != "room-pick")?;
        }
    }
    // The selected scene is loaded in full. Every reachable drawable must have
    // exactly one binding, so no decorative primitive bypasses admission.
    let mut remaining = selectors.len();
    let mut drawn_meshes = BTreeSet::new();
    for node_index in worlds.keys() {
        let Some(mesh_index) = nodes[*node_index].get("mesh") else {
            continue;
        };
        let mesh_index = mesh_index
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(invalid)?;
        drawn_meshes.insert(mesh_index);
        let primitives = meshes
            .get(mesh_index)
            .and_then(|m| m["primitives"].as_array())
            .ok_or_else(invalid)?;
        // Check the whole range before iterating, using the admitted selector
        // count as the budget instead of allocating another scene-sized set.
        need(!primitives.is_empty() && primitives.len() <= remaining)?;
        remaining -= primitives.len();
        for primitive_index in 0..primitives.len() {
            need(selectors.contains(&(*node_index, mesh_index, primitive_index)))?;
        }
    }
    need(remaining == 0 && drawn_meshes.len() == meshes.len())?;
    geometry_work.complete(&gltf)?;
    let mut plan_ids = BTreeSet::new();
    let mut features = BTreeMap::new();
    let mut points = 0usize;
    for plan in &p.plans {
        let level = levels.get(plan.level_id.as_str()).ok_or_else(invalid)?;
        need(
            id(&plan.plan_id)
                && plan_ids.insert(&plan.plan_id)
                && plan.building_id == level.building_id
                && plan.coordinates == "scene-XZ-metres"
                && unique(&plan.feature_ids, 8192)
                && plan.features.len() <= 8192
                && same_ids(
                    &plan.feature_ids,
                    plan.features.iter().map(|f| f.feature_id.clone()),
                ),
        )?;
        for f in &plan.features {
            need(
                id(&f.feature_id)
                    && features
                        .insert(f.feature_id.clone(), (&plan.level_id, f))
                        .is_none()
                    && ["room", "wall", "opening", "stair", "context"].contains(&f.role.as_str())
                    && !f.polygons.is_empty(),
            )?;
            if let Some(oid) = &f.space_occurrence_id {
                let o = occurrences.get(oid.as_str()).ok_or_else(invalid)?;
                need(
                    f.room_id.as_deref() == Some(o.room_id.as_str())
                        && o.level_id == plan.level_id
                        && o.building_id == plan.building_id
                        && o.plan_feature_ids.contains(&f.feature_id),
                )?;
            } else {
                need(f.room_id.is_none() && f.role != "room")?;
            }
            let mut feature_polygons = Vec::new();
            for polygon in &f.polygons {
                let mut rings = Vec::new();
                for ring in std::iter::once(&polygon.outer).chain(&polygon.holes) {
                    points = points.checked_add(ring.len()).ok_or_else(invalid)?;
                    need(
                        points <= 200_000
                            && ring.len() >= 3
                            && ring.iter().all(|point| level.bounds.plan_contains(point)),
                    )?;
                    if let Some(oid) = &f.space_occurrence_id {
                        need(
                            ring.iter()
                                .all(|point| occurrences[oid.as_str()].bounds.plan_contains(point)),
                        )?;
                    }
                    rings.push(footprint::ring(ring, &mut work)?);
                }
                let mut rings = rings.into_iter();
                let polygon = footprint::Polygon {
                    outer: rings.next().ok_or_else(invalid)?,
                    holes: rings.collect(),
                };
                polygon.validate(&mut work)?;
                feature_polygons.push(polygon);
            }
            footprint::disjoint(&feature_polygons, &mut work)?;
            if f.role == "room" {
                let oid = f.space_occurrence_id.as_deref().ok_or_else(invalid)?;
                footprints.entry(oid).or_default().extend(feature_polygons);
            }
        }
    }
    for o in &p.occurrences {
        for fid in &o.plan_feature_ids {
            need(features.get(fid).is_some_and(|(lid, f)| {
                **lid == o.level_id
                    && f.space_occurrence_id.as_deref() == Some(o.space_occurrence_id.as_str())
            }))?;
        }
        if let Some(dimensions) = &o.measured_dimensions {
            measured(o, dimensions, &features)?;
        }
    }
    need(
        unique(&p.coverage.selectable_occurrences, 4096)
            && unique(&p.coverage.unselectable_occurrences, 4096)
            && p.coverage.exclusions.len() <= 4096
            && p.coverage.exclusions.iter().all(|s| text(s, 1024)),
    )?;
    let mut covered = BTreeSet::new();
    for oid in p
        .coverage
        .selectable_occurrences
        .iter()
        .chain(&p.coverage.unselectable_occurrences)
    {
        need(occurrences.contains_key(oid.as_str()) && covered.insert(oid))?;
    }
    need(covered.len() == occurrences.len())?;
    for oid in &p.coverage.selectable_occurrences {
        need(
            picks.contains(oid)
                && occurrences[oid.as_str()]
                    .plan_feature_ids
                    .iter()
                    .any(|fid| features.get(fid).is_some_and(|(_, f)| f.role == "room")),
        )?;
        let polygons = footprints.get(oid.as_str()).ok_or_else(invalid)?;
        footprint::disjoint(polygons, &mut work)?;
        supports
            .get(oid.as_str())
            .ok_or_else(invalid)?
            .matches(polygons, &mut work)?;
    }
    need(p.coverage.unselectable_occurrences.is_empty() || !p.coverage.exclusions.is_empty())?;
    for overlay in &p.overlay_bindings {
        let room = rooms.get(overlay.room_id.as_str()).ok_or_else(invalid)?;
        need(
            overlay.publication_id == p.publication_id
                && ["electrical", "network"].contains(&overlay.kind.as_str())
                && text(&overlay.source_revision, 128)
                && nullable_text(&overlay.source_updated_at, 64)
                && nullable_text(&overlay.retrieved_at, 64)
                && nullable_uuid(&overlay.native_place_id)
                && unique(&overlay.record_ids, 1024)
                && overlay.record_ids.iter().all(|s| uuid(s)),
        )?;
        need(overlay.native_place_id == room.native_place_id)?;
        if let Some(oid) = &overlay.space_occurrence_id {
            need(
                occurrences
                    .get(oid.as_str())
                    .is_some_and(|o| o.room_id == overlay.room_id),
            )?;
        }
        if let Anchor::SourcePosition { position, basis } = &overlay.anchor {
            let building = buildings
                .get(room.building_id.as_str())
                .ok_or_else(invalid)?;
            need(
                position.iter().all(|v| coordinate(*v))
                    && text(basis, 1024)
                    && building.bounds.point_contains(*position),
            )?;
            if let Some(oid) = &overlay.space_occurrence_id {
                let occurrence = occurrences.get(oid.as_str()).ok_or_else(invalid)?;
                let level = levels
                    .get(occurrence.level_id.as_str())
                    .ok_or_else(invalid)?;
                need(
                    occurrence.bounds.point_contains(*position)
                        && level.bounds.point_contains(*position),
                )?;
            }
        }
    }
    Ok(())
}
pub struct ServerAtlasSceneSelection {
    path: PathBuf,
    identities: [Identity; 2],
    pub(crate) value: Value,
    pub(crate) semantics_sha256: String,
    pub(crate) revision: String,
    overview_sha256: String,
    entry_building_id: Option<String>,
}
impl ServerAtlasSceneSelection {
    pub fn from_arguments(
        args: &[String],
        overview: Option<&ServerModelOverviewSelection>,
    ) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let mut path = None;
        let mut hash = None;
        let mut entry_building_id = None;
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let slot = match arg.as_str() {
                "--atlas-scene-manifest" => Some(&mut path),
                "--atlas-scene-manifest-sha256" => Some(&mut hash),
                "--atlas-entry-building-id" => Some(&mut entry_building_id),
                _ => None,
            };
            if let Some(slot) = slot {
                need(args.first().map(String::as_str) == Some("serve") && slot.is_none())?;
                *slot = Some(
                    iter.next()
                        .filter(|v| !v.starts_with("--"))
                        .ok_or_else(invalid)?
                        .clone(),
                );
            } else {
                remaining.push(arg.clone());
            }
        }
        let mut selected = match (path, hash) {
            (None, None) => None,
            (Some(path), Some(hash)) => Some(Self::read_pinned(
                Path::new(&path),
                &hash,
                overview.ok_or_else(invalid)?,
            )?),
            _ => return Err(invalid()),
        };
        if let Some(entry) = entry_building_id {
            let selection = selected.as_mut().ok_or_else(invalid)?;
            need(id(&entry) && selection.has_building(&entry))?;
            selection.entry_building_id = Some(entry);
        }
        Ok((remaining, selected))
    }
    pub fn read_pinned(
        path: &Path,
        sha: &str,
        overview: &ServerModelOverviewSelection,
    ) -> Result<Self, String> {
        need(
            path.is_absolute()
                && path.file_name().and_then(|s| s.to_str()) == Some("atlas-scene.json")
                && path.parent() == overview.path.parent()
                && digest(sha),
        )?;
        let identities = [
            Identity::capture(path.parent().ok_or_else(invalid)?, true)?,
            Identity::capture(path, false)?,
        ];
        let bytes = super::server::read_selected_file(path, MAX_COMPANION, true)?;
        need(hash(&bytes) == sha)?;
        let value = crate::contracts::v2::parse_value(&bytes).map_err(|_| invalid())?;
        let glb = overview.read_original()?;
        validate(&value, &glb, Tier::Overview)?;
        drop(glb);
        if let Some(detail) = overview.read_detail()? {
            validate(&value, &detail, Tier::Detail)?;
        }
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|_| invalid())?;
        let selected = Self {
            path: path.to_owned(),
            identities,
            value,
            semantics_sha256: sha.into(),
            revision: hash(&random),
            overview_sha256: overview.manifest_sha256.clone(),
            entry_building_id: None,
        };
        selected.verify(overview)?;
        Ok(selected)
    }
    /// Exact admitted source bytes for documentary exports, including plans.
    /// Keep the original pin rather than reserializing the parsed publication.
    pub(crate) fn read_companion(
        &self,
        overview: &ServerModelOverviewSelection,
    ) -> Result<Vec<u8>, String> {
        self.verify(overview)?;
        overview.read_original()?;
        let bytes = super::server::read_selected_file(&self.path, MAX_COMPANION, true)?;
        need(hash(&bytes) == self.semantics_sha256)?;
        self.verify(overview)?;
        overview.read_original()?;
        Ok(bytes)
    }
    /// Explicit source-owner presentation preference within this selected
    /// publication. This establishes no native identity or access authority.
    pub fn entry_building_id(&self) -> Option<&str> {
        self.entry_building_id.as_deref()
    }
    fn has_building(&self, building_id: &str) -> bool {
        self.value["buildings"].as_array().is_some_and(|buildings| {
            buildings
                .iter()
                .any(|building| building["buildingId"] == building_id)
        })
    }
    pub(crate) fn verify(&self, overview: &ServerModelOverviewSelection) -> Result<(), String> {
        need(
            self.entry_building_id
                .as_ref()
                .is_none_or(|entry| id(entry) && self.has_building(entry)),
        )?;
        need(
            self.path.parent() == overview.path.parent()
                && self.overview_sha256 == overview.manifest_sha256
                && self.value["scope"]["workspaceId"] == overview.manifest.scope.workspace_id
                && self.value["scope"]["homeId"] == overview.manifest.scope.home_id
                && self.value["publicationId"] == overview.manifest.publication_id
                && self.value["original"]["sha256"] == overview.manifest.original.sha256
                && self.value["original"]["bytes"].as_u64()
                    == Some(overview.manifest.original.bytes),
        )?;
        let current = [
            Identity::capture(self.path.parent().ok_or_else(invalid)?, true)?,
            Identity::capture(&self.path, false)?,
        ];
        need(current == self.identities)?;
        need(
            hash(&super::server::read_selected_file(
                &self.path,
                MAX_COMPANION,
                true,
            )?) == self.semantics_sha256,
        )?;
        need(
            [
                Identity::capture(self.path.parent().ok_or_else(invalid)?, true)?,
                Identity::capture(&self.path, false)?,
            ] == self.identities,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    /// Admits a frame as `validate` does: typed, the same keys, values in range.
    fn admits(geographic: Option<Value>) -> bool {
        let mut frame = json!({"units":"m","upAxis":"Y","horizontalAxes":["X","Z"],
            "geometryPlacement":"gltf-world-after-node-transforms-once","physicalRegistration":null});
        if let Some(value) = geographic {
            frame["geographic"] = value;
        }
        serde_json::from_value::<Frame>(frame.clone()).is_ok_and(|typed| {
            same_keys(&frame, &serde_json::to_value(&typed).unwrap())
                && typed.geographic.as_ref().is_none_or(Geographic::valid)
        })
    }
    #[test]
    fn geographic_frame_is_optional_complete_and_in_range() {
        assert!(admits(None));
        assert!(admits(Some(
            json!({"latitude":51.48,"longitude":0,"northDeg":0})
        )));
        assert!(admits(Some(
            json!({"latitude":-90,"longitude":180,"northDeg":-360})
        )));
        assert!(!admits(Some(Value::Null)), "absent, never null");
        assert!(!admits(Some(json!({"latitude":51.48,"longitude":0}))));
        assert!(!admits(Some(
            json!({"latitude":51.48,"longitude":0,"northDeg":0,"altitude":0})
        )));
        assert!(!admits(Some(
            json!({"latitude":91,"longitude":0,"northDeg":0})
        )));
        assert!(!admits(Some(
            json!({"latitude":0,"longitude":180.5,"northDeg":0})
        )));
        assert!(!admits(Some(
            json!({"latitude":0,"longitude":0,"northDeg":"0"})
        )));
    }
    /// Admits one occurrence's dimensions as `validate` does, against a single
    /// square room feature with one polygon of four outer vertices.
    fn measures(dimensions: Value) -> bool {
        let mut row = json!({"spaceOccurrenceId":"o1","roomId":"r1","buildingId":"b1","levelId":"l1",
            "bounds":{"min":[0,0,0],"max":[4,3,4]},"planFeatureIds":["f1"],
            "geometryBasis":{"kind":"source-model","sourceRef":null,"note":null}});
        if !dimensions.is_null() {
            row["measuredDimensions"] = dimensions;
        }
        let feature: PlanFeature = serde_json::from_value(json!({"featureId":"f1","roomId":"r1",
            "spaceOccurrenceId":"o1","role":"room","polygons":[{"outer":[[0,0],[4,0],[4,4],[0,4]],"holes":[]}]}))
        .unwrap();
        let level = "l1".to_string();
        let features = BTreeMap::from([("f1".to_string(), (&level, &feature))]);
        serde_json::from_value::<Occurrence>(row.clone()).is_ok_and(|typed| {
            same_keys(&row, &serde_json::to_value(&typed).unwrap())
                && typed
                    .measured_dimensions
                    .as_deref()
                    .is_none_or(|d| measured(&typed, d, &features).is_ok())
        })
    }
    #[test]
    fn measured_dimensions_are_optional_owner_confirmed_and_on_own_walls() {
        let basis = "owner-confirmed-measurement";
        let area =
            |value: Value| json!({"quantity":"area","value":value,"unit":"m2","basis":basis});
        let wall = |from: usize, to: usize| {
            json!({"quantity":"length","value":3.52,"unit":"m","basis":basis,
            "edge":{"featureId":"f1","polygon":0,"from":from,"to":to}})
        };
        assert!(measures(Value::Null));
        assert!(measures(json!([
            area(json!(14.65)),
            wall(0, 1),
            wall(1, 3)
        ])));
        assert!(!measures(json!([])), "absent, never empty");
        assert!(
            !measures(json!([area(json!(14)), area(json!(15))])),
            "one area"
        );
        assert!(
            !measures(json!([wall(0, 1), wall(0, 1)])),
            "one value per wall"
        );
        assert!(!measures(json!([area(json!(0))])));
        assert!(!measures(json!([area(json!("14"))])));
        assert!(!measures(json!([wall(0, 0)])));
        assert!(!measures(json!([wall(0, 4)])), "vertex out of range");
        assert!(!measures(
            json!([{"quantity":"area","value":14,"unit":"m","basis":basis}])
        ));
        assert!(!measures(
            json!([{"quantity":"area","value":14,"unit":"m2","basis":"outline"}])
        ));
        assert!(!measures(
            json!([{"quantity":"height","value":2.6,"unit":"m","basis":basis}])
        ));
        assert!(
            !measures(
                json!([{"quantity":"length","value":3,"unit":"m","basis":basis,
            "edge":{"featureId":"f2","polygon":0,"from":0,"to":1}}])
            ),
            "another feature"
        );
        assert!(!measures(
            json!([{"quantity":"length","value":3,"unit":"m","basis":basis,
            "edge":{"featureId":"f1","polygon":1,"from":0,"to":1}}])
        ));
        assert!(!measures(
            json!([{"quantity":"area","value":14,"unit":"m2","basis":basis,"note":"x"}])
        ));
    }
}
