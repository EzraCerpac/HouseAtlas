//! Exact old issuer -> explicit new metadata -> exact legacy-byte rollback.
//! Two fresh synthetic states, no listener, real accounts, providers or imports.
//! The separately built/pinned original binary only performs fresh initialize.
use houseatlas_backend::{
    config::server::{ServerCommand, ServerConfig},
    lifecycle::{
        Failure, persistent,
        receipt_compatibility::{self, Selection},
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn legacy_binary() -> Result<PathBuf, Failure> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 4
        || args[0] != "--legacy-binary"
        || args[2] != "--expected-legacy-binary-sha256"
    {
        return Err("Required exact --legacy-binary and --expected-legacy-binary-sha256".into());
    }
    let path = PathBuf::from(&args[1]);
    if !path.is_absolute() || fs::canonicalize(&path)? != path {
        return Err("Legacy binary must be an exact canonical local path".into());
    }
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o022 != 0
        || metadata.len() > 512 * 1024 * 1024
    {
        return Err("Unsupported selected legacy binary".into());
    }
    let mut file = File::open(&path)?;
    let mut digest = Sha256::new();
    let mut chunk = [0_u8; 64 * 1024];
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if Instant::now() >= deadline {
            return Err("Selected binary hashing deadline exceeded".into());
        }
        let count = file.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        digest.update(&chunk[..count]);
    }
    if format!("{:x}", digest.finalize()) != args[3] {
        return Err("Legacy binary SHA256 mismatch".into());
    }
    Ok(path)
}

