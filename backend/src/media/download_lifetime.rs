//! Presentation data sampled from an actual process-local issuer deadline.
//! No permission, renewal, URL inference, wall-clock conversion or wire3 change.
use serde::Serialize;
use std::time::Instant;

/// Remaining display budget at the owner's final availability observation.
/// This is not a promise of future authority or file presence: either can change
/// before the handle deadline. No serde reconstruction or public field mutation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadLifetime {
    remaining_ms: u64,
}

impl DownloadLifetime {
    pub fn remaining_ms(&self) -> u64 {
        self.remaining_ms
    }
}

/// Owner-resolution DATA, not a download capability. Only `Available` may
/// produce a gateway link; missing owner bindings preserve `Unbound`. Native
/// authority failures remain errors, rather than disclosing a handle's status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum DownloadAvailability {
    Available { lifetime: DownloadLifetime },
    Unavailable,
    Unbound,
}

/// Trusted issuer supplies its exact retained deadline, after actual current
/// authority/file checks. Floors milliseconds so display never rounds beyond
/// the deadline. No positive sub-millisecond budget is advertised. A gateway
/// transport adapter anchors this budget to the START of its resolve call in
/// the client's monotonic clock, accounting conservatively for transport and
/// rendering delays; sampling at receipt would extend the actual issuer life.
/// This pure projection cannot establish that any handle exists/is available.
pub fn project_issuer_lifetime(deadline: Instant) -> Option<DownloadLifetime> {
    let remaining_ms =
        u64::try_from(deadline.checked_duration_since(Instant::now())?.as_millis()).ok()?;
    (remaining_ms > 0).then_some(DownloadLifetime { remaining_ms })
}
