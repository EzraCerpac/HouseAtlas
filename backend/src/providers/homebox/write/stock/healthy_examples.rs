//! One healthy synthetic mapping matrix for stock.2 / wire3. No transport,
//! provider, admission, denial, replay, concurrency or failure controls run here.
//! The shared contract peer owns actual wire validation and canonical digests.

use super::*;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use uuid::Uuid;

const METADATA: &str = include_str!(
    "../../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
);

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x00000000_0000_4000_8000_000000000000 | value)
}

fn fixture_digest() -> Digest {
    // A typed placeholder supplied by the synthetic contract/preparation peer.
    // This is never evidence that the fixture bytes have this actual digest.
    Digest::parse("a".repeat(64)).unwrap()
}

fn target(kind: ResourceKind, id: Option<Uuid>, owner: Option<Uuid>) -> StockTarget {
    StockTarget {
        source_instance_id: fixture_id(0x10),
        // The published normalized fixture has an opaque collection name.
        // Wire3 requires UUID collections, so this separate synthetic scope is
        // explicit rather than a claimed conversion of the published scope.
        collection_id: fixture_id(0x11),
        resource_kind: kind,
        resource_id: id,
        entity_id: owner,
    }
}

/// A schema-shaped healthy wire request for the root workflow fixture. Real
/// callers must obtain StockCommand from the shared validating contract port.
pub(super) fn healthy_command(
    command_id: &str,
    target: StockTarget,
    payload: Value,
) -> StockCommand {
    let context = Context {
        workspace_id: fixture_id(1),
        home_id: fixture_id(2),
    };
    let native_sync_behavior = match command_id {
        "homebox.entity.update"
        | "homebox.location.update"
        | "homebox.entity.archive"
        | "homebox.location.archive"
        | "homebox.entity.unarchive"
        | "homebox.location.unarchive"
        | "homebox.entity.reparent"
        | "homebox.location.reparent"
        | "homebox.field.create"
        | "homebox.field.update"
        | "homebox.field.delete" => Some(false),
        _ => None,
    };
    let request_id = fixture_id(0x20);
    let idempotency_key = fixture_id(0x21);
    let provider_observation = fixture_id(0x22);
    let approval_receipt_id = Some(fixture_id(0x23));
    let mut wire_target = json!({
        "authority":"homebox",
        "sourceInstanceId":target.source_instance_id,
        "collectionId":target.collection_id,
        "resourceKind":target.resource_kind,
    });
    if let Some(id) = target.resource_id {
        wire_target["resourceId"] = json!(id);
    }
    if let Some(owner) = target.entity_id {
        wire_target["entityId"] = json!(owner);
    }
    let mut original_wire = json!({
        "schemaVersion":3,"commandId":command_id,"requestId":request_id,
        "context":context,"target":wire_target,"payload":payload,
        "idempotencyKey":idempotency_key,"reason":"Healthy synthetic mapping example",
        "preconditions":{
            "providerObservation":{"kind":"provider-observation","handle":provider_observation},
            "atlasGuards":[]
        },
        "approvalReceiptId":approval_receipt_id,
    });
    if let Some(observed) = native_sync_behavior {
        original_wire["nativeSyncBehavior"] =
            json!({"mode":"preserve-observed","observed":observed});
    }
    StockCommand {
        command_id: command_id.into(),
        request_id,
        idempotency_key,
        context,
        target,
        payload,
        native_sync_behavior,
        provider_observation,
        approval_receipt_id,
        original_wire,
        request_digest: fixture_digest(),
    }
}

fn qualified_reference(kind: ResourceKind, id: Uuid) -> Value {
    json!({"authority":"homebox","sourceInstanceId":fixture_id(0x10),
        "collectionId":fixture_id(0x11),"resourceKind":kind,"resourceId":id})
}

fn reviewed_impact() -> Value {
    json!({"impactId":fixture_id(0x30),"impactDigest":"a".repeat(64)})
}

fn with_impact(mut payload: Value) -> Value {
    payload
        .as_object_mut()
        .unwrap()
        .extend(reviewed_impact().as_object().unwrap().clone());
    payload
}

fn deletion() -> Value {
    with_impact(json!({"cascade":"observed-reviewed-impact"}))
}

fn stage(csv: bool) -> StagedUpload {
    StagedUpload {
        upload_token: fixture_id(0x40),
        sha256: fixture_digest(),
        byte_size: 64,
        content_type: if csv { "text/csv" } else { "image/png" }.into(),
        filename: if csv {
            "synthetic.csv"
        } else {
            "synthetic.png"
        }
        .into(),
    }
}

