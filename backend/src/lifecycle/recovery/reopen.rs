//! Rebuild actual host components from a validated existing closed native image.
//! Never calls lifecycle::prepare, bootstraps records or reconstructs authority.
use crate::{
    access::AccessBoundary,
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::recovery::{ExistingPath, RecoveryConfig},
    http::contracts::NativeContracts,
    media::{
        AssetVault, MediaError, WorkBudget,
        native::{NativeMediaRuntime, NativeMediaStorage},
        recovery::{MAX_DATABASE, RecoveryDatabasePort},
        types::Availability,
        vault::AvailableAssetVerifier,
    },
    storage::StoreOptions,
};
use sha2::{Digest, Sha256};
use std::{
    fmt,
    io::{Read, Seek, SeekFrom},
    sync::{Arc, Mutex},
};

/// Sanitized phase only; errors do not emit private paths/configuration.
/// Every outcome consumes the source Core. Failures leave restored files for
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

// Bind the owner's read-only validation to the same bounded pinned file before
// normal opening enables WAL. This checks identity/bytes, not graph semantics.
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

/// Requires the original actual Core solely for its storage-owned validator.
/// The selected Atlas DB must already be a closed standalone recovery image;
/// this is not a hot-WAL service restart or a detached cold-process opener.
/// Trusted ownership must exclude other writers throughout. Storage::open is
/// path-based and contains its normal migration machinery; exact current-image
/// validation precedes it so this lane applies no migrations or creation.
pub fn reopen_existing(
    source: Core,
    config: RecoveryConfig,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    checkpoint(budget)?;
    configuration(&config)?;
    let before = image_digest(&config.database, budget)?;
    let validated = NativeMediaStorage::new(&source.store)
        .validate_recovery_database(config.database.path(), budget)
        .map_err(|_| ReopenError::Image)?;
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }

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
    let Core {
        access,
        store,
        vault: source_vault,
        ..
    } = source;
    store
        .into_inner()
        .map_err(|_| ReopenError::SourceClose)?
        .close()
        .map_err(|_| ReopenError::SourceClose)?;
    let access = Arc::try_unwrap(access).map_err(|_| ReopenError::SourceClose)?;
    let source_vault = Arc::try_unwrap(source_vault).map_err(|_| ReopenError::SourceClose)?;
    drop(access.into_inner().map_err(|_| ReopenError::SourceClose)?);
    drop(source_vault);

    checkpoint(budget)?;
    configuration(&config)?;
    if image_digest(&config.database, budget)? != before {
        return Err(ReopenError::Image);
    }
    let mut access = AccessBoundary::open(config.access_database.path(), config.access)
        .map_err(|_| ReopenError::Access)?;
    // The selected separate access DB is not recovered from the image. Rotate
    // its actual restore epoch and clear sessions/rates with the owner's seam.
    access
        .invalidate_all_sessions()
        .map_err(|_| ReopenError::SessionReset)?;
    checkpoint(budget)?;
    // Recheck all selected identities/bytes immediately before normal opening,
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
    let store = Store::open(
        config.database.path(),
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        StoreOptions::default(),
    )
    .map_err(|_| ReopenError::Store)?;
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
