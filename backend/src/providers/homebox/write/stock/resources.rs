//! Stock resource mappings from the wire3 stock.2 operation catalog and the
//! HomeBox Swagger artifact pinned to sysadminsmedia/homebox commit
//! e01dd737238a3fa7e1a6454b37de6c6fc88c86e4. Source/schema research is not runtime
//! qualification. No provider CAS, generated identity, clear form or native
//! time-value translation is inferred here.
//!
//! External link translation additionally follows pinned
//! backend/internal/data/repo/repo_item_attachments.go (SHA256
//! 32933019f370fc8a5dfc0fd7dfbe3173917d1c000ca64af7a9903cdafad3cfda):
//! source type `link` has MIME `link/url`; external ID becomes native `path` and
//! is exposed unchanged by ToItemAttachment. The pinned external handler
//! v1_ctrl_entities_attachments_external.go (SHA256
//! 52bcd0588f1eefb94a455602ba01dc1f8e9778350e67de6ff4f23daf95c3dc27)
//! checks HTTP/HTTPS before creation. These are public upstream references.

use super::types::{
    GeneratedIdentity, NativeBody, NativeMethod, NativePlan, Preparation, ReadbackSelector,
    ResourceKind, ResponseKind, StockCommand, StockMappingError, plan, readback,
};
use serde_json::{Map, Value};
use uuid::Uuid;

type BodyResult<T> = Result<T, &'static str>;

const TAG_FIELDS: &[&str] = &["name", "color", "description", "icon", "parentId"];
const MAINTENANCE_FIELDS: &[&str] = &[
    "name",
    "description",
    "cost",
    "scheduledDate",
    "completedDate",
];
const TYPE_FIELDS: &[&str] = &["name", "icon", "isLocation", "defaultTemplateId"];
const TEMPLATE_SCALARS: &[&str] = &[
    "name",
    "description",
    "notes",
    "defaultName",
    "defaultDescription",
    "defaultManufacturer",
    "defaultModelNumber",
    "defaultQuantity",
    "defaultInsured",
    "defaultLifetimeWarranty",
    "defaultWarrantyDetails",
    "includePurchaseFields",
    "includeSoldFields",
    "includeWarrantyFields",
];

fn object(value: &Value) -> BodyResult<&Map<String, Value>> {
    value.as_object().ok_or("resource-payload-object-required")
}

fn required<'a>(value: &'a Map<String, Value>, key: &str) -> BodyResult<&'a Value> {
    value.get(key).ok_or("native-resource-state-incomplete")
}

/// A complete, source-bound native observation is required for a whole PUT.
/// Omitted fields are never replaced with fabricated defaults.
fn preserved(current: &Value, fields: &[&str]) -> BodyResult<Map<String, Value>> {
    let current = object(current)?;
    let mut body = Map::new();
    for key in fields {
        body.insert((*key).to_owned(), required(current, key)?.clone());
    }
    Ok(body)
}

fn copy_present(payload: &Map<String, Value>, body: &mut Map<String, Value>, fields: &[&str]) {
    for key in fields {
        if let Some(value) = payload.get(*key) {
            body.insert((*key).to_owned(), value.clone());
        }
    }
}

fn bounded_native_string(value: &Value, max: usize) -> BodyResult<()> {
    match value.as_str() {
        Some(value) if value.chars().count() <= max => Ok(()),
        _ => Err("native-resource-string-limit"),
    }
}

fn body_tag(payload: &Value, current: Option<&Value>) -> BodyResult<Value> {
    let payload = object(payload)?;
    let mut body = match current {
        Some(current) => preserved(current, TAG_FIELDS)?,
        None => Map::new(),
    };
    copy_present(payload, &mut body, TAG_FIELDS);
    Ok(Value::Object(body))
}

fn body_maintenance(payload: &Value, current: Option<&Value>) -> BodyResult<Value> {
    let payload = object(payload)?;
    let mut body = match current {
        Some(current) => preserved(current, MAINTENANCE_FIELDS)?,
        None => Map::new(),
    };
    copy_present(payload, &mut body, MAINTENANCE_FIELDS);
    // The native artifact exposes string clocks, but no exact null-clear or
    // calendar-date translation. The common mapper supplies qualified forms.
    Ok(Value::Object(body))
}

