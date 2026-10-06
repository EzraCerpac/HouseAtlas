use super::*;
use uuid::Uuid;

pub struct HomeBoxWriter<'a, A, D, R, S> {
    pub mapper: &'a CatalogMapper,
    pub authorization: &'a A,
    pub dispatch: &'a D,
    pub readback: &'a R,
    pub activity: &'a S,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionResult {
    pub activity: ActivityRecord,
    pub reused: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteError {
    Unauthorized,
    Mapping(MappingError),
    Activity(ActivityFault),
    ActivityNotFound,
    ActivityReceiptMismatch,
    /// External side effects may have occurred. Recover by authorized readback
    /// of the reserved activity, never by sending the command again.
    RecoveryRequired {
        operation_id: Uuid,
    },
}

impl<A, D, R, S> HomeBoxWriter<'_, A, D, R, S>
where
    A: AuthorizationPort,
    D: DispatchPort,
    R: ReadbackPort,
    S: ActivityPort,
{
    pub async fn execute(&self, command: WriteCommand) -> Result<ExecutionResult, WriteError> {
        // Reauthorization precedes mapping and all activity lookup/replay.
        let actor = self
            .authorization
            .authorize(AuthorizationRequest::Execute {
                command: &command,
                catalog: self.mapper.identity(),
            })
            .await
            .map_err(|_| WriteError::Unauthorized)?;
        let mapped = self.mapper.map(&command).map_err(WriteError::Mapping)?;
        let attempt = WriteAttempt {
            actor_id: actor.actor_id,
            command,
            mapped,
        };
        let mut record = match self
            .activity
            .reserve(&attempt)
            .await
            .map_err(WriteError::Activity)?
        {
            Reservation::Existing(record) => {
                if record.attempt != attempt || record.activity_version == 0 {
                    return Err(WriteError::ActivityReceiptMismatch);
                }
                return Ok(ExecutionResult {
                    activity: *record,
                    reused: true,
                });
            }
            Reservation::Reserved(record) => {
                if record.attempt != attempt
                    || record.activity_version != 1
                    || record.outcome.is_some()
                {
                    return Err(WriteError::ActivityReceiptMismatch);
                }
                *record
            }
        };

        // Reservation is asynchronous: acquire current operation-specific
        // authority again immediately before dispatch. The trusted driver must
        // enforce its epoch when it binds source credentials and performs I/O.
        let current_authority = self
            .authorization
            .authorize(AuthorizationRequest::Execute {
                command: &attempt.command,
                catalog: &attempt.mapped.catalog,
            })
            .await;
        let authority = match current_authority {
            Ok(current) if current.actor_id == actor.actor_id => current,
            _ => {
                self.persist_dispatch(&record, DispatchState::NotDispatched)
                    .await?;
                return Err(WriteError::Unauthorized);
            }
        };

        // The durable reservation stays unresolved if this future is cancelled.
        let dispatch = match self.dispatch.dispatch(&attempt.mapped, authority).await {
            DispatchEvidence::Acknowledged { scope } if scope == attempt.mapped.request.scope => {
                DispatchState::Acknowledged
            }
            DispatchEvidence::ConfirmedNoWrite { scope }
                if scope == attempt.mapped.request.scope =>
            {
                DispatchState::ConfirmedNoWrite
            }
            DispatchEvidence::NotDispatched => DispatchState::NotDispatched,
            // Wrong-scope replies cannot be accepted as a write receipt.
            _ => DispatchState::Unknown,
        };
        // Persist dispatch evidence before awaiting readback. Cancellation of
        // readback therefore preserves the recorded acknowledgement/uncertainty.
        record = self.persist_dispatch(&record, dispatch).await?;
        let dispatch = record.outcome.as_ref().unwrap().dispatch;
        if matches!(
            dispatch,
            DispatchState::Acknowledged | DispatchState::Unknown
        ) {
            let outcome = self.observe(&attempt.mapped, dispatch, authority).await;
            record = self.persist(&record, &outcome).await?;
        }
        Ok(ExecutionResult {
            activity: record,
            reused: false,
        })
    }

    /// Readback only: this method never calls DispatchPort. A matching current
    /// value cannot prove that an uncertain earlier request caused the change.
    pub async fn reconcile(
        &self,
        target: &EntityRef,
        operation_id: Uuid,
    ) -> Result<ActivityRecord, WriteError> {
        let actor = self
            .authorization
            .authorize(AuthorizationRequest::Reconcile {
                target,
                operation_id,
            })
            .await
            .map_err(|_| WriteError::Unauthorized)?;
        let record = self
            .activity
            .load(actor, target, operation_id)
            .await
            .map_err(WriteError::Activity)?
            .ok_or(WriteError::ActivityNotFound)?;
        if record.attempt.actor_id != actor.actor_id
            || record.attempt.command.target != *target
            || record.attempt.command.operation_id != operation_id
            || record.attempt.mapped.request.scope != target.partition()
            || record.attempt.mapped.readback.target != *target
            || record.activity_version == 0
        {
            return Err(WriteError::ActivityReceiptMismatch);
        }
        // The lookup gate does not replace operation-specific current access.
        let authority = self
            .authorization
            .authorize(AuthorizationRequest::Execute {
                command: &record.attempt.command,
                catalog: &record.attempt.mapped.catalog,
            })
            .await
            .map_err(|_| WriteError::Unauthorized)?;
        if authority.actor_id != actor.actor_id {
            return Err(WriteError::Unauthorized);
        }
        let dispatch = record
            .outcome
            .as_ref()
            .map(|outcome| outcome.dispatch)
            .unwrap_or(DispatchState::Unknown);
        let outcome = self
            .observe(&record.attempt.mapped, dispatch, authority)
            .await;
        self.persist(&record, &outcome).await
    }

    async fn persist(
        &self,
        record: &ActivityRecord,
        outcome: &WriteOutcome,
    ) -> Result<ActivityRecord, WriteError> {
        let updated = self
            .activity
            .save_outcome(&record.attempt, record.activity_version, outcome)
            .await
            .map_err(|_| WriteError::RecoveryRequired {
                operation_id: record.attempt.command.operation_id,
            })?;
        if updated.attempt != record.attempt
            || record.activity_version.checked_add(1) != Some(updated.activity_version)
            || updated.outcome.as_ref() != Some(outcome)
        {
            return Err(WriteError::RecoveryRequired {
                operation_id: record.attempt.command.operation_id,
            });
        }
        Ok(updated)
    }

    async fn persist_dispatch(
        &self,
        record: &ActivityRecord,
        dispatch: DispatchState,
    ) -> Result<ActivityRecord, WriteError> {
        let updated = self
            .activity
            .record_dispatch(&record.attempt, dispatch)
            .await
            .map_err(|_| WriteError::RecoveryRequired {
                operation_id: record.attempt.command.operation_id,
            })?;
        if updated.attempt != record.attempt
            || updated.activity_version <= record.activity_version
            || !updated
                .outcome
                .as_ref()
                .is_some_and(|outcome| dispatch.permits_refinement_to(outcome.dispatch))
        {
            return Err(WriteError::RecoveryRequired {
                operation_id: record.attempt.command.operation_id,
            });
        }
        Ok(updated)
    }

    async fn observe(
        &self,
        mapped: &MappedWrite,
        dispatch: DispatchState,
        authority: AuthorizedActor,
    ) -> WriteOutcome {
        let mut observation = not_requested();
        if matches!(
            dispatch,
            DispatchState::Acknowledged | DispatchState::Unknown
        ) {
            observation.state = match self.readback.readback(mapped, authority).await {
                ReadbackEvidence::Observed {
                    target,
                    value,
                    retrieved_at,
                    source_updated_at,
                } if target == mapped.readback.target => {
                    observation.retrieved_at = Some(retrieved_at);
                    observation.source_updated_at = source_updated_at;
                    if value == mapped.expected_value {
                        ObservationState::Matches
                    } else {
                        ObservationState::Differs
                    }
                }
                ReadbackEvidence::Missing { target } if target == mapped.readback.target => {
                    ObservationState::Missing
                }
                ReadbackEvidence::Unavailable => ObservationState::Unavailable,
                _ => ObservationState::WrongScope,
            };
        }
        WriteOutcome {
            dispatch,
            observation,
        }
    }
}

fn not_requested() -> Observation {
    Observation {
        state: ObservationState::NotRequested,
        retrieved_at: None,
        source_updated_at: None,
    }
}
