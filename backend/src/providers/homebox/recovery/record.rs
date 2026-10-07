//! Trusted native owner supplies these records independently of an image. No
//! Deserialize/from-image constructor exists. These values are evidence DATA;
//! their construction neither authenticates a driver nor grants authority.
use super::{codec::*, *};
use crate::{jobs, providers::homebox::write::stock as w};
use serde_json::{Value, json};
use w::StockContractPort;

pub struct RetainedWriterAttempt {
    pub(super) config: jobs::QueueConfig,
    pub(super) job: jobs::LeasedJob,
    pub(super) baseline: w::StoredOperation,
    preflight: w::StockPreflight,
    permit: w::InvocationPermit,
    pub(super) prepared: storage::PreparedNativeIntent,
    pub(super) events: Vec<RecordedEvent>,
    pub(super) steps: Vec<storage::QueueStepEvidence>,
    pub(super) outcomes: Vec<RecordedOutcome>,
}
pub(super) enum RecordedEvent {
    Readback {
        receipt: Box<w::DispatchReceipt>,
        observation: Box<w::NativeObservation>,
    },
    RemoteEnd(Box<w::DispatchReceipt>),
    NeverInvoked,
}
pub(super) struct RecordedOutcome {
    pub at: jobs::Timestamp,
    pub report: jobs::FinishReport,
    pub step_count: usize,
    pub liabilities: Vec<(String, jobs::StorageLiability)>,
}

impl RetainedWriterAttempt {
    /// Call from the original native owner with exact admitted stock objects,
    /// before I/O. Retain this record outside the recoverable image, with its
    /// original provenance. Media proof bytes are unchanged and media-owned.
    pub fn from_prepared(
        contracts: &NativeWriterContracts,
        config: jobs::QueueConfig,
        job: jobs::LeasedJob,
        admitted: w::StoredOperation,
        preflight: w::StockPreflight,
        permit: w::InvocationPermit,
        prepared_media_evidence: Vec<u8>,
    ) -> storage::Result<Self> {
        let command = &admitted.command;
        let plan = admitted.plan.as_ref().ok_or_else(incompatible)?;
        let packet = PreparedPacket {
            format: NATIVE_CODEC.into(),
            writer_commit: WRITER_COMMIT.into(),
            native_source_commit: w::NATIVE_SOURCE_COMMIT.into(),
            binding: binding(&job),
            command: command.clone(),
            plan: plan.clone(),
            preparation: preparation(&preflight.preparation),
            preflight_digest: preflight.preflight_digest.clone(),
            authority: authority(&admitted.captured_authority),
            permit: permit_value(&permit),
            baseline: admitted.outcome.clone(),
            activity_version: admitted.activity_version,
        };
        let prepared = storage::PreparedNativeIntent {
            codec: NATIVE_CODEC.into(),
            native_payload: encode(&packet)?,
            prepared_media_evidence,
            storage_liability: liability(&admitted.outcome.storage_liability)?,
        };
        let record = Self {
            config,
            job,
            baseline: admitted,
            preflight,
            permit,
            prepared,
            events: vec![],
            steps: vec![],
            outcomes: vec![],
        };
        record.validate_origin(contracts)?;
        Ok(record)
    }
    pub fn prepared(&self) -> &storage::PreparedNativeIntent {
        &self.prepared
    }
    pub fn steps(&self) -> &[storage::QueueStepEvidence] {
        &self.steps
    }

