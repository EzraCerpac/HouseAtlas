//! Initial original preparation DATA, on the actual queue admission transaction.
//! Archived bytes do not retain E, grants, approval or historical qualification.
//! Fresh profile 8 remains unavailable until its independent owners are complete.
use super::*;
use crate::{access, domain::stock as domain, providers::homebox::write::stock as native};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{cell::RefCell, io::Write};

const FORMAT: &str = "houseatlas-jobs-original-preparation/1";
const MAX_CAPTURES: usize = 100;
const MAX_SELECTORS: usize = 1_000;
const MAX_RAW_BYTES: usize = 524_288;

/// Closed encoder output; these bytes are DATA and cannot reconstitute evidence.
pub struct QueueOriginalPreparationData {
    bytes: Vec<u8>,
    sha256: String,
}
impl QueueOriginalPreparationData {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub fn qualification_evidence(&self) -> &'static str {
        "not-archived"
    }

    /// Encode only the closed original carrier and existing queue codecs.
    /// Encoding is no enqueue, disclosure permission or historical attestation.
    pub fn encode<'owner, W, G, F, C, S>(
        original: &domain::NativeQueueOriginalPreparation<'_, '_, 'owner, W, G, F, C, S>,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<Self>
    where
        G: domain::NativeQueueOriginalGraph<'owner, C, S>,
        F: domain::GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        input.validate().map_err(|_| invalid())?;
        config.validate().map_err(|_| invalid())?;
        let request = original.prepared().request();
        let captured = original.captured();
        let principal = captured.principal();
        if config
            .registration
            .resolve(&input.partition, &input.write_scope)
            .map_err(|_| invalid())?
            != *scope
            || input.intent.request_digest.as_hex() != request.intent_digest()
            || input.intent.operation_id != request.id().as_str()
            || request.raw()["idempotencyKey"].as_str() != Some(&input.receipt.mutation_id)
            || input.receipt.workspace_id != principal.scope().workspace_id.as_str()
            || input.receipt.home_id != principal.scope().home_id.as_str()
            || input.receipt.actor_id != principal.actor_id().as_str()
            || request.raw()["target"]["sourceInstanceId"].as_str()
                != Some(&input.partition.source_instance_id)
            || request.raw()["target"]["collectionId"].as_str()
                != Some(&input.partition.collection_id)
        {
            return Err(invalid());
        }
        let retained = original.native();
        let physical = &retained.authority().physical_binding;
        let identity = &config.registration.identity;
        if identity.deployment_id != physical.deployment_id.to_string()
            || identity.physical_database_id != physical.physical_database_id.to_string()
            || identity.configuration_digest.as_hex() != physical.configuration_digest.as_str()
        {
            return Err(invalid());
        }
        let captures = retained.capture().snapshots();
        let selectors = captured
            .source_grants()
            .len()
            .checked_add(captured.partition_grants().len())
            .ok_or_else(unavailable)?;
        if captures.len() > MAX_CAPTURES || selectors > MAX_SELECTORS {
            return Err(unavailable());
        }
        let raw_bytes = captures.iter().try_fold(0usize, |total, capture| {
            total
                .checked_add(capture.original().original.len())
                .ok_or_else(unavailable)
        })?;
        if raw_bytes > MAX_RAW_BYTES {
            return Err(unavailable());
        }
        let sources: Vec<_> = captures
            .iter()
            .map(|snapshot| {
                let raw = snapshot.original();
                CaptureData {
                    scope: &raw.scope,
                    target: &raw.target,
                    path: &raw.path,
                    query: &raw.query,
                    observed_at: &raw.observed_at,
                    original_base64: STANDARD.encode(&raw.original),
                    original_sha256: digest(&raw.original),
                }
            })
            .collect();
        let source_refs: Vec<_> = captured
            .source_grants()
            .iter()
            .map(|g| g.reference())
            .collect();
        let partitions: Vec<_> = captured
            .partition_grants()
            .iter()
            .map(|g| g.partition())
            .collect();
        let packet = Packet {
            format: FORMAT,
            qualification_evidence: "not-archived",
            original: request.raw(),
            original_intent_digest: request.intent_digest(),
            enqueue: request_value(input),
            canonical_scope: scope_value(scope),
            configuration: config_value(config),
            command: retained.command(),
            authority: super::super::stock_activity::codec::encode_original_authority(
                retained.authority(),
            )?,
            owner_preflight: super::super::stock_activity::codec::encode_original_preflight(
                retained.owner_preflight(),
            )?,
            preflight: super::super::stock_activity::codec::encode_original_preflight(
                retained.preflight(),
            )?,
            plan: retained.plan(),
            capture_digest: retained.capture().capture_digest(),
            captures: sources,
            source_refs,
            partitions,
        };
        let mut bounded = BoundedBytes(Vec::new());
        serde_json::to_writer(&mut bounded, &packet).map_err(|_| unavailable())?;
        let bytes = bounded.0;
        let sha256 = digest(&bytes);
        Ok(Self { bytes, sha256 })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Packet<'a> {
    format: &'static str,
    qualification_evidence: &'static str,
    original: &'a Value,
    original_intent_digest: &'a str,
    enqueue: Value,
    canonical_scope: Value,
    configuration: Value,
    command: &'a native::StockCommand,
    authority: Value,
    owner_preflight: Value,
    preflight: Value,
    plan: &'a native::NativePlan,
    capture_digest: &'a native::Digest,
    captures: Vec<CaptureData<'a>>,
    source_refs: Vec<&'a access::SourceRef>,
    partitions: Vec<&'a access::SourcePartition>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureData<'a> {
    scope: &'a crate::providers::homebox::read::SourceScope,
    target: &'a native::StockTarget,
    path: &'a str,
    query: &'a [(String, String)],
    observed_at: &'a str,
    original_base64: String,
    original_sha256: String,
}
struct BoundedBytes(Vec<u8>);
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_METADATA_BYTES.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("Preparation DATA exceeds its bound"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn original_error(error: domain::StockError) -> Error {
    match error {
        domain::StockError::AuthorityChanged | domain::StockError::CapabilityDenied => {
            Error::new("forbidden", "Original preparation authority is unavailable")
        }
        _ => unavailable(),
    }
}
fn unavailable() -> Error {
    Error::new(
        "upstream-unavailable",
        "Original preparation DATA is unavailable",
    )
}

/// A durable SQL cut observed before later release checks. No dispatch, replay,
/// disclosure, successful delivery or historical proof follows from this DATA.
pub struct QueueOriginalPreparationCommittedData {
    snapshot: JobSnapshot,
    preparation: QueueOriginalPreparationData,
}
impl QueueOriginalPreparationCommittedData {
    pub fn snapshot(&self) -> &JobSnapshot {
        &self.snapshot
    }
    pub fn preparation(&self) -> &QueueOriginalPreparationData {
        &self.preparation
    }
}
#[derive(Default)]
pub struct QueueOriginalPreparationObservation(
    RefCell<Option<QueueOriginalPreparationCommittedData>>,
);
impl QueueOriginalPreparationObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<QueueOriginalPreparationCommittedData> {
        self.0.borrow_mut().take()
    }
}

