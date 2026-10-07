//! Stock entity/location mappings. Native behavior is pinned to HomeBox commit
//! e01dd737238a3fa7e1a6454b37de6c6fc88c86e4, repo_entities.go and types/date.go.
//! PUT replaces scalars, tags and fields and can propagate the stored sync flag;
//! only an attested complete preparation can supply its preserved values.
use super::types::*;
use serde_json::{Map, Value};
use uuid::Uuid;

const STRING_FIELDS: &[&str] = &[
    "assetId",
    "name",
    "description",
    "manufacturer",
    "modelNumber",
    "serialNumber",
    "notes",
    "purchaseFrom",
    "soldTo",
    "soldNotes",
    "warrantyDetails",
    "purchaseDate",
    "soldDate",
    "warrantyExpires",
];
const BOOL_FIELDS: &[&str] = &[
    "archived",
    "insured",
    "lifetimeWarranty",
    "syncChildEntityLocations",
];
const NUMBER_FIELDS: &[&str] = &["quantity", "purchasePrice", "soldPrice"];
const CREATE_FIELDS: &[&str] = &[
    "name",
    "description",
    "entityTypeId",
    "parentId",
    "quantity",
    "tagIds",
];
const DUPLICATE_FIELDS: &[&str] = &[
    "copyAttachments",
    "copyCustomFields",
    "copyMaintenance",
    "copyPrefix",
];

