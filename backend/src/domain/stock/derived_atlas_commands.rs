//! Pure specialized mapping from explicitly supplied owner derivation data.
//! This data is not a grant, renderer seal, source-presence proof or receipt.
//! Storage must check its preimages and qualified peers in its original fenced
//! transaction and retain the derivation with the exact stock intent.

use super::atlas_commands::{
    map_group, map_group_with_entries, map_group_with_payload, plan_atlas_commands_with,
};
use super::{AtlasCommandPlan, OperationId, StockError, StockResult, ValidatedRequest};
use crate::{
    contracts::{AssetPayloadPreviewPolicy, BindingPayloadSourceState},
    storage::{Contract, Lifecycle, Operation, Record, RecordType},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// Storage must retain this mapping version with immutable derivation data.
pub const ATLAS_DERIVATION_FORMAT: &str = "atlas-derived-command/1";
/// Ordered child derivations; the single-command v1 format is unchanged.
pub const ATLAS_BATCH_DERIVATION_FORMAT: &str = "atlas-derived-batch/1";

/// Closed stock-catalogue predicate for the specialized derivation mapper.
/// This declares mapping support only; it does not qualify evidence or grant
/// execution authority.
pub fn atlas_derived_operation(id: OperationId) -> bool {
    matches!(
        id,
        OperationId::AtlasBindingCreate
            | OperationId::AtlasBindingReview
            | OperationId::AtlasBindingRestore
            | OperationId::AtlasBindingRemap
            | OperationId::AtlasGeometryCreate
            | OperationId::AtlasAssetReview
    )
}

/// Immutable inputs needed to reproduce a specialized mapping. They carry no
/// authority. In particular SafeRendered requires the Media owner's actual
/// renderer-receipt validation; supplying its enum or UUID cannot establish it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AtlasDerivation {
    BindingCreate {
        source_state: BindingPayloadSourceState,
    },
    BindingReview {
        original: Record,
    },
    BindingRestore {
        original: Record,
    },
    BindingRemap {
        original: Record,
        source_state: BindingPayloadSourceState,
    },
    GeometryCreate {
        imported_at: String,
    },
    AssetReview {
        original: Record,
        preview_policy: AssetPayloadPreviewPolicy,
        renderer_receipt_id: Option<String>,
    },
}

/// The same planner and stock group linkage used by direct and staged commands.
/// Single specialized forms keep their immutable v1 mapping. Staged
/// asset.create keeps its existing media-sealed mapper.
pub fn plan_derived_atlas_commands(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
    native: &impl Contract,
) -> StockResult<AtlasCommandPlan> {
    if !request.children().is_empty() {
        return Err(StockError::CapabilityHeld);
    }
    plan_atlas_commands_with(request, native, |request, index| {
        map_derived_group(request, index, derivation, native)
    })
}

/// Compose direct and specialized children through the existing group factory.
/// The vector is aligned to the submitted child order: None maps a direct form;
/// Some maps one specialized form. No stage, grant or renderer proof is created.
pub fn plan_derived_atlas_batch_commands(
    request: &ValidatedRequest,
    derivations: &[Option<AtlasDerivation>],
    native: &impl Contract,
) -> StockResult<AtlasCommandPlan> {
    if request.id() != OperationId::AtlasBatchExecute
        || request.children().is_empty()
        || request.children().len() != derivations.len()
        || !derivations.iter().any(Option::is_some)
    {
        return Err(StockError::CapabilityHeld);
    }
    plan_atlas_commands_with(request, native, |child, index| {
        let index = index.ok_or(StockError::CorrelationMismatch)?;
        match &derivations[index] {
            Some(derivation) => map_derived_group(child, Some(index), derivation, native),
            None => map_group(child, Some(index), native),
        }
    })
}

