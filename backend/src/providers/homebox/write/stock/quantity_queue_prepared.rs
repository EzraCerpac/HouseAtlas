//! Detached quantity-only Prepared DATA from the genuine original phase.
//! This is neither queue admission nor invocation authority. Its codec has no
//! receiver here and is distinct from the admitted-operation recovery codec.
use super::*;
use crate::{
    access,
    app::homebox_quantity_graph::OriginalQuantityPreparation,
    jobs,
    providers::homebox::read,
    storage::{self, StockActivityPrincipal as _},
};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// Production encoding for this closed original quantity producer only.
pub const NATIVE_QUEUED_QUANTITY_PREPARED_CODEC: &str =
    "houseatlas-homebox-quantity-queued-prepared/1";

// Storage's queue::MAX_METADATA_BYTES is private. Keep this accepted codec
// bound equal to that queue journal bound; neither encoded field may exceed it.
const MAX_ENCODED_BYTES: usize = 1_048_576;
const NO_MEDIA_FORMAT: &str = "houseatlas-homebox-quantity-queued-no-media/1";

struct PreparedQuantityIssuer;

/// Immutable custody of one source cut and its deterministic Prepared DATA.
/// Private fields and allocation identity prevent DATA from issuing this token.
/// No live preparation, Access, reader, grant, guard or evidence owner is held.
pub struct NativeQueuedQuantityPrepared {
    source: Arc<NativeQueuedQuantityOriginal>,
    issuer: Arc<PreparedQuantityIssuer>,
    prepared: storage::PreparedNativeIntent,
}

impl NativeQueuedQuantityPrepared {
    pub fn capture_original<'phase, 'tx, 'native: 'phase, 'p, 'owner, T, K>(
        preparation: &OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
        source: Arc<NativeQueuedQuantityOriginal>,
        qualification: &FreshQualification<'phase, 'tx, 'p>,
    ) -> Result<Self, StockErrorCode>
    where
        T: read::Transport,
        K: read::Clock + Send + Sync,
    {
        revalidate_original_phase(preparation, &source, qualification)?;
        let prepared = encode_original(&source)?;
        let result = Self {
            source,
            issuer: Arc::new(PreparedQuantityIssuer),
            prepared,
        };
        // Fence the finished allocation with this same actual physical/native
        // phase. The detached result does not retain or renew that authority.
        revalidate_original_phase(preparation, &result.source, qualification)?;
        result.revalidate_original_guard(preparation, qualification.guard())?;
        Ok(result)
    }

    pub fn source_cut(&self) -> &Arc<NativeQueuedQuantityOriginal> {
        &self.source
    }

    /// Encoded DATA only; this getter is not token or authorization proof.
    pub fn prepared(&self) -> &storage::PreparedNativeIntent {
        &self.prepared
    }

    pub fn matches_source(&self, source: &Arc<NativeQueuedQuantityOriginal>) -> bool {
        Arc::ptr_eq(&self.source, source)
            && self.source.known_zero_admission().matches_original(source)
    }

    /// Identity of the private prepared issuer, never equality of codec DATA.
    pub fn same_prepared(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.issuer, &other.issuer)
    }

    /// Check the exact original preparation/guard and reconstruct untouched
    /// planned DATA. Current physical qualification is a separate Root B fence.
    pub fn revalidate_original_guard<'native, 'p, 'owner, T, K>(
        &self,
        preparation: &OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
        guard: &access::TransactionAuthorization<'_>,
    ) -> Result<(), StockErrorCode>
    where
        T: read::Transport,
        K: read::Clock + Send + Sync,
    {
        self.source.revalidate_original_guard(preparation, guard)?;
        if !self.matches_source(&self.source) || self.prepared != encode_original(&self.source)? {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }
}

