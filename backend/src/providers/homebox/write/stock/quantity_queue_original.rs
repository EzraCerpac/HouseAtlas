//! Detached original quantity capture for queue composition. This producer
//! finishes under the genuine current original phase; its immutable result is
//! neither current authorization nor queue admission or invocation authority.
use super::*;
use crate::{
    access,
    app::homebox_quantity_graph::{
        OriginalQuantityPreparation, OriginalQuantityPreparationIdentity,
    },
    jobs,
    providers::homebox::read,
    storage::{self, StockActivityPrincipal as _},
};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::sync::Arc;
use uuid::Uuid;

/// Exact captured native bytes and retrieval metadata. No DATA constructor,
/// Clone or serde can manufacture original snapshot custody.
pub struct NativeQueuedQuantitySnapshot {
    original: Vec<u8>,
    scope: read::SourceScope,
    target: StockTarget,
    path: String,
    query: Vec<(String, String)>,
    observed_at: String,
    digest: Digest,
    raw_digest: Digest,
}
impl NativeQueuedQuantitySnapshot {
    pub fn original(&self) -> &[u8] {
        &self.original
    }
    pub fn scope(&self) -> &read::SourceScope {
        &self.scope
    }
    pub fn target(&self) -> &StockTarget {
        &self.target
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
    pub fn raw_digest(&self) -> &Digest {
        &self.raw_digest
    }
}

/// Private allocation shared only by one original cut and its known-zero
/// admission token. It retains no live root, grants, source or Store owner.
struct OriginalQuantityIssuer;
pub struct NativeQuantityKnownZeroAdmission {
    issuer: Arc<OriginalQuantityIssuer>,
}
impl NativeQuantityKnownZeroAdmission {
    pub fn matches_original(&self, original: &NativeQueuedQuantityOriginal) -> bool {
        Arc::ptr_eq(&self.issuer, &original.issuer)
    }
    /// These are accounting DATA for this qualified no-stage quantity form.
    /// Storage must still independently admit the actual queue operation.
    pub fn pending_byte_liability(&self) -> jobs::PendingByteLiability {
        jobs::PendingByteLiability {
            required: false,
            reserved_bytes: Some(0),
        }
    }
}

/// Detached immutable original capture, with no public DATA constructor,
/// Clone, serde, grant/credential custody, or runtime effect entry point.
pub struct NativeQueuedQuantityOriginal {
    issuer: Arc<OriginalQuantityIssuer>,
    known_zero: NativeQuantityKnownZeroAdmission,
    original_identity: Arc<OriginalQuantityPreparationIdentity>,
    command: StockCommand,
    plan: NativePlan,
    authority: StockAuthority,
    owner_preflight: StockPreflight,
    preflight: StockPreflight,
    snapshot: NativeQueuedQuantitySnapshot,
    capture_digest: Digest,
    source_metadata: access::SourceAuthorityMetadata,
    reviewed_policy: Value,
    physical: storage::StockActivityPhysicalRegistration,
    queue_config: jobs::QueueConfig,
    enqueue_request: jobs::EnqueueRequest,
    canonical_scope: jobs::CanonicalScope,
}
impl NativeQueuedQuantityOriginal {
    pub fn capture_original<'phase, 'tx, 'native: 'phase, 'p, 'owner, T, K>(
        preparation: &OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
        qualification: &FreshQualification<'phase, 'tx, 'p>,
    ) -> Result<Self, StockErrorCode>
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
        // This call consumes neither owner nor guard and acquires no lock. The
        // actual Root B qualifies native, Domain and borrowed physical custody.
        preparation
            .revalidate_original_phase(qualification.guard(), physical)
            .map_err(|_| StockErrorCode::PreflightConflict)?;
        let native = preparation.native();
        let command = native.command();
        let authority = native.authority();
        native.revalidate_in_guard(qualification, command, authority)?;
        let request = preparation.prepared().request();
        let policy = configured.reviewed_policy();
        let maximum = match configured.descriptor().policy {
            QuantityPolicy::NoHuman { maximum } => maximum,
            QuantityPolicy::HumanRequired => return Err(StockErrorCode::UnsupportedCapability),
        };
        let quantity = command
            .payload
            .get("quantity")
            .and_then(Value::as_u64)
            .ok_or(StockErrorCode::InvalidArgument)?;
        if command != original.command()
            || authority != original.captured_authority()
            || !matches!(
                authority.qualification,
                NativeQualification::Qualified { .. }
            )
            || command.command_id != "homebox.entity.quantity.set"
            || command.approval_receipt_id.is_some()
            || command.original_wire.get("approvalReceiptId") != Some(&Value::Null)
            || command.native_sync_behavior.is_some()
            || command.target.resource_kind != ResourceKind::Entity
            || command.target.entity_id.is_some()
            || command.target.id().is_err()
            || command.target.id().is_ok_and(|id| id.is_nil())
            || maximum > jobs::MAX_SAFE_INTEGER
            || quantity > maximum
            || command
                .payload
                .as_object()
                .is_none_or(|payload| payload.len() != 1)
            || policy.get("approvalRequirement").and_then(Value::as_str) != Some("no-human")
            || policy.get("maximum").and_then(Value::as_u64) != Some(maximum)
            || request.id() != crate::domain::stock::OperationId::HomeboxEntityQuantitySet
            || request.raw() != &command.original_wire
            || request.intent_digest() != command.request_digest.as_str()
            || !request.children().is_empty()
            || request.whole_collection_required()
            || command.original_wire["preconditions"]["atlasGuards"]
                .as_array()
                .is_none_or(|guards| !guards.is_empty())
            || qualification.captured().source_grants().len() != 1
            || qualification.captured().partition_grants().len() != 1
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let plan = native.plan();
        let preflight = native.preflight();
        let path = format!(
            "/api/v1/entities/{}",
            command
                .target
                .id()
                .map_err(|_| StockErrorCode::PreflightConflict)?
        );
        if preflight.preparation.snapshots.len() != 1
            || native.capture().snapshots().len() != 1
            || preflight.preparation.snapshots[0].target != command.target
            || !preflight.preparation.snapshots[0].complete
            || preflight.preparation.staged_upload.is_some()
            || !preflight.preparation.native_clear_values.is_empty()
            || preflight.provider_observation != command.provider_observation
            || preflight.request_digest != command.request_digest
            || preflight.source_epoch != authority.source_epoch
            || map_stock(command, &preflight.preparation)
                .map_err(|_| StockErrorCode::PreflightConflict)?
                != *plan
            || plan.request.method != NativeMethod::Patch
            || plan.request.path != path
            || !plan.request.query.is_empty()
            || plan.request.body != NativeBody::Json(command.payload.clone())
            || plan.response != ResponseKind::Entity
            || plan.success_status != 200
            || plan.generated != GeneratedIdentity::None
            || plan.requires_complete_impact
            || plan.readback.path != path
            || !plan.readback.query.is_empty()
            || plan.readback.target != command.target
            || plan.readback.selector != ReadbackSelector::Whole
            || plan.readback.expected != command.payload
            || plan.readback.absence
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let decoded = &native.capture().snapshots()[0];
        let raw = decoded.original();
        if raw.original.is_empty()
            || raw.original.len()
                > crate::providers::homebox::wire::DecodeLimits::default().max_response_bytes
            || raw.target != command.target
            || raw.path != path
            || !raw.query.is_empty()
            || decoded.digest() != &preflight.preparation.snapshots[0].digest
            || decoded.snapshot_value() != &preflight.preparation.snapshots[0].value
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let partition = observation.source_partition();
        let queue_partition = jobs::SourcePartition {
            workspace_id: partition.workspace_id.as_str().to_owned(),
            home_id: partition.home_id.as_str().to_owned(),
            source_instance_id: partition.source_instance_id.as_str().to_owned(),
            collection_id: partition.collection_id.clone(),
        };
        let raw_target = &command.original_wire["target"];
        let external_id = original_uuid(
            &raw_target["resourceId"],
            command
                .target
                .id()
                .map_err(|_| StockErrorCode::InvalidArgument)?,
        )?;
        let write_scope = jobs::WriteScope {
            source_instance_id: original_uuid(
                &raw_target["sourceInstanceId"],
                command.target.source_instance_id,
            )?,
            collection_id: original_uuid(
                &raw_target["collectionId"],
                command.target.collection_id,
            )?,
            selection: jobs::ScopeSelection::Resources(vec![jobs::ResourceRef {
                kind: jobs::ResourceKind::Entity,
                id: external_id.clone(),
            }]),
        };
        observation
            .queue_config()
            .validate()
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let canonical_scope = observation
            .queue_config()
            .registration
            .resolve(&queue_partition, &write_scope)
            .map_err(|_| StockErrorCode::PreflightConflict)?;
        let issuer = Arc::new(OriginalQuantityIssuer);
        let known_zero = NativeQuantityKnownZeroAdmission {
            issuer: Arc::clone(&issuer),
        };
        let enqueue_request = jobs::EnqueueRequest {
            receipt: jobs::ReceiptKey {
                workspace_id: original_uuid(
                    &command.original_wire["context"]["workspaceId"],
                    command.context.workspace_id,
                )?,
                home_id: original_uuid(
                    &command.original_wire["context"]["homeId"],
                    command.context.home_id,
                )?,
                actor_id: original
                    .original_activity_principal()
                    .actor_id()
                    .as_str()
                    .to_owned(),
                mutation_id: original_uuid(
                    &command.original_wire["idempotencyKey"],
                    command.idempotency_key,
                )?,
            },
            partition: queue_partition,
            intent: jobs::IntentMetadata {
                contract_id: crate::contracts::stock::CONTRACT_VERSION.to_owned(),
                operation_id: command.command_id.clone(),
                target_external_id: Some(external_id),
                request_digest: jobs::Digest::from_hex(command.request_digest.as_str().to_owned())
                    .map_err(|_| StockErrorCode::PreflightConflict)?,
            },
            write_scope,
            pending_byte_liability: known_zero.pending_byte_liability(),
        };
        enqueue_request
            .validate()
            .map_err(|_| StockErrorCode::PreflightConflict)?;
        qualification.revalidate()?;
        let cut = Self {
            issuer,
            known_zero,
            original_identity: Arc::clone(preparation.original_preparation_identity()),
            command: command.clone(),
            plan: plan.clone(),
            authority: authority.clone(),
            owner_preflight: native.owner_preflight().clone(),
            preflight: preflight.clone(),
            snapshot: NativeQueuedQuantitySnapshot {
                original: raw.original.clone(),
                scope: raw.scope.clone(),
                target: raw.target.clone(),
                path: raw.path.clone(),
                query: raw.query.clone(),
                observed_at: raw.observed_at.clone(),
                digest: decoded.digest().clone(),
                raw_digest: Digest::parse(format!("{:x}", Sha256::digest(&raw.original)))
                    .map_err(|_| StockErrorCode::PreflightConflict)?,
            },
            capture_digest: native.capture().capture_digest().clone(),
            source_metadata: observation.source_metadata().clone(),
            reviewed_policy: policy.clone(),
            physical: observation.registration().clone(),
            queue_config: observation.queue_config().clone(),
            enqueue_request,
            canonical_scope,
        };
        preparation
            .revalidate_original_phase(qualification.guard(), physical)
            .map_err(|_| StockErrorCode::PreflightConflict)?;
        cut.revalidate_original_guard(preparation, qualification.guard())?;
        Ok(cut)
    }
    /// Revalidate this exact detached cut against its unchanged original bundle
    /// and held mutation guard. Current physical Store qualification remains a
    /// separate mandatory Root B phase; this leaf acquires no Store or Access.
    pub fn revalidate_original_guard<'native, 'p, 'owner, T, K>(
        &self,
        preparation: &OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
        guard: &access::TransactionAuthorization<'_>,
    ) -> Result<(), StockErrorCode>
    where
        T: read::Transport,
        K: read::Clock + Send + Sync,
    {
        if !Arc::ptr_eq(
            &self.original_identity,
            preparation.original_preparation_identity(),
        ) {
            return Err(StockErrorCode::CapabilityDenied);
        }
        let original = preparation.original();
        let native = preparation.native();
        let configured = preparation.configured();
        let captured = preparation.captured();
        if !std::ptr::eq(guard.principal(), original.original_activity_principal())
            || !std::ptr::eq(captured.principal(), guard.principal())
            || !std::ptr::eq(native.source().original(), original)
            || !native
                .source()
                .configured()
                .is_some_and(|actual| Arc::ptr_eq(actual, configured))
            || &self.command != native.command()
            || &self.command != original.command()
            || &self.plan != native.plan()
            || &self.authority != native.authority()
            || &self.authority != original.captured_authority()
            || &self.preflight != native.preflight()
            || &self.owner_preflight != native.owner_preflight()
            || &self.capture_digest != native.capture().capture_digest()
            || &self.source_metadata != configured.metadata()
            || &self.reviewed_policy != configured.reviewed_policy()
            || &self.physical != configured.physical()
            || &self.queue_config != configured.queue()
            || !self.known_zero.matches_original(self)
            || native.capture().snapshots().len() != 1
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let decoded = &native.capture().snapshots()[0];
        let raw = decoded.original();
        if self.snapshot.original != raw.original
            || self.snapshot.scope != raw.scope
            || self.snapshot.target != raw.target
            || self.snapshot.path != raw.path
            || self.snapshot.query != raw.query
            || self.snapshot.observed_at != raw.observed_at
            || &self.snapshot.digest != decoded.digest()
            || decoded.snapshot_value() != &self.preflight.preparation.snapshots[0].value
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        guard
            .assert_mutation()
            .map_err(|_| StockErrorCode::CapabilityDenied)?;
        guard
            .revalidate_source(original.original_activity_source())
            .map_err(|_| StockErrorCode::CapabilityDenied)?;
        guard
            .revalidate_source_partition(original.original_activity_partition())
            .map_err(|_| StockErrorCode::CapabilityDenied)?;
        for grant in captured.source_grants() {
            guard
                .revalidate_source(grant)
                .map_err(|_| StockErrorCode::CapabilityDenied)?;
        }
        for grant in captured.partition_grants() {
            guard
                .revalidate_source_partition(grant)
                .map_err(|_| StockErrorCode::CapabilityDenied)?;
        }
        if guard
            .persisted_source_metadata(original.original_activity_partition())
            .map_err(|_| StockErrorCode::CapabilityDenied)?
            != self.source_metadata
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        native
            .source()
            .revalidate_activity_capture(guard, native.capture())?;
        guard
            .revalidate()
            .map_err(|_| StockErrorCode::CapabilityDenied)?;
        Ok(())
    }
    pub fn known_zero_admission(&self) -> &NativeQuantityKnownZeroAdmission {
        &self.known_zero
    }
    pub fn command(&self) -> &StockCommand {
        &self.command
    }
    pub fn plan(&self) -> &NativePlan {
        &self.plan
    }
    pub fn authority(&self) -> &StockAuthority {
        &self.authority
    }
    pub fn owner_id(&self) -> Uuid {
        self.physical.owner_id
    }
    pub fn owner_preflight(&self) -> &StockPreflight {
        &self.owner_preflight
    }
    pub fn preflight(&self) -> &StockPreflight {
        &self.preflight
    }
    pub fn snapshot(&self) -> &NativeQueuedQuantitySnapshot {
        &self.snapshot
    }
    pub fn capture_digest(&self) -> &Digest {
        &self.capture_digest
    }
    pub fn source_metadata(&self) -> &access::SourceAuthorityMetadata {
        &self.source_metadata
    }
    pub fn source_registration(&self) -> &access::SourceRegistration {
        self.source_metadata.registration()
    }
    pub fn reviewed_policy(&self) -> &Value {
        &self.reviewed_policy
    }
    pub fn physical(&self) -> &storage::StockActivityPhysicalRegistration {
        &self.physical
    }
    pub fn queue_config(&self) -> &jobs::QueueConfig {
        &self.queue_config
    }
    pub fn enqueue_request(&self) -> &jobs::EnqueueRequest {
        &self.enqueue_request
    }
    pub fn canonical_scope(&self) -> &jobs::CanonicalScope {
        &self.canonical_scope
    }
}
fn original_uuid(value: &Value, expected: Uuid) -> Result<String, StockErrorCode> {
    let raw = value.as_str().ok_or(StockErrorCode::InvalidArgument)?;
    if expected.is_nil() || raw.len() != 36 || Uuid::parse_str(raw).ok() != Some(expected) {
        return Err(StockErrorCode::PreflightConflict);
    }
    Ok(raw.to_owned())
}
