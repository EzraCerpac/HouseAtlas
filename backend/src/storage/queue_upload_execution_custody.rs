//! Process-local execution custody for one released original upload journal.
//! Construction correlates original cuts; it does not authorize transport or
//! infer that a native invocation has started or ended.
use super::*;
use crate::{
    app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission,
    media::native_queued_upload::{NativeQueuedUploadOriginal, NativeQueuedUploadPrepared},
    providers::homebox::write::stock::queued_upload_dispatch::{
        CapturedQueuedUploadEffects, QueuedUploadFinishEvidence,
    },
};
use std::cell::Cell;
use std::sync::MutexGuard;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use upload_journal_custody::OriginalUploadJournalCut;
use upload_original_owner::OriginalQueuedUploadAttempt;

const READY: u8 = 0;
const DISPATCH_ENTERED: u8 = 1;
const DISPATCH_RELEASED: u8 = 2;

#[derive(Default)]
enum ExecutionLedger {
    #[default]
    Ready,
    DispatchEntered,
    DispatchReleased,
}

#[derive(Default)]
enum FinishLedger {
    #[default]
    Ready,
    Entered,
    CommittedData(QueueUploadFinishCommittedData),
    ReleaseQualified(QueueUploadFinishCommittedData),
}

/// Committed finish facts remain DATA until the whole original Access bridge
/// qualifies their exact successor. Taking an observation never resets custody.
pub struct QueueUploadFinishCommittedData {
    job: LeasedJob,
    report: FinishReport,
    steps: Vec<QueueStepEvidence>,
    snapshot: JobSnapshot,
    journal_receipt: NativeJournalReceipt,
    outcome_at: Timestamp,
    outcome: QueueUploadFinishOutcomeData,
}
/// The exact SQLite outcome inserted by this finish transaction.
pub struct QueueUploadFinishOutcomeData {
    event_id: i64,
    body: String,
    digest: String,
}
impl QueueUploadFinishOutcomeData {
    pub fn event_id(&self) -> i64 {
        self.event_id
    }
    pub fn body(&self) -> &str {
        &self.body
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    fn retained_data(&self) -> Self {
        Self {
            event_id: self.event_id,
            body: self.body.clone(),
            digest: self.digest.clone(),
        }
    }
}
pub(super) fn load_new_finish_outcome(
    db: &Connection,
    job: &LeasedJob,
    prior_event_id: i64,
    report: &FinishReport,
    at: Timestamp,
) -> Result<QueueUploadFinishOutcomeData> {
    let (event_id, body, stored_digest, codec): (i64, String, String, i64) = db.query_row(
        "SELECT event_id,body,digest,codec_version FROM queue_outcomes \
         WHERE job_id=?1 AND fence=?2 AND event_id>?3 ORDER BY event_id LIMIT 1",
        params![job.lease.job_id.0, decimal(job.lease.fence), prior_event_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    if event_id <= prior_event_id
        || body.len() > MAX_METADATA_BYTES
        || codec != 1
        || stored_digest != digest(body.as_bytes())
    {
        return Err(bad());
    }
    let value = decoded(&body)?;
    let expected_at = decimal(at);
    if value["format"] != "houseatlas-queue-outcome/1"
        || value["kind"] != "finish"
        || value["at"].as_str() != Some(expected_at.as_str())
        || value["job"] != leased_value(job)
        || value["report"] != report_value(report)
        || !value["evidenceCut"].is_array()
        || !value["liabilityCut"].is_array()
    {
        return Err(bad());
    }
    Ok(QueueUploadFinishOutcomeData {
        event_id,
        body,
        digest: stored_digest,
    })
}
impl QueueUploadFinishCommittedData {
    pub fn job(&self) -> &LeasedJob {
        &self.job
    }
    pub fn report(&self) -> &FinishReport {
        &self.report
    }
    pub fn steps(&self) -> &[QueueStepEvidence] {
        &self.steps
    }
    pub fn snapshot(&self) -> &JobSnapshot {
        &self.snapshot
    }
    pub fn journal_receipt(&self) -> &NativeJournalReceipt {
        &self.journal_receipt
    }
    pub fn outcome_at(&self) -> Timestamp {
        self.outcome_at
    }
    pub fn outcome(&self) -> &QueueUploadFinishOutcomeData {
        &self.outcome
    }
    fn retained_data(&self) -> Self {
        Self {
            job: self.job.clone(),
            report: self.report.clone(),
            steps: self.steps.clone(),
            snapshot: self.snapshot.clone(),
            journal_receipt: self.journal_receipt.clone(),
            outcome_at: self.outcome_at,
            outcome: self.outcome.retained_data(),
        }
    }
    fn matches(
        &self,
        job: &LeasedJob,
        report: &FinishReport,
        steps: &[QueueStepEvidence],
        snapshot: &JobSnapshot,
        receipt: &NativeJournalReceipt,
        outcome_at: Timestamp,
    ) -> bool {
        &self.job == job
            && &self.report == report
            && self.steps == steps
            && &self.snapshot == snapshot
            && self.journal_receipt.native_payload_digest == receipt.native_payload_digest
            && self.journal_receipt.journal_evidence_digest == receipt.journal_evidence_digest
            && self.outcome_at == outcome_at
    }
}

#[derive(Default)]
pub struct QueueUploadFinishCommittedObservation {
    data: Cell<Option<QueueUploadFinishCommittedData>>,
    occupied: Cell<bool>,
}
impl QueueUploadFinishCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<QueueUploadFinishCommittedData> {
        self.data.take()
    }
    fn is_unused(&self) -> bool {
        !self.occupied.get()
    }
}

struct PreparedFinishCommit {
    ledger: QueueUploadFinishCommittedData,
    observation: QueueUploadFinishCommittedData,
}

/// Built only from a capture of actual sealed Source effects. Raw report and
/// step fields have no constructor or public setters here.
pub(super) struct QueueUploadFinishInput<'a> {
    job: &'a LeasedJob,
    now: Timestamp,
    report: &'a FinishReport,
    steps: &'a [QueueStepEvidence],
}
impl QueueUploadFinishInput<'_> {
    pub(super) fn job(&self) -> &LeasedJob {
        self.job
    }
    pub(super) fn now(&self) -> Timestamp {
        self.now
    }
    pub(super) fn report(&self) -> &FinishReport {
        self.report
    }
    pub(super) fn steps(&self) -> &[QueueStepEvidence] {
        self.steps
    }
}

