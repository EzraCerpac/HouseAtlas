use super::*;
use rusqlite::params;

/// The only quantity admission result. Waiting work remains ordinary data;
/// admitted work retains the original allocations required for one invocation.
pub enum OriginalQuantityAdmission<'b, B> {
    Held(Box<StoredOperation>),
    Admitted(OriginalQuantityInvocation<'b, B>),
}

/// Issued only by a newly committed admission from this live producer session.
/// It is consumed by value before credential delivery and cannot be cloned.
/// Native `body_accepted` records admission of the intended request body; it is
/// not evidence that an HTTP body was sent or that a remote attempt ended.
/// This carrier grants no retry or later reconstruction from journal DATA.
pub struct OriginalQuantityInvocation<'b, B> {
    original_preparation: &'b B,
    original: Arc<crate::app::stock_activity_principal::OriginalStockActivityPrincipal>,
    session: Arc<()>,
    store: super::super::QuantityInstallationStoreIdentity,
    operation: Box<StoredOperation>,
    permit: Box<InvocationPermit>,
}

impl<'b, B> OriginalQuantityInvocation<'b, B> {
    pub fn original_preparation(&self) -> &B {
        self.original_preparation
    }
    pub fn original(
        &self,
    ) -> &crate::app::stock_activity_principal::OriginalStockActivityPrincipal {
        &self.original
    }
    pub fn operation(&self) -> &StoredOperation {
        &self.operation
    }
    pub fn permit(&self) -> &InvocationPermit {
        &self.permit
    }
}

/// Post-commit DATA channel. A failed release fence cannot hide a committed
/// admission from the original owner, but taking this value grants no retry.
pub struct QuantityAdmissionCommittedObservation(Mutex<Option<Admission>>);

impl QuantityAdmissionCommittedObservation {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn take(&self) -> Option<Admission> {
        self.0.lock().ok()?.take()
    }
}

impl Default for QuantityAdmissionCommittedObservation {
    fn default() -> Self {
        Self::new()
    }
}

impl<
    C: Contract + Send,
    A: Authorization + Send,
    R: Runtime + Send,
    G: StockActivityAuthorization<
        crate::app::stock_activity_principal::OriginalStockActivityPrincipal,
    >,
    S: StockContractPort + Send + Sync,