fn snapshot(target: StockTarget, value: Value) -> NativeSnapshot {
    NativeSnapshot {
        target,
        value,
        digest: fixture_digest(),
        complete: true,
        // This attestation is provided solely by the synthetic preparation peer.
        // A production adapter must obtain genuine registered-build evidence.
        hidden_fields_preserved: true,
    }
}

fn preparation() -> Preparation {
    let published: Value = serde_json::from_str(METADATA).unwrap();
    assert_eq!(published["synthetic"], true);
    let mut entity = published["entities"][0].clone();
    let entity_id = fixture_id(0x500);
    // Retain the published arbitrary entity type, null parent and original
    // source clock; complete native fields are synthetic.
    entity.as_object_mut().unwrap().extend(
        json!({
            "assetId":"100500","description":"Synthetic complete native object",
            "manufacturer":"Example","modelNumber":"Fixture","serialNumber":"S-1",
            "notes":"Preserved synthetic notes","purchaseFrom":"Synthetic source",
            "soldTo":"","soldNotes":"","warrantyDetails":"Preserved warranty",
            "purchaseDate":"2026-01-01","soldDate":"2026-01-02","warrantyExpires":"2027-01-01",
            "quantity":1,"purchasePrice":12.5,"soldPrice":0,
            "insured":false,"lifetimeWarranty":false,"syncChildEntityLocations":false,
            "tags":[{"id":fixture_id(0x600)}],
            "fields":[{"id":fixture_id(0x800),"name":"Original field","type":"text",
                "textValue":"Preserved","numberValue":0,"booleanValue":false}],
            "attachments":[
                {"id":fixture_id(0x900),"title":"Original file","type":"photo","primary":false,
                    "mimeType":"image/png","path":"synthetic.png"},
                {"id":fixture_id(0x901),"title":"Original link","type":"manual","primary":false,
                    "mimeType":"link/url","path":"https://example.invalid/manual"}
            ]
        })
        .as_object()
        .unwrap()
        .clone(),
    );
    let tag = json!({"id":fixture_id(0x600),"name":"Original tag","color":"#123456",
        "description":"Preserved tag description","icon":"tag","parentId":fixture_id(0x601)});
    let maintenance = json!({"id":fixture_id(0xa00),"itemID":entity_id,"name":"Original maintenance",
        "description":"Preserved maintenance description","cost":"12.50",
        "scheduledDate":"2026-01-10","completedDate":"2026-01-11"});
    let entity_type = json!({"id":fixture_id(0x700),"name":"Custom cupboard","icon":"box",
        "isLocation":true,"defaultTemplateId":fixture_id(0xb00)});
    let template = json!({"id":fixture_id(0xb00),"name":"Original template",
    "description":"Preserved template description","notes":"Preserved template notes",
    "defaultName":"Fixture item","defaultDescription":"Fixture description",
    "defaultManufacturer":"Example","defaultModelNumber":"Fixture","defaultQuantity":1,
    "defaultInsured":false,"defaultLifetimeWarranty":false,"defaultWarrantyDetails":"Fixture warranty",
    "includePurchaseFields":true,"includeSoldFields":false,"includeWarrantyFields":true,
    "defaultLocation":{"id":fixture_id(0x501)},"defaultTags":[{"id":fixture_id(0x600)}],
    "fields":[
        {"id":fixture_id(0xc00),"name":"Template text","type":"text","textValue":"Old"},
        {"id":fixture_id(0xc01),"name":"Removable text","type":"text","textValue":"Old"}
    ]});
    let mut native_clear_values = Vec::new();
    for (field, native_value, native_readback_value) in [
        ("purchasePrice", json!(0), json!(0)),
        ("soldPrice", json!(0), json!(0)),
        ("purchaseDate", json!(""), json!("0001-01-01")),
        ("soldDate", json!(""), json!("0001-01-01")),
        ("warrantyExpires", json!(""), json!("0001-01-01")),
    ] {
        native_clear_values.push(NativeClear {
            command_id: "homebox.entity.update".into(),
            field: field.into(),
            native_value,
            native_readback_value,
        });
    }
    native_clear_values.push(NativeClear {
        command_id: "homebox.maintenance.reopen".into(),
        field: "completedDate".into(),
        native_value: json!(""),
        native_readback_value: json!("0001-01-01"),
    });
    Preparation {
        snapshots: vec![
            snapshot(target(ResourceKind::Entity, Some(entity_id), None), entity),
            snapshot(
                target(ResourceKind::Tag, Some(fixture_id(0x600)), None),
                tag,
            ),
            snapshot(
                target(
                    ResourceKind::Maintenance,
                    Some(fixture_id(0xa00)),
                    Some(entity_id),
                ),
                maintenance,
            ),
            snapshot(
                target(ResourceKind::EntityType, Some(fixture_id(0x700)), None),
                entity_type,
            ),
            snapshot(
                target(ResourceKind::Template, Some(fixture_id(0xb00)), None),
                template,
            ),
        ],
        staged_upload: None,
        native_clear_values,
    }
}