    /// Retain the actual bounded driver receipt and the qualified exact GET,
    /// absence or complete impact observation; reuse accepted native semantics.
    pub fn record_response_readback(
        &mut self,
        contracts: &NativeWriterContracts,
        receipt: w::DispatchReceipt,
        observation: w::NativeObservation,
    ) -> storage::Result<()> {
        let ended = matches!(
            receipt.remote_activity,
            w::RemoteActivity::EndedProven { .. }
        );
        // Prepare both events before appending either, so an encoding failure
        // cannot leave a half-recorded producer sequence.
        let mut candidate = vec![RecordedEvent::Readback {
            receipt: Box::new(receipt.clone()),
            observation: Box::new(observation),
        }];
        if ended {
            candidate.push(RecordedEvent::RemoteEnd(Box::new(receipt)));
        }
        self.append(contracts, candidate)
    }
    pub fn record_remote_end(
        &mut self,
        contracts: &NativeWriterContracts,
        receipt: w::DispatchReceipt,
    ) -> storage::Result<()> {
        self.append(contracts, vec![RecordedEvent::RemoteEnd(Box::new(receipt))])
    }
    /// Only the actual driver's positive NeverInvoked variant qualifies this
    /// event. HTTP failure, cancellation or missing journal are insufficient.
    pub fn record_never_invoked(
        &mut self,
        contracts: &NativeWriterContracts,
        dispatch: w::NativeDispatch,
    ) -> storage::Result<()> {
        if !matches!(dispatch, w::NativeDispatch::NeverInvoked) {
            return Err(incompatible());
        }
        self.append(contracts, vec![RecordedEvent::NeverInvoked])
    }
    fn append(
        &mut self,
        contracts: &NativeWriterContracts,
        events: Vec<RecordedEvent>,
    ) -> storage::Result<()> {
        let mut operation = self.reconstruct(contracts, self.events.len())?;
        let mut steps = vec![];
        for (offset, event) in events.iter().enumerate() {
            let index = self.events.len() + offset;
            let (next, step) = self.reduce(contracts, &operation, event, index)?;
            operation = next;
            steps.push(step);
        }
        self.events.extend(events);
        self.steps.extend(steps);
        Ok(())
    }
    /// Independently retain the actual finish transaction's exact report and
    /// liability prefix. This never writes queue state or changes accounting.
    pub fn record_finish(
        &mut self,
        contracts: &NativeWriterContracts,
        at: jobs::Timestamp,
        report: jobs::FinishReport,
        liabilities: Vec<(String, jobs::StorageLiability)>,
    ) -> storage::Result<()> {
        if !self.outcomes.is_empty() {
            return Err(incompatible());
        }
        self.validate_report(contracts, &report, self.steps.len())?;
        if !liabilities
            .last()
            .is_some_and(|(origin, value)| origin == "finish" && value == &report.storage_liability)
        {
            return Err(incompatible());
        }
        self.outcomes.push(RecordedOutcome {
            at,
            report,
            step_count: self.steps.len(),
            liabilities,
        });
        Ok(())
    }
    pub(super) fn validate_origin(&self, contracts: &NativeWriterContracts) -> storage::Result<()> {
        self.config.validate().map_err(|_| incompatible())?;
        self.job.request.validate().map_err(|_| incompatible())?;
        let c = &self.baseline.command;
        let a = &self.baseline.captured_authority;
        let p = &self.permit;
        let job = &self.job;
        let receipt = &job.request.receipt;
        let plan = self.baseline.plan.as_ref().ok_or_else(incompatible)?;
        let outcome = &self.baseline.outcome;
        let parsed = contracts
            .validate_request(&c.original_wire)
            .map_err(|_| incompatible())?;
        let mapped = w::map_stock(c, &self.preflight.preparation).map_err(|_| incompatible())?;
        let pd = contracts
            .digest_native(&serde_json::to_value(plan)?)
            .map_err(|_| incompatible())?;
        if c.context.workspace_id.is_nil()
            || c.context.home_id.is_nil()
            || c.target.source_instance_id.is_nil()
            || c.target.collection_id.is_nil()
            || parsed != *c
            || mapped != *plan
            || pd != p.plan_digest
            || self.preflight.provider_observation != c.provider_observation
            || self.preflight.request_digest != c.request_digest
            || self.preflight.source_epoch != a.source_epoch
            || a.source_epoch == 0
            || a.actor_id.is_nil()
            || a.physical_binding.deployment_id.is_nil()
            || a.physical_binding.physical_database_id.is_nil()
            || p.owner_id.is_nil()
            || p.operation_id.is_nil()
            || p.operation_id != self.baseline.operation_id
            || p.actor_id != a.actor_id
            || p.physical_binding != a.physical_binding
            || p.source_epoch != a.source_epoch
            || p.qualification != a.qualification
            || p.dispatcher_epoch != job.lease.fence
            || job.lease.fence == 0
            || job.lease.expires_at == 0
            || job.attempt == 0
            || job.lease.job_id.0 != p.operation_id.to_string()
            || job.lease.owner_id != p.owner_id.to_string()
            || self.baseline.actor_id != a.actor_id
            || self.baseline.activity_version == 0
            || job.lease.physical_identity != self.config.registration.identity
            || job.lease.owner_id != self.config.registration.dispatcher_owner_id
            || job.lease.physical_identity.deployment_id
                != a.physical_binding.deployment_id.to_string()
            || job.lease.physical_identity.physical_database_id
                != a.physical_binding.physical_database_id.to_string()
            || job.lease.physical_identity.configuration_digest.as_hex()
                != a.physical_binding.configuration_digest.as_str()
            || receipt.workspace_id != c.context.workspace_id.to_string()
            || receipt.home_id != c.context.home_id.to_string()
            || receipt.actor_id != a.actor_id.to_string()
            || receipt.mutation_id != c.idempotency_key.to_string()
            || job.request.partition.workspace_id != receipt.workspace_id
            || job.request.partition.home_id != receipt.home_id
            || job.request.partition.source_instance_id != c.target.source_instance_id.to_string()
            || job.request.partition.collection_id != c.target.collection_id.to_string()
            || job.request.intent.operation_id != c.command_id
            || job.request.intent.target_external_id
                != c.target.resource_id.map(|id| id.to_string())
            || job.request.intent.request_digest.as_hex() != c.request_digest.as_str()
            || job.pending_byte_liability != job.request.pending_byte_liability
            || self
                .config
                .registration
                .resolve(&job.request.partition, &job.request.write_scope)
                .map_err(|_| incompatible())?
                != job.canonical_scope
            || self.baseline.actual_target.is_some()
            || !self.baseline.generated_members.is_empty()
            || outcome.operation_id != p.operation_id
            || outcome.command_id != c.command_id
            || outcome.request_id != c.request_id
            || outcome.request_digest != c.request_digest
            || outcome.resolved_scope != c.context
            || outcome.state != w::OutcomeState::Dispatching
            || !outcome.known_effects.is_empty()
            || outcome.response_digest.is_some()
            || outcome.readback_digest.is_some()
            || outcome.response_success
            || outcome.readback_agrees
            || outcome.generated_identity_resolved
            || !matches!(
                outcome.remote_activity,
                w::RemoteActivity::EndUnproven {
                    termination_evidence_digest: None
                }
            )
        {
            return Err(incompatible());
        }
        contracts
            .validate_outcome(outcome)
            .map_err(|_| incompatible())?;
        for snapshot in &self.preflight.preparation.snapshots {
            if !snapshot.target.same_partition(&c.target)
                || !snapshot.complete
                || contracts
                    .digest_native(&snapshot.value)
                    .map_err(|_| incompatible())?
                    != snapshot.digest
            {
                return Err(incompatible());
            }
        }
        Ok(())
    }
    pub(super) fn reconstruct(
        &self,
        contracts: &NativeWriterContracts,
        count: usize,
    ) -> storage::Result<w::StoredOperation> {
        self.validate_origin(contracts)?;
        if count > self.events.len() {
            return Err(incompatible());
        }
        let mut operation = self.baseline.clone();
        for (index, event) in self.events[..count].iter().enumerate() {
            let (next, step) = self.reduce(contracts, &operation, event, index)?;
            if self.steps.get(index) != Some(&step) {
                return Err(incompatible());
            }
            operation = next;
        }
        Ok(operation)
    }
    fn reduce(
        &self,
        contracts: &NativeWriterContracts,
        previous: &w::StoredOperation,
        event: &RecordedEvent,
        index: usize,
    ) -> storage::Result<(w::StoredOperation, storage::QueueStepEvidence)> {
        let mut next = previous.clone();
        let plan = self.baseline.plan.as_ref().ok_or_else(incompatible)?;
        let mut response_digest = None;
        let mut readback_digest = None;
        let mut termination_digest = None;
        let (kind, codec, value) = match event {
            RecordedEvent::Readback {
                receipt: r,
                observation: o,
            } => {
                let facts =
                    w::retained_bridge::dispatch(contracts, &next.command, plan, &self.permit, r);
                if !facts.remote_activity.invoked()
                    || !facts.remote_activity.well_formed()
                    || matches!(r.remote_activity, w::RemoteActivity::NotDispatched { .. })
                    || facts.remote_activity != r.remote_activity
                {
                    return Err(incompatible());
                }
                next.outcome = next
                    .outcome
                    .with_dispatch(&facts)
                    .ok_or_else(incompatible)?;
                next.actual_target = facts.generated_target;
                next.generated_members = facts.generated_members;
                let observed = w::retained_bridge::observation(contracts, &next, o)
                    .ok_or_else(incompatible)?;
                next.outcome = next
                    .outcome
                    .with_observation(&observed)
                    .ok_or_else(incompatible)?;
                response_digest = next
                    .outcome
                    .response_digest
                    .as_ref()
                    .map(digest)
                    .transpose()?;
                readback_digest = Some(digest(&observed.readback_digest)?);
                (
                    storage::StepKind::ResponseReadback,
                    READBACK_CODEC,
                    json!({"receipt":receipt(r),"observation":observation(o)}),
                )
            }
            RecordedEvent::RemoteEnd(r) => {
                let facts =
                    w::retained_bridge::dispatch(contracts, &next.command, plan, &self.permit, r);
                let w::RemoteActivity::EndedProven {
                    termination_evidence_digest: e,
                } = &facts.remote_activity
                else {
                    return Err(incompatible());
                };
                if facts.remote_activity != r.remote_activity
                    || !next.outcome.remote_activity.invoked()
                    || matches!(
                        next.outcome.remote_activity,
                        w::RemoteActivity::EndedProven { .. }
                    ) && next.outcome.remote_activity != facts.remote_activity
                {
                    return Err(incompatible());
                }
                termination_digest = Some(digest(e)?);
                next.outcome.remote_activity = facts.remote_activity.clone();
                (
                    storage::StepKind::RemoteEnd,
                    REMOTE_END_CODEC,
                    json!({"receipt":receipt(r)}),
                )
            }
            RecordedEvent::NeverInvoked => {
                if index != 0
                    || next.outcome.response_digest.is_some()
                    || next.outcome.readback_digest.is_some()
                {
                    return Err(incompatible());
                }
                next.outcome.remote_activity = w::RemoteActivity::not_dispatched();
                next.outcome.state = w::OutcomeState::RejectedBeforeDispatch;
                next.outcome.verification = w::Verification::NoDispatch;
                next.outcome.unknown_scope_fence_retained = false;
                (
                    storage::StepKind::PositiveNoEffect,
                    NEVER_INVOKED_CODEC,
                    json!({"nativeDispatch":"NeverInvoked"}),
                )
            }
        };
        contracts
            .validate_outcome(&next.outcome)
            .map_err(|_| incompatible())?;
        let packet = StepPacket {
            format: codec.into(),
            prepared_sha256: raw_digest(&self.prepared.native_payload),
            sequence: index.to_string(),
            evidence: value,
        };
        Ok((
            next,
            storage::QueueStepEvidence {
                kind,
                codec: codec.into(),
                payload: encode(&packet)?,
                response_digest,
                readback_digest,
                termination_digest,
            },
        ))
    }
    pub(super) fn validate_report(
        &self,
        contracts: &NativeWriterContracts,
        report: &jobs::FinishReport,
        count: usize,
    ) -> storage::Result<()> {
        let operation = self.reconstruct(contracts, count)?;
        let o = &operation.outcome;
        // Accounting is independently media-owned; compare exact retained
        // reports in the adapter instead of inferring cleanup from effects.
        if remote(&o.remote_activity)? != report.remote_activity {
            return Err(incompatible());
        }
        if let jobs::RemoteActivity::Invoked(jobs::InvokedRemoteActivity::EndedProven {
            termination_evidence_digest: e,
        }) = &report.remote_activity
            && !self.steps[..count].iter().any(|s| {
                s.kind == storage::StepKind::RemoteEnd && s.termination_digest.as_ref() == Some(e)
            })
        {
            return Err(incompatible());
        }
        match &report.disposition {
            jobs::FinishDisposition::Succeeded(applied) => {
                let target = w::retained_bridge::target(&operation).ok_or_else(incompatible)?;
                let at = crate::contracts::semantics::timestamp_millis(&o.observed_at)
                    .and_then(|at| u64::try_from(at).ok())
                    .ok_or_else(incompatible)?;
                if o.state != w::OutcomeState::ConfirmedObserved
                    || applied.external_id != target.resource_id.map(|id| id.to_string())
                    || applied.observation.response_digest
                        != digest(o.response_digest.as_ref().ok_or_else(incompatible)?)?
                    || applied.observation.readback_digest
                        != digest(o.readback_digest.as_ref().ok_or_else(incompatible)?)?
                    || applied.observation.observed_at != at
                {
                    return Err(incompatible());
                }
            }
            jobs::FinishDisposition::Failed(_) => {
                if o.state != w::OutcomeState::RejectedBeforeDispatch
                    || !self.steps[..count]
                        .iter()
                        .any(|s| s.kind == storage::StepKind::PositiveNoEffect)
                {
                    return Err(incompatible());
                }
            }
            jobs::FinishDisposition::Hold(_) => {
                if !o.unknown_scope_fence_retained || !o.known_effects.is_empty() {
                    return Err(incompatible());
                }
            }
            jobs::FinishDisposition::Partial(_) => {
                if !o.unknown_scope_fence_retained || o.known_effects.is_empty() {
                    return Err(incompatible());
                }
            }
            // No accepted native retry/no-effect-after-invocation proof API.
            jobs::FinishDisposition::RetryAt { .. } => return Err(unavailable()),
        }
        Ok(())
    }
}
// Avoid shadowing the actual invocation permit carrier in producer construction.
fn permit_value(value: &w::InvocationPermit) -> Value {
    permit(value)
}

pub struct RetainedWriterArchive {
    pub(super) attempts: Vec<RetainedWriterAttempt>,
}
impl RetainedWriterArchive {
    /// Freeze independently retained owner records. Never populate this archive
    /// by decoding queue/image packets. Missing original owner evidence fails.
    pub fn new(attempts: Vec<RetainedWriterAttempt>) -> storage::Result<Self> {
        for (index, record) in attempts.iter().enumerate() {
            if attempts[..index].iter().any(|other| {
                other.job.lease.physical_identity == record.job.lease.physical_identity
                    && other.job.lease.job_id == record.job.lease.job_id
                    && other.job.lease.fence == record.job.lease.fence
            }) {
                return Err(incompatible());
            }
        }
        Ok(Self { attempts })
    }
    pub(super) fn find(&self, job: &jobs::LeasedJob) -> storage::Result<&RetainedWriterAttempt> {
        self.attempts
            .iter()
            .find(|a| a.job == *job)
            .ok_or_else(unavailable)
    }
}
