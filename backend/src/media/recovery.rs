//! Offline trusted administration only, never a domain/HTTP/browser command.
//! Storage supplies coherent SQLite backup and authoritative DB validation.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rustix::fs::Mode;
use serde::{Deserialize, Serialize};

use super::private_fs::{PrivateDir, destination_parent};
use super::types::{
    AssetOwner, AssetPayload, AssetPurpose, AssetRecord, Availability, Lifecycle, PreviewPolicy,
    SourceLicense, sha256,
};
use super::{AssetVault, MAX_BYTES, MediaError, MediaResult, WorkBudget};

pub const CONTRACT_VERSION: &str = "1.0.0";
pub const DATABASE_SCHEMA: u32 = 3;
pub const MAX_DATABASE: usize = 64 * 1024 * 1024;
pub const MAX_MANIFEST: usize = 16 * 1024 * 1024;
pub const MAX_TOTAL: usize = 256 * 1024 * 1024;
pub const MAX_ASSETS: usize = 10_000;
const FORMAT: &str = "houseatlas-owned-recovery/1";
const CAPTURE_METHOD: &str = "sqlite-backup-and-retained-immutable-originals";
const EXCLUSIONS: [&str; 5] = [
    "HomeBox originals",
    "access database and sessions",
    "credentials",
    "server configuration",
    "Network source state",
];

/// The peer must check ACTUAL stored contract/schema/migration SQL hashes,
/// integrity/foreign keys, the frozen snapshot graph and exact one-to-one asset
/// manifest agreement. Reading assets alone does not implement this port.
pub trait RecoveryDatabasePort {
    /// Use SQLite's backup API, normalize the closed copied DB to standalone
    /// DELETE journal mode, and leave one private regular file at destination.
    /// Do not hash/copy a hot raw SQLite file as a substitute for backup.
    fn backup_to(&self, destination: &Path, budget: &WorkBudget) -> MediaResult<()>;

