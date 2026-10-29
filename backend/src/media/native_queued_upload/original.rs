use super::*;

impl NativeQueuedUploadSnapshot {
    pub fn original(&self) -> &[u8] {
        &self.original
    }
    pub fn scope(&self) -> &read::SourceScope {
        &self.scope
    }
    pub fn target(&self) -> &native::StockTarget {
        &self.target
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
    pub fn digest(&self) -> &native::Digest {
        &self.digest
    }
}

impl NativeQueuedUploadImpact {
    pub fn partition(&self) -> &jobs::SourcePartition {
        &self.partition
    }
    pub fn entity_id(&self) -> &str {
        &self.entity_id
    }
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.staged
    }
    pub fn snapshot_digest(&self) -> &native::Digest {
        &self.snapshot_digest
    }
}

impl NativeQueuedUploadKnownNonzeroAdmission {
    pub fn matches_original(&self, original: &NativeQueuedUploadOriginal) -> bool {
        Arc::ptr_eq(&self.issuer, &original.custody.issuer)
    }
    pub fn pending_byte_liability(&self) -> jobs::PendingByteLiability {
        self.pending
    }
}

impl InstalledNativeQueuedUploadOrigin<'_> {
    pub fn matches_original(&self, original: &NativeQueuedUploadOriginal) -> bool {
        std::ptr::eq(self.original, original)
            && Arc::ptr_eq(self.custody, &original.custody)
            && Arc::ptr_eq(self.custody_issuer, &original.custody.issuer)
            && original
                .installed_issuer
                .as_ref()
                .is_some_and(|issuer| Arc::ptr_eq(self.installed_issuer, issuer))
    }
}

impl NativeQueuedUploadOriginal {
    /// Pure private-allocation correlation, with no I/O or current authority.
    /// The host separately revalidates the same sealed E under its original
    /// principal/exact grant and the actual Source/native/Domain/physical phase.
    pub fn matches_source_preparation(
        &self,
        proof: &NativeQueuedUploadSourcePreparation<'_>,
    ) -> bool {
        self.installed_origin()
            .is_some_and(|origin| origin.matches_original(self))
            && Arc::ptr_eq(&self.custody, &proof.custody)
            && Arc::ptr_eq(&self.custody.issuer, &proof.custody.issuer)
    }

    /// Present only after the concrete installed binder's final checks. The
    /// borrowed receipt records producer origin, without current authority.
    pub fn installed_origin(&self) -> Option<InstalledNativeQueuedUploadOrigin<'_>> {
        self.installed_issuer
            .as_ref()
            .map(|installed_issuer| InstalledNativeQueuedUploadOrigin {
                original: self,
                installed_issuer,
                custody: &self.custody,
                custody_issuer: &self.custody.issuer,
            })
    }

    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }
    pub fn known_nonzero_admission(&self) -> &NativeQueuedUploadKnownNonzeroAdmission {
        &self.known_nonzero
    }
    pub fn source_reference(&self) -> &a::SourceRef {
        &self.source_reference
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.original
    }
    pub fn command(&self) -> &native::StockCommand {
        &self.command
    }
    pub fn plan(&self) -> &native::NativePlan {
        &self.plan
    }
    pub fn authority(&self) -> &native::StockAuthority {
        &self.authority
    }
    pub fn preflight(&self) -> &native::StockPreflight {
        &self.preflight
    }
    pub fn owner_preflight(&self) -> &native::StockPreflight {
        &self.owner_preflight
    }
    pub fn snapshot(&self) -> &NativeQueuedUploadSnapshot {
        &self.snapshot
    }
    pub fn capture_digest(&self) -> &native::Digest {
        &self.capture_digest
    }
    pub fn ordered_impact(&self) -> &[NativeQueuedUploadImpact] {
        &self.ordered_impact
    }
    pub fn queue_config(&self) -> &jobs::QueueConfig {
        &self.queue_config
    }
    pub fn enqueue_request(&self) -> &jobs::EnqueueRequest {
        &self.enqueue_request
    }
    pub fn canonical_scope(&self) -> &jobs::CanonicalScope {
        &self.canonical_scope
    }
}

fn upload_provenance_unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Original upload Media provenance is unavailable",
    )
}

