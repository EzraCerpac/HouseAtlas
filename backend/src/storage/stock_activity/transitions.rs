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
        let (id, now) = {
            let store = self.store.lock().map_err(|_| StockPortFault::Unavailable)?;
            (
                Uuid::parse_str(&store.runtime.new_id().map_err(unavailable)?).map_err(evidence)?,
                store.runtime.now().map_err(unavailable)?,
            )
        };
        self.schemas.validate_observed_at(&now)?;
        let reservation = self.transact_live(|db, guard| {
            repository::register(db,&self.registration)?;
            let prior: Option<String> = db.query_row("SELECT operation_id FROM stock_activity_operations WHERE actor_id=?1 AND workspace_id=?2 AND home_id=?3 AND idempotency_key=?4",params![authority.actor_id.to_string(),command.context.workspace_id.to_string(),command.context.home_id.to_string(),command.idempotency_key.to_string()],|r|r.get(0)).optional().map_err(unavailable)?;
            if let Some(prior) = prior {
                let row = repository::load(db,Uuid::parse_str(&prior).map_err(evidence)?)?;
                self.checked(&row.operation)?;
                if row.operation.command.request_digest != command.request_digest { return Err(StockPortFault::ContentConflict); }
                self.authorize_guard(Some(guard),StockActivityPhase::Precommit,StockActivityAction::Disclose(&row.operation))?;
                // Existing metadata is handed off only through the explicit
                // original-owner queued_handoff; reserve never redispatches.
                return Ok(StockReservation::Existing(Box::new(row.operation)));
            }
            let waiting=repository::occupied(db,&self.registration)?;
            let operation=super::baseline::fresh(command,authority,id,&now,waiting);
            self.checked(&operation)?;
            self.authorize_guard(Some(guard),StockActivityPhase::Precommit,StockActivityAction::Reserve(command,authority))?;
            db.execute("INSERT INTO stock_activity_operations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,0,0,0)",params![id.to_string(),authority.physical_binding.physical_database_id.to_string(),authority.actor_id.to_string(),command.context.workspace_id.to_string(),command.context.home_id.to_string(),command.idempotency_key.to_string(),command.request_digest.as_str(),"1",codec::encode_operation(&operation).map_err(evidence)?]).map_err(unavailable)?;
            repository::append(db,&operation,"reserve","{}")?;
            Ok(if waiting {StockReservation::Queued(Box::new(operation))}else{StockReservation::Reserved(Box::new(operation))})
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
        self.check_authority(authority)?;
        self.checked(reserved)?;
        if preflight.request_digest != reserved.command.request_digest
            || preflight.provider_observation != reserved.command.provider_observation
            || preflight.source_epoch != authority.source_epoch
            || self
                .schemas
                .digest_native(&serde_json::to_value(plan).map_err(evidence)?)?
                != *plan_digest
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        if native::map_stock(&reserved.command, &preflight.preparation).map_err(evidence)? != *plan
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let result=self.transact_live(|db, guard| {
            let mut row=repository::load(db,reserved.operation_id)?;
            if row.operation!=*reserved {return Err(StockPortFault::VersionConflict);}
            if row.permit.is_some() || row.body_accepted || !matches!(row.operation.outcome.state,OutcomeState::Prepared|OutcomeState::Queued) {return Err(StockPortFault::EvidenceConflict);}
            let action=StockActivityAction::Admit(&row.operation,plan,plan_digest,preflight,authority);
            self.authorize_guard(Some(guard),StockActivityPhase::Entry,action)?;
            let earlier:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM stock_activity_events e JOIN stock_activity_operations o ON o.operation_id=e.operation_id WHERE e.kind='reserve' AND o.physical_database_id=?1 AND o.body_accepted=0 AND json_extract(o.operation_json,'$.payload.outcome.state') IN ('prepared','queued') AND e.sequence<(SELECT sequence FROM stock_activity_events WHERE operation_id=?2 AND kind='reserve'))",params![self.registration.physical_binding.physical_database_id.to_string(),reserved.operation_id.to_string()],|r|r.get(0)).map_err(unavailable)?;
            if earlier || repository::occupied(db,&self.registration)? {
                self.authorize_guard(Some(guard),StockActivityPhase::Precommit,action)?;
                if row.operation.outcome.state==OutcomeState::Prepared {
                    row.operation.outcome.state=OutcomeState::Queued;
                    repository::update(db,&mut row.operation,None,false,"queued","{}")?;
                }
                return Ok(Admission::Held(Box::new(row.operation)));
            }
            let evidence=self.authorization.admission(&self.original,&self.registration,guard,&row.operation,plan,preflight)?;
            if !evidence.liability.well_formed() || evidence.approval.as_ref().map(|a|a.receipt_id)!=row.operation.command.approval_receipt_id {return Err(StockPortFault::EvidenceConflict);}
            if let NativeBody::Multipart{stage,..}=&plan.request.body
                && evidence.liability.reserved_bytes.is_none_or(|b|b<stage.byte_size) {return Err(StockPortFault::EvidenceConflict);}
            if let Some(approval)=&evidence.approval {
                db.execute("INSERT INTO stock_activity_approvals VALUES(?1,?2,?3)",params![approval.receipt_id.to_string(),row.operation.operation_id.to_string(),approval.evidence_digest.as_str()]).map_err(evidence_error)?;
            }
            let permit=InvocationPermit {operation_id:row.operation.operation_id,actor_id:row.operation.actor_id,physical_binding:self.registration.physical_binding.clone(),owner_id:self.registration.owner_id,dispatcher_epoch:self.registration.dispatcher_epoch,source_epoch:self.registration.source_epoch,plan_digest:plan_digest.clone(),qualification:self.registration.qualification.clone()};
            self.authorize_guard(Some(guard),StockActivityPhase::Precommit,action)?;
            row.operation.plan=Some(plan.clone());
            row.operation.outcome.state=OutcomeState::Dispatching;
            row.operation.outcome.remote_activity=RemoteActivity::Active{termination_evidence_digest:None};
            row.operation.outcome.unknown_scope_fence_retained=true;
            row.operation.outcome.storage_liability=evidence.liability.clone();
            self.checked(&row.operation)?;
            repository::update(db,&mut row.operation,Some(&permit),true,"admit",&codec::encode_admission(&permit,preflight,&evidence).map_err(evidence_error)?)?;
            let changed=db.execute("UPDATE stock_activity_physical SET active_operation_id=?1 WHERE physical_database_id=?2 AND active_operation_id IS NULL",params![permit.operation_id.to_string(),permit.physical_binding.physical_database_id.to_string()]).map_err(unavailable)?;
            if changed!=1 {return Err(StockPortFault::VersionConflict);}
            Ok(Admission::Admitted{permit:Box::new(permit),operation:Box::new(row.operation)})
        })?;
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
