//! Producer-only packets and independently authorized offline evidence. This
//! module performs no archive I/O and never reconstructs a live producer/grant.
use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::native::{RetainedPrincipal, access_error, access_scope};
use super::recovery_policy::{MediaPolicyEvidence, UploadMatch};
use super::recovery_policy_archive_codec::{self as codec, ArchiveRow, EntryData, Purpose};
use super::review::VerifiedAssetReview;
use super::staged_upload::StagedAssetPlan;
use super::types::{Scope, is_digest, is_uuid, sha256};
use super::{MediaError, MediaResult, WorkBudget};
use crate::{access as a, lifecycle::provider_dispatch::archive::ArchiveDestination, storage as s};

pub const MAX_MEDIA_POLICY_ARCHIVE_MEMBERS: usize = 10_000;
pub const MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES: usize = 1024 * 1024;
pub const MAX_MEDIA_POLICY_ARCHIVE_TOTAL_BYTES: usize = 16 * 1024 * 1024;
pub const MEDIA_POLICY_ARCHIVE_FORMAT: &str = "houseatlas-media-policy-archive/1";

/// Native-owner-selected matching DATA. Construction grants no custody, read
/// approval or authenticated origin; the mandatory native policy supplies that.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaPolicyArchiveOrigin {
    deployment_id: String,
    physical_database_id: String,
    archive_id: String,
    generation: String,
}
impl MediaPolicyArchiveOrigin {
    pub fn new(
        deployment_id: impl Into<String>,
        physical_database_id: impl Into<String>,
        archive_id: impl Into<String>,
        generation: impl Into<String>,
    ) -> MediaResult<Self> {
        let origin = Self {
            deployment_id: deployment_id.into(),
            physical_database_id: physical_database_id.into(),
            archive_id: archive_id.into(),
            generation: generation.into(),
        };
        origin.validate()?;
        Ok(origin)
    }
    pub fn deployment_id(&self) -> &str {
        &self.deployment_id
    }
    pub fn physical_database_id(&self) -> &str {
        &self.physical_database_id
    }
    pub fn archive_id(&self) -> &str {
        &self.archive_id
    }
    pub fn generation(&self) -> &str {
        &self.generation
    }
    pub(super) fn validate(&self) -> MediaResult<()> {
        if [
            &self.deployment_id,
            &self.physical_database_id,
            &self.archive_id,
            &self.generation,
        ]
        .into_iter()
        .any(|s| s.is_empty() || s.len() > 128 || s.chars().any(char::is_control))
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(())
    }
}

/// Catalog comparison DATA. It is not an archive completion or read receipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaPolicyArchiveCatalogEntry {
    name: String,
    sha256: String,
    byte_size: u64,
}
impl MediaPolicyArchiveCatalogEntry {
    pub fn new(
        name: impl Into<String>,
        sha256: impl Into<String>,
        byte_size: u64,
    ) -> MediaResult<Self> {
        let entry = Self {
            name: name.into(),
            sha256: sha256.into(),
            byte_size,
        };
        if !valid_member(&entry.name)
            || !is_digest(&entry.sha256)
            || entry.byte_size == 0
            || entry.byte_size > MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES as u64
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(entry)
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub fn byte_size(&self) -> u64 {
        self.byte_size
    }
}
pub fn valid_media_policy_archive_member(name: &str) -> bool {
    valid_member(name)
}
fn valid_member(name: &str) -> bool {
    name.strip_suffix(".media-policy.json").is_some_and(is_uuid)
}

/// Mandatory independent full-field capture approval, separate from user
/// disclosure. The original allocation and genuine destination must qualify.
/// No default; callbacks must not reenter Storage/Access or perform I/O.
pub trait MediaPolicyArchiveWriteAuthorization {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        packet: &MediaPolicyArchivePacket,
    ) -> MediaResult<()>;
}
/// Actual native owner authenticates origin/destination/generation, exact bytes,
/// original producer scope/identity/provenance and COMPLETE catalog independently
/// of the SQL image. Matching labels/hashes/paths are not this binding. No default.
/// Callbacks are synchronous and must not perform I/O or reenter Storage/Access.
pub trait MediaPolicyArchiveReadAuthorization {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        member: &str,
        bytes: &[u8],
        cut: &RestoredMediaPolicyArchiveCut,
    ) -> s::Result<()>;
    fn authorize_catalog(
        &self,
        destination: &ArchiveDestination,
        origin: &MediaPolicyArchiveOrigin,
        members: &[MediaPolicyArchiveCatalogEntry],
    ) -> s::Result<()>;
}