    fn validate_recovery_database(
        &self,
        database: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<ValidatedDatabase>;
}

pub struct ValidatedDatabase {
    pub contract_version: String,
    pub database_schema: u32,
    pub assets: Vec<AssetRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseMember {
    pub file: String,
    pub sha256: String,
    pub byte_size: u64,
}

/// Explicit public field names rather than serde(flatten), so unknown or
/// duplicate manifest fields cannot disappear during deserialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryAsset {
    pub workspace_id: String,
    pub home_id: String,
    pub asset_id: String,
    pub revision: u64,
    pub lifecycle: Lifecycle,
    pub owner: AssetOwner,
    pub purpose: AssetPurpose,
    pub storage_key: String,
    pub sha256: String,
    pub byte_size: u64,
    pub content_type: String,
    pub source_license: SourceLicense,
    pub availability: Availability,
    pub preview_policy: PreviewPolicy,
    pub evidence_ids: Vec<String>,
    #[serde(deserialize_with = "super::types::required_nullable")]
    pub blob: Option<String>,
}

impl RecoveryAsset {
    fn from_record(record: &AssetRecord, blob: Option<String>) -> Self {
        let AssetPayload {
            owner,
            purpose,
            storage_key,
            sha256,
            byte_size,
            content_type,
            source_license,
            availability,
            preview_policy,
            evidence_ids,
        } = &record.payload;
        Self {
            workspace_id: record.workspace_id.clone(),
            home_id: record.home_id.clone(),
            asset_id: record.record_id.clone(),
            revision: record.revision,
            lifecycle: record.lifecycle,
            owner: *owner,
            purpose: *purpose,
            storage_key: storage_key.clone(),
            sha256: sha256.clone(),
            byte_size: *byte_size,
            content_type: content_type.clone(),
            source_license: source_license.clone(),
            availability: *availability,
            preview_policy: *preview_policy,
            evidence_ids: evidence_ids.clone(),
            blob,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryManifest {
    pub format: String,
    pub contract_version: String,
    pub database_schema: u32,
    pub database: DatabaseMember,
    pub assets: Vec<RecoveryAsset>,
    pub exclusions: Vec<String>,
    pub capture_method: String,
}

pub struct VerifiedRecovery {
    pub manifest: RecoveryManifest,
    pub assets: Vec<AssetRecord>,
}

pub struct RestoredRecovery {
    pub database_path: PathBuf,
    pub vault_root: PathBuf,
    pub manifest: RecoveryManifest,
}

fn database_assets<P: RecoveryDatabasePort>(
    port: &P,
    bundle: &PrivateDir,
    budget: &WorkBudget,
) -> MediaResult<(Vec<AssetRecord>, Vec<u8>)> {
    let bytes = bundle.read("atlas.sqlite", MAX_DATABASE, budget)?;
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err(MediaError::Unavailable);
    }
    let validated = port.validate_recovery_database(&bundle.path.join("atlas.sqlite"), budget)?;
    bundle.check()?;
    // Bind the storage validation to the same closed image hashed by media.
    if bundle.read("atlas.sqlite", MAX_DATABASE, budget)? != bytes {
        return Err(MediaError::Unavailable);
    }
    if validated.contract_version != CONTRACT_VERSION
        || validated.database_schema != DATABASE_SCHEMA
    {
        return Err(MediaError::Unavailable);
    }
    if validated.assets.len() > MAX_ASSETS {
        return Err(MediaError::TooLarge);
    }
    let mut assets = validated.assets;
    let mut identities = BTreeSet::new();
    for record in &assets {
        budget.check()?;
        record.validate()?;
        if !identities.insert((record.workspace_id.clone(), record.record_id.clone())) {
            return Err(MediaError::Unavailable);
        }
    }
    assets.sort_by(|a, b| {
        (&a.workspace_id, &a.home_id, &a.record_id).cmp(&(
            &b.workspace_id,
            &b.home_id,
            &b.record_id,
        ))
    });
    Ok((assets, bytes))
}

pub fn capture_recovery<P: RecoveryDatabasePort>(
    port: &P,
    vault: &AssetVault,
    destination: &Path,
    budget: &WorkBudget,
) -> MediaResult<RecoveryManifest> {
    budget.check()?;
    let (parent, name) = destination_parent(destination)?;
    let staged = parent.temporary(".atlas-capture-")?;
    port.backup_to(&staged.directory.path.join("atlas.sqlite"), budget)?;
    staged.directory.check()?;
    staged.directory.sync_member("atlas.sqlite")?;
    let (assets, database) = database_assets(port, &staged.directory, budget)?;
    let originals = staged.directory.child("originals", true)?;
    let mut total = database.len();
    let mut entries = Vec::with_capacity(assets.len());
    for (index, record) in assets.iter().enumerate() {
        budget.check()?;
        let payload = &record.payload;
        let has_owned_key = payload.storage_key == record.scope().storage_key(&payload.sha256)?;
        let original = if payload.availability == Availability::Available || has_owned_key {
            match vault.read_retained(record, budget) {
                Ok(bytes) => Some(bytes),
                Err(MediaError::NotFound) if payload.availability == Availability::Missing => None,
                Err(e) => return Err(e),
            }
        } else {
            None
        };
        let blob = if let Some(bytes) = original {
            add_total(&mut total, bytes.len())?;
            let member = format!("{index}.blob");
            originals.write_new(&member, &bytes, Mode::from_raw_mode(0o400))?;
            Some(member)
        } else {
            None
        };
        entries.push(RecoveryAsset::from_record(record, blob));
    }
    let manifest = RecoveryManifest {
        format: FORMAT.to_owned(),
        contract_version: CONTRACT_VERSION.to_owned(),
        database_schema: DATABASE_SCHEMA,
        database: DatabaseMember {
            file: "atlas.sqlite".to_owned(),
            sha256: sha256(&database),
            byte_size: database.len() as u64,
        },
        assets: entries,
        exclusions: EXCLUSIONS.iter().map(|s| (*s).to_owned()).collect(),
        capture_method: CAPTURE_METHOD.to_owned(),
    };
    // This wire format has no canonical-manifest digest requirement. Scope keys
    // remain exactly canonical; database and original digests cover raw bytes.
    let json = serde_json::to_vec(&manifest).map_err(|_| MediaError::Unavailable)?;
    if json.len() > MAX_MANIFEST {
        return Err(MediaError::TooLarge);
    }
    staged
        .directory
        .write_new("manifest.json", &json, Mode::from_raw_mode(0o600))?;
    originals.sync()?;
    staged.directory.sync()?;
    verify_directory(port, &staged.directory, budget)?;
    budget.check()?;
    staged.publish(&name)?;
    Ok(manifest)
}

pub fn verify_recovery<P: RecoveryDatabasePort>(
    port: &P,
    bundle: &Path,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    let bundle = PrivateDir::open(bundle, false)?;
    verify_directory(port, &bundle, budget)
}

fn verify_directory<P: RecoveryDatabasePort>(
    port: &P,
    bundle: &PrivateDir,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    budget.check()?;
    let manifest: RecoveryManifest =
        serde_json::from_slice(&bundle.read("manifest.json", MAX_MANIFEST, budget)?)
            .map_err(|_| MediaError::Unavailable)?;
    if manifest.format != FORMAT
        || manifest.contract_version != CONTRACT_VERSION
        || manifest.database_schema != DATABASE_SCHEMA
        || manifest.database.file != "atlas.sqlite"
        || manifest.capture_method != CAPTURE_METHOD
        || manifest.exclusions != EXCLUSIONS
        || manifest.assets.len() > MAX_ASSETS
    {
        return Err(MediaError::Unavailable);
    }
    let (assets, bytes) = database_assets(port, bundle, budget)?;
    if manifest.database.sha256 != sha256(&bytes)
        || manifest.database.byte_size != bytes.len() as u64
        || assets.len() != manifest.assets.len()
    {
        return Err(MediaError::Unavailable);
    }
    let originals = bundle.child("originals", false)?;
    let mut expected = Vec::new();
    let mut total = bytes.len();
    for (index, (record, entry)) in assets.iter().zip(&manifest.assets).enumerate() {
        budget.check()?;
        if entry
            .blob
            .as_ref()
            .is_some_and(|name| *name != format!("{index}.blob"))
            || *entry != RecoveryAsset::from_record(record, entry.blob.clone())
            || record.payload.availability == Availability::Available && entry.blob.is_none()
        {
            return Err(MediaError::Unavailable);
        }
        if let Some(member) = &entry.blob {
            let original = originals.read(member, MAX_BYTES, budget)?;
            if original.len() as u64 != record.payload.byte_size
                || sha256(&original) != record.payload.sha256
            {
                return Err(MediaError::Unavailable);
            }
            add_total(&mut total, original.len())?;
            expected.push(member.clone());
        }
    }
    expected.sort();
    if originals.members()? != expected
        || bundle.members()? != ["atlas.sqlite", "manifest.json", "originals"]
    {
        return Err(MediaError::Unavailable);
    }
    budget.check()?;
    Ok(VerifiedRecovery { manifest, assets })
}

pub fn restore_recovery<P: RecoveryDatabasePort>(
    port: &P,
    bundle: &Path,
    destination: &Path,
    budget: &WorkBudget,
) -> MediaResult<RestoredRecovery> {
    let (parent, name) = destination_parent(destination)?;
    let bundle = PrivateDir::open(bundle, false)?;
    let verified = verify_directory(port, &bundle, budget)?;
    let staged = parent.temporary(".atlas-restore-")?;
    let database = bundle.read("atlas.sqlite", MAX_DATABASE, budget)?;
    if sha256(&database) != verified.manifest.database.sha256 {
        return Err(MediaError::Unavailable);
    }
    staged
        .directory
        .write_new("atlas.sqlite", &database, Mode::from_raw_mode(0o600))?;
    let vault = AssetVault::open(&staged.directory.path.join("media"))?;
    let originals = bundle.child("originals", false)?;
    for (record, entry) in verified.assets.iter().zip(&verified.manifest.assets) {
        budget.check()?;
        if let Some(member) = &entry.blob {
            vault.restore_retained(record, &originals.read(member, MAX_BYTES, budget)?, budget)?;
        }
    }
    database_assets(port, &staged.directory, budget)?;
    vault.sync_retained_hierarchy()?;
    staged.directory.sync()?;
    budget.check()?;
    let path = staged.publish(&name)?;
    Ok(RestoredRecovery {
        database_path: path.join("atlas.sqlite"),
        vault_root: path.join("media"),
        manifest: verified.manifest,
    })
}

fn add_total(total: &mut usize, bytes: usize) -> MediaResult<()> {
    *total = total.checked_add(bytes).ok_or(MediaError::TooLarge)?;
    if *total > MAX_TOTAL {
        return Err(MediaError::TooLarge);
    }
    Ok(())
}
