use super::*;

/// Durability boundary, supplied by the SQLite owner. All mutations below are
/// atomic transactions, not a read followed by an independently committed write.
///
/// * Enqueue binds the whole exact request to the permanent receipt key. An
///   identical retry returns its existing job; any difference is a conflict.
///   Receipts have no expiry that would permit dispatching a duplicate.
/// * There is one durable global lease row for ALL workspace/home/source
///   partitions. Claim chooses due work in durable enqueue sequence, advances a
///   checked monotonically increasing fence and increments attempts atomically.
/// * Expired running work becomes NeedsReconciliation while keeping that global
///   reservation. It cannot become due work or free the slot automatically.
/// * Finish atomically validates job ID plus the active global fence, records
///   status/acknowledgement/times and releases the reservation only for a definite
///   outcome. A returning original writer may finish its same held fence. A
///   stale fence never changes a row. Hold preserves the reservation.
/// * Reconcile checks the same held fence and durably stores the evidence
///   reference with its resolution. Only qualified quiescence plus complete
///   scoped read-back permits this method to release the global reservation.
/// * Every snapshot/receipt is scoped by the complete supplied receipt key.
///   The application must authorize before calling, including exact retries.
///
/// These are requirements on the adapter, not a claim that a trait implements
/// cross-process exclusion. Provider-side fencing is unavailable here: lease
/// expiry alone is never evidence that an old physical write has stopped.
pub trait QueueStore {
    type Error;

    fn enqueue(
        &mut self,
        request: &EnqueueRequest,
        now: Timestamp,
    ) -> Result<EnqueueOutcome, Self::Error>;

    fn claim_next(
        &mut self,
        now: Timestamp,
        lease_duration_ms: u64,
    ) -> Result<ClaimOutcome, Self::Error>;

    fn finish(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot, Self::Error>;

    fn snapshot(&mut self, receipt: &ReceiptKey) -> Result<Option<JobSnapshot>, Self::Error>;

    fn held_job(&mut self) -> Result<Option<HeldJob>, Self::Error>;

    fn reconcile(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        evidence: &ReconciliationEvidence,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot, Self::Error>;
}

/// Synthetic injection now; future owner supplies the full qualified wire3 port.
///
/// Recheck current actor/partition/source authority immediately before dispatch.
/// An authorization denial has a definite NotApplied outcome. Use the prepared
/// operation without GET/merge/PUT invention. Return only after all owned I/O has
/// stopped; do not detach background writes. Unknown transport outcomes require
/// Uncertain, even for timeouts or generic errors. AfterBackoff requires positive
/// knowledge that the operation was not applied, never merely a retryable HTTP
/// code. Provider acknowledgement does not authorize refreshing a read cache.
pub trait HomeBoxWriter {
    fn write(&mut self, job: &LeasedJob) -> WriteOutcome;
}

/// Qualified recovery injection, separate from ordinary dispatch. Never sends a
/// write. Confirm the prior dispatch is quiescent and obtain complete authorized
/// source read-back before returning a definite outcome and private evidence.
/// Until such evidence exists, return StillUncertain and retain the global hold.
pub trait HomeBoxReconciler {
    fn reconcile(&mut self, job: &HeldJob) -> ReconciliationOutcome;
}
