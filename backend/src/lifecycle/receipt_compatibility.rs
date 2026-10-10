//! Explicit offline metadata upgrade and conservative pre-cutover rollback.
//! No serving fallback, database adoption, grants, provisioning, session/epoch
//! rotation or SQL writes. A rollback restores metadata for the old binary only;
//! it does not certify application/data compatibility after pilot writes.
use super::{
    Failure,
    persistent::{self, ServerLease, State},
};
use crate::config::server::{ServerConfig, absolute_path, read_selected_file};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const RECEIPT: &str = "server-state.json";
const PENDING: &str = "server-state.receipt-compatibility.pending";
const NEXT: &str = "server-state.receipt-compatibility.next";
const RECEIPT_LIMIT: u64 = 16 * 1024;
const DATABASE_LIMIT: u64 = 256 * 1024 * 1024;

/// Every invocation independently selects the exact private config and current
/// receipt bytes. Rollback additionally selects the original legacy receipt.
pub struct Selection {
    config_path: PathBuf,
    config_sha256: String,
    receipt_sha256: String,
    legacy_receipt_sha256: Option<String>,
}
impl Selection {
    pub fn new(
        config_path: PathBuf,
        config_sha256: String,
        receipt_sha256: String,
        legacy_receipt_sha256: Option<String>,
    ) -> Result<Self, String> {
        absolute_path(&config_path)?;
        for digest in [&config_sha256, &receipt_sha256]
            .into_iter()
            .chain(legacy_receipt_sha256.as_ref())
        {
            if digest.len() != 64
                || !digest
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("Receipt selection requires exact lowercase SHA256 values".into());
            }
        }
        Ok(Self {
            config_path,
            config_sha256,
            receipt_sha256,
            legacy_receipt_sha256,
        })
    }

    pub(crate) fn from_arguments(arguments: &[String], rollback: bool) -> Result<Self, String> {
        let mut options = BTreeMap::new();
        let mut remaining = arguments.iter();
        while let Some(name) = remaining.next() {
            if !matches!(
                name.as_str(),
                "--server-config" | "--expected-config-sha256" | "--expected-receipt-sha256"
            ) && !(rollback && name == "--expected-legacy-receipt-sha256")
            {
                return Err("Unsupported offline receipt option".into());
            }
            if options
                .insert(
                    name.as_str(),
                    remaining.next().ok_or("Missing receipt option value")?,
                )
                .is_some()
            {
                return Err("Repeated offline receipt option".into());
            }
        }
        let required = |name| {
            options
                .get(name)
                .map(|value| (*value).clone())
                .ok_or_else(|| format!("Required {name}"))
        };
        Self::new(
            PathBuf::from(required("--server-config")?),
            required("--expected-config-sha256")?,
            required("--expected-receipt-sha256")?,
            if rollback {
                Some(required("--expected-legacy-receipt-sha256")?)
            } else {
                None
            },
        )
    }

    fn config(&self) -> Result<ServerConfig, Failure> {
        let bytes = read_selected_file(&self.config_path, 64 * 1024, true)?;
        if sha256(&bytes) != self.config_sha256 {
            return Err("Selected configuration SHA256 changed".into());
        }
        let config: ServerConfig =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid selected server configuration")?;
        config.validate()?;
        Ok(config)
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileCut {
    name: String,
    device: u64,
    inode: u64,
    bytes: u64,
    sha256: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectoryCut {
    name: String,
    device: u64,
    inode: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Compatibility {
    format: String,
    configuration_sha256: String,
    legacy_receipt_sha256: String,
    upgraded_receipt_sha256: String,
    databases: Vec<FileCut>,
    media_directories: Vec<DirectoryCut>,
}

/// Fixed report fields contain only receipt hashes and derived local filenames.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    operation: &'static str,
    outcome: &'static str,
    receipt_sha256: String,
    legacy_backup: String,
    compatibility_record: String,
    rollback_scope: &'static str,
}

pub(crate) fn require_no_pending(config: &ServerConfig) -> Result<(), Failure> {
    for name in [PENDING, NEXT] {
        require_absent(&config.data_directory.join(name))?;
    }
    Ok(())
}
fn require_absent(path: &Path) -> Result<(), Failure> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err("Incomplete receipt compatibility requires offline review; no automatic adoption or retry".into()),
        Err(error) => Err(error.into()),
    }
}
fn names(legacy: &str) -> (String, String) {
    (
        format!("server-state.legacy.{legacy}.json"),
        format!("server-state.compatibility.{legacy}.json"),
    )
}
fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn selected_receipt(config: &ServerConfig, expected: &str) -> Result<(Vec<u8>, State), Failure> {
    let bytes = read_selected_file(&config.data_directory.join(RECEIPT), RECEIPT_LIMIT, true)?;
    if sha256(&bytes) != expected {
        return Err("Selected state receipt SHA256 changed".into());
    }
    let state =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid exact persistent state receipt")?;
    Ok((bytes, state))
}

