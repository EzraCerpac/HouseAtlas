//! A local stack continuation of the SAME released upload admission.
//! Only owned typed phase messages cross the transport's genuine Sync boundary.
use super::{
    Core, RequestPrincipal, homebox_queued_upload_admission::OriginalQueuedUploadAdmission,
};
use crate::media::native_queued_upload::{
    NativeQueuedUploadDispatchBody, NativeQueuedUploadDispatchBounds,
};
use crate::providers::homebox::write::stock::{
    self as native, QualifiedQueuedUploadReadback, StockContractPort as _,
    queued_upload_dispatch::{
        CapturedQueuedUploadEffects, QueuedUploadExecutionPhaseProxy,
        QueuedUploadExecutionPhaseRequest, QueuedUploadNativeAttempt,
    },
};
use crate::providers::homebox::write_transport;
use crate::{access, domain::stock as domain, jobs, storage};
use sha2::{Digest as _, Sha256};
use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};

fn unavailable() -> storage::Error {
    storage::Error::new("owner-unavailable", "Original upload execution unavailable")
}

/// This boundary deliberately borrows the original non-Sync admission on the
/// local stack. It issues no new request principal, stage, claim or journal.
pub struct OriginalQueuedUploadExecutionBoundary<'a, 'bundle, 'native, 'owner, 'captured, 'p> {
    core: &'a Core,
    admission: &'a OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
    execution: Arc<storage::OriginalQueuedUploadExecution>,
    body_attempted: Cell<bool>,
    header_attempted: Cell<bool>,
    finish_attempted: Cell<bool>,
    finish_observation: storage::QueueUploadFinishCommittedObservation,
    committed_finish: RefCell<Option<storage::QueueUploadFinishCommittedData>>,
}

pub struct OriginalQueuedUploadExecutionOutcome<'native, 'owner, 'captured, 'p> {
    effects: Arc<CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>>,
    finish: Result<jobs::JobSnapshot, native::StockPortFault>,
    committed: Option<jobs::JobSnapshot>,
}
impl<'native, 'owner, 'captured, 'p>
    OriginalQueuedUploadExecutionOutcome<'native, 'owner, 'captured, 'p>
{
    pub fn effects(&self) -> &Arc<CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>> {
        &self.effects
    }
    pub fn finish(&self) -> &Result<jobs::JobSnapshot, native::StockPortFault> {
        &self.finish
    }
    pub fn committed_snapshot(&self) -> Option<&jobs::JobSnapshot> {
        self.committed.as_ref()
    }
}

