//! Integrator declares this owned bridge inside storage::stock_activity.
//! Accepted data codecs only; no SQL, sealed record constructor or live brand.
use super::*;
use crate::storage::{Error, Result};

// The archive authenticates exact bytes, including these nested strings. Do
// not rely on the peer decoder's present/future acceptance of equivalent JSON:
// its decoded data must produce the very same original-owner encoding.
fn decode_exact<T>(
    json: &str,
    decode: impl FnOnce(&str) -> Result<T>,
    encode: impl FnOnce(&T) -> Result<String>,
) -> Result<T> {
    let value = decode(json)?;
    if encode(&value)? != json {
        return Err(Error::new(
            "schema-incompatible",
            "Retained native storage string is not canonical",
        ));
    }
    Ok(value)
}

pub(crate) fn encode_operation(v: &StoredOperation) -> Result<String> {
    super::codec::encode_operation(v)
}
pub(crate) fn decode_operation(v: &str) -> Result<StoredOperation> {
    decode_exact(v, super::codec::decode_operation, encode_operation)
}
pub(crate) fn encode_permit(v: &InvocationPermit) -> Result<String> {
    super::codec::encode_permit(v)
}
pub(crate) fn decode_permit(v: &str) -> Result<InvocationPermit> {
    decode_exact(v, super::codec::decode_permit, encode_permit)
}
pub(crate) fn encode_dispatch(v: &DispatchFacts) -> Result<String> {
    super::codec::encode_dispatch(v)
}
pub(crate) fn decode_dispatch(v: &str) -> Result<DispatchFacts> {
    decode_exact(v, super::codec::decode_dispatch, encode_dispatch)
}
pub(crate) fn encode_observation(v: &ObservationFacts) -> Result<String> {
    super::codec::encode_observation(v)
}
pub(crate) fn decode_observation(v: &str) -> Result<ObservationFacts> {
    decode_exact(v, super::codec::decode_observation, encode_observation)
}
pub(crate) fn encode_admission(v: &StockActivityAdmissionCut) -> Result<String> {
    super::codec::encode_admission(&v.permit, &v.preflight, &v.evidence)
}
pub(crate) fn decode_admission(v: &str) -> Result<StockActivityAdmissionCut> {
    decode_exact(
        v,
        |json| {
            let (permit, preflight, evidence) = super::codec::decode_admission(json)?;
            Ok(StockActivityAdmissionCut {
                permit,
                preflight,
                evidence,
            })
        },
        encode_admission,
    )
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