pub(super) fn map(
    command: &StockCommand,
    preparation: &Preparation,
) -> Result<Option<NativePlan>, StockMappingError> {
    let id = command.command_id.as_str();
    let operation = match id {
        "homebox.entity.create" | "homebox.location.create" => "create",
        "homebox.entity.update" | "homebox.location.update" => "update",
        "homebox.entity.archive" | "homebox.location.archive" => "archive",
        "homebox.entity.unarchive" | "homebox.location.unarchive" => "unarchive",
        "homebox.entity.reparent" | "homebox.location.reparent" => "reparent",
        "homebox.entity.delete" | "homebox.location.delete" => "delete",
        "homebox.entity.duplicate" | "homebox.location.duplicate" => "duplicate",
        "homebox.entity.children.sync" | "homebox.location.children.sync" => "sync",
        "homebox.entity.quantity.set" => "quantity",
        "homebox.entity.type.set" => "type",
        "homebox.entity.tags.set" => "tags-set",
        "homebox.entity.tags.add" => "tags-add",
        "homebox.entity.tags.remove" => "tags-remove",
        "homebox.field.create" => "field-create",
        "homebox.field.update" => "field-update",
        "homebox.field.delete" => "field-delete",
        _ => return Ok(None),
    };
    object(&command.payload)?;
    if operation.starts_with("field-") {
        return map_field(command, preparation, operation).map(Some);
    }
    if command.target.resource_kind != ResourceKind::Entity {
        return Err(StockMappingError::InvalidNativeInput);
    }
    if operation == "update" {
        requested_native_values(&command.payload)?;
    }
    if operation == "create" {
        if command.target.resource_id.is_some() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        let body = Value::Object(copy_fields(&command.payload, CREATE_FIELDS)?);
        nonzero_uuid(required(&body, "entityTypeId")?)?;
        nullable_parent(required(&body, "parentId")?)?;
        ids(required(&body, "tagIds")?)?;
        finite_nonnegative(required(&body, "quantity")?)?;
        return Ok(Some(plan(
            command,
            NativeMethod::Post,
            "/api/v1/entities".to_owned(),
            NativeBody::Json(body.clone()),
            ResponseKind::Entity,
            readback(
                command,
                "/api/v1/entities/{generatedId}".to_owned(),
                ReadbackSelector::Whole,
                body,
                false,
            ),
            GeneratedIdentity::DirectResponse,
        )));
    }

    let target_id = command.target.id()?;
    let snapshot = entity_snapshot(preparation, &command.target)?;
    let path = format!("/api/v1/entities/{target_id}");
    match operation {
        "delete" => Ok(Some(plan(
            command,
            NativeMethod::Delete,
            path.clone(),
            NativeBody::None,
            ResponseKind::NoContent,
            readback(command, path, ReadbackSelector::Whole, Value::Null, true),
            GeneratedIdentity::None,
        ))),
        "duplicate" => {
            let body = Value::Object(copy_fields(&command.payload, DUPLICATE_FIELDS)?);
            let mut mapped = plan(
                command,
                NativeMethod::Post,
                format!("{path}/duplicate"),
                NativeBody::Json(body),
                ResponseKind::Entity,
                readback(
                    command,
                    "/api/v1/entities/{generatedId}".to_owned(),
                    ReadbackSelector::Whole,
                    Value::Object(Map::new()),
                    false,
                ),
                GeneratedIdentity::DirectResponse,
            );
            // Copy options can create attachment/maintenance/field descendants.
            mapped.requires_complete_impact = true;
            Ok(Some(mapped))
        }
        "quantity" => {
            finite_nonnegative(required(&command.payload, "quantity")?)?;
            Ok(Some(patch(
                command,
                path,
                copy_fields(&command.payload, &["quantity"])?,
            )))
        }
        "type" => {
            nonzero_uuid(required(&command.payload, "entityTypeId")?)?;
            Ok(Some(patch(
                command,
                path,
                copy_fields(&command.payload, &["entityTypeId"])?,
            )))
        }
        "tags-set" | "tags-add" | "tags-remove" => {
            let wanted = ids(required(&command.payload, "tagIds")?)?;
            let current = relation_ids(&snapshot.value, "tags")?;
            let next = match operation {
                "tags-set" => wanted,
                "tags-add" => {
                    let mut next = current;
                    for wanted_id in wanted {
                        if !next.contains(&wanted_id) {
                            next.push(wanted_id);
                        }
                    }
                    next
                }
                _ => current
                    .into_iter()
                    .filter(|value| !wanted.contains(value))
                    .collect(),
            };
            if next.len() > 100 {
                return Err(StockMappingError::NativeLimitation(
                    "native-tag-set-exceeds-wire-bound",
                ));
            }
            let body = Map::from_iter([("tagIds".to_owned(), uuid_array(&next))]);
            Ok(Some(patch(command, path, body)))
        }
        "reparent" => {
            preserve_sync(command, &snapshot.value)?;
            let parent = required(&command.payload, "parentId")?;
            if nullable_parent(parent)?.is_some() {
                return Ok(Some(patch(
                    command,
                    path,
                    copy_fields(&command.payload, &["parentId"])?,
                )));
            }
            // PATCH nil/null is a native no-op; only preserved PUT clears root.
            let mut body = object(&writable_entity(
                &snapshot.value,
                snapshot.hidden_fields_preserved,
            )?)?
            .clone();
            body.insert("parentId".to_owned(), Value::Null);
            Ok(Some(put(command, path, body)))
        }
        "update" | "archive" | "unarchive" | "sync" => {
            if operation != "sync" {
                preserve_sync(command, &snapshot.value)?;
            }
            let mut body = object(&writable_entity(
                &snapshot.value,
                snapshot.hidden_fields_preserved,
            )?)?
            .clone();
            match operation {
                "archive" | "unarchive" => {
                    body.insert("archived".to_owned(), Value::Bool(operation == "archive"));
                }
                "sync" => {
                    if string(&command.payload, "propagation")? != "native-if-non-null-parent" {
                        return Err(StockMappingError::NativeLimitation(
                            "native-child-sync-variant",
                        ));
                    }
                    let enabled = required(&command.payload, "syncChildEntityLocations")?
                        .as_bool()
                        .ok_or(StockMappingError::InvalidNativeInput)?;
                    body.insert("syncChildEntityLocations".to_owned(), Value::Bool(enabled));
                }
                _ => {
                    for (key, value) in object(&command.payload)? {
                        if !STRING_FIELDS.contains(&key.as_str())
                            && !BOOL_FIELDS.contains(&key.as_str())
                            && !matches!(key.as_str(), "purchasePrice" | "soldPrice")
                        {
                            return Err(StockMappingError::InvalidNativeInput);
                        }
                        let mapped = if value.is_null()
                            && matches!(
                                key.as_str(),
                                "purchasePrice"
                                    | "soldPrice"
                                    | "purchaseDate"
                                    | "soldDate"
                                    | "warrantyExpires"
                            ) {
                            // Preserve wire null in intent; only the trusted peer
                            // can qualify its exact native clear representation.
                            preparation.clear(&command.command_id, key)?.clone()
                        } else {
                            value.clone()
                        };
                        body.insert(key.clone(), mapped);
                    }
                }
            }
            Ok(Some(put(command, path, body)))
        }
        _ => Err(StockMappingError::UnsupportedOperation),
    }
}

