//! Stock execution uses the existing native transaction, never a second store.
use super::super::{
    command_extension::CommandExtension, context, repository as repo, repository::ReceiptKind,
    stock_repository as stock_repo, *,
};
use super::{AtlasStore, shape};
use crate::domain::{
    self,
    stock::{
        self, AtlasCommandPlan, AtlasDerivation, StockContractPort, StockError, ValidatedRequest,
    },
};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::BTreeSet;

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
        let mut extension = StockTransaction {
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
        extension.commit.ok_or_else(stock_repo::incompatible)
    }
}
struct StockTransaction<'a, 'g, C, B: Authorization, R, S> {
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
    StockTransaction<'_, '_, C, B, R, S>
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
impl<C: Contract, B: StockAuthorization, R: Runtime, S: StockContractPort> CommandExtension
    for StockTransaction<'_, '_, C, B, R, S>
{
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
        if self.review.is_some() {
            if matches!(
                facts.phase,
                MutationPhase::Replay | MutationPhase::ReplayPrecommit
            ) || replay.is_some()
            {
                return Err(Error::new(
                    "upstream-unavailable",
                    "Renderer review replay is held",
                ));
            }
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
                domain::enforce_current_presence_hold(requirement).map_err(|_| {
                    Error::new(
                        "upstream-unavailable",
                        "Atomic presence qualification is unavailable",
                    )
                })?;
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
