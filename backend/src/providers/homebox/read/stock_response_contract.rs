//! Synthetic late stock-response contracts for #285. No HTTP listener or Store.
//! These cases qualify failure carriers, not provider/native publication.
use super::*;
use serde_json::{Value, json};
use std::collections::VecDeque;

const SUCCESS: &str = "2026-10-25T10:00:00Z";
const ATTEMPT: &str = "2026-10-25T11:00:00Z";
const FACT: &str = "2026-01-02T03:04:05.1200+02:00";
const ORIGINAL: &str = "00000000-0000-4000-8000-000000000901";
const CANDIDATE: &str = "00000000-0000-4000-8000-000000000902";
const LOCATION: &str = "00000000-0000-4000-8000-000000000001";
const ITEM: &str = "00000000-0000-4000-8000-000000000002";

fn value(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}
fn registration() -> SourceRegistration {
    let fixture = value(include_str!(
        "../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
    ));
    serde_json::from_value(fixture["sourceRegistration"].clone()).unwrap()
}
struct FixedClock(&'static str);
impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse(self.0).unwrap()
    }
}
struct Chunks(VecDeque<Vec<u8>>);
impl Body for Chunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, ReadError> {
        Ok(self.0.pop_front())
    }
}
struct Step {
    path: String,
    query: Vec<(String, String)>,
    body: Value,
}
struct Script {
    scope: SourceScope,
    steps: VecDeque<Step>,
    calls: Vec<GetRequest>,
}
impl Transport for &mut Script {
    type Body = Chunks;
    async fn get(&mut self, request: GetRequest) -> Result<GetResponse<Chunks>, ReadError> {
        let step = self.steps.pop_front().expect("unexpected synthetic GET");
        assert_eq!(request.method(), "GET");
        assert_eq!(request.scope(), &self.scope);
        assert_eq!(request.path(), step.path);
        assert_eq!(request.query(), step.query);
        self.calls.push(request);
        let bytes = serde_json::to_vec(&step.body).unwrap();
        Ok(GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(bytes.chunks(7).map(|chunk| chunk.to_vec()).collect()),
        })
    }
}
fn script(maintenance: Value) -> Script {
    let mut items = value(include_str!("../wire/fixtures/items.page.json"));
    items["items"].as_array_mut().unwrap().truncate(1);
    items["total"] = json!(1);
    let page = |is_location: &str, body| Step {
        path: "/api/v1/entities".into(),
        query: vec![
            ("isLocation".into(), is_location.into()),
            ("includeArchived".into(), "true".into()),
            ("page".into(), "1".into()),
            ("pageSize".into(), "2".into()),
        ],
        body,
    };
    let detail = |id: &str, body| Step {
        path: format!("/api/v1/entities/{id}"),
        query: vec![],
        body,
    };
    let maintenance_step = |id: &str, body| Step {
        path: format!("/api/v1/entities/{id}/maintenance"),
        query: vec![("status".into(), "both".into())],
        body,
    };
    Script {
        scope: registration().scope(),
        steps: vec![
            page(
                "true",
                value(include_str!("../wire/fixtures/locations.page.json")),
            ),
            page("false", items),
            detail(
                LOCATION,
                value(include_str!("../wire/fixtures/location.detail.json")),
            ),
            maintenance_step(LOCATION, json!([])),
            detail(
                ITEM,
                value(include_str!("../wire/fixtures/item.detail.json")),
            ),
            maintenance_step(ITEM, maintenance),
        ]
        .into(),
        calls: vec![],
    }
}
fn reader<'a>(
    transport: &'a mut Script,
    now: &'static str,
) -> HomeBoxReader<&'a mut Script, FixedClock> {
    HomeBoxReader::new_stock(
        registration(),
        transport,
        FixedClock(now),
        Limits {
            max_page_size: 2,
            max_pages: 2,
            ..Limits::default()
        },
        None,
    )
    .unwrap()
}
fn assert_six_gets(script: &Script) {
    assert!(
        script.steps.is_empty(),
        "all six ordered responses were consumed"
    );
    assert_eq!(script.calls.len(), 6);
    let maintenance: Vec<_> = script
        .calls
        .iter()
        .filter(|call| call.path().ends_with("/maintenance"))
        .collect();
    assert_eq!(maintenance.len(), 2);
    for call in maintenance {
        assert_eq!(call.query(), &[("status".into(), "both".into())]);
    }
    assert_eq!(
        script.calls.last().unwrap().path(),
        format!("/api/v1/entities/{ITEM}/maintenance")
    );
}
async fn complete_baseline() -> CompleteGeneration {
    let mut transport = script(value(include_str!("../wire/fixtures/maintenance.json")));
    let mut reader = reader(&mut transport, SUCCESS);
    assert_eq!(reader.metadata_dialect(), "homebox-stock-v0.26.2");
    let complete = reader
        .fetch_generation(None, Uuid::parse(ORIGINAL).unwrap())
        .await
        .unwrap();
    drop(reader);
    assert_six_gets(&transport);
    assert_eq!(complete.stats().requests, 6);
    assert_eq!(complete.stats().pages, 2);
    assert_eq!(complete.cache().status, CacheState::Fresh);
    assert_eq!(
        complete.cache().generation_id.as_ref().unwrap().as_str(),
        ORIGINAL
    );
    assert_eq!(
        complete
            .cache()
            .last_successful_fetch_at
            .as_ref()
            .unwrap()
            .as_str(),
        SUCCESS
    );
    assert_eq!(complete.entities().len(), 2);
    assert_eq!(complete.entities()[0].entity.id.as_str(), LOCATION);
    assert_eq!(complete.entities()[1].entity.id.as_str(), ITEM);
    assert!(complete.entities()[0].maintenance.is_empty());
    assert_eq!(complete.entities()[1].maintenance.len(), 3);
    for projection in complete.entities() {
        assert_eq!(
            projection.source_updated_at.as_ref().unwrap().as_str(),
            FACT
        );
        assert_eq!(projection.retrieved_at.as_str(), SUCCESS);
        assert_eq!(projection.entity.quantity, Some(1.5));
        assert!(projection.entity.archived);
    }
    let native = complete.native_presence.as_ref().unwrap();
    assert_eq!(native.generation_id().as_str(), ORIGINAL);
    assert_eq!(native.responses().len(), 6);
    complete
}

