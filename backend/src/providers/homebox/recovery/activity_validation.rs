//! Recompute accepted native facts at each own historical event cut.
use super::{NativeWriterContracts, activity_capture::*, incompatible, unavailable};
use crate::{providers::homebox::write::stock as n, storage as s};
use n::StockContractPort;
fn require(value: bool) -> s::Result<()> {
    if value { Ok(()) } else { Err(incompatible()) }
}
pub(super) fn require_queued_cut(
    registration: &s::StockActivityRegistration,
    event: &s::RetainedStockActivityEvent,
) -> s::Result<()> {
    let operation = event.operation();
    require(
        operation.outcome.state == n::OutcomeState::Queued
            && operation.plan.is_none()
            && operation.captured_authority.physical_binding == registration.physical_binding
            && matches!(
                event.facts(),
                s::StockActivityEventFacts::Reserve | s::StockActivityEventFacts::Queued
            ),
    )
}
pub(super) fn validate_prefix(
    contracts: &NativeWriterContracts,
    record: &s::RetainedStockActivity,
    prefix: &[s::RetainedStockActivityEvent],
    native: &[RetainedStockNativeEvent],
) -> s::Result<()> {
    require(!prefix.is_empty() && record.events().get(..prefix.len()) == Some(prefix))?;
    validate_event_prefix(contracts, record.registration(), prefix, native)
}
pub(super) trait ActivityEventView {
    fn sequence(&self) -> u64;
    fn operation(&self) -> &n::StoredOperation;
    fn facts(&self) -> &s::StockActivityEventFacts;
}
impl ActivityEventView for s::RetainedStockActivityEvent {
    fn sequence(&self) -> u64 {
        self.sequence()
    }
    fn operation(&self) -> &n::StoredOperation {
        self.operation()
    }
    fn facts(&self) -> &s::StockActivityEventFacts {
        self.facts()
    }
}
pub(super) fn validate_event_prefix<T: ActivityEventView>(
    contracts: &NativeWriterContracts,
    registration: &s::StockActivityRegistration,
    prefix: &[T],
    native: &[RetainedStockNativeEvent],
) -> s::Result<()> {
    require(!prefix.is_empty())?;
    let first = prefix.first().ok_or_else(incompatible)?;
    require(matches!(first.facts(), s::StockActivityEventFacts::Reserve))?;
    let mut permit = None;
    let mut raw_index = 0usize;
    for (index, event) in prefix.iter().enumerate() {
        let operation = event.operation();
        let original = first.operation();
        require(
            event.sequence() != 0
                && operation.operation_id == original.operation_id
                && !operation.operation_id.is_nil()
                && operation.command == original.command
                && operation.actor_id == original.actor_id
                && operation.captured_authority == original.captured_authority
                && operation.actor_id == operation.captured_authority.actor_id
                && operation.captured_authority.physical_binding == registration.physical_binding
                && operation.captured_authority.source_epoch == registration.source_epoch
                && operation.captured_authority.qualification == registration.qualification
                && registration.dispatcher_epoch != 0
                && registration.source_epoch != 0
                && !registration.owner_id.is_nil()
                && !registration.physical_binding.deployment_id.is_nil()
                && !registration.physical_binding.physical_database_id.is_nil()
                && contracts
                    .validate_request(&operation.command.original_wire)
                    .map_err(|_| incompatible())?
                    == operation.command
                && operation.outcome.operation_id == operation.operation_id
                && operation.outcome.command_id == operation.command.command_id
                && operation.outcome.request_id == operation.command.request_id
                && operation.outcome.request_digest == operation.command.request_digest
                && operation.outcome.resolved_scope == operation.command.context,
        )?;
        contracts
            .validate_outcome(&operation.outcome)
            .map_err(|_| incompatible())?;
        contracts
            .validate_observed_at(&operation.outcome.observed_at)
            .map_err(|_| incompatible())?;
        if let Some(prior) = index.checked_sub(1).and_then(|i| prefix.get(i)) {
            require(
                event.sequence() > prior.sequence()
                    && prior.operation().activity_version.checked_add(1)
                        == Some(operation.activity_version),
            )?;
        }
        match event.facts() {
            s::StockActivityEventFacts::Reserve => require(
                index == 0
                    && operation.activity_version == 1
                    && operation.plan.is_none()
                    && permit.is_none()
                    && *operation == s::retained_native_codec_bridge::baseline(operation),
            )?,
            s::StockActivityEventFacts::Queued => {
                let mut expected = prefix[index.checked_sub(1).ok_or_else(incompatible)?]
                    .operation()
                    .clone();
                require(
                    expected.outcome.state == n::OutcomeState::Prepared
                        && expected.plan.is_none()
                        && permit.is_none(),
                )?;
                expected.outcome.state = n::OutcomeState::Queued;
                expected.activity_version += 1;
                require(expected == *operation)?;
            }
            s::StockActivityEventFacts::Admit(admission) => {
                require(permit.is_none())?;
                let prior = prefix
                    .get(index.checked_sub(1).ok_or_else(incompatible)?)
                    .ok_or_else(incompatible)?
                    .operation();
                validate_admission(contracts, registration, prior, operation, admission)?;
                permit = Some(&admission.permit);
            }
            s::StockActivityEventFacts::Dispatch(_)
            | s::StockActivityEventFacts::Observation(_)
            | s::StockActivityEventFacts::NeverInvoked => {
                let prior = prefix
                    .get(index.checked_sub(1).ok_or_else(incompatible)?)
                    .ok_or_else(incompatible)?
                    .operation();
                let raw = native.get(raw_index).ok_or_else(unavailable)?;
                validate_native(contracts, registration, prior, event, permit, raw)?;
                raw_index += 1;
            }
            s::StockActivityEventFacts::Reject(_) => return Err(unavailable()),
        }
    }
    // Future entries in the independent archive must never qualify this cut.
    require(
        native
            .get(raw_index)
            .is_none_or(|v| v.sequence > prefix.last().unwrap().sequence()),
    )?;
    Ok(())
}
fn validate_admission(
    contracts: &NativeWriterContracts,
    registration: &s::StockActivityRegistration,
    prior: &n::StoredOperation,
    admitted: &n::StoredOperation,
    cut: &s::StockActivityAdmissionCut,
) -> s::Result<()> {
    let c = &admitted.command;
    let p = &cut.permit;
    let f = &cut.preflight;
    let plan = admitted.plan.as_ref().ok_or_else(incompatible)?;
    require(
        prior.plan.is_none()
            && matches!(
                prior.outcome.state,
                n::OutcomeState::Prepared | n::OutcomeState::Queued
            )
            && p.operation_id == admitted.operation_id
            && p.actor_id == admitted.actor_id
            && p.physical_binding == registration.physical_binding
            && p.owner_id == registration.owner_id
            && p.dispatcher_epoch == registration.dispatcher_epoch
            && p.source_epoch == registration.source_epoch
            && p.qualification == registration.qualification
            && f.provider_observation == c.provider_observation
            && f.request_digest == c.request_digest
            && f.source_epoch == p.source_epoch
            && n::map_stock(c, &f.preparation).map_err(|_| incompatible())? == *plan
            && contracts
                .digest_native(&serde_json::to_value(plan).map_err(|_| incompatible())?)
                .map_err(|_| incompatible())?
                == p.plan_digest
            && cut.evidence.approval.as_ref().map(|a| a.receipt_id) == c.approval_receipt_id
            && cut.evidence.liability.well_formed(),
    )?;
    for snapshot in &f.preparation.snapshots {
        require(
            snapshot.target.same_partition(&c.target)
                && snapshot.complete
                && contracts
                    .digest_native(&snapshot.value)
                    .map_err(|_| incompatible())?
                    == snapshot.digest,
        )?;
    }
    if let n::NativeBody::Multipart { stage, .. } = &plan.request.body {
        require(
            cut.evidence
                .liability
                .reserved_bytes
                .is_some_and(|bytes| bytes >= stage.byte_size),
        )?;
    }
    let mut expected = prior.clone();
    expected.plan = Some(plan.clone());
    expected.outcome.state = n::OutcomeState::Dispatching;
    expected.outcome.remote_activity = n::RemoteActivity::Active {
        termination_evidence_digest: None,
    };
    expected.outcome.unknown_scope_fence_retained = true;
    expected.outcome.storage_liability = cut.evidence.liability.clone();
    expected.activity_version = expected
        .activity_version
        .checked_add(1)
        .ok_or_else(incompatible)?;
    require(expected == *admitted)
}
pub(super) fn validate_native(
    contracts: &NativeWriterContracts,
    registration: &s::StockActivityRegistration,
    before: &n::StoredOperation,
    event: &impl ActivityEventView,
    permit: Option<&n::InvocationPermit>,
    raw: &RetainedStockNativeEvent,
) -> s::Result<()> {
    let permit = permit.ok_or_else(incompatible)?;
    require(
        raw.sequence == event.sequence()
            && raw.before == *before
            && permit.operation_id == before.operation_id
            && permit.actor_id == before.actor_id
            && permit.physical_binding == registration.physical_binding
            && permit.owner_id == registration.owner_id
            && permit.dispatcher_epoch == registration.dispatcher_epoch
            && permit.source_epoch == registration.source_epoch
            && permit.qualification == registration.qualification,
    )?;
    let mut expected = before.clone();
    match (&raw.raw, event.facts()) {
        (
            RawNativeCut::Dispatch {
                permit: captured,
                plan,
                authority,
                result: n::NativeDispatch::Invoked(receipt),
            },
            s::StockActivityEventFacts::Dispatch(facts),
        ) => {
            require(
                captured == permit
                    && before.plan.as_ref() == Some(plan.as_ref())
                    && authority == &before.captured_authority
                    && receipt.operation_id == permit.operation_id
                    && receipt.plan_digest == permit.plan_digest
                    && receipt.context == before.command.context
                    && receipt.source_instance_id == before.command.target.source_instance_id
                    && receipt.collection_id == before.command.target.collection_id
                    && receipt.remote_activity.invoked()
                    && receipt.remote_activity.well_formed(),
            )?;
            let actual =
                n::retained_bridge::dispatch(contracts, &before.command, plan, permit, receipt);
            require(actual == *facts)?;
            expected.outcome = before
                .outcome
                .with_dispatch(&actual)
                .ok_or_else(incompatible)?;
            require(
                before.actual_target.is_none() || before.actual_target == actual.generated_target,
            )?;
            require(
                before.generated_members.is_empty()
                    || before.generated_members == actual.generated_members,
            )?;
            expected.actual_target = actual.generated_target;
            expected.generated_members = actual.generated_members;
        }
        (
            RawNativeCut::Dispatch {
                permit: captured,
                plan,
                authority,
                result: n::NativeDispatch::NeverInvoked,
            },
            s::StockActivityEventFacts::NeverInvoked,
        ) => {
            require(
                captured == permit
                    && before.plan.as_ref() == Some(plan.as_ref())
                    && authority == &before.captured_authority
                    && before.outcome.state == n::OutcomeState::Dispatching
                    && before.outcome.response_digest.is_none()
                    && before.outcome.readback_digest.is_none(),
            )?;
            expected.outcome.state = n::OutcomeState::RejectedBeforeDispatch;
            expected.outcome.verification = n::Verification::NoDispatch;
            expected.outcome.remote_activity = n::RemoteActivity::not_dispatched();
            expected.outcome.unknown_scope_fence_retained = false;
        }
        (
            RawNativeCut::Observation {
                plan,
                authority,
                result,
            },
            s::StockActivityEventFacts::Observation(facts),
        ) => {
            require(
                readback_authority_matches(before, authority)
                    && n::retained_bridge::readback_plan(before).as_ref() == Some(plan),
            )?;
            let actual = n::retained_bridge::observation(contracts, before, result)
                .ok_or_else(incompatible)?;
            require(actual == *facts)?;
            expected.outcome = before
                .outcome
                .with_observation(&actual)
                .ok_or_else(incompatible)?;
        }
        _ => return Err(incompatible()),
    }
    expected.activity_version = before
        .activity_version
        .checked_add(1)
        .ok_or_else(incompatible)?;
    contracts
        .validate_outcome(&expected.outcome)
        .map_err(|_| incompatible())?;
    require(expected == *event.operation())
}

// Exact accepted workflow compatibility after a refreshed readback grant.
// This comparison never creates a grant; actual authority is retained and the
// inner original readback owner independently authorizes the GET.
pub(super) fn readback_authority_matches(
    operation: &n::StoredOperation,
    authority: &n::StockAuthority,
) -> bool {
    authority.actor_id == operation.actor_id
        && authority.physical_binding == operation.captured_authority.physical_binding
}