fn revalidate_original_phase<'phase, 'tx, 'native: 'phase, 'p, 'owner, T, K>(
    preparation: &OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
    source: &NativeQueuedQuantityOriginal,
    qualification: &FreshQualification<'phase, 'tx, 'p>,
) -> Result<(), StockErrorCode>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    qualification.revalidate()?;
    let physical = qualification
        .quantity_installation()
        .ok_or(StockErrorCode::ProviderUnqualified)?;
    let observation = physical.observation();
    let original = preparation.original();
    let configured = preparation.configured();
    if !std::ptr::eq(qualification.captured(), preparation.captured())
        || !std::ptr::eq(
            qualification.guard().principal(),
            original.original_activity_principal(),
        )
        || !std::ptr::eq(observation.original(), original)
        || !Arc::ptr_eq(physical.configured(), configured)
        || observation.queue_config() != configured.queue()
        || observation.registration() != configured.physical()
        || observation.source_metadata() != configured.metadata()
    {
        return Err(StockErrorCode::CapabilityDenied);
    }
    preparation
        .revalidate_original_phase(qualification.guard(), physical)
        .map_err(|_| StockErrorCode::PreflightConflict)?;
    let native = preparation.native();
    native.revalidate_in_guard(qualification, native.command(), native.authority())?;
    // The source factory positively restricts NoHuman/null receipt, existing
    // entity quantity PATCH/200 + GET readback, no stage/media/clear/children/
    // impact/generated identity. This exact immutable cut is correlated to the
    // unchanged original command, plan, owner preflight and raw capture here.
    source.revalidate_original_guard(preparation, qualification.guard())
}

#[derive(Serialize)]
struct QuantityPayload<'a> {
    format: &'static str,
    native_source_commit: &'static str,
    contract_version: &'static str,
    original_wire: &'a Value,
    plan: &'a NativePlan,
}

#[derive(Serialize)]
struct QuantityNoMedia {
    format: &'static str,
    pending_required: bool,
    reserved_bytes: u64,
}

fn encode_original(
    source: &NativeQueuedQuantityOriginal,
) -> Result<storage::PreparedNativeIntent, StockErrorCode> {
    let known_zero = source.known_zero_admission();
    let pending = known_zero.pending_byte_liability();
    if !known_zero.matches_original(source)
        || pending.required
        || pending.reserved_bytes != Some(0)
        || source.enqueue_request().pending_byte_liability != pending
    {
        return Err(StockErrorCode::PreflightConflict);
    }
    let reserved_bytes = pending
        .reserved_bytes
        .ok_or(StockErrorCode::PreflightConflict)?;
    let native_payload = encode_bounded(&QuantityPayload {
        format: NATIVE_QUEUED_QUANTITY_PREPARED_CODEC,
        native_source_commit: NATIVE_SOURCE_COMMIT,
        contract_version: CONTRACT_VERSION,
        original_wire: &source.command().original_wire,
        plan: source.plan(),
    })?;
    // This encoding derives only from the actual source's known-zero issuer.
    // It is no-media DATA, not Media-origin, staging, history or approval proof.
    let prepared_media_evidence = encode_bounded(&QuantityNoMedia {
        format: NO_MEDIA_FORMAT,
        pending_required: pending.required,
        reserved_bytes,
    })?;
    Ok(storage::PreparedNativeIntent {
        codec: NATIVE_QUEUED_QUANTITY_PREPARED_CODEC.to_owned(),
        native_payload,
        prepared_media_evidence,
        storage_liability: jobs::StorageLiability {
            accounting: jobs::ByteAccounting::Complete {
                known_bytes: reserved_bytes,
                reserved_bytes,
            },
            // This producer performs no I/O and has no invocation entry point.
            metadata_commit_evidence: jobs::MetadataCommitEvidence::NotDispatched,
            byte_disposition: jobs::ByteDisposition::None,
            reference_closure_evidence: jobs::ReferenceClosureEvidence::Unassessed,
            orphan_candidate_id: None,
            unresolved_attempts: 0,
        },
    })
}

fn encode_bounded(value: &impl Serialize) -> Result<Vec<u8>, StockErrorCode> {
    let encoded = serde_json::to_vec(value).map_err(|_| StockErrorCode::PreflightConflict)?;
    if encoded.is_empty() || encoded.len() > MAX_ENCODED_BYTES {
        return Err(StockErrorCode::InvalidArgument);
    }
    Ok(encoded)
}