#[tokio::test(flavor = "current_thread")]
async fn complete_stock_response_sequence_is_the_positive_control() {
    complete_baseline().await;
}

async fn assert_late_failure(
    final_maintenance: Value,
    code: ErrorCode,
    status: CacheState,
    transition: QuarantineTransition,
    quarantined: bool,
) {
    let complete = complete_baseline().await;
    let previous = complete.previous();
    let saved_cache = previous.cache().clone();
    let saved_entities = previous.entities().to_vec();
    let saved_native = complete.native_presence.as_ref().unwrap();
    let saved_responses: Vec<_> = saved_native
        .responses()
        .iter()
        .map(|r| {
            (
                r.path().to_owned(),
                r.retrieved_at().clone(),
                r.body().to_vec(),
            )
        })
        .collect();
    for with_previous in [true, false] {
        let mut transport = script(final_maintenance.clone());
        let mut reader = reader(&mut transport, ATTEMPT);
        let failed = reader
            .fetch_generation(
                with_previous.then_some(&previous),
                Uuid::parse(CANDIDATE).unwrap(),
            )
            .await
            .expect_err("the sixth response must reject the whole candidate");
        drop(reader);
        assert_six_gets(&transport);
        assert_eq!(failed.stats.requests, 6);
        assert_eq!(failed.stats.pages, 2);
        assert_eq!(failed.error.code, code);
        assert_eq!(failed.error.message, code.message());
        assert_eq!(failed.error.at.as_str(), ATTEMPT);
        assert_eq!(failed.quarantine_transition, transition);
        assert_eq!(failed.quarantine, Some(quarantined));
        let proposed = failed.cache.as_ref().unwrap();
        assert_eq!(proposed.status, status);
        assert_eq!(proposed.last_attempt_at.as_ref().unwrap().as_str(), ATTEMPT);
        assert_eq!(proposed.error.as_ref(), Some(&failed.error));
        if with_previous {
            assert_eq!(proposed.generation_id, saved_cache.generation_id);
            assert_eq!(
                proposed.last_successful_fetch_at,
                saved_cache.last_successful_fetch_at
            );
        } else {
            assert!(proposed.generation_id.is_none());
            assert!(proposed.last_successful_fetch_at.is_none());
        }
        // Full projection equality includes all facts, attachments, maintenance,
        // source dates and retrieval dates, including the completed location.
        assert_eq!(previous.cache(), &saved_cache);
        assert_eq!(previous.entities(), saved_entities);
        for (before, after) in saved_entities.iter().zip(previous.entities()) {
            assert_eq!(after.source_updated_at, before.source_updated_at);
            assert_eq!(after.retrieved_at, before.retrieved_at);
            assert_eq!(after.retrieved_at.as_str(), SUCCESS);
        }
        assert_eq!(saved_native.generation_id().as_str(), ORIGINAL);
        assert_eq!(
            saved_native
                .responses()
                .iter()
                .map(|r| (
                    r.path().to_owned(),
                    r.retrieved_at().clone(),
                    r.body().to_vec()
                ))
                .collect::<Vec<_>>(),
            saved_responses
        );
        // FailedRead has only a failure-metadata proposal: no partial location,
        // complete candidate, or native publication/capture carrier escapes.
        // No Store/native publication is invoked by these fixtures.
        let serialized = serde_json::to_value(&failed).unwrap();
        let mut keys: Vec<_> = serialized
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "cache",
                "error",
                "quarantine",
                "quarantineTransition",
                "stats"
            ]
        );
        assert!(!serialized.to_string().contains(CANDIDATE));
    }
}

#[tokio::test(flavor = "current_thread")]
async fn final_invalid_maintenance_date_preserves_previous_complete_facts() {
    let mut maintenance = value(include_str!("../wire/fixtures/maintenance.json"));
    maintenance[0]["scheduledDate"] = json!("2026-02-30");
    assert_late_failure(
        maintenance,
        ErrorCode::InvalidSchema,
        CacheState::Error,
        QuarantineTransition::Preserve,
        false,
    )
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn final_wrong_maintenance_item_quarantines_without_replacing_generation() {
    let mut maintenance = value(include_str!("../wire/fixtures/maintenance.json"));
    maintenance[0]["itemID"] = json!(LOCATION);
    assert_late_failure(
        maintenance,
        ErrorCode::WrongScope,
        CacheState::AccessRevoked,
        QuarantineTransition::Quarantine,
        true,
    )
    .await;
}
