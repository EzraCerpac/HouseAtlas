//! Closed original quantity activity consumer. Same-transaction physical/graph
//! qualification belongs to Storage's Root B path before these callbacks.
//! Native dispatch, readback and never-invoked facts have no issuer here.
use super::*;
use crate::{
    access,
    app::{
        homebox_quantity_graph::OriginalQuantityPreparation,
        stock_activity_principal::OriginalStockActivityPrincipal,
    },
    domain::stock::OperationId,
    providers::homebox::read,
    storage::{self, StockActivityPrincipal},
};
use std::sync::Arc;

pub struct QuantityActivityAuthorization<'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    preparation: &'bundle OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
    plan_digest: Digest,
}
impl<'bundle, 'native, 'p, 'owner, T: read::Transport, K: read::Clock + Send + Sync>
    QuantityActivityAuthorization<'bundle, 'native, 'p, 'owner, T, K>
{
    pub fn new(
        preparation: &'bundle OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
    ) -> Result<Self, StockPortFault> {
        let plan_digest = plan_digest(preparation.native().plan())?;
        let consumer = Self {
            preparation,
            plan_digest,
        };
        consumer.check_original(preparation.original())?;
        Ok(consumer)
    }
    fn check_original(
        &self,
        original: &OriginalStockActivityPrincipal,
    ) -> Result<(), StockPortFault> {
        let native = self.preparation.native();
        let source = native.source();
        let captured = self.preparation.captured();
        let configured = self.preparation.configured();
        let e = configured.descriptor();
        let command = original.command();
        let request = self.preparation.prepared().request();
        if !std::ptr::eq(original, self.preparation.original())
            || !std::ptr::eq(source.original(), original)
            || !std::ptr::eq(original.original_activity_principal(), captured.principal())
            || !source
                .configured()
                .is_some_and(|actual| Arc::ptr_eq(actual, configured))
            || native.command() != command
            || native.authority() != original.captured_authority()
            || original.captured_authority() != &e.authority
            || command.command_id != "homebox.entity.quantity.set"
            || command.context != e.scope
            || command.target != e.target
            || command.target.resource_kind != ResourceKind::Entity
            || command.target.entity_id.is_some()
            || command.target.id().is_err()
            || command.target.id().is_ok_and(|id| id.is_nil())
            || command.approval_receipt_id.is_some()
            || command.native_sync_behavior.is_some()
            || request.id() != OperationId::HomeboxEntityQuantitySet
            || request.raw() != &command.original_wire
            || request.intent_digest() != command.request_digest.as_str()
            || !request.children().is_empty()
            || request.whole_collection_required()
            || command.original_wire["preconditions"]["atlasGuards"]
                .as_array()
                .is_none_or(|guards| !guards.is_empty())
            || captured.source_grants().len() != 1
            || captured.partition_grants().len() != 1
            || captured.source_grants()[0].reference()
                != original.original_activity_source().reference()
            || captured.partition_grants()[0].partition()
                != original.original_activity_partition().partition()
            || original.original_activity_source().reference().partition()
                != *original.original_activity_partition().partition()
            || !configured
                .source()
                .contains(original.original_activity_source().reference())
            || configured.metadata() != &e.metadata
            || !matches!(
                e.authority.qualification,
                NativeQualification::Qualified { .. }
            )
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let maximum = match e.policy {
            QuantityPolicy::NoHuman { maximum } => maximum,
            QuantityPolicy::HumanRequired => return Err(StockPortFault::Unavailable),
        };
        let quantity = command
            .payload
            .get("quantity")
            .and_then(serde_json::Value::as_u64)
            .ok_or(StockPortFault::ContentConflict)?;
        if maximum > 9_007_199_254_740_991
            || quantity > maximum
            || command
                .payload
                .as_object()
                .is_none_or(|payload| payload.len() != 1)
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let preflight = native.preflight();
        let plan = native.plan();
        let path = format!(
            "/api/v1/entities/{}",
            command
                .target
                .id()
                .map_err(|_| StockPortFault::ContentConflict)?
        );
        if preflight.provider_observation != command.provider_observation
            || preflight.request_digest != command.request_digest
            || preflight.source_epoch != e.authority.source_epoch
            || preflight.preparation.snapshots.len() != 1
            || native.capture().snapshots().len() != 1
            || preflight.preparation.snapshots[0].target != command.target
            || !preflight.preparation.snapshots[0].complete
            || preflight.preparation.staged_upload.is_some()
            || !preflight.preparation.native_clear_values.is_empty()
            || map_stock(command, &preflight.preparation)
                .map_err(|_| StockPortFault::EvidenceConflict)?
                != *plan
            || plan_digest(plan)? != self.plan_digest
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
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(())
    }
    fn check_guard(
        &self,
        original: &OriginalStockActivityPrincipal,
        registration: &storage::StockActivityRegistration,
        guard: &access::TransactionAuthorization<'_>,
    ) -> Result<(), StockPortFault> {
        self.check_original(original)?;
        let configured = self.preparation.configured();
        let e = configured.descriptor();
        let physical = configured.physical();
        if !std::ptr::eq(guard.principal(), original.original_activity_principal())
            || registration.physical_binding != physical.physical_binding
            || registration.owner_id != physical.owner_id
            || registration.dispatcher_epoch != physical.dispatcher_epoch
            || registration.source_epoch != e.authority.source_epoch
            || registration.qualification != e.authority.qualification
            || registration.physical_binding != original.captured_authority().physical_binding
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        guard
            .assert_mutation()
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        guard
            .revalidate_source(original.original_activity_source())
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        guard
            .revalidate_source_partition(original.original_activity_partition())
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        for grant in self.preparation.captured().source_grants() {
            guard
                .revalidate_source(grant)
                .map_err(|_| StockPortFault::EvidenceConflict)?;
        }
        for grant in self.preparation.captured().partition_grants() {
            guard
                .revalidate_source_partition(grant)
                .map_err(|_| StockPortFault::EvidenceConflict)?;
        }
        let metadata = guard
            .persisted_source_metadata(original.original_activity_partition())
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        if &metadata != configured.metadata() {
            return Err(StockPortFault::EvidenceConflict);
        }
        self.preparation
            .native()
            .source()
            .revalidate_activity_capture(guard, self.preparation.native().capture())
            .map_err(source_fault)?;
        guard
            .revalidate()
            .map(|_| ())
            .map_err(|_| StockPortFault::EvidenceConflict)
    }
    fn operation(&self, operation: &StoredOperation, admitted: bool) -> Result<(), StockPortFault> {
        let original = self.preparation.original();
        let command = original.command();
        let outcome = &operation.outcome;
        if operation.operation_id.is_nil()
            || operation.activity_version == 0
            || operation.activity_version > 9_007_199_254_740_991
            || operation.command != *command
            || operation.actor_id != original.captured_authority().actor_id
            || operation.captured_authority != *original.captured_authority()
            || operation.actual_target.is_some()
            || !operation.generated_members.is_empty()
            || outcome.schema_version != 3
            || outcome.command_id != command.command_id
            || outcome.request_id != command.request_id
            || outcome.operation_id != operation.operation_id
            || outcome.resolved_scope != command.context
            || outcome.request_digest != command.request_digest
            || outcome.causality_proven
            || outcome.atomic_provider_cas
            || !outcome.native_editor_race_possible
            || !outcome.known_effects.is_empty()
            || outcome.response_digest.is_some()
            || outcome.readback_digest.is_some()
            || outcome.generated_identity_resolved
            || outcome.verification != Verification::Unresolved
            || outcome.response_success
            || outcome.readback_agrees
            || outcome.resolution_evidence_digest.is_some()
            || outcome.resolution_actor_id.is_some()
            || outcome.storage_liability != no_stage_liability()
            || outcome.observed_at.len() > 128
            || read::Timestamp::parse(&outcome.observed_at).is_err()
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        if admitted {
            if operation.activity_version < 2
                || operation.plan.as_ref() != Some(self.preparation.native().plan())
                || outcome.state != OutcomeState::Dispatching
                || !outcome.unknown_scope_fence_retained
                || outcome.remote_activity
                    != (RemoteActivity::Active {
                        termination_evidence_digest: None,
                    })
            {
                return Err(StockPortFault::EvidenceConflict);
            }
        } else if operation.plan.is_some()
            || !matches!(outcome.state, OutcomeState::Prepared | OutcomeState::Queued)
            || outcome.unknown_scope_fence_retained
            || outcome.remote_activity != RemoteActivity::not_dispatched()
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(())
    }
    fn check_admission(
        &self,
        operation: &StoredOperation,
        plan: &NativePlan,
        preflight: &StockPreflight,
    ) -> Result<(), StockPortFault> {
        self.operation(operation, false)?;
        if plan != self.preparation.native().plan()
            || preflight != self.preparation.native().preflight()
            || plan.request.method != NativeMethod::Patch
            || !matches!(plan.request.body, NativeBody::Json(_))
            || preflight.preparation.staged_upload.is_some()
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(())
    }
    fn check_action(
        &self,
        phase: storage::StockActivityPhase,
        action: storage::StockActivityAction<'_>,
    ) -> Result<(), StockPortFault> {
        use storage::{StockActivityAction as Action, StockActivityPhase as Phase};
        match action {
            Action::Reserve(command, authority)
                if matches!(phase, Phase::Entry | Phase::Precommit) =>
            {
                if command != self.preparation.original().command()
                    || authority != self.preparation.native().authority()
                {
                    return Err(StockPortFault::ContentConflict);
                }
                Ok(())
            }
            Action::Admit(operation, plan, digest, preflight, authority)
                if matches!(phase, Phase::Entry | Phase::Precommit) =>
            {
                self.check_admission(operation, plan, preflight)?;
                if digest != &self.plan_digest || authority != self.preparation.native().authority()
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                Ok(())
            }
            Action::Invoke(operation, permit, plan, authority)
                if matches!(phase, Phase::Entry | Phase::Precommit) =>
            {
                self.operation(operation, true)?;
                let physical = self.preparation.configured().physical();
                let expected = self.preparation.native().authority();
                if plan != self.preparation.native().plan()
                    || authority != expected
                    || permit.operation_id != operation.operation_id
                    || permit.actor_id != operation.actor_id
                    || permit.physical_binding != physical.physical_binding
                    || permit.owner_id != physical.owner_id
                    || permit.dispatcher_epoch != physical.dispatcher_epoch
                    || permit.source_epoch != expected.source_epoch
                    || permit.plan_digest != self.plan_digest
                    || permit.qualification != expected.qualification
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                // Storage separately proves the original body-accepted hold and
                // one-shot producer under its same transaction. Permit DATA alone
                // cannot establish those facts or issue an invocation carrier.
                Ok(())
            }
            Action::Disclose(operation) => self.operation(
                operation,
                matches!(operation.outcome.state, OutcomeState::Dispatching),
            ),
            _ => Err(StockPortFault::Unavailable),
        }
    }
}
impl<T: read::Transport, K: read::Clock + Send + Sync>
    storage::StockActivityAuthorization<OriginalStockActivityPrincipal>
    for QuantityActivityAuthorization<'_, '_, '_, '_, T, K>
{
    fn authorize(
        &self,
        original: &OriginalStockActivityPrincipal,
        registration: &storage::StockActivityRegistration,
        guard: Option<&access::TransactionAuthorization<'_>>,
        phase: storage::StockActivityPhase,
        action: storage::StockActivityAction<'_>,
    ) -> Result<(), StockPortFault> {
        if let Some(guard) = guard {
            self.check_guard(original, registration, guard)?;
            return self.check_action(phase, action);
        }
        // These legacy port fences occur outside every Store transaction.
        // A supplied guard always takes the branch above, with no lock reentry.
        if !matches!(
            (phase, action),
            (
                storage::StockActivityPhase::Entry,
                storage::StockActivityAction::Reserve(..)
            ) | (
                storage::StockActivityPhase::Release,
                storage::StockActivityAction::Disclose(_)
            )
        ) {
            return Err(StockPortFault::Unavailable);
        }
        let mut boundary = self
            .preparation
            .configured()
            .access()
            .try_lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        boundary
            .with_mutation_authorization(original.original_activity_principal(), |guard| {
                self.check_guard(original, registration, guard)
                    .map_err(ActivityFailure)?;
                self.check_action(phase, action).map_err(ActivityFailure)
            })
            .map_err(|failure| failure.0)
    }
    fn admission(
        &self,
        original: &OriginalStockActivityPrincipal,
        registration: &storage::StockActivityRegistration,
        guard: &access::TransactionAuthorization<'_>,
        operation: &StoredOperation,
        plan: &NativePlan,
        preflight: &StockPreflight,
    ) -> Result<storage::StockActivityAdmissionEvidence, StockPortFault> {
        self.check_guard(original, registration, guard)?;
        self.check_admission(operation, plan, preflight)?;
        Ok(storage::StockActivityAdmissionEvidence {
            approval: None,
            liability: no_stage_liability(),
        })
    }
}
fn no_stage_liability() -> StorageLiability {
    StorageLiability {
        accounting_complete: true,
        metadata_commit_evidence: MetadataEvidence::NotDispatched,
        byte_disposition: ByteDisposition::None,
        reference_closure_evidence: ReferenceClosure::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 0,
        known_bytes: 0,
        reserved_bytes: Some(0),
    }
}
fn plan_digest(plan: &NativePlan) -> Result<Digest, StockPortFault> {
    let value = serde_json::to_value(plan).map_err(|_| StockPortFault::ContentConflict)?;
    let digest = crate::contracts::semantics::canonical_digest(&value)
        .map_err(|_| StockPortFault::ContentConflict)?;
    Digest::parse(digest).map_err(|_| StockPortFault::ContentConflict)
}
fn source_fault(error: StockErrorCode) -> StockPortFault {
    match error {
        StockErrorCode::ResourceUnavailable | StockErrorCode::SourceUnavailable => {
            StockPortFault::Unavailable
        }
        StockErrorCode::InvalidArgument => StockPortFault::ContentConflict,
        _ => StockPortFault::EvidenceConflict,
    }
}
struct ActivityFailure(StockPortFault);
impl From<access::AccessError> for ActivityFailure {
    fn from(_: access::AccessError) -> Self {
        Self(StockPortFault::EvidenceConflict)
    }
}
