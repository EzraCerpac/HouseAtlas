//! One healthy loopback GET and actual native publication. This executable has
//! no stopped-control branch. All passwords, certificates and DBs are disposable.
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
use n::DurableNetworkSidecar;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

type Failure = Box<dyn std::error::Error + Send + Sync>;
fn publication_error(error: n::NetworkPublicationError<s::Error>) -> Failure {
    match error {
        n::NetworkPublicationError::Network(error) => error.into(),
        n::NetworkPublicationError::Storage(error) => error.into(),
    }
}
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
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Failure> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        return Err("Expected disposable loopback origin and certificate path".into());
    }
    let origin = &args[1];
    let parsed = url::Url::parse(origin)?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port().is_none()
        || parsed.origin().ascii_serialization() != *origin
    {
        return Err("Fixture requires canonical IPv4 loopback HTTPS".into());
    }
    let ca = std::fs::read(&args[2])?;
    let directory = tempfile::tempdir()?;
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
        a::AccessConfig::new(vec![origin.clone()])?
            .with_lifecycle_policy(a::LifecyclePolicy::from_trusted_configuration(policy)),
    )?));
    let (configure_principal, principal, login_url, read_url) = {
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
        (configure_principal, principal, login_url, read_url)
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
        2000,
        2000,
        300_000,
        &directory_path,
    )?
    .with_reviewed_ca_pem(&ca)?;
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
    let runtime = HostNetworkRuntime::open(settings)?;
    let outcome = runtime
        .refresh(
            &core,
            authority,
            lease.clone(),
            CancellationToken::new(),
            || "2026-01-02T12:00:00Z".into(),
        )
        .await;
    let cache = match outcome {
        Ok(RefreshResult::Published(cache)) => cache,
        Ok(RefreshResult::SourceFailure(cache)) => {
            return Err(format!(
                "Healthy fixture returned sanitized source failure: {:?}",
                cache.error.as_ref().map(|e| &e.code)
            )
            .into());
        }
        Ok(RefreshResult::AlreadyRunning) => return Err("Unexpected in-progress result".into()),
        Err(n::NetworkPublicationError::Network(e)) => return Err(e.into()),
        Err(n::NetworkPublicationError::Storage(e)) => return Err(e.into()),
    };
    lease.revalidate()?;
    let db = rusqlite::Connection::open_with_flags(
        &atlas_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let epoch: i64 = db.query_row(
        "SELECT epoch FROM cache_epochs WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    assert_eq!(epoch, 1);
    let body: String = db.query_row(
        "SELECT body FROM caches WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    assert_eq!(serde_json::from_str::<s::CacheStatus>(&body)?, cache);
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM network_relations WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    assert_eq!(count, 4);
    let reservations: i64 =
        db.query_row("SELECT COUNT(*) FROM cache_generations", [], |r| r.get(0))?;
    let schema: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    assert_eq!(schema, 5);
    // A distinct genuine viewer has no lifecycle policy. Browse uses only its
    // current Read authority and original typed resource grants on the same Store.
    let viewer = a::CanonicalId::parse("00000000-0000-4000-8000-000000000006")?;
    let viewer_actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000007")?;
    let viewer_password = format!("Disposable-{}", app::new_id()?);
    access.provision_user(
        &viewer,
        &viewer_actor,
        "synthetic-network-viewer",
        &a::hash_password(&viewer_password)?,
        None,
    )?;
    access.set_membership(&viewer, &scope, a::Role::Viewer, true)?;
    let viewer_receipt = access.login(
        &evidence(&login_url, origin, a::Method::Post, None, None),
        &serde_json::to_vec(
            &json!({"username":"synthetic-network-viewer", "password":viewer_password}),
        )?,
        "disposable-loopback-viewer",
    )?;
    let viewer_cookie = viewer_receipt
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing viewer cookie")?;
    let viewer_principal = access.authorize(
        &evidence(&read_url, origin, a::Method::Get, Some(viewer_cookie), None),
        &scope,
        a::Action::Read,
    )?;
    let viewer_partition = access.partition_grant(
        &viewer_principal,
        &runtime.settings().configured_source().partition(),
    )?;
    let mut viewer_entities = Vec::new();
    for (kind, id) in [
        (a::SourceKind::NetworkGroup, "group-a"),
        (a::SourceKind::NetworkDevice, "device-a"),
        (a::SourceKind::NetworkDevice, "device-b"),
        (a::SourceKind::NetworkInterface, "interface-a"),
        (a::SourceKind::NetworkSegment, "segment-a"),
    ] {
        viewer_entities.push(
            access.source_grant(
                &viewer_principal,
                &a::SourceRef {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                    key: a::SourceKey {
                        source_instance_id: runtime
                            .settings()
                            .configured_source()
                            .partition()
                            .source_instance_id,
                        collection_id: registration.collection_id.clone(),
                        source_kind: kind,
                        external_id: id.into(),
                    },
                },
            )?,
        );
    }
    let (facet, disclosure) = runtime
        .read(
            &core,
            access.clone(),
            viewer_principal,
            viewer_partition,
            viewer_entities,
            "2026-01-02T12:00:01Z",
        )
        .map_err(publication_error)?;
    disclosure.revalidate()?;
    assert_eq!(disclosure.link_grants().len(), 4);
    assert_eq!(disclosure.observation_grants().len(), 1);
    let raw_member = disclosure
        .link_grants()
        .iter()
        .find(|g| g.reference().external_id() == "member-a")
        .ok_or("Missing genuine member grant")?
        .reference();
    assert_eq!(raw_member.from().key.external_id, "segment-a");
    assert_eq!(raw_member.to().key.external_id, "interface-a");
    let raw_gap = disclosure
        .link_grants()
        .iter()
        .find(|g| g.reference().external_id() == "gap-a")
        .ok_or("Missing genuine hidden endpoint grant")?
        .reference();
    assert_eq!(raw_gap.to().key.external_id, "device-b");
    let observation = disclosure.observation_grants()[0].reference();
    assert_eq!(observation.external_id(), raw_member.external_id()); // Separate namespaces.
    assert_eq!(observation.collector_id(), "synthetic-collector-a");
    assert_eq!(
        observation
            .device()
            .ok_or("Missing device")?
            .key
            .external_id,
        "device-a"
    );
    assert_eq!(
        observation
            .interface()
            .ok_or("Missing interface")?
            .key
            .external_id,
        "interface-a"
    );
    assert_eq!(
        (
            facet.groups.len(),
            facet.devices.len(),
            facet.interfaces.len(),
            facet.segments.len()
        ),
        (1, 2, 1, 1)
    );
    assert_eq!(
        (
            facet.current_claims.len(),
            facet.history.len(),
            facet.observations.len()
        ),
        (3, 1, 1)
    );
    assert_eq!(facet.status, n::FacetStatus::Fresh);
    assert!(facet.read_only);
    assert!(!facet.capabilities.physical_placement);
    assert_eq!(
        facet.observations[0].observation.fact_at,
        "2026-01-01T01:02:03Z"
    );
    assert_eq!(
        facet.observations[0].observation.retrieved_at,
        "2026-01-02T12:00:00Z"
    );
    assert_eq!(
        facet.observations[0].observation.value["value"]["note"],
        "Original synthetic source text"
    );
    assert_eq!(
        facet.observations[0].freshness,
        n::ObservationFreshness::Stale
    );
    let owning_core_alias = core.clone();
    assert!(Arc::ptr_eq(&core, &owning_core_alias));
    let released = runtime
        .disclose(&owning_core_alias, &disclosure, "2026-01-02T12:00:01Z")
        .map_err(publication_error)?;
    assert_eq!(released, facet); // Same retained originals, no recapture or HTTP.
    let epoch_after: i64 = db.query_row(
        "SELECT epoch FROM cache_epochs WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    let reservations_after: i64 =
        db.query_row("SELECT COUNT(*) FROM cache_generations", [], |r| r.get(0))?;
    assert_eq!(epoch_after, epoch);
    assert_eq!(reservations_after, reservations);
    drop(db);
    let source = runtime.settings().source().clone();
    let review = runtime.settings().review().clone();
    let key = n::partition_key(&source.scope)?;
    use sha2::{Digest, Sha256};
    let sidecar_path = directory_path.join(format!(
        "network-{:x}.sqlite",
        Sha256::digest(key.as_bytes())
    ));
    runtime.close()?;
    let sidecar = n::SqliteNetworkSidecar::open(&sidecar_path, std::slice::from_ref(&source))?;
    let row = sidecar.load(
        &source,
        cache.generation_id.as_deref().ok_or("Missing generation")?,
    )?;
    let packet = n::SidecarPacket {
        format: n::SIDECAR_FORMAT.into(),
        rows: vec![row],
    };
    let retained = n::validate_sidecar_packet(&packet, std::slice::from_ref(&source))?.remove(0);
    let cache: n::CacheMetadata = serde_json::from_value(serde_json::to_value(cache)?)?;
    let generation = retained
        .generation
        .as_ref()
        .ok_or("Missing retained generation")?;
    assert_eq!(generation_references(&source, generation)?.len(), 5);
    assert_eq!(generation.inventory.links.len(), 4);
    assert_eq!(generation.observations.len(), 1);
    accepted.authorize_generation(&accepted_original, &source, generation)?;
    assert_eq!(generation.retrieved_at, "2026-01-02T12:00:00Z");
    let reopened = n::reopen_sidecar(
        &source,
        &cache,
        &generation.network_relations,
        &packet.rows[0],
        Some(&review),
    )?;
    assert_eq!(reopened, retained);
    sidecar.close()?;
    drop(core);
    println!(
        "PASS healthy canonical Network: same Core/access/Store issuer; owning-Core configuration, original principal before shared injection, accepted PR36 lease ABI; verified TLS inventory GET1, genuine AT11 original grants, same-store native publisher, epoch0->1, durable pointer/reopen, schema5; entities5/links4/relations4/observations1; genuine viewer link/observation capture and original-grant same-Core/Store rerelease; canonical ownership checked before browse; reads preserve epoch/reservations"
    );
    Ok(())
}