fn patch(command: &StockCommand, path: String, body: Map<String, Value>) -> NativePlan {
    let expected = Value::Object(body);
    plan(
        command,
        NativeMethod::Patch,
        path.clone(),
        NativeBody::Json(expected.clone()),
        ResponseKind::Entity,
        readback(command, path, ReadbackSelector::Whole, expected, false),
        GeneratedIdentity::None,
    )
}

fn put(command: &StockCommand, path: String, body: Map<String, Value>) -> NativePlan {
    let has_native_sync = body
        .get("syncChildEntityLocations")
        .and_then(Value::as_bool)
        == Some(true);
    let expected = Value::Object(body);
    let mut mapped = plan(
        command,
        NativeMethod::Put,
        path.clone(),
        NativeBody::Json(expected.clone()),
        ResponseKind::Entity,
        readback(command, path, ReadbackSelector::Whole, expected, false),
        GeneratedIdentity::None,
    );
    // Even unrelated full PUT can exercise native child propagation.
    mapped.requires_complete_impact |= has_native_sync;
    mapped
}

fn entity_snapshot<'a>(
    preparation: &'a Preparation,
    target: &StockTarget,
) -> Result<&'a NativeSnapshot, StockMappingError> {
    let snapshot = preparation.snapshot(target)?;
    if nonzero_uuid(required(&snapshot.value, "id")?)? != target.id()? {
        return Err(StockMappingError::ObservationConflict);
    }
    Ok(snapshot)
}

fn preserve_sync(command: &StockCommand, value: &Value) -> Result<(), StockMappingError> {
    let actual = required(value, "syncChildEntityLocations")?
        .as_bool()
        .ok_or(StockMappingError::InvalidNativeInput)?;
    let observed = command
        .native_sync_behavior
        .ok_or(StockMappingError::InvalidNativeInput)?;
    if actual == observed {
        Ok(())
    } else {
        Err(StockMappingError::ObservationConflict)
    }
}

/// Project the complete native EntityOut to the writable EntityUpdate shape.
/// Missing scalar data is never filled with a destructive default. The peer's
/// attestation covers native fields/date details hidden by EntityOut itself.
pub(super) fn writable_entity(
    value: &Value,
    hidden_fields_preserved: bool,
) -> Result<Value, StockMappingError> {
    if !hidden_fields_preserved {
        return Err(StockMappingError::NativeLimitation(
            "native-entity-hidden-fields-unproven",
        ));
    }
    let mut body = Map::new();
    body.insert(
        "id".to_owned(),
        Value::String(nonzero_uuid(required(value, "id")?)?.to_string()),
    );
    for name in STRING_FIELDS {
        let scalar = required(value, name)?;
        if !scalar.is_string() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        body.insert((*name).to_owned(), scalar.clone());
    }
    for name in BOOL_FIELDS {
        let scalar = required(value, name)?;
        if !scalar.is_boolean() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        body.insert((*name).to_owned(), scalar.clone());
    }
    for name in NUMBER_FIELDS {
        let scalar = required(value, name)?;
        if !scalar.as_f64().is_some_and(f64::is_finite) {
            return Err(StockMappingError::InvalidNativeInput);
        }
        body.insert((*name).to_owned(), scalar.clone());
    }
    let parent = object(value)?.get("parent");
    body.insert(
        "parentId".to_owned(),
        match parent {
            None | Some(Value::Null) => Value::Null,
            Some(parent) => Value::String(nonzero_uuid(required(parent, "id")?)?.to_string()),
        },
    );
    if let Some(entity_type) = object(value)?
        .get("entityType")
        .filter(|value| !value.is_null())
    {
        body.insert(
            "entityTypeId".to_owned(),
            Value::String(nonzero_uuid(required(entity_type, "id")?)?.to_string()),
        );
    }
    body.insert(
        "tagIds".to_owned(),
        uuid_array(&relation_ids(value, "tags")?),
    );
    let fields = native_fields(required(value, "fields")?)?;
    body.insert("fields".to_owned(), Value::Array(fields));
    Ok(Value::Object(body))
}

