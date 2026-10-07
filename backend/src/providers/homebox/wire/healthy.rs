//! Only inspected positive source-derived examples. No provider, fault or controls.
use super::*;
use crate::providers::homebox::read::{Attachment, NativeIntent, SourceScope, Timestamp, Uuid};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn healthy_fixture_schemas() {
    let swagger_bytes =
        include_bytes!("../../../../../contracts/stock-wire3/native/homebox.swagger.json");
    assert_eq!(
        format!("{:x}", Sha256::digest(swagger_bytes)),
        SWAGGER_SHA256
    );
    let mut swagger: Value = serde_json::from_slice(swagger_bytes).unwrap();
    fn translate(value: &mut Value) {
        match value {
            Value::Array(rows) => rows.iter_mut().for_each(translate),
            Value::Object(object) => {
                object.values_mut().for_each(translate);
                if object.remove("x-nullable") == Some(Value::Bool(true)) {
                    let schema = value.take();
                    *value = serde_json::json!({"anyOf": [schema, {"type": "null"}]});
                }
            }
            _ => (),
        }
    }
    translate(&mut swagger);
    for name in ["attachments", "fields"] {
        let property = &mut swagger["definitions"]["repo.EntityOut"]["properties"][name];
        let schema = property.take();
        *property = serde_json::json!({"anyOf": [schema, {"type": "null"}]});
    }
    let manifest: Value = serde_json::from_slice(include_bytes!("fixtures/manifest.json")).unwrap();
    let fixtures: &[(&str, &[u8])] = &[
        (
            "locations.page.json",
            include_bytes!("fixtures/locations.page.json"),
        ),
        (
            "items.page.json",
            include_bytes!("fixtures/items.page.json"),
        ),
        (
            "items-second.page.json",
            include_bytes!("fixtures/items-second.page.json"),
        ),
        (
            "empty.page.json",
            include_bytes!("fixtures/empty.page.json"),
        ),
        (
            "location.detail.json",
            include_bytes!("fixtures/location.detail.json"),
        ),
        (
            "item.detail.json",
            include_bytes!("fixtures/item.detail.json"),
        ),
        (
            "unknown.detail.json",
            include_bytes!("fixtures/unknown.detail.json"),
        ),
        (
            "maintenance.json",
            include_bytes!("fixtures/maintenance.json"),
        ),
        (
            "empty-maintenance.json",
            include_bytes!("fixtures/empty-maintenance.json"),
        ),
    ];
    assert_eq!(manifest["files"].as_array().unwrap().len(), fixtures.len());
    for (name, bytes) in fixtures {
        let row = manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["path"] == *name)
            .unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            row["sha256"].as_str().unwrap()
        );
        let definition = row["definition"].as_str().unwrap();
        let mut schema = if definition.ends_with("[]") {
            serde_json::json!({"type": "array", "items": {"$ref": "#/definitions/repo.MaintenanceEntryWithDetails"}})
        } else {
            serde_json::json!({"$ref": format!("#/definitions/{definition}")})
        };
        schema["definitions"] = swagger["definitions"].clone();
        let validator = jsonschema::options()
            .with_draft(jsonschema::Draft::Draft4)
            .build(&schema)
            .unwrap();
        validator
            .validate(&serde_json::from_slice::<Value>(bytes).unwrap())
            .unwrap();
    }
}

fn id(n: u64) -> Uuid {
    Uuid::parse(&format!("00000000-0000-4000-8000-{n:012}")).expect("synthetic UUID")
}
fn request(is_location: bool, page: u64) -> PageRequest {
    PageRequest {
        page,
        page_size: 2,
        is_location,
        parent_ids: vec![],
    }
}
const ITEM: &[u8] = include_bytes!("fixtures/item.detail.json");
const MAINTENANCE: &[u8] = include_bytes!("fixtures/maintenance.json");

#[test]
fn healthy_locations_items_and_bounded_pages() {
    healthy_fixture_schemas();
    let limits = DecodeLimits::default();
    let locations = decode_page(
        include_bytes!("fixtures/locations.page.json"),
        &request(true, 1),
        limits,
    )
    .unwrap();
    assert!(locations.value.items[0].archived);
    assert_eq!(
        locations.value.items[0].entity_type.as_ref().unwrap().name,
        "Arbitrary container"
    );
    let items = decode_page(
        include_bytes!("fixtures/items.page.json"),
        &request(false, 1),
        limits,
    )
    .unwrap();
    assert_eq!(items.value.items.len(), 2);
    assert_eq!(items.reader_value().unwrap()["items"][0]["assetId"], "0");
    assert_eq!(items.value.items[0].parent.as_ref().unwrap().id, id(1));
    assert!(items.value.items[1].entity_type.is_none());
    let second = decode_page(
        include_bytes!("fixtures/items-second.page.json"),
        &request(false, 2),
        limits,
    )
    .unwrap();
    assert_eq!(second.value.page, 2);
    assert_eq!(second.value.items.len(), 1);
    assert_eq!(items.value.total, second.value.total);
    let empty = decode_page(
        include_bytes!("fixtures/empty.page.json"),
        &request(false, 1),
        limits,
    )
    .unwrap();
    assert!(empty.value.items.is_empty());
    assert_eq!(empty.value.total, 0);
}