fn body_type(payload: &Value, current: Option<&Value>) -> BodyResult<Value> {
    let payload = object(payload)?;
    let mut body = match current {
        Some(current) => preserved(current, TYPE_FIELDS)?,
        None => Map::new(),
    };
    copy_present(payload, &mut body, TYPE_FIELDS);
    Ok(Value::Object(body))
}

fn reference_id(value: &Value) -> BodyResult<Value> {
    object(value)?
        .get("resourceId")
        .or_else(|| value.get("id"))
        .cloned()
        .ok_or("native-template-reference-identity-missing")
}

fn reference_ids(value: &Value) -> BodyResult<Value> {
    let values = value
        .as_array()
        .ok_or("native-template-reference-array-required")?;
    values
        .iter()
        .map(reference_id)
        .collect::<BodyResult<Vec<_>>>()
        .map(Value::Array)
}

fn nullable_reference_id(value: &Value) -> BodyResult<Value> {
    if value.is_null() {
        Ok(Value::Null)
    } else {
        reference_id(value)
    }
}

/// The inspected stock template behavior does not qualify non-text custom
/// fields. Keep their explicit wire arms, but stop before native dispatch.
fn template_field(field: &Value) -> BodyResult<Value> {
    let field = object(field)?;
    let value = object(required(field, "value")?)?;
    if required(value, "kind")?.as_str() != Some("text") {
        return Err("native-template-non-text-field-unqualified");
    }
    let mut native = Map::new();
    if let Some(id) = field.get("id") {
        native.insert("id".into(), id.clone());
    }
    native.insert("name".into(), required(field, "name")?.clone());
    native.insert("type".into(), Value::String("text".into()));
    native.insert("textValue".into(), required(value, "value")?.clone());
    Ok(Value::Object(native))
}

fn existing_template_fields(
    current: &Map<String, Value>,
    hidden_fields_preserved: bool,
) -> BodyResult<Vec<Value>> {
    let fields = required(current, "fields")?
        .as_array()
        .ok_or("native-template-fields-required")?;
    let mut projected = Vec::with_capacity(fields.len());
    let mut ids = Vec::with_capacity(fields.len());
    for field in fields {
        let field = object(field)?;
        let kind = required(field, "type")?
            .as_str()
            .ok_or("native-template-field-type-required")?;
        if !matches!(kind, "text" | "number" | "boolean" | "time") {
            return Err("native-template-field-type-unavailable");
        }
        if kind != "text" && !hidden_fields_preserved {
            return Err("native-template-non-text-field-preservation-unqualified");
        }
        let id = required(field, "id")?
            .as_str()
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or("native-template-field-identity-missing")?;
        if ids.contains(&id) {
            return Err("native-template-field-identity-ambiguous");
        }
        ids.push(id);
        required(field, "name")?;
        if kind == "text" {
            required(field, "textValue")?;
        }
        let mut native = Map::new();
        copy_present(
            field,
            &mut native,
            &[
                "id",
                "name",
                "type",
                "textValue",
                "numberValue",
                "booleanValue",
                "timeValue",
            ],
        );
        projected.push(Value::Object(native));
    }
    Ok(projected)
}

fn template_field_changes(fields: &mut Vec<Value>, changes: &Value) -> BodyResult<()> {
    let changes = changes
        .as_array()
        .ok_or("native-template-field-changes-required")?;
    for change in changes {
        let change = object(change)?;
        match required(change, "op")?.as_str() {
            Some("create") => fields.push(template_field(required(change, "field")?)?),
            Some("update") | Some("delete") => {
                let id = required(change, "fieldId")?;
                let index = fields
                    .iter()
                    .position(|field| field.get("id") == Some(id))
                    .ok_or("native-template-field-identity-missing")?;
                if required(change, "op")?.as_str() == Some("delete") {
                    fields.remove(index);
                    continue;
                }
                let changes = object(required(change, "changes")?)?;
                let field = fields[index]
                    .as_object_mut()
                    .ok_or("native-template-field-object-required")?;
                if field.get("type").and_then(Value::as_str) != Some("text") {
                    return Err("native-template-non-text-field-update-unqualified");
                }
                if let Some(name) = changes.get("name") {
                    field.insert("name".into(), name.clone());
                }
                if let Some(value) = changes.get("value") {
                    let value = object(value)?;
                    if required(value, "kind")?.as_str() != Some("text") {
                        return Err("native-template-non-text-field-unqualified");
                    }
                    field.insert("type".into(), Value::String("text".into()));
                    field.insert("textValue".into(), required(value, "value")?.clone());
                }
            }
            _ => return Err("native-template-field-operation-unavailable"),
        }
    }
    Ok(())
}

