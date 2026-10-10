//! Fresh journal custody for the genuine release-qualified initial attempt.
//! A captured journal is DATA until the root's entire Access wrapper succeeds.
//! This cut supplies no dispatch, Media approval or cold-recovery authority.
use super::original_owner::{OriginalEnqueueRecord, OriginalQueuedQuantityAttempt};
use super::*;
use crate::{
    app::{RequestPrincipal, homebox_queued_quantity::OriginalQueuedQuantityPreparation},
    providers::homebox::{
        read, write::stock::quantity_queue_prepared::NativeQueuedQuantityPrepared,
    },
};
use std::cell::RefCell;

pub struct QueueOriginalJournalCommittedData {
    job: LeasedJob,
    prepared: PreparedNativeIntent,
    receipt: NativeJournalReceipt,
}
impl QueueOriginalJournalCommittedData {
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

#[derive(Default)]
pub struct QueueOriginalJournalCommittedObservation(
    RefCell<Option<QueueOriginalJournalCommittedData>>,
);
impl QueueOriginalJournalCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<QueueOriginalJournalCommittedData> {
        self.0.borrow_mut().take()
    }
}

pub(super) enum OriginalQuantityJournalLedger {
    Empty,
    CommittedData(QueueOriginalJournalCommittedData),
    ReleaseQualified(QueueOriginalJournalCommittedData),
}

/// Privately issued over the same original record and actual fresh journal cut.
/// Public facts cannot construct this carrier or qualify a copied journal row.
pub struct OriginalQueueJournalCut {
    record: Arc<OriginalEnqueueRecord>,
    data: QueueOriginalJournalCommittedData,
    native: Arc<NativeQueuedQuantityPrepared>,
}
impl OriginalQueueJournalCut {
    pub fn job(&self) -> &LeasedJob {
        self.data.job()
    }
    pub fn prepared(&self) -> &PreparedNativeIntent {
        self.data.prepared()
    }
    pub fn receipt(&self) -> &NativeJournalReceipt {
        self.data.receipt()
    }
    pub fn native_preparation(&self) -> &Arc<NativeQueuedQuantityPrepared> {
        &self.native
    }
    pub fn source_cut(&self) -> &Arc<crate::providers::homebox::write::stock::quantity_queue_original::NativeQueuedQuantityOriginal>{
        self.record.source_cut()
    }
    pub fn media_cut(
        &self,
    ) -> &Arc<crate::media::native_queued_quantity::NativeQueuedMediaOriginal> {
        self.record.media_cut()
    }
    pub fn matches_attempt(&self, attempt: &OriginalQueuedQuantityAttempt) -> bool {
        Arc::ptr_eq(&self.record, attempt.record())
            && attempt.journal_ledger().lock().is_ok_and(|ledger| {
                matches!(&*ledger, OriginalQuantityJournalLedger::ReleaseQualified(cut)
                    if cut.matches(self.job(), self.prepared(), self.receipt()))
            })
    }
}

pub(super) struct QueueOriginalJournalCapture<'a> {
    attempt: &'a OriginalQueuedQuantityAttempt,
    principal: &'a RequestPrincipal,
    witness_address: *const (),
    original: &'a ValidatedRequest,
    receipt: &'a ReceiptKey,
    config: &'a QueueConfig,
    native: &'a Arc<NativeQueuedQuantityPrepared>,
    prepared: &'a PreparedNativeIntent,
    observation: &'a QueueOriginalJournalCommittedObservation,
}
impl<'a> QueueOriginalJournalCapture<'a> {
    fn new<T: read::Transport, K: read::Clock + Send + Sync>(
        attempt: &'a OriginalQueuedQuantityAttempt,
        preparation: &'a OriginalQueuedQuantityPreparation<'_, '_, '_, '_, T, K>,
        native: &'a Arc<NativeQueuedQuantityPrepared>,
        observation: &'a QueueOriginalJournalCommittedObservation,
    ) -> Self {
        Self {
            attempt,
            principal: preparation.principal(),
            witness_address: std::ptr::from_ref(preparation).cast(),
            original: preparation.original(),
            receipt: &preparation.request().receipt,
            config: preparation.config(),
            native,
            prepared: native.prepared(),
            observation,
        }
    }

