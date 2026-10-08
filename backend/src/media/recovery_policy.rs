//! Independent actual-producer policy evidence. This owner never restores
//! Access/Stage/Review authority and never reads Storage during its callback.
//! Missing historical or restarted provenance stays unavailable.
use crate::{access as a, domain::stock, storage as s};
use serde::Serialize;
use serde_json::{Value, json};

use super::native::RetainedPrincipal;
use super::review::VerifiedAssetReview;
use super::staged_upload::{StagedAssetPlan, StagedFile};
use super::types::{BlobIdentity, PreviewPolicy, Scope};
use super::vault::PreparedOriginal;
use super::{MediaError, MediaResult, WorkBudget};

const MAX_ENTRIES: usize = 10_000;
const MAX_ENTRY_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

/// Private producer constructor, called only after actual successful bounded
/// rendering. Clones retain issued provenance; data/enum/MIME cannot mint it.
/// Serializable facts are deliberately separate from this opaque carrier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RendererQualification {
    scope: Scope,
    original: PreparedOriginal,
    rendered: BlobIdentity,
}

impl RendererQualification {
    pub(super) fn produced(
        scope: &Scope,
        original: &PreparedOriginal,
        rendered: BlobIdentity,
    ) -> Self {
        Self {
            scope: scope.clone(),
            original: original.clone(),
            rendered,
        }
    }

    pub(super) fn matches(&self, scope: &Scope, original: &PreparedOriginal) -> bool {
        self.scope == *scope && self.original == *original
    }

    pub fn scope(&self) -> &Scope {
        &self.scope
    }
    pub fn original(&self) -> &PreparedOriginal {
        &self.original
    }
    pub fn rendered(&self) -> &BlobIdentity {
        &self.rendered
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProducerFacts<'a> {
    renderer: &'static str,
    scope: &'a Scope,
    purpose: super::types::AssetPurpose,
    storage_key: &'a str,
    original_sha256: &'a str,
    original_byte_size: u64,
    content_type: &'a str,
    rendered_sha256: &'a str,
    rendered_byte_size: u64,
}

impl RendererQualification {
    fn facts(&self) -> ProducerFacts<'_> {
        ProducerFacts {
            renderer: "houseatlas-stripped-rgba8-png/1",
            scope: &self.scope,
            purpose: self.original.purpose,
            storage_key: &self.original.storage_key,
            original_sha256: &self.original.identity.sha256,
            original_byte_size: self.original.identity.byte_size,
            content_type: self.original.content_type.as_str(),
            rendered_sha256: &self.rendered.sha256,
            rendered_byte_size: self.rendered.byte_size,
        }
    }
}

#[derive(Serialize)]
struct UploadProvenance {
    #[serde(skip)]
    qualifier: RendererQualification,
    request_digest: String,
    actor_id: String,
    request_id: String,
    asset_id: String,
    staged: StagedFile,
    payload: Value,
    binding_digest: String,
    root_request_digest: String,
    root_operation_id: String,
    group_ordinal: usize,
    group_operation_id: String,
    asset_audit_id: String,
}

struct PolicyEntry {
    qualifier: RendererQualification,
    asset: s::Record,
    upload: Option<UploadProvenance>,
    // Original native commit/review linkage retained as audit DATA; cannot
    // recreate producer qualification or revive the original grant.
    association: Value,
}

/// Bounded owner of actual issued qualifications and exact committed lineage.
/// No serde, public entry setter or historical proof adoption. Empty/missing
/// entries reject every frame. Root supplies its separate Jobs evidence peer.
#[derive(Default)]
pub struct MediaPolicyEvidence {
    entries: Vec<PolicyEntry>,
    retained_bytes: usize,
}

fn unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Independent original Media producer evidence is unavailable",
    )
}

fn digest(value: &Value) -> MediaResult<String> {
    stock::canonical_digest(value).map_err(|_| MediaError::InvalidInput)
}

fn value<T: Serialize>(data: &T) -> MediaResult<Value> {
    serde_json::to_value(data).map_err(|_| MediaError::Unavailable)
}

