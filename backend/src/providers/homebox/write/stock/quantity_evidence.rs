//! Consuming native evidence custody for the actual original quantity session.
//! Driver results are retained before journal or disclosure awaits. Response and
//! readback agreement never establish remote termination, causality, or CAS.
use super::*;
use crate::{
    app::{
        self, homebox_quantity_graph::OriginalQuantityPreparation,
        stock_activity_principal::OriginalStockActivityPrincipal,
    },
    http::contracts::NativeContracts,
    media::native::NativeMediaRuntime,
    providers::homebox::{read, recovery::NativeWriterContracts, write_transport},
    storage::{self, StockActivitySession},
};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

type OriginalPreparation<'n, 'p, 'o, T, K> = OriginalQuantityPreparation<'n, 'p, 'o, T, K>;
type Authorization<'b, 'n, 'p, 'o, T, K> = QuantityActivityAuthorization<'b, 'n, 'p, 'o, T, K>;
type Session<'b, 'n, 'p, 'o, T, K> = StockActivitySession<
    NativeContracts,
    app::ReadAuthority,
    NativeMediaRuntime<app::ServerRuntime>,
    OriginalStockActivityPrincipal,
    Authorization<'b, 'n, 'p, 'o, T, K>,
    NativeWriterContracts,
>;

pub(super) struct QuantityEvidenceState<'b, 'p, T: read::Transport, K: read::Clock + Send + Sync> {
    claimed: bool,
    report: Option<write_transport::DispatchReport>,
    observation: Option<RetainedFreshReadback<'b, NativeWriterContracts, QuantitySource<'p, T, K>>>,
    journal: Option<JournalExpectation>,
}
struct JournalExpectation {
    prior: StoredOperation,
    expected: StoredOperation,
    facts: JournalFacts,
    phase: JournalPhase,
}
enum JournalFacts {
    NeverInvoked(InvocationPermit),
    Dispatch(InvocationPermit, DispatchFacts),
    Observation(ObservationFacts),
}
#[derive(PartialEq)]
enum JournalPhase {
    Armed,
    Entered,
    Precommitted,
}
impl<T: read::Transport, K: read::Clock + Send + Sync> Default
    for QuantityEvidenceState<'_, '_, T, K>
{
    fn default() -> Self {
        Self {
            claimed: false,
            report: None,
            observation: None,
            journal: None,
        }
    }
}
impl<T: read::Transport, K: read::Clock + Send + Sync> QuantityEvidenceState<'_, '_, T, K> {
    pub(super) fn disclosable(&self, operation: &StoredOperation) -> bool {
        self.journal
            .as_ref()
            .is_some_and(|j| j.phase == JournalPhase::Precommitted && &j.expected == operation)
    }
    pub(super) fn authorize(
        &mut self,
        phase: storage::StockActivityPhase,
        action: storage::StockActivityAction<'_>,
    ) -> Result<(), StockPortFault> {
        let j = self.journal.as_mut().ok_or(StockPortFault::Unavailable)?;
        let matches = match (&j.facts, action) {
            (
                JournalFacts::NeverInvoked(p),
                storage::StockActivityAction::NeverInvoked(o, actual),
            ) => o == &j.prior && actual == p,
            (
                JournalFacts::Dispatch(p, f),
                storage::StockActivityAction::Dispatch(o, actual_p, actual_f),
            ) => o == &j.prior && actual_p == p && actual_f == f,
            (
                JournalFacts::Observation(f),
                storage::StockActivityAction::Observation(o, actual),
            ) => o == &j.prior && actual == f,
            _ => false,
        };
        if !matches {
            return Err(StockPortFault::EvidenceConflict);
        }
        j.phase = match (phase, &j.phase) {
            (storage::StockActivityPhase::Entry, JournalPhase::Armed) => JournalPhase::Entered,
            (storage::StockActivityPhase::Precommit, JournalPhase::Entered) => {
                JournalPhase::Precommitted
            }
            _ => return Err(StockPortFault::EvidenceConflict),
        };
        Ok(())
    }
    fn arm(&mut self, prior: &StoredOperation, facts: JournalFacts) -> Result<(), StockPortFault> {
        if self
            .journal
            .as_ref()
            .is_some_and(|j| !self.disclosable(prior) || j.phase != JournalPhase::Precommitted)
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let mut expected = prior.clone();
        match &facts {
            JournalFacts::NeverInvoked(_) => {
                expected.outcome.state = OutcomeState::RejectedBeforeDispatch;
                expected.outcome.verification = Verification::NoDispatch;
                expected.outcome.remote_activity = RemoteActivity::not_dispatched();
                expected.outcome.unknown_scope_fence_retained = false;
            }
            JournalFacts::Dispatch(_, f) => {
                expected.outcome = expected
                    .outcome
                    .with_dispatch(f)
                    .ok_or(StockPortFault::EvidenceConflict)?;
                expected.actual_target = f.generated_target.clone();
                expected.generated_members = f.generated_members.clone();
            }
            JournalFacts::Observation(f) => {
                expected.outcome = expected
                    .outcome
                    .with_observation(f)
                    .ok_or(StockPortFault::EvidenceConflict)?
            }
        }
        expected.activity_version = expected
            .activity_version
            .checked_add(1)
            .ok_or(StockPortFault::VersionConflict)?;
        self.journal = Some(JournalExpectation {
            prior: prior.clone(),
            expected,
            facts,
            phase: JournalPhase::Armed,
        });
        Ok(())
    }
}

