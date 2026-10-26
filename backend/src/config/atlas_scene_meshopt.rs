//! Transfer compression for publication GLBs: `EXT_meshopt_compression`,
//! expanded to the plain static profile before any other check reads the file,
//! so every budget and bounds check sees the decoded geometry. Pins and
//! digests stay on the served bytes. The admitted subset matches the viewer
//! (frontend/src/lantern/canonical-ifc/glb-meshopt.ts) and tools/model-bake:
//! one GLB buffer, one fallback buffer every compressed view decodes into,
//! `ATTRIBUTES` views of 4-, 8-, 12- or 16-byte vertices and `TRIANGLES`
//! views of 2- or 4-byte indices, without filters.
use super::atlas_scene::{invalid, need};
use super::atlas_scene_glb::integer;
use serde_json::{Map, Value, json};

pub(super) const MESHOPT: &str = "EXT_meshopt_compression";

fn only(value: &Value, keys: &[&str]) -> Result<(), String> {
    let row = value.as_object().ok_or_else(invalid)?;
    need(row.keys().all(|key| keys.contains(&key.as_str())))
}
fn pad(length: usize) -> usize {
    length.next_multiple_of(4)
}

enum Span {
    Plain(usize, usize),
    Compressed {
        source: (usize, usize),
        count: usize,
        stride: usize,
        triangles: bool,
    },
}