fn commit_group<'a>(
    commit: &'a s::StockAtlasCommit,
    request: &stock::ValidatedRequest,
    actor: &str,
    asset_id: &str,
) -> MediaResult<(usize, &'a s::StockCommitGroup, &'a s::MutationResult)> {
    if commit.actor_id != actor
        || commit.replayed
        || stock::request_digest(&commit.original_request).map_err(|_| MediaError::InvalidInput)?
            != commit.request_digest
    {
        return Err(MediaError::Conflict);
    }
    let mut found = None;
    for (ordinal, group) in commit.groups.iter().enumerate() {
        if digest(&group.original_request)? == digest(request.raw())? {
            if found.is_some() {
                return Err(MediaError::Conflict);
            }
            found = Some((ordinal, group));
        }
    }
    let (ordinal, group) = found.ok_or(MediaError::Conflict)?;
    let result = group.native_results.first().ok_or(MediaError::Conflict)?;
    let native = group.native_entries.first().ok_or(MediaError::Conflict)?;
    if group.request_digest != request.intent_digest()
        || group.native_entries.len() != group.native_results.len()
        || native.target != result.audit.record
        || native.command.mutation_id != result.audit.mutation_id
        || native.command.operation != result.audit.operation
        || native.command.expected_revision != result.audit.previous_revision
        || native.command.value.as_ref().is_none_or(|v| {
            v.record_type != s::RecordType::Asset || v.payload != result.record.payload
        })
        || result.record.record_type != s::RecordType::Asset
        || result.record.record_id != asset_id
        || result.record.workspace_id != request.context().workspace_id
        || result.record.home_id != request.context().home_id
        || result.record.last_audit_id != result.audit.audit_id
        || result.audit.record.record_type != s::RecordType::Asset
        || result.audit.record.record_id != asset_id
        || result.audit.actor_id != actor
        || result.audit.workspace_id != result.record.workspace_id
        || result.audit.home_id != result.record.home_id
        || result.audit.result_revision != result.record.revision
        || result.audit.after_digest
            != crate::contracts::semantics::canonical_digest(&value(&result.record)?)
                .map_err(|_| MediaError::InvalidInput)?
        || result.replayed
    {
        return Err(MediaError::Conflict);
    }
    Ok((ordinal, group, result))
}

impl PolicyEntry {
    fn facts(&self) -> Value {
        json!({"producer":self.qualifier.facts(), "asset":self.asset,
            "association":self.association, "upload":self.upload,
            "uploadProducer":self.upload.as_ref().map(|u|u.qualifier.facts())})
    }
}

impl MediaPolicyEvidence {
    /// Versioned read-only association DATA for the genuine native archive
    /// writer. This value never reconstructs qualification, authority or an
    /// archive receipt; origin/custody verification belongs to that actual owner.
    pub fn archive_facts(&self) -> Value {
        json!({"format":"houseatlas-media-policy-evidence/1",
            "entries":self.entries.iter().map(PolicyEntry::facts).collect::<Vec<_>>()})
    }

    fn retain(&mut self, entry: PolicyEntry) -> MediaResult<()> {
        let bytes = serde_json::to_vec(&entry.facts())
            .map_err(|_| MediaError::Unavailable)?
            .len();
        if self.entries.len() >= MAX_ENTRIES
            || bytes > MAX_ENTRY_BYTES
            || bytes > MAX_TOTAL_BYTES.saturating_sub(self.retained_bytes)
        {
            return Err(MediaError::TooLarge);
        }
        self.retained_bytes += bytes;
        self.entries.push(entry);
        Ok(())
    }

    /// Actual postcommit host capture, before losing stage/cleanup custody.
    /// Commit DTO alone cannot qualify policy; the genuine sealed stage is
    /// mandatory. Native Store remains responsible for commit authenticity and
    /// linked SQL receipt validation. This method does not authenticate a public
    /// commit DTO. Failure here never implies SQL rollback.
    pub fn retain_upload(
        &mut self,
        stage: &StagedAssetPlan,
        commit: &s::StockAtlasCommit,
    ) -> MediaResult<()> {
        let qualifier = stage
            .recovery_qualification()
            .ok_or(MediaError::Unavailable)?
            .clone();
        let principal = stage.original_principal().principal();
        let scope = qualifier.scope();
        if principal.scope().workspace_id.as_str() != scope.workspace_id
            || principal.scope().home_id.as_str() != scope.home_id
            || stage.payload().preview_policy != PreviewPolicy::SafeRendered
        {
            return Err(MediaError::Conflict);
        }
        let (ordinal, group, result) = commit_group(
            commit,
            stage.request(),
            principal.actor_id().as_str(),
            stage.asset_id(),
        )?;
        let payload = value(stage.payload())?;
        if result.record.revision != 1
            || result.record.payload != payload
            || result.audit.operation != s::Operation::Create
            || result.audit.previous_revision.is_some()
            || result.audit.before_digest.is_some()
        {
            return Err(MediaError::Conflict);
        }
        let upload = UploadProvenance {
            qualifier: qualifier.clone(),
            request_digest: digest(stage.request().raw())?,
            actor_id: principal.actor_id().as_str().into(),
            request_id: stage.request().request_id().into(),
            asset_id: stage.asset_id().into(),
            staged: stage.staged().clone(),
            payload,
            binding_digest: stage.binding_digest().into(),
            root_request_digest: digest(&commit.original_request)?,
            root_operation_id: commit.operation_id.clone(),
            group_ordinal: ordinal,
            group_operation_id: group.operation_id.clone(),
            asset_audit_id: result.audit.audit_id.clone(),
        };
        self.retain(PolicyEntry { qualifier, asset: result.record.clone(), upload: Some(upload),
            association: json!({"kind":"upload","bindingDigest":stage.binding_digest(),"commit":commit}) })
    }