fn map_derived_group(
    request: &ValidatedRequest,
    index: Option<usize>,
    derivation: &AtlasDerivation,
    native: &impl Contract,
) -> StockResult<super::AtlasCommandGroup> {
    let (operation, payload) = match (request.id(), derivation) {
        (OperationId::AtlasBindingCreate, AtlasDerivation::BindingCreate { source_state }) => {
            let mut payload = request.payload().clone();
            payload["sourceState"] = json!(source_state);
            (Operation::Create, payload)
        }
        (OperationId::AtlasBindingReview, AtlasDerivation::BindingReview { original }) => {
            check_original(
                request,
                original,
                RecordType::Binding,
                Lifecycle::Active,
                native,
            )?;
            let mut payload = original.payload.clone();
            payload["reviewStatus"] = request.payload()["reviewStatus"].clone();
            payload["evidenceIds"] = request.payload()["evidenceIds"].clone();
            (Operation::Replace, payload)
        }
        (OperationId::AtlasBindingRestore, AtlasDerivation::BindingRestore { original }) => {
            check_original(
                request,
                original,
                RecordType::Binding,
                Lifecycle::Tombstoned,
                native,
            )?;
            (Operation::Restore, Value::Null)
        }
        (
            OperationId::AtlasBindingRemap,
            AtlasDerivation::BindingRemap {
                original,
                source_state,
            },
        ) => {
            check_original(
                request,
                original,
                RecordType::Binding,
                Lifecycle::Active,
                native,
            )?;
            return remap(request, index, original, *source_state, native);
        }
        (OperationId::AtlasGeometryCreate, AtlasDerivation::GeometryCreate { imported_at }) => {
            super::operational_time(imported_at)?;
            let mut payload = request.payload().clone();
            payload["importedAt"] = json!(imported_at);
            (Operation::Create, payload)
        }
        (
            OperationId::AtlasAssetReview,
            AtlasDerivation::AssetReview {
                original,
                preview_policy,
                renderer_receipt_id,
            },
        ) => {
            check_original(
                request,
                original,
                RecordType::Asset,
                Lifecycle::Active,
                native,
            )?;
            let expected = match request.payload()["treatment"].as_str() {
                Some("block") => AssetPayloadPreviewPolicy::Blocked,
                Some("download-only") => AssetPayloadPreviewPolicy::DownloadOnly,
                Some("request-preview") => AssetPayloadPreviewPolicy::SafeRendered,
                _ => return Err(StockError::InvalidContract),
            };
            if *preview_policy != expected
                || request.payload()["rendererReceiptId"] != json!(renderer_receipt_id)
            {
                return Err(StockError::CorrelationMismatch);
            }
            let mut payload = original.payload.clone();
            payload["previewPolicy"] = json!(preview_policy);
            payload["evidenceIds"] = request.payload()["evidenceIds"].clone();
            (Operation::Replace, payload)
        }
        _ => return Err(StockError::CapabilityHeld),
    };
    map_group_with_payload(request, index, native, operation, &payload)
}

fn check_original(
    request: &ValidatedRequest,
    original: &Record,
    record_type: RecordType,
    lifecycle: Lifecycle,
    native: &impl Contract,
) -> StockResult<()> {
    native
        .validate_shape("record", &json!(original))
        .map_err(|_| StockError::OwnerUnavailable)?;
    if original.workspace_id != request.context().workspace_id
        || original.home_id != request.context().home_id
        || original.record_type != record_type
        || request.target()["recordType"] != record_type.as_str()
        || request.target()["recordId"] != original.record_id
        || original.lifecycle != lifecycle
        || request.raw()["preconditions"]["target"]["kind"] != "atlas"
        || crate::domain::integer::safe_integer(&request.raw()["preconditions"]["target"]["value"])
            != Some(original.revision)
    {
        return Err(StockError::CorrelationMismatch);
    }
    Ok(())
}

fn remap(
    request: &ValidatedRequest,
    child_index: Option<usize>,
    original: &Record,
    source_state: BindingPayloadSourceState,
    native: &impl Contract,
) -> StockResult<super::AtlasCommandGroup> {
    let input = request.payload();
    if input["oldBindingId"] != original.record_id {
        return Err(StockError::CorrelationMismatch);
    }
    // Freeze the original physical identity, source, state and evidence on the
    // retired binding. Remap evidence describes the new binding and journal;
    // it does not assert a new observation of the old reserved source key.
    let mut retired = original.payload.clone();
    retired["reviewStatus"] = json!("retired");
    let new_binding = json!({"atlasId":original.payload["atlasId"],
        "source":input["source"],"sourceState":source_state,
        "reviewStatus":"accepted","evidenceIds":input["evidenceIds"]});
    let journal = json!({"atlasId":original.payload["atlasId"],
        "fromBindingId":input["oldBindingId"],"toBindingId":input["newBindingId"],
        "reason":input["reason"],"evidenceIds":input["evidenceIds"]});
    let mut entries = Vec::with_capacity(3);
    for (position, (record_type, record_id, operation, payload)) in [
        (
            RecordType::Binding,
            input["oldBindingId"].clone(),
            Operation::Replace,
            retired,
        ),
        (
            RecordType::Binding,
            input["newBindingId"].clone(),
            Operation::Create,
            new_binding,
        ),
        (
            RecordType::Reconciliation,
            input["journalId"].clone(),
            Operation::Create,
            journal,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let mut entry =
            map_group_with_payload(request, None, native, Operation::Replace, &original.payload)?
                .native_entries()[0]
                .clone();
        entry.target.record_type = record_type;
        entry.target.record_id = record_id
            .as_str()
            .ok_or(StockError::InvalidContract)?
            .into();
        entry.command.operation = operation;
        entry.command.expected_revision = if position == 0 {
            Some(original.revision)
        } else {
            None
        };
        entry.command.mutation_id = remap_mutation_id(request.intent_digest(), position);
        entry.command.value = Some(crate::storage::RecordValue {
            record_type,
            payload,
        });
        entries.push(entry);
    }
    map_group_with_entries(request, child_index, native, entries)
}

// Domain-separated UUIDv8 derivation, fixed for this mapping version. Transport
// request/approval renewal cannot change the root intent digest or entry IDs.
fn remap_mutation_id(intent_digest: &str, position: usize) -> String {
    let mut hash = Sha256::new();
    hash.update(b"houseatlas/atlas-binding-remap/native-id/1\0");
    hash.update(intent_digest.as_bytes());
    hash.update([position as u8]);
    let digest = hash.finalize();
    let mut bytes: [u8; 16] = digest[..16].try_into().expect("fixed digest size");
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}
