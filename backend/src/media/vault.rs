use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

use rustix::fs::{AtFlags, Mode, linkat};

use super::content::{qualify_original_preview, validate_original_content};
use super::private_fs::PrivateDir;
use super::recovery_policy::RendererQualification;
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
/// Measured original metadata alone conveys no renderer qualification.
pub struct PreparedOriginal {
    pub purpose: AssetPurpose,
    pub storage_key: String,
    pub identity: BlobIdentity,
    pub content_type: ContentType,
}

/// Server-created original with immutable optional renderer qualification.
/// Public measured metadata remains available by reference; converting into
/// that metadata deliberately discards renderer qualification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QualifiedOriginal {
    measured: PreparedOriginal,
    preview_policy: PreviewPolicy,
    qualification: Option<RendererQualification>,
}

impl std::ops::Deref for QualifiedOriginal {
    type Target = PreparedOriginal;
    fn deref(&self) -> &Self::Target {
        &self.measured
    }
}

impl QualifiedOriginal {
    pub fn renderer_qualification(&self) -> Option<&RendererQualification> {
        self.qualification.as_ref()
    }
    pub fn into_measured(self) -> PreparedOriginal {
        self.measured
    }

    pub fn with_provenance(
        self,
        source_license: SourceLicense,
        evidence_ids: Vec<String>,
    ) -> MediaResult<AssetPayload> {
        let mut payload = self
            .measured
            .with_provenance(source_license, evidence_ids)?;
        payload.preview_policy = self.preview_policy;
        payload.validate()?;
        Ok(payload)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RetainedUsage {
    pub originals: usize,
    pub bytes: u64,
}

struct PreparationPolicy<'a> {
    minimum_bytes: usize,
    limits: Option<&'a super::staged_upload::UploadLimits>,
    qualify_preview: bool,
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
            preview_policy: PreviewPolicy::DownloadOnly,
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
        Self::open_selected(root, true)
    }

    /// Offline existing custody only; never creates or synchronizes directories.
    pub fn open_existing(root: &Path) -> MediaResult<Self> {
        Self::open_selected(root, false)
    }

