//! Stock execution uses the existing native transaction, never a second store.
use super::super::{
    cache_repository as cache, command_extension::CommandExtension, context, repository as repo,
    repository::ReceiptKind, stock_repository as stock_repo, *,
};
use super::{AtlasStore, shape};
use super::{
    presence_engine::{
        ActiveCommandFrame, OriginalPresenceEngine, OriginalPresenceEngineInputs,
        assert_core_presence_hold,
    },
    presence_transaction::PresenceStoreAllocation,
    stock_presence::{
        MAX_ACCEPTED_FRAME_BYTES, PresenceCommandMapping, StockPresenceAcceptedFrame,
        StockPresenceCommandPeers, StockPresenceCommittedData, StockPresenceCommittedObservation,
        StockPresenceStorageReleasedCut, bounded_size,
    },
};
use crate::domain::{
    self,
    stock::{
        self, AtlasCommandPlan, AtlasDerivation, StockContractPort, StockError, ValidatedRequest,
    },
};
use rusqlite::Connection;
use rusqlite::{TransactionBehavior, params};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Arc;

pub(super) enum Qualification<'a, 'g> {
    Direct,
    VerifiedReview(&'a AssetReviewCommitPeers<'a, 'g>),
    Staged(&'a crate::media::staged_upload::StagedAssetPlan),
    Derived(&'a AtlasDerivation),
    DerivedBatch(&'a [Option<AtlasDerivation>]),
}

pub(super) fn stock_error(error: StockError) -> Error {
    match error {
        StockError::InvalidContract => {
            Error::new("invalid-contract", "Stock contract is incompatible")
        }
        StockError::CapabilityHeld | StockError::UnsupportedCapability => {
            Error::new("upstream-unavailable", "Stock capability is held")
        }
        StockError::CapabilityDenied | StockError::AuthorityChanged => {
            Error::new("forbidden", "Stock authority is unavailable")
        }
        _ => Error::new("schema-incompatible", "Stock owner result is incompatible"),
    }
}
impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    // The opaque peers, original principal, mapping, and observation must remain
    // distinct inputs so the command cannot infer one from retained DATA.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_presence_stock_json_with_authorization<
        'phase,
        'call,
        'tx,
        'origin,
        'reader,
        B,
        S,
    >(
        &mut self,
        authorization: &B,
        principal: &'call crate::app::RequestPrincipal,
        contracts: &S,
        raw: &Value,
        mapping: PresenceCommandMapping<'_>,
        peers: StockPresenceCommandPeers<'phase, 'call, 'tx, 'origin, 'reader>,
        observation: &StockPresenceCommittedObservation,
    ) -> Result<StockPresenceStorageReleasedCut<'call, 'origin, 'reader>>
    where
        B: StockAuthorization<Principal = crate::app::RequestPrincipal>,
        S: StockContractPort,
    {
        if !Arc::ptr_eq(&self.instance, &peers.instance)
            || !std::ptr::eq(principal, peers.principal)
            || raw != peers.request.raw()
            || !observation.is_empty()
            || peers
                .publications
                .iter()
                .any(|closed| !closed.matches_store(self))
        {
            return Err(Error::new(
                "forbidden",
                "Original stock presence command changed",
            ));
        }
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        if request.raw() != peers.request.raw()
            || request.intent_digest() != peers.request.intent_digest()
        {
            return Err(stock_repo::incompatible());
        }
        let (plan, qualification) = match mapping {
            PresenceCommandMapping::Direct => (
                stock::plan_atlas_commands(&request, &self.contract).map_err(stock_error)?,
                Qualification::Direct,
            ),
            PresenceCommandMapping::Derived(derivation) => {
                super::super::stock_derivation::validate_derivation(&request, derivation)?;
                (
                    stock::plan_derived_atlas_commands(&request, derivation, &self.contract)
                        .map_err(stock_error)?,
                    Qualification::Derived(derivation),
                )
            }
            PresenceCommandMapping::DerivedBatch(derivations) => {
                super::super::stock_derivation::validate_batch_derivations(&request, derivations)?;
                (
                    stock::plan_derived_atlas_batch_commands(&request, derivations, &self.contract)
                        .map_err(stock_error)?,
                    Qualification::DerivedBatch(derivations),
                )
            }
        };
        let (commit, frame) = self.execute_stock_plan_with_presence(
            authorization,
            principal,
            contracts,
            &request,
            &plan,
            qualification,
            Some(&peers),
            Some(observation),
        )?;
        let frame = frame.ok_or_else(stock_repo::incompatible)?;
        if commit.replayed || frame.commit != commit {
            return Err(stock_repo::incompatible());
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let check = || -> Result<()> {
            peers
                .guard
                .assert_mutation()
                .map_err(|_| Error::new("forbidden", "Original Access mutation unavailable"))?;
            peers
                .guard
                .revalidate()
                .map_err(|_| Error::new("forbidden", "Original Access mutation unavailable"))?;
            for grant in peers.access.sources {
                peers.guard.revalidate_source(grant).map_err(|_| {
                    Error::new("forbidden", "Original source authority unavailable")
                })?;
            }
            for grant in peers.access.partitions {
                peers
                    .guard
                    .revalidate_source_partition(grant)
                    .map_err(|_| {
                        Error::new("forbidden", "Original partition authority unavailable")
                    })?;
            }
            let scope: crate::access::Scope =
                serde_json::from_value(serde_json::to_value(plan.scope())?)?;
            peers
                .guard
                .authorize(&scope, crate::access::Capability::Mutate)
                .map_err(|_| Error::new("forbidden", "Original mutation scope unavailable"))?;
            let verified = authorization.authorize(
                principal,
                AuthorizationRequest {
                    scope: plan.scope(),
                    capability: Capability::Mutate,
                    targets: &frame.precommit.targets,
                    source: None,
                    source_partition: None,
                    mutation: Some(&frame.precommit),
                },
            )?;
            if verified.workspace_id != plan.scope().workspace_id
                || verified.home_id != plan.scope().home_id
                || verified.actor_id != commit.actor_id
            {
                return Err(stock_repo::incompatible());
            }
            Ok(())
        };
        check()?;
        let saved = stock_repo::load(
            &tx,
            &self.contract,
            plan.scope(),
            &commit.actor_id,
            &commit.operation_id,
        )?;
        if saved != commit {
            return Err(stock_repo::incompatible());
        }
        super::super::stock_projection::validate_retained(&tx, &saved, contracts, &self.contract)?;
        match (&frame.precommit.batch, frame.batch_hash.as_deref()) {
            (Some(batch), Some(hash)) => {
                let results = commit
                    .groups
                    .iter()
                    .flat_map(|g| g.native_results.iter().cloned())
                    .collect::<Vec<_>>();
                super::super::presence_witness_repository::check_batch_receipt(
                    &tx,
                    &self.contract,
                    plan.scope(),
                    &commit.actor_id,
                    batch,
                    hash,
                    &results,
                )?;
            }
            (None, None) => {}
            _ => return Err(stock_repo::incompatible()),
        }
        for closed in peers.publications {
            let data = closed.committed();
            let partition = data.cache().partition();
            let registration = cache::source(&tx, &partition)?;
            let current = cache::publication_state(&tx, &partition)?;
            if registration != *data.registration()
                || current.cache.as_ref() != Some(data.cache())
                || current.cache_epoch != data.successor_cache_epoch()
                || current.homebox_entities != data.homebox_entities()
                || current.network_relations != data.network_relations()
            {
                return Err(stock_repo::incompatible());
            }
        }
        for witness in &frame.witnesses {
            let body: String = tx.query_row(
                "SELECT body FROM presence_witnesses WHERE workspace_id=?1 AND home_id=?2 AND binding_record_id=?3 AND audit_id=?4",
                params![witness.workspace_id, witness.home_id, witness.binding_record_id, witness.audit_id],
                |row| row.get(0),
            )?;
            if body != repo::json(&self.contract, witness)? {
                return Err(stock_repo::incompatible());
            }
        }
        for (result, hash) in commit
            .groups
            .iter()
            .flat_map(|g| &g.native_results)
            .zip(&frame.command_hashes)
        {
            let current =
                repo::read_record(&tx, &result.record.scope(), &result.record.reference())?;
            let audit: String = tx.query_row(
                "SELECT body FROM audits WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND audit_id=?4",
                params![result.record.workspace_id, result.record.home_id, result.record.record_id, result.audit.audit_id],
                |row| row.get(0),
            )?;
            let receipt = repo::receipt(
                &tx,
                ReceiptKind::Command,
                &result.record.scope(),
                &commit.actor_id,
                &result.audit.mutation_id,
            )?
            .ok_or_else(stock_repo::incompatible)?;
            if current != result.record
                || audit != repo::json(&self.contract, &result.audit)?
                || receipt.hash != *hash
                || receipt.body != repo::json(&self.contract, result)?
            {
                return Err(stock_repo::incompatible());
            }
        }
        check()?;
        tx.commit()?;
        if peers
            .publications
            .iter()
            .any(|closed| !closed.matches_store(self))
        {
            return Err(Error::new(
                "forbidden",
                "Original native publication Store changed",
            ));
        }
        Ok(StockPresenceStorageReleasedCut {
            frame,
            instance: peers.instance,
            invocation: peers.invocation,
            principal: peers.principal,
            request: peers.request,
            publications: peers.publications,
            prepared: peers.prepared,
        })
    }
    /// Required authorizer retains original handles for both native and stock
    /// checks. Full input is validated before planning; no alternate weak plan.
    pub fn execute_stock_json_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        contracts: &S,
        raw: &Value,
    ) -> Result<StockAtlasCommit>
    where
        B: StockAuthorization<Principal = A::Principal>,
        S: StockContractPort,
    {
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        let plan = stock::plan_atlas_commands(&request, &self.contract).map_err(stock_error)?;
        self.execute_stock_plan(
            authorization,
            principal,
            contracts,
            &request,
            &plan,
            Qualification::Direct,
        )
    }

    /// Executes one specialized derived Atlas mapping in the same native
    /// transaction and borrowed original-principal authorization fence.
    pub fn execute_derived_stock_json_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        contracts: &S,
        raw: &Value,
        derivation: &AtlasDerivation,
    ) -> Result<StockAtlasCommit>
    where
        B: StockAuthorization<Principal = A::Principal>,
        S: StockContractPort,
    {
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        super::super::stock_derivation::validate_derivation(&request, derivation)?;
        let plan = stock::plan_derived_atlas_commands(&request, derivation, &self.contract)
            .map_err(stock_error)?;
        self.execute_stock_plan(
            authorization,
            principal,
            contracts,
            &request,
            &plan,
            Qualification::Derived(derivation),
        )
    }

    /// Execute ordered direct and specialized children in the existing single
    /// native transaction. Every supplied preimage is checked against its one
    /// original snapshot; the required authorizer uses the same principal.
    pub fn execute_derived_stock_batch_json_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        contracts: &S,
        raw: &Value,
        derivations: &[Option<AtlasDerivation>],
    ) -> Result<StockAtlasCommit>
    where
        B: StockAuthorization<Principal = A::Principal>,
        S: StockContractPort,
    {
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        super::super::stock_derivation::validate_batch_derivations(&request, derivations)?;
        let plan = stock::plan_derived_atlas_batch_commands(&request, derivations, &self.contract)
            .map_err(stock_error)?;
        self.execute_stock_plan(
            authorization,
            principal,
            contracts,
            &request,
            &plan,
            Qualification::DerivedBatch(derivations),
        )
    }

    /// Consumes one authentic stage in the original stock/native transaction.
    /// The per-call principal need not be the persistent read principal type.
    pub fn execute_staged_stock_json_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        raw: &Value,
        staged: &crate::media::staged_upload::StagedAssetPlan,
    ) -> Result<StockAtlasCommit>
    where
        B: StockAuthorization,
        B::Principal: StagedUploadPrincipal,
        S: StockContractPort,
    {
        if !std::ptr::eq(
            principal.original_upload_principal(),
            staged.original_principal().principal(),
        ) {
            return Err(Error::new(
                "forbidden",
                "Original upload principal is required",
            ));
        }
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        let qualified = stock::plan_staged_atlas_commands(&request, staged, &self.contract)
            .map_err(stock_error)?;
        self.execute_stock_plan(
            authorization,
            principal,
            contracts,
            &request,
            qualified.plan(),
            Qualification::Staged(staged),
        )
    }

