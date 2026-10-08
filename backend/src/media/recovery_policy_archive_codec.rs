//! Closed archive DATA codecs. Decoding never calls the renderer qualification
//! constructor and cannot recreate a stage, review receipt or live authority.
use super::recovery_policy::{RendererQualification, commit_group};
use super::recovery_policy_archive::{
    MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES, MEDIA_POLICY_ARCHIVE_FORMAT, MediaPolicyArchiveOrigin,
};
use super::review::VerifiedAssetReview;
use super::staged_upload::{StagedAssetPlan, StagedFile};
use super::types::{
    AssetPayload, AssetPurpose, AssetRecord, Availability, ContentType, Lifecycle, PreviewPolicy,
    Scope, is_digest, is_uuid, required_nullable,
};
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget};
use crate::{
    contracts,
    domain::{native_semantics::NativeSemantics, stock},
    storage as s,
};
use s::Contract;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Write};

const RENDERER: &str = "houseatlas-stripped-rgba8-png/1";
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Purpose {
    Upload,
    ExistingAssetReview,
}
impl Purpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::ExistingAssetReview => "existing-asset-review",
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ArchiveRow {
    pub format: String,
    pub origin: MediaPolicyArchiveOrigin,
    pub purpose: Purpose,
    pub entry: EntryData,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProducerData {
    renderer: String,
    pub scope: Scope,
    purpose: AssetPurpose,
    storage_key: String,
    original_sha256: String,
    original_byte_size: u64,
    content_type: String,
    rendered_sha256: String,
    rendered_byte_size: u64,
}
impl ProducerData {
    fn issued(q: &RendererQualification) -> Self {
        Self {
            renderer: RENDERER.into(),
            scope: q.scope().clone(),
            purpose: q.original().purpose,
            storage_key: q.original().storage_key.clone(),
            original_sha256: q.original().identity.sha256.clone(),
            original_byte_size: q.original().identity.byte_size,
            content_type: q.original().content_type.as_str().into(),
            rendered_sha256: q.rendered().sha256.clone(),
            rendered_byte_size: q.rendered().byte_size,
        }
    }
    fn matches(&self, record: &AssetRecord) -> bool {
        let p = &record.payload;
        record.scope() == self.scope
            && p.purpose == self.purpose
            && p.storage_key == self.storage_key
            && p.sha256 == self.original_sha256
            && p.byte_size == self.original_byte_size
            && p.content_type == self.content_type
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct UploadStageData {
    pub format: String,
    pub scope: Scope,
    pub actor_id: String,
    pub request_id: String,
    pub asset_id: String,
    pub staged: StagedFile,
    pub payload: AssetPayload,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct UploadData {
    pub format: String,
    pub stage: UploadStageData,
    original_request: Value,
    request_digest: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewReceiptData {
    format: String,
    renderer: String,
    receipt_id: String,
    scope: Scope,
    asset_id: String,
    revision: u64,
    original_record_digest: String,
    original_sha256: String,
    original_byte_size: u64,
    rendered_sha256: String,
    rendered_byte_size: u64,
    actor_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewFactsData {
    format: String,
    renderer_receipt: ReviewReceiptData,
    request_digest: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReviewData {
    pub preimage: s::Record,
    facts: ReviewFactsData,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EntryData {
    pub producer: ProducerData,
    pub asset: s::Record,
    pub request: Value,
    pub commit: s::StockAtlasCommit,
    pub group_ordinal: usize,
    pub binding_digest: String,
    #[serde(deserialize_with = "required_nullable")]
    pub upload: Option<UploadData>,
    #[serde(deserialize_with = "required_nullable")]
    pub review: Option<ReviewData>,
}
fn value<T: Serialize>(v: &T) -> MediaResult<Value> {
    serde_json::to_value(v).map_err(|_| MediaError::InvalidInput)
}
fn digest(v: &Value) -> MediaResult<String> {
    stock::canonical_digest(v).map_err(|_| MediaError::InvalidInput)
}
fn require(ok: bool) -> MediaResult<()> {
    if ok {
        Ok(())
    } else {
        Err(MediaError::Conflict)
    }
}
fn stock_error(_: stock::StockError) -> MediaError {
    MediaError::InvalidInput
}
fn native_error(_: s::Error) -> MediaError {
    MediaError::InvalidInput
}
impl EntryData {
    pub fn upload(stage: &StagedAssetPlan, commit: &s::StockAtlasCommit) -> MediaResult<Self> {
        let original = stage.original_principal().principal();
        let (ordinal, _, result) = commit_group(
            commit,
            stage.request(),
            original.actor_id().as_str(),
            stage.asset_id(),
        )?;
        Ok(Self {
            producer: ProducerData::issued(
                stage
                    .recovery_qualification()
                    .ok_or(MediaError::Unavailable)?,
            ),
            asset: result.record.clone(),
            request: stage.request().raw().clone(),
            commit: commit.clone(),
            group_ordinal: ordinal,
            binding_digest: stage.binding_digest().into(),
            upload: Some(UploadData {
                format: "houseatlas-owned-upload-plan-binding/1".into(),
                stage: UploadStageData {
                    format: "houseatlas-owned-upload-stage/1".into(),
                    scope: Scope {
                        workspace_id: original.scope().workspace_id.as_str().into(),
                        home_id: original.scope().home_id.as_str().into(),
                    },
                    actor_id: original.actor_id().as_str().into(),
                    request_id: stage.request().request_id().into(),
                    asset_id: stage.asset_id().into(),
                    staged: stage.staged().clone(),
                    payload: stage.payload().clone(),
                },
                original_request: stage.request().raw().clone(),
                request_digest: stage.request().intent_digest().into(),
            }),
            review: None,
        })
    }
    pub fn review(
        proof: &VerifiedAssetReview,
        committed: &s::Record,
        commit: &s::StockAtlasCommit,
    ) -> MediaResult<Self> {
        let (ordinal, _, _) = commit_group(
            commit,
            proof.request(),
            proof.original_principal().principal().actor_id().as_str(),
            &committed.record_id,
        )?;
        Ok(Self {
            producer: ProducerData::issued(proof.recovery_qualification()),
            asset: committed.clone(),
            request: proof.request().raw().clone(),
            commit: commit.clone(),
            group_ordinal: ordinal,
            binding_digest: String::new(),
            upload: None,
            review: Some(ReviewData {
                preimage: serde_json::from_value(value(proof.original_record())?)
                    .map_err(|_| MediaError::InvalidInput)?,
                facts: serde_json::from_value(value(&proof.retained_facts())?)
                    .map_err(|_| MediaError::InvalidInput)?,
            }),
        })
    }
}
struct BoundedWriter {
    bytes: Vec<u8>,
    max: usize,
}
impl Write for BoundedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.max.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("Archive packet limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn bounded<T: Serialize>(data: &T, max: usize) -> MediaResult<Vec<u8>> {
    let mut writer = BoundedWriter {
        bytes: Vec::new(),
        max: max.min(MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES),
    };
    serde_json::to_writer(&mut writer, data).map_err(|_| MediaError::TooLarge)?;
    Ok(writer.bytes)
}
pub(super) fn check_source(
    commit: &s::StockAtlasCommit,
    max: usize,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    bounded(commit, max)?;
    budget.check()
}
pub(super) fn encode(row: &ArchiveRow, max: usize, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    budget.check()?;
    let bytes = bounded(row, max)?;
    budget.check()?;
    Ok(bytes)
}
pub(super) fn decode(bytes: &[u8], budget: &WorkBudget) -> MediaResult<ArchiveRow> {
    budget.check()?;
    if bytes.is_empty() || bytes.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES {
        return Err(MediaError::TooLarge);
    }
    let row: ArchiveRow = serde_json::from_slice(bytes).map_err(|_| MediaError::InvalidInput)?;
    // Exact deterministic reencoding also rejects duplicates/aliases within
    // nested Value payloads: they cannot survive as producer-origin bytes.
    require(bounded(&row, MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES)? == bytes)?;
    validate(&row, budget)?;
    budget.check()?;
    Ok(row)
}
fn validate(row: &ArchiveRow, budget: &WorkBudget) -> MediaResult<()> {
    require(row.format == MEDIA_POLICY_ARCHIVE_FORMAT)?;
    row.origin.validate()?;
    let e = &row.entry;
    let p = &e.producer;
    require(
        p.renderer == RENDERER
            && p.purpose.is_original()
            && p.content_type == ContentType::Png.as_str()
            && is_digest(&p.original_sha256)
            && is_digest(&p.rendered_sha256)
            && p.original_byte_size > 0
            && p.original_byte_size <= MAX_BYTES as u64
            && p.rendered_byte_size > 0
            && p.rendered_byte_size <= MAX_BYTES as u64
            && p.storage_key == p.scope.storage_key(&p.original_sha256)?,
    )?;
    let asset: AssetRecord =
        serde_json::from_value(value(&e.asset)?).map_err(|_| MediaError::InvalidInput)?;
    asset.validate()?;
    require(
        p.matches(&asset)
            && asset.payload.preview_policy == PreviewPolicy::SafeRendered
            && asset.payload.availability == Availability::Available
            && asset.lifecycle == Lifecycle::Active,
    )?;
    let native = s::NativeContract::new(NativeSemantics::native());
    let schemas = stock::NativeStockContract::new().map_err(stock_error)?;
    native
        .validate_shape("record", &value(&e.asset)?)
        .map_err(native_error)?;
    let request =
        stock::ValidatedRequest::parse(&schemas, e.request.clone()).map_err(stock_error)?;
    let root = stock::ValidatedRequest::parse(&schemas, e.commit.original_request.clone())
        .map_err(stock_error)?;
    require(
        root.intent_digest() == e.commit.request_digest
            && !e.commit.replayed
            && is_uuid(&e.commit.operation_id)
            && is_uuid(&e.commit.actor_id)
            && request.context() == root.context(),
    )?;
    let children = root.children();
    require(
        e.commit.groups.len()
            == if children.is_empty() {
                1
            } else {
                children.len()
            },
    )?;
    for (ordinal, group) in e.commit.groups.iter().enumerate() {
        budget.check()?;
        let child = if children.is_empty() {
            &root
        } else {
            &children[ordinal]
        };
        require(
            digest(&group.original_request)? == digest(child.raw())?
                && group.request_digest == child.intent_digest()
                && group.child_index
                    == if children.is_empty() {
                        None
                    } else {
                        Some(ordinal)
                    }
                && is_uuid(&group.operation_id)
                && !group.native_entries.is_empty()
                && group.native_entries.len() == group.native_results.len(),
        )?;
        if children.is_empty() {
            require(group.operation_id == e.commit.operation_id)?;
        }
        for (entry, result) in group.native_entries.iter().zip(&group.native_results) {
            native
                .validate_shape("recordRef", &value(&entry.target)?)
                .map_err(native_error)?;
            native
                .validate_shape("mutation", &value(&entry.command)?)
                .map_err(native_error)?;
            native
                .validate_shape("mutationResult", &value(result)?)
                .map_err(native_error)?;
            require(
                entry.target == result.audit.record
                    && entry.target == result.record.reference()
                    && entry.command.operation == result.audit.operation
                    && entry.command.mutation_id == result.audit.mutation_id
                    && entry.command.expected_revision == result.audit.previous_revision
                    && result.record.last_audit_id == result.audit.audit_id
                    && result.audit.actor_id == e.commit.actor_id
                    && result.record.workspace_id == root.context().workspace_id
                    && result.record.home_id == root.context().home_id
                    && result.audit.workspace_id == result.record.workspace_id
                    && result.audit.home_id == result.record.home_id
                    && result.audit.result_revision == result.record.revision
                    && !result.replayed
                    && result.audit.after_digest
                        == contracts::semantics::canonical_digest(&value(&result.record)?)
                            .map_err(|_| MediaError::InvalidInput)?,
            )?;
        }
    }
    let (ordinal, group, result) =
        commit_group(&e.commit, &request, &e.commit.actor_id, &asset.record_id)?;
    require(
        ordinal == e.group_ordinal && result.record == e.asset && group.native_entries.len() == 1,
    )?;
    match row.purpose {
        Purpose::Upload => validate_upload(e, &request, &schemas, &native, result)?,
        Purpose::ExistingAssetReview => validate_review(e, &request, &native, group, result)?,
    }
    Ok(())
}
fn validate_upload(
    e: &EntryData,
    request: &stock::ValidatedRequest,
    schemas: &stock::NativeStockContract,
    native: &impl s::Contract,
    result: &s::MutationResult,
) -> MediaResult<()> {
    let binding = e.upload.as_ref().ok_or(MediaError::InvalidInput)?;
    let stage = &binding.stage;
    require(
        e.review.is_none()
            && request.id() == stock::OperationId::AtlasAssetCreate
            && binding.format == "houseatlas-owned-upload-plan-binding/1"
            && stage.format == "houseatlas-owned-upload-stage/1"
            && stage.scope == e.producer.scope
            && stage.actor_id == e.commit.actor_id
            && stage.asset_id == e.asset.record_id
            && stage.request_id == request.request_id()
            && request.target()["recordId"] == stage.asset_id
            && binding.request_digest == request.intent_digest()
            && digest(&binding.original_request)? == digest(request.raw())?
            && is_digest(&e.binding_digest)
            && digest(&value(binding)?)? == e.binding_digest
            && value(&stage.payload)? == e.asset.payload
            && result.audit.operation == s::Operation::Create
            && result.audit.previous_revision.is_none()
            && result.audit.before_digest.is_none()
            && e.asset.revision == 1,
    )?;
    use stock::StockContractPort;
    schemas
        .validate("#/$defs/stage", &value(&stage.staged)?)
        .map_err(stock_error)?;
    native
        .validate_shape("assetPayload", &value(&stage.payload)?)
        .map_err(native_error)?;
    require(
        is_uuid(&stage.staged.upload_token)
            && stage.staged.sha256 == e.producer.original_sha256
            && stage.staged.byte_size == e.producer.original_byte_size
            && stage.staged.content_type == e.producer.content_type
            && digest(&request.payload()["staged"])? == digest(&value(&stage.staged)?)?
            && request.payload()["purpose"] == value(&stage.payload.purpose)?
            && request.payload()["sourceLicense"] == value(&stage.payload.source_license)?
            && request.payload()["evidenceIds"] == value(&stage.payload.evidence_ids)?,
    )?;
    native
        .validate_result(result, s::Prior::Missing)
        .map_err(native_error)
}
fn validate_review(
    e: &EntryData,
    request: &stock::ValidatedRequest,
    native: &impl s::Contract,
    group: &s::StockCommitGroup,
    result: &s::MutationResult,
) -> MediaResult<()> {
    let review = e.review.as_ref().ok_or(MediaError::InvalidInput)?;
    let facts = &review.facts;
    let r = &facts.renderer_receipt;
    let before: AssetRecord =
        serde_json::from_value(value(&review.preimage)?).map_err(|_| MediaError::InvalidInput)?;
    before.validate()?;
    native
        .validate_shape("record", &value(&review.preimage)?)
        .map_err(native_error)?;
    let p = &e.producer;
    require(
        e.upload.is_none()
            && e.binding_digest.is_empty()
            && request.id() == stock::OperationId::AtlasAssetReview
            && request.payload()["treatment"] == "request-preview"
            && request.payload()["rendererReceiptId"] == r.receipt_id
            && request.target()["recordId"] == e.asset.record_id
            && request.raw()["preconditions"]["target"]["kind"] == "atlas"
            && request.raw()["preconditions"]["target"]["value"].as_f64()
                == Some(before.revision as f64)
            && facts.format == "houseatlas-bound-asset-renderer-review/1"
            && facts.request_digest == digest(request.raw())?
            && r.format == "houseatlas-existing-asset-renderer-review/1"
            && r.renderer == RENDERER
            && is_uuid(&r.receipt_id)
            && r.scope == p.scope
            && r.asset_id == before.record_id
            && r.revision == before.revision
            && r.actor_id == e.commit.actor_id
            && r.original_record_digest == digest(&value(&review.preimage)?)?
            && r.original_sha256 == p.original_sha256
            && r.original_byte_size == p.original_byte_size
            && r.rendered_sha256 == p.rendered_sha256
            && r.rendered_byte_size == p.rendered_byte_size
            && p.matches(&before)
            && before.lifecycle == Lifecycle::Active
            && before.payload.availability == Availability::Available
            && e.asset.record_id == before.record_id
            && e.asset.revision
                == before
                    .revision
                    .checked_add(1)
                    .ok_or(MediaError::InvalidInput)?
            && e.asset.created_at == before.created_at
            && result.audit.operation == s::Operation::Replace
            && result.audit.previous_revision == Some(before.revision)
            && result.audit.before_digest.as_deref()
                == Some(
                    contracts::semantics::canonical_digest(&value(&review.preimage)?)
                        .map_err(|_| MediaError::InvalidInput)?
                        .as_str(),
                )
            && value(&e.commit.asset_review)? == value(&Some(facts))?,
    )?;
    let derivation = stock::AtlasDerivation::AssetReview {
        original: review.preimage.clone(),
        preview_policy: contracts::AssetPayloadPreviewPolicy::SafeRendered,
        renderer_receipt_id: Some(r.receipt_id.clone()),
    };
    let mapped =
        stock::plan_derived_atlas_commands(request, &derivation, native).map_err(stock_error)?;
    require(mapped.groups()[0].native_entries() == group.native_entries)?;
    let mut expected = before.payload;
    expected.preview_policy = PreviewPolicy::SafeRendered;
    expected.evidence_ids = serde_json::from_value(request.payload()["evidenceIds"].clone())
        .map_err(|_| MediaError::InvalidInput)?;
    require(value(&expected)? == e.asset.payload)?;
    native
        .validate_result(result, s::Prior::Record(&review.preimage))
        .map_err(native_error)
}