>
    StockActivitySession<
        C,
        A,
        R,
        crate::app::stock_activity_principal::OriginalStockActivityPrincipal,
        G,
        S,
    >
{
    pub fn admit_original_quantity<'bundle, 'native, 'p, 'owner, T, K>(
        &self,
        reserved: &StoredOperation,
        preparation: &'bundle crate::app::homebox_quantity_graph::OriginalQuantityPreparation<
            'native,
            'p,
            'owner,
            T,
            K,
        >,
        committed: &QuantityAdmissionCommittedObservation,
    ) -> PortResult<
        OriginalQuantityAdmission<
            'bundle,
            crate::app::homebox_quantity_graph::OriginalQuantityPreparation<
                'native,
                'p,
                'owner,
                T,
                K,
            >,
        >,
    >
    where
        T: crate::providers::homebox::read::Transport,
        K: crate::providers::homebox::read::Clock + Send + Sync,
    {
        if !std::ptr::eq(preparation.original(), &*self.original)
            || !Arc::ptr_eq(preparation.configured().access(), &self.access)
            || reserved.command != *preparation.native().command()
            || preparation.native().command() != &self.command
            || preparation.native().authority() != &self.captured_authority
            || preparation.configured().physical().physical_binding
                != self.registration.physical_binding
            || preparation.configured().physical().owner_id != self.registration.owner_id
            || preparation.configured().physical().dispatcher_epoch
                != self.registration.dispatcher_epoch
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        let producer = self
            .producer_operations
            .try_lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        if !producer.contains(&reserved.operation_id) {
            return Err(StockPortFault::EvidenceConflict);
        }
        let mut recorded = committed
            .0
            .try_lock()
            .map_err(|_| StockPortFault::Unavailable)?;
        if recorded.is_some() {
            return Err(StockPortFault::EvidenceConflict);
        }
        let plan = preparation.native().plan();
        let preflight = preparation.native().preflight();
        let authority = preparation.native().authority();
        let plan_digest = self
            .schemas
            .digest_native(&serde_json::to_value(plan).map_err(evidence)?)?;
        let qualify =
            |db: &Connection,
             guard: &access::TransactionAuthorization<'_>,
             identity: &super::super::QuantityInstallationStoreIdentity| {
                let physical = super::super::observe_quantity_installation_in_transaction(
                    db,
                    identity,
                    preparation.original(),
                    guard,
                    preparation.configured().queue(),
                    preparation.configured().physical(),
                )
                .map_err(evidence)?;
                if !preparation
                    .configured()
                    .store_identity()
                    .matches_observation(physical.observation())
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                preparation
                    .revalidate_activity_transaction(guard, &physical)
                    .map_err(evidence)
            };
        let result = self.admit_with_qualification(
            reserved,
            plan,
            &plan_digest,
            preflight,
            authority,
            true,
            qualify,
            |admission| {
                *recorded = Some(match admission {
                    Admission::Held(operation) => Admission::Held(operation.clone()),
                    Admission::Admitted { operation, permit } => Admission::Admitted {
                        operation: operation.clone(),
                        permit: permit.clone(),
                    },
                });
            },
        )?;
        drop(producer);
        match result {
            Admission::Held(operation) => {
                self.transact_quantity_live_committed(
                    |db, guard, identity| {
                        qualify(db, guard, identity)?;
                        let row = repository::load(db, operation.operation_id)?;
                        self.checked(&row.operation)?;
                        if row.operation != *operation
                            || row.permit.is_some()
                            || row.body_accepted
                            || row.operation.outcome.state != OutcomeState::Queued
                        {
                            return Err(StockPortFault::VersionConflict);
                        }
                        self.authorize_guard(
                            Some(guard),
                            StockActivityPhase::Release,
                            StockActivityAction::Disclose(&operation),
                        )
                    },
                    |_| {},
                )?;
                Ok(OriginalQuantityAdmission::Held(operation))
            }
            Admission::Admitted { operation, permit } => {
                self.transact_quantity_live_committed(
                    |db, guard, identity| {
                        qualify(db, guard, identity)?;
                        self.authorize_guard(
                            Some(guard),
                            StockActivityPhase::Release,
                            StockActivityAction::Disclose(&operation),
                        )?;
                        let record =
                            repository::retained(db, operation.operation_id, &self.registration)?;
                        check_initial_invocation(&record, &operation, &permit)?;
                        Ok(())
                    },
                    |_| {},
                )?;
                Ok(OriginalQuantityAdmission::Admitted(
                    OriginalQuantityInvocation {
                        original_preparation: preparation,
                        original: Arc::clone(&self.original),
                        session: Arc::clone(&self.session),
                        store: preparation.configured().store_identity().clone(),
                        operation,
                        permit,
                    },
                ))
            }
        }
    }

    /// Consume the issuer's single carrier before accessing credentials. A
    /// failure leaves the committed activity in place for evidence recovery;
    /// there is no reissue path from an operation id or retained journal.
    #[expect(
        clippy::too_many_arguments,
        reason = "The one-shot invocation checks each independent original and transport boundary input"
    )]
    pub fn consume_quantity_authorization<'bundle, 'native, 'p, 'owner, T, K>(
        &self,
        invocation: OriginalQuantityInvocation<
            'bundle,
            crate::app::homebox_quantity_graph::OriginalQuantityPreparation<
                'native,
                'p,
                'owner,
                T,
                K,
            >,
        >,
        preparation: &crate::app::homebox_quantity_graph::OriginalQuantityPreparation<
            'native,
            'p,
            'owner,
            T,
            K,
        >,
        endpoint: &crate::providers::homebox::write_transport::SourceEndpoint,
        permit: &InvocationPermit,
        plan: &NativePlan,
        authority: &StockAuthority,
        deadline: tokio::time::Instant,
    ) -> PortResult<crate::providers::homebox::write_transport::AuthorizationHeader>
    where
        T: crate::providers::homebox::read::Transport,
        K: crate::providers::homebox::read::Clock + Send + Sync,
    {
        if tokio::time::Instant::now() >= deadline {
            return Err(StockPortFault::Unavailable);
        }
        if !std::ptr::eq(invocation.original_preparation, preparation)
            || !Arc::ptr_eq(&invocation.original, &self.original)
            || !Arc::ptr_eq(&invocation.session, &self.session)
            || !std::ptr::eq(preparation.original(), &*self.original)
            || !Arc::ptr_eq(preparation.configured().access(), &self.access)
            || invocation.operation.command != *preparation.native().command()
            || invocation.permit.as_ref() != permit
            || invocation.operation.plan.as_ref() != Some(plan)
            || preparation.native().plan() != plan
            || preparation.native().authority() != authority
            || authority != &self.captured_authority
            || preparation.configured().physical().physical_binding
                != self.registration.physical_binding
            || preparation.configured().physical().owner_id != self.registration.owner_id
            || preparation.configured().physical().dispatcher_epoch
                != self.registration.dispatcher_epoch
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        self.checked(&invocation.operation)?;
        self.check_authority(authority)?;
        let binding = endpoint.binding();
        if binding.context != invocation.operation.command.context
            || binding.source_instance_id != invocation.operation.command.target.source_instance_id
            || binding.collection_id != invocation.operation.command.target.collection_id
            || binding.physical_binding != self.registration.physical_binding
            || binding.owner_id != self.registration.owner_id
            || binding.dispatcher_epoch != self.registration.dispatcher_epoch
            || binding.source_epoch != self.registration.source_epoch
            || binding.qualification != self.registration.qualification
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        self.transact_quantity_live_committed(
            |db, guard, identity| {
                if tokio::time::Instant::now() >= deadline {
                    return Err(StockPortFault::Unavailable);
                }
                let qualify = || -> PortResult<()> {
                    let physical = super::super::observe_quantity_installation_in_transaction(
                        db,
                        identity,
                        preparation.original(),
                        guard,
                        preparation.configured().queue(),
                        preparation.configured().physical(),
                    )
                    .map_err(evidence)?;
                    if !invocation.store.matches_observation(physical.observation()) {
                        return Err(StockPortFault::EvidenceConflict);
                    }
                    preparation
                        .revalidate_activity_transaction(guard, &physical)
                        .map_err(evidence)
                };
                qualify()?;
                let record = repository::retained(db, permit.operation_id, &self.registration)?;
                check_initial_invocation(&record, &invocation.operation, permit)?;
                let action =
                    StockActivityAction::Invoke(&invocation.operation, permit, plan, authority);
                self.authorize_guard(Some(guard), StockActivityPhase::Entry, action)?;
                qualify()?;
                self.authorize_guard(Some(guard), StockActivityPhase::Precommit, action)?;
                qualify()?;
                let selected = preparation
                    .configured()
                    .homebox()
                    .endpoint()
                    .map_err(evidence)?;
                let header = preparation
                    .configured()
                    .credentials()
                    .deliver_quantity_header_in_guard(
                        &selected,
                        endpoint,
                        &self.original,
                        guard,
                        plan,
                        deadline,
                    )
                    .map_err(evidence)?;
                if tokio::time::Instant::now() >= deadline {
                    return Err(StockPortFault::Unavailable);
                }
                qualify()?;
                Ok(header)
            },
            |_| {},
        )
    }
}