impl<'a, 'bundle, 'native, 'owner, 'captured, 'p>
    OriginalQueuedUploadExecutionBoundary<'a, 'bundle, 'native, 'owner, 'captured, 'p>
{
    pub fn bind(
        core: &'a Core,
        admission: &'a OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        attempt: storage::OriginalQueuedUploadAttempt,
        journal: storage::OriginalUploadJournalCut,
    ) -> storage::Result<Self> {
        if !Arc::ptr_eq(&core.access, admission.preparation().configured().access()) {
            return Err(unavailable());
        }
        let execution = {
            let store = core.store.try_lock().map_err(|_| unavailable())?;
            storage::OriginalQueuedUploadExecution::from_original(
                &store, admission, attempt, journal,
            )?
        };
        Ok(Self {
            core,
            admission,
            execution: Arc::new(execution),
            body_attempted: Cell::new(false),
            header_attempted: Cell::new(false),
            finish_attempted: Cell::new(false),
            finish_observation: storage::QueueUploadFinishCommittedObservation::new(),
            committed_finish: RefCell::new(None),
        })
    }

    pub fn admission(
        &self,
    ) -> &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p> {
        self.admission
    }
    pub fn execution(&self) -> &Arc<storage::OriginalQueuedUploadExecution> {
        &self.execution
    }
    pub fn job(&self) -> &jobs::LeasedJob {
        self.execution.attempt().job()
    }

    pub fn consume_body(
        &self,
        bounds: NativeQueuedUploadDispatchBounds<'_>,
    ) -> storage::Result<NativeQueuedUploadDispatchBody> {
        // Failure, cancellation, or a second request never restores this gate.
        if self.body_attempted.replace(true) {
            return Err(unavailable());
        }
        let deadline = self
            .admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(bounds.budget)
            .map_err(|_| unavailable())?
            .min(bounds.deadline);
        let mut store = self.core.store.try_lock().map_err(|_| unavailable())?;
        store.with_original_upload_execution_phase(
            self.admission,
            &self.execution,
            deadline,
            bounds.budget,
            |guard, physical| {
                NativeQueuedUploadDispatchBody::capture_under_guard(
                    self.execution.native_preparation(),
                    self.execution.journal(),
                    self.execution.attempt(),
                    self.admission,
                    guard,
                    physical,
                    bounds,
                )
                .map_err(|_| unavailable())
            },
        )
    }

    pub fn consume_header(
        &self,
        endpoint: &write_transport::SourceEndpoint,
        permit: &native::InvocationPermit,
        plan: &native::NativePlan,
        authority: &native::StockAuthority,
        deadline: std::time::Instant,
    ) -> Result<write_transport::AuthorizationHeader, write_transport::TransportFault> {
        if self.header_attempted.replace(true) {
            return Err(write_transport::TransportFault::Resources);
        }
        let prepared = self.admission.preparation().native();
        if plan != prepared.plan() || authority != prepared.authority() {
            return Err(write_transport::TransportFault::Binding);
        }
        let budget =
            phase_budget(deadline).map_err(|_| write_transport::TransportFault::Deadline)?;
        let deadline = prepared
            .source()
            .original_capture_deadline(&budget)
            .map_err(|_| write_transport::TransportFault::Deadline)?
            .min(deadline);
        let mut store = self
            .core
            .store
            .try_lock()
            .map_err(|_| write_transport::TransportFault::Resources)?;
        store
            .with_original_upload_dispatch_header(
                self.admission,
                &self.execution,
                deadline,
                &budget,
                |guard, physical| {
                    let qualification =
                        native::FreshQualification::with_queued_upload_installation(
                            guard,
                            self.admission.preparation().captured(),
                            physical,
                        )
                        .map_err(|_| unavailable())?;
                    prepared
                        .source()
                        .deliver_header_in_guard(
                            prepared,
                            endpoint,
                            permit,
                            deadline,
                            &qualification,
                        )
                        .map_err(|_| unavailable())
                },
            )
            .map_err(|_| write_transport::TransportFault::Resources)
    }
    fn matches_body_request(
        &self,
        permit: &native::InvocationPermit,
        stage: &native::StagedUpload,
    ) -> bool {
        let prepared = self.admission.preparation().native();
        let configured = prepared.source().configured();
        let physical = configured.physical();
        let authority = prepared.authority();
        let digest = crate::providers::homebox::recovery::NativeWriterContracts::new()
            .ok()
            .and_then(|contracts| {
                serde_json::to_value(prepared.plan())
                    .ok()
                    .and_then(|value| contracts.digest_native(&value).ok())
            });
        stage
            == prepared
                .capture()
                .evidence()
                .source_preparation()
                .staged_upload()
            && permit.operation_id == prepared.command().request_id
            && permit.actor_id == authority.actor_id
            && permit.physical_binding == physical.physical_binding
            && permit.owner_id == physical.owner_id
            && permit.dispatcher_epoch == physical.dispatcher_epoch
            && permit.source_epoch == authority.source_epoch
            && permit.qualification == authority.qualification
            && digest.as_ref() == Some(&permit.plan_digest)
    }
    pub fn check_readback(&self, deadline: std::time::Instant) -> storage::Result<()> {
        let budget = phase_budget(deadline)?;
        let deadline = self
            .admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(&budget)
            .map_err(|_| unavailable())?
            .min(deadline);
        let mut store = self.core.store.try_lock().map_err(|_| unavailable())?;
        store.queued_upload_check_readback(self.admission, &self.execution, deadline, &budget)
    }

    pub fn qualify_readback(
        &self,
        effects: &CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>,
        deadline: std::time::Instant,
    ) -> Result<QualifiedQueuedUploadReadback<'captured, 'p>, native::StockPortFault> {
        if !effects.matches_execution(&self.execution)
            || !effects.matches_native(self.admission.preparation().native())
        {
            return Err(native::StockPortFault::EvidenceConflict);
        }
        let budget = phase_budget(deadline).map_err(|_| native::StockPortFault::Unavailable)?;
        let deadline = self
            .admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(&budget)
            .map_err(|_| native::StockPortFault::Unavailable)?
            .min(deadline);
        let mut store = self
            .core
            .store
            .try_lock()
            .map_err(|_| native::StockPortFault::Unavailable)?;
        store
            .with_original_upload_execution_phase(
                self.admission,
                &self.execution,
                deadline,
                &budget,
                |guard, physical| {
                    let qualification =
                        native::FreshQualification::with_queued_upload_installation(
                            guard,
                            self.admission.preparation().captured(),
                            physical,
                        )
                        .map_err(|_| unavailable())?;
                    effects
                        .qualify_readback_in_guard(&qualification)
                        .map_err(|_| unavailable())
                },
            )
            .map_err(|_| native::StockPortFault::Unavailable)
    }
    pub async fn execute(
        &self,
        limits: write_transport::Limits,
        deadline: tokio::time::Instant,
        cancellation: tokio_util::sync::CancellationToken,
    ) -> Result<
        OriginalQueuedUploadExecutionOutcome<'native, 'owner, 'captured, 'p>,
        native::StockPortFault,
    > {
        let budget =
            phase_budget(deadline.into_std()).map_err(|_| native::StockPortFault::Unavailable)?;
        let deadline = deadline.min(tokio::time::Instant::from_std(
            self.admission
                .preparation()
                .native()
                .source()
                .original_capture_deadline(&budget)
                .map_err(|_| native::StockPortFault::Unavailable)?,
        ));
        let (proxy, mut receiver) = QueuedUploadExecutionPhaseProxy::channel(
            Arc::clone(&self.execution),
            self.admission.preparation().native(),
        )?;
        let attempt = QueuedUploadNativeAttempt::from_journaled_original(
            proxy,
            limits,
            deadline,
            cancellation,
        )?;
        let work = async {
            let effects = attempt.execute().await;
            let effects = match effects.capture_readback().await {
                Ok(effects) => effects,
                Err(error) => error.into_owner(),
            };
            let finish = effects.clone().finish().await.map_err(|error| error.code());
            OriginalQueuedUploadExecutionOutcome {
                committed: effects.committed_snapshot().cloned(),
                effects,
                finish,
            }
        };
        tokio::pin!(work);
        loop {
            tokio::select! {
                outcome = &mut work => return Ok(outcome),
                request = receiver.recv() => {
                    let Some(request) = request else { return Ok((&mut work).await); };
                    self.service_phase(request);
                }
            }
        }
    }
    fn service_phase(
        &self,
        request: QueuedUploadExecutionPhaseRequest<'native, 'owner, 'captured, 'p>,
    ) {
        match request {
            QueuedUploadExecutionPhaseRequest::Body(request) => {
                let result = if Arc::ptr_eq(&request.execution, &self.execution) {
                    (|| {
                        let budget = phase_budget(request.deadline.into_std())
                            .map_err(|_| write_transport::TransportFault::Deadline)?;
                        let body = self
                            .consume_body(NativeQueuedUploadDispatchBounds {
                                max_bytes: request.max_bytes,
                                deadline: request.deadline.into_std(),
                                budget: &budget,
                            })
                            .map_err(|_| write_transport::TransportFault::Stage)?;
                        if !self.matches_body_request(&request.permit, &request.stage) {
                            return Err(write_transport::TransportFault::Stage);
                        }
                        Ok(body)
                    })()
                } else {
                    Err(write_transport::TransportFault::Binding)
                };
                let _ = request.reply.send(result);
            }
            QueuedUploadExecutionPhaseRequest::Header(request) => {
                let result = if Arc::ptr_eq(&request.execution, &self.execution) {
                    self.consume_header(
                        &request.endpoint,
                        &request.permit,
                        &request.plan,
                        &request.authority,
                        request.deadline.into_std(),
                    )
                } else {
                    Err(write_transport::TransportFault::Binding)
                };
                let _ = request.reply.send(result);
            }
            QueuedUploadExecutionPhaseRequest::CheckReadback {
                execution,
                deadline,
                reply,
            } => {
                let result = if Arc::ptr_eq(&execution, &self.execution) {
                    self.check_readback(deadline.into_std())
                        .map_err(|_| native::StockPortFault::Unavailable)
                } else {
                    Err(native::StockPortFault::EvidenceConflict)
                };
                let _ = reply.send(result);
            }
            QueuedUploadExecutionPhaseRequest::QualifyReadback {
                execution,
                effects,
                deadline,
                reply,
            } => {
                let result = if Arc::ptr_eq(&execution, &self.execution) {
                    self.qualify_readback(&effects, deadline.into_std())
                } else {
                    Err(native::StockPortFault::EvidenceConflict)
                };
                let _ = reply.send(result);
            }
            QueuedUploadExecutionPhaseRequest::Finish {
                execution,
                effects,
                deadline,
                reply,
            } => {
                let result = if Arc::ptr_eq(&execution, &self.execution) {
                    self.finish(&effects, deadline.into_std())
                } else {
                    Err(unavailable())
                };
                let _ = reply.send((result, self.committed_snapshot()));
            }
        }
    }

    pub fn finish(
        &self,
        effects: &CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>,
        deadline: std::time::Instant,
    ) -> storage::Result<jobs::JobSnapshot> {
        if self.finish_attempted.replace(true) {
            return Err(unavailable());
        }
        let result = (|| {
            if !effects.matches_execution(&self.execution)
                || !effects.matches_native(self.admission.preparation().native())
            {
                return Err(unavailable());
            }
            let budget = phase_budget(deadline)?;
            let deadline = self
                .admission
                .preparation()
                .native()
                .source()
                .original_capture_deadline(&budget)
                .map_err(|_| unavailable())?
                .min(deadline);
            let mut store = self.core.store.try_lock().map_err(|_| unavailable())?;
            store.queued_upload_finish_owned(
                self.admission,
                &self.execution,
                effects,
                &self.finish_observation,
                deadline,
                &budget,
            )
        })();
        // A commit survives a later engine/Access/output failure as diagnostic DATA.
        if let Some(data) = self.finish_observation.take() {
            *self.committed_finish.borrow_mut() = Some(data);
        }
        result
    }
    pub fn committed_snapshot(&self) -> Option<jobs::JobSnapshot> {
        self.committed_finish
            .borrow()
            .as_ref()
            .map(|data| data.snapshot().clone())
    }
}

