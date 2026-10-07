//! Actual durable owned-original staging and immutable stock request binding.
//! A token locates data; it does not authorize or consume a storage receipt.
//! Atomic token consumption and the qualified stock asset planner remain owned
//! by storage/domain. No held operation is released by this module.
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::sync::Mutex;

use rustix::fs::Mode;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{access as a, contracts as dto, domain::stock, storage as s};

use super::native::{RetainedPrincipal, access_error, access_scope, storage_error};
use super::private_fs::PrivateDir;
use super::types::{
    AssetPayload, AssetPurpose, BlobIdentity, ContentType, Scope, SourceLicense, is_uuid, sha256,
};
use super::vault::PreparedOriginal;
use super::{AssetVault, MediaError, MediaResult, WorkBudget};

#[path = "upload_maintenance.rs"]
mod maintenance;
pub use maintenance::{StageCleanup, UploadLimits, UploadUsage};

const STAGE_FORMAT: &str = "houseatlas-owned-upload-stage/1";
const PLAN_FORMAT: &str = "houseatlas-owned-upload-plan-binding/1";
const MAX_STAGE: usize = 64 * 1024;
const MAX_PLAN: usize = 1024 * 1024;

/// Host admission data, not an approval or caller-supplied asset identity.
pub struct UploadAdmission {
    pub request_id: String,
    pub purpose: AssetPurpose,
    pub content_type: ContentType,
    pub filename: String,
    pub source_license: SourceLicense,
    pub evidence_ids: Vec<String>,
}

/// Exact projection of the published stock `$defs/stage` input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagedFile {
    pub upload_token: String,
    pub sha256: String,
    pub byte_size: u64,
    pub content_type: String,
    pub filename: String,
}

/// Proposed upload response. IDs come from the server; file facts are measured.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadReceipt {
    pub request_id: String,
    pub asset_id: String,
    pub staged: StagedFile,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StageRecord {
    format: String,
    scope: Scope,
    actor_id: String,
    request_id: String,
    asset_id: String,
    staged: StagedFile,
    payload: AssetPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanRecord<'a> {
    format: &'static str,
    stage: &'a StageRecord,
    original_request: &'a Value,
    request_digest: &'a str,
}

/// Sealed verified data for the actual storage/domain owner. It is neither an
/// AtlasCommandPlan nor a receipt/approval or an execution capability.
pub struct StagedAssetPlan {
    original: RetainedPrincipal,
    request: stock::ValidatedRequest,
    asset_id: String,
    payload: AssetPayload,
    staged: StagedFile,
    binding_digest: String,
}

impl StagedAssetPlan {
    pub fn original_principal(&self) -> &RetainedPrincipal {
        &self.original
    }
    pub fn request(&self) -> &stock::ValidatedRequest {
        &self.request
    }
    pub fn asset_id(&self) -> &str {
        &self.asset_id
    }
    pub fn payload(&self) -> &AssetPayload {
        &self.payload
    }
    pub fn staged(&self) -> &StagedFile {
        &self.staged
    }
    pub fn binding_digest(&self) -> &str {
        &self.binding_digest
    }
}

/// Borrowed vault plus the host's real storage Runtime for asset-ID issuance.
/// Token/plan data is durable, but opaque authority stays in this process. Losing
/// this owner loses its handles; files cannot reconstruct or adopt authority.
/// The trusted host exclusively owns and serializes the configured vault root.
pub struct NativeUploadStages<'a, R> {
    vault: &'a AssetVault,
    runtime: &'a R,
    directory: PrivateDir,
    schemas: stock::NativeStockContract,
    originals: Mutex<BTreeMap<String, RetainedPrincipal>>,
    limits: UploadLimits,
}

fn stock_error(error: stock::StockError) -> MediaError {
    match error {
        stock::StockError::OwnerUnavailable => MediaError::Unavailable,
        _ => MediaError::InvalidInput,
    }
}

fn json<T: Serialize>(value: &T) -> MediaResult<Value> {
    serde_json::to_value(value).map_err(|_| MediaError::Unavailable)
}

fn checked_bytes<T: Serialize>(value: &T, maximum: usize) -> MediaResult<Vec<u8>> {
    let bytes = serde_json::to_vec(value).map_err(|_| MediaError::Unavailable)?;
    if bytes.len() > maximum {
        return Err(MediaError::TooLarge);
    }
    Ok(bytes)
}

fn authorize(
    guard: &a::TransactionAuthorization<'_>,
    principal: &RetainedPrincipal,
    budget: &WorkBudget,
) -> MediaResult<Scope> {
    budget.check()?;
    if !std::ptr::eq(guard.principal(), principal.principal()) {
        return Err(MediaError::Forbidden);
    }
    let issued = guard.assert_mutation().map_err(access_error)?;
    let scope = Scope {
        workspace_id: issued.scope().workspace_id.as_str().to_owned(),
        home_id: issued.scope().home_id.as_str().to_owned(),
    };
    guard
        .authorize(&access_scope(&scope)?, a::Capability::Mutate)
        .map_err(access_error)?;
    Ok(scope)
}

