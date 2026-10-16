//! Anonymous generated source geometry; no IFC/native binding is invented.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
pub fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn generate(scope: Value, publication_id: String) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let positions: [f32; 24] = [
        0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0., 1.,
        1.,
    ];
    let indices: [u16; 36] = [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 5,
    ];
    let mut binary = Vec::new();
    for p in positions {
        binary.extend(p.to_le_bytes());
    }
    for _ in 0..8 {
        for n in [0.0f32, 1.0, 0.0] {
            binary.extend(n.to_le_bytes());
        }
    }
    for i in indices {
        binary.extend(i.to_le_bytes());
    }
    let mut chunk=serde_json::to_vec(&json!({"asset":{"version":"2.0","generator":"HouseAtlas anonymous unified scene fixture"},"scene":0,"scenes":[{"nodes":[0,1,2,3,4]}],"nodes":[{"mesh":0},{"mesh":0,"translation":[2,0,0]},{"mesh":0,"translation":[0,2,0]},{"mesh":0,"scale":[1,3,1]},{"mesh":0,"translation":[1,0,0]}],"meshes":[{"primitives":[{"attributes":{"POSITION":0,"NORMAL":1},"indices":2,"material":0}]}],"materials":[{"doubleSided":true,"pbrMetallicRoughness":{"baseColorFactor":[0.65,0.75,0.85,1],"metallicFactor":0,"roughnessFactor":1}}],"buffers":[{"byteLength":binary.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":96},{"buffer":0,"byteOffset":96,"byteLength":96},{"buffer":0,"byteOffset":192,"byteLength":72}],"accessors":[{"bufferView":0,"componentType":5126,"count":8,"type":"VEC3","min":[0,0,0],"max":[1,1,1]},{"bufferView":1,"componentType":5126,"count":8,"type":"VEC3"},{"bufferView":2,"componentType":5123,"count":36,"type":"SCALAR"}]})).unwrap();
    while !chunk.len().is_multiple_of(4) {
        chunk.push(b' ');
    }
    let mut glb = Vec::new();
    glb.extend(b"glTF");
    glb.extend(2u32.to_le_bytes());
    glb.extend(((28 + chunk.len() + binary.len()) as u32).to_le_bytes());
    glb.extend((chunk.len() as u32).to_le_bytes());
    glb.extend(0x4e4f534au32.to_le_bytes());
    glb.extend(chunk);
    glb.extend((binary.len() as u32).to_le_bytes());
    glb.extend(0x004e4942u32.to_le_bytes());
    glb.extend(binary);
    let overview = json!({"profile":"houseatlas.model-overview-publication.v1","scope":scope,"publicationId":publication_id,"label":"Generated unified Atlas","qualification":"provisional-overview","frame":{"linearUnit":"m","upAxis":"Y","placement":"baked-in-asset","physicalRegistration":null},"components":[{"id":"building-main","kind":"building","label":"Generated building"}],"sourceNote":"Three generated source pick cubes; one explicitly estimated","original":{"file":"overview.glb","contentType":"model/gltf-binary","sha256":sha(&glb),"bytes":glb.len()}});
    let mut occurrences = Vec::new();
    let mut bindings = Vec::new();
    let mut plans = Vec::new();
    for (node, (oid, room, level, x, y, estimated)) in [
        ("hall-lower", "hall", "lower", 0, 0, false),
        ("estimated-lower", "estimated-room", "lower", 2, 0, true),
        ("hall-upper", "hall", "upper", 0, 2, false),
    ]
    .into_iter()
    .enumerate()
    {
        let feature = format!("plan-{oid}");
        occurrences.push(json!({"spaceOccurrenceId":oid,"roomId":room,"buildingId":"building-main","levelId":level,"bounds":{"min":[x,y,0],"max":[x+1,y+1,1]},"planFeatureIds":[feature],"geometryBasis":{"kind":if estimated{"owner-estimated-pick-proxy"}else{"source-model"},"sourceRef":if estimated{Some("generated-estimate-v1")}else{None},"note":if estimated{Some("Synthetic owner-authored pick cube, not measured dimensions")}else{None}}}));
        bindings.push(json!({"artifactId":"model","nodeIndex":node,"meshIndex":0,"primitiveIndices":[0],"buildingId":"building-main","levelIds":[level],"spaceOccurrenceId":oid,"role":"room-pick"}));
        let f = json!({"featureId":feature,"roomId":room,"spaceOccurrenceId":oid,"role":"room","polygons":[{"outer":[[x,0],[x+1,0],[x+1,1],[x,1]],"holes":[]}]});
        if level == "upper" {
            plans.push(json!({"planId":"plan-upper","buildingId":"building-main","levelId":"upper","coordinates":"scene-XZ-metres","featureIds":[feature],"features":[f]}));
        } else if plans.is_empty() {
            plans.push(json!({"planId":"plan-lower","buildingId":"building-main","levelId":"lower","coordinates":"scene-XZ-metres","featureIds":[feature],"features":[f]}));
        } else {
            plans[0]["featureIds"]
                .as_array_mut()
                .unwrap()
                .push(json!(feature));
            plans[0]["features"].as_array_mut().unwrap().push(f);
        }
    }
    bindings.push(json!({"artifactId":"model","nodeIndex":3,"meshIndex":0,"primitiveIndices":[0],"buildingId":"building-main","levelIds":["lower","upper"],"spaceOccurrenceId":null,"role":"structure"}));
    bindings.push(json!({"artifactId":"model","nodeIndex":4,"meshIndex":0,"primitiveIndices":[0],"buildingId":"building-main","levelIds":["lower"],"spaceOccurrenceId":null,"role":"slab"}));
    let companion = json!({"profile":"houseatlas.unified-atlas-publication.v1","scope":scope,"publicationId":publication_id,"sourceRevisionId":"generated-source-v1","sourceSha256":sha(b"Generated anonymous source recipe v1"),"original":{"sha256":sha(&glb),"bytes":glb.len()},"frame":{"units":"m","upAxis":"Y","horizontalAxes":["X","Z"],"geometryPlacement":"gltf-world-after-node-transforms-once","physicalRegistration":null},"buildings":[{"buildingId":"building-main","label":"Generated building","nativePlaceId":null,"bounds":{"min":[0,0,0],"max":[3,3,1]},"levelIds":["lower","upper"]}],"levels":[{"levelId":"lower","buildingId":"building-main","label":"Lower","nativePlaceId":null,"sourceElevationM":0,"elevationBasis":"generated source","occurrenceIds":["hall-lower","estimated-lower"],"bounds":{"min":[0,0,0],"max":[3,1,1]}},{"levelId":"upper","buildingId":"building-main","label":"Upper","nativePlaceId":null,"sourceElevationM":2,"elevationBasis":"generated source","occurrenceIds":["hall-upper"],"bounds":{"min":[0,2,0],"max":[1,3,1]}}],"rooms":[{"roomId":"hall","buildingId":"building-main","label":"Hall","nativePlaceId":null,"nativeBinding":{"status":"unmapped","receiptSha256":null},"occurrenceIds":["hall-lower","hall-upper"]},{"roomId":"estimated-room","buildingId":"building-main","label":"Estimated room","nativePlaceId":null,"nativeBinding":{"status":"unmapped","receiptSha256":null},"occurrenceIds":["estimated-lower"]}],"occurrences":occurrences,"meshBindings":bindings,"plans":plans,"overlayBindings":[{"publicationId":publication_id,"kind":"electrical","sourceRevision":"generated-documentary-v1","sourceUpdatedAt":null,"retrievedAt":null,"roomId":"hall","spaceOccurrenceId":null,"nativePlaceId":null,"recordIds":[],"anchor":{"kind":"room-summary"}}],"coverage":{"selectableOccurrences":["hall-lower","estimated-lower","hall-upper"],"unselectableOccurrences":[],"exclusions":[]}});
    (
        glb,
        serde_json::to_vec(&overview).unwrap(),
        serde_json::to_vec(&companion).unwrap(),
    )
}
