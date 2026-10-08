//! Closed phase bridge for the original quantity admission engine.
//! Only the concrete original bundle below implements this private bridge.
//! No provider/filesystem work or lock reentry occurs in its transaction fences.
use super::*;
use crate::{
    access,
    app::homebox_queued_quantity::{OriginalQueuedQuantityPreparation, QueuedQuantityPhase},
    providers::homebox::read,
};
use original_owner::{QueueOriginalClaimCapture, QueueOriginalEnqueueCapture};

pub(super) trait OwnedQuantityContext {
    fn revalidate(&self, db: &Connection) -> Result<()>;
    fn validate_fresh(
        &self,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()>;
    fn validate_initial(&self, row: &StoredJob, config: &QueueConfig, now: Timestamp)
    -> Result<()>;
    fn enqueue_committed(&self, snapshot: &JobSnapshot) -> Result<()>;
    fn claim_committed(&self, job: &LeasedJob) -> Result<()>;
}

enum PhaseFailure {
    Access(access::AccessError),
    Storage(Error),
}
impl From<access::AccessError> for PhaseFailure {
    fn from(error: access::AccessError) -> Self {
        Self::Access(error)
    }
}
impl From<Error> for PhaseFailure {
    fn from(error: Error) -> Self {
        Self::Storage(error)
    }
}
impl From<rusqlite::Error> for PhaseFailure {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.into())
    }
}
impl PhaseFailure {
    fn storage(self) -> Error {
        match self {
            Self::Storage(error) => error,
            Self::Access(error) => {
                Error::new(error.code(), "Original queue Access fence unavailable")
            }
        }
    }
}

enum Capture<'phase, 'capture> {
    Enqueue(&'phase QueueOriginalEnqueueCapture<'capture>),
    Claim(&'phase QueueOriginalClaimCapture<'capture>),
}

struct QuantityContext<'phase, 'capture, 'tx, 'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    preparation: &'phase OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
    guard: &'phase access::TransactionAuthorization<'tx>,
    identity: crate::storage::QuantityInstallationStoreIdentity,
    capture: Capture<'phase, 'capture>,
}

fn unavailable() -> Error {
    Error::new(
        "owner-unavailable",
        "Current original queue phase unavailable",
    )
}

impl<T: read::Transport, K: read::Clock + Send + Sync>
    QuantityContext<'_, '_, '_, '_, '_, '_, '_, T, K>
{
    fn active(&self, db: &Connection) -> Result<()> {
        let quantity = self.preparation.quantity_preparation();
        let configured = quantity.configured();
        let transaction = crate::storage::observe_quantity_installation_in_transaction(
            db,
            &self.identity,
            quantity.original(),
            self.guard,
            configured.queue(),
            configured.physical(),
        )?;
        self.preparation
            .revalidate_queue_transaction(self.guard, &transaction)
    }
}

