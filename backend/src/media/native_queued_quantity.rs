//! Concrete detached known-zero Media provenance for the actual quantity owner.
//! The Source issuer supplies positive no-stage admission. Queue DATA cannot
//! manufacture it, and only Storage's original Release-qualified proof can
//! qualify a historical initial attempt. These checks perform no I/O or reentry.
use std::sync::Arc;

use crate::{
    domain::{
        queue_recovery::{QueuedMediaRecovery, RetainedAttempt, RetainedEnqueue, RetainedOutcome},
        stock::ValidatedRequest,
    },
    jobs::{CanonicalScope, EnqueueRequest, LeasedJob, PendingByteLiability, QueueRegistration},
    providers::homebox::write::stock::quantity_queue_original::NativeQueuedQuantityOriginal,
    storage::{self as s, RecordedOriginalEnqueueProof},
};

use super::{MediaError, MediaResult};

// Constructed only after the actual Source token matches its private original
// issuer and positively supplies the exact known-zero accounting DATA.
struct KnownZeroReservation {
    pending: PendingByteLiability,
    bytes: u64,
}

/// Immutable concrete Media cut for one genuine Source allocation. No Clone,
/// Default, serde or DATA/proof constructor. This cut retains no live Access,
/// vault, Store, credential or grant and provides no current queue authority.
pub struct NativeQueuedMediaOriginal {
    source: Arc<NativeQueuedQuantityOriginal>,
    reservation: KnownZeroReservation,
}

fn unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Original quantity Media provenance is unavailable",
    )
}

impl NativeQueuedMediaOriginal {
    /// Bind only the producer's actual private-issuer known-zero admission.
    /// Neither a missing reservation nor a request/DTO zero is an admission.
    pub fn from_quantity(source: Arc<NativeQueuedQuantityOriginal>) -> MediaResult<Self> {
        let admission = source.known_zero_admission();
        if !admission.matches_original(&source) {
            return Err(MediaError::Unavailable);
        }
        let pending = admission.pending_byte_liability();
        if pending.required
            || pending.reserved_bytes != Some(0)
            || pending != source.enqueue_request().pending_byte_liability
        {
            return Err(MediaError::Unavailable);
        }
        let bytes = pending.reserved_bytes.ok_or(MediaError::Unavailable)?;
        Ok(Self {
            source,
            reservation: KnownZeroReservation { pending, bytes },
        })
    }

    pub fn source(&self) -> &Arc<NativeQueuedQuantityOriginal> {
        &self.source
    }

    /// Allocation and positive producer admission only, for live Root binding.
    /// Historical validation additionally requires the actual recorded proof.
    pub fn matches_source(&self, source: &Arc<NativeQueuedQuantityOriginal>) -> bool {
        Arc::ptr_eq(&self.source, source)
            && self.source.known_zero_admission().matches_original(source)
            && self.source.known_zero_admission().pending_byte_liability()
                == self.reservation.pending
            && self.source.enqueue_request().pending_byte_liability == self.reservation.pending
    }

    /// Positive bytes retained from the genuine producer token, never inferred
    /// from MIME, a digest label, an absent stage or unknown accounting.
    pub fn known_reserved_bytes(&self) -> u64 {
        self.reservation.bytes
    }

    pub fn pending_byte_liability(&self) -> PendingByteLiability {
        self.reservation.pending
    }

    /// Pure historical comparison against the exact Source/Media allocations
    /// retained by Storage's actual released original enqueue. Request, scope
    /// and registration are matching DATA; none can construct this proof.
    pub fn validate_original(
        &self,
        proof: &RecordedOriginalEnqueueProof,
        source: &Arc<NativeQueuedQuantityOriginal>,
        registration: &QueueRegistration,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
    ) -> s::Result<()> {
        if !std::ptr::eq(self, proof.media_cut().as_ref())
            || !Arc::ptr_eq(source, proof.source_cut())
            || !self.matches_source(source)
        {
            return Err(unavailable());
        }
        if registration != &source.queue_config().registration
            || original.raw() != &source.command().original_wire
            || request != source.enqueue_request()
            || scope != source.canonical_scope()
            || request.pending_byte_liability != self.reservation.pending
        {
            return Err(unavailable());
        }
        Ok(())
    }

    /// The exact approved cross-owner call requires the leased cut as its last
    /// argument. Storage's private Release-qualified matcher runs FIRST; DTO
    /// equality cannot substitute for a released original claim allocation.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_unprepared_attempt(
        &self,
        proof: &RecordedOriginalEnqueueProof,
        source: &Arc<NativeQueuedQuantityOriginal>,
        registration: &QueueRegistration,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        job: &LeasedJob,
    ) -> s::Result<()> {
        if !proof.matches_released_attempt(job)
            || !std::ptr::eq(self, proof.media_cut().as_ref())
            || !Arc::ptr_eq(source, proof.source_cut())
            || !Arc::ptr_eq(source, &self.source)
        {
            return Err(unavailable());
        }
        self.validate_original(proof, source, registration, original, request, scope)?;
        if job.request != *request
            || job.canonical_scope != *scope
            || job.pending_byte_liability != self.reservation.pending
            || job.lease.physical_identity != registration.identity
            || job.lease.owner_id != registration.dispatcher_owner_id
            || job.attempt != 1
        {
            return Err(unavailable());
        }
        Ok(())
    }
}

/// Implements the existing concrete offline Media peer only for the genuine
/// recorded enqueue and its original unprepared initial claim. Prepared bytes,
/// journals, steps, liability prefixes and outcomes require other actual owners
/// and remain unavailable. This peer issues no dispatch/recovery permission.
impl QueuedMediaRecovery<RecordedOriginalEnqueueProof> for NativeQueuedMediaOriginal {
    fn validate_original(
        &self,
        enqueue: &RetainedEnqueue<'_, RecordedOriginalEnqueueProof>,
    ) -> s::Result<()> {
        let source = enqueue.original_proof.source_cut();
        NativeQueuedMediaOriginal::validate_original(
            self,
            enqueue.original_proof,
            source,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
        )?;
        if enqueue.config != source.queue_config() {
            return Err(unavailable());
        }
        Ok(())
    }

    fn validate_attempt(
        &self,
        attempt: &RetainedAttempt<'_, RecordedOriginalEnqueueProof>,
    ) -> s::Result<()> {
        let enqueue = &attempt.enqueue;
        let source = enqueue.original_proof.source_cut();
        self.validate_unprepared_attempt(
            enqueue.original_proof,
            source,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
            attempt.job,
        )?;
        if enqueue.config != source.queue_config()
            || attempt.prepared.is_some()
            || attempt.journal.is_some()
            || !attempt.steps.is_empty()
            || !attempt.liabilities.is_empty()
            || !attempt.outcomes.is_empty()
        {
            return Err(unavailable());
        }
        Ok(())
    }

    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, RecordedOriginalEnqueueProof>,
    ) -> s::Result<()> {
        Err(unavailable())
    }
}
