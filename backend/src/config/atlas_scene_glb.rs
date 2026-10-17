//! Bounded standard-glTF scene transforms and selected primitive positions.
//! This is not an IFC admission or a general renderer/mesh converter.
use super::atlas_scene::{coordinate, invalid, need};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
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
        // Three decomposes matrix nodes before recomposing their world pose.
        // Keep this static profile exact: general rotation/scale uses explicit
        // TRS; matrix nodes may only translate an identity linear transform.
        need((0..12).all(|i| m[i] == IDENTITY[i]))?;
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
    const MAX_NODES: usize = 20_000;
    need(
        nodes.len() <= MAX_NODES
            && nodes.iter().all(|node| {
                node.is_object()
                    && node.get("skin").is_none()
                    && node.get("weights").is_none()
                    && node
                        .get("extras")
                        .filter(|v| v.is_object())
                        .is_none_or(|extras| {
                            extras["applyTransformAgain"] != true
                                && extras["posesAlreadyApplied"] != false
                        })
            }),
    )?;
    // The loader builds every declared camera, including unused cameras.
    if let Some(cameras) = gltf.get("cameras") {
        let cameras = cameras.as_array().ok_or_else(invalid)?;
        need(cameras.len() <= MAX_NODES && cameras.iter().all(Value::is_object))?;
    }
    let scenes = gltf["scenes"].as_array().ok_or_else(invalid)?;
    need(scenes.len() == 1)?;
    let scene = gltf
        .get("scene")
        .map(|v| v.as_u64().ok_or_else(invalid))
        .transpose()?
        .unwrap_or(0) as usize;
    let roots = scenes
        .get(scene)
        .and_then(|s| s["nodes"].as_array())
        .ok_or_else(invalid)?;
    need(roots.len() <= MAX_NODES)?;
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
        need(depth <= 64 && index < nodes.len() && !worlds.contains_key(&index))?;
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
            let children = children.as_array().ok_or_else(invalid)?;
            need(children.len() <= MAX_NODES - pending.len())?;
            for child in children {
                pending.push((
                    child.as_u64().ok_or_else(invalid)? as usize,
                    world,
                    depth + 1,
                ));
            }
        }
    }
    need(worlds.len() == nodes.len())?;
    Ok(worlds)
}
// Match the renderer's allocation budget for every drawn primitive instance,
// including repeated nodes that share one declared mesh/accessor.
#[derive(Default)]
pub(super) struct Work {
    read: usize,
    accessors: BTreeSet<usize>,
    instances: usize,
    vertices: usize,
    indices: usize,
}
impl Work {
    fn primitive(&mut self, vertices: usize, indices: usize) -> Result<(), String> {
        self.instances = self.instances.checked_add(1).ok_or_else(invalid)?;
        self.vertices = self.vertices.checked_add(vertices).ok_or_else(invalid)?;
        self.indices = self.indices.checked_add(indices).ok_or_else(invalid)?;
        need(
            self.instances <= 20_000 && self.vertices <= 1_800_000 && self.indices <= 600_000 * 3,
        )?;
        // Positions, copied indices and prepared triangles, exactly as preflightGltf.
        need(self.vertices * 12 + self.indices * 4 + self.indices / 3 * 72 <= 96 * 1024 * 1024)
    }
    pub(super) fn complete(&self, gltf: &Value) -> Result<(), String> {
        // Decline unused declarations: the frontend validates every accessor,
        // whereas this static profile reads only selected primitive attributes.
        need(
            gltf["accessors"]
                .as_array()
                .is_some_and(|a| a.len() == self.accessors.len()),
        )?;
        let views = gltf["bufferViews"].as_array().ok_or_else(invalid)?;
        let declared = integer(&gltf["buffers"][0], "byteLength", None)?;
        let mut copied = 0usize;
        for view in views {
            need(view["buffer"] == 0)?;
            let offset = integer(view, "byteOffset", Some(0))?;
            let length = integer(view, "byteLength", None)?;
            need(
                length > 0
                    && offset
                        .checked_add(length)
                        .is_some_and(|end| end <= declared),
            )?;
            if view.get("byteStride").is_some() {
                let stride = integer(view, "byteStride", None)?;
                need((4..=252).contains(&stride) && stride.is_multiple_of(4))?;
            }
            copied = copied.checked_add(length).ok_or_else(invalid)?;
            need(copied <= 32 * 1024 * 1024)?;
        }
        Ok(())
    }
}
fn integer(value: &Value, key: &str, default: Option<usize>) -> Result<usize, String> {
    match value.get(key) {
        Some(v) => v
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .filter(|n| *n <= 0x7fff_ffff)
            .ok_or_else(invalid),
        None => default.ok_or_else(invalid),
    }
}
// The selected static profile admits POSITION and optional NORMAL only. Every
// admitted accessor has a checked BIN span before any element is read.
struct Accessor<'a> {
    bytes: &'a [u8],
    count: usize,
    stride: usize,
    component: usize,
}
fn accessor<'a>(
    gltf: &Value,
    glb: &'a [u8],
    json_end: usize,
    index: &Value,
    width: usize,
    indices: bool,
    work: &mut Work,
) -> Result<Accessor<'a>, String> {
    let index = index
        .as_u64()
        .and_then(|n| usize::try_from(n).ok())
        .ok_or_else(invalid)?;
    let a = gltf["accessors"].get(index).ok_or_else(invalid)?;
    let component = integer(a, "componentType", None)?;
    let unit = match component {
        5121 if indices => 1,
        5123 if indices => 2,
        5125 if indices => 4,
        5126 if !indices => 4,
        _ => return Err(invalid()),
    };
    need(
        a["type"] == if indices { "SCALAR" } else { "VEC3" }
            && a.get("sparse").is_none()
            && a.get("normalized").is_none_or(|v| v == false),
    )?;
    let count = integer(a, "count", None)?;
    work.accessors.insert(index);
    work.read = work.read.checked_add(count).ok_or_else(invalid)?;
    need(count > 0 && work.read <= 8_000_000)?;
    let view = gltf["bufferViews"]
        .get(integer(a, "bufferView", None)?)
        .ok_or_else(invalid)?;
    need(view["buffer"] == 0)?;
    let offset = integer(view, "byteOffset", Some(0))?;
    let size = integer(view, "byteLength", None)?;
    let element = unit * width;
    let stride = integer(view, "byteStride", Some(element))?;
    let start = integer(a, "byteOffset", Some(0))?;
    need(start.is_multiple_of(unit) && offset.is_multiple_of(unit))?;
    if indices {
        need(view.get("byteStride").is_none())?;
    } else {
        need(
            (element..=252).contains(&stride)
                && stride.is_multiple_of(4)
                && start.is_multiple_of(4)
                && offset.is_multiple_of(4),
        )?;
    }
    let end = start
        .checked_add((count - 1).checked_mul(stride).ok_or_else(invalid)?)
        .and_then(|n| n.checked_add(element))
        .ok_or_else(invalid)?;
    // GLTFLoader slices complete interleaved strides, including the last one.
    let loader_end = if stride != element {
        (start / stride)
            .checked_add(count)
            .and_then(|n| n.checked_mul(stride))
            .ok_or_else(invalid)?
    } else {
        start
            .checked_add(count.checked_mul(element).ok_or_else(invalid)?)
            .ok_or_else(invalid)?
    };
    need(end <= size && loader_end <= size)?;
    let declared = integer(&gltf["buffers"][0], "byteLength", None)?;
    need(offset.checked_add(size).is_some_and(|end| end <= declared))?;
    let binary = json_end.checked_add(8).ok_or_else(invalid)?;
    let first = binary
        .checked_add(offset)
        .and_then(|n| n.checked_add(start))
        .ok_or_else(invalid)?;
    let last = binary
        .checked_add(offset)
        .and_then(|n| n.checked_add(end))
        .ok_or_else(invalid)?;
    Ok(Accessor {
        bytes: glb.get(first..last).ok_or_else(invalid)?,
        count,
        stride,
        component,
    })
}
fn vector(a: &Accessor<'_>, index: usize) -> Result<[f64; 3], String> {
    let at = index * a.stride;
    let mut point = [0.; 3];
    for (axis, value) in point.iter_mut().enumerate() {
        *value = f32::from_le_bytes(
            a.bytes[at + axis * 4..at + axis * 4 + 4]
                .try_into()
                .map_err(|_| invalid())?,
        ) as f64;
        need(value.is_finite())?;
    }
    Ok(point)
}
pub(super) struct Geometry<'a> {
    position: Accessor<'a>,
    indices: Option<Accessor<'a>>,
    world: Matrix,
    pub minimum_y: f64,
}
fn index(a: &Accessor<'_>, i: usize) -> Result<usize, String> {
    let at = i * a.stride;
    let value = match a.component {
        5121 => a.bytes[at] as u32,
        5123 => u16::from_le_bytes(a.bytes[at..at + 2].try_into().map_err(|_| invalid())?) as u32,
        5125 => u32::from_le_bytes(a.bytes[at..at + 4].try_into().map_err(|_| invalid())?),
        _ => return Err(invalid()),
    };
    usize::try_from(value).map_err(|_| invalid())
}
fn transform(point: [f64; 3], world: &Matrix) -> [f64; 3] {
    std::array::from_fn(|r| {
        // standard-glb.ts stores world positions in a Float32Array before
        // prepareMeshes, bounds checks and footprint extraction consume them.
        (world[r] * point[0] + world[4 + r] * point[1] + world[8 + r] * point[2] + world[12 + r])
            as f32 as f64
    })
}
impl Geometry<'_> {
    pub(super) fn triangles(
        &self,
        mut visit: impl FnMut(super::atlas_scene_footprint::Triangle) -> Result<(), String>,
    ) -> Result<(), String> {
        let count = self
            .indices
            .as_ref()
            .map_or(self.position.count, |a| a.count);
        for first in (0..count).step_by(3) {
            let mut triangle = [[0.; 3]; 3];
            for (corner, point) in triangle.iter_mut().enumerate() {
                let vertex = match &self.indices {
                    Some(a) => index(a, first + corner)?,
                    None => first + corner,
                };
                *point = transform(vector(&self.position, vertex)?, &self.world);
            }
            visit(triangle)?;
        }
        Ok(())
    }
}
fn factor(value: Option<&Value>, width: usize) -> Result<(), String> {
    if let Some(value) = value {
        let values = value.as_array().ok_or_else(invalid)?;
        need(
            values.len() == width
                && values.iter().all(|v| {
                    v.as_f64()
                        .is_some_and(|n| n.is_finite() && (0. ..=1.).contains(&n))
                }),
        )?;
    }
    Ok(())
}
fn scalar(value: Option<&Value>) -> Result<(), String> {
    if let Some(value) = value {
        need(
            value
                .as_f64()
                .is_some_and(|n| n.is_finite() && (0. ..=1.).contains(&n)),
        )?;
    }
    Ok(())
}
// This renderer uses color materials and declines textures. Close that profile
// rather than admitting unresolved material/resource dependencies.
pub(super) fn materials(gltf: &Value) -> Result<(), String> {
    for key in ["images", "textures", "samplers"] {
        need(
            gltf.get(key)
                .is_none_or(|v| v.as_array().is_some_and(Vec::is_empty)),
        )?;
    }
    if let Some(materials) = gltf.get("materials") {
        let materials = materials.as_array().ok_or_else(invalid)?;
        need(materials.len() <= 8192)?;
        for material in materials {
            let object = material.as_object().ok_or_else(invalid)?;
            need(object.keys().all(|k| {
                [
                    "name",
                    "extras",
                    "pbrMetallicRoughness",
                    "emissiveFactor",
                    "alphaMode",
                    "alphaCutoff",
                    "doubleSided",
                ]
                .contains(&k.as_str())
            }))?;
            if let Some(pbr) = material.get("pbrMetallicRoughness") {
                let pbr = pbr.as_object().ok_or_else(invalid)?;
                need(pbr.keys().all(|k| {
                    [
                        "baseColorFactor",
                        "metallicFactor",
                        "roughnessFactor",
                        "extras",
                    ]
                    .contains(&k.as_str())
                }))?;
                factor(pbr.get("baseColorFactor"), 4)?;
                scalar(pbr.get("metallicFactor"))?;
                scalar(pbr.get("roughnessFactor"))?;
            }
            factor(material.get("emissiveFactor"), 3)?;
            scalar(material.get("alphaCutoff"))?;
            need(
                material.get("alphaMode").is_none_or(|v| {
                    v.as_str()
                        .is_some_and(|s| ["OPAQUE", "MASK", "BLEND"].contains(&s))
                }) && material.get("doubleSided").is_none_or(|v| v.is_boolean())
                    && material.get("name").is_none_or(|v| v.is_string()),
            )?;
        }
    }
    Ok(())
}
pub(super) fn positions<'a>(
    gltf: &Value,
    glb: &'a [u8],
    json_end: usize,
    primitive: &Value,
    world: &Matrix,
    work: &mut Work,
    mut check: impl FnMut([f64; 3]) -> bool,
) -> Result<Geometry<'a>, String> {
    need(primitive.get("targets").is_none() && integer(primitive, "mode", Some(4))? == 4)?;
    if primitive.get("material").is_some() {
        let material = integer(primitive, "material", None)?;
        need(
            gltf["materials"]
                .get(material)
                .is_some_and(Value::is_object),
        )?;
    }
    let attributes = primitive["attributes"].as_object().ok_or_else(invalid)?;
    need(
        attributes
            .keys()
            .all(|key| matches!(key.as_str(), "POSITION" | "NORMAL")),
    )?;
    let position = accessor(
        gltf,
        glb,
        json_end,
        &primitive["attributes"]["POSITION"],
        3,
        false,
        work,
    )?;
    let indices = primitive
        .get("indices")
        .map(|indices| accessor(gltf, glb, json_end, indices, 1, true, work))
        .transpose()?;
    work.primitive(
        position.count,
        indices.as_ref().map_or(position.count, |a| a.count),
    )?;
    if let Some(normal) = attributes.get("NORMAL") {
        let normal = accessor(gltf, glb, json_end, normal, 3, false, work)?;
        need(normal.count == position.count)?;
        for i in 0..normal.count {
            vector(&normal, i)?;
        }
    }
    if let Some(indices) = &indices {
        need(indices.count.is_multiple_of(3))?;
        for i in 0..indices.count {
            need(index(indices, i)? < position.count)?;
        }
    } else {
        need(position.count.is_multiple_of(3))?;
    }
    let mut minimum_y = f64::INFINITY;
    for i in 0..position.count {
        let point = transform(vector(&position, i)?, world);
        need(point.into_iter().all(coordinate) && check(point))?;
        minimum_y = minimum_y.min(point[1]);
    }
    Ok(Geometry {
        position,
        indices,
        world: *world,
        minimum_y,
    })
}
