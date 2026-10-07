use super::{migrations, repository as repo, *};
#[path = "cache.rs"]
mod cache;
#[path = "cache_custody.rs"]
mod cache_custody;
pub use cache_custody::*;
#[path = "commands.rs"]
mod commands;
#[path = "recovery.rs"]
mod recovery;
#[path = "stock.rs"]
mod stock;
#[path = "stock_history.rs"]
mod stock_history;
#[path = "upload_queries.rs"]
mod upload_queries;
pub use recovery::{RecoveryImage, RecoveryValidationPeers};

use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path, sync::Arc, time::Duration};

#[derive(Debug, Clone)]
pub struct StoreOptions {
    pub allow_synthetic_bootstrap: bool,
    pub busy_timeout_ms: u64,
    /// Fresh-only opt-in profile; never upgrades an existing schema-5 database.
    pub stock_activity_profile: bool,
}
impl Default for StoreOptions {
    fn default() -> Self {
        Self {
            allow_synthetic_bootstrap: false,
            busy_timeout_ms: 5_000,
            stock_activity_profile: false,
        }
    }
}

/// One connection and one writer; exclusive &mut self prevents nested calls.
/// No public connection, arbitrary SQL, receipt deletion or migration API.
pub struct AtlasStore<C, A, R> {
    pub(super) db: Connection,
    instance: Arc<()>,
    cache_pins: cache_custody::CachePinRegistry,
    contract: C,
    authorization: A,
    pub(super) runtime: R,
    pub(super) options: StoreOptions,
}
impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Borrow the original authorizer supplied when this Store was opened.
    /// Composition can check its owner identity without acquiring an authority
    /// lock. This borrow does not authorize any read, mutation or disclosure.
    pub fn configured_authorization(&self) -> &A {
        &self.authorization
    }

    pub fn open(
        path: impl AsRef<Path>,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
    ) -> Result<Self> {
        if options.busy_timeout_ms > 60_000 {
            return Err(Error::new("invalid-contract", "Invalid storage timeout"));
        }
        let mut db = Connection::open(path)?;
        db.busy_timeout(Duration::from_millis(options.busy_timeout_ms))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        migrations::migrate(&mut db, options.stock_activity_profile)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        Ok(Self {
            db,
            instance: Arc::new(()),
            cache_pins: cache_custody::CachePinRegistry::default(),
            contract,
            authorization,
            runtime,
            options,
        })
    }
    pub fn database_version(&self) -> u32 {
        if self.options.stock_activity_profile {
            migrations::STOCK_ACTIVITY_DATABASE_VERSION
        } else {
            DATABASE_VERSION
        }
    }
    pub fn close(self) -> Result<()> {
        self.db.close().map_err(|(_, e)| e.into())
    }

    /// Offline, explicitly enabled fixture bootstrap, with no audit prehistory.
    pub fn initialize_synthetic(&mut self, snapshot: &Snapshot) -> Result<()> {
        if !self.options.allow_synthetic_bootstrap {
            return Err(Error::new("forbidden", "Synthetic bootstrap is disabled"));
        }
        if !snapshot.synthetic || snapshot.contract_version != CONTRACT_VERSION {
            return Err(Error::new(
                "invalid-contract",
                "Published synthetic snapshot is required",
            ));
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        repo::bootstrap(&tx, &self.contract, &self.runtime, snapshot)?;
        tx.commit()?;
        Ok(())
    }
    pub fn read_record(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> Result<Record> {
        shape(&self.contract, "recordRef", target)?;
        let tx = self.db.transaction()?;
        authorize(
            &self.contract,
            &self.authorization,
            principal,
            read_request(scope, Capability::Read, std::slice::from_ref(target)),
        )?;
        let record = repo::read_record(&tx, scope, target)?;
        tx.commit()?;
        Ok(record)
    }
    /// Published HTTP history is a bare array in durable audit sequence order.
    pub fn history(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> Result<Vec<Audit>> {
        shape(&self.contract, "recordRef", target)?;
        let tx = self.db.transaction()?;
        authorize(
            &self.contract,
            &self.authorization,
            principal,
            read_request(scope, Capability::ReadHistory, std::slice::from_ref(target)),
        )?;
        let history = repo::history(&tx, scope, target)?;
        tx.commit()?;
        Ok(history)
    }
    pub fn read_asset_manifest(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> Result<Value> {
        shape(&self.contract, "recordRef", target)?;
        let tx = self.db.transaction()?;
        authorize(
            &self.contract,
            &self.authorization,
            principal,
            read_request(
                scope,
                Capability::ReadAssetManifest,
                std::slice::from_ref(target),
            ),
        )?;
        let manifest = repo::asset_manifest(&tx, scope, target)?;
        tx.commit()?;
        Ok(manifest)
    }
    pub fn read_snapshot(&mut self, principal: &A::Principal, scope: &Scope) -> Result<Snapshot> {
        read_snapshot(
            &mut self.db,
            &self.contract,
            &self.authorization,
            principal,
            scope,
        )
    }

    /// Same-store snapshot read using an original per-call authority fence.
    /// Private network-link selectors require a host-owned typed link adapter;
    /// they are not frozen SourceKind values or generation-membership proof.
    pub fn read_snapshot_with_authorization<B: Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        scope: &Scope,
    ) -> Result<Snapshot> {
        read_snapshot(
            &mut self.db,
            &self.contract,
            authorization,
            principal,
            scope,
        )
    }
}
fn read_snapshot<C: Contract, B: Authorization>(
    db: &mut Connection,
    contract: &C,
    authorization: &B,
    principal: &B::Principal,
    scope: &Scope,
) -> Result<Snapshot> {
    let tx = db.transaction()?;
    let actor = authorize(
        contract,
        authorization,
        principal,
        read_request(scope, Capability::Read, &[]),
    )?;
    let mut snapshot = repo::snapshot(&tx)?.scoped(scope);
    let partition_key = |p: &SourcePartition| {
        (
            p.workspace_id.clone(),
            p.home_id.clone(),
            p.source_instance_id.clone(),
            p.collection_id.clone(),
        )
    };
    let mut denied = BTreeSet::new();
    let mut accepted = Vec::<(Option<SourcePartition>, Option<Value>)>::new();
    for cache in &snapshot.caches {
        if cache["status"] == "access-revoked" {
            denied.insert(partition_key(&repo::partition(cache)?));
        }
    }
    for source in &snapshot.sources {
        let partition = repo::partition(source)?;
        let mut request = read_request(scope, Capability::ReadCache, &[]);
        request.source_partition = Some(&partition);
        if source_denied(authorize(contract, authorization, principal, request))? {
            denied.insert(partition_key(&partition));
        } else {
            accepted.push((Some(partition), None));
        }
    }
    let mut check = |partition: SourcePartition, sources: Vec<Value>| -> Result<()> {
        if denied.contains(&partition_key(&partition)) {
            return Ok(());
        }
        for source in &sources {
            let mut request = read_request(scope, Capability::ReadCache, &[]);
            request.source = Some(source);
            if source_denied(authorize(contract, authorization, principal, request))? {
                denied.insert(partition_key(&partition));
                break;
            }
            accepted.push((None, Some(source.clone())));
        }
        Ok(())
    };
    for projection in &snapshot.homebox_entities {
        let source = &projection["source"];
        let partition = SourcePartition {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            source_instance_id: repo::string(source, "sourceInstanceId")?.into(),
            collection_id: repo::string(source, "collectionId")?.into(),
        };
        check(
            partition,
            vec![json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,"key":source})],
        )?;
    }
    for relation in &snapshot.network_relations {
        let partition = repo::partition(relation)?;
        let base = json!({"sourceInstanceId":partition.source_instance_id,"collectionId":partition.collection_id,
                "sourceKind":"network-link","externalId":relation["externalId"]});
        // Private selector retains the exact cached endpoint binding. Entity
        // grants alone cannot qualify a reused link ID with different ends.
        let mut refs = vec![
            json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":base,"from":relation["from"],"to":relation["to"]}),
        ];
        for endpoint in [&relation["from"], &relation["to"]] {
            if endpoint["kind"] != "unresolved" {
                let mut key = base.clone();
                key["sourceKind"] =
                    Value::String(format!("network-{}", repo::string(endpoint, "kind")?));
                key["externalId"] = endpoint["id"].clone();
                refs.push(
                    json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,"key":key}),
                );
            }
        }
        check(partition, refs)?;
    }
    snapshot.homebox_entities = snapshot
        .homebox_entities
        .into_iter()
        .map(|r| {
            let source = &r["source"];
            let key = (
                repo::string(&r, "workspaceId")?.into(),
                repo::string(&r, "homeId")?.into(),
                repo::string(source, "sourceInstanceId")?.into(),
                repo::string(source, "collectionId")?.into(),
            );
            Ok((r, !denied.contains(&key)))
        })
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter_map(|(r, visible)| visible.then_some(r))
        .collect();
    snapshot.network_relations = snapshot
        .network_relations
        .into_iter()
        .map(|r| Ok((!denied.contains(&partition_key(&repo::partition(&r)?)), r)))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter_map(|(visible, r)| visible.then_some(r))
        .collect();
    for cache in &mut snapshot.caches {
        if denied.contains(&partition_key(&repo::partition(cache)?)) {
            cache["status"] = json!("access-revoked");
        }
    }
    for source in &snapshot.sources {
        let p = repo::partition(source)?;
        if denied.contains(&partition_key(&p))
            && !snapshot
                .caches
                .iter()
                .any(|c| repo::partition(c).is_ok_and(|c| c == p))
        {
            let cache = json!({"schemaVersion":1,"workspaceId":p.workspace_id,"homeId":p.home_id,"sourceInstanceId":p.source_instance_id,
                    "collectionId":p.collection_id,"status":"access-revoked","lastSuccessfulFetchAt":null,"lastAttemptAt":null,"generationId":null,
                    "consistency":"non-transactional-offset-pages","error":null});
            contract.validate_shape("cacheStatus", &cache)?;
            snapshot.caches.push(cache);
        }
    }
    let recheck = || -> Result<()> {
        let current = authorize(
            contract,
            authorization,
            principal,
            read_request(scope, Capability::Read, &[]),
        )?;
        if current != actor {
            return Err(Error::new(
                "unauthenticated",
                "Snapshot read principal changed",
            ));
        }
        for (partition, source) in &accepted {
            let mut request = read_request(scope, Capability::ReadCache, &[]);
            request.source_partition = partition.as_ref();
            request.source = source.as_ref();
            if authorize(contract, authorization, principal, request)? != actor {
                return Err(Error::new(
                    "unauthenticated",
                    "Snapshot source principal changed",
                ));
            }
        }
        Ok(())
    };
    recheck()?;
    tx.commit()?;
    recheck()?;
    Ok(snapshot)
}

