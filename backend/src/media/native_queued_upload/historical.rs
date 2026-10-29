use super::*;

impl NativeQueuedUploadHistoricalMedia {
    /// Copy prior qualified measurement only, without descriptor reads, source
    /// freshness renewal, current authorization or adopted historical DATA.
    pub fn capture_released_original(
        recorded: &s::RecordedOriginalUploadEnqueue,
        execution: &s::OriginalQueuedUploadExecution,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        budget.check()?;
        let proof = recorded.proof();
        let upload = recorded.upload_cut();
        let attempt = execution.attempt();
        let journal = execution.journal();
        let native = execution.native_preparation();
        if !attempt.matches_released_upload(&proof)
            || !journal.matches_attempt(attempt)
            || journal.job() != attempt.job()
            || !Arc::ptr_eq(upload, proof.upload_cut())
            || !Arc::ptr_eq(upload, execution.upload_cut())
            || !Arc::ptr_eq(upload, journal.upload_cut())
            || !Arc::ptr_eq(upload, native.upload_cut())
            || !Arc::ptr_eq(native, journal.native_preparation())
            || !native.matches_original(upload)
            || !upload
                .installed_origin()
                .is_some_and(|origin| origin.matches_original(upload))
            || !upload.known_nonzero.matches_original(upload)
        {
            return Err(MediaError::Unavailable);
        }
        upload
            .validate_original(
                &proof,
                &upload.queue_config.registration,
                &upload.original,
                &upload.enqueue_request,
                &upload.canonical_scope,
            )
            .map_err(|_| MediaError::Unavailable)?;
        native.validate_prepared_journal(journal, attempt, native.prepared(), budget)?;
        let installed = upload
            .installed_issuer
            .as_ref()
            .ok_or(MediaError::Unavailable)?;
        historical_fact_bounds(upload, native.prepared(), budget)?;
        let measured_byte_size = upload.custody.body_bytes.len() as u64;
        if measured_byte_size != upload.custody.staged.byte_size
            || upload.custody.staged.sha256.as_str() != sha256(&upload.custody.body_bytes)
        {
            return Err(MediaError::Unavailable);
        }
        budget.check()?;
        let snapshot = NativeQueuedUploadSnapshot {
            original: upload.snapshot.original.clone(),
            scope: upload.snapshot.scope.clone(),
            target: upload.snapshot.target.clone(),
            path: upload.snapshot.path.clone(),
            query: upload.snapshot.query.clone(),
            observed_at: upload.snapshot.observed_at.clone(),
            digest: upload.snapshot.digest.clone(),
        };
        budget.check()?;
        let result = Self {
            original_issuer: Arc::clone(&upload.custody.issuer),
            installed_issuer: Arc::clone(installed),
            prepared_identity: Arc::clone(&native.issuer.identity),
            original: upload.original.clone(),
            command: upload.command.clone(),
            authority: upload.authority.clone(),
            plan: upload.plan.clone(),
            preflight: upload.preflight.clone(),
            owner_preflight: upload.owner_preflight.clone(),
            snapshot,
            capture_digest: upload.capture_digest.clone(),
            ordered_impact: upload
                .ordered_impact
                .iter()
                .map(|impact| NativeQueuedUploadImpact {
                    partition: impact.partition.clone(),
                    entity_id: impact.entity_id.clone(),
                    staged: impact.staged.clone(),
                    snapshot_digest: impact.snapshot_digest.clone(),
                })
                .collect(),
            source_reference: upload.source_reference.clone(),
            queue_config: upload.queue_config.clone(),
            enqueue_request: upload.enqueue_request.clone(),
            canonical_scope: upload.canonical_scope.clone(),
            prepared: native.prepared().clone(),
            pending: upload.known_nonzero.pending_byte_liability(),
            staged: upload.custody.staged.clone(),
            reservation_bytes: upload.custody.reservation_bytes.clone(),
            measured_byte_size,
        };
        budget.check()?;
        Ok(result)
    }