fn check_initial_invocation(
    record: &RetainedStockActivity,
    operation: &StoredOperation,
    permit: &InvocationPermit,
) -> PortResult<()> {
    if record.operation() != operation
        || record.permit() != Some(permit)
        || !record.body_accepted()
        || !record.physical_hold()
        || record
            .events()
            .iter()
            .filter(|event| matches!(event.facts(), StockActivityEventFacts::Admit(_)))
            .count()
            != 1
        || record.events().iter().any(|event| {
            matches!(
                event.facts(),
                StockActivityEventFacts::Dispatch(_)
                    | StockActivityEventFacts::Observation(_)
                    | StockActivityEventFacts::NeverInvoked
            )
        })
        || operation.outcome.state != OutcomeState::Dispatching
        || operation.plan.as_ref().is_none()
        || !matches!(
            record.events().last().map(|event| event.facts()),
            Some(StockActivityEventFacts::Admit(_))
        )
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(())
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
    /// One admission engine for the ordinary port and the original quantity
    /// path. `qualify` is private to Storage and runs inside the same live
    /// Access guard and SQLite transaction as the durable successor.
    #[expect(
        clippy::too_many_arguments,
        reason = "The shared atomic admission engine preserves every existing port input and its private transaction qualifier"
    )]
    pub(super) fn admit_with_qualification(
        &self,
        reserved: &StoredOperation,
        plan: &NativePlan,
        plan_digest: &Digest,
        preflight: &StockPreflight,
        authority: &StockAuthority,
        quantity_order: bool,
        qualify: impl Fn(
            &Connection,
            &access::TransactionAuthorization<'_>,
            &super::super::QuantityInstallationStoreIdentity,
        ) -> PortResult<()>,
        committed: impl FnOnce(&mut Admission),
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
        let transition =
            |db: &Connection,
             guard: &access::TransactionAuthorization<'_>,
             identity: &super::super::QuantityInstallationStoreIdentity| {
                let mut row = repository::load(db, reserved.operation_id)?;
                if row.operation != *reserved {
                    return Err(StockPortFault::VersionConflict);
                }
                if row.permit.is_some()
                    || row.body_accepted
                    || !matches!(
                        row.operation.outcome.state,
                        OutcomeState::Prepared | OutcomeState::Queued
                    )
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                let action = StockActivityAction::Admit(
                    &row.operation,
                    plan,
                    plan_digest,
                    preflight,
                    authority,
                );
                self.authorize_guard(Some(guard), StockActivityPhase::Entry, action)?;
                qualify(db, guard, identity)?;
                let earlier: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM stock_activity_events e JOIN stock_activity_operations o ON o.operation_id=e.operation_id WHERE e.kind='reserve' AND o.physical_database_id=?1 AND o.body_accepted=0 AND json_extract(o.operation_json,'$.payload.outcome.state') IN ('prepared','queued') AND e.sequence<(SELECT sequence FROM stock_activity_events WHERE operation_id=?2 AND kind='reserve'))", params![self.registration.physical_binding.physical_database_id.to_string(), reserved.operation_id.to_string()], |r| r.get(0)).map_err(unavailable)?;
                if earlier || repository::occupied(db, &self.registration)? {
                    self.authorize_guard(Some(guard), StockActivityPhase::Precommit, action)?;
                    qualify(db, guard, identity)?;
                    if row.operation.outcome.state == OutcomeState::Prepared {
                        row.operation.outcome.state = OutcomeState::Queued;
                        repository::update(db, &mut row.operation, None, false, "queued", "{}")?;
                    }
                    return Ok(Admission::Held(Box::new(row.operation)));
                }
                let evidence = self.authorization.admission(
                    &self.original,
                    &self.registration,
                    guard,
                    &row.operation,
                    plan,
                    preflight,
                )?;
                if !evidence.liability.well_formed()
                    || evidence.approval.as_ref().map(|a| a.receipt_id)
                        != row.operation.command.approval_receipt_id
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                if let NativeBody::Multipart { stage, .. } = &plan.request.body
                    && evidence
                        .liability
                        .reserved_bytes
                        .is_none_or(|b| b < stage.byte_size)
                {
                    return Err(StockPortFault::EvidenceConflict);
                }
                if let Some(approval) = &evidence.approval {
                    db.execute(
                        "INSERT INTO stock_activity_approvals VALUES(?1,?2,?3)",
                        params![
                            approval.receipt_id.to_string(),
                            row.operation.operation_id.to_string(),
                            approval.evidence_digest.as_str()
                        ],
                    )
                    .map_err(|_| StockPortFault::EvidenceConflict)?;
                }
                let permit = InvocationPermit {
                    operation_id: row.operation.operation_id,
                    actor_id: row.operation.actor_id,
                    physical_binding: self.registration.physical_binding.clone(),
                    owner_id: self.registration.owner_id,
                    dispatcher_epoch: self.registration.dispatcher_epoch,
                    source_epoch: self.registration.source_epoch,
                    plan_digest: plan_digest.clone(),
                    qualification: self.registration.qualification.clone(),
                };
                self.authorize_guard(Some(guard), StockActivityPhase::Precommit, action)?;
                qualify(db, guard, identity)?;
                row.operation.plan = Some(plan.clone());
                row.operation.outcome.state = OutcomeState::Dispatching;
                row.operation.outcome.remote_activity = RemoteActivity::Active {
                    termination_evidence_digest: None,
                };
                row.operation.outcome.unknown_scope_fence_retained = true;
                row.operation.outcome.storage_liability = evidence.liability.clone();
                self.checked(&row.operation)?;
                repository::update(
                    db,
                    &mut row.operation,
                    Some(&permit),
                    true,
                    "admit",
                    &codec::encode_admission(&permit, preflight, &evidence)
                        .map_err(|_| StockPortFault::EvidenceConflict)?,
                )?;
                let changed = db.execute("UPDATE stock_activity_physical SET active_operation_id=?1 WHERE physical_database_id=?2 AND active_operation_id IS NULL", params![permit.operation_id.to_string(), permit.physical_binding.physical_database_id.to_string()]).map_err(unavailable)?;
                if changed != 1 {
                    return Err(StockPortFault::VersionConflict);
                }
                Ok(Admission::Admitted {
                    permit: Box::new(permit),
                    operation: Box::new(row.operation),
                })
            };
        if quantity_order {
            self.transact_quantity_live_committed(transition, committed)
        } else {
            self.transact_live_with_identity_committed(
                |db, guard, _, identity| transition(db, guard, identity),
                committed,
            )
        }
    }
}
