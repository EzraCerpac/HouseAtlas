//! Journal custody for the released original queued upload attempt.
//! A committed journal remains DATA until the whole original Access bridge
//! succeeds. Neither a copied intent nor a durable row issues this cut.
use super::upload_original_owner::{OriginalQueuedUploadAttempt, OriginalUploadEnqueueRecord};
use super::*;
use crate::{
    app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission,
    media::native_queued_upload::{NativeQueuedUploadOriginal, NativeQueuedUploadPrepared},
};
use std::cell::Cell;
use std::sync::MutexGuard;

pub struct QueueUploadJournalCommittedData {
    job: LeasedJob,
    prepared: PreparedNativeIntent,
    receipt: NativeJournalReceipt,
}
impl QueueUploadJournalCommittedData {
    pub fn job(&self) -> &LeasedJob {
        &self.job
    }
    pub fn prepared(&self) -> &PreparedNativeIntent {
        &self.prepared
    }
    pub fn receipt(&self) -> &NativeJournalReceipt {
        &self.receipt
    }
    fn retained_data(&self) -> Self {
        Self {
            job: self.job.clone(),
            prepared: self.prepared.clone(),
            receipt: self.receipt.clone(),
        }
    }
    fn matches(
        &self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
        receipt: &NativeJournalReceipt,
    ) -> bool {
        self.job == *job
            && self.prepared == *prepared
            && self.receipt.native_payload_digest == receipt.native_payload_digest
            && self.receipt.journal_evidence_digest == receipt.journal_evidence_digest
    }
}

/// An observation of DATA. Taking it never resets the private journal ledger.
#[derive(Default)]
pub struct QueueUploadJournalCommittedObservation {
    data: Cell<Option<QueueUploadJournalCommittedData>>,
    occupied: Cell<bool>,
}
impl QueueUploadJournalCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<QueueUploadJournalCommittedData> {
        self.data.take()
    }
    fn is_unused(&self) -> bool {
        !self.occupied.get()
    }
}

#[derive(Default)]
pub(super) enum OriginalUploadJournalLedger {
    #[default]
    Empty,
    CommittedData(QueueUploadJournalCommittedData),
    ReleaseQualified(QueueUploadJournalCommittedData),
}
struct PreparedJournalCommit {
    ledger: QueueUploadJournalCommittedData,
    observation: QueueUploadJournalCommittedData,
    cut: QueueUploadJournalCommittedData,
}

/// The issued cut retains the original enqueue record and the SAME opaque
/// Media preparation held by the live bridge. It has no public constructor.
pub struct OriginalUploadJournalCut {
    record: Arc<OriginalUploadEnqueueRecord>,
    data: QueueUploadJournalCommittedData,
    native: Arc<NativeQueuedUploadPrepared>,
}
impl OriginalUploadJournalCut {
    pub fn job(&self) -> &LeasedJob {
        self.data.job()
    }
    pub fn prepared(&self) -> &PreparedNativeIntent {
        self.data.prepared()
    }
    pub fn receipt(&self) -> &NativeJournalReceipt {
        self.data.receipt()
    }
    pub fn native_preparation(&self) -> &Arc<NativeQueuedUploadPrepared> {
        &self.native
    }
    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        self.record.upload_cut()
    }
    pub fn matches_attempt(&self, attempt: &OriginalQueuedUploadAttempt) -> bool {
        Arc::ptr_eq(&self.record, attempt.record())
            && attempt.journal_ledger().try_lock().is_ok_and(|ledger| {
                let current = ledger.take();
                let qualified = matches!(&current, OriginalUploadJournalLedger::ReleaseQualified(data)
                    if data.matches(self.job(), self.prepared(), self.receipt()));
                ledger.set(current);
                qualified
            })
    }
}