/// Candidate validated DATA, not authenticated proof or a live qualification.
/// No constructor, serde or live-producer conversion is public.
pub struct RestoredMediaPolicyArchiveCut {
    row: ArchiveRow,
    member: String,
    request_digest: String,
    root_request_digest: String,
    upload_payload: Option<Value>,
}
impl RestoredMediaPolicyArchiveCut {
    pub fn origin(&self) -> &MediaPolicyArchiveOrigin {
        &self.row.origin
    }
    pub fn purpose(&self) -> &'static str {
        self.row.purpose.as_str()
    }
    pub fn scope(&self) -> &Scope {
        &self.row.entry.producer.scope
    }
    pub fn asset_id(&self) -> &str {
        &self.row.entry.asset.record_id
    }
    pub fn revision(&self) -> u64 {
        self.row.entry.asset.revision
    }
    pub fn audit_id(&self) -> &str {
        &self.row.entry.asset.last_audit_id
    }
    pub fn actor_id(&self) -> &str {
        &self.row.entry.commit.actor_id
    }
    pub fn record(&self) -> &s::Record {
        &self.row.entry.asset
    }
    pub fn commit(&self) -> &s::StockAtlasCommit {
        &self.row.entry.commit
    }
    pub fn group_ordinal(&self) -> usize {
        self.row.entry.group_ordinal
    }
    pub fn request(&self) -> &Value {
        &self.row.entry.request
    }
    pub fn review_preimage(&self) -> Option<&s::Record> {
        self.row.entry.review.as_ref().map(|r| &r.preimage)
    }
    pub fn producer_facts(&self) -> Value {
        serde_json::json!(&self.row.entry.producer)
    }
    pub fn member_name(&self) -> &str {
        &self.member
    }
    fn validated(row: ArchiveRow) -> MediaResult<Self> {
        let request_digest = crate::domain::stock::canonical_digest(&row.entry.request)
            .map_err(|_| MediaError::InvalidInput)?;
        let root_request_digest =
            crate::domain::stock::canonical_digest(&row.entry.commit.original_request)
                .map_err(|_| MediaError::InvalidInput)?;
        let upload_payload = row
            .entry
            .upload
            .as_ref()
            .map(|u| serde_json::to_value(&u.stage.payload))
            .transpose()
            .map_err(|_| MediaError::Unavailable)?;
        let member = format!("{}.media-policy.json", row.entry.asset.last_audit_id);
        Ok(Self {
            row,
            member,
            request_digest,
            root_request_digest,
            upload_payload,
        })
    }
    fn matches(&self, frame: s::MediaPolicyRecoveryFrame<'_>) -> bool {
        match frame {
            s::MediaPolicyRecoveryFrame::Asset(asset) => self.row.entry.asset == *asset,
            s::MediaPolicyRecoveryFrame::Upload(upload) => {
                let Some(binding) = &self.row.entry.upload else {
                    return false;
                };
                let Some(payload) = &self.upload_payload else {
                    return false;
                };
                let group = &self.row.entry.commit.groups[self.row.entry.group_ordinal];
                UploadMatch {
                    scope: &binding.stage.scope,
                    actor_id: &binding.stage.actor_id,
                    request_id: &binding.stage.request_id,
                    asset_id: &binding.stage.asset_id,
                    request_digest: &self.request_digest,
                    staged: &binding.stage.staged,
                    payload,
                    binding_digest: &self.row.entry.binding_digest,
                    root_request_digest: &self.root_request_digest,
                    root_operation_id: &self.row.entry.commit.operation_id,
                    group_ordinal: self.row.entry.group_ordinal,
                    group_operation_id: &group.operation_id,
                    asset_audit_id: &self.row.entry.asset.last_audit_id,
                }
                .matches(upload)
            }
        }
    }
    // Pure exact comparison for the native publisher's genuine Store carrier.
    // This cannot authenticate completion or construct a stage/renderer proof.
    pub(super) fn matches_consumed_upload(&self, upload: &s::ConsumedUpload) -> bool {
        self.matches(s::MediaPolicyRecoveryFrame::Upload(upload))
    }
}

