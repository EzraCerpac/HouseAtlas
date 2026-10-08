//! Explicit isolated synthetic regression lane; never part of ordinary CI.
//! The driver permits only the four reviewed cases. No provider fallback.
use houseatlas_backend::{
    access as a,
    app::{self, Core, ReadAuthority, ServerRuntime, Store},
    config::providers::{network::NetworkSettings, registry::ProviderRegistry},
    domain as d,
    http::contracts::NativeContracts,
    media::{AssetVault, native::NativeMediaRuntime},
    providers::network::{self as n, host_runtime::*},
    storage as s,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

type Failure = Box<dyn std::error::Error + Send + Sync>;
fn evidence<'a>(
    url: &'a str,
    origin: &'a str,
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url,
        origin: Some(origin),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

struct Fixture {
    core: Arc<Mutex<Core>>,
    authority: Arc<NetworkAuthority>,
    lease: Arc<OriginalNetworkLease>,
    settings: NetworkSettings,
    atlas_path: std::path::PathBuf,
    source_id: String,
    // Dropped last, after all genuine database/authority handles.
    directory: tempfile::TempDir,
}
fn fixture(origin: &str, ca: &[u8], tls_root: &std::path::Path) -> Result<Fixture, Failure> {
    let parsed = url::Url::parse(origin)?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port().is_none()
        || parsed.origin().ascii_serialization() != *origin
    {
        return Err("Fixture requires canonical IPv4 loopback HTTPS".into());
    }
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-network-regression-")
        .tempdir_in(tls_root)?;
    let directory_path = std::fs::canonicalize(directory.path())?;
    let mut snapshot: Value = serde_json::from_str(include_str!(
        "../../../../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    let mut registration: s::SourceRegistration =
        serde_json::from_value(snapshot["sources"][2].clone())?;
    registration.partition_mode = s::PartitionMode::ReviewedEntityAllowlist;
    registration.allowed_external_ids = [
        "group-a",
        "device-a",
        "device-b",
        "interface-a",
        "segment-a",
        "member-a",
        "association-a",
        "connection-a",
        "gap-a",
    ]
    .map(String::from)
    .to_vec();
    snapshot["sources"][2] = serde_json::to_value(&registration)?;
    snapshot["networkRelations"] = json!([]);
    let registry = ProviderRegistry::from_trusted_configuration(vec![registration.clone()])?;
    let source = registry.sources()[0].clone();
    let scope = source.partition().scope();
    let user = a::CanonicalId::parse("00000000-0000-4000-8000-000000000004")?;
    let actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000005")?;
    let policy = vec![
        a::LifecycleRule::new(
            user.clone(),
            actor.clone(),
            source.access_registration().clone(),
            a::LifecycleCapability::ConfigureSource,
            a::Action::Mutate,
        )?,
        a::LifecycleRule::new(
            user.clone(),
            actor.clone(),
            source.access_registration().clone(),
            a::LifecycleCapability::PublishCache,
            a::Action::Read,
        )?,
    ];
    // Root's genuine canonical issuer exists before the Network bridge. Its
    // original policy, principal and sessions are not recreated by injection.
    let canonical = Arc::new(Mutex::new(a::AccessBoundary::open(
        directory_path.join("access.sqlite"),
        a::AccessConfig::new(vec![origin.to_owned()])?
            .with_lifecycle_policy(a::LifecyclePolicy::from_trusted_configuration(policy)),
    )?));
    let (configure_principal, principal) = {
        let mut issuer = canonical
            .try_lock()
            .map_err(|_| "Canonical access unexpectedly locked")?;
        let password = format!("Disposable-{}", app::new_id()?);
        issuer.provision_user(
            &user,
            &actor,
            "synthetic-network-editor",
            &a::hash_password(&password)?,
            None,
        )?;
        issuer.set_membership(&user, &scope, a::Role::Editor, true)?;
        let login_url = format!("{origin}/api/atlas/auth/login");
        let receipt = issuer.login(
            &evidence(&login_url, origin, a::Method::Post, None, None),
            &serde_json::to_vec(
                &json!({"username":"synthetic-network-editor", "password":password}),
            )?,
            "disposable-loopback",
        )?;
        let cookie = receipt
            .set_cookie()
            .split(';')
            .next()
            .ok_or("Missing session cookie")?;
        let csrf = receipt.info().csrf_token();
        let configure_url = format!("{origin}/api/atlas/configure");
        let configure_principal = issuer.authorize(
            &evidence(
                &configure_url,
                origin,
                a::Method::Post,
                Some(cookie),
                Some(csrf),
            ),
            &scope,
            a::Action::Mutate,
        )?;
        let read_url = format!("{origin}/api/atlas/network");
        let principal = issuer.authorize(
            &evidence(&read_url, origin, a::Method::Get, Some(cookie), None),
            &scope,
            a::Action::Read,
        )?;
        (configure_principal, principal)
    };
    // Store/Core and the bridge share this exact canonical allocation. Held
    // callbacks must use borrowed authority rather than reenter ReadAuthority.
    let vault = Arc::new(AssetVault::open(&directory_path.join("media"))?);
    let atlas_path = directory_path.join("atlas.sqlite");
    let mut store = Store::open(
        &atlas_path,
        NativeContracts,
        ReadAuthority(canonical.clone()),
        NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(snapshot)?)?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: registration.workspace_id.clone(),
            home_id: registration.home_id.clone(),
        },
        label: "Synthetic Network home".into(),
    };
    let core = Arc::new(Mutex::new(Core {
        access: canonical.clone(),
        store: Mutex::new(store),
        vault,
        homes: vec![home.clone()],
        home,
    }));
    let canonical_from_core = core
        .try_lock()
        .map_err(|_| "Core unexpectedly locked")?
        .access
        .clone();
    assert!(Arc::ptr_eq(&canonical_from_core, &canonical));
    let access = NetworkAccess::from_shared(a::SharedAccess::from_existing(canonical_from_core));
    assert!(Arc::ptr_eq(access.shared().as_existing(), &canonical));
    access.configure(&core, &configure_principal, &source)?;
    let (partition, grants) = {
        let issuer = canonical
            .try_lock()
            .map_err(|_| "Canonical access unexpectedly locked")?;
        issuer.revalidate(&principal)?;
        let partition = issuer.authorize_source_partition(&principal, &source.partition())?;
        let mut grants = Vec::new();
        for (kind, id) in [
            (a::SourceKind::NetworkGroup, "group-a"),
            (a::SourceKind::NetworkDevice, "device-a"),
            (a::SourceKind::NetworkDevice, "device-b"),
            (a::SourceKind::NetworkInterface, "interface-a"),
            (a::SourceKind::NetworkSegment, "segment-a"),
        ] {
            grants.push(issuer.authorize_source(
                &principal,
                &a::SourceRef {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                    key: a::SourceKey {
                        source_instance_id: source.partition().source_instance_id,
                        collection_id: registration.collection_id.clone(),
                        source_kind: kind,
                        external_id: id.into(),
                    },
                },
            )?);
        }
        (partition, grants)
    };
    let settings = NetworkSettings::new(
        source.clone(),
        origin,
        serde_json::from_str(include_str!(
            "../../../../../../adapters/network/fixtures/link-review.json"
        ))?,
        n::Limits::default(),
        5000,
        5000,
        300_000,
        &directory_path,
    )?
    .with_reviewed_ca_pem(ca)?;
    let accepted = access.bind_accepted_original(
        principal.clone(),
        source.clone(),
        partition.clone(),
        grants.clone(),
        &settings.transport(),
        None,
    )?;
    use n::NetworkReadAuthority;
    let accepted_original =
        accepted.authorize_inventory(settings.source(), settings.transport().reviewed_origin())?;
    assert!(Arc::ptr_eq(&accepted_original, accepted.lease()));
    accepted.revalidate_inventory(
        &accepted_original,
        settings.source(),
        settings.transport().reviewed_origin(),
    )?;
    let lease = access.retain_original(principal, source, partition, grants)?;
    let authority = NetworkAuthority::new(lease.clone(), &settings.transport(), None)?;
    Ok(Fixture {
        core,
        authority,
        lease,
        settings,
        atlas_path,
        source_id: registration.source_instance_id,
        directory,
    })
}

#[derive(Debug, PartialEq)]
struct State {
    epoch: i64,
    reservations: i64,
    cache: Option<s::CacheStatus>,
    relations: Vec<String>,
    rows: Vec<(String, String, String, String)>,
}
impl Fixture {
    fn state(&self) -> Result<State, Failure> {
        use rusqlite::OptionalExtension;
        let readonly = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY;
        let atlas = rusqlite::Connection::open_with_flags(&self.atlas_path, readonly)?;
        let epoch = atlas.query_row(
            "SELECT COALESCE((SELECT epoch FROM cache_epochs WHERE source_instance_id=?1),0)",
            [&self.source_id],
            |r| r.get(0),
        )?;
        let reservations =
            atlas.query_row("SELECT COUNT(*) FROM cache_generations", [], |r| r.get(0))?;
        let body: Option<String> = atlas
            .query_row(
                "SELECT body FROM caches WHERE source_instance_id=?1",
                [&self.source_id],
                |r| r.get(0),
            )
            .optional()?;
        let relations = atlas
            .prepare(
                "SELECT body FROM network_relations WHERE source_instance_id=?1 ORDER BY body",
            )?
            .query_map([&self.source_id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        let mut paths = std::fs::read_dir(self.directory.path())?
            .collect::<std::io::Result<Vec<_>>>()?
            .into_iter()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("network-") && name.ends_with(".sqlite"))
            })
            .collect::<Vec<_>>();
        if paths.len() != 1 {
            return Err("Expected one disposable sidecar".into());
        }
        let sidecar = rusqlite::Connection::open_with_flags(paths.remove(0), readonly)?;
        let rows = sidecar.prepare(
            "SELECT partition_key,generation_id,sha256,body FROM core_network_generations ORDER BY partition_key,generation_id",
        )?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(State {
            epoch,
            reservations,
            cache: body.map(|body| serde_json::from_str(&body)).transpose()?,
            relations,
            rows,
        })
    }
    async fn refresh(
        &self,
        runtime: &HostNetworkRuntime,
        cancellation: CancellationToken,
        at: &'static str,
    ) -> Result<RefreshResult, n::NetworkPublicationError<s::Error>> {
        runtime
            .refresh(
                &self.core,
                self.authority.clone(),
                self.lease.clone(),
                cancellation,
                || at.into(),
            )
            .await
    }
}
// Only the inspected parent writes this fixed bounded marker. No fixture file
// polling or file I/O is introduced into production authority callbacks.
async fn inventory_received() -> Result<(), Failure> {
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::task::spawn_blocking(|| {
            use std::io::Read;
            let mut marker = [0_u8; 19];
            std::io::stdin().read_exact(&mut marker)?;
            if &marker != b"inventory-received\n" {
                return Err("Unexpected driver marker".into());
            }
            Ok::<_, Failure>(())
        }),
    )
    .await???;
    Ok(())
}
fn release_response() -> Result<(), Failure> {
    use std::io::Write;
    println!("RELEASE");
    std::io::stdout().flush()?;
    Ok(())
}
fn published(
    result: Result<RefreshResult, n::NetworkPublicationError<s::Error>>,
) -> Result<s::CacheStatus, Failure> {
    match result {
        Ok(RefreshResult::Published(cache)) => Ok(cache),
        _ => Err("Expected actual committed native publication".into()),
    }
}
const SUCCESS_AT: &str = "2026-01-02T12:00:00Z";
const FAILURE_AT: &str = "2026-01-03T03:04:05Z";

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Failure> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4
        || !matches!(
            args[1].as_str(),
            "shared-source-flight"
                | "cancel-before-prepare"
                | "cancel-inflight"
                | "captured-failure-time"
        )
    {
        return Err(
            "Expected one explicitly allowed synthetic case, loopback origin and CA".into(),
        );
    }
    let ca_path = std::fs::canonicalize(&args[3])?;
    let fixture = fixture(
        &args[2],
        &std::fs::read(&ca_path)?,
        ca_path.parent().ok_or("Missing disposable TLS root")?,
    )?;
    let runtime = HostNetworkRuntime::open(fixture.settings.clone())?;
    let initial = fixture.state()?;
    assert_eq!(initial.epoch, 0);
    assert!(initial.rows.is_empty());
    match args[1].as_str() {
        "shared-source-flight" => {
            // A distinct runtime and sidecar connection, with the SAME actual
            // canonical Core/source and original authority, overlap at the GET.
            let second = HostNetworkRuntime::open(fixture.settings.clone())?;
            let (first, overlap) = tokio::join!(
                fixture.refresh(&runtime, CancellationToken::new(), SUCCESS_AT),
                async {
                    inventory_received().await?;
                    let before = fixture.state()?;
                    let result = fixture
                        .refresh(&second, CancellationToken::new(), SUCCESS_AT)
                        .await;
                    assert!(matches!(result, Ok(RefreshResult::AlreadyRunning)));
                    assert_eq!(fixture.state()?, before); // No second native preparation/reservation.
                    release_response()?;
                    Ok::<_, Failure>(())
                }
            );
            overlap?;
            let cache = published(first)?;
            let final_state = fixture.state()?;
            assert_eq!(final_state.epoch, 1);
            assert_eq!(final_state.reservations, initial.reservations + 1);
            assert_eq!(final_state.rows.len(), 1);
            assert_eq!(final_state.cache, Some(cache));
            second.close()?;
        }
        "cancel-before-prepare" => {
            let cancellation = CancellationToken::new();
            cancellation.cancel();
            let result = fixture.refresh(&runtime, cancellation, SUCCESS_AT).await;
            assert!(
                matches!(result, Err(n::NetworkPublicationError::Network(error)) if error.code == n::ErrorCode::Timeout)
            );
            assert_eq!(fixture.state()?, initial);
        }
        "cancel-inflight" => {
            let cancellation = CancellationToken::new();
            let (result, cancelled) = tokio::join!(
                fixture.refresh(&runtime, cancellation.clone(), SUCCESS_AT),
                async {
                    inventory_received().await?;
                    cancellation.cancel();
                    release_response()?;
                    Ok::<_, Failure>(())
                }
            );
            cancelled?;
            assert!(
                matches!(result, Err(n::NetworkPublicationError::Network(error)) if error.code == n::ErrorCode::Timeout)
            );
            let after_cancel = fixture.state()?;
            assert_eq!(after_cancel.epoch, initial.epoch);
            assert_eq!(after_cancel.cache, initial.cache);
            assert_eq!(after_cancel.relations, initial.relations);
            assert_eq!(after_cancel.rows, initial.rows);
            assert_eq!(after_cancel.reservations, initial.reservations);
            // A subsequent healthy call proves the shared flight was released.
            let cache = published(
                fixture
                    .refresh(&runtime, CancellationToken::new(), SUCCESS_AT)
                    .await,
            )?;
            let final_state = fixture.state()?;
            assert_eq!(final_state.epoch, 1);
            assert_eq!(final_state.rows.len(), 1);
            assert_eq!(final_state.reservations, initial.reservations + 1);
            assert_eq!(final_state.cache, Some(cache));
        }
        "captured-failure-time" => {
            let healthy = published(
                fixture
                    .refresh(&runtime, CancellationToken::new(), SUCCESS_AT)
                    .await,
            )?;
            let before = fixture.state()?;
            let failed = fixture
                .refresh(&runtime, CancellationToken::new(), FAILURE_AT)
                .await;
            let cache = match failed {
                Ok(RefreshResult::SourceFailure(cache)) => cache,
                _ => return Err("Expected actual native upstream failure receipt".into()),
            };
            assert_eq!(cache.last_attempt_at.as_deref(), Some(FAILURE_AT));
            assert_eq!(
                cache.error.as_ref().map(|error| error.at.as_str()),
                Some(FAILURE_AT)
            );
            assert_eq!(
                cache.error.as_ref().map(|error| error.code),
                Some(s::FailureCode::Upstream)
            );
            assert_eq!(
                cache.last_successful_fetch_at,
                healthy.last_successful_fetch_at
            );
            assert_eq!(cache.generation_id, healthy.generation_id);
            let after = fixture.state()?;
            assert_eq!(after.cache, Some(cache));
            assert_eq!(after.epoch, before.epoch + 1);
            assert_eq!(after.reservations, before.reservations);
            assert_eq!(after.relations, before.relations);
            assert_eq!(after.rows, before.rows); // Exact retained partition/ID/digest/body.
        }
        _ => unreachable!("Case checked before any setup"),
    }
    fixture.lease.revalidate()?;
    runtime.close()?;
    let directory_path = fixture.directory.path().to_owned();
    drop(fixture);
    assert!(!directory_path.exists());
    println!(
        "PASS {}: genuine same-Core/AT11/Store/native; disposable state removed",
        args[1]
    );
    Ok(())
}
