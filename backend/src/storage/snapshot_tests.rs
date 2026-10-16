//! Generated, healthy in-memory multihome reads; no provider or private state.
use super::*;
use crate::domain::native_semantics::NativeSemantics;
use std::{
    cell::{Cell, RefCell},
    hint::black_box,
    rc::Rc,
    time::Instant,
};

#[derive(Clone, Default)]
struct SyntheticAuthority {
    calls: Rc<RefCell<Vec<AuthorizationCall>>>,
    record_calls: bool,
}
#[derive(Clone, Debug, PartialEq)]
struct AuthorizationCall {
    capability: Capability,
    source: Option<Value>,
    partition: Option<SourcePartition>,
}
impl Authorization for SyntheticAuthority {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        actor: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        assert_eq!(request.scope.workspace_id, actor.workspace_id);
        assert_eq!(request.scope.home_id, actor.home_id);
        if let Some(partition) = request.source_partition {
            assert_eq!(partition.scope(), *request.scope);
        }
        if let Some(source) = request.source {
            assert!(value_in_scope(source, request.scope));
        }
        if self.record_calls {
            self.calls.borrow_mut().push(AuthorizationCall {
                capability: request.capability,
                source: request.source.cloned(),
                partition: request.source_partition.cloned(),
            });
        }
        Ok(actor.clone())
    }
}
struct SyntheticRuntime(Cell<u64>);
impl Runtime for SyntheticRuntime {
    fn now(&self) -> Result<String> {
        Ok("2026-01-02T12:00:00Z".into())
    }
    fn new_id(&self) -> Result<String> {
        let next = self.0.get();
        self.0.set(next + 1);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
        Err(Error::new(
            "invalid-transition",
            "This synthetic fixture has no available assets",
        ))
    }
}
type SyntheticStore =
    AtlasStore<NativeContract<NativeSemantics>, SyntheticAuthority, SyntheticRuntime>;
fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}
fn scope() -> Scope {
    Scope {
        workspace_id: id(1),
        home_id: id(2),
    }
}
fn actor(scope: &Scope) -> VerifiedActor {
    VerifiedActor {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
        actor_id: id(50),
    }
}

// Clone the checked-in public fixture into distinct homes in one workspace.
// Every UUID reference is remapped consistently; labels never establish joins.
fn remap(value: &mut Value, copy: u128, other_workspace: bool) {
    match value {
        Value::String(text) => {
            if *text == id(1) {
                if other_workspace {
                    *text = id(9);
                }
            } else if let Ok(uuid) = uuid::Uuid::parse_str(text) {
                *text = uuid::Uuid::from_u128(uuid.as_u128() + copy * 1_000_000).to_string();
            }
        }
        Value::Array(values) => {
            for value in values {
                remap(value, copy, other_workspace);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                remap(value, copy, other_workspace);
            }
        }
        _ => {}
    }
}
fn fixture(copies: usize, other_workspace: bool) -> Snapshot {
    let original: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))
    .unwrap();
    let mut combined = Snapshot::default();
    for copy in 0..copies + usize::from(other_workspace) {
        let is_other = other_workspace && copy == copies;
        let mut value = original.clone();
        remap(
            &mut value,
            if is_other { 0 } else { copy as u128 },
            is_other,
        );
        let mut next: Snapshot = serde_json::from_value(value).unwrap();
        let network = next
            .sources
            .iter()
            .find(|source| source["owner"] == "network")
            .unwrap();
        let mut cache = next.caches[0].clone();
        cache["sourceInstanceId"] = network["sourceInstanceId"].clone();
        cache["collectionId"] = network["collectionId"].clone();
        next.caches.push(cache);
        // Deliberately differ from key order: SQL must retain insertion order.
        next.records.reverse();
        next.sources.reverse();
        next.caches.reverse();
        next.homebox_entities.reverse();
        next.network_relations.reverse();
        combined.records.extend(next.records);
        combined.sources.extend(next.sources);
        combined.caches.extend(next.caches);
        combined.homebox_entities.extend(next.homebox_entities);
        combined.network_relations.extend(next.network_relations);
    }
    combined
}
fn open(initial: &Snapshot, authority: SyntheticAuthority) -> SyntheticStore {
    let mut store = AtlasStore::open(
        ":memory:",
        NativeContract::new(NativeSemantics::native()),
        authority,
        SyntheticRuntime(Cell::new(80_000)),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )
    .unwrap();
    store.initialize_synthetic(initial).unwrap();
    store
}
fn counts(snapshot: &Snapshot) -> [usize; 5] {
    [
        snapshot.records.len(),
        snapshot.sources.len(),
        snapshot.homebox_entities.len(),
        snapshot.caches.len(),
        snapshot.network_relations.len(),
    ]
}

