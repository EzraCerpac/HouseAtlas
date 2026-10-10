//! Same-Store retained replay source preparation. No replay action runs here.
use super::super::*;
use super::AtlasStore;
use crate::{domain::stock::StockContractPort, media::native::RetainedPrincipal};
use serde_json::Value;

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Capture the exact saved root/plan in the original read transaction.
    /// Existing required ReadHistory semantic qualification covers the full
    /// original commit and actual current facts before this carrier is issued.
    /// The original request/principal, owner and Store pins are retained; no
    /// read hit, authority DTO or saved renderer facts become replay authority.
    pub fn prepare_stock_atlas_replay_source_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        stock: &S,
        raw: &Value,
        original: &RetainedPrincipal,
    ) -> Result<StockAtlasReplayPreparation>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        let (read, saved) = self.prepare_retained_source_with_authorization(
            authorization,
            principal,
            stock,
            raw,
            original,
        )?;
        Ok(StockAtlasReplayPreparation { read, saved })
    }

    /// Reload and qualify the exact retained source for read-only disclosure.
    /// Saved wire, request/operation/native/audit IDs and replay flags remain
    /// unchanged. Missing source and original Media/HTTP release stay unknown.
    /// Mutation Replay/ReplayPrecommit checks belong to a separate actual owner.
    pub fn disclose_stock_atlas_replay_source_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        stock: &S,
        preparation: &StockAtlasReplayPreparation,
    ) -> Result<StockRetainedReconciliation>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        self.disclose_stock_retained_committed_result_with_authorization(
            authorization,
            principal,
            stock,
            &preparation.read,
        )
    }
}