/// Fresh factory-only packet retaining the genuine original allocation until
/// native authorized publication. Bytes never serialize that allocation.
pub struct MediaPolicyArchivePacket {
    original: RetainedPrincipal,
    bytes: Vec<u8>,
    cut: RestoredMediaPolicyArchiveCut,
}
fn authorize(
    guard: &a::TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    if !std::ptr::eq(guard.principal(), original.principal()) {
        return Err(MediaError::Forbidden);
    }
    let principal = guard.assert_mutation().map_err(access_error)?;
    let scope = Scope {
        workspace_id: principal.scope().workspace_id.as_str().into(),
        home_id: principal.scope().home_id.as_str().into(),
    };
    guard
        .authorize(&access_scope(&scope)?, a::Capability::Mutate)
        .map_err(access_error)?;
    Ok(())
}
impl MediaPolicyArchivePacket {
    /// Host postcommit capture while genuine stage custody and original Access
    /// fence remain retained. The host must supply its actual Store completion;
    /// public commit DATA is correlated here, never authenticated as completion.
    /// Capture/publication failure after commit never implies SQL rollback.
    pub fn encode_upload(
        stage: &StagedAssetPlan,
        commit: &s::StockAtlasCommit,
        guard: &a::TransactionAuthorization<'_>,
        origin: &MediaPolicyArchiveOrigin,
        max_bytes: usize,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        codec::check_source(commit, max_bytes, budget)?;
        authorize(guard, stage.original_principal(), budget)?;
        let mut live = MediaPolicyEvidence::default();
        live.retain_upload(stage, commit)?;
        let entry = EntryData::upload(stage, commit)?;
        Self::encode(
            entry,
            Purpose::Upload,
            origin,
            stage.original_principal(),
            max_bytes,
            budget,
        )
    }
    /// Host postcommit capture using the actual live renderer proof, its original
    /// fence, the exact durable successor and the host's actual Store completion.
    /// Public commit DATA cannot independently establish completion authenticity.
    /// Capture/publication failure after commit never implies SQL rollback.
    #[allow(clippy::too_many_arguments)]
    pub fn encode_review(
        proof: &VerifiedAssetReview,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        committed: &s::Record,
        commit: &s::StockAtlasCommit,
        origin: &MediaPolicyArchiveOrigin,
        max_bytes: usize,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        codec::check_source(commit, max_bytes, budget)?;
        let mut live = MediaPolicyEvidence::default();
        live.retain_review(proof, guard, original, committed, commit, budget)?;
        let entry = EntryData::review(proof, committed, commit)?;
        Self::encode(
            entry,
            Purpose::ExistingAssetReview,
            origin,
            original,
            max_bytes,
            budget,
        )
    }
    fn encode(
        entry: EntryData,
        purpose: Purpose,
        origin: &MediaPolicyArchiveOrigin,
        original: &RetainedPrincipal,
        max_bytes: usize,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        origin.validate()?;
        let row = ArchiveRow {
            format: MEDIA_POLICY_ARCHIVE_FORMAT.into(),
            origin: origin.clone(),
            purpose,
            entry,
        };
        let bytes = codec::encode(&row, max_bytes, budget)?;
        let decoded = codec::decode(&bytes, budget)?;
        let cut = RestoredMediaPolicyArchiveCut::validated(decoded)?;
        Ok(Self {
            original: original.clone(),
            bytes,
            cut,
        })
    }
    pub fn original_principal(&self) -> &RetainedPrincipal {
        &self.original
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn cut(&self) -> &RestoredMediaPolicyArchiveCut {
        &self.cut
    }
    pub fn member_name(&self) -> &str {
        self.cut.member_name()
    }
    /// Decode candidate DATA and authenticate it under the mandatory independent
    /// native read owner. This creates no live producer or original grant.
    pub fn decode<'a, A: MediaPolicyArchiveReadAuthorization>(
        bytes: &[u8],
        destination: &ArchiveDestination,
        member: &str,
        read_owner: &'a A,
        budget: &WorkBudget,
    ) -> s::Result<ArchivedMediaPolicyEvidence<'a, A>> {
        let row = codec::decode(bytes, budget).map_err(archive_error)?;
        let cut = RestoredMediaPolicyArchiveCut::validated(row).map_err(archive_error)?;
        if member != cut.member_name() {
            return Err(archive_error(MediaError::Conflict));
        }
        read_owner.authorize_archive(destination, member, bytes, &cut)?;
        budget.check().map_err(archive_error)?;
        Ok(ArchivedMediaPolicyEvidence {
            bytes: bytes.to_vec(),
            cut,
            destination: destination.clone(),
            read_owner,
        })
    }
}
fn archive_error(_: MediaError) -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Independent Media archive evidence is unavailable",
    )
}