/// Owns the real dispatcher and a consumed original invocation. No adopted
/// report, dispatcher, facts, or retry handle can enter this owner.
pub struct QuantityNativeAttempt<'b, 'n, 'p, 'o, T: read::Transport, K: read::Clock + Send + Sync> {
    session: &'b Session<'b, 'n, 'p, 'o, T, K>,
    preparation: &'b OriginalPreparation<'n, 'p, 'o, T, K>,
    dispatcher: write_transport::HttpDispatcher<
        QuantityDispatchResources<'b, 'n, 'p, 'o, T, K, Authorization<'b, 'n, 'p, 'o, T, K>>,
    >,
    operation: StoredOperation,
    permit: InvocationPermit,
    deadline: Instant,
    cancellation: CancellationToken,
}
impl<'b, 'n, 'p, 'o, T: read::Transport, K: read::Clock + Send + Sync>
    QuantityNativeAttempt<'b, 'n, 'p, 'o, T, K>
{
    pub fn from_original(
        session: &'b Session<'b, 'n, 'p, 'o, T, K>,
        preparation: &'b OriginalPreparation<'n, 'p, 'o, T, K>,
        invocation: storage::OriginalQuantityInvocation<'b, OriginalPreparation<'n, 'p, 'o, T, K>>,
        limits: write_transport::Limits,
        deadline: Instant,
        cancellation: CancellationToken,
    ) -> Result<Self, StockPortFault> {
        Self::from_original_bound(
            session,
            preparation,
            invocation,
            limits,
            deadline,
            cancellation,
            #[cfg(test)]
            None,
        )
    }

    #[cfg(test)]
    pub(crate) fn from_original_with_loopback_certificate(
        session: &'b Session<'b, 'n, 'p, 'o, T, K>,
        preparation: &'b OriginalPreparation<'n, 'p, 'o, T, K>,
        invocation: storage::OriginalQuantityInvocation<'b, OriginalPreparation<'n, 'p, 'o, T, K>>,
        limits: write_transport::Limits,
        deadline: Instant,
        cancellation: CancellationToken,
        certificate_der: &[u8],
    ) -> Result<Self, StockPortFault> {
        Self::from_original_bound(
            session,
            preparation,
            invocation,
            limits,
            deadline,
            cancellation,
            Some(certificate_der),
        )
    }

    fn from_original_bound(
        session: &'b Session<'b, 'n, 'p, 'o, T, K>,
        preparation: &'b OriginalPreparation<'n, 'p, 'o, T, K>,
        invocation: storage::OriginalQuantityInvocation<'b, OriginalPreparation<'n, 'p, 'o, T, K>>,
        limits: write_transport::Limits,
        deadline: Instant,
        cancellation: CancellationToken,
        #[cfg(test)] certificate_der: Option<&[u8]>,
    ) -> Result<Self, StockPortFault> {
        if !session.owns_original_quantity_invocation(&invocation, preparation) {
            return Err(StockPortFault::EvidenceConflict);
        }
        let g = session.original_quantity_authorization();
        if !g.owns_preparation(preparation) {
            return Err(StockPortFault::EvidenceConflict);
        }
        g.check_original(preparation.original())?;
        let operation = invocation.operation().clone();
        let permit = invocation.permit().clone();
        let resources = QuantityDispatchResources::new(session, preparation, invocation)?;
        #[cfg(test)]
        let dispatcher = match certificate_der {
            Some(der) => resources.into_http_with_loopback_certificate(limits, der),
            None => resources.into_http(limits),
        }
        .map_err(|_| StockPortFault::Unavailable)?;
        #[cfg(not(test))]
        let dispatcher = resources
            .into_http(limits)
            .map_err(|_| StockPortFault::Unavailable)?;
        let mut evidence = g.evidence.lock().map_err(|_| StockPortFault::Unavailable)?;
        if evidence.claimed {
            return Err(StockPortFault::EvidenceConflict);
        }
        evidence.claimed = true;
        drop(evidence);
        Ok(Self {
            session,
            preparation,
            dispatcher,
            operation,
            permit,
            deadline,
            cancellation,
        })
    }
    pub async fn execute(
        self,
    ) -> Result<CapturedQuantityDispatch<'b, 'n, 'p, 'o, T, K>, StockPortFault> {
        let report = self
            .dispatcher
            .dispatch_until(
                &self.permit,
                self.preparation.native().plan(),
                self.preparation.native().authority(),
                self.deadline,
                &self.cancellation,
            )
            .await;
        let mut evidence = self
            .session
            .original_quantity_authorization()
            .evidence
            .lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        if evidence.report.is_some() {
            return Err(StockPortFault::EvidenceConflict);
        }
        evidence.report = Some(report);
        drop(evidence);
        Ok(CapturedQuantityDispatch {
            session: self.session,
            preparation: self.preparation,
            operation: self.operation,
            permit: self.permit,
        })
    }
}
pub struct CapturedQuantityDispatch<
    'b,
    'n,
    'p,
    'o,
    T: read::Transport,
    K: read::Clock + Send + Sync,
