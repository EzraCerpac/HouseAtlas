//! Actual explicitly configured artifact custody for the quantity-only source.
//! Nothing here discovers installations, executes a binary, signs a build,
//! issues grants, dispatches a write, or authorizes a human-required request.
use super::*;
use crate::{
    app::stock_activity_principal::OriginalStockActivityPrincipal,
    config::providers::quantity_installation::OriginalQuantityConfigured, providers::homebox::read,
    storage::StockActivityPrincipal,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::{
    fs::{File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, SystemTime},
};

const MAX_EXECUTABLE: u64 = 64 * 1024 * 1024;
const MAX_PROVENANCE: u64 = 64 * 1024;
const REPOSITORY_PATH: &str = "backend/internal/data/repo/repo_entities.go";
const HANDLER_PATH: &str = "backend/app/api/handlers/v1/v1_ctrl_entities.go";
const SWAGGER_PATH: &str = "backend/app/api/static/docs/swagger.json";
const REPOSITORY_SHA: &str = "56758719661cf36f2799879656519589a7a89b5dcc66341f1abcb7a43cf353d8";
const HANDLER_SHA: &str = "4e8064b6dd63fdbdd65e466a470aaef44838d7e23fb10ba3fe0764a2a65d29d4";
const SWAGGER_SHA: &str = "5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493";

/// No public constructor, Clone, Debug or serde: only opened-file capture issues it.
struct CapturedInstallationFile {
    bytes: Vec<u8>,
    sha256: Digest,
    path: PathBuf,
    before: Metadata,
    after: Metadata,
    retrieved_at: SystemTime,
}
impl CapturedInstallationFile {
    fn capture(path: &Path, maximum: u64, exact: Option<u64>) -> Result<Self, StockErrorCode> {
        let mut file = File::open(path).map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let before = file
            .metadata()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        if !before.is_file()
            || before.len() == 0
            || before.len() > maximum
            || exact.is_some_and(|length| length != before.len())
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
        if bytes.len() as u64 != before.len() || !same_opened_file(&before, &after) {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        Ok(Self {
            sha256: digest_bytes(&bytes)?,
            bytes,
            path: path.to_owned(),
            before,
            after,
            retrieved_at: SystemTime::now(),
        })
    }
}
#[cfg(unix)]
fn same_opened_file(a: &Metadata, b: &Metadata) -> bool {
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
fn same_opened_file(_: &Metadata, _: &Metadata) -> bool {
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
    reviewed_quantity_policy: ReviewedQuantityPolicy,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    path: String,
    sha256: Digest,
    bytes: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewedQuantityPolicy {
    policy_id: String,
    policy_version: u64,
    policy_epoch: u64,
    actor_id: uuid::Uuid,
    context: Context,
    target: StockTarget,
    account_id: String,
    group_id: String,
    physical_binding: PolicyPhysicalBinding,
    dispatcher_owner_id: uuid::Uuid,
    dispatcher_epoch: u64,
    source_epoch: u64,
    approval_requirement: ApprovalRequirement,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    maximum: Option<u64>,
    freshness_millis: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyPhysicalBinding {
    deployment_id: uuid::Uuid,
    physical_database_id: uuid::Uuid,
    configuration_digest: Digest,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ApprovalRequirement {
    NoHuman,
    HumanRequired,
}

/// Retains the exact trusted root configuration and actual captured artifacts.
/// Public immutable byte getters are evidence inspection, never authority minting.
pub struct NativeQuantityInstallationOwner {
    configured: Arc<OriginalQuantityConfigured>,
    executable: CapturedInstallationFile,
    provenance: CapturedInstallationFile,
    repository: CapturedInstallationFile,
    handler: CapturedInstallationFile,
    swagger: CapturedInstallationFile,
    policy: ReviewedQuantityPolicy,
    policy_value: Value,
    catalog_digest: Digest,
    route_digest: Digest,
    captured_at: Instant,
}
/// Only the actual installation owner can construct transport custody.
/// There is no mutable reader or raw Arc getter on this public handle.
pub struct QuantityInstalledReader<'p, T, K> {
    pub(super) installation: Arc<NativeQuantityInstallationOwner>,
    pub(super) preview: &'p OriginalQuantityPreview<'p>,
    pub(super) reader: Arc<tokio::sync::Mutex<read::HomeBoxReader<T, K>>>,
}
#[derive(Clone, Copy)]
pub enum QuantityInstallationArtifact {
    Executable,
    BuildProvenance,
    EntityRepository,
    EntityHandler,
    Swagger,
}
/// Inspection exposes the original capture's facts, without issuing custody.
pub struct QuantityInstallationArtifactSource<'a> {
    capture: &'a CapturedInstallationFile,
}
impl QuantityInstallationArtifactSource<'_> {
    pub fn path(&self) -> &Path {
        &self.capture.path
    }
    pub fn bytes(&self) -> &[u8] {
        &self.capture.bytes
    }
    pub fn sha256(&self) -> &Digest {
        &self.capture.sha256
    }
    pub fn retrieved_at(&self) -> SystemTime {
        self.capture.retrieved_at
    }
    pub fn before_metadata(&self) -> &Metadata {
        &self.capture.before
    }
    pub fn after_metadata(&self) -> &Metadata {
        &self.capture.after
    }
}
/// Issued only by this retained original owner through a current real guard.
/// Synchronous qualification retains neither an Access nor a Store guard.
pub(super) struct QuantityInstalledAdmission<'owner, 'p> {
    owner: &'owner NativeQuantityInstallationOwner,
    original: &'p OriginalStockActivityPrincipal,
    queue: crate::jobs::QueueConfig,
    physical: crate::storage::StockActivityPhysicalRegistration,
    metadata: crate::access::SourceAuthorityMetadata,
    proof_digest: Digest,
}
impl QuantityInstalledAdmission<'_, '_> {
    pub(super) fn bind_capture(&self, capture_digest: &Digest) -> Result<Digest, StockErrorCode> {
        if self.owner.configured.queue() != &self.queue
            || self.owner.configured.physical() != &self.physical
            || self.owner.configured.metadata() != &self.metadata
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        digest_value(&json!({"kind":"homebox-quantity-installed-capture-v1",
            "installationProofDigest":self.proof_digest,"captureDigest":capture_digest,
            "requestDigest":self.original.command().request_digest,
            "providerObservation":self.original.command().provider_observation}))
    }
}
impl NativeQuantityInstallationOwner {
    pub fn capture_configured(
        configured: &Arc<OriginalQuantityConfigured>,
    ) -> Result<Arc<Self>, StockErrorCode> {
        // Count the entire artifact retrieval in the conservative owner window.
        let captured_at = Instant::now();
        let paths = configured.artifacts();
        let executable =
            CapturedInstallationFile::capture(paths.executable(), MAX_EXECUTABLE, None)?;
        let provenance =
            CapturedInstallationFile::capture(paths.build_provenance(), MAX_PROVENANCE, None)?;
        let repository =
            CapturedInstallationFile::capture(paths.entity_repository(), 87660, Some(87660))?;
        let handler =
            CapturedInstallationFile::capture(paths.entity_handler(), 19776, Some(19776))?;
        let swagger = CapturedInstallationFile::capture(paths.swagger(), 216647, Some(216647))?;
        let parsed: BuildProvenance = serde_json::from_slice(&provenance.bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let raw: Value = serde_json::from_slice(&provenance.bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let policy_value = raw
            .get("reviewedQuantityPolicy")
            .cloned()
            .ok_or(StockErrorCode::ProviderUnqualified)?;
        let expected = configured.descriptor();
        if parsed.schema_version != 1
            || parsed.release != expected.version
            || parsed.source_commit != NATIVE_SOURCE_COMMIT
            || parsed.source_commit != expected.source_commit
            || parsed.executable_sha256 != executable.sha256
            || expected.build_digest != executable.sha256
            || !parsed.custom_patches.is_empty()
            || parsed.source_artifacts.len() != 3
            || repository.sha256.as_str() != REPOSITORY_SHA
            || handler.sha256.as_str() != HANDLER_SHA
            || swagger.sha256.as_str() != SWAGGER_SHA
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        let pins = [
            (REPOSITORY_PATH, REPOSITORY_SHA, 87660),
            (HANDLER_PATH, HANDLER_SHA, 19776),
            (SWAGGER_PATH, SWAGGER_SHA, 216647),
        ];
        for (path, sha, length) in pins {
            if parsed
                .source_artifacts
                .iter()
                .filter(|artifact| {
                    artifact.path == path
                        && artifact.sha256.as_str() == sha
                        && artifact.bytes == length
                })
                .count()
                != 1
            {
                return Err(StockErrorCode::ProviderUnqualified);
            }
        }
        let catalog: Value = serde_json::from_str(include_str!(
            "../../../../../../contracts/stock-wire3/agent/operation-catalog.json"
        ))
        .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let routes: Value = serde_json::from_slice(&swagger.bytes)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let catalog_digest = digest_value(&catalog)?;
        let route_digest = digest_value(&routes)?;
        if expected.catalog_digest != catalog_digest
            || expected.route_digest != route_digest
            || digest_value(&policy_value)? != expected.policy_digest
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        let owner = Arc::new(Self {
            configured: Arc::clone(configured),
            executable,
            provenance,
            repository,
            handler,
            swagger,
            policy: parsed.reviewed_quantity_policy,
            policy_value,
            catalog_digest,
            route_digest,
            captured_at,
        });
        owner.check_configuration()?;
        Ok(owner)
    }
    pub fn profile(self: &Arc<Self>) -> Result<QuantityProfile, StockErrorCode> {
        QuantityProfile::from_installation(Arc::clone(self), self.configured.descriptor().clone())
    }
    pub fn create_reader<'p, K: read::Clock + Send + Sync>(
        self: &Arc<Self>,
        preview: &'p OriginalQuantityPreview<'p>,
        clock: K,
    ) -> Result<
        QuantityInstalledReader<'p, read::HttpTransport<read::NativeReadCredentials<'p>>, K>,
        StockErrorCode,
    > {
        self.check_preview(preview)?;
        let credentials = self
            .configured
            .credentials()
            .bind_original(
                Arc::clone(self.configured.access()),
                preview.principal,
                preview.source.clone(),
                preview.partition.clone(),
            )
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        let reader = self
            .configured
            .homebox()
            .reader(credentials, clock)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        super::quantity_observation::quantity_reader_check(&reader, self.configured.metadata())?;
        Ok(QuantityInstalledReader {
            installation: Arc::clone(self),
            preview,
            reader: Arc::new(tokio::sync::Mutex::new(reader)),
        })
    }
    #[cfg(test)]
    pub(super) fn fixture_reader<'p, T: read::Transport, K: read::Clock + Send + Sync>(
        self: &Arc<Self>,
        preview: &'p OriginalQuantityPreview<'p>,
        reader: Arc<tokio::sync::Mutex<read::HomeBoxReader<T, K>>>,
    ) -> Result<QuantityInstalledReader<'p, T, K>, StockErrorCode> {
        self.check_preview(preview)?;
        {
            let configured = reader
                .try_lock()
                .map_err(|_| StockErrorCode::ResourceUnavailable)?;
            super::quantity_observation::quantity_reader_check(
                &configured,
                self.configured.metadata(),
            )?;
        }
        Ok(QuantityInstalledReader {
            installation: Arc::clone(self),
            preview,
            reader,
        })
    }
    fn check_preview(
        self: &Arc<Self>,
        preview: &OriginalQuantityPreview<'_>,
    ) -> Result<(), StockErrorCode> {
        self.check_configuration()?;
        if !preview
            .profile
            .installation
            .as_ref()
            .is_some_and(|owner| Arc::ptr_eq(owner, self))
            || &preview.profile.expected != self.configured.descriptor()
            || preview.source.reference().partition() != self.configured.source().partition()
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        Ok(())
    }
    pub fn executable_bytes(&self) -> &[u8] {
        &self.executable.bytes
    }
    pub fn build_provenance_bytes(&self) -> &[u8] {
        &self.provenance.bytes
    }
    pub fn entity_repository_bytes(&self) -> &[u8] {
        &self.repository.bytes
    }
    pub fn entity_handler_bytes(&self) -> &[u8] {
        &self.handler.bytes
    }
    pub fn swagger_bytes(&self) -> &[u8] {
        &self.swagger.bytes
    }
    pub fn artifact_source(
        &self,
        artifact: QuantityInstallationArtifact,
    ) -> QuantityInstallationArtifactSource<'_> {
        let capture = match artifact {
            QuantityInstallationArtifact::Executable => &self.executable,
            QuantityInstallationArtifact::BuildProvenance => &self.provenance,
            QuantityInstallationArtifact::EntityRepository => &self.repository,
            QuantityInstallationArtifact::EntityHandler => &self.handler,
            QuantityInstallationArtifact::Swagger => &self.swagger,
        };
        QuantityInstallationArtifactSource { capture }
    }
    pub(super) fn configured(&self) -> &Arc<OriginalQuantityConfigured> {
        &self.configured
    }

    pub(super) fn admit_original<'owner, 'p>(
        &'owner self,
        original: &'p OriginalStockActivityPrincipal,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Result<QuantityInstalledAdmission<'owner, 'p>, StockErrorCode> {
        context.revalidate()?;
        self.check_configuration()?;
        let physical = context
            .quantity_installation()
            .ok_or(StockErrorCode::UnsupportedCapability)?;
        let observation = physical.observation();
        if !Arc::ptr_eq(physical.configured(), &self.configured)
            || !std::ptr::eq(observation.original(), original)
            || !std::ptr::eq(
                context.guard().principal(),
                original.original_activity_principal(),
            )
            || !self
                .configured
                .store_identity()
                .matches_observation(observation)
            || observation.queue_config() != self.configured.queue()
            || observation.registration() != self.configured.physical()
            || observation.source_metadata() != self.configured.metadata()
            || original.captured_authority() != &self.configured.descriptor().authority
            || self.captured_at.elapsed() > self.configured.descriptor().freshness
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        let partition = original.original_activity_partition();
        context
            .guard()
            .assert_mutation()
            .map_err(super::quantity_observation::quantity_access_error)?;
        context
            .guard()
            .revalidate_source(original.original_activity_source())
            .map_err(super::quantity_observation::quantity_access_error)?;
        let metadata = context
            .guard()
            .persisted_source_metadata(partition)
            .map_err(super::quantity_observation::quantity_access_error)?;
        if metadata != *self.configured.metadata() {
            return Err(StockErrorCode::PreflightConflict);
        }
        let e = self.configured.descriptor();
        let command = original.command();
        let quantity = command
            .payload
            .get("quantity")
            .and_then(Value::as_u64)
            .ok_or(StockErrorCode::InvalidArgument)?;
        if command.command_id != "homebox.entity.quantity.set"
            || command.context != e.scope
            || command.target != e.target
            || !self
                .configured
                .source()
                .contains(original.original_activity_source().reference())
            || self.policy.approval_requirement != ApprovalRequirement::NoHuman
            || self.policy.maximum.is_none_or(|maximum| quantity > maximum)
            || quantity > 9_007_199_254_740_991
        {
            return Err(StockErrorCode::CapabilityDenied);
        }
        let queue = observation.queue_config().clone();
        let registration = observation.registration().clone();
        let proof_digest = digest_value(
            &json!({"kind":"homebox-quantity-original-installation-v1",
            "executableSha256":self.executable.sha256,"provenanceSha256":self.provenance.sha256,
            "repositorySha256":self.repository.sha256,"handlerSha256":self.handler.sha256,
            "swaggerSha256":self.swagger.sha256,"catalogDigest":self.catalog_digest,
            "routeDigest":self.route_digest,"policyDigest":e.policy_digest,
            "deploymentId":registration.physical_binding.deployment_id,
            "physicalDatabaseId":registration.physical_binding.physical_database_id,
            "configurationDigest":registration.physical_binding.configuration_digest,
            "dispatcherOwnerId":registration.owner_id,"dispatcherEpoch":registration.dispatcher_epoch,
            "accessEpoch":metadata.access_epoch(),"sourceRegistrationVersion":metadata.source_registration_version(),
            "sourceRegistrationSha256":metadata.source_registration_sha256(),
            "sourceRegistration":metadata.registration(),
            "queueLeaseDurationMillis":queue.lease_duration_ms,
            "queueRetry":{"maxAttempts":queue.retry.max_attempts,"initialDelayMillis":queue.retry.initial_delay_ms,
                "maxDelayMillis":queue.retry.max_delay_ms},
            "queueProfileVersion":queue.admission_profile.profile_version,
            "queueLimits":{"waiting":queue.admission_profile.max_waiting_intents,
                "waitMillis":queue.admission_profile.max_admission_wait_ms,
                "unresolvedAttempts":queue.admission_profile.max_unresolved_storage_attempts,
                "unresolvedBytes":queue.admission_profile.max_unresolved_storage_bytes},
            "actorId":original.captured_authority().actor_id,"requestDigest":command.request_digest,
            "providerObservation":command.provider_observation}),
        )?;
        Ok(QuantityInstalledAdmission {
            owner: self,
            original,
            queue,
            physical: registration,
            metadata,
            proof_digest,
        })
    }

    fn check_configuration(&self) -> Result<(), StockErrorCode> {
        let e = self.configured.descriptor();
        let p = &self.policy;
        let physical = self.configured.physical();
        let queue = self.configured.queue();
        let queue_identity = &queue.registration.identity;
        let endpoint = self
            .configured
            .homebox()
            .endpoint()
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        if !self.configured.credentials().matches_endpoint(&endpoint)
            || &self.policy_value != self.configured.reviewed_policy()
            || self.configured.source().access_registration()
                != self.configured.metadata().registration()
            || self.configured.source().registration() != self.configured.homebox().registration()
            || self.configured.metadata() != &e.metadata
            || physical.physical_binding != e.authority.physical_binding
            || physical.dispatcher_epoch != e.dispatcher_epoch
            || queue.validate().is_err()
            || queue_identity.deployment_id != physical.physical_binding.deployment_id.to_string()
            || queue_identity.physical_database_id
                != physical.physical_binding.physical_database_id.to_string()
            || queue_identity.configuration_digest.as_hex()
                != physical.physical_binding.configuration_digest.as_str()
            || queue.registration.dispatcher_owner_id != physical.owner_id.to_string()
            || p.policy_id.is_empty()
            || p.policy_id.len() > 4096
            || !(1..=9_007_199_254_740_991).contains(&p.policy_version)
            || !(1..=9_007_199_254_740_991).contains(&p.policy_epoch)
            || p.actor_id != e.authority.actor_id
            || p.context != e.scope
            || p.target != e.target
            || p.account_id != e.account_id
            || p.group_id != e.group_id
            || p.physical_binding.deployment_id != physical.physical_binding.deployment_id
            || p.physical_binding.physical_database_id
                != physical.physical_binding.physical_database_id
            || p.physical_binding.configuration_digest
                != physical.physical_binding.configuration_digest
            || p.dispatcher_owner_id != physical.owner_id
            || p.dispatcher_epoch != physical.dispatcher_epoch
            || p.source_epoch != e.authority.source_epoch
            || u128::from(p.freshness_millis) != e.freshness.as_millis()
            || self.policy_value.get("maximum").is_some_and(Value::is_null)
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        match (
            &e.authority.qualification,
            e.policy,
            &p.approval_requirement,
            p.maximum,
        ) {
            (
                NativeQualification::Qualified {
                    catalog_digest,
                    registered_build_digest,
                    route_qualification_digest,
                },
                QuantityPolicy::NoHuman { maximum },
                ApprovalRequirement::NoHuman,
                Some(actual_maximum),
            ) if catalog_digest == &self.catalog_digest
                && registered_build_digest == &self.executable.sha256
                && route_qualification_digest == &self.route_digest
                && maximum == actual_maximum =>
            {
                Ok(())
            }
            _ => Err(StockErrorCode::UnsupportedCapability),
        }
    }
}
fn digest_bytes(bytes: &[u8]) -> Result<Digest, StockErrorCode> {
    Digest::parse(format!("{:x}", Sha256::digest(bytes)))
        .map_err(|_| StockErrorCode::ProviderUnqualified)
}
fn digest_value(value: &Value) -> Result<Digest, StockErrorCode> {
    let digest = crate::contracts::semantics::canonical_digest(value)
        .map_err(|_| StockErrorCode::ProviderUnqualified)?;
    Digest::parse(digest).map_err(|_| StockErrorCode::ProviderUnqualified)
}
