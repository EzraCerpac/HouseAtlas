//! Native producer cuts; persisted facts remain data, never revived grants.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StockActivityAdmissionCut {
    pub permit: InvocationPermit,
    pub preflight: StockPreflight,
    pub evidence: StockActivityAdmissionEvidence,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StockActivityEventFacts {
    Reserve,
    Queued,
    Admit(Box<StockActivityAdmissionCut>),
    Reject(StockErrorCode),
    NeverInvoked,
    Dispatch(DispatchFacts),
    Observation(ObservationFacts),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetainedStockActivityEvent {
    pub(super) sequence: u64,
    pub(super) operation: StoredOperation,
    pub(super) facts: StockActivityEventFacts,
}
impl RetainedStockActivityEvent {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn operation(&self) -> &StoredOperation {
        &self.operation
    }
    pub fn facts(&self) -> &StockActivityEventFacts {
        &self.facts
    }
}

/// Storage-sealed immutable cut of the actual native journal. No deserializer,
/// image constructor, invocation permit issuer or queued-handoff authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetainedStockActivity {
    pub(super) registration: StockActivityRegistration,
    pub(super) operation: StoredOperation,
    pub(super) permit: Option<InvocationPermit>,
    pub(super) body_accepted: bool,
    pub(super) physical_hold: bool,
    pub(super) events: Vec<RetainedStockActivityEvent>,
}
impl RetainedStockActivity {
    pub fn registration(&self) -> &StockActivityRegistration {
        &self.registration
    }
    pub fn operation(&self) -> &StoredOperation {
        &self.operation
    }
    pub fn original(&self) -> &StoredOperation {
        &self.events[0].operation
    }
    pub fn permit(&self) -> Option<&InvocationPermit> {
        self.permit.as_ref()
    }
    pub fn body_accepted(&self) -> bool {
        self.body_accepted
    }
    pub fn physical_hold(&self) -> bool {
        self.physical_hold
    }
    pub fn events(&self) -> &[RetainedStockActivityEvent] {
        &self.events
    }
}

/// Independently retain outside Core before native I/O and after each fact cut.
/// Original handles remain genuine in memory. This is producer evidence DATA,
/// not offline discovery, disclosure or recovered invocation authority.
pub struct StockActivityProducer<P: StockActivityPrincipal> {
    original: Arc<P>,
    session: Arc<()>,
    record: RetainedStockActivity,
}
/// Qualify the complete historical/preflight cut and its server archive or
/// disclosure destination. Latest-outcome disclosure alone cannot authorize
/// hidden snapshot fields or earlier effects. Required, with no success default;
/// callbacks must not reenter storage or perform provider I/O.
pub trait StockActivityRetentionAuthorization<P: StockActivityPrincipal>:
    StockActivityAuthorization<P>
{
    fn authorize_retention(
        &self,
        original: &P,
        registration: &StockActivityRegistration,
        guard: Option<&access::TransactionAuthorization<'_>>,
        phase: StockActivityPhase,
        record: &RetainedStockActivity,
    ) -> PortResult<()>;
}
impl<P: StockActivityPrincipal> StockActivityProducer<P> {
    pub fn original(&self) -> &P {
        &self.original
    }
    pub fn record(&self) -> &RetainedStockActivity {
        &self.record
    }
}

impl<
    C: Contract + Send,
    A: Authorization + Send,
    R: Runtime + Send,
    P: StockActivityPrincipal,
    G: StockActivityRetentionAuthorization<P>,
    S: StockContractPort + Send + Sync,
> StockActivitySession<C, A, R, P, G, S>
{
    /// Capture under the original live AT11 fence; never construct from restored
    /// rows or replace a session-bound QueuedStockActivity. Does not dispatch.
    pub fn retain_producer(&self, operation_id: Uuid) -> PortResult<StockActivityProducer<P>> {
        if !self
            .producer_operations
            .try_lock()
            .map_err(|_| StockPortFault::Unavailable)?
            .contains(&operation_id)
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let record = self.transact_live(|db, guard| {
            let record = repository::retained(db, operation_id, &self.registration)?;
            self.checked(record.operation())?;
            validate_record(&record, &*self.schemas)?;
            self.authorization.authorize_retention(
                &self.original,
                &self.registration,
                Some(guard),
                StockActivityPhase::Entry,
                &record,
            )?;
            self.authorization.authorize_retention(
                &self.original,
                &self.registration,
                Some(guard),
                StockActivityPhase::Precommit,
                &record,
            )?;
            Ok(record)
        })?;
        self.authorization.authorize_retention(
            &self.original,
            &self.registration,
            None,
            StockActivityPhase::Release,
            &record,
        )?;
        Ok(StockActivityProducer {
            original: self.original.clone(),
            session: self.session.clone(),
            record,
        })
    }
    /// Capture a successor cut only through the unchanged original session.
    /// The prior cut remains immutable and can be archived independently.
    pub fn retain_producer_successor(
        &self,
        prior: &StockActivityProducer<P>,
    ) -> PortResult<StockActivityProducer<P>> {
        if !Arc::ptr_eq(&self.session, &prior.session)
            || !Arc::ptr_eq(&self.original, &prior.original)
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let next = self.retain_producer(prior.record.operation.operation_id)?;
        if next.record.events.len() < prior.record.events.len()
            || next.record.events[..prior.record.events.len()] != prior.record.events
        {
            return Err(StockPortFault::VersionConflict);
        }
        Ok(next)
    }
}

pub(super) fn validate_record<S: StockContractPort>(
    record: &RetainedStockActivity,
    schemas: &S,
) -> PortResult<()> {
    if record.events.is_empty() {
        return Err(StockPortFault::EvidenceConflict);
    }
    for event in &record.events {
        let operation = &event.operation;
        let command = &operation.command;
        if schemas
            .validate_request(&command.original_wire)
            .map_err(|_| StockPortFault::ContentConflict)?
            != *command
            || operation.actor_id != operation.captured_authority.actor_id
            || operation.operation_id != operation.outcome.operation_id
            || command.request_id != operation.outcome.request_id
            || command.request_digest != operation.outcome.request_digest
            || command.command_id != operation.outcome.command_id
            || command.context != operation.outcome.resolved_scope
            || operation.captured_authority.physical_binding != record.registration.physical_binding
            || operation.captured_authority.source_epoch != record.registration.source_epoch
            || operation.captured_authority.qualification != record.registration.qualification
            || !operation.outcome.well_formed()
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        schemas.validate_observed_at(&operation.outcome.observed_at)?;
        schemas.validate_outcome(&operation.outcome)?;
        if let StockActivityEventFacts::Admit(admission) = &event.facts
            && (admission.permit.operation_id != operation.operation_id
                || admission.permit.actor_id != operation.actor_id
                || admission.permit.physical_binding != record.registration.physical_binding
                || admission.permit.owner_id != record.registration.owner_id
                || admission.permit.dispatcher_epoch != record.registration.dispatcher_epoch
                || admission.permit.source_epoch != record.registration.source_epoch
                || admission.permit.qualification != record.registration.qualification
                || Some(&admission.permit) != record.permit.as_ref()
                || schemas.digest_native(
                    &serde_json::to_value(
                        operation
                            .plan
                            .as_ref()
                            .ok_or(StockPortFault::EvidenceConflict)?,
                    )
                    .map_err(evidence)?,
                )? != admission.permit.plan_digest)
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        if let StockActivityEventFacts::Observation(facts) = &event.facts {
            schemas.validate_observed_at(&facts.observed_at)?;
        }
    }
    Ok(())
}
