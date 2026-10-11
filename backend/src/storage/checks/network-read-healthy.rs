//! Positive same-store read with actual AT11 original grants. The published
//! synthetic relation fixture supplies matching data, not a Network sidecar or
//! accepted-generation membership proof. No provider, publication or controls.
#[allow(dead_code)]
mod support;
use houseatlas_at07_checkpoint::{access as a, storage as s};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    rc::Rc,
};
use support::{CheckResult, Oracle, SyntheticRuntime, id, load};

struct ConfiguredAuthority;
impl s::Authorization for ConfiguredAuthority {
    type Principal = a::Principal;
    fn authorize(
        &self,
        _: &a::Principal,
        _: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        Err(s::Error::new(
            "checkpoint-error",
            "Use the original borrowed read fence",
        ))
    }
}

// Exact fixture adapter only. Network owns the production generation validator
// and raw endpoint closure; this adapter has no grant issuer or graph fallback.
struct OriginalRead<'g, 'a> {
    guard: &'g a::TransactionAuthorization<'a>,
    registrations: &'g [a::SourceRegistration],
    partitions: &'g [a::PartitionGrant],
    entities: &'g [a::SourceGrant],
    links: &'g [a::NetworkLinkGrant],
    calls: &'g RefCell<Vec<Value>>,
}
fn access_error(_: a::AccessError) -> s::Error {
    s::Error::new("not-found", "Original fixture authority unavailable")
}
impl s::Authorization for OriginalRead<'_, '_> {
    type Principal = a::Principal;
    fn authorize(
        &self,
        principal: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert!(std::ptr::eq(principal, self.guard.principal()));
        assert!(request.targets.is_empty() && request.mutation.is_none());
        assert!(matches!(
            request.capability,
            s::Capability::Read | s::Capability::ReadCache
        ));
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(request.scope)?)?;
        self.guard
            .authorize(&scope, a::Capability::Read)
            .map_err(access_error)?;
        if let Some(partition) = request.source_partition {
            let partition: a::SourcePartition =
                serde_json::from_value(serde_json::to_value(partition)?)?;
            let original = self
                .partitions
                .iter()
                .find(|v| v.partition() == &partition)
                .ok_or_else(|| s::Error::new("checkpoint-error", "Original partition missing"))?;
            assert!(std::ptr::eq(
                self.guard
                    .revalidate_source_partition(original)
                    .map_err(access_error)?,
                original
            ));
            if let Some(source) = request.source {
                let stored: a::SourceRegistration = serde_json::from_value(source.clone())?;
                assert_eq!(stored.partition(), partition);
                assert!(self.registrations.contains(&stored));
                self.calls
                    .borrow_mut()
                    .push(json!({"registeredRead":source}));
            }
        }
        if let Some(source) = request.source.filter(|v| v.get("key").is_some()) {
            self.calls.borrow_mut().push(source.clone());
            if source["key"]["sourceKind"] == "network-link" {
                let original = self
                    .links
                    .iter()
                    .find(|grant| {
                        let link = grant.reference();
                        source["workspaceId"] == link.partition().workspace_id.as_str()
                            && source["homeId"] == link.partition().home_id.as_str()
                            && source["key"]["sourceInstanceId"]
                                == link.partition().source_instance_id.as_str()
                            && source["key"]["collectionId"] == link.partition().collection_id
                            && source["key"]["externalId"] == link.external_id()
                            && endpoint_matches(source.get("from"), link.from())
                            && endpoint_matches(source.get("to"), link.to())
                    })
                    .ok_or_else(|| s::Error::new("checkpoint-error", "Original link missing"))?;
                assert!(std::ptr::eq(
                    self.guard
                        .revalidate_network_link(original)
                        .map_err(access_error)?,
                    original
                ));
            } else {
                let reference: a::SourceRef = serde_json::from_value(source.clone())?;
                let original = self
                    .entities
                    .iter()
                    .find(|v| v.reference() == &reference)
                    .ok_or_else(|| s::Error::new("checkpoint-error", "Original entity missing"))?;
                assert!(std::ptr::eq(
                    self.guard
                        .revalidate_source(original)
                        .map_err(access_error)?,
                    original
                ));
            }
        }
        Ok(s::VerifiedActor {
            workspace_id: scope.workspace_id.as_str().into(),
            home_id: scope.home_id.as_str().into(),
            actor_id: principal.actor_id().as_str().into(),
        })
    }
}

