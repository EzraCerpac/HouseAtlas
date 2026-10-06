use super::*;
use serde_json::Value;
use uuid::Uuid;

/// One application component. No routes, HTTP client, scheduler or SQLite pool.
pub struct StockWriter<C, A, P, S, D, R> {
    pub contracts: C,
    pub access: A,
    pub preparation: P,
    pub activity: S,
    pub dispatch: D,
    pub readback: R,
}

impl<C, A, P, S, D, R> StockWriter<C, A, P, S, D, R>
where
    C: StockContractPort,
    A: StockAccessPort,
    P: StockPreparationPort,
    S: StockActivityPort,
    D: StockDispatchPort,
    R: StockReadbackPort,
{
    pub async fn execute(&self, wire: &Value) -> StockResult {
        let command = match self.contracts.validate_request(wire) {
            Ok(command) => command,
            Err(error) => return StockResult::Error(error),
        };
        let authority = match self
            .access
            .authorize(&command, AuthorityPhase::Execute)
            .await
        {
            Ok(authority) => authority,
            Err(code) => return error(&command, None, code),
        };
        let reservation = match self.activity.reserve(&command, &authority).await {
            Ok(reservation) => reservation,
            Err(fault) => return error(&command, None, port_error(fault)),
        };
        match reservation {
            StockReservation::Existing(operation) | StockReservation::Queued(operation) => {
                // Async reserve may outlive membership/source capability. Check
                // original command and every disclosed retained effect now.
                if !same_intent(&command, &operation.command)
                    || !valid_operation(&operation)
                    || operation.actor_id != authority.actor_id
                {
                    return error(
                        &command,
                        Some(operation.operation_id),
                        StockErrorCode::IdempotencyMismatch,
                    );
                }
                self.disclose(&command, *operation).await
            }
            StockReservation::Reserved(operation) => {
                if !same_intent(&command, &operation.command)
                    || operation.command != command
                    || !valid_operation(&operation)
                    || operation.actor_id != authority.actor_id
                    || operation.captured_authority != authority
                    || operation.outcome.state != OutcomeState::Prepared
                {
                    return error(
                        &command,
                        Some(operation.operation_id),
                        StockErrorCode::InternalError,
                    );
                }
                self.run_reserved(*operation).await
            }
        }
    }

    /// Used only by the durable queue owner for a never-invoked reservation.
    /// A duplicate HTTP/MCP request never calls this for Existing/Queued state.
    /// Atomic admit supplies the actual duplicate/fenced-dispatch protection.
    pub async fn run_reserved(&self, operation: StoredOperation) -> StockResult {
        let command = &operation.command;
        if !valid_operation(&operation)
            || !matches!(
                operation.outcome.state,
                OutcomeState::Prepared | OutcomeState::Queued
            )
            || operation.outcome.remote_activity.invoked()
        {
            return error(
                command,
                Some(operation.operation_id),
                StockErrorCode::UnknownHeld,
            );
        }
        let authority = match self
            .access
            .authorize(command, AuthorityPhase::Execute)
            .await
        {
            Ok(authority) if authority == operation.captured_authority => authority,
            Ok(_) => {
                return self
                    .reject(&operation, StockErrorCode::PreflightConflict)
                    .await;
            }
            Err(code) => return self.reject(&operation, code).await,
        };
        let preflight = match self.preparation.prepare(command, &authority).await {
            Ok(preflight) => preflight,
            Err(code) => return self.reject(&operation, code).await,
        };
        if preflight.request_digest != command.request_digest
            || preflight.provider_observation != command.provider_observation
            || preflight.source_epoch != authority.source_epoch
        {
            return self
                .reject(&operation, StockErrorCode::PreflightConflict)
                .await;
        }
        let plan = match map_stock(command, &preflight.preparation) {
            Ok(plan) => plan,
            Err(error) => return self.reject(&operation, mapping_error(error)).await,
        };
        let plan_digest = match serde_json::to_value(&plan)
            .ok()
            .and_then(|v| self.contracts.digest_native(&v).ok())
        {
            Some(digest) => digest,
            None => return self.reject(&operation, StockErrorCode::InternalError).await,
        };
        // No mutable authority substitution after preparation. AT07 also
        // rechecks original grants and finite preflight clocks atomically.
        let current = match self
            .access
            .authorize(command, AuthorityPhase::Execute)
            .await
        {
            Ok(current) if current == authority => current,
            Ok(_) => {
                return self
                    .reject(&operation, StockErrorCode::PreflightConflict)
                    .await;
            }
            Err(code) => return self.reject(&operation, code).await,
        };
        let (permit, admitted) = match self
            .activity
            .admit(&operation, &plan, &plan_digest, &preflight, &current)
            .await
        {
            Ok(Admission::Held(held)) => {
                if !same_operation(&operation, &held)
                    || !valid_operation(&held)
                    || !matches!(
                        held.outcome.state,
                        OutcomeState::Queued | OutcomeState::RejectedBeforeDispatch
                    )
                {
                    return error(
                        command,
                        Some(operation.operation_id),
                        StockErrorCode::InternalError,
                    );
                }
                return self.disclose(command, *held).await;
            }
            Ok(Admission::Admitted {
                permit,
                operation: admitted,
            }) => (permit, *admitted),
            Err(fault) => return error(command, Some(operation.operation_id), port_error(fault)),
        };
        if !same_operation(&operation, &admitted)
            || !valid_operation(&admitted)
            || admitted.plan.as_ref() != Some(&plan)
            || admitted.outcome.state != OutcomeState::Dispatching
            || permit.operation_id != operation.operation_id
            || permit.actor_id != current.actor_id
            || permit.physical_binding != current.physical_binding
            || permit.source_epoch != current.source_epoch
            || permit.plan_digest != plan_digest
            || permit.qualification != current.qualification
        {
            return error(
                command,
                Some(operation.operation_id),
                StockErrorCode::UnknownHeld,
            );
        }
        // Durable dispatch intent precedes exactly one external invocation.
        // Dropping this future does not release the remote invocation hold.
        let record = match self.dispatch.dispatch(&permit, &plan, &current).await {
            NativeDispatch::NeverInvoked => {
                let saved = match self.activity.record_never_invoked(&permit).await {
                    Ok(saved) => saved,
                    Err(_) => {
                        return error(
                            command,
                            Some(operation.operation_id),
                            StockErrorCode::UnknownHeld,
                        );
                    }
                };
                if !same_operation(&admitted, &saved)
                    || !valid_operation(&saved)
                    || saved.activity_version <= admitted.activity_version
                    || saved.outcome.state != OutcomeState::RejectedBeforeDispatch
                {
                    return error(
                        command,
                        Some(operation.operation_id),
                        StockErrorCode::UnknownHeld,
                    );
                }
                return self.disclose(command, saved).await;
            }
            NativeDispatch::Invoked(receipt) => {
                let facts = super::evidence::dispatch_facts(
                    &self.contracts,
                    command,
                    &plan,
                    &permit,
                    &receipt,
                );
                match self.activity.record_dispatch(&permit, &facts).await {
                    Ok(saved)
                        if same_operation(&admitted, &saved)
                            && valid_operation(&saved)
                            && saved.activity_version > admitted.activity_version
                            && dispatch_retained(&saved, &facts) =>
                    {
                        saved
                    }
                    _ => {
                        return error(
                            command,
                            Some(operation.operation_id),
                            StockErrorCode::UnknownHeld,
                        );
                    }
                }
            }
        };
        self.observe_then_disclose(command, record).await
    }

    /// Recovery is GET-only. It never invokes dispatch, replaces original intent
    /// or promotes matching current values to causal/native CAS proof.
    pub async fn reconcile(&self, wire: &Value, operation_id: Uuid) -> StockResult {
        let command = match self.contracts.validate_request(wire) {
            Ok(command) => command,
            Err(error) => return StockResult::Error(error),
        };
        let authority = match self
            .access
            .authorize(&command, AuthorityPhase::Execute)
            .await
        {
            Ok(authority) => authority,
            Err(code) => return error(&command, Some(operation_id), code),
        };
        let operation = match self
            .activity
            .load(&command, authority.actor_id, operation_id)
            .await
        {
            Ok(operation) => operation,
            Err(fault) => return error(&command, Some(operation_id), port_error(fault)),
        };
        if !same_intent(&command, &operation.command)
            || !valid_operation(&operation)
            || operation.actor_id != authority.actor_id
            || operation.operation_id != operation_id
        {
            return error(
                &command,
                Some(operation_id),
                StockErrorCode::ResourceUnavailable,
            );
        }
        if matches!(
            operation.outcome.state,
            OutcomeState::Dispatching | OutcomeState::Partial | OutcomeState::UnknownHeld
        ) && operation.plan.is_some()
        {
            self.observe_then_disclose(&command, operation).await
        } else {
            self.disclose(&command, operation).await
        }
    }

    async fn observe_then_disclose(
        &self,
        response_command: &StockCommand,
        mut operation: StoredOperation,
    ) -> StockResult {
        let Some(plan) = operation.plan.as_ref() else {
            return error(
                response_command,
                Some(operation.operation_id),
                StockErrorCode::UnknownHeld,
            );
        };
        // Refresh membership/capability AFTER dispatch and persistence awaits.
        // Failure retains recorded dispatch evidence and performs no GET.
        let authority = match self
            .access
            .authorize(&operation.command, AuthorityPhase::Readback(plan))
            .await
        {
            Ok(authority)
                if authority.actor_id == operation.actor_id
                    && authority.physical_binding
                        == operation.captured_authority.physical_binding =>
            {
                authority
            }
            Ok(_) => {
                return error(
                    response_command,
                    Some(operation.operation_id),
                    StockErrorCode::CapabilityDenied,
                );
            }
            Err(code) => return error(response_command, Some(operation.operation_id), code),
        };
        let mut readback = plan.readback.clone();
        if let Some(target) = &operation.actual_target {
            readback.target = target.clone();
            if let Some(id) = target.resource_id {
                readback.path = readback.path.replace("{generatedId}", &id.to_string());
            }
        }
        // An unresolved generated ID never turns into a name/hash/list guess.
        if readback.path.contains("{generatedId}")
            || matches!(plan.generated, GeneratedIdentity::EntityMember { .. })
                && operation.actual_target.is_none()
        {
            return self.disclose(response_command, operation).await;
        }
        let observation = self
            .readback
            .readback(&operation, &readback, &authority)
            .await;
        if let Some(facts) =
            super::evidence::observation_facts(&self.contracts, &operation, &observation)
        {
            let prior = operation.clone();
            let expected = match prior.outcome.with_observation(&facts) {
                Some(expected) => expected,
                None => {
                    return error(
                        response_command,
                        Some(operation.operation_id),
                        StockErrorCode::UnknownHeld,
                    );
                }
            };
            operation = match self.activity.save_observation(&operation, &facts).await {
                Ok(saved)
                    if same_operation(&prior, &saved)
                        && valid_operation(&saved)
                        && saved.activity_version > prior.activity_version
                        && saved.actual_target == prior.actual_target
                        && saved.generated_members == prior.generated_members
                        && saved.outcome.response_success == prior.outcome.response_success
                        && saved.outcome.response_digest == prior.outcome.response_digest
                        && saved.outcome.remote_activity == prior.outcome.remote_activity
                        && saved.outcome.readback_agrees == facts.agrees
                        && saved.outcome.readback_digest.as_ref()
                            == Some(&facts.readback_digest)
                        && saved.outcome.state == expected.state
                        && saved.outcome.verification == expected.verification
                        && saved.outcome.unknown_scope_fence_retained
                            == expected.unknown_scope_fence_retained
                        && saved.outcome.generated_identity_resolved
                            == expected.generated_identity_resolved
                        && saved.outcome.known_effects == expected.known_effects =>
                {
                    saved
                }
                _ => {
                    return error(
                        response_command,
                        Some(operation.operation_id),
                        StockErrorCode::UnknownHeld,
                    );
                }
            };
        }
        self.disclose(response_command, operation).await
    }

    async fn reject(&self, operation: &StoredOperation, code: StockErrorCode) -> StockResult {
        match self.activity.reject(operation, code).await {
            Ok(saved)
                if same_operation(operation, &saved)
                    && valid_operation(&saved)
                    && saved.outcome.state == OutcomeState::RejectedBeforeDispatch =>
            {
                // Authorization failure must not disclose a retained outcome.
                // The sanitized error still identifies this authorized attempt.
                error(&operation.command, Some(saved.operation_id), code)
            }
            _ => error(
                &operation.command,
                Some(operation.operation_id),
                StockErrorCode::UnknownHeld,
            ),
        }
    }

    async fn disclose(
        &self,
        response_command: &StockCommand,
        operation: StoredOperation,
    ) -> StockResult {
        if !valid_operation(&operation) {
            return error(
                response_command,
                Some(operation.operation_id),
                StockErrorCode::InternalError,
            );
        }
        let current = match self
            .access
            .authorize(
                &operation.command,
                AuthorityPhase::Disclose(&operation.outcome),
            )
            .await
        {
            Ok(current)
                if current.actor_id == operation.actor_id
                    && current.physical_binding
                        == operation.captured_authority.physical_binding =>
            {
                current
            }
            Ok(_) => {
                return error(
                    response_command,
                    Some(operation.operation_id),
                    StockErrorCode::CapabilityDenied,
                );
            }
            Err(code) => return error(response_command, Some(operation.operation_id), code),
        };
        let _ = current; // Authority is consumed here; never serialized to clients.
        let mut outcome = operation.outcome;
        // A renewed transport request ID does not create a new operation.
        outcome.request_id = response_command.request_id;
        if self.contracts.validate_outcome(&outcome).is_err() {
            return error(
                response_command,
                Some(operation.operation_id),
                StockErrorCode::InternalError,
            );
        }
        StockResult::Outcome(Box::new(outcome))
    }
}

