//! Rebuild actual host components from a validated existing closed native image.
//! Never calls lifecycle::prepare, bootstraps records or reconstructs authority.
use crate::{
    access::AccessBoundary,
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::recovery::{
        ExistingPath, HomeboxRecoveryOwners, RecoveryConfig, RecoveryPeers,
        StockActivityRecoveryOwners,
    },
    domain::{
        queue_recovery::{OriginalEnqueueOwner, QueuedMediaRecovery},
        stock::NativeStockContract,
    },
    http::contracts::NativeContracts,
    media::{
        AssetVault, MediaError, WorkBudget,
        native::{NativeMediaRuntime, NativeMediaStorage},
        native_recovery::NativeMediaRecovery,
        recovery::{MAX_DATABASE, RecoveryDatabasePort, ValidatedDatabase},
        types::Availability,
        vault::AvailableAssetVerifier,
    },
    providers::homebox::write::stock::StockContractPort,
    storage::{
        self, QueueDiscovery, QueueRecoveryEvidence, StockActivityRecoveryDiscovery,
        StockActivityRecoveryEvidence, StoreOptions,
    },
};
use sha2::{Digest, Sha256};
use std::{
    fmt,
    io::{Read, Seek, SeekFrom},
    path::Path,
    sync::{Arc, Mutex},
};

/// Sanitized phase only; errors do not emit private paths/configuration.
/// When a source Core is supplied, every outcome consumes it. Failures leave restored files for
/// the owner and may occur after access sessions have already been reset;
/// this API provides no distributed rollback or crash-recovery qualification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReopenError {
    Configuration,
    Budget,
    Image,
    SourceClose,
    Access,
    SessionReset,
    Vault,
    Store,
}
impl fmt::Display for ReopenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Configuration => "Existing recovery configuration unavailable",
            Self::Budget => "Recovery work budget exhausted",
            Self::Image => "Native recovery image validation unavailable",
            Self::SourceClose => "Original recovery host could not close exclusively",
            Self::Access => "Separately configured access persistence unavailable",
            Self::SessionReset => "Recovery access session reset unavailable",
            Self::Vault => "Existing retained media vault unavailable",
            Self::Store => "Existing native recovery store unavailable",
        })
    }
}
impl std::error::Error for ReopenError {}
fn checkpoint(budget: &WorkBudget) -> Result<(), ReopenError> {
    budget.check().map_err(|_| ReopenError::Budget)
}
fn configuration(config: &RecoveryConfig) -> Result<(), ReopenError> {
    config.check().map_err(|_| ReopenError::Configuration)
}
fn storage_checkpoint(budget: &WorkBudget) -> storage::Result<()> {
    budget
        .check()
        .map_err(|_| storage::Error::new("storage-unavailable", "Recovery work budget exhausted"))
}

fn declared_image(config: &RecoveryConfig, digest: [u8; 32]) -> Result<(), ReopenError> {
    if let Some(member) = &config.expected_database {
        let actual = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        if actual != member.sha256
            || config
                .database
                .file()
                .metadata()
                .map_err(|_| ReopenError::Image)?
                .len()
                != member.byte_size
        {
            return Err(ReopenError::Image);
        }
    }
    Ok(())
}

// Bind the owner's read-only validation to the same bounded pinned file before
// strict opening enables WAL. This checks identity/bytes, not graph semantics.
fn image_digest(database: &ExistingPath, budget: &WorkBudget) -> Result<[u8; 32], ReopenError> {
    database.check().map_err(|_| ReopenError::Configuration)?;
    let mut file = database.file();
    if file.metadata().map_err(|_| ReopenError::Image)?.len() > MAX_DATABASE as u64 {
        return Err(ReopenError::Image);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| ReopenError::Image)?;
    let mut digest = Sha256::new();
    let mut total = 0usize;
    let mut buffer = [0u8; 65536];
    loop {
        checkpoint(budget)?;
        let count = file.read(&mut buffer).map_err(|_| ReopenError::Image)?;
        if count == 0 {
            break;
        }
        total = total.checked_add(count).ok_or(ReopenError::Image)?;
        if total > MAX_DATABASE {
            return Err(ReopenError::Image);
        }
        digest.update(&buffer[..count]);
    }
    database.check().map_err(|_| ReopenError::Configuration)?;
    Ok(digest.finalize().into())
}