/// Authenticated offline proof borrows its SAME independent native read owner;
/// no Deserialize/Clone/public constructor or live authority conversion.
pub struct ArchivedMediaPolicyEvidence<'a, A> {
    bytes: Vec<u8>,
    cut: RestoredMediaPolicyArchiveCut,
    destination: ArchiveDestination,
    read_owner: &'a A,
}
impl<A: MediaPolicyArchiveReadAuthorization> ArchivedMediaPolicyEvidence<'_, A> {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn cut(&self) -> &RestoredMediaPolicyArchiveCut {
        &self.cut
    }
    fn revalidate(&self) -> s::Result<()> {
        self.read_owner.authorize_archive(
            &self.destination,
            self.cut.member_name(),
            &self.bytes,
            &self.cut,
        )
    }
    fn catalog_entry(&self) -> MediaPolicyArchiveCatalogEntry {
        MediaPolicyArchiveCatalogEntry {
            name: self.cut.member.clone(),
            sha256: sha256(&self.bytes),
            byte_size: self.bytes.len() as u64,
        }
    }
}
/// Complete closed native generation with mandatory independent catalog/read
/// policy. Member/callback work is pure matching; no filesystem or SQL reentry.
pub struct AuthenticatedMediaPolicyArchive<'a, A> {
    destination: ArchiveDestination,
    origin: MediaPolicyArchiveOrigin,
    evidence: Vec<ArchivedMediaPolicyEvidence<'a, A>>,
    catalog: Vec<MediaPolicyArchiveCatalogEntry>,
    read_owner: &'a A,
}
impl<'a, A: MediaPolicyArchiveReadAuthorization> AuthenticatedMediaPolicyArchive<'a, A> {
    pub fn new(
        destination: &ArchiveDestination,
        origin: &MediaPolicyArchiveOrigin,
        mut evidence: Vec<ArchivedMediaPolicyEvidence<'a, A>>,
        read_owner: &'a A,
        budget: &WorkBudget,
    ) -> s::Result<Self> {
        budget.check().map_err(archive_error)?;
        origin.validate().map_err(archive_error)?;
        if evidence.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBERS {
            return Err(archive_error(MediaError::TooLarge));
        }
        evidence.sort_by(|a, b| a.cut.member_name().cmp(b.cut.member_name()));
        let mut names = BTreeSet::new();
        let mut total = 0usize;
        let mut catalog = Vec::with_capacity(evidence.len());
        for entry in &evidence {
            budget.check().map_err(archive_error)?;
            if !std::ptr::eq(entry.read_owner, read_owner)
                || entry.destination != *destination
                || entry.cut.origin() != origin
                || !names.insert(entry.cut.member_name())
            {
                return Err(archive_error(MediaError::Conflict));
            }
            total = total
                .checked_add(entry.bytes.len())
                .ok_or_else(|| archive_error(MediaError::TooLarge))?;
            if total > MAX_MEDIA_POLICY_ARCHIVE_TOTAL_BYTES {
                return Err(archive_error(MediaError::TooLarge));
            }
            entry.revalidate()?;
            catalog.push(entry.catalog_entry());
        }
        read_owner.authorize_catalog(destination, origin, &catalog)?;
        budget.check().map_err(archive_error)?;
        Ok(Self {
            destination: destination.clone(),
            origin: origin.clone(),
            evidence,
            catalog,
            read_owner,
        })
    }
    pub fn origin(&self) -> &MediaPolicyArchiveOrigin {
        &self.origin
    }
    pub fn catalog(&self) -> &[MediaPolicyArchiveCatalogEntry] {
        &self.catalog
    }
    pub fn validate_frame(&self, frame: s::MediaPolicyRecoveryFrame<'_>) -> s::Result<()> {
        self.read_owner
            .authorize_catalog(&self.destination, &self.origin, &self.catalog)?;
        let entry = self
            .evidence
            .iter()
            .find(|e| match frame {
                s::MediaPolicyRecoveryFrame::Asset(record) => e.cut.row.entry.asset == *record,
                s::MediaPolicyRecoveryFrame::Upload(upload) => {
                    e.cut.row.entry.upload.is_some()
                        && e.cut.row.entry.asset.record_id == upload.asset_id()
                        && e.cut.row.entry.asset.last_audit_id == upload.asset_audit_id()
                }
            })
            .ok_or_else(|| archive_error(MediaError::Unavailable))?;
        entry.revalidate()?;
        if entry.cut.matches(frame) {
            Ok(())
        } else {
            Err(archive_error(MediaError::Conflict))
        }
    }
}
