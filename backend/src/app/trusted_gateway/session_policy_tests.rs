//! Explicitly authorized session-policy regression lane: generated memory Access
//! and an owned disposable Unix socket only. No WhoIs or remote transport.
use super::*;
use crate::access::{
    AccessBoundary, AccessConfig, AccessLimits, Action, CanonicalId, LoopbackLocalIdentity, Method,
    RequestEvidence, Role, Scope, SessionReceipt,
};
use std::{
    hint::black_box,
    sync::atomic::{AtomicI64, Ordering},
    time::Instant,
};

const ORIGIN: &str = "https://atlas.synthetic.ts.net";
const HEADER: &str = r#"{"schemaVersion":1,"kind":"user","value":"synthetic@gateway"}"#;
const NOW: i64 = 1_800_000_000_000;
const YEAR: i64 = 365 * 24 * 60 * 60 * 1000;

fn id(n: u32) -> CanonicalId {
    CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
}
fn scope() -> Scope {
    Scope {
        workspace_id: id(1),
        home_id: id(2),
    }
}
fn request<'a>(
    method: Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> RequestEvidence<'a> {
    RequestEvidence {
        method,
        url: "https://atlas.synthetic.ts.net/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf,
        authorization: None,
    }
}
fn cookie(receipt: &SessionReceipt) -> &str {
    receipt.set_cookie().split(';').next().unwrap()
}
struct Fixture {
    // Keep directory and listener alive throughout the fixture's checks.
    _directory: tempfile::TempDir,
    _listener: UnixListener,
    socket: Arc<GatewaySocket>,
    peer: GatewayConnection,
    access: AccessBoundary,
    clock: Arc<AtomicI64>,
}
impl Fixture {
    async fn new() -> Self {
        let directory = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let path = fs::canonicalize(directory.path())
            .unwrap()
            .join("gateway.sock");
        let policy = Arc::new(TrustedProxyPolicy {
            user_login: "synthetic@gateway".into(),
            node_tag: "tag:synthetic".into(),
            peer_uid: rustix::process::geteuid().as_raw(),
        });
        let clock = Arc::new(AtomicI64::new(NOW));
        let current = clock.clone();
        let config = AccessConfig::new(vec![ORIGIN.into()])
            .unwrap()
            .with_trusted_proxy(
                LoopbackLocalIdentity {
                    user_id: id(4),
                    actor_id: id(5),
                    username: "synthetic".into(),
                    scope: scope(),
                },
                policy.clone(),
            )
            .unwrap()
            .with_limits(AccessLimits {
                request_limit: 10_000,
                ..Default::default()
            })
            .unwrap()
            .with_clock(move || current.load(Ordering::Relaxed));
        let mut access = AccessBoundary::in_memory(config).unwrap();
        access.provision_loopback_local_user().unwrap();
        let (listener, socket) = GatewaySocket::bind(&path, policy).await.unwrap();
        let _client = tokio::net::UnixStream::connect(&path).await.unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        let peer = GatewayConnection {
            uid: Some(stream.peer_cred().unwrap().uid()),
        };
        Self {
            _directory: directory,
            _listener: listener,
            socket,
            peer,
            access,
            clock,
        }
    }
    fn login(&mut self, old: Option<&str>) -> SessionReceipt {
        let observed = request(Method::Post, old, None);
        let proof = self
            .socket
            .checked_identity(&self.peer, HEADER, &observed)
            .unwrap();
        self.access.login_trusted_proxy(&observed, proof).unwrap()
    }
}

#[tokio::test]
async fn year_sessions_keep_devices_and_idle_then_expire_and_renew_with_identity() {
    let mut f = Fixture::new().await;
    let sessions: Vec<_> = (0..8).map(|_| f.login(None)).collect();
    for session in &sessions {
        assert_eq!(session.info().expires_at_ms(), NOW + YEAR);
        assert!(session.set_cookie().contains("Max-Age=31536000"));
    }
    // No requests occur for over eight hours. Every independently issued device
    // session, including the first of eight, retains its native authorization.
    f.clock.store(NOW + 9 * 60 * 60 * 1000, Ordering::Relaxed);
    for session in &sessions {
        let principal = f
            .access
            .authorize(
                &request(Method::Get, Some(cookie(session)), None),
                &scope(),
                Action::Read,
            )
            .unwrap();
        assert_eq!(principal.role(), Role::Editor);
    }
    let original = &sessions[0];
    f.clock.store(NOW + YEAR - 1, Ordering::Relaxed);
    assert!(
        f.access
            .session_info(&request(Method::Get, Some(cookie(original)), None))
            .is_ok()
    );
    // CSRF-backed rotation changes tokens but never extends absolute lifetime.
    let rotated = f
        .access
        .rotate_session(&request(
            Method::Post,
            Some(cookie(original)),
            Some(original.info().csrf_token()),
        ))
        .unwrap();
    assert_eq!(rotated.info().expires_at_ms(), NOW + YEAR);
    f.clock.store(NOW + YEAR, Ordering::Relaxed);
    assert!(matches!(
        f.access
            .session_info(&request(Method::Get, Some(cookie(&rotated)), None)),
        Err(AccessError::Unauthenticated)
    ));
    assert!(
        f.access
            .rotate_session(&request(
                Method::Post,
                Some(cookie(&rotated)),
                Some(rotated.info().csrf_token())
            ))
            .is_err()
    );
    // Existing explicit proxy sign-in consumes a fresh request-bound proof;
    // it can replace an expired cookie and gives a new 365-day lifetime.
    let renewed = f.login(Some(cookie(&rotated)));
    assert_eq!(renewed.info().expires_at_ms(), NOW + 2 * YEAR);
    assert!(
        f.access
            .authorize(
                &request(Method::Get, Some(cookie(&renewed)), None),
                &scope(),
                Action::Read
            )
            .is_ok()
    );
    assert!(
        f.socket
            .checked_identity(
                &f.peer,
                r#"{"schemaVersion":1,"kind":"user","value":"other@gateway"}"#,
                &request(Method::Post, Some(cookie(&renewed)), None)
            )
            .is_err()
    );
}

