//! Explicit queue-free full-profile recovery CLI. No R3 fallback or authority restore.
use super::{Failure, backup::QueueFreeNativeOwners, persistent};
use crate::{
    access,
    app::Store,
    config::{
        geodata_profile::ServerGeodataSelection,
        server::{ServerConfig, absolute_path, read_selected_file},
    },
    domain::stock::NativeStockContract,
    http::contracts::NativeContracts,
    media::{AssetVault, WorkBudget},
    storage::{self, ClosedSource, geodata::GeodataOwners},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const PROFILE: &str = "native-full-geodata-queue-free";

enum Operation {
    Capture {
        config: Box<ServerConfig>,
        config_path: PathBuf,
        config_bytes: Vec<u8>,
        destination: PathBuf,
    },
    Verify {
        bundle: PathBuf,
    },
    Restore {
        bundle: PathBuf,
        destination: PathBuf,
    },
}

pub struct Selection {
    operation: Operation,
    policy: ServerGeodataSelection,
    policy_path: PathBuf,
}

impl Selection {
    /// Distinct commands are parsed before the unchanged serve/backup parsers.
    /// Unknown options include every AI-account or service-activation option.
    pub fn from_arguments(arguments: &[String]) -> Result<Option<Self>, String> {
        let Some(mode) = arguments.first().map(String::as_str) else {
            return Ok(None);
        };
        if !matches!(
            mode,
            "full-geodata-backup" | "full-geodata-verify" | "full-geodata-restore"
        ) {
            return Ok(None);
        }
        let mut options = BTreeMap::new();
        let mut remaining = arguments[1..].iter();
        while let Some(name) = remaining.next() {
            let allowed = matches!(
                name.as_str(),
                "--full-geodata-source-policy" | "--full-geodata-source-policy-sha256"
            ) || (mode == "full-geodata-backup" && name == "--server-config")
                || (mode != "full-geodata-backup" && name == "--bundle")
                || (mode != "full-geodata-verify" && name == "--destination");
            if !allowed
                || options
                    .insert(
                        name.as_str(),
                        remaining
                            .next()
                            .filter(|value| !value.starts_with("--"))
                            .ok_or("Missing full geodata recovery option value")?,
                    )
                    .is_some()
            {
                return Err("Unsupported or repeated full geodata recovery option".into());
            }
        }
        let path = |name| -> Result<PathBuf, String> {
            let path = PathBuf::from(
                options
                    .get(name)
                    .ok_or("Missing required full geodata recovery option")?
                    .as_str(),
            );
            absolute_path(&path)?;
            Ok(path)
        };
        let policy_path = path("--full-geodata-source-policy")?;
        let policy = ServerGeodataSelection::read_pinned(
            &policy_path,
            options
                .get("--full-geodata-source-policy-sha256")
                .ok_or("Required full geodata source policy custody digest")?,
        )?;
        let operation = match mode {
            "full-geodata-backup" => {
                let config_path = path("--server-config")?;
                let config_bytes = read_selected_file(&config_path, 64 * 1024, true)?;
                let config: ServerConfig = serde_json::from_slice(&config_bytes)
                    .map_err(|_| "Invalid full geodata backup server configuration")?;
                config.validate()?;
                Operation::Capture {
                    config: Box::new(config),
                    config_path,
                    config_bytes,
                    destination: path("--destination")?,
                }
            }
            "full-geodata-verify" => Operation::Verify {
                bundle: path("--bundle")?,
            },
            _ => Operation::Restore {
                bundle: path("--bundle")?,
                destination: path("--destination")?,
            },
        };
        Ok(Some(Self {
            operation,
            policy,
            policy_path,
        }))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    format: &'static str,
    profile: &'static str,
    operation: &'static str,
    database_sha256: String,
    database_bytes: u64,
    asset_record_count: usize,
    retained_asset_count: usize,
    conversion_receipt_sha256: String,
}

fn progress(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| {
        storage::Error::new(
            "storage-unavailable",
            "Offline full recovery budget unavailable",
        )
    })
}

/// Capture retains the original native lease. Verify and restore use an empty
/// in-memory owner for structural validation, never credentials or source grants.
pub fn execute(selection: Selection) -> Result<Report, Failure> {
    let budget = WorkBudget::new_offline_backup()?;
    let queues = QueueFreeNativeOwners::for_queue_free_profile()?;
    let stock = NativeStockContract::new()?;
    let peers = storage::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &queues,
        evidence: &queues,
    };
    let (operation, bundle) = match selection.operation {
        Operation::Capture {
            config,
            config_path,
            config_bytes,
            destination,
        } => {
            let policy = selection.policy.into_policy(&config)?;
            // These pins inspect only existing closed source bytes. No destination
            // is inspected until the strict full receipt and lease are acquired.
            let atlas =
                ClosedSource::open(&config.data_directory.join("atlas.sqlite"), &mut || {
                    progress(&budget)
                })?;
            let access =
                ClosedSource::open(&config.data_directory.join("access.sqlite"), &mut || {
                    progress(&budget)
                })?;
            atlas.require_delete()?;
            access.require_delete()?;
            let receipt_path = config.data_directory.join("server-full-geodata-state.json");
            let receipt = read_selected_file(&receipt_path, 16 * 1024, true)?;
            // Declare the retained lease first so Core destruction also remains
            // excluded, including an early error while processing the bundle.
            let lease;
            let (core, acquired_lease) =
                persistent::reopen_full_geodata_for_backup(&config, policy)?;
            lease = acquired_lease;
            atlas.check(&mut || progress(&budget))?;
            access.check(&mut || progress(&budget))?;
            if read_selected_file(&config_path, 64 * 1024, true)? != config_bytes
                || read_selected_file(&receipt_path, 16 * 1024, true)? != receipt
            {
                return Err("Full geodata backup source binding changed".into());
            }
            require_destination(
                &destination,
                &[
                    &config.data_directory,
                    &config.frontend_directory,
                    &config_path,
                    &config.tls_certificate,
                    &config.tls_private_key,
                    &selection.policy_path,
                ],
            )?;
            let manifest = core
                .store
                .lock()
                .map_err(|_| "Full geodata store unavailable")?
                .capture_full_geodata_recovery(&destination, &peers, &mut || {
                    progress(&budget)?;
                    lease.check().map_err(|_| {
                        storage::Error::new(
                            "storage-unavailable",
                            "Full geodata backup lease changed",
                        )
                    })
                })?;
            drop(core);
            atlas.check(&mut || progress(&budget))?;
            access.check(&mut || progress(&budget))?;
            lease.check()?;
            if read_selected_file(&config_path, 64 * 1024, true)? != config_bytes
                || read_selected_file(&receipt_path, 16 * 1024, true)? != receipt
            {
                return Err("Full geodata backup source binding changed".into());
            }
            ("capture", manifest)
        }
        operation => {
            let policy = selection.policy.into_offline_policy()?;
            let (bundle, destination) = match operation {
                Operation::Verify { bundle } => (bundle, None),
                Operation::Restore {
                    bundle,
                    destination,
                } => (bundle, Some(destination)),
                Operation::Capture { .. } => unreachable!(),
            };
            persistent::private_directory(&bundle)?;
            let access = Arc::new(Mutex::new(access::AccessBoundary::in_memory(
                access::AccessConfig::new(vec!["https://offline.invalid".into()])?,
            )?));
            let vault = Arc::new(AssetVault::open_existing(&bundle.join("media"))?);
            let owners = GeodataOwners::new(access, vault, policy);
            if let Some(destination) = destination {
                require_destination(&destination, &[&bundle, &selection.policy_path])?;
                let manifest = Store::restore_full_geodata_recovery(
                    &bundle,
                    &destination,
                    &NativeContracts,
                    &peers,
                    &owners,
                    &mut || progress(&budget),
                )?;
                ("restore", manifest)
            } else {
                let manifest = Store::verify_full_geodata_recovery(
                    &bundle,
                    &NativeContracts,
                    &peers,
                    &owners,
                    &mut || progress(&budget),
                )?;
                ("verify", manifest)
            }
        }
    };
    progress(&budget)?;
    Ok(Report {
        format: "houseatlas-full-geodata-offline-report/1",
        profile: PROFILE,
        operation,
        database_sha256: bundle.database_sha256,
        database_bytes: bundle.database_bytes,
        asset_record_count: bundle.assets.len(),
        retained_asset_count: bundle.retained_assets.len(),
        conversion_receipt_sha256: bundle.conversion_receipt_sha256,
    })
}

fn require_destination(destination: &Path, sources: &[&Path]) -> Result<(), Failure> {
    absolute_path(destination)?;
    let parent = destination
        .parent()
        .ok_or("Missing full geodata recovery destination parent")?;
    persistent::private_directory(parent)?;
    if sources
        .iter()
        .any(|source| destination.starts_with(source) || source.starts_with(destination))
    {
        return Err("Full geodata recovery destination overlaps selected source state".into());
    }
    match fs::symlink_metadata(destination) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err("Full geodata recovery destination must be absent".into()),
        Err(error) => Err(error.into()),
    }
}