fn upload_token() -> MediaResult<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| MediaError::Unavailable)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

impl<'a, R: s::Runtime> NativeUploadStages<'a, R> {
    pub fn open(vault: &'a AssetVault, runtime: &'a R) -> MediaResult<Self> {
        Self::open_with_limits(vault, runtime, UploadLimits::default())
    }

    /// Trusted serialized host policy, never caller upload metadata.
    pub fn open_with_limits(
        vault: &'a AssetVault,
        runtime: &'a R,
        limits: UploadLimits,
    ) -> MediaResult<Self> {
        limits.validate()?;
        Ok(Self {
            directory: vault.upload_directory()?,
            vault,
            runtime,
            schemas: stock::NativeStockContract::new().map_err(stock_error)?,
            originals: Mutex::new(BTreeMap::new()),
            limits,
        })
    }

    fn validate_admission(&self, admission: &UploadAdmission) -> MediaResult<()> {
        if !is_uuid(&admission.request_id)
            || !admission.purpose.is_original()
            || admission.filename.is_empty()
            || admission.filename.chars().count() > 255
            || admission
                .filename
                .chars()
                .any(|c| c == '/' || c == '\\' || c <= '\u{1f}')
            || admission.evidence_ids.len() > 100
        {
            return Err(MediaError::InvalidInput);
        }
        // Intrinsic provenance validation precedes accepting/retaining bytes.
        dto::decode::<dto::License>(&checked_bytes(&admission.source_license, MAX_STAGE)?)
            .map_err(|_| MediaError::InvalidInput)?;
        let mut evidence = BTreeSet::new();
        for id in &admission.evidence_ids {
            if !evidence.insert(id) {
                return Err(MediaError::InvalidInput);
            }
            dto::decode::<dto::RecordRef>(&checked_bytes(
                &serde_json::json!({"recordType":"evidence","recordId":id}),
                MAX_STAGE,
            )?)
            .map_err(|_| MediaError::InvalidInput)?;
        }
        checked_bytes(
            &serde_json::json!({
                "requestId": &admission.request_id, "purpose": admission.purpose,
                "contentType": admission.content_type.as_str(), "filename": &admission.filename,
                "sourceLicense": &admission.source_license, "evidenceIds": &admission.evidence_ids,
            }),
            MAX_STAGE,
        )?;
        Ok(())
    }

    pub fn stage_original(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        admission: UploadAdmission,
        body: &mut impl Read,
        budget: &WorkBudget,
    ) -> MediaResult<UploadReceipt> {
        let scope = authorize(guard, original, budget)?;
        self.validate_admission(&admission)?;
        self.expire_pending(budget)?;
        let mut originals = self
            .originals
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        if self.usage(budget)?.pending_stages >= self.limits.max_pending {
            return Err(MediaError::TooLarge);
        }
        let token = upload_token()?;
        let asset_id = self.runtime.new_id().map_err(storage_error)?;
        if !is_uuid(&asset_id) || asset_id == token {
            return Err(MediaError::Unavailable);
        }
        dto::decode::<dto::RecordRef>(&checked_bytes(
            &serde_json::json!({"recordType":"asset","recordId":&asset_id}),
            MAX_STAGE,
        )?)
        .map_err(|_| MediaError::Unavailable)?;
        // The durable reservation precedes blob installation. Interrupted
        // reservations and immutable originals remain charged after reopen.
        let pending = self.directory.temporary(".upload-")?;
        self.write_reservation_lifetime(&pending.directory)?;
        let prepared = self.vault.prepare_upload_original(
            &scope,
            admission.purpose,
            admission.content_type,
            body,
            budget,
            &self.limits,
        )?;
        let payload = prepared.with_provenance(admission.source_license, admission.evidence_ids)?;
        let staged = StagedFile {
            upload_token: token.clone(),
            sha256: payload.sha256.clone(),
            byte_size: payload.byte_size,
            content_type: payload.content_type.clone(),
            filename: admission.filename,
        };
        stock::StockContractPort::validate(&self.schemas, "#/$defs/stage", &json(&staged)?)
            .map_err(stock_error)?;
        dto::decode::<dto::AssetPayload>(&checked_bytes(&payload, MAX_STAGE)?)
            .map_err(|_| MediaError::InvalidInput)?;
        let record = StageRecord {
            format: STAGE_FORMAT.to_owned(),
            scope,
            actor_id: original.principal().actor_id().as_str().to_owned(),
            request_id: admission.request_id,
            asset_id,
            staged,
            payload,
        };
        let key = sha256(token.as_bytes());
        self.directory.require_absent(&key)?;
        pending.directory.write_new(
            "stage.json",
            &checked_bytes(&record, MAX_STAGE)?,
            Mode::from_raw_mode(0o400),
        )?;
        authorize(guard, original, budget)?;
        self.complete_lifetime(&pending.directory, budget)?;
        pending.publish(&key)?;
        self.vault.sync_retained_hierarchy()?;
        authorize(guard, original, budget)?;
        // Slow publication barriers cannot return a receipt already expired.
        // Published metadata remains charged and eligible for ordinary expiry.
        self.require_live(&self.directory.child(&key, false)?, budget)?;
        originals.insert(key, original.clone());
        Ok(UploadReceipt {
            request_id: record.request_id,
            asset_id: record.asset_id,
            staged: record.staged,
        })
    }

