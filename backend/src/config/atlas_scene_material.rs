//! houseatlas.embedded-png-material.v1 (canonical contract SHA-256
//! f1a8c569ba64b27a98354d9efb86353abeda8cd3b28eeb150cf5b7b94fb9618c).
//! Unified Atlas's closed embedded RGB8 PNG profile. No URL resolution, media
//! admission, colour conversion or model activation happens here.
use super::atlas_scene::{invalid, need};
use super::atlas_scene_glb::{color_material, integer};
use flate2::{Decompress, FlushDecompress, Status};
use serde_json::Value;
use std::{collections::BTreeSet, io::Cursor};

const MIB: usize = 1024 * 1024;
const DECODE_SCRATCH: usize = 8 * MIB;
// Bounds only the identity scan below. How many textures fit is the tier's
// prepared and GPU budget (atlas_scene_glb.rs), which charges every image.
const MAX_IMAGES: usize = 64;
#[derive(Clone, Copy, Default)]
pub(super) struct Material {
    pub textured: bool,
    pub normal_map: bool,
}
#[derive(Default)]
pub(super) struct Materials {
    entries: Vec<Material>,
    pub retained_bytes: usize,
    pub encoded_bytes: usize,
    pub mip_bytes: usize,
    pub scratch_bytes: usize,
}
impl Materials {
    pub fn primitive(&self, primitive: &Value) -> Result<Material, String> {
        match primitive.get("material") {
            None => Ok(Material::default()),
            Some(_) => self
                .entries
                .get(integer(primitive, "material", None)?)
                .copied()
                .ok_or_else(invalid),
        }
    }
}
fn array<'a>(gltf: &'a Value, key: &str) -> Result<&'a [Value], String> {
    match gltf.get(key) {
        None => Ok(&[]),
        Some(v) => v.as_array().map(Vec::as_slice).ok_or_else(invalid),
    }
}
fn keys(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or_else(invalid)?;
    need(object.keys().all(|k| allowed.contains(&k.as_str())))
}
fn factor(value: Option<&Value>, width: usize) -> Result<(), String> {
    if let Some(v) = value {
        let a = v.as_array().ok_or_else(invalid)?;
        need(
            a.len() == width
                && a.iter().all(|v| {
                    v.as_f64()
                        .is_some_and(|n| n.is_finite() && (0. ..=1.).contains(&n))
                }),
        )?;
    }
    Ok(())
}
fn sampler(s: &Value) -> Result<(), String> {
    keys(
        s,
        &["name", "extras", "magFilter", "minFilter", "wrapS", "wrapT"],
    )?;
    need(integer(s, "magFilter", None)? == 9729 && integer(s, "minFilter", None)? == 9987)?;
    for key in ["wrapS", "wrapT"] {
        need(integer(s, key, Some(10497))? == 10497)?;
    }
    need(s.get("name").is_none_or(Value::is_string))
}
struct Image<'a> {
    bytes: &'a [u8],
    canonical: usize,
    mips: usize,
}
pub(super) fn materials(gltf: &Value, glb: &[u8], json_end: usize) -> Result<Materials, String> {
    let images = array(gltf, "images")?;
    let textures = array(gltf, "textures")?;
    let samplers = array(gltf, "samplers")?;
    let materials = array(gltf, "materials")?;
    need(
        images.len() <= MAX_IMAGES
            && textures.len() <= 8192
            && samplers.len() <= 8192
            && materials.len() <= 8192,
    )?;
    let mut encoded_reservation = 0usize;
    let mut retained_rgba = 0usize;
    let mut decoded: Vec<Image<'_>> = Vec::new();
    for image in images {
        keys(image, &["name", "extras", "mimeType", "bufferView"])?;
        need(image["mimeType"] == "image/png" && image.get("name").is_none_or(Value::is_string))?;
        let view = gltf["bufferViews"]
            .get(integer(image, "bufferView", None)?)
            .ok_or_else(invalid)?;
        need(
            view["buffer"] == 0 && view.get("byteStride").is_none() && view.get("target").is_none(),
        )?;
        let offset = integer(view, "byteOffset", Some(0))?;
        let length = integer(view, "byteLength", None)?;
        need(length > 0 && length <= 2 * MIB)?;
        need(offset.checked_add(length).is_some_and(|end| {
            integer(&gltf["buffers"][0], "byteLength", None).is_ok_and(|n| end <= n)
        }))?;
        let start = json_end
            .checked_add(8)
            .and_then(|n| n.checked_add(offset))
            .ok_or_else(invalid)?;
        let end = start.checked_add(length).ok_or_else(invalid)?;
        let bytes = glb.get(start..end).ok_or_else(invalid)?;
        let (width, height) = png(bytes)?;
        let rgba = width * height * 4;
        let (mut w, mut h, mut mips) = (width, height, 0);
        loop {
            mips += w * h * 4;
            if w == 1 && h == 1 {
                break;
            }
            w = (w / 2).max(1);
            h = (h / 2).max(1);
        }
        // Exact byte comparisons (length first) intern the image identities;
        // material references then use small keys rather than repeated PNG scans.
        let canonical = decoded
            .iter()
            .position(|image| image.bytes == bytes)
            .unwrap_or(decoded.len());
        // Decoded pixels and retained encoded input belong to the image, not
        // its GPU colour role. The same bytes can back sRGB and data textures.
        if canonical == decoded.len() {
            encoded_reservation += length;
            retained_rgba += rgba;
        }
        decoded.push(Image {
            bytes,
            canonical,
            mips,
        });
    }
    for s in samplers {
        sampler(s)?;
    }
    let mut image_refs = BTreeSet::new();
    let mut sampler_refs = BTreeSet::new();
    let mut sources = Vec::new();
    for texture in textures {
        keys(texture, &["name", "extras", "source", "sampler"])?;
        need(texture.get("name").is_none_or(Value::is_string))?;
        let source = integer(texture, "source", None)?;
        need(source < images.len())?;
        image_refs.insert(source);
        let index = integer(texture, "sampler", None)?;
        need(index < samplers.len())?;
        sampler_refs.insert(index);
        sources.push(source);
    }
    let mut result = Materials {
        retained_bytes: retained_rgba,
        encoded_bytes: encoded_reservation,
        ..Materials::default()
    };
    let mut texture_refs = BTreeSet::new();
    let mut resources = BTreeSet::new();
    for material in materials {
        let pbr = material.get("pbrMetallicRoughness");
        let slots = [
            pbr.and_then(|p| p.get("baseColorTexture")),
            material.get("normalTexture"),
            pbr.and_then(|p| p.get("metallicRoughnessTexture")),
        ];
        let textured = slots.iter().any(Option::is_some);
        if !textured {
            color_material(material)?;
        } else {
            keys(
                material,
                &[
                    "name",
                    "extras",
                    "pbrMetallicRoughness",
                    "normalTexture",
                    "alphaMode",
                    "doubleSided",
                ],
            )?;
            need(
                material.get("alphaMode").is_none_or(|v| v == "OPAQUE")
                    && material.get("doubleSided").is_none_or(Value::is_boolean)
                    && material.get("name").is_none_or(Value::is_string),
            )?;
            if let Some(pbr) = pbr {
                keys(
                    pbr,
                    &[
                        "baseColorFactor",
                        "metallicFactor",
                        "roughnessFactor",
                        "baseColorTexture",
                        "metallicRoughnessTexture",
                        "extras",
                    ],
                )?;
                factor(pbr.get("baseColorFactor"), 4)?;
                need(
                    pbr.get("baseColorFactor")
                        .is_none_or(|v| v[3].as_f64() == Some(1.)),
                )?;
                for key in ["metallicFactor", "roughnessFactor"] {
                    if let Some(v) = pbr.get(key) {
                        need(
                            v.as_f64()
                                .is_some_and(|n| n.is_finite() && (0. ..=1.).contains(&n)),
                        )?;
                    }
                }
            }
        }
        for (role, slot) in slots.into_iter().enumerate() {
            let Some(slot) = slot else {
                continue;
            };
            keys(
                slot,
                if role == 1 {
                    &["index", "texCoord", "scale", "extras"]
                } else {
                    &["index", "texCoord", "extras"]
                },
            )?;
            need(integer(slot, "texCoord", Some(0))? == 0)?;
            if role == 1 {
                need(slot.get("scale").is_none_or(|v| v.as_f64() == Some(1.)))?;
            }
            let texture = integer(slot, "index", None)?;
            let image = decoded
                .get(*sources.get(texture).ok_or_else(invalid)?)
                .ok_or_else(invalid)?;
            texture_refs.insert(texture);
            // Only one admitted sampler state. Normal and MR are both data;
            // base colour is a distinct sRGB resource even with identical bytes.
            if resources.insert((image.canonical, role == 0)) {
                result.mip_bytes += image.mips;
            }
        }
        result.entries.push(Material {
            textured,
            normal_map: material.get("normalTexture").is_some(),
        });
    }
    need(
        image_refs.len() == images.len()
            && sampler_refs.len() == samplers.len()
            && texture_refs.len() == textures.len(),
    )?;
    if !images.is_empty() {
        // Conservative workspace reservation once per owner. This maximum is
        // deliberately not a measurement of the frontend's dimension-derived
        // peak; both must remain within the frozen 8 MiB scratch ceiling.
        result.scratch_bytes = DECODE_SCRATCH;
    }
    Ok(result)
}

