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
                    && node.get("camera").is_none()
                    && node
                        .get("extras")
                        .filter(|v| v.is_object())
                        .is_none_or(|extras| {
                            extras["applyTransformAgain"] != true
                                && extras["posesAlreadyApplied"] != false
                        })
            }),
    )?;
    // The viewer owns its camera; source cameras are outside this static profile.
    need(
        gltf.get("cameras")
            .is_none_or(|v| v.as_array().is_some_and(Vec::is_empty)),
    )?;
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
const MIB: usize = 1024 * 1024;
/// The work one tier admits. The overview is what every device loads; the
/// detail is the unsimplified master, which only capable devices opt into.
/// Both match the frontend's tier limits (glb-preflight.ts).
#[derive(Clone, Copy)]
pub(super) struct Limits {
    instances: usize,
    vertices: usize,
    triangles: usize,
    accessor_reads: usize,
    buffer_bytes: usize,
    prepared_bytes: usize,
    gpu_bytes: usize,
}
pub(super) const OVERVIEW: Limits = Limits {
    instances: 20_000,
    vertices: 1_800_000,
    triangles: 600_000,
    accessor_reads: 8_000_000,
    buffer_bytes: 32 * MIB,
    prepared_bytes: 96 * MIB,
    gpu_bytes: 64 * MIB,
};
pub(super) const DETAIL: Limits = Limits {
    instances: 20_000,
    vertices: 12_000_000,
    triangles: 4_000_000,
    accessor_reads: 64_000_000,
    buffer_bytes: 256 * MIB,
    prepared_bytes: 640 * MIB,
    gpu_bytes: 384 * MIB,
};
// Match the renderer's allocation budget for every drawn primitive instance,
// including repeated nodes that share one declared mesh/accessor.
pub(super) struct Work {
    limits: Limits,
    read: usize,
    accessors: BTreeSet<usize>,
    instances: usize,
    vertices: usize,
    indices: usize,
    attribute_copies: usize,
    expanded_attributes: usize,
    materials: super::atlas_scene_material::Materials,
}
impl Work {
    pub(super) fn new(materials: super::atlas_scene_material::Materials, limits: Limits) -> Self {
        Self {
            limits,
            read: 0,
            accessors: BTreeSet::new(),
            instances: 0,
            vertices: 0,
            indices: 0,
            attribute_copies: 0,
            expanded_attributes: 0,
            materials,
        }
    }
    fn primitive(
        &mut self,
        vertices: usize,
        indices: usize,
        source_width: usize,
        expanded_width: usize,
    ) -> Result<(), String> {
        self.instances = self.instances.checked_add(1).ok_or_else(invalid)?;
        self.vertices = self.vertices.checked_add(vertices).ok_or_else(invalid)?;
        self.indices = self.indices.checked_add(indices).ok_or_else(invalid)?;
        need(
            self.instances <= self.limits.instances
                && self.vertices <= self.limits.vertices
                && self.indices <= self.limits.triangles * 3,
        )?;
        self.attribute_copies = self
            .attribute_copies
            .checked_add(vertices * source_width)
            .ok_or_else(invalid)?;
        self.expanded_attributes = self
            .expanded_attributes
            .checked_add(indices * expanded_width)
            .ok_or_else(invalid)?;
        // Keep the legacy position/flat-normal stream (24 bytes). Textured
        // corners also own UV2/shading-normal3/tangent4 (36 bytes), including
        // fallback tangent values when the material has no normal map.
        need(
            self.prepared_bytes() <= self.limits.prepared_bytes
                && self.gpu_bytes() <= self.limits.gpu_bytes,
        )
    }
    fn prepared_bytes(&self) -> usize {
        self.vertices * 12
            + self.indices * 4
            + self.indices * 24
            + self.expanded_attributes
            + self.attribute_copies
            + self.materials.retained_bytes
            + self.materials.encoded_bytes
            + self.materials.scratch_bytes
    }
    fn gpu_bytes(&self) -> usize {
        self.indices * 24 + self.expanded_attributes + self.materials.mip_bytes
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
            need(copied <= self.limits.buffer_bytes)?;
        }
        Ok(())
    }
}
pub(super) fn integer(value: &Value, key: &str, default: Option<usize>) -> Result<usize, String> {
    match value.get(key) {
        Some(v) => v
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .filter(|n| *n <= 0x7fff_ffff)
            .ok_or_else(invalid),
        None => default.ok_or_else(invalid),
    }
}
// The selected static profile admits checked FLOAT vector attributes. Every
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
        a["type"]
            == if indices {
                "SCALAR"
            } else {
                match width {
                    2 => "VEC2",
                    3 => "VEC3",
                    4 => "VEC4",
                    _ => return Err(invalid()),
                }
            }
            && a.get("sparse").is_none()
            && a.get("normalized").is_none_or(|v| v == false),
    )?;
    let count = integer(a, "count", None)?;
    work.accessors.insert(index);
    work.read = work.read.checked_add(count).ok_or_else(invalid)?;
    need(count > 0 && work.read <= work.limits.accessor_reads)?;
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
fn vector<const N: usize>(a: &Accessor<'_>, index: usize) -> Result<[f64; N], String> {
    let at = index * a.stride;
    let mut point = [0.; N];
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
    reflected: bool,
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
// Keep the determinant operations in the same order as Three's Matrix4:
// standard-glb.ts swaps the final two indices when this determinant is negative.
fn determinant(m: &Matrix) -> f64 {
    let [
        n11,
        n21,
        n31,
        n41,
        n12,
        n22,
        n32,
        n42,
        n13,
        n23,
        n33,
        n43,
        n14,
        n24,
        n34,
        n44,
    ] = *m;
    let t11 = n23 * n34 - n24 * n33;
    let t12 = n22 * n34 - n24 * n32;
    let t13 = n22 * n33 - n23 * n32;
    let t21 = n21 * n34 - n24 * n31;
    let t22 = n21 * n33 - n23 * n31;
    let t23 = n21 * n32 - n22 * n31;
    n11 * (n42 * t11 - n43 * t12 + n44 * t13) - n12 * (n41 * t11 - n43 * t21 + n44 * t22)
        + n13 * (n41 * t12 - n42 * t21 + n44 * t23)
        - n14 * (n41 * t13 - n42 * t22 + n43 * t23)
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
            if self.reflected {
                triangle.swap(1, 2);
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
// Preserve the existing untextured core material profile.
pub(super) fn color_material(material: &Value) -> Result<(), String> {
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
    if let Some(cutoff) = material.get("alphaCutoff") {
        need(cutoff.as_f64().is_some_and(|v| v.is_finite() && v >= 0.))?;
    }
    need(
        material.get("alphaMode").is_none_or(|v| {
            v.as_str()
                .is_some_and(|s| ["OPAQUE", "MASK", "BLEND"].contains(&s))
        }) && material.get("doubleSided").is_none_or(|v| v.is_boolean())
            && material.get("name").is_none_or(|v| v.is_string()),
    )?;
    Ok(())
}
// Inverse-transpose normal basis for the opted-in shading path. Admission
// checks representability; the renderer owns the single world-pose application.
fn normal_basis(n: [f64; 3], m: &Matrix) -> Result<[f64; 3], String> {
    let cofactors = [
        [
            m[5] * m[10] - m[9] * m[6],
            m[9] * m[2] - m[1] * m[10],
            m[1] * m[6] - m[5] * m[2],
        ],
        [
            m[8] * m[6] - m[4] * m[10],
            m[0] * m[10] - m[8] * m[2],
            m[4] * m[2] - m[0] * m[6],
        ],
        [
            m[4] * m[9] - m[8] * m[5],
            m[8] * m[1] - m[0] * m[9],
            m[0] * m[5] - m[4] * m[1],
        ],
    ];
    // Matrix3.getNormalMatrix uses this inverse-transpose determinant order.
    let det = m[0] * cofactors[0][0] + m[1] * cofactors[1][0] + m[2] * cofactors[2][0];
    need(det.is_finite() && det != 0.)?;
    let inverse = 1. / det;
    let transformed: [f64; 3] = std::array::from_fn(|r| {
        let row = cofactors[r];
        row[0] * inverse * n[0] + row[1] * inverse * n[1] + row[2] * inverse * n[2]
    });
    let length_squared = transformed.iter().map(|v| v * v).sum::<f64>();
    need(length_squared.is_finite() && length_squared > 0.)?;
    let normalize = 1. / length_squared.sqrt();
    Ok(transformed.map(|v| v * normalize))
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
    let material = work.materials.primitive(primitive)?;
    let attributes = primitive["attributes"].as_object().ok_or_else(invalid)?;
    need(attributes.keys().all(|key| {
        matches!(key.as_str(), "POSITION" | "NORMAL")
            || material.textured && matches!(key.as_str(), "TEXCOORD_0" | "TANGENT")
    }))?;
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
    let mut source_width = 0;
    let expanded_width = if material.textured { 36 } else { 0 };
    let normal = attributes
        .get("NORMAL")
        .map(|value| accessor(gltf, glb, json_end, value, 3, false, work))
        .transpose()?;
    if let Some(normal) = &normal {
        need(normal.count == position.count)?;
        for i in 0..normal.count {
            let n = vector::<3>(normal, i)?;
            if material.textured {
                normal_basis(n, world)?;
            }
        }
        if material.textured {
            source_width += 12;
        }
    }
    if material.textured {
        need(normal.is_some() && determinant(world).is_finite() && determinant(world) != 0.)?;
        let uv = accessor(
            gltf,
            glb,
            json_end,
            attributes.get("TEXCOORD_0").ok_or_else(invalid)?,
            2,
            false,
            work,
        )?;
        need(uv.count == position.count)?;
        for i in 0..uv.count {
            need(vector::<2>(&uv, i)?.iter().all(|v| v.abs() <= 1_000_000.))?;
        }
        source_width += 8;
        if material.normal_map {
            need(attributes.contains_key("TANGENT"))?;
        }
        if let Some(tangent) = attributes.get("TANGENT") {
            let tangent = accessor(gltf, glb, json_end, tangent, 4, false, work)?;
            need(tangent.count == position.count)?;
            for i in 0..tangent.count {
                let [x, y, z, w] = vector::<4>(&tangent, i)?;
                if material.normal_map {
                    need(
                        ((x * x + y * y + z * z).sqrt() - 1.).abs() <= 0.0001
                            && (w == -1. || w == 1.),
                    )?;
                    let transformed: [f64; 3] =
                        std::array::from_fn(|r| world[r] * x + world[4 + r] * y + world[8 + r] * z);
                    let n =
                        normal_basis(vector::<3>(normal.as_ref().ok_or_else(invalid)?, i)?, world)?;
                    let dot = transformed.iter().zip(n).map(|(t, n)| t * n).sum::<f64>();
                    let orthogonal: [f64; 3] =
                        std::array::from_fn(|r| transformed[r] + n[r] * (-dot));
                    let length_squared = orthogonal.iter().map(|v| v * v).sum::<f64>();
                    need(length_squared.is_finite() && length_squared > 0.)?;
                }
            }
            if material.normal_map {
                source_width += 16;
            }
        }
    }
    work.primitive(
        position.count,
        indices.as_ref().map_or(position.count, |a| a.count),
        source_width,
        expanded_width,
    )?;
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
        if indices.is_none() {
            minimum_y = minimum_y.min(point[1]);
        }
    }
    // Indexed support planes follow only drawn vertices, as prepareMeshes does;
    // unused positions retain the strict finite/range/bounds checks above.
    if let Some(indices) = &indices {
        for i in 0..indices.count {
            let point = transform(vector(&position, index(indices, i)?)?, world);
            minimum_y = minimum_y.min(point[1]);
        }
    }
    Ok(Geometry {
        position,
        indices,
        world: *world,
        reflected: determinant(world) < 0.,
        minimum_y,
    })
}

#[cfg(test)]
#[path = "../../examples/support/unified_atlas_fixture.rs"]
mod fixture;
#[cfg(test)]
#[path = "../../examples/support/unified_atlas_material_fixture.rs"]
mod material_fixture;

// Dedicated generated successful material fixtures only. These execute the
// existing publication owner, then check exact allocation facts and legacy
// triangle equivalence without any reader/recovery/control operation.
#[cfg(test)]
mod material_healthy {
    use super::*;
    use crate::config::{
        atlas_scene::ServerAtlasSceneSelection, model_overview::ServerModelOverviewSelection,
    };
    use serde_json::json;
    use std::{fs, os::unix::fs::PermissionsExt};
    fn geometry(glb: &[u8]) -> (Work, Vec<super::super::atlas_scene_footprint::Triangle>) {
        let size = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let gltf: Value = serde_json::from_slice(&glb[20..20 + size]).unwrap();
        let materials =
            super::super::atlas_scene_material::materials(&gltf, glb, 20 + size).unwrap();
        let mut work = Work::new(materials, OVERVIEW);
        let mut triangles = Vec::new();
        for (node, world) in worlds(&gltf).unwrap() {
            if let Some(mesh) = gltf["nodes"][node]["mesh"].as_u64() {
                for primitive in gltf["meshes"][mesh as usize]["primitives"]
                    .as_array()
                    .unwrap()
                {
                    positions(&gltf, glb, 20 + size, primitive, &world, &mut work, |_| {
                        true
                    })
                    .unwrap()
                    .triangles(|t| {
                        triangles.push(t);
                        Ok(())
                    })
                    .unwrap();
                }
            }
        }
        work.complete(&gltf).unwrap();
        (work, triangles)
    }
    fn positive(name: &str, encoded: usize, rgba: usize, mips: usize, prepared: usize, gpu: usize) {
        let scope = json!({"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003"});
        let publication_id = "00000000-0000-4000-8000-000000000006".to_owned();
        let (legacy, _, _) = fixture::generate(scope.clone(), publication_id.clone());
        let (glb, overview, scene) = material_fixture::generate(scope, publication_id, name);
        let root = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        for (file, bytes) in [
            ("overview.glb", &glb),
            ("publication.json", &overview),
            ("atlas-scene.json", &scene),
        ] {
            fs::write(root.join(file), bytes).unwrap();
            fs::set_permissions(root.join(file), fs::Permissions::from_mode(0o600)).unwrap();
        }
        let overview = ServerModelOverviewSelection::read_pinned(
            &root.join("publication.json"),
            &fixture::sha(&overview),
        )
        .unwrap();
        ServerAtlasSceneSelection::read_pinned(
            &root.join("atlas-scene.json"),
            &fixture::sha(&scene),
            &overview,
        )
        .unwrap();
        let (work, triangles) = geometry(&glb);
        let (old, old_triangles) = geometry(&legacy);
        assert_eq!(triangles, old_triangles);
        assert_eq!((old.prepared_bytes(), old.gpu_bytes()), (9852, 7200));
        assert_eq!((work.instances, work.vertices, work.indices), (6, 121, 300));
        assert_eq!(
            (
                work.materials.retained_bytes,
                work.materials.mip_bytes,
                work.materials.scratch_bytes
            ),
            (rgba, mips, 8_388_608)
        );
        assert_eq!(work.materials.encoded_bytes, encoded);
        assert_eq!(
            work.attribute_copies,
            if name == "rgb8-base-color" {
                2420
            } else {
                4356
            }
        );
        assert_eq!(work.expanded_attributes, 10_800);
        assert_eq!((work.prepared_bytes(), work.gpu_bytes()), (prepared, gpu));
    }
    #[test]
    fn rgb8_three_maps() {
        positive("rgb8-three-maps", 218, 48, 60, 8_413_882, 18_060);
    }
    #[test]
    fn rgb8_max_dimension() {
        positive(
            "rgb8-max-dimension",
            17_026,
            12_582_912,
            16_777_212,
            21_013_554,
            16_795_212,
        );
    }
    #[test]
    fn rgb8_four_maps() {
        positive(
            "rgb8-four-maps",
            23_128,
            16_777_216,
            22_369_616,
            25_213_960,
            22_387_616,
        );
    }
    #[test]
    fn rgb8_adam7_narrow() {
        positive("rgb8-adam7-narrow", 216, 84, 132, 8_413_916, 18_132);
    }
    #[test]
    fn rgb8_adam7_odd() {
        positive("rgb8-adam7-odd", 265, 180, 216, 8_414_061, 18_216);
    }
    #[test]
    fn rgb8_shared_roles() {
        positive("rgb8-shared-roles", 73, 16, 40, 8_413_705, 18_040);
    }
    #[test]
    fn rgb8_duplicate_images() {
        positive("rgb8-duplicate-images", 73, 16, 40, 8_413_705, 18_040);
    }
    #[test]
    fn rgb8_npot_mips() {
        positive("rgb8-npot-mips", 255, 180, 216, 8_414_051, 18_216);
    }
    #[test]
    fn rgb8_base_color() {
        positive("rgb8-base-color", 73, 16, 20, 8_411_769, 18_020);
    }
}

#[cfg(test)]
mod material_regression {
    use super::*;
    use serde_json::json;

    fn generated(name: &str) -> (Value, Vec<u8>, usize) {
        let scope = json!({"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003"});
        let id = "00000000-0000-4000-8000-000000000006".to_owned();
        let (bytes, _, _) = if name == "legacy" {
            fixture::generate(scope, id)
        } else {
            material_fixture::generate(scope, id, name)
        };
        let json_end = 20 + u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        let gltf = serde_json::from_slice(&bytes[20..json_end]).unwrap();
        (gltf, bytes, json_end)
    }
    fn admit(
        gltf: &Value,
        bytes: &[u8],
        end: usize,
    ) -> Result<super::super::atlas_scene_material::Materials, String> {
        super::super::atlas_scene_material::materials(gltf, bytes, end)
    }
    fn primitive(gltf: &Value, bytes: &[u8], end: usize) -> Result<(), String> {
        let mut work = Work::new(admit(gltf, bytes, end)?, OVERVIEW);
        positions(
            gltf,
            bytes,
            end,
            &gltf["meshes"][0]["primitives"][0],
            &IDENTITY,
            &mut work,
            |_| true,
        )
        .map(|_| ())
    }
    fn replace_attribute(gltf: &Value, bytes: &mut [u8], end: usize, key: &str, values: &[f32]) {
        let index = gltf["meshes"][0]["primitives"][0]["attributes"][key]
            .as_u64()
            .unwrap() as usize;
        let accessor = &gltf["accessors"][index];
        let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().unwrap() as usize];
        let start = end
            + 8
            + view["byteOffset"].as_u64().unwrap_or(0) as usize
            + accessor["byteOffset"].as_u64().unwrap_or(0) as usize;
        let stride = view["byteStride"]
            .as_u64()
            .map_or(values.len() * 4, |n| n as usize);
        for i in 0..accessor["count"].as_u64().unwrap() as usize {
            for (axis, value) in values.iter().enumerate() {
                let at = start + i * stride + axis * 4;
                bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
            }
        }
    }
    #[test]
    fn textured_requires_normal() {
        let (mut gltf, bytes, end) = generated("rgb8-base-color");
        assert!(primitive(&gltf, &bytes, end).is_ok());
        gltf["meshes"][0]["primitives"][0]["attributes"]
            .as_object_mut()
            .unwrap()
            .remove("NORMAL");
        assert!(primitive(&gltf, &bytes, end).is_err());
    }
    #[test]
    fn textured_rejects_zero_normal() {
        let (gltf, mut bytes, end) = generated("rgb8-base-color");
        assert!(primitive(&gltf, &bytes, end).is_ok());
        replace_attribute(&gltf, &mut bytes, end, "NORMAL", &[0., 0., 0.]);
        assert!(primitive(&gltf, &bytes, end).is_err());
    }
    #[test]
    fn normal_map_rejects_parallel_tangent() {
        let (gltf, mut bytes, end) = generated("rgb8-three-maps");
        assert!(primitive(&gltf, &bytes, end).is_ok());
        replace_attribute(&gltf, &mut bytes, end, "TANGENT", &[0., 1., 0., 1.]);
        assert!(primitive(&gltf, &bytes, end).is_err());
    }
    #[test]
    fn texture_requires_sampler() {
        let (mut gltf, bytes, end) = generated("rgb8-three-maps");
        assert!(admit(&gltf, &bytes, end).is_ok());
        gltf["textures"][0]
            .as_object_mut()
            .unwrap()
            .remove("sampler");
        assert!(admit(&gltf, &bytes, end).is_err());
    }
    #[test]
    fn sampler_requires_mag_filter() {
        let (mut gltf, bytes, end) = generated("rgb8-three-maps");
        assert!(admit(&gltf, &bytes, end).is_ok());
        gltf["samplers"][0]
            .as_object_mut()
            .unwrap()
            .remove("magFilter");
        assert!(admit(&gltf, &bytes, end).is_err());
    }
    #[test]
    fn sampler_requires_min_filter() {
        let (mut gltf, bytes, end) = generated("rgb8-three-maps");
        assert!(admit(&gltf, &bytes, end).is_ok());
        gltf["samplers"][0]
            .as_object_mut()
            .unwrap()
            .remove("minFilter");
        assert!(admit(&gltf, &bytes, end).is_err());
    }
    #[test]
    fn legacy_blend_and_zero_source_normals_remain_admitted() {
        let (mut gltf, mut bytes, end) = generated("legacy");
        gltf["materials"][0]["alphaMode"] = json!("BLEND");
        gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"][3] = json!(0.13);
        replace_attribute(&gltf, &mut bytes, end, "NORMAL", &[0., 0., 0.]);
        assert!(primitive(&gltf, &bytes, end).is_ok());
    }
}

// The optional detail GLB is checked against the same companion as the
// overview, under its own larger budget.
#[cfg(test)]
mod detail_tier {
    use super::*;
    use crate::config::{
        atlas_scene::ServerAtlasSceneSelection, model_overview::ServerModelOverviewSelection,
    };
    use serde_json::json;
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

    struct Publication {
        _temporary: tempfile::TempDir,
        root: PathBuf,
        manifest: String,
        scene: String,
    }
    /// A publication folder with the generated overview, its companion and
    /// `detail` as detail.glb, declared under the name `file`.
    fn folder(detail: Option<&[u8]>, file: &str) -> Publication {
        let scope = json!({"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003"});
        let (glb, manifest, scene) =
            fixture::generate(scope, "00000000-0000-4000-8000-000000000006".into());
        let mut manifest: Value = serde_json::from_slice(&manifest).unwrap();
        if let Some(detail) = detail {
            manifest["detail"] = json!({"file":file,"contentType":"model/gltf-binary","sha256":fixture::sha(detail),"bytes":detail.len()});
        }
        let manifest = serde_json::to_vec(&manifest).unwrap();
        let temporary = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let mut files = vec![
            ("overview.glb", glb.as_slice()),
            ("publication.json", manifest.as_slice()),
            ("atlas-scene.json", scene.as_slice()),
        ];
        if let Some(detail) = detail {
            files.push(("detail.glb", detail));
        }
        for (name, bytes) in files {
            fs::write(root.join(name), bytes).unwrap();
            fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o600)).unwrap();
        }
        Publication {
            _temporary: temporary,
            root,
            manifest: fixture::sha(&manifest),
            scene: fixture::sha(&scene),
        }
    }
    impl Publication {
        fn select(&self) -> Result<ServerModelOverviewSelection, String> {
            ServerModelOverviewSelection::read_pinned(
                &self.root.join("publication.json"),
                &self.manifest,
            )
        }
        fn scene(&self, overview: &ServerModelOverviewSelection) -> Result<(), String> {
            ServerAtlasSceneSelection::read_pinned(
                &self.root.join("atlas-scene.json"),
                &self.scene,
                overview,
            )
            .map(|_| ())
        }
    }
    fn generated() -> Vec<u8> {
        let scope = json!({"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003"});
        fixture::generate(scope, "00000000-0000-4000-8000-000000000006".into()).0
    }
    /// The generated GLB with the first position's X set to `x`.
    fn moved(x: f32) -> Vec<u8> {
        let mut glb = generated();
        let bin = 28 + u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        glb[bin..bin + 4].copy_from_slice(&x.to_le_bytes());
        glb
    }

    /// The generated GLB as a different file with the same slots and geometry.
    fn relabelled() -> Vec<u8> {
        let glb = generated();
        let at = glb.windows(13).position(|w| w == b"scene fixture").unwrap();
        [&glb[..at], b"scene detail ", &glb[at + 13..]].concat()
    }

    #[test]
    fn detail_is_selected_validated_and_read() {
        let detail = relabelled();
        let publication = folder(Some(&detail), "detail.glb");
        let overview = publication.select().unwrap();
        publication.scene(&overview).unwrap();
        assert_eq!(overview.read_detail().unwrap().unwrap(), detail);
        assert_ne!(overview.read_original().unwrap(), detail);
    }
    #[test]
    fn without_detail_nothing_changes() {
        let publication = folder(None, "detail.glb");
        let overview = publication.select().unwrap();
        publication.scene(&overview).unwrap();
        assert!(overview.read_detail().unwrap().is_none());
    }
    #[test]
    fn detail_outside_the_companion_bounds_is_refused() {
        let publication = folder(Some(&moved(100.)), "detail.glb");
        let overview = publication.select().unwrap();
        assert!(publication.scene(&overview).is_err());
    }
    #[test]
    fn detail_must_be_detail_glb() {
        let detail = relabelled();
        let publication = folder(Some(&detail), "overview.glb");
        assert!(publication.select().is_err());
    }
    #[test]
    fn changed_detail_conflicts_the_whole_selection() {
        let detail = relabelled();
        let publication = folder(Some(&detail), "detail.glb");
        let overview = publication.select().unwrap();
        fs::write(publication.root.join("detail.glb"), generated()).unwrap();
        assert!(overview.read_detail().is_err());
        assert!(overview.read_original().is_err());
    }
    #[test]
    fn detail_budget_admits_what_the_overview_refuses() {
        let triangles = 700_000;
        let mut overview = Work::new(Default::default(), OVERVIEW);
        assert!(overview.primitive(triangles, triangles * 3, 0, 0).is_err());
        let mut detail = Work::new(Default::default(), DETAIL);
        assert!(detail.primitive(triangles, triangles * 3, 0, 0).is_ok());
        assert!(
            detail
                .primitive(DETAIL.vertices, DETAIL.triangles * 3, 0, 0)
                .is_err()
        );
    }
}
