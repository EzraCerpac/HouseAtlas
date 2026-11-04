//! One generated native read through the actual AI host and stock executor.
//! Connection/inference are explicitly synthetic; no provider, credential lease,
//! native key, HTTP listener, trusted review or reviewed write is exercised.
use super::{NativeReadCatalog, NativeReadPrepared, native_read_catalog};
use crate::{
    access as a,
    ai::{
        self, AiError, Cancellation, ConnectionPort, ConnectionSnapshot, InferenceOutcome,
        InferencePort, PortFuture, ResponsesRequest, RunInput, RunLimits, RunOutcome, Usage,
        host::{
            continuation::{ExactReviewReady, HostContinuations},
            enrollment::{EnrollmentOwner, TrustedRegistration},
            native::NativeHostContext,
            service::{AiHost, HostApi, HostCommand, HostPeers},
            startup::{authority::StartupAuthority, configuration::StartupConfiguration},
            status::StatusJournal,
        },
        oauth::{RegistrationBinding, RegistrationKind},
        runner::AiCheckpoint,
        runtime::{
            AccountModels, ConnectionActionPort, ConnectionActionRequest, ConnectionActionResult,
            HumanReviewPort, HumanReviewResult, ModelsPort, ReviewInput,
        },
        stock::{STOCK_COMMAND_COUNT, STOCK_CONTRACT_VERSION, SharedStockPort},
    },
    app::{RequestPrincipal, access_scope},
    contracts::stock as wire,
    http::{Host, agents::stock_dispatch},
    lifecycle,
    transports::mcp::NativePrincipalPort,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::OpenOptionsExt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
const MODEL: &str = "synthetic-selected-model";
const REQUEST: &str = "synthetic-native-read";
const ANSWER: &str = "Synthetic canonical circuit read completed.";

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

// This deliberately supplied test readiness is not an account observation or
// runtime admission from native credentials. Only the shared read path is real.
struct SyntheticRuntime {
    command: Value,
    expected_records: Value,
    requests: Mutex<Vec<Value>>,
    received: Mutex<Vec<Value>>,
}
impl ConnectionPort<NativeHostContext> for SyntheticRuntime {
    fn check<'a>(
        &'a self,
        _: &'a NativeHostContext,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            cancel.checkpoint()?;
            assert_eq!(model, MODEL);
            Ok(ConnectionSnapshot {
                method: ai::ConnectionMethod::SignInWithChatgpt,
                permission: ai::InferencePermission::Granted,
                eligibility: ai::Eligibility::Unknown,
                authorization: ai::AuthorizationState::Connected,
                account: Some(ai::AccountDisplay {
                    account_id: "synthetic-provider-account".into(),
                    workspace_id: "synthetic-provider-workspace".into(),
                    label: "Synthetic connection peer only".into(),
                }),
                paid_use_admission: ai::PaidUseAdmission::VerifiedZeroPaidUse,
                runtime: ai::RuntimeSnapshot {
                    kind: ai::RuntimeKind::Local,
                    route: ai::RuntimeRoute::LocalInferenceCompanion,
                    qualification: ai::RuntimeQualification::Qualified,
                    availability: ai::RuntimeAvailability::Ready,
                    checked_at: None,
                },
                usage_supported: false,
            })
        })
    }
}
impl InferencePort<NativeHostContext> for SyntheticRuntime {
    fn infer<'a>(
        &'a self,
        _: &'a NativeHostContext,
        request_id: &'a str,
        request: &'a ResponsesRequest,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, InferenceOutcome> {
        Box::pin(async move {
            cancel.checkpoint()?;
            assert_eq!(request_id, REQUEST);
            let wire = serde_json::to_value(request).unwrap();
            assert_eq!(wire["model"], MODEL);
            assert_eq!(wire["store"], false);
            assert_eq!(wire["stream"], true);
            let mut requests = self.requests.lock().unwrap();
            requests.push(wire.clone());
            let output = match requests.len() {
                1 => {
                    assert!(
                        wire["tools"][0]["tools"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|tool| tool["name"] == "atlas_records")
                    );
                    vec![json!({
                        "type":"function_call", "namespace":"houseatlas",
                        "call_id":"synthetic-native-get", "name":"atlas_records",
                        "arguments":self.command.to_string()
                    })]
                }
                2 => {
                    let outputs = wire["input"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|item| item["type"] == "function_call_output")
                        .collect::<Vec<_>>();
                    assert_eq!(outputs.len(), 1);
                    assert_eq!(outputs[0]["call_id"], "synthetic-native-get");
                    let canonical: Value =
                        serde_json::from_str(outputs[0]["output"].as_str().unwrap()).unwrap();
                    assert_eq!(canonical["schemaVersion"], 3);
                    assert_eq!(canonical["requestId"], self.command["requestId"]);
                    assert_eq!(canonical["commandId"], self.command["commandId"]);
                    assert_eq!(canonical["resolvedScope"], self.command["context"]);
                    assert_eq!(canonical["status"], "read");
                    assert_eq!(canonical["replayed"], false);
                    assert_eq!(canonical["data"]["records"], self.expected_records);
                    assert_eq!(canonical["data"]["nextCursor"], Value::Null);
                    assert_eq!(canonical["data"]["sourceStatus"], "current");
                    // Validate the actual owner-issued envelope against the
                    // generated stock contract, not a test substitute result.
                    let validator = wire::StockValidation::new().unwrap();
                    let parsed =
                        wire::StockRequest::parse(&validator, self.command.clone()).unwrap();
                    wire::StockResponse::parse(&validator, &parsed, canonical.clone(), &[])
                        .unwrap();
                    self.received.lock().unwrap().push(canonical);
                    vec![json!({
                        "type":"message", "role":"assistant", "phase":"final_answer",
                        "content":[{"type":"output_text", "text":ANSWER}]
                    })]
                }
                _ => panic!("the finite synthetic inference peer must not be replayed"),
            };
            Ok(InferenceOutcome::Completed {
                output,
                usage: Usage::default(),
            })
        })
    }
}