    pub fn matches_original(&self, upload: &Arc<NativeQueuedUploadOriginal>) -> bool {
        Arc::ptr_eq(&self.original_issuer, &upload.custody.issuer)
            && upload
                .installed_issuer
                .as_ref()
                .is_some_and(|issuer| Arc::ptr_eq(&self.installed_issuer, issuer))
    }
    pub fn matches_prepared(&self, native: &Arc<NativeQueuedUploadPrepared>) -> bool {
        Arc::ptr_eq(&self.prepared_identity, &native.issuer.identity)
            && self.matches_original(native.upload_cut())
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.original
    }
    pub fn command(&self) -> &native::StockCommand {
        &self.command
    }
    pub fn authority(&self) -> &native::StockAuthority {
        &self.authority
    }
    pub fn plan(&self) -> &native::NativePlan {
        &self.plan
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
    pub fn source_reference(&self) -> &a::SourceRef {
        &self.source_reference
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
    pub fn prepared(&self) -> &s::PreparedNativeIntent {
        &self.prepared
    }
    pub fn pending_byte_liability(&self) -> jobs::PendingByteLiability {
        self.pending
    }
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.staged
    }
    pub fn reservation_bytes(&self) -> &[u8] {
        &self.reservation_bytes
    }
    pub fn measured_byte_size(&self) -> u64 {
        self.measured_byte_size
    }
}

fn historical_fact_bounds(
    upload: &NativeQueuedUploadOriginal,
    prepared: &s::PreparedNativeIntent,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    if !upload.original.children().is_empty()
        || upload.ordered_impact.len() != 1
        || upload.snapshot.original.len()
            > crate::providers::homebox::wire::DecodeLimits::default().max_response_bytes
        || upload.custody.body_bytes.len() > MAX_BYTES
        || upload.custody.reservation_bytes.len() > MAX_RESERVATION_BYTES
        || prepared.native_payload.len() > MAX_PREPARED_FIELD_BYTES
        || prepared.prepared_media_evidence.len() > MAX_PREPARED_FIELD_BYTES
    {
        return Err(MediaError::TooLarge);
    }
    // The actual upload route retains only Copy enums and a static path, with
    // no additional owned Route strings hidden from the copy budget.
    let domain::Route::HomeboxNative(route) = upload.original.route() else {
        return Err(MediaError::Unavailable);
    };
    if upload.original.id() != domain::OperationId::HomeboxFileUpload
        || route.path != "/api/v1/entities/{id}/attachments"
        || !matches!(route.method, domain::Method::Post)
    {
        return Err(MediaError::Unavailable);
    }
    // Raw owner/prepared/reservation buffers use their separate byte caps.
    // Avoid JSON's Vec<u8> expansion; every other copied fact shares 1 MiB.
    let mut facts = FactBudget { bytes: 0, budget };
    facts.json(upload.original.raw())?;
    facts.json(upload.original.context())?;
    facts.json(&(
        upload.original.request_id(),
        upload.original.intent_digest(),
    ))?;
    facts.json(&upload.command)?;
    let authority = &upload.authority;
    facts.json(&(
        authority.actor_id,
        authority.source_epoch,
        authority.authority_digest.as_str(),
        authority.physical_binding.deployment_id,
        authority.physical_binding.physical_database_id,
        authority.physical_binding.configuration_digest.as_str(),
    ))?;
    let native::NativeQualification::Qualified {
        catalog_digest,
        registered_build_digest,
        route_qualification_digest,
    } = &authority.qualification
    else {
        return Err(MediaError::Unavailable);
    };
    facts.json(&(
        "Qualified",
        catalog_digest.as_str(),
        registered_build_digest.as_str(),
        route_qualification_digest.as_str(),
    ))?;
    facts.json(&("HomeboxFileUpload", "Post", route.path))?;
    facts.json(&upload.plan)?;
    facts.preflight(&upload.preflight)?;
    facts.preflight(&upload.owner_preflight)?;
    facts.json(&(
        &upload.snapshot.scope,
        &upload.snapshot.target,
        &upload.snapshot.path,
        &upload.snapshot.query,
        &upload.snapshot.observed_at,
        &upload.snapshot.digest,
    ))?;
    facts.json(&upload.capture_digest)?;
    facts.json(&upload.source_reference)?;
    facts.json(&upload.custody.staged)?;
    facts.queue_config(&upload.queue_config)?;
    let request = &upload.enqueue_request;
    facts.json(&(
        &request.receipt.workspace_id,
        &request.receipt.home_id,
        &request.receipt.actor_id,
        &request.receipt.mutation_id,
    ))?;
    facts.partition(&request.partition)?;
    facts.json(&(
        &request.intent.contract_id,
        &request.intent.operation_id,
        &request.intent.target_external_id,
        request.intent.request_digest.as_hex(),
    ))?;
    facts.json(&(
        &request.write_scope.source_instance_id,
        &request.write_scope.collection_id,
        &upload.canonical_scope.collection_id,
    ))?;
    facts.selection(&request.write_scope.selection)?;
    facts.selection(&upload.canonical_scope.selection)?;
    let impact = &upload.ordered_impact[0];
    facts.partition(&impact.partition)?;
    facts.json(&(&impact.entity_id, &impact.staged, &impact.snapshot_digest))?;
    let liability = claim_reservation(upload)?;
    if prepared.storage_liability != liability {
        return Err(MediaError::Unavailable);
    }
    facts.json(&(
        prepared.codec.as_str(),
        request.pending_byte_liability.required,
        request.pending_byte_liability.reserved_bytes,
        upload.known_nonzero.pending.required,
        upload.known_nonzero.pending.reserved_bytes,
        upload.custody.staged.byte_size,
        0u64,
        upload.custody.staged.byte_size,
        "NotDispatched",
        "None",
        "Unassessed",
        Option::<&str>::None,
        1u32,
    ))?;
    budget.check()
}
