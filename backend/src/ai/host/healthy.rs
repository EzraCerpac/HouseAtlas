//! Healthy disposable protocol example. All account/security/encryption and
//! enrollment peers below are explicit synthetic stubs. No live account/token,
//! service/inference, reviewed write or stopped control is exercised.
#[path = "healthy_verification.rs"]
mod healthy_verification;
use axum::http::request::Parts;
use houseatlas_backend::ai::{
    self, AiError, Cancellation, ConnectionPort, ConnectionSnapshot, DomainCatalog, PortFuture,
    ReviewContinuationPort, ToolCall, ToolDescriptor, ToolEffect,
    host::{
        HostAuthority,
        bridge::BridgeAdmission,
        continuation::{ExactReviewReady, HostContinuations},
        http::{self, ApplicationHttpAuthority, BridgeHttpGate, MountedHost},
        lifecycle::{LifecycleEnvironment, LifecycleHost},
        models::{HttpAccountModels, ModelLease, ModelSession},
        service::{AiHost, HostPeers},
        status::StatusJournal,
        transport::{
            HttpResponses, HttpTarget, InferenceLease, InferenceSession, SYNTHETIC_BEARER,
        },
    },
    oauth::{self, ProtectedValue, RegistrationBinding},
    runner::AiCheckpoint,
    runtime::{self, HumanReviewPort},
    stock::{DomainDispatch, ReviewChallenge},
    transport::{ResponsesAdapter, TransportLimits},
};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