/// The plain GLB for a meshopt-compressed one, or `None` when nothing is
/// compressed. Refuses before decoding when the decoded views would exceed
/// `buffer_bytes`.
pub(super) fn expand(glb: &[u8], buffer_bytes: usize) -> Result<Option<Vec<u8>>, String> {
    let word = |at: usize| -> Result<usize, String> {
        Ok(u32::from_le_bytes(
            glb.get(at..at + 4)
                .ok_or_else(invalid)?
                .try_into()
                .map_err(|_| invalid())?,
        ) as usize)
    };
    let json_len = word(12)?;
    need(json_len <= 8 * 1024 * 1024 && word(16)? == 0x4e4f_534a)?;
    let mut gltf =
        crate::contracts::v2::parse_value(glb.get(20..20 + json_len).ok_or_else(invalid)?)
            .map_err(|_| invalid())?;
    let declares = |key: &str| {
        gltf.get(key)
            .and_then(Value::as_array)
            .is_some_and(|names| names.iter().any(|name| name == MESHOPT))
    };
    if !declares("extensionsUsed") {
        return Ok(None);
    }
    need(
        gltf["extensionsUsed"] == json!([MESHOPT])
            && gltf["extensionsRequired"] == json!([MESHOPT]),
    )?;
    let bin_at = 20 + json_len;
    need(word(bin_at + 4)? == 0x004e_4942 && bin_at + 8 + word(bin_at)? == glb.len())?;
    let bin = &glb[bin_at + 8..];
    let buffers = gltf["buffers"].as_array().ok_or_else(invalid)?;
    need(buffers.len() == 2)?;
    only(&buffers[0], &["byteLength"])?;
    only(&buffers[1], &["byteLength", "extensions"])?;
    only(&buffers[1]["extensions"], &[MESHOPT])?;
    need(buffers[1]["extensions"][MESHOPT] == json!({"fallback": true}))?;
    let bin_len = integer(&buffers[0], "byteLength", None)?;
    let fallback_len = integer(&buffers[1], "byteLength", None)?;
    need(bin_len > 0 && bin_len <= bin.len() && fallback_len > 0)?;
    let views = gltf["bufferViews"].as_array().ok_or_else(invalid)?;
    let mut decoded = 0usize;
    let mut spans = Vec::with_capacity(views.len());
    for view in views {
        let offset = integer(view, "byteOffset", Some(0))?;
        let length = integer(view, "byteLength", None)?;
        decoded = decoded.checked_add(length).ok_or_else(invalid)?;
        need(length > 0 && decoded <= buffer_bytes)?;
        let end = offset.checked_add(length).ok_or_else(invalid)?;
        if view["buffer"] == 0 {
            need(view.get("extensions").is_none() && end <= bin_len)?;
            spans.push(Span::Plain(offset, length));
            continue;
        }
        need(view["buffer"] == 1 && end <= fallback_len)?;
        only(&view["extensions"], &[MESHOPT])?;
        let extension = &view["extensions"][MESHOPT];
        only(
            extension,
            &[
                "buffer",
                "byteOffset",
                "byteLength",
                "byteStride",
                "count",
                "mode",
                "filter",
            ],
        )?;
        let source = integer(extension, "byteOffset", Some(0))?;
        let source_len = integer(extension, "byteLength", None)?;
        let count = integer(extension, "count", None)?;
        let stride = integer(extension, "byteStride", None)?;
        need(
            extension["buffer"] == 0
                && source_len > 0
                && source
                    .checked_add(source_len)
                    .is_some_and(|end| end <= bin_len)
                && extension
                    .get("filter")
                    .is_none_or(|filter| filter == "NONE")
                && count.checked_mul(stride) == Some(length),
        )?;
        let triangles = match extension["mode"].as_str() {
            Some("ATTRIBUTES") => {
                need(
                    [4, 8, 12, 16].contains(&stride)
                        && view.get("byteStride").and_then(Value::as_u64) == Some(stride as u64),
                )?;
                false
            }
            Some("TRIANGLES") => {
                need(
                    (stride == 2 || stride == 4)
                        && count.is_multiple_of(3)
                        && view.get("byteStride").is_none(),
                )?;
                true
            }
            _ => return Err(invalid()),
        };
        spans.push(Span::Compressed {
            source: (source, source_len),
            count,
            stride,
            triangles,
        });
    }
    let mut out = Vec::with_capacity(spans.iter().map(span_len).map(pad).sum());
    let mut placed = Vec::with_capacity(spans.len());
    for span in &spans {
        placed.push(out.len());
        match *span {
            Span::Plain(offset, length) => out.extend_from_slice(&bin[offset..offset + length]),
            Span::Compressed {
                source: (offset, length),
                count,
                stride,
                triangles,
            } => out.extend(decode(
                &bin[offset..offset + length],
                count,
                stride,
                triangles,
            )?),
        }
        out.resize(pad(out.len()), 0);
    }
    let views = gltf["bufferViews"].as_array_mut().ok_or_else(invalid)?;
    for (view, offset) in views.iter_mut().zip(placed) {
        let row = view.as_object_mut().ok_or_else(invalid)?;
        row.remove("extensions");
        row.insert("buffer".into(), json!(0));
        row.insert("byteOffset".into(), json!(offset));
    }
    let row: &mut Map<String, Value> = gltf.as_object_mut().ok_or_else(invalid)?;
    row.remove("extensionsUsed");
    row.remove("extensionsRequired");
    row.insert("buffers".into(), json!([{"byteLength": out.len()}]));
    let mut text = serde_json::to_vec(&gltf).map_err(|_| invalid())?;
    text.resize(pad(text.len()), b' ');
    let total = 28 + text.len() + out.len();
    let mut plain = Vec::with_capacity(total);
    for value in [0x4654_6c67, 2, total, text.len(), 0x4e4f_534a] {
        plain.extend_from_slice(&u32::try_from(value).map_err(|_| invalid())?.to_le_bytes());
    }
    plain.extend_from_slice(&text);
    plain.extend_from_slice(
        &u32::try_from(out.len())
            .map_err(|_| invalid())?
            .to_le_bytes(),
    );
    plain.extend_from_slice(&0x004e_4942u32.to_le_bytes());
    plain.extend_from_slice(&out);
    Ok(Some(plain))
}

fn span_len(span: &Span) -> usize {
    match *span {
        Span::Plain(_, length) => length,
        Span::Compressed { count, stride, .. } => count * stride,
    }
}

