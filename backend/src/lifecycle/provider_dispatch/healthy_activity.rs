//! Fresh synthetic AT11/AT07/native-stock composition through this host.
//! Adapted from exact storage 29a37d8 stock-activity-healthy source.
//! Dispatch/readback/evidence policy stay synthetic; no HTTP or provider I/O.
use super::*;
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

type Check<T> = Result<T, Box<dyn std::error::Error>>;
const TIME: &str = "2026-10-07T12:00:00Z";
fn id(n: u128) -> Uuid {
    Uuid::from_u128(0x00000000_0000_4000_8000_000000000000 | n)
}
fn digest(value: &Value) -> n::Digest {
    n::Digest::parse(contracts::semantics::canonical_digest(value).expect("finite synthetic JSON"))
        .expect("canonical SHA-256")
}
// Inspect the actual Storage codec string in the peer-owned packet. This is
// fixture-only JSON inspection, not a serializer or restored producer factory.
fn operation_payload(value: &Value) -> Value {
    let encoded: Value = serde_json::from_str(value.as_str().expect("storage codec string"))
        .expect("actual operation JSON");
    encoded["payload"].clone()
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
    archive: std::path::PathBuf,
    archive_destination: super::super::archive::ArchiveDestination,
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
impl NativeArchiveAuthorization<Original> for Peers {
    fn authorize_archive(
        &self,
        destination: &super::super::archive::ArchiveDestination,
        producer: &s::StockActivityProducer<Original>,
        native: Option<&codec::RetainedNativeStockActivity<Original>>,
    ) -> Result<(), n::StockPortFault> {
        if !std::ptr::eq(producer.original(), Arc::as_ptr(&self.0.original))
            || producer.record().registration() != &self.0.registration
            || producer.record().original().command != self.0.command
            || destination != &self.0.archive_destination
        {
            return Err(n::StockPortFault::EvidenceConflict);
        }
        self.current(None)?;
        for event in native.map(|n| n.native_events()).unwrap_or(&[]) {
            if event.before().command != self.0.command || event.authority() != &self.0.authority {
                return Err(n::StockPortFault::EvidenceConflict);
            }
            if let Some(receipt) = event.receipt()
                && !receipt
                    .response
                    .as_ref()
                    .is_some_and(|r| r.value == self.0.response)
            {
                return Err(n::StockPortFault::EvidenceConflict);
            }
            if let Some(observation) = event.observation()
                && !matches!(observation,n::NativeObservation::Present{value,observed_at,complete:true,..}
                    if value==&self.0.response && observed_at==TIME)
            {
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
        // Actual durable admission frame must exist BEFORE this genuine
        // producer seam is entered. No native I/O is simulated before it.
        let frame: Value = serde_json::from_slice(
            &std::fs::read(
                self.0
                    .archive
                    .join(format!("{}.2.producer.json", permit.operation_id)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            operation_payload(&frame["operation"])["activityVersion"],
            "2"
        );
        assert_eq!(frame["bodyAccepted"], true);
        assert_eq!(frame["physicalHold"], true);
        assert_eq!(frame["events"].as_array().unwrap().len(), 2);
        assert!(frame["native"].as_array().unwrap().is_empty());
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
        let frame: Value = serde_json::from_slice(
            &std::fs::read(
                self.0
                    .archive
                    .join(format!("{}.3.producer.json", operation.operation_id)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            operation_payload(&frame["operation"])["activityVersion"],
            "3"
        );
        assert_eq!(
            operation_payload(&frame["native"][0]["before"])["activityVersion"],
            "2"
        );
        assert_eq!(
            frame["native"][0]["raw"]["result"]["receipt"]["response"]["value"],
            self.0.response
        );
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

#[test]
fn healthy_fresh_stock_activity() -> Check<()> {
    let directory = tempfile::tempdir()?;
    let root = directory.path();
    let database = root.join("stock.sqlite");
    let archive_path = root.join("original-archive");
    std::fs::create_dir(&archive_path)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&archive_path, std::fs::Permissions::from_mode(0o700))?;
    let archive = PrivateStockArchive::open(
        crate::config::provider_dispatch::archive::TrustedStockArchiveConfig::new(
            archive_path.clone(),
            16 * 1024 * 1024,
        )?,
    )
    .map_err(|e| format!("archive:{e:?}"))?;
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
        archive: archive_path.clone(),
        archive_destination: archive.destination().clone(),
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
    let queue = crate::jobs::QueueConfig {
        lease_duration_ms: 1000,
        retry: crate::jobs::RetryPolicy {
            max_attempts: 1,
            initial_delay_ms: 100,
            max_delay_ms: 1000,
        },
        registration: crate::jobs::QueueRegistration {
            identity: crate::jobs::PhysicalQueueIdentity {
                deployment_id: authority.physical_binding.deployment_id.to_string(),
                physical_database_id: authority.physical_binding.physical_database_id.to_string(),
                configuration_digest: crate::jobs::Digest::from_hex(
                    authority
                        .physical_binding
                        .configuration_digest
                        .as_str()
                        .into(),
                )
                .unwrap(),
            },
            dispatcher_owner_id: activity_registration.owner_id.to_string(),
            aliases: vec![crate::jobs::SourceAlias {
                partition: crate::jobs::SourcePartition {
                    workspace_id: id(1).to_string(),
                    home_id: id(2).to_string(),
                    source_instance_id: id(10).to_string(),
                    collection_id: id(11).to_string(),
                },
                canonical_collection_id: id(11).to_string(),
            }],
        },
        admission_profile: crate::jobs::AdmissionProfile::stock_engineering_fixture(),
    };
    let mut host = DurableStockHost::new(
        store.clone(),
        access.clone(),
        TrustedDispatcherConfig::new(queue).unwrap(),
        archive.clone(),
    )
    .map_err(|e| format!("host:{e:?}"))?;
    let contracts = Arc::new(peers.clone());
    let session = host
        .activity(
            OriginalStockBinding {
                original: original.clone(),
                authorization: Arc::new(peers.clone()),
                contracts: contracts.clone(),
                command: command.clone(),
                captured_authority: authority.clone(),
            },
            activity_registration,
        )
        .map_err(|e| format!("host original session:{e:?}"))?;
    let retention = Retention::new(
        archive,
        Arc::new(peers.clone()),
        host.native_contracts.clone(),
    );
    let activity = RetainingActivity {
        session,
        retention: retention.clone(),
    };
    // Use only the test's synthetic dispatch peer. The production bind's actual
    // HttpDispatcher specialization is compiled but is not invoked here.
    let mut bound = BoundStock {
        writer: n::StockWriter {
            contracts: SharedContracts(contracts),
            access: peers.clone(),
            preparation: peers.clone(),
            activity,
            dispatch: retention.capture.dispatch_port(peers.clone()),
            readback: retention.capture.readback_port(peers.clone()),
        },
        command: command.clone(),
        actor_id: authority.actor_id,
        deployment: PhantomData,
        retention,
    };
    let outcome = match ready(bound.execute()) {
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
    let loaded = ready(bound.snapshot(outcome.operation_id))
        .map_err(|e| format!("ordinary journal read: {e:?}"))?;
    assert_eq!(loaded.outcome, outcome);
    assert_eq!(loaded.activity_version, 4);
    assert_eq!(loaded.command.original_wire, raw);
    assert_eq!(loaded.command.request_digest, command.request_digest);
    let record = bound
        .retained_record()
        .map_err(|e| format!("retained record:{e:?}"))?;
    assert_eq!(record.operation(), &loaded);
    assert_eq!(record.events().len(), 4);
    let receipts = bound
        .archive_receipts()
        .map_err(|e| format!("archive receipts:{e:?}"))?;
    assert_eq!(receipts.len(), 4);
    assert_eq!(std::fs::read_dir(&archive_path)?.count(), 4);
    for receipt in &receipts {
        let path = archive_path.join(receipt.name());
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(&path)?;
        assert_eq!(metadata.mode() & 0o777, 0o600);
        assert_eq!(metadata.uid(), rustix::process::geteuid().as_raw());
        let bytes = std::fs::read(path)?;
        use sha2::{Digest as _, Sha256};
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), receipt.sha256());
        let saved: Value = serde_json::from_slice(&bytes)?;
        assert_eq!(saved["format"], codec::ACTIVITY_NATIVE_ARCHIVE_CODEC_V4);
        assert_eq!(
            saved["storageCommit"],
            codec::ACTIVITY_ARCHIVE_STORAGE_COMMIT
        );
        assert_eq!(saved["writerCommit"], codec::WRITER_COMMIT);
    }
    let final_frame: Value = serde_json::from_slice(&std::fs::read(
        archive_path.join(format!("{}.4.producer.json", outcome.operation_id)),
    )?)?;
    assert_eq!(
        operation_payload(&final_frame["original"])["command"]["original_wire"],
        raw
    );
    assert_eq!(final_frame["native"][1]["raw"]["result"]["value"], response);
    assert_eq!(
        operation_payload(&final_frame["native"][1]["before"])["activityVersion"],
        "3"
    );
    assert_eq!(final_frame["physicalHold"], true);
    assert_eq!(final_frame["native"][0]["sequence"], "3");
    assert_eq!(final_frame["native"][1]["sequence"], "4");
    let native_archive = bound
        .into_retained_native()
        .map_err(|e| format!("native archive:{e:?}"))?;
    assert!(std::ptr::eq(
        native_archive.producer().original(),
        Arc::as_ptr(&original)
    ));
    assert_eq!(native_archive.native_events().len(), 2);
    assert_eq!(native_archive.native_events()[0].sequence(), 3);
    assert_eq!(native_archive.native_events()[1].sequence(), 4);
    assert_eq!(
        native_archive.native_events()[0].codec(),
        codec::ACTIVITY_DISPATCH_CODEC_V3
    );
    assert_eq!(
        native_archive.native_events()[1].codec(),
        codec::ACTIVITY_OBSERVATION_CODEC_V3
    );
    assert_eq!(native_archive.producer().record(), &record);
    drop(host);
    drop(store);
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
        json!({"fixture":"fresh-stock-activity","profile":6,"operations":count,"events":events,"bodyAccepted":accepted,"logicalHold":logical,"liabilityHold":liability,"physicalHold":held,"dispatches":1,"readbacks":1,"outcome":outcome,"database":database.display().to_string()})
    );
    Ok(())
}
