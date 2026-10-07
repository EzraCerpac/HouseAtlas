//! Success-only synthetic examples. No fault/denial/concurrency/control cases.
use super::*;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const FIXTURE: &str =
    include_str!("../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json");
const MINIMAL: &str =
    include_str!("../../../../../packages/contracts/fixtures/homebox-page.wire.json");
const NOW: &str = "2026-10-06T10:00:00.000Z";
const GENERATION: &str = "00000000-0000-4000-8000-000000000999";
const LOCATION: &str = "00000000-0000-4000-8000-000000000500";
const ITEM: &str = "00000000-0000-4000-8000-000000000501";

#[derive(Clone)]
struct FixedClock;
impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse(NOW).unwrap()
    }
}
struct Chunks(VecDeque<Vec<u8>>);
impl Body for Chunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, ReadError> {
        Ok(self.0.pop_front())
    }
}
struct SyntheticTransport {
    scope: SourceScope,
    entities: Vec<Value>,
    maintenance: Value,
    calls: Arc<Mutex<Vec<GetRequest>>>,
    integral_page_numbers: bool,
}
impl Transport for SyntheticTransport {
    type Body = Chunks;
    async fn get(&mut self, request: GetRequest) -> Result<GetResponse<Chunks>, ReadError> {
        self.calls.lock().unwrap().push(request.clone());
        let value = if request.path() == "/api/v1/entities" {
            let query = |key: &str| {
                request
                    .query()
                    .iter()
                    .find(|(k, _)| k == key)
                    .unwrap()
                    .1
                    .clone()
            };
            let location = query("isLocation") == "true";
            let page = query("page").parse::<usize>().unwrap();
            let size = query("pageSize").parse::<usize>().unwrap();
            let parents: Vec<_> = request
                .query()
                .iter()
                .filter(|(k, _)| k == "parentIds")
                .map(|(_, v)| v.as_str())
                .collect();
            let rows: Vec<_> = self
                .entities
                .iter()
                .filter(|e| {
                    e["entityType"]["isLocation"].as_bool().unwrap_or(false) == location
                        && (parents.is_empty()
                            || e["parent"]["id"]
                                .as_str()
                                .is_some_and(|id| parents.contains(&id)))
                })
                .map(|e| {
                    let mut row = serde_json::Map::new();
                    for key in [
                        "id",
                        "name",
                        "archived",
                        "updatedAt",
                        "entityType",
                        "parent",
                    ] {
                        if let Some(v) = e.get(key) {
                            row.insert(key.into(), v.clone());
                        }
                    }
                    Value::Object(row)
                })
                .collect();
            let mut value = json!({ "items": rows.iter().skip((page - 1) * size).take(size).collect::<Vec<_>>(), "page": page, "pageSize": size, "total": rows.len() });
            if self.integral_page_numbers {
                for key in ["page", "pageSize", "total"] {
                    value[key] = json!(value[key].as_u64().unwrap() as f64);
                }
            }
            value
        } else if request.path().ends_with("/maintenance") {
            self.maintenance.clone()
        } else {
            let id = request.path().rsplit('/').next().unwrap();
            self.entities
                .iter()
                .find(|e| e["id"].as_str().unwrap().eq_ignore_ascii_case(id))
                .unwrap()
                .clone()
        };
        let bytes = serde_json::to_vec(&value).unwrap();
        // Split UTF-8 across owned chunks too; decode occurs after bounded assembly.
        Ok(GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(bytes.chunks(7).map(|c| c.to_vec()).collect()),
        })
    }
}
type TestReader = HomeBoxReader<SyntheticTransport, FixedClock>;
fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}
fn registration() -> SourceRegistration {
    serde_json::from_value(fixture()["sourceRegistration"].clone()).unwrap()
}
fn reader(
    entities: Vec<Value>,
    reg: SourceRegistration,
    limits: Limits,
    navigation: Option<NativeNavigation>,
) -> (TestReader, Arc<Mutex<Vec<GetRequest>>>) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let transport = SyntheticTransport {
        scope: reg.scope(),
        entities,
        maintenance: fixture()["maintenance"].clone(),
        calls: calls.clone(),
        integral_page_numbers: false,
    };
    (
        HomeBoxReader::new(reg, transport, FixedClock, limits, navigation).unwrap(),
        calls,
    )
}
fn metadata() -> Vec<Value> {
    fixture()["entities"].as_array().unwrap().clone()
}
fn generation_id() -> Uuid {
    Uuid::parse(GENERATION).unwrap()
}
fn emit(name: &str, value: Value) {
    if let Some(dir) = std::env::var_os("AT08_EVIDENCE_DIR") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    }
}
fn snapshot(g: &CompleteGeneration, reg: &SourceRegistration) -> Value {
    json!({ "contractVersion": "1.0.0", "synthetic": true, "sources": [{
        "workspaceId": reg.workspace_id, "homeId": reg.home_id, "sourceInstanceId": reg.source_instance_id,
        "collectionId": reg.collection_id, "owner": reg.owner, "partitionMode": reg.partition_mode, "allowedExternalIds": reg.allowed_external_ids
    }], "records": [], "caches": [g.cache()], "homeboxEntities": g.entities(), "networkRelations": [] })
}

