//! Fresh opaque renderer consumption through the existing Store transaction.
use super::super::{repository as repo, stock_repository as stock_repo, *};
use super::{AtlasStore, stock::stock_error};
use crate::{contracts::AssetPayloadPreviewPolicy, domain::stock, media};
use serde_json::Value;
use std::sync::Arc;

pub(super) fn media_error(error: media::MediaError) -> Error {
    use media::MediaError as M;
    let code = match error {
        M::Unauthenticated => "unauthenticated",
        M::Forbidden => "forbidden",
        M::Conflict => "revision-conflict",
        M::InvalidInput => "invalid-contract",
        _ => "upstream-unavailable",
    };
    Error::new(code, "Original renderer review is unavailable")
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn capture_asset_review_original(
        &mut self,
        principal: &A::Principal,
        original: &media::native::RetainedPrincipal,
        scope: &Scope,
        target: &RecordRef,
    ) -> Result<AssetReviewOriginal>
    where
        A::Principal: StagedUploadPrincipal,
    {
        if !std::ptr::eq(principal.original_upload_principal(), original.principal()) {
            return Err(Error::new(
                "forbidden",
                "Original review principal is required",
            ));
        }
        if target.record_type != RecordType::Asset {
            return Err(stock_repo::incompatible());
        }
        let record = self.read_record(principal, scope, target)?;
        Ok(AssetReviewOriginal {
            instance: self.instance.clone(),
            principal: original.clone(),
            record,
        })
    }

    /// Preparation carries no grant. Fresh execution rechecks the actual Store
    /// original and owner bytes under its borrowed Access transaction fence.
    pub fn prepare_verified_asset_review<'a, S: stock::StockContractPort>(
        &self,
        principal: &A::Principal,
        contracts: &S,
        raw: &Value,
        original: &'a AssetReviewOriginal,
        proof: &'a media::review::VerifiedAssetReview,
    ) -> Result<VerifiedAssetReviewPlan<'a>>
    where
        A::Principal: StagedUploadPrincipal,
    {
        if !Arc::ptr_eq(&self.instance, &original.instance)
            || !std::ptr::eq(
                principal.original_upload_principal(),
                original.principal.principal(),
            )
            || !std::ptr::eq(
                original.principal.principal(),
                proof.original_principal().principal(),
            )
        {
            return Err(Error::new(
                "forbidden",
                "Original Store review custody is required",
            ));
        }
        let request =
            stock::ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        if request.raw() != proof.request().raw()
            || stock::canonical_digest(request.raw()).map_err(stock_error)?
                != proof.request_digest()
            || self
                .contract
                .canonical_json(&serde_json::to_value(original.record())?)?
                != self
                    .contract
                    .canonical_json(&serde_json::to_value(proof.original_record())?)?
        {
            return Err(stock_repo::incompatible());
        }
        let derivation = stock::AtlasDerivation::AssetReview {
            original: original.record.clone(),
            preview_policy: AssetPayloadPreviewPolicy::SafeRendered,
            renderer_receipt_id: Some(proof.facts().receipt_id().into()),
        };
        let plan = stock::plan_derived_atlas_commands(&request, &derivation, &self.contract)
            .map_err(stock_error)?;
        let facts = serde_json::from_value(serde_json::to_value(proof.retained_facts())?)?;
        Ok(VerifiedAssetReviewPlan {
            original,
            proof,
            request,
            plan,
            derivation,
            facts,
        })
    }

    /// Single fresh request only. Both precommit and durable-successor release
    /// use the actual opaque proof and original Access allocation. An error at
    /// release can follow a durable commit; it never means SQL was rolled back.
    pub fn execute_verified_asset_review_stock_json_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        contracts: &S,
        raw: &Value,
        peers: AssetReviewCommitPeers<'_, '_>,
    ) -> Result<StockAtlasCommit>
    where
        B: StockAuthorization<Principal = A::Principal>,
        S: stock::StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        let bound = peers.bound;
        if !Arc::ptr_eq(&self.instance, &bound.original.instance)
            || !std::ptr::eq(
                principal.original_upload_principal(),
                bound.original.principal.principal(),
            )
            || !std::ptr::eq(
                peers.guard.principal(),
                principal.original_upload_principal(),
            )
            || !std::ptr::eq(
                bound.original.principal.principal(),
                bound.proof.original_principal().principal(),
            )
        {
            return Err(Error::new(
                "forbidden",
                "Original Store review custody is required",
            ));
        }
        let request =
            stock::ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        if request.raw() != bound.request.raw() {
            return Err(stock_repo::incompatible());
        }
        let commit = self.execute_stock_plan(
            authorization,
            principal,
            contracts,
            &request,
            bound.plan(),
            super::stock::Qualification::VerifiedReview(&peers),
        )?;
        if let Some(observation) = peers.observation {
            observation.committed(&commit);
        }
        let result = commit
            .groups
            .first()
            .and_then(|g| g.native_results.first())
            .ok_or_else(stock_repo::incompatible)?;
        let target = RecordRef {
            record_type: RecordType::Asset,
            record_id: bound.original.record.record_id.clone(),
        };
        let tx = self.db.transaction()?;
        let actual = repo::read_record(&tx, bound.plan.scope(), &target)?;
        if self
            .contract
            .canonical_json(&serde_json::to_value(&actual)?)?
            != self
                .contract
                .canonical_json(&serde_json::to_value(&result.record)?)?
            || actual.last_audit_id != result.audit.audit_id
        {
            return Err(stock_repo::incompatible());
        }
        // Reload and validate the genuine linked SQL stock/native receipts;
        // this is data verification and does not authorize replay.
        let retained = stock_repo::load(
            &tx,
            &self.contract,
            bound.plan.scope(),
            &commit.actor_id,
            &commit.operation_id,
        )?;
        super::super::stock_projection::validate_retained(
            &tx,
            &retained,
            contracts,
            &self.contract,
        )?;
        if retained != commit {
            return Err(stock_repo::incompatible());
        }
        bound
            .proof
            .revalidate_release(
                peers.guard,
                &bound.original.principal,
                &actual,
                &request,
                peers.budget,
            )
            .map_err(media_error)?;
        tx.commit()?;
        if let Some(observation) = peers.observation {
            observation.store_qualified();
        }
        Ok(commit)
    }
}

impl AssetReviewCommitPeers<'_, '_> {
    pub(super) fn validate_original<C: Contract>(
        &self,
        contract: &C,
        original: &Snapshot,
    ) -> Result<()> {
        let bound = self.bound;
        let expected = bound.original.record();
        let target = RecordRef {
            record_type: RecordType::Asset,
            record_id: expected.record_id.clone(),
        };
        let actual = original
            .records
            .iter()
            .find(|r| r.matches(bound.plan.scope(), &target))
            .ok_or_else(stock_repo::incompatible)?;
        if contract.canonical_json(&serde_json::to_value(actual)?)?
            != contract.canonical_json(&serde_json::to_value(expected)?)?
        {
            return Err(stock_repo::incompatible());
        }
        bound
            .proof
            .revalidate_before_commit(
                self.guard,
                &bound.original.principal,
                actual,
                &bound.request,
                self.budget,
            )
            .map_err(media_error)
    }
}
