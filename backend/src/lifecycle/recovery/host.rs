//! Offline native recovery over the actual host-owned SQLite connection/vault.
//!
//! These methods are not HTTP or agent authority. The embedding owner supplies
//! a drained Core and exclusively owns/serializes source and destination paths.
//! Image integrity provides neither authenticity nor an operational gate.
use crate::{
    app::{Core, ReadAuthority, ServerRuntime},
    config::recovery::{RecoveryConfig, RecoveryPeers},
    domain::stock::NativeStockContract,
    http::contracts::NativeContracts,
    media::{
        self, MediaResult, WorkBudget,
        native::{NativeMediaRuntime, NativeMediaStorage},
        native_recovery::NativeMediaRecovery,
        recovery::{
            RecoveryDatabasePort, RecoveryManifest, RecoveryProfile, RestoredRecovery,
            VerifiedRecovery,
        },
    },
    storage::{QueueDiscovery, QueueRecoveryEvidence},
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
    /// Uses storage's strict existing-state opener, without creation/migration.
    pub fn reopen(
        self,
        config: RecoveryConfig,
        budget: &WorkBudget,
    ) -> Result<Core, super::reopen::ReopenError> {
        super::reopen::reopen_existing(self.core, config, budget)
    }
}

/// Required-peer populated recovery. The actual owner handles and complete
/// registry remain borrowed for this host's lifetime; no native-only fallback.
/// Image validity grants no queue resume, dispatch or reconciliation authority.
pub struct PopulatedRecoveryHost<'a, D, E> {
    core: Core,
    peers: RecoveryPeers<'a, D, E>,
}
impl<'a, D: QueueDiscovery, E: QueueRecoveryEvidence> PopulatedRecoveryHost<'a, D, E> {
    pub fn new(core: Core, peers: RecoveryPeers<'a, D, E>) -> Self {
        Self { core, peers }
    }
    pub fn into_core(self) -> Core {
        self.core
    }
    pub fn profile(&self) -> RecoveryProfile {
        NativeMediaRecovery::new(&self.core.store, self.peers.storage()).recovery_profile()
    }
    pub fn capture(
        &mut self,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RecoveryManifest> {
        media::recovery::capture_recovery(
            &NativeMediaRecovery::new(&self.core.store, self.peers.storage()),
            &self.core.vault,
            destination,
            budget,
        )
    }
    pub fn validate(&self, bundle: &Path, budget: &WorkBudget) -> MediaResult<VerifiedRecovery> {
        validate_closed(bundle, &self.peers, budget)
    }
    /// Preserves the complete native image and retained Atlas originals. Access,
    /// sessions/credentials/config, HomeBox originals and Network sidecars are
    /// excluded. Queued external media proofs require the evidence owner's
    /// availability contract; committed originals are not a substitute.
    pub fn restore(
        &self,
        bundle: &Path,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RestoredRecovery> {
        restore_closed(bundle, destination, &self.peers, budget)
    }
    pub fn reopen(
        self,
        config: RecoveryConfig,
        budget: &WorkBudget,
    ) -> Result<Core, super::reopen::ReopenError> {
        super::reopen::reopen_with_peers(self.core, config, &self.peers, budget)
    }
}

/// Detached verification retains the same actual owner peers at every image
/// validation stage and needs no spare source database or reconstructed principal.
pub fn validate_closed<D: QueueDiscovery, E: QueueRecoveryEvidence>(
    bundle: &Path,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    let port = NativeMediaRecovery::<
        NativeContracts,
        ReadAuthority,
        NativeMediaRuntime<ServerRuntime>,
        NativeStockContract,
        D,
        E,
    >::validator(&NativeContracts, peers.storage());
    media::recovery::verify_recovery(&port, bundle, budget)
}

pub fn restore_closed<D: QueueDiscovery, E: QueueRecoveryEvidence>(
    bundle: &Path,
    destination: &Path,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
) -> MediaResult<RestoredRecovery> {
    let port = NativeMediaRecovery::<
        NativeContracts,
        ReadAuthority,
        NativeMediaRuntime<ServerRuntime>,
        NativeStockContract,
        D,
        E,
    >::validator(&NativeContracts, peers.storage());
    media::recovery::restore_recovery(&port, bundle, destination, budget)
}
