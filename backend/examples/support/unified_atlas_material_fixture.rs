//! Named generated material positives layered over the unchanged geometry fixture.
use flate2::{Compression, write::ZlibEncoder};
use serde_json::{Value, json};
use std::io::Write;
fn png(width: usize, height: usize, interlaced: bool, pixel: [u8; 3]) -> Vec<u8> {
    let mut raster = Vec::new();
    let layout: &[(usize, usize, usize, usize)] = if interlaced {
        &[
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    } else {
        &[(0, 0, 1, 1)]
    };
    for &(x, y, dx, dy) in layout {
        if width <= x || height <= y {
            continue;
        }
        for _ in (y..height).step_by(dy) {
            raster.extend([0]); // One PNG filter byte before this row's RGB samples.
            for _ in (x..width).step_by(dx) {
                raster.extend(pixel);
            }
        }
    }
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&raster).unwrap();
    let compressed = encoder.finish().unwrap();
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = Vec::new();
    header.extend((width as u32).to_be_bytes());
    header.extend((height as u32).to_be_bytes());
    header.extend([8, 2, 0, 0, u8::from(interlaced)]);
    for (kind, data) in [
        (b"IHDR", header.as_slice()),
        (b"IDAT", compressed.as_slice()),
        (b"IEND", &[]),
    ] {
        bytes.extend((data.len() as u32).to_be_bytes());
        let start = bytes.len();
        bytes.extend(kind);
        bytes.extend(data);
        bytes.extend(crc32fast::hash(&bytes[start..]).to_be_bytes());
    }
    bytes
}
fn view(document: &mut Value, binary: &mut Vec<u8>, bytes: &[u8]) -> usize {
    while !binary.len().is_multiple_of(4) {
        binary.push(0);
    }
    let at = binary.len();
    binary.extend(bytes);
    let views = document["bufferViews"].as_array_mut().unwrap();
    let index = views.len();
    views.push(json!({"buffer":0,"byteOffset":at,"byteLength":bytes.len()}));
    index
}
fn attribute(
    document: &mut Value,
    binary: &mut Vec<u8>,
    count: usize,
    values: &[f32],
    kind: &str,
) -> usize {
    let bytes: Vec<_> = (0..count)
        .flat_map(|_| values.iter().flat_map(|v| v.to_le_bytes()))
        .collect();
    let view = view(document, binary, &bytes);
    let accessors = document["accessors"].as_array_mut().unwrap();
    let index = accessors.len();
    accessors.push(json!({"bufferView":view,"componentType":5126,"count":count,"type":kind}));
    index
}
pub fn generate(scope: Value, publication_id: String, name: &str) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let (original, overview, companion) = super::fixture::generate(scope, publication_id);
    let json_len = u32::from_le_bytes(original[12..16].try_into().unwrap()) as usize;
    let mut document: Value = serde_json::from_slice(&original[20..20 + json_len]).unwrap();
    let mut binary = original[28 + json_len..].to_vec();
    let (width, height, interlaced, shared, normal) = match name {
        "rgb8-three-maps" => (2, 2, false, false, true),
        "rgb8-max-dimension" => (1024, 1024, false, false, true),
        "rgb8-adam7-narrow" => (1, 7, true, false, true),
        "rgb8-adam7-odd" => (5, 3, true, false, true),
        "rgb8-shared-roles" => (2, 2, false, true, true),
        "rgb8-duplicate-images" => (2, 2, false, false, true),
        "rgb8-npot-mips" => (3, 5, false, false, true),
        "rgb8-base-color" => (2, 2, false, false, false),
        _ => panic!("Unknown named positive material fixture"),
    };
    // Geometry bytes, world poses, winding, support planes and all semantic
    // joins remain exact. Add matching UV/tangent streams to each source mesh.
    for mesh in 0..document["meshes"].as_array().unwrap().len() {
        let position = document["meshes"][mesh]["primitives"][0]["attributes"]["POSITION"]
            .as_u64()
            .unwrap() as usize;
        let count = document["accessors"][position]["count"].as_u64().unwrap() as usize;
        let uv = attribute(&mut document, &mut binary, count, &[0.25, 0.75], "VEC2");
        document["meshes"][mesh]["primitives"][0]["attributes"]["TEXCOORD_0"] = json!(uv);
        if normal {
            let tangent = attribute(
                &mut document,
                &mut binary,
                count,
                &[1., 0., 0., -1.],
                "VEC4",
            );
            document["meshes"][mesh]["primitives"][0]["attributes"]["TANGENT"] = json!(tangent);
        }
    }
    let pixels = if name == "rgb8-duplicate-images" {
        [[192, 64, 32]; 3]
    } else {
        [[192, 64, 32], [128, 128, 255], [0, 96, 224]]
    };
    let image_count = if shared || !normal { 1 } else { 3 };
    document["images"] = json!([]);
    document["textures"] = json!([]);
    document["samplers"] = json!([{"magFilter":9729,"minFilter":9987}]);
    for pixel in pixels.iter().take(image_count) {
        let bytes = png(width, height, interlaced, *pixel);
        let image_view = view(&mut document, &mut binary, &bytes);
        let index = document["images"].as_array().unwrap().len();
        document["images"]
            .as_array_mut()
            .unwrap()
            .push(json!({"bufferView":image_view,"mimeType":"image/png"}));
        document["textures"]
            .as_array_mut()
            .unwrap()
            .push(json!({"source":index,"sampler":0}));
    }
    document["materials"][0] = json!({"alphaMode":"OPAQUE","doubleSided":true,"pbrMetallicRoughness":{
        "baseColorFactor":[0.65,0.75,0.85,1],"metallicFactor":0.75,"roughnessFactor":0.5,"baseColorTexture":{"index":0,"texCoord":0}}});
    if normal {
        document["materials"][0]["normalTexture"] =
            json!({"index":if shared {0} else {1},"texCoord":0,"scale":1});
        document["materials"][0]["pbrMetallicRoughness"]["metallicRoughnessTexture"] =
            json!({"index":if shared {0} else {2},"texCoord":0});
    }
    document["buffers"][0]["byteLength"] = json!(binary.len());
    while !binary.len().is_multiple_of(4) {
        binary.push(0);
    }
    let mut chunk = serde_json::to_vec(&document).unwrap();
    while !chunk.len().is_multiple_of(4) {
        chunk.push(b' ');
    }
    let mut glb = b"glTF".to_vec();
    glb.extend(2u32.to_le_bytes());
    glb.extend(((28 + chunk.len() + binary.len()) as u32).to_le_bytes());
    glb.extend((chunk.len() as u32).to_le_bytes());
    glb.extend(0x4e4f534au32.to_le_bytes());
    glb.extend(chunk);
    glb.extend((binary.len() as u32).to_le_bytes());
    glb.extend(0x004e4942u32.to_le_bytes());
    glb.extend(binary);
    let mut overview: Value = serde_json::from_slice(&overview).unwrap();
    let mut companion: Value = serde_json::from_slice(&companion).unwrap();
    for value in [&mut overview, &mut companion] {
        value["original"]["sha256"] = json!(super::fixture::sha(&glb));
        value["original"]["bytes"] = json!(glb.len());
    }
    (
        glb,
        serde_json::to_vec(&overview).unwrap(),
        serde_json::to_vec(&companion).unwrap(),
    )
}