fn template_payload(payload: &Map<String, Value>, body: &mut Map<String, Value>) -> BodyResult<()> {
    copy_present(payload, body, TEMPLATE_SCALARS);
    for (wire, native) in [
        ("includePurchaseDetails", "includePurchaseFields"),
        ("includeSoldDetails", "includeSoldFields"),
        ("includeWarrantyDetails", "includeWarrantyFields"),
    ] {
        if let Some(value) = payload.get(wire) {
            body.insert(native.into(), value.clone());
        }
    }
    if let Some(location) = payload.get("defaultLocation") {
        body.insert("defaultLocationId".into(), nullable_reference_id(location)?);
    }
    if let Some(tags) = payload.get("defaultTags") {
        body.insert("defaultTagIds".into(), reference_ids(tags)?);
    }
    for name in ["notes", "defaultWarrantyDetails"] {
        if let Some(value) = body.get(name).filter(|value| !value.is_null()) {
            // Wire3 allows 4096; the pinned native payload limit is 1000.
            bounded_native_string(value, 1000)?;
        }
    }
    Ok(())
}

fn body_template(
    payload: &Value,
    current: Option<&Value>,
    hidden_fields_preserved: bool,
) -> BodyResult<Value> {
    let payload = object(payload)?;
    let (mut body, mut fields) = match current {
        Some(current) => {
            let mut body = preserved(current, TEMPLATE_SCALARS)?;
            let current = object(current)?;
            body.insert(
                "defaultLocationId".into(),
                nullable_reference_id(required(current, "defaultLocation")?)?,
            );
            body.insert(
                "defaultTagIds".into(),
                reference_ids(required(current, "defaultTags")?)?,
            );
            (
                body,
                existing_template_fields(current, hidden_fields_preserved)?,
            )
        }
        None => (Map::new(), Vec::new()),
    };
    template_payload(payload, &mut body)?;
    if let Some(created) = payload.get("fields") {
        fields = created
            .as_array()
            .ok_or("native-template-fields-required")?
            .iter()
            .map(template_field)
            .collect::<BodyResult<Vec<_>>>()?;
    }
    if let Some(changes) = payload.get("fieldChanges") {
        template_field_changes(&mut fields, changes)?;
    }
    if fields.len() > 100 {
        return Err("native-template-field-limit");
    }
    body.insert("fields".into(), Value::Array(fields));
    Ok(Value::Object(body))
}

fn limitation(error: &'static str) -> StockMappingError {
    StockMappingError::NativeLimitation(error)
}

fn json_body(value: BodyResult<Value>) -> Result<NativeBody, StockMappingError> {
    value.map(NativeBody::Json).map_err(limitation)
}

fn with_id(body: NativeBody, id: Uuid) -> Result<NativeBody, StockMappingError> {
    match body {
        NativeBody::Json(Value::Object(mut body)) => {
            body.insert("id".into(), Value::String(id.to_string()));
            Ok(NativeBody::Json(Value::Object(body)))
        }
        _ => Err(StockMappingError::InvalidNativeInput),
    }
}

fn expected(body: &NativeBody) -> Value {
    match body {
        NativeBody::Json(Value::Object(body)) => {
            let mut expected = body.clone();
            expected.remove("id");
            Value::Object(expected)
        }
        _ => Value::Object(Map::new()),
    }
}

fn identity(value: &Value, id: Uuid) -> Result<(), StockMappingError> {
    let observed = value
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if observed == Some(id) {
        Ok(())
    } else {
        Err(StockMappingError::ObservationConflict)
    }
}

fn snapshot<'a>(
    command: &StockCommand,
    preparation: &'a Preparation,
) -> Result<&'a Value, StockMappingError> {
    let snapshot = preparation.snapshot(&command.target)?;
    identity(&snapshot.value, command.target.id()?)?;
    Ok(&snapshot.value)
}

