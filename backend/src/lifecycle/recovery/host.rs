//! Offline native recovery over the actual host-owned SQLite connection/vault.
//!
//! These methods are not HTTP or agent authority. The embedding owner supplies
//! a drained Core and exclusively owns/serializes source and destination paths.
//! Image integrity provides neither authenticity nor an operational gate.
use crate::{
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::recovery::{
        HomeboxRecoveryOwners, RecoveryConfig, RecoveryPeers, StockActivityRecoveryOwners,
    },
    domain::{
        queue_recovery::{OriginalEnqueueOwner, QueuedMediaRecovery},
        stock::NativeStockContract,
    },
    http::contracts::NativeContracts,
    media::{
        self, MediaError, MediaResult, WorkBudget,
        native::{NativeMediaRuntime, NativeMediaStorage},
        native_recovery::NativeMediaRecovery,
        recovery::{
            MAX_ASSETS, RecoveryDatabasePort, RecoveryManifest, RecoveryProfile, RestoredRecovery,
            ValidatedDatabase, VerifiedRecovery,
        },
    },
    providers::homebox::write::stock::StockContractPort,
    storage::{
        self, QueueDiscovery, QueueRecoveryEvidence, StockActivityRecoveryDiscovery,
        StockActivityRecoveryEvidence,
    },
};
use std::{path::Path, sync::Mutex};

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

