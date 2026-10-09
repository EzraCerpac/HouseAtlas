//! Bounded immutable history of the original released upload preparation.
//! Pure process-local correlation does not confer current grants, body access,
//! dispatch, Finish, remote deployment, restoration or restart authority.
use super::queued_upload_installation::{
    NativeQueuedUploadInstallationOwner, QueuedUploadProfileDescriptor,
};
use super::*;
use crate::{
    access as a,
    domain::stock::ValidatedRequest,
    media::{self, native_queued_upload::NativeQueuedUploadHistoricalMedia},
    providers::homebox::{recovery::NativeWriterContracts, wire},
    storage,
};
use serde::Serialize;
use serde_json::Value;
use std::{io::Write, mem::size_of, sync::Arc, time::SystemTime};

type Native<'owner, 'captured, 'p> =
    RetainedFreshPreparation<'owner, NativeWriterContracts, QueuedUploadSource<'captured, 'p>>;
const STRUCTURED_MAX: usize = 4 * 1024 * 1024;
const TOTAL_MAX: usize = 80 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueuedUploadHistoricalArtifactRole {
    Executable,
    BuildProvenance,
    EffectiveConfiguration,
    ReviewedSource,
}
/// Scalar observations of the original opened file, not a deploy version.
pub struct QueuedUploadHistoricalFileObservation {
    device: Option<u64>,
    inode: Option<u64>,
    length: u64,
    modified_seconds: Option<i64>,
    modified_nanoseconds: Option<i64>,
    is_file: bool,
}
impl QueuedUploadHistoricalFileObservation {
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
    #[cfg(unix)]
    fn capture(metadata: &std::fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;
        Self {
            device: Some(metadata.dev()),
            inode: Some(metadata.ino()),
            length: metadata.len(),
            modified_seconds: Some(metadata.mtime()),
            modified_nanoseconds: Some(metadata.mtime_nsec()),
            is_file: metadata.is_file(),
        }
    }
    #[cfg(not(unix))]
    fn capture(metadata: &std::fs::Metadata) -> Self {
        Self {
            device: None,
            inode: None,
            length: metadata.len(),
            modified_seconds: None,
            modified_nanoseconds: None,
            is_file: metadata.is_file(),
        }
    }
    fn matches(&self, metadata: &std::fs::Metadata) -> bool {
        let actual = Self::capture(metadata);
        self.device == actual.device
            && self.inode == actual.inode
            && self.length == actual.length
            && self.modified_seconds == actual.modified_seconds
            && self.modified_nanoseconds == actual.modified_nanoseconds
            && self.is_file == actual.is_file
    }
}
pub struct QueuedUploadHistoricalArtifact {
    role: QueuedUploadHistoricalArtifactRole,
    logical_pin: Option<&'static str>,
    bytes: Vec<u8>,
    digest: Digest,
    retrieved_at: SystemTime,
    before: QueuedUploadHistoricalFileObservation,
    after: QueuedUploadHistoricalFileObservation,
}
impl QueuedUploadHistoricalArtifact {
    pub fn role(&self) -> QueuedUploadHistoricalArtifactRole {
        self.role
    }
    pub fn logical_pin(&self) -> Option<&str> {
        self.logical_pin
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
    pub fn retrieved_at(&self) -> SystemTime {
        self.retrieved_at
    }
    pub fn before(&self) -> &QueuedUploadHistoricalFileObservation {
        &self.before
    }
    pub fn after(&self) -> &QueuedUploadHistoricalFileObservation {
        &self.after
    }
}
pub struct QueuedUploadHistoricalInstallation {
    descriptor: QueuedUploadProfileDescriptor,
    reviewed_policy: Value,
    catalog_digest: Digest,
    route_digest: Digest,
    artifacts: Vec<QueuedUploadHistoricalArtifact>,
}
impl QueuedUploadHistoricalInstallation {
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
    pub fn artifacts(&self) -> &[QueuedUploadHistoricalArtifact] {
        &self.artifacts
    }
    fn matches(&self, owner: &NativeQueuedUploadInstallationOwner) -> bool {
        let descriptor = owner.descriptor();
        same_descriptor(&self.descriptor, descriptor)
            && self.reviewed_policy == *owner.historical_policy()
            && self.catalog_digest == *owner.historical_catalog_digest()
            && self.route_digest == *owner.historical_route_digest()
            && self.artifacts.len() == 12
            && owner.historical_artifacts().count() == 12
            && self
                .artifacts
                .iter()
                .zip(owner.historical_artifacts())
                .all(|(stored, actual)| {
                    stored.role == actual.role
                        && stored.logical_pin == actual.logical_pin
                        && stored.bytes == actual.bytes
                        && stored.digest == *actual.digest
                        && stored.retrieved_at == actual.retrieved_at
                        && stored.before.matches(actual.before)
                        && stored.after.matches(actual.after)
                })
    }
}
pub struct QueuedUploadHistoricalSourceSnapshot {
    original: FreshNativeCapture,
    source: Value,
    snapshot_value: Value,
    digest: Digest,
    method: &'static str,
    status: u16,
    limits: wire::DecodeLimits,
}
impl QueuedUploadHistoricalSourceSnapshot {
    pub fn original(&self) -> &FreshNativeCapture {
        &self.original
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
        self.method
    }
    pub fn status(&self) -> u16 {
        self.status
    }
    pub fn original_decode_limits(&self) -> wire::DecodeLimits {
        self.limits
    }
}
/// Only actual released cuts plus the same native/E producer can issue this
/// handle-free historical owner. No Clone, serde or DATA constructor exists.
pub struct NativeQueuedUploadHistoricalPreparation {
    issuer: Arc<()>,
    original: ValidatedRequest,
    command: StockCommand,
    authority: StockAuthority,
    plan: NativePlan,
    preflight: StockPreflight,
    owner_preflight: StockPreflight,
    capture_digest: Digest,
    metadata: a::SourceAuthorityMetadata,
    reference: a::SourceRef,
    partition: a::SourcePartition,
    actor: String,
    workspace: String,
    home: String,
    role: a::Role,
    snapshot: QueuedUploadHistoricalSourceSnapshot,
    installation: QueuedUploadHistoricalInstallation,
}
impl NativeQueuedUploadHistoricalPreparation {
    pub fn capture_released_original(
        native: &Native<'_, '_, '_>,
        recorded: &storage::RecordedOriginalUploadEnqueue,
        execution: &Arc<storage::OriginalQueuedUploadExecution>,
        storage: &storage::ReleasedQueuedUploadOriginalHistory,
        media: &NativeQueuedUploadHistoricalMedia,
        budget: &media::WorkBudget,
    ) -> Result<Self, StockErrorCode> {
        check(budget)?;
        let proof = recorded.proof();
        let upload = execution.upload_cut();
        let prepared = execution.native_preparation();
        let attempt = execution.attempt();
        let journal = execution.journal();
        // Opaque genuine producer/cut correlations precede counting and DATA.
        if !storage.matches_live(recorded, execution)
            || !media.matches_original(upload)
            || !media.matches_prepared(prepared)
            || !attempt.matches_released_upload(&proof)
            || !journal.matches_attempt(attempt)
            || !Arc::ptr_eq(recorded.upload_cut(), upload)
            || !Arc::ptr_eq(journal.upload_cut(), upload)
            || !Arc::ptr_eq(journal.native_preparation(), prepared)
            || !prepared.matches_original(upload)
            || journal.job() != attempt.job()
            || !upload.matches_source_preparation(native.capture().evidence().source_preparation())
        {
            return Err(unavailable());
        }
        prepared
            .validate_prepared_journal(journal, attempt, prepared.prepared(), budget)
            .map_err(|_| unavailable())?;
        let facts = native.source().historical_live_facts(native)?;
        let raw = facts.snapshot.original();
        let limits = native.original_decode_limits();
        if facts.status != 200
            || facts.method != "GET"
            || !same_request(storage.original(), media.original())
            || !same_request(storage.original(), upload.original())
            || storage.original().raw() != &native.command().original_wire
            || media.command() != native.command()
            || media.authority() != native.authority()
            || media.plan() != native.plan()
            || media.preflight() != native.preflight()
            || media.owner_preflight() != native.owner_preflight()
            || media.capture_digest() != native.capture().capture_digest()
            || media.snapshot().original() != raw.original
            || media.snapshot().scope() != &raw.scope
            || media.snapshot().target() != &raw.target
            || media.snapshot().path() != raw.path
            || media.snapshot().query() != raw.query
            || media.snapshot().observed_at() != raw.observed_at
            || media.snapshot().digest() != facts.snapshot.digest()
            || media.source_reference() != facts.reference
            || storage.config() != media.queue_config()
            || storage.request() != media.enqueue_request()
            || storage.scope() != media.canonical_scope()
            || storage.prepared() != media.prepared()
            || storage.prepared() != prepared.prepared()
            || storage.initial_claim() != attempt.job()
            || storage.request().pending_byte_liability != media.pending_byte_liability()
            || storage.journal_receipt().native_payload_digest
                != journal.receipt().native_payload_digest
            || storage.journal_receipt().journal_evidence_digest
                != journal.receipt().journal_evidence_digest
            || media.ordered_impact().len() != 1
            || !storage.original().children().is_empty()
            || native.command().approval_receipt_id.is_some()
            || native.command().command_id != "homebox.file.upload"
            || !native
                .preflight()
                .preparation
                .native_clear_values
                .is_empty()
            || native.preflight().preparation.snapshots.len() != 1
            || media.staged_upload()
                != native
                    .capture()
                    .evidence()
                    .source_preparation()
                    .staged_upload()
            || media.measured_byte_size() != media.staged_upload().byte_size
            || media.pending_byte_liability().reserved_bytes != Some(media.measured_byte_size())
            || !media.pending_byte_liability().required
            || media.prepared().native_payload.len() > 1_048_576
            || media.prepared().prepared_media_evidence.len() > 1_048_576
            || media.queue_config().registration.aliases.len() > 64
            || raw.original.len() > limits.max_response_bytes.min(10 * 1024 * 1024)
        {
            return Err(unavailable());
        }
        facts.installation.validate_historical_artifacts()?;
        let mut tally = Tally {
            structured: 0,
            total: size_of::<Self>() + 64,
            budget,
        };
        tally.structured(size_of::<ValidatedRequest>())?;
        tally.string(&storage.original().context().workspace_id)?;
        tally.string(&storage.original().context().home_id)?;
        tally.string(storage.original().request_id())?;
        tally.string(storage.original().intent_digest())?;
        tally.value_heap(storage.original().raw())?;
        tally.json(storage.original().raw())?;
        tally.structured(size_of::<StockCommand>())?;
        tally.value_heap(&native.command().payload)?;
        tally.value_heap(&native.command().original_wire)?;
        tally.json(native.command())?;
        tally.authority(native.authority())?;
        tally.structured(size_of::<NativePlan>())?;
        tally.value_heap(&native.plan().readback.expected)?;
        if let NativeBody::Json(value) = &native.plan().request.body {
            tally.value_heap(value)?;
        }
        tally.json(native.plan())?;
        tally.preflight(native.preflight())?;
        tally.preflight(native.owner_preflight())?;
        tally.string(native.capture().capture_digest().as_str())?;
        tally.metadata(facts.metadata)?;
        tally.json(facts.reference)?;
        tally.json(facts.partition)?;
        for text in [facts.actor, facts.workspace, facts.home] {
            tally.string(text)?;
        }
        tally.json(&raw.scope)?;
        tally.json(&raw.target)?;
        for text in [&raw.path, &raw.observed_at] {
            tally.string(text)?;
        }
        for (key, value) in &raw.query {
            tally.string(key)?;
            tally.string(value)?;
        }
        tally.value_heap(facts.snapshot.source())?;
        tally.value_heap(facts.snapshot.snapshot_value())?;
        tally.json(facts.snapshot.source())?;
        tally.json(facts.snapshot.snapshot_value())?;
        tally.string(facts.snapshot.digest().as_str())?;
        tally.descriptor(facts.installation.descriptor())?;
        tally.value_heap(facts.installation.historical_policy())?;
        tally.json(facts.installation.historical_policy())?;
        tally.string(facts.installation.historical_catalog_digest().as_str())?;
        tally.string(facts.installation.historical_route_digest().as_str())?;
        tally.buffer(raw.original.len())?;
        let mut artifact_count = 0usize;
        for artifact in facts.installation.historical_artifacts() {
            tally.structured(
                size_of::<QueuedUploadHistoricalArtifact>()
                    + 2 * size_of::<QueuedUploadHistoricalFileObservation>(),
            )?;
            tally.string(artifact.digest.as_str())?;
            if let Some(pin) = artifact.logical_pin {
                tally.string(pin)?;
            }
            tally.buffer(artifact.bytes.len())?;
            artifact_count += 1;
        }
        if artifact_count != 12 {
            return Err(unavailable());
        }
        check(budget)?;
        // All variable-sized inputs are charged before the first deep clone.
        let artifacts = facts
            .installation
            .historical_artifacts()
            .map(|a| QueuedUploadHistoricalArtifact {
                role: a.role,
                logical_pin: a.logical_pin,
                bytes: a.bytes.to_vec(),
                digest: a.digest.clone(),
                retrieved_at: a.retrieved_at,
                before: QueuedUploadHistoricalFileObservation::capture(a.before),
                after: QueuedUploadHistoricalFileObservation::capture(a.after),
            })
            .collect();
        let result = Self {
            issuer: facts.issuer.clone(),
            original: storage.original().clone(),
            command: native.command().clone(),
            authority: native.authority().clone(),
            plan: native.plan().clone(),
            preflight: native.preflight().clone(),
            owner_preflight: native.owner_preflight().clone(),
            capture_digest: native.capture().capture_digest().clone(),
            metadata: facts.metadata.clone(),
            reference: facts.reference.clone(),
            partition: facts.partition.clone(),
            actor: facts.actor.to_owned(),
            workspace: facts.workspace.to_owned(),
            home: facts.home.to_owned(),
            role: facts.role,
            snapshot: QueuedUploadHistoricalSourceSnapshot {
                original: FreshNativeCapture {
                    scope: raw.scope.clone(),
                    target: raw.target.clone(),
                    path: raw.path.clone(),
                    query: raw.query.clone(),
                    original: raw.original.clone(),
                    observed_at: raw.observed_at.clone(),
                },
                source: facts.snapshot.source().clone(),
                snapshot_value: facts.snapshot.snapshot_value().clone(),
                digest: facts.snapshot.digest().clone(),
                method: facts.method,
                status: facts.status,
                limits,
            },
            installation: QueuedUploadHistoricalInstallation {
                descriptor: facts.installation.descriptor().clone(),
                reviewed_policy: facts.installation.historical_policy().clone(),
                catalog_digest: facts.installation.historical_catalog_digest().clone(),
                route_digest: facts.installation.historical_route_digest().clone(),
                artifacts,
            },
        };
        check(budget)?;
        if !result.matches_live(native) {
            return Err(unavailable());
        }
        Ok(result)
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.original
    }
    pub fn command(&self) -> &StockCommand {
        &self.command
    }
    pub fn authority(&self) -> &StockAuthority {
        &self.authority
    }
    pub fn plan(&self) -> &NativePlan {
        &self.plan
    }
    pub fn preflight(&self) -> &StockPreflight {
        &self.preflight
    }
    pub fn owner_preflight(&self) -> &StockPreflight {
        &self.owner_preflight
    }
    pub fn capture_digest(&self) -> &Digest {
        &self.capture_digest
    }
    pub fn source_metadata(&self) -> &a::SourceAuthorityMetadata {
        &self.metadata
    }
    pub fn source_reference(&self) -> &a::SourceRef {
        &self.reference
    }
    pub fn partition(&self) -> &a::SourcePartition {
        &self.partition
    }
    pub fn observed_actor(&self) -> &str {
        &self.actor
    }
    pub fn observed_workspace(&self) -> &str {
        &self.workspace
    }
    pub fn observed_home(&self) -> &str {
        &self.home
    }
    pub fn observed_role(&self) -> a::Role {
        self.role
    }
    pub fn snapshot(&self) -> &QueuedUploadHistoricalSourceSnapshot {
        &self.snapshot
    }
    pub fn installation(&self) -> &QueuedUploadHistoricalInstallation {
        &self.installation
    }
    /// Pure same-issuer and immutable-fact comparison. No Access or clock fence.
    pub fn matches_live(&self, native: &Native<'_, '_, '_>) -> bool {
        let Ok(facts) = native.source().historical_live_facts(native) else {
            return false;
        };
        let raw = facts.snapshot.original();
        let limits = native.original_decode_limits();
        Arc::ptr_eq(&self.issuer, facts.issuer)
            && self.command == *native.command()
            && self.authority == *native.authority()
            && self.plan == *native.plan()
            && self.preflight == *native.preflight()
            && self.owner_preflight == *native.owner_preflight()
            && self.capture_digest == *native.capture().capture_digest()
            && self.original.raw() == &native.command().original_wire
            && self.metadata == *facts.metadata
            && self.reference == *facts.reference
            && self.partition == *facts.partition
            && self.actor == facts.actor
            && self.workspace == facts.workspace
            && self.home == facts.home
            && self.role == facts.role
            && self.snapshot.original.scope == raw.scope
            && self.snapshot.original.target == raw.target
            && self.snapshot.original.path == raw.path
            && self.snapshot.original.query == raw.query
            && self.snapshot.original.original == raw.original
            && self.snapshot.original.observed_at == raw.observed_at
            && self.snapshot.source == *facts.snapshot.source()
            && self.snapshot.snapshot_value == *facts.snapshot.snapshot_value()
            && self.snapshot.digest == *facts.snapshot.digest()
            && self.snapshot.method == facts.method
            && self.snapshot.status == facts.status
            && self.snapshot.limits.max_response_bytes == limits.max_response_bytes
            && self.snapshot.limits.max_entries == limits.max_entries
            && self.snapshot.limits.max_text_chars == limits.max_text_chars
            && self.installation.matches(facts.installation)
    }
}
fn same_request(a: &ValidatedRequest, b: &ValidatedRequest) -> bool {
    a.raw() == b.raw() && a.request_id() == b.request_id() && a.intent_digest() == b.intent_digest()
}
fn same_descriptor(a: &QueuedUploadProfileDescriptor, b: &QueuedUploadProfileDescriptor) -> bool {
    a.installed_release == b.installed_release
        && a.source_commit == b.source_commit
        && a.executable_sha256 == b.executable_sha256
        && a.context == b.context
        && a.owner == b.owner
        && a.account_id == b.account_id
        && a.group_id == b.group_id
        && a.authority == b.authority
        && a.policy_id == b.policy_id
        && a.policy_version == b.policy_version
        && a.policy_epoch == b.policy_epoch
        && a.policy_digest == b.policy_digest
        && a.allowed_types == b.allowed_types
        && a.maximum_bytes == b.maximum_bytes
        && a.freshness == b.freshness
}
fn unavailable() -> StockErrorCode {
    StockErrorCode::ResourceUnavailable
}
fn check(budget: &media::WorkBudget) -> Result<(), StockErrorCode> {
    budget.check().map_err(|_| unavailable())
}
struct Tally<'a> {
    structured: usize,
    total: usize,
    budget: &'a media::WorkBudget,
}
impl Tally<'_> {
    fn structured(&mut self, bytes: usize) -> Result<(), StockErrorCode> {
        check(self.budget)?;
        self.structured = self
            .structured
            .checked_add(bytes)
            .filter(|n| *n <= STRUCTURED_MAX)
            .ok_or_else(unavailable)?;
        self.buffer(bytes)
    }
    fn buffer(&mut self, bytes: usize) -> Result<(), StockErrorCode> {
        check(self.budget)?;
        self.total = self
            .total
            .checked_add(bytes)
            .filter(|n| *n <= TOTAL_MAX)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn string(&mut self, text: &str) -> Result<(), StockErrorCode> {
        self.structured(size_of::<String>() + text.len())
    }
    fn value_heap(&mut self, value: &Value) -> Result<(), StockErrorCode> {
        self.structured(size_of::<Value>() + 64)?;
        match value {
            Value::String(s) => self.structured(s.len())?,
            Value::Array(values) => {
                self.structured(size_of::<Vec<Value>>())?;
                for value in values {
                    self.value_heap(value)?;
                }
            }
            Value::Object(values) => {
                self.structured(size_of::<serde_json::Map<String, Value>>())?;
                for (key, value) in values {
                    self.structured(128)?;
                    self.string(key)?;
                    self.value_heap(value)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn json<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), StockErrorCode> {
        serde_json::to_writer(&mut *self, value).map_err(|_| unavailable())?;
        check(self.budget)
    }
    fn metadata(&mut self, metadata: &a::SourceAuthorityMetadata) -> Result<(), StockErrorCode> {
        self.structured(size_of::<a::SourceAuthorityMetadata>())?;
        self.string(metadata.access_epoch())?;
        self.structured(size_of::<u64>())?;
        self.string(metadata.source_registration_sha256())?;
        let registration = metadata.registration();
        self.structured(size_of::<a::SourceRegistration>())?;
        self.string(registration.workspace_id.as_str())?;
        self.string(registration.home_id.as_str())?;
        self.string(registration.source_instance_id.as_str())?;
        self.string(&registration.collection_id)?;
        for id in &registration.allowed_external_ids {
            self.string(id)?;
        }
        Ok(())
    }
    fn authority(&mut self, a: &StockAuthority) -> Result<(), StockErrorCode> {
        self.structured(size_of::<StockAuthority>())?;
        self.string(a.authority_digest.as_str())?;
        self.string(a.physical_binding.configuration_digest.as_str())?;
        if let NativeQualification::Qualified {
            catalog_digest,
            registered_build_digest,
            route_qualification_digest,
        } = &a.qualification
        {
            for d in [
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            ] {
                self.string(d.as_str())?;
            }
        }
        Ok(())
    }
    fn preflight(&mut self, p: &StockPreflight) -> Result<(), StockErrorCode> {
        self.structured(size_of::<StockPreflight>())?;
        self.string(p.request_digest.as_str())?;
        self.string(p.preflight_digest.as_str())?;
        if !p.preparation.native_clear_values.is_empty() {
            return Err(unavailable());
        }
        for s in &p.preparation.snapshots {
            self.structured(size_of::<NativeSnapshot>())?;
            self.json(&s.target)?;
            self.value_heap(&s.value)?;
            self.json(&s.value)?;
            self.string(s.digest.as_str())?;
        }
        if let Some(stage) = &p.preparation.staged_upload {
            self.json(stage)?;
        }
        Ok(())
    }
    fn descriptor(&mut self, d: &QueuedUploadProfileDescriptor) -> Result<(), StockErrorCode> {
        self.structured(size_of::<QueuedUploadProfileDescriptor>())?;
        for s in [
            &d.installed_release,
            &d.source_commit,
            &d.account_id,
            &d.group_id,
            &d.policy_id,
        ] {
            self.string(s)?;
        }
        for digest in [&d.executable_sha256, &d.policy_digest] {
            self.string(digest.as_str())?;
        }
        self.authority(&d.authority)?;
        self.json(&d.context)?;
        self.json(&d.owner)?;
        for s in &d.allowed_types {
            self.string(s)?;
        }
        Ok(())
    }
}
impl Write for Tally<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let charged = bytes
            .len()
            .checked_mul(4)
            .ok_or_else(|| std::io::Error::other("historical source work bound"))?;
        self.structured(charged)
            .map_err(|_| std::io::Error::other("historical source work bound"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