/// One stream decoded to its raw little-endian bytes. The decoder accepts
/// untrusted input; a malformed stream is an error.
fn decode(encoded: &[u8], count: usize, stride: usize, triangles: bool) -> Result<Vec<u8>, String> {
    use meshopt::encoding::{decode_index_buffer, decode_vertex_buffer};
    fn bytes<const N: usize>(words: Vec<[u32; N]>) -> Vec<u8> {
        words
            .into_iter()
            .flatten()
            .flat_map(u32::to_ne_bytes)
            .collect()
    }
    let decoded = match (triangles, stride) {
        (true, 2) => decode_index_buffer::<u16>(encoded, count)
            .map(|v| v.into_iter().flat_map(u16::to_ne_bytes).collect()),
        (true, _) => decode_index_buffer::<u32>(encoded, count)
            .map(|v| v.into_iter().flat_map(u32::to_ne_bytes).collect()),
        (false, 4) => decode_vertex_buffer::<[u32; 1]>(encoded, count).map(bytes),
        (false, 8) => decode_vertex_buffer::<[u32; 2]>(encoded, count).map(bytes),
        (false, 12) => decode_vertex_buffer::<[u32; 3]>(encoded, count).map(bytes),
        (false, _) => decode_vertex_buffer::<[u32; 4]>(encoded, count).map(bytes),
    };
    decoded.map_err(|_| invalid())
}

#[cfg(test)]
pub(super) mod compress {
    //! The bake's encoding, reproduced for generated test files: every vertex
    //! view in ATTRIBUTES mode and every index view in TRIANGLES mode.
    use super::*;
    use meshopt::encoding::{encode_index_buffer, encode_vertex_buffer};

