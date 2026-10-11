//! One positive, private synthetic quantity fixture. No socket or native write.
use super::*;
use crate::{
    access as a,
    app::{RequestPrincipal, stock_activity_principal::OriginalStockActivityPrincipal},
    domain::stock::CapturedAccess,
    providers::homebox::{read, recovery::NativeWriterContracts, wire},
    storage::StockActivityPrincipal,
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

fn id(n: u64) -> Uuid {
    Uuid::parse_str(&format!("00000000-0000-4000-8000-{n:012}")).unwrap()
}
fn aid(n: u64) -> a::CanonicalId {
    a::CanonicalId::parse(id(n).to_string()).unwrap()
}
const ORIGIN: &str = "https://atlas.synthetic.invalid";
const PASSWORD: &str = "Synthetic-test-password-only!";
const AT: &str = "2026-10-08T12:00:00.1200+02:00";
struct Clock;
impl read::Clock for Clock {
    fn now(&self) -> read::Timestamp {
        read::Timestamp::parse(AT).unwrap()
    }
}
struct Chunks(VecDeque<Vec<u8>>);
impl read::Body for Chunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, read::ReadError> {
        Ok(self.0.pop_front())
    }
}
struct FixedGet {
    scope: read::SourceScope,
    responses: VecDeque<Vec<u8>>,
    calls: Arc<Mutex<Vec<read::GetRequest>>>,
    access: Arc<Mutex<a::AccessBoundary>>,
}
impl read::Transport for FixedGet {
    type Body = Chunks;
    async fn get(
        &mut self,
        request: read::GetRequest,
    ) -> Result<read::GetResponse<Chunks>, read::ReadError> {
        // The original Access fence has been released before provider I/O.
        assert!(self.access.try_lock().is_ok());
        assert_eq!(request.method(), "GET");
        assert_eq!(request.scope(), &self.scope);
        assert_eq!(request.path(), format!("/api/v1/entities/{}", id(2)));
        assert!(request.query().is_empty());
        assert!(request.reject_redirects());
        self.calls.lock().unwrap().push(request);
        let bytes = self.responses.pop_front().unwrap();
        Ok(read::GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(bytes.chunks(7).map(|chunk| chunk.to_vec()).collect()),
        })
    }
}
fn command(contracts: &NativeWriterContracts, handle: Uuid, target: &StockTarget) -> StockCommand {
    let mut native = serde_json::to_value(target).unwrap();
    native.as_object_mut().unwrap().remove("entityId");
    native["authority"] = json!("homebox");
    contracts.validate_request(&json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set",
        "requestId":id(100),"idempotencyKey":id(101),
        "context":{"workspaceId":id(1),"homeId":id(2)},"target":native,
        "payload":{"quantity":2},"reason":"Synthetic quantity fixture",
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":handle},"atlasGuards":[]},
        "approvalReceiptId":null})).unwrap()
}
fn operation(c: &StockCommand, authority: &StockAuthority, plan: NativePlan) -> StoredOperation {
    // Supplied historical data only: no activity admission, queue or dispatch.
    StoredOperation {
        actor_id: authority.actor_id,
        captured_authority: authority.clone(),
        operation_id: id(110),
        activity_version: 1,
        command: c.clone(),
        plan: Some(plan),
        actual_target: None,
        generated_members: vec![],
        outcome: StockOutcome {
            schema_version: 3,
            command_id: c.command_id.clone(),
            request_id: c.request_id,
            operation_id: id(110),
            resolved_scope: c.context.clone(),
            request_digest: c.request_digest.clone(),
            causality_proven: false,
            atomic_provider_cas: false,
            native_editor_race_possible: true,
            known_effects: vec![],
            observed_at: AT.into(),
            response_digest: None,
            readback_digest: None,
            generated_identity_resolved: false,
            unknown_scope_fence_retained: true,
            remote_activity: RemoteActivity::end_unproven(),
            storage_liability: StorageLiability {
                accounting_complete: false,
                metadata_commit_evidence: MetadataEvidence::Unknown,
                byte_disposition: ByteDisposition::Unknown,
                reference_closure_evidence: ReferenceClosure::Unassessed,
                orphan_candidate_id: None,
                unresolved_attempts: 0,
                known_bytes: 0,
                reserved_bytes: None,
            },
            state: OutcomeState::UnknownHeld,
            verification: Verification::Unresolved,
            response_success: false,
            readback_agrees: false,
            resolution_evidence_digest: None,
            resolution_actor_id: None,
        },
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_native_quantity_capture_guard_and_readback() {
    let access_scope = a::Scope {
        workspace_id: aid(1),
        home_id: aid(2),
    };
    let registration = a::SourceRegistration {
        workspace_id: aid(1),
        home_id: aid(2),
        source_instance_id: aid(10),
        collection_id: id(4).to_string(),
        owner: a::SourceOwner::Homebox,
        partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(2).to_string(), id(1).to_string()],
    };
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec![ORIGIN.into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    boundary
        .provision_user(
            &aid(6),
            &aid(7),
            "synthetic-editor",
            &a::hash_password(PASSWORD).unwrap(),
            None,
        )
        .unwrap();
    boundary
        .set_membership(&aid(6), &access_scope, a::Role::Editor, true)
        .unwrap();
    boundary.put_source(&registration, None).unwrap();
    let mut request_evidence = a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie: None,
        csrf: None,
        authorization: None,
    };
    let session = boundary
        .login(
            &request_evidence,
            &serde_json::to_vec(&json!({"username":"synthetic-editor","password":PASSWORD}))
                .unwrap(),
            "synthetic-quantity",
        )
        .unwrap();
    request_evidence.cookie = Some(session.set_cookie().split(';').next().unwrap());
    request_evidence.csrf = Some(session.info().csrf_token());
    let request = RequestPrincipal::new(
        boundary
            .authorize(&request_evidence, &access_scope, a::Action::Mutate)
            .unwrap(),
    );
    let source_ref = a::SourceRef {
        workspace_id: aid(1),
        home_id: aid(2),
        key: a::SourceKey {
            source_instance_id: aid(10),
            collection_id: id(4).to_string(),
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: id(2).to_string(),
        },
    };
    request.capture_source(&boundary, &source_ref).unwrap();
    request
        .capture_partition(&boundary, &registration.partition())
        .unwrap();
    let source_grant = request.captured_source(&source_ref).unwrap();
    let partition_grant = request
        .captured_partition(&registration.partition())
        .unwrap();
    // Clone retains the same Arc allocation; no RequestPrincipal borrow crosses GET.
    let original = request.principal.clone();
    let principal = original.principal();
    let mut exported_metadata = None;
    boundary
        .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
            assert!(std::ptr::eq(guard.principal(), principal));
            exported_metadata = Some(guard.persisted_source_metadata(&partition_grant)?);
            Ok(())
        })
        .unwrap();
    let metadata = exported_metadata.unwrap();
    assert_eq!(metadata.registration(), &registration);
    assert_eq!(metadata.source_registration_version(), 1);
    let contracts = NativeWriterContracts::new().unwrap();
    let digest = contracts
        .digest_native(&json!({"privateSyntheticQuantity":id(7)}))
        .unwrap();
    let authority = StockAuthority {
        actor_id: id(7),
        source_epoch: 1,
        authority_digest: digest.clone(),
        physical_binding: PhysicalBinding {
            deployment_id: id(104),
            physical_database_id: id(105),
            configuration_digest: digest.clone(),
        },
        qualification: NativeQualification::SyntheticFixture,
    };
    let target = StockTarget {
        source_instance_id: id(10),
        collection_id: id(4),
        resource_kind: ResourceKind::Entity,
        resource_id: Some(id(2)),
        entity_id: None,
    };
    let profile = QuantityProfile::synthetic_fixture(QuantityProfileDescriptor {
        source_commit: NATIVE_SOURCE_COMMIT.into(),
        version: read::HOMEBOX_REFERENCE_VERSION.into(),
        build_digest: digest.clone(),
        catalog_digest: digest.clone(),
        route_digest: digest.clone(),
        group_id: "synthetic-group".into(),
        account_id: "synthetic-account".into(),
        scope: Context {
            workspace_id: id(1),
            home_id: id(2),
        },
        target: target.clone(),
        metadata: metadata.clone(),
        authority: authority.clone(),
        dispatcher_epoch: 1,
        policy_digest: digest,
        policy: QuantityPolicy::NoHuman { maximum: 2 },
        freshness: Duration::from_secs(60),
    })
    .unwrap();
    let mut exported_preview = None;
    boundary
        .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
            exported_preview = Some(
                OriginalQuantityPreview::new(
                    principal,
                    &source_grant,
                    &partition_grant,
                    &profile,
                    guard,
                )
                .unwrap(),
            );
            Ok(())
        })
        .unwrap();
    let preview = exported_preview.unwrap();
    let access = Arc::new(Mutex::new(boundary));
    let before = include_str!("../../wire/fixtures/item.detail.json")
        .replacen("\"quantity\": 1.5", "\"quantity\": 1", 1)
        .replacen("\"purchasePrice\": 0", "\"purchasePrice\": 1.2300e+2", 1)
        .replacen(
            "\"fields\": null",
            "\"fields\": null, \"nativeExtension\": 9007199254740993",
            1,
        )
        .into_bytes();
    // Synthetic post-response, supplied up front; no PATCH changes any state.
    let after = String::from_utf8(before.clone())
        .unwrap()
        .replacen("\"quantity\": 1", "\"quantity\": 2", 1)
        .into_bytes();
    let before_value: Value = serde_json::from_slice(&before).unwrap();
    let after_value: Value = serde_json::from_slice(&after).unwrap();
    let read_registration: read::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let read_scope = read_registration.scope();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let reader = Arc::new(tokio::sync::Mutex::new(
        read::HomeBoxReader::new_stock(
            read_registration,
            FixedGet {
                scope: read_scope.clone(),
                responses: [before.clone(), before.clone(), after.clone()].into(),
                calls: Arc::clone(&calls),
                access: Arc::clone(&access),
            },
            Clock,
            read::Limits::default(),
            None,
        )
        .unwrap(),
    ));
    let registry = QuantityObservationRegistry::new(&preview);
    let handle = registry.issue_observation(&reader, &access).await.unwrap();
    assert_eq!(calls.lock().unwrap().len(), 1);
    let c = command(&contracts, handle, &target);
    let owner = OriginalStockActivityPrincipal::from_captured_request(
        &request,
        &mut access.lock().unwrap(),
        &contracts,
        c.clone(),
        authority.clone(),
        &source_ref,
    )
    .unwrap();
    drop(request);
    assert!(std::ptr::eq(owner.original_activity_principal(), principal));
    assert_eq!(
        owner.original_activity_source().reference(),
        source_grant.reference()
    );
    assert_eq!(
        owner.original_activity_partition().partition(),
        partition_grant.partition()
    );
    let captured = CapturedAccess::retain_original(
        &mut access.lock().unwrap(),
        principal,
        std::slice::from_ref(&source_grant),
        std::slice::from_ref(&partition_grant),
    )
    .unwrap();
    let source =
        QuantitySource::new(&owner, &registry, Arc::clone(&reader), Arc::clone(&access)).unwrap();
    let adapter = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        source,
        wire::DecodeLimits::default(),
    );
    let pending = adapter.capture_pending(&c, &authority).await.unwrap();
    assert_eq!(calls.lock().unwrap().len(), 2);
    let mut exported_retained = None;
    access
        .lock()
        .unwrap()
        .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
            assert!(std::ptr::eq(
                guard.principal(),
                owner.original_activity_principal()
            ));
            assert_eq!(guard.persisted_source_metadata(&partition_grant)?, metadata);
            let qualification = FreshQualification::new(guard, &captured).unwrap();
            exported_retained = Some(pending.finish_in_guard(&qualification).unwrap());
            Ok(())
        })
        .unwrap();
    let retained = exported_retained.unwrap();
    let snapshot = &retained.capture().snapshots()[0];
    assert_eq!(snapshot.original().original, before);
    assert_eq!(snapshot.original().scope, read_scope);
    assert_eq!(snapshot.original().target, target);
    assert_eq!(snapshot.original().observed_at, AT);
    assert_eq!(snapshot.source(), &before_value);
    assert_eq!(snapshot.source()["quantity"], 1);
    assert_eq!(snapshot.source()["purchasePrice"].to_string(), "1.2300e+2");
    assert_eq!(
        snapshot.source()["nativeExtension"].to_string(),
        "9007199254740993"
    );
    assert_eq!(
        snapshot.source()["updatedAt"],
        "2026-01-02T03:04:05.1200+02:00"
    );
    let retained_address = snapshot.original().original.as_ptr();
    let retained_plan = retained.plan().clone();
    assert_eq!(retained_plan.request.method, NativeMethod::Patch);
    assert_eq!(
        retained_plan.request.path,
        format!("/api/v1/entities/{}", id(2))
    );
    assert!(retained_plan.request.query.is_empty());
    let NativeBody::Json(body) = &retained_plan.request.body else {
        panic!("quantity JSON")
    };
    assert_eq!(body, &json!({"quantity":2}));
    for _ in 0..3 {
        access
            .lock()
            .unwrap()
            .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
                assert_eq!(guard.persisted_source_metadata(&partition_grant)?, metadata);
                retained
                    .revalidate_in_guard(
                        &FreshQualification::new(guard, &captured).unwrap(),
                        &c,
                        &authority,
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();
        assert_eq!(
            retained.capture().snapshots()[0]
                .original()
                .original
                .as_ptr(),
            retained_address
        );
        assert_eq!(retained.plan(), &retained_plan);
    }
    assert_eq!(calls.lock().unwrap().len(), 2);
    let historical = operation(&c, &authority, retained_plan.clone());
    let readback = DecodedStockReadback::new(
        NativeWriterContracts::new().unwrap(),
        QuantitySource::new(&owner, &registry, Arc::clone(&reader), Arc::clone(&access)).unwrap(),
        wire::DecodeLimits::default(),
    );
    let pending_readback = readback
        .capture_pending(&historical, &retained_plan.readback, &authority)
        .await
        .unwrap();
    let mut exported_readback = None;
    access
        .lock()
        .unwrap()
        .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
            assert!(std::ptr::eq(
                guard.principal(),
                owner.original_activity_principal()
            ));
            assert_eq!(guard.persisted_source_metadata(&partition_grant)?, metadata);
            exported_readback = Some(
                pending_readback
                    .finish_in_guard(&FreshQualification::new(guard, &captured).unwrap())
                    .unwrap(),
            );
            Ok(())
        })
        .unwrap();
    let NativeObservation::Present {
        value,
        target: observed_target,
        context,
        observed_at,
        complete,
        impact,
    } = exported_readback.unwrap()
    else {
        panic!("qualified quantity readback")
    };
    assert_eq!(value, after_value);
    assert_eq!(value["quantity"], 2);
    assert_eq!(value["purchasePrice"].to_string(), "1.2300e+2");
    assert_eq!(value["nativeExtension"].to_string(), "9007199254740993");
    assert_eq!(value["updatedAt"], before_value["updatedAt"]);
    assert_eq!(observed_target, target);
    assert_eq!(context, c.context);
    assert_eq!(observed_at, AT);
    assert!(complete);
    assert!(impact.is_none());
    assert_eq!(historical.plan, Some(retained_plan));
    assert!(!historical.outcome.causality_proven);
    assert!(!historical.outcome.atomic_provider_cas);
    let observed = calls.lock().unwrap();
    assert_eq!(observed.len(), 3);
    for call in observed.iter() {
        assert_eq!(call.method(), "GET");
        assert_eq!(call.path(), format!("/api/v1/entities/{}", id(2)));
        assert!(call.query().is_empty());
        assert_eq!(call.scope(), &read_scope);
    }
}
