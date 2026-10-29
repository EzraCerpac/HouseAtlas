use super::*;

impl NativeQueuedUploadStages {
    /// Bind only with the same actual stage's source-preparation allocation.
    /// The production host must obtain `proof` from the same sealed native
    /// Source used by `bound`; this matcher cannot prove generic Source identity.
    /// Source/native callbacks are delegated only after Media locks release.
    #[allow(clippy::too_many_arguments)]
    pub fn bind_original_with_source_preparation<'a, 'p, 'owner, W, G, F, C, S>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        proof: &NativeQueuedUploadSourcePreparation<'_>,
        bound: &NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
        config: &jobs::QueueConfig,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, S>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        budget.check()?;
        if !proof.matches_stage(&stage) {
            return Err(MediaError::Forbidden);
        }
        {
            let _current =
                proof.current_under_guard(guard, &stage.original, stage.source, budget)?;
        }
        self.bind_original(guard, stage, bound, config, budget)
    }

    /// Consume the stage using only the actual installed upload Source's E and
    /// the same Store-borrowed physical phase. No caller-selected proof/config
    /// or ordinary qualification fallback is accepted.
    pub fn bind_original_with_queued_upload_installation<
        'phase,
        'a,
        'p,
        'owner,
        'captured,
        W,
        G,
        F,
        C,
    >(
        &self,
        guard: &'phase a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        bound: &NativeQueueOriginalPreparation<
            'a,
            'p,
            'owner,
            W,
            G,
            F,
            C,
            native::QueuedUploadSource<'captured, 'p>,
        >,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, native::QueuedUploadSource<'captured, 'p>>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
    {
        check_queued_upload_binding(
            guard,
            &stage.custody,
            &stage.original,
            stage.source,
            bound,
            physical,
            budget,
        )?;
        let mut original = self.bind_inner(
            guard,
            stage,
            bound,
            physical.queue_config(),
            budget,
            OriginalBindPhase::QueuedUpload(physical),
        )?;
        // The engine has released all Media locks before these Source/phase
        // checks. The SAME actual E still retains the original stage allocation.
        let proof = bound.native().capture().evidence().source_preparation();
        check_queued_upload_binding(
            guard,
            &original.custody,
            &proof.original,
            proof.source,
            bound,
            physical,
            budget,
        )?;
        budget.check()?;
        original.installed_issuer = Some(Arc::new(InstalledQueuedUploadIssuer));
        Ok(original)
    }

    /// Actual native/Domain original qualification is mandatory before and after
    /// binding. Consume the stage once; retain only detached descriptor custody
    /// and exact original facts. This issues no current Access/Store authority.
    pub fn bind_original<'a, 'p, 'owner, W, G, F, C, S>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        bound: &NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
        config: &jobs::QueueConfig,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, S>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        self.bind_inner(
            guard,
            stage,
            bound,
            config,
            budget,
            OriginalBindPhase::Ordinary,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn bind_inner<'phase, 'a, 'p, 'owner, W, G, F, C, S>(
        &self,
        guard: &'phase a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        bound: &NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
        config: &jobs::QueueConfig,
        budget: &WorkBudget,
        phase: OriginalBindPhase<'phase, 'p>,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, S>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        budget.check()?;
        if !Arc::ptr_eq(&self.owner, &stage.custody.owner)
            || !std::ptr::eq(stage.original.principal(), bound.captured().principal())
            || !bound
                .captured()
                .source_grants()
                .iter()
                .any(|source| std::ptr::eq(source, stage.source))
            || !bound
                .captured()
                .partition_grants()
                .iter()
                .any(|partition| partition.partition() == &stage.source.reference().partition())
        {
            return Err(MediaError::Forbidden);
        }
        authorize_original(guard, &stage.original, stage.source)?;
        match &phase {
            OriginalBindPhase::Ordinary => bound.revalidate(guard, bound.native().authority()),
            OriginalBindPhase::QueuedUpload(physical) => bound
                .revalidate_with_queued_upload_installation(
                    guard,
                    bound.native().authority(),
                    physical,
                ),
        }
        .map_err(|_| MediaError::Unavailable)?;
        let native = bound.native();
        let command = native.command();
        let request = bound.prepared().request();
        // Bound all detached request/native/configuration facts before any
        // clones or native mapping; the raw snapshot has its separate wire cap.
        let mut facts = FactBudget { bytes: 0, budget };
        facts.json(request.raw())?;
        facts.json(native.command())?;
        facts.json(native.plan())?;
        facts.preflight(native.preflight())?;
        facts.preflight(native.owner_preflight())?;
        facts.queue_config(config)?;
        let owner_entity = command
            .target
            .owner()
            .map_err(|_| MediaError::InvalidInput)?;
        let reference = stage.source.reference();
        if command.command_id != "homebox.file.upload"
            || request.id() != domain::OperationId::HomeboxFileUpload
            || request.raw() != &command.original_wire
            || !request.children().is_empty()
            || request.whole_collection_required()
            || command.target.resource_kind != native::ResourceKind::Attachment
            || command.target.resource_id.is_some()
            || owner_entity.is_nil()
            || !matches!(
                native.authority().qualification,
                native::NativeQualification::Qualified { .. }
            )
            || reference.key.external_id != owner_entity.to_string()
            || reference.key.source_instance_id.as_str()
                != command.target.source_instance_id.to_string()
            || reference.key.collection_id != command.target.collection_id.to_string()
            || reference.workspace_id.as_str() != command.context.workspace_id.to_string()
            || reference.home_id.as_str() != command.context.home_id.to_string()
            || native.preflight().preparation.staged_upload.as_ref() != Some(stage.staged_upload())
            || command.payload.get("staged")
                != Some(
                    &serde_json::to_value(stage.staged_upload())
                        .map_err(|_| MediaError::InvalidInput)?,
                )
            || native.capture().snapshots().len() != 1
            || native.preflight().preparation.snapshots.len() != 1
        {
            return Err(MediaError::InvalidInput);
        }
        let plan = native.plan();
        let path = format!("/api/v1/entities/{owner_entity}/attachments");
        if plan.request.method != native::NativeMethod::Post
            || plan.request.path != path
            || !plan.request.query.is_empty()
            || native::map_stock(command, &native.preflight().preparation)
                .map_err(|_| MediaError::InvalidInput)?
                != *plan
        {
            return Err(MediaError::InvalidInput);
        }
        let native::NativeBody::Multipart {
            file_field,
            stage: planned_stage,
            ..
        } = &plan.request.body
        else {
            return Err(MediaError::InvalidInput);
        };
        if file_field != "file" || planned_stage != stage.staged_upload() {
            return Err(MediaError::InvalidInput);
        }
        let decoded = &native.capture().snapshots()[0];
        let raw = decoded.original();
        let owner_target = command
            .target
            .owner_target()
            .map_err(|_| MediaError::InvalidInput)?;
        if raw.original.is_empty()
            || raw.original.len()
                > crate::providers::homebox::wire::DecodeLimits::default().max_response_bytes
            || raw.target != owner_target
            || raw.path != format!("/api/v1/entities/{owner_entity}")
            || !raw.query.is_empty()
            || raw.scope.workspace_id.as_str() != reference.workspace_id.as_str()
            || raw.scope.home_id.as_str() != reference.home_id.as_str()
            || raw.scope.source_instance_id.as_str() != reference.key.source_instance_id.as_str()
            || raw.scope.collection_id != reference.key.collection_id
            || native.preflight().preparation.snapshots[0].target != owner_target
            || !native.preflight().preparation.snapshots[0].complete
            || &native.preflight().preparation.snapshots[0].digest != decoded.digest()
            || &native.preflight().preparation.snapshots[0].value != decoded.snapshot_value()
        {
            return Err(MediaError::InvalidInput);
        }
        config.validate().map_err(|_| MediaError::InvalidInput)?;
        let physical = &native.authority().physical_binding;
        if config.registration.identity.deployment_id != physical.deployment_id.to_string()
            || config.registration.identity.physical_database_id
                != physical.physical_database_id.to_string()
            || config.registration.identity.configuration_digest.as_hex()
                != physical.configuration_digest.as_str()
        {
            return Err(MediaError::InvalidInput);
        }
        let raw_wire = request.raw();
        let partition = jobs::SourcePartition {
            workspace_id: exact_uuid(
                &raw_wire["context"]["workspaceId"],
                command.context.workspace_id,
            )?,
            home_id: exact_uuid(&raw_wire["context"]["homeId"], command.context.home_id)?,
            source_instance_id: exact_uuid(
                &raw_wire["target"]["sourceInstanceId"],
                command.target.source_instance_id,
            )?,
            collection_id: exact_uuid(
                &raw_wire["target"]["collectionId"],
                command.target.collection_id,
            )?,
        };
        let entity_id = exact_uuid(&raw_wire["target"]["entityId"], owner_entity)?;
        let write_scope = jobs::WriteScope {
            source_instance_id: partition.source_instance_id.clone(),
            collection_id: partition.collection_id.clone(),
            selection: jobs::ScopeSelection::Resources(vec![jobs::ResourceRef {
                kind: jobs::ResourceKind::Entity,
                id: entity_id.clone(),
            }]),
        };
        let canonical_scope = config
            .registration
            .resolve(&partition, &write_scope)
            .map_err(|_| MediaError::InvalidInput)?;
        let pending = jobs::PendingByteLiability {
            required: true,
            reserved_bytes: Some(stage.custody.staged.byte_size),
        };
        let enqueue = jobs::EnqueueRequest {
            receipt: jobs::ReceiptKey {
                workspace_id: partition.workspace_id.clone(),
                home_id: partition.home_id.clone(),
                actor_id: stage.original.principal().actor_id().as_str().into(),
                mutation_id: exact_uuid(&raw_wire["idempotencyKey"], command.idempotency_key)?,
            },
            partition: partition.clone(),
            intent: jobs::IntentMetadata {
                contract_id: crate::contracts::stock::CONTRACT_VERSION.into(),
                operation_id: command.command_id.clone(),
                target_external_id: Some(entity_id.clone()),
                request_digest: jobs::Digest::from_hex(command.request_digest.as_str().into())
                    .map_err(|_| MediaError::InvalidInput)?,
            },
            write_scope,
            pending_byte_liability: pending,
        };
        enqueue.validate().map_err(|_| MediaError::InvalidInput)?;
        let local_custody = self
            .owner
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let directory_custody = self.owner.lock()?;
        let before = self.owner.scan(budget)?;
        revalidate_body(&stage.custody, budget)?;
        if before != self.owner.scan(budget)? {
            return Err(MediaError::Unavailable);
        }
        drop(directory_custody);
        drop(local_custody);
        // A source qualifier may consult this actual stage producer. Never call
        // it while Media owner locks are held.
        match &phase {
            OriginalBindPhase::Ordinary => bound.revalidate(guard, native.authority()),
            OriginalBindPhase::QueuedUpload(physical) => bound
                .revalidate_with_queued_upload_installation(guard, native.authority(), physical),
        }
        .map_err(|_| MediaError::Unavailable)?;
        authorize_original(guard, &stage.original, stage.source)?;
        budget.check()?;
        let impact = NativeQueuedUploadImpact {
            partition,
            entity_id,
            staged: stage.custody.staged.clone(),
            snapshot_digest: decoded.digest().clone(),
        };
        let known_nonzero = NativeQueuedUploadKnownNonzeroAdmission {
            issuer: Arc::clone(&stage.custody.issuer),
            pending,
        };
        let original = NativeQueuedUploadOriginal {
            installed_issuer: None,
            custody: Arc::clone(&stage.custody),
            known_nonzero,
            source_reference: reference.clone(),
            original: request.clone(),
            command: command.clone(),
            plan: plan.clone(),
            authority: native.authority().clone(),
            preflight: native.preflight().clone(),
            owner_preflight: native.owner_preflight().clone(),
            snapshot: NativeQueuedUploadSnapshot {
                original: raw.original.clone(),
                scope: raw.scope.clone(),
                target: raw.target.clone(),
                path: raw.path.clone(),
                query: raw.query.clone(),
                observed_at: raw.observed_at.clone(),
                digest: decoded.digest().clone(),
            },
            capture_digest: native.capture().capture_digest().clone(),
            ordered_impact: vec![impact],
            queue_config: config.clone(),
            enqueue_request: enqueue,
            canonical_scope,
        };
        budget.check()?;
        Ok(original)
    }
}

#[allow(clippy::too_many_arguments)]
fn check_queued_upload_binding<'phase, 'a, 'p, 'owner, 'captured, W, G, F, C>(
    guard: &'phase a::TransactionAuthorization<'_>,
    custody: &Arc<StageCustody>,
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    bound: &NativeQueueOriginalPreparation<
        'a,
        'p,
        'owner,
        W,
        G,
        F,
        C,
        native::QueuedUploadSource<'captured, 'p>,
    >,
    physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<'phase, 'p>,
    budget: &WorkBudget,
) -> MediaResult<()>
where
    G: NativeQueueOriginalGraph<'owner, C, native::QueuedUploadSource<'captured, 'p>>,
    F: GraphAuthorization<W, G>,
    C: native::StockContractPort + Sync,
{
    budget.check()?;
    let source = bound.native().source();
    let captured = source.captured();
    let configured = source.configured();
    let selected_source = source.original_source();
    let selected_partition = source.original_partition();
    let proof = bound.native().capture().evidence().source_preparation();
    if !Arc::ptr_eq(custody, &proof.custody)
        || !Arc::ptr_eq(&custody.issuer, &proof.custody.issuer)
        || !std::ptr::eq(original.principal(), proof.original.principal())
        || !std::ptr::eq(grant, proof.source)
        || !std::ptr::eq(original.principal(), source.original().principal())
        || !std::ptr::eq(original.principal(), captured.principal())
        || !std::ptr::eq(guard.principal(), captured.principal())
        || !std::ptr::eq(captured, bound.captured())
        || !std::ptr::eq(captured, physical.captured())
        || !std::ptr::eq(grant, selected_source)
        || !std::ptr::eq(selected_source, physical.source())
        || !std::ptr::eq(selected_partition, physical.partition())
        || !captured
            .source_grants()
            .iter()
            .any(|item| std::ptr::eq(item, selected_source))
        || !captured
            .partition_grants()
            .iter()
            .any(|item| std::ptr::eq(item, selected_partition))
        || selected_source.reference().partition() != *selected_partition.partition()
        || selected_partition.partition() != &configured.source().partition()
        || !configured.source().contains(selected_source.reference())
        || !Arc::ptr_eq(configured, physical.configured())
        || !physical.matches_configured_store()
        || physical.queue_config() != configured.queue()
        || physical.registration() != configured.physical()
        || physical.source_metadata() != configured.metadata()
    {
        return Err(MediaError::Forbidden);
    }
    guard
        .revalidate_source_partition(selected_partition)
        .map_err(access_error)?;
    if guard
        .persisted_source_metadata(selected_partition)
        .map_err(access_error)?
        != *configured.metadata()
    {
        return Err(MediaError::Forbidden);
    }
    {
        let _current = proof.current_under_guard(guard, original, grant, budget)?;
    }
    // No Source or Store callback, network work or reentry surrounds these
    // bounded Media descriptor checks. All Media locks have now been dropped.
    authorize_original(guard, original, grant)?;
    budget.check()
}

fn exact_uuid(raw: &Value, expected: Uuid) -> MediaResult<String> {
    let raw = raw.as_str().ok_or(MediaError::InvalidInput)?;
    if expected.is_nil() || raw.len() != 36 || Uuid::parse_str(raw).ok() != Some(expected) {
        return Err(MediaError::InvalidInput);
    }
    Ok(raw.into())
}