/// Owns the record's journal mutex from before Access entry through the entire
/// synchronous bridge. All fallible clones are staged before SQLite COMMIT.
pub(super) struct QueueUploadJournalCapture<'a> {
    attempt: &'a OriginalQueuedUploadAttempt,
    principal: &'a crate::app::RequestPrincipal,
    witness_address: *const (),
    original: &'a ValidatedRequest,
    receipt: &'a ReceiptKey,
    config: &'a QueueConfig,
    native: &'a Arc<NativeQueuedUploadPrepared>,
    ledger: MutexGuard<'a, Cell<OriginalUploadJournalLedger>>,
    prepared_commit: Cell<Option<PreparedJournalCommit>>,
    cut_data: Cell<Option<QueueUploadJournalCommittedData>>,
    observation: &'a QueueUploadJournalCommittedObservation,
}
impl<'a> QueueUploadJournalCapture<'a> {
    fn new<'bundle, 'native, 'owner, 'captured, 'p>(
        attempt: &'a OriginalQueuedUploadAttempt,
        preparation: &'a OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        native: &'a Arc<NativeQueuedUploadPrepared>,
        observation: &'a QueueUploadJournalCommittedObservation,
    ) -> Result<Self> {
        let ledger = attempt.journal_ledger().try_lock().map_err(|_| bad())?;
        let capture = Self {
            attempt,
            principal: preparation.principal(),
            witness_address: std::ptr::from_ref(preparation).cast(),
            original: preparation.original(),
            receipt: &preparation.request().receipt,
            config: preparation.config(),
            native,
            ledger,
            prepared_commit: Cell::new(None),
            cut_data: Cell::new(None),
            observation,
        };
        capture.validate_empty()?;
        Ok(capture)
    }
    fn validate_empty(&self) -> Result<()> {
        let current = self.ledger.take();
        let empty = matches!(current, OriginalUploadJournalLedger::Empty);
        self.ledger.set(current);
        let staged = self.prepared_commit.take();
        let already_staged = staged.is_some();
        self.prepared_commit.set(staged);
        let cut = self.cut_data.take();
        let already_committed = cut.is_some();
        self.cut_data.set(cut);
        if !empty || !self.observation.is_unused() || already_staged || already_committed {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn validate_attempt(
        &self,
        store: &crate::app::Store,
        preparation: &OriginalQueuedUploadAdmission<'_, '_, '_, '_, '_>,
        native: &Arc<NativeQueuedUploadPrepared>,
    ) -> Result<()> {
        if self.witness_address != std::ptr::from_ref(preparation).cast()
            || !std::ptr::eq(self.principal, preparation.principal())
            || !std::ptr::eq(self.original, preparation.original())
            || !std::ptr::eq(self.receipt, &preparation.request().receipt)
            || self.config != preparation.config()
            || !self
                .attempt
                .matches_original_upload(&store.quantity_installation_store_identity(), preparation)
            || !Arc::ptr_eq(self.native, native)
            || !Arc::ptr_eq(native.upload_cut(), preparation.upload_cut())
            || !native.matches_original(preparation.upload_cut())
        {
            return Err(conflict());
        }
        self.validate_empty()
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
        prepared: &PreparedNativeIntent,
    ) -> Result<()> {
        if !self
            .attempt
            .matches_store_identity(&session.store.quantity_installation_store_identity())
            || self.attempt.job() != job
            || !std::ptr::eq(self.native.prepared(), prepared)
            || self.config != &session.config
            || !std::ptr::eq(self.original, session.original)
            || !std::ptr::eq(self.receipt, session.receipt)
            || std::ptr::from_ref(self.principal).cast::<()>()
                != std::ptr::from_ref(session.principal).cast::<()>()
            || self.witness_address != std::ptr::from_ref(session.witness).cast::<()>()
        {
            return Err(conflict());
        }
        self.validate_empty()
    }
    pub(super) fn prepare_committed(
        &self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
        receipt: &NativeJournalReceipt,
    ) -> Result<()> {
        self.validate_empty()?;
        if self.attempt.job() != job || !std::ptr::eq(self.native.prepared(), prepared) {
            return Err(conflict());
        }
        let data = QueueUploadJournalCommittedData {
            job: job.clone(),
            prepared: prepared.clone(),
            receipt: receipt.clone(),
        };
        self.prepared_commit.set(Some(PreparedJournalCommit {
            ledger: data.retained_data(),
            cut: data.retained_data(),
            observation: data,
        }));
        Ok(())
    }
    pub(super) fn record_committed(&self) {
        let Some(staged) = self.prepared_commit.take() else {
            return;
        };
        self.ledger
            .set(OriginalUploadJournalLedger::CommittedData(staged.ledger));
        self.observation.data.set(Some(staged.observation));
        self.observation.occupied.set(true);
        self.cut_data.set(Some(staged.cut));
    }
    /// Called by Root only after the full Access wrapper has succeeded.
    pub(super) fn record_released(&self, receipt: &NativeJournalReceipt) -> Result<()> {
        let current = self.ledger.take();
        match current {
            OriginalUploadJournalLedger::CommittedData(data)
                if data.matches(self.attempt.job(), self.native.prepared(), receipt) =>
            {
                self.ledger
                    .set(OriginalUploadJournalLedger::ReleaseQualified(data));
                Ok(())
            }
            other => {
                self.ledger.set(other);
                Err(conflict())
            }
        }
    }
}

impl OriginalQueuedUploadAttempt {
    pub fn commit_native_owned<'bundle, 'native, 'owner, 'captured, 'p>(
        &self,
        store: &mut crate::app::Store,
        preparation: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        native: &Arc<NativeQueuedUploadPrepared>,
        observation: &QueueUploadJournalCommittedObservation,
    ) -> Result<OriginalUploadJournalCut> {
        let capture = QueueUploadJournalCapture::new(self, preparation, native, observation)?;
        capture.validate_attempt(store, preparation, native)?;
        let receipt =
            store.commit_original_upload_journal_inner(preparation, self, native, &capture)?;
        let current = capture.ledger.take();
        let data = match current {
            OriginalUploadJournalLedger::ReleaseQualified(data)
                if data.matches(self.job(), native.prepared(), &receipt) =>
            {
                data
            }
            other => {
                capture.ledger.set(other);
                return Err(conflict());
            }
        };
        capture
            .ledger
            .set(OriginalUploadJournalLedger::ReleaseQualified(data));
        let cut_data = capture.cut_data.take().ok_or_else(conflict)?;
        Ok(OriginalUploadJournalCut {
            record: Arc::clone(self.record()),
            data: cut_data,
            native: Arc::clone(native),
        })
    }
}