#[test]
fn healthy_native_detail_and_attachment_semantics() {
    let detail = decode_detail(ITEM, &id(2), DecodeLimits::default()).unwrap();
    assert_eq!(detail.original, ITEM);
    let bridge = detail.reader_value().unwrap();
    assert_eq!(bridge["attachments"][0]["kind"], "stored-file");
    assert_eq!(bridge["attachments"][0]["byteSize"], Value::Null);
    assert_eq!(
        detail.source["attachments"][0]["path"],
        "private/blob-key.pdf"
    );
    assert!(detail.value.entity.archived);
    assert_eq!(detail.value.entity.quantity, Some(1.5));
    assert_eq!(detail.value.entity.manufacturer.as_deref(), Some(""));
    assert_eq!(
        detail.value.summary.updated_at.as_str(),
        "2026-01-02T03:04:05.1200+02:00"
    );
    assert!(
        matches!(&detail.value.attachments[0], Attachment::StoredFile {
        byte_size: None, proxy_ref: None, content_type: Some(mime), ..
    } if mime == "application/pdf")
    );
    assert!(
        matches!(&detail.value.attachments[1], Attachment::ExternalLink {
        url, archived: false, ..
    } if url == "https://example.invalid/manual?q=%2f")
    );
    assert!(matches!(
        &detail.value.attachments[2],
        Attachment::StoredFile {
            content_type: None,
            byte_size: None,
            proxy_ref: None,
            ..
        }
    ));
}

#[test]
fn healthy_null_metadata_and_go_nil_slices() {
    let detail = decode_detail(
        include_bytes!("fixtures/unknown.detail.json"),
        &id(3),
        DecodeLimits::default(),
    )
    .unwrap();
    assert!(detail.value.entity.entity_type.is_none());
    assert!(detail.value.entity.parent.is_none());
    assert!(detail.value.attachments.is_empty());
    assert!(detail.source["entityType"].is_null());
    assert!(detail.source["attachments"].is_null());
    assert!(native_route_candidates(&detail.value.summary).is_empty());
}

#[test]
fn healthy_calendar_maintenance_and_decimal_cost() {
    let log = decode_maintenance(MAINTENANCE, &id(2), DecodeLimits::default()).unwrap();
    assert_eq!(log.value.entity_id(), &id(2));
    let entries = log.value.entries();
    assert_eq!(
        entries[0].scheduled_date.as_ref().unwrap().as_str(),
        "2026-02-01"
    );
    assert!(entries[0].completed_date.is_none());
    assert_eq!(
        entries[1].completed_date.as_ref().unwrap().as_str(),
        "2026-02-01"
    );
    assert_eq!(entries[1].cost.to_string(), "12.50");
    assert_eq!(entries[2].cost.to_string(), "1.25e+06");
    assert_eq!(log.source[1]["cost"], "12.50");
    let calendar: MaintenanceDate = serde_json::from_str("\"2026-02-01\"").unwrap();
    let legacy: MaintenanceDate = serde_json::from_str("\"2026-02-01T00:00:00Z\"").unwrap();
    assert_eq!(calendar.as_str(), "2026-02-01");
    assert_eq!(legacy.as_str(), "2026-02-01T00:00:00Z");
    assert_eq!(
        log.reader_value().unwrap()[0]["scheduledDate"],
        "2026-02-01"
    );
    let empty = decode_maintenance(
        include_bytes!("fixtures/empty-maintenance.json"),
        &id(1),
        DecodeLimits::default(),
    )
    .unwrap();
    assert!(empty.value.entries().is_empty());
}

#[test]
fn healthy_scoped_projection_candidate_and_provenance() {
    let limits = DecodeLimits::default();
    let detail = decode_detail(ITEM, &id(2), limits).unwrap();
    let log = decode_maintenance(MAINTENANCE, &id(2), limits).unwrap();
    let scope = SourceScope {
        workspace_id: id(901),
        home_id: id(902),
        source_instance_id: id(903),
        collection_id: "Opaque/Σ/CaSe".into(),
    };
    let retrieved = Timestamp::parse("2026-03-01T09:00:00.001Z").unwrap();
    let candidate = detail
        .value
        .projection_candidate(&scope, retrieved.clone(), &log.value)
        .unwrap();
    assert_eq!(candidate.source.collection_id, scope.collection_id);
    assert_eq!(
        candidate.source.source_instance_id,
        scope.source_instance_id
    );
    assert_eq!(candidate.retrieved_at, retrieved);
    assert!(candidate.native_links.is_empty());
    let value = serde_json::to_value(candidate).unwrap();
    assert_eq!(value["maintenance"][0]["scheduledDate"], "2026-02-01");
    assert_eq!(value["maintenance"][0]["completedDate"], Value::Null);
    assert!(value["maintenance"][1]["cost"].is_number());
    let provenance = WireProvenance::source_derived_synthetic();
    assert_eq!(provenance.reference_source_commit, SOURCE_COMMIT);
    assert!(provenance.source_revision.is_none());
    assert!(provenance.observed_target_version.is_none());
    assert_eq!(
        provenance.evidence_kind,
        EvidenceKind::SourceDerivedSynthetic
    );
}

#[test]
fn healthy_type_specific_source_navigation_and_query() {
    let limits = DecodeLimits::default();
    let item = decode_detail(ITEM, &id(2), limits).unwrap();
    let item_routes = native_route_candidates(&item.value.summary);
    assert_eq!(item_routes[2].intent, NativeIntent::Maintenance);
    assert_eq!(item_routes[2].path, "/item/{entityId}/maintenance");
    assert!(item_routes.iter().all(|r| !r.verified));
    let location = decode_detail(
        include_bytes!("fixtures/location.detail.json"),
        &id(1),
        limits,
    )
    .unwrap();
    let routes = native_route_candidates(&location.value.summary);
    assert_eq!(routes.len(), 2);
    assert_eq!(routes[1].path, "/location/{entityId}/edit");
    let request = PageRequest {
        parent_ids: vec![id(1), id(4)],
        ..request(true, 1)
    };
    let query = request.query().unwrap();
    assert!(query.contains(&("includeArchived".into(), "true".into())));
    assert_eq!(query.iter().filter(|(k, _)| k == "parentIds").count(), 2);
}