struct Case {
    command: StockCommand,
    preparation: Preparation,
    method: NativeMethod,
    path: String,
}

fn cases() -> Vec<Case> {
    let entity_id = fixture_id(0x500);
    let entity_path = format!("/api/v1/entities/{entity_id}");
    let mut cases = Vec::new();
    let base = preparation();
    let mut add = |id: &str, target: StockTarget, payload: Value, method, path: String| {
        let mut preparation = base.clone();
        if id == "homebox.file.upload" {
            preparation.staged_upload = Some(stage(false));
        }
        if id == "homebox.import.csv" {
            preparation.staged_upload = Some(stage(true));
        }
        let mut command = healthy_command(id, target, payload);
        command.request_id = fixture_id(0x1000 + cases.len() as u128);
        command.idempotency_key = fixture_id(0x2000 + cases.len() as u128);
        command.original_wire["requestId"] = json!(command.request_id);
        command.original_wire["idempotencyKey"] = json!(command.idempotency_key);
        cases.push(Case {
            command,
            preparation,
            method,
            path,
        });
    };
    let entity_create = || {
        json!({"name":"Healthy created entity","description":"Synthetic",
        "entityTypeId":fixture_id(0x700),"parentId":Value::Null,"quantity":1,"tagIds":[fixture_id(0x600)]})
    };
    let entity_changes = || {
        json!({"name":"Healthy updated entity","description":"Synthetic update",
        "assetId":"100501","manufacturer":"Example revised","modelNumber":"Fixture revised",
        "serialNumber":"S-2","notes":"Updated notes","purchaseFrom":"Synthetic revised source",
        "purchasePrice":15.5,"soldPrice":2,"soldTo":"Synthetic recipient","soldNotes":"Updated sale notes",
        "insured":true,"lifetimeWarranty":true,"warrantyDetails":"Updated warranty",
        "purchaseDate":"2026-02-01","soldDate":"2026-02-02","warrantyExpires":"2028-02-01"})
    };
    let duplicate = || {
        json!({"copyAttachments":true,"copyCustomFields":true,
        "copyMaintenance":true,"copyPrefix":"Healthy duplicate "})
    };
    for family in ["entity", "location"] {
        for (verb, payload, method, path) in [
            (
                "create",
                entity_create(),
                NativeMethod::Post,
                "/api/v1/entities".into(),
            ),
            (
                "update",
                entity_changes(),
                NativeMethod::Put,
                entity_path.clone(),
            ),
            ("archive", json!({}), NativeMethod::Put, entity_path.clone()),
            (
                "unarchive",
                json!({}),
                NativeMethod::Put,
                entity_path.clone(),
            ),
            (
                "reparent",
                with_impact(json!({"parentId":fixture_id(0x501)})),
                NativeMethod::Patch,
                entity_path.clone(),
            ),
            (
                "delete",
                deletion(),
                NativeMethod::Delete,
                entity_path.clone(),
            ),
            (
                "duplicate",
                duplicate(),
                NativeMethod::Post,
                format!("{entity_path}/duplicate"),
            ),
            (
                "children.sync",
                with_impact(json!({"syncChildEntityLocations":true,
                "propagation":"native-if-non-null-parent"})),
                NativeMethod::Put,
                entity_path.clone(),
            ),
        ] {
            let resource_id = if verb == "create" {
                None
            } else {
                Some(entity_id)
            };
            add(
                &format!("homebox.{family}.{verb}"),
                target(ResourceKind::Entity, resource_id, None),
                payload,
                method,
                path,
            );
        }
    }
    add(
        "homebox.entity.quantity.set",
        target(ResourceKind::Entity, Some(entity_id), None),
        json!({"quantity":0}),
        NativeMethod::Patch,
        entity_path.clone(),
    );
    add(
        "homebox.entity.type.set",
        target(ResourceKind::Entity, Some(entity_id), None),
        with_impact(json!({"entityTypeId":fixture_id(0x701)})),
        NativeMethod::Patch,
        entity_path.clone(),
    );
    for verb in ["set", "add", "remove"] {
        add(
            &format!("homebox.entity.tags.{verb}"),
            target(ResourceKind::Entity, Some(entity_id), None),
            json!({"tagIds":[fixture_id(0x600)]}),
            NativeMethod::Patch,
            entity_path.clone(),
        );
    }
    for (verb, payload, method) in [
        (
            "create",
            json!({"name":"Healthy tag","color":"#abcdef","description":"Synthetic tag",
            "icon":"tag","parentId":fixture_id(0x601)}),
            NativeMethod::Post,
        ),
        (
            "update",
            json!({"name":"Healthy revised tag"}),
            NativeMethod::Put,
        ),
        ("delete", deletion(), NativeMethod::Delete),
    ] {
        let id = if verb == "create" {
            None
        } else {
            Some(fixture_id(0x600))
        };
        let path = id.map_or("/api/v1/tags".into(), |id| format!("/api/v1/tags/{id}"));
        add(
            &format!("homebox.tag.{verb}"),
            target(ResourceKind::Tag, id, None),
            payload,
            method,
            path,
        );
    }
    for (verb, payload, id) in [
        (
            "create",
            json!({"name":"Healthy field","value":{"kind":"text","value":"New"}}),
            None,
        ),
        (
            "update",
            json!({"name":"Healthy revised field","value":{"kind":"text","value":"Revised"}}),
            Some(fixture_id(0x800)),
        ),
        ("delete", deletion(), Some(fixture_id(0x800))),
    ] {
        add(
            &format!("homebox.field.{verb}"),
            target(ResourceKind::Field, id, Some(entity_id)),
            payload,
            NativeMethod::Put,
            entity_path.clone(),
        );
    }
    let attachment_path = |id| format!("{entity_path}/attachments/{id}");
    for (id, attachment_id, payload, method, path) in [
        (
            "homebox.file.upload",
            None,
            json!({"staged":stage(false),"type":"photo","primary":true}),
            NativeMethod::Post,
            format!("{entity_path}/attachments"),
        ),
        (
            "homebox.file.upload",
            None,
            json!({"staged":stage(false),"type":"thumbnail","primary":false}),
            NativeMethod::Post,
            format!("{entity_path}/attachments"),
        ),
        (
            "homebox.file.upload",
            None,
            json!({"staged":stage(false),"type":"photo","primary":false}),
            NativeMethod::Post,
            format!("{entity_path}/attachments"),
        ),
        (
            "homebox.file.update",
            Some(fixture_id(0x900)),
            json!({"title":"Healthy revised file","type":"photo","primary":true}),
            NativeMethod::Put,
            attachment_path(fixture_id(0x900)),
        ),
        (
            "homebox.file.update",
            Some(fixture_id(0x900)),
            json!({"title":"Healthy manual file","type":"manual","primary":false}),
            NativeMethod::Put,
            attachment_path(fixture_id(0x900)),
        ),
        (
            "homebox.file.delete",
            Some(fixture_id(0x900)),
            deletion(),
            NativeMethod::Delete,
            attachment_path(fixture_id(0x900)),
        ),
        (
            "homebox.document-link.create",
            None,
            json!({"title":"Healthy manual","url":"https://example.invalid/manual","archived":false,"attachmentType":"manual"}),
            NativeMethod::Post,
            format!("{entity_path}/attachments/external"),
        ),
        (
            "homebox.document-link.update",
            Some(fixture_id(0x901)),
            json!({"title":"Healthy revised manual"}),
            NativeMethod::Put,
            attachment_path(fixture_id(0x901)),
        ),
        (
            "homebox.document-link.delete",
            Some(fixture_id(0x901)),
            deletion(),
            NativeMethod::Delete,
            attachment_path(fixture_id(0x901)),
        ),
    ] {
        add(
            id,
            target(ResourceKind::Attachment, attachment_id, Some(entity_id)),
            payload,
            method,
            path,
        );
    }
    for (verb, payload, method) in [
        (
            "create",
            json!({"name":"Healthy maintenance","description":"Synthetic maintenance",
            "cost":"20.25","scheduledDate":"2026-02-10","completedDate":"2026-02-11"}),
            NativeMethod::Post,
        ),
        (
            "update",
            json!({"name":"Healthy revised maintenance","description":"Revised description","cost":"30.50"}),
            NativeMethod::Put,
        ),
        (
            "schedule",
            json!({"scheduledDate":"2026-03-10"}),
            NativeMethod::Put,
        ),
        (
            "complete",
            json!({"completedDate":"2026-03-11","cost":"35.75"}),
            NativeMethod::Put,
        ),
        (
            "reopen",
            json!({"completedDate":Value::Null}),
            NativeMethod::Put,
        ),
        ("delete", deletion(), NativeMethod::Delete),
    ] {
        let id = if verb == "create" {
            None
        } else {
            Some(fixture_id(0xa00))
        };
        let path = id.map_or(format!("{entity_path}/maintenance"), |id| {
            format!("/api/v1/maintenance/{id}")
        });
        add(
            &format!("homebox.maintenance.{verb}"),
            target(ResourceKind::Maintenance, id, Some(entity_id)),
            payload,
            method,
            path,
        );
    }
    for (verb, payload, method) in [
        (
            "create",
            json!({"name":"Healthy type","icon":"box","isLocation":false,
            "defaultTemplateId":fixture_id(0xb00)}),
            NativeMethod::Post,
        ),
        (
            "update",
            json!({"name":"Healthy revised type","isLocation":false}),
            NativeMethod::Put,
        ),
        ("delete", deletion(), NativeMethod::Delete),
    ] {
        let id = if verb == "create" {
            None
        } else {
            Some(fixture_id(0x700))
        };
        let path = id.map_or("/api/v1/entity-types".into(), |id| {
            format!("/api/v1/entity-types/{id}")
        });
        add(
            &format!("homebox.entity-type.{verb}"),
            target(ResourceKind::EntityType, id, None),
            payload,
            method,
            path,
        );
    }
    let template_create = json!({"name":"Healthy template","description":"Synthetic template",
        "notes":"Healthy notes","defaultName":"Healthy item","defaultDescription":"Healthy description",
        "defaultManufacturer":"Example","defaultModelNumber":"Fixture","defaultQuantity":2,
        "defaultInsured":true,"defaultLifetimeWarranty":true,"defaultWarrantyDetails":"Healthy warranty",
        "defaultLocation":qualified_reference(ResourceKind::Entity,fixture_id(0x501)),
        "defaultTags":[qualified_reference(ResourceKind::Tag,fixture_id(0x600))],
        "includePurchaseDetails":true,"includeSoldDetails":true,"includeWarrantyDetails":true,
        "fields":[{"name":"Healthy template field","value":{"kind":"text","value":"Created"}}]});
    let template_update = json!({"name":"Healthy revised template","defaultQuantity":3,
    "includePurchaseDetails":false,"includeSoldDetails":true,"includeWarrantyDetails":false,
    "defaultLocation":qualified_reference(ResourceKind::Entity,fixture_id(0x501)),
    "defaultTags":[qualified_reference(ResourceKind::Tag,fixture_id(0x600))],
    "fieldChanges":[
        {"op":"create","field":{"name":"Added template text","value":{"kind":"text","value":"Added"}}},
        {"op":"update","fieldId":fixture_id(0xc00),"changes":{"name":"Revised template text","value":{"kind":"text","value":"Revised"}}},
        {"op":"delete","fieldId":fixture_id(0xc01),"impactId":fixture_id(0x30),"impactDigest":"a".repeat(64)}
    ]});
    for (verb, payload, method) in [
        ("create", template_create, NativeMethod::Post),
        ("update", template_update, NativeMethod::Put),
        ("delete", deletion(), NativeMethod::Delete),
        (
            "create-item",
            json!({"name":"Healthy template item","description":"Synthetic item",
            "entityTypeId":fixture_id(0x700),"parentId":fixture_id(0x501),"quantity":2,"tagIds":[fixture_id(0x600)]}),
            NativeMethod::Post,
        ),
    ] {
        let id = if verb == "create" {
            None
        } else {
            Some(fixture_id(0xb00))
        };
        let path = if verb == "create-item" {
            format!("/api/v1/templates/{}/create-item", id.unwrap())
        } else {
            id.map_or("/api/v1/templates".into(), |id| {
                format!("/api/v1/templates/{id}")
            })
        };
        add(
            &format!("homebox.template.{verb}"),
            target(ResourceKind::Template, id, None),
            payload,
            method,
            path,
        );
    }
    for action in [
        "create-missing-thumbnails",
        "ensure-asset-ids",
        "ensure-import-refs",
        "set-primary-photos",
        "wipe-inventory",
        "zero-item-time-fields",
    ] {
        let mut payload = with_impact(json!({"action":action}));
        if action == "wipe-inventory" {
            payload.as_object_mut().unwrap().extend(
                json!({"wipeLocations":true,
                "wipeTags":true,"wipeMaintenance":true})
                .as_object()
                .unwrap()
                .clone(),
            );
        }
        add(
            "homebox.bulk.execute",
            target(ResourceKind::Collection, None, None),
            payload,
            NativeMethod::Post,
            format!("/api/v1/actions/{action}"),
        );
    }
    add(
        "homebox.import.csv",
        target(ResourceKind::Collection, None, None),
        with_impact(json!({"format":"csv","stage":stage(true),"maxRows":1})),
        NativeMethod::Post,
        "/api/v1/entities/import".into(),
    );
    for subject in ["asset", "item", "location"] {
        let mut payload = json!({"subject":subject,"delivery":"print","maxBytes":1024});
        let native_id = if subject == "asset" {
            payload["assetId"] = json!("100500");
            "100500".to_owned()
        } else {
            payload["resourceId"] = json!(entity_id);
            entity_id.to_string()
        };
        add(
            "homebox.label.output",
            target(ResourceKind::Collection, None, None),
            payload,
            NativeMethod::Get,
            format!("/api/v1/labelmaker/{subject}/{native_id}"),
        );
    }
    for family in ["entity", "location"] {
        add(
            &format!("homebox.{family}.reparent"),
            target(ResourceKind::Entity, Some(entity_id), None),
            with_impact(json!({"parentId":Value::Null})),
            NativeMethod::Put,
            entity_path.clone(),
        );
    }
    for (kind, value) in [("number", json!(42)), ("boolean", json!(true))] {
        for verb in ["create", "update"] {
            let id = if verb == "create" {
                None
            } else {
                Some(fixture_id(0x800))
            };
            add(
                &format!("homebox.field.{verb}"),
                target(ResourceKind::Field, id, Some(entity_id)),
                json!({"name":"Healthy scalar field","value":{"kind":kind,"value":value}}),
                NativeMethod::Put,
                entity_path.clone(),
            );
        }
    }
    add(
        "homebox.entity.update",
        target(ResourceKind::Entity, Some(entity_id), None),
        json!({"purchasePrice":Value::Null,"soldPrice":Value::Null,"purchaseDate":Value::Null,
            "soldDate":Value::Null,"warrantyExpires":Value::Null}),
        NativeMethod::Put,
        entity_path.clone(),
    );
    add(
        "homebox.entity-type.update",
        target(ResourceKind::EntityType, Some(fixture_id(0x700)), None),
        json!({"name":"Healthy type without a default template"}),
        NativeMethod::Put,
        format!("/api/v1/entity-types/{}", fixture_id(0x700)),
    );
    add(
        "homebox.tag.update",
        target(ResourceKind::Tag, Some(fixture_id(0x600)), None),
        json!({"name":"Healthy root tag","parentId":Value::Null}),
        NativeMethod::Put,
        format!("/api/v1/tags/{}", fixture_id(0x600)),
    );
    add(
        "homebox.entity.update",
        target(ResourceKind::Entity, Some(entity_id), None),
        json!({"name":"Healthy entity retaining 101 fields"}),
        NativeMethod::Put,
        entity_path,
    );
    // These native observations are complete shapes, not wire mutation arrays.
    // The wire request still changes only the named scalar above.
    let no_template = cases.len() - 3;
    cases[no_template]
        .preparation
        .snapshots
        .iter_mut()
        .find(|snapshot| snapshot.target.resource_kind == ResourceKind::EntityType)
        .unwrap()
        .value
        .as_object_mut()
        .unwrap()
        .remove("defaultTemplateId");
    let existing_fields = (0..101)
        .map(|index| {
            json!({
                "id":fixture_id(0xd00 + index),"name":format!("Preserved field {index}"),
                "type":"text","textValue":format!("Preserved value {index}"),
                "numberValue":0,"booleanValue":false
            })
        })
        .collect::<Vec<_>>();
    cases.last_mut().unwrap().preparation.snapshots[0].value["fields"] = json!(existing_fields);
    cases
}

