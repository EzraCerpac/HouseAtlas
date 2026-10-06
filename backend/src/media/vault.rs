use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

use rustix::fs::{AtFlags, Mode, linkat};

use super::content::validate_content;
use super::private_fs::PrivateDir;
use super::types::{
    AssetOwner, AssetPayload, AssetPurpose, AssetRecord, Availability, BlobIdentity, ContentType,
    PreviewPolicy, Scope, SourceLicense, is_digest, sha256,
};
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget};

/// A trusted server-owned root. Installed originals are never overwritten or
/// deleted. Tombstones affect storage delivery policy, not retained bytes.
pub struct AssetVault {
    root: PrivateDir,
    blobs: PrivateDir,
    staging: PrivateDir,
    scopes: Mutex<BTreeMap<String, PrivateDir>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedOriginal {
    pub purpose: AssetPurpose,
    pub storage_key: String,
    pub identity: BlobIdentity,
    pub content_type: ContentType,
}

impl PreparedOriginal {
    /// The caller supplies real provenance; preparation invents no license or
    /// evidence references and does not commit an asset record to SQLite.
    pub fn with_provenance(
        self,
        source_license: SourceLicense,
        evidence_ids: Vec<String>,
    ) -> MediaResult<AssetPayload> {
        let payload = AssetPayload {
            owner: AssetOwner::Atlas,
            purpose: self.purpose,
            storage_key: self.storage_key,
            sha256: self.identity.sha256,
            byte_size: self.identity.byte_size,
            content_type: self.content_type.as_str().to_owned(),
            source_license,
            availability: Availability::Available,
            preview_policy: if self.content_type == ContentType::Png {
                PreviewPolicy::SafeRendered
            } else {
                PreviewPolicy::DownloadOnly
            },
            evidence_ids,
        };
        payload.validate()?;
        Ok(payload)
    }
}

/// Proposed AT07 callback. A storage availability commit must use this actual
/// byte receipt after retained-file and directory durability barriers complete,
/// never the digest/size supplied by a client.
pub trait AvailableAssetVerifier {
    fn verify_available_asset(
        &self,
        record: &AssetRecord,
        budget: &WorkBudget,
    ) -> MediaResult<BlobIdentity>;
}

impl AssetVault {
    pub fn open(root: &Path) -> MediaResult<Self> {
        let root = PrivateDir::open(root, true)?;
        let blobs = root.child("blobs", true)?;
        let staging = root.child("staging", true)?;
        let mut scopes = BTreeMap::new();
        for name in blobs.members()? {
            if !is_digest(&name) {
                return Err(MediaError::Unavailable);
            }
            scopes.insert(name.clone(), blobs.child(&name, false)?);
        }
        Ok(Self {
            root,
            blobs,
            staging,
            scopes: Mutex::new(scopes),
        })
    }

    fn check_hierarchy(&self) -> MediaResult<()> {
        self.root.check()?;
        self.blobs.check()?;
        self.staging.check()
    }

    /// Bottom-up barrier for a complete restored vault, including empty dirs.
    pub(crate) fn sync_retained_hierarchy(&self) -> MediaResult<()> {
        self.check_hierarchy()?;
        let scopes = self.scopes.lock().map_err(|_| MediaError::Unavailable)?;
        for scope in scopes.values() {
            scope.sync()?;
        }
        self.blobs.sync()?;
        self.staging.sync()?;
        self.root.sync()
    }

    /// Establish durability even when an earlier installation retained the link
    /// but returned a barrier error. Installation and availability verification
    /// share this path; readable bytes alone are not an availability receipt.
    fn sync_retained_member(
        &self,
        directory: &PrivateDir,
        member: &str,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        self.check_hierarchy()?;
        directory.sync_member(member)?;
        directory.sync()?;
        self.blobs.sync()?;
        self.staging.sync()?;
        self.root.sync()?;
        budget.check()
    }

    fn with_scope<T>(
        &self,
        scope: &Scope,
        create: bool,
        operation: impl FnOnce(&PrivateDir) -> MediaResult<T>,
    ) -> MediaResult<T> {
        self.check_hierarchy()?;
        let partition = scope.storage_partition()?;
        let mut scopes = self.scopes.lock().map_err(|_| MediaError::Unavailable)?;
        if !scopes.contains_key(&partition) {
            scopes.insert(partition.clone(), self.blobs.child(&partition, create)?);
        }
        let directory = scopes.get(&partition).ok_or(MediaError::Unavailable)?;
        directory.check()?;
        let result = operation(directory)?;
        directory.check()?;
        self.check_hierarchy()?;
        Ok(result)
    }