fn validate(
    config: &ServerConfig,
    state: &State,
    digest: &str,
    lease: &ServerLease,
) -> Result<(), Failure> {
    lease.check()?;
    require_no_pending(config)?;
    require_absent(&config.data_directory.join("server-state.rebind.pending"))?;
    let access_path = config.data_directory.join("access.sqlite");
    let atlas_path = config.data_directory.join("atlas.sqlite");
    let access = persistent::private_metadata(&access_path)?;
    let atlas = persistent::private_metadata(&atlas_path)?;
    if state
        != &(State {
            format: "houseatlas-persistent-server/1".into(),
            configuration_digest: digest.into(),
            atlas_schema: crate::storage::DATABASE_VERSION,
            access_schema: crate::access::ACCESS_SCHEMA_VERSION,
            access_device: access.dev(),
            access_inode: access.ino(),
            atlas_device: atlas.dev(),
            atlas_inode: atlas.ino(),
        })
    {
        return Err(
            "Original deployment, schema or native database identity does not match".into(),
        );
    }
    database_cut(config)?;
    media_cut(config)?;
    // Actual Access owner validates its compiled schema/opaque epoch and exact
    // selected local identity using SELECTs only. No authentication is performed.
    let mut access =
        crate::access::AccessBoundary::open_existing(&access_path, config.access_config()?)?;
    if !config.authentication.is_password() {
        access.validate_loopback_local_user()?;
    }
    drop(access);
    crate::storage::validate_existing_receipt_schema(&atlas_path)?;
    lease.check()
}

