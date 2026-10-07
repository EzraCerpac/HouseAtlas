//! Current attachment intake measured by the actual Media owner.
use crate::{
    access::{CanonicalId, TransactionAuthorization},
    media::{
        MediaError, MediaResult, WorkBudget,
        native::RetainedPrincipal,
        staged_upload::{NativeUploadStages, UploadAdmission},
        types::AssetPurpose,
        vault::PreparedOriginal,
    },
    storage::Runtime,
};
use std::io::Read;

/// Original outer request correlation, supplied before existing-asset lookup.
/// These IDs are data; the Media call below checks the actual intake authority.
pub struct AttachmentIntakeIdentity<'a> {
    pub request_id: &'a str,
    pub idempotency_key: &'a str,
}

/// Owned measurement for one original attachment request. The only constructor
/// calls Media with the actual body and original mutation guard. No constructor
/// accepts manifest fields or a caller's PreparedOriginal. No mutable accessor,
/// Clone or deserializer can substitute data or rebind a later request.
pub struct MeasuredAttachmentOriginal {
    original: RetainedPrincipal,
    request_id: CanonicalId,
    idempotency_key: CanonicalId,
    prepared: PreparedOriginal,
}

impl MeasuredAttachmentOriginal {
    /// Read-only input to Storage's actual scoped original resolver.
    pub fn prepared(&self) -> &PreparedOriginal {
        &self.prepared
    }

    /// The retained original AT11 allocation, not renewed authority.
    pub fn original_principal(&self) -> &RetainedPrincipal {
        &self.original
    }

    pub fn request_id(&self) -> &str {
        self.request_id.as_str()
    }

    pub fn idempotency_key(&self) -> &str {
        self.idempotency_key.as_str()
    }
}

/// Measure this evidence intake under real Media admission limits without
/// issuing an asset ID or token. Retain the original outer request IDs: an old
/// measurement cannot qualify a fresh request with different IDs or key.
pub fn measure_attachment_original<R: Runtime>(
    identity: AttachmentIntakeIdentity<'_>,
    stages: &NativeUploadStages<'_, R>,
    guard: &TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    admission: &UploadAdmission,
    body: &mut impl Read,
    budget: &WorkBudget,
) -> MediaResult<MeasuredAttachmentOriginal> {
    let request_id =
        CanonicalId::parse(identity.request_id).map_err(|_| MediaError::InvalidInput)?;
    let idempotency_key =
        CanonicalId::parse(identity.idempotency_key).map_err(|_| MediaError::InvalidInput)?;
    if admission.purpose != AssetPurpose::EvidenceOriginal {
        return Err(MediaError::Unsupported);
    }
    let prepared =
        stages.prepare_original_for_resolution(guard, original, admission, body, budget)?;
    Ok(MeasuredAttachmentOriginal {
        original: original.clone(),
        request_id,
        idempotency_key,
        prepared,
    })
}
