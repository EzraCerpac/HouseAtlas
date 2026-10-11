//! Positive capture of explicit installation artifacts and original native custody.
//! No socket, native write, queue execution or activity admission.
use super::*;
use crate::{
    access as a,
    app::{RequestPrincipal, stock_activity_principal::OriginalStockActivityPrincipal},
    config::providers::quantity_installation::{
        QuantityInstallationArtifacts, QuantityInstallationInput,
    },
    domain::stock::CapturedAccess,
    http::contracts::NativeContracts,
    jobs as j,
    providers::homebox::{read, recovery::NativeWriterContracts, wire},
    storage as s,
    storage::StockActivityPrincipal,
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
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

fn digest_bytes(bytes: &[u8]) -> Digest {
    use sha2::{Digest as _, Sha256};
    Digest::parse(format!("{:x}", Sha256::digest(bytes))).unwrap()
}
fn digest_value(value: &Value) -> Digest {
    Digest::parse(crate::contracts::semantics::canonical_digest(value).unwrap()).unwrap()
}
const REPO_PATH: &str = "backend/internal/data/repo/repo_entities.go";
const HANDLER_PATH: &str = "backend/app/api/handlers/v1/v1_ctrl_entities.go";
const SWAGGER_PATH: &str = "backend/app/api/static/docs/swagger.json";

// The caller explicitly supplies downloaded public source references. This
// helper never downloads anything and absence fails the named positive test.
fn reference_artifacts(root: &Path) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let bytes = ["repo_entities.go", "v1_ctrl_entities.go", "swagger.json"]
        .map(|name| std::fs::read(root.join(name)).unwrap());
    assert_eq!(bytes[0].len(), 87660);
    assert_eq!(
        digest_bytes(&bytes[0]).as_str(),
        "56758719661cf36f2799879656519589a7a89b5dcc66341f1abcb7a43cf353d8"
    );
    assert_eq!(bytes[1].len(), 19776);
    assert_eq!(
        digest_bytes(&bytes[1]).as_str(),
        "4e8064b6dd63fdbdd65e466a470aaef44838d7e23fb10ba3fe0764a2a65d29d4"
    );
    assert_eq!(bytes[2].len(), 216647);
    assert_eq!(
        digest_bytes(&bytes[2]).as_str(),
        "5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493"
    );
    let [repository, handler, swagger] = bytes;
    (repository, handler, swagger)
}
#[tokio::test(flavor = "current_thread")]
async fn healthy_native_quantity_installation_capture_guard_and_readback() {
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
    let reference_root = PathBuf::from(
        std::env::var_os("HOUSEATLAS_QUANTITY_REFERENCE_DIR")
            .expect("explicit public pinned reference directory is required"),
    );
    assert!(reference_root.is_absolute());
    let (repository_bytes, handler_bytes, swagger_bytes) = reference_artifacts(&reference_root);
    let directory = tempfile::tempdir().unwrap();
    let fixture_root = std::fs::canonicalize(directory.path()).unwrap();
    let artifact_root = fixture_root.join("artifacts");
    std::fs::create_dir(&artifact_root).unwrap();
    // Deliberately supplied synthetic executable bytes; never executed. Public
    // pinned Go and Swagger bytes are actual files captured by the normal owner.
    let executable_bytes = b"Synthetic quantity executable fixture bytes, never executed.\n";
    let executable_path = artifact_root.join("homebox.fixture");
    let provenance_path = artifact_root.join("build-provenance.json");
    let repository_path = artifact_root.join("repo_entities.go");
    let handler_path = artifact_root.join("v1_ctrl_entities.go");
    let swagger_path = artifact_root.join("swagger.json");
    std::fs::write(&executable_path, executable_bytes).unwrap();
    std::fs::write(&repository_path, &repository_bytes).unwrap();
    std::fs::write(&handler_path, &handler_bytes).unwrap();
    std::fs::write(&swagger_path, &swagger_bytes).unwrap();
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../../../../contracts/stock-wire3/agent/operation-catalog.json"
    ))
    .unwrap();
    let routes: Value = serde_json::from_slice(&swagger_bytes).unwrap();
    let catalog_digest = digest_value(&catalog);
    let route_digest = digest_value(&routes);
    let build_digest = digest_bytes(executable_bytes);
    let configuration_digest = digest_value(&json!({"syntheticPhysicalConfiguration":id(4)}));
    let physical_binding = PhysicalBinding {
        deployment_id: id(104),
        physical_database_id: id(105),
        configuration_digest: configuration_digest.clone(),
    };
    let target = StockTarget {
        source_instance_id: id(10),
        collection_id: id(4),
        resource_kind: ResourceKind::Entity,
        resource_id: Some(id(2)),
        entity_id: None,
    };
    let context = Context {
        workspace_id: id(1),
        home_id: id(2),
    };
    let reviewed_policy = json!({"policyId":"synthetic-explicit-quantity-policy", "policyVersion":1,"policyEpoch":1,
        "actorId":id(7),"context":context,"target":target,"accountId":"synthetic-account","groupId":"synthetic-group",
        "physicalBinding":{"deploymentId":id(104),"physicalDatabaseId":id(105),"configurationDigest":configuration_digest},
        "dispatcherOwnerId":id(106),"dispatcherEpoch":1,"sourceEpoch":1,"approvalRequirement":"no-human",
        "maximum":2,"freshnessMillis":60000});
    let policy_digest = digest_value(&reviewed_policy);
    let authority = StockAuthority {
        actor_id: id(7),
        source_epoch: 1,
        authority_digest: policy_digest.clone(),
        physical_binding: physical_binding.clone(),
        qualification: NativeQualification::Qualified {
            catalog_digest: catalog_digest.clone(),
            registered_build_digest: build_digest.clone(),
            route_qualification_digest: route_digest.clone(),
        },
    };
    let descriptor = QuantityProfileDescriptor {
        source_commit: NATIVE_SOURCE_COMMIT.into(),
        version: read::HOMEBOX_REFERENCE_VERSION.into(),
        build_digest: build_digest.clone(),
        catalog_digest,
        route_digest,
        group_id: "synthetic-group".into(),
        account_id: "synthetic-account".into(),
        scope: context.clone(),
        target: target.clone(),
        metadata: metadata.clone(),
        authority: authority.clone(),
        dispatcher_epoch: 1,
        policy_digest,
        policy: QuantityPolicy::NoHuman { maximum: 2 },
        freshness: Duration::from_secs(60),
    };
    let provenance = json!({"schemaVersion":1,"release":read::HOMEBOX_REFERENCE_VERSION,"sourceCommit":NATIVE_SOURCE_COMMIT,
        "executableSha256":build_digest,"sourceArtifacts":[
            {"path":REPO_PATH,"sha256":digest_bytes(&repository_bytes),"bytes":repository_bytes.len()},
            {"path":HANDLER_PATH,"sha256":digest_bytes(&handler_bytes),"bytes":handler_bytes.len()},
            {"path":SWAGGER_PATH,"sha256":digest_bytes(&swagger_bytes),"bytes":swagger_bytes.len()}],
        "customPatches":[],"reviewedQuantityPolicy":reviewed_policy});
    let provenance_bytes = serde_json::to_vec(&provenance).unwrap();
    std::fs::write(&provenance_path, &provenance_bytes).unwrap();
    let queue = j::QueueConfig {
        lease_duration_ms: 1000,
        retry: j::RetryPolicy {
            max_attempts: 1,
            initial_delay_ms: 1,
            max_delay_ms: 1,
        },
        registration: j::QueueRegistration {
            identity: j::PhysicalQueueIdentity {
                deployment_id: id(104).to_string(),
                physical_database_id: id(105).to_string(),
                configuration_digest: j::Digest::from_hex(configuration_digest.as_str().into())
                    .unwrap(),
            },
            dispatcher_owner_id: id(106).to_string(),
            aliases: vec![j::SourceAlias {
                partition: j::SourcePartition {
                    workspace_id: id(1).to_string(),
                    home_id: id(2).to_string(),
                    source_instance_id: id(10).to_string(),
                    collection_id: id(4).to_string(),
                },
                canonical_collection_id: id(4).to_string(),
            }],
        },
        admission_profile: j::AdmissionProfile::stock_engineering_fixture(),
    };
    queue.validate().unwrap();
    let physical = s::StockActivityPhysicalRegistration {
        physical_binding: physical_binding.clone(),
        owner_id: id(106),
        dispatcher_epoch: 1,
    };
    let access = Arc::new(Mutex::new(boundary));
    let vault =
        Arc::new(crate::media::AssetVault::open(&fixture_root.join("empty-vault")).unwrap());
    let database = fixture_root.join("native-store.sqlite");
    let store = s::AtlasStore::open(
        &database,
        NativeContracts,
        crate::app::ReadAuthority(Arc::clone(&access)),
        crate::media::native::NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: crate::app::ServerRuntime,
        },
        s::StoreOptions {
            stock_activity_profile: true,
            ..s::StoreOptions::default()
        },
    )
    .unwrap();
    // Explicit trusted synthetic startup rows on this disposable empty native
    // Store. This is setup data, before observations; it invokes no registration
    // callback, queue session, admission, reservation or activity transition.
    install_startup_rows(&database, &queue, &physical);
    let home = crate::domain::HomeSummary {
        scope: crate::domain::Scope {
            workspace_id: id(1).to_string(),
            home_id: id(2).to_string(),
        },
        label: "Synthetic home".into(),
    };
    let core = crate::app::Core {
        access: Arc::clone(&access),
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: crate::domain::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::new(
            crate::media::recovery_policy::MediaPolicyEvidence::default(),
        ),
        vault,
        home: home.clone(),
        homes: vec![home],
    };
    let durable_registration: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let registry_config =
        crate::config::providers::registry::ProviderRegistry::from_trusted_configuration(vec![
            durable_registration.clone(),
        ])
        .unwrap();
    let configured_source = Arc::clone(registry_config.find(&registration.partition()).unwrap());
    let homebox = Arc::new(
        crate::config::providers::homebox::TrustedHomeBoxSource::new_stock(
            "https://homebox.synthetic.invalid",
            durable_registration,
            read::Limits::default(),
            None,
        )
        .unwrap(),
    );
    let credentials = Arc::new(
        read::NativeReadCredentialConfig::from_trusted_header(
            &homebox.endpoint().unwrap(),
            b"Bearer synthetic-fixture-only".to_vec(),
        )
        .unwrap(),
    );
    let configured = core
        .quantity_installation_configuration(
            configured_source,
            homebox,
            credentials,
            QuantityInstallationInput {
                descriptor,
                artifacts: QuantityInstallationArtifacts::new(
                    executable_path,
                    provenance_path,
                    repository_path,
                    handler_path,
                    swagger_path,
                )
                .unwrap(),
                reviewed_policy: reviewed_policy.clone(),
                queue: queue.clone(),
                physical: physical.clone(),
            },
        )
        .unwrap();
    let installation = NativeQuantityInstallationOwner::capture_configured(&configured).unwrap();
    assert_eq!(installation.executable_bytes(), executable_bytes);
    assert_eq!(installation.build_provenance_bytes(), provenance_bytes);
    assert_eq!(installation.entity_repository_bytes(), repository_bytes);
    assert_eq!(installation.entity_handler_bytes(), handler_bytes);
    assert_eq!(installation.swagger_bytes(), swagger_bytes);
    let profile = installation.profile().unwrap();
    let mut exported_preview = None;
    access
        .lock()
        .unwrap()
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
    let before = include_str!("../../wire/fixtures/item.detail.json")
        .replacen("\"quantity\": 1.5", "\"quantity\": 1", 1)
        .replacen("\"purchasePrice\": 0", "\"purchasePrice\": 1.2300e+2", 1)
        .replacen(
            "\"fields\": null",
            "\"fields\": null, \"nativeExtension\": 9007199254740993",
            1,
        )
        .into_bytes();
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
    // Only the transport is test-injected; installation/profile/artifact and
    // actual root/Access/Store producers above use their normal constructors.
    let installed_reader = installation.fixture_reader(&preview, reader).unwrap();
    let registry = QuantityObservationRegistry::new(&preview);
    let handle = registry
        .issue_installed_observation(&installed_reader)
        .await
        .unwrap();
    assert_eq!(calls.lock().unwrap().len(), 1);
    let contracts = NativeWriterContracts::new().unwrap();
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
    let captured = CapturedAccess::retain_original(
        &mut access.lock().unwrap(),
        principal,
        std::slice::from_ref(&source_grant),
        std::slice::from_ref(&partition_grant),
    )
    .unwrap();
    let source = QuantitySource::from_installed(&owner, &registry, &installed_reader).unwrap();
    let adapter = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        source,
        wire::DecodeLimits::default(),
    );
    let pending = adapter.capture_pending(&c, &authority).await.unwrap();
    assert_eq!(calls.lock().unwrap().len(), 2);
    let mut exported_retained = None;
    {
        let mut actual_store = core.store.lock().unwrap();
        access
            .lock()
            .unwrap()
            .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
                let physical_observation = configured
                    .observe_original(&mut actual_store, &owner, guard)
                    .unwrap();
                assert!(std::ptr::eq(
                    physical_observation.observation().original(),
                    &owner
                ));
                assert_eq!(
                    physical_observation.observation().source_metadata(),
                    &metadata
                );
                assert_eq!(physical_observation.observation().registration(), &physical);
                assert!(
                    configured
                        .store_identity()
                        .matches_observation(physical_observation.observation())
                );
                let qualification = FreshQualification::with_quantity_installation(
                    guard,
                    &captured,
                    &physical_observation,
                )
                .unwrap();
                exported_retained = Some(pending.finish_in_guard(&qualification).unwrap());
                Ok(())
            })
            .unwrap();
    }
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
    let plan = retained.plan().clone();
    assert_eq!(plan.request.method, NativeMethod::Patch);
    assert_eq!(plan.request.path, format!("/api/v1/entities/{}", id(2)));
    assert!(plan.request.query.is_empty());
    let NativeBody::Json(body) = &plan.request.body else {
        panic!("quantity JSON")
    };
    assert_eq!(body, &json!({"quantity":2}));
    for _ in 0..3 {
        let mut actual_store = core.store.lock().unwrap();
        access
            .lock()
            .unwrap()
            .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
                let physical_observation = configured
                    .observe_original(&mut actual_store, &owner, guard)
                    .unwrap();
                let qualification = FreshQualification::with_quantity_installation(
                    guard,
                    &captured,
                    &physical_observation,
                )
                .unwrap();
                retained
                    .revalidate_in_guard(&qualification, &c, &authority)
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
        assert_eq!(retained.plan(), &plan);
    }
    assert_eq!(calls.lock().unwrap().len(), 2);
    let historical = operation(&c, &authority, plan.clone());
    let readback = DecodedStockReadback::new(
        NativeWriterContracts::new().unwrap(),
        QuantitySource::from_installed(&owner, &registry, &installed_reader).unwrap(),
        wire::DecodeLimits::default(),
    );
    let pending_readback = readback
        .capture_pending(&historical, &plan.readback, &authority)
        .await
        .unwrap();
    let mut exported_readback = None;
    {
        let mut actual_store = core.store.lock().unwrap();
        access
            .lock()
            .unwrap()
            .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
                let physical_observation = configured
                    .observe_original(&mut actual_store, &owner, guard)
                    .unwrap();
                let qualification = FreshQualification::with_quantity_installation(
                    guard,
                    &captured,
                    &physical_observation,
                )
                .unwrap();
                exported_readback = Some(pending_readback.finish_in_guard(&qualification).unwrap());
                Ok(())
            })
            .unwrap();
    }
    let NativeObservation::Present {
        value,
        target: observed_target,
        context: observed_context,
        observed_at,
        complete,
        impact,
    } = exported_readback.unwrap()
    else {
        panic!("installed quantity readback")
    };
    assert_eq!(value, after_value);
    assert_eq!(value["quantity"], 2);
    assert_eq!(value["purchasePrice"].to_string(), "1.2300e+2");
    assert_eq!(value["nativeExtension"].to_string(), "9007199254740993");
    assert_eq!(value["updatedAt"], before_value["updatedAt"]);
    assert_eq!(observed_target, target);
    assert_eq!(observed_context, context);
    assert_eq!(observed_at, AT);
    assert!(complete);
    assert!(impact.is_none());
    assert_eq!(historical.plan, Some(plan));
    assert!(!historical.outcome.causality_proven);
    assert!(!historical.outcome.atomic_provider_cas);
    assert_eq!(calls.lock().unwrap().len(), 3);
    // Read-only installation/capture phases created no queue or activity entry.
    let audit = rusqlite::Connection::open(&database).unwrap();
    let entries:i64 = audit.query_row("SELECT (SELECT count(*) FROM queue_jobs)+(SELECT count(*) FROM stock_activity_operations)",[],|row| row.get(0)).unwrap();
    assert_eq!(entries, 0);
}