// Any attempt to reach review, action or discovery is a failure of this read
// contract, not synthetic approval, qualification or a permissive fallback.
#[derive(Clone, Default)]
struct Never(Arc<AtomicUsize>);
macro_rules! unused_async {
    ($name:ident ($($arg:ident : $ty:ty),* $(,)?) -> $result:ty) => {
        fn $name<'a>(&'a self, $($arg: $ty),*) -> PortFuture<'a, $result> {
            $(let _ = $arg;)*
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AiError::DomainUnavailable) })
        }
    };
}
impl ExactReviewReady<NativeHostContext, NativeReadPrepared> for Never {
    fn ready(
        &self,
        _: &NativeHostContext,
        _: &AiCheckpoint<NativeReadPrepared>,
    ) -> Result<(), AiError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Err(AiError::DomainUnavailable)
    }
}
impl HumanReviewPort<NativeHostContext> for Never {
    unused_async!(
        open(
            c: &'a NativeHostContext,
            r: &'a ReviewInput,
            stop: &'a Cancellation,
        ) -> HumanReviewResult
    );
}
impl ConnectionActionPort<NativeHostContext> for Never {
    unused_async!(
        act(
            c: &'a NativeHostContext,
            r: &'a ConnectionActionRequest,
            stop: &'a Cancellation,
        ) -> ConnectionActionResult
    );
    unused_async!(
        status(
            c: &'a NativeHostContext,
            id: &'a str,
            stop: &'a Cancellation,
        ) -> ConnectionActionResult
    );
}
impl ModelsPort<NativeHostContext> for Never {
    unused_async!(discover(c: &'a NativeHostContext, stop: &'a Cancellation) -> AccountModels);
}
struct Peers {
    runtime: SyntheticRuntime,
    catalog: NativeReadCatalog,
    continuations: HostContinuations<StartupAuthority, Never, NativeReadPrepared>,
    never: Never,
}
impl HostPeers for Peers {
    type Context = NativeHostContext;
    type Connection = SyntheticRuntime;
    type Inference = SyntheticRuntime;
    type Catalog = NativeReadCatalog;
    type Continuations = HostContinuations<StartupAuthority, Never, NativeReadPrepared>;
    type Human = Never;
    type Actions = Never;
    type Models = Never;
    fn connection(&self) -> &Self::Connection {
        &self.runtime
    }
    fn inference(&self) -> &Self::Inference {
        &self.runtime
    }
    fn catalog(&self) -> &Self::Catalog {
        &self.catalog
    }
    fn continuations(&self) -> &Self::Continuations {
        &self.continuations
    }
    fn human(&self) -> &Self::Human {
        &self.never
    }
    fn actions(&self) -> &Self::Actions {
        &self.never
    }
    fn models(&self) -> &Self::Models {
        &self.never
    }
    fn selected_model(&self, _: &NativeHostContext) -> Result<String, AiError> {
        Ok(MODEL.into())
    }
}