    /// Bind once to the full unchanged, genuinely validated stock envelope.
    /// This publishes immutable plan DATA, not a SQLite consumed-token marker.
    /// A repeated binding conflicts; durable retry/consume belongs to storage.
    pub fn bind_asset_plan(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        token: &str,
        request: &stock::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<StagedAssetPlan> {
        let scope = authorize(guard, original, budget)?;
        if !is_uuid(token) {
            return Err(MediaError::InvalidInput);
        }
        let key = sha256(token.as_bytes());
        let originals = self
            .originals
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let retained = originals.get(&key).ok_or(MediaError::Unavailable)?;
        if !retained.same_original(original) {
            return Err(MediaError::Forbidden);
        }
        checked_bytes(request.raw(), MAX_PLAN)?;
        let request = stock::ValidatedRequest::parse(&self.schemas, request.raw().clone())
            .map_err(stock_error)?;
        if request.id() != stock::OperationId::AtlasAssetCreate {
            return Err(MediaError::Unsupported);
        }
        let directory = self.directory.child(&key, false)?;
        if directory.members()? != ["lifetime.json", "stage.json"] {
            return Err(MediaError::Conflict);
        }
        self.require_live(&directory, budget)?;
        let record: StageRecord =
            serde_json::from_slice(&directory.read("stage.json", MAX_STAGE, budget)?)
                .map_err(|_| MediaError::Unavailable)?;
        let payload = request.payload();
        let equals = |left: &Value, right: &Value| -> MediaResult<bool> {
            Ok(stock::canonical_digest(left).map_err(stock_error)?
                == stock::canonical_digest(right).map_err(stock_error)?)
        };
        if record.format != STAGE_FORMAT
            || record.scope != scope
            || record.actor_id != original.principal().actor_id().as_str()
            || record.request_id != request.request_id()
            || record.staged.upload_token != token
            || request.context().workspace_id != scope.workspace_id
            || request.context().home_id != scope.home_id
            || request.target()["recordId"] != record.asset_id
            || !equals(&payload["staged"], &json(&record.staged)?)?
            || !equals(&payload["purpose"], &json(&record.payload.purpose)?)?
            || !equals(
                &payload["sourceLicense"],
                &json(&record.payload.source_license)?,
            )?
            || !equals(
                &payload["evidenceIds"],
                &json(&record.payload.evidence_ids)?,
            )?
        {
            return Err(MediaError::Conflict);
        }
        dto::decode::<dto::AssetPayload>(&checked_bytes(&record.payload, MAX_STAGE)?)
            .map_err(|_| MediaError::Unavailable)?;
        let prepared = PreparedOriginal {
            purpose: record.payload.purpose,
            storage_key: record.payload.storage_key.clone(),
            identity: BlobIdentity {
                sha256: record.payload.sha256.clone(),
                byte_size: record.payload.byte_size,
            },
            content_type: ContentType::parse(&record.payload.content_type)?,
        };
        let identity = self
            .vault
            .verify_prepared_original(&scope, &prepared, budget)?;
        if identity.sha256 != record.staged.sha256
            || identity.byte_size != record.staged.byte_size
            || record.payload.content_type != record.staged.content_type
        {
            return Err(MediaError::Unavailable);
        }
        let binding = PlanRecord {
            format: PLAN_FORMAT,
            stage: &record,
            original_request: request.raw(),
            request_digest: request.intent_digest(),
        };
        let bytes = checked_bytes(&binding, MAX_PLAN)?;
        let binding_digest = stock::canonical_digest(&json(&binding)?).map_err(stock_error)?;
        let pending = directory.temporary(".plan-")?;
        pending
            .directory
            .write_new("binding.json", &bytes, Mode::from_raw_mode(0o400))?;
        authorize(guard, original, budget)?;
        pending.publish("plan")?;
        self.directory.sync()?;
        self.vault.sync_retained_hierarchy()?;
        authorize(guard, original, budget)?;
        Ok(StagedAssetPlan {
            original: original.clone(),
            request,
            asset_id: record.asset_id,
            payload: record.payload,
            staged: record.staged,
            binding_digest,
        })
    }
}
