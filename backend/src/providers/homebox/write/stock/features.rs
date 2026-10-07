use super::types::*;
use serde_json::{Value, json};

pub(super) fn map(
    command: &StockCommand,
    preparation: &Preparation,
) -> Result<Option<NativePlan>, StockMappingError> {
    match command.command_id.as_str() {
        "homebox.bulk.execute" => {
            let action = string(&command.payload, "action")?;
            if ![
                "create-missing-thumbnails",
                "ensure-asset-ids",
                "ensure-import-refs",
                "set-primary-photos",
                "wipe-inventory",
                "zero-item-time-fields",
            ]
            .contains(&action)
            {
                return Err(StockMappingError::UnsupportedOperation);
            }
            let body = if action == "wipe-inventory" {
                NativeBody::Json(Value::Object(copy_fields(
                    &command.payload,
                    &["wipeLocations", "wipeTags", "wipeMaintenance"],
                )?))
            } else {
                NativeBody::None
            };
            Ok(Some(plan(
                command,
                NativeMethod::Post,
                format!("/api/v1/actions/{action}"),
                body,
                ResponseKind::Bulk,
                readback(
                    command,
                    "/api/v1/entities".into(),
                    ReadbackSelector::CompleteImpact,
                    json!({}),
                    false,
                ),
                GeneratedIdentity::None,
            )))
        }
        "homebox.import.csv" => {
            let requested: StagedUpload =
                serde_json::from_value(required(&command.payload, "stage")?.clone())
                    .map_err(|_| StockMappingError::InvalidNativeInput)?;
            let stage = preparation
                .staged_upload
                .as_ref()
                .filter(|s| **s == requested)
                .ok_or(StockMappingError::StageMismatch)?;
            if stage.content_type != "text/csv" {
                return Err(StockMappingError::StageMismatch);
            }
            // maxRows, impact and approval are local admission constraints, never
            // invented native query/body fields. Intake must parse rows before admission.
            Ok(Some(plan(
                command,
                NativeMethod::Post,
                "/api/v1/entities/import".into(),
                NativeBody::Multipart {
                    file_field: "csv".into(),
                    stage: stage.clone(),
                    fields: vec![],
                },
                ResponseKind::NoContent,
                readback(
                    command,
                    "/api/v1/entities".into(),
                    ReadbackSelector::CompleteImpact,
                    json!({}),
                    false,
                ),
                GeneratedIdentity::None,
            )))
        }
        "homebox.label.output" => {
            if string(&command.payload, "delivery")? != "print" {
                return Err(StockMappingError::NativeLimitation(
                    "label render is a non-mutating read owned by the read/artifact component",
                ));
            }
            let subject = string(&command.payload, "subject")?;
            let id = match subject {
                "asset" => {
                    let value = string(&command.payload, "assetId")?;
                    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                        return Err(StockMappingError::InvalidNativeInput);
                    }
                    value.to_owned()
                }
                "item" | "location" => uuid(required(&command.payload, "resourceId")?)?.to_string(),
                _ => return Err(StockMappingError::InvalidNativeInput),
            };
            let mut mapped = plan(
                command,
                NativeMethod::Get,
                format!("/api/v1/labelmaker/{subject}/{id}"),
                NativeBody::None,
                ResponseKind::Printer,
                readback(
                    command,
                    String::new(),
                    ReadbackSelector::Printer,
                    json!({"subject":subject,"id":id}),
                    false,
                ),
                GeneratedIdentity::None,
            );
            mapped.request.query = vec![("print".into(), "true".into())];
            mapped.max_response_bytes = Some(
                required(&command.payload, "maxBytes")?
                    .as_u64()
                    .ok_or(StockMappingError::InvalidNativeInput)?,
            );
            mapped.requires_complete_impact = true;
            Ok(Some(mapped))
        }
        _ => Ok(None),
    }
}