#[tokio::test]
async fn year_sessions_preserve_logout_revocation_scope_and_csrf() {
    let mut f = Fixture::new().await;
    let first = f.login(None);
    let other = f.login(None);
    let get = request(Method::Get, Some(cookie(&first)), None);
    let principal = f.access.authorize(&get, &scope(), Action::Read).unwrap();
    assert!(
        f.access
            .authorize(
                &request(Method::Post, Some(cookie(&first)), None),
                &scope(),
                Action::Mutate
            )
            .is_err()
    );
    assert!(
        f.access
            .authorize(
                &request(Method::Post, Some(cookie(&first)), Some("wrong")),
                &scope(),
                Action::Mutate
            )
            .is_err()
    );
    let mut cross_origin = request(
        Method::Post,
        Some(cookie(&first)),
        Some(first.info().csrf_token()),
    );
    cross_origin.origin = Some("https://other.synthetic.invalid");
    assert!(
        f.access
            .authorize(&cross_origin, &scope(), Action::Mutate)
            .is_err()
    );
    assert!(
        f.access
            .authorize(
                &get,
                &Scope {
                    workspace_id: id(1),
                    home_id: id(9)
                },
                Action::Read
            )
            .is_err()
    );
    let post = request(
        Method::Post,
        Some(cookie(&first)),
        Some(first.info().csrf_token()),
    );
    assert!(f.access.authorize(&post, &scope(), Action::Mutate).is_ok());
    let expired_cookie = f.access.logout(&post).unwrap();
    assert!(expired_cookie.contains("Max-Age=0"));
    assert!(f.access.session_info(&get).is_err());
    assert!(f.access.revalidate(&principal).is_err());
    assert!(
        f.access
            .session_info(&request(Method::Get, Some(cookie(&other)), None))
            .is_ok()
    );
    f.access.revoke_user_sessions(&id(4)).unwrap();
    assert!(
        f.access
            .session_info(&request(Method::Get, Some(cookie(&other)), None))
            .is_err()
    );
    let next = f.login(None);
    let next_principal = f
        .access
        .authorize(
            &request(Method::Get, Some(cookie(&next)), None),
            &scope(),
            Action::Read,
        )
        .unwrap();
    f.access
        .set_membership(&id(4), &scope(), Role::Editor, false)
        .unwrap();
    assert!(f.access.revalidate(&next_principal).is_err());
    assert!(
        f.access
            .authorize(
                &request(Method::Get, Some(cookie(&next)), None),
                &scope(),
                Action::Read
            )
            .is_err()
    );
}

fn measure(name: &str, mut operation: impl FnMut()) {
    const WARMUP: usize = 200;
    const COUNT: usize = 2_000;
    for _ in 0..WARMUP {
        operation();
    }
    let run = Instant::now();
    let mut samples = Vec::with_capacity(COUNT);
    for _ in 0..COUNT {
        let start = Instant::now();
        operation();
        samples.push(start.elapsed().as_nanos());
    }
    let runtime = run.elapsed();
    samples.sort_unstable();
    let sum: u128 = samples.iter().sum();
    println!(
        "{name}: warmup={WARMUP} count={COUNT} p50_ns={} p95_ns={} mean_ns={} runtime_us={}",
        samples[COUNT / 2],
        samples[COUNT * 95 / 100],
        sum / COUNT as u128,
        runtime.as_micros()
    );
}

#[tokio::test]
async fn generated_local_gateway_admission_benchmark() {
    let mut f = Fixture::new().await;
    let session = f.login(None);
    let observed = request(Method::Get, Some(cookie(&session)), None);
    let scope = scope();
    println!(
        "LOCAL GENERATED ONLY: debug/test build, one process, disposable Unix socket, in-memory SQLite; no WhoIs, gateway daemon, TCP/TLS, browser, real provider or production latency. Retained native guards unchanged."
    );
    measure("control", || {
        black_box(HEADER);
    });
    measure("native_authorize", || {
        black_box(
            f.access
                .authorize(black_box(&observed), &scope, Action::Read)
                .unwrap(),
        );
    });
    measure("gateway_admit", || {
        black_box(
            f.socket
                .admit(black_box(&f.peer), black_box(HEADER))
                .unwrap(),
        );
    });
    measure("gateway_admit_plus_native_authorize", || {
        black_box(
            f.socket
                .admit(black_box(&f.peer), black_box(HEADER))
                .unwrap(),
        );
        black_box(
            f.access
                .authorize(black_box(&observed), &scope, Action::Read)
                .unwrap(),
        );
    });
    f.socket.remove_after_shutdown().unwrap();
}