impl NativeQueuedUploadOriginal {
    /// Pure comparison against the installed cut retained by Storage's actual
    /// released original enqueue. Matching DTOs cannot create this provenance.
    pub fn validate_original(
        &self,
        proof: &RecordedOriginalUploadEnqueueProof,
        registration: &jobs::QueueRegistration,
        original: &ValidatedRequest,
        request: &jobs::EnqueueRequest,
        scope: &jobs::CanonicalScope,
    ) -> s::Result<()> {
        let pending = self.known_nonzero.pending_byte_liability();
        if !std::ptr::eq(self, proof.upload_cut().as_ref())
            || !self
                .installed_origin()
                .is_some_and(|origin| origin.matches_original(self))
            || !self.known_nonzero.matches_original(self)
            || !pending.required
            || pending.reserved_bytes != Some(self.custody.staged.byte_size)
            || pending.reserved_bytes != Some(self.custody.body_bytes.len() as u64)
            || self.custody.staged.byte_size == 0
        {
            return Err(upload_provenance_unavailable());
        }
        if registration != &self.queue_config.registration
            || original.raw() != self.original.raw()
            || original.intent_digest() != self.original.intent_digest()
            || request != &self.enqueue_request
            || scope != &self.canonical_scope
            || request.pending_byte_liability != pending
            || request.intent.request_digest.as_hex() != original.intent_digest()
        {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }

    /// The actual Storage Release-qualified matcher runs before DATA checks.
    /// Only its exact initial claim can qualify this unprepared attempt.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_unprepared_attempt(
        &self,
        proof: &RecordedOriginalUploadEnqueueProof,
        registration: &jobs::QueueRegistration,
        original: &ValidatedRequest,
        request: &jobs::EnqueueRequest,
        scope: &jobs::CanonicalScope,
        job: &jobs::LeasedJob,
    ) -> s::Result<()> {
        if !proof.matches_released_attempt(job) || !std::ptr::eq(self, proof.upload_cut().as_ref())
        {
            return Err(upload_provenance_unavailable());
        }
        self.validate_original(proof, registration, original, request, scope)?;
        if job.request != *request
            || job.canonical_scope != *scope
            || job.pending_byte_liability != self.known_nonzero.pending_byte_liability()
            || job.lease.physical_identity != registration.identity
            || job.lease.owner_id != registration.dispatcher_owner_id
            || job.attempt != 1
        {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }
}

/// Concrete offline comparison only for the genuine released original enqueue
/// and its unprepared initial claim. Prepared bytes, journals, step/liability
/// prefixes beyond the exact claim reservation and outcomes remain unavailable;
/// this issues no recovery permission
/// or current native/Access authority and performs no I/O or native callbacks.
impl QueuedMediaRecovery<RecordedOriginalUploadEnqueueProof> for NativeQueuedUploadOriginal {
    fn validate_original(
        &self,
        enqueue: &RetainedEnqueue<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        NativeQueuedUploadOriginal::validate_original(
            self,
            enqueue.original_proof,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
        )?;
        if enqueue.config != &self.queue_config {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }

    fn validate_attempt(
        &self,
        attempt: &RetainedAttempt<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        let enqueue = &attempt.enqueue;
        self.validate_unprepared_attempt(
            enqueue.original_proof,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
            attempt.job,
        )?;
        if enqueue.config != &self.queue_config
            || attempt.prepared.is_some()
            || attempt.journal.is_some()
            || !attempt.steps.is_empty()
            || attempt.liabilities.len() != 1
            || attempt.liabilities[0].0 != "claim"
            || attempt.liabilities[0].1
                != claim_reservation(self).map_err(|_| upload_provenance_unavailable())?
            || !attempt.outcomes.is_empty()
        {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }

    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        Err(upload_provenance_unavailable())
    }
}

/// Local measured custody supplies a positive reservation, not evidence of
/// remotely retained bytes, metadata commit or reference closure.
pub(super) fn claim_reservation(
    upload: &NativeQueuedUploadOriginal,
) -> MediaResult<jobs::StorageLiability> {
    let pending = upload.known_nonzero.pending_byte_liability();
    if !upload
        .installed_origin()
        .is_some_and(|origin| origin.matches_original(upload))
        || !upload.known_nonzero.matches_original(upload)
        || !pending.required
        || pending.reserved_bytes != Some(upload.custody.staged.byte_size)
        || pending.reserved_bytes != Some(upload.custody.body_bytes.len() as u64)
        || upload.custody.staged.byte_size == 0
        || pending != upload.enqueue_request.pending_byte_liability
    {
        return Err(MediaError::Unavailable);
    }
    Ok(jobs::StorageLiability {
        accounting: jobs::ByteAccounting::Complete {
            known_bytes: 0,
            reserved_bytes: upload.custody.staged.byte_size,
        },
        metadata_commit_evidence: jobs::MetadataCommitEvidence::NotDispatched,
        byte_disposition: jobs::ByteDisposition::None,
        reference_closure_evidence: jobs::ReferenceClosureEvidence::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 1,
    })
}