/// Concrete recovery host using the actual offline access issuer, corrected
/// domain discovery/evidence and retained HomeBox codecs. Original and media
/// owners remain mandatory; there is no default proof or recovered dispatch.
pub struct HomeboxRecoveryHost<'a, O, M> {
    core: Core,
    owners: HomeboxRecoveryOwners<'a, O, M>,
}
impl<'a, O: OriginalEnqueueOwner, M: QueuedMediaRecovery<O::Proof>> HomeboxRecoveryHost<'a, O, M> {
    pub fn new(core: Core, owners: HomeboxRecoveryOwners<'a, O, M>) -> Self {
        Self { core, owners }
    }
    pub fn into_core(self) -> Core {
        self.core
    }
    pub fn profile(&self) -> MediaResult<RecoveryProfile> {
        self.owners
            .with_peers(|peers| {
                NativeMediaRecovery::new(&self.core.store, peers.storage()).recovery_profile()
            })
            .map_err(|_| MediaError::Unavailable)
    }
    /// Captures through the original issuing Store and its actual vault.
    pub fn capture(
        &mut self,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RecoveryManifest> {
        self.owners
            .with_peers(|peers| {
                media::recovery::capture_recovery(
                    &NativeMediaRecovery::new(&self.core.store, peers.storage()),
                    &self.core.vault,
                    destination,
                    budget,
                )
            })
            .map_err(|_| MediaError::Unavailable)?
    }
    pub fn validate(&self, bundle: &Path, budget: &WorkBudget) -> MediaResult<VerifiedRecovery> {
        validate_homebox_closed(bundle, &self.owners, budget)
    }
    /// Uses detached real validators and preserves the complete native image.
    /// All exclusions and independent queued-media requirements remain as above.
    pub fn restore(
        &self,
        bundle: &Path,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RestoredRecovery> {
        restore_homebox_closed(bundle, destination, &self.owners, budget)
    }
    pub fn reopen(
        self,
        config: RecoveryConfig,
        budget: &WorkBudget,
    ) -> Result<Core, super::reopen::ReopenError> {
        super::reopen::reopen_homebox_with_owners(self.core, config, &self.owners, budget)
    }
}

/// Closed-bundle validation needs no source Core, live grant or spare Store.
pub fn validate_homebox_closed<O: OriginalEnqueueOwner, M: QueuedMediaRecovery<O::Proof>>(
    bundle: &Path,
    owners: &HomeboxRecoveryOwners<'_, O, M>,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    owners
        .with_peers(|peers| validate_closed(bundle, peers, budget))
        .map_err(|_| MediaError::Unavailable)?
}

pub fn restore_homebox_closed<O: OriginalEnqueueOwner, M: QueuedMediaRecovery<O::Proof>>(
    bundle: &Path,
    destination: &Path,
    owners: &HomeboxRecoveryOwners<'_, O, M>,
    budget: &WorkBudget,
) -> MediaResult<RestoredRecovery> {
    owners
        .with_peers(|peers| restore_closed(bundle, destination, peers, budget))
        .map_err(|_| MediaError::Unavailable)?
}

/// Explicit async activity recovery on the original Store and retained vault.
/// Base peers still validate native/stock/upload/Jobs; independently selected
/// activity owners qualify the complete physical registry and every event cut.
/// The image cannot choose these owners or yield a producer, handoff or dispatch
/// session. No source grants, writer UUIDs or Jobs leases are reconstructed.
pub struct StockActivityRecoveryHost<'a, D, E, W, AD, AE> {
    core: Core,
    base: RecoveryPeers<'a, D, E>,
    activity: StockActivityRecoveryOwners<'a, W, AD, AE>,
}
impl<
    'a,
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
> StockActivityRecoveryHost<'a, D, E, W, AD, AE>
{
    pub fn new(
        core: Core,
        base: RecoveryPeers<'a, D, E>,
        activity: StockActivityRecoveryOwners<'a, W, AD, AE>,
    ) -> Self {
        Self {
            core,
            base,
            activity,
        }
    }

    pub fn into_core(self) -> Core {
        self.core
    }

    pub fn profile(&self) -> RecoveryProfile {
        stock_activity_profile()
    }

    pub fn capture(
        &mut self,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RecoveryManifest> {
        media::recovery::capture_recovery(
            &StockActivityRecoveryPort::new(&self.core.store, &self.base, &self.activity),
            &self.core.vault,
            destination,
            budget,
        )
    }

    pub fn validate(&self, bundle: &Path, budget: &WorkBudget) -> MediaResult<VerifiedRecovery> {
        validate_stock_activity_closed(bundle, &self.base, &self.activity, budget)
    }

    /// Atlas image/originals only. Access persistence and sessions, credentials,
    /// trusted configuration, HomeBox originals and Network state stay excluded.
    /// Queued/staged external media and liability require independent evidence;
    /// retained Atlas originals cannot substitute for that owner provenance.
    pub fn restore(
        &self,
        bundle: &Path,
        destination: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<RestoredRecovery> {
        restore_stock_activity_closed(bundle, destination, &self.base, &self.activity, budget)
    }

    pub fn reopen(
        self,
        config: RecoveryConfig,
        budget: &WorkBudget,
    ) -> Result<Core, super::reopen::ReopenError> {
        super::reopen::reopen_stock_activity_with_owners(
            self.core,
            config,
            &self.base,
            &self.activity,
            budget,
        )
    }
}

pub fn validate_stock_activity_closed<
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
>(
    bundle: &Path,
    base: &RecoveryPeers<'_, D, E>,
    activity: &StockActivityRecoveryOwners<'_, W, AD, AE>,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    media::recovery::verify_recovery(
        &StockActivityRecoveryPort::validator(base, activity),
        bundle,
        budget,
    )
}

pub fn restore_stock_activity_closed<
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
>(
    bundle: &Path,
    destination: &Path,
    base: &RecoveryPeers<'_, D, E>,
    activity: &StockActivityRecoveryOwners<'_, W, AD, AE>,
    budget: &WorkBudget,
) -> MediaResult<RestoredRecovery> {
    media::recovery::restore_recovery(
        &StockActivityRecoveryPort::validator(base, activity),
        bundle,
        destination,
        budget,
    )
}

// Compatibility comes only from the compiled storage owner. This is an
// explicit constructor choice, never a manifest/schema autodetection path.
fn stock_activity_profile() -> RecoveryProfile {
    RecoveryProfile::NativeRustV1 {
        contract_version: storage::CONTRACT_VERSION,
        database_schema: storage::STOCK_ACTIVITY_DATABASE_VERSION,
        database_lineage: storage::DATABASE_LINEAGE,
    }
}

fn activity_checkpoint(budget: &WorkBudget) -> storage::Result<()> {
    budget
        .check()
        .map_err(|_| storage::Error::new("storage-unavailable", "Recovery work budget exhausted"))
}

// The actual media recovery port, backed ONLY by storage's activity validator.
// Capture borrows the original issuing store; detached operations have no store
// and cannot capture. Retain the exact RecoveryImage for same-handle reopening.
pub(crate) struct StockActivityRecoveryPort<'host, 'peer, D, E, W, AD, AE> {
    source: Option<&'host Mutex<Store>>,
    base: &'host RecoveryPeers<'peer, D, E>,
    activity: &'host StockActivityRecoveryOwners<'peer, W, AD, AE>,
}
impl<
    'host,
    'peer,
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
> StockActivityRecoveryPort<'host, 'peer, D, E, W, AD, AE>
{
    fn new(
        source: &'host Mutex<Store>,
        base: &'host RecoveryPeers<'peer, D, E>,
        activity: &'host StockActivityRecoveryOwners<'peer, W, AD, AE>,
    ) -> Self {
        Self {
            source: Some(source),
            base,
            activity,
        }
    }

    pub(crate) fn validator(
        base: &'host RecoveryPeers<'peer, D, E>,
        activity: &'host StockActivityRecoveryOwners<'peer, W, AD, AE>,
    ) -> Self {
        Self {
            source: None,
            base,
            activity,
        }
    }

    fn revalidate(&self, budget: &WorkBudget) -> MediaResult<()> {
        budget.check()?;
        self.activity
            .revalidate()
            .map_err(|_| MediaError::Unavailable)?;
        budget.check()
    }

    pub(crate) fn validate_image(
        &self,
        database: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<storage::RecoveryImage> {
        self.revalidate(budget)?;
        let image = Store::validate_existing_stock_activity_recovery_image_with_peers(
            database,
            &NativeContracts,
            &self.base.storage(),
            &self.activity.storage(),
            &mut || activity_checkpoint(budget),
        )
        .map_err(|_| MediaError::Unavailable)?;
        self.revalidate(budget)?;
        check_activity_image(&image, budget)?;
        Ok(image)
    }
}
impl<
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
> RecoveryDatabasePort for StockActivityRecoveryPort<'_, '_, D, E, W, AD, AE>
{
    fn recovery_profile(&self) -> RecoveryProfile {
        stock_activity_profile()
    }

    fn backup_to(&self, destination: &Path, budget: &WorkBudget) -> MediaResult<()> {
        self.revalidate(budget)?;
        let source = self.source.ok_or(MediaError::Unsupported)?;
        let mut store = source.try_lock().map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        let image = store
            .backup_stock_activity_recovery_to_with_peers(
                destination,
                &self.base.storage(),
                &self.activity.storage(),
                &mut || activity_checkpoint(budget),
            )
            .map_err(|_| MediaError::Unavailable)?;
        drop(store);
        self.revalidate(budget)?;
        project_activity_image(image, budget)?;
        Ok(())
    }

    fn validate_recovery_database(
        &self,
        database: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<ValidatedDatabase> {
        project_activity_image(self.validate_image(database, budget)?, budget)
    }
}

fn check_activity_image(image: &storage::RecoveryImage, budget: &WorkBudget) -> MediaResult<()> {
    budget.check()?;
    let profile = stock_activity_profile();
    if image.contract_version != profile.contract_version()
        || image.database_schema != profile.database_schema()
        || Some(image.database_lineage.as_str()) != profile.database_lineage()
    {
        return Err(MediaError::Unavailable);
    }
    if image.assets.len() > MAX_ASSETS {
        return Err(MediaError::TooLarge);
    }
    Ok(())
}

// Match the native media projection through PUBLIC shared DTO decoding and
// media AssetRecord validation. This changes only the in-memory asset view;
// original numeric carriers, hashes, ordering and native payloads stay in the
// untouched RecoveryImage and copied DB. Storage alone checks the full image.
fn project_activity_image(
    image: storage::RecoveryImage,
    budget: &WorkBudget,
) -> MediaResult<ValidatedDatabase> {
    check_activity_image(&image, budget)?;
    let mut assets = Vec::with_capacity(image.assets.len());
    for original in &image.assets {
        budget.check()?;
        let bytes = serde_json::to_vec(original).map_err(|_| MediaError::Unavailable)?;
        let typed = crate::contracts::decode::<crate::contracts::AssetRecord>(&bytes)
            .map_err(|_| MediaError::Unavailable)?;
        let mut projection = serde_json::to_value(&typed).map_err(|_| MediaError::Unavailable)?;
        projection["revision"] = projected_integer(&typed.revision)?.into();
        projection["payload"]["byteSize"] = projected_integer(&typed.payload.byte_size)?.into();
        let asset: media::types::AssetRecord =
            serde_json::from_value(projection).map_err(|_| MediaError::Unavailable)?;
        asset.validate()?;
        assets.push(asset);
    }
    budget.check()?;
    Ok(ValidatedDatabase {
        contract_version: image.contract_version,
        database_schema: image.database_schema,
        database_lineage: Some(image.database_lineage),
        assets,
    })
}

fn projected_integer(value: &crate::contracts::JsonInteger) -> MediaResult<u64> {
    if let Some(integer) = value.as_number().as_u64() {
        return (integer <= storage::MAX_REVISION)
            .then_some(integer)
            .ok_or(MediaError::Unavailable);
    }
    let number = value.as_number().as_f64().ok_or(MediaError::Unavailable)?;
    if number.is_finite()
        && number >= 0.0
        && number <= storage::MAX_REVISION as f64
        && number.fract() == 0.0
    {
        Ok(number as u64)
    } else {
        Err(MediaError::Unavailable)
    }
}
