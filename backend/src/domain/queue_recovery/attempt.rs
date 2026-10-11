use super::*;
use crate::{domain::stock::StockContractPort, jobs::*, storage};
use sha2::{Digest as _, Sha256};

/// Concrete storage evidence binding, borrowing the same complete discovery
/// registry/original/media peers. This validates retained facts only. It never
/// returns an invocation permit, changes liabilities or schedules dispatch.
pub struct NativeQueueRecoveryEvidence<'a, 'peer, C, A: RecoveryDiscoveryAuthority, O, M, N> {
    discovery: &'a NativeQueueDiscovery<'peer, C, A, O, M>,
    native: &'a N,
}

impl<'a, 'peer, C, A, O, M, N> NativeQueueRecoveryEvidence<'a, 'peer, C, A, O, M, N>
where
    C: StockContractPort,
    A: RecoveryDiscoveryAuthority,
    O: OriginalEnqueueOwner,
    M: QueuedMediaRecovery<O::Proof>,
    N: NativeRetainedEvidence<O::Proof>,
{
    pub fn new(discovery: &'a NativeQueueDiscovery<'peer, C, A, O, M>, native: &'a N) -> Self {
        Self { discovery, native }
    }
}

impl<C, A, O, M, N> storage::QueueRecoveryEvidence
    for NativeQueueRecoveryEvidence<'_, '_, C, A, O, M, N>
where
    C: StockContractPort,
    A: RecoveryDiscoveryAuthority,
    O: OriginalEnqueueOwner,
    M: QueuedMediaRecovery<O::Proof>,
    N: NativeRetainedEvidence<O::Proof>,
{
    fn validate_attempt(
        &self,
        config: &QueueConfig,
        frame: storage::QueueRecoveryAttempt<'_>,
    ) -> storage::Result<()> {
        let job = frame.job;
        let origin = self.discovery.correlate_original(
            frame.original,
            &job.request,
            &job.canonical_scope,
            config,
        )?;
        self.discovery.correlate_attempt(config, &origin, job)?;
        if job.lease.physical_identity != config.registration.identity
            || job.lease.owner_id != config.registration.dispatcher_owner_id
            || job.lease.job_id.0.is_empty()
            || job.lease.fence == 0
            || job.attempt == 0
            || job.pending_byte_liability != job.request.pending_byte_liability
        {
            return Err(incompatible());
        }
        match (frame.prepared, frame.journal) {
            (None, None) => {}
            (Some(prepared), Some(journal)) => {
                if prepared.codec != self.native.native_codec() || prepared.codec.is_empty() {
                    return Err(unavailable());
                }
                if prepared.codec != journal.native_codec
                    || raw_digest(&prepared.native_payload)
                        != journal.native_payload_digest.as_hex()
                    || raw_digest(&prepared.prepared_media_evidence)
                        != journal.prepared_media_digest.as_hex()
                    || prepared.storage_liability != journal.prepared_liability
                {
                    return Err(incompatible());
                }
            }
            _ => return Err(incompatible()),
        }
        let attempt = RetainedAttempt {
            enqueue: RetainedEnqueue {
                config,
                original: frame.original,
                request: &job.request,
                scope: &job.canonical_scope,
                original_proof: &origin.proof,
            },
            job,
            prepared: frame.prepared,
            journal: frame.journal,
            steps: frame.steps,
            liabilities: frame.liabilities,
            outcomes: frame.outcomes,
        };
        self.discovery.media().validate_attempt(&attempt)?;
        if frame.prepared.is_some() {
            self.native.validate_prepared(&attempt)?;
        }
        for (index, step) in frame.steps.iter().enumerate() {
            if self.native.step_codec(&step.kind) != Some(step.codec.as_str())
                || step.codec.is_empty()
            {
                return Err(unavailable());
            }
            self.native.validate_step(&attempt, index, step)?;
        }
        let mut step_cut = 0;
        let mut liability_cut = 0;
        let mut previous: Option<&storage::QueueRecoveryOutcome<'_>> = None;
        for (index, outcome) in frame.outcomes.iter().enumerate() {
            if outcome.steps.len() < step_cut
                || outcome.liabilities.len() < liability_cut
                || !frame.steps.starts_with(outcome.steps)
                || !frame.liabilities.starts_with(outcome.liabilities)
                || previous.is_some_and(|prior| outcome.at < prior.at)
                || !matches!(outcome.kind, "finish" | "reconcile" | "admission-reject")
            {
                return Err(incompatible());
            }
            let retained = RetainedOutcome {
                enqueue: &attempt.enqueue,
                job,
                prepared: frame.prepared,
                journal: frame.journal,
                index,
                outcome,
                previous,
                added_steps: &outcome.steps[step_cut..],
            };
            self.discovery.media().validate_outcome(&retained)?;
            self.native.validate_outcome(&retained)?;
            step_cut = outcome.steps.len();
            liability_cut = outcome.liabilities.len();
            previous = Some(outcome);
        }
        self.discovery.authorize(&config.registration)
    }
}

fn raw_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