fn shape<C: Contract, T: Serialize>(contract: &C, name: &str, value: &T) -> Result<()> {
    contract.validate_shape(name, &serde_json::to_value(value)?)
}
fn read_request<'a>(
    scope: &'a Scope,
    capability: Capability,
    targets: &'a [RecordRef],
) -> AuthorizationRequest<'a> {
    AuthorizationRequest {
        scope,
        capability,
        targets,
        source: None,
        source_partition: None,
        mutation: None,
    }
}
fn authorize<C: Contract, A: Authorization>(
    contract: &C,
    authorization: &A,
    principal: &A::Principal,
    request: AuthorizationRequest<'_>,
) -> Result<VerifiedActor> {
    shape(contract, "scope", request.scope)?;
    let scope = request.scope;
    let actor = authorization.authorize(principal, request)?;
    if actor.workspace_id != scope.workspace_id || actor.home_id != scope.home_id {
        return Err(Error::new("not-found", "Authorized home unavailable"));
    }
    shape(
        contract,
        "recordRef",
        &RecordRef {
            record_type: RecordType::Identity,
            record_id: actor.actor_id.clone(),
        },
    )?;
    Ok(actor)
}
fn source_denied(result: Result<VerifiedActor>) -> Result<bool> {
    match result {
        Ok(_) => Ok(false),
        Err(e) if matches!(e.code, "forbidden" | "not-found") => Ok(true),
        Err(e) => Err(e),
    }
}