// This healthy fixture has resolved endpoints. Projected unresolved endpoints
// require the production owner's accepted-generation/raw-member qualification.
fn endpoint_matches(endpoint: Option<&Value>, original: &a::SourceRef) -> bool {
    endpoint.is_some_and(|endpoint| {
        endpoint["id"] == original.key.external_id
            && serde_json::to_value(original.key.source_kind).is_ok_and(|kind| {
                kind == format!("network-{}", endpoint["kind"].as_str().unwrap_or_default())
            })
    })
}

fn main() -> CheckResult<()> {
    let root = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh output directory required")?,
    );
    fs::create_dir(&out)?;
    let scope = s::Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let access_scope: a::Scope = serde_json::from_value(serde_json::to_value(&scope)?)?;
    let mut snapshot: s::Snapshot = load(&root, "plan-free.snapshot.json")?;
    // Two unchanged published healthy relations with explicit original endpoints.
    snapshot.network_relations.truncate(2);
    let mut expected_json = serde_json::to_value(&snapshot)?;
    for field in [
        "records",
        "sources",
        "caches",
        "homeboxEntities",
        "networkRelations",
    ] {
        expected_json[field]
            .as_array_mut()
            .ok_or("Published rows missing")?
            .retain(|row| {
                row["workspaceId"] == scope.workspace_id && row["homeId"] == scope.home_id
            });
    }
    let expected: s::Snapshot = serde_json::from_value(expected_json)?;
    let registrations: Vec<a::SourceRegistration> = expected
        .sources
        .iter()
        .cloned()
        .map(serde_json::from_value)
        .collect::<std::result::Result<_, _>>()?;
    let network = registrations
        .iter()
        .find(|v| v.owner == a::SourceOwner::Network)
        .ok_or("Published network source missing")?;
    let partition: s::SourcePartition =
        serde_json::from_value(serde_json::to_value(network.partition())?)?;
    let config = a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])?
        .with_clock(|| 1_800_000_000_000);
    let mut access = a::AccessBoundary::in_memory(config)?;
    for source in &registrations {
        access.put_source(source, None)?;
    }
    let password = "Synthetic-network-read-password-only!";
    access.provision_user(
        &a::CanonicalId::parse(id(50))?,
        &a::CanonicalId::parse(id(51))?,
        "synthetic-viewer",
        &a::hash_password(password)?,
        None,
    )?;
    access.set_membership(
        &a::CanonicalId::parse(id(50))?,
        &access_scope,
        a::Role::Viewer,
        true,
    )?;
    let mut request = a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie: None,
        csrf: None,
        authorization: None,
    };
    let session = access.login(
        &request,
        &serde_json::to_vec(&json!({"username":"synthetic-viewer","password":password}))?,
        "synthetic-loopback",
    )?;
    request.method = a::Method::Get;
    request.cookie = Some(
        session
            .set_cookie()
            .split(';')
            .next()
            .ok_or("Session cookie missing")?,
    );
    let principal = access.authorize(&request, &access_scope, a::Action::Read)?;
    let partitions = registrations
        .iter()
        .map(|v| access.authorize_source_partition(&principal, &v.partition()))
        .collect::<a::AccessResult<Vec<_>>>()?;
    let mut entities = Vec::new();
    for projection in &expected.homebox_entities {
        let reference = serde_json::from_value(
            json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,"key":projection["source"]}),
        )?;
        entities.push(access.authorize_source(&principal, &reference)?);
    }
    let mut links = Vec::new();
    for relation in &expected.network_relations {
        let endpoint = |v: &Value| -> CheckResult<a::SourceRef> {
            Ok(serde_json::from_value(
                json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,"key":{
                "sourceInstanceId":partition.source_instance_id,"collectionId":partition.collection_id,
                "sourceKind":format!("network-{}",v["kind"].as_str().ok_or("Endpoint kind missing")?),"externalId":v["id"]}}),
            )?)
        };
        let from = endpoint(&relation["from"])?;
        let to = endpoint(&relation["to"])?;
        let from_grant = access.authorize_source(&principal, &from)?;
        let to_grant = access.authorize_source(&principal, &to)?;
        let link = a::NetworkLinkRef::new(
            network.partition(),
            relation["externalId"].as_str().ok_or("Link ID missing")?,
            from,
            to,
        )?;
        links.push(access.authorize_network_link(&principal, &link, &from_grant, &to_grant)?);
        entities.extend([from_grant, to_grant]);
    }
    let oracle = Oracle::start(&root)?;
    let next = Rc::new(Cell::new(80_000));
    let path = out.join("network-read.sqlite");
    let mut store = s::AtlasStore::open(
        &path,
        oracle.storage_contract(),
        ConfiguredAuthority,
        SyntheticRuntime { next: next.clone() },
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&snapshot)?;
    let calls = RefCell::new(Vec::new());
    let mut first = None;
    access.with_read_authorization(&principal, |guard| -> CheckResult<()> {
        let authority = OriginalRead {
            guard,
            registrations: &registrations,
            partitions: &partitions,
            entities: &entities,
            links: &links,
            calls: &calls,
        };
        let read = store
            .read_cache_partition_with_authorization(&authority, &principal, &scope, &partition)?;
        assert_eq!(
            serde_json::to_value(&read.registration)?,
            serde_json::to_value(network)?
        );
        assert_eq!(read.state.cache_epoch, 0);
        assert!(read.state.cache.is_none() && read.state.homebox_entities.is_empty());
        assert_eq!(read.state.network_relations, expected.network_relations);
        assert_eq!(
            store.read_snapshot_with_authorization(&authority, &principal, &scope)?,
            expected
        );
        first = Some(read);
        Ok(())
    })?;
    store.close()?;
    let mut store = s::AtlasStore::open(
        &path,
        oracle.storage_contract(),
        ConfiguredAuthority,
        SyntheticRuntime { next: next.clone() },
        Default::default(),
    )?;
    access.with_read_authorization(&principal, |guard| -> CheckResult<()> {
        let authority = OriginalRead {
            guard,
            registrations: &registrations,
            partitions: &partitions,
            entities: &entities,
            links: &links,
            calls: &calls,
        };
        assert_eq!(
            store.read_cache_partition_with_authorization(
                &authority, &principal, &scope, &partition
            )?,
            *first.as_ref().ok_or("First read missing")?
        );
        assert_eq!(
            store.read_snapshot_with_authorization(&authority, &principal, &scope)?,
            expected
        );
        Ok(())
    })?;
    store.close()?;
    assert_eq!(next.get(), 80_000);
    let db =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    for table in ["audits", "receipts", "batch_receipts"] {
        let rows: i64 = db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })?;
        assert_eq!(rows, 0);
    }
    // Bootstrap retains the fixture's existing HomeBox generation reservation;
    // the read path must preserve it without reserving another generation.
    let reservations: i64 = db.query_row("SELECT count(*) FROM cache_generations", [], |row| {
        row.get(0)
    })?;
    assert_eq!(
        reservations as usize,
        snapshot
            .caches
            .iter()
            .filter(|v| !v["generationId"].is_null())
            .count()
    );
    assert!(
        calls
            .borrow()
            .iter()
            .any(|v| v["key"]["sourceKind"] == "network-link"
                && v["key"]["externalId"] == "member-a")
    );
    fs::write(
        out.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&json!({
        "actualAccess":"5e87c6c9152228ac4ae72814c6e6fc8f0ea8d7a2", "cacheEpoch":first.as_ref().map(|v|v.state.cache_epoch),
        "originalPrincipalAndGrantPointers":"preserved", "networkRelations":expected.network_relations.len(),
        "publicationWrites":0,"reservedIds":0,"authorizedReopen":"pass","cachedEndpointBinding":"both cached endpoint kinds/IDs match original typed link","authorizationCalls":*calls.borrow(),
        "scope":"actual AT11 read fence and typed link grants; native shapes plus published offline semantic oracle; synthetic raw relation membership fixture",
        "deferred":"actual Network sidecar generation validation/HTTP host wiring; historical held controls"}))?,
    )?;
    println!(
        "healthy network storage read: original AT11 principal and grants, same-store partition/snapshot, exact network-link selectors, zero publication writes, authorized reopen"
    );
    Ok(())
}
