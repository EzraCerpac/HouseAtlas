//! Integrator declares this owned bridge inside storage::stock_activity.
//! Accepted data codecs only; no SQL, sealed record constructor or live brand.
use super::*;
use crate::storage::Result;

pub(crate) fn encode_operation(v: &StoredOperation) -> Result<String> {
    super::codec::encode_operation(v)
}
pub(crate) fn decode_operation(v: &str) -> Result<StoredOperation> {
    super::codec::decode_operation(v)
}
pub(crate) fn encode_permit(v: &InvocationPermit) -> Result<String> {
    super::codec::encode_permit(v)
}
pub(crate) fn decode_permit(v: &str) -> Result<InvocationPermit> {
    super::codec::decode_permit(v)
}
pub(crate) fn encode_dispatch(v: &DispatchFacts) -> Result<String> {
    super::codec::encode_dispatch(v)
}
pub(crate) fn decode_dispatch(v: &str) -> Result<DispatchFacts> {
    super::codec::decode_dispatch(v)
}
pub(crate) fn encode_observation(v: &ObservationFacts) -> Result<String> {
    super::codec::encode_observation(v)
}
pub(crate) fn decode_observation(v: &str) -> Result<ObservationFacts> {
    super::codec::decode_observation(v)
}
pub(crate) fn encode_admission(v: &StockActivityAdmissionCut) -> Result<String> {
    super::codec::encode_admission(&v.permit, &v.preflight, &v.evidence)
}
pub(crate) fn decode_admission(v: &str) -> Result<StockActivityAdmissionCut> {
    let (permit, preflight, evidence) = super::codec::decode_admission(v)?;
    Ok(StockActivityAdmissionCut {
        permit,
        preflight,
        evidence,
    })
}
pub(crate) fn baseline(v: &StoredOperation) -> StoredOperation {
    super::baseline::fresh(
        &v.command,
        &v.captured_authority,
        v.operation_id,
        &v.outcome.observed_at,
        v.outcome.state == OutcomeState::Queued,
    )
}