/// Exact original attempt and its released journal, consumed once by value.
/// Detached queue rows and copied journal receipts cannot construct this cut.
pub struct OriginalQueuedUploadExecution {
    attempt: OriginalQueuedUploadAttempt,
    journal: OriginalUploadJournalCut,
    source_attempt: AtomicBool,
    dispatch_state: AtomicU8,
    ledger: Mutex<Cell<ExecutionLedger>>,
    finish_ledger: Mutex<Cell<FinishLedger>>,
    // Independent one-way finish header. Its entry requires the sealed Source
    // effect and is intentionally not exposed through a raw report API.
    finish_state: AtomicU8,
}

impl OriginalQueuedUploadExecution {
    pub fn from_original(
        store: &crate::app::Store,
        admission: &OriginalQueuedUploadAdmission<'_, '_, '_, '_, '_>,
        attempt: OriginalQueuedUploadAttempt,
        journal: OriginalUploadJournalCut,
    ) -> Result<Self> {
        if !attempt
            .matches_original_upload(&store.quantity_installation_store_identity(), admission)
            || !journal.matches_attempt(&attempt)
            || journal.job() != attempt.job()
            || !Arc::ptr_eq(journal.upload_cut(), admission.upload_cut())
            || !Arc::ptr_eq(
                journal.native_preparation().upload_cut(),
                admission.upload_cut(),
            )
            || !journal
                .native_preparation()
                .matches_original(admission.upload_cut())
            || journal.prepared() != journal.native_preparation().prepared()
        {
            return Err(conflict());
        }
        Ok(Self {
            attempt,
            journal,
            source_attempt: AtomicBool::new(false),
            dispatch_state: AtomicU8::new(READY),
            ledger: Mutex::new(Cell::new(ExecutionLedger::Ready)),
            finish_ledger: Mutex::new(Cell::new(FinishLedger::Ready)),
            finish_state: AtomicU8::new(READY),
        })
    }