#[tokio::test(flavor = "current_thread")]
async fn complete_fixture_generation_with_scoped_gets_and_pagination() {
    let reg = registration();
    let limits = Limits {
        max_page_size: 1,
        ..Limits::default()
    };
    let (mut r, calls) = reader(metadata(), reg.clone(), limits, None);
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    assert_eq!(g.entities().len(), 3);
    assert_eq!(g.stats().pages, 3);
    assert_eq!(g.stats().requests, 9);
    assert_eq!(g.cache().status, CacheState::Fresh);
    assert_eq!(
        g.cache()
            .last_successful_fetch_at
            .as_ref()
            .unwrap()
            .as_str(),
        NOW
    );
    assert_eq!(
        g.quarantine_transition(),
        QuarantineTransition::RevalidationCandidate
    );
    assert!(!g.deletion_confirmed());
    for c in calls.lock().unwrap().iter() {
        assert_eq!(c.method(), "GET");
        assert_eq!(c.tenant(), reg.collection_id);
        assert_eq!(c.scope(), &reg.scope());
        assert!(c.reject_redirects());
        assert!(c.path().starts_with("/api/v1/entities"));
        if c.path() == "/api/v1/entities" {
            assert!(
                c.query()
                    .contains(&("includeArchived".into(), "true".into()))
            );
        }
    }
    let item = g
        .entities()
        .iter()
        .find(|p| p.entity.id.as_str() == ITEM)
        .unwrap();
    assert_eq!(item.entity.parent.as_ref().unwrap().id.as_str(), LOCATION);
    assert_eq!(item.attachments.len(), 2);
    assert_eq!(item.maintenance.len(), 1);
    assert_eq!(
        item.source_updated_at.as_ref().unwrap().as_str(),
        "2026-01-01T00:00:00Z"
    );
    assert!(item.entity.manufacturer.is_none());
    assert!(item.native_links.is_empty());
    assert!(matches!(
        item.attachments[0],
        Attachment::StoredFile {
            proxy_ref: None,
            ..
        }
    ));
    emit("complete.snapshot.json", snapshot(&g, &reg));
}

#[tokio::test(flavor = "current_thread")]
async fn filtered_view_preserves_complete_cache_and_uses_repeated_parents() {
    let (mut r, calls) = reader(metadata(), registration(), Limits::default(), None);
    let complete = r.fetch_generation(None, generation_id()).await.unwrap();
    let prior = complete.previous();
    let saved_cache = prior.cache().clone();
    let view = r
        .fetch_view(&[Uuid::parse(LOCATION).unwrap(), Uuid::parse(ITEM).unwrap()])
        .await
        .unwrap();
    assert_eq!(view.homebox_entities.len(), 1);
    assert_eq!(view.homebox_entities[0].entity.id.as_str(), ITEM);
    assert_eq!(view.quarantine_transition(), QuarantineTransition::Preserve);
    assert_eq!(prior.cache(), &saved_cache);
    for c in calls
        .lock()
        .unwrap()
        .iter()
        .filter(|c| c.query().iter().any(|(k, _)| k == "parentIds"))
    {
        assert_eq!(
            c.query().iter().filter(|(k, _)| k == "parentIds").count(),
            2
        );
    }
    emit("filtered.view.json", serde_json::to_value(view).unwrap());
}

#[tokio::test(flavor = "current_thread")]
async fn empty_success_retains_missing_as_unresolved_candidates() {
    let reg = registration();
    let (mut full, _) = reader(metadata(), reg.clone(), Limits::default(), None);
    let original = full.fetch_generation(None, generation_id()).await.unwrap();
    let previous = original.previous();
    let saved = previous.cache().clone();
    let (mut empty, _) = reader(Vec::new(), reg.clone(), Limits::default(), None);
    let g = empty
        .fetch_generation(
            Some(&previous),
            Uuid::parse("00000000-0000-4000-8000-000000000998").unwrap(),
        )
        .await
        .unwrap();
    assert!(g.entities().is_empty());
    assert_eq!(g.cache().status, CacheState::Fresh);
    assert!(g.cache().generation_id.is_some());
    assert_eq!(g.missing_external_ids().len(), 3);
    assert!(!g.deletion_confirmed());
    assert_eq!(previous.cache(), &saved);
    emit("empty.snapshot.json", snapshot(&g, &reg));
}

