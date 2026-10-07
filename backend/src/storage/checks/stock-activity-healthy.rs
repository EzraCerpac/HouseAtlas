//! Fresh synthetic HomeBox quantity activity through actual AT11, AT51,
//! stock.2 mapper/writer, and AT07 SQLite activity session. No native I/O.
use houseatlas_at07_checkpoint::{
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

type Check<T> = Result<T, Box<dyn std::error::Error>>;
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
struct ProducerEvidence<'a> {
    original: &'a Arc<Original>,
    producer: &'a s::StockActivityProducer<Original>,
}
impl s::StockActivityRecoveryEvidence for ProducerEvidence<'_> {
    fn validate_record(&self, record: &s::RetainedStockActivity) -> s::Result<()> {
        // Independently retained live object, not a copy constructed from image.
        if !std::ptr::eq(self.producer.original(), Arc::as_ptr(self.original))
            || record != self.producer.record()
        {
            return Err(s::Error::new(
                "checkpoint-error",
                "Original producer cut differs",
            ));
        }
        Ok(())
    }
    fn validate_event(&self, event: s::StockActivityRecoveryEvent<'_>) -> s::Result<()> {
        let original = self.producer.record();
        let index = usize::try_from(event.event.operation().activity_version - 1)
            .map_err(|_| s::Error::new("checkpoint-error", "Fixture event version differs"))?;
        if original.events().get(index) != Some(event.event)
            || original.events().get(..=index) != Some(event.prefix)
            || event.registration != original.registration()
            || event.original != original.original()
            || event.previous != index.checked_sub(1).and_then(|v| original.events().get(v))
        {
            return Err(s::Error::new(
                "checkpoint-error",
                "Original producer prefix differs",
            ));
        }
        let admitted = event
            .prefix
            .iter()
            .any(|v| matches!(v.facts(), s::StockActivityEventFacts::Admit(_)));
        if event.body_accepted != admitted || event.permit.is_some() != admitted {
            return Err(s::Error::new(
                "checkpoint-error",
                "Fixture admission cut differs",
            ));
        }
        Ok(())
    }
}
struct EmptyJobs;
impl s::QueueDiscovery for EmptyJobs {
    fn authorize_discovery(
        &self,
        _: &houseatlas_at07_checkpoint::jobs::QueueRegistration,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in activity fixture",
        ))
    }
    fn validate_retained_enqueue(
        &self,
        _: &houseatlas_at07_checkpoint::domain::stock::ValidatedRequest,
        _: &houseatlas_at07_checkpoint::jobs::EnqueueRequest,
        _: &houseatlas_at07_checkpoint::jobs::CanonicalScope,
        _: &houseatlas_at07_checkpoint::jobs::QueueConfig,
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
        _: &houseatlas_at07_checkpoint::jobs::QueueConfig,
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
        assert_eq!(authority, &self.0.authority);
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

fn main() -> Check<()> {
    let root = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("houseatlas-at07-activity-healthy-{}", id(900)))
        });
    std::fs::create_dir(&root)?;
    let database = root.join("stock.sqlite");
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
        "../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
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
        Arc::new(peers.clone()),
        activity_registration,
        command.clone(),
        authority.clone(),
    )
    .map_err(|e| format!("activity session: {e:?}"))?;
    let writer = n::StockWriter {
        contracts: peers.clone(),
        access: peers.clone(),
        preparation: peers.clone(),
        activity,
        dispatch: peers.clone(),
        readback: peers.clone(),
    };
    let outcome = match ready(writer.execute(&raw)) {
        n::StockResult::Outcome(outcome) => *outcome,
        n::StockResult::Error(error) => return Err(format!("stock writer: {error:?}").into()),
    };
    assert_eq!(outcome.state, n::OutcomeState::ConfirmedObserved);
    assert_eq!(outcome.verification, n::Verification::ObservedAfterWrite);
    assert!(matches!(
        outcome.remote_activity,
        n::RemoteActivity::EndUnproven { .. }
    ));
    assert_eq!(outcome.response_digest, Some(digest(&response)));
    assert_eq!(outcome.readback_digest, Some(digest(&response)));
    assert!(outcome.response_success && outcome.readback_agrees);
    assert_eq!(outcome.known_effects.len(), 1);
    assert_eq!(outcome.known_effects[0].effect, n::Effect::Updated);
    assert_eq!(peers.0.dispatches.load(Ordering::SeqCst), 1);
    assert_eq!(peers.0.readbacks.load(Ordering::SeqCst), 1);
    assert!(peers.0.policy_checks.load(Ordering::SeqCst) >= 6);
    let loaded = ready(n::StockActivityPort::load(
        &writer.activity,
        &command,
        authority.actor_id,
        outcome.operation_id,
    ))
    .map_err(|e| format!("ordinary journal read: {e:?}"))?;
    assert_eq!(loaded.outcome, outcome);
    assert_eq!(loaded.activity_version, 4);
    let producer = writer
        .activity
        .retain_producer(outcome.operation_id)
        .map_err(|e| format!("ordinary producer retention: {e:?}"))?;
    assert!(std::ptr::eq(producer.original(), Arc::as_ptr(&original)));
    assert_eq!(producer.record().operation(), &loaded);
    assert_eq!(producer.record().original().activity_version, 1);
    assert_eq!(producer.record().original().command, command);
    assert_eq!(producer.record().events().len(), 4);
    assert!(producer.record().body_accepted() && producer.record().physical_hold());
    let s::StockActivityEventFacts::Admit(admission) = producer.record().events()[1].facts() else {
        return Err("Actual admission cut missing".into());
    };
    assert_eq!(admission.preflight, peers.preflight());
    assert_eq!(producer.record().permit(), Some(&admission.permit));
    assert_eq!(
        producer.record().events()[1].operation().plan.as_ref(),
        Some(
            &n::map_stock(&command, &admission.preflight.preparation)
                .map_err(|e| format!("native plan: {e:?}"))?
        )
    );
    let successor = writer
        .activity
        .retain_producer_successor(&producer)
        .map_err(|e| format!("ordinary retained successor: {e:?}"))?;
    assert_eq!(successor.record(), producer.record());
    drop(writer);
    // Producer has no source-store Arc. Preserve it independently across close.
    let mut store = Arc::try_unwrap(store)
        .map_err(|_| "Activity retained source Store")?
        .into_inner()
        .map_err(|_| "Fixture Store poisoned")?;
    let stock = houseatlas_at07_checkpoint::domain::stock::NativeStockContract::new()?;
    let empty_jobs = EmptyJobs;
    let base = s::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &empty_jobs,
        evidence: &empty_jobs,
    };
    let registry = vec![s::StockActivityPhysicalRegistration::from(
        &peers.0.registration,
    )];
    let discovery = OfflineDiscovery(registry.clone());
    let evidence = ProducerEvidence {
        original: &original,
        producer: &producer,
    };
    let activity = s::StockActivityRecoveryPeers {
        contracts: &peers,
        registry: &registry,
        discovery: &discovery,
        evidence: &evidence,
    };
    let image_path = root.join("activity-image.sqlite");
    let mut progress = 0usize;
    let mut check = || {
        progress += 1;
        Ok(())
    };
    let image = store.backup_stock_activity_recovery_to_with_peers(
        &image_path,
        &base,
        &activity,
        &mut check,
    )?;
    assert_eq!(image.database_schema, 6);
    store.close()?;
    let bytes = std::fs::read(&image_path)?;
    let validated = Store::validate_existing_stock_activity_recovery_image_with_peers(
        &image_path,
        &s::NativeContract::new(NativeSemantics::native()),
        &base,
        &activity,
        &mut check,
    )?;
    assert_eq!(validated, image);
    assert_eq!(std::fs::read(&image_path)?, bytes);
    let restored = root.join("restored-activity.sqlite");
    std::fs::copy(&image_path, &restored)?;
    let restored_store = Store::open_existing_stock_activity_recovery_image_with_peers(
        &restored,
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(access.clone()),
        Clock(Arc::new(AtomicU64::new(2000))),
        s::StoreOptions {
            stock_activity_profile: true,
            ..Default::default()
        },
        &image,
        &base,
        &activity,
        &mut check,
    )?;
    assert_eq!(restored_store.database_version(), 6);
    restored_store.close()?;
    assert!(progress > 0);
    let db = rusqlite::Connection::open_with_flags(
        &database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let (count, accepted, logical, liability): (i64, bool, bool, bool) = db.query_row(
        "SELECT count(*),body_accepted,logical_hold,liability_hold FROM stock_activity_operations",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    assert_eq!(
        (count, accepted, logical, liability),
        (1, true, false, false)
    );
    let held: bool = db.query_row(
        "SELECT active_operation_id IS NOT NULL FROM stock_activity_physical",
        [],
        |r| r.get(0),
    )?;
    assert!(held);
    let events: i64 = db.query_row("SELECT count(*) FROM stock_activity_events", [], |r| {
        r.get(0)
    })?;
    assert_eq!(events, 4);
    let observation: String = db.query_row(
        "SELECT facts_json FROM stock_activity_events WHERE kind='observation'",
        [],
        |r| r.get(0),
    )?;
    let observation: Value = serde_json::from_str(&observation)?;
    assert_eq!(observation["payload"]["observedAt"], TIME);
    assert!(observation["payload"].get("impactEvidenceDigest").is_some());
    println!(
        "{}",
        json!({"fixture":"fresh-stock-activity","profile":6,"operations":count,"events":events,"bodyAccepted":accepted,"logicalHold":logical,"liabilityHold":liability,"physicalHold":held,"dispatches":1,"readbacks":1,"outcome":outcome,"database":database.display().to_string(),
            "producerRetention":"original-Arc-and-native-admission-cut-pass","imageValidation":"unchanged-read-only-bytes","strictProfile6Reopen":"pass","recoveredDispatches":0,
            "recoveryPeerScope":"independent synthetic administrative registry/producer equality; production native raw receipt/observation and media codecs remain required"})
    );
    Ok(())
}
