//! Integrator declaration inside write::stock makes the accepted private
//! evidence functions available without copying or widening their semantics.
use super::*;

pub(crate) fn dispatch<C: StockContractPort>(
    contracts: &C,
    command: &StockCommand,
    plan: &NativePlan,
    permit: &InvocationPermit,
    receipt: &DispatchReceipt,
) -> DispatchFacts {
    super::evidence::dispatch_facts(contracts, command, plan, permit, receipt)
}
pub(crate) fn observation<C: StockContractPort>(
    contracts: &C,
    operation: &StoredOperation,
    observation: &NativeObservation,
) -> Option<ObservationFacts> {
    super::evidence::observation_facts(contracts, operation, observation)
}
pub(crate) fn target(operation: &StoredOperation) -> Option<StockTarget> {
    super::evidence::effective_target(operation, operation.plan.as_ref()?)
}
pub(crate) fn invalid_request(request_id: uuid::Uuid) -> StockError {
    StockError::new(request_id, None, StockErrorCode::InvalidArgument)
}

pub(crate) fn readback_plan(operation: &StoredOperation) -> Option<ReadbackPlan> {
    let mut readback = operation.plan.as_ref()?.readback.clone();
    if matches!(
        readback.selector,
        ReadbackSelector::Whole | ReadbackSelector::RootList | ReadbackSelector::Member { .. }
    ) {
        readback.target = target(operation)?;
        readback.path = readback
            .path
            .replace("{generatedId}", &readback.target.id().ok()?.to_string());
    }
    Some(readback)
}
