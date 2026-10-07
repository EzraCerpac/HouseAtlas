//! Success-only source/cache checkpoint. The timeout below is a successfully
//! persisted synthetic status; no transport, denial, fault or failure injection
//! is performed. All rejection/replay/crash/concurrency controls stay unrun.
#[allow(dead_code)]
mod support;
use houseatlas_at07_checkpoint::storage::*;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    rc::Rc,
};
use support::*;

#[derive(Debug, Clone, Serialize)]
struct TrustedCall {
    capability: &'static str,
    source: Value,
}
#[derive(Clone)]
struct CacheAuthorization {
    inner: SyntheticAuthorization,
    calls: Rc<RefCell<Vec<TrustedCall>>>,
}
impl Authorization for CacheAuthorization {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        let operation = match request.capability {
            Capability::ConfigureSource => Some("configure-source"),
            Capability::PublishCache => Some("publish-cache"),
            _ => None,
        };
        if let Some(capability) = operation {
            assert!(request.mutation.is_none());
            assert!(request.targets.is_empty());
            assert!(request.source_partition.is_none());
            self.calls.borrow_mut().push(TrustedCall {
                capability,
                source: request
                    .source
                    .ok_or(Error::new(
                        "checkpoint-error",
                        "Trusted source selectors missing",
                    ))?
                    .clone(),
            });
        }
        self.inner.authorize(principal, request)
    }
}
fn fresh(partition: &SourcePartition, generation_id: &str, at: &str) -> CacheStatus {
    CacheStatus {
        schema_version: 1,
        workspace_id: partition.workspace_id.clone(),
        home_id: partition.home_id.clone(),
        source_instance_id: partition.source_instance_id.clone(),
        collection_id: partition.collection_id.clone(),
        status: CacheState::Fresh,
        last_successful_fetch_at: Some(at.into()),
        last_attempt_at: Some(at.into()),
        generation_id: Some(generation_id.into()),
        consistency: "non-transactional-offset-pages".into(),
        error: None,
    }
}
fn main() -> CheckResult<()> {
    let root = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("fresh output directory required")?,
    );
    fs::create_dir(&directory)?;
    let path = directory.join("cache-healthy.sqlite");
    let oracle = Oracle::start(&root)?;
    let calls = Rc::new(RefCell::new(vec![]));
    let authorization = CacheAuthorization {
        inner: SyntheticAuthorization {
            oracle: oracle.clone(),
            contexts: Rc::new(RefCell::new(vec![])),
        },
        calls: calls.clone(),
    };
    let runtime = SyntheticRuntime {
        next: Rc::new(Cell::new(80_000)),
    };
    let principal = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let initial: Snapshot = load(&root, "plan-free.snapshot.json")?;
    let mut store = AtlasStore::open(
        &path,
        oracle.storage_contract(),
        authorization.clone(),
        runtime.clone(),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )?;
    store.initialize_synthetic(&initial)?;
    let before = store.read_snapshot(&principal, &scope)?;
    let homebox = SourcePartition {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(10),
        collection_id: "synthetic-collection-a".into(),
    };
    let prepared = store.prepare_cache_publication(&principal, &scope, &homebox)?;
    assert_eq!(prepared.state().cache_epoch, 0);
    assert_eq!(
        prepared.fence().baseline_generation_id(),
        Some(id(900).as_str())
    );
    assert_eq!(
        prepared.fence().baseline_cache_epoch().value(),
        prepared.state().cache_epoch
    );
    assert_eq!(prepared.fence().partition(), &homebox);
    assert!(!prepared.state().homebox_entities.is_empty());
    let mut projections = prepared.state().homebox_entities.clone();
    for projection in &mut projections {
        projection["retrievedAt"] = json!("2026-01-03T10:00:00.123Z");
    }
    let cache = fresh(
        &homebox,
        prepared.fence().reserved_generation_id(),
        "2026-01-03T11:00:00.123456+01:00",
    );
    let (prepared_state, prepared_fence) = prepared.into_parts();
    let published =
        store.publish_prepared_generation(&principal, prepared_fence, &cache, &projections, &[])?;
    let fetched = store.read_cache_for_publication(&principal, &scope, &homebox)?;
    assert_eq!(fetched.cache, Some(published.clone()));
    assert_eq!(fetched.cache_epoch, 1);
    assert_eq!(
        oracle.canonical(&fetched.homebox_entities)?,
        oracle.canonical(&projections)?
    );
    for (old, new) in prepared_state
        .homebox_entities
        .iter()
        .zip(&fetched.homebox_entities)
    {
        assert_eq!(old["sourceUpdatedAt"], new["sourceUpdatedAt"]);
        assert_eq!(old["entity"], new["entity"]);
    }
    let failure = store.record_cache_failure(
        &principal,
        &scope,
        &homebox,
        &CacheFailure {
            code: FailureCode::Timeout,
            status: None,
        },
    )?;
    assert_eq!(failure.status, CacheState::Error);
    assert_eq!(failure.generation_id, published.generation_id);
    assert_eq!(
        failure.last_successful_fetch_at,
        published.last_successful_fetch_at
    );
    assert_eq!(
        failure.last_attempt_at.as_deref(),
        Some("2026-01-03T12:00:00Z")
    );
    assert_eq!(
        failure.error.as_ref().map(|e| e.message.as_str()),
        Some("Source request timed out")
    );
    let retained = store.read_cache_for_publication(&principal, &scope, &homebox)?;
    assert_eq!(retained.cache_epoch, 2);
    assert_eq!(retained.homebox_entities, projections);
    let empty_prepared = store.prepare_cache_publication(&principal, &scope, &homebox)?;
    assert_eq!(
        empty_prepared.fence().baseline_generation_id(),
        published.generation_id.as_deref()
    );
    assert_eq!(empty_prepared.fence().baseline_cache_epoch().value(), 2);
    let empty_cache = fresh(
        &homebox,
        empty_prepared.fence().reserved_generation_id(),
        "2026-01-03T13:00:00Z",
    );
    store.publish_prepared_generation(
        &principal,
        empty_prepared.into_parts().1,
        &empty_cache,
        &[],
        &[],
    )?;
    let empty = store.read_cache_for_publication(&principal, &scope, &homebox)?;
    assert_eq!(empty.cache_epoch, 3);
    assert!(empty.homebox_entities.is_empty());
    assert!(empty.network_relations.is_empty());

    let registration = SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(25),
        collection_id: "synthetic-new-empty".into(),
        owner: SourceOwner::Homebox,
        partition_mode: PartitionMode::ExclusiveHome,
        allowed_external_ids: vec![],
    };
    assert_eq!(
        store.register_source_json(&principal, &serde_json::to_value(&registration)?)?,
        registration
    );
    let new = store.prepare_cache_publication(&principal, &scope, &registration.partition())?;
    assert!(new.state().cache.is_none());
    assert_eq!(new.state().cache_epoch, 0);
    assert!(new.state().homebox_entities.is_empty());
    assert!(new.fence().baseline_generation_id().is_none());
    let new_cache = fresh(
        &registration.partition(),
        new.fence().reserved_generation_id(),
        "2026-01-03T14:00:00Z",
    );
    store.publish_prepared_generation(&principal, new.into_parts().1, &new_cache, &[], &[])?;
    let new_state =
        store.read_cache_for_publication(&principal, &scope, &registration.partition())?;
    assert_eq!(new_state.cache_epoch, 1);
    assert_eq!(new_state.cache, Some(new_cache));

    let network = SourcePartition {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(12),
        collection_id: "inventory".into(),
    };
    let network_prepared = store.prepare_cache_publication(&principal, &scope, &network)?;
    assert!(network_prepared.state().cache.is_none());
    assert_eq!(network_prepared.state().cache_epoch, 0);
    assert!(!network_prepared.state().network_relations.is_empty());
    let relations = network_prepared.state().network_relations.clone();
    let network_cache = fresh(
        &network,
        network_prepared.fence().reserved_generation_id(),
        "2026-01-03T15:00:00Z",
    );
    store.publish_prepared_generation(
        &principal,
        network_prepared.into_parts().1,
        &network_cache,
        &[],
        &relations,
    )?;
    let network_state = store.read_cache_for_publication(&principal, &scope, &network)?;
    assert_eq!(network_state.cache_epoch, 1);
    assert_eq!(network_state.network_relations, relations);
    let after = store.read_snapshot(&principal, &scope)?;
    assert_eq!(after.records, before.records);
    assert_eq!(after.network_relations, before.network_relations);
    assert!(after.homebox_entities.is_empty());
    oracle.validate_snapshot(&after)?;
    let room = store.read_record(&principal, &scope, &reference(RecordType::Identity, 200))?;
    assert!(
        store
            .history(&principal, &scope, &room.reference())?
            .is_empty()
    );
    store.close()?;
    let mut reopened = AtlasStore::open(
        &path,
        oracle.storage_contract(),
        authorization,
        runtime,
        StoreOptions::default(),
    )?;
    assert_eq!(reopened.read_snapshot(&principal, &scope)?, after);
    assert_eq!(
        reopened.read_cache_for_publication(&principal, &scope, &homebox)?,
        empty
    );
    assert_eq!(
        reopened.read_cache_for_publication(&principal, &scope, &network)?,
        network_state
    );
    reopened.close()?;
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let count = |table: &str| {
        db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| {
            r.get::<_, u32>(0)
        })
    };
    assert_eq!(count("records")? as usize, initial.records.len());
    assert_eq!(count("binding_reservations")?, 3);
    assert_eq!(count("cache_generations")?, 5);
    assert_eq!(count("sources")?, 4);
    assert_eq!(count("cache_epochs")?, 4);
    assert_eq!(count("audits")?, 0);
    assert_eq!(count("receipts")?, 0);
    assert_eq!(count("batch_receipts")?, 0);
    let log = calls.borrow();
    assert_eq!(
        log.iter()
            .filter(|r| r.capability == "configure-source")
            .count(),
        2
    );
    assert!(
        oracle
            .counts
            .borrow()
            .get("timestamp")
            .is_some_and(|n| *n > 0)
    );
    fs::write(
        directory.join("evidence.json"),
        serde_json::to_vec_pretty(&json!({
        "lineage":DATABASE_LINEAGE,"sqliteVersion":rusqlite::version(),"recordRows":count("records")?,"bindingReservations":count("binding_reservations")?,
        "sourceRows":count("sources")?,"epochRows":count("cache_epochs")?,"reservedGenerations":count("cache_generations")?,
        "completePublications":4,"successfulSyntheticStatusPublications":1,"homeboxEpoch":empty.cache_epoch,"newSourceEpoch":new_state.cache_epoch,"networkEpoch":network_state.cache_epoch,
        "contractCalls":*oracle.counts.borrow(),"trustedAuthorizationCalls":*log,"retainedFailure":failure,"finalSnapshot":after,
        "peerScope":"AT51 native shapes/numeric types; offline published semantic/JCS oracle; synthetic authorization/runtime; no actual HomeBox/Network peer or source access",
        "deferred":"rejection, replay, quarantine/denial, fault/crash/concurrency, native peer integration, witness schemas"}))?,
    )?;
    println!(
        "healthy cache checkpoint: 4 complete publications; 1 successful synthetic timeout-status publication; durable epochs 3/1/1; 5 generation reservations; records/bindings retained; healthy reopen"
    );
    println!("evidence: {}", directory.join("evidence.json").display());
    Ok(())
}