    fn open_selected(root: &Path, create: bool) -> MediaResult<Self> {
        let root = PrivateDir::open(root, create)?;
        let blobs = root.child("blobs", create)?;
        let staging = root.child("staging", create)?;
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

    /// Pending upload receipts belong to this vault, not an independent DB.
    /// Recovery exports committed originals; it does not export these receipts.
    pub(super) fn upload_directory(&self) -> MediaResult<PrivateDir> {
        self.check_hierarchy()?;
        self.root.child("uploads", true)
    }

    /// Durable accounting includes committed and abandoned originals. Pending
    /// receipt cleanup never makes retained bytes disappear from this quota.
    pub fn retained_usage(&self, budget: &WorkBudget) -> MediaResult<RetainedUsage> {
        self.check_hierarchy()?;
        let mut usage = RetainedUsage::default();
        for partition in self.blobs.members()? {
            budget.check()?;
            if !is_digest(&partition) {
                return Err(MediaError::Unavailable);
            }
            let directory = self.blobs.child(&partition, false)?;
            for member in directory.members()? {
                budget.check()?;
                let digest = member
                    .strip_suffix(".blob")
                    .ok_or(MediaError::Unavailable)?;
                if !is_digest(digest) {
                    return Err(MediaError::Unavailable);
                }
                usage.originals = usage.originals.checked_add(1).ok_or(MediaError::TooLarge)?;
                usage.bytes = usage
                    .bytes
                    .checked_add(directory.member_size(&member)?)
                    .ok_or(MediaError::TooLarge)?;
            }
        }
        // A prior interrupted install can leave a private byte copy before
        // link publication. Charge it too, even if it shares an inode with an
        // installed blob; conservative path accounting bounds retained state.
        for name in self.staging.members()? {
            budget.check()?;
            if !name.starts_with("original-") {
                return Err(MediaError::Unavailable);
            }
            let scratch = self.staging.child(&name, false)?;
            let members = scratch.members()?;
            if members.iter().any(|member| member != "bytes") {
                return Err(MediaError::Unavailable);
            }
            usage.originals = usage.originals.checked_add(1).ok_or(MediaError::TooLarge)?;
            if !members.is_empty() {
                usage.bytes = usage
                    .bytes
                    .checked_add(scratch.member_size("bytes")?)
                    .ok_or(MediaError::TooLarge)?;
            }
        }
        self.check_hierarchy()?;
        Ok(usage)
    }

    /// Reopen and prove actual prepared bytes without inventing an asset record,
    /// audit ID or timestamp before the storage transaction creates them.
    pub(super) fn verify_prepared_original(
        &self,
        scope: &Scope,
        prepared: &PreparedOriginal,
        budget: &WorkBudget,
    ) -> MediaResult<BlobIdentity> {
        scope.validate()?;
        let identity = &prepared.identity;
        if !prepared.purpose.is_original()
            || prepared.storage_key != scope.storage_key(&identity.sha256)?
            || identity.byte_size == 0
            || identity.byte_size > MAX_BYTES as u64
        {
            return Err(MediaError::Unavailable);
        }
        self.with_scope(scope, false, |directory| {
            let member = format!("{}.blob", identity.sha256);
            let bytes = directory.read(&member, MAX_BYTES, budget)?;
            if bytes.len() as u64 != identity.byte_size || sha256(&bytes) != identity.sha256 {
                return Err(MediaError::Unavailable);
            }
            validate_original_content(&bytes, prepared.content_type, budget)?;
            self.sync_retained_member(directory, &member, budget)?;
            Ok(BlobIdentity {
                sha256: sha256(&bytes),
                byte_size: bytes.len() as u64,
            })
        })
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
    ) -> MediaResult<QualifiedOriginal> {
        self.prepare_original_with_minimum(
            scope,
            purpose,
            content_type,
            body,
            budget,
            PreparationPolicy {
                minimum_bytes: 0,
                limits: None,
                qualify_preview: true,
            },
        )
    }

    pub(super) fn prepare_upload_original(
        &self,
        scope: &Scope,
        purpose: AssetPurpose,
        content_type: ContentType,
        body: &mut impl Read,
        budget: &WorkBudget,
        limits: &super::staged_upload::UploadLimits,
    ) -> MediaResult<QualifiedOriginal> {
        self.prepare_original_with_minimum(
            scope,
            purpose,
            content_type,
            body,
            budget,
            PreparationPolicy {
                minimum_bytes: 1,
                limits: Some(limits),
                qualify_preview: true,
            },
        )
    }

    /// Reuse resolution measures originals without doing optional preview work.
    pub(super) fn prepare_upload_original_measured(
        &self,
        scope: &Scope,
        purpose: AssetPurpose,
        content_type: ContentType,
        body: &mut impl Read,
        budget: &WorkBudget,
        limits: &super::staged_upload::UploadLimits,
    ) -> MediaResult<PreparedOriginal> {
        self.prepare_original_with_minimum(
            scope,
            purpose,
            content_type,
            body,
            budget,
            PreparationPolicy {
                minimum_bytes: 1,
                limits: Some(limits),
                qualify_preview: false,
            },
        )
        .map(QualifiedOriginal::into_measured)
    }

    fn enforce_upload_capacity(
        &self,
        scope: &Scope,
        bytes: &[u8],
        limits: &super::staged_upload::UploadLimits,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        let usage = self.retained_usage(budget)?;
        if usage.originals > limits.max_retained_originals
            || usage.bytes > limits.max_retained_bytes
        {
            return Err(MediaError::TooLarge);
        }
        scope.validate()?;
        let present = self.with_scope(scope, true, |directory| {
            match directory.require_absent(&format!("{}.blob", sha256(bytes))) {
                Ok(()) => Ok(false),
                Err(MediaError::Conflict) => Ok(true),
                Err(error) => Err(error),
            }
        })?;
        // Reserve the maximum byte paths install can retain on an uncertain
        // return: its private copy plus a newly linked original, when new.
        let paths = if present { 1 } else { 2 };
        if usage
            .originals
            .checked_add(paths)
            .is_none_or(|count| count > limits.max_retained_originals)
            || (bytes.len() as u64)
                .checked_mul(paths as u64)
                .is_none_or(|size| size > limits.max_retained_bytes.saturating_sub(usage.bytes))
        {
            return Err(MediaError::TooLarge);
        }
        Ok(())
    }

    fn prepare_original_with_minimum(
        &self,
        scope: &Scope,
        purpose: AssetPurpose,
        content_type: ContentType,
        body: &mut impl Read,
        budget: &WorkBudget,
        policy: PreparationPolicy<'_>,
    ) -> MediaResult<QualifiedOriginal> {
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
        if bytes.len() < policy.minimum_bytes {
            return Err(MediaError::InvalidInput);
        }
        validate_original_content(&bytes, content_type, budget)?;
        if let Some(limits) = policy.limits {
            self.enforce_upload_capacity(scope, &bytes, limits, budget)?;
        }
        let rendered = if policy.qualify_preview {
            qualify_original_preview(&bytes, content_type, budget)?
        } else {
            None
        };
        let prepared = self.install(scope, &bytes, budget)?;
        budget.check()?;
        let measured = PreparedOriginal {
            purpose,
            storage_key: prepared.storage_key,
            identity: prepared.identity,
            content_type,
        };
        let qualification =
            rendered.map(|output| RendererQualification::produced(scope, &measured, output));
        Ok(QualifiedOriginal {
            measured,
            preview_policy: if qualification.is_some() {
                PreviewPolicy::SafeRendered
            } else {
                PreviewPolicy::DownloadOnly
            },
            qualification,
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
        validate_original_content(bytes, ContentType::parse(&payload.content_type)?, budget)?;
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
        validate_original_content(&bytes, content_type, budget)?;
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