    pub fn attempt(&self) -> &OriginalQueuedUploadAttempt {
        &self.attempt
    }
    pub fn journal(&self) -> &OriginalUploadJournalCut {
        &self.journal
    }
    pub fn native_preparation(&self) -> &Arc<NativeQueuedUploadPrepared> {
        self.journal.native_preparation()
    }
    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        self.journal.upload_cut()
    }
    /// One driver may consume this execution cut. The Source owner calls this
    /// before validation, driver construction, or any other fallible work.
    pub(crate) fn enter_source_attempt(&self) -> Result<()> {
        self.source_attempt
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| conflict())?;
        Ok(())
    }
    /// Pure observation of the exact finish released by the whole Access
    /// bridge. Committed DATA, a caller snapshot, and lock contention do not
    /// create this fact.
    pub fn matches_released_finish(&self, snapshot: &JobSnapshot) -> bool {
        self.finish_ledger.try_lock().is_ok_and(|ledger| {
            let current = ledger.take();
            let released = matches!(&current, FinishLedger::ReleaseQualified(data)
                if &data.snapshot == snapshot);
            ledger.set(current);
            released
        })
    }

    /// Burns the dispatch entry before any fallible provenance or Access check.
    pub(super) fn enter_dispatch<'a>(
        &'a self,
        store: &crate::app::Store,
        admission: &'a OriginalQueuedUploadAdmission<'_, '_, '_, '_, '_>,
    ) -> Result<QueueUploadExecutionCapture<'a>> {
        self.dispatch_state
            .compare_exchange(READY, DISPATCH_ENTERED, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| conflict())?;
        let ledger = self.ledger.try_lock().map_err(|_| conflict())?;
        let prior = ledger.take();
        if !matches!(prior, ExecutionLedger::Ready) {
            ledger.set(prior);
            return Err(conflict());
        }
        ledger.set(ExecutionLedger::DispatchEntered);
        if !self
            .attempt
            .matches_original_upload(&store.quantity_installation_store_identity(), admission)
            || !Arc::ptr_eq(self.upload_cut(), admission.upload_cut())
            || !Arc::ptr_eq(
                self.native_preparation().upload_cut(),
                admission.upload_cut(),
            )
            || !self
                .native_preparation()
                .matches_original(admission.upload_cut())
        {
            return Err(conflict());
        }
        Ok(QueueUploadExecutionCapture {
            execution: self,
            principal: admission.principal(),
            witness_address: std::ptr::from_ref(admission).cast(),
            original: admission.original(),
            receipt: &admission.request().receipt,
            config: admission.config(),
            native: self.native_preparation(),
            prepared: self.native_preparation().prepared(),
            ledger,
        })
    }
}