fn phase_budget(deadline: std::time::Instant) -> storage::Result<crate::media::WorkBudget> {
    let remaining = deadline
        .checked_duration_since(std::time::Instant::now())
        .ok_or_else(unavailable)?;
    crate::media::WorkBudget::new(
        remaining.min(std::time::Duration::from_secs(10)),
        crate::media::Cancellation::default(),
    )
    .map_err(|_| unavailable())
}

/// A temporary Access adapter. Current native/Media/physical qualification is
/// separately mandatory through the closed actual-db upload execution context.
pub(crate) struct QueuedUploadExecutionPhase<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p> {
    admission: &'phase OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
    execution: &'phase Arc<storage::OriginalQueuedUploadExecution>,
    guard: &'phase access::TransactionAuthorization<'tx>,
    finish: Option<(
        &'phase jobs::FinishReport,
        &'phase [storage::QueueStepEvidence],
    )>,
}

impl<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p>
    QueuedUploadExecutionPhase<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p>
{
    pub(crate) fn new(
        admission: &'phase OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        execution: &'phase Arc<storage::OriginalQueuedUploadExecution>,
        guard: &'phase access::TransactionAuthorization<'tx>,
        finish: Option<(
            &'phase jobs::FinishReport,
            &'phase [storage::QueueStepEvidence],
        )>,
    ) -> storage::Result<Self> {
        admission.revalidate_guard(guard)?;
        let cut = execution.journal();
        if !cut.matches_attempt(execution.attempt())
            || !Arc::ptr_eq(cut.native_preparation(), execution.native_preparation())
            || !Arc::ptr_eq(cut.upload_cut(), admission.upload_cut())
            || !Arc::ptr_eq(execution.upload_cut(), admission.upload_cut())
        {
            return Err(unavailable());
        }
        Ok(Self {
            admission,
            execution,
            guard,
            finish,
        })
    }

    fn check(
        &self,
        principal: &RequestPrincipal,
        witness: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        original: &domain::ValidatedRequest,
    ) -> storage::Result<()> {
        if !std::ptr::eq(principal, self.admission.principal())
            || !std::ptr::eq(witness, self.admission)
            || !std::ptr::eq(original, self.admission.original())
            || storage::original_upload_execution_now()?
                >= self.execution.attempt().job().lease.expires_at
        {
            return Err(unavailable());
        }
        self.admission.revalidate_guard(self.guard)
    }

    fn journal_matches(&self, view: &storage::JournalEvidenceView) -> bool {
        let cut = self.execution.journal();
        view.native_codec == cut.prepared().codec
            && view.native_payload_digest == cut.receipt().native_payload_digest
            && view.journal_evidence_digest == cut.receipt().journal_evidence_digest
            && view.prepared_media_digest.as_hex()
                == format!(
                    "{:x}",
                    Sha256::digest(&cut.prepared().prepared_media_evidence)
                )
            && view.prepared_liability == cut.prepared().storage_liability
    }
}

