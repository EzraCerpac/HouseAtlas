//! Small source-only plan fixture. Synthetic reference metadata is not a
//! production registry/proof. No deletion, maintenance, recovery or provider I/O.
use houseatlas_backend::{http::contracts::NativeContracts, providers::network as n, storage as s};
use n::DurableNetworkSidecar;
use serde_json::{Value, json};
use std::{cell::Cell, future::Future, pin::Pin, sync::Mutex};
type Check<T> = Result<T, Box<dyn std::error::Error>>;
const AT: &str = "2026-10-07T12:00:00Z";
const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}
struct SyntheticAuthority;
impl s::Authorization for SyntheticAuthority {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        actor: &s::VerifiedActor,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(request.scope.workspace_id, actor.workspace_id);
        assert_eq!(request.scope.home_id, actor.home_id);
        Ok(actor.clone())
    }
}
struct Clock(Cell<u64>);
impl s::Runtime for Clock {
    fn now(&self) -> s::Result<String> {
        Ok(AT.into())
    }
    fn new_id(&self) -> s::Result<String> {
        let id = self.0.get();
        self.0.set(id + 1);
        Ok(crate::id(id))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "fixture-only",
            "No asset in this source fixture",
        ))
    }
}
struct UnusedStage;
impl s::OriginalStagedCachePublication for UnusedStage {
    fn registration(&self) -> &s::SourceRegistration {
        unreachable!("No publication through fixture references")
    }
    fn cache(&self) -> &s::CacheStatus {
        unreachable!("No publication through fixture references")
    }
    fn homebox_entities(&self) -> &[Value] {
        &[]
    }
    fn network_relations(&self) -> &[Value] {
        &[]
    }
    fn native_sha256(&self) -> &str {
        HASH
    }
}
struct Reference {
    registration: s::SourceRegistration,
    generation: String,
    digest: Option<String>,
    reason: s::CacheProtectionReason,
}
struct SyntheticReferences {
    entries: Vec<Reference>,
    coverage: s::CacheReferenceCoverage,
}
struct ReferenceGuard<'a>(&'a mut SyntheticReferences);
impl s::OriginalCacheReferences for SyntheticReferences {
    type Staged = UnusedStage;
    type Guard<'a> = ReferenceGuard<'a>;
    fn lock(&mut self) -> s::Result<Self::Guard<'_>> {
        Ok(ReferenceGuard(self))
    }
}
impl s::OriginalCacheReferenceGuard for ReferenceGuard<'_> {
    type Staged = UnusedStage;
    type Admission = ();
    fn enumerate(&mut self, sink: &mut s::CacheProtectionSink<'_>) -> s::Result<()> {
        for entry in &self.0.entries {
            sink.protect(
                &entry.registration,
                &entry.generation,
                entry.digest.as_deref(),
                entry.reason,
            )?;
        }
        Ok(())
    }
    fn reclamation_coverage(&self) -> s::CacheReferenceCoverage {
        self.0.coverage
    }
    fn verify_staged(&mut self, _: &UnusedStage) -> s::Result<()> {
        Err(s::Error::new("fixture-only", "No staged custody"))
    }
    fn verify_unpublished(&mut self, _: &UnusedStage) -> s::Result<()> {
        Err(s::Error::new("fixture-only", "No unpublished proof"))
    }
    fn admit_candidate(
        &mut self,
        _: &s::SourceRegistration,
        _: &str,
        _: u64,
        _: s::CacheCapacityLimits,
        _: &[s::ProtectedCacheGeneration],
    ) -> s::Result<()> {
        Err(s::Error::new(
            "fixture-only",
            "No admission in plan fixture",
        ))
    }
}
fn reference(
    source: &s::SourceRegistration,
    generation: &str,
    reason: s::CacheProtectionReason,
) -> Reference {
    Reference {
        registration: source.clone(),
        generation: generation.into(),
        digest: Some(HASH.into()),
        reason,
    }
}
fn policy(
    source: &s::SourceRegistration,
    generation: &str,
) -> s::Result<s::CacheReclamationPolicy> {
    s::CacheReclamationPolicy::new(
        "synthetic-explicit-owner/1".into(),
        vec![s::CacheReclamationRequest::archived_payload(
            source.clone(),
            generation.into(),
            HASH.into(),
        )?],
    )
}
struct Inventory(n::SourceScope);
fn core_state(path: &std::path::Path) -> Check<Value> {
    let mut db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let transaction = db.transaction()?;
    let mut state = serde_json::Map::new();
    for (table, columns) in [
        (
            "sources",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,body)",
        ),
        (
            "caches",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,body)",
        ),
        (
            "projections",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,external_id,body)",
        ),
        (
            "network_relations",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,external_id,body)",
        ),
        (
            "cache_generations",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,generation_id)",
        ),
        (
            "cache_epochs",
            "json_array(workspace_id,home_id,source_instance_id,collection_id,epoch)",
        ),
    ] {
        let suffix = match table {
            "cache_generations" => ",generation_id",
            "projections" | "network_relations" => ",external_id",
            _ => "",
        };
        let rows = transaction
            .prepare(&format!("SELECT {columns} FROM {table} ORDER BY workspace_id,home_id,source_instance_id,collection_id{suffix}"))?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        state.insert(table.into(), serde_json::to_value(rows)?);
    }
    transaction.commit()?;
    Ok(Value::Object(state))
}
impl n::InventoryTransport for Inventory {
    fn get_inventory(
        &self,
        request: n::InventoryGet,
        _: n::Limits,
    ) -> Pin<Box<dyn Future<Output = Result<n::InventoryResponse, n::NetworkError>> + Send + '_>>
    {
        assert_eq!(
            (request.method(), request.path()),
            ("GET", "/api/inventory")
        );
        Box::pin(async {
            Ok(n::InventoryResponse {
                status: 200,
                source: Some(self.0.clone()),
                body: include_bytes!(
                    "../../../../../../adapters/network/fixtures/inventory.wire.json"
                )
                .to_vec(),
                source_snapshot_at: None,
                redirected: false,
                location: None,
                url: None,
            })
        })
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Check<()> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-reference-plan-")
        .tempdir()?;
    let db_path = directory.path().join("core.sqlite");
    let source: s::SourceRegistration = serde_json::from_value(
        json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]}),
    )?;
    let actor = s::VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let mut store = s::AtlasStore::open(
        &db_path,
        NativeContracts,
        SyntheticAuthority,
        Clock(Cell::new(100)),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    let historical = id(90);
    let historical_cache = json!({"schemaVersion":1,"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","status":"fresh","lastSuccessfulFetchAt":AT,"lastAttemptAt":AT,"generationId":historical,"consistency":"non-transactional-offset-pages","error":null});
    // Approved fresh synthetic bootstrap establishes a historical burned ID,
    // without fabricating or dropping a live original Store pin. Actual prepared
    // pins remain conservative even after the legacy metadata commit.
    store.initialize_synthetic(&s::Snapshot {
        sources: vec![serde_json::to_value(&source)?],
        caches: vec![historical_cache],
        ..Default::default()
    })?;
    let mut published = vec![historical];
    // One actual SQL publication makes that generation superseded. Empty rows
    // are synthetic fixture setup, not an original Native proof.
    {
        let prepared =
            store.prepare_cache_publication(&actor, &source.scope(), &source.partition())?;
        let (_, fence) = prepared.into_parts();
        let generation = fence.reserved_generation_id().to_owned();
        let cache: s::CacheStatus = serde_json::from_value(
            json!({"schemaVersion":1,"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","status":"fresh","lastSuccessfulFetchAt":AT,"lastAttemptAt":AT,"generationId":generation,"consistency":"non-transactional-offset-pages","error":null}),
        )?;
        store.publish_prepared_generation(&actor, fence, &cache, &[], &[])?;
        published.push(generation);
    }
    let prepared = store.prepare_cache_publication(&actor, &source.scope(), &source.partition())?;
    let (_, inflight) = prepared.into_parts();
    let inflight_id = inflight.reserved_generation_id().to_owned();
    let before = core_state(&db_path)?;
    let old = &published[0];
    let current = &published[1];
    let mut refs = SyntheticReferences {
        entries: vec![reference(&source, old, s::CacheProtectionReason::Archive)],
        coverage: s::CacheReferenceCoverage::Complete,
    };
    {
        let mut guard = store.guard_cache_residency(&mut refs)?;
        let plan = guard.plan_reclamation(&policy(&source, old)?)?;
        assert!(
            guard
                .protected()
                .iter()
                .any(|entry| entry.generation_id() == inflight_id
                    && entry.origin() == s::CacheProtectionOrigin::StorePin)
        );
        assert!(
            !plan
                .entries
                .iter()
                .find(|entry| entry.generation_id == inflight_id)
                .unwrap()
                .owner_policy_candidate()
        );
        let entry = plan
            .entries
            .iter()
            .find(|entry| &entry.generation_id == old)
            .unwrap();
        assert!(entry.owner_policy_candidate());
        assert!(entry.burned_identifier_present);
        // Add a real retained-reference reason through this same owner's held
        // guard. Plan must refresh rather than use its earlier archive snapshot.
        guard.original_references().0.entries.push(reference(
            &source,
            old,
            s::CacheProtectionReason::Recovery,
        ));
        let refreshed = guard.plan_reclamation(&policy(&source, old)?)?;
        assert!(
            refreshed
                .entries
                .iter()
                .find(|entry| &entry.generation_id == old)
                .unwrap()
                .blockers
                .contains(&s::CacheReclamationBlocker::RetainedReference(
                    s::CacheProtectionReason::Recovery
                ))
        );
        guard.release().1?;
    }
    for reason in [
        s::CacheProtectionReason::History,
        s::CacheProtectionReason::Disclosure,
        s::CacheProtectionReason::InFlightOrAmbiguous,
        s::CacheProtectionReason::StagedOrAmbiguous,
    ] {
        refs.entries = vec![
            reference(&source, old, s::CacheProtectionReason::Archive),
            reference(&source, old, reason),
        ];
        let mut guard = store.guard_cache_residency(&mut refs)?;
        let plan = guard.plan_reclamation(&policy(&source, old)?)?;
        assert!(
            plan.entries
                .iter()
                .find(|entry| &entry.generation_id == old)
                .unwrap()
                .blockers
                .contains(&s::CacheReclamationBlocker::RetainedReference(reason))
        );
        guard.release().1?;
    }
    refs.entries = vec![reference(
        &source,
        current,
        s::CacheProtectionReason::Archive,
    )];
    {
        let mut guard = store.guard_cache_residency(&mut refs)?;
        let plan = guard.plan_reclamation(&policy(&source, current)?)?;
        assert!(
            plan.entries
                .iter()
                .find(|entry| &entry.generation_id == current)
                .unwrap()
                .blockers
                .contains(&s::CacheReclamationBlocker::RetainedReference(
                    s::CacheProtectionReason::Current
                ))
        );
        guard.release().1?;
    }
    refs.coverage = s::CacheReferenceCoverage::Unknown;
    refs.entries = vec![reference(&source, old, s::CacheProtectionReason::Archive)];
    {
        let mut guard = store.guard_cache_residency(&mut refs)?;
        assert!(
            guard
                .plan_reclamation(&policy(&source, old)?)?
                .entries
                .iter()
                .all(|entry| !entry.owner_policy_candidate())
        );
        guard.release().1?;
    }
    // Actual Network owner, actual projection row, no archived capture: the
    // complete persisted scan must retain that unpaired row and unknown leases.
    let network_source: n::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&source)?)?;
    let review: n::LinkReview = serde_json::from_str(include_str!(
        "../../../../../../adapters/network/fixtures/link-review.json"
    ))?;
    let mut sidecar = n::SqliteNetworkSidecar::open(
        &directory.path().join("projection.sqlite"),
        std::slice::from_ref(&network_source),
    )?;
    let outcome =
        n::NetworkProvider::new(network_source.clone(), review.clone(), n::Limits::default())?
            .prepare_refresh(
                &n::RetainedState::empty(network_source.scope.clone()),
                0,
                &id(999),
                &Inventory(network_source.scope.clone()),
                || AT.into(),
            )
            .await?;
    let proposal = match outcome {
        n::RefreshOutcome::Complete(proposal) => proposal,
        _ => return Err("Expected fixture proposal".into()),
    };
    let row = n::stage_row(&network_source, &proposal)?;
    sidecar.stage(&network_source, &row)?;
    let sidecar = Mutex::new(sidecar);
    let mut native =
        n::NetworkCacheReferences::new(&sidecar, &network_source, &review, n::Limits::default());
    {
        let mut guard = store.guard_cache_residency(&mut native)?;
        assert!(
            guard
                .protected()
                .iter()
                .any(|entry| entry.generation_id() == id(999)
                    && entry.reason() == s::CacheProtectionReason::StagedOrAmbiguous)
        );
        let plan = guard.plan_reclamation(&policy(&source, &id(999))?)?;
        assert_eq!(plan.coverage, s::CacheReferenceCoverage::Unknown);
        assert!(
            plan.entries
                .iter()
                .all(|entry| !entry.owner_policy_candidate())
        );
        guard.release().1?;
    }
    assert_eq!(core_state(&db_path)?, before);
    let db = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let ids = db
        .prepare("SELECT generation_id FROM cache_generations ORDER BY generation_id")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    assert_eq!(ids, published);
    drop(db);
    sidecar
        .into_inner()
        .map_err(|_| "Fixture mutex poisoned")?
        .close()?;
    drop(inflight);
    store.close()?;
    let path = directory.path().to_owned();
    drop(directory);
    assert!(!path.exists());
    println!(
        "PASS explicit owner candidate metadata; current/history/pins/disclosure/recovery/unknown protections; fresh same-Store enumeration; unpaired actual Network row; burned IDs unchanged; temporary state removed; no deletion/maintenance"
    );
    Ok(())
}
