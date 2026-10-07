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
/// Published JavaScript storage schema; native Rust storage has its own profile.
pub const DATABASE_SCHEMA: u32 = 3;
pub const NATIVE_DATABASE_SCHEMA: u32 = 1;
pub const NATIVE_DATABASE_LINEAGE: &str = "houseatlas-rust-storage/1";
pub const MAX_DATABASE: usize = 64 * 1024 * 1024;
pub const MAX_MANIFEST: usize = 16 * 1024 * 1024;
pub const MAX_TOTAL: usize = 256 * 1024 * 1024;
pub const MAX_ASSETS: usize = 10_000;
const FORMAT: &str = "houseatlas-owned-recovery/1";
const NATIVE_FORMAT: &str = "houseatlas-rust-owned-recovery/1";
const CAPTURE_METHOD: &str = "sqlite-backup-and-retained-immutable-originals";
const EXCLUSIONS: [&str; 5] = [
    "HomeBox originals",
    "access database and sessions",
    "credentials",
    "server configuration",
    "Network source state",
];

/// Selected by the trusted storage adapter, never inferred from a bundle.
/// A profile names an identity; it implements no migration or witness lineage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryProfile {
    LegacyJsV1,
    NativeRustV1,
}

impl RecoveryProfile {
    pub const fn format(self) -> &'static str {
        match self {
            Self::LegacyJsV1 => FORMAT,
            Self::NativeRustV1 => NATIVE_FORMAT,
        }
    }

    pub const fn contract_version(self) -> &'static str {
        CONTRACT_VERSION
    }

    pub const fn database_schema(self) -> u32 {
        match self {
            Self::LegacyJsV1 => DATABASE_SCHEMA,
            Self::NativeRustV1 => NATIVE_DATABASE_SCHEMA,
        }
    }

    pub const fn database_lineage(self) -> Option<&'static str> {
        match self {
            Self::LegacyJsV1 => None,
            Self::NativeRustV1 => Some(NATIVE_DATABASE_LINEAGE),
        }
    }

    fn matches_metadata(self, contract_version: &str, schema: u32, lineage: Option<&str>) -> bool {
        contract_version == self.contract_version()
            && schema == self.database_schema()
            && lineage == self.database_lineage()
    }
}

/// The peer must check ACTUAL stored contract/schema/migration SQL hashes,
/// integrity/foreign keys, the frozen snapshot graph and exact one-to-one asset
/// manifest agreement. Reading assets alone does not implement this port.
pub trait RecoveryDatabasePort {
    /// Native adapters explicitly select NativeRustV1. The compatibility
    /// default preserves the published JavaScript recovery format/schema 3.
    /// Selection never substitutes for validating the actual database metadata.
    fn recovery_profile(&self) -> RecoveryProfile {
        RecoveryProfile::LegacyJsV1
    }

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
    /// Actual validated storage lineage, not a value invented from the profile.
    /// Legacy databases have none; native databases require the exact identity.
    pub database_lineage: Option<String>,
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
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_database_lineage"
    )]
    pub database_lineage: Option<String>,
    pub database: DatabaseMember,
    pub assets: Vec<RecoveryAsset>,
    pub exclusions: Vec<String>,
    pub capture_method: String,
}

// Omitted lineage preserves the legacy wire shape. A present value must be a
// string; null cannot masquerade as omission in a legacy or native bundle.
fn present_database_lineage<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
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
    profile: RecoveryProfile,
    bundle: &PrivateDir,
    budget: &WorkBudget,
) -> MediaResult<(ValidatedDatabase, Vec<u8>)> {
    let bytes = bundle.read("atlas.sqlite", MAX_DATABASE, budget)?;
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err(MediaError::Unavailable);
    }
    let mut validated =
        port.validate_recovery_database(&bundle.path.join("atlas.sqlite"), budget)?;
    bundle.check()?;
    // Bind the storage validation to the same closed image hashed by media.
    if bundle.read("atlas.sqlite", MAX_DATABASE, budget)? != bytes {
        return Err(MediaError::Unavailable);
    }
    if !profile.matches_metadata(
        &validated.contract_version,
        validated.database_schema,
        validated.database_lineage.as_deref(),
    ) {
        return Err(MediaError::Unavailable);
    }
    if validated.assets.len() > MAX_ASSETS {
        return Err(MediaError::TooLarge);
    }
    let assets = &mut validated.assets;
    let mut identities = BTreeSet::new();
    for record in assets.iter() {
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
    Ok((validated, bytes))
}

pub fn capture_recovery<P: RecoveryDatabasePort>(
    port: &P,
    vault: &AssetVault,
    destination: &Path,
    budget: &WorkBudget,
) -> MediaResult<RecoveryManifest> {
    budget.check()?;
    let profile = port.recovery_profile();
    let (parent, name) = destination_parent(destination)?;
    let staged = parent.temporary(".atlas-capture-")?;
    port.backup_to(&staged.directory.path.join("atlas.sqlite"), budget)?;
    staged.directory.check()?;
    staged.directory.sync_member("atlas.sqlite")?;
    let (validated, database) = database_assets(port, profile, &staged.directory, budget)?;
    let originals = staged.directory.child("originals", true)?;
    let mut total = database.len();
    let mut entries = Vec::with_capacity(validated.assets.len());
    for (index, record) in validated.assets.iter().enumerate() {
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
        format: profile.format().to_owned(),
        contract_version: validated.contract_version,
        database_schema: validated.database_schema,
        database_lineage: validated.database_lineage,
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
    verify_directory(port, profile, &staged.directory, budget)?;
    budget.check()?;
    staged.publish(&name)?;
    Ok(manifest)
}

pub fn verify_recovery<P: RecoveryDatabasePort>(
    port: &P,
    bundle: &Path,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    let profile = port.recovery_profile();
    let bundle = PrivateDir::open(bundle, false)?;
    verify_directory(port, profile, &bundle, budget)
}

fn verify_directory<P: RecoveryDatabasePort>(
    port: &P,
    profile: RecoveryProfile,
    bundle: &PrivateDir,
    budget: &WorkBudget,
) -> MediaResult<VerifiedRecovery> {
    budget.check()?;
    let manifest: RecoveryManifest =
        serde_json::from_slice(&bundle.read("manifest.json", MAX_MANIFEST, budget)?)
            .map_err(|_| MediaError::Unavailable)?;
    if manifest.format != profile.format()
        || !profile.matches_metadata(
            &manifest.contract_version,
            manifest.database_schema,
            manifest.database_lineage.as_deref(),
        )
        || manifest.database.file != "atlas.sqlite"
        || manifest.capture_method != CAPTURE_METHOD
        || manifest.exclusions != EXCLUSIONS
        || manifest.assets.len() > MAX_ASSETS
    {
        return Err(MediaError::Unavailable);
    }
    let (validated, bytes) = database_assets(port, profile, bundle, budget)?;
    let assets = validated.assets;
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
    let profile = port.recovery_profile();
    let (parent, name) = destination_parent(destination)?;
    let bundle = PrivateDir::open(bundle, false)?;
    let verified = verify_directory(port, profile, &bundle, budget)?;
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
    database_assets(port, profile, &staged.directory, budget)?;
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
