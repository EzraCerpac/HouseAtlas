//! Positive disposable pin lifetime with actual AT11/Core/Store/native publication
//! and one concrete verified loopback inventory GET. No reclamation or held controls.
use houseatlas_backend::{
    access as a,
    app::{self, Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store},
    config::providers::{network::NetworkSettings, registry::ProviderRegistry},
    domain as d,
    http::contracts::NativeContracts,
    media::{AssetVault, native::NativeMediaRuntime},
    providers::network::{self as n, host_runtime::*},
    storage as s,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    os::unix::fs::PermissionsExt,
    path::Path,
    sync::{Arc, Mutex},
};

use tokio_util::sync::CancellationToken;
type Check<T> = Result<T, Box<dyn std::error::Error>>;
fn owner_error(error: n::NetworkPublicationError<s::Error>) -> Box<dyn std::error::Error> {
    match error {
        n::NetworkPublicationError::Network(error) => Box::new(error),
        n::NetworkPublicationError::Storage(error) => Box::new(error),
    }
}
const AT: &str = "2026-01-02T12:00:00Z";
const ORIGIN: &str = "https://network-pin.invalid";
fn evidence<'a>(
    url: &'a str,
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url,
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}
// Evidence only: compare all actual keys and bodies under one read-only SQL
// snapshot. This connection supplies neither custody nor authority to the test.
fn core_state(path: &Path) -> Check<Value> {
    let mut db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let tx = db.transaction()?;
    let mut result = serde_json::Map::new();
    for (table, columns, suffix) in [
        (
            "sources",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,body)",
            "",
        ),
        (
            "caches",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,body)",
            "",
        ),
        (
            "projections",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,external_id,body)",
            ",external_id",
        ),
        (
            "network_relations",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,external_id,body)",
            ",external_id",
        ),
        (
            "cache_generations",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,generation_id)",
            ",generation_id",
        ),
        (
            "cache_epochs",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,epoch)",
            "",
        ),
    ] {
        let rows = tx.prepare(&format!("SELECT {columns} FROM {table} ORDER BY workspace_id,home_id,source_instance_id,collection_id{suffix}"))?
            .query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        result.insert(table.into(), serde_json::to_value(rows)?);
    }
    tx.commit()?;
    Ok(Value::Object(result))
}
fn count_disclosures(
    store: &mut Store,
    references: &mut n::NetworkCacheReferences<'_>,
    generation_id: &str,
) -> s::Result<usize> {
    let guard = store.guard_cache_residency(references)?;
    let count = guard
        .protected()
        .iter()
        .filter(|entry| {
            entry.generation_id() == generation_id
                && entry.reason() == s::CacheProtectionReason::Disclosure
                && entry.origin() == s::CacheProtectionOrigin::StorePin
        })
        .count();
    guard.release().1?;
    Ok(count)
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Check<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        return Err("Expected fresh loopback origin and reviewed CA arguments".into());
    }
    let upstream_origin = &args[1];
    let parsed = url::Url::parse(upstream_origin)?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port().is_none()
        || parsed.origin().ascii_serialization() != *upstream_origin
    {
        return Err("Fixture accepts canonical IPv4 loopback HTTPS only".into());
    }
    let ca = std::fs::read(&args[2])?;
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-network-pin-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let directory_path = std::fs::canonicalize(directory.path())?;
    let mut snapshot: s::Snapshot = serde_json::from_slice(include_bytes!(
        "../../../../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    let mut registration: s::SourceRegistration =
        serde_json::from_value(snapshot.sources[2].clone())?;
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
    snapshot.sources[2] = serde_json::to_value(&registration)?;
    let registry = ProviderRegistry::from_trusted_configuration(vec![registration.clone()])?;
    let configured = registry.sources()[0].clone();
    let source: n::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration)?)?;
    let review: n::LinkReview = serde_json::from_slice(include_bytes!(
        "../../../../../../adapters/network/fixtures/link-review.json"
    ))?;
    let settings = NetworkSettings::new(
        configured.clone(),
        upstream_origin,
        review.clone(),
        n::Limits::default(),
        2000,
        2000,
        300_000,
        &directory_path,
    )?
    .with_reviewed_ca_pem(&ca)?;
    let key = n::partition_key(&source.scope)?;
    let sidecar_path = directory_path.join(format!(
        "network-{:x}.sqlite",
        Sha256::digest(key.as_bytes())
    ));
    // Fresh approved bootstrap contains no target cache pointer or relation.
    // The actual original runtime must reserve, fetch, stage and publish it.
    snapshot
        .caches
        .retain(|cache| cache["sourceInstanceId"] != registration.source_instance_id);
    snapshot.network_relations.clear();

    let scope = configured.partition().scope();
    let user = a::CanonicalId::parse("00000000-0000-4000-8000-000000000004")?;
    let actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000005")?;
    let rule = a::LifecycleRule::new(
        user.clone(),
        actor.clone(),
        configured.access_registration().clone(),
        a::LifecycleCapability::ConfigureSource,
        a::Action::Mutate,
    )?;
    let publish_rule = a::LifecycleRule::new(
        user.clone(),
        actor.clone(),
        configured.access_registration().clone(),
        a::LifecycleCapability::PublishCache,
        a::Action::Read,
    )?;
    let canonical = Arc::new(Mutex::new(a::AccessBoundary::open(
        directory_path.join("access.sqlite"),
        a::AccessConfig::new(vec![ORIGIN.into()])?.with_lifecycle_policy(
            a::LifecyclePolicy::from_trusted_configuration(vec![rule, publish_rule]),
        ),
    )?));
    let (configure_principal, principal) = {
        let mut issuer = canonical.lock().map_err(|_| "Fixture access lock")?;
        let password = format!("Disposable-{}", app::new_id()?);
        issuer.provision_user(
            &user,
            &actor,
            "synthetic-pin-reader",
            &a::hash_password(&password)?,
            None,
        )?;
        issuer.set_membership(&user, &scope, a::Role::Editor, true)?;
        let login_url = format!("{ORIGIN}/api/atlas/auth/login");
        let login = issuer.login(
            &evidence(&login_url, a::Method::Post, None, None),
            &serde_json::to_vec(&json!({"username":"synthetic-pin-reader","password":password}))?,
            "disposable-local-only",
        )?;
        let cookie = login
            .set_cookie()
            .split(';')
            .next()
            .ok_or("Missing cookie")?;
        let configure_url = format!("{ORIGIN}/api/atlas/configure");
        let configure_principal = issuer.authorize(
            &evidence(
                &configure_url,
                a::Method::Post,
                Some(cookie),
                Some(login.info().csrf_token()),
            ),
            &scope,
            a::Action::Mutate,
        )?;
        let read_url = format!("{ORIGIN}/api/atlas/network");
        let principal = issuer.authorize(
            &evidence(&read_url, a::Method::Get, Some(cookie), None),
            &scope,
            a::Action::Read,
        )?;
        (configure_principal, principal)
    };
    let vault = Arc::new(AssetVault::open(&directory_path.join("media"))?);
    let db_path = directory_path.join("atlas.sqlite");
    let mut store = Store::open(
        &db_path,
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
    // Fresh approved bootstrap only: no target generation or invented custody.
    store.initialize_synthetic(&snapshot)?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: registration.workspace_id.clone(),
            home_id: registration.home_id.clone(),
        },
        label: "Synthetic pin fixture".into(),
    };
    let core = Arc::new(Mutex::new(Core {
        access: canonical.clone(),
        store: Arc::new(Mutex::new(store)),
        vault,
        atlas_list_pages: Default::default(),
        media_policy_evidence: Mutex::default(),
        homes: vec![home.clone()],
        home,
    }));
    let access = NetworkAccess::from_shared(a::SharedAccess::from_existing(canonical.clone()));
    access.configure(&core, &configure_principal, &configured)?;
    let (partition, entities) = {
        let issuer = canonical.lock().map_err(|_| "Fixture access lock")?;
        let partition = issuer.authorize_source_partition(&principal, &configured.partition())?;
        let mut entities = Vec::new();
        for (kind, external_id) in [
            (a::SourceKind::NetworkGroup, "group-a"),
            (a::SourceKind::NetworkDevice, "device-a"),
            (a::SourceKind::NetworkDevice, "device-b"),
            (a::SourceKind::NetworkInterface, "interface-a"),
            (a::SourceKind::NetworkSegment, "segment-a"),
        ] {
            entities.push(issuer.authorize_source(
                &principal,
                &a::SourceRef {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                    key: a::SourceKey {
                        source_instance_id: configured.partition().source_instance_id,
                        collection_id: registration.collection_id.clone(),
                        source_kind: kind,
                        external_id: external_id.into(),
                    },
                },
            )?);
        }
        (partition, entities)
    };
    let runtime = HostNetworkRuntime::open(settings.clone())?;
    let original = access.retain_original(
        principal.clone(),
        configured.clone(),
        partition.clone(),
        entities.clone(),
    )?;
    let authority = NetworkAuthority::new(original.clone(), &settings.transport(), None)?;
    let cache = match runtime
        .refresh(
            &core,
            authority,
            original.clone(),
            CancellationToken::new(),
            || AT.into(),
        )
        .await
        .map_err(owner_error)?
    {
        RefreshResult::Published(cache) => cache,
        _ => return Err("Expected genuine healthy Network publication".into()),
    };
    original.revalidate()?;
    let generation_id = cache.generation_id.ok_or("Missing published generation")?;
    let before = core_state(&db_path)?;
    let request_principal = RequestPrincipal::new(principal.clone());
    let (facet, disclosure) = runtime
        .read(&core, access.clone(), principal, partition, entities, AT)
        .map_err(|_| "Original positive runtime read failed")?;
    assert_eq!(disclosure.generation_id(), Some(generation_id.as_str()));
    assert_eq!(disclosure.link_grants().len(), 4);
    // This unchanged original inventory input has no observation rows.
    assert_eq!(disclosure.observation_grants().len(), 0);
    disclosure.revalidate()?;
    assert_eq!(
        runtime
            .disclose(&core, &disclosure, AT)
            .map_err(|_| "Original release failed")?,
        facet
    );
    // Close before reopening: no simultaneous independent path opens, race,
    // restart/recovery control, or cross-open ownership qualification.
    runtime.close()?;
    let sidecar = Mutex::new(n::SqliteNetworkSidecar::open(
        &sidecar_path,
        std::slice::from_ref(&source),
    )?);
    let mut references =
        n::NetworkCacheReferences::new(&sidecar, &source, &review, n::Limits::default());
    let owner = core.lock().map_err(|_| "Fixture Core lock")?;
    let mut store = owner.store.lock().map_err(|_| "Fixture Store lock")?;
    assert_eq!(
        count_disclosures(&mut store, &mut references, &generation_id)?,
        1
    );
    let pinned = store.read_cache_partition_pinned_with_authorization(
        &ReadAuthority(canonical.clone()),
        &request_principal,
        &registration.scope(),
        &registration.partition(),
    )?;
    let (baseline, token) = pinned.into_parts();
    let token = token.ok_or("Missing actual current generation pin")?;
    store.validate_cache_disclosure_pin(&token, &baseline)?;
    assert_eq!(token.registration(), &registration);
    assert_eq!(token.generation_id(), generation_id);
    assert_eq!(
        count_disclosures(&mut store, &mut references, &generation_id)?,
        2
    );
    drop(token);
    assert_eq!(
        count_disclosures(&mut store, &mut references, &generation_id)?,
        1
    );
    // Exactly the Arc retention used by actual HTTP Graph/Witness/Reader.
    let reader = disclosure.clone();
    assert!(Arc::ptr_eq(&reader, &disclosure));
    drop(disclosure);
    assert_eq!(
        count_disclosures(&mut store, &mut references, &generation_id)?,
        1
    );
    let mut guard = store.guard_cache_residency(&mut references)?;
    drop(reader);
    assert!(
        guard
            .protected()
            .iter()
            .any(|entry| entry.generation_id() == generation_id
                && entry.reason() == s::CacheProtectionReason::Disclosure)
    );
    let plan = guard.plan_reclamation(&s::CacheReclamationPolicy::new(
        "synthetic-no-release/1".into(),
        vec![],
    )?)?;
    assert_eq!(plan.coverage, s::CacheReferenceCoverage::Unknown);
    assert!(
        plan.entries
            .iter()
            .all(|entry| !entry.owner_policy_candidate())
    );
    guard.release().1?;
    assert_eq!(
        count_disclosures(&mut store, &mut references, &generation_id)?,
        0
    );
    assert_eq!(core_state(&db_path)?, before);
    drop(store);
    drop(owner);
    sidecar
        .into_inner()
        .map_err(|_| "Fixture sidecar lock")?
        .close()?;
    drop(core);
    drop(original);
    drop(access);
    drop(canonical);
    let path = directory_path;
    drop(directory);
    assert!(!path.exists());
    println!(
        "PASS actual AT11 Network disclosure; same-Store read pin; Native guard Disclosure enumeration 1->2->1; Reader Arc lifetime; last drop after guarded inventory ->0; Unknown protects all; full cache/Core-source state and burned IDs unchanged; fresh state removed; one concrete verified passive inventory TLS GET and actual native publication; no live provider/reclamation/maintenance/held controls"
    );
    Ok(())
}
