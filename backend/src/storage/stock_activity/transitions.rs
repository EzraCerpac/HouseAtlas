use super::*;
use rusqlite::{OptionalExtension, params};
use serde_json::json;

impl<
    C: Contract + Send,
    A: Authorization + Send,
    R: Runtime + Send,
    P: StockActivityPrincipal,
    G: StockActivityAuthorization<P>,
    S: StockContractPort + Send + Sync,
> StockActivityPort for StockActivitySession<C, A, R, P, G, S>
{
    async fn reserve(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> PortResult<StockReservation> {
        self.check_command(command)?;
        self.check_authority(authority)?;
        self.authorize(
            StockActivityPhase::Entry,
            StockActivityAction::Reserve(command, authority),
        )?;
        let (reservation, _) = self.transact_live_with_runtime_committed(|db, guard, runtime| {
            repository::register(db,&self.registration)?;
            let prior: Option<String> = db.query_row("SELECT operation_id FROM stock_activity_operations WHERE actor_id=?1 AND workspace_id=?2 AND home_id=?3 AND idempotency_key=?4",params![authority.actor_id.to_string(),command.context.workspace_id.to_string(),command.context.home_id.to_string(),command.idempotency_key.to_string()],|r|r.get(0)).optional().map_err(unavailable)?;
            if let Some(prior) = prior {
                let row = repository::load(db,Uuid::parse_str(&prior).map_err(evidence)?)?;
                self.checked(&row.operation)?;
                if row.operation.command.request_digest != command.request_digest { return Err(StockPortFault::ContentConflict); }
                self.authorize_guard(Some(guard),StockActivityPhase::Precommit,StockActivityAction::Disclose(&row.operation))?;
                // Existing metadata is handed off only through the explicit
                // original-owner queued_handoff; reserve never redispatches.
                return Ok((StockReservation::Existing(Box::new(row.operation)), None));
            }
            // Contention must fail before creating a durable reservation.
            // Hold the original producer set lock through commit so no later
            // lock acquisition can lose this session's producer eligibility.
            let producer = self.producer_operations.try_lock().map_err(|_|StockPortFault::Unavailable)?;
            // Existing durable results do not depend on fresh metadata. Borrow
            // the original runtime under this same Store transaction, avoiding
            // a second lock or an out-of-transaction lookup/allocation gap.
            let id=Uuid::parse_str(&runtime.new_id().map_err(unavailable)?).map_err(evidence)?;
            let now=runtime.now().map_err(unavailable)?;
            self.schemas.validate_observed_at(&now)?;
            let waiting=repository::occupied(db,&self.registration)?;
            let operation=super::baseline::fresh(command,authority,id,&now,waiting);
            self.checked(&operation)?;
            self.authorize_guard(Some(guard),StockActivityPhase::Precommit,StockActivityAction::Reserve(command,authority))?;
            db.execute("INSERT INTO stock_activity_operations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,0,0,0)",params![id.to_string(),authority.physical_binding.physical_database_id.to_string(),authority.actor_id.to_string(),command.context.workspace_id.to_string(),command.context.home_id.to_string(),command.idempotency_key.to_string(),command.request_digest.as_str(),"1",codec::encode_operation(&operation).map_err(evidence)?]).map_err(unavailable)?;
            repository::append(db,&operation,"reserve","{}")?;
            Ok((if waiting {StockReservation::Queued(Box::new(operation))}else{StockReservation::Reserved(Box::new(operation))}, Some(producer)))
        }, |(reservation, producer)| {
            if let Some(mut producer) = producer.take() {
                match reservation {
                    StockReservation::Reserved(operation) | StockReservation::Queued(operation) => {
                        producer.insert(operation.operation_id);
                    }
                    StockReservation::Existing(_) => {}
                }
            }
        })?;
        let operation = match &reservation {
            StockReservation::Reserved(v)
            | StockReservation::Existing(v)
            | StockReservation::Queued(v) => v,
        };
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(operation),
        )?;
        Ok(reservation)
    }
    async fn admit(
        &self,
        reserved: &StoredOperation,
        plan: &NativePlan,
        plan_digest: &Digest,
        preflight: &StockPreflight,
        authority: &StockAuthority,
    ) -> PortResult<Admission> {
        let result = self.admit_with_qualification(
            reserved,
            plan,
            plan_digest,
            preflight,
            authority,
            false,
            |_, _, _| Ok(()),
            |_| {},
        )?;
        let operation = match &result {
            Admission::Admitted { operation, .. } | Admission::Held(operation) => operation,
        };
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(operation),
        )?;
        Ok(result)
    }
    async fn reject(
        &self,
        reserved: &StoredOperation,
        reason: StockErrorCode,
    ) -> PortResult<StoredOperation> {
        let operation = self.transact(|db| {
            let mut row = repository::load(db, reserved.operation_id)?;
            self.checked(&row.operation)?;
            if row.operation != *reserved {
                return Err(StockPortFault::VersionConflict);
            }
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
            let action = StockActivityAction::Reject(&row.operation, reason);
            self.authorize(StockActivityPhase::Entry, action)?;
            self.authorize(StockActivityPhase::Precommit, action)?;
            row.operation.outcome.state = OutcomeState::RejectedBeforeDispatch;
            row.operation.outcome.verification = Verification::NoDispatch;
            self.checked(&row.operation)?;
            repository::update(
                db,
                &mut row.operation,
                None,
                false,
                "reject",
                &crate::contracts::semantics::canonical_json(&json!({"reason":reason}))
                    .map_err(evidence_error)?,
            )?;
            Ok(row.operation)
        })?;
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(&operation),
        )?;
        Ok(operation)
    }
    async fn record_never_invoked(&self, permit: &InvocationPermit) -> PortResult<StoredOperation> {
        let operation = self.transact(|db| {
            let mut row = repository::load(db, permit.operation_id)?;
            self.checked(&row.operation)?;
            repository::verify_permit(&row, permit, &self.registration)?;
            if row.operation.outcome.state != OutcomeState::Dispatching
                || row.operation.outcome.response_digest.is_some()
                || row.operation.outcome.readback_digest.is_some()
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            let action = StockActivityAction::NeverInvoked(&row.operation, permit);
            self.authorize(StockActivityPhase::Entry, action)?;
            self.authorize(StockActivityPhase::Precommit, action)?;
            row.operation.outcome.state = OutcomeState::RejectedBeforeDispatch;
            row.operation.outcome.verification = Verification::NoDispatch;
            row.operation.outcome.remote_activity = RemoteActivity::not_dispatched();
            row.operation.outcome.unknown_scope_fence_retained = false;
            // Byte reservation remains; no inferred cleanup/binding from no I/O.
            self.checked(&row.operation)?;
            repository::update(
                db,
                &mut row.operation,
                Some(permit),
                true,
                "never-invoked",
                "{}",
            )?;
            repository::release(db, &self.registration, permit.operation_id)?;
            Ok(row.operation)
        })?;
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(&operation),
        )?;
        Ok(operation)
    }
    async fn record_dispatch(
        &self,
        permit: &InvocationPermit,
        facts: &DispatchFacts,
    ) -> PortResult<StoredOperation> {
        let operation = self.transact(|db| {
            let mut row = repository::load(db, permit.operation_id)?;
            self.checked(&row.operation)?;
            repository::verify_permit(&row, permit, &self.registration)?;
            let action = StockActivityAction::Dispatch(&row.operation, permit, facts);
            self.authorize(StockActivityPhase::Entry, action)?;
            self.authorize(StockActivityPhase::Precommit, action)?;
            row.operation.outcome = row
                .operation
                .outcome
                .with_dispatch(facts)
                .ok_or(StockPortFault::EvidenceConflict)?;
            if row.operation.actual_target.is_some()
                && row.operation.actual_target != facts.generated_target
                || !row.operation.generated_members.is_empty()
                    && row.operation.generated_members != facts.generated_members
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            if facts
                .generated_target
                .as_ref()
                .is_some_and(|t| !t.same_partition(&row.operation.command.target))
            {
                return Err(StockPortFault::EvidenceConflict);
            }
            row.operation.actual_target = facts.generated_target.clone();
            row.operation.generated_members = facts.generated_members.clone();
            self.checked(&row.operation)?;
            repository::update(
                db,
                &mut row.operation,
                Some(permit),
                true,
                "dispatch",
                &codec::encode_dispatch(facts).map_err(evidence_error)?,
            )?;
            if matches!(facts.remote_activity, RemoteActivity::EndedProven { .. }) {
                // Original evidence peer must qualify actual correlated endproof.
                repository::release(db, &self.registration, permit.operation_id)?;
            }
            Ok(row.operation)
        })?;
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(&operation),
        )?;
        Ok(operation)
    }
    async fn save_observation(
        &self,
        input: &StoredOperation,
        facts: &ObservationFacts,
    ) -> PortResult<StoredOperation> {
        self.schemas.validate_observed_at(&facts.observed_at)?;
        let operation = self.transact(|db| {
            let mut row = repository::load(db, input.operation_id)?;
            self.checked(&row.operation)?;
            if row.operation != *input {
                return Err(StockPortFault::VersionConflict);
            }
            let permit = row.permit.clone().ok_or(StockPortFault::EvidenceConflict)?;
            repository::verify_permit(&row, &permit, &self.registration)?;
            let action = StockActivityAction::Observation(&row.operation, facts);
            self.authorize(StockActivityPhase::Entry, action)?;
            self.authorize(StockActivityPhase::Precommit, action)?;
            row.operation.outcome = row
                .operation
                .outcome
                .with_observation(facts)
                .ok_or(StockPortFault::EvidenceConflict)?;
            self.checked(&row.operation)?;
            repository::update(
                db,
                &mut row.operation,
                Some(&permit),
                true,
                "observation",
                &codec::encode_observation(facts).map_err(evidence_error)?,
            )?;
            // Observation never releases the physical slot or byte reservation.
            Ok(row.operation)
        })?;
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(&operation),
        )?;
        Ok(operation)
    }
    async fn load(
        &self,
        command: &StockCommand,
        actor_id: Uuid,
        operation_id: Uuid,
    ) -> PortResult<StoredOperation> {
        self.check_command(command)?;
        let operation = self.transact(|db| {
            let row = repository::load(db, operation_id)?;
            self.checked(&row.operation)?;
            if row.operation.actor_id != actor_id {
                return Err(StockPortFault::EvidenceConflict);
            }
            self.authorize(
                StockActivityPhase::Entry,
                StockActivityAction::Disclose(&row.operation),
            )?;
            self.authorize(
                StockActivityPhase::Precommit,
                StockActivityAction::Disclose(&row.operation),
            )?;
            Ok(row.operation)
        })?;
        self.authorize(
            StockActivityPhase::Release,
            StockActivityAction::Disclose(&operation),
        )?;
        Ok(operation)
    }
}
fn evidence_error<T>(_: T) -> StockPortFault {
    StockPortFault::EvidenceConflict
}