#[tokio::test(flavor = "current_thread")]
async fn pinned_minimal_page_keeps_unknowns_and_arbitrary_container_type() {
    let page: Value = serde_json::from_str(MINIMAL).unwrap();
    let entities = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let mut v = v.clone();
            v["attachments"] = json!([]);
            v
        })
        .collect();
    let reg = registration();
    let (mut r, _) = reader(entities, reg.clone(), Limits::default(), None);
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    assert_eq!(g.entities().len(), 2);
    let cupboard = g
        .entities()
        .iter()
        .find(|p| p.entity.id.as_str() == LOCATION)
        .unwrap();
    assert_eq!(
        cupboard.entity.entity_type.as_ref().unwrap().name,
        "Cabinet"
    );
    assert!(cupboard.entity.quantity.is_none());
    assert!(g.entities().iter().any(|p| p.entity.entity_type.is_none()));
    emit("minimal.snapshot.json", snapshot(&g, &reg));
}

#[tokio::test(flavor = "current_thread")]
async fn uuid_normalization_preserves_opaque_collection_and_source_dates() {
    let mut reg = registration();
    reg.collection_id = "Synthetic-Opaque-A".into();
    let mut entity = metadata()[0].clone();
    entity["id"] = json!("ABCDEFAB-0000-4000-8000-000000000500");
    entity["entityType"]["id"] = json!("ABCDEFAB-0000-4000-8000-000000000700");
    entity["name"] = json!("Synthetic cupboard 🧰");
    entity["updatedAt"] = json!("2026-01-01T02:00:00.1200+02:00");
    entity["archived"] = json!(true);
    let (mut r, _) = reader(vec![entity], reg.clone(), Limits::default(), None);
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    assert_eq!(
        g.entities()[0].entity.id.as_str(),
        "abcdefab-0000-4000-8000-000000000500"
    );
    assert_eq!(g.entities()[0].source.collection_id, "Synthetic-Opaque-A");
    assert_eq!(
        g.entities()[0].source_updated_at.as_ref().unwrap().as_str(),
        "2026-01-01T02:00:00.1200+02:00"
    );
    assert!(g.entities()[0].entity.archived);
    emit("provenance.snapshot.json", snapshot(&g, &reg));
}

#[tokio::test(flavor = "current_thread")]
async fn reviewed_allowlist_projects_only_registered_entities() {
    let mut reg = registration();
    reg.partition_mode = PartitionMode::ReviewedEntityAllowlist;
    reg.allowed_external_ids = vec![Uuid::parse(LOCATION).unwrap()];
    let (mut r, calls) = reader(metadata(), reg.clone(), Limits::default(), None);
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    assert_eq!(g.entities().len(), 1);
    assert_eq!(g.entities()[0].entity.id.as_str(), LOCATION);
    assert_eq!(calls.lock().unwrap().len(), 4);
    emit("allowlist.snapshot.json", snapshot(&g, &reg));
}

#[tokio::test(flavor = "current_thread")]
async fn verified_synthetic_navigation_preserves_source_identity() {
    let reg = registration();
    let navigation = NativeNavigation {
        scope: reg.scope(),
        origin: "https://synthetic-homebox.example.invalid".into(),
        routes: vec![NativeRoute {
            intent: NativeIntent::Edit,
            verified: true,
            path: "/entities/{entityId}".into(),
        }],
    };
    let (mut r, _) = reader(metadata(), reg.clone(), Limits::default(), Some(navigation));
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    for p in g.entities() {
        assert_eq!(p.native_links.len(), 1);
        assert_eq!(p.native_links[0].entity.key, p.source);
        assert_eq!(
            p.native_links[0].href,
            format!(
                "https://synthetic-homebox.example.invalid/entities/{}",
                p.entity.id.as_str()
            )
        );
    }
    emit("navigation.snapshot.json", snapshot(&g, &reg));
}

#[tokio::test(flavor = "current_thread")]
async fn pure_freshness_calculation_keeps_success_time() {
    let (mut r, _) = reader(metadata(), registration(), Limits::default(), None);
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    let saved = g.cache().clone();
    let (aged, age) = cache_freshness(
        g.cache(),
        &Timestamp::parse("2026-10-06T11:00:00.000Z").unwrap(),
        1000,
    );
    assert_eq!(age, Some(3_600_000));
    assert_eq!(aged.status, CacheState::Stale);
    assert_eq!(
        aged.last_successful_fetch_at,
        saved.last_successful_fetch_at
    );
    assert_eq!(g.cache(), &saved);
}

