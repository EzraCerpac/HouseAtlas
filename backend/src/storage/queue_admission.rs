//! Private queue admission operations.
use super::quantity_original::OwnedQuantityContext;
use super::*;

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    pub(super) fn enqueue_inner(
        &mut self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: u64,
    ) -> Result<EnqueueOutcome> {
        self.enqueue_inner_with_original(input, scope, config, now, None)
    }

    pub(super) fn enqueue_inner_with_original(
        &mut self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: u64,
        original_preparation: Option<&dyn super::original_preparation::InitialPreparationContext>,
    ) -> Result<EnqueueOutcome> {
        self.enqueue_inner_contexts(input, scope, config, now, original_preparation, None)
    }

    pub(super) fn enqueue_inner_with_owned(
        &mut self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: u64,
        owned: Option<&dyn OwnedQuantityContext>,
    ) -> Result<EnqueueOutcome> {
        self.enqueue_inner_contexts(input, scope, config, now, None, owned)
    }

    fn enqueue_inner_contexts(
        &mut self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: u64,
        original_preparation: Option<&dyn super::original_preparation::InitialPreparationContext>,
        owned: Option<&dyn OwnedQuantityContext>,
    ) -> Result<EnqueueOutcome> {
        if let Some(context) = owned {
            if original_preparation.is_some() {
                return Err(invalid());
            }
            context.validate_fresh(input, scope, config)?;
            context.revalidate(&self.store.db)?;
        }
        if config != &self.config
            || input.receipt != *self.receipt
            || input.intent.request_digest.as_hex() != self.original.intent_digest()
            || config
                .registration
                .resolve(&input.partition, &input.write_scope)
                .map_err(|_| invalid())?
                != *scope
        {
            return Err(invalid());
        }
        input.validate().map_err(|_| invalid())?;
        self.authority.validate_enqueue(
            self.principal,
            self.witness,
            self.original,
            input,
            scope,
        )?;
        if input.intent.operation_id != self.original.id().as_str()
            || self.original.raw()["idempotencyKey"].as_str() != Some(&input.receipt.mutation_id)
            || self.original.raw()["target"]["sourceInstanceId"].as_str()
                != Some(&input.partition.source_instance_id)
            || self.original.raw()["target"]["collectionId"].as_str()
                != Some(&input.partition.collection_id)
        {
            return Err(invalid());
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Enqueue(input),
        )?;
        if let Some(preparation) = original_preparation {
            preparation.revalidate()?;
        }
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(context) = owned {
            context.revalidate(&tx)?;
        }
        let r = &input.receipt;
        let identity = &config.registration.identity;
        let prior:Option<String>=tx.query_row("SELECT job_id FROM queue_jobs WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",params![r.workspace_id,r.home_id,r.actor_id,r.mutation_id],|x|x.get(0)).optional()?;
        if let Some(id) = prior {
            // Fresh evidence cannot promote a retained receipt to replay authority.
            if original_preparation.is_some() || owned.is_some() {
                return Err(conflict());
            }
            let row = load(&tx, &id)?;
            if row.request != *input
                || row.scope != *scope
                || row.physical != identity.physical_database_id
                || row.deployment != identity.deployment_id
            {
                return Err(conflict());
            }
            let output = row.snapshot();
            let stored_original = self
                .authority
                .parse_retained_original(decoded(&row.original_json)?)?;
            if stored_original.intent_digest() != row.request.intent.request_digest.as_hex() {
                return Err(bad());
            }
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                &stored_original,
                self.receipt,
                QueuePhase::Precommit,
                QueueAction::Replay {
                    snapshot: &output,
                    stored_original: &stored_original,
                },
            )?;
            tx.commit()?;
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                &stored_original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Replay {
                    snapshot: &output,
                    stored_original: &stored_original,
                },
            )?;
            return Ok(EnqueueOutcome::Replayed(output));
        }
        let snapshot = queue_snapshot(&tx, config, input.pending_byte_liability)?;
        let decision = decide_admission(
            &config.registration,
            &config.admission_profile,
            &snapshot,
            scope,
            None,
            true,
        )
        .map_err(|_| invalid())?;
        if let QueueDecision::RejectedBeforeDispatch { reason } = decision {
            if let Some(context) = owned {
                context.revalidate(&tx)?;
            }
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Precommit,
                QueueAction::Enqueue(input),
            )?;
            if let Some(preparation) = original_preparation {
                preparation.revalidate()?;
            }
            tx.commit()?;
            if let Some(context) = owned {
                context.revalidate(&self.store.db)?;
            }
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Enqueue(input),
            )?;
            if let Some(preparation) = original_preparation {
                preparation.revalidate()?;
            }
            return Ok(EnqueueOutcome::RejectedBeforeDispatch { reason });
        }
        let sequence:String=tx.query_row("SELECT next_sequence FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2",params![identity.deployment_id,identity.physical_database_id],|x|x.get(0))?;
        let sequence = sum(parse_u64(&sequence)?, 1)?;
        let id = format!(
            "q{}",
            digest(
                format!(
                    "{}:{}:{}:{}",
                    identity.deployment_id.len(),
                    identity.deployment_id,
                    identity.physical_database_id,
                    sequence
                )
                .as_bytes()
            )
        );
        tx.execute("UPDATE queue_physical SET next_sequence=?1 WHERE deployment_id=?2 AND physical_database_id=?3",params![decimal(sequence),identity.deployment_id,identity.physical_database_id])?;
        tx.execute("INSERT INTO queue_jobs(job_id,deployment_id,physical_database_id,sequence,workspace_id,home_id,actor_id,mutation_id,intent_digest,original_json,request_json,canonical_scope_json,status,attempts,created_at,updated_at,next_attempt_at,body_accepted,activity,logical_fence,liability_json,codec_version) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'queued',0,?13,?14,?15,0,'not-dispatched',0,?16,1)",params![id,identity.deployment_id,identity.physical_database_id,decimal(sequence),r.workspace_id,r.home_id,r.actor_id,r.mutation_id,input.intent.request_digest.as_hex(),encoded(self.original.raw())?,encoded(&request_value(input))?,encoded(&scope_value(scope))?,decimal(now),decimal(now),decimal(now),encoded(&liability_value(&zero_liability()))?])?;
        let output = load(&tx, &id)?.snapshot();
        let retained_preparation = original_preparation
            .map(|preparation| preparation.insert(&tx, &id))
            .transpose()?;
        if let Some(context) = owned {
            context.revalidate(&tx)?;
        }
        self.authority.validate_enqueue(
            self.principal,
            self.witness,
            self.original,
            input,
            scope,
        )?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Enqueue(input),
        )?;
        if let Some(preparation) = original_preparation {
            preparation.revalidate()?;
        }
        tx.commit()?;
        if let Some(context) = owned {
            context.enqueue_committed(&output)?;
            let release = self.store.db.transaction()?;
            context.revalidate(&release)?;
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Enqueue(input),
            )?;
            context.revalidate(&release)?;
            release.commit()?;
            return Ok(EnqueueOutcome::Enqueued(output));
        }
        // The actual queue and preparation rows are durable even when a later
        // original authority/release check fails. Observation is DATA only.
        if let (Some(preparation), Some(retained)) = (original_preparation, retained_preparation) {
            preparation.committed(&output, retained);
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Release,
            QueueAction::Enqueue(input),
        )?;
        if let Some(preparation) = original_preparation {
            preparation.revalidate()?;
        }
        Ok(EnqueueOutcome::Enqueued(output))
    }
    pub(super) fn claim_next_inner(
        &mut self,
        now: u64,
        config: &QueueConfig,
    ) -> Result<ClaimOutcome> {
        self.claim_next_inner_with_owned(now, config, None)
    }

    pub(super) fn claim_next_inner_with_owned(
        &mut self,
        now: u64,
        config: &QueueConfig,
        owned: Option<(&dyn OwnedQuantityContext, &JobSnapshot)>,
    ) -> Result<ClaimOutcome> {
        if config != &self.config {
            return Err(invalid());
        }
        // An original first claim never expires waiters or adopts retry rows.
        if owned.is_none() {
            self.expire_own_waiter(now)?;
        }
        let authorize_observation = |phase, db: &Connection| {
            if let Some((context, _)) = owned {
                context.revalidate(db)?;
            }
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                phase,
                QueueAction::Snapshot(self.receipt),
            )
        };
        authorize_observation(QueuePhase::Entry, &self.store.db)?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((context, expected)) = owned {
            context.revalidate(&tx)?;
            let initial = load(&tx, &expected.job_id.0)?;
            context.validate_initial(&initial, config, now)?;
        }
        let (fence, active_id, active_fence, expires) = active(&tx, config)?;
        if let Some(id) = active_id {
            let expires = expires.ok_or_else(bad)?;
            if owned.is_some() {
                authorize_observation(QueuePhase::Precommit, &tx)?;
                tx.commit()?;
                authorize_observation(QueuePhase::Release, &self.store.db)?;
                return Ok(ClaimOutcome::Busy {
                    expires_at: expires,
                });
            }
            if now >= expires {
                let row = load(&tx, &id)?;
                if row.request.receipt != *self.receipt {
                    authorize_observation(QueuePhase::Precommit, &tx)?;
                    tx.commit()?;
                    authorize_observation(QueuePhase::Release, &self.store.db)?;
                    return Ok(ClaimOutcome::Busy {
                        expires_at: expires,
                    });
                }
                matches_original(self.receipt, self.original, &row, &self.config)?;
                let job = row.leased(config)?;
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Entry,
                    QueueAction::ExpireLease(&job),
                )?;
                if row.status == JobStatus::Running {
                    tx.execute("UPDATE queue_jobs SET status='held',updated_at=?1,failure='LeaseExpired',logical_fence=1 WHERE job_id=?2",params![decimal(now.max(row.updated)),id])?;
                }
                if !matches!(
                    row.remote,
                    RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
                ) {
                    store_activity(
                        &tx,
                        &id,
                        &RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven),
                    )?;
                }
                let held = load(&tx, &id)?;
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Precommit,
                    QueueAction::ExpireLease(&job),
                )?;
                let output = held.snapshot();
                tx.commit()?;
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Release,
                    QueueAction::ExpireLease(&job),
                )?;
                return Ok(ClaimOutcome::HeldForReconciliation(output));
            }
            if active_fence.is_none() {
                return Err(bad());
            }
            authorize_observation(QueuePhase::Precommit, &tx)?;
            tx.commit()?;
            authorize_observation(QueuePhase::Release, &self.store.db)?;
            return Ok(ClaimOutcome::Busy {
                expires_at: expires,
            });
        }
        let ids = due_ids(&tx, config)?;
        let mut candidate = None;
        for id in ids {
            let row = load(&tx, &id)?;
            if row.next.is_some_and(|at| at <= now) {
                candidate = Some(id);
                break;
            }
        }
        let Some(id) = candidate else {
            authorize_observation(QueuePhase::Precommit, &tx)?;
            tx.commit()?;
            authorize_observation(QueuePhase::Release, &self.store.db)?;
            return Ok(ClaimOutcome::Idle);
        };
        let identity = &config.registration.identity;
        if let Some(reason) = crate::storage::stock_activity::jobs_hold(
            &tx,
            self.store.options.stock_activity_profile,
            &identity.physical_database_id,
            &identity.deployment_id,
            identity.configuration_digest.as_hex(),
            &config.registration.dispatcher_owner_id,
        )? {
            authorize_observation(QueuePhase::Precommit, &tx)?;
            tx.commit()?;
            authorize_observation(QueuePhase::Release, &self.store.db)?;
            return Ok(ClaimOutcome::Waiting { reason });
        }
        let row = load(&tx, &id)?;
        if row.request.receipt != *self.receipt {
            authorize_observation(QueuePhase::Precommit, &tx)?;
            tx.commit()?;
            authorize_observation(QueuePhase::Release, &self.store.db)?;
            return Ok(ClaimOutcome::Waiting {
                reason: QueueWaitReason::EarlierWaiter,
            });
        }
        matches_original(self.receipt, self.original, &row, &self.config)?;
        let policy = queue_snapshot(&tx, config, row.request.pending_byte_liability)?;
        validate_job_state(&row)?;
        if let Some((context, _)) = owned {
            context.validate_initial(&row, config, now)?;
        }
        if row.status == JobStatus::RetryScheduled {
            validate_retry(&tx, &row, config)?;
        }
        match decide_admission(
            &config.registration,
            &config.admission_profile,
            &policy,
            &row.scope,
            Some(&JobId(id.clone())),
            true,
        )
        .map_err(|_| invalid())?
        {
            QueueDecision::QueueMetadata { reason } => {
                authorize_observation(QueuePhase::Precommit, &tx)?;
                tx.commit()?;
                authorize_observation(QueuePhase::Release, &self.store.db)?;
                return Ok(ClaimOutcome::Waiting { reason });
            }
            QueueDecision::RejectedBeforeDispatch { reason } => {
                if let Some((context, _)) = owned {
                    context.revalidate(&tx)?;
                }
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Entry,
                    QueueAction::Reject {
                        request: &row.request,
                        reason,
                    },
                )?;
                if row.attempts > 0 {
                    let job = row.leased(config)?;
                    let prior = retained_outcomes(&tx, &job)?;
                    require_retry_proof(prior.last().ok_or_else(bad)?)?;
                    let at = now.max(row.updated);
                    let step = QueueStepEvidence {
                        kind: StepKind::Other, codec: "houseatlas-admission/1".into(),
                        payload: encoded(&json!({"format":"houseatlas-admission/1","at":at.to_string(),"reason":"Rejected"}))?.into_bytes(),
                        response_digest: None, readback_digest: None, termination_digest: None,
                    };
                    insert_evidence(&tx, &job, std::slice::from_ref(&step))?;
                    append_outcome(
                        &tx,
                        &job,
                        at,
                        &FinishReport {
                            disposition: FinishDisposition::Failed(FailureCode::Rejected),
                            remote_activity: row.remote.clone(),
                            storage_liability: row.liability.clone(),
                        },
                        "admission-reject",
                        None,
                    )?;
                }
                tx.execute("UPDATE queue_jobs SET status='failed',updated_at=?1,next_attempt_at=NULL,failure='Rejected' WHERE job_id=?2",params![decimal(now.max(row.updated)),id])?;
                if let Some((context, _)) = owned {
                    context.revalidate(&tx)?;
                }
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Precommit,
                    QueueAction::Reject {
                        request: &row.request,
                        reason,
                    },
                )?;
                tx.commit()?;
                if let Some((context, _)) = owned {
                    context.revalidate(&self.store.db)?;
                }
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Release,
                    QueueAction::Reject {
                        request: &row.request,
                        reason,
                    },
                )?;
                return Ok(ClaimOutcome::RejectedBeforeDispatch { reason });
            }
            QueueDecision::ReadyForExclusiveDispatch => {}
            _ => return Err(invalid()),
        }
        let fence = sum(fence, 1)?;
        let expires = now
            .checked_add(config.lease_duration_ms)
            .ok_or_else(overflow)?;
        let attempts = row.attempts.checked_add(1).ok_or_else(overflow)?;
        let job = LeasedJob {
            lease: Lease {
                job_id: JobId(id.clone()),
                fence,
                expires_at: expires,
                owner_id: config.registration.dispatcher_owner_id.clone(),
                physical_identity: config.registration.identity.clone(),
            },
            request: row.request.clone(),
            attempt: attempts,
            canonical_scope: row.scope.clone(),
            pending_byte_liability: row.request.pending_byte_liability,
        };
        if let Some((context, _)) = owned {
            context.revalidate(&tx)?;
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Claim(&job),
        )?;
        let identity = &config.registration.identity;
        tx.execute("UPDATE queue_physical SET fence=?1,active_job_id=?2,active_fence=?3,expires_at=?4 WHERE deployment_id=?5 AND physical_database_id=?6",params![decimal(fence),id,decimal(fence),decimal(expires),identity.deployment_id,identity.physical_database_id])?;
        tx.execute("UPDATE queue_jobs SET status='running',attempts=?1,updated_at=?2,next_attempt_at=NULL,lease_fence=?3,lease_owner=?4,lease_expires=?5,body_accepted=1,logical_fence=1,activity='active',termination_digest=NULL WHERE job_id=?6",params![i64::from(attempts),decimal(now.max(row.updated)),decimal(fence),job.lease.owner_id,decimal(expires),id])?;
        tx.execute(
            "INSERT INTO queue_attempts(job_id,fence,original_leased_job_json) VALUES(?1,?2,?3)",
            params![id, decimal(fence), encoded(&leased_value(&job))?],
        )?;
        if let Some(liability) = reservation_liability(row.request.pending_byte_liability)? {
            append_liability(&tx, &row, fence, "claim", &liability)?;
        }
        if let Some((context, _)) = owned {
            context.revalidate(&tx)?;
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Claim(&job),
        )?;
        tx.commit()?;
        if let Some((context, _)) = owned {
            context.claim_committed(&job)?;
            let release = self.store.db.transaction()?;
            context.revalidate(&release)?;
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Claim(&job),
            )?;
            context.revalidate(&release)?;
            release.commit()?;
            return Ok(ClaimOutcome::Claimed(job));
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Release,
            QueueAction::Claim(&job),
        )?;
        Ok(ClaimOutcome::Claimed(job))
    }
}