impl<'bundle, 'native, 'owner, 'captured, 'p> storage::QueueAuthorization
    for QueuedUploadExecutionPhase<'_, '_, 'bundle, 'native, 'owner, 'captured, 'p>
{
    type Principal = RequestPrincipal;
    type Witness = OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>;
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        witness: &Self::Witness,
        original: &domain::ValidatedRequest,
        _phase: storage::QueuePhase,
        action: storage::QueueAction<'_>,
    ) -> storage::Result<storage::VerifiedActor> {
        self.check(principal, witness, original)?;
        let expected_job = self.execution.attempt().job();
        let exact = match action {
            storage::QueueAction::Lease(lease) => lease == &expected_job.lease,
            storage::QueueAction::Dispatch { job, journal, now } => {
                job == expected_job
                    && now < expected_job.lease.expires_at
                    && self.journal_matches(journal)
            }
            storage::QueueAction::Snapshot(receipt) => {
                self.finish.is_some() && std::ptr::eq(receipt, &self.admission.request().receipt)
            }
            storage::QueueAction::Finish {
                job,
                report,
                journal,
                steps,
            } => self
                .finish
                .is_some_and(|(expected_report, expected_steps)| {
                    job == expected_job
                        && std::ptr::eq(report, expected_report)
                        && std::ptr::eq(steps, expected_steps)
                        && journal.is_some_and(|view| self.journal_matches(view))
                }),
            _ => false,
        };
        if !exact {
            return Err(unavailable());
        }
        let actual = self
            .guard
            .authorize(self.guard.principal().scope(), access::Capability::Mutate)
            .map_err(|_| unavailable())?;
        Ok(storage::VerifiedActor {
            workspace_id: actual.scope().workspace_id.as_str().into(),
            home_id: actual.scope().home_id.as_str().into(),
            actor_id: actual.actor_id().as_str().into(),
        })
    }
    fn validate_enqueue(
        &self,
        _: &RequestPrincipal,
        _: &Self::Witness,
        _: &domain::ValidatedRequest,
        _: &jobs::EnqueueRequest,
        _: &jobs::CanonicalScope,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
    fn parse_retained_original(
        &self,
        _: serde_json::Value,
    ) -> storage::Result<domain::ValidatedRequest> {
        Err(unavailable())
    }
    fn remote_end_step(
        &self,
        _: &RequestPrincipal,
        _: &Self::Witness,
        _: &domain::ValidatedRequest,
        _: &jobs::RemoteEndEvidence,
        _: &jobs::LeasedJob,
        _: &storage::JournalEvidenceView,
    ) -> storage::Result<storage::QueueStepEvidence> {
        Err(unavailable())
    }
    fn reconciliation_steps(
        &self,
        _: &RequestPrincipal,
        _: &Self::Witness,
        _: &domain::ValidatedRequest,
        _: &jobs::HeldJob,
        _: &jobs::ReconciliationEvidence,
        _: &jobs::FinishDisposition,
    ) -> storage::Result<Vec<storage::QueueStepEvidence>> {
        Err(unavailable())
    }
}
