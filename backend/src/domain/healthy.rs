//! Only fixed healthy synthetic examples. These do not qualify access/storage
//! adapters or exercise the deferred rejection/fault/concurrency controls.

use super::*;
use serde_json::{Value, json};
use std::cell::Cell;

const PLAN_FREE: &str =
    include_str!("../../../packages/contracts/fixtures/plan-free.snapshot.json");
const MUTATION: &str =
    include_str!("../../../packages/contracts/fixtures/create-circuit.mutation.json");
const RESULT: &str =
    include_str!("../../../packages/contracts/fixtures/create-circuit.result.json");
const HISTORY_CONTEXT: &str =
    include_str!("../../../packages/contracts/history/fixtures/contexts.json");
const HISTORIES: [&str; 3] = [
    include_str!("../../../packages/contracts/history/fixtures/empty.audit-array.json"),
    include_str!("../../../packages/contracts/history/fixtures/recorded.audit-array.json"),
    include_str!("../../../packages/contracts/history/fixtures/tombstone.audit-array.json"),
];

fn scope() -> Scope {
    Scope {
        workspace_id: uuid(1),
        home_id: uuid(2),
    }
}

fn uuid(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

#[derive(Clone)]
struct SyntheticPrincipal;

struct SyntheticAccess {
    reads: Cell<usize>,
}

impl AccessPort<SyntheticPrincipal> for SyntheticAccess {
    fn authorize(
        &self,
        _: &SyntheticPrincipal,
        scope: &Scope,
        _: Capability,
    ) -> DomainResult<AuthorizedHome> {
        self.reads.set(self.reads.get() + 1);
        Ok(AuthorizedHome {
            home: HomeSummary {
                scope: scope.clone(),
                label: "Synthetic home".into(),
            },
            other_homes: Vec::new(),
            can_edit_homebox: true,
        })
    }

    fn revalidate(&self, _: &SyntheticPrincipal, _: &Scope, _: Capability) -> DomainResult<()> {
        // Only an injected healthy fixture principal exists in this example.
        // The concrete AT11 adapter must compare captured policy epochs.
        Ok(())
    }
}

struct SyntheticReads {
    snapshot: Snapshot,
    record: Option<Record>,
    audits: Vec<Audit>,
    snapshot_reads: usize,
}

impl ReadPort<SyntheticPrincipal> for SyntheticReads {
    fn snapshot(&mut self, _: &SyntheticPrincipal, _: &Scope) -> DomainResult<Snapshot> {
        self.snapshot_reads += 1;
        Ok(self.snapshot.clone())
    }
    fn record(&mut self, _: &SyntheticPrincipal, _: &Scope, _: &RecordRef) -> DomainResult<Record> {
        self.record.clone().ok_or(DomainError::NotFound)
    }
    fn history(
        &mut self,
        _: &SyntheticPrincipal,
        _: &Scope,
        _: &RecordRef,
    ) -> DomainResult<Vec<Audit>> {
        Ok(self.audits.clone())
    }
}

fn queries(snapshot: Snapshot) -> Queries<SyntheticReads, SyntheticAccess> {
    Queries {
        store: SyntheticReads {
            snapshot,
            record: None,
            audits: Vec::new(),
            snapshot_reads: 0,
        },
        access: SyntheticAccess {
            reads: Cell::new(0),
        },
    }
}

#[test]
fn healthy_plan_free_room_item_query_checkpoint() {
    let snapshot: Snapshot = serde_json::from_str(PLAN_FREE).unwrap();
    let wire: Value = serde_json::from_str(PLAN_FREE).unwrap();
    assert_eq!(serde_json::to_value(&snapshot).unwrap(), wire);
    let mut queries = queries(snapshot);
    let view = queries
        .current(&SyntheticPrincipal, &scope(), "2026-01-02T12:05:00Z", &[])
        .unwrap();
    assert_eq!(queries.store.snapshot_reads, 1);
    assert_eq!(queries.access.reads.get(), 2);
    assert_eq!(view.entries.len(), 4);
    assert_eq!(view.visible_entries(false).count(), 3);
    assert_eq!(view.rooms(false).len(), 0);
    assert_eq!(view.items(false).len(), 1);
    assert_eq!(view.unplaced_items(false)[0].entity.id, uuid(501));
    let cabinet = &view.entries[0];
    assert_eq!(cabinet.kind, EntryKind::Place);
    assert_eq!(cabinet.semantic_kind, SemanticKind::Unclassified);
    assert_eq!(
        cabinet.source_updated_at.as_deref(),
        Some("2025-12-01T00:00:00Z")
    );
    assert_eq!(cabinet.retrieved_at, "2026-01-02T12:00:00Z");
    assert_eq!(cabinet.cache_status, CacheState::Fresh);
    assert_eq!(view.children_of(&cabinet.key, true)[0].entity.id, uuid(502));
    assert_eq!(view.entries[3].kind, EntryKind::Unknown);
    assert_eq!(
        view.search("Synthetic manual", false)[0].entity.id,
        uuid(501)
    );
    let public = serde_json::to_value(&view).unwrap();
    assert_eq!(public["homes"][0].as_object().unwrap().len(), 3);
    assert!(
        public["entries"][1]["attachments"][0]
            .get("proxyRef")
            .is_none()
    );
    // Published routes are unverified, so current output has no edit capability.
    assert!(
        view.entries
            .iter()
            .all(|entry| entry.native_links.is_empty())
    );
}

#[test]
fn healthy_reviewed_room_and_media_capability_example() {
    let mut wire: Value = serde_json::from_str(PLAN_FREE).unwrap();
    let semantics = wire["records"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|r| r["recordType"] == "location-semantics")
        .unwrap();
    semantics["payload"]["semanticKind"] = json!("room");
    // This is an explicitly reviewed synthetic annotation, not classification
    // inferred from the Cabinet type, name, depth or parent relationship.
    let snapshot: Snapshot = serde_json::from_value(wire).unwrap();
    let item = &snapshot.homebox_entities[1];
    let media = MediaCapability {
        entity: SourceRef {
            scope: scope(),
            key: item.source.clone(),
        },
        attachment_id: uuid(800),
        download_href: Some(format!(
            "/api/atlas/media/{}/{}/synthetic/download",
            uuid(1),
            uuid(2)
        )),
        preview_href: None,
        preview_validated: false,
    };
    let mut queries = queries(snapshot);
    let view = queries
        .current(
            &SyntheticPrincipal,
            &scope(),
            "2026-01-02T12:05:00Z",
            &[media],
        )
        .unwrap();
    assert_eq!(view.rooms(false)[0].entity.id, uuid(500));
    assert_eq!(view.items(false)[0].atlas_id, Some(uuid(201)));
    let public = serde_json::to_value(&view).unwrap();
    assert!(
        public["entries"][1]["attachments"][0]["downloadHref"]
            .as_str()
            .unwrap()
            .ends_with("/download")
    );
    assert!(public["entries"][1]["attachments"][0]["previewHref"].is_null());
    assert_eq!(
        public["entries"][1]["attachments"][1]["url"],
        "https://manual.example.invalid/device"
    );
}

#[test]
fn healthy_recorded_history_examples_preserve_storage_order() {
    let contexts: Value = serde_json::from_str(HISTORY_CONTEXT).unwrap();
    let target: RecordRef = serde_json::from_value(contexts["record"].clone()).unwrap();
    for (index, history) in HISTORIES.iter().enumerate() {
        let mut queries = queries(serde_json::from_str(PLAN_FREE).unwrap());
        let mut record: Record = serde_json::from_value(
            contexts["cases"][index]
                .get("committedRecord")
                .cloned()
                .unwrap_or_else(|| {
                    serde_json::from_str::<Value>(RESULT).unwrap()["record"].clone()
                }),
        )
        .unwrap();
        if index == 0 {
            record.last_audit_id = uuid(10406)
        }
        queries.store.record = Some(record);
        queries.store.audits = serde_json::from_str(history).unwrap();
        assert_eq!(
            queries
                .record(&SyntheticPrincipal, &scope(), &target)
                .unwrap()
                .target,
            target
        );
        let audits = queries
            .history(&SyntheticPrincipal, &scope(), &target)
            .unwrap();
        assert_eq!(
            serde_json::to_value(audits).unwrap(),
            serde_json::from_str::<Value>(history).unwrap()
        );
    }
}

/// A deliberately bounded fixture-validation stub. The external healthy schema
/// checker validates these exact inputs against the actual published schema.
/// This adapter is not the production frozen-schema validator.
struct FixtureContracts {
    target: Value,
    command: Value,
    batch: Value,
}

impl ContractPort for FixtureContracts {
    fn validate(&self, shape: ContractShape, value: &Value) -> DomainResult<()> {
        let fixture = match shape {
            ContractShape::RecordRef => &self.target,
            ContractShape::Mutation => &self.command,
            ContractShape::BatchMutation => &self.batch,
        };
        if fixture == value {
            Ok(())
        } else {
            Err(DomainError::InvalidContract)
        }
    }
}

struct FixtureCommands {
    result: MutationResult,
    single_calls: usize,
    batch_calls: usize,
}

impl CommandPort<SyntheticPrincipal> for FixtureCommands {
    fn execute(
        &mut self,
        _: &SyntheticPrincipal,
        scope: &Scope,
        target: &RecordRef,
        command: &CanonicalMutation,
    ) -> DomainResult<MutationResult> {
        assert_eq!(scope, &self.result.record.scope);
        assert_eq!(target, &self.result.record.target);
        assert_eq!(
            command.wire(),
            &serde_json::from_str::<Value>(MUTATION).unwrap()
        );
        self.single_calls += 1;
        Ok(self.result.clone())
    }
    fn execute_batch(
        &mut self,
        _: &SyntheticPrincipal,
        _: &Scope,
        batch: &CanonicalBatch,
    ) -> DomainResult<BatchResult> {
        assert_eq!(batch.entries().len(), 1);
        self.batch_calls += 1;
        Ok(BatchResult {
            schema_version: 1,
            batch_id: batch.wire()["batchId"].as_str().unwrap().into(),
            results: vec![self.result.clone()],
            replayed: false,
        })
    }
}

#[test]
fn healthy_canonical_single_and_batch_delegation() {
    let result: MutationResult = serde_json::from_str(RESULT).unwrap();
    let target = result.record.target.clone();
    let wire: Value = serde_json::from_str(MUTATION).unwrap();
    let batch = json!({ "schemaVersion": 1, "batchId": uuid(1100), "reason": "Synthetic batch delegation",
        "commands": [{ "target": target, "command": wire }] });
    let mut commands = Commands {
        contracts: FixtureContracts {
            target: serde_json::to_value(&target).unwrap(),
            command: wire.clone(),
            batch: batch.clone(),
        },
        access: SyntheticAccess {
            reads: Cell::new(0),
        },
        store: FixtureCommands {
            result,
            single_calls: 0,
            batch_calls: 0,
        },
    };
    let result = commands
        .execute(&SyntheticPrincipal, &scope(), &target, wire)
        .unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        serde_json::from_str::<Value>(RESULT).unwrap()
    );
    let results = commands
        .execute_batch(&SyntheticPrincipal, &scope(), batch)
        .unwrap();
    assert_eq!(results.results.len(), 1);
    assert_eq!(commands.store.single_calls, 1);
    assert_eq!(commands.store.batch_calls, 1);
    assert_eq!(commands.access.reads.get(), 4);
}