/// Retained native-only handoff. Populated images use reopen_with_peers.
/// The selected Atlas DB must already be a closed standalone recovery image;
/// this is not a hot-WAL service restart. The strict storage opener creates and
/// migrates nothing. Trusted ownership must exclude other writers throughout.
pub fn reopen_existing(
    source: Core,
    config: RecoveryConfig,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    checkpoint(budget)?;
    configuration(&config)?;
    let before = image_digest(&config.database, budget)?;
    declared_image(&config, before)?;
    let image = Store::validate_existing_recovery_image(
        config.database.path(),
        &NativeContracts,
        &mut || storage_checkpoint(budget),
    )
    .map_err(|_| ReopenError::Image)?;
    let validated = NativeMediaStorage::new(&source.store)
        .validate_recovery_database(config.database.path(), budget)
        .map_err(|_| ReopenError::Image)?;
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }

    finish_reopen(
        Some(source),
        config,
        budget,
        before,
        validated,
        |database, access, vault| {
            Store::open_existing_recovery_image(
                database,
                NativeContracts,
                ReadAuthority(access),
                NativeMediaRuntime {
                    vault,
                    server: ServerRuntime,
                },
                StoreOptions::default(),
                &image,
                &mut || storage_checkpoint(budget),
            )
            .map_err(|_| ReopenError::Store)
        },
    )
}

/// Cold opening of an already closed image. Only trusted configuration and
/// actual independently owned discovery/evidence peers are required; no fixture
/// preparation, source Store, provider call, grant minting or migration.
pub fn reopen_closed<D: QueueDiscovery, E: QueueRecoveryEvidence>(
    config: RecoveryConfig,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_selected(None, config, peers, budget)
}

/// Consume a drained old host before rebuilding actual components. Peers must
/// not retain source access/vault aliases, or exclusive close fails. They must
/// remain independently qualified after the selected access session reset.
pub fn reopen_with_peers<D: QueueDiscovery, E: QueueRecoveryEvidence>(
    source: Core,
    config: RecoveryConfig,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_selected(Some(source), config, peers, budget)
}

/// Cold concrete composition. The independently retained access issuer/grant
/// and writer/original/media owners survive the new boundary's session reset.
/// Reconstructing those facts from the selected image is never an alternative.
pub fn reopen_homebox_closed<O: OriginalEnqueueOwner, M: QueuedMediaRecovery<O::Proof>>(
    config: RecoveryConfig,
    owners: &HomeboxRecoveryOwners<'_, O, M>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    owners
        .with_peers(|peers| reopen_closed(config, peers, budget))
        .map_err(|_| ReopenError::Configuration)?
}

/// Consumes the old Core on all outcomes, including owner qualification errors.
pub fn reopen_homebox_with_owners<O: OriginalEnqueueOwner, M: QueuedMediaRecovery<O::Proof>>(
    source: Core,
    config: RecoveryConfig,
    owners: &HomeboxRecoveryOwners<'_, O, M>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    owners
        .with_peers(|peers| reopen_with_peers(source, config, peers, budget))
        .map_err(|_| ReopenError::Configuration)?
}

fn reopen_selected<D: QueueDiscovery, E: QueueRecoveryEvidence>(
    source: Option<Core>,
    config: RecoveryConfig,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    checkpoint(budget)?;
    configuration(&config)?;
    let before = image_digest(&config.database, budget)?;
    declared_image(&config, before)?;
    let port = NativeMediaRecovery::<
        NativeContracts,
        ReadAuthority,
        NativeMediaRuntime<ServerRuntime>,
        NativeStockContract,
        D,
        E,
    >::validator(&NativeContracts, peers.storage());
    // Preserve the actual native return. The projected media assets cannot
    // reconstruct its original numeric carriers, ordering or native payloads.
    let image = port
        .validate_image(config.database.path(), budget)
        .map_err(|_| ReopenError::Image)?;
    let validated = port
        .validate_recovery_database(config.database.path(), budget)
        .map_err(|_| ReopenError::Image)?;
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }
    finish_reopen(
        source,
        config,
        budget,
        before,
        validated,
        |database, access, vault| {
            Store::open_existing_recovery_image_with_peers(
                database,
                NativeContracts,
                ReadAuthority(access),
                NativeMediaRuntime {
                    vault,
                    server: ServerRuntime,
                },
                StoreOptions::default(),
                &image,
                &peers.storage(),
                &mut || storage_checkpoint(budget),
            )
            .map_err(|_| ReopenError::Store)
        },
    )
}

fn close_source(source: Core) -> Result<(), ReopenError> {
    let Core {
        access,
        store,
        vault,
        ..
    } = source;
    store
        .into_inner()
        .map_err(|_| ReopenError::SourceClose)?
        .close()
        .map_err(|_| ReopenError::SourceClose)?;
    let access = Arc::try_unwrap(access).map_err(|_| ReopenError::SourceClose)?;
    let vault = Arc::try_unwrap(vault).map_err(|_| ReopenError::SourceClose)?;
    drop(access.into_inner().map_err(|_| ReopenError::SourceClose)?);
    drop(vault);
    Ok(())
}

/// Cold strict profile-6 opening with independently selected base and native
/// activity owners. No producer brand, live source/session, queued handoff or
/// original invocation authority is reconstructed from the validated image.
pub fn reopen_stock_activity_closed<
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
>(
    config: RecoveryConfig,
    base: &RecoveryPeers<'_, D, E>,
    activity: &StockActivityRecoveryOwners<'_, W, AD, AE>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_stock_activity_selected(None, config, base, activity, budget)
}