#[derive(Clone, Default)]
struct Synthetic {
    retained_attempts: Arc<Mutex<usize>>,
    rotated: Arc<AtomicBool>,
    releases: Arc<AtomicUsize>,
    receipt_releases: Arc<AtomicUsize>,
    retired_handles: Arc<AtomicUsize>,
    observations: Arc<AtomicUsize>,
    disconnect_displays: Arc<AtomicUsize>,
    expect_stopped_display: bool,
}
impl Synthetic {
    fn current_binding(&self) -> RegistrationBinding {
        let mut current = binding();
        if self.rotated.load(Ordering::SeqCst) {
            current.cancellation_epoch = "synthetic-cancel-epoch-next".into();
        }
        current
    }
}
fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-registration".into(),
        actor_id: "synthetic-actor".into(),
        workspace_id: "synthetic-workspace".into(),
        home_id: "synthetic-home".into(),
        authority_epoch: "synthetic-authority-epoch".into(),
        cancellation_epoch: "synthetic-cancel-epoch".into(),
    }
}
fn snapshot(ready: bool) -> ConnectionSnapshot {
    ConnectionSnapshot {
        method: ai::ConnectionMethod::SignInWithChatgpt,
        permission: if ready {
            ai::InferencePermission::Granted
        } else {
            ai::InferencePermission::Unknown
        },
        eligibility: if ready {
            ai::Eligibility::Eligible
        } else {
            ai::Eligibility::Unknown
        },
        authorization: if ready {
            ai::AuthorizationState::Connected
        } else {
            ai::AuthorizationState::Unconfigured
        },
        account: ready.then(|| ai::AccountDisplay {
            account_id: "synthetic-account".into(),
            workspace_id: "synthetic-workspace".into(),
            label: "Synthetic account".into(),
        }),
        paid_use_admission: if ready {
            ai::PaidUseAdmission::VerifiedZeroPaidUse
        } else {
            ai::PaidUseAdmission::Held
        },
        runtime: ai::RuntimeSnapshot {
            kind: ai::RuntimeKind::Local,
            route: ai::RuntimeRoute::LocalInferenceCompanion,
            qualification: if ready {
                ai::RuntimeQualification::Qualified
            } else {
                ai::RuntimeQualification::Held
            },
            availability: if ready {
                ai::RuntimeAvailability::Ready
            } else {
                ai::RuntimeAvailability::Unknown
            },
            checked_at: None,
        },
        usage_supported: true,
    }
}
impl HostAuthority<()> for Synthetic {
    fn binding(&self, _: &()) -> Result<RegistrationBinding, AiError> {
        Ok(self.current_binding())
    }
    fn revalidate(&self, _: &(), b: &RegistrationBinding) -> Result<(), AiError> {
        if b == &self.current_binding() {
            Ok(())
        } else {
            Err(AiError::ConnectionUnavailable)
        }
    }
    fn revalidate_action_receipt(&self, _: &(), b: &RegistrationBinding) -> Result<(), AiError> {
        let current = self.current_binding();
        assert_eq!(b.actor_id, current.actor_id);
        assert_eq!(b.workspace_id, current.workspace_id);
        assert_eq!(b.home_id, current.home_id);
        assert_eq!(b.registration_id, current.registration_id);
        assert_eq!(b.authority_epoch, current.authority_epoch);
        Ok(())
    }
}
impl ConnectionPort<()> for Synthetic {
    fn check<'a>(
        &'a self,
        _: &'a (),
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            cancel.checkpoint()?;
            assert_eq!(model, "synthetic-model");
            Ok(snapshot(true))
        })
    }
}
struct Lease {
    token: ProtectedValue,
    binding: RegistrationBinding,
    snapshot: ConnectionSnapshot,
}
impl InferenceLease for Lease {
    fn bearer(&self) -> &ProtectedValue {
        &self.token
    }
    fn binding(&self) -> &RegistrationBinding {
        &self.binding
    }
    fn snapshot(&self) -> &ConnectionSnapshot {
        &self.snapshot
    }
}
impl ModelLease for Lease {
    fn bearer(&self) -> &ProtectedValue {
        &self.token
    }
    fn binding(&self) -> &RegistrationBinding {
        &self.binding
    }
}
fn synthetic_lease() -> Result<Lease, AiError> {
    Ok(Lease {
        token: ProtectedValue::from_trusted_adapter(SYNTHETIC_BEARER.into())?,
        binding: binding(),
        snapshot: snapshot(true),
    })
}
impl InferenceSession<()> for Synthetic {
    type Lease = Lease;
    fn acquire<'a>(
        &'a self,
        _: &'a (),
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Lease> {
        Box::pin(async move {
            cancel.checkpoint()?;
            assert_eq!(model, "synthetic-model");
            synthetic_lease()
        })
    }
    fn revalidate<'a>(
        &'a self,
        _: &'a (),
        lease: &'a Lease,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            cancel.checkpoint()?;
            assert_eq!(lease.binding, binding());
            Ok(())
        })
    }
}
impl ModelSession<()> for Synthetic {
    type Lease = Lease;
    fn acquire_models<'a>(&'a self, _: &'a (), cancel: &'a Cancellation) -> PortFuture<'a, Lease> {
        Box::pin(async move {
            cancel.checkpoint()?;
            synthetic_lease()
        })
    }
    fn revalidate_models<'a>(
        &'a self,
        context: &'a (),
        lease: &'a Lease,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ()> {
        InferenceSession::revalidate(self, context, lease, cancel)
    }
}
struct SyntheticPrepared(Arc<AtomicUsize>);
impl Drop for SyntheticPrepared {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
impl DomainCatalog<()> for Synthetic {
    type Prepared = SyntheticPrepared;
    fn tools(&self, _: &()) -> Result<Vec<ToolDescriptor>, AiError> {
        Ok(vec![])
    }
    fn prepare(&self, _: &(), _: &ToolCall) -> Result<SyntheticPrepared, AiError> {
        Err(AiError::DomainUnavailable)
    }
    fn effect(&self, _: &SyntheticPrepared) -> ToolEffect {
        ToolEffect::Read
    }
    fn review<'a>(
        &'a self,
        _: &'a (),
        _: &'a SyntheticPrepared,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
    fn execute_read<'a>(
        &'a self,
        _: &'a (),
        _: &'a SyntheticPrepared,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Value> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
    fn execute_reviewed<'a>(
        &'a self,
        _: &'a (),
        _: &'a SyntheticPrepared,
        _: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
}
impl ExactReviewReady<(), SyntheticPrepared> for Synthetic {
    fn ready(&self, _: &(), _: &AiCheckpoint<SyntheticPrepared>) -> Result<(), AiError> {
        Err(AiError::DomainUnavailable)
    }
}
impl HumanReviewPort<()> for Synthetic {
    fn open<'a>(
        &'a self,
        _: &'a (),
        _: &'a runtime::ReviewInput,
        _: &'a Cancellation,
    ) -> PortFuture<'a, runtime::HumanReviewResult> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
}
impl ApplicationHttpAuthority for Synthetic {
    type Context = ();
    fn capture<'a>(&'a self, head: &'a Parts, mutating: bool) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(head.headers["cookie"], "synthetic-session=fixture");
            if mutating {
                assert_eq!(head.headers["x-atlas-csrf"], "synthetic-csrf");
            }
            Ok(())
        })
    }
    fn release(&self, _: &()) -> Result<(), AiError> {
        self.releases.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn release_after_disconnect(&self, _: &()) -> Result<(), AiError> {
        assert!(self.rotated.load(Ordering::SeqCst));
        self.receipt_releases.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
impl oauth::SecurityPort for Synthetic {
    fn fresh<'a>(&'a self) -> PortFuture<'a, oauth::FreshAuthorization> {
        Box::pin(async {
            Ok(oauth::FreshAuthorization {
                state: ProtectedValue::from_trusted_adapter("s".repeat(43))?,
                nonce: ProtectedValue::from_trusted_adapter("n".repeat(43))?,
                verifier: ProtectedValue::from_trusted_adapter("v".repeat(43))?,
                s256_challenge: "c".repeat(43),
            })
        })
    }
    fn state_matches(&self, _: &ProtectedValue, _: &str) -> bool {
        false
    }
    fn validate_website_callback(&self, _: &str, _: &str) -> Result<(), AiError> {
        Err(AiError::ConnectionUnavailable)
    }
    fn verify_identity<'a>(
        &'a self,
        _: &'a ProtectedValue,
        _: oauth::IdentityRequirements<'a>,
    ) -> PortFuture<'a, oauth::IdentityValidation> {
        Box::pin(async { Err(AiError::ConnectionUnavailable) })
    }
}
impl oauth::OAuthProviderPort for Synthetic {
    fn exchange<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: oauth::CodeExchange<'a>,
    ) -> PortFuture<'a, oauth::ProviderTokens> {
        Box::pin(async { Err(AiError::ConnectionUnavailable) })
    }
    fn refresh<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: oauth::RefreshGrant<'a>,
    ) -> PortFuture<'a, oauth::ProviderTokens> {
        Box::pin(async { Err(AiError::ConnectionUnavailable) })
    }
    fn revoke<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: &'a str,
        _: &'a ProtectedValue,
    ) -> PortFuture<'a, oauth::ProviderRevocation> {
        Box::pin(async { Err(AiError::ConnectionUnavailable) })
    }
}
impl oauth::CredentialBoundary<()> for Synthetic {
    type Lease = ();
    fn acquire<'a>(&'a self, _: &'a (), _: &'a RegistrationBinding) -> PortFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    fn load<'a>(&'a self, _: &'a ()) -> PortFuture<'a, oauth::RegistrationRecord> {
        Box::pin(async {
            Ok(oauth::RegistrationRecord {
                binding: binding(),
                kind: oauth::RegistrationKind::LocalPublicClient,
                app_name: "Synthetic HouseAtlas".into(),
                stable_host_id: "synthetic-host".into(),
                issued_client_id: None,
                identity: None,
                credentials: None,
                pending_authorization: None,
                refresh_checkpoint: oauth::RefreshCheckpoint::None,
                state: oauth::LifecycleState::Disconnected,
                revocation: oauth::RevocationState::NotRequested,
            })
        })
    }
    fn persist_atomic<'a>(
        &'a self,
        _: &'a mut (),
        record: &'a oauth::RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            if record.pending_authorization.is_some() {
                *self.retained_attempts.lock().unwrap() += 1;
            } else {
                assert_eq!(record.state, oauth::LifecycleState::Disconnected);
                assert!(record.credentials.is_none());
                assert!(self.rotated.load(Ordering::SeqCst));
            }
            Ok(())
        })
    }
    fn revalidate<'a>(
        &'a self,
        _: &'a (),
        _: &'a (),
        b: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(b, &binding());
            Ok(())
        })
    }
    fn stop_use<'a>(&'a self, _: &'a mut ()) -> PortFuture<'a, ()> {
        Box::pin(async move {
            self.rotated.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        Ok(1_700_000_000_000)
    }
}
impl LifecycleEnvironment<()> for Synthetic {
    fn select_candidate(&self, _: &(), route: ai::RuntimeRoute) -> Result<(), AiError> {
        assert_eq!(route, ai::RuntimeRoute::LocalSignInHelper);
        Ok(())
    }
    fn callback_selection(&self, _: &()) -> Result<oauth::CallbackSelection, AiError> {
        Ok(oauth::CallbackSelection::AvailableLoopbackPort(
            std::num::NonZeroU16::new(1455).unwrap(),
        ))
    }
    fn launch<'a>(&'a self, _: &'a (), launch: oauth::AuthorizationLaunch) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let uri = url::Url::parse(launch.trusted_authorization_url()).unwrap();
            assert_eq!(uri.host_str(), Some("auth.openai.com"));
            assert_eq!(
                uri.query_pairs().find(|(k, _)| k == "scope").unwrap().1,
                "openid profile email"
            );
            Ok(())
        })
    }
    fn manage_usage<'a>(&'a self, _: &'a ()) -> PortFuture<'a, ()> {
        Box::pin(async { Err(AiError::ConnectionUnavailable) })
    }
    fn cached_display(&self, _: &()) -> ConnectionSnapshot {
        // Local retirement has already happened. This is cached fixture display
        // only, with no asynchronous observation or credential acquisition.
        if self.expect_stopped_display {
            assert!(self.rotated.load(Ordering::SeqCst));
        }
        self.disconnect_displays.fetch_add(1, Ordering::SeqCst);
        snapshot(false)
    }
    fn snapshot<'a>(
        &'a self,
        _: &'a (),
        _: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            self.observations.fetch_add(1, Ordering::SeqCst);
            Ok(snapshot(false))
        })
    }
}
type Infer = ResponsesAdapter<HttpResponses<Synthetic>>;
type Continuations = HostContinuations<Synthetic, Synthetic, SyntheticPrepared>;
type Actions = LifecycleHost<Synthetic, Synthetic, Synthetic, Synthetic>;
struct Peers {
    synthetic: Synthetic,
    infer: Infer,
    continuations: Continuations,
    actions: Actions,
    models: HttpAccountModels<Synthetic>,
}
impl HostPeers for Peers {
    type Context = ();
    type Connection = Synthetic;
    type Inference = Infer;
    type Catalog = Synthetic;
    type Continuations = Continuations;
    type Human = Synthetic;
    type Actions = Actions;
    type Models = HttpAccountModels<Synthetic>;
    fn connection(&self) -> &Synthetic {
        &self.synthetic
    }
    fn inference(&self) -> &Infer {
        &self.infer
    }
    fn catalog(&self) -> &Synthetic {
        &self.synthetic
    }
    fn continuations(&self) -> &Continuations {
        &self.continuations
    }
    fn human(&self) -> &Synthetic {
        &self.synthetic
    }
    fn actions(&self) -> &Actions {
        &self.actions
    }
    fn models(&self) -> &HttpAccountModels<Synthetic> {
        &self.models
    }
    fn selected_model(&self, _: &()) -> Result<String, AiError> {
        Ok("synthetic-model".into())
    }
}
fn provider_fixture(listener: TcpListener) {
    for expected in ["GET /v1/models", "POST /v1/responses"] {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with(expected));
        let mut length = 0;
        let mut auth = false;
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            let lower = line.to_ascii_lowercase();
            if let Some(v) = lower.strip_prefix("content-length:") {
                length = v.trim().parse().unwrap();
            }
            if let Some(v) = lower.strip_prefix("authorization:") {
                auth = v.trim() == format!("bearer {SYNTHETIC_BEARER}");
            }
        }
        assert!(auth);
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        if expected.starts_with("GET") {
            let data=json!({"models":[{"slug":"synthetic-model","display_name":"Synthetic model","visibility":"list"}]}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{data}",data.len()).unwrap();
        } else {
            let wire: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(wire["store"], false);
            assert_eq!(wire["stream"], true);
            assert_eq!(wire["model"], "synthetic-model");
            assert_eq!(wire["input"][0]["content"], "Synthetic hello");
            let event = json!({"type":"response.completed","response":{"status":"completed","output":[
                {"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Synthetic completed"}]}],
                "usage":{"input_tokens":9,"output_tokens":4,"total_tokens":13}}});
            let data = format!("event: response.completed\r\ndata: {event}\r\n\r\n");
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nx-request-id: synthetic-provider-request\r\nConnection: close\r\n\r\n").unwrap();
            for chunk in data.as_bytes().chunks(7) {
                write!(stream, "{:x}\r\n", chunk.len()).unwrap();
                stream.write_all(chunk).unwrap();
                stream.write_all(b"\r\n").unwrap();
            }
            stream.write_all(b"0\r\n\r\n").unwrap();
        }
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let private = tempfile::tempdir()?;
    let db_path = private.path().join("host.sqlite");
    let journal = StatusJournal::new(Connection::open(&db_path)?)?;
    let synthetic = Synthetic {
        expect_stopped_display: true,
        ..Synthetic::default()
    };
    let provider = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let target = HttpTarget::SyntheticLoopback(SocketAddrV4::new(
        Ipv4Addr::LOCALHOST,
        provider.local_addr()?.port(),
    ));
    let provider_thread = std::thread::spawn(move || provider_fixture(provider));
    let peers = Peers {
        synthetic: synthetic.clone(),
        infer: ResponsesAdapter::new(
            HttpResponses::new(synthetic.clone(), target.clone())?,
            TransportLimits::default(),
        )?,
        continuations: HostContinuations::new(
            synthetic.clone(),
            synthetic.clone(),
            journal.clone(),
            Duration::from_secs(60),
        )?,
        actions: LifecycleHost {
            security: synthetic.clone(),
            provider: synthetic.clone(),
            credentials: synthetic.clone(),
            environment: synthetic.clone(),
            journal: journal.clone(),
        },
        models: HttpAccountModels::new(synthetic.clone(), target)?,
    };
    let host = Arc::new(AiHost {
        peers,
        authority: synthetic.clone(),
        journal: journal.clone(),
        limits: ai::RunLimits::default(),
    });
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let address = listener.local_addr()?;
    let capability = "synthetic-installation-capability-0000000000";
    let gate = BridgeHttpGate {
        application: synthetic.clone(),
        bridge: BridgeAdmission::new(
            synthetic.clone(),
            "https://houseatlas.invalid".into(),
            address.to_string(),
            ProtectedValue::from_trusted_adapter(capability.into())?,
        )?,
    };
    let app = axum::Router::new()
        .nest(
            "/api/atlas/ai",
            http::router(
                host.clone(),
                http::SessionHttpGate {
                    application: synthetic.clone(),
                    authority: synthetic.clone(),
                },
            ),
        )
        .nest(
            "/api/atlas/runtime-bridge",
            http::router(Arc::new(MountedHost(host.clone())), gate),
        );
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stop_rx.await;
            })
            .await
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(10))
        .build()?;
    let request = |method, path: &str, _id: &str| {
        client
            .request(method, format!("http://{address}/api/atlas/ai{path}"))
            .header("origin", "https://houseatlas.invalid")
            .header("cookie", "synthetic-session=fixture")
            .header("x-atlas-csrf", "synthetic-csrf")
    };
    let bridge = client
        .get(format!(
            "http://{address}/api/atlas/runtime-bridge/connection"
        ))
        .header("origin", "https://houseatlas.invalid")
        .header("cookie", "synthetic-session=fixture")
        .header("x-houseatlas-installation", capability)
        .header("x-houseatlas-registration", binding().registration_id)
        .header("x-houseatlas-request-id", "connection")
        .header(
            "x-houseatlas-cancellation-epoch",
            binding().cancellation_epoch,
        )
        .send()
        .await?;
    assert!(bridge.status().is_success());
    let observed_connection: Value = serde_json::from_slice(&bridge.bytes().await?)?;
    let response = request(reqwest::Method::GET, "/models", "models")
        .send()
        .await?;
    assert!(response.status().is_success());
    let models: Value = serde_json::from_slice(&response.bytes().await?)?;
    assert_eq!(models["modelSlugs"], json!(["synthetic-model"]));
    let response=request(reqwest::Method::POST,"/connection/actions","synthetic-connect")
        .header("content-type","application/json").body(json!({"actionId":"synthetic-connect","command":{"action":"connect","route":"local-sign-in-helper"}}).to_string()).send().await?;
    assert!(response.status().is_success());
    let action: Value = serde_json::from_slice(&response.bytes().await?)?;
    assert_eq!(action["status"], "pending");
    assert_eq!(action["snapshot"]["paidUseAdmission"], "held");
    let response = request(
        reqwest::Method::GET,
        "/connection/actions/synthetic-connect",
        "synthetic-connect",
    )
    .send()
    .await?;
    assert!(response.status().is_success());
    assert_eq!(
        serde_json::from_slice::<Value>(&response.bytes().await?)?,
        action
    );
    assert_eq!(*synthetic.retained_attempts.lock().unwrap(), 1);
    let response = request(reqwest::Method::POST, "/run", "synthetic-run")
        .header("content-type", "application/json")
        .body(json!({"requestId":"synthetic-run","prompt":"Synthetic hello"}).to_string())
        .send()
        .await?;
    assert!(response.status().is_success());
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    let completed: Value = serde_json::from_slice(&response.bytes().await?)?;
    assert_eq!(completed["status"], "completed");
    assert_eq!(completed["text"], "Synthetic completed");
    assert_eq!(completed["usage"]["totalTokens"], 13);
    let response = request(
        reqwest::Method::GET,
        "/requests/synthetic-run",
        "synthetic-run",
    )
    .send()
    .await?;
    assert!(response.status().is_success());
    let retained = serde_json::from_slice::<Value>(&response.bytes().await?)?;
    assert_eq!(retained["status"], "finished");
    assert_eq!(retained["outcome"], completed);
    // Inspected healthy local dismissal: seed a synthetic waiting outcome and
    // retain the actual opaque checkpoint. No review/approval/dispatch occurs.
    let call = ToolCall {
        call_id: "synthetic-call".into(),
        name: "synthetic-held".into(),
        arguments: json!({}),
    };
    let usage = ai::Usage {
        input_tokens: Some(2),
        output_tokens: Some(1),
        total_tokens: Some(3),
    };
    let continuation = host
        .peers
        .continuations
        .retain(
            &(),
            AiCheckpoint {
                request_id: "synthetic-review".into(),
                model: "synthetic-model".into(),
                history: vec![],
                pending: vec![(
                    call.clone(),
                    SyntheticPrepared(synthetic.retired_handles.clone()),
                )],
                seen_calls: Default::default(),
                next_round: 1,
                usage,
                operation_ids: vec![],
                limits: ai::RunLimits::default(),
            },
            &Cancellation::default(),
        )
        .await?;
    let waiting = ai::RunOutcome::ReviewRequired {
        calls: vec![call],
        continuation_id: continuation,
        reviews: vec![],
        usage,
    };
    let b = binding();
    let scope = serde_json::to_string(&[
        &b.actor_id,
        &b.workspace_id,
        &b.home_id,
        &b.registration_id,
        &b.authority_epoch,
        &b.cancellation_epoch,
    ])?;
    Connection::open(&db_path)?.execute(
        "INSERT INTO ai_host_status(scope,id,kind,state,payload)
        VALUES(?1,'synthetic-review','request','finished',?2)",
        rusqlite::params![scope, serde_json::to_string(&waiting)?],
    )?;
    let response = request(
        reqwest::Method::POST,
        "/requests/synthetic-review/cancel",
        "synthetic-review",
    )
    .header("content-type", "application/json")
    .body(json!({"requestId":"synthetic-review"}).to_string())
    .send()
    .await?;
    assert!(response.status().is_success());
    let dismissal: Value = serde_json::from_slice(&response.bytes().await?)?;
    assert_eq!(dismissal["status"], "confirmed");
    assert_eq!(synthetic.retired_handles.load(Ordering::SeqCst), 1);
    let response = request(
        reqwest::Method::GET,
        "/requests/synthetic-review",
        "synthetic-review",
    )
    .send()
    .await?;
    assert!(response.status().is_success());
    let dismissed: Value = serde_json::from_slice(&response.bytes().await?)?;
    assert_eq!(
        dismissed["outcome"],
        json!({"status":"cancelled","usage":usage})
    );
    assert_eq!(synthetic.observations.load(Ordering::SeqCst), 1);
    // Normal no-token lifecycle disconnect: stop_use rotates the synthetic
    // cancellation epoch. The real OAuth implementation never calls revoke.
    let response = request(
        reqwest::Method::POST,
        "/connection/actions",
        "synthetic-disconnect",
    )
    .header("content-type", "application/json")
    .body(json!({"actionId":"synthetic-disconnect","command":{"action":"disconnect"}}).to_string())
    .send()
    .await?;
    assert!(response.status().is_success());
    let disconnected: Value = serde_json::from_slice(&response.bytes().await?)?;
    assert_eq!(disconnected["status"], "completed");
    assert_eq!(synthetic.observations.load(Ordering::SeqCst), 1);
    assert_eq!(synthetic.disconnect_displays.load(Ordering::SeqCst), 1);
    assert_eq!(
        disconnected["snapshot"]["authorization"],
        "sign-in-required"
    );
    assert_eq!(disconnected["snapshot"]["paidUseAdmission"], "held");
    let response = request(
        reqwest::Method::GET,
        "/connection/actions/synthetic-disconnect",
        "synthetic-disconnect",
    )
    .send()
    .await?;
    assert!(response.status().is_success());
    assert_eq!(
        serde_json::from_slice::<Value>(&response.bytes().await?)?,
        disconnected
    );
    assert_eq!(synthetic.releases.load(Ordering::SeqCst), 9);
    assert_eq!(synthetic.receipt_releases.load(Ordering::SeqCst), 1);
    stop_tx.send(()).unwrap();
    server.await??;
    provider_thread.join().unwrap();
    drop(host);
    drop(journal);
    // Inspected positive upgrade input: earlier versions used the six-field
    // request scope for action rows. Seed one receipt and one ordinary pending
    // action, then let the actual journal constructor upgrade them atomically.
    // No callback, credential exchange or action replay is performed.
    let mut legacy_receipt = disconnected.clone();
    legacy_receipt["actionId"] = json!("synthetic-legacy-receipt");
    let legacy_payload = serde_json::to_string(&legacy_receipt)?;
    let pending_payload = json!({"action":"consent"}).to_string();
    {
        let original = Connection::open(&db_path)?;
        original.execute(
            "INSERT INTO ai_host_status(scope,id,kind,state,payload,cancelled)
            VALUES(?1,'synthetic-legacy-receipt','action','observed',?2,0)",
            rusqlite::params![scope, legacy_payload],
        )?;
        original.execute(
            "INSERT INTO ai_host_status(scope,id,kind,state,payload,cancelled)
            VALUES(?1,'synthetic-legacy-pending','action','unconfirmed',?2,0)",
            rusqlite::params![scope, pending_payload],
        )?;
    }
    let reopened = StatusJournal::new(Connection::open(&db_path)?)?;
    assert_eq!(
        serde_json::to_value(reopened.read(&binding(), "synthetic-run", true)?)?,
        retained
    );
    let readonly =
        Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let counts: i64 = readonly.query_row(
        "SELECT count(*) FROM ai_host_observation WHERE category='usage'",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(counts, 1);
    let retired: i64 = readonly.query_row(
        "SELECT count(*) FROM ai_host_observation WHERE category='continuation-retired'",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(retired, 1);
    let current = synthetic.current_binding();
    let action_scope = serde_json::to_string(&[
        &current.actor_id,
        &current.workspace_id,
        &current.home_id,
        &current.registration_id,
        &current.authority_epoch,
    ])?;
    for (id, state, payload) in [
        (
            "synthetic-legacy-receipt",
            "observed",
            legacy_payload.as_str(),
        ),
        (
            "synthetic-legacy-pending",
            "unconfirmed",
            pending_payload.as_str(),
        ),
    ] {
        let row:(String,String,String,i64) = readonly.query_row(
            "SELECT scope,state,payload,cancelled FROM ai_host_status WHERE kind='action' AND id=?1",
            [id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
        assert_eq!(row, (action_scope.clone(), state.into(), payload.into(), 0));
        let upgrade: (String, String) = readonly.query_row(
            "SELECT scope,payload FROM ai_host_observation
             WHERE category='action-scope-upgraded' AND id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        assert_eq!(
            upgrade,
            (
                scope.clone(),
                json!({"receiptScope":action_scope}).to_string()
            )
        );
    }
    assert_eq!(
        serde_json::to_value(reopened.read(&binding(), "synthetic-review", true)?)?,
        dismissed
    );
    // Poll the durable action under the newly captured cancellation epoch after
    // a healthy reopen; this does not reissue disconnect or recover a fault.
    let reopened_actions = LifecycleHost {
        security: synthetic.clone(),
        provider: synthetic.clone(),
        credentials: synthetic.clone(),
        environment: synthetic.clone(),
        journal: reopened,
    };
    let action_poll = runtime::ConnectionActionPort::status(
        &reopened_actions,
        &(),
        "synthetic-disconnect",
        &Cancellation::default(),
    )
    .await?;
    assert_eq!(serde_json::to_value(action_poll)?, disconnected);
    let legacy_poll = runtime::ConnectionActionPort::status(
        &reopened_actions,
        &(),
        "synthetic-legacy-receipt",
        &Cancellation::default(),
    )
    .await?;
    assert_eq!(serde_json::to_value(legacy_poll)?, legacy_receipt);
    let pending_poll = runtime::ConnectionActionPort::status(
        &reopened_actions,
        &(),
        "synthetic-legacy-pending",
        &Cancellation::default(),
    )
    .await?;
    assert!(matches!(
        pending_poll.status,
        runtime::ConnectionActionStatus::Unconfirmed
    ));
    assert_eq!(pending_poll.action_id, "synthetic-legacy-pending");
    assert_eq!(
        pending_poll.snapshot.paid_use_admission,
        ai::PaidUseAdmission::Held
    );
    let verification = healthy_verification::run(private.path()).await?;
    if let Some(path) = std::env::var_os("HOUSEATLAS_AI_HEALTHY_JSON") {
        std::fs::write(
            path,
            serde_json::to_vec(&json!({"connection":observed_connection,
            "action":action,"verification":verification,"disconnect":disconnected,"legacyReceipt":legacy_receipt,"legacyPending":pending_poll,"dismissal":dismissal,"dismissedStatus":dismissed,"run":completed,"requestStatus":retained,"models":models}))?,
        )?;
    }
    println!(
        "healthy: actual loopback models/Responses HTTP, mounted router/run/status, durable usage/reopen, pending OAuth begin, local review dismissal, no-token disconnect/epoch-stable receipt without fresh observation, legacy action-key upgrade/polling, and retained exchange verification/private codec/original action completion; account/crypto/encryption peers synthetic; no paid inference or stopped controls"
    );
    Ok(())
}
