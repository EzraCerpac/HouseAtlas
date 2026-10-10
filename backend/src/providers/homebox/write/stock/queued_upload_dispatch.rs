//! Closed one-shot native upload effects. Channel requests are phase inputs,
//! never authority; the original root pump owns all current qualification.
pub(crate) use super::queued_upload_source::PendingReadbackIdentity;
use super::queued_upload_source::{
    PendingQueuedUploadReadback, QualifiedQueuedUploadReadback, QueuedUploadSource,
};
use super::*;
use crate::{
    jobs, media,
    providers::homebox::{recovery::NativeWriterContracts, write_transport},
    storage,
};
use media::native_queued_upload::NativeQueuedUploadDispatchBody;
use serde_json::json;
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicBool, Ordering},
};
use tokio::{
    sync::{mpsc, oneshot},
    time::Instant,
};
use tokio_util::sync::CancellationToken;

type Native<'owner, 'captured, 'p> =
    RetainedFreshPreparation<'owner, NativeWriterContracts, QueuedUploadSource<'captured, 'p>>;
type Execution = storage::OriginalQueuedUploadExecution;
type PortResult<T> = Result<T, StockPortFault>;

pub struct QueuedUploadBodyPhaseRequest {
    pub execution: Arc<Execution>,
    pub permit: InvocationPermit,
    pub stage: StagedUpload,
    pub max_bytes: usize,
    pub deadline: Instant,
    pub reply:
        oneshot::Sender<Result<NativeQueuedUploadDispatchBody, write_transport::TransportFault>>,
}
pub struct QueuedUploadHeaderPhaseRequest {
    pub execution: Arc<Execution>,
    pub endpoint: write_transport::SourceEndpoint,
    pub permit: InvocationPermit,
    pub plan: NativePlan,
    pub authority: StockAuthority,
    pub deadline: Instant,
    pub reply: oneshot::Sender<
        Result<write_transport::AuthorizationHeader, write_transport::TransportFault>,
    >,
}
pub enum QueuedUploadExecutionPhaseRequest<'native, 'owner, 'captured, 'p> {
    Body(Box<QueuedUploadBodyPhaseRequest>),
    Header(Box<QueuedUploadHeaderPhaseRequest>),
    CheckReadback {
        execution: Arc<Execution>,
        deadline: Instant,
        reply: oneshot::Sender<PortResult<()>>,
    },
    QualifyReadback {
        execution: Arc<Execution>,
        effects: Arc<CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>>,
        deadline: Instant,
        reply: oneshot::Sender<PortResult<QualifiedQueuedUploadReadback<'captured, 'p>>>,
    },
    Finish {
        execution: Arc<Execution>,
        effects: Arc<CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>>,
        deadline: Instant,
        reply: oneshot::Sender<(
            storage::Result<jobs::JobSnapshot>,
            Option<jobs::JobSnapshot>,
        )>,
    },
}
pub struct QueuedUploadExecutionPhaseProxy<'native, 'owner, 'captured, 'p> {
    execution: Arc<Execution>,
    native: &'native Native<'owner, 'captured, 'p>,
    sender: mpsc::Sender<QueuedUploadExecutionPhaseRequest<'native, 'owner, 'captured, 'p>>,
}
impl<'native, 'owner, 'captured, 'p>
    QueuedUploadExecutionPhaseProxy<'native, 'owner, 'captured, 'p>
{
    pub fn channel(
        execution: Arc<Execution>,
        native: &'native Native<'owner, 'captured, 'p>,
    ) -> PortResult<(
        Self,
        mpsc::Receiver<QueuedUploadExecutionPhaseRequest<'native, 'owner, 'captured, 'p>>,
    )> {
        check_execution(&execution, native)?;
        let (sender, receiver) = mpsc::channel(1);
        Ok((
            Self {
                execution,
                native,
                sender,
            },
            receiver,
        ))
    }
    fn retained(&self) -> Self {
        Self {
            execution: self.execution.clone(),
            native: self.native,
            sender: self.sender.clone(),
        }
    }
    async fn send(
        &self,
        request: QueuedUploadExecutionPhaseRequest<'native, 'owner, 'captured, 'p>,
        deadline: Instant,
    ) -> Result<(), write_transport::TransportFault> {
        tokio::time::timeout_at(deadline, self.sender.send(request))
            .await
            .map_err(|_| write_transport::TransportFault::Deadline)?
            .map_err(|_| write_transport::TransportFault::Resources)
    }
}
impl write_transport::DispatchResources for QueuedUploadExecutionPhaseProxy<'_, '_, '_, '_> {
    async fn authorization(
        &self,
        endpoint: &write_transport::SourceEndpoint,
        permit: &InvocationPermit,
        plan: &NativePlan,
        authority: &StockAuthority,
        deadline: Instant,
    ) -> Result<Option<write_transport::AuthorizationHeader>, write_transport::TransportFault> {
        let endpoint = write_transport::SourceEndpoint::https(
            endpoint.origin().as_str(),
            endpoint.binding().clone(),
        )?;
        let (reply, receiver) = oneshot::channel();
        self.send(
            QueuedUploadExecutionPhaseRequest::Header(Box::new(QueuedUploadHeaderPhaseRequest {
                execution: self.execution.clone(),
                endpoint,
                permit: permit.clone(),
                plan: plan.clone(),
                authority: authority.clone(),
                deadline,
                reply,
            })),
            deadline,
        )
        .await?;
        tokio::time::timeout_at(deadline, receiver)
            .await
            .map_err(|_| write_transport::TransportFault::Deadline)?
            .map_err(|_| write_transport::TransportFault::Resources)?
            .map(Some)
    }
    async fn staged_bytes(
        &self,
        permit: &InvocationPermit,
        stage: &StagedUpload,
        max_bytes: usize,
        deadline: Instant,
    ) -> Result<Vec<u8>, write_transport::TransportFault> {
        let (reply, receiver) = oneshot::channel();
        self.send(
            QueuedUploadExecutionPhaseRequest::Body(Box::new(QueuedUploadBodyPhaseRequest {
                execution: self.execution.clone(),
                permit: permit.clone(),
                stage: stage.clone(),
                max_bytes,
                deadline,
                reply,
            })),
            deadline,
        )
        .await?;
        let body = tokio::time::timeout_at(deadline, receiver)
            .await
            .map_err(|_| write_transport::TransportFault::Deadline)?
            .map_err(|_| write_transport::TransportFault::Resources)??;
        if !body.matches_preparation(self.execution.native_preparation()) {
            return Err(write_transport::TransportFault::Stage);
        }
        let duration = deadline
            .checked_duration_since(Instant::now())
            .ok_or(write_transport::TransportFault::Deadline)?;
        let budget = media::WorkBudget::new(
            duration.min(std::time::Duration::from_secs(10)),
            media::Cancellation::default(),
        )
        .map_err(|_| write_transport::TransportFault::Stage)?;
        body.into_bytes(stage, max_bytes, deadline.into_std(), &budget)
            .map_err(|_| write_transport::TransportFault::Stage)
    }
}
pub struct QueuedUploadSourceError<O> {
    code: StockPortFault,
    owner: O,
}
impl<O> QueuedUploadSourceError<O> {
    pub fn code(&self) -> StockPortFault {
        self.code
    }
    pub fn into_owner(self) -> O {
        self.owner
    }
}
pub struct QueuedUploadNativeAttempt<'native, 'owner, 'captured, 'p> {
    proxy: QueuedUploadExecutionPhaseProxy<'native, 'owner, 'captured, 'p>,
    dispatcher: write_transport::HttpDispatcher<
        QueuedUploadExecutionPhaseProxy<'native, 'owner, 'captured, 'p>,
    >,
    permit: InvocationPermit,
    deadline: Instant,
    cancellation: CancellationToken,
}
pub(crate) struct QueuedUploadEffectsIdentity {
    _private: (),
}
pub struct CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p> {
    historical_identity: Arc<QueuedUploadEffectsIdentity>,
    proxy: QueuedUploadExecutionPhaseProxy<'native, 'owner, 'captured, 'p>,
    permit: InvocationPermit,
    transport: write_transport::DispatchReport,
    pending: OnceLock<Arc<PendingQueuedUploadReadback<'captured, 'p>>>,
    qualified: OnceLock<QualifiedQueuedUploadReadback<'captured, 'p>>,
    finish_report: OnceLock<jobs::FinishReport>,
    steps: OnceLock<Vec<storage::QueueStepEvidence>>,
    readback_attempted: AtomicBool,
    finish_attempted: AtomicBool,
    committed: OnceLock<jobs::JobSnapshot>,
    deadline: Instant,
}
pub struct QueuedUploadFinishEvidence<'a> {
    effects_identity: &'a Arc<QueuedUploadEffectsIdentity>,
    qualified_readback_identity: Option<&'a Arc<PendingReadbackIdentity>>,
    execution: &'a Arc<Execution>,
    report: &'a jobs::FinishReport,
    steps: &'a [storage::QueueStepEvidence],
}
impl QueuedUploadFinishEvidence<'_> {
    pub(crate) fn effects_identity(&self) -> &Arc<QueuedUploadEffectsIdentity> {
        self.effects_identity
    }
    pub(crate) fn qualified_readback_identity(&self) -> Option<&Arc<PendingReadbackIdentity>> {
        self.qualified_readback_identity
    }

    pub fn execution(&self) -> &Arc<Execution> {
        self.execution
    }
    pub fn report(&self) -> &jobs::FinishReport {
        self.report
    }
    pub fn steps(&self) -> &[storage::QueueStepEvidence] {
        self.steps
    }
}
impl<'native, 'owner, 'captured, 'p> QueuedUploadNativeAttempt<'native, 'owner, 'captured, 'p> {
    pub fn from_journaled_original(
        proxy: QueuedUploadExecutionPhaseProxy<'native, 'owner, 'captured, 'p>,
        limits: write_transport::Limits,
        deadline: Instant,
        cancellation: CancellationToken,
    ) -> PortResult<Self> {
        proxy
            .execution
            .enter_source_attempt()
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        check_execution(&proxy.execution, proxy.native)?;
        let native = proxy.native;
        let source = native.source();
        let configured = source.configured();
        let physical = configured.physical();
        let authority = native.authority();
        let contracts = NativeWriterContracts::new().map_err(|_| StockPortFault::Unavailable)?;
        let plan_digest = contracts
            .digest_native(
                &serde_json::to_value(native.plan())
                    .map_err(|_| StockPortFault::EvidenceConflict)?,
            )
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        let permit = InvocationPermit {
            operation_id: native.command().request_id,
            actor_id: authority.actor_id,
            physical_binding: physical.physical_binding.clone(),
            owner_id: physical.owner_id,
            dispatcher_epoch: physical.dispatcher_epoch,
            source_epoch: authority.source_epoch,
            plan_digest,
            qualification: authority.qualification.clone(),
        };
        let origin = configured
            .homebox()
            .endpoint()
            .map_err(|_| StockPortFault::Unavailable)?;
        let endpoint = write_transport::SourceEndpoint::https(
            origin.origin().as_str(),
            write_transport::DispatchBinding {
                context: native.command().context.clone(),
                source_instance_id: native.command().target.source_instance_id,
                collection_id: native.command().target.collection_id,
                physical_binding: physical.physical_binding.clone(),
                owner_id: physical.owner_id,
                dispatcher_epoch: physical.dispatcher_epoch,
                source_epoch: authority.source_epoch,
                qualification: authority.qualification.clone(),
            },
        )
        .map_err(|_| StockPortFault::Unavailable)?;
        let dispatcher = write_transport::HttpDispatcher::new(endpoint, proxy.retained(), limits)
            .map_err(|_| StockPortFault::Unavailable)?;
        Ok(Self {
            proxy,
            dispatcher,
            permit,
            deadline,
            cancellation,
        })
    }
    pub async fn execute(self) -> Arc<CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>> {
        let report = self
            .dispatcher
            .dispatch_until(
                &self.permit,
                self.proxy.native.plan(),
                self.proxy.native.authority(),
                self.deadline,
                &self.cancellation,
            )
            .await;
        // Preserve the actual transport result before any journal, GET or output await.
        Arc::new(CapturedQueuedUploadEffects {
            historical_identity: Arc::new(QueuedUploadEffectsIdentity { _private: () }),
            proxy: self.proxy,
            permit: self.permit,
            transport: report,
            pending: OnceLock::new(),
            qualified: OnceLock::new(),
            finish_report: OnceLock::new(),
            steps: OnceLock::new(),
            readback_attempted: AtomicBool::new(false),
            finish_attempted: AtomicBool::new(false),
            committed: OnceLock::new(),
            deadline: self.deadline,
        })
    }
}
impl<'native, 'owner, 'captured, 'p> CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p> {
    pub(crate) fn historical_identity(&self) -> &Arc<QueuedUploadEffectsIdentity> {
        &self.historical_identity
    }
    pub(crate) fn matches_qualified_readback_identity(
        &self,
        expected: Option<&Arc<PendingReadbackIdentity>>,
    ) -> bool {
        match (self.qualified.get(), expected) {
            (None, None) => true,
            (Some(qualified), Some(expected)) => self.pending.get().is_some_and(|pending| {
                qualified.matches_capture(pending)
                    && Arc::ptr_eq(pending.historical_identity(), expected)
            }),
            _ => false,
        }
    }
    pub fn matches_execution(&self, execution: &Arc<Execution>) -> bool {
        Arc::ptr_eq(&self.proxy.execution, execution)
    }
    /// Pure original native allocation correlation; this issues no authority.
    pub fn matches_native(&self, expected: &Native<'owner, 'captured, 'p>) -> bool {
        std::ptr::eq(self.proxy.native, expected)
    }
    pub fn transport_report(&self) -> &write_transport::DispatchReport {
        &self.transport
    }
    pub fn report(&self) -> Option<&jobs::FinishReport> {
        self.finish_report.get()
    }
    pub fn steps(&self) -> &[storage::QueueStepEvidence] {
        self.steps.get().map(Vec::as_slice).unwrap_or(&[])
    }
    pub fn readback_original(&self) -> Option<&[u8]> {
        self.pending.get().map(|pending| pending.original_bytes())
    }
    pub fn readback_observed_at(&self) -> Option<&str> {
        self.pending.get().map(|pending| pending.observed_at())
    }
    pub fn committed_snapshot(&self) -> Option<&jobs::JobSnapshot> {
        self.committed.get()
    }
    pub async fn capture_readback(
        self: Arc<Self>,
    ) -> Result<Arc<Self>, QueuedUploadSourceError<Arc<Self>>> {
        let result = async {
            self.readback_attempted
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map_err(|_| StockPortFault::EvidenceConflict)?;
            self.check_report()?;
            if matches!(self.transport.dispatch, NativeDispatch::Invoked(_)) {
                let (reply, receiver) = oneshot::channel();
                self.proxy
                    .send(
                        QueuedUploadExecutionPhaseRequest::CheckReadback {
                            execution: self.proxy.execution.clone(),
                            deadline: self.deadline,
                            reply,
                        },
                        self.deadline,
                    )
                    .await
                    .map_err(|_| StockPortFault::Unavailable)?;
                tokio::time::timeout_at(self.deadline, receiver)
                    .await
                    .map_err(|_| StockPortFault::Unavailable)?
                    .map_err(|_| StockPortFault::Unavailable)??;
                match self
                    .proxy
                    .native
                    .source()
                    .capture_queued_readback(self.proxy.native.capture().evidence(), self.deadline)
                    .await
                {
                    Ok(pending) => {
                        self.pending
                            .set(pending)
                            .map_err(|_| StockPortFault::EvidenceConflict)?;
                    }
                    Err(failure) => {
                        if let Some(pending) = failure.pending {
                            self.pending
                                .set(pending)
                                .map_err(|_| StockPortFault::EvidenceConflict)?;
                        }
                        let _ = failure.code;
                        return Err(StockPortFault::Unavailable);
                    }
                }
                let (reply, receiver) = oneshot::channel();
                self.proxy
                    .send(
                        QueuedUploadExecutionPhaseRequest::QualifyReadback {
                            execution: self.proxy.execution.clone(),
                            effects: self.clone(),
                            deadline: self.deadline,
                            reply,
                        },
                        self.deadline,
                    )
                    .await
                    .map_err(|_| StockPortFault::Unavailable)?;
                let qualified = tokio::time::timeout_at(self.deadline, receiver)
                    .await
                    .map_err(|_| StockPortFault::Unavailable)?
                    .map_err(|_| StockPortFault::Unavailable)??;
                if !qualified
                    .matches_capture(self.pending.get().ok_or(StockPortFault::EvidenceConflict)?)
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                self.qualified
                    .set(qualified)
                    .map_err(|_| StockPortFault::EvidenceConflict)?;
            }
            self.freeze_finish()
        }
        .await;
        match result {
            Ok(()) => Ok(self),
            Err(code) => Err(QueuedUploadSourceError { code, owner: self }),
        }
    }
    pub fn qualify_readback_in_guard(
        &self,
        context: &FreshQualification<'_, '_, '_>,
    ) -> PortResult<QualifiedQueuedUploadReadback<'captured, 'p>> {
        self.check_current(context)?;
        self.check_report()?;
        if !matches!(self.transport.dispatch, NativeDispatch::Invoked(_)) {
            return Err(StockPortFault::EvidenceConflict);
        }
        self.proxy
            .native
            .source()
            .qualify_queued_readback_in_guard(
                self.pending.get().ok_or(StockPortFault::Unavailable)?,
                self.proxy.native,
                context,
            )
            .map_err(|_| StockPortFault::EvidenceConflict)
    }
    pub fn finish_evidence_in_guard(
        &self,
        context: &FreshQualification<'_, '_, '_>,
    ) -> PortResult<QueuedUploadFinishEvidence<'_>> {
        self.check_current(context)?;
        self.check_report()?;
        if let Some(qualified) = self.qualified.get() {
            let pending = self.pending.get().ok_or(StockPortFault::EvidenceConflict)?;
            if !qualified.matches_capture(pending) {
                return Err(StockPortFault::EvidenceConflict);
            }
            let actual = self
                .proxy
                .native
                .source()
                .qualify_queued_readback_in_guard(pending, self.proxy.native, context)
                .map_err(|_| StockPortFault::EvidenceConflict)?;
            if !actual.matches_capture(pending)
                || actual.digest() != qualified.digest()
                || actual.value() != qualified.value()
            {
                return Err(StockPortFault::EvidenceConflict);
            }
        }
        let (report, steps) = self.derive_finish()?;
        if self.report() != Some(&report) || self.steps() != steps {
            return Err(StockPortFault::EvidenceConflict);
        }
        self.check_current(context)?;
        Ok(QueuedUploadFinishEvidence {
            effects_identity: &self.historical_identity,
            qualified_readback_identity: self
                .qualified
                .get()
                .and_then(|_| self.pending.get().map(|p| p.historical_identity())),
            execution: &self.proxy.execution,
            report: self.report().ok_or(StockPortFault::Unavailable)?,
            steps: self.steps(),
        })
    }
    pub async fn finish(
        self: Arc<Self>,
    ) -> Result<jobs::JobSnapshot, QueuedUploadSourceError<Arc<Self>>> {
        let result = async {
            self.finish_attempted
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map_err(|_| StockPortFault::EvidenceConflict)?;
            self.freeze_finish()?;
            let (reply, receiver) = oneshot::channel();
            self.proxy
                .send(
                    QueuedUploadExecutionPhaseRequest::Finish {
                        execution: self.proxy.execution.clone(),
                        effects: self.clone(),
                        deadline: self.deadline,
                        reply,
                    },
                    self.deadline,
                )
                .await
                .map_err(|_| StockPortFault::Unavailable)?;
            // A finish already submitted remains awaited, preserving committed DATA
            // even when its later full Access release fails.
            let (result, committed) = receiver.await.map_err(|_| StockPortFault::Unavailable)?;
            if let Some(snapshot) = committed {
                self.committed
                    .set(snapshot)
                    .map_err(|_| StockPortFault::EvidenceConflict)?;
            }
            let snapshot = result.map_err(|_| StockPortFault::Unavailable)?;
            if !self.proxy.execution.matches_released_finish(&snapshot) {
                return Err(StockPortFault::EvidenceConflict);
            }
            Ok(snapshot)
        }
        .await;
        result.map_err(|code| QueuedUploadSourceError { code, owner: self })
    }
    fn check_current(&self, context: &FreshQualification<'_, '_, '_>) -> PortResult<()> {
        check_execution(&self.proxy.execution, self.proxy.native)?;
        self.proxy
            .native
            .revalidate_in_guard(
                context,
                self.proxy.native.command(),
                self.proxy.native.authority(),
            )
            .map_err(|_| StockPortFault::EvidenceConflict)
    }
    fn check_report(&self) -> PortResult<()> {
        let native = self.proxy.native;
        let e = &self.transport.evidence;
        if e.operation_id != native.command().request_id
            || e.operation_id != self.permit.operation_id
            || e.plan_digest != self.permit.plan_digest
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        match &self.transport.dispatch {
            NativeDispatch::NeverInvoked
                if e.activity == write_transport::PhysicalActivity::NotStarted =>
            {
                Ok(())
            }
            NativeDispatch::Invoked(receipt)
                if e.activity != write_transport::PhysicalActivity::NotStarted
                    && receipt.operation_id == self.permit.operation_id
                    && receipt.plan_digest == self.permit.plan_digest
                    && receipt.context == native.command().context
                    && receipt.source_instance_id == native.command().target.source_instance_id
                    && receipt.collection_id == native.command().target.collection_id
                    && receipt.remote_activity == RemoteActivity::end_unproven() =>
            {
                if let Some(response) = &receipt.response
                    && (e.response_status != Some(response.status)
                        || e.response_body_digest.as_ref() != Some(&response.body_digest)
                        || e.activity != write_transport::PhysicalActivity::ResponseReceived)
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                Ok(())
            }
            _ => Err(StockPortFault::EvidenceConflict),
        }
    }
    fn freeze_finish(&self) -> PortResult<()> {
        let (report, steps) = self.derive_finish()?;
        if let Some(existing) = self.report() {
            if existing != &report || self.steps() != steps {
                return Err(StockPortFault::EvidenceConflict);
            }
            return Ok(());
        }
        self.steps
            .set(steps)
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        self.finish_report
            .set(report)
            .map_err(|_| StockPortFault::EvidenceConflict)
    }
    fn derive_finish(&self) -> PortResult<(jobs::FinishReport, Vec<storage::QueueStepEvidence>)> {
        self.check_report()?;
        let native = self.proxy.native;
        let mut liability = self
            .proxy
            .execution
            .native_preparation()
            .prepared()
            .storage_liability
            .clone();
        let mut response_digest = None;
        let mut readback_digest = None;
        let disposition = match &self.transport.dispatch {
            NativeDispatch::NeverInvoked => {
                jobs::FinishDisposition::Failed(jobs::FailureCode::Unavailable)
            }
            NativeDispatch::Invoked(receipt) => {
                liability.metadata_commit_evidence = jobs::MetadataCommitEvidence::Unknown;
                liability.byte_disposition = jobs::ByteDisposition::Unknown;
                let contracts =
                    NativeWriterContracts::new().map_err(|_| StockPortFault::Unavailable)?;
                let facts = super::evidence::dispatch_facts(
                    &contracts,
                    native.command(),
                    native.plan(),
                    &self.permit,
                    receipt,
                );
                response_digest = facts.response_digest.as_ref().map(job_digest).transpose()?;
                let observed = self.qualified.get();
                let matched = facts.response_success
                    && generated_match(native.plan(), &facts, receipt, observed.map(|q| q.value()));
                if matched {
                    let observed = observed.ok_or(StockPortFault::EvidenceConflict)?;
                    let at = chrono::DateTime::parse_from_rfc3339(observed.observed_at())
                        .ok()
                        .and_then(|t| u64::try_from(t.timestamp_millis()).ok())
                        .ok_or(StockPortFault::EvidenceConflict)?;
                    let readback = job_digest(observed.digest())?;
                    readback_digest = Some(readback.clone());
                    jobs::FinishDisposition::Succeeded(jobs::AppliedWrite {
                        external_id: facts
                            .generated_target
                            .as_ref()
                            .and_then(|t| t.id().ok())
                            .map(|id| id.to_string()),
                        source_updated_at: observed.value()["updatedAt"]
                            .as_str()
                            .map(str::to_owned),
                        observation: jobs::ObservedWriteEvidence {
                            response_digest: response_digest
                                .clone()
                                .ok_or(StockPortFault::EvidenceConflict)?,
                            readback_digest: readback,
                            observed_at: at,
                        },
                    })
                } else {
                    jobs::FinishDisposition::Hold(jobs::FailureCode::OutcomeUnknown)
                }
            }
            NativeDispatch::Unavailable => return Err(StockPortFault::Unavailable),
        };
        let job = self.proxy.execution.attempt().job();
        let payload=serde_json::to_vec(&json!({"format":"houseatlas-homebox-upload-queue-effects/1",
            "jobId":job.lease.job_id.0,"fence":job.lease.fence,"attempt":job.attempt,
            "requestId":native.command().request_id,"requestDigest":native.command().request_digest,
            "planDigest":self.permit.plan_digest,"responseDigest":response_digest.as_ref().map(jobs::Digest::as_hex),
            "readbackRawSha256":self.pending.get().map(|p|p.raw_digest()).transpose()?.as_ref().map(Digest::as_str),
            "qualifiedReadbackRawSha256":self.qualified.get().map(|q|q.digest().as_str()),
            "observedAt":self.qualified.get().map(|q|q.observed_at()),"remoteTermination":"unproven"}))
            .map_err(|_|StockPortFault::EvidenceConflict)?;
        if payload.len() > 1_048_576 {
            return Err(StockPortFault::EvidenceConflict);
        }
        let kind = if matches!(disposition, jobs::FinishDisposition::Succeeded(_)) {
            storage::StepKind::ResponseReadback
        } else {
            storage::StepKind::Other
        };
        let remote_activity = if matches!(self.transport.dispatch, NativeDispatch::NeverInvoked) {
            jobs::RemoteActivity::NotDispatched
        } else {
            jobs::RemoteActivity::Invoked(jobs::InvokedRemoteActivity::EndUnproven)
        };
        Ok((
            jobs::FinishReport {
                disposition,
                remote_activity,
                storage_liability: liability,
            },
            vec![storage::QueueStepEvidence {
                kind,
                codec: "houseatlas-homebox-upload-queue-effects/1".into(),
                payload,
                response_digest,
                readback_digest,
                termination_digest: None,
            }],
        ))
    }
}
fn check_execution(execution: &Arc<Execution>, native: &Native<'_, '_, '_>) -> PortResult<()> {
    let cut = execution.upload_cut();
    if !Arc::ptr_eq(cut, execution.native_preparation().upload_cut())
        || !execution.native_preparation().matches_original(cut)
        || !execution.journal().matches_attempt(execution.attempt())
        || execution.journal().job() != execution.attempt().job()
        || execution.journal().prepared() != execution.native_preparation().prepared()
        || cut.command() != native.command()
        || cut.plan() != native.plan()
        || cut.authority() != native.authority()
        || cut.preflight() != native.preflight()
        || cut.owner_preflight() != native.owner_preflight()
        || cut.capture_digest() != native.capture().capture_digest()
        || !cut.matches_source_preparation(native.capture().evidence().source_preparation())
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    let configured = native.source().configured();
    if cut.queue_config() != configured.queue()
        || native.command().approval_receipt_id.is_some()
        || native.command().payload["primary"] != serde_json::Value::Bool(false)
        || !matches!(
            native.command().payload["type"].as_str(),
            Some("manual" | "warranty" | "attachment" | "receipt")
        )
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(())
}
fn generated_match(
    plan: &NativePlan,
    facts: &DispatchFacts,
    receipt: &DispatchReceipt,
    readback: Option<&serde_json::Value>,
) -> bool {
    let Some(value) = readback else { return false };
    let Some(target) = facts.generated_target.as_ref() else {
        return false;
    };
    let Ok(id) = target.id() else { return false };
    let Some(response) = receipt.response.as_ref() else {
        return false;
    };
    let GeneratedIdentity::EntityMember { field, before_ids } = &plan.generated else {
        return false;
    };
    let Some(expected_ids) = facts
        .generated_members
        .iter()
        .find(|(f, _)| f == field)
        .map(|(_, ids)| ids)
    else {
        return false;
    };
    let Some(rows) = value[field].as_array() else {
        return false;
    };
    let mut ids = Vec::new();
    for row in rows {
        let Some(id) = row["id"]
            .as_str()
            .and_then(|s| uuid::Uuid::parse_str(s).ok())
            .filter(|id| !id.is_nil())
        else {
            return false;
        };
        if ids.contains(&id) {
            return false;
        }
        ids.push(id);
    }
    if ids.len() != expected_ids.len()
        || ids.iter().any(|id| !expected_ids.contains(id))
        || before_ids.iter().any(|id| !ids.contains(id))
    {
        return false;
    }
    let owner = plan.readback.target.owner().ok().map(|id| id.to_string());
    if value["id"].as_str() != owner.as_deref() {
        return false;
    }
    let Some(expected) = plan.readback.expected.as_object() else {
        return false;
    };
    let selected = |value: &serde_json::Value| {
        value[field]
            .as_array()
            .and_then(|rows| {
                rows.iter().find(|row| {
                    row["id"]
                        .as_str()
                        .and_then(|s| uuid::Uuid::parse_str(s).ok())
                        == Some(id)
                })
            })
            .is_some_and(|row| {
                expected
                    .iter()
                    .all(|(key, value)| row.get(key) == Some(value))
            })
    };
    selected(value) && selected(&response.value)
}
fn job_digest(digest: &Digest) -> PortResult<jobs::Digest> {
    jobs::Digest::from_hex(digest.as_str().to_owned()).map_err(|_| StockPortFault::EvidenceConflict)
}

