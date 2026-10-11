//! Offline full-image recovery through actual stock/queue validation peers.
//! The host selects trusted peers and private paths; validation grants no
//! authority to dispatch, reconcile or resume a recovered queue.
use std::path::Path;
use std::sync::Mutex;

use crate::{domain::stock::StockContractPort, storage as s};

use super::native::{
    check_recovery_image, native_recovery_profile, project_recovery_image, recovery_checkpoint,
    storage_error,
};
use super::recovery::{RecoveryDatabasePort, RecoveryProfile, ValidatedDatabase};
use super::{MediaError, MediaResult, WorkBudget};

enum Source<'a, C, A, R> {
    Store(&'a Mutex<s::AtlasStore<C, A, R>>),
    Existing(&'a Path, &'a C),
    Validator(&'a C),
}

/// All validation peers are required and retained for the operation's lifetime.
/// Supply the complete trusted queue registry and owner-qualified codecs.
/// Callbacks must not reenter storage or create an opposing access/vault lock
/// order: storage invokes them while its store lock/read transaction is held.
pub struct NativeMediaRecovery<'store, 'peer, C, A, R, S, D, E> {
    source: Source<'store, C, A, R>,
    peers: s::RecoveryValidationPeers<'peer, S, D, E>,
}

impl<'store, 'peer, C, A, R, S, D, E> NativeMediaRecovery<'store, 'peer, C, A, R, S, D, E>
where
    C: s::Contract,
    A: s::Authorization,
    R: s::Runtime,
    S: StockContractPort,
    D: s::QueueDiscovery,
    E: s::QueueRecoveryEvidence,
{
    pub fn new(
        store: &'store Mutex<s::AtlasStore<C, A, R>>,
        peers: s::RecoveryValidationPeers<'peer, S, D, E>,
    ) -> Self {
        Self {
            source: Source::Store(store),
            peers,
        }
    }

    /// Detached verify/restore needs no source store, CREATE or migration.
    /// This explicit mode cannot back up an absent source connection.
    pub fn validator(
        contract: &'store C,
        peers: s::RecoveryValidationPeers<'peer, S, D, E>,
    ) -> Self {
        Self {
            source: Source::Validator(contract),
            peers,
        }
    }

    /// Caller holds the existing server lease and proves a closed source with
    /// no WAL/SHM/journal. This adapter opens no runtime, Access DB or authority.
    pub fn existing_source(
        database: &'store Path,
        contract: &'store C,
        peers: s::RecoveryValidationPeers<'peer, S, D, E>,
    ) -> Self {
        Self {
            source: Source::Existing(database, contract),
            peers,
        }
    }

    pub fn backup_image(
        &self,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<s::RecoveryImage> {
        budget.check()?;
        let image = match self.source {
            Source::Store(source) => {
                let mut store = source.try_lock().map_err(|_| MediaError::Unavailable)?;
                budget.check()?;
                store
                    .backup_recovery_to_with_peers(destination, &self.peers, &mut || {
                        recovery_checkpoint(budget)
                    })
                    .map_err(storage_error)?
            }
            Source::Existing(database, contract) => {
                s::AtlasStore::<C, A, R>::backup_existing_recovery_to_with_peers(
                    database,
                    contract,
                    destination,
                    &self.peers,
                    &mut || recovery_checkpoint(budget),
                )
                .map_err(storage_error)?
            }
            Source::Validator(_) => return Err(MediaError::Unsupported),
        };
        check_recovery_image(&image, native_recovery_profile(), budget)?;
        Ok(image)
    }

    /// Preserve the exact storage records, order and payloads for the host's
    /// strict opener. Neither this identity nor the projected media manifest
    /// replaces the full-image digest and exclusive path binding.
    pub fn validate_image(
        &self,
        database: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<s::RecoveryImage> {
        budget.check()?;
        let image = match self.source {
            Source::Store(source) => {
                let store = source.try_lock().map_err(|_| MediaError::Unavailable)?;
                budget.check()?;
                let image = store
                    .validate_recovery_image_with_peers(database, &self.peers, &mut || {
                        recovery_checkpoint(budget)
                    })
                    .map_err(storage_error)?;
                drop(store);
                image
            }
            Source::Validator(contract) | Source::Existing(_, contract) => {
                s::AtlasStore::<C, A, R>::validate_existing_recovery_image_with_peers(
                    database,
                    contract,
                    &self.peers,
                    &mut || recovery_checkpoint(budget),
                )
                .map_err(storage_error)?
            }
        };
        check_recovery_image(&image, native_recovery_profile(), budget)?;
        Ok(image)
    }
}

impl<C, A, R, S, D, E> RecoveryDatabasePort for NativeMediaRecovery<'_, '_, C, A, R, S, D, E>
where
    C: s::Contract,
    A: s::Authorization,
    R: s::Runtime,
    S: StockContractPort,
    D: s::QueueDiscovery,
    E: s::QueueRecoveryEvidence,
{
    fn recovery_profile(&self) -> RecoveryProfile {
        native_recovery_profile()
    }

    fn backup_to(&self, destination: &Path, budget: &WorkBudget) -> MediaResult<()> {
        project_recovery_image(
            self.backup_image(destination, budget)?,
            self.recovery_profile(),
            budget,
        )?;
        Ok(())
    }

    fn validate_recovery_database(
        &self,
        database: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<ValidatedDatabase> {
        project_recovery_image(
            self.validate_image(database, budget)?,
            self.recovery_profile(),
            budget,
        )
    }
}