    pub(in crate::config) fn compress(glb: &[u8]) -> Vec<u8> {
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let mut gltf: Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        let bin = &glb[28 + json_len..];
        let index_views: Vec<u64> = gltf["meshes"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|m| m["primitives"].as_array().unwrap().iter())
            .filter_map(|p| p["indices"].as_u64())
            .map(|a| {
                gltf["accessors"][a as usize]["bufferView"]
                    .as_u64()
                    .unwrap()
            })
            .collect();
        let accessor_of = |view: usize| {
            gltf["accessors"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["bufferView"] == view)
                .cloned()
        };
        let (mut out, mut fallback) = (Vec::new(), 0usize);
        let mut views = Vec::new();
        for (at, view) in gltf["bufferViews"].as_array().unwrap().iter().enumerate() {
            let offset = view["byteOffset"].as_u64().unwrap_or(0) as usize;
            let length = view["byteLength"].as_u64().unwrap() as usize;
            let data = &bin[offset..offset + length];
            let accessor = accessor_of(at);
            let mut row = view.clone();
            let encoded = accessor
                .filter(|_| view.get("byteStride").is_none())
                .and_then(|a| {
                    let count = a["count"].as_u64().unwrap() as usize;
                    let width = match a["type"].as_str().unwrap() {
                        "SCALAR" => 1,
                        "VEC2" => 2,
                        "VEC3" => 3,
                        _ => 4,
                    };
                    if index_views.contains(&(at as u64)) {
                        let size = if a["componentType"] == 5123 { 2 } else { 4 };
                        let indices: Vec<u32> = data
                            .chunks(size)
                            .map(|c| {
                                if size == 2 {
                                    u16::from_le_bytes([c[0], c[1]]) as u32
                                } else {
                                    u32::from_le_bytes(c.try_into().unwrap())
                                }
                            })
                            .collect();
                        let vertices = indices.iter().max().map_or(0, |m| *m as usize + 1);
                        Some((
                            encode_index_buffer(&indices, vertices).unwrap(),
                            count,
                            size,
                            "TRIANGLES",
                        ))
                    } else if a["componentType"] == 5126 && length == count * width * 4 {
                        let words: Vec<u32> = data
                            .chunks(4)
                            .map(|c| u32::from_ne_bytes(c.try_into().unwrap()))
                            .collect();
                        let encoded = match width {
                            1 => encode_vertex_buffer(
                                &words.chunks(1).map(|c| [c[0]]).collect::<Vec<_>>(),
                            ),
                            2 => encode_vertex_buffer(
                                &words.chunks(2).map(|c| [c[0], c[1]]).collect::<Vec<_>>(),
                            ),
                            3 => encode_vertex_buffer(
                                &words
                                    .chunks(3)
                                    .map(|c| [c[0], c[1], c[2]])
                                    .collect::<Vec<_>>(),
                            ),
                            _ => encode_vertex_buffer(
                                &words
                                    .chunks(4)
                                    .map(|c| [c[0], c[1], c[2], c[3]])
                                    .collect::<Vec<_>>(),
                            ),
                        };
                        Some((encoded.unwrap(), count, width * 4, "ATTRIBUTES"))
                    } else {
                        None
                    }
                });
            match encoded {
                Some((encoded, count, stride, mode)) => {
                    row["buffer"] = json!(1);
                    row["byteOffset"] = json!(fallback);
                    if mode == "ATTRIBUTES" {
                        row["byteStride"] = json!(stride);
                    }
                    row["extensions"] = json!({MESHOPT: {"buffer": 0, "byteOffset": out.len(), "byteLength": encoded.len(), "byteStride": stride, "count": count, "mode": mode}});
                    fallback += pad(length);
                    out.extend_from_slice(&encoded);
                }
                None => {
                    row["byteOffset"] = json!(out.len());
                    out.extend_from_slice(data);
                }
            }
            out.resize(pad(out.len()), 0);
            views.push(row);
        }
        gltf["bufferViews"] = json!(views);
        gltf["buffers"] = json!([{"byteLength": out.len()}, {"byteLength": fallback, "extensions": {MESHOPT: {"fallback": true}}}]);
        gltf["extensionsUsed"] = json!([MESHOPT]);
        gltf["extensionsRequired"] = json!([MESHOPT]);
        let mut text = serde_json::to_vec(&gltf).unwrap();
        text.resize(pad(text.len()), b' ');
        let total = 28 + text.len() + out.len();
        let mut file = Vec::new();
        for value in [
            0x4654_6c67u32,
            2,
            total as u32,
            text.len() as u32,
            0x4e4f_534a,
        ] {
            file.extend_from_slice(&value.to_le_bytes());
        }
        file.extend_from_slice(&text);
        file.extend_from_slice(&(out.len() as u32).to_le_bytes());
        file.extend_from_slice(&0x004e_4942u32.to_le_bytes());
        file.extend_from_slice(&out);
        file
    }
}

#[cfg(test)]
mod healthy {
    use super::compress::compress;
    use super::*;
    use serde_json::json;