/// Reusable positive preparations for the root workflow's injected peers.
pub(super) fn healthy_cases() -> Vec<(StockCommand, Preparation)> {
    cases()
        .into_iter()
        .map(|case| (case.command, case.preparation))
        .collect()
}

fn assert_family_values(command: &StockCommand, preparation: &Preparation, plan: &NativePlan) {
    if matches!(plan.request.method, NativeMethod::Put)
        && command.target.resource_kind == ResourceKind::Entity
    {
        let NativeBody::Json(body) = &plan.request.body else {
            panic!("healthy entity PUT has JSON")
        };
        let original = &preparation.snapshots[0].value;
        assert_eq!(body["id"], original["id"]);
        assert_eq!(body["entityTypeId"], original["entityType"]["id"]);
        assert_eq!(body["quantity"], original["quantity"]);
        assert_eq!(
            body["fields"].as_array().unwrap().len(),
            original["fields"].as_array().unwrap().len()
        );
        assert_eq!(
            body["syncChildEntityLocations"],
            command
                .payload
                .get("syncChildEntityLocations")
                .cloned()
                .unwrap_or_else(|| original["syncChildEntityLocations"].clone())
        );
    }
    match command.command_id.as_str() {
        "homebox.file.upload" => {
            let NativeBody::Multipart {
                file_field,
                stage,
                fields,
            } = &plan.request.body
            else {
                panic!("healthy upload is multipart")
            };
            assert_eq!(file_field, "file");
            if command.payload["type"] == "photo" && command.payload["primary"] == false {
                let owner = preparation
                    .snapshot(&command.target.owner_target().unwrap())
                    .unwrap();
                assert!(
                    owner.value["attachments"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|attachment| attachment["type"] == "photo")
                );
            }
            assert_eq!(
                fields,
                &vec![
                    ("name".into(), stage.filename.clone()),
                    (
                        "type".into(),
                        command.payload["type"].as_str().unwrap().into()
                    ),
                    (
                        "primary".into(),
                        command.payload["primary"].as_bool().unwrap().to_string()
                    )
                ]
            );
            assert_eq!(
                plan.readback.selector,
                ReadbackSelector::Member {
                    field: "attachments".into()
                }
            );
        }
        "homebox.file.update" => {
            let NativeBody::Json(body) = &plan.request.body else {
                panic!("healthy attachment update uses JSON")
            };
            assert_eq!(body["title"], command.payload["title"]);
            assert_eq!(body["type"], command.payload["type"]);
            assert_eq!(body["primary"], command.payload["primary"]);
        }
        "homebox.document-link.create" => {
            let NativeBody::Json(body) = &plan.request.body else {
                panic!("healthy link uses JSON")
            };
            assert_eq!(
                body,
                &json!({"title":"Healthy manual","source_type":"link",
                "external_id":"https://example.invalid/manual","attachment_type":"manual"})
            );
            assert_eq!(plan.readback.expected["mimeType"], "link/url");
        }
        "homebox.import.csv" => {
            let NativeBody::Multipart {
                file_field,
                stage,
                fields,
            } = &plan.request.body
            else {
                panic!("healthy CSV is multipart")
            };
            assert_eq!(file_field, "csv");
            assert_eq!(stage.content_type, "text/csv");
            assert!(fields.is_empty());
            assert_eq!(plan.success_status, 204);
            assert_eq!(plan.readback.selector, ReadbackSelector::CompleteImpact);
        }
        "homebox.label.output" => {
            assert_eq!(plan.request.query, vec![("print".into(), "true".into())]);
            assert_eq!(plan.readback.selector, ReadbackSelector::Printer);
        }
        "homebox.bulk.execute" => {
            assert_eq!(plan.readback.selector, ReadbackSelector::CompleteImpact);
            if command.payload["action"] == "wipe-inventory" {
                assert_eq!(
                    plan.request.body,
                    NativeBody::Json(
                        json!({"wipeLocations":true,"wipeTags":true,"wipeMaintenance":true})
                    )
                );
            } else {
                assert_eq!(plan.request.body, NativeBody::None);
            }
        }
        "homebox.template.create" | "homebox.template.update" => {
            let NativeBody::Json(body) = &plan.request.body else {
                panic!("healthy template uses JSON")
            };
            assert_eq!(body["defaultLocationId"], fixture_id(0x501).to_string());
            assert_eq!(body["defaultTagIds"], json!([fixture_id(0x600)]));
            assert_eq!(
                body["includePurchaseFields"],
                command.payload["includePurchaseDetails"]
            );
            assert_eq!(
                body["includeSoldFields"],
                command.payload["includeSoldDetails"]
            );
            assert_eq!(
                body["includeWarrantyFields"],
                command.payload["includeWarrantyDetails"]
            );
        }
        "homebox.entity-type.update"
            if command.payload["name"] == "Healthy type without a default template" =>
        {
            let NativeBody::Json(body) = &plan.request.body else {
                panic!("healthy type update uses JSON")
            };
            assert_eq!(body.get("defaultTemplateId"), None);
            assert_eq!(
                command.original_wire["payload"].get("defaultTemplateId"),
                None
            );
            let mut native = preparation.snapshot(&command.target).unwrap().value.clone();
            native["name"] = command.payload["name"].clone();
            super::healthy_workflow::assert_healthy_observation(
                command,
                preparation,
                plan,
                json!([native]),
            );
        }
        "homebox.tag.update" if command.payload["name"] == "Healthy root tag" => {
            assert_eq!(command.original_wire["payload"]["parentId"], Value::Null);
            let mut native = preparation.snapshot(&command.target).unwrap().value.clone();
            native["name"] = command.payload["name"].clone();
            native["parentId"] = json!(Uuid::nil());
            super::healthy_workflow::assert_healthy_observation(command, preparation, plan, native);
        }
        "homebox.entity.update"
            if command.payload["name"] == "Healthy entity retaining 101 fields" =>
        {
            let mut native = preparation.snapshot(&command.target).unwrap().value.clone();
            native["name"] = command.payload["name"].clone();
            assert_eq!(native["fields"].as_array().unwrap().len(), 101);
            super::healthy_workflow::assert_healthy_observation(command, preparation, plan, native);
        }
        "homebox.maintenance.update" => {
            assert_eq!(command.original_wire["payload"]["cost"], "30.50");
            let mut native = preparation.snapshot(&command.target).unwrap().value.clone();
            native
                .as_object_mut()
                .unwrap()
                .extend(command.payload.as_object().unwrap().clone());
            native["cost"] = json!("30.5");
            super::healthy_workflow::assert_healthy_observation(
                command,
                preparation,
                plan,
                json!([native]),
            );
            assert_eq!(command.payload["cost"], "30.50");
        }
        _ => {}
    }
    if command.target.resource_kind == ResourceKind::Maintenance {
        assert_eq!(
            plan.readback.path,
            format!("/api/v1/entities/{}/maintenance", fixture_id(0x500))
        );
        assert_eq!(plan.readback.query, vec![("status".into(), "both".into())]);
        if let NativeBody::Json(body) = &plan.request.body {
            assert!(body["cost"].is_string());
        }
    }
    for clear in &preparation.native_clear_values {
        if clear.command_id == command.command_id
            && command.payload.get(&clear.field) == Some(&Value::Null)
        {
            let NativeBody::Json(body) = &plan.request.body else {
                panic!("healthy qualified clear uses JSON")
            };
            assert_eq!(body[&clear.field], clear.native_value);
            assert_eq!(
                plan.readback.expected[&clear.field],
                clear.native_readback_value
            );
        }
    }
}