struct LegacyInitializer(Child);
impl Drop for LegacyInitializer {
    fn drop(&mut self) {
        // The initializer has no child-process launch path. Always reap this
        // exact owned child, including when polling or the deadline fails.
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn initialize_legacy(binary: &Path, path: &Path, root: &Path) -> Result<(), Failure> {
    let mut child = LegacyInitializer(
        Command::new(binary)
            .args(["initialize", "--server-config"])
            .arg(path)
            .env_clear()
            .env("TMPDIR", root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child.0.try_wait()? {
            return if status.success() {
                Ok(())
            } else {
                Err("Pinned legacy fresh synthetic initializer failed".into())
            };
        }
        if Instant::now() >= deadline {
            return Err("Pinned legacy fresh synthetic initializer exceeded 30 seconds".into());
        }
        thread::sleep(Duration::from_millis(25));
    }
}
fn fresh(
    root: &Path,
    leaf: &str,
    binary: &Path,
) -> Result<(PathBuf, ServerConfig, Vec<u8>), Failure> {
    let data = root.join(leaf);
    let config: ServerConfig = serde_json::from_value(json!({
        "schemaVersion":1,"deploymentId":id(1),"dataDirectory":data,"logDirectory":data.join("logs"),
        "frontendDirectory":root.join("unused-frontend"),"tlsCertificate":root.join("unused-certificate.pem"),
        "tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":"https://houseatlas.synthetic.ts.net",
        "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic receipt home"}],"mcpCommands":"read-only",
        "authentication":{"mode":"trusted-proxy","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-receipt",
            "scope":{"workspaceId":id(2),"homeId":id(3)}},"policy":{"userLogin":"synthetic@receipt","nodeTag":"tag:synthetic",
            "peerUid":rustix::process::geteuid().as_raw()},"socket":data.join("gateway.sock")}
    }))?;
    let path = root.join(format!("{leaf}.config.json"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;
    file.write_all(&serde_json::to_vec(&config)?)?;
    file.sync_all()?;
    initialize_legacy(binary, &path, root)?;
    let original = fs::read(data.join("server-state.json"))?;
    let wire: Value = serde_json::from_slice(&original)?;
    assert_eq!(wire["format"], "houseatlas-persistent-server/1");
    assert_ne!(wire["configurationDigest"], config.state_digest()?);
    Ok((path, config, original))
}
fn fingerprints(config: &ServerConfig) -> Result<Vec<(String, u64, u64, String)>, Failure> {
    let mut values = Vec::new();
    for name in ["access.sqlite", "atlas.sqlite"] {
        let path = config.data_directory.join(name);
        let metadata = fs::metadata(&path)?;
        values.push((
            name.into(),
            metadata.dev(),
            metadata.ino(),
            sha256(&fs::read(path)?),
        ));
    }
    Ok(values)
}
fn selection(
    config_path: &Path,
    receipt: &[u8],
    legacy: Option<&[u8]>,
) -> Result<Selection, Failure> {
    Ok(Selection::new(
        config_path.into(),
        sha256(&fs::read(config_path)?),
        sha256(receipt),
        legacy.map(sha256),
    )?)
}
fn unchanged_authority(config: &ServerConfig) -> Result<(), Failure> {
    let db = rusqlite::Connection::open_with_flags(
        config.data_directory.join("access.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    db.pragma_update(None, "query_only", true)?;
    let counts: (i64, i64, i64, i64) = db.query_row(
        "SELECT (SELECT count(*) FROM access_users),(SELECT count(*) FROM access_memberships),(SELECT count(*) FROM access_sessions),(SELECT count(*) FROM access_sources)", [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?;
    assert_eq!(counts, (1, 1, 0, 0));
    db.close().map_err(|(_, error)| error)?;
    Ok(())
}
fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    let binary = legacy_binary()?;
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let (path, config, original) = fresh(&root, "rollback-state", &binary)?;
    let original_files = fingerprints(&config)?;
    // This targeted refusal is the required strict-serving compatibility seam,
    // not an adversarial, replay, expiry or mutation/omission control suite.
    assert!(persistent::reopen(&config).is_err());
    let upgrade = selection(&path, &original, None)?;
    let report = receipt_compatibility::upgrade(&upgrade)?;
    let current = fs::read(config.data_directory.join("server-state.json"))?;
    let mut expected: Value = serde_json::from_slice(&original)?;
    expected["configurationDigest"] = json!(config.state_digest()?);
    assert_eq!(serde_json::from_slice::<Value>(&current)?, expected);
    assert_eq!(fingerprints(&config)?, original_files);
    let upgraded_report = serde_json::to_value(report)?;
    assert_eq!(
        fs::read(
            config
                .data_directory
                .join(upgraded_report["legacyBackup"].as_str().unwrap())
        )?,
        original
    );
    let rollback = selection(&path, &current, Some(&original))?;
    receipt_compatibility::rollback(&rollback)?;
    assert_eq!(
        fs::read(config.data_directory.join("server-state.json"))?,
        original
    );
    assert_eq!(fingerprints(&config)?, original_files);
    assert!(persistent::reopen(&config).is_err());
    unchanged_authority(&config)?;
    // A separate independently issued synthetic state checks new strict reopen.
    // We claim no rollback after SQLite reads/checkpoints/authentication/writes.
    let (path, config, original) = fresh(&root, "new-reopen-state", &binary)?;
    let before = fingerprints(&config)?;
    receipt_compatibility::upgrade(&selection(&path, &original, None)?)?;
    let (core, lease) = persistent::reopen(&config)?;
    assert_eq!(
        core.store
            .lock()
            .map_err(|_| "Synthetic store unavailable")?
            .database_version(),
        5
    );
    drop(core);
    drop(lease);
    for (name, device, inode, _) in before {
        let metadata = fs::metadata(config.data_directory.join(name))?;
        assert_eq!((metadata.dev(), metadata.ino()), (device, inode));
    }
    unchanged_authority(&config)?;
    let args = vec![
        "rollback-state-receipt".into(),
        "--server-config".into(),
        path.to_string_lossy().into_owned(),
        "--expected-config-sha256".into(),
        sha256(&fs::read(&path)?),
        "--expected-receipt-sha256".into(),
        sha256(&fs::read(config.data_directory.join("server-state.json"))?),
        "--expected-legacy-receipt-sha256".into(),
        sha256(&original),
    ];
    assert!(matches!(
        ServerCommand::from_arguments(&args)?,
        Some(ServerCommand::RollbackStateReceipt(_))
    ));
    drop(temporary);
    println!(
        "{{\"synthetic\":true,\"legacyOriginalIssuer\":true,\"exactMetadataUpgradeAndRollback\":true,\"newStrictReopen\":true,\"noListener\":true,\"noDataRollbackAcceptance\":true}}"
    );
    Ok(())
}