fn attachment_snapshot<'a>(
    command: &StockCommand,
    preparation: &'a Preparation,
) -> Result<(&'a Value, Vec<Uuid>), StockMappingError> {
    let owner = command.target.owner_target()?;
    let snapshot = preparation.snapshot(&owner)?;
    identity(&snapshot.value, owner.id()?)?;
    let attachments = snapshot
        .value
        .get("attachments")
        .and_then(Value::as_array)
        .ok_or(StockMappingError::CompleteNativeObservationRequired)?;
    let mut ids = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        let id = attachment
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or(StockMappingError::InvalidNativeInput)?;
        if id.is_nil() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        if ids.contains(&id) {
            return Err(StockMappingError::ObservationConflict);
        }
        ids.push(id);
    }
    Ok((&snapshot.value, ids))
}

fn existing_attachment<'a>(
    command: &StockCommand,
    owner: &'a Value,
) -> Result<&'a Value, StockMappingError> {
    let id = command.target.id()?;
    owner
        .get("attachments")
        .and_then(Value::as_array)
        .and_then(|members| {
            members.iter().find(|member| {
                member
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == Some(id)
            })
        })
        .ok_or(StockMappingError::ObservationConflict)
}

fn attachment_kind(command: &StockCommand, current: &Value) -> Result<(), StockMappingError> {
    let mime = current
        .get("mimeType")
        .and_then(Value::as_str)
        .ok_or(StockMappingError::CompleteNativeObservationRequired)?;
    let link_command = command.command_id.starts_with("homebox.document-link.");
    if link_command != (mime == "link/url") {
        return Err(StockMappingError::ObservationConflict);
    }
    Ok(())
}

fn body_attachment_update(payload: &Value, current: &Value) -> BodyResult<Value> {
    let mut body = preserved(current, &["title", "type", "primary"])?;
    copy_present(object(payload)?, &mut body, &["title", "type", "primary"]);
    Ok(Value::Object(body))
}

fn no_native_null(payload: &Value, fields: &[&str]) -> Result<(), StockMappingError> {
    for field in fields {
        if payload.get(*field).is_some_and(Value::is_null) {
            return Err(limitation("native-null-clear-form-unestablished"));
        }
    }
    Ok(())
}

fn qualified_clear_body(
    command: &StockCommand,
    preparation: &Preparation,
    mut body: NativeBody,
    fields: &[&str],
) -> Result<NativeBody, StockMappingError> {
    for field in fields {
        if command.payload.get(*field).is_some_and(Value::is_null) {
            // Both native maintenance clocks and native reference IDs use
            // string DTOs. No null-to-empty/zero/root conversion is invented.
            let native = preparation.clear(&command.command_id, field)?;
            if !native.is_string() {
                return Err(StockMappingError::InvalidNativeInput);
            }
            let NativeBody::Json(Value::Object(values)) = &mut body else {
                return Err(StockMappingError::InvalidNativeInput);
            };
            values.insert((*field).into(), native.clone());
        }
    }
    Ok(body)
}

fn template_references(command: &StockCommand) -> Result<(), StockMappingError> {
    let check = |reference: &Value, kind: &str| -> Result<(), StockMappingError> {
        let source = reference
            .get("sourceInstanceId")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let collection = reference
            .get("collectionId")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if source != Some(command.target.source_instance_id)
            || collection != Some(command.target.collection_id)
            || reference.get("authority").and_then(Value::as_str) != Some("homebox")
            || reference.get("resourceKind").and_then(Value::as_str) != Some(kind)
        {
            return Err(StockMappingError::InvalidNativeInput);
        }
        Ok(())
    };
    if let Some(location) = command
        .payload
        .get("defaultLocation")
        .filter(|value| !value.is_null())
    {
        check(location, "entity")?;
    }
    if let Some(tags) = command.payload.get("defaultTags") {
        for tag in tags
            .as_array()
            .ok_or(StockMappingError::InvalidNativeInput)?
        {
            check(tag, "tag")?;
        }
    }
    Ok(())
}

fn resource_delete(
    command: &StockCommand,
    path: String,
    read_path: String,
    selector: ReadbackSelector,
) -> NativePlan {
    plan(
        command,
        NativeMethod::Delete,
        path,
        NativeBody::None,
        ResponseKind::NoContent,
        readback(command, read_path, selector, Value::Null, true),
        GeneratedIdentity::None,
    )
}