fn evidence<'a>(
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf,
        authorization: None,
    }
}

#[tokio::test]
async fn typed_ai_request_executes_native_stock_read_and_retains_unknown_usage()
-> Result<(), lifecycle::Failure> {
    let scratch = tempfile::tempdir()?;
    let root = fs::canonicalize(scratch.path())?;
    let core = lifecycle::prepare(&root.join("fixture"), ORIGIN)?;
    let scope = access_scope(&core.home.scope)?;
    let context =
        json!({"workspaceId":scope.workspace_id.as_str(),"homeId":scope.home_id.as_str()});
    let scratch_receipt: Value =
        serde_json::from_slice(&fs::read(root.join("fixture/smoke-session.json"))?)?;
    let login_body = serde_json::to_vec(&scratch_receipt["editorLogin"])?;
    drop(scratch_receipt);
    let session = core.access.lock().unwrap().login(
        &evidence(a::Method::Post, None, None),
        &login_body,
        "synthetic-ai-native-read",
    )?;
    drop(login_body);
    let cookie = session.set_cookie().split(';').next().unwrap().to_owned();
    let editor = core.access.lock().unwrap().authorize(
        &evidence(
            a::Method::Post,
            Some(&cookie),
            Some(session.info().csrf_token()),
        ),
        &scope,
        a::Action::Mutate,
    )?;
    let target = json!({"authority":"atlas","recordType":"circuit","recordId":id(920)});
    let payload = json!({"label":null,"panel":null,"evidenceIds":[id(100)]});
    // Generate the existing circuit through the unchanged native fixture setup
    // owner before AI runs. Its data below is an independent frozen expectation.
    let created = stock_dispatch::execute(
        &core,
        &RequestPrincipal::new(editor.clone()),
        json!({
            "schemaVersion":3,"commandId":"atlas.circuit.create","requestId":id(1200),
            "context":context,"target":target,"payload":payload,"idempotencyKey":id(1300),
            "reason":"Generated AI read fixture setup",
            "preconditions":{"target":null,"guards":[{
                "target":{"authority":"atlas","recordType":"evidence","recordId":id(100)},
                "revision":{"kind":"atlas","value":1}
            }]},"approvalReceiptId":null
        }),
    )?;
    let expected_records = json!([{
        "target":target,"revision":1,"lifecycle":"active","payload":payload
    }]);
    assert_eq!(created.wire["status"], "committed");
    assert_eq!(created.wire["data"]["records"], expected_records);
    let principal = core.access.lock().unwrap().authorize(
        &evidence(a::Method::Get, Some(&cookie), None),
        &scope,
        a::Action::Read,
    )?;
    let access = Arc::clone(&core.access);
    let binding = RegistrationBinding {
        registration_id: "synthetic-existing-registration".into(),
        actor_id: principal.actor_id().as_str().into(),
        workspace_id: scope.workspace_id.as_str().into(),
        home_id: scope.home_id.as_str().into(),
        authority_epoch: "synthetic-authority".into(),
        cancellation_epoch: "synthetic-cancellation".into(),
    };
    let journal_path = root.join("ai-status.sqlite");
    let journal = StatusJournal::new(Connection::open(&journal_path)?)?;
    let enrollment = Arc::new(EnrollmentOwner::new(
        Connection::open_in_memory()?,
        Arc::clone(&access),
        journal.clone(),
    )?);
    enrollment.install_existing_approval(
        &editor,
        &TrustedRegistration::from_existing_approval(
            binding.clone(),
            RegistrationKind::LocalPublicClient,
            "Synthetic native read test".into(),
            "synthetic-test-host".into(),
        )?,
    )?;
    let config_bytes = serde_json::to_vec(&json!({
        "schemaVersion":1,"applicationOrigin":ORIGIN,"stableHostId":"synthetic-test-host",
        "appName":"Synthetic native read test",
        "credentialDirectory":root.join("unopened-credentials"),
        "registrations":[{
            "registrationId":binding.registration_id,"actorId":binding.actor_id,
            "workspaceId":binding.workspace_id,"homeId":binding.home_id,
            "authorityEpoch":binding.authority_epoch,"cancellationEpoch":binding.cancellation_epoch
        }]
    }))?;
    let config_path = root.join("synthetic-config.json");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&config_path)?;
    file.write_all(&config_bytes)?;
    drop(file);
    let configuration = Arc::new(StartupConfiguration::read_pinned(
        &config_path,
        &format!("{:x}", Sha256::digest(&config_bytes)),
    )?);
    let authority = StartupAuthority {
        access: Arc::clone(&access),
        enrollment,
        configuration,
    };
    let native = NativeHostContext::capture(
        principal,
        binding.clone(),
        &NativePrincipalPort::new(access),
    )
    .await?;
    let application = Host::new(core, ORIGIN.into(), Arc::default(), vec![])?;
    let command = json!({
        "schemaVersion":3,"commandId":"atlas.circuit.get","requestId":id(1201),
        "context":context,"target":target,"payload":{}
    });
    let never = Never::default();
    let catalog = native_read_catalog(&application, authority.clone())?;
    let canonical: Value = serde_json::from_slice(include_bytes!(
        "../../../../../contracts/stock-wire3/agent/operation-catalog.json"
    ))?;
    let projection = catalog.domain().projection(&native)?;
    assert_eq!(canonical["contractVersion"], STOCK_CONTRACT_VERSION);
    assert_eq!(projection.contract_version, STOCK_CONTRACT_VERSION);
    let canonical_commands = canonical["commands"].as_array().unwrap();
    assert_eq!(canonical_commands.len(), STOCK_COMMAND_COUNT);
    let expected_membership: BTreeSet<_> = canonical_commands
        .iter()
        .map(|command| {
            (
                command["toolFamily"].as_str().unwrap().to_owned(),
                command["commandId"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    let actual_membership: BTreeSet<_> = projection
        .families
        .iter()
        .flat_map(|family| {
            family.commands.iter().map(|command| {
                (family.family.as_str().to_owned(), command.command_id.clone())
            })
        })
        .collect();
    assert_eq!(expected_membership.len(), STOCK_COMMAND_COUNT);
    assert_eq!(actual_membership, expected_membership);
    let host = AiHost {
        peers: Peers {
            runtime: SyntheticRuntime {
                command,
                expected_records,
                requests: Mutex::default(),
                received: Mutex::default(),
            },
            catalog,
            continuations: HostContinuations::new(
                authority.clone(),
                never.clone(),
                journal.clone(),
                Duration::from_secs(60),
            )?,
            never,
        },
        authority,
        journal: journal.clone(),
        limits: RunLimits::default(),
    };
    let wire = host
        .call(
            &native,
            HostCommand::Run(RunInput {
                request_id: REQUEST.into(),
                prompt: "Read the generated circuit.".into(),
            }),
        )
        .await?;
    let outcome: RunOutcome = serde_json::from_value(wire.clone())?;
    assert_eq!(
        outcome,
        RunOutcome::Completed {
            text: ANSWER.into(),
            operation_ids: vec![],
            usage: Usage::default()
        }
    );
    assert_eq!(
        wire["usage"],
        json!({"inputTokens":null,"outputTokens":null,"totalTokens":null})
    );
    assert_eq!(host.peers.runtime.requests.lock().unwrap().len(), 2);
    assert_eq!(host.peers.runtime.received.lock().unwrap().len(), 1);
    assert_eq!(host.peers.never.0.load(Ordering::SeqCst), 0);
    let retained = json!({"status":"finished","requestId":REQUEST,"outcome":wire});
    assert_eq!(
        host.call(&native, HostCommand::Status(REQUEST.into()))
            .await?,
        retained
    );
    assert_eq!(
        serde_json::to_value(journal.read(&binding, REQUEST, true)?)?,
        retained
    );
    drop(host);
    drop(journal);
    let reopened = StatusJournal::open_existing_read_only(Connection::open_with_flags(
        &journal_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?)?;
    assert_eq!(
        serde_json::to_value(reopened.read(&binding, REQUEST, true)?)?,
        retained
    );
    assert!(!root.join("unopened-credentials").exists());
    Ok(())
}
