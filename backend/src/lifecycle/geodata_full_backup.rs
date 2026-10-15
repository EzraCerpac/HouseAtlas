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
    Copy {
        source: PathBuf,
        source_sha256: String,
        source_vault: PathBuf,
        destination: PathBuf,
    },
    Bind {
        config: Box<ServerConfig>,
        config_path: PathBuf,
        config_bytes: Vec<u8>,
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
            "full-geodata-backup"
                | "full-geodata-verify"
                | "full-geodata-restore"
                | "full-geodata-copy"
                | "full-geodata-bind"
        ) {
            return Ok(None);
        }
        let mut options = BTreeMap::new();
        let mut remaining = arguments[1..].iter();
        while let Some(name) = remaining.next() {
            let allowed = matches!(
                name.as_str(),
                "--full-geodata-source-policy" | "--full-geodata-source-policy-sha256"
            ) || (matches!(mode, "full-geodata-backup" | "full-geodata-bind")
                && name == "--server-config")
                || (matches!(mode, "full-geodata-verify" | "full-geodata-restore")
                    && name == "--bundle")
                || (matches!(
                    mode,
                    "full-geodata-backup" | "full-geodata-restore" | "full-geodata-copy"
                ) && name == "--destination")
                || (mode == "full-geodata-copy"
                    && matches!(
                        name.as_str(),
                        "--source-atlas" | "--source-atlas-sha256" | "--source-vault"
                    ));
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
            "full-geodata-backup" | "full-geodata-bind" => {
                let config_path = path("--server-config")?;
                let config_bytes = read_selected_file(&config_path, 64 * 1024, true)?;
                let config: ServerConfig = serde_json::from_slice(&config_bytes)
                    .map_err(|_| "Invalid full geodata backup server configuration")?;
                config.validate()?;
                if mode == "full-geodata-bind" {
                    Operation::Bind {
                        config: Box::new(config),
                        config_path,
                        config_bytes,
                    }
                } else {
                    Operation::Capture {
                        config: Box::new(config),
                        config_path,
                        config_bytes,
                        destination: path("--destination")?,
                    }
                }
            }
            "full-geodata-verify" => Operation::Verify {
                bundle: path("--bundle")?,
            },
            "full-geodata-restore" => Operation::Restore {
                bundle: path("--bundle")?,
                destination: path("--destination")?,
            },
            _ => {
                let source_sha256 = options
                    .get("--source-atlas-sha256")
                    .ok_or("Required expected source Atlas SHA-256")?
                    .to_string();
                if source_sha256.len() != 64
                    || !source_sha256
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err("Expected source Atlas digest must be lowercase SHA-256".into());
                }
                Operation::Copy {
                    source: path("--source-atlas")?,
                    source_sha256,
                    source_vault: path("--source-vault")?,
                    destination: path("--destination")?,
                }
            }
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
    #[serde(flatten)]
    details: ReportDetails,
}

#[derive(Serialize)]
#[serde(untagged, rename_all = "camelCase")]
enum ReportDetails {
    Recovery {
        #[serde(rename = "databaseSha256")]
        database_sha256: String,
        #[serde(rename = "databaseBytes")]
        database_bytes: u64,
        #[serde(rename = "assetRecordCount")]
        asset_record_count: usize,
        #[serde(rename = "retainedAssetCount")]
        retained_asset_count: usize,
        #[serde(rename = "conversionReceiptSha256")]
        conversion_receipt_sha256: String,
        #[serde(
            rename = "sourceDatabaseSha256",
            skip_serializing_if = "Option::is_none"
        )]
        source_database_sha256: Option<String>,
        #[serde(
            rename = "sourceDatabaseBytes",
            skip_serializing_if = "Option::is_none"
        )]
        source_database_bytes: Option<u64>,
    },
    Copy {
        #[serde(rename = "copyReport")]
        copy_report: storage::geodata_full::FullProfileCopyReport,
    },
    Bound {
        binding: &'static str,
    },
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
    let (operation, bundle, source_pin) = match selection.operation {
        Operation::Copy {
            source,
            source_sha256,
            source_vault,
            destination,
        } => {
            let policy = selection.policy.into_offline_policy()?;
            persistent::private_directory(&source_vault)?;
            require_destination(
                &destination,
                &[&source, &source_vault, &selection.policy_path],
            )?;
            let owners = offline_owners(&source_vault, policy)?;
            let copy_report = storage::geodata_full::copy_v5_to_full(
                &source,
                &destination,
                &source_sha256,
                &NativeContracts,
                &peers,
                &owners,
                &mut || progress(&budget),
            )?;
            progress(&budget)?;
            return Ok(Report {
                format: "houseatlas-full-geodata-offline-report/1",
                profile: PROFILE,
                operation: "copy",
                details: ReportDetails::Copy { copy_report },
            });
        }
        Operation::Bind {
            config,
            config_path,
            config_bytes,
        } => {
            let policy = selection.policy.into_policy(&config)?;
            if read_selected_file(&config_path, 64 * 1024, true)? != config_bytes {
                return Err("Full geodata bind configuration changed".into());
            }
            persistent::bind_full_geodata(&config, policy)?;
            if read_selected_file(&config_path, 64 * 1024, true)? != config_bytes {
                return Err(
                    "Full geodata bind configuration changed after receipt creation".into(),
                );
            }
            progress(&budget)?;
            return Ok(Report {
                format: "houseatlas-full-geodata-offline-report/1",
                profile: PROFILE,
                operation: "bind",
                details: ReportDetails::Bound {
                    binding: "full-geodata-state-receipt-created",
                },
            });
        }
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
            ("capture", manifest, Some((atlas.sha256(), atlas.bytes())))
        }
        operation => {
            let policy = selection.policy.into_offline_policy()?;
            let (bundle, destination) = match operation {
                Operation::Verify { bundle } => (bundle, None),
                Operation::Restore {
                    bundle,
                    destination,
                } => (bundle, Some(destination)),
                Operation::Capture { .. } | Operation::Copy { .. } | Operation::Bind { .. } => {
                    unreachable!()
                }
            };
            persistent::private_directory(&bundle)?;
            let owners = offline_owners(&bundle.join("media"), policy)?;
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
                ("restore", manifest, None)
            } else {
                let manifest = Store::verify_full_geodata_recovery(
                    &bundle,
                    &NativeContracts,
                    &peers,
                    &owners,
                    &mut || progress(&budget),
                )?;
                ("verify", manifest, None)
            }
        }
    };
    progress(&budget)?;
    let (source_database_sha256, source_database_bytes) = match source_pin {
        Some((sha256, bytes)) => (Some(sha256), Some(bytes)),
        None => (None, None),
    };
    Ok(Report {
        format: "houseatlas-full-geodata-offline-report/1",
        profile: PROFILE,
        operation,
        details: ReportDetails::Recovery {
            database_sha256: bundle.database_sha256,
            database_bytes: bundle.database_bytes,
            asset_record_count: bundle.assets.len(),
            retained_asset_count: bundle.retained_assets.len(),
            conversion_receipt_sha256: bundle.conversion_receipt_sha256,
            source_database_sha256,
            source_database_bytes,
        },
    })
}

fn offline_owners(
    vault_path: &Path,
    policy: Arc<dyn storage::geodata::GeodataSourcePolicy>,
) -> Result<GeodataOwners, Failure> {
    let access = Arc::new(Mutex::new(access::AccessBoundary::in_memory(
        access::AccessConfig::new(vec!["https://offline.invalid".into()])?,
    )?));
    let vault = Arc::new(AssetVault::open_existing(vault_path)?);
    Ok(GeodataOwners::new(access, vault, policy))
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
