use super::*;

/// Durability boundary, supplied by the SQLite owner. All mutations below are
/// atomic transactions, not a read followed by an independently committed write.
///
/// * Trusted registration binds (deployment, physical database, configuration)
///   and all source aliases. A waiting request cannot choose another queue.
/// * Enqueue binds the canonical intent digest and immutable metadata to the permanent receipt key. An
///   identical retry returns its existing job; any difference is a conflict.
///   Receipts have no expiry that would permit dispatching a duplicate.
/// * Waiting rows contain bounded metadata only, bodyAccepted=false. Admission
///   recomputes decide_admission in the SAME transaction; capacity, canonical
///   overlap scopes and storage reservation cannot be read/committed separately.
/// * There is one durable global lease row for ALL workspace/home/source
///   partitions. Claim chooses due work in durable enqueue sequence, advances a
///   checked monotonically increasing fence and increments attempts atomically.
/// * Expired running work becomes NeedsReconciliation while keeping that global
///   reservation. It cannot become due work or free the slot automatically.
/// * Finish atomically validates job ID plus the active global fence, records
///   owner/physical configuration, status, remote activity and liability
///   independently. For invoked attempts, only EndedProven releases the physical
///   slot; a positively never-invoked attempt may release its unused reservation. Logical
///   uncertainty/partial scopes and byte/orphan liabilities remain retained.
///   Matching definite acknowledgement is not lost to a backwards timestamp;
///   persist max(now, prior.updated_at). A stale fence never changes a row.
///   Reports describe the matching lease/attempt. Keep earlier attempts' known
///   bytes, reservations, incomplete accounting, unresolved counts and orphan
///   references; a new claim or finish report cannot replace that liability.
/// * Reconcile checks original job/owner/fence and persists logical evidence. It
///   MUST preserve remote activity and byte/orphan liabilities. Human effect
///   resolution cannot release the physical slot. End evidence is a separate
///   correlated capability, checked against the exact original lease.
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
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: Timestamp,
    ) -> Result<EnqueueOutcome, Self::Error>;

    fn claim_next(
        &mut self,
        now: Timestamp,
        config: &QueueConfig,
    ) -> Result<ClaimOutcome, Self::Error>;

    fn finish(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        report: &FinishReport,
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

    /// Persist EndedProven and release ONLY the matching physical slot. Preserve
    /// logical fences, effect outcome and all liabilities; never redispatch.
    fn prove_remote_end(
        &mut self,
        evidence: &RemoteEndEvidence,
        now: Timestamp,
    ) -> Result<JobSnapshot, Self::Error>;
}

/// Synthetic injection now; future owner supplies the full qualified wire3 port.
///
/// After exclusive admission, accept/stage bytes only under the returned
/// qualified reservation. Persist immutable dispatch intent before provider I/O.
/// Recheck current actor/partition/source authority immediately before dispatch.
/// An authorization denial has a NotInvoked outcome. Use the prepared
/// operation without GET/merge/PUT invention. Return only after all owned I/O has
/// stopped; do not detach background writes. Unknown transport outcomes require
/// Uncertain, even for timeouts or generic errors. AfterBackoff requires positive
/// knowledge that the operation was not applied, never merely a retryable HTTP
/// code. Provider acknowledgement does not authorize refreshing a read cache.
pub trait HomeBoxWriter {
    fn write(&mut self, job: &LeasedJob) -> DispatchReport;
}

/// Qualified recovery injection, separate from ordinary dispatch. Never sends a
/// write. Obtain complete currently authorized correlated effects or explicit
/// audited human effect resolution. This cannot prove remote termination or
/// purge/release bytes. StillUncertain retains the logical scope fence.
pub trait HomeBoxReconciler {
    fn reconcile(&mut self, job: &HeldJob) -> ReconciliationOutcome;
}
