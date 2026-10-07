//! Inspected healthy synthetic peers adapted from exact Storage71 example.
//! No real credentials/accounts, provider I/O, restore/reopen or held controls.
use crate::{
    access as a,
    contracts::{self, stock as wire},
    domain::native_semantics::NativeSemantics,
    media::native::NativeReadAuthority,
    providers::homebox::write::stock as n,
    storage as s,
};
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    task::{Context as TaskContext, Poll, Waker},
};
use uuid::Uuid;

type Store = s::AtlasStore<s::NativeContract<NativeSemantics>, NativeReadAuthority, Clock>;
const TIME: &str = "2026-10-07T12:00:00Z";
fn id(n: u128) -> Uuid {
    Uuid::from_u128(0x00000000_0000_4000_8000_000000000000 | n)
}
fn digest(value: &Value) -> n::Digest {
    n::Digest::parse(contracts::semantics::canonical_digest(value).expect("finite synthetic JSON"))
        .expect("canonical SHA-256")
}
fn request<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/stock",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = pin!(future);
    match future
        .as_mut()
        .poll(&mut TaskContext::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("synthetic workflow must complete without an executor"),
    }
}

#[derive(Clone)]
struct Clock(Arc<AtomicU64>);
impl s::Runtime for Clock {
    fn now(&self) -> s::Result<String> {
        Ok(TIME.into())
    }
    fn new_id(&self) -> s::Result<String> {
        Ok(id(self.0.fetch_add(1, Ordering::SeqCst) as u128).to_string())
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "No asset in quantity fixture",
        ))
    }
}
struct Original {
    principal: a::Principal,
    source: a::SourceGrant,
    partition: a::PartitionGrant,
}

// Exact synthetic administrative/provenance peers for this isolated example.
// Production recovery still needs actual access/codec/media owner bindings.
struct OfflineDiscovery(Vec<s::StockActivityPhysicalRegistration>);
impl s::StockActivityRecoveryDiscovery for OfflineDiscovery {
    fn revalidate_registry(
        &self,
        registry: &[s::StockActivityPhysicalRegistration],
    ) -> s::Result<()> {
        if registry != self.0 {
            return Err(s::Error::new(
                "checkpoint-error",
                "Trusted fixture registry differs",
            ));
        }
        Ok(())
    }
    fn revalidate_registration(
        &self,
        registry: &[s::StockActivityPhysicalRegistration],
        registration: &s::StockActivityPhysicalRegistration,
    ) -> s::Result<()> {
        self.revalidate_registry(registry)?;
        if !self.0.contains(registration) {
            return Err(s::Error::new(
                "checkpoint-error",
                "Trusted fixture registration missing",
            ));
        }
        Ok(())
    }
}
struct EmptyJobs;
impl s::QueueDiscovery for EmptyJobs {
    fn authorize_discovery(&self, _: &crate::jobs::QueueRegistration) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in activity fixture",
        ))
    }
    fn validate_retained_enqueue(
        &self,
        _: &crate::domain::stock::ValidatedRequest,
        _: &crate::jobs::EnqueueRequest,
        _: &crate::jobs::CanonicalScope,
        _: &crate::jobs::QueueConfig,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in activity fixture",
        ))
    }
}
impl s::QueueRecoveryEvidence for EmptyJobs {
    fn validate_attempt(
        &self,
        _: &crate::jobs::QueueConfig,
        _: s::QueueRecoveryAttempt<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in activity fixture",
        ))
    }
}
impl s::StockActivityPrincipal for Original {
    fn original_activity_principal(&self) -> &a::Principal {
        &self.principal
    }
    fn original_activity_source(&self) -> &a::SourceGrant {
        &self.source
    }
    fn original_activity_partition(&self) -> &a::PartitionGrant {
        &self.partition
    }
}