fn database_cut(config: &ServerConfig) -> Result<Vec<FileCut>, Failure> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut result = Vec::new();
    for database in ["access.sqlite", "atlas.sqlite"] {
        result.push(file_cut(&config.data_directory, database, deadline)?);
        for suffix in ["-wal", "-shm", "-journal"] {
            let name = format!("{database}{suffix}");
            let path = config.data_directory.join(&name);
            match fs::symlink_metadata(path) {
                Ok(_) => result.push(file_cut(&config.data_directory, &name, deadline)?),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(result)
}
fn file_cut(root: &Path, name: &str, deadline: Instant) -> Result<FileCut, Failure> {
    let path = root.join(name);
    let before = persistent::private_metadata(&path)?;
    if before.len() > DATABASE_LIMIT {
        return Err("Receipt compatibility database size exceeds bounded selection".into());
    }
    let mut file = File::from(rustix::fs::open(
        &path,
        rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    )?);
    let opened = file.metadata()?;
    if opened.dev() != before.dev() || opened.ino() != before.ino() {
        return Err("Native file changed during compatibility capture".into());
    }
    let mut digest = Sha256::new();
    let mut size = 0_u64;
    let mut chunk = [0_u8; 64 * 1024];
    loop {
        if Instant::now() >= deadline {
            return Err("Receipt compatibility capture deadline exceeded".into());
        }
        let count = file.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > DATABASE_LIMIT {
            return Err("Native file changed during compatibility capture".into());
        }
        digest.update(&chunk[..count]);
    }
    let after = persistent::private_metadata(&path)?;
    let handle = file.metadata()?;
    if size != before.len()
        || after.dev() != before.dev()
        || after.ino() != before.ino()
        || handle.dev() != before.dev()
        || handle.ino() != before.ino()
        || after.len() != before.len()
        || after.mtime() != before.mtime()
        || after.mtime_nsec() != before.mtime_nsec()
        || after.ctime() != before.ctime()
        || after.ctime_nsec() != before.ctime_nsec()
    {
        return Err("Native file changed during compatibility capture".into());
    }
    Ok(FileCut {
        name: name.into(),
        device: before.dev(),
        inode: before.ino(),
        bytes: size,
        sha256: format!("{:x}", digest.finalize()),
    })
}
fn media_cut(config: &ServerConfig) -> Result<Vec<DirectoryCut>, Failure> {
    ["media", "media/blobs", "media/staging"]
        .into_iter()
        .map(|name| {
            let file = persistent::private_directory(&config.data_directory.join(name))?;
            let metadata = file.metadata()?;
            Ok(DirectoryCut {
                name: name.into(),
                device: metadata.dev(),
                inode: metadata.ino(),
            })
        })
        .collect()
}

fn create_durable(
    config: &ServerConfig,
    name: &str,
    bytes: &[u8],
    lease: &ServerLease,
) -> Result<(), Failure> {
    lease.check()?;
    let mut file = persistent::open_private(&config.data_directory.join(name), true, false)?;
    file.write_all(bytes)?;
    persistent::sync(&file)?;
    persistent::sync(&lease.directory)?;
    if read_selected_file(&config.data_directory.join(name), RECEIPT_LIMIT, true)? != bytes {
        return Err("Receipt compatibility private output changed".into());
    }
    lease.check()
}

fn publish(
    selection: &Selection,
    config: &ServerConfig,
    original: &[u8],
    bytes: &[u8],
    cut: &Compatibility,
    lease: &ServerLease,
) -> Result<(), Failure> {
    // All failures after this point preserve exact owned partial artifacts. No
    // cleanup/retry can mistake a renamed receipt for an uncommitted operation.
    let operation = (|| -> Result<(), Failure> {
        create_durable(
            config,
            PENDING,
            b"houseatlas-offline-receipt-compatibility/1\n",
            lease,
        )?;
        create_durable(config, NEXT, bytes, lease)?;
        selection.config()?;
        lease.check()?;
        if read_selected_file(&config.data_directory.join(RECEIPT), RECEIPT_LIMIT, true)?
            != original
            || database_cut(config)? != cut.databases
            || media_cut(config)? != cut.media_directories
        {
            return Err("Selected files changed before receipt publication".into());
        }
        let pending = persistent::private_metadata(&config.data_directory.join(NEXT))?;
        if read_selected_file(&config.data_directory.join(NEXT), RECEIPT_LIMIT, true)? != bytes {
            return Err("Staged compatibility receipt changed".into());
        }
        let named = persistent::private_metadata(&config.data_directory.join(NEXT))?;
        if pending.dev() != named.dev() || pending.ino() != named.ino() {
            return Err("Staged compatibility identity changed".into());
        }
        fs::rename(
            config.data_directory.join(NEXT),
            config.data_directory.join(RECEIPT),
        )?;
        persistent::sync(&lease.directory)?;
        lease.check()?;
        if read_selected_file(&config.data_directory.join(RECEIPT), RECEIPT_LIMIT, true)? != bytes
            || database_cut(config)? != cut.databases
            || media_cut(config)? != cut.media_directories
        {
            return Err("Selected files changed after receipt publication".into());
        }
        fs::remove_file(config.data_directory.join(PENDING))?;
        persistent::sync(&lease.directory)?;
        lease.check()
    })();
    operation.map_err(|error| format!("Offline receipt outcome incomplete; receipt may have changed. Preserve compatibility artifacts and review before serving or retrying: {error}").into())
}

/// Upgrade only the digest field after matching the actual legacy issuer. The
/// expected full config SHA independently selects listener/MCP policy omitted
/// by v1. Original bytes and metadata are durably retained before publication.
pub fn upgrade(selection: &Selection) -> Result<Report, Failure> {
    if selection.legacy_receipt_sha256.is_some() {
        return Err("Upgrade selects only the current legacy receipt".into());
    }
    let config = selection.config()?;
    let lease = ServerLease::acquire(&config, false)?;
    let (original, mut state) = selected_receipt(&config, &selection.receipt_sha256)?;
    validate(&config, &state, &config.legacy_state_digest()?, &lease)?;
    let legacy = sha256(&original);
    let (backup, record) = names(&legacy);
    require_absent(&config.data_directory.join(&backup))?;
    require_absent(&config.data_directory.join(&record))?;
    state.configuration_digest = config.state_digest()?;
    let bytes = serde_json::to_vec(&state)?;
    let cut = Compatibility {
        format: "houseatlas-receipt-compatibility/1".into(),
        configuration_sha256: selection.config_sha256.clone(),
        legacy_receipt_sha256: legacy,
        upgraded_receipt_sha256: sha256(&bytes),
        databases: database_cut(&config)?,
        media_directories: media_cut(&config)?,
    };
    // A partial backup/record before staging does not change the old receipt,
    // but still requires review rather than an automatic create/overwrite retry.
    create_durable(&config, &backup, &original, &lease).map_err(|error| format!("Legacy backup outcome incomplete; original receipt not published. Preserve artifacts: {error}"))?;
    create_durable(&config, &record, &serde_json::to_vec(&cut)?, &lease).map_err(|error| format!("Compatibility record outcome incomplete; original receipt not published. Preserve artifacts: {error}"))?;
    publish(selection, &config, &original, &bytes, &cut, &lease)?;
    Ok(Report {
        operation: "upgrade-state-receipt",
        outcome: "durable-metadata-only",
        receipt_sha256: sha256(&bytes),
        legacy_backup: backup,
        compatibility_record: record,
        rollback_scope: "pre-cutover unchanged physical database files only; no application/data rollback acceptance",
    })
}

/// Conservative metadata rollback: physical DB/sidecar bytes and identities must
/// equal the upgrade cut. Even reads/checkpoints/authentication can change these
/// bytes and cause refusal. No records are removed, rewritten or adopted.
pub fn rollback(selection: &Selection) -> Result<Report, Failure> {
    let legacy = selection
        .legacy_receipt_sha256
        .as_ref()
        .ok_or("Rollback requires exact original legacy receipt SHA256")?;
    let config = selection.config()?;
    let lease = ServerLease::acquire(&config, false)?;
    let (current, state) = selected_receipt(&config, &selection.receipt_sha256)?;
    validate(&config, &state, &config.state_digest()?, &lease)?;
    let (backup, record) = names(legacy);
    let original = read_selected_file(&config.data_directory.join(&backup), RECEIPT_LIMIT, true)?;
    if sha256(&original) != *legacy {
        return Err("Legacy backup SHA256 changed".into());
    }
    let old: State =
        serde_json::from_slice(&original).map_err(|_| "Invalid exact legacy backup")?;
    validate(&config, &old, &config.legacy_state_digest()?, &lease)?;
    let mut expected_old = state.clone();
    expected_old.configuration_digest = config.legacy_state_digest()?;
    if old != expected_old {
        return Err("Legacy backup differs beyond its original digest".into());
    }
    let cut: Compatibility = serde_json::from_slice(&read_selected_file(
        &config.data_directory.join(&record),
        RECEIPT_LIMIT,
        true,
    )?)
    .map_err(|_| "Invalid exact compatibility record")?;
    if cut.format != "houseatlas-receipt-compatibility/1"
        || cut.configuration_sha256 != selection.config_sha256
        || cut.legacy_receipt_sha256 != *legacy
        || cut.upgraded_receipt_sha256 != sha256(&current)
        || cut.databases != database_cut(&config)?
        || cut.media_directories != media_cut(&config)?
    {
        return Err(
            "Compatibility cut changed; post-cutover data rollback is not supported".into(),
        );
    }
    publish(selection, &config, &current, &original, &cut, &lease)?;
    Ok(Report {
        operation: "rollback-state-receipt",
        outcome: "durable-metadata-only",
        receipt_sha256: legacy.clone(),
        legacy_backup: backup,
        compatibility_record: record,
        rollback_scope: "original legacy binary only; new serving still refuses this legacy receipt",
    })
}