    fn install(
        &self,
        scope: &Scope,
        bytes: &[u8],
        budget: &WorkBudget,
    ) -> MediaResult<PreparedIdentity> {
        budget.check()?;
        if bytes.len() > MAX_BYTES {
            return Err(MediaError::TooLarge);
        }
        let digest = sha256(bytes);
        let identity = BlobIdentity {
            sha256: digest.clone(),
            byte_size: bytes.len() as u64,
        };
        self.with_scope(scope, true, |directory| {
            let staged = self.staging.temporary("original-")?;
            staged
                .directory
                .write_new("bytes", bytes, Mode::from_raw_mode(0o400))?;
            self.check_hierarchy()?;
            directory.check()?;
            staged.directory.check()?;
            budget.check()?;
            let member = format!("{digest}.blob");
            match linkat(
                &staged.directory.file,
                "bytes",
                &directory.file,
                &member,
                AtFlags::empty(),
            ) {
                Ok(()) => (),
                Err(rustix::io::Errno::EXIST) => {
                    let current = directory.read(&member, MAX_BYTES, budget)?;
                    if current.len() != bytes.len() || sha256(&current) != digest {
                        return Err(MediaError::Unavailable);
                    }
                }
                Err(e) => return Err(e.into()),
            }
            self.sync_retained_member(directory, &member, budget)?;
            Ok(PreparedIdentity {
                storage_key: scope.storage_key(&digest)?,
                identity,
            })
        })
    }

    /// Local bounded reader supplied by the trusted integrator; no network or
    /// arbitrary browser path/URL input is accepted by this component.
    pub fn prepare_original(
        &self,
        scope: &Scope,
        purpose: AssetPurpose,
        content_type: ContentType,
        body: &mut impl Read,
        budget: &WorkBudget,
    ) -> MediaResult<PreparedOriginal> {
        scope.validate()?;
        if !purpose.is_original() {
            return Err(MediaError::InvalidInput);
        }
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 65536];
        let mut chunks = 0usize;
        loop {
            budget.check()?;
            let n = body.read(&mut chunk)?;
            if n == 0 {
                break;
            }
            chunks += 1;
            if chunks > 65536 {
                return Err(MediaError::TooLarge);
            }
            if n > MAX_BYTES.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&chunk[..n]);
        }
        validate_content(&bytes, content_type, budget)?;
        let prepared = self.install(scope, &bytes, budget)?;
        budget.check()?;
        Ok(PreparedOriginal {
            purpose,
            storage_key: prepared.storage_key,
            identity: prepared.identity,
            content_type,
        })
    }

    pub fn read_retained(&self, record: &AssetRecord, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
        record.validate()?;
        let payload = &record.payload;
        if !payload.purpose.is_original()
            || payload.storage_key != record.scope().storage_key(&payload.sha256)?
        {
            return Err(MediaError::Unavailable);
        }
        if payload.byte_size > MAX_BYTES as u64 {
            return Err(MediaError::TooLarge);
        }
        self.with_scope(&record.scope(), false, |directory| {
            let bytes = directory.read(&format!("{}.blob", payload.sha256), MAX_BYTES, budget)?;
            if bytes.len() as u64 != payload.byte_size || sha256(&bytes) != payload.sha256 {
                return Err(MediaError::Unavailable);
            }
            budget.check()?;
            Ok(bytes)
        })
    }

    /// Offline restore seam. A lifecycle tombstone or explicit missing flag
    /// never changes the retained identity or grants permission to deliver it.
    pub fn restore_retained(
        &self,
        record: &AssetRecord,
        bytes: &[u8],
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        record.validate()?;
        let payload = &record.payload;
        if !payload.purpose.is_original()
            || payload.storage_key != record.scope().storage_key(&payload.sha256)?
            || bytes.len() as u64 != payload.byte_size
            || sha256(bytes) != payload.sha256
        {
            return Err(MediaError::Unavailable);
        }
        validate_content(bytes, ContentType::parse(&payload.content_type)?, budget)?;
        self.install(&record.scope(), bytes, budget)?;
        Ok(())
    }
}

impl AvailableAssetVerifier for AssetVault {
    fn verify_available_asset(
        &self,
        record: &AssetRecord,
        budget: &WorkBudget,
    ) -> MediaResult<BlobIdentity> {
        let bytes = self.read_retained(record, budget)?;
        let content_type = ContentType::parse(&record.payload.content_type)?;
        validate_content(&bytes, content_type, budget)?;
        if record.payload.preview_policy == PreviewPolicy::SafeRendered
            && content_type != ContentType::Png
        {
            return Err(MediaError::Unsupported);
        }
        self.with_scope(&record.scope(), false, |directory| {
            self.sync_retained_member(
                directory,
                &format!("{}.blob", record.payload.sha256),
                budget,
            )
        })?;
        budget.check()?;
        Ok(BlobIdentity {
            sha256: sha256(&bytes),
            byte_size: bytes.len() as u64,
        })
    }
}

struct PreparedIdentity {
    storage_key: String,
    identity: BlobIdentity,
}
