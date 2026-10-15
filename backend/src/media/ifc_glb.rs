//! Bounded IFC-derived GLB custody profile. The embedded receipt binds the
//! immutable IFC original, but does not assert semantic IFC tessellation.
use super::types::sha256;
use super::{MediaError, MediaResult, WorkBudget};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub const MIME: &str = "model/gltf-binary";
pub const PROFILE: &str = "houseatlas.ifc-derived-glb.v1";
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
fn bad() -> MediaError {
    MediaError::Unsupported
}
fn need(ok: bool) -> MediaResult<()> {
    if ok { Ok(()) } else { Err(bad()) }
}
fn word(bytes: &[u8], at: usize) -> MediaResult<usize> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at + 4)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ) as usize)
}
fn hash(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    })
}
fn keys(value: &Value, expected: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|o| o.len() == expected.len() && expected.iter().all(|k| o.contains_key(*k)))
}
fn accessor_bytes<'a>(accessor: &Value, views: &[Value], bin: &'a [u8]) -> MediaResult<&'a [u8]> {
    let view = views
        .get(accessor["bufferView"].as_u64().ok_or_else(bad)? as usize)
        .ok_or_else(bad)?;
    let start = view["byteOffset"].as_u64().ok_or_else(bad)? as usize;
    let unit = match accessor["componentType"].as_u64() {
        Some(5123) => 2usize,
        Some(5125) | Some(5126) => 4,
        _ => return Err(bad()),
    };
    let width = match accessor["type"].as_str() {
        Some("SCALAR") => 1usize,
        Some("VEC3") => 3,
        _ => return Err(bad()),
    };
    let size = (accessor["count"].as_u64().ok_or_else(bad)? as usize)
        .checked_mul(unit)
        .and_then(|n| n.checked_mul(width))
        .ok_or_else(bad)?;
    bin.get(start..start.checked_add(size).ok_or_else(bad)?)
        .ok_or_else(bad)
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lineage {
    pub floor_label: String,
    pub original_sha256: String,
    pub original_bytes: u64,
    pub converter: Value,
}
pub struct QualifiedGlb<'a> {
    bytes: &'a [u8],
    lineage: Lineage,
}
impl<'a> QualifiedGlb<'a> {
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }
    pub fn lineage(&self) -> &Lineage {
        &self.lineage
    }
}
/// The only admitted GLB profile is self-contained glTF 2.0 with an embedded
/// Y-up/metre conversion claim. Numeric geometry and byte lineage are checked;
/// neither IFC project units/axes nor converter execution are proven here.
pub fn validate(bytes: &[u8], budget: &WorkBudget) -> MediaResult<Lineage> {
    budget.check()?;
    need(bytes.len() <= MAX_BYTES && bytes.len() >= 28 && bytes.len().is_multiple_of(4))?;
    need(
        bytes.get(..4) == Some(b"glTF") && word(bytes, 4)? == 2 && word(bytes, 8)? == bytes.len(),
    )?;
    let json_len = word(bytes, 12)?;
    need(json_len > 0 && json_len % 4 == 0 && bytes.get(16..20) == Some(b"JSON"))?;
    let bin_header = 20usize.checked_add(json_len).ok_or_else(bad)?;
    need(bin_header.checked_add(8).is_some_and(|n| n <= bytes.len()))?;
    let bin_len = word(bytes, bin_header)?;
    need(bin_len % 4 == 0 && bytes.get(bin_header + 4..bin_header + 8) == Some(b"BIN\0"))?;
    need(
        bin_header
            .checked_add(8)
            .and_then(|n| n.checked_add(bin_len))
            == Some(bytes.len()),
    )?;
    let document = super::mesh_derivative::parse_bounded_json(&bytes[20..bin_header], budget)?;
    let asset = &document["asset"];
    need(
        keys(
            &document,
            &[
                "asset",
                "buffers",
                "bufferViews",
                "accessors",
                "meshes",
                "nodes",
                "scenes",
                "scene",
            ],
        ) && keys(asset, &["version", "extras"])
            && keys(&asset["extras"], &["houseatlasIfcDerivative"])
            && asset["version"] == "2.0"
            && document["extensionsUsed"].is_null()
            && document["extensionsRequired"].is_null(),
    )?;
    let receipt = &asset["extras"]["houseatlasIfcDerivative"];
    need(
        keys(
            receipt,
            &[
                "profile",
                "originalSha256",
                "originalBytes",
                "floorLabel",
                "sourceUnits",
                "sourceUpAxis",
                "glbUnits",
                "glbUpAxis",
                "sourceToGlb",
                "converter",
            ],
        ) && receipt["profile"] == PROFILE
            && hash(&receipt["originalSha256"])
            && receipt["originalBytes"]
                .as_u64()
                .is_some_and(|n| n > 0 && n <= super::MAX_BYTES as u64)
            && receipt["floorLabel"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 128)
            && receipt["sourceUnits"] == "mm"
            && receipt["sourceUpAxis"] == "Z"
            && receipt["glbUnits"] == "m"
            && receipt["glbUpAxis"] == "Y"
            && receipt["sourceToGlb"] == json!({"axisMap":["x","z","-y"],"scale":0.001}),
    )?;
    let converter = &receipt["converter"];
    need(
        keys(converter, &["name", "version", "configSha256"])
            && converter["name"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 128)
            && converter["version"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 64)
            && hash(&converter["configSha256"]),
    )?;
    let buffers = document["buffers"].as_array().ok_or_else(bad)?;
    let bin = &bytes[bin_header + 8..];
    need(
        buffers.len() == 1
            && keys(&buffers[0], &["byteLength"])
            && buffers[0]["byteLength"]
                .as_u64()
                .is_some_and(|n| n > 0 && n <= bin_len as u64 && bin_len as u64 - n <= 3),
    )?;
    // The closed profile rejects external references and features the viewer
    // does not validate; resource loading must never follow a GLB URL.
    need(
        document["images"].is_null()
            && document["textures"].is_null()
            && document["animations"].is_null()
            && document["skins"].is_null()
            && document["cameras"].is_null(),
    )?;
    let views = document["bufferViews"].as_array().ok_or_else(bad)?;
    let accessors = document["accessors"].as_array().ok_or_else(bad)?;
    let meshes = document["meshes"].as_array().ok_or_else(bad)?;
    let nodes = document["nodes"].as_array().ok_or_else(bad)?;
    let scenes = document["scenes"].as_array().ok_or_else(bad)?;
    need(
        !meshes.is_empty()
            && meshes.len() <= 512
            && views.len() == meshes.len() * 2
            && accessors.len() == views.len()
            && nodes.len() == meshes.len()
            && scenes.len() == 1
            && document["scene"] == 0,
    )?;
    let declared = buffers[0]["byteLength"].as_u64().ok_or_else(bad)? as usize;
    need(bin[declared..].iter().all(|b| *b == 0))?;
    let mut covered = 0usize;
    for view in views {
        budget.check()?;
        need(
            keys(view, &["buffer", "byteLength", "byteOffset"])
                && view["byteOffset"].as_u64().is_some_and(|n| n % 4 == 0)
                && view["buffer"] == 0
                && view["byteLength"].as_u64().is_some_and(|n| n > 0)
                && view["byteOffset"]
                    .as_u64()
                    .unwrap_or(0)
                    .checked_add(view["byteLength"].as_u64().unwrap_or(u64::MAX))
                    .is_some_and(|end| end <= buffers[0]["byteLength"].as_u64().unwrap_or(0)),
        )?;
        let start = view["byteOffset"].as_u64().ok_or_else(bad)? as usize;
        need(
            start >= covered && start - covered <= 3 && bin[covered..start].iter().all(|b| *b == 0),
        )?;
        covered = start + (view["byteLength"].as_u64().ok_or_else(bad)? as usize);
    }
    need(declared - covered <= 3 && bin[covered..declared].iter().all(|b| *b == 0))?;
    for (accessor_index, accessor) in accessors.iter().enumerate() {
        budget.check()?;
        need(
            keys(accessor, &["bufferView", "componentType", "count", "type"])
                && accessor["bufferView"] == accessor_index
                && accessor["count"]
                    .as_u64()
                    .is_some_and(|n| n > 0 && n <= 150_000),
        )?;
        let unit = match accessor["componentType"].as_u64() {
            Some(5123) => 2u64,
            Some(5125) | Some(5126) => 4,
            _ => return Err(bad()),
        };
        let width = match accessor["type"].as_str() {
            Some("SCALAR") => 1u64,
            Some("VEC3") => 3,
            _ => return Err(bad()),
        };
        let view = &views[accessor["bufferView"].as_u64().ok_or_else(bad)? as usize];
        need(
            unit.checked_mul(width)
                .and_then(|n| n.checked_mul(accessor["count"].as_u64()?))
                == view["byteLength"].as_u64(),
        )?;
    }
    need(meshes.len() == nodes.len())?;
    let mut total_vertices = 0u64;
    let mut total_triangles = 0u64;
    let mut mesh_names = BTreeSet::new();
    for (mesh_index, mesh) in meshes.iter().enumerate() {
        budget.check()?;
        need(keys(mesh, &["name", "primitives"]))?;
        let name = mesh["name"].as_str().ok_or_else(bad)?;
        need(!name.is_empty() && name.len() <= 128 && mesh_names.insert(name.to_owned()))?;
        let primitives = mesh["primitives"].as_array().ok_or_else(bad)?;
        need(primitives.len() == 1)?;
        for p in primitives {
            need(
                keys(p, &["attributes", "indices", "mode"])
                    && p["mode"] == 4
                    && keys(&p["attributes"], &["POSITION"])
                    && p["attributes"]["POSITION"] == mesh_index * 2
                    && p["indices"] == mesh_index * 2 + 1,
            )?;
            let position =
                &accessors[p["attributes"]["POSITION"].as_u64().ok_or_else(bad)? as usize];
            let indices = &accessors[p["indices"].as_u64().ok_or_else(bad)? as usize];
            need(
                position["type"] == "VEC3"
                    && position["componentType"] == 5126
                    && indices["type"] == "SCALAR"
                    && (indices["componentType"] == 5123 || indices["componentType"] == 5125)
                    && indices["count"]
                        .as_u64()
                        .is_some_and(|n| n > 0 && n % 3 == 0),
            )?;
            total_vertices = total_vertices
                .checked_add(position["count"].as_u64().ok_or_else(bad)?)
                .ok_or_else(bad)?;
            total_triangles = total_triangles
                .checked_add(indices["count"].as_u64().ok_or_else(bad)? / 3)
                .ok_or_else(bad)?;
            need(total_vertices <= 150_000 && total_triangles <= 50_000)?;
            let positions = accessor_bytes(position, views, bin)?;
            for item in positions.as_chunks::<4>().0 {
                budget.check()?;
                let coordinate = f32::from_le_bytes(*item);
                need(coordinate.is_finite() && coordinate.abs() <= 1_000_000.0)?;
            }
            let triangle_indices = accessor_bytes(indices, views, bin)?;
            let index_width = if indices["componentType"] == 5123 {
                2
            } else {
                4
            };
            let vertex_count = position["count"].as_u64().ok_or_else(bad)?;
            let mut decoded_indices = Vec::with_capacity(triangle_indices.len() / index_width);
            for item in triangle_indices.chunks_exact(index_width) {
                budget.check()?;
                let n = if index_width == 2 {
                    u16::from_le_bytes(item.try_into().map_err(|_| bad())?) as u64
                } else {
                    u32::from_le_bytes(item.try_into().map_err(|_| bad())?) as u64
                };
                need(n < vertex_count)?;
                decoded_indices.push(n as usize);
            }
            let point = |vertex: usize, axis: usize| -> MediaResult<f64> {
                let at = vertex
                    .checked_mul(12)
                    .and_then(|n| n.checked_add(axis * 4))
                    .ok_or_else(bad)?;
                Ok(f32::from_le_bytes(
                    positions
                        .get(at..at + 4)
                        .ok_or_else(bad)?
                        .try_into()
                        .map_err(|_| bad())?,
                ) as f64)
            };
            for triangle in decoded_indices.as_chunks::<3>().0 {
                budget.check()?;
                let a = [
                    point(triangle[0], 0)?,
                    point(triangle[0], 1)?,
                    point(triangle[0], 2)?,
                ];
                let b = [
                    point(triangle[1], 0)?,
                    point(triangle[1], 1)?,
                    point(triangle[1], 2)?,
                ];
                let c = [
                    point(triangle[2], 0)?,
                    point(triangle[2], 1)?,
                    point(triangle[2], 2)?,
                ];
                let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                let cross = [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0],
                ];
                need(cross.iter().all(|n| n.is_finite()) && cross.iter().any(|n| *n != 0.0))?;
            }
        }
        let node = &nodes[mesh_index];
        need(
            keys(node, &["name", "mesh"])
                && node["mesh"] == mesh_index
                && node["name"] == mesh["name"],
        )?;
    }
    let roots = scenes[0]["nodes"].as_array().ok_or_else(bad)?;
    need(
        keys(&scenes[0], &["nodes"])
            && roots.len() == nodes.len()
            && roots.iter().enumerate().all(|(i, n)| n == &json!(i)),
    )?;
    need(
        roots
            .iter()
            .filter_map(Value::as_u64)
            .collect::<BTreeSet<_>>()
            .len()
            == nodes.len(),
    )?;
    budget.check()?;
    Ok(Lineage {
        floor_label: receipt["floorLabel"].as_str().ok_or_else(bad)?.to_owned(),
        original_sha256: receipt["originalSha256"]
            .as_str()
            .ok_or_else(bad)?
            .to_owned(),
        original_bytes: receipt["originalBytes"].as_u64().ok_or_else(bad)?,
        converter: converter.clone(),
    })
}
pub fn qualify<'a>(
    bytes: &'a [u8],
    original: &[u8],
    budget: &WorkBudget,
) -> MediaResult<QualifiedGlb<'a>> {
    let lineage = validate(bytes, budget)?;
    need(
        lineage.original_sha256 == sha256(original)
            && lineage.original_bytes == original.len() as u64,
    )?;
    super::geometry_original::validate(original, super::types::ContentType::Ifc, budget)?;
    Ok(QualifiedGlb { bytes, lineage })
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn budget() -> WorkBudget {
        WorkBudget::new(Duration::from_secs(10), Default::default()).unwrap()
    }
    fn source() -> Vec<u8> {
        b"ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;\nDATA;ENDSEC;\nEND-ISO-10303-21;"
            .to_vec()
    }
    fn fixture(original: &[u8]) -> Vec<u8> {
        let mut binary = vec![0u8; 44];
        for (i, v) in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.].iter().enumerate() {
            binary[4 * i..4 * i + 4].copy_from_slice(&v.to_le_bytes());
        }
        for (i, v) in [0u16, 1, 2].iter().enumerate() {
            binary[36 + 2 * i..38 + 2 * i].copy_from_slice(&v.to_le_bytes());
        }
        let doc = json!({
            "asset":{"version":"2.0","extras":{"houseatlasIfcDerivative":{
                "profile":PROFILE,"originalSha256":sha256(original),"originalBytes":original.len(),
                "floorLabel":"Synthetic floor","sourceUnits":"mm","sourceUpAxis":"Z",
                "glbUnits":"m","glbUpAxis":"Y",
                "sourceToGlb":{"axisMap":["x","z","-y"],"scale":0.001},
                "converter":{"name":"synthetic","version":"1","configSha256":"a".repeat(64)}
            }}},
            "buffers":[{"byteLength":42}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":6}],
            "accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},{"bufferView":1,"componentType":5123,"count":3,"type":"SCALAR"}],
            "meshes":[{"name":"synthetic-mesh","primitives":[{"attributes":{"POSITION":0},"indices":1,"mode":4}]}],
            "nodes":[{"name":"synthetic-mesh","mesh":0}],"scenes":[{"nodes":[0]}],"scene":0
        });
        let mut document = serde_json::to_vec(&doc).unwrap();
        while document.len() % 4 != 0 {
            document.push(b' ');
        }
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"glTF");
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&((28 + document.len() + binary.len()) as u32).to_le_bytes());
        bytes.extend_from_slice(&(document.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"JSON");
        bytes.extend_from_slice(&document);
        bytes.extend_from_slice(&(binary.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"BIN\0");
        bytes.extend_from_slice(&binary);
        bytes
    }
    #[test]
    fn healthy_ifc_glb_lineage_and_axes() {
        let source = source();
        let glb = fixture(&source);
        let qualified = qualify(&glb, &source, &budget()).unwrap();
        assert_eq!(qualified.lineage().original_sha256, sha256(&source));
        assert_eq!(qualified.lineage().floor_label, "Synthetic floor");
    }
}
