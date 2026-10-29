use super::*;

impl<'grant> NativeQueuedUploadStage<'grant> {
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }

    /// Borrow this actual stage under its original mutation phase. Principal
    /// and grant DATA copies cannot substitute for the original allocations.
    pub fn current_under_guard<'stage, 'phase, 'tx>(
        &'stage self,
        guard: &'phase a::TransactionAuthorization<'tx>,
        original: &RetainedPrincipal,
        source: &a::SourceGrant,
        budget: &'phase WorkBudget,
    ) -> MediaResult<CurrentNativeQueuedUploadStage<'stage, 'phase, 'tx>> {
        if !std::ptr::eq(self.original.principal(), original.principal())
            || !std::ptr::eq(self.source, source)
        {
            return Err(MediaError::Forbidden);
        }
        let current = CurrentNativeQueuedUploadStage {
            custody: &self.custody,
            original: &self.original,
            source: self.source,
            guard,
            budget,
        };
        current.revalidate()?;
        Ok(current)
    }

    /// Retain this actual stage's source preparation after checking its current
    /// original phase. The host must retain this proof in the same sealed native
    /// Source preparation; Media alone cannot establish a generic Source owner.
    pub fn issue_source_preparation_under_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        source: &a::SourceGrant,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadSourcePreparation<'grant>> {
        {
            let _current = self.current_under_guard(guard, original, source, budget)?;
        }
        Ok(NativeQueuedUploadSourcePreparation {
            custody: Arc::clone(&self.custody),
            original: self.original.clone(),
            source: self.source,
        })
    }
}

impl NativeQueuedUploadSourcePreparation<'_> {
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }

    pub fn source_reference(&self) -> &a::SourceRef {
        self.source.reference()
    }

    /// Allocation correlation only; callers must separately check current
    /// original guard authority and genuine sealed Source ownership.
    pub fn matches_stage(&self, stage: &NativeQueuedUploadStage<'_>) -> bool {
        Arc::ptr_eq(&self.custody, &stage.custody)
            && Arc::ptr_eq(&self.custody.issuer, &stage.custody.issuer)
            && std::ptr::eq(self.original.principal(), stage.original.principal())
            && std::ptr::eq(self.source, stage.source)
    }

    pub fn current_under_guard<'owner, 'phase, 'tx>(
        &'owner self,
        guard: &'phase a::TransactionAuthorization<'tx>,
        original: &RetainedPrincipal,
        source: &a::SourceGrant,
        budget: &'phase WorkBudget,
    ) -> MediaResult<CurrentNativeQueuedUploadStage<'owner, 'phase, 'tx>> {
        if !std::ptr::eq(self.original.principal(), original.principal())
            || !std::ptr::eq(self.source, source)
        {
            return Err(MediaError::Forbidden);
        }
        let current = CurrentNativeQueuedUploadStage {
            custody: &self.custody,
            original: &self.original,
            source: self.source,
            guard,
            budget,
        };
        current.revalidate()?;
        Ok(current)
    }
}

impl CurrentNativeQueuedUploadStage<'_, '_, '_> {
    /// Comparison DATA; this getter does not detach current-stage authority.
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }

    /// Comparison DATA for the exact retained original grant.
    pub fn source_reference(&self) -> &a::SourceRef {
        self.source.reference()
    }

    pub fn revalidate(&self) -> MediaResult<()> {
        self.budget.check()?;
        authorize_original(self.guard, self.original, self.source)?;
        {
            let _local_custody = self
                .custody
                .owner
                .custody
                .try_lock()
                .map_err(|_| MediaError::Unavailable)?;
            let _directory_custody = self.custody.owner.lock()?;
            let before = self.custody.owner.scan(self.budget)?;
            revalidate_body(self.custody, self.budget)?;
            if before != self.custody.owner.scan(self.budget)? {
                return Err(MediaError::Unavailable);
            }
        }
        authorize_original(self.guard, self.original, self.source)?;
        self.budget.check()
    }
}