    pub(super) fn execute_stock_plan<B: StockAuthorization, S: StockContractPort>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        request: &ValidatedRequest,
        plan: &AtlasCommandPlan,
        qualification: Qualification<'_, '_>,
    ) -> Result<StockAtlasCommit> {
        self.execute_stock_plan_with_presence(
            authorization,
            principal,
            contracts,
            request,
            plan,
            qualification,
            None,
            None,
        )
        .map(|(commit, _)| commit)
    }

    // Preserve the existing planner inputs and pass the optional original peer
    // explicitly through the single native engine.
    #[allow(clippy::too_many_arguments)]
    fn execute_stock_plan_with_presence<
        'phase,
        'call,
        'tx,
        'origin,
        'reader,
        B: StockAuthorization,
        S: StockContractPort,
    >(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        request: &ValidatedRequest,
        plan: &AtlasCommandPlan,
        qualification: Qualification<'_, '_>,
        presence: Option<&StockPresenceCommandPeers<'phase, 'call, 'tx, 'origin, 'reader>>,
        observation: Option<&StockPresenceCommittedObservation>,
    ) -> Result<(StockAtlasCommit, Option<StockPresenceAcceptedFrame>)> {
        let (staged, derivation, child_derivations, review) = match qualification {
            Qualification::Direct => (None, None, None, None),
            Qualification::VerifiedReview(peers) => (None, None, None, Some(peers)),
            Qualification::Staged(staged) => (Some(staged), None, None, None),
            Qualification::Derived(derivation) => (None, Some(derivation), None, None),
            Qualification::DerivedBatch(derivations) => (None, None, Some(derivations), None),
        };
        let entries = plan
            .groups()
            .iter()
            .flat_map(|g| g.native_entries().iter().cloned())
            .collect::<Vec<_>>();
        let batch = plan.batch_target_id().map(|id| BatchMutation {
            schema_version: 1,
            batch_id: id.into(),
            reason: request.raw()["reason"].as_str().unwrap_or_default().into(),
            commands: entries.clone(),
        });
        if let Some(batch) = &batch {
            shape(&self.contract, "batchMutation", batch)?;
        }
        let allocation = PresenceStoreAllocation::capture(self);
        let runtime = &self.runtime;
        let clock = || {
            runtime
                .now()
                .map_err(|_| domain::DomainError::UpstreamUnavailable)
        };
        let original_presence = presence
            .map(|peers| {
                OriginalPresenceEngine::new(OriginalPresenceEngineInputs {
                    principal: peers.access.principal,
                    guard: peers.guard,
                    access: peers.access,
                    network: None,
                    age: peers.age,
                    now: &clock,
                    publications: peers.publications,
                })
            })
            .transpose()?;
        let mut extension = StockTransaction {
            presence: original_presence,
            observation,
            accepted_frame: None,
            pending_data: None,
            contract: &self.contract,
            authorization,
            principal,
            runtime: &self.runtime,
            contracts,
            request,
            plan,
            staged,
            derivation,
            child_derivations,
            review,
            entries: &entries,
            batch: batch.as_ref(),
            commit: None,
        };
        // Borrow private fields once; there is one connection and engine.
        let mut commands = super::commands::CommandTransaction {
            allocation,
            instance: &self.instance,
            fresh_witness_profile: self.options.presence_profile
                == PresenceProfileSelection::FreshV7,
            db: &mut self.db,
            contract: &self.contract,
            authorization,
            runtime: &self.runtime,
        };
        commands.execute_entries(
            principal,
            plan.scope(),
            &entries,
            batch.as_ref(),
            &mut extension,
        )?;
        let commit = extension.commit.ok_or_else(stock_repo::incompatible)?;
        Ok((commit, extension.accepted_frame))
    }
}
struct StockTransaction<'a, 'g, 'origin, 'reader, C, B: Authorization, R, S> {
    // No public/host constructor supplies this peer; existing staging holds remain.
    presence: Option<OriginalPresenceEngine<'a, 'g, 'origin, 'reader>>,
    observation: Option<&'a StockPresenceCommittedObservation>,
    accepted_frame: Option<StockPresenceAcceptedFrame>,
    pending_data: Option<StockPresenceCommittedData>,
    contract: &'a C,
    authorization: &'a B,
    principal: &'a B::Principal,
    runtime: &'a R,
    contracts: &'a S,
    request: &'a ValidatedRequest,
    plan: &'a AtlasCommandPlan,
    staged: Option<&'a crate::media::staged_upload::StagedAssetPlan>,
    derivation: Option<&'a AtlasDerivation>,
    child_derivations: Option<&'a [Option<AtlasDerivation>]>,
    review: Option<&'a AssetReviewCommitPeers<'a, 'g>>,
    entries: &'a [MutationEntry],
    batch: Option<&'a BatchMutation>,
    commit: Option<StockAtlasCommit>,
}
impl<C: Contract, B: StockAuthorization, R: Runtime, S: StockContractPort>
    StockTransaction<'_, '_, '_, '_, C, B, R, S>
{
    fn project(&self, commit: &StockAtlasCommit) -> Result<stock::OwnerResult> {
        super::super::stock_projection::project(
            self.request,
            self.plan,
            commit,
            self.contracts,
            self.contract,
        )
    }
    fn id(&self) -> Result<String> {
        let id = self.runtime.new_id()?;
        shape(
            self.contract,
            "recordRef",
            &RecordRef {
                record_type: RecordType::Identity,
                record_id: id.clone(),
            },
        )?;
        Ok(id)
    }
}
impl<C: Contract, B: StockAuthorization, R: Runtime, S: StockContractPort> CommandExtension<C>
    for StockTransaction<'_, '_, '_, '_, C, B, R, S>
{
    fn after_candidate(&mut self, frame: &ActiveCommandFrame<'_, '_, C>) -> Result<()> {
        match self.presence.as_mut() {
            Some(original) => {
                original.candidate(frame)?;
                for result in frame.results {
                    if result.record.record_type == RecordType::Binding {
                        let prior =
                            frame.context.original.records.iter().find(|r| {
                                r.matches(&frame.context.scope, &result.record.reference())
                            });
                        let prior_domain: Option<domain::Record> = prior
                            .map(|r| serde_json::from_value(serde_json::to_value(r)?))
                            .transpose()?;
                        let current: domain::Record =
                            serde_json::from_value(serde_json::to_value(&result.record)?)?;
                        let operation =
                            serde_json::from_value(serde_json::to_value(result.audit.operation)?)?;
                        if matches!(
                            domain::binding_presence_requirement(
                                prior_domain.as_ref(),
                                &current,
                                operation
                            )
                            .map_err(|_| stock_repo::incompatible())?,
                            domain::PresenceRequirement::Qualify(_)
                        ) {
                            original
                                .check_staged_binding(&result.record, result.audit.operation)?;
                        }
                    }
                }
                Ok(())
            }
            None => assert_core_presence_hold(frame),
        }
    }
    fn after_precommit(&mut self, frame: &ActiveCommandFrame<'_, '_, C>) -> Result<()> {
        if let Some(original) = self.presence.as_mut() {
            let retained = original.precommit(frame)?;
            bounded_size(
                &(
                    &retained.candidate,
                    &retained.precommit,
                    self.commit.as_ref().ok_or_else(stock_repo::incompatible)?,
                    frame.command_hashes,
                    frame.batch_hash,
                    &retained.witnesses,
                ),
                MAX_ACCEPTED_FRAME_BYTES,
            )?;
            let accepted = StockPresenceAcceptedFrame {
                commit: self
                    .commit
                    .as_ref()
                    .ok_or_else(stock_repo::incompatible)?
                    .clone(),
                candidate: retained.candidate,
                precommit: retained.precommit,
                command_hashes: frame.command_hashes.to_vec(),
                batch_hash: frame.batch_hash.map(str::to_owned),
                witnesses: retained.witnesses,
            };
            self.pending_data = Some(accepted.data());
            self.accepted_frame = Some(accepted);
        }
        Ok(())
    }
    fn record_committed(&mut self) {
        if let (Some(observation), Some(data)) = (self.observation, self.pending_data.take()) {
            observation.committed(data);
        }
    }
    fn stock(&self) -> bool {
        true
    }
    fn authorize(
        &mut self,
        facts: &MutationAuthorizationContext,
        original: &Snapshot,
        candidate: Option<&Snapshot>,
        replay: Option<&Replay>,
        actor: &VerifiedActor,
    ) -> Result<()> {
        if (self.review.is_some() || self.presence.is_some())
            && (matches!(
                facts.phase,
                MutationPhase::Replay | MutationPhase::ReplayPrecommit
            ) || replay.is_some())
        {
            return Err(Error::new(
                "upstream-unavailable",
                if self.review.is_some() {
                    "Renderer review replay is held"
                } else {
                    "Original presence replay is held"
                },
            ));
        }
        let extra = self
            .plan
            .root_guards()
            .iter()
            .map(|g| g.record.clone())
            .collect::<Vec<_>>();
        let candidate = candidate.map(|s| s.scoped(self.plan.scope()));
        let closure = context::closure_with_extra(
            self.contract,
            self.plan.scope(),
            &original.scoped(self.plan.scope()),
            candidate.as_ref(),
            self.entries,
            replay,
            &extra,
        )?;
        let verified = self.authorization.authorize_stock_mutation(
            self.principal,
            StockMutationFrame {
                plan: self.plan,
                native: facts,
                closure: &closure,
                commit: self.commit.as_ref(),
            },
        )?;
        if verified != *actor {
            return Err(Error::new(
                "unauthenticated",
                "Verified stock principal changed during transaction",
            ));
        }
        if let Some(review) = self.review
            && facts.phase == MutationPhase::Precommit
        {
            review.validate_original(self.contract, original)?;
        }
        Ok(())
    }
    fn admit(
        &mut self,
        db: &Connection,
        actor: &VerifiedActor,
    ) -> Result<Option<Vec<MutationResult>>> {
        // CommandTransaction has completed native and stock intake checks.
        // Check consumption before any stock key/receipt can return early.
        let consumed = self
            .staged
            .map(|staged| {
                super::super::upload_repository::admit(
                    db,
                    self.contract,
                    self.contracts,
                    actor,
                    self.request,
                    staged,
                )
            })
            .transpose()?
            .unwrap_or(false);
        let scope = self.plan.scope();
        if let Some((id, ordinal)) =
            stock_repo::key(db, scope, &actor.actor_id, self.plan.root_idempotency_key())?
        {
            if self.presence.is_some() {
                return Err(stock_repo::conflict());
            }
            if self.review.is_some() {
                return Err(Error::new(
                    "upstream-unavailable",
                    "Renderer review replay is held",
                ));
            }
            if ordinal.is_some() {
                return Err(stock_repo::conflict());
            }
            if self.staged.is_some() && !consumed {
                return Err(stock_repo::incompatible());
            }
            let mut commit = stock_repo::load(db, self.contract, scope, &actor.actor_id, &id)?;
            if commit.asset_review.is_some() {
                return Err(Error::new(
                    "upstream-unavailable",
                    "Renderer review replay is held",
                ));
            }
            if commit.request_digest != self.plan.request_digest() {
                return Err(stock_repo::conflict());
            }
            super::super::stock_projection::validate_retained(
                db,
                &commit,
                self.contracts,
                self.contract,
            )?;
            if let Some(batch) = self.batch {
                let receipt = repo::receipt(
                    db,
                    ReceiptKind::Batch,
                    scope,
                    &actor.actor_id,
                    &batch.batch_id,
                )?
                .ok_or_else(stock_repo::incompatible)?;
                let mut body = serde_json::to_value(batch)?;
                body["scope"] = serde_json::to_value(scope)?;
                let flat = commit
                    .groups
                    .iter()
                    .flat_map(|g| g.native_results.clone())
                    .collect::<Vec<_>>();
                if receipt.hash != repo::digest(self.contract, &body)?
                    || self
                        .contract
                        .canonical_json(&serde_json::from_str::<Value>(&receipt.body)?)?
                        != self
                            .contract
                            .canonical_json(&serde_json::to_value(&flat)?)?
                {
                    return Err(stock_repo::incompatible());
                }
            }
            commit.replayed = true;
            for group in &mut commit.groups {
                for result in &mut group.native_results {
                    result.replayed = true;
                }
            }
            let output = self.project(&commit)?;
            commit.wire = output.wire;
            commit.children = output.children;
            let results = commit
                .groups
                .iter()
                .flat_map(|g| g.native_results.clone())
                .collect();
            self.commit = Some(commit);
            return Ok(Some(results));
        }
        if consumed {
            return Err(stock_repo::incompatible());
        }
        let mut keys = BTreeSet::new();
        keys.insert(self.plan.root_idempotency_key());
        for group in self.plan.groups() {
            let key = group.original_request()["idempotencyKey"]
                .as_str()
                .ok_or_else(stock_repo::incompatible)?;
            if group.child_index().is_some() && !keys.insert(key) {
                return Err(stock_repo::conflict());
            }
        }
        for key in keys {
            if stock_repo::key(db, scope, &actor.actor_id, key)?.is_some()
                || repo::receipt(db, ReceiptKind::Command, scope, &actor.actor_id, key)?.is_some()
                || repo::receipt(db, ReceiptKind::Batch, scope, &actor.actor_id, key)?.is_some()
            {
                return Err(stock_repo::conflict());
            }
        }
        Ok(None)
    }
    fn validate_original(&self, original: &Snapshot) -> Result<()> {
        if let Some(review) = self.review {
            review.validate_original(self.contract, original)?;
        }
        if let Some(derivation) = self.derivation {
            super::super::stock_derivation::validate_original(
                self.contract,
                self.request,
                original,
                self.plan.scope(),
                derivation,
            )?;
        }
        if let Some(derivations) = self.child_derivations {
            super::super::stock_derivation::validate_batch_derivations(self.request, derivations)?;
            for (child, derivation) in self.request.children().iter().zip(derivations) {
                if let Some(derivation) = derivation {
                    super::super::stock_derivation::validate_original(
                        self.contract,
                        child,
                        original,
                        self.plan.scope(),
                        derivation,
                    )?;
                }
            }
        }
        // A single root's guards are its native command guards. Preserve the
        // native transition-then-guards order instead of checking them twice.
        if self.plan.batch_target_id().is_none() {
            return Ok(());
        }
        let mut seen = BTreeSet::new();
        for guard in self.plan.root_guards() {
            if !seen.insert((guard.record.record_type.as_str(), &guard.record.record_id)) {
                return Err(Error::new(
                    "invalid-contract",
                    "Stock root guards must be unique",
                ));
            }
            let record = original
                .records
                .iter()
                .find(|r| r.matches(self.plan.scope(), &guard.record))
                .ok_or(Error::new(
                    "guard-conflict",
                    "Stock root guard is unavailable",
                ))?;
            if record.revision != guard.expected_revision {
                return Err(Error::new("guard-conflict", "Stock root guard changed"));
            }
        }
        Ok(())
    }
    fn stage(
        &mut self,
        original: &Snapshot,
        results: &[MutationResult],
        actor: &VerifiedActor,
    ) -> Result<()> {
        let root_id = self.id()?;
        let mut offset = 0;
        let mut groups = Vec::new();
        for group in self.plan.groups() {
            let end = offset + group.native_entries().len();
            let native_results = results
                .get(offset..end)
                .ok_or_else(stock_repo::incompatible)?
                .to_vec();
            offset = end;
            for (entry, result) in group.native_entries().iter().zip(&native_results) {
                let prior = original
                    .records
                    .iter()
                    .find(|r| r.matches(self.plan.scope(), &entry.target))
                    .map(|r| serde_json::from_value::<domain::Record>(serde_json::to_value(r)?))
                    .transpose()?;
                let candidate = serde_json::from_value::<domain::Record>(serde_json::to_value(
                    &result.record,
                )?)?;
                let operation = serde_json::from_value::<domain::MutationOperation>(
                    serde_json::to_value(entry.command.operation)?,
                )?;
                let requirement =
                    domain::binding_presence_requirement(prior.as_ref(), &candidate, operation)
                        .map_err(|_| {
                            Error::new("invalid-contract", "Presence predicate is incompatible")
                        })?;
                if self.presence.is_none() {
                    domain::enforce_current_presence_hold(requirement).map_err(|_| {
                        Error::new(
                            "upstream-unavailable",
                            "Atomic presence qualification is unavailable",
                        )
                    })?;
                }
            }
            groups.push(StockCommitGroup {
                child_index: group.child_index(),
                original_request: group.original_request().clone(),
                request_digest: group.request_digest().into(),
                operation_id: if group.child_index().is_some() {
                    self.id()?
                } else {
                    root_id.clone()
                },
                native_entries: group.native_entries().to_vec(),
                native_results,
            });
        }
        if offset != results.len() {
            return Err(stock_repo::incompatible());
        }
        let mut commit = StockAtlasCommit {
            original_request: self.plan.original_request().clone(),
            request_digest: self.plan.request_digest().into(),
            operation_id: root_id,
            actor_id: actor.actor_id.clone(),
            replayed: false,
            groups,
            derivation_format: None,
            derivation: None,
            child_derivations: None,
            asset_review: None,
            wire: Value::Null,
            children: Vec::new(),
        };
        commit.set_derivation(self.derivation.cloned());
        if let Some(derivations) = self.child_derivations {
            commit.set_child_derivations(derivations);
        }
        if let Some(review) = self.review {
            commit.derivation_format = Some(ATLAS_VERIFIED_ASSET_REVIEW_FORMAT.into());
            commit.derivation = Some(review.bound.derivation().clone());
            commit.asset_review = Some(review.bound.retained_facts().clone());
        }
        if self.review.is_some() {
            super::super::stock_derivation::validate_retained_preimage(
                &commit,
                self.contracts,
                self.contract,
            )?;
        }
        let output = self.project(&commit)?;
        commit.wire = output.wire;
        commit.children = output.children;
        self.commit = Some(commit);
        Ok(())
    }
    fn persist(&self, db: &Connection, hashes: &[String]) -> Result<()> {
        stock_repo::persist(
            db,
            self.plan.scope(),
            self.commit.as_ref().ok_or_else(stock_repo::incompatible)?,
            hashes,
        )?;
        if let Some(staged) = self.staged {
            super::super::upload_repository::consume(
                db,
                self.contract,
                self.contracts,
                self.request,
                staged,
                self.commit.as_ref().ok_or_else(stock_repo::incompatible)?,
            )?;
        }
        Ok(())
    }
}