/// Native AssetID is a signed int64; its decoder removes quote/hyphen bytes
/// before decimal parsing, and its formatter emits an empty string for <=0.
/// Positive output is zero-padded to at least six digits with a separator
/// after the first three. Pinned repo/asset_id_type.go, lines 9–60 (SHA256
/// d23271c5b18e8bd60afa22d169e0e8d7519cc191ced3d9ec2a35598711c25757).
/// This value is only a writable scalar comparison, never a target identity.
pub(super) fn native_asset_id(value: &Value) -> Option<i64> {
    let value = value.as_str()?;
    if value.is_empty() {
        return Some(0);
    }
    value
        .chars()
        .filter(|character| *character != '"' && *character != '-')
        .collect::<String>()
        .parse::<i64>()
        .ok()
        .map(|value| value.max(0))
}

fn requested_native_values(payload: &Value) -> Result<(), StockMappingError> {
    if let Some(asset_id) = payload.get("assetId")
        && !native_asset_id(asset_id).is_some_and(|value| value > 0)
    {
        // A caller's nonempty zero identifier disappears in native output;
        // an oversized decimal cannot fit the actual stored AssetID type.
        return Err(StockMappingError::NativeLimitation(
            "native-asset-id-requires-positive-signed-64-bit-value",
        ));
    }
    for field in ["purchaseDate", "soldDate", "warrantyExpires"] {
        if payload.get(field).and_then(Value::as_str) == Some("0001-01-01") {
            // DateFromTime produces Go's zero time for this explicit value;
            // repo_entities.go lines 1503–1519 clear rather than persist it.
            // Only caller payload is checked: observed sentinel preservation
            // and qualified wire-null clear representations remain untouched.
            return Err(StockMappingError::NativeLimitation(
                "native-explicit-date-is-unset-sentinel",
            ));
        }
    }
    Ok(())
}

fn map_field(
    command: &StockCommand,
    preparation: &Preparation,
    operation: &str,
) -> Result<NativePlan, StockMappingError> {
    if command.target.resource_kind != ResourceKind::Field {
        return Err(StockMappingError::InvalidNativeInput);
    }
    let owner = command.target.owner_target()?;
    let snapshot = entity_snapshot(preparation, &owner)?;
    preserve_sync(command, &snapshot.value)?;
    let mut body = object(&writable_entity(
        &snapshot.value,
        snapshot.hidden_fields_preserved,
    )?)?
    .clone();
    let mut fields = body
        .get("fields")
        .ok_or(StockMappingError::InvalidNativeInput)?
        .as_array()
        .ok_or(StockMappingError::InvalidNativeInput)?
        .clone();
    let before_ids = fields
        .iter()
        .map(|field| nonzero_uuid(required(field, "id")?))
        .collect::<Result<Vec<_>, _>>()?;
    let (expected, generated, absence) = if operation == "field-create" {
        if command.target.resource_id.is_some() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        if fields.len() >= 100 {
            return Err(StockMappingError::NativeLimitation(
                "native-field-set-exceeds-wire-bound",
            ));
        }
        let mut field = Map::from_iter([
            (
                "name".to_owned(),
                required(&command.payload, "name")?.clone(),
            ),
            ("textValue".to_owned(), Value::String(String::new())),
            ("numberValue".to_owned(), Value::from(0)),
            ("booleanValue".to_owned(), Value::Bool(false)),
        ]);
        set_field_value(&mut field, required(&command.payload, "value")?)?;
        let expected = Value::Object(field);
        fields.push(expected.clone());
        (
            expected,
            GeneratedIdentity::EntityMember {
                field: "fields".to_owned(),
                before_ids,
            },
            false,
        )
    } else {
        let target_id = command.target.id()?;
        let index = before_ids
            .iter()
            .position(|id| *id == target_id)
            .ok_or(StockMappingError::ObservationConflict)?;
        if operation == "field-delete" {
            fields.remove(index);
            (Value::Null, GeneratedIdentity::None, true)
        } else {
            let mut field = object(&fields[index])?.clone();
            if let Some(name) = object(&command.payload)?.get("name") {
                field.insert("name".to_owned(), name.clone());
            }
            if let Some(value) = object(&command.payload)?.get("value") {
                set_field_value(&mut field, value)?;
            }
            let expected = Value::Object(field);
            fields[index] = expected.clone();
            (expected, GeneratedIdentity::None, false)
        }
    };
    let has_native_sync = body
        .get("syncChildEntityLocations")
        .and_then(Value::as_bool)
        == Some(true);
    body.insert("fields".to_owned(), Value::Array(fields));
    let path = format!("/api/v1/entities/{}", owner.id()?);
    let mut mapped = plan(
        command,
        NativeMethod::Put,
        path.clone(),
        NativeBody::Json(Value::Object(body)),
        ResponseKind::Entity,
        readback(
            command,
            path,
            ReadbackSelector::Member {
                field: "fields".to_owned(),
            },
            expected,
            absence,
        ),
        generated,
    );
    mapped.requires_complete_impact |= has_native_sync;
    Ok(mapped)
}

