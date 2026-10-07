//! Native HomeBox activity journal on the original Atlas connection.
//! Original host handles are retained in memory; database rows are data only.
mod baseline;
mod codec;
mod journal;
mod recovery;
mod replay;
mod repository;
mod retention;
mod transitions;
pub(crate) use recovery::validate as validate_recovery_activity;
pub use recovery::*;
pub use retention::*;

use super::{AtlasStore, Authorization, Contract, Runtime};
use crate::{access, providers::homebox::write::stock as native};
use native::*;
use rusqlite::{Connection, TransactionBehavior};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

type PortResult<T> = std::result::Result<T, StockPortFault>;

/// Retain the actual AT11 principal and host source/grant/witness handles.
/// Implement this getter on the unchanged original host wrapper.
pub trait StockActivityPrincipal: Send + Sync {
    fn original_activity_principal(&self) -> &access::Principal;
    fn original_activity_source(&self) -> &access::SourceGrant;
    fn original_activity_partition(&self) -> &access::PartitionGrant;
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StockActivityRegistration {
    pub physical_binding: PhysicalBinding,
    pub owner_id: Uuid,
    pub dispatcher_epoch: u64,
    pub source_epoch: u64,
    pub qualification: NativeQualification,
}
#[derive(Clone, Copy, Debug)]
pub enum StockActivityPhase {
    Entry,
    Precommit,
    Release,
}
#[derive(Clone, Copy, Debug)]
pub enum StockActivityAction<'a> {
    Reserve(&'a StockCommand, &'a StockAuthority),
    Admit(
        &'a StoredOperation,
        &'a NativePlan,
        &'a Digest,
        &'a StockPreflight,
        &'a StockAuthority,
    ),
    Reject(&'a StoredOperation, StockErrorCode),
    NeverInvoked(&'a StoredOperation, &'a InvocationPermit),
    Dispatch(&'a StoredOperation, &'a InvocationPermit, &'a DispatchFacts),
    Observation(&'a StoredOperation, &'a ObservationFacts),
    Disclose(&'a StoredOperation),
    Handoff(&'a StoredOperation),
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockActivityApproval {
    pub receipt_id: Uuid,
    pub evidence_digest: Digest,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockActivityAdmissionEvidence {
    pub approval: Option<StockActivityApproval>,
    pub liability: StorageLiability,
}
/// Mandatory original-authority peer; no permissive implementation is supplied.
/// Callbacks are synchronous and must not perform native I/O or reenter storage.
/// Entry/Precommit revalidate genuine original grants, guards, source/dispatcher
/// epochs and route/impact/observation. Admission evidence binds trusted human
/// approval and byte reservation to the exact durable operation/plan.
/// Evidence callbacks qualify exact server-held receipt/never-start/readback
/// witnesses independently of current user disclosure grants: revocation must
/// not discard completed I/O evidence. Public permits/facts are never proofs.
/// Release validates current output disclosure. Failures after commit retain
/// durable facts even when their disclosure is refused.
pub trait StockActivityAuthorization<P: StockActivityPrincipal>: Send + Sync {
    fn authorize(
        &self,
        original: &P,
        registration: &StockActivityRegistration,
        guard: Option<&access::TransactionAuthorization<'_>>,
        phase: StockActivityPhase,
        action: StockActivityAction<'_>,
    ) -> PortResult<()>;
    fn admission(
        &self,
        original: &P,
        registration: &StockActivityRegistration,
        guard: &access::TransactionAuthorization<'_>,
        operation: &StoredOperation,
        plan: &NativePlan,
        preflight: &StockPreflight,
    ) -> PortResult<StockActivityAdmissionEvidence>;
}

/// In-memory original-owner handoff. No constructor or deserializer.
pub struct QueuedStockActivity {
    operation: StoredOperation,
    session: Arc<()>,
}
impl QueuedStockActivity {
    pub fn operation(&self) -> &StoredOperation {
        &self.operation
    }
}

/// Actual async StockActivityPort. SQLite and access guards never cross awaits.
pub struct StockActivitySession<C, A, R, P, G, S> {
    store: Arc<Mutex<AtlasStore<C, A, R>>>,
    access: Arc<Mutex<access::AccessBoundary>>,
    original: Arc<P>,
    authorization: Arc<G>,
    schemas: Arc<S>,
    registration: StockActivityRegistration,
    command: StockCommand,
    captured_authority: StockAuthority,
    session: Arc<()>,
    // Only actual new reservations committed by this original live session.
    // Reopening rows or receiving Existing metadata never populates this set.
    producer_operations: Mutex<std::collections::BTreeSet<Uuid>>,
}
impl<
    C: Contract + Send,
    A: Authorization + Send,
    R: Runtime + Send,
    P: StockActivityPrincipal,
    G: StockActivityAuthorization<P>,
    S: StockContractPort + Send + Sync,
> StockActivitySession<C, A, R, P, G, S>
{
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<Mutex<AtlasStore<C, A, R>>>,
        access: Arc<Mutex<access::AccessBoundary>>,
        original: Arc<P>,
        authorization: Arc<G>,
        schemas: Arc<S>,
        registration: StockActivityRegistration,
        command: StockCommand,
        captured_authority: StockAuthority,
    ) -> PortResult<Self> {
        if schemas
            .validate_request(&command.original_wire)
            .map_err(|_| StockPortFault::ContentConflict)?
            != command
        {
            return Err(StockPortFault::ContentConflict);
        }
        let value = Self {
            store,
            access,
            original,
            authorization,
            schemas,
            registration,
            command,
            captured_authority,
            session: Arc::new(()),
            producer_operations: Mutex::new(std::collections::BTreeSet::new()),
        };
        value.check_authority(&value.captured_authority)?;
        value.transact_live(|db, guard| {
            value.authorize_guard(
                Some(guard),
                StockActivityPhase::Entry,
                StockActivityAction::Reserve(&value.command, &value.captured_authority),
            )?;
            repository::register(db, &value.registration)?;
            value.authorize_guard(
                Some(guard),
                StockActivityPhase::Precommit,
                StockActivityAction::Reserve(&value.command, &value.captured_authority),
            )
        })?;
        Ok(value)
    }
    fn transact<T>(&self, f: impl FnOnce(&Connection) -> PortResult<T>) -> PortResult<T> {
        // A live call retains the access fence before entering here, while an
        // evidence policy may consult access with the store already borrowed.
        // Never wait for the store mutex: contention returns Unavailable and
        // releases the live fence, so those two paths cannot form a lock cycle.
        // The caller receives no permit, implicit retry or physical release.
        let mut store = self
            .store
            .try_lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        if !store.options.stock_activity_profile {
            return Err(StockPortFault::Unavailable);
        }
        let tx = store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let result = f(&tx)?;
        tx.commit().map_err(unavailable)?;
        Ok(result)
    }
    fn transact_live<T>(
        &self,
        f: impl FnOnce(&Connection, &access::TransactionAuthorization<'_>) -> PortResult<T>,
    ) -> PortResult<T> {
        let mut boundary = self
            .access
            .lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        let mut output = None;
        boundary
            .with_mutation_authorization(
                self.original.original_activity_principal(),
                |guard| -> std::result::Result<(), AuthorityFailure> {
                    guard.revalidate_source(self.original.original_activity_source())?;
                    guard
                        .revalidate_source_partition(self.original.original_activity_partition())?;
                    output = Some(
                        self.transact(|db| {
                            let result = f(db, guard)?;
                            guard
                                .revalidate_source(self.original.original_activity_source())
                                .map_err(evidence)?;
                            guard
                                .revalidate_source_partition(
                                    self.original.original_activity_partition(),
                                )
                                .map_err(evidence)?;
                            Ok(result)
                        })
                        .map_err(AuthorityFailure),
                    );
                    match output.as_ref() {
                        Some(Ok(_)) => Ok(()),
                        Some(Err(error)) => Err(AuthorityFailure(error.0)),
                        None => Err(AuthorityFailure(StockPortFault::Unavailable)),
                    }
                },
            )
            .map_err(|e| e.0)?;
        output.ok_or(StockPortFault::Unavailable)?.map_err(|e| e.0)
    }
    fn authorize(
        &self,
        phase: StockActivityPhase,
        action: StockActivityAction<'_>,
    ) -> PortResult<()> {
        self.authorize_guard(None, phase, action)
    }
    fn authorize_guard(
        &self,
        guard: Option<&access::TransactionAuthorization<'_>>,
        phase: StockActivityPhase,
        action: StockActivityAction<'_>,
    ) -> PortResult<()> {
        self.authorization
            .authorize(&self.original, &self.registration, guard, phase, action)
    }
    fn check_command(&self, command: &StockCommand) -> PortResult<()> {
        // Root request/approval/observation renewals may share one immutable intent.
        let parsed = self
            .schemas
            .validate_request(&command.original_wire)
            .map_err(|_| StockPortFault::ContentConflict)?;
        if parsed != *command
            || command.request_digest != self.command.request_digest
            || command.idempotency_key != self.command.idempotency_key
            || command.context != self.command.context
            || command.target != self.command.target
            || command.command_id != self.command.command_id
        {
            return Err(StockPortFault::ContentConflict);
        }
        Ok(())
    }
    fn check_authority(&self, authority: &StockAuthority) -> PortResult<()> {
        if authority != &self.captured_authority
            || authority.actor_id.to_string()
                != self
                    .original
                    .original_activity_principal()
                    .actor_id()
                    .as_str()
            || authority.physical_binding != self.registration.physical_binding
            || authority.source_epoch != self.registration.source_epoch
            || authority.qualification != self.registration.qualification
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(())
    }
    fn checked(&self, operation: &StoredOperation) -> PortResult<()> {
        self.check_command(&operation.command)?;
        self.schemas
            .validate_observed_at(&operation.outcome.observed_at)?;
        self.check_authority(&operation.captured_authority)?;
        if operation.actor_id != operation.captured_authority.actor_id
            || operation.operation_id != operation.outcome.operation_id
            || operation.command.request_id != operation.outcome.request_id
            || operation.command.request_digest != operation.outcome.request_digest
            || operation.command.command_id != operation.outcome.command_id
            || operation.command.context != operation.outcome.resolved_scope
            || !operation.outcome.well_formed()
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        self.schemas.validate_outcome(&operation.outcome)
    }
    /// Explicit original-owner handoff; no pending scan or automatic retry.
    pub fn queued_handoff(&self, operation_id: Uuid) -> PortResult<QueuedStockActivity> {
        let operation = self.transact_live(|db, guard| {
            let row = repository::load(db, operation_id)?;
            self.checked(&row.operation)?;
            if row.permit.is_some()
                || row.body_accepted
                || !matches!(
                    row.operation.outcome.state,
                    OutcomeState::Prepared | OutcomeState::Queued
                )
                || row.operation.outcome.remote_activity.invoked()
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            self.authorize_guard(
                Some(guard),
                StockActivityPhase::Entry,
                StockActivityAction::Handoff(&row.operation),
            )?;
            self.authorize_guard(
                Some(guard),
                StockActivityPhase::Precommit,
                StockActivityAction::Handoff(&row.operation),
            )?;
            Ok(row.operation)
        })?;
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Handoff(&operation),
        )?;
        Ok(QueuedStockActivity {
            operation,
            session: self.session.clone(),
        })
    }
    pub fn retain_handoff(&self, handoff: &QueuedStockActivity) -> PortResult<StoredOperation> {
        if !Arc::ptr_eq(&self.session, &handoff.session) {
            return Err(StockPortFault::EvidenceConflict);
        }
        let current = self.queued_handoff(handoff.operation.operation_id)?;
        if current.operation != handoff.operation {
            return Err(StockPortFault::VersionConflict);
        }
        Ok(current.operation)
    }
}
fn unavailable<T>(_: T) -> StockPortFault {
    StockPortFault::Unavailable
}
fn evidence<T>(_: T) -> StockPortFault {
    StockPortFault::EvidenceConflict
}

pub(crate) use repository::jobs_hold;

struct AuthorityFailure(StockPortFault);
impl From<access::AccessError> for AuthorityFailure {
    fn from(_: access::AccessError) -> Self {
        Self(StockPortFault::EvidenceConflict)
    }
}