impl<T: read::Transport, K: read::Clock + Send + Sync> OwnedQuantityContext
    for QuantityContext<'_, '_, '_, '_, '_, '_, '_, T, K>
{
    fn revalidate(&self, db: &Connection) -> Result<()> {
        if db.is_autocommit() {
            // Release observes a fresh native read-only transaction after the
            // actual write commit. It never reuses the precommit observation.
            let transaction = db.unchecked_transaction()?;
            self.active(&transaction)?;
            transaction.commit()?;
            Ok(())
        } else {
            self.active(db)
        }
    }
    fn validate_fresh(
        &self,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()> {
        match self.capture {
            Capture::Enqueue(capture) => capture.validate_fresh(request, scope, config),
            Capture::Claim(_) => Err(conflict()),
        }
    }
    fn validate_initial(
        &self,
        row: &StoredJob,
        config: &QueueConfig,
        now: Timestamp,
    ) -> Result<()> {
        if now < row.created
            || config
                .admission_profile
                .never_dispatched_wait_expired(row.created, now, 0)
        {
            return Err(conflict());
        }
        match self.capture {
            Capture::Claim(capture) => capture.validate_initial(row, config),
            Capture::Enqueue(_) => Err(conflict()),
        }
    }
    fn enqueue_committed(&self, snapshot: &JobSnapshot) -> Result<()> {
        match self.capture {
            Capture::Enqueue(capture) => capture.record_committed(snapshot),
            Capture::Claim(_) => Err(conflict()),
        }
    }

    fn claim_committed(&self, job: &LeasedJob) -> Result<()> {
        match self.capture {
            Capture::Claim(capture) => capture.record_committed(job),
            Capture::Enqueue(_) => Err(conflict()),
        }
    }
}

impl crate::app::Store {
    pub(super) fn enqueue_original_quantity_inner<'bundle, 'native, 'p, 'owner, T, K>(
        &mut self,
        preparation: &OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
        now: Timestamp,
        capture: &QueueOriginalEnqueueCapture<'_>,
    ) -> Result<EnqueueOutcome>
    where
        T: read::Transport,
        K: read::Clock + Send + Sync,
    {
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(
            &boundary,
            preparation.quantity_preparation().configured().access(),
        ) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        boundary
            .with_mutation_authorization(preparation.principal().principal.principal(), |guard| {
                let context = QuantityContext {
                    preparation,
                    guard,
                    identity,
                    capture: Capture::Enqueue(capture),
                };
                context.revalidate(&self.db)?;
                let authority = QueuedQuantityPhase::new(preparation, guard, None)?;
                let config = preparation.config().clone();
                let mut session = self.queue_session(
                    config.clone(),
                    QueueSessionBinding {
                        receipt: &preparation.request().receipt,
                        original: preparation.original(),
                        principal: preparation.principal(),
                        witness: preparation,
                    },
                    &authority,
                    QueueEvidenceInbox::default(),
                )?;
                output = Some(session.enqueue_inner_with_owned(
                    preparation.request(),
                    preparation.scope(),
                    &config,
                    now,
                    Some(&context),
                )?);
                Ok::<(), PhaseFailure>(())
            })
            .map_err(PhaseFailure::storage)?;
        let outcome = output.ok_or_else(unavailable)?;
        if let EnqueueOutcome::Enqueued(snapshot) = &outcome {
            capture.record_released(snapshot)?;
        }
        Ok(outcome)
    }

    pub(super) fn claim_original_quantity_initial_inner<'bundle, 'native, 'p, 'owner, T, K>(
        &mut self,
        preparation: &OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
        expected: &JobSnapshot,
        now: Timestamp,
        capture: &QueueOriginalClaimCapture<'_>,
    ) -> Result<ClaimOutcome>
    where
        T: read::Transport,
        K: read::Clock + Send + Sync,
    {
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(
            &boundary,
            preparation.quantity_preparation().configured().access(),
        ) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        boundary
            .with_mutation_authorization(preparation.principal().principal.principal(), |guard| {
                let context = QuantityContext {
                    preparation,
                    guard,
                    identity,
                    capture: Capture::Claim(capture),
                };
                context.revalidate(&self.db)?;
                // Check exact first-claim preimage before even registration
                // may mutate; the shared engine checks it again in its tx.
                let transaction = self
                    .db
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                context.revalidate(&transaction)?;
                let row = load(&transaction, &expected.job_id.0)?;
                context.validate_initial(&row, preparation.config(), now)?;
                transaction.commit()?;
                let authority = QueuedQuantityPhase::new(preparation, guard, Some(expected))?;
                let config = preparation.config().clone();
                let mut session = self.queue_session(
                    config.clone(),
                    QueueSessionBinding {
                        receipt: &preparation.request().receipt,
                        original: preparation.original(),
                        principal: preparation.principal(),
                        witness: preparation,
                    },
                    &authority,
                    QueueEvidenceInbox::default(),
                )?;
                output = Some(session.claim_next_inner_with_owned(
                    now,
                    &config,
                    Some((&context, expected)),
                )?);
                Ok::<(), PhaseFailure>(())
            })
            .map_err(PhaseFailure::storage)?;
        let outcome = output.ok_or_else(unavailable)?;
        if let ClaimOutcome::Claimed(job) = &outcome {
            capture.record_released(job)?;
        }
        Ok(outcome)
    }
}
