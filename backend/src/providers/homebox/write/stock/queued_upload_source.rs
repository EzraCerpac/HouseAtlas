//! One-shot original owner GET and genuine installed nonphoto upload preflight.
//! This source never sends, stages, admits, enqueues, or proves provider CAS.
use super::queued_upload_installation::{NativeQueuedUploadInstallationOwner, upload_bytes_digest};
use super::*;
use crate::{
    access as a,
    domain::stock::CapturedAccess,
    media::{
        self, native::RetainedPrincipal, native_queued_upload::NativeQueuedUploadSourcePreparation,
    },
    providers::homebox::{read, recovery::NativeWriterContracts},
};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};
use uuid::Uuid;

struct HostClock;
impl read::Clock for HostClock {
    fn now(&self) -> read::Timestamp {
        let now: chrono::DateTime<chrono::Utc> = SystemTime::now().into();
        read::Timestamp::parse(&now.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
            .expect("SystemTime RFC3339 timestamp")
    }
}
struct OriginalBindings<'captured, 'p> {
    installation: Arc<NativeQueuedUploadInstallationOwner>,
    captured: &'captured CapturedAccess<'p>,
    original: RetainedPrincipal,
    source: &'captured a::SourceGrant,
    partition: &'captured a::PartitionGrant,
    target: StockTarget,
}
impl OriginalBindings<'_, '_> {
    fn check_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<a::SourceAuthorityMetadata, StockErrorCode> {
        self.installation.check_capture_window()?;
        if !std::ptr::eq(guard.principal(), self.captured.principal())
            || !std::ptr::eq(guard.principal(), self.original.principal())
        {
            return Err(StockErrorCode::CapabilityDenied);
        }
        guard.assert_mutation().map_err(upload_access_error)?;
        for source in self.captured.source_grants() {
            guard
                .revalidate_source(source)
                .map_err(upload_access_error)?;
        }
        for partition in self.captured.partition_grants() {
            guard
                .revalidate_source_partition(partition)
                .map_err(upload_access_error)?;
        }
        let metadata = guard
            .persisted_source_metadata(self.partition)
            .map_err(upload_access_error)?;
        let configured = self.installation.configured();
        let e = self.installation.descriptor();
        let r = self.source.reference();
        let scope = configured.homebox().scope();
        if metadata != *configured.metadata()
            || !configured.source().contains(r)
            || r.partition() != *self.partition.partition()
            || r.key.source_kind != a::SourceKind::HomeboxEntity
            || r.key.external_id
                != e.owner
                    .id()
                    .map_err(|_| StockErrorCode::InvalidArgument)?
                    .to_string()
            || r.workspace_id.as_str() != scope.workspace_id.as_str()
            || r.home_id.as_str() != scope.home_id.as_str()
            || r.key.source_instance_id.as_str() != scope.source_instance_id.as_str()
            || r.key.collection_id != scope.collection_id
            || self.original.principal().actor_id().as_str() != e.authority.actor_id.to_string()
            || self.original.principal().scope().workspace_id.as_str()
                != e.context.workspace_id.to_string()
            || self.original.principal().scope().home_id.as_str() != e.context.home_id.to_string()
            || self.target.owner_target().ok().as_ref() != Some(&e.owner)
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        guard.revalidate().map_err(upload_access_error)?;
        Ok(metadata)
    }
    fn fence(
        &self,
        proof: &NativeQueuedUploadSourcePreparation<'_>,
    ) -> Result<a::SourceAuthorityMetadata, StockErrorCode> {
        let mut access = self
            .installation
            .configured()
            .access()
            .try_lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let mut metadata = None;
        access
            .with_mutation_authorization(self.original.principal(), |guard| {
                let before = self.check_guard(guard).map_err(UploadFenceError)?;
                check_stage(
                    proof,
                    guard,
                    &self.original,
                    self.source,
                    self.installation.descriptor().maximum_bytes,
                )
                .map_err(UploadFenceError)?;
                let after = self.check_guard(guard).map_err(UploadFenceError)?;
                if before != after {
                    return Err(UploadFenceError(StockErrorCode::PreflightConflict));
                }
                metadata = Some(after);
                Ok::<(), UploadFenceError>(())
            })
            .map_err(|e| e.0)?;
        metadata.ok_or(StockErrorCode::ResourceUnavailable)
    }
}
struct ObservationIdentity<'captured, 'p> {
    bindings: OriginalBindings<'captured, 'p>,
    issuer: Arc<()>,
    observation: Uuid,
    started_at: Instant,
    metadata: a::SourceAuthorityMetadata,
    raw_digest: Digest,
    scope: read::SourceScope,
    path: String,
    observed_at: String,
}
/// Issued only after the actual configured reader and original mutation fences.
/// No Clone/serde/constructor or reader adoption API exists.
pub struct ConfiguredQueuedUploadObservation<'captured, 'p> {
    identity: Arc<ObservationIdentity<'captured, 'p>>,
    capture: read::CapturedStockEntity,
    proof: NativeQueuedUploadSourcePreparation<'captured>,
}
impl ConfiguredQueuedUploadObservation<'_, '_> {
    pub fn provider_observation(&self) -> Uuid {
        self.identity.observation
    }
}
pub struct QueuedUploadSource<'captured, 'p> {
    identity: Arc<ObservationIdentity<'captured, 'p>>,
    command: StockCommand,
    authority: StockAuthority,
    pending: Mutex<Option<ConfiguredQueuedUploadObservation<'captured, 'p>>>,
}
/// E owns the same original token. DATA cannot construct or clone this evidence.
pub struct QueuedUploadCaptureEvidence<'captured, 'p> {
    identity: Arc<ObservationIdentity<'captured, 'p>>,
    proof: NativeQueuedUploadSourcePreparation<'captured>,
}
impl<'captured> QueuedUploadCaptureEvidence<'captured, '_> {
    pub fn source_preparation(&self) -> &NativeQueuedUploadSourcePreparation<'captured> {
        &self.proof
    }
}
impl<'captured, 'p> QueuedUploadSource<'captured, 'p> {
    pub async fn observe_original(
        installation: &Arc<NativeQueuedUploadInstallationOwner>,
        captured: &'captured CapturedAccess<'p>,
        original: &RetainedPrincipal,
        target: &StockTarget,
        proof: NativeQueuedUploadSourcePreparation<'captured>,
    ) -> Result<ConfiguredQueuedUploadObservation<'captured, 'p>, StockErrorCode> {
        installation.check_capture_window()?;
        if target.resource_kind != ResourceKind::Attachment
            || target.resource_id.is_some()
            || target.entity_id.is_none_or(|id| id.is_nil())
            || target.owner_target().ok().as_ref() != Some(&installation.descriptor().owner)
            || !std::ptr::eq(captured.principal(), original.principal())
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let selected: Vec<_> = captured
            .source_grants()
            .iter()
            .filter(|grant| grant.reference() == proof.source_reference())
            .collect();
        if selected.len() != 1 {
            return Err(StockErrorCode::CapabilityDenied);
        }
        let source = selected[0];
        let partitions: Vec<_> = captured
            .partition_grants()
            .iter()
            .filter(|grant| grant.partition() == &source.reference().partition())
            .collect();
        if partitions.len() != 1 {
            return Err(StockErrorCode::CapabilityDenied);
        }
        let bindings = OriginalBindings {
            installation: installation.clone(),
            captured,
            original: original.clone(),
            source,
            partition: partitions[0],
            target: target.clone(),
        };
        let started_at = Instant::now();
        let metadata = bindings.fence(&proof)?;
        let configured = installation.configured();
        let credentials = configured
            .credentials()
            .bind_original(
                configured.access().clone(),
                captured.principal(),
                source.clone(),
                partitions[0].clone(),
            )
            .map_err(|_| StockErrorCode::CapabilityDenied)?;
        let mut reader = configured
            .homebox()
            .reader(credentials, HostClock)
            .map_err(|_| StockErrorCode::ProviderUnqualified)?;
        check_reader(&reader, installation)?;
        let id = read::Uuid::parse(
            &installation
                .descriptor()
                .owner
                .id()
                .map_err(|_| StockErrorCode::InvalidArgument)?
                .to_string(),
        )
        .map_err(|_| StockErrorCode::InvalidArgument)?;
        let remaining = installation
            .descriptor()
            .freshness
            .checked_sub(started_at.elapsed())
            .ok_or(StockErrorCode::PreflightConflict)?;
        let capture = tokio::time::timeout(remaining, reader.capture_stock_entity(&id))
            .await
            .map_err(|_| StockErrorCode::ResourceUnavailable)?
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        check_reader(&reader, installation)?;
        drop(reader);
        if bindings.fence(&proof)? != metadata
            || started_at.elapsed() > installation.descriptor().freshness
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        if capture.status() != 200
            || capture.method() != "GET"
            || !capture.query().is_empty()
            || capture.path() != format!("/api/v1/entities/{}", id.as_str())
            || capture.entity_id() != &id
            || capture.scope() != &configured.homebox().scope()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let identity = Arc::new(ObservationIdentity {
            issuer: Arc::new(()),
            observation: issue_observation_id()?,
            started_at,
            metadata,
            raw_digest: upload_bytes_digest(capture.original_bytes())?,
            scope: capture.scope().clone(),
            path: capture.path().to_owned(),
            observed_at: capture.retrieved_at().as_str().to_owned(),
            bindings,
        });
        Ok(ConfiguredQueuedUploadObservation {
            identity,
            capture,
            proof,
        })
    }
    pub fn from_observed(
        observation: ConfiguredQueuedUploadObservation<'captured, 'p>,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<Self, StockErrorCode> {
        check_command(
            &observation.identity,
            &observation.proof,
            command,
            authority,
        )?;
        Ok(Self {
            identity: observation.identity.clone(),
            command: command.clone(),
            authority: authority.clone(),
            pending: Mutex::new(Some(observation)),
        })
    }
    pub fn captured(&self) -> &CapturedAccess<'p> {
        self.identity.bindings.captured
    }
    pub fn original(&self) -> &RetainedPrincipal {
        &self.identity.bindings.original
    }
    pub fn original_source(&self) -> &a::SourceGrant {
        self.identity.bindings.source
    }
    pub fn original_partition(&self) -> &a::PartitionGrant {
        self.identity.bindings.partition
    }
    pub fn configured(
        &self,
    ) -> &Arc<crate::config::providers::queued_upload::OriginalQueuedUploadConfigured> {
        self.identity.bindings.installation.configured()
    }
    /// Immutable original capture-window DATA, not a grant or current authority.
    pub fn original_capture_deadline(
        &self,
        budget: &media::WorkBudget,
    ) -> Result<Instant, StockErrorCode> {
        budget
            .check()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        self.check_frozen(&self.command, &self.authority)?;
        let installation = &self.identity.bindings.installation;
        let source_deadline = self
            .identity
            .started_at
            .checked_add(installation.descriptor().freshness)
            .ok_or(StockErrorCode::PreflightConflict)?;
        let deadline = source_deadline.min(installation.original_capture_deadline()?);
        self.check_frozen(&self.command, &self.authority)?;
        budget
            .check()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        if Instant::now() >= deadline {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(deadline)
    }
    fn check_frozen(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<(), StockErrorCode> {
        if command != &self.command || authority != &self.authority {
            return Err(StockErrorCode::PreflightConflict);
        }
        self.identity.bindings.installation.check_capture_window()?;
        if self.identity.started_at.elapsed()
            > self.identity.bindings.installation.descriptor().freshness
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }
}
impl<'captured, 'p> FreshPreparationSourcePort for QueuedUploadSource<'captured, 'p> {
    type Evidence = QueuedUploadCaptureEvidence<'captured, 'p>;
    async fn capture_preparation(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<FreshPreparationCapture<Self::Evidence>, StockErrorCode> {
        self.check_frozen(command, authority)?;
        let observation = self
            .pending
            .try_lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?
            .take()
            .ok_or(StockErrorCode::PreflightConflict)?;
        if !Arc::ptr_eq(&observation.identity, &self.identity) {
            return Err(StockErrorCode::PreflightConflict);
        }
        check_command(&self.identity, &observation.proof, command, authority)?;
        let snapshot = observation.capture.into_fresh(
            &command.context,
            command
                .target
                .owner_target()
                .map_err(|_| StockErrorCode::InvalidArgument)?,
        )?;
        Ok(FreshPreparationCapture {
            evidence: QueuedUploadCaptureEvidence {
                identity: observation.identity,
                proof: observation.proof,
            },
            snapshots: vec![snapshot],
        })
    }
    fn qualify_preparation(
        &self,
        _: &StockCommand,
        _: &StockAuthority,
        _: &DecodedFreshPreparation<Self::Evidence>,
    ) -> Result<StockPreflight, StockErrorCode> {
        Err(StockErrorCode::ProviderUnqualified)
    }
    fn qualify_preparation_in_guard(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<Self::Evidence>,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Result<StockPreflight, StockErrorCode> {
        self.check_frozen(command, authority)?;
        context.revalidate()?;
        let e = capture.evidence();
        let bindings = &self.identity.bindings;
        if !Arc::ptr_eq(&e.identity, &self.identity)
            || !Arc::ptr_eq(&e.identity.issuer, &self.identity.issuer)
            || !std::ptr::eq(context.captured(), bindings.captured)
            || capture.snapshots().len() != 1
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        check_command(&self.identity, &e.proof, command, authority)?;
        if !context
            .queued_upload_installation()
            .is_some_and(|physical| std::ptr::eq(physical.partition(), bindings.partition))
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        if bindings.check_guard(context.guard())? != self.identity.metadata {
            return Err(StockErrorCode::PreflightConflict);
        }
        let snapshot = &capture.snapshots()[0];
        let raw = snapshot.original();
        if raw.scope != self.identity.scope
            || raw.target != bindings.installation.descriptor().owner
            || raw.path != self.identity.path
            || !raw.query.is_empty()
            || raw.observed_at != self.identity.observed_at
            || upload_bytes_digest(&raw.original)? != self.identity.raw_digest
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        // The actual fixed detail decoder has retained all original EntityOut
        // bytes; the pinned repository eagerly loads its attachments. This
        // creates no preservation claim for hidden PUT fields.
        let preparation = Preparation {
            snapshots: vec![NativeSnapshot {
                target: raw.target.clone(),
                value: snapshot.snapshot_value().clone(),
                digest: snapshot.digest().clone(),
                complete: true,
                hidden_fields_preserved: false,
            }],
            staged_upload: Some(e.proof.staged_upload().clone()),
            native_clear_values: vec![],
        };
        let plan =
            map_stock(command, &preparation).map_err(|_| StockErrorCode::UnsupportedCapability)?;
        check_upload_plan(command, &plan, &preparation)?;
        let proof_digest = bindings.installation.admit_original(
            bindings.captured,
            bindings.source,
            context,
            command,
            authority,
            capture.capture_digest(),
        )?;
        // The Source mutex is never held around actual Media body/catalog checks.
        check_stage(
            &e.proof,
            context.guard(),
            &bindings.original,
            bindings.source,
            bindings.installation.descriptor().maximum_bytes,
        )?;
        if bindings.check_guard(context.guard())? != self.identity.metadata {
            return Err(StockErrorCode::PreflightConflict);
        }
        self.check_frozen(command, authority)?;
        let final_digest = bindings.installation.admit_original(
            bindings.captured,
            bindings.source,
            context,
            command,
            authority,
            capture.capture_digest(),
        )?;
        if final_digest != proof_digest {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(StockPreflight {
            preparation,
            provider_observation: command.provider_observation,
            request_digest: command.request_digest.clone(),
            source_epoch: authority.source_epoch,
            preflight_digest: final_digest,
        })
    }
}
fn check_command(
    identity: &ObservationIdentity<'_, '_>,
    proof: &NativeQueuedUploadSourcePreparation<'_>,
    command: &StockCommand,
    authority: &StockAuthority,
) -> Result<(), StockErrorCode> {
    let bindings = &identity.bindings;
    let descriptor = bindings.installation.descriptor();
    bindings.installation.check_capture_window()?;
    let contracts =
        NativeWriterContracts::new().map_err(|_| StockErrorCode::ResourceUnavailable)?;
    if contracts
        .validate_request(&command.original_wire)
        .map_err(|_| StockErrorCode::InvalidArgument)?
        != *command
        || command.command_id != "homebox.file.upload"
        || command.context != descriptor.context
        || command.target != bindings.target
        || command.provider_observation != identity.observation
        || command.approval_receipt_id.is_some()
        || command.native_sync_behavior.is_some()
        || authority != &descriptor.authority
        || identity.started_at.elapsed() > descriptor.freshness
        || command.payload.get("primary") != Some(&Value::Bool(false))
        || !command
            .payload
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|t| descriptor.allowed_types.iter().any(|allowed| allowed == t))
        || command.payload.get("staged")
            != Some(
                &serde_json::to_value(proof.staged_upload())
                    .map_err(|_| StockErrorCode::InvalidArgument)?,
            )
        || command.payload.get("impactId").is_some()
        || command.payload.get("children").is_some()
        || command.payload.get("clear").is_some()
        || proof.staged_upload().byte_size == 0
        || proof.staged_upload().byte_size > descriptor.maximum_bytes
        || proof.staged_upload().byte_size > media::MAX_BYTES as u64
    {
        return Err(StockErrorCode::UnsupportedCapability);
    }
    // Reject UUID normalization of the actual registered owner/partition in the
    // frozen full wire. Opaque collection spelling must match the original source.
    let wire = &command.original_wire;
    if wire["context"]["workspaceId"].as_str() != Some(identity.scope.workspace_id.as_str())
        || wire["context"]["homeId"].as_str() != Some(identity.scope.home_id.as_str())
        || wire["target"]["sourceInstanceId"].as_str()
            != Some(identity.scope.source_instance_id.as_str())
        || wire["target"]["collectionId"].as_str() != Some(identity.scope.collection_id.as_str())
        || wire["target"]["entityId"].as_str()
            != Some(bindings.source.reference().key.external_id.as_str())
    {
        return Err(StockErrorCode::PreflightConflict);
    }
    Ok(())
}
fn check_upload_plan(
    command: &StockCommand,
    plan: &NativePlan,
    preparation: &Preparation,
) -> Result<(), StockErrorCode> {
    let owner = command
        .target
        .owner()
        .map_err(|_| StockErrorCode::InvalidArgument)?;
    let stage = preparation
        .staged_upload
        .as_ref()
        .ok_or(StockErrorCode::InvalidArgument)?;
    let attachment_type = command.payload["type"]
        .as_str()
        .ok_or(StockErrorCode::InvalidArgument)?;
    let fields = vec![
        ("name".into(), stage.filename.clone()),
        ("type".into(), attachment_type.into()),
        ("primary".into(), "false".into()),
    ];
    let expected = json!({"title":stage.filename,"type":attachment_type,"primary":false});
    let ids = preparation.snapshots[0].value["attachments"]
        .as_array()
        .ok_or(StockErrorCode::PreflightConflict)?
        .iter()
        .map(|a| {
            a["id"]
                .as_str()
                .and_then(|id| Uuid::parse_str(id).ok())
                .filter(|id| !id.is_nil())
                .ok_or(StockErrorCode::PreflightConflict)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if plan.request.method != NativeMethod::Post
        || plan.request.path != format!("/api/v1/entities/{owner}/attachments")
        || !plan.request.query.is_empty()
        || plan.success_status != 201
        || plan.response != ResponseKind::Entity
        || plan.request.body
            != (NativeBody::Multipart {
                file_field: "file".into(),
                stage: stage.clone(),
                fields,
            })
        || plan.generated
            != (GeneratedIdentity::EntityMember {
                field: "attachments".into(),
                before_ids: ids,
            })
        || plan.readback.path != format!("/api/v1/entities/{owner}")
        || !plan.readback.query.is_empty()
        || plan.readback.target != command.target
        || plan.readback.absence
        || plan.readback.selector
            != (ReadbackSelector::Member {
                field: "attachments".into(),
            })
        || plan.readback.expected != expected
        || plan.requires_complete_impact
        || plan.max_response_bytes.is_some()
        || preparation.snapshots.len() != 1
        || !preparation.native_clear_values.is_empty()
    {
        return Err(StockErrorCode::UnsupportedCapability);
    }
    Ok(())
}
fn check_stage(
    proof: &NativeQueuedUploadSourcePreparation<'_>,
    guard: &a::TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    source: &a::SourceGrant,
    maximum: u64,
) -> Result<(), StockErrorCode> {
    if proof.staged_upload().byte_size == 0
        || proof.staged_upload().byte_size > maximum
        || proof.staged_upload().byte_size > media::MAX_BYTES as u64
        || proof.source_reference() != source.reference()
    {
        return Err(StockErrorCode::PreflightConflict);
    }
    let budget = media::WorkBudget::new(Duration::from_secs(10), media::Cancellation::default())
        .map_err(|_| StockErrorCode::ResourceUnavailable)?;
    let current = proof
        .current_under_guard(guard, original, source, &budget)
        .map_err(|_| StockErrorCode::PreflightConflict)?;
    current
        .revalidate()
        .map_err(|_| StockErrorCode::PreflightConflict)
}
fn check_reader<T: read::Transport, K: read::Clock>(
    reader: &read::HomeBoxReader<T, K>,
    installation: &NativeQueuedUploadInstallationOwner,
) -> Result<(), StockErrorCode> {
    let expected: read::SourceRegistration = serde_json::from_value(
        serde_json::to_value(installation.configured().homebox().registration())
            .map_err(|_| StockErrorCode::ProviderUnqualified)?,
    )
    .map_err(|_| StockErrorCode::ProviderUnqualified)?;
    let r = reader.registration();
    if reader.scope() != &installation.configured().homebox().scope()
        || reader.metadata_dialect() != crate::providers::homebox::wire::DIALECT
        || r.workspace_id != expected.workspace_id
        || r.home_id != expected.home_id
        || r.source_instance_id != expected.source_instance_id
        || r.collection_id != expected.collection_id
        || r.owner != expected.owner
        || r.partition_mode != expected.partition_mode
        || r.allowed_external_ids != expected.allowed_external_ids
    {
        return Err(StockErrorCode::ProviderUnqualified);
    }
    Ok(())
}
fn issue_observation_id() -> Result<Uuid, StockErrorCode> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| StockErrorCode::ResourceUnavailable)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(Uuid::from_bytes(bytes))
}
struct UploadFenceError(StockErrorCode);
impl From<a::AccessError> for UploadFenceError {
    fn from(error: a::AccessError) -> Self {
        Self(upload_access_error(error))
    }
}
pub(super) fn upload_access_error(error: a::AccessError) -> StockErrorCode {
    match error {
        a::AccessError::Unauthenticated | a::AccessError::Forbidden | a::AccessError::NotFound => {
            StockErrorCode::CapabilityDenied
        }
        _ => StockErrorCode::ResourceUnavailable,
    }
}