#[derive(Clone)]
struct Peers(Arc<Fixture>);
struct Fixture {
    access: Arc<Mutex<a::AccessBoundary>>,
    original: Arc<Original>,
    validation: wire::StockValidation,
    command: n::StockCommand,
    authority: n::StockAuthority,
    registration: s::StockActivityRegistration,
    snapshot: Value,
    response: Value,
    dispatches: AtomicUsize,
    readbacks: AtomicUsize,
    policy_checks: AtomicUsize,
}
impl Peers {
    fn current(
        &self,
        guard: Option<&a::TransactionAuthorization<'_>>,
    ) -> Result<(), n::StockPortFault> {
        let f = &self.0;
        if let Some(g) = guard {
            g.revalidate()
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            g.authorize(f.original.principal.scope(), a::Capability::Mutate)
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            g.revalidate_source(&f.original.source)
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            g.revalidate_source_partition(&f.original.partition)
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
        } else {
            let access = f
                .access
                .lock()
                .map_err(|_| n::StockPortFault::Unavailable)?;
            access
                .authorize_storage(
                    &f.original.principal,
                    f.original.principal.scope(),
                    a::Capability::Mutate,
                )
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            access
                .revalidate_source(&f.original.source)
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            access
                .revalidate_source_partition(&f.original.partition)
                .map_err(|_| n::StockPortFault::EvidenceConflict)?;
        }
        Ok(())
    }
    fn preflight(&self) -> n::StockPreflight {
        let f = &self.0;
        let snapshot = n::NativeSnapshot {
            target: f.command.target.clone(),
            value: f.snapshot.clone(),
            digest: digest(&f.snapshot),
            complete: true,
            hidden_fields_preserved: true,
        };
        let preparation = n::Preparation {
            snapshots: vec![snapshot],
            staged_upload: None,
            native_clear_values: vec![],
        };
        n::StockPreflight {
            preparation,
            provider_observation: f.command.provider_observation,
            request_digest: f.command.request_digest.clone(),
            source_epoch: f.authority.source_epoch,
            preflight_digest: digest(&json!({"observation":f.command.provider_observation,
                "snapshot":f.snapshot,"sourceEpoch":f.authority.source_epoch})),
        }
    }
}
fn provider_error(wire: &Value) -> n::StockError {
    n::StockError {
        schema_version: 3,
        request_id: wire["requestId"]
            .as_str()
            .and_then(|v| Uuid::parse_str(v).ok())
            .unwrap_or(Uuid::nil()),
        code: n::StockErrorCode::InvalidArgument,
        message: "AT51 rejected synthetic request".into(),
        retry: n::RetryAdvice::None,
        operation_id: None,
    }
}
impl n::StockContractPort for Peers {
    fn validate_request(&self, raw: &Value) -> Result<n::StockCommand, n::StockError> {
        let parsed = wire::StockRequest::parse(&self.0.validation, raw.clone())
            .map_err(|_| provider_error(raw))?;
        if parsed.raw() != &self.0.command.original_wire
            || parsed.intent_digest() != self.0.command.request_digest.as_str()
        {
            return Err(provider_error(raw));
        }
        Ok(self.0.command.clone())
    }
    fn digest_native(&self, value: &Value) -> Result<n::Digest, n::StockPortFault> {
        Ok(digest(value))
    }
    fn validate_outcome(&self, outcome: &n::StockOutcome) -> Result<(), n::StockPortFault> {
        if !outcome.well_formed() {
            return Err(n::StockPortFault::EvidenceConflict);
        }
        let request =
            wire::StockRequest::parse(&self.0.validation, self.0.command.original_wire.clone())
                .map_err(|_| n::StockPortFault::ContentConflict)?;
        wire::StockResponse::parse(
            &self.0.validation,
            &request,
            serde_json::to_value(outcome).map_err(|_| n::StockPortFault::ContentConflict)?,
            &[],
        )
        .map_err(|_| n::StockPortFault::EvidenceConflict)?;
        Ok(())
    }
    fn validate_observed_at(&self, value: &str) -> Result<(), n::StockPortFault> {
        contracts::semantics::timestamp_millis(value)
            .ok_or(n::StockPortFault::ContentConflict)
            .map(|_| ())
    }
}
impl n::StockAccessPort for Peers {
    async fn authorize(
        &self,
        command: &n::StockCommand,
        phase: n::AuthorityPhase<'_>,
    ) -> Result<n::StockAuthority, n::StockErrorCode> {
        if command != &self.0.command || self.current(None).is_err() {
            return Err(n::StockErrorCode::CapabilityDenied);
        }
        if let n::AuthorityPhase::Readback(plan) = phase
            && (plan.readback.target != command.target
                || plan.readback.path != format!("/api/v1/entities/{}", id(500)))
        {
            return Err(n::StockErrorCode::CapabilityDenied);
        }
        Ok(self.0.authority.clone())
    }
}
impl n::StockPreparationPort for Peers {
    async fn prepare(
        &self,
        command: &n::StockCommand,
        authority: &n::StockAuthority,
    ) -> Result<n::StockPreflight, n::StockErrorCode> {
        if command != &self.0.command
            || authority != &self.0.authority
            || self.current(None).is_err()
        {
            return Err(n::StockErrorCode::PreflightConflict);
        }
        Ok(self.preflight())
    }
}
impl s::StockActivityAuthorization<Original> for Peers {
    fn authorize(
        &self,
        original: &Original,
        registration: &s::StockActivityRegistration,
        guard: Option<&a::TransactionAuthorization<'_>>,
        _phase: s::StockActivityPhase,
        action: s::StockActivityAction<'_>,
    ) -> Result<(), n::StockPortFault> {
        if !std::ptr::eq(original, Arc::as_ptr(&self.0.original))
            || registration.physical_binding != self.0.registration.physical_binding
            || registration.owner_id != self.0.registration.owner_id
            || registration.source_epoch != self.0.registration.source_epoch
            || registration.dispatcher_epoch != self.0.registration.dispatcher_epoch
        {
            return Err(n::StockPortFault::EvidenceConflict);
        }
        self.current(guard)?;
        match action {
            s::StockActivityAction::Reserve(command, authority) => {
                if command != &self.0.command || authority != &self.0.authority {
                    return Err(n::StockPortFault::EvidenceConflict);
                }
            }
            s::StockActivityAction::Admit(operation, plan, plan_digest, preflight, authority) => {
                if operation.command != self.0.command
                    || authority != &self.0.authority
                    || preflight != &self.preflight()
                    || n::map_stock(&self.0.command, &preflight.preparation)
                        .ok()
                        .as_ref()
                        != Some(plan)
                    || digest(
                        &serde_json::to_value(plan)
                            .map_err(|_| n::StockPortFault::EvidenceConflict)?,
                    ) != *plan_digest
                {
                    return Err(n::StockPortFault::EvidenceConflict);
                }
            }
            s::StockActivityAction::Dispatch(operation, permit, facts) => {
                if operation.command != self.0.command
                    || permit.actor_id != self.0.authority.actor_id
                    || facts.response_digest != Some(digest(&self.0.response))
                    || !facts.response_success
                    || !matches!(facts.remote_activity, n::RemoteActivity::EndUnproven { .. })
                {
                    return Err(n::StockPortFault::EvidenceConflict);
                }
            }
            s::StockActivityAction::Observation(operation, facts) => {
                if operation.command != self.0.command
                    || facts.readback_digest != digest(&self.0.response)
                    || !facts.agrees
                    || facts.observed_at != TIME
                    || facts.known_effects.len() != 1
                {
                    return Err(n::StockPortFault::EvidenceConflict);
                }
            }
            s::StockActivityAction::Disclose(operation) => {
                if operation.command != self.0.command {
                    return Err(n::StockPortFault::EvidenceConflict);
                }
            }
            _ => return Err(n::StockPortFault::EvidenceConflict),
        }
        self.0.policy_checks.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn admission(
        &self,
        original: &Original,
        registration: &s::StockActivityRegistration,
        guard: &a::TransactionAuthorization<'_>,
        operation: &n::StoredOperation,
        plan: &n::NativePlan,
        preflight: &n::StockPreflight,
    ) -> Result<s::StockActivityAdmissionEvidence, n::StockPortFault> {
        if !std::ptr::eq(original, Arc::as_ptr(&self.0.original))
            || registration.physical_binding != self.0.registration.physical_binding
            || operation.command != self.0.command
            || preflight != &self.preflight()
            || n::map_stock(&self.0.command, &preflight.preparation)
                .ok()
                .as_ref()
                != Some(plan)
        {
            return Err(n::StockPortFault::EvidenceConflict);
        }
        self.current(Some(guard))?;
        Ok(s::StockActivityAdmissionEvidence {
            approval: None,
            liability: n::StorageLiability {
                accounting_complete: true,
                metadata_commit_evidence: n::MetadataEvidence::NotDispatched,
                byte_disposition: n::ByteDisposition::None,
                reference_closure_evidence: n::ReferenceClosure::Unassessed,
                orphan_candidate_id: None,
                unresolved_attempts: 0,
                known_bytes: 0,
                reserved_bytes: Some(0),
            },
        })
    }
}
impl s::StockActivityRetentionAuthorization<Original> for Peers {
    fn authorize_retention(
        &self,
        original: &Original,
        registration: &s::StockActivityRegistration,
        guard: Option<&a::TransactionAuthorization<'_>>,
        phase: s::StockActivityPhase,
        record: &s::RetainedStockActivity,
    ) -> Result<(), n::StockPortFault> {
        <Self as s::StockActivityAuthorization<Original>>::authorize(
            self,
            original,
            registration,
            guard,
            phase,
            s::StockActivityAction::Disclose(record.operation()),
        )?;
        if record.registration() != &self.0.registration
            || record.original().command != self.0.command
        {
            return Err(n::StockPortFault::EvidenceConflict);
        }
        for event in record.events() {
            if let s::StockActivityEventFacts::Admit(admission) = event.facts()
                && admission.preflight != self.preflight()
            {
                return Err(n::StockPortFault::EvidenceConflict);
            }
            if event.operation().command != self.0.command {
                return Err(n::StockPortFault::EvidenceConflict);
            }
        }
        Ok(())
    }
}
impl n::StockDispatchPort for Peers {
    async fn dispatch(
        &self,
        permit: &n::InvocationPermit,
        plan: &n::NativePlan,
        authority: &n::StockAuthority,
    ) -> n::NativeDispatch {
        assert_eq!(authority, &self.0.authority);
        assert_eq!(
            permit.physical_binding,
            self.0.registration.physical_binding
        );
        assert_eq!(permit.owner_id, self.0.registration.owner_id);
        assert_eq!(plan.request.method, n::NativeMethod::Patch);
        assert_eq!(plan.request.path, format!("/api/v1/entities/{}", id(500)));
        assert_eq!(
            plan.request.body,
            n::NativeBody::Json(json!({"quantity":0}))
        );
        assert!(self.current(None).is_ok());
        assert_eq!(self.0.dispatches.fetch_add(1, Ordering::SeqCst), 0);
        n::NativeDispatch::Invoked(n::DispatchReceipt {
            operation_id: permit.operation_id,
            plan_digest: permit.plan_digest.clone(),
            context: self.0.command.context.clone(),
            source_instance_id: self.0.command.target.source_instance_id,
            collection_id: self.0.command.target.collection_id,
            response: Some(n::NativeResponse {
                status: plan.success_status,
                value: self.0.response.clone(),
                body_digest: digest(&self.0.response),
            }),
            remote_activity: n::RemoteActivity::end_unproven(),
        })
    }
}
impl n::StockReadbackPort for Peers {
    async fn readback(
        &self,
        operation: &n::StoredOperation,
        plan: &n::ReadbackPlan,
        authority: &n::StockAuthority,
    ) -> n::NativeObservation {
        assert_eq!(authority.actor_id, self.0.authority.actor_id);
        assert_eq!(
            authority.physical_binding,
            self.0.authority.physical_binding
        );
        assert_eq!(operation.command, self.0.command);
        assert_eq!(plan.target, self.0.command.target);
        assert_eq!(plan.path, format!("/api/v1/entities/{}", id(500)));
        assert!(self.current(None).is_ok());
        assert_eq!(self.0.readbacks.fetch_add(1, Ordering::SeqCst), 0);
        n::NativeObservation::Present {
            context: self.0.command.context.clone(),
            target: plan.target.clone(),
            value: self.0.response.clone(),
            observed_at: TIME.into(),
            complete: true,
            impact: None,
        }
    }
}

struct OriginalEvidence(Peers);
impl s::StockActivityRecoveryEvidence for OriginalEvidence {
    fn validate_record(&self, record: &s::RetainedStockActivity) -> s::Result<()> {
        assert_eq!(record.registration(), &self.0.0.registration);
        assert_eq!(record.original().command, self.0.0.command);
        for (index, event) in record.events().iter().enumerate() {
            let prefix = &record.events()[..=index];
            let permit = prefix.iter().find_map(|e| match e.facts() {
                s::StockActivityEventFacts::Admit(c) => Some(&c.permit),
                _ => None,
            });
            self.validate_event(s::StockActivityRecoveryEvent {
                registration: record.registration(),
                original: record.original(),
                event,
                previous: index.checked_sub(1).map(|i| &record.events()[i]),
                prefix,
                permit,
                body_accepted: permit.is_some(),
                physical_hold: matches!(
                    event.operation().outcome.remote_activity,
                    n::RemoteActivity::Active { .. } | n::RemoteActivity::EndUnproven { .. }
                ),
            })?;
        }
        Ok(())
    }
    fn validate_event(&self, frame: s::StockActivityRecoveryEvent<'_>) -> s::Result<()> {
        assert_eq!(frame.registration, &self.0.0.registration);
        assert_eq!(frame.original.command, self.0.0.command);
        assert_eq!(
            frame.event.operation().captured_authority,
            self.0.0.authority
        );
        assert_eq!(frame.prefix.last(), Some(frame.event));
        assert_eq!(
            frame
                .event
                .operation()
                .outcome
                .storage_liability
                .reserved_bytes,
            Some(0)
        );
        assert_eq!(
            frame
                .event
                .operation()
                .outcome
                .storage_liability
                .known_bytes,
            0
        );
        assert_eq!(
            frame
                .event
                .operation()
                .outcome
                .storage_liability
                .byte_disposition,
            n::ByteDisposition::None
        );
        for event in frame.prefix {
            if let s::StockActivityEventFacts::Admit(cut) = event.facts() {
                assert_eq!(cut.preflight, self.0.preflight());
                assert!(cut.evidence.approval.is_none());
                assert_eq!(cut.evidence.liability.reserved_bytes, Some(0));
                assert_eq!(frame.permit, Some(&cut.permit));
            }
        }
        Ok(())
    }
}
#[test]
fn healthy_profile6_native_capture_and_event_cuts() -> Result<(), Box<dyn std::error::Error>> {
    composition(false)
}
#[test]
fn healthy_profile6_authorized_archive_roundtrip() -> Result<(), Box<dyn std::error::Error>> {
    composition(true)
}
fn composition(archive_roundtrip: bool) -> Result<(), Box<dyn std::error::Error>> {
    use super::*;
    use n::{StockActivityPort, StockDispatchPort, StockReadbackPort};
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("stock.sqlite");
    let scope: a::Scope = serde_json::from_value(json!({"workspaceId":id(1),"homeId":id(2)}))?;
    let registration: a::SourceRegistration = serde_json::from_value(json!({
        "workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(10),
        "collectionId":id(11).to_string(),"owner":"homebox",
        "partitionMode":"exclusive-home","allowedExternalIds":[]}))?;
    let source_ref: a::SourceRef = serde_json::from_value(json!({
        "workspaceId":id(1),"homeId":id(2),"key":{
            "sourceInstanceId":id(10),"collectionId":id(11).to_string(),
            "sourceKind":"homebox-entity","externalId":id(500).to_string()}}))?;
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])?
            .with_clock(|| 1_800_000_000_000),
    )?;
    access.put_source(&registration, Some(true))?;
    let canonical = |n| a::CanonicalId::parse(id(n).to_string());
    let password = "Synthetic-activity-password-only!";
    access.provision_user(
        &canonical(50)?,
        &canonical(30)?,
        "synthetic-activity",
        &a::hash_password(password)?,
        None,
    )?;
    access.set_membership(&canonical(50)?, &scope, a::Role::Editor, true)?;
    let session = access.login(
        &request(None, None),
        &serde_json::to_vec(&json!({"username":"synthetic-activity","password":password}))?,
        "synthetic-loopback",
    )?;
    let cookie = session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("cookie")?
        .to_owned();
    let principal = access.authorize(
        &request(Some(&cookie), Some(session.info().csrf_token())),
        &scope,
        a::Action::Mutate,
    )?;
    let source = access.authorize_source(&principal, &source_ref)?;
    let partition = access.authorize_source_partition(&principal, &registration.partition())?;
    let original = Arc::new(Original {
        principal,
        source,
        partition,
    });
    let access = Arc::new(Mutex::new(access));

    let validation = wire::StockValidation::new()?;
    let raw = json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set",
        "requestId":id(20),"context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(10),
            "collectionId":id(11),"resourceKind":"entity","resourceId":id(500)},
        "payload":{"quantity":0},"idempotencyKey":id(21),
        "reason":"Synthetic quantity update",
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":id(22)},
            "atlasGuards":[]},"approvalReceiptId":null});
    let parsed = wire::StockRequest::parse(&validation, raw.clone())?;
    let command = n::StockCommand {
        command_id: parsed.id().as_str().into(),
        request_id: id(20),
        idempotency_key: id(21),
        context: n::Context {
            workspace_id: id(1),
            home_id: id(2),
        },
        target: n::StockTarget {
            source_instance_id: id(10),
            collection_id: id(11),
            resource_kind: n::ResourceKind::Entity,
            resource_id: Some(id(500)),
            entity_id: None,
        },
        payload: parsed.payload().clone(),
        native_sync_behavior: None,
        provider_observation: id(22),
        approval_receipt_id: None,
        original_wire: raw.clone(),
        request_digest: n::Digest::parse(parsed.intent_digest().into())
            .map_err(|e| format!("intent digest: {e:?}"))?,
    };
    let binding = n::PhysicalBinding {
        deployment_id: id(31),
        physical_database_id: id(32),
        configuration_digest: digest(&json!({"source":id(10),"collection":id(11)})),
    };
    let authority = n::StockAuthority {
        actor_id: id(30),
        source_epoch: 1,
        authority_digest: digest(&json!({"actor":id(30),"sourceEpoch":1})),
        physical_binding: binding.clone(),
        qualification: n::NativeQualification::SyntheticFixture,
    };
    let activity_registration = s::StockActivityRegistration {
        physical_binding: binding,
        owner_id: id(41),
        dispatcher_epoch: 1,
        source_epoch: 1,
        qualification: n::NativeQualification::SyntheticFixture,
    };
    let published: Value = serde_json::from_str(include_str!(
        "../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
    ))?;
    assert_eq!(published["synthetic"], true);
    let mut snapshot = published["entities"][0].clone();
    // The reviewed metadata supplies type, parent and raw source clock. The
    // explicit native-only fixture supplements complete preserved fields.
    snapshot.as_object_mut().ok_or("synthetic entity")?.extend(
        json!({
            "id":id(500),"assetId":"100500","description":"Synthetic complete native object",
            "manufacturer":"Example","modelNumber":"Fixture","serialNumber":"S-1",
            "notes":"Preserved synthetic notes","purchaseFrom":"Synthetic source",
            "soldTo":"","soldNotes":"","warrantyDetails":"Preserved warranty",
            "purchaseDate":"2026-01-01","soldDate":"2026-01-02","warrantyExpires":"2027-01-01",
            "quantity":1,"purchasePrice":12.5,"soldPrice":0,
            "insured":false,"lifetimeWarranty":false,"syncChildEntityLocations":false,
            "tags":[],"fields":[],"attachments":[]
        })
        .as_object()
        .ok_or("synthetic fields")?
        .clone(),
    );
    let mut response = snapshot.clone();
    response["quantity"] = json!(0);
    let peers = Peers(Arc::new(Fixture {
        access: access.clone(),
        original: original.clone(),
        validation,
        command: command.clone(),
        authority: authority.clone(),
        registration: activity_registration.clone(),
        snapshot,
        response: response.clone(),
        dispatches: AtomicUsize::new(0),
        readbacks: AtomicUsize::new(0),
        policy_checks: AtomicUsize::new(0),
    }));
    let store = Arc::new(Mutex::new(s::AtlasStore::open(
        &database,
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(access.clone()),
        Clock(Arc::new(AtomicU64::new(1000))),
        s::StoreOptions {
            stock_activity_profile: true,
            ..Default::default()
        },
    )?));
    let activity = s::StockActivitySession::new(
        store.clone(),
        access.clone(),
        original.clone(),
        Arc::new(peers.clone()),
        Arc::new(super::NativeWriterContracts::new()?),
        activity_registration.clone(),
        command.clone(),
        authority.clone(),
    )
    .map_err(|e| format!("activity session: {e:?}"))?;

    let contracts = NativeWriterContracts::new()?;
    let reservation =
        ready(activity.reserve(&command, &authority)).map_err(|e| format!("reserve: {e:?}"))?;
    let n::StockReservation::Reserved(reserved) = reservation else {
        panic!("fresh reservation");
    };
    let preflight = peers.preflight();
    let plan = n::map_stock(&command, &preflight.preparation).map_err(|e| format!("map: {e:?}"))?;
    let plan_digest = digest(&serde_json::to_value(&plan)?);
    let capture = StockActivityNativeCapture::unbound();
    let dispatch = capture.dispatch_port(peers.clone());
    let readback = capture.readback_port(peers.clone());
    let admitted = ready(activity.admit(&reserved, &plan, &plan_digest, &preflight, &authority))
        .map_err(|e| format!("admit: {e:?}"))?;
    let n::Admission::Admitted {
        permit,
        operation: admitted,
    } = admitted
    else {
        panic!("fresh admission");
    };
    let producer = activity
        .retain_producer(admitted.operation_id)
        .map_err(|e| format!("producer: {e:?}"))?;
    assert!(std::ptr::eq(producer.original(), Arc::as_ptr(&original)));
    let mut retained = RetainedNativeStockActivity::bind_admitted(&contracts, producer, &capture)?;
    // Original live producer and complete pre-I/O cut remain independently held.
    // This test has no production durable archive or native driver.
    assert_eq!(retained.producer().record().operation(), &*admitted);
    let mut archive_packets = Vec::new();
    if archive_roundtrip {
        let packet = NativeActivityArchivePacket::encode(&contracts, &retained)?;
        assert_eq!(packet.cut().events().len(), 2);
        assert!(packet.cut().native_events().is_empty());
        archive_packets.push(sync_packet(directory.path(), "before-io.json", &packet)?);
    }
    let raw_dispatch = ready(dispatch.dispatch(&permit, &plan, &authority));
    let n::NativeDispatch::Invoked(receipt) = &raw_dispatch else {
        panic!("healthy synthetic native receipt");
    };
    let facts = n::retained_bridge::dispatch(&contracts, &command, &plan, &permit, receipt);
    let dispatched = ready(activity.record_dispatch(&permit, &facts))
        .map_err(|e| format!("dispatch fact: {e:?}"))?;
    let successor = activity
        .retain_producer_successor(retained.producer())
        .map_err(|e| format!("dispatch successor: {e:?}"))?;
    retained.retain_successor(&contracts, successor)?;
    assert_eq!(retained.native_events()[0].dispatch(), Some(&raw_dispatch));
    assert_eq!(retained.native_events()[0].before(), &*admitted);
    if archive_roundtrip {
        let packet = NativeActivityArchivePacket::encode(&contracts, &retained)?;
        assert_eq!(packet.cut().events().len(), 3);
        assert_eq!(packet.cut().native_events().len(), 1);
        archive_packets.push(sync_packet(
            directory.path(),
            "after-dispatch.json",
            &packet,
        )?);
    }
    let resolved = n::retained_bridge::readback_plan(&dispatched).expect("exact native GET");
    let readback_authority = if archive_roundtrip {
        n::StockAuthority {
            authority_digest: digest(&json!({"syntheticRefreshedAuthority":true})),
            ..authority.clone()
        }
    } else {
        authority.clone()
    };
    let raw_observation = ready(readback.readback(&dispatched, &resolved, &readback_authority));
    let observed_facts = n::retained_bridge::observation(&contracts, &dispatched, &raw_observation)
        .expect("qualified fresh observation");
    let observed = ready(activity.save_observation(&dispatched, &observed_facts))
        .map_err(|e| format!("observation fact: {e:?}"))?;
    let successor = activity
        .retain_producer_successor(retained.producer())
        .map_err(|e| format!("observation successor: {e:?}"))?;
    retained.retain_successor(&contracts, successor)?;
    assert_eq!(
        retained.native_events()[1].observation(),
        Some(&raw_observation)
    );
    assert_eq!(retained.native_events()[1].before(), &dispatched);
    assert_eq!(observed.outcome.state, n::OutcomeState::ConfirmedObserved);
    assert!(matches!(
        observed.outcome.remote_activity,
        n::RemoteActivity::EndUnproven { .. }
    ));
    assert!(!observed.outcome.causality_proven && !observed.outcome.atomic_provider_cas);
    assert!(!observed.outcome.unknown_scope_fence_retained);
    if archive_roundtrip {
        let packet = NativeActivityArchivePacket::encode(&contracts, &retained)?;
        assert_eq!(
            packet.cut().native_events()[1].authority(),
            &readback_authority
        );
        archive_packets.push(sync_packet(
            directory.path(),
            "after-observation.json",
            &packet,
        )?);
    }
    let archive = RetainedNativeStockActivityArchive::new(vec![retained.seal(&contracts)?])?;
    let original_evidence = OriginalEvidence(peers.clone());
    let evidence = HomeboxStockActivityEvidence::new(&contracts, &archive, &original_evidence);
    let record = archive.retained(observed.operation_id)?.producer().record();
    assert_eq!(record.events().len(), 4);
    assert!(record.physical_hold() && record.body_accepted());
    assert!(
        record.events()[0]
            .operation()
            .outcome
            .response_digest
            .is_none()
    );
    assert!(
        record.events()[1]
            .operation()
            .outcome
            .readback_digest
            .is_none()
    );
    assert!(
        record.events()[2]
            .operation()
            .outcome
            .readback_digest
            .is_none()
    );
    assert_eq!(record.events()[3].operation(), &observed);
    drop((activity, dispatch, readback, capture));
    let mut store = Arc::try_unwrap(store)
        .map_err(|_| "live store alias")?
        .into_inner()
        .map_err(|_| "store lock")?;
    let stock = crate::domain::stock::NativeStockContract::new()?;
    let empty_jobs = EmptyJobs;
    let base = s::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &empty_jobs,
        evidence: &empty_jobs,
    };
    let registry = vec![s::StockActivityPhysicalRegistration::from(
        &activity_registration,
    )];
    let discovery = OfflineDiscovery(registry.clone());
    let archive_owner = SyntheticArchiveOwner {
        original: original.clone(),
        registration: activity_registration.clone(),
        packets: archive_packets
            .iter()
            .map(|(_, bytes)| bytes.clone())
            .collect(),
    };
    let restored_records = archive_packets
        .iter()
        .map(|(path, expected)| {
            let bytes = std::fs::read(path)?;
            assert_eq!(&bytes, expected);
            NativeActivityArchivePacket::decode(&contracts, &bytes, &archive_owner)
                .map_err(std::io::Error::other)
        })
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    if archive_roundtrip {
        assert_eq!(restored_records.len(), 3);
        assert_eq!(restored_records[0].cut().events().len(), 2);
        assert!(restored_records[0].cut().native_events().is_empty());
        assert_eq!(restored_records[1].cut().events().len(), 3);
        assert!(
            restored_records[1]
                .cut()
                .operation()
                .outcome
                .readback_digest
                .is_none()
        );
        assert_eq!(restored_records[2].cut().events().len(), 4);
        assert_eq!(
            restored_records[2].cut().native_events()[1].authority(),
            &readback_authority
        );
    }
    // Earlier snapshots are healthy roundtrips, not multiple current versions
    // of the same operation in the recovery archive.
    let current = restored_records.into_iter().last().into_iter().collect();
    let restored_archive = RestoredNativeActivityArchive::new(current)?;
    let restored_evidence = HomeboxRestoredStockActivityEvidence::new(
        &contracts,
        &restored_archive,
        &original_evidence,
    );
    let selected: &dyn s::StockActivityRecoveryEvidence = if archive_roundtrip {
        &restored_evidence
    } else {
        &evidence
    };
    let selected = SelectedEvidence(selected);
    let activity_peers = s::StockActivityRecoveryPeers {
        contracts: &contracts,
        registry: &registry,
        discovery: &discovery,
        evidence: &selected,
    };
    let image_path = directory.path().join("activity-image.sqlite");
    let mut check = || Ok(());
    let image = store.backup_stock_activity_recovery_to_with_peers(
        &image_path,
        &base,
        &activity_peers,
        &mut check,
    )?;
    store.close()?;
    let bytes = std::fs::read(&image_path)?;
    let validated = Store::validate_existing_stock_activity_recovery_image_with_peers(
        &image_path,
        &s::NativeContract::new(NativeSemantics::native()),
        &base,
        &activity_peers,
        &mut check,
    )?;
    assert_eq!(validated, image);
    assert_eq!(std::fs::read(&image_path)?, bytes);
    assert_eq!(image.database_schema, 6);
    assert_eq!(peers.0.dispatches.load(Ordering::SeqCst), 1);
    assert_eq!(peers.0.readbacks.load(Ordering::SeqCst), 1);
    println!(
        "profile6 native /3: sealed original producer, actual synthetic NativeDispatch/receipt/observation capture, four own-prefix events, unchanged image bytes, physical hold preserved; no recovered execution"
    );
    if archive_roundtrip {
        println!(
            "archive /4: three fresh synced authorized cut packets, genuine pre-I/O producer association, closed lossless decode via original storage codecs, refreshed GET authority retained, restored evidence qualifies four own prefixes; no producer restored and no execution resumed"
        );
    }
    Ok(())
}

