//! Fresh staged completion custody from the original Store executor.
//! A commit, consumed-token row or stage pair cannot construct this carrier.
use super::super::{
    repository as repo, stock_repository as stock_repo, upload_repository as upload, *,
};
use super::AtlasStore;
use crate::{domain::stock, media::staged_upload::StagedAssetPlan};
use serde_json::Value;

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Reuse the existing authentic staged executor and all its native/stock
    /// fences. Committed data is observed before subsequent qualification can
    /// fail; failure never means rollback or permission to submit again.
    /// Only a fresh successful execution can issue opaque completion custody.
    pub fn execute_staged_stock_json_observing_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        raw: &Value,
        staged: &StagedAssetPlan,
        observation: &AssetUploadCommitObservation,
    ) -> Result<StockAtlasCommit>
    where
        B: StockAuthorization,
        B::Principal: StagedUploadPrincipal,
        S: stock::StockContractPort,
    {
        let commit = self.execute_staged_stock_json_with_authorization(
            authorization,
            principal,
            contracts,
            raw,
            staged,
        )?;
        observation.committed(&commit);
        // The existing data replay path cannot issue original fresh custody.
        if commit.replayed {
            return Err(Error::new(
                "upstream-unavailable",
                "Fresh upload completion is required",
            ));
        }
        let original = staged.original_principal();
        if !std::ptr::eq(principal.original_upload_principal(), original.principal()) {
            return Err(Error::new(
                "forbidden",
                "Original upload principal is required",
            ));
        }
        let scope = Scope {
            workspace_id: staged.request().context().workspace_id.clone(),
            home_id: staged.request().context().home_id.clone(),
        };
        let tx = self.db.transaction()?;
        let retained = stock_repo::load(
            &tx,
            &self.contract,
            &scope,
            original.principal().actor_id().as_str(),
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
        let consumed = upload::load_for_commit(&tx, &self.contract, contracts, &commit)?
            .ok_or_else(stock_repo::incompatible)?;
        // The existing strict loader proves the token/native/stock association.
        // Bind those actual facts to this call's genuine opaque stage as well,
        // including complete canonical request/payload and untouched metadata.
        if consumed.scope() != &scope
            || consumed.actor_id() != original.principal().actor_id().as_str()
            || consumed.request_id() != staged.request().request_id()
            || consumed.asset_id() != staged.asset_id()
            || consumed.binding_digest() != staged.binding_digest()
            || consumed.staged() != staged.staged()
            || self.contract.canonical_json(consumed.asset_request())?
                != self.contract.canonical_json(staged.request().raw())?
            || self.contract.canonical_json(consumed.root_request())?
                != self.contract.canonical_json(raw)?
            || self.contract.canonical_json(consumed.asset_payload())?
                != self
                    .contract
                    .canonical_json(&serde_json::to_value(staged.payload())?)?
        {
            return Err(stock_repo::incompatible());
        }
        let result = commit
            .groups
            .get(consumed.group_ordinal())
            .and_then(|group| group.native_results.first())
            .ok_or_else(stock_repo::incompatible)?;
        let target = RecordRef {
            record_type: RecordType::Asset,
            record_id: consumed.asset_id().into(),
        };
        let actual = repo::read_record(&tx, &scope, &target)?;
        if self
            .contract
            .canonical_json(&serde_json::to_value(&actual)?)?
            != self
                .contract
                .canonical_json(&serde_json::to_value(&result.record)?)?
            || actual.last_audit_id != consumed.asset_audit_id()
        {
            return Err(stock_repo::incompatible());
        }
        // Borrow the original configured Runtime on this same Store; no second
        // connection, caller-provided measurement or policy inferred from MIME.
        let proof = self.runtime.verify_available_asset(&actual)?;
        if proof.sha256 != staged.staged().sha256 || proof.byte_size != staged.staged().byte_size {
            return Err(Error::new(
                "asset-unavailable",
                "Owned original unavailable",
            ));
        }
        tx.commit()?;
        observation.store_qualified(&commit, &self.instance, original, consumed);
        Ok(commit)
    }
}