pub(super) struct QueuedUploadHistoricalEffectFacts<'a, 'captured, 'p> {
    pub(super) permit: &'a InvocationPermit,
    pub(super) native_command: &'a StockCommand,
    pub(super) native_plan: &'a NativePlan,
    pub(super) native_authority: &'a StockAuthority,
    pub(super) report: &'a write_transport::DispatchReport,
    pub(super) finish: &'a jobs::FinishReport,
    pub(super) steps: &'a [storage::QueueStepEvidence],
    pub(super) pending: Option<&'a PendingQueuedUploadReadback<'captured, 'p>>,
    pub(super) qualified: Option<&'a QualifiedQueuedUploadReadback<'captured, 'p>>,
}
impl<'native, 'owner, 'captured, 'p> CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p> {
    pub(super) fn historical_facts(
        &self,
    ) -> PortResult<QueuedUploadHistoricalEffectFacts<'_, 'captured, 'p>> {
        check_execution(&self.proxy.execution, self.proxy.native)?;
        self.check_report()?;
        if let Some(pending) = self.pending.get()
            && !pending.matches_source(self.proxy.native.source())
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        if let Some(qualified) = self.qualified.get()
            && !self
                .pending
                .get()
                .is_some_and(|pending| qualified.matches_capture(pending))
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(QueuedUploadHistoricalEffectFacts {
            permit: &self.permit,
            native_command: self.proxy.native.command(),
            native_plan: self.proxy.native.plan(),
            native_authority: self.proxy.native.authority(),
            report: &self.transport,
            finish: self.report().ok_or(StockPortFault::EvidenceConflict)?,
            steps: self.steps(),
            pending: self.pending.get().map(Arc::as_ref),
            qualified: self.qualified.get(),
        })
    }
    // Call only after bounded historical input and derivation-work accounting.
    pub(super) fn validate_historical_frozen(&self) -> PortResult<()> {
        let (report, steps) = self.derive_finish()?;
        if self.report() != Some(&report) || self.steps() != steps {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(())
    }
}
