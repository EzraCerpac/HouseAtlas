//! Bounded standard-glTF scene transforms and selected primitive positions.
//! This is not an IFC admission or a general renderer/mesh converter.
use super::atlas_scene::{coordinate, invalid, need};
use serde_json::Value;
use std::collections::BTreeMap;
type Matrix = [f64; 16];
const IDENTITY: Matrix = [
    1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
];
fn numbers<const N: usize>(value: Option<&Value>, default: [f64; N]) -> Result<[f64; N], String> {
    let Some(value) = value else {
        return Ok(default);
    };
    let values = value.as_array().ok_or_else(invalid)?;
    need(values.len() == N)?;
    let mut output = default;
    for (slot, value) in output.iter_mut().zip(values) {
        *slot = value
            .as_f64()
            .filter(|v| coordinate(*v))
            .ok_or_else(invalid)?;
    }
    Ok(output)
}
fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    let mut out = [0.; 16];
    for c in 0..4 {
        for r in 0..4 {
            out[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    out
}
fn local(node: &Value) -> Result<Matrix, String> {
    if node.get("matrix").is_some() {
        need(
            ["translation", "rotation", "scale"]
                .iter()
                .all(|k| node.get(k).is_none()),
        )?;
        let m = numbers(node.get("matrix"), IDENTITY)?;
        need(m[3] == 0. && m[7] == 0. && m[11] == 0. && m[15] == 1.)?;
        return Ok(m);
    }
    let [x, y, z, w] = numbers(node.get("rotation"), [0., 0., 0., 1.])?;
    need((x * x + y * y + z * z + w * w - 1.).abs() < 0.0001)?;
    let scale = numbers(node.get("scale"), [1., 1., 1.])?;
    let translation = numbers(node.get("translation"), [0., 0., 0.])?;
    let mut m = [
        1. - 2. * (y * y + z * z),
        2. * (x * y + z * w),
        2. * (x * z - y * w),
        0.,
        2. * (x * y - z * w),
        1. - 2. * (x * x + z * z),
        2. * (y * z + x * w),
        0.,
        2. * (x * z + y * w),
        2. * (y * z - x * w),
        1. - 2. * (x * x + y * y),
        0.,
        translation[0],
        translation[1],
        translation[2],
        1.,
    ];
    for c in 0..3 {
        for r in 0..3 {
            m[c * 4 + r] *= scale[c];
        }
    }
    Ok(m)
}
pub(super) fn worlds(gltf: &Value) -> Result<BTreeMap<usize, Matrix>, String> {
    let nodes = gltf["nodes"].as_array().ok_or_else(invalid)?;
    need(nodes.len() <= 65_536)?;
    let scene = gltf
        .get("scene")
        .map(|v| v.as_u64().ok_or_else(invalid))
        .transpose()?
        .unwrap_or(0) as usize;
    let roots = gltf["scenes"]
        .get(scene)
        .and_then(|s| s["nodes"].as_array())
        .ok_or_else(invalid)?;
    let mut worlds = BTreeMap::new();
    let mut pending = Vec::new();
    for root in roots {
        pending.push((
            root.as_u64().ok_or_else(invalid)? as usize,
            IDENTITY,
            0usize,
        ));
    }
    while let Some((index, parent, depth)) = pending.pop() {
        need(depth <= 256 && index < nodes.len() && !worlds.contains_key(&index))?;
        let node = &nodes[index];
        let world = multiply(&parent, &local(node)?);
        need(
            world.iter().all(|n| n.is_finite())
                && [world[12], world[13], world[14]]
                    .into_iter()
                    .all(coordinate),
        )?;
        worlds.insert(index, world);
        if let Some(children) = node.get("children") {
            for child in children.as_array().ok_or_else(invalid)? {
                pending.push((
                    child.as_u64().ok_or_else(invalid)? as usize,
                    world,
                    depth + 1,
                ));
            }
            need(pending.len() <= 65_536)?;
        }
    }
    Ok(worlds)
}
fn integer(value: &Value, key: &str, default: Option<usize>) -> Result<usize, String> {
    match value.get(key) {
        Some(v) => v
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(invalid),
        None => default.ok_or_else(invalid),
    }
}
pub(super) fn positions(
    gltf: &Value,
    glb: &[u8],
    json_end: usize,
    primitive: &Value,
    world: &Matrix,
    visited: &mut usize,
    mut check: impl FnMut([f64; 3]) -> bool,
) -> Result<(), String> {
    let accessor = primitive["attributes"]["POSITION"]
        .as_u64()
        .ok_or_else(invalid)? as usize;
    let a = gltf["accessors"].get(accessor).ok_or_else(invalid)?;
    need(
        a["componentType"] == 5126
            && a["type"] == "VEC3"
            && a.get("sparse").is_none()
            && a.get("normalized").is_none_or(|v| v == false),
    )?;
    let count = integer(a, "count", None)?;
    *visited = visited.checked_add(count).ok_or_else(invalid)?;
    need(count > 0 && *visited <= 8_000_000)?;
    let view = gltf["bufferViews"]
        .get(integer(a, "bufferView", None)?)
        .ok_or_else(invalid)?;
    need(view["buffer"] == 0)?;
    let offset = integer(view, "byteOffset", Some(0))?;
    let size = integer(view, "byteLength", None)?;
    let stride = integer(view, "byteStride", Some(12))?;
    let start = integer(a, "byteOffset", Some(0))?;
    need(
        (12..=252).contains(&stride)
            && stride.is_multiple_of(4)
            && start.is_multiple_of(4)
            && offset.is_multiple_of(4),
    )?;
    let end = start
        .checked_add((count - 1).checked_mul(stride).ok_or_else(invalid)?)
        .and_then(|n| n.checked_add(12))
        .ok_or_else(invalid)?;
    need(end <= size)?;
    let binary = json_end.checked_add(8).ok_or_else(invalid)?;
    for i in 0..count {
        let at = binary
            .checked_add(offset)
            .and_then(|n| n.checked_add(start))
            .and_then(|n| n.checked_add(i * stride))
            .ok_or_else(invalid)?;
        let bytes = glb.get(at..at + 12).ok_or_else(invalid)?;
        let mut p = [0.; 3];
        for (axis, p) in p.iter_mut().enumerate() {
            *p = f32::from_le_bytes(
                bytes[axis * 4..axis * 4 + 4]
                    .try_into()
                    .map_err(|_| invalid())?,
            ) as f64;
            need(p.is_finite())?;
        }
        let point = std::array::from_fn(|r| {
            world[r] * p[0] + world[4 + r] * p[1] + world[8 + r] * p[2] + world[12 + r]
        });
        need(point.into_iter().all(coordinate) && check(point))?;
    }
    Ok(())
}