#[test]
fn healthy_synthetic_stock_operation_mappings() {
    let cases = cases();
    let mut command_ids = BTreeSet::new();
    let mut bulk_actions = BTreeSet::new();
    let mut print_subjects = BTreeSet::new();
    for case in &cases {
        let plan = map_stock(&case.command, &case.preparation).unwrap_or_else(|error| {
            panic!("healthy {} mapping: {error:?}", case.command.command_id)
        });
        assert_eq!(
            plan.request.method, case.method,
            "{}",
            case.command.command_id
        );
        assert_eq!(plan.request.path, case.path, "{}", case.command.command_id);
        assert_family_values(&case.command, &case.preparation, &plan);
        println!("HEALTHY_STOCK_REQUEST={}", case.command.original_wire);
        println!(
            "HEALTHY_NATIVE_PLAN={}",
            serde_json::to_string(&plan).unwrap()
        );
        let encoded = serde_json::to_value(&plan).unwrap();
        let decoded: NativePlan = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded, plan);
        command_ids.insert(case.command.command_id.as_str());
        if case.command.command_id == "homebox.bulk.execute" {
            bulk_actions.insert(case.command.payload["action"].as_str().unwrap());
        }
        if case.command.command_id == "homebox.label.output" {
            print_subjects.insert(case.command.payload["subject"].as_str().unwrap());
        }
    }
    // 48 required write IDs and the label-output ID's three print variants.
    assert_eq!(command_ids.len(), 49);
    assert_eq!(bulk_actions.len(), 6);
    assert_eq!(print_subjects.len(), 3);
    assert_eq!(cases.len(), 69);
    assert_eq!(healthy_cases().len(), cases.len());
}