/// Native known-field projection for response/readback comparison. The exact
/// target/owner identity is checked separately; timestamps are not rewritten.
pub(super) fn writable_resource(
    kind: ResourceKind,
    value: &Value,
) -> Result<Value, StockMappingError> {
    match kind {
        ResourceKind::Tag => preserved(value, TAG_FIELDS)
            .map(Value::Object)
            .map_err(limitation),
        ResourceKind::Attachment => {
            let mut fields = preserved(value, &["title", "type", "primary"]).map_err(limitation)?;
            copy_present(
                object(value).map_err(limitation)?,
                &mut fields,
                &["path", "mimeType"],
            );
            Ok(Value::Object(fields))
        }
        ResourceKind::Maintenance => preserved(value, MAINTENANCE_FIELDS)
            .map(Value::Object)
            .map_err(limitation),
        ResourceKind::EntityType => preserved(value, TYPE_FIELDS)
            .map(Value::Object)
            .map_err(limitation),
        ResourceKind::Template => {
            // Readback projection is distinct from submitting a PUT. The
            // template update mapping checks trusted preservation evidence.
            body_template(&Value::Object(Map::new()), Some(value), true).map_err(limitation)
        }
        _ => Err(StockMappingError::UnsupportedOperation),
    }
}

pub(super) fn map(
    command: &StockCommand,
    preparation: &Preparation,
) -> Result<Option<NativePlan>, StockMappingError> {
    let id_path = |kind: &str| -> Result<String, StockMappingError> {
        Ok(format!("/api/v1/{kind}/{}", command.target.id()?))
    };
    let mut mapped = match command.command_id.as_str() {
        "homebox.tag.create" => {
            let body = json_body(body_tag(&command.payload, None))?;
            let read = readback(
                command,
                "/api/v1/tags/{generatedId}".into(),
                ReadbackSelector::Whole,
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Post,
                "/api/v1/tags".into(),
                body,
                ResponseKind::Tag,
                read,
                GeneratedIdentity::DirectResponse,
            )
        }
        "homebox.tag.update" => {
            let current = snapshot(command, preparation)?;
            let body = with_id(
                json_body(body_tag(&command.payload, Some(current)))?,
                command.target.id()?,
            )?;
            let path = id_path("tags")?;
            let read = readback(
                command,
                path.clone(),
                ReadbackSelector::Whole,
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Put,
                path,
                body,
                ResponseKind::Tag,
                read,
                GeneratedIdentity::None,
            )
        }
        "homebox.tag.delete" => {
            snapshot(command, preparation)?;
            let path = id_path("tags")?;
            resource_delete(command, path.clone(), path, ReadbackSelector::Whole)
        }
        "homebox.file.upload" => {
            let (_, before_ids) = attachment_snapshot(command, preparation)?;
            let stage = preparation
                .staged_upload
                .clone()
                .ok_or(StockMappingError::StageMismatch)?;
            let staged =
                serde_json::to_value(&stage).map_err(|_| StockMappingError::InvalidNativeInput)?;
            if command.payload.get("staged") != Some(&staged) {
                return Err(StockMappingError::StageMismatch);
            }
            let payload = object(&command.payload).map_err(limitation)?;
            let attachment_type = required(payload, "type")
                .map_err(limitation)?
                .as_str()
                .ok_or(StockMappingError::InvalidNativeInput)?;
            let primary = required(payload, "primary")
                .map_err(limitation)?
                .as_bool()
                .ok_or(StockMappingError::InvalidNativeInput)?;
            let owner = command.target.owner()?;
            let expected = serde_json::json!({"title":stage.filename.clone(),"type":attachment_type,"primary":primary});
            let fields = vec![
                ("name".into(), stage.filename.clone()),
                ("type".into(), attachment_type.into()),
                ("primary".into(), primary.to_string()),
            ];
            let read = readback(
                command,
                format!("/api/v1/entities/{owner}"),
                ReadbackSelector::Member {
                    field: "attachments".into(),
                },
                expected,
                false,
            );
            plan(
                command,
                NativeMethod::Post,
                format!("/api/v1/entities/{owner}/attachments"),
                NativeBody::Multipart {
                    file_field: "file".into(),
                    stage,
                    fields,
                },
                ResponseKind::Entity,
                read,
                GeneratedIdentity::EntityMember {
                    field: "attachments".into(),
                    before_ids,
                },
            )
        }
        "homebox.file.update" | "homebox.document-link.update" => {
            let (owner, _) = attachment_snapshot(command, preparation)?;
            let current = existing_attachment(command, owner)?;
            attachment_kind(command, current)?;
            let body = json_body(body_attachment_update(&command.payload, current))?;
            let read = readback(
                command,
                format!("/api/v1/entities/{}", command.target.owner()?),
                ReadbackSelector::Member {
                    field: "attachments".into(),
                },
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Put,
                format!(
                    "/api/v1/entities/{}/attachments/{}",
                    command.target.owner()?,
                    command.target.id()?
                ),
                body,
                ResponseKind::Entity,
                read,
                GeneratedIdentity::None,
            )
        }
        "homebox.file.delete" | "homebox.document-link.delete" => {
            let (owner, _) = attachment_snapshot(command, preparation)?;
            attachment_kind(command, existing_attachment(command, owner)?)?;
            resource_delete(
                command,
                format!(
                    "/api/v1/entities/{}/attachments/{}",
                    command.target.owner()?,
                    command.target.id()?
                ),
                format!("/api/v1/entities/{}", command.target.owner()?),
                ReadbackSelector::Member {
                    field: "attachments".into(),
                },
            )
        }
        "homebox.document-link.create" => {
            let (_, before_ids) = attachment_snapshot(command, preparation)?;
            let payload = object(&command.payload).map_err(limitation)?;
            let title = required(payload, "title").map_err(limitation)?;
            let url = required(payload, "url").map_err(limitation)?;
            let attachment_type = required(payload, "attachmentType").map_err(limitation)?;
            let body = NativeBody::Json(serde_json::json!({"title":title,"source_type":"link",
                "external_id":url,"attachment_type":attachment_type}));
            let owner = command.target.owner()?;
            let expected = serde_json::json!({"title":title,"type":attachment_type,
                "path":url,"mimeType":"link/url"});
            let read = readback(
                command,
                format!("/api/v1/entities/{owner}"),
                ReadbackSelector::Member {
                    field: "attachments".into(),
                },
                expected,
                false,
            );
            plan(
                command,
                NativeMethod::Post,
                format!("/api/v1/entities/{owner}/attachments/external"),
                body,
                ResponseKind::Entity,
                read,
                GeneratedIdentity::EntityMember {
                    field: "attachments".into(),
                    before_ids,
                },
            )
        }
        "homebox.maintenance.create" => {
            let body = qualified_clear_body(
                command,
                preparation,
                json_body(body_maintenance(&command.payload, None))?,
                &["scheduledDate", "completedDate"],
            )?;
            let path = format!("/api/v1/entities/{}/maintenance", command.target.owner()?);
            let mut read = readback(
                command,
                path.clone(),
                ReadbackSelector::RootList,
                expected(&body),
                false,
            );
            read.query.push(("status".into(), "both".into()));
            plan(
                command,
                NativeMethod::Post,
                path,
                body,
                ResponseKind::Maintenance,
                read,
                GeneratedIdentity::DirectResponse,
            )
        }
        "homebox.maintenance.update"
        | "homebox.maintenance.schedule"
        | "homebox.maintenance.complete"
        | "homebox.maintenance.reopen" => {
            let current = snapshot(command, preparation)?;
            let body = qualified_clear_body(
                command,
                preparation,
                json_body(body_maintenance(&command.payload, Some(current)))?,
                &["scheduledDate", "completedDate"],
            )?;
            let mut read = readback(
                command,
                format!("/api/v1/entities/{}/maintenance", command.target.owner()?),
                ReadbackSelector::RootList,
                expected(&body),
                false,
            );
            read.query.push(("status".into(), "both".into()));
            plan(
                command,
                NativeMethod::Put,
                id_path("maintenance")?,
                body,
                ResponseKind::Maintenance,
                read,
                GeneratedIdentity::None,
            )
        }
        "homebox.maintenance.delete" => {
            snapshot(command, preparation)?;
            let mut mapped = resource_delete(
                command,
                id_path("maintenance")?,
                format!("/api/v1/entities/{}/maintenance", command.target.owner()?),
                ReadbackSelector::RootList,
            );
            mapped.readback.query.push(("status".into(), "both".into()));
            mapped
        }
        "homebox.entity-type.create" => {
            let body = qualified_clear_body(
                command,
                preparation,
                json_body(body_type(&command.payload, None))?,
                &["defaultTemplateId"],
            )?;
            let read = readback(
                command,
                "/api/v1/entity-types".into(),
                ReadbackSelector::RootList,
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Post,
                "/api/v1/entity-types".into(),
                body,
                ResponseKind::EntityType,
                read,
                GeneratedIdentity::DirectResponse,
            )
        }
        "homebox.entity-type.update" => {
            let current = snapshot(command, preparation)?;
            let body = with_id(
                qualified_clear_body(
                    command,
                    preparation,
                    json_body(body_type(&command.payload, Some(current)))?,
                    &["defaultTemplateId"],
                )?,
                command.target.id()?,
            )?;
            let read = readback(
                command,
                "/api/v1/entity-types".into(),
                ReadbackSelector::RootList,
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Put,
                id_path("entity-types")?,
                body,
                ResponseKind::EntityType,
                read,
                GeneratedIdentity::None,
            )
        }
        "homebox.entity-type.delete" => {
            snapshot(command, preparation)?;
            resource_delete(
                command,
                id_path("entity-types")?,
                "/api/v1/entity-types".into(),
                ReadbackSelector::RootList,
            )
        }
        "homebox.template.create" => {
            template_references(command)?;
            no_native_null(
                &command.payload,
                &[
                    "defaultName",
                    "defaultDescription",
                    "defaultManufacturer",
                    "defaultModelNumber",
                    "defaultQuantity",
                    "defaultWarrantyDetails",
                    "defaultLocation",
                ],
            )?;
            let body = json_body(body_template(&command.payload, None, false))?;
            let read = readback(
                command,
                "/api/v1/templates/{generatedId}".into(),
                ReadbackSelector::Whole,
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Post,
                "/api/v1/templates".into(),
                body,
                ResponseKind::Template,
                read,
                GeneratedIdentity::DirectResponse,
            )
        }
        "homebox.template.update" => {
            template_references(command)?;
            no_native_null(
                &command.payload,
                &[
                    "defaultName",
                    "defaultDescription",
                    "defaultManufacturer",
                    "defaultModelNumber",
                    "defaultQuantity",
                    "defaultWarrantyDetails",
                    "defaultLocation",
                ],
            )?;
            let current = snapshot(command, preparation)?;
            let hidden = preparation
                .snapshot(&command.target)?
                .hidden_fields_preserved;
            let body = with_id(
                json_body(body_template(&command.payload, Some(current), hidden))?,
                command.target.id()?,
            )?;
            let path = id_path("templates")?;
            let read = readback(
                command,
                path.clone(),
                ReadbackSelector::Whole,
                expected(&body),
                false,
            );
            plan(
                command,
                NativeMethod::Put,
                path,
                body,
                ResponseKind::Template,
                read,
                GeneratedIdentity::None,
            )
        }
        "homebox.template.delete" => {
            snapshot(command, preparation)?;
            let path = id_path("templates")?;
            resource_delete(command, path.clone(), path, ReadbackSelector::Whole)
        }
        "homebox.template.create-item" => {
            snapshot(command, preparation)?;
            let body = qualified_clear_body(
                command,
                preparation,
                NativeBody::Json(command.payload.clone()),
                &["parentId"],
            )?;
            let mut read = readback(
                command,
                "/api/v1/entities/{generatedId}".into(),
                ReadbackSelector::Whole,
                expected(&body),
                false,
            );
            read.target.resource_kind = ResourceKind::Entity;
            read.target.resource_id = None;
            plan(
                command,
                NativeMethod::Post,
                format!("{}/create-item", id_path("templates")?),
                body,
                ResponseKind::Entity,
                read,
                GeneratedIdentity::DirectResponse,
            )
        }
        _ => return Ok(None),
    };
    if command.command_id == "homebox.entity-type.update"
        || command.payload.get("primary").is_some()
        || command
            .payload
            .get("fieldChanges")
            .and_then(Value::as_array)
            .is_some_and(|changes| {
                changes
                    .iter()
                    .any(|change| change.get("op").and_then(Value::as_str) == Some("delete"))
            })
    {
        mapped.requires_complete_impact = true;
    }
    Ok(Some(mapped))
}
