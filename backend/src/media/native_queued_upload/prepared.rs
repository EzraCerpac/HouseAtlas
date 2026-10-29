use super::*;

impl NativeQueuedUploadPrepared {
    pub fn capture_original<'phase, 'tx, 'bundle, 'native: 'phase, 'owner, 'captured, 'p>(
        admission: &crate::app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission<
            'bundle,
            'native,
            'owner,
            'captured,
            'p,
        >,
        guard: &'phase a::TransactionAuthorization<'tx>,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        budget.check()?;
        admission
            .revalidate_phase(guard, physical)
            .map_err(|_| MediaError::Unavailable)?;
        let upload = admission.upload_cut();
        let liability = claim_reservation(upload)?;
        let prepared = encode_upload_prepared(upload, liability, budget)?;
        let captured = Self {
            upload: Arc::clone(upload),
            issuer: Arc::new(UploadPreparedIssuer {
                identity: Arc::new(UploadPreparedIdentity),
                custody: Arc::clone(&upload.custody),
                dispatch_body_taken: AtomicBool::new(false),
            }),
            prepared,
        };
        captured.revalidate_original_phase(admission, guard, physical, budget)?;
        Ok(captured)
    }

    /// Recheck the actual live original installed phase and bounded descriptor
    /// custody at Entry, Precommit or fresh Release. This performs local file
    /// reads; matching prepared DATA alone supplies no current authority.
    pub fn revalidate_original_phase<
        'phase,
        'tx,
        'bundle,
        'native: 'phase,
        'owner,
        'captured,
        'p,
    >(
        &self,
        admission: &crate::app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission<
            'bundle,
            'native,
            'owner,
            'captured,
            'p,
        >,
        guard: &'phase a::TransactionAuthorization<'tx>,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        let upload = admission.upload_cut();
        if !self.matches_original(upload) {
            return Err(MediaError::Unavailable);
        }
        admission
            .revalidate_phase(guard, physical)
            .map_err(|_| MediaError::Unavailable)?;
        let native = admission.preparation().native();
        let source = native.source();
        let proof = native.capture().evidence().source_preparation();
        if !upload.matches_source_preparation(proof) {
            return Err(MediaError::Unavailable);
        }
        let liability = claim_reservation(upload)?;
        if self.prepared.storage_liability != liability {
            return Err(MediaError::Unavailable);
        }
        {
            let _current = proof.current_under_guard(
                guard,
                source.original(),
                source.original_source(),
                budget,
            )?;
        }
        // Bounded local descriptor I/O under Media custody; no Source mutex,
        // native/Store callback, network work, await or reentry surrounds it.
        {
            let owner = &upload.custody.owner;
            let _local = owner
                .custody
                .try_lock()
                .map_err(|_| MediaError::Unavailable)?;
            let _directory = owner.lock()?;
            let before = owner.scan(budget)?;
            revalidate_body(&upload.custody, budget)?;
            if before != owner.scan(budget)? {
                return Err(MediaError::Unavailable);
            }
        }
        // Root/Source/Access phase fences run only after Media locks release.
        admission
            .revalidate_phase(guard, physical)
            .map_err(|_| MediaError::Unavailable)?;
        {
            let _current = proof.current_under_guard(
                guard,
                source.original(),
                source.original_source(),
                budget,
            )?;
        }
        if !self.matches_original(admission.upload_cut())
            || !upload.matches_source_preparation(proof)
        {
            return Err(MediaError::Unavailable);
        }
        budget.check()
    }

    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        &self.upload
    }
    pub fn prepared(&self) -> &s::PreparedNativeIntent {
        &self.prepared
    }

    /// Bounded retained DATA decoding under this actual original issuer. No
    /// filesystem read, cold-start admission or reconstructed proof is issued.
    pub fn decode_retained_data<'a>(
        &'a self,
        candidate: &s::PreparedNativeIntent,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadDecoded<'a>> {
        if !self.matches_original(&self.upload) {
            return Err(MediaError::Unavailable);
        }
        budget.check()?;
        let liability = claim_reservation(&self.upload)?;
        if candidate.codec != NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
            || candidate.native_payload.len() > MAX_PREPARED_FIELD_BYTES
            || candidate.prepared_media_evidence.len() > MAX_PREPARED_FIELD_BYTES
            || candidate.storage_liability != liability
        {
            return Err(MediaError::Unavailable);
        }
        let expected = encode_upload_prepared(&self.upload, liability, budget)?;
        budget.check()?;
        let _: Value = serde_json::from_slice(&candidate.native_payload)
            .map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        let _: Value = serde_json::from_slice(&candidate.prepared_media_evidence)
            .map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        // Exact canonical bytes reject unknown, duplicate, missing or changed
        // fields even where a general JSON parser would accept their spelling.
        if candidate != &expected || self.prepared != expected {
            return Err(MediaError::Unavailable);
        }
        Ok(NativeQueuedUploadDecoded { native: self })
    }

    pub fn validate_prepared_journal<'a>(
        &'a self,
        journal: &s::OriginalUploadJournalCut,
        attempt: &s::OriginalQueuedUploadAttempt,
        candidate: &s::PreparedNativeIntent,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadDecoded<'a>> {
        if !journal.matches_attempt(attempt)
            || !std::ptr::eq(self, journal.native_preparation().as_ref())
            || !Arc::ptr_eq(&self.upload, journal.upload_cut())
            || candidate != journal.prepared()
        {
            return Err(MediaError::Unavailable);
        }
        self.decode_retained_data(candidate, budget)
    }
    /// Actual original/issuer custody correlation only, with no current grant.
    pub fn matches_original(&self, upload: &Arc<NativeQueuedUploadOriginal>) -> bool {
        Arc::ptr_eq(&self.upload, upload)
            && Arc::ptr_eq(&self.issuer.custody, &upload.custody)
            && Arc::ptr_eq(&self.issuer.custody.issuer, &upload.custody.issuer)
            && upload
                .installed_origin()
                .is_some_and(|origin| origin.matches_original(upload))
            && upload.known_nonzero.matches_original(upload)
    }
}

impl NativeQueuedUploadDecoded<'_> {
    pub fn plan(&self) -> &native::NativePlan {
        &self.native.upload.plan
    }
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.native.upload.custody.staged
    }
    pub fn prepared(&self) -> &s::PreparedNativeIntent {
        &self.native.prepared
    }
}
