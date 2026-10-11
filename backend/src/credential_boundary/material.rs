//! Original material retention checks for narrow terminal writes.
use super::record::encode;
use crate::ai::{
    AiError,
    oauth::{RefreshCheckpoint, RegistrationRecord},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Hashes of authenticated material permit preserving or retiring it after a
/// local stop without retaining a second plaintext record in the lease.
pub(crate) struct MaterialFingerprints {
    pub(crate) credentials: Option<[u8; 32]>,
    pub(crate) pending: Option<[u8; 32]>,
    pub(crate) checkpoint: Option<[u8; 32]>,
}

#[derive(Deserialize)]
struct MaterialFrame<'a> {
    #[serde(borrow)]
    record: MaterialRecord<'a>,
}

#[derive(Deserialize)]
struct MaterialRecord<'a> {
    #[serde(borrow)]
    credentials: &'a serde_json::value::RawValue,
    #[serde(borrow)]
    pending_authorization: &'a serde_json::value::RawValue,
    #[serde(borrow)]
    refresh_checkpoint: &'a serde_json::value::RawValue,
}

pub(crate) fn material_fingerprints(
    record: &RegistrationRecord,
) -> Result<MaterialFingerprints, AiError> {
    let plaintext = encode(record)?;
    // Borrow raw values from the canonical, bounded, zeroizing envelope. No
    // secret-bearing serde Value or additional plaintext Strings are created.
    let frame: MaterialFrame<'_> = serde_json::from_slice(plaintext.expose_for_encryption())
        .map_err(|_| AiError::DomainUnavailable)?;
    let digest = |raw: &serde_json::value::RawValue| Sha256::digest(raw.get().as_bytes()).into();
    Ok(MaterialFingerprints {
        credentials: record
            .credentials
            .as_ref()
            .map(|_| digest(frame.record.credentials)),
        pending: record
            .pending_authorization
            .as_ref()
            .map(|_| digest(frame.record.pending_authorization)),
        checkpoint: (!matches!(record.refresh_checkpoint, RefreshCheckpoint::None))
            .then(|| digest(frame.record.refresh_checkpoint)),
    })
}
