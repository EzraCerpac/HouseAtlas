//! Administrative inspection of the selected profile on its original connection.
use super::*;

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Validate the complete compiled Atlas v5 or selected full-geodata v1
    /// profile without initialization, migration, reopen or session activity.
    /// Required peers retain their existing schema and evidence obligations.
    ///
    /// The caller owns coordination with Access, media and runtime owners; this
    /// read snapshot supplies neither whole-Core coherence nor a maintenance
    /// grant. The original connection policy is retained, and synchronous peer
    /// calls are bounded by their owners. Call outside an existing transaction.
    pub fn validate_current_profile_read_only_with_peers<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        &mut self,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        self.options.require_available_profile()?;
        if self.options.stock_activity_profile {
            return Err(Error::new(
                "schema-incompatible",
                "Current read validation requires Atlas v5 or full-geodata v1",
            ));
        }
        if self.full_geodata.is_some() {
            // This existing same-connection validator owns its read transaction,
            // document closure and retained-byte validation. No native fallback.
            return self.validate_full_geodata(peers, check);
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let image = recovery::validate_v5_full_peers(&tx, &self.contract, peers, check)?;
        tx.commit()?;
        Ok(image)
    }
}

#[cfg(test)]
#[path = "checks/updater-read-validation-healthy.rs"]
mod healthy;