fn set_field_value(field: &mut Map<String, Value>, value: &Value) -> Result<(), StockMappingError> {
    let kind = string(value, "kind")?;
    let scalar = required(value, "value")?;
    let native_key = match kind {
        "text" if scalar.is_string() => "textValue",
        "number"
            if scalar.as_i64().is_some_and(|number| {
                (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&number)
            }) =>
        {
            "numberValue"
        }
        "boolean" if scalar.is_boolean() => "booleanValue",
        "time" => {
            return Err(StockMappingError::NativeLimitation(
                "native-entity-time-field-write",
            ));
        }
        _ => return Err(StockMappingError::InvalidNativeInput),
    };
    field.insert("type".to_owned(), Value::String(kind.to_owned()));
    field.insert(native_key.to_owned(), scalar.clone());
    Ok(())
}

fn native_fields(value: &Value) -> Result<Vec<Value>, StockMappingError> {
    if value.is_null() {
        return Ok(Vec::new());
    }
    let fields = value
        .as_array()
        .ok_or(StockMappingError::InvalidNativeInput)?;
    let mut ids = Vec::with_capacity(fields.len());
    let mut out = Vec::with_capacity(fields.len());
    for field in fields {
        let id = nonzero_uuid(required(field, "id")?)?;
        if ids.contains(&id) {
            return Err(StockMappingError::InvalidNativeInput);
        }
        ids.push(id);
        if !matches!(
            string(field, "type")?,
            "text" | "number" | "boolean" | "time"
        ) || !required(field, "name")?.is_string()
            || !required(field, "textValue")?.is_string()
            || required(field, "numberValue")?.as_i64().is_none()
            || !required(field, "booleanValue")?.is_boolean()
        {
            return Err(StockMappingError::InvalidNativeInput);
        }
        // Existing hidden time columns are untouched by native field updates;
        // preserving them still requires the full snapshot attestation above.
        out.push(Value::Object(copy_fields(
            field,
            &[
                "id",
                "name",
                "type",
                "textValue",
                "numberValue",
                "booleanValue",
            ],
        )?));
    }
    Ok(out)
}

fn relation_ids(value: &Value, field: &str) -> Result<Vec<Uuid>, StockMappingError> {
    let related = required(value, field)?;
    if related.is_null() {
        return Ok(Vec::new());
    }
    let entries = related
        .as_array()
        .ok_or(StockMappingError::InvalidNativeInput)?;
    let values = entries
        .iter()
        .map(|entry| nonzero_uuid(required(entry, "id")?))
        .collect::<Result<Vec<_>, _>>()?;
    unique_ids(values)
}

fn ids(value: &Value) -> Result<Vec<Uuid>, StockMappingError> {
    let values = value
        .as_array()
        .ok_or(StockMappingError::InvalidNativeInput)?;
    unique_ids(
        values
            .iter()
            .map(nonzero_uuid)
            .collect::<Result<Vec<_>, _>>()?,
    )
}

fn unique_ids(values: Vec<Uuid>) -> Result<Vec<Uuid>, StockMappingError> {
    for (index, id) in values.iter().enumerate() {
        if values[..index].contains(id) {
            return Err(StockMappingError::InvalidNativeInput);
        }
    }
    Ok(values)
}

fn uuid_array(values: &[Uuid]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|id| Value::String(id.to_string()))
            .collect(),
    )
}

fn nonzero_uuid(value: &Value) -> Result<Uuid, StockMappingError> {
    let id = uuid(value)?;
    if id.is_nil() {
        Err(StockMappingError::NativeLimitation("native-nil-reference"))
    } else {
        Ok(id)
    }
}

fn nullable_parent(value: &Value) -> Result<Option<Uuid>, StockMappingError> {
    if value.is_null() {
        Ok(None)
    } else {
        nonzero_uuid(value).map(Some)
    }
}

fn finite_nonnegative(value: &Value) -> Result<(), StockMappingError> {
    if value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number >= 0.0)
    {
        Ok(())
    } else {
        Err(StockMappingError::InvalidNativeInput)
    }
}