// Private dispatch, implemented only for the actual closed carrier below.
// There is no public success-returning qualifier or DATA reconstruction path.
pub(super) trait InitialPreparationContext {
    fn revalidate(&self) -> Result<()>;
    fn insert(&self, db: &Connection, job: &str) -> Result<QueueOriginalPreparationData>;
    fn committed(&self, snapshot: &JobSnapshot, preparation: QueueOriginalPreparationData);
}
struct OriginalContext<'a, 'p, 'owner, 'guard, W, G, F, C, S: native::FreshPreparationSourcePort> {
    original: &'a domain::NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
    guard: &'a access::TransactionAuthorization<'guard>,
    authority: &'a native::StockAuthority,
    data: QueueOriginalPreparationData,
    observation: &'a QueueOriginalPreparationObservation,
}
impl<'owner, W, G, F, C, S> InitialPreparationContext
    for OriginalContext<'_, '_, 'owner, '_, W, G, F, C, S>
where
    G: domain::NativeQueueOriginalGraph<'owner, C, S>,
    F: domain::GraphAuthorization<W, G>,
    C: native::StockContractPort + Sync,
    S: native::FreshPreparationSourcePort,
{
    fn revalidate(&self) -> Result<()> {
        self.original
            .revalidate(self.guard, self.authority)
            .map_err(original_error)
    }
    fn insert(&self, db: &Connection, job: &str) -> Result<QueueOriginalPreparationData> {
        db.execute("INSERT INTO queue_original_preparations(job_id,data_codec_version,packet,packet_sha256) VALUES(?1,1,?2,?3)", params![job, self.data.bytes(), self.data.sha256()])?;
        let length: i64 = db.query_row("SELECT length(packet) FROM queue_original_preparations WHERE job_id=?1 AND data_codec_version=1", [job], |row| row.get(0))?;
        if !(1..=MAX_METADATA_BYTES as i64).contains(&length) {
            return Err(bad());
        }
        let (bytes, sha256): (Vec<u8>, String) = db.query_row("SELECT packet,packet_sha256 FROM queue_original_preparations WHERE job_id=?1 AND data_codec_version=1", [job], |row| Ok((row.get(0)?, row.get(1)?)))?;
        if bytes != self.data.bytes || sha256 != self.data.sha256 || digest(&bytes) != sha256 {
            return Err(bad());
        }
        Ok(QueueOriginalPreparationData { bytes, sha256 })
    }
    fn committed(&self, snapshot: &JobSnapshot, preparation: QueueOriginalPreparationData) {
        self.observation
            .0
            .replace(Some(QueueOriginalPreparationCommittedData {
                snapshot: snapshot.clone(),
                preparation,
            }));
    }
}

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    /// Source-only fresh admission. Profile 8 is unavailable before DB opening;
    /// this implementation neither installs that schema nor admits a profile.
    /// The actual existing QueueAuthorization and original Domain/native owners
    /// remain mandatory. No capture await runs while Store/Access is borrowed.
    #[expect(
        clippy::too_many_arguments,
        reason = "Explicit original queue, Access and native peers are required"
    )]
    pub fn enqueue_original_prepared<'owner, G, F, NC, S>(
        &mut self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: Timestamp,
        original: &domain::NativeQueueOriginalPreparation<'_, '_, 'owner, Q::Witness, G, F, NC, S>,
        guard: &access::TransactionAuthorization<'_>,
        current_original_authority: &native::StockAuthority,
        observation: &QueueOriginalPreparationObservation,
    ) -> Result<EnqueueOutcome>
    where
        A::Principal: super::super::StagedUploadPrincipal,
        G: domain::NativeQueueOriginalGraph<'owner, NC, S>,
        F: domain::GraphAuthorization<Q::Witness, G>,
        NC: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        use super::super::StagedUploadPrincipal as _;
        if self.store.options.queue_original_preparation_profile
            != super::super::QueueOriginalPreparationProfileSelection::FreshV8
        {
            return Err(unavailable());
        }
        if !std::ptr::eq(self.original, original.prepared().request())
            || !std::ptr::eq(self.witness, original.prepared().witness())
            || !std::ptr::eq(
                self.principal.original_upload_principal(),
                original.captured().principal(),
            )
            || observation.0.borrow().is_some()
        {
            return Err(invalid());
        }
        original
            .revalidate(guard, current_original_authority)
            .map_err(original_error)?;
        let context = OriginalContext {
            original,
            guard,
            authority: current_original_authority,
            data: QueueOriginalPreparationData::encode(original, input, scope, config)?,
            observation,
        };
        self.enqueue_inner_with_original(input, scope, config, now, Some(&context))
    }
}