#[test]
fn healthy_multihome_snapshot_order_and_authority() {
    let initial = fixture(4, true);
    let authority = SyntheticAuthority {
        record_calls: true,
        ..Default::default()
    };
    let calls = authority.calls.clone();
    let mut store = open(&initial, authority);
    let before = repo::snapshot(&store.db).unwrap();
    assert_eq!(before, initial);
    let mut remapped = serde_json::to_value(scope()).unwrap();
    remap(&mut remapped, 3, false);
    for selected in [
        scope(),
        Scope {
            workspace_id: id(1),
            home_id: id(3),
        },
        serde_json::from_value(remapped).unwrap(),
        Scope {
            workspace_id: id(9),
            home_id: id(2),
        },
        Scope {
            workspace_id: id(1),
            home_id: id(999),
        },
    ] {
        calls.borrow_mut().clear();
        let expected = before.scoped(&selected);
        let actual = store.read_snapshot(&actor(&selected), &selected).unwrap();
        assert_eq!(actual, expected);
        let observations = calls.borrow().clone();
        let rounds = observations
            .split(|call| call.capability == Capability::Read)
            .collect::<Vec<_>>();
        assert_eq!(rounds.len(), 4); // before reading, before commit, after commit
        assert!(rounds[0].is_empty());
        assert_eq!(rounds[1], rounds[2]);
        assert_eq!(rounds[2], rounds[3]);
        let stored_calls = calls.borrow().len();
        let borrowed = SyntheticAuthority {
            record_calls: true,
            ..Default::default()
        };
        assert_eq!(
            store
                .read_snapshot_with_authorization(&borrowed, &actor(&selected), &selected)
                .unwrap(),
            expected
        );
        assert_eq!(calls.borrow().len(), stored_calls);
        assert_eq!(*borrowed.calls.borrow(), observations);
        if !expected.sources.is_empty() {
            assert!(
                observations
                    .iter()
                    .any(|call| call.capability == Capability::ReadCache)
            );
        }
    }
    assert_eq!(repo::snapshot(&store.db).unwrap(), before);
}

#[test]
fn healthy_snapshot_keeps_tombstones_and_history() {
    let mut store = open(&fixture(2, true), SyntheticAuthority::default());
    let selected = scope();
    let principal = actor(&selected);
    let target = RecordRef {
        record_type: RecordType::Circuit,
        record_id: id(406),
    };
    let create: Mutation = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/create-circuit.mutation.json"
    ))
    .unwrap();
    let first = store
        .execute(&principal, &selected, &target, &create)
        .unwrap();
    let mut replace = create.clone();
    replace.mutation_id = id(300_001);
    replace.operation = Operation::Replace;
    replace.expected_revision = Some(1);
    let second = store
        .execute(&principal, &selected, &target, &replace)
        .unwrap();
    let mut retire = replace.clone();
    retire.mutation_id = id(300_002);
    retire.operation = Operation::Tombstone;
    retire.expected_revision = Some(2);
    retire.value = None;
    let third = store
        .execute(&principal, &selected, &target, &retire)
        .unwrap();
    assert_eq!(third.record.lifecycle, Lifecycle::Tombstoned);
    let snapshot = store.read_snapshot(&principal, &selected).unwrap();
    assert!(snapshot.records.contains(&third.record));
    assert_eq!(
        snapshot,
        repo::snapshot(&store.db).unwrap().scoped(&selected)
    );
    let mut restore = retire;
    restore.mutation_id = id(300_003);
    restore.operation = Operation::Restore;
    restore.expected_revision = Some(3);
    let fourth = store
        .execute(&principal, &selected, &target, &restore)
        .unwrap();
    let history = store.history(&principal, &selected, &target).unwrap();
    assert_eq!(
        history,
        vec![first.audit, second.audit, third.audit, fourth.audit]
    );
    assert_eq!(
        history
            .iter()
            .map(|audit| audit.result_revision)
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 4]
    );
    assert_eq!(
        store.read_snapshot(&principal, &selected).unwrap(),
        repo::snapshot(&store.db).unwrap().scoped(&selected)
    );
}

#[test]
#[ignore = "Explicit bounded synthetic performance measurement, not an ordinary CI gate"]
fn healthy_multihome_snapshot_profile() {
    println!(
        "snapshot_environment sqlite={} debug_assertions={} cache=warm storage=in-memory",
        rusqlite::version(),
        cfg!(debug_assertions)
    );
    for copies in [1, 16, 64] {
        let initial = fixture(copies, true);
        let fixture_sha = migrations::sha256(serde_json::to_vec(&initial).unwrap());
        let mut store = open(&initial, SyntheticAuthority::default());
        let selected = scope();
        let principal = actor(&selected);
        let expected = repo::snapshot(&store.db).unwrap().scoped(&selected);
        let result_sha = migrations::sha256(serde_json::to_vec(&expected).unwrap());
        for _ in 0..3 {
            assert_eq!(
                store.read_snapshot(&principal, &selected).unwrap(),
                expected
            );
        }
        let mut samples = Vec::new();
        for _ in 0..15 {
            let start = Instant::now();
            for _ in 0..5 {
                black_box(
                    store
                        .read_snapshot(black_box(&principal), black_box(&selected))
                        .unwrap(),
                );
            }
            samples.push(start.elapsed().as_micros() / 5);
        }
        println!(
            "snapshot_profile copies={copies} total={:?} selected={:?} fixture_sha256={fixture_sha} result_sha256={result_sha} warmup=3 groups=15 reads_per_group=5 group_mean_us={samples:?}",
            counts(&initial),
            counts(&expected)
        );
        samples.sort_unstable();
        println!(
            "snapshot_summary copies={copies} min_us={} median_us={} p95_us={} max_us={}",
            samples[0], samples[7], samples[14], samples[14]
        );
    }
}