fn same_intent(a: &StockCommand, b: &StockCommand) -> bool {
    a.request_digest == b.request_digest
        && a.idempotency_key == b.idempotency_key
        && a.command_id == b.command_id
        && a.context == b.context
        && a.target == b.target
}
fn same_operation(a: &StoredOperation, b: &StoredOperation) -> bool {
    a.operation_id == b.operation_id
        && a.actor_id == b.actor_id
        && a.command == b.command
        && a.captured_authority == b.captured_authority
}
fn valid_operation(operation: &StoredOperation) -> bool {
    let outcome = &operation.outcome;
    operation.activity_version > 0
        && operation.actor_id == operation.captured_authority.actor_id
        && outcome.well_formed()
        && outcome.operation_id == operation.operation_id
        && outcome.request_id == operation.command.request_id
        && outcome.command_id == operation.command.command_id
        && outcome.resolved_scope == operation.command.context
        && outcome.request_digest == operation.command.request_digest
        && outcome.known_effects.iter().all(|effect| {
            effect.target.source_instance_id == operation.command.target.source_instance_id
                && effect.target.collection_id == operation.command.target.collection_id
        })
}
fn dispatch_retained(operation: &StoredOperation, facts: &DispatchFacts) -> bool {
    operation.outcome.response_success == facts.response_success
        && operation.outcome.response_digest == facts.response_digest
        && operation.outcome.remote_activity == facts.remote_activity
        && operation.actual_target == facts.generated_target
        && operation.generated_members == facts.generated_members
        && operation.outcome.generated_identity_resolved == facts.generated_identity_resolved
}
fn error(command: &StockCommand, operation_id: Option<Uuid>, code: StockErrorCode) -> StockResult {
    let operation_id = if matches!(
        code,
        StockErrorCode::CapabilityDenied | StockErrorCode::Unauthenticated
    ) {
        None
    } else {
        operation_id
    };
    StockResult::Error(StockError::new(command.request_id, operation_id, code))
}
fn port_error(fault: StockPortFault) -> StockErrorCode {
    match fault {
        StockPortFault::ContentConflict => StockErrorCode::IdempotencyMismatch,
        StockPortFault::VersionConflict | StockPortFault::EvidenceConflict => {
            StockErrorCode::UnknownHeld
        }
        StockPortFault::Unavailable => StockErrorCode::SourceUnavailable,
    }
}
fn mapping_error(error: StockMappingError) -> StockErrorCode {
    match error {
        StockMappingError::UnsupportedOperation | StockMappingError::NativeLimitation(_) => {
            StockErrorCode::UnsupportedCapability
        }
        StockMappingError::CompleteNativeObservationRequired
        | StockMappingError::ObservationConflict => StockErrorCode::PreflightConflict,
        StockMappingError::InvalidNativeInput | StockMappingError::StageMismatch => {
            StockErrorCode::InvalidArgument
        }
    }
}