> {
    session: &'b Session<'b, 'n, 'p, 'o, T, K>,
    preparation: &'b OriginalPreparation<'n, 'p, 'o, T, K>,
    operation: StoredOperation,
    permit: InvocationPermit,
}
impl<'b, 'n, 'p, 'o, T: read::Transport, K: read::Clock + Send + Sync>
    CapturedQuantityDispatch<'b, 'n, 'p, 'o, T, K>
{
    pub async fn record(
        self,
    ) -> Result<CapturedQuantityRecorded<'b, 'n, 'p, 'o, T, K>, StockPortFault> {
        let contracts = NativeWriterContracts::new().map_err(|_| StockPortFault::Unavailable)?;
        let facts = {
            let mut e = self
                .session
                .original_quantity_authorization()
                .evidence
                .lock()
                .map_err(|_| StockPortFault::Unavailable)?;
            let report = e.report.as_ref().ok_or(StockPortFault::Unavailable)?;
            if report.evidence.operation_id != self.operation.operation_id
                || report.evidence.plan_digest != self.permit.plan_digest
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            let facts = match &report.dispatch {
                NativeDispatch::Unavailable => return Err(StockPortFault::Unavailable),
                NativeDispatch::NeverInvoked
                    if report.evidence.activity
                        == write_transport::PhysicalActivity::NotStarted =>
                {
                    None
                }
                NativeDispatch::Invoked(receipt)
                    if receipt.remote_activity == RemoteActivity::end_unproven()
                        && report.evidence.activity
                            != write_transport::PhysicalActivity::NotStarted =>
                {
                    Some(super::evidence::dispatch_facts(
                        &contracts,
                        self.preparation.original().command(),
                        self.preparation.native().plan(),
                        &self.permit,
                        receipt,
                    ))
                }
                _ => return Err(StockPortFault::EvidenceConflict),
            };
            e.arm(
                &self.operation,
                match &facts {
                    Some(f) => JournalFacts::Dispatch(self.permit.clone(), f.clone()),
                    None => JournalFacts::NeverInvoked(self.permit.clone()),
                },
            )?;
            facts
        };
        let operation = match facts {
            Some(f) => self.session.record_dispatch(&self.permit, &f).await?,
            None => self.session.record_never_invoked(&self.permit).await?,
        };
        if !self
            .session
            .original_quantity_authorization()
            .evidence
            .lock()
            .map_err(|_| StockPortFault::Unavailable)?
            .disclosable(&operation)
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(CapturedQuantityRecorded {
            session: self.session,
            preparation: self.preparation,
            operation,
        })
    }
}
pub struct CapturedQuantityRecorded<
    'b,
    'n,
    'p,
    'o,
    T: read::Transport,
    K: read::Clock + Send + Sync,
