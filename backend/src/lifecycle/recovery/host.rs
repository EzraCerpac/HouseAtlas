//! Offline native recovery over the actual host-owned SQLite connection/vault.
//!
//! These methods are not HTTP or agent authority. The embedding owner supplies
//! a drained Core and exclusively owns/serializes source and destination paths.
//! Image integrity provides neither authenticity nor an operational gate.
use crate::{
    app::Core,
    config::recovery::RecoveryConfig,
    media::{
        self, MediaResult, WorkBudget,
        native::NativeMediaStorage,
        recovery::{
            RecoveryDatabasePort, RecoveryManifest, RecoveryProfile, RestoredRecovery,
            VerifiedRecovery,
        },
    },
};
use std::path::Path;

/// An owned host so restore/reopen can close the original connection and access
/// boundary before rebuilding them. It provisions no synthetic or live state.
pub struct RecoveryHost {
    core: Core,
}
impl RecoveryHost {
    pub fn new(core: Core) -> Self {
        Self { core }
    }
    pub fn into_core(self) -> Core {
        self.core
    }

    /// Compiled storage compatibility, never a schema number used as lineage.
    pub fn profile(&self) -> RecoveryProfile {
        NativeMediaStorage::new(&self.core.store).recovery_profile()
    }
    pub fn capture(
        &mut self,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RecoveryManifest> {
        media::recovery::capture_recovery(
            &NativeMediaStorage::new(&self.core.store),
            &self.core.vault,
            destination,
            budget,
        )
    }
    pub fn validate(
        &mut self,
        bundle: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<VerifiedRecovery> {
        media::recovery::verify_recovery(&NativeMediaStorage::new(&self.core.store), bundle, budget)
    }
    /// Publishes only the native closed Atlas image and retained Atlas originals
    /// to a new destination. Access DB/sessions, credentials, configuration,
    /// HomeBox originals and Network sidecar state remain excluded by the peer.
    /// Stock/queue image limitations propagate from the exact storage validator;
    /// no filtering, schema fallback or substitute validator is supplied.
    pub fn restore(
        &mut self,
        bundle: &Path,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RestoredRecovery> {
        media::recovery::restore_recovery(
            &NativeMediaStorage::new(&self.core.store),
            bundle,
            destination,
            budget,
        )
    }
    /// Revalidates the selected closed existing state with the original store,
    /// consumes that store, then rebuilds real contracts/access/runtime/vault.
    /// A cold opener without an original Core needs a storage-owned detached
    /// validator and no-create/no-migrate opener; neither exists in this peer.
    pub fn reopen(
        self,
        config: RecoveryConfig,
        budget: &WorkBudget,
    ) -> Result<Core, super::reopen::ReopenError> {
        super::reopen::reopen_existing(self.core, config, budget)
    }
}