fn install_startup_rows(
    database: &Path,
    queue: &j::QueueConfig,
    physical: &s::StockActivityPhysicalRegistration,
) {
    let profile = &queue.admission_profile;
    let registration = &queue.registration;
    let config = json!({"lease":queue.lease_duration_ms.to_string(),"retry":{"maxAttempts":queue.retry.max_attempts,
        "initial":queue.retry.initial_delay_ms.to_string(),"max":queue.retry.max_delay_ms.to_string()},
        "identity":{"deployment":registration.identity.deployment_id,"physical":registration.identity.physical_database_id,
        "digest":registration.identity.configuration_digest.as_hex()},"owner":registration.dispatcher_owner_id,
        "aliases":registration.aliases.iter().map(|alias| json!({"workspace":alias.partition.workspace_id,
            "home":alias.partition.home_id,"source":alias.partition.source_instance_id,"collection":alias.partition.collection_id,
            "canonical":alias.canonical_collection_id})).collect::<Vec<_>>(),
        "profile":{"version":profile.profile_version,"qualification":{"kind":"offline"},"waiting":profile.max_waiting_intents,
            "waitMs":profile.max_admission_wait_ms.to_string(),"attempts":profile.max_unresolved_storage_attempts,
            "bytes":profile.max_unresolved_storage_bytes.to_string()}});
    let mut db = rusqlite::Connection::open(database).unwrap();
    let tx = db.transaction().unwrap();
    tx.execute("INSERT INTO queue_physical(deployment_id,physical_database_id,configuration_digest,configuration_json,owner_id,next_sequence,fence) VALUES(?1,?2,?3,?4,?5,'0','0')",
        rusqlite::params![registration.identity.deployment_id,registration.identity.physical_database_id,
            registration.identity.configuration_digest.as_hex(),serde_json::to_string(&config).unwrap(),registration.dispatcher_owner_id]).unwrap();
    for alias in &registration.aliases {
        tx.execute(
            "INSERT INTO queue_aliases VALUES(?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                registration.identity.deployment_id,
                registration.identity.physical_database_id,
                alias.partition.workspace_id,
                alias.partition.home_id,
                alias.partition.source_instance_id,
                alias.partition.collection_id,
                alias.canonical_collection_id
            ],
        )
        .unwrap();
    }
    tx.execute(
        "INSERT INTO stock_activity_physical VALUES(?1,?2,?3,?4,?5,NULL)",
        rusqlite::params![
            physical.physical_binding.physical_database_id.to_string(),
            physical.physical_binding.deployment_id.to_string(),
            physical.physical_binding.configuration_digest.as_str(),
            physical.owner_id.to_string(),
            physical.dispatcher_epoch.to_string()
        ],
    )
    .unwrap();
    tx.commit().unwrap();
}