> {
    session: &'b Session<'b, 'n, 'p, 'o, T, K>,
    preparation: &'b OriginalPreparation<'n, 'p, 'o, T, K>,
    operation: StoredOperation,
}
impl<'b, 'n, 'p, 'o, T: read::Transport, K: read::Clock + Send + Sync>
    CapturedQuantityRecorded<'b, 'n, 'p, 'o, T, K>
{
    pub fn operation(&self) -> &StoredOperation {
        &self.operation
    }
    pub async fn capture_readback(
        self,
        binding: &'b QuantityReadbackBinding<'_, 'p, T, K>,
    ) -> Result<CapturedQuantityObservation<'b, 'n, 'p, 'o, T, K>, StockPortFault> {
        if !std::ptr::eq(binding.original(), self.preparation.original())
            || !std::ptr::eq(binding.captured(), self.preparation.captured())
            || !binding
                .native()
                .source()
                .same_custody(self.preparation.native().source())
            || !binding
                .native()
                .source()
                .configured()
                .is_some_and(|c| std::sync::Arc::ptr_eq(c, self.preparation.configured()))
            || !self.operation.outcome.remote_activity.invoked()
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let observation = binding
            .capture_current(
                &self.operation,
                &self.preparation.native().plan().readback,
                self.preparation.native().authority(),
            )
            .await
            .ok_or(StockPortFault::Unavailable)?;
        let mut e = self
            .session
            .original_quantity_authorization()
            .evidence
            .lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        if e.observation.is_some() {
            return Err(StockPortFault::EvidenceConflict);
        }
        e.observation = Some(observation);
        let receipt = e.observation.as_ref().ok_or(StockPortFault::Unavailable)?;
        if receipt.operation() != &self.operation
            || receipt.plan() != &self.preparation.native().plan().readback
            || receipt.authority() != self.preparation.native().authority()
            || !receipt
                .source()
                .same_custody(self.preparation.native().source())
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let contracts = NativeWriterContracts::new().map_err(|_| StockPortFault::Unavailable)?;
        let facts = super::evidence::observation_facts(
            &contracts,
            &self.operation,
            e.observation
                .as_ref()
                .ok_or(StockPortFault::Unavailable)?
                .observation(),
        )
        .ok_or(StockPortFault::EvidenceConflict)?;
        e.arm(&self.operation, JournalFacts::Observation(facts.clone()))?;
        drop(e);
        Ok(CapturedQuantityObservation {
            session: self.session,
            operation: self.operation,
            facts,
        })
    }
}
pub struct CapturedQuantityObservation<
    'b,
    'n,
    'p,
    'o,
    T: read::Transport,
    K: read::Clock + Send + Sync,
> {
    session: &'b Session<'b, 'n, 'p, 'o, T, K>,
    operation: StoredOperation,
    facts: ObservationFacts,
}
impl<T: read::Transport, K: read::Clock + Send + Sync>
    CapturedQuantityObservation<'_, '_, '_, '_, T, K>
{
    pub async fn record(self) -> Result<StoredOperation, StockPortFault> {
        self.session
            .save_observation(&self.operation, &self.facts)
            .await
    }
}