    fn generated() -> Vec<u8> {
        let scope = json!({"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003"});
        super::super::atlas_scene_glb::fixture::generate(
            scope,
            "00000000-0000-4000-8000-000000000006".into(),
        )
        .0
    }
    fn json_of(glb: &[u8]) -> Value {
        let len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        serde_json::from_slice(&glb[20..20 + len]).unwrap()
    }
    /// Rewrites a compressed GLB's JSON, keeping its BIN chunk.
    fn edited(glb: &[u8], change: impl FnOnce(&mut Value)) -> Vec<u8> {
        let len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let mut gltf = json_of(glb);
        change(&mut gltf);
        let mut text = serde_json::to_vec(&gltf).unwrap();
        text.resize(pad(text.len()), b' ');
        let bin = &glb[20 + len..];
        let mut out = Vec::new();
        for value in [
            0x4654_6c67u32,
            2,
            (20 + text.len() + bin.len()) as u32,
            text.len() as u32,
            0x4e4f_534a,
        ] {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out.extend_from_slice(&text);
        out.extend_from_slice(bin);
        out
    }
    fn first_compressed(gltf: &Value) -> usize {
        gltf["bufferViews"]
            .as_array()
            .unwrap()
            .iter()
            .position(|v| v.get("extensions").is_some())
            .unwrap()
    }

    #[test]
    fn plain_files_pass_through() {
        assert!(expand(&generated(), 32 << 20).unwrap().is_none());
    }
    #[test]
    fn expansion_restores_every_view() {
        let plain = generated();
        let compressed = compress(&plain);
        let expanded = expand(&compressed, 32 << 20).unwrap().unwrap();
        let (a, b) = (json_of(&plain), json_of(&expanded));
        assert!(b.get("extensionsUsed").is_none() && b["buffers"].as_array().unwrap().len() == 1);
        let bytes = |glb: &[u8], view: &Value| {
            let start = 28
                + u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize
                + view["byteOffset"].as_u64().unwrap_or(0) as usize;
            glb[start..start + view["byteLength"].as_u64().unwrap() as usize].to_vec()
        };
        // Each triangle with its corners rotated to start at the smallest index.
        let triangles = |data: &[u8], size: usize| {
            let indices: Vec<u32> = data
                .chunks(size)
                .map(|c| {
                    if size == 2 {
                        u16::from_le_bytes([c[0], c[1]]) as u32
                    } else {
                        u32::from_le_bytes(c.try_into().unwrap())
                    }
                })
                .collect();
            indices
                .chunks(3)
                .map(|t| {
                    (0..3)
                        .map(|r| [t[r], t[(r + 1) % 3], t[(r + 2) % 3]])
                        .min()
                        .unwrap()
                })
                .collect::<Vec<_>>()
        };
        for (at, (x, y)) in a["bufferViews"]
            .as_array()
            .unwrap()
            .iter()
            .zip(b["bufferViews"].as_array().unwrap())
            .enumerate()
        {
            let (left, right) = (bytes(&plain, x), bytes(&expanded, y));
            let index = a["meshes"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|m| m["primitives"].as_array().unwrap().iter())
                .filter_map(|p| p["indices"].as_u64())
                .map(|i| &a["accessors"][i as usize])
                .find(|accessor| accessor["bufferView"] == at);
            match index {
                // The index codec may rotate a triangle's corners, keeping its winding.
                Some(accessor) => {
                    let size = if accessor["componentType"] == 5123 {
                        2
                    } else {
                        4
                    };
                    assert_eq!(triangles(&left, size), triangles(&right, size));
                }
                None => assert_eq!(left, right),
            }
        }
    }
    #[test]
    fn malformed_streams_and_decoded_sizes_are_refused() {
        let compressed = compress(&generated());
        let at = first_compressed(&json_of(&compressed));
        let truncated = edited(&compressed, |g| {
            let n = g["bufferViews"][at]["extensions"][MESHOPT]["byteLength"]
                .as_u64()
                .unwrap();
            g["bufferViews"][at]["extensions"][MESHOPT]["byteLength"] = json!(n / 2);
        });
        assert!(expand(&truncated, 32 << 20).is_err());
        assert!(expand(&compressed, 64).is_err());
        let filtered = edited(&compressed, |g| {
            g["bufferViews"][at]["extensions"][MESHOPT]["filter"] = json!("OCTAHEDRAL")
        });
        assert!(expand(&filtered, 32 << 20).is_err());
        let optional = edited(&compressed, |g| {
            g.as_object_mut().unwrap().remove("extensionsRequired");
        });
        assert!(expand(&optional, 32 << 20).is_err());
        let plain_on_fallback = edited(&compressed, |g| {
            g["bufferViews"][at]
                .as_object_mut()
                .unwrap()
                .remove("extensions");
        });
        assert!(expand(&plain_on_fallback, 32 << 20).is_err());
    }
}
