//! Explicit configured artifact custody for the reviewed nonphoto upload lane.
//! Captured files are startup evidence, never current remote deployment proof.
use super::*;
use crate::{
    access as a, config::providers::queued_upload::OriginalQueuedUploadConfigured,
    domain::stock::CapturedAccess, providers::homebox::read,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::{
    fs::{File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

#[derive(Clone)]
pub struct QueuedUploadProfileDescriptor {
    pub installed_release: String,
    pub source_commit: String,
    pub executable_sha256: Digest,
    pub context: Context,
    pub owner: StockTarget,
    pub account_id: String,
    pub group_id: String,
    pub authority: StockAuthority,
    pub policy_id: String,
    pub policy_version: u64,
    pub policy_epoch: u64,
    pub policy_digest: Digest,
    pub allowed_types: Vec<String>,
    pub maximum_bytes: u64,
    pub freshness: Duration,
}
struct ArtifactCapture {
    bytes: Vec<u8>,
    sha256: Digest,
    path: PathBuf,
    before: Metadata,
    after: Metadata,
    retrieved_at: SystemTime,
}
impl ArtifactCapture {
    fn capture(path: &Path, maximum: u64, exact: Option<u64>) -> Result<Self, StockErrorCode> {
        let mut file = File::open(path).map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let before = file
            .metadata()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        if !before.is_file()
            || before.len() == 0
            || before.len() > maximum
            || exact.is_some_and(|len| len != before.len())
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        let mut bytes = Vec::with_capacity(before.len() as usize);
        (&mut file)
            .take(maximum + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let after = file
            .metadata()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        if bytes.len() as u64 != before.len() || !same_file(&before, &after) {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        Ok(Self {
            sha256: upload_bytes_digest(&bytes)?,
            bytes,
            path: path.to_owned(),
            before,
            after,
            retrieved_at: SystemTime::now(),
        })
    }
}
#[cfg(unix)]
fn same_file(a: &Metadata, b: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.is_file()
        && b.is_file()
        && a.dev() == b.dev()
        && a.ino() == b.ino()
        && a.len() == b.len()
        && a.mtime() == b.mtime()
        && a.mtime_nsec() == b.mtime_nsec()
}
#[cfg(not(unix))]
fn same_file(_: &Metadata, _: &Metadata) -> bool {
    false
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildProvenance {
    schema_version: u64,
    release: String,
    source_commit: String,
    executable_sha256: Digest,
    source_artifacts: Vec<SourceArtifact>,
    custom_patches: Vec<Value>,
    effective_configuration_sha256: Digest,
    reviewed_upload_policy: UploadPolicy,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    path: String,
    sha256: Digest,
    bytes: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UploadPolicy {
    schema_version: u64,
    kind: String,
    policy_id: String,
    policy_version: u64,
    policy_epoch: u64,
    actor_id: uuid::Uuid,
    context: Context,
    owner: StockTarget,
    account_id: String,
    group_id: String,
    physical_binding: PolicyPhysical,
    dispatcher_owner_id: uuid::Uuid,
    dispatcher_epoch: u64,
    source_epoch: u64,
    approval_requirement: String,
    allowed_types: Vec<String>,
    maximum_bytes: u64,
    freshness_millis: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyPhysical {
    deployment_id: uuid::Uuid,
    physical_database_id: uuid::Uuid,
    configuration_digest: Digest,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectiveConfiguration {
    schema_version: u64,
    endpoint_origin: String,
    account_id: String,
    group_id: String,
    web: WebConfiguration,
    thumbnail: ThumbnailConfiguration,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebConfiguration {
    max_file_upload: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ThumbnailConfiguration {
    enabled: bool,
}

/// Private captured buffers and original opened-file metadata have no adoption
/// constructor or serialization. The root configuration allocation is retained.
pub struct NativeQueuedUploadInstallationOwner {
    configured: Arc<OriginalQueuedUploadConfigured>,
    executable: ArtifactCapture,
    provenance: ArtifactCapture,
    effective: ArtifactCapture,
    artifacts: Vec<ArtifactCapture>,
    policy: UploadPolicy,
    policy_value: Value,
    effective_value: EffectiveConfiguration,
    catalog_digest: Digest,
    route_digest: Digest,
    captured_at: Instant,
}
/// Borrowed inspection is DATA, not a new installation receipt.
pub struct QueuedUploadArtifactSource<'a> {
    captured: &'a ArtifactCapture,
}
impl QueuedUploadArtifactSource<'_> {
    pub fn path(&self) -> &Path {
        &self.captured.path
    }
    pub fn bytes(&self) -> &[u8] {
        &self.captured.bytes
    }
    pub fn sha256(&self) -> &Digest {
        &self.captured.sha256
    }
    pub fn before_metadata(&self) -> &Metadata {
        &self.captured.before
    }
    pub fn after_metadata(&self) -> &Metadata {
        &self.captured.after
    }
    pub fn retrieved_at(&self) -> SystemTime {
        self.captured.retrieved_at
    }
}
impl NativeQueuedUploadInstallationOwner {
    pub fn capture_configured(
        configured: &Arc<OriginalQueuedUploadConfigured>,
    ) -> Result<Self, StockErrorCode> {
        let captured_at = Instant::now();
        let paths = configured.artifacts();
        let executable = ArtifactCapture::capture(paths.executable(), 64 * 1024 * 1024, None)?;
        let provenance = ArtifactCapture::capture(paths.build_provenance(), 64 * 1024, None)?;
        let effective = ArtifactCapture::capture(paths.effective_configuration(), 64 * 1024, None)?;
        let supplied = [
            paths.attachment_schema(),
            paths.configuration_schema(),
            paths.entity_repository(),
            paths.attachment_repository(),
            paths.routes(),
            paths.attachment_service(),
            paths.swagger(),
            paths.entity_handler(),
            paths.attachment_handler(),
        ];
        let mut artifacts = Vec::with_capacity(PINS.len());
        for (path, pin) in supplied.into_iter().zip(PINS) {
            let captured = ArtifactCapture::capture(path, pin.bytes, Some(pin.bytes))?;
            if captured.sha256.as_str() != pin.sha256 {
                return Err(StockErrorCode::ProviderUnqualified);
            }
            artifacts.push(captured);
        }
        let parsed: BuildProvenance = serde_json::from_slice(&provenance.bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let raw: Value = serde_json::from_slice(&provenance.bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let policy_value = raw
            .get("reviewedUploadPolicy")
            .cloned()
            .ok_or(StockErrorCode::ProviderUnqualified)?;
        let effective_value: EffectiveConfiguration = serde_json::from_slice(&effective.bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let descriptor = configured.descriptor();
        if parsed.schema_version != 1
            || parsed.release != descriptor.installed_release
            || parsed.source_commit != NATIVE_SOURCE_COMMIT
            || parsed.source_commit != descriptor.source_commit
            || parsed.executable_sha256 != executable.sha256
            || executable.sha256 != descriptor.executable_sha256
            || parsed.effective_configuration_sha256 != effective.sha256
            || !parsed.custom_patches.is_empty()
            || parsed.source_artifacts.len() != PINS.len()
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        for (artifact, pin) in parsed.source_artifacts.iter().zip(PINS) {
            if artifact.path != pin.path
                || artifact.sha256.as_str() != pin.sha256
                || artifact.bytes != pin.bytes
            {
                return Err(StockErrorCode::ProviderUnqualified);
            }
        }
        let catalog: Value = serde_json::from_str(include_str!(
            "../../../../../../contracts/stock-wire3/agent/operation-catalog.json"
        ))
        .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let swagger: Value = serde_json::from_slice(&artifacts[6].bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let owner = Self {
            configured: configured.clone(),
            executable,
            provenance,
            effective,
            artifacts,
            policy: parsed.reviewed_upload_policy,
            policy_value,
            effective_value,
            catalog_digest: upload_value_digest(&catalog)?,
            route_digest: upload_value_digest(&swagger)?,
            captured_at,
        };
        owner.check_capture_window()?;
        Ok(owner)
    }
    pub fn configured(&self) -> &Arc<OriginalQueuedUploadConfigured> {
        &self.configured
    }
    pub fn descriptor(&self) -> &QueuedUploadProfileDescriptor {
        self.configured.descriptor()
    }
    pub fn executable(&self) -> QueuedUploadArtifactSource<'_> {
        QueuedUploadArtifactSource {
            captured: &self.executable,
        }
    }
    pub fn build_provenance(&self) -> QueuedUploadArtifactSource<'_> {
        QueuedUploadArtifactSource {
            captured: &self.provenance,
        }
    }
    pub fn effective_configuration(&self) -> QueuedUploadArtifactSource<'_> {
        QueuedUploadArtifactSource {
            captured: &self.effective,
        }
    }
    pub fn source_artifacts(
        &self,
    ) -> impl ExactSizeIterator<Item = QueuedUploadArtifactSource<'_>> {
        self.artifacts
            .iter()
            .map(|captured| QueuedUploadArtifactSource { captured })
    }
    pub(super) fn check_capture_window(&self) -> Result<(), StockErrorCode> {
        self.check_configuration()?;
        if self.captured_at.elapsed() > self.descriptor().freshness {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        Ok(())
    }
    fn check_configuration(&self) -> Result<(), StockErrorCode> {
        let c = &self.configured;
        let e = c.descriptor();
        let p = &self.policy;
        let f = c.physical();
        let effective = &self.effective_value;
        let endpoint = c
            .homebox()
            .endpoint()
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let queue = c.queue();
        let identity = &queue.registration.identity;
        if !c.credentials().matches_endpoint(&endpoint)
            || endpoint.origin().scheme() != "https"
            || c.homebox().metadata_dialect() != crate::providers::homebox::wire::DIALECT
            || c.source().access_registration() != c.metadata().registration()
            || c.source().registration() != c.homebox().registration()
            || c.metadata().registration().owner != a::SourceOwner::Homebox
            || c.metadata().source_registration_version() != e.authority.source_epoch
            || &self.policy_value != c.reviewed_policy()
            || upload_value_digest(&self.policy_value)? != e.policy_digest
            || e.installed_release != read::HOMEBOX_REFERENCE_VERSION
            || e.source_commit != NATIVE_SOURCE_COMMIT
            || e.context.workspace_id.is_nil()
            || e.context.home_id.is_nil()
            || e.owner.resource_kind != ResourceKind::Entity
            || e.owner.entity_id.is_some()
            || e.owner.id().is_err()
            || e.owner.id().is_ok_and(|id| id.is_nil())
            || e.account_id.is_empty()
            || e.group_id.is_empty()
            || e.account_id.len() > 4096
            || e.group_id.len() > 4096
            || p.schema_version != 1
            || p.kind != "homebox-queued-file-upload"
            || p.policy_id != e.policy_id
            || p.policy_id.is_empty()
            || p.policy_id.len() > 4096
            || p.policy_version != e.policy_version
            || p.policy_epoch != e.policy_epoch
            || !(1..=9_007_199_254_740_991).contains(&p.policy_version)
            || !(1..=9_007_199_254_740_991).contains(&p.policy_epoch)
            || p.actor_id != e.authority.actor_id
            || p.actor_id.is_nil()
            || p.context != e.context
            || p.owner != e.owner
            || p.account_id != e.account_id
            || p.group_id != e.group_id
            || p.approval_requirement != "no-human"
            || p.allowed_types != e.allowed_types
            || !valid_types(&p.allowed_types)
            || p.maximum_bytes != e.maximum_bytes
            || !(1..=10 * 1024 * 1024).contains(&p.maximum_bytes)
            || !(1..=60000).contains(&p.freshness_millis)
            || e.freshness != Duration::from_millis(p.freshness_millis)
            || p.physical_binding.deployment_id != f.physical_binding.deployment_id
            || p.physical_binding.physical_database_id != f.physical_binding.physical_database_id
            || p.physical_binding.configuration_digest != f.physical_binding.configuration_digest
            || f.physical_binding != e.authority.physical_binding
            || f.physical_binding.deployment_id.is_nil()
            || f.physical_binding.physical_database_id.is_nil()
            || f.owner_id.is_nil()
            || f.dispatcher_epoch == 0
            || p.dispatcher_owner_id != f.owner_id
            || p.dispatcher_epoch != f.dispatcher_epoch
            || p.source_epoch != e.authority.source_epoch
            || p.source_epoch == 0
            || queue.validate().is_err()
            || identity.deployment_id != f.physical_binding.deployment_id.to_string()
            || identity.physical_database_id != f.physical_binding.physical_database_id.to_string()
            || identity.configuration_digest.as_hex()
                != f.physical_binding.configuration_digest.as_str()
            || queue.registration.dispatcher_owner_id != f.owner_id.to_string()
            || effective.schema_version != 1
            || effective.endpoint_origin != endpoint.origin().as_str()
            || effective.account_id != e.account_id
            || effective.group_id != e.group_id
            || effective.thumbnail.enabled
            || effective.web.max_file_upload == 0
            || effective
                .web
                .max_file_upload
                .checked_mul(1024 * 1024)
                .is_none_or(|n| n < p.maximum_bytes)
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        let scope = c.homebox().scope();
        if scope.workspace_id.as_str() != e.context.workspace_id.to_string()
            || scope.home_id.as_str() != e.context.home_id.to_string()
            || scope.source_instance_id.as_str() != e.owner.source_instance_id.to_string()
            || scope.collection_id != e.owner.collection_id.to_string()
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        match &e.authority.qualification {
            NativeQualification::Qualified {
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            } if catalog_digest == &self.catalog_digest
                && registered_build_digest == &self.executable.sha256
                && route_qualification_digest == &self.route_digest =>
            {
                Ok(())
            }
            _ => Err(StockErrorCode::ProviderUnqualified),
        }
    }
    pub(super) fn admit_original(
        &self,
        captured: &CapturedAccess<'_>,
        source: &a::SourceGrant,
        context: &FreshQualification<'_, '_, '_>,
        command: &StockCommand,
        authority: &StockAuthority,
        capture_digest: &Digest,
    ) -> Result<Digest, StockErrorCode> {
        self.check_capture_window()?;
        context.revalidate()?;
        let physical = context
            .queued_upload_installation()
            .ok_or(StockErrorCode::ProviderUnqualified)?;
        let partition = physical.partition();
        if !std::ptr::eq(context.captured(), captured)
            || !std::ptr::eq(physical.captured(), captured)
            || !Arc::ptr_eq(physical.configured(), &self.configured)
            || !physical.matches_configured_store()
            || !std::ptr::eq(physical.source(), source)
            || partition.partition() != &source.reference().partition()
            || physical.source_metadata() != self.configured.metadata()
            || physical.queue_config() != self.configured.queue()
            || physical.registration() != self.configured.physical()
            || authority != &self.descriptor().authority
            || command.context != self.descriptor().context
            || command.target.owner_target().ok().as_ref() != Some(&self.descriptor().owner)
            || command.approval_receipt_id.is_some()
            || !self.configured.source().contains(source.reference())
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        context
            .guard()
            .revalidate_source(source)
            .map_err(super::queued_upload_source::upload_access_error)?;
        context
            .guard()
            .revalidate_source_partition(partition)
            .map_err(super::queued_upload_source::upload_access_error)?;
        let metadata = context
            .guard()
            .persisted_source_metadata(partition)
            .map_err(super::queued_upload_source::upload_access_error)?;
        if &metadata != self.configured.metadata() {
            return Err(StockErrorCode::PreflightConflict);
        }
        let result = upload_value_digest(
            &json!({"kind":"homebox-queued-upload-original-installed-capture-v1",
            "build":self.executable.sha256,"provenance":self.provenance.sha256,"effectiveConfiguration":self.effective.sha256,
            "sourceArtifacts":self.artifacts.iter().map(|a| &a.sha256).collect::<Vec<_>>(),
            "catalog":self.catalog_digest,"routes":self.route_digest,"policy":self.descriptor().policy_digest,
            "physicalBinding":{"deploymentId":self.configured.physical().physical_binding.deployment_id,
                "physicalDatabaseId":self.configured.physical().physical_binding.physical_database_id,
                "configurationDigest":self.configured.physical().physical_binding.configuration_digest},
            "dispatcherOwnerId":self.configured.physical().owner_id,"dispatcherEpoch":self.configured.physical().dispatcher_epoch,
            "sourceEpoch":authority.source_epoch,"accessEpoch":metadata.access_epoch(),
            "registrationVersion":metadata.source_registration_version(),"registrationDigest":metadata.source_registration_sha256(),
            "registration":metadata.registration(),"captureDigest":capture_digest,"requestDigest":command.request_digest,
            "observation":command.provider_observation}),
        )?;
        context.revalidate()?;
        self.check_capture_window()?;
        Ok(result)
    }
}
fn valid_types(types: &[String]) -> bool {
    !types.is_empty()
        && types.len() <= 4
        && types.iter().enumerate().all(|(i, t)| {
            ["manual", "warranty", "attachment", "receipt"].contains(&t.as_str())
                && !types[..i].contains(t)
        })
}
pub(super) fn upload_bytes_digest(bytes: &[u8]) -> Result<Digest, StockErrorCode> {
    Digest::parse(format!("{:x}", Sha256::digest(bytes)))
        .map_err(|_| StockErrorCode::ProviderUnqualified)
}
pub(super) fn upload_value_digest(value: &Value) -> Result<Digest, StockErrorCode> {
    let digest = crate::contracts::semantics::canonical_digest(value)
        .map_err(|_| StockErrorCode::ProviderUnqualified)?;
    Digest::parse(digest).map_err(|_| StockErrorCode::ProviderUnqualified)
}
struct Pin {
    path: &'static str,
    sha256: &'static str,
    bytes: u64,
}
const PINS: &[Pin] = &[
    Pin {
        path: "backend/internal/data/ent/schema/attachment.go",
        sha256: "cb8b7780ebb0ec54ed4026faa4fa10860412925827e5b5ef8ac91f2eac52f523",
        bytes: 989,
    },
    Pin {
        path: "backend/internal/sys/config/conf.go",
        sha256: "675fc330a6274b12a8c9d89dc6f04c89c26ac1ac3201935fc89b37c2587d0b85",
        bytes: 8457,
    },
    Pin {
        path: "backend/internal/data/repo/repo_entities.go",
        sha256: "56758719661cf36f2799879656519589a7a89b5dcc66341f1abcb7a43cf353d8",
        bytes: 87660,
    },
    Pin {
        path: "backend/internal/data/repo/repo_item_attachments.go",
        sha256: "32933019f370fc8a5dfc0fd7dfbe3173917d1c000ca64af7a9903cdafad3cfda",
        bytes: 30526,
    },
    Pin {
        path: "backend/app/api/routes.go",
        sha256: "ac69b5a58690773d0ee36376e7a4222024175628dcb687f4caab23ccba2d1671",
        bytes: 14211,
    },
    Pin {
        path: "backend/internal/core/services/service_items_attachments.go",
        sha256: "0bb2379a3d50bd7ade99d14b9b80bb8187e41e16221e21edea32d5165633f367",
        bytes: 6553,
    },
    Pin {
        path: "backend/app/api/static/docs/swagger.json",
        sha256: "5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493",
        bytes: 216647,
    },
    Pin {
        path: "backend/app/api/handlers/v1/v1_ctrl_entities.go",
        sha256: "4e8064b6dd63fdbdd65e466a470aaef44838d7e23fb10ba3fe0764a2a65d29d4",
        bytes: 19776,
    },
    Pin {
        path: "backend/app/api/handlers/v1/v1_ctrl_entities_attachments.go",
        sha256: "3d80d522e7f3a1facbd567b027855cd9f7d626c5792cbce8d0e0c862310b3808",
        bytes: 11921,
    },
];
