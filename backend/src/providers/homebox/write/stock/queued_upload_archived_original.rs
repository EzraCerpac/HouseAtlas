//! Authenticated publication DATA from the original queued upload preparation.
//! Allocation identity joins the same permit and Storage decoder. Historical
//! observations, epochs and commitments grant no current authority or custody.
use super::queued_upload_history::QueuedUploadHistoricalArtifactRole;
use super::queued_upload_installation::{QueuedUploadProfileDescriptor, upload_value_digest};
use super::*;
use crate::{
    access as a,
    app::homebox_queued_upload_history_publication::UnadmittedQueuedUploadOriginalFrame,
    domain::stock as domain,
    jobs,
    lifecycle::recovery::upload_history_intake::AuthenticatedQueuedUploadOriginalFrame,
    media::WorkBudget,
    providers::homebox::{read, recovery::NativeWriterContracts, wire},
    storage,
};
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{self, DeserializeOwned, DeserializeSeed, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Value, json};
use std::{
    fmt,
    mem::size_of,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const HEAP_MAX: usize = 64 * 1024 * 1024;
const JSON_MAX: usize = 16 * 1024 * 1024;
const NODE_MAX: usize = 100_000;
const TEXT_MAX: usize = 1024 * 1024;

pub(crate) struct ArchivedQueuedUploadSourceFactsIdentity {
    _private: (),
}
pub struct ArchivedQueuedUploadSourceFacts<'permit, 'bytes> {
    frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
    storage_identity: Arc<storage::ArchivedQueuedUploadOriginalFactsIdentity>,
    identity: Arc<ArchivedQueuedUploadSourceFactsIdentity>,
    data: ArchivedSourceDecoded<'bytes>,
}
struct ArchivedSourceDecoded<'bytes> {
    original: domain::ValidatedRequest,
    command: StockCommand,
    authority: StockAuthority,
    plan: NativePlan,
    preflight: StockPreflight,
    owner_preflight: StockPreflight,
    capture_digest: Digest,
    metadata: ArchivedQueuedUploadSourceMetadata,
    reference: a::SourceRef,
    partition: a::SourcePartition,
    actor: String,
    workspace: String,
    home: String,
    role: a::Role,
    snapshot: ArchivedQueuedUploadSourceSnapshot<'bytes>,
    installation: ArchivedQueuedUploadInstallationFacts<'bytes>,
}
pub struct ArchivedQueuedUploadSourceMetadata {
    access_epoch: String,
    registration_version: u64,
    registration_sha256: String,
    registration: a::SourceRegistration,
}
impl ArchivedQueuedUploadSourceMetadata {
    pub fn access_epoch(&self) -> &str {
        &self.access_epoch
    }
    pub fn registration_version(&self) -> u64 {
        self.registration_version
    }
    pub fn registration_sha256(&self) -> &str {
        &self.registration_sha256
    }
    pub fn source_registration_version(&self) -> u64 {
        self.registration_version
    }
    pub fn source_registration_sha256(&self) -> &str {
        &self.registration_sha256
    }
    pub fn registration(&self) -> &a::SourceRegistration {
        &self.registration
    }
}
pub struct ArchivedQueuedUploadSourceSnapshot<'bytes> {
    original: &'bytes [u8],
    scope: read::SourceScope,
    target: StockTarget,
    path: String,
    query: Vec<(String, String)>,
    observed_at: String,
    source: Value,
    snapshot_value: Value,
    digest: Digest,
    method: String,
    status: u16,
    limits: wire::DecodeLimits,
}
impl<'bytes> ArchivedQueuedUploadSourceSnapshot<'bytes> {
    pub fn original(&self) -> &'bytes [u8] {
        self.original
    }
    pub fn scope(&self) -> &read::SourceScope {
        &self.scope
    }
    pub fn target(&self) -> &StockTarget {
        &self.target
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
    pub fn source(&self) -> &Value {
        &self.source
    }
    pub fn snapshot_value(&self) -> &Value {
        &self.snapshot_value
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
    pub fn method(&self) -> &str {
        &self.method
    }
    pub fn status(&self) -> u16 {
        self.status
    }
    pub fn original_decode_limits(&self) -> wire::DecodeLimits {
        self.limits
    }
}
pub struct ArchivedQueuedUploadInstallationFacts<'bytes> {
    descriptor: QueuedUploadProfileDescriptor,
    reviewed_policy: Value,
    catalog_digest: Digest,
    route_digest: Digest,
    artifacts: Vec<ArchivedQueuedUploadArtifactFacts<'bytes>>,
}
impl<'bytes> ArchivedQueuedUploadInstallationFacts<'bytes> {
    pub fn descriptor(&self) -> &QueuedUploadProfileDescriptor {
        &self.descriptor
    }
    pub fn reviewed_policy(&self) -> &Value {
        &self.reviewed_policy
    }
    pub fn catalog_digest(&self) -> &Digest {
        &self.catalog_digest
    }
    pub fn route_digest(&self) -> &Digest {
        &self.route_digest
    }
    pub fn artifacts(&self) -> &[ArchivedQueuedUploadArtifactFacts<'bytes>] {
        &self.artifacts
    }
}
#[derive(PartialEq, Eq)]
pub struct ArchivedQueuedUploadFileObservation {
    device: Option<u64>,
    inode: Option<u64>,
    length: u64,
    modified_seconds: Option<i64>,
    modified_nanoseconds: Option<i64>,
    is_file: bool,
}
impl ArchivedQueuedUploadFileObservation {
    pub fn device(&self) -> Option<u64> {
        self.device
    }
    pub fn inode(&self) -> Option<u64> {
        self.inode
    }
    pub fn length(&self) -> u64 {
        self.length
    }
    pub fn modified_seconds(&self) -> Option<i64> {
        self.modified_seconds
    }
    pub fn modified_nanoseconds(&self) -> Option<i64> {
        self.modified_nanoseconds
    }
    pub fn is_file(&self) -> bool {
        self.is_file
    }
}
pub struct ArchivedQueuedUploadArtifactFacts<'bytes> {
    role: QueuedUploadHistoricalArtifactRole,
    logical_pin: Option<String>,
    digest: Digest,
    bytes: &'bytes [u8],
    retrieved_at: SystemTime,
    before: ArchivedQueuedUploadFileObservation,
    after: ArchivedQueuedUploadFileObservation,
}
impl<'bytes> ArchivedQueuedUploadArtifactFacts<'bytes> {
    pub fn role(&self) -> QueuedUploadHistoricalArtifactRole {
        self.role
    }
    pub fn logical_pin(&self) -> Option<&str> {
        self.logical_pin.as_deref()
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
    pub fn bytes(&self) -> &'bytes [u8] {
        self.bytes
    }
    pub fn retrieved_at(&self) -> SystemTime {
        self.retrieved_at
    }
    pub fn before(&self) -> &ArchivedQueuedUploadFileObservation {
        &self.before
    }
    pub fn after(&self) -> &ArchivedQueuedUploadFileObservation {
        &self.after
    }
}
/// Stock-private borrowed input; no authority, filesystem or configured owner.
pub(super) struct QueuedUploadArchivedInstallationInput<'a> {
    pub(super) installation: &'a ArchivedQueuedUploadInstallationFacts<'a>,
    pub(super) budget: &'a WorkBudget,
    pub(super) metadata: &'a ArchivedQueuedUploadSourceMetadata,
    pub(super) scope: &'a read::SourceScope,
    pub(super) reference: &'a a::SourceRef,
    pub(super) queue: &'a jobs::QueueConfig,
    pub(super) provenance: &'a Value,
    pub(super) effective: &'a Value,
    pub(super) swagger: &'a Value,
    pub(super) catalog: &'a Value,
    pub(super) registration_value: &'a Value,
}
impl<'permit, 'bytes> ArchivedQueuedUploadSourceFacts<'permit, 'bytes> {
    pub fn decode_authenticated(
        frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
        storage: &storage::ArchivedQueuedUploadOriginalFacts<'permit, 'bytes>,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        check(budget)?;
        if !storage.matches_authenticated(frame) {
            return Err(unavailable());
        }
        let selected = frame
            .registry()
            .get(frame.queue_index())
            .ok_or_else(unavailable)?;
        if selected != storage.config() || storage.initial_claim().lease.job_id.0 != frame.job_id()
        {
            return Err(unavailable());
        }
        let publication =
            UnadmittedQueuedUploadOriginalFrame::parse(frame.original_bytes(), budget)?;
        let section = |name| publication.section(name, budget)?.ok_or_else(unavailable);
        let mut heap = Heap::new(budget);
        heap.charge(size_of::<Self>() + 2 * size_of::<Arc<()>>())?;
        // Static schema compilation is charged before either genuine contract
        // constructor. Input-controlled reparses and clones are charged below.
        heap.charge(16 * 1024 * 1024)?;
        let contracts = NativeWriterContracts::new()?;
        let domain_contracts = domain::NativeStockContract::new().map_err(|_| unavailable())?;
        let mut common = Reader::new(section("original")?, &mut heap);
        let original = common.original(&domain_contracts)?;
        common.finish()?;
        if !same_original(&original, storage.original()) {
            return Err(unavailable());
        }
        let mut r = Reader::new(section("source")?, &mut heap);
        let source_original = r.original(&domain_contracts)?;
        if !same_original(&original, &source_original) {
            return Err(unavailable());
        }
        let command: StockCommand = r.typed()?;
        let authority = r.authority()?;
        let plan: NativePlan = r.typed()?;
        let preflight = r.preflight()?;
        let owner_preflight = r.preflight()?;
        let capture_digest = r.digest()?;
        let access_epoch = r.text()?;
        let registration_version = r.u64()?;
        let registration_sha256 = r.text()?;
        let registration_value = r.value()?;
        r.heap.reparse(&registration_value, 5)?;
        let registration =
            serde_json::from_value(registration_value.clone()).map_err(|_| unavailable())?;
        let metadata = ArchivedQueuedUploadSourceMetadata {
            access_epoch,
            registration_version,
            registration_sha256,
            registration,
        };
        let reference = r.typed()?;
        let partition = r.typed()?;
        let actor = r.text()?;
        let workspace = r.text()?;
        let home = r.text()?;
        let role = r.typed()?;
        let scope = r.typed()?;
        let target = r.typed()?;
        let path = r.text()?;
        let query = r.query()?;
        let observed_at = r.text()?;
        let source = r.value()?;
        let snapshot_value = r.value()?;
        let digest = r.digest()?;
        let method = r.text()?;
        let status = r.u16()?;
        let limits = wire::DecodeLimits {
            max_response_bytes: r.usize()?,
            max_entries: r.usize()?,
            max_text_chars: r.usize()?,
        };
        let descriptor = QueuedUploadProfileDescriptor {
            installed_release: r.text()?,
            source_commit: r.text()?,
            executable_sha256: r.digest()?,
            context: r.typed()?,
            owner: r.typed()?,
            account_id: r.text()?,
            group_id: r.text()?,
            authority: r.authority()?,
            policy_id: r.text()?,
            policy_version: r.u64()?,
            policy_epoch: r.u64()?,
            policy_digest: r.digest()?,
            allowed_types: r.texts(4)?,
            maximum_bytes: r.u64()?,
            freshness: r.duration()?,
        };
        let reviewed_policy = r.value()?;
        let catalog_digest = r.digest()?;
        let route_digest = r.digest()?;
        if r.usize()? != 12 {
            return Err(unavailable());
        }
        r.heap
            .charge(12 * size_of::<ArchivedQueuedUploadArtifactFacts<'_>>())?;
        let mut artifacts = Vec::with_capacity(12);
        for i in 0..12 {
            let role = match r.text()?.as_str() {
                "executable" => QueuedUploadHistoricalArtifactRole::Executable,
                "build-provenance" => QueuedUploadHistoricalArtifactRole::BuildProvenance,
                "effective-configuration" => {
                    QueuedUploadHistoricalArtifactRole::EffectiveConfiguration
                }
                "reviewed-source" => QueuedUploadHistoricalArtifactRole::ReviewedSource,
                _ => return Err(unavailable()),
            };
            let logical_pin = if r.boolean()? { Some(r.text()?) } else { None };
            let digest = r.digest()?;
            let retrieved_at = r.time()?;
            let before = r.file()?;
            let after = r.file()?;
            let bytes = section(ARTIFACT_NAMES[i])?;
            artifacts.push(ArchivedQueuedUploadArtifactFacts {
                role,
                logical_pin,
                digest,
                bytes,
                retrieved_at,
                before,
                after,
            });
        }
        r.finish()?;
        let snapshot = ArchivedQueuedUploadSourceSnapshot {
            original: section("source-owner-raw")?,
            scope,
            target,
            path,
            query,
            observed_at,
            source,
            snapshot_value,
            digest,
            method,
            status,
            limits,
        };
        let installation = ArchivedQueuedUploadInstallationFacts {
            descriptor,
            reviewed_policy,
            catalog_digest,
            route_digest,
            artifacts,
        };
        // Private artifact schemas reparse already lexically checked Values.
        let provenance = heap.value(installation.artifacts[1].bytes(), 64 * 1024)?;
        let effective = heap.value(installation.artifacts[2].bytes(), 64 * 1024)?;
        let swagger = heap.value(installation.artifacts[9].bytes(), JSON_MAX)?;
        let catalog = heap.value(
            include_bytes!("../../../../../../contracts/stock-wire3/agent/operation-catalog.json"),
            JSON_MAX,
        )?;
        heap.reparse(&provenance, 3)?;
        heap.reparse(&effective, 2)?;
        heap.reparse(&installation.reviewed_policy, 2)?;
        heap.reparse(&swagger, 3)?;
        heap.reparse(&catalog, 3)?;
        heap.reparse(&registration_value, 3)?;
        heap.charge(128 * 1024)?;
        heap.charge(
            metadata
                .registration()
                .allowed_external_ids
                .len()
                .checked_mul(64)
                .ok_or_else(unavailable)?,
        )?;
        super::queued_upload_installation::validate_archived_original_installation(
            &QueuedUploadArchivedInstallationInput {
                installation: &installation,
                budget,
                metadata: &metadata,
                scope: &snapshot.scope,
                reference: &reference,
                queue: selected,
                provenance: &provenance,
                effective: &effective,
                swagger: &swagger,
                catalog: &catalog,
                registration_value: &registration_value,
            },
        )
        .map_err(|_| unavailable())?;
        let data = ArchivedSourceDecoded {
            original,
            command,
            authority,
            plan,
            preflight,
            owner_preflight,
            capture_digest,
            metadata,
            reference,
            partition,
            actor,
            workspace,
            home,
            role,
            snapshot,
            installation,
        };
        data.validate(
            &contracts,
            section("native-payload")?,
            &provenance,
            &registration_value,
            &mut heap,
        )?;
        check(budget)?;
        Ok(Self {
            frame,
            storage_identity: Arc::clone(storage.identity()),
            identity: Arc::new(ArchivedQueuedUploadSourceFactsIdentity { _private: () }),
            data,
        })
    }
    pub fn matches_authenticated(
        &self,
        frame: &AuthenticatedQueuedUploadOriginalFrame<'_>,
    ) -> bool {
        std::ptr::eq(self.frame, frame)
    }
    pub fn matches_storage_facts(
        &self,
        facts: &storage::ArchivedQueuedUploadOriginalFacts<'_, '_>,
    ) -> bool {
        facts.matches_authenticated(self.frame)
            && Arc::ptr_eq(&self.storage_identity, facts.identity())
    }
    pub(crate) fn frame(&self) -> &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes> {
        self.frame
    }
    pub(crate) fn identity(&self) -> &Arc<ArchivedQueuedUploadSourceFactsIdentity> {
        &self.identity
    }
    pub fn original(&self) -> &domain::ValidatedRequest {
        &self.data.original
    }
    pub fn command(&self) -> &StockCommand {
        &self.data.command
    }
    pub fn authority(&self) -> &StockAuthority {
        &self.data.authority
    }
    pub fn plan(&self) -> &NativePlan {
        &self.data.plan
    }
    pub fn preflight(&self) -> &StockPreflight {
        &self.data.preflight
    }
    pub fn owner_preflight(&self) -> &StockPreflight {
        &self.data.owner_preflight
    }
    pub fn capture_digest(&self) -> &Digest {
        &self.data.capture_digest
    }
    pub fn source_reference(&self) -> &a::SourceRef {
        &self.data.reference
    }
    pub fn partition(&self) -> &a::SourcePartition {
        &self.data.partition
    }
    pub fn observed_actor(&self) -> &str {
        &self.data.actor
    }
    pub fn observed_workspace(&self) -> &str {
        &self.data.workspace
    }
    pub fn observed_home(&self) -> &str {
        &self.data.home
    }
    pub fn observed_role(&self) -> a::Role {
        self.data.role
    }
    pub fn source_metadata(&self) -> &ArchivedQueuedUploadSourceMetadata {
        &self.data.metadata
    }
    pub fn snapshot(&self) -> &ArchivedQueuedUploadSourceSnapshot<'bytes> {
        &self.data.snapshot
    }
    pub fn installation(&self) -> &ArchivedQueuedUploadInstallationFacts<'bytes> {
        &self.data.installation
    }
}
const ARTIFACT_NAMES: [&str; 12] = [
    "artifact-00",
    "artifact-01",
    "artifact-02",
    "artifact-03",
    "artifact-04",
    "artifact-05",
    "artifact-06",
    "artifact-07",
    "artifact-08",
    "artifact-09",
    "artifact-10",
    "artifact-11",
];
impl ArchivedSourceDecoded<'_> {
    fn validate(
        &self,
        contracts: &NativeWriterContracts,
        payload: &[u8],
        provenance: &Value,
        registration_value: &Value,
        heap: &mut Heap<'_>,
    ) -> storage::Result<()> {
        let c = &self.command;
        let a = &self.authority;
        let s = &self.snapshot;
        let d = self.installation.descriptor();
        heap.reparse(self.original.raw(), 8)?;
        if contracts
            .validate_request(self.original.raw())
            .map_err(|_| unavailable())?
            != *c
            || c.original_wire != *self.original.raw()
            || c.command_id != "homebox.file.upload"
            || c.approval_receipt_id.is_some()
            || c.native_sync_behavior.is_some()
            || c.payload.get("impactId").is_some()
            || c.payload.get("children").is_some()
            || c.payload.get("clear").is_some()
            || c.payload.get("primary") != Some(&Value::Bool(false))
            || !c.payload["type"]
                .as_str()
                .is_some_and(|t| d.allowed_types.iter().any(|x| x == t))
            || c.context != d.context
            || c.target.owner_target().map_err(|_| unavailable())? != d.owner
            || a != &d.authority
            || self.role != a::Role::Editor
            || self.actor != a.actor_id.to_string()
            || self.workspace != c.context.workspace_id.to_string()
            || self.home != c.context.home_id.to_string()
            || self.reference.key.source_kind != a::SourceKind::HomeboxEntity
            || self.reference.key.external_id
                != d.owner.id().map_err(|_| unavailable())?.to_string()
            || self.reference.partition() != self.partition
            || self.metadata.registration.partition() != self.partition
            || self.reference.workspace_id.as_str() != self.workspace
            || self.reference.home_id.as_str() != self.home
            || self.reference.key.source_instance_id.as_str()
                != c.target.source_instance_id.to_string()
            || self.reference.key.collection_id != c.target.collection_id.to_string()
            || s.scope.workspace_id.as_str() != self.partition.workspace_id.as_str()
            || s.scope.home_id.as_str() != self.partition.home_id.as_str()
            || s.scope.source_instance_id.as_str() != self.partition.source_instance_id.as_str()
            || s.scope.collection_id != self.partition.collection_id
            || s.target != d.owner
            || s.method != "GET"
            || s.status != 200
            || !s.query.is_empty()
            || s.path != format!("/api/v1/entities/{}", self.reference.key.external_id)
        {
            return Err(unavailable());
        }
        // UUID parsing must never normalize a different original spelling.
        for (encoded, expected) in [
            (
                &c.original_wire["context"]["workspaceId"],
                self.workspace.as_str(),
            ),
            (&c.original_wire["context"]["homeId"], self.home.as_str()),
            (
                &c.original_wire["target"]["sourceInstanceId"],
                s.scope.source_instance_id.as_str(),
            ),
            (
                &c.original_wire["target"]["collectionId"],
                s.scope.collection_id.as_str(),
            ),
            (
                &c.original_wire["target"]["entityId"],
                self.reference.key.external_id.as_str(),
            ),
        ] {
            if encoded.as_str() != Some(expected) {
                return Err(unavailable());
            }
        }
        let cap = wire::DecodeLimits::default();
        if s.limits.max_response_bytes == 0
            || s.limits.max_response_bytes > cap.max_response_bytes
            || s.limits.max_entries == 0
            || s.limits.max_entries > cap.max_entries
            || s.limits.max_text_chars == 0
            || s.limits.max_text_chars > cap.max_text_chars
            || s.original.len() > s.limits.max_response_bytes
        {
            return Err(unavailable());
        }
        read::Timestamp::parse(&s.observed_at).map_err(|_| unavailable())?;
        contracts
            .validate_observed_at(&s.observed_at)
            .map_err(|_| unavailable())?;
        // Preflight precedes both actual wire parser calls, the decoder's owned
        // original Vec and all returned typed detail/source allocations.
        heap.json_charge(s.original, s.limits.max_response_bytes, 10)?;
        let parsed = wire::parse_observation(s.original, s.limits).map_err(|_| unavailable())?;
        let id = read::Uuid::parse(&self.reference.key.external_id).map_err(|_| unavailable())?;
        let detail = wire::decode_detail(s.original, &id, s.limits).map_err(|_| unavailable())?;
        if parsed != s.source
            || detail.source != s.source
            || s.snapshot_value != s.source
            || contracts
                .digest_native(&s.source)
                .map_err(|_| unavailable())?
                != s.digest
        {
            return Err(unavailable());
        }
        let stage = self
            .preflight
            .preparation
            .staged_upload
            .as_ref()
            .ok_or_else(unavailable)?;
        heap.reparse(&s.snapshot_value, 8)?;
        heap.charge(4096)?;
        if stage.byte_size == 0
            || stage.byte_size > d.maximum_bytes
            || stage.byte_size > 10 * 1024 * 1024
            || stage.upload_token.is_nil()
            || c.payload.get("staged")
                != Some(&serde_json::to_value(stage).map_err(|_| unavailable())?)
        {
            return Err(unavailable());
        }
        let preparation = Preparation {
            snapshots: vec![NativeSnapshot {
                target: s.target.clone(),
                value: s.snapshot_value.clone(),
                digest: s.digest.clone(),
                complete: true,
                hidden_fields_preserved: false,
            }],
            staged_upload: Some(stage.clone()),
            native_clear_values: vec![],
        };
        if self.preflight.preparation != preparation
            || self.owner_preflight.preparation != preparation
            || self.preflight.provider_observation != c.provider_observation
            || self.owner_preflight.provider_observation != c.provider_observation
            || self.preflight.request_digest != c.request_digest
            || self.owner_preflight.request_digest != c.request_digest
            || self.preflight.source_epoch != a.source_epoch
            || self.owner_preflight.source_epoch != a.source_epoch
            || map_stock(c, &preparation).map_err(|_| unavailable())? != self.plan
        {
            return Err(unavailable());
        }
        self.check_plan(stage, heap)?;
        heap.reparse(&c.original_wire, 4)?;
        heap.charge(64 * 1024)?;
        let captures = [json!({"scope":s.scope,"target":s.target,"path":s.path,
            "query":s.query,"observedAt":s.observed_at,
            "originalSha256":bounded_bytes_digest(s.original, heap.budget)?,"nativeDigest":s.digest})];
        let qualification = match &a.qualification {
            NativeQualification::Qualified {
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            } => {
                json!({"kind":"qualified","catalogDigest":catalog_digest,"registeredBuildDigest":registered_build_digest,"routeQualificationDigest":route_qualification_digest})
            }
            NativeQualification::SyntheticFixture => return Err(unavailable()),
        };
        let capture = json!({"originalRequest":c.original_wire,"actorId":a.actor_id,
            "sourceEpoch":a.source_epoch,"authorityDigest":a.authority_digest,
            "deploymentId":a.physical_binding.deployment_id,"physicalDatabaseId":a.physical_binding.physical_database_id,
            "configurationDigest":a.physical_binding.configuration_digest,"qualification":qualification,"captures":captures});
        if contracts
            .digest_native(&capture)
            .map_err(|_| unavailable())?
            != self.capture_digest
        {
            return Err(unavailable());
        }
        let artifacts = self.installation.artifacts();
        let policy = &provenance["reviewedUploadPolicy"];
        let dispatcher_id: uuid::Uuid = serde_json::from_value(policy["dispatcherOwnerId"].clone())
            .map_err(|_| unavailable())?;
        heap.reparse(registration_value, 3)?;
        let owner_digest = json!({"kind":"homebox-queued-upload-original-installed-capture-v1",
            "build":artifacts[0].digest(),"provenance":artifacts[1].digest(),"effectiveConfiguration":artifacts[2].digest(),
            "sourceArtifacts":artifacts[3..].iter().map(|x| x.digest()).collect::<Vec<_>>(),
            "catalog":self.installation.catalog_digest(),"routes":self.installation.route_digest(),"policy":d.policy_digest,
            "physicalBinding":{"deploymentId":a.physical_binding.deployment_id,"physicalDatabaseId":a.physical_binding.physical_database_id,
                "configurationDigest":a.physical_binding.configuration_digest},
            "dispatcherOwnerId":dispatcher_id,"dispatcherEpoch":policy["dispatcherEpoch"],
            "sourceEpoch":a.source_epoch,"accessEpoch":self.metadata.access_epoch(),
            "registrationVersion":self.metadata.registration_version(),"registrationDigest":self.metadata.registration_sha256(),
            "registration":self.metadata.registration(),"captureDigest":self.capture_digest,"requestDigest":c.request_digest,
            "observation":c.provider_observation});
        if upload_value_digest(&owner_digest).map_err(|_| unavailable())?
            != self.owner_preflight.preflight_digest
        {
            return Err(unavailable());
        }
        let wrapped = json!({"kind":"homebox-decoded-fresh-preflight-v1","captureDigest":self.capture_digest,
            "ownerPreflightDigest":self.owner_preflight.preflight_digest,
            "snapshots":[{"target":s.target,"digest":s.digest,"complete":true,"hiddenFieldsPreserved":false}],
            "stagedUpload":stage,"nativeClearValues":[]});
        if contracts
            .digest_native(&wrapped)
            .map_err(|_| unavailable())?
            != self.preflight.preflight_digest
        {
            return Err(unavailable());
        }
        heap.reparse(&c.original_wire, 4)?;
        heap.charge(payload.len().checked_mul(6).ok_or_else(unavailable)?)?;
        let actual = heap.value(payload, 1024 * 1024)?;
        let expected = serde_json::to_value(UploadPreparedPayload {
            format: crate::media::native_queued_upload::NATIVE_QUEUED_UPLOAD_PREPARED_CODEC,
            native_source_commit: NATIVE_SOURCE_COMMIT,
            contract_version: CONTRACT_VERSION,
            original_wire: &c.original_wire,
            plan: &self.plan,
        })
        .map_err(|_| unavailable())?;
        if actual != expected {
            return Err(unavailable());
        }
        // The deterministic producer's bytes, including snake_case key order,
        // are the durable native payload, not merely equal JSON DATA.
        let encoded = serde_json::to_vec(&UploadPreparedPayload {
            format: crate::media::native_queued_upload::NATIVE_QUEUED_UPLOAD_PREPARED_CODEC,
            native_source_commit: NATIVE_SOURCE_COMMIT,
            contract_version: CONTRACT_VERSION,
            original_wire: &c.original_wire,
            plan: &self.plan,
        })
        .map_err(|_| unavailable())?;
        if encoded.as_slice() != payload {
            return Err(unavailable());
        }
        Ok(())
    }
    fn check_plan(&self, stage: &StagedUpload, heap: &mut Heap<'_>) -> storage::Result<()> {
        let p = &self.plan;
        let c = &self.command;
        let owner = c.target.owner().map_err(|_| unavailable())?;
        let kind = c.payload["type"].as_str().ok_or_else(unavailable)?;
        let rows = self.snapshot.snapshot_value["attachments"]
            .as_array()
            .ok_or_else(unavailable)?;
        heap.charge(
            rows.len()
                .checked_mul(size_of::<uuid::Uuid>())
                .ok_or_else(unavailable)?
                + stage.filename.len() * 4
                + 4096,
        )?;
        let before_ids = rows
            .iter()
            .map(|row| {
                row["id"]
                    .as_str()
                    .and_then(|s| uuid::Uuid::parse_str(s).ok())
                    .filter(|id| !id.is_nil())
                    .ok_or_else(unavailable)
            })
            .collect::<storage::Result<Vec<_>>>()?;
        let fields = vec![
            ("name".to_owned(), stage.filename.clone()),
            ("type".to_owned(), kind.to_owned()),
            ("primary".to_owned(), "false".to_owned()),
        ];
        if p.request.method != NativeMethod::Post
            || p.request.path != format!("/api/v1/entities/{owner}/attachments")
            || !p.request.query.is_empty()
            || p.success_status != 201
            || p.response != ResponseKind::Entity
            || p.request.body
                != (NativeBody::Multipart {
                    file_field: "file".to_owned(),
                    stage: stage.clone(),
                    fields,
                })
            || p.generated
                != (GeneratedIdentity::EntityMember {
                    field: "attachments".to_owned(),
                    before_ids,
                })
            || p.readback.path != format!("/api/v1/entities/{owner}")
            || !p.readback.query.is_empty()
            || p.readback.target != c.target
            || p.readback.absence
            || p.readback.selector
                != (ReadbackSelector::Member {
                    field: "attachments".to_owned(),
                })
            || p.readback.expected != json!({"title":stage.filename,"type":kind,"primary":false})
            || p.requires_complete_impact
            || p.max_response_bytes.is_some()
        {
            return Err(unavailable());
        }
        Ok(())
    }
}
#[derive(Serialize)]
struct UploadPreparedPayload<'a> {
    format: &'static str,
    native_source_commit: &'static str,
    contract_version: &'static str,
    original_wire: &'a Value,
    plan: &'a NativePlan,
}
fn same_original(a: &domain::ValidatedRequest, b: &domain::ValidatedRequest) -> bool {
    a.raw() == b.raw()
        && a.id() == b.id()
        && a.context() == b.context()
        && a.request_id() == b.request_id()
        && a.intent_digest() == b.intent_digest()
        && matches!((a.route(),b.route()), (domain::Route::HomeboxNative(x),domain::Route::HomeboxNative(y)) if x.method == y.method && x.path == y.path)
        && a.children().is_empty()
        && b.children().is_empty()
}
/// Monotonic conservative aggregate allocation ledger. Charges are never
/// refunded when temporaries drop, so sequential typed reparses also count.
struct Heap<'a> {
    used: usize,
    budget: &'a WorkBudget,
}
impl<'a> Heap<'a> {
    fn new(budget: &'a WorkBudget) -> Self {
        Self { used: 0, budget }
    }
    fn charge(&mut self, bytes: usize) -> storage::Result<()> {
        check(self.budget)?;
        self.used = self
            .used
            .checked_add(bytes)
            .filter(|n| *n <= HEAP_MAX)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn json_charge(&mut self, bytes: &[u8], maximum: usize, copies: usize) -> storage::Result<()> {
        if bytes.is_empty() || bytes.len() > maximum || maximum > JSON_MAX {
            return Err(unavailable());
        }
        std::str::from_utf8(bytes).map_err(|_| unavailable())?;
        let mut depth = 0usize;
        let mut nodes = 1usize;
        let mut string = false;
        let mut escape = false;
        let mut text = 0usize;
        for (i, b) in bytes.iter().copied().enumerate() {
            if i % 4096 == 0 {
                check(self.budget)?;
            }
            if string {
                text = text.checked_add(1).ok_or_else(unavailable)?;
                if text > TEXT_MAX {
                    return Err(unavailable());
                }
                if escape {
                    escape = false;
                } else if b == b'\\' {
                    escape = true;
                } else if b == b'"' {
                    string = false;
                }
                continue;
            }
            match b {
                b'"' => {
                    string = true;
                    text = 0;
                    nodes += 1;
                }
                b'{' | b'[' => {
                    depth += 1;
                    nodes += 1;
                    if depth > 64 {
                        return Err(unavailable());
                    }
                }
                b'}' | b']' => {
                    depth = depth.checked_sub(1).ok_or_else(unavailable)?;
                }
                b',' | b':' => {
                    nodes += 1;
                }
                _ => {}
            }
            if nodes > NODE_MAX {
                return Err(unavailable());
            }
        }
        if string || depth != 0 {
            return Err(unavailable());
        }
        // Includes map nodes/key buffers, Vec spare capacity, Value/typed
        // structs, decoded strings and serde/canonicalization working storage.
        let footprint = bytes
            .len()
            .checked_mul(4)
            .and_then(|n| nodes.checked_mul(256).and_then(|v| n.checked_add(v)))
            .ok_or_else(unavailable)?;
        self.charge(footprint.checked_mul(copies).ok_or_else(unavailable)?)
    }
    fn value(&mut self, bytes: &[u8], maximum: usize) -> storage::Result<Value> {
        self.json_charge(bytes, maximum, 1)?;
        let mut decoder = serde_json::Deserializer::from_slice(bytes);
        let value = JsonSeed {
            depth: 0,
            budget: self.budget,
        }
        .deserialize(&mut decoder)
        .map_err(|_| unavailable())?;
        decoder.end().map_err(|_| unavailable())?;
        check(self.budget)?;
        Ok(value)
    }
    fn reparse(&mut self, value: &Value, copies: usize) -> storage::Result<()> {
        let (bytes, nodes) = value_size(value, 0, self.budget)?;
        self.charge(
            bytes
                .checked_mul(4)
                .and_then(|n| nodes.checked_mul(256).and_then(|v| n.checked_add(v)))
                .and_then(|n| n.checked_mul(copies))
                .ok_or_else(unavailable)?,
        )
    }
}
fn value_size(value: &Value, depth: usize, budget: &WorkBudget) -> storage::Result<(usize, usize)> {
    check(budget)?;
    if depth > 64 {
        return Err(unavailable());
    }
    let mut bytes = 32usize;
    let mut nodes = 1usize;
    let mut add = |v: &Value| -> storage::Result<()> {
        let (b, n) = value_size(v, depth + 1, budget)?;
        bytes = bytes.checked_add(b).ok_or_else(unavailable)?;
        nodes = nodes.checked_add(n).ok_or_else(unavailable)?;
        if nodes > NODE_MAX {
            return Err(unavailable());
        }
        Ok(())
    };
    match value {
        Value::String(s) => bytes = bytes.checked_add(s.len()).ok_or_else(unavailable)?,
        Value::Array(v) => {
            for item in v {
                add(item)?;
            }
        }
        Value::Object(v) => {
            for item in v.values() {
                add(item)?;
            }
            for key in v.keys() {
                bytes = bytes.checked_add(key.len()).ok_or_else(unavailable)?;
            }
        }
        _ => {}
    }
    Ok((bytes, nodes))
}
/// Duplicate-key-aware JSON value parser used only after lexical allocation
/// preflight. No unchecked blanket decoding of authority/preflight exists.
#[derive(Clone, Copy)]
struct JsonSeed<'a> {
    depth: usize,
    budget: &'a WorkBudget,
}
impl<'de> DeserializeSeed<'de> for JsonSeed<'_> {
    type Value = Value;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        self.budget
            .check()
            .map_err(|_| de::Error::custom("work budget"))?;
        if self.depth > 64 {
            return Err(de::Error::custom("nesting limit"));
        }
        // RawValue distinguishes lexical JSON objects from serde_json's
        // arbitrary_precision private numeric maps and preserves numbers.
        let raw = <&serde_json::value::RawValue>::deserialize(d)?;
        let token = raw.get();
        let mut decoder = serde_json::Deserializer::from_str(token);
        let value = match token.as_bytes().first() {
            Some(b'{') => decoder.deserialize_map(self),
            Some(b'[') => decoder.deserialize_seq(self),
            _ => serde_json::from_str::<Value>(token),
        }
        .map_err(de::Error::custom)?;
        if let Value::Number(n) = &value
            && n.as_f64().is_none_or(|v| !v.is_finite())
        {
            return Err(de::Error::custom("nonfinite number"));
        }
        self.budget
            .check()
            .map_err(|_| de::Error::custom("work budget"))?;
        Ok(value)
    }
}
impl<'de> Visitor<'de> for JsonSeed<'_> {
    type Value = Value;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded unique-key JSON")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut out = Vec::new();
        loop {
            self.budget
                .check()
                .map_err(|_| de::Error::custom("work budget"))?;
            let Some(v) = a.next_element_seed(Self {
                depth: self.depth + 1,
                budget: self.budget,
            })?
            else {
                break;
            };
            out.push(v);
        }
        Ok(Value::Array(out))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut out = serde_json::Map::new();
        loop {
            self.budget
                .check()
                .map_err(|_| de::Error::custom("work budget"))?;
            let Some(key) = a.next_key::<String>()? else {
                break;
            };
            if out.contains_key(&key) {
                return Err(de::Error::custom("duplicate JSON key"));
            }
            let value = a.next_value_seed(Self {
                depth: self.depth + 1,
                budget: self.budget,
            })?;
            out.insert(key, value);
        }
        Ok(Value::Object(out))
    }
}
struct Reader<'a, 'heap, 'budget> {
    rest: &'a [u8],
    heap: &'heap mut Heap<'budget>,
}
impl<'a, 'heap, 'budget> Reader<'a, 'heap, 'budget> {
    fn new(rest: &'a [u8], heap: &'heap mut Heap<'budget>) -> Self {
        Self { rest, heap }
    }
    fn take(&mut self, n: usize) -> storage::Result<&'a [u8]> {
        check(self.heap.budget)?;
        if n > self.rest.len() {
            return Err(unavailable());
        }
        let (out, rest) = self.rest.split_at(n);
        self.rest = rest;
        Ok(out)
    }
    fn u64(&mut self) -> storage::Result<u64> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn i64(&mut self) -> storage::Result<i64> {
        Ok(i64::from_be_bytes(
            self.take(8)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn u32(&mut self) -> storage::Result<u32> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn u16(&mut self) -> storage::Result<u16> {
        Ok(u16::from_be_bytes(
            self.take(2)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn usize(&mut self) -> storage::Result<usize> {
        usize::try_from(self.u64()?).map_err(|_| unavailable())
    }
    fn boolean(&mut self) -> storage::Result<bool> {
        match self.take(1)? {
            [0] => Ok(false),
            [1] => Ok(true),
            _ => Err(unavailable()),
        }
    }
    fn text(&mut self) -> storage::Result<String> {
        let n = self.usize()?;
        if n == 0 || n > 4096 {
            return Err(unavailable());
        }
        let bytes = self.take(n)?;
        let text = std::str::from_utf8(bytes).map_err(|_| unavailable())?;
        self.heap.charge(n + size_of::<String>())?;
        Ok(text.to_owned())
    }
    fn texts(&mut self, maximum: usize) -> storage::Result<Vec<String>> {
        let n = self.usize()?;
        if n > maximum {
            return Err(unavailable());
        }
        self.heap.charge(n * size_of::<String>())?;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            out.push(self.text()?);
        }
        Ok(out)
    }
    fn query(&mut self) -> storage::Result<Vec<(String, String)>> {
        // This producer's sole owner entity GET has the exact empty query.
        if self.usize()? != 0 {
            return Err(unavailable());
        }
        Ok(Vec::new())
    }
    fn value(&mut self) -> storage::Result<Value> {
        let n = self.usize()?;
        let bytes = self.take(n)?;
        self.heap.value(bytes, JSON_MAX)
    }
    fn typed<T: DeserializeOwned + Serialize>(&mut self) -> storage::Result<T> {
        let value = self.value()?;
        self.heap.reparse(&value, 4)?;
        let typed = serde_json::from_value(value.clone()).map_err(|_| unavailable())?;
        if serde_json::to_value(&typed).map_err(|_| unavailable())? != value {
            return Err(unavailable());
        }
        check(self.heap.budget)?;
        Ok(typed)
    }
    fn digest(&mut self) -> storage::Result<Digest> {
        Digest::parse(self.text()?).map_err(|_| unavailable())
    }
    fn duration(&mut self) -> storage::Result<Duration> {
        let secs = self.u64()?;
        let nanos = self.u32()?;
        if nanos >= 1_000_000_000 {
            return Err(unavailable());
        }
        Ok(Duration::new(secs, nanos))
    }
    fn time(&mut self) -> storage::Result<SystemTime> {
        let negative = self.boolean()?;
        let duration = self.duration()?;
        if negative && duration.is_zero() {
            return Err(unavailable());
        }
        if negative {
            UNIX_EPOCH.checked_sub(duration)
        } else {
            UNIX_EPOCH.checked_add(duration)
        }
        .ok_or_else(unavailable)
    }
    fn option_u64(&mut self) -> storage::Result<Option<u64>> {
        if self.boolean()? {
            Ok(Some(self.u64()?))
        } else {
            Ok(None)
        }
    }
    fn option_i64(&mut self) -> storage::Result<Option<i64>> {
        if self.boolean()? {
            Ok(Some(self.i64()?))
        } else {
            Ok(None)
        }
    }
    fn file(&mut self) -> storage::Result<ArchivedQueuedUploadFileObservation> {
        let result = ArchivedQueuedUploadFileObservation {
            device: self.option_u64()?,
            inode: self.option_u64()?,
            length: self.u64()?,
            modified_seconds: self.option_i64()?,
            modified_nanoseconds: self.option_i64()?,
            is_file: self.boolean()?,
        };
        if result
            .modified_nanoseconds
            .is_some_and(|n| !(0..1_000_000_000).contains(&n))
        {
            return Err(unavailable());
        }
        Ok(result)
    }
    fn authority(&mut self) -> storage::Result<StockAuthority> {
        let actor_id = self.typed()?;
        let source_epoch = self.u64()?;
        let authority_digest = self.digest()?;
        let physical_binding = PhysicalBinding {
            deployment_id: self.typed()?,
            physical_database_id: self.typed()?,
            configuration_digest: self.digest()?,
        };
        if self.text()? != "qualified" {
            return Err(unavailable());
        }
        let qualification = NativeQualification::Qualified {
            catalog_digest: self.digest()?,
            registered_build_digest: self.digest()?,
            route_qualification_digest: self.digest()?,
        };
        Ok(StockAuthority {
            actor_id,
            source_epoch,
            authority_digest,
            physical_binding,
            qualification,
        })
    }
    fn preflight(&mut self) -> storage::Result<StockPreflight> {
        if self.usize()? != 1 {
            return Err(unavailable());
        }
        self.heap.charge(size_of::<NativeSnapshot>())?;
        let snapshot = NativeSnapshot {
            target: self.typed()?,
            value: self.value()?,
            digest: self.digest()?,
            complete: self.boolean()?,
            hidden_fields_preserved: self.boolean()?,
        };
        let staged_upload = self.typed()?;
        if self.usize()? != 0 {
            return Err(unavailable());
        }
        let preparation = Preparation {
            snapshots: vec![snapshot],
            staged_upload,
            native_clear_values: vec![],
        };
        Ok(StockPreflight {
            preparation,
            provider_observation: self.typed()?,
            request_digest: self.digest()?,
            source_epoch: self.u64()?,
            preflight_digest: self.digest()?,
        })
    }
    fn original(
        &mut self,
        contracts: &domain::NativeStockContract,
    ) -> storage::Result<domain::ValidatedRequest> {
        let raw = self.value()?;
        self.heap.reparse(&raw, 8)?;
        let original =
            domain::ValidatedRequest::parse(contracts, raw).map_err(|_| unavailable())?;
        let id = self.text()?;
        let context: domain::StockContext = self.typed()?;
        let request_id = self.text()?;
        let digest = self.text()?;
        let method = self.text()?;
        let path = self.text()?;
        if self.usize()? != 0
            || id != "homebox.file.upload"
            || id != original.id().as_str()
            || context != *original.context()
            || request_id != original.request_id()
            || digest != original.intent_digest()
            || !original.children().is_empty()
            || !matches!(original.route(),domain::Route::HomeboxNative(r) if method == "POST" && r.method == domain::Method::Post && path == r.path)
        {
            return Err(unavailable());
        }
        Ok(original)
    }
    fn finish(self) -> storage::Result<()> {
        if self.rest.is_empty() {
            check(self.heap.budget)
        } else {
            Err(unavailable())
        }
    }
}
fn bounded_bytes_digest(bytes: &[u8], budget: &WorkBudget) -> storage::Result<Digest> {
    use sha2::{Digest as _, Sha256};
    let mut digest = Sha256::new();
    for part in bytes.chunks(64 * 1024) {
        check(budget)?;
        digest.update(part);
    }
    check(budget)?;
    Digest::parse(format!("{:x}", digest.finalize())).map_err(|_| unavailable())
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Archived original upload Source facts unavailable",
    )
}
