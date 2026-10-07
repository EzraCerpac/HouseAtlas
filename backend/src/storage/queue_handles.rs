//! Synchronous shared ports for the existing jobs dispatcher and native owner.
//! Each borrow covers one bounded SQL operation and ends before provider I/O.
use super::*;
use std::{cell::RefCell, rc::Rc};

type SharedSession<'a, C, A, R, Q> = Rc<RefCell<QueueSession<'a, C, A, R, Q>>>;

pub trait QueueJournalPort {
    fn commit_native(
        &mut self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
    ) -> Result<NativeJournalReceipt>;
    fn authorize_dispatch(
        &mut self,
        job: &LeasedJob,
        now: Timestamp,
    ) -> Result<NativeJournalReceipt>;
    fn evidence_inbox(&self) -> Result<QueueEvidenceInbox>;
}

pub struct QueueHandles<'a, C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>>
{
    pub store: QueueStoreHandle<'a, C, A, R, Q>,
    pub journal: QueueJournalHandle<'a, C, A, R, Q>,
}
pub struct QueueStoreHandle<
    'a,
    C,
    A: Authorization,
    R,
    Q: QueueAuthorization<Principal = A::Principal>,
> {
    shared: SharedSession<'a, C, A, R, Q>,
}
pub struct QueueJournalHandle<
    'a,
    C,
    A: Authorization,
    R,
    Q: QueueAuthorization<Principal = A::Principal>,
> {
    shared: SharedSession<'a, C, A, R, Q>,
}
impl<'a, C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'a, C, A, R, Q>
{
    pub fn into_handles(self) -> QueueHandles<'a, C, A, R, Q> {
        let shared = Rc::new(RefCell::new(self));
        QueueHandles {
            store: QueueStoreHandle {
                shared: Rc::clone(&shared),
            },
            journal: QueueJournalHandle { shared },
        }
    }
}
impl<C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>> Clone
    for QueueStoreHandle<'_, C, A, R, Q>
{
    fn clone(&self) -> Self {
        Self {
            shared: Rc::clone(&self.shared),
        }
    }
}
impl<C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>> Clone
    for QueueJournalHandle<'_, C, A, R, Q>
{
    fn clone(&self) -> Self {
        Self {
            shared: Rc::clone(&self.shared),
        }
    }
}
impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueStore for QueueStoreHandle<'_, C, A, R, Q>
{
    type Error = Error;
    fn enqueue(
        &mut self,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: Timestamp,
    ) -> Result<EnqueueOutcome> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .enqueue(request, scope, config, now)
    }
    fn claim_next(&mut self, now: Timestamp, config: &QueueConfig) -> Result<ClaimOutcome> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .claim_next(now, config)
    }
    fn finish(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        report: &FinishReport,
    ) -> Result<JobSnapshot> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .finish(lease, now, report)
    }
    fn snapshot(&mut self, receipt: &ReceiptKey) -> Result<Option<JobSnapshot>> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .snapshot(receipt)
    }
    fn held_job(&mut self) -> Result<Option<HeldJob>> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .held_job()
    }
    fn reconcile(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        evidence: &ReconciliationEvidence,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .reconcile(lease, now, evidence, disposition)
    }
    fn prove_remote_end(
        &mut self,
        evidence: &RemoteEndEvidence,
        now: Timestamp,
    ) -> Result<JobSnapshot> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .prove_remote_end(evidence, now)
    }
}
impl<C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>> QueueJournalPort
    for QueueJournalHandle<'_, C, A, R, Q>
{
    fn commit_native(
        &mut self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
    ) -> Result<NativeJournalReceipt> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .commit_native(job, prepared)
    }
    fn authorize_dispatch(
        &mut self,
        job: &LeasedJob,
        now: Timestamp,
    ) -> Result<NativeJournalReceipt> {
        self.shared
            .try_borrow_mut()
            .map_err(|_| stale())?
            .authorize_dispatch(job, now)
    }
    fn evidence_inbox(&self) -> Result<QueueEvidenceInbox> {
        Ok(self
            .shared
            .try_borrow()
            .map_err(|_| stale())?
            .evidence_inbox())
    }
}