    pub(super) fn validate_attempt<T: read::Transport, K: read::Clock + Send + Sync>(
        &self,
        store: &crate::app::Store,
        preparation: &OriginalQueuedQuantityPreparation<'_, '_, '_, '_, T, K>,
        native: &Arc<NativeQueuedQuantityPrepared>,
    ) -> Result<()> {
        if !self
            .attempt
            .matches_original_quantity(&store.quantity_installation_store_identity(), preparation)
            || !std::ptr::eq(self.principal, preparation.principal())
            || self.witness_address != std::ptr::from_ref(preparation).cast()
            || !std::ptr::eq(self.original, preparation.original())
            || !std::ptr::eq(self.receipt, &preparation.request().receipt)
            || !self.native.matches_source(preparation.source_cut())
            || self.config != preparation.config()
            || !Arc::ptr_eq(self.native, native)
            || self.prepared != native.prepared()
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
            || self.config != &session.config
            || !std::ptr::eq(self.original, session.original)
            || !std::ptr::eq(self.receipt, session.receipt)
            || std::ptr::from_ref(self.principal).cast::<()>()
                != std::ptr::from_ref(session.principal).cast::<()>()
            || self.witness_address != std::ptr::from_ref(session.witness).cast::<()>()
            || self.attempt.job() != job
            || self.prepared != prepared
        {
            return Err(conflict());
        }
        self.validate_empty()
    }

    fn validate_empty(&self) -> Result<()> {
        if !matches!(
            *self.attempt.journal_ledger().lock().map_err(|_| bad())?,
            OriginalQuantityJournalLedger::Empty
        ) || self.observation.0.borrow().is_some()
        {
            return Err(conflict());
        }
        Ok(())
    }

    pub(super) fn record_committed(
        &self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
        receipt: &NativeJournalReceipt,
    ) -> Result<()> {
        if job != self.attempt.job() || prepared != self.prepared {
            return Err(conflict());
        }
        let data = QueueOriginalJournalCommittedData {
            job: job.clone(),
            prepared: prepared.clone(),
            receipt: receipt.clone(),
        };
        let retained = data.retained_data();
        self.observation.0.replace(Some(data));
        let mut ledger = self.attempt.journal_ledger().lock().map_err(|_| bad())?;
        if !matches!(*ledger, OriginalQuantityJournalLedger::Empty) {
            return Err(conflict());
        }
        *ledger = OriginalQuantityJournalLedger::CommittedData(retained);
        Ok(())
    }

    /// Root calls this only after its complete native physical/Q/Access wrapper
    /// succeeds. The generic journal engine has no promotion path.
    pub(super) fn record_released(&self, receipt: &NativeJournalReceipt) -> Result<()> {
        let mut ledger = self.attempt.journal_ledger().lock().map_err(|_| bad())?;
        match &*ledger {
            OriginalQuantityJournalLedger::CommittedData(data)
                if data.matches(self.attempt.job(), self.prepared, receipt) =>
            {
                *ledger = OriginalQuantityJournalLedger::ReleaseQualified(data.retained_data());
                Ok(())
            }
            _ => Err(conflict()),
        }
    }
}

impl OriginalQueuedQuantityAttempt {
    /// Commit through the original live native owner. Copied prepared DATA is
    /// not accepted as a native producer or journal qualification.
    pub fn commit_native_owned<T: read::Transport, K: read::Clock + Send + Sync>(
        &self,
        store: &mut crate::app::Store,
        preparation: &OriginalQueuedQuantityPreparation<'_, '_, '_, '_, T, K>,
        native: &Arc<NativeQueuedQuantityPrepared>,
        observation: &QueueOriginalJournalCommittedObservation,
    ) -> Result<OriginalQueueJournalCut> {
        let capture = QueueOriginalJournalCapture::new(self, preparation, native, observation);
        capture.validate_attempt(store, preparation, native)?;
        let receipt =
            store.commit_original_quantity_journal_inner(preparation, self, native, &capture)?;
        let ledger = self.journal_ledger().lock().map_err(|_| bad())?;
        let OriginalQuantityJournalLedger::ReleaseQualified(data) = &*ledger else {
            return Err(conflict());
        };
        if !data.matches(self.job(), native.prepared(), &receipt) {
            return Err(conflict());
        }
        Ok(OriginalQueueJournalCut {
            record: Arc::clone(self.record()),
            data: data.retained_data(),
            native: Arc::clone(native),
        })
    }
}