/// Consumes the drained original Core on every outcome. Owners are held outside
/// Core/session reset and must not retain source access/vault aliases. Image
/// validity grants neither recovered execution nor physical-hold release.
pub fn reopen_stock_activity_with_owners<
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
>(
    source: Core,
    config: RecoveryConfig,
    base: &RecoveryPeers<'_, D, E>,
    activity: &StockActivityRecoveryOwners<'_, W, AD, AE>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_stock_activity_selected(Some(source), config, base, activity, budget)
}

fn reopen_stock_activity_selected<
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
>(
    source: Option<Core>,
    config: RecoveryConfig,
    base: &RecoveryPeers<'_, D, E>,
    activity: &StockActivityRecoveryOwners<'_, W, AD, AE>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    checkpoint(budget)?;
    configuration(&config)?;
    activity
        .revalidate()
        .map_err(|_| ReopenError::Configuration)?;
    let before = image_digest(&config.database, budget)?;
    declared_image(&config, before)?;
    let port = super::host::StockActivityRecoveryPort::validator(base, activity);
    let image = port
        .validate_image(config.database.path(), budget)
        .map_err(|_| ReopenError::Image)?;
    let validated = port
        .validate_recovery_database(config.database.path(), budget)
        .map_err(|_| ReopenError::Image)?;
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }
    finish_reopen(
        source,
        config,
        budget,
        before,
        validated,
        |database, access, vault| {
            activity
                .revalidate()
                .map_err(|_| ReopenError::Configuration)?;
            let store = Store::open_existing_stock_activity_recovery_image_with_peers(
                database,
                NativeContracts,
                ReadAuthority(access),
                NativeMediaRuntime {
                    vault,
                    server: ServerRuntime,
                },
                StoreOptions {
                    stock_activity_profile: true,
                    ..StoreOptions::default()
                },
                &image,
                &base.storage(),
                &activity.storage(),
                &mut || storage_checkpoint(budget),
            )
            .map_err(|_| ReopenError::Store)?;
            // Recheck the SAME external issuer after access-session reset and
            // strict opening. A new boundary or equal metadata is no substitute.
            if activity.revalidate().is_err() {
                store.close().map_err(|_| ReopenError::Store)?;
                return Err(ReopenError::Configuration);
            }
            Ok(store)
        },
    )
}

fn finish_reopen(
    source: Option<Core>,
    config: RecoveryConfig,
    budget: &WorkBudget,
    before: [u8; 32],
    validated: ValidatedDatabase,
    open: impl FnOnce(&Path, Arc<Mutex<AccessBoundary>>, Arc<AssetVault>) -> Result<Store, ReopenError>,
) -> Result<Core, ReopenError> {
    let vault = Arc::new(AssetVault::open(config.vault.path()).map_err(|_| ReopenError::Vault)?);
    configuration(&config)?;
    for record in &validated.assets {
        checkpoint(budget)?;
        let payload = &record.payload;
        let owned_key = record
            .scope()
            .storage_key(&payload.sha256)
            .map_err(|_| ReopenError::Vault)?;
        if payload.availability == Availability::Available {
            vault
                .verify_available_asset(record, budget)
                .map_err(|_| ReopenError::Vault)?;
        } else if payload.storage_key == owned_key {
            match vault.read_retained(record, budget) {
                Ok(_) => (),
                Err(MediaError::NotFound) if payload.availability == Availability::Missing => (),
                Err(_) => return Err(ReopenError::Vault),
            }
        }
    }

    // Closing storage drops its original ReadAuthority and media runtime clones.
    // Outstanding external access/vault clones mean the host was not drained.
    if let Some(source) = source {
        close_source(source)?;
    }

    checkpoint(budget)?;
    configuration(&config)?;
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }
    let mut access = AccessBoundary::open_existing(config.access_database.path(), config.access)
        .map_err(|_| ReopenError::Access)?;
    checkpoint(budget)?;
    config
        .access_database
        .check()
        .map_err(|_| ReopenError::Configuration)?;
    // The selected separate access DB is not recovered from the image. Rotate
    // its actual restore epoch and clear sessions/rates with the owner's seam.
    access
        .invalidate_all_sessions()
        .map_err(|_| ReopenError::SessionReset)?;
    checkpoint(budget)?;
    // Recheck all selected identities/bytes immediately before strict opening,
    // after the synchronous access and retained-media work.
    for path in [
        &config.directory,
        &config.database,
        &config.vault,
        &config.blobs,
        &config.staging,
        &config.access_database,
    ] {
        path.check().map_err(|_| ReopenError::Configuration)?;
    }
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }
    let access = Arc::new(Mutex::new(access));
    let store = open(
        config.database.path(),
        Arc::clone(&access),
        Arc::clone(&vault),
    )?;
    if let Err(error) = checkpoint(budget) {
        store.close().map_err(|_| ReopenError::Store)?;
        return Err(error);
    }
    Ok(Core {
        access,
        store: Mutex::new(store),
        vault,
        home: config.home,
        homes: config.homes,
    })
}