fn word(bytes: &[u8]) -> Result<usize, String> {
    Ok(u32::from_be_bytes(bytes.try_into().map_err(|_| invalid())?) as usize)
}
fn png(bytes: &[u8]) -> Result<(usize, usize), String> {
    need(bytes.starts_with(b"\x89PNG\r\n\x1a\n"))?;
    let mut at = 8usize;
    let mut header = None;
    let mut idat = Vec::new();
    let (mut seen_data, mut ended_data, mut palette, mut end) = (false, false, false, false);
    while at < bytes.len() {
        let length = word(bytes.get(at..at + 4).ok_or_else(invalid)?)?;
        let chunk_end = at
            .checked_add(12)
            .and_then(|n| n.checked_add(length))
            .ok_or_else(invalid)?;
        let chunk = bytes.get(at + 4..chunk_end).ok_or_else(invalid)?;
        let kind = &chunk[..4];
        let data = &chunk[4..4 + length];
        need(
            kind.iter().all(u8::is_ascii_alphabetic)
                && kind[2].is_ascii_uppercase()
                && crc32fast::hash(&chunk[..4 + length]) == word(&chunk[4 + length..])? as u32,
        )?;
        if kind != b"IHDR" {
            need(header.is_some())?;
        }
        if kind != b"IDAT" && seen_data {
            ended_data = true;
        }
        match kind {
            b"IHDR" => {
                need(at == 8 && header.is_none() && length == 13)?;
                let width = word(&data[..4])?;
                let height = word(&data[4..8])?;
                need(
                    (1..=1024).contains(&width)
                        && (1..=1024).contains(&height)
                        && width * height <= 1_048_576
                        && data[8..12] == [8, 2, 0, 0]
                        && data[12] <= 1,
                )?;
                header = Some((width, height, data[12]));
            }
            b"PLTE" => {
                need(
                    !palette
                        && !seen_data
                        && length > 0
                        && length <= 768
                        && length.is_multiple_of(3),
                )?;
                palette = true;
            }
            b"IDAT" => {
                need(!ended_data)?;
                seen_data = true;
                idat.extend_from_slice(data);
            }
            b"IEND" => {
                need(length == 0 && !idat.is_empty() && chunk_end == bytes.len())?;
                end = true;
            }
            b"acTL" | b"fcTL" | b"fdAT" | b"tRNS" => return Err(invalid()),
            _ => need(kind[0].is_ascii_lowercase())?,
        }
        at = chunk_end;
    }
    need(end)?;
    let (width, height, interlace) = header.ok_or_else(invalid)?;
    // Prove exact zlib completion, checksum, packed raster size and legal filter
    // bytes, including all Adam7 passes. Reader::finish alone discards leftovers.
    let layout: &[(usize, usize, usize, usize)] = if interlace == 0 {
        &[(0, 0, 1, 1)]
    } else {
        &[
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    };
    let rows: Vec<_> = layout
        .iter()
        .filter_map(|&(x, y, dx, dy)| {
            let w = width.saturating_sub(x).div_ceil(dx);
            let h = height.saturating_sub(y).div_ceil(dy);
            (w > 0 && h > 0).then_some((w * 3 + 1, h))
        })
        .collect();
    let expected: usize = rows.iter().map(|(row, h)| row * h).sum();
    {
        let mut raster = vec![0; expected + 1];
        let mut decoder = Decompress::new(true);
        need(
            decoder
                .decompress(&idat, &mut raster, FlushDecompress::Finish)
                .map_err(|_| invalid())?
                == Status::StreamEnd
                && decoder.total_in() as usize == idat.len()
                && decoder.total_out() as usize == expected,
        )?;
        let mut offset = 0;
        for (row, h) in rows {
            for _ in 0..h {
                need(raster[offset] <= 4)?;
                offset += row;
            }
        }
    }
    drop(idat);
    let output_size = width * height * 3;
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: DECODE_SCRATCH - output_size,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_transformations(png::Transformations::IDENTITY);
    decoder.ignore_checksums(false);
    let mut reader = decoder.read_info().map_err(|_| invalid())?;
    need(reader.output_buffer_size() == Some(output_size))?;
    let mut rgb = vec![0; output_size];
    let frame = reader.next_frame(&mut rgb).map_err(|_| invalid())?;
    need(
        frame.width as usize == width
            && frame.height as usize == height
            && frame.color_type == png::ColorType::Rgb
            && frame.bit_depth == png::BitDepth::Eight
            && frame.buffer_size() == output_size,
    )?;
    reader.finish().map_err(|_| invalid())?;
    Ok((width, height))
}
