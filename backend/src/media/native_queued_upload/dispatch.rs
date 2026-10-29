use super::*;

impl NativeQueuedUploadDispatchBody {
    pub fn capture_under_guard<'phase, 'tx, 'bundle, 'native: 'phase, 'owner, 'captured, 'p>(
        native: &Arc<NativeQueuedUploadPrepared>,
        journal: &s::OriginalUploadJournalCut,
        attempt: &s::OriginalQueuedUploadAttempt,
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
        bounds: NativeQueuedUploadDispatchBounds<'_>,
    ) -> MediaResult<Self> {
        // SAME prepared issuer owns this opportunity across all Arc copies.
        native
            .issuer
            .dispatch_body_taken
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| MediaError::Unavailable)?;
        let NativeQueuedUploadDispatchBounds {
            max_bytes,
            deadline,
            budget,
        } = bounds;
        check_body_deadline(deadline, budget)?;
        if !journal.matches_attempt(attempt)
            || !Arc::ptr_eq(native, journal.native_preparation())
            || !Arc::ptr_eq(native.upload_cut(), journal.upload_cut())
            || !Arc::ptr_eq(native.upload_cut(), admission.upload_cut())
            || native.prepared() != journal.prepared()
        {
            return Err(MediaError::Unavailable);
        }
        let body_size = native.upload.custody.staged.byte_size;
        if body_size == 0 || body_size > max_bytes.min(MAX_BYTES) as u64 {
            return Err(MediaError::TooLarge);
        }
        native.validate_prepared_journal(journal, attempt, native.prepared(), budget)?;
        native.revalidate_original_phase(admission, guard, physical, budget)?;
        let source_deadline = admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(budget)
            .map_err(|_| MediaError::Unavailable)?;
        let effective_deadline = deadline.min(source_deadline);
        check_body_deadline(effective_deadline, budget)?;
        let bytes = {
            let custody = &native.upload.custody;
            let owner = &custody.owner;
            let _local = owner
                .custody
                .try_lock()
                .map_err(|_| MediaError::Unavailable)?;
            let _directory = owner.lock()?;
            let before = owner.scan(budget)?;
            let bytes = read_revalidated_body(custody, budget)?;
            if before != owner.scan(budget)? || bytes.len() > max_bytes {
                return Err(MediaError::Unavailable);
            }
            bytes
        };
        // No Media locks surround actual Root/Source/Access phase callbacks.
        native.revalidate_original_phase(admission, guard, physical, budget)?;
        native.validate_prepared_journal(journal, attempt, native.prepared(), budget)?;
        if admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(budget)
            .map_err(|_| MediaError::Unavailable)?
            != source_deadline
        {
            return Err(MediaError::Unavailable);
        }
        check_body_deadline(deadline, budget)?;
        check_body_deadline(effective_deadline, budget)?;
        Ok(Self {
            native: Arc::clone(native),
            bytes,
            deadline,
            effective_deadline,
        })
    }

    /// Pure same-preparation allocation correlation, without current authority.
    pub fn matches_preparation(&self, native: &Arc<NativeQueuedUploadPrepared>) -> bool {
        Arc::ptr_eq(&self.native, native) && native.matches_original(native.upload_cut())
    }

    pub fn into_bytes(
        self,
        stage: &native::StagedUpload,
        max_bytes: usize,
        deadline: Instant,
        budget: &WorkBudget,
    ) -> MediaResult<Vec<u8>> {
        check_body_deadline(self.deadline, budget)?;
        check_body_deadline(self.effective_deadline, budget)?;
        check_body_deadline(deadline, budget)?;
        if deadline > self.deadline
            || stage != &self.native.upload.custody.staged
            || self.bytes.len() > max_bytes
            || stage.byte_size != self.bytes.len() as u64
            || stage.sha256.as_str() != sha256(&self.bytes)
        {
            return Err(MediaError::Unavailable);
        }
        check_body_deadline(self.deadline, budget)?;
        check_body_deadline(self.effective_deadline, budget)?;
        check_body_deadline(deadline, budget)?;
        Ok(self.bytes)
    }
}

fn check_body_deadline(deadline: Instant, budget: &WorkBudget) -> MediaResult<()> {
    budget.check()?;
    if Instant::now() >= deadline {
        return Err(MediaError::Unavailable);
    }
    Ok(())
}
