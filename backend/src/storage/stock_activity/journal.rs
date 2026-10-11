//! Check retained fact/snapshot linkage without reconstructing authority.
use super::*;

pub(super) fn check(
    previous: Option<&StoredOperation>,
    event: &StoredOperation,
    kind: &str,
    facts: &str,
    retained_permit: Option<&InvocationPermit>,
) -> PortResult<()> {
    let Some(previous) = previous else {
        if kind != "reserve"
            || !matches!(
                event.outcome.state,
                OutcomeState::Prepared | OutcomeState::Queued
            )
            || *event
                != super::baseline::fresh(
                    &event.command,
                    &event.captured_authority,
                    event.operation_id,
                    &event.outcome.observed_at,
                    event.outcome.state == OutcomeState::Queued,
                )
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        return Ok(());
    };
    let mut expected = previous.clone();
    match kind {
        "queued" => {
            if previous.outcome.state != OutcomeState::Prepared || previous.plan.is_some() {
                return Err(StockPortFault::EvidenceConflict);
            }
            expected.outcome.state = OutcomeState::Queued;
        }
        "admit" => {
            let (permit, preflight, admission) =
                codec::decode_admission(facts).map_err(evidence)?;
            if retained_permit != Some(&permit)
                || previous.plan.is_some()
                || !matches!(
                    previous.outcome.state,
                    OutcomeState::Prepared | OutcomeState::Queued
                )
                || permit.operation_id != event.operation_id
                || permit.actor_id != event.actor_id
                || permit.physical_binding != event.captured_authority.physical_binding
                || permit.source_epoch != event.captured_authority.source_epoch
                || permit.qualification != event.captured_authority.qualification
                || preflight.provider_observation != event.command.provider_observation
                || preflight.request_digest != event.command.request_digest
                || preflight.source_epoch != permit.source_epoch
                || event.plan.is_none()
                || event.outcome.storage_liability != admission.liability
                || admission.approval.as_ref().map(|a| a.receipt_id)
                    != event.command.approval_receipt_id
                || native::map_stock(&event.command, &preflight.preparation).map_err(evidence)?
                    != *event
                        .plan
                        .as_ref()
                        .ok_or(StockPortFault::EvidenceConflict)?
                || crate::contracts::semantics::canonical_digest(
                    &serde_json::to_value(&event.plan).map_err(evidence)?,
                )
                .map_err(evidence)?
                    != permit.plan_digest.as_str()
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            expected.plan = event.plan.clone();
            expected.outcome.state = OutcomeState::Dispatching;
            expected.outcome.remote_activity = RemoteActivity::Active {
                termination_evidence_digest: None,
            };
            expected.outcome.unknown_scope_fence_retained = true;
            expected.outcome.storage_liability = event.outcome.storage_liability.clone();
        }
        "reject" => {
            if previous.plan.is_some()
                || !matches!(
                    previous.outcome.state,
                    OutcomeState::Prepared | OutcomeState::Queued
                )
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            let value: serde_json::Value = serde_json::from_str(facts).map_err(evidence)?;
            let _: StockErrorCode = serde_json::from_value(
                value
                    .get("reason")
                    .ok_or(StockPortFault::EvidenceConflict)?
                    .clone(),
            )
            .map_err(evidence)?;
            expected.outcome.state = OutcomeState::RejectedBeforeDispatch;
            expected.outcome.verification = Verification::NoDispatch;
        }
        "never-invoked" => {
            if previous.outcome.state != OutcomeState::Dispatching
                || previous.outcome.response_digest.is_some()
                || previous.outcome.readback_digest.is_some()
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            expected.outcome.state = OutcomeState::RejectedBeforeDispatch;
            expected.outcome.verification = Verification::NoDispatch;
            expected.outcome.remote_activity = RemoteActivity::not_dispatched();
            expected.outcome.unknown_scope_fence_retained = false;
        }
        "dispatch" => {
            let facts = codec::decode_dispatch(facts).map_err(evidence)?;
            if previous.actual_target.is_some() && previous.actual_target != facts.generated_target
                || !previous.generated_members.is_empty()
                    && previous.generated_members != facts.generated_members
                || facts
                    .generated_target
                    .as_ref()
                    .is_some_and(|t| !t.same_partition(&event.command.target))
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            expected.outcome = previous
                .outcome
                .with_dispatch(&facts)
                .ok_or(StockPortFault::EvidenceConflict)?;
            expected.actual_target = facts.generated_target;
            expected.generated_members = facts.generated_members;
        }
        "observation" => {
            let facts = codec::decode_observation(facts).map_err(evidence)?;
            expected.outcome = previous
                .outcome
                .with_observation(&facts)
                .ok_or(StockPortFault::EvidenceConflict)?;
        }
        _ => return Err(StockPortFault::EvidenceConflict),
    }
    expected.activity_version = previous
        .activity_version
        .checked_add(1)
        .ok_or(StockPortFault::EvidenceConflict)?;
    if expected != *event {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(())
}