/// Closed finish capture from the actual sealed Source effect. It cannot be
/// assembled from FinishReport/step DTOs alone.
pub(super) struct QueueUploadFinishCapture<'a, 'native, 'owner, 'captured, 'p> {
    execution: &'a Arc<OriginalQueuedUploadExecution>,
    effects: &'a CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>,
    principal: &'a crate::app::RequestPrincipal,
    witness_address: *const (),
    original: &'a ValidatedRequest,
    receipt: &'a ReceiptKey,
    config: &'a QueueConfig,
    native: &'a Arc<NativeQueuedUploadPrepared>,
    report: &'a FinishReport,
    steps: &'a [QueueStepEvidence],
    observation: &'a QueueUploadFinishCommittedObservation,
    ledger: MutexGuard<'a, Cell<FinishLedger>>,
    prepared: Cell<Option<PreparedFinishCommit>>,
}
impl<'a, 'native, 'owner, 'captured, 'p>
    QueueUploadFinishCapture<'a, 'native, 'owner, 'captured, 'p>
{
    pub(super) fn new<'bundle>(
        store: &crate::app::Store,
        admission: &'a OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        execution: &'a Arc<OriginalQueuedUploadExecution>,
        effects: &'a CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>,
        observation: &'a QueueUploadFinishCommittedObservation,
    ) -> Result<Self> {
        // The irreversible header precedes lock acquisition and all fallible
        // provenance work. No report is selected before exact Source identity.
        execution
            .finish_state
            .compare_exchange(READY, DISPATCH_ENTERED, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| conflict())?;
        let ledger = execution.finish_ledger.try_lock().map_err(|_| conflict())?;
        let prior = ledger.take();
        if !matches!(prior, FinishLedger::Ready) {
            ledger.set(prior);
            return Err(conflict());
        }
        ledger.set(FinishLedger::Entered);
        if !effects.matches_execution(execution)
            || !effects.matches_native(admission.preparation().native())
            || !execution
                .attempt
                .matches_original_upload(&store.quantity_installation_store_identity(), admission)
            || !Arc::ptr_eq(execution.upload_cut(), admission.upload_cut())
            || !Arc::ptr_eq(
                execution.native_preparation().upload_cut(),
                admission.upload_cut(),
            )
            || !execution
                .native_preparation()
                .matches_original(admission.upload_cut())
            || !observation.is_unused()
        {
            return Err(conflict());
        }
        let report = effects.report().ok_or_else(conflict)?;
        let steps = effects.steps();
        if steps.len() > 64
            || steps.iter().any(|step| {
                step.codec.is_empty()
                    || step.codec.len() > 128
                    || step.payload.is_empty()
                    || step.payload.len() > MAX_METADATA_BYTES
            })
        {
            return Err(invalid());
        }
        if matches!(report.remote_activity, RemoteActivity::Invoked(_))
            && execution.dispatch_state.load(Ordering::Acquire) != DISPATCH_RELEASED
        {
            return Err(conflict());
        }
        Ok(Self {
            execution,
            effects,
            principal: admission.principal(),
            witness_address: std::ptr::from_ref(admission).cast(),
            original: admission.original(),
            receipt: &admission.request().receipt,
            config: admission.config(),
            native: execution.native_preparation(),
            report,
            steps,
            observation,
            ledger,
            prepared: Cell::new(None),
        })
    }
    pub(super) fn input(&self, now: Timestamp) -> QueueUploadFinishInput<'_> {
        QueueUploadFinishInput {
            job: self.execution.attempt.job(),
            now,
            report: self.report,
            steps: self.steps,
        }
    }
    pub(super) fn validate_source_view(&self, view: &QueuedUploadFinishEvidence<'_>) -> Result<()> {
        if !self.effects.matches_execution(self.execution)
            || !Arc::ptr_eq(view.execution(), self.execution)
            || !std::ptr::eq(view.report(), self.report)
            || !std::ptr::eq(view.steps(), self.steps)
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn validate_journal(
        &self,
        job: &LeasedJob,
        journal: &JournalEvidenceView,
    ) -> Result<()> {
        let cut = self.execution.journal();
        let prepared = self.native.prepared();
        if cut.job() != job
            || journal.native_codec != prepared.codec
            || journal.native_payload_digest != cut.receipt().native_payload_digest
            || journal.journal_evidence_digest != cut.receipt().journal_evidence_digest
            || journal.prepared_media_digest.as_hex() != digest(&prepared.prepared_media_evidence)
            || journal.prepared_liability != prepared.storage_liability
            || journal.native_payload_digest.as_hex() != digest(&prepared.native_payload)
        {
            return Err(stale());
        }
        Ok(())
    }
    pub(super) fn validate_session<
        C,
        A: Authorization,
        R,
        Q: QueueAuthorization<Principal = A::Principal>,
    >(
        &self,
        session: &QueueSession<'_, C, A, R, Q>,
        input: &QueueUploadFinishInput<'_>,
    ) -> Result<()> {
        let execution = self.execution.as_ref();
        let current = self.ledger.take();
        let entered = matches!(current, FinishLedger::Entered);
        self.ledger.set(current);
        if !entered
            || execution.finish_state.load(Ordering::Acquire) != DISPATCH_ENTERED
            || (matches!(self.report.remote_activity, RemoteActivity::Invoked(_))
                && execution.dispatch_state.load(Ordering::Acquire) != DISPATCH_RELEASED)
            || !execution
                .attempt
                .matches_store_identity(&session.store.quantity_installation_store_identity())
            || execution.attempt.job() != input.job
            || execution.journal.job() != input.job
            || self.config != &session.config
            || !std::ptr::eq(self.original, session.original)
            || !std::ptr::eq(self.receipt, session.receipt)
            || std::ptr::from_ref(self.principal).cast::<()>()
                != std::ptr::from_ref(session.principal).cast::<()>()
            || self.witness_address != std::ptr::from_ref(session.witness).cast::<()>()
            || !Arc::ptr_eq(self.native, execution.native_preparation())
            || !std::ptr::eq(self.report, input.report)
            || !std::ptr::eq(self.steps, input.steps)
            || !self.observation.is_unused()
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn prepare_committed(
        &self,
        input: &QueueUploadFinishInput<'_>,
        snapshot: &JobSnapshot,
        actual_receipt: &NativeJournalReceipt,
        outcome_at: Timestamp,
        outcome: QueueUploadFinishOutcomeData,
    ) -> Result<()> {
        let cut_receipt = self.execution.journal.receipt();
        let prior = self.prepared.take();
        let already_prepared = prior.is_some();
        self.prepared.set(prior);
        if already_prepared
            || actual_receipt.native_payload_digest != cut_receipt.native_payload_digest
            || actual_receipt.journal_evidence_digest != cut_receipt.journal_evidence_digest
            || self.report != input.report
            || self.steps != input.steps
            || self.execution.attempt.job() != input.job
        {
            return Err(conflict());
        }
        let data = QueueUploadFinishCommittedData {
            job: input.job.clone(),
            report: input.report.clone(),
            steps: input.steps.to_vec(),
            snapshot: snapshot.clone(),
            journal_receipt: actual_receipt.clone(),
            outcome_at,
            outcome,
        };
        self.prepared.set(Some(PreparedFinishCommit {
            ledger: data.retained_data(),
            observation: data,
        }));
        Ok(())
    }
    pub(super) fn record_committed(&self) {
        if let Some(prepared) = self.prepared.take() {
            self.ledger
                .set(FinishLedger::CommittedData(prepared.ledger));
            self.observation.data.set(Some(prepared.observation));
            self.observation.occupied.set(true);
        }
    }
    pub(super) fn validate_successor_outcome(&self, db: &Connection) -> Result<()> {
        let current = self.ledger.take();
        let valid: Result<bool> = (|| {
            let FinishLedger::CommittedData(data) = &current else {
                return Ok(false);
            };
            let stored: (String, String, i64) = db.query_row(
                "SELECT body,digest,codec_version FROM queue_outcomes \
                 WHERE event_id=?1 AND job_id=?2 AND fence=?3",
                params![
                    data.outcome.event_id,
                    data.job.lease.job_id.0,
                    decimal(data.job.lease.fence)
                ],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            Ok(stored.0 == data.outcome.body
                && stored.1 == data.outcome.digest
                && stored.2 == 1
                && digest(stored.0.as_bytes()) == stored.1)
        })();
        self.ledger.set(current);
        if !valid? {
            return Err(stale());
        }
        Ok(())
    }
    pub(super) fn record_released(&self, snapshot: &JobSnapshot) -> Result<()> {
        let current = self.ledger.take();
        match current {
            FinishLedger::CommittedData(data)
                if data.matches(
                    self.execution.attempt.job(),
                    self.report,
                    self.steps,
                    snapshot,
                    self.execution.journal.receipt(),
                    data.outcome_at,
                ) =>
            {
                if self
                    .execution
                    .finish_state
                    .compare_exchange(
                        DISPATCH_ENTERED,
                        DISPATCH_RELEASED,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    )
                    .is_err()
                {
                    self.ledger.set(FinishLedger::CommittedData(data));
                    return Err(conflict());
                }
                self.ledger.set(FinishLedger::ReleaseQualified(data));
                Ok(())
            }
            other => {
                self.ledger.set(other);
                Err(conflict())
            }
        }
    }
}

/// Borrows all exact original pins across the synchronous Access bridge.
pub(super) struct QueueUploadExecutionCapture<'a> {
    execution: &'a OriginalQueuedUploadExecution,
    principal: &'a crate::app::RequestPrincipal,
    witness_address: *const (),
    original: &'a ValidatedRequest,
    receipt: &'a ReceiptKey,
    config: &'a QueueConfig,
    native: &'a Arc<NativeQueuedUploadPrepared>,
    prepared: &'a PreparedNativeIntent,
    ledger: MutexGuard<'a, Cell<ExecutionLedger>>,
}

impl QueueUploadExecutionCapture<'_> {
    fn is_entered(&self) -> bool {
        let current = self.ledger.take();
        let entered = matches!(current, ExecutionLedger::DispatchEntered);
        self.ledger.set(current);
        entered
    }
    pub(super) fn validate_session<
        C,
        A: Authorization,
        R,
        Q: QueueAuthorization<Principal = A::Principal>,
    >(
        &self,
        session: &QueueSession<'_, C, A, R, Q>,
        job: &LeasedJob,
    ) -> Result<()> {
        if self.execution.dispatch_state.load(Ordering::Acquire) != DISPATCH_ENTERED
            || !self.is_entered()
            || !self
                .execution
                .attempt
                .matches_store_identity(&session.store.quantity_installation_store_identity())
            || self.execution.attempt.job() != job
            || self.execution.journal.job() != job
            || self.config != &session.config
            || !std::ptr::eq(self.original, session.original)
            || !std::ptr::eq(self.receipt, session.receipt)
            || std::ptr::from_ref(self.principal).cast::<()>()
                != std::ptr::from_ref(session.principal).cast::<()>()
            || self.witness_address != std::ptr::from_ref(session.witness).cast::<()>()
            || !Arc::ptr_eq(self.native, self.execution.native_preparation())
            || !std::ptr::eq(self.prepared, self.native.prepared())
            || self.execution.journal.prepared() != self.prepared
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn validate_journal(
        &self,
        job: &LeasedJob,
        journal: &JournalEvidenceView,
    ) -> Result<()> {
        let cut = self.execution.journal();
        if cut.job() != job
            || journal.native_codec != self.prepared.codec
            || journal.native_payload_digest != cut.receipt().native_payload_digest
            || journal.journal_evidence_digest != cut.receipt().journal_evidence_digest
            || journal.prepared_media_digest.as_hex()
                != digest(&self.prepared.prepared_media_evidence)
            || journal.prepared_liability != self.prepared.storage_liability
            || journal.native_payload_digest.as_hex() != digest(&self.prepared.native_payload)
        {
            return Err(stale());
        }
        Ok(())
    }
    /// Root calls this only after the full native Access wrapper commits,
    /// including every Release recheck and the read transaction COMMIT.
    pub(super) fn record_dispatch_released(&self, receipt: &NativeJournalReceipt) -> Result<()> {
        let cut = self.execution.journal.receipt();
        if !self.is_entered()
            || receipt.native_payload_digest != cut.native_payload_digest
            || receipt.journal_evidence_digest != cut.journal_evidence_digest
        {
            return Err(conflict());
        }
        self.execution
            .dispatch_state
            .compare_exchange(
                DISPATCH_ENTERED,
                DISPATCH_RELEASED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|_| conflict())?;
        self.ledger.set(ExecutionLedger::DispatchReleased);
        Ok(())
    }
}