    /// Existing-original review capture uses the actual receipt and original
    /// allocation under its genuine release guard. A serialized receipt cannot
    /// call this method. Store must already validate its real committed links;
    /// commit DTO consistency here does not authenticate a Store commit.
    pub fn retain_review(
        &mut self,
        proof: &VerifiedAssetReview,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        committed: &s::Record,
        commit: &s::StockAtlasCommit,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        proof.revalidate_release(guard, original, committed, proof.request(), budget)?;
        let (_, _, result) = commit_group(
            commit,
            proof.request(),
            original.principal().actor_id().as_str(),
            &committed.record_id,
        )?;
        let before = value(proof.original_record())?;
        if result.record != *committed
            || result.audit.operation != s::Operation::Replace
            || result.audit.previous_revision != Some(proof.original_record().revision)
            || result.audit.before_digest.as_deref()
                != Some(
                    crate::contracts::semantics::canonical_digest(&before)
                        .map_err(|_| MediaError::InvalidInput)?
                        .as_str(),
                )
            || value(&commit.asset_review)? != value(&Some(proof.retained_facts()))?
        {
            return Err(MediaError::Conflict);
        }
        budget.check()?;
        self.retain(PolicyEntry { qualifier: proof.recovery_qualification().clone(), asset: committed.clone(), upload: None,
            association: json!({"kind":"existing-asset-review","review":proof.retained_facts(),"commit":commit}) })
    }

    /// Synchronous independent producer matching only: no Storage, vault, Access
    /// or provider calls, no resumed grants, no default-safe policy. Match exact
    /// current record lineage; unknown subsequent mutations stay unavailable.
    pub fn validate_frame(&self, frame: s::MediaPolicyRecoveryFrame<'_>) -> s::Result<()> {
        let matches = match frame {
            s::MediaPolicyRecoveryFrame::Asset(asset) => self.entries.iter().any(|entry| {
                entry.asset == *asset
                    && asset.payload["previewPolicy"] == "safe-rendered"
                    && asset.workspace_id == entry.qualifier.scope.workspace_id
                    && asset.home_id == entry.qualifier.scope.home_id
            }),
            s::MediaPolicyRecoveryFrame::Upload(upload) => self
                .entries
                .iter()
                .filter_map(|e| e.upload.as_ref())
                .any(|entry| {
                    upload.scope().workspace_id == entry.qualifier.scope.workspace_id
                        && upload.scope().home_id == entry.qualifier.scope.home_id
                        && upload.actor_id() == entry.actor_id
                        && upload.request_id() == entry.request_id
                        && upload.asset_id() == entry.asset_id
                        && stock::canonical_digest(upload.asset_request())
                            .is_ok_and(|d| d == entry.request_digest)
                        && upload.staged() == &entry.staged
                        && upload.asset_payload() == &entry.payload
                        && upload.binding_digest() == entry.binding_digest
                        && upload.root_operation_id() == entry.root_operation_id
                        && upload.group_ordinal() == entry.group_ordinal
                        && upload.group_operation_id() == entry.group_operation_id
                        && upload.asset_audit_id() == entry.asset_audit_id
                        && stock::canonical_digest(upload.root_request())
                            .is_ok_and(|d| d == entry.root_request_digest)
                }),
        };
        if matches { Ok(()) } else { Err(unavailable()) }
    }
}

/// Concrete durable owner seam, presently UNBOUND. The implementation must be
/// selected from the actual native immutable provenance/custody owner, validate
/// its genuine producer/archive origin and complete referenced archive catalog,
/// and fail for legacy/unknown records. The current vault's private JSON files
/// supply no authenticated issuer proof. Do not invent signing credentials or
/// implement this from serde facts/hashes/MIME. No default implementation exists.
/// Its verified offline receipts never restore live Stage/Review/Access objects.
pub trait MediaPolicyArchivePort {
    type NativeReceipt;
    fn retain_producer_evidence(
        &self,
        evidence: &MediaPolicyEvidence,
        budget: &WorkBudget,
    ) -> MediaResult<Self::NativeReceipt>;
    /// Load the complete bounded native archive catalog through genuine native
    /// custody/origin validation. Reading serialized facts cannot satisfy this
    /// contract; missing catalog coverage must remain unavailable.
    fn read_producer_evidence(&self, budget: &WorkBudget) -> MediaResult<Vec<Self::NativeReceipt>>;
    fn validate_archived_frame(
        &self,
        receipt: &Self::NativeReceipt,
        frame: s::MediaPolicyRecoveryFrame<'_>,
        budget: &WorkBudget,
    ) -> s::Result<()>;
}