fn sync_packet(
    directory: &std::path::Path,
    name: &str,
    packet: &super::NativeActivityArchivePacket,
) -> std::io::Result<(std::path::PathBuf, Vec<u8>)> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let path = directory.join(name);
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&path)?;
    file.write_all(packet.bytes())?;
    file.sync_all()?;
    std::fs::File::open(directory)?.sync_all()?;
    Ok((path, packet.bytes().to_vec()))
}
// Independent synthetic original archive issuer retained outside the image.
// Production supplies its actual authenticated read/origin/generation binding.
struct SyntheticArchiveOwner {
    original: Arc<Original>,
    registration: s::StockActivityRegistration,
    packets: Vec<Vec<u8>>,
}
impl super::NativeActivityArchiveReadAuthorization for SyntheticArchiveOwner {
    fn authorize_archive(
        &self,
        bytes: &[u8],
        cut: &super::RestoredNativeActivityCut,
    ) -> s::Result<()> {
        assert!(self.packets.iter().any(|expected| expected == bytes));
        assert_eq!(cut.registration(), &self.registration);
        assert_eq!(
            cut.original().actor_id.to_string(),
            self.original.principal.actor_id().as_str()
        );
        assert_eq!(
            cut.original().command.context.workspace_id.to_string(),
            self.original.principal.scope().workspace_id.as_str()
        );
        assert_eq!(
            cut.original().command.context.home_id.to_string(),
            self.original.principal.scope().home_id.as_str()
        );
        assert_eq!(cut.operation().operation_id, cut.original().operation_id);
        Ok(())
    }
}
struct SelectedEvidence<'a>(&'a dyn s::StockActivityRecoveryEvidence);
impl s::StockActivityRecoveryEvidence for SelectedEvidence<'_> {
    fn validate_record(&self, record: &s::RetainedStockActivity) -> s::Result<()> {
        self.0.validate_record(record)
    }
    fn validate_event(&self, event: s::StockActivityRecoveryEvent<'_>) -> s::Result<()> {
        self.0.validate_event(event)
    }
}