#[tokio::test(flavor = "current_thread")]
async fn integral_json_float_spellings_publish_contract_valid_metadata() {
    let reg = registration();
    let mut entities = metadata();
    entities[1]["attachments"][0]["byteSize"] = json!(12.0);
    let transport = SyntheticTransport {
        scope: reg.scope(),
        entities,
        maintenance: fixture()["maintenance"].clone(),
        calls: Arc::new(Mutex::new(Vec::new())),
        integral_page_numbers: true,
    };
    let mut r =
        HomeBoxReader::new(reg.clone(), transport, FixedClock, Limits::default(), None).unwrap();
    let g = r.fetch_generation(None, generation_id()).await.unwrap();
    let item = g
        .entities()
        .iter()
        .find(|p| p.entity.id.as_str() == ITEM)
        .unwrap();
    assert!(matches!(
        item.attachments[0],
        Attachment::StoredFile {
            byte_size: Some(12),
            ..
        }
    ));
    assert_eq!(g.stats().pages, 2);
    emit("integral-floats.snapshot.json", snapshot(&g, &reg));

    // These are valid integral spellings in the same JSON Schema dialect.
    for spelling in ["12", "12.0", "12e0", "1.2e1"] {
        let raw = format!(r#"{{"items":[],"page":1.0,"pageSize":100e0,"total":{spelling}}}"#);
        let page = super::decode::page(super::decode::parse(raw.as_bytes()).unwrap()).unwrap();
        assert_eq!((page.page, page.page_size, page.total), (1, 100, 12));
        let raw = format!(
            r#"{{"kind":"stored-file","attachmentId":"00000000-0000-4000-8000-000000000801","title":"Synthetic","contentType":null,"byteSize":{spelling},"proxyRef":null}}"#
        );
        let a: Attachment = serde_json::from_str(&raw).unwrap();
        assert!(matches!(
            a,
            Attachment::StoredFile {
                byte_size: Some(12),
                ..
            }
        ));
    }
    let a: Attachment = serde_json::from_str(r#"{"kind":"stored-file","attachmentId":"00000000-0000-4000-8000-000000000801","title":"Synthetic unknown size","contentType":null,"byteSize":null,"proxyRef":null}"#).unwrap();
    assert!(matches!(
        a,
        Attachment::StoredFile {
            byte_size: None,
            ..
        }
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn literal_http_reference_representation_is_preserved() {
    let reg = registration();
    let urls = [
        "http://manual.example.invalid/file?q=synthetic",
        "https://manual.example.invalid/file?q=synthetic",
    ];
    for (i, url) in urls.iter().enumerate() {
        let mut entities = metadata();
        entities[1]["attachments"][1]["url"] = json!(url);
        let (mut r, _) = reader(entities, reg.clone(), Limits::default(), None);
        let g = r.fetch_generation(None, generation_id()).await.unwrap();
        let item = g
            .entities()
            .iter()
            .find(|p| p.entity.id.as_str() == ITEM)
            .unwrap();
        assert!(
            matches!(&item.attachments[1], Attachment::ExternalLink { url: actual, .. } if actual == url)
        );
        emit(
            &format!("literal-url-{i}.snapshot.json"),
            snapshot(&g, &reg),
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn original_valid_uri_syntax_and_escaped_spelling_are_preserved() {
    let reg = registration();
    let urls = [
        "https://manual.example.invalid/Synthetic%20Manual.pdf?q=part%2fA#section%202",
        "https://MANUAL.example.invalid/Caf%C3%A9.pdf?literal=%25&name=synthetic",
        "http://[2001:db8::1]:8080/manual%20reference?part=synthetic#intro",
        "https://manual.example.invalid/a;b=synthetic?note=a%2Bb&path=one/two",
    ];
    for (i, url) in urls.iter().enumerate() {
        let mut entities = metadata();
        entities[1]["attachments"][1]["url"] = json!(url);
        let (mut r, _) = reader(entities, reg.clone(), Limits::default(), None);
        let g = r.fetch_generation(None, generation_id()).await.unwrap();
        let item = g
            .entities()
            .iter()
            .find(|p| p.entity.id.as_str() == ITEM)
            .unwrap();
        assert!(
            matches!(&item.attachments[1], Attachment::ExternalLink { url: actual, .. } if actual == url)
        );
        emit(
            &format!("original-uri-{i}.snapshot.json"),
            snapshot(&g, &reg),
        );
    }
}
