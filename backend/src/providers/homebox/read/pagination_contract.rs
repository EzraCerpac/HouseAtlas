//! Bounded in-memory stock-page contracts for #285. No HTTP, credentials or Store.
use super::*;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const SUCCESS: &str = "2026-10-25T10:00:00Z";
const ATTEMPT: &str = "2026-10-25T11:00:00Z";
const ORIGINAL: &str = "00000000-0000-4000-8000-000000000901";
const CANDIDATE: &str = "00000000-0000-4000-8000-000000000902";
const LOCATIONS: &str = include_str!("../wire/fixtures/locations.page.json");
const ITEMS: &str = include_str!("../wire/fixtures/items.page.json");
const LAST: &str = include_str!("../wire/fixtures/items-second.page.json");

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
struct ScriptedPages {
    scope: SourceScope,
    responses: VecDeque<Value>,
    calls: Arc<Mutex<Vec<GetRequest>>>,
}
type TestReader = HomeBoxReader<ScriptedPages, FixedClock>;
type Calls = Arc<Mutex<Vec<GetRequest>>>;
impl Transport for ScriptedPages {
    type Body = Chunks;
    async fn get(&mut self, request: GetRequest) -> Result<GetResponse<Self::Body>, ReadError> {
        assert_eq!(request.scope(), &self.scope);
        assert_eq!(request.method(), "GET");
        self.calls.lock().unwrap().push(request);
        let value = self.responses.pop_front().expect("unexpected fixture GET");
        let bytes = serde_json::to_vec(&value).unwrap();
        Ok(GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(bytes.chunks(7).map(|chunk| chunk.to_vec()).collect()),
        })
    }
}
fn value(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}
fn reader(responses: Vec<Value>, now: &'static str, max_pages: usize) -> (TestReader, Calls) {
    let fixture = value(include_str!(
        "../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
    ));
    let registration: SourceRegistration =
        serde_json::from_value(fixture["sourceRegistration"].clone()).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let transport = ScriptedPages {
        scope: registration.scope(),
        responses: responses.into(),
        calls: calls.clone(),
    };
    let reader = HomeBoxReader::new_stock(
        registration,
        transport,
        FixedClock(now),
        Limits {
            max_page_size: 2,
            max_pages,
            ..Limits::default()
        },
        None,
    )
    .unwrap();
    (reader, calls)
}
async fn previous() -> PreviousGeneration {
    // One location and one item, each with its own complete detail/maintenance.
    let mut items = value(ITEMS);
    items["items"].as_array_mut().unwrap().truncate(1);
    items["total"] = json!(1);
    let (mut reader, _) = reader(
        vec![
            value(LOCATIONS),
            items,
            value(include_str!("../wire/fixtures/location.detail.json")),
            json!([]),
            value(include_str!("../wire/fixtures/item.detail.json")),
            value(include_str!("../wire/fixtures/maintenance.json")),
        ],
        SUCCESS,
        4,
    );
    assert_eq!(reader.metadata_dialect(), "homebox-stock-v0.26.2");
    let complete = reader
        .fetch_generation(None, Uuid::parse(ORIGINAL).unwrap())
        .await
        .unwrap();
    assert_eq!(complete.entities().len(), 2);
    complete.previous()
}
fn incomplete_cases() -> Vec<(&'static str, Vec<Value>, usize)> {
    let mut short_first = value(ITEMS);
    short_first["items"].as_array_mut().unwrap().pop();
    let mut missing_last = value(LAST);
    missing_last["items"] = json!([]);
    // This page is internally complete for total=2, but disagrees with page 1.
    let mut drift = value(LAST);
    drift["total"] = json!(2);
    drift["items"] = json!([]);
    vec![
        ("short first page", vec![value(LOCATIONS), short_first], 4),
        (
            "missing final row",
            vec![value(LOCATIONS), value(ITEMS), missing_last],
            4,
        ),
        (
            "cross-page total drift",
            vec![value(LOCATIONS), value(ITEMS), drift],
            4,
        ),
        // The page budget includes both location and item partitions. No third
        // GET is allowed even though the item total requires a second item page.
        ("page budget", vec![value(LOCATIONS), value(ITEMS)], 2),
    ]
}

#[tokio::test(flavor = "current_thread")]
async fn incomplete_stock_pages_preserve_last_complete_generation() {
    let previous = previous().await;
    let saved_cache = previous.cache().clone();
    let saved_entities = previous.entities().to_vec();
    for (name, responses, max_pages) in incomplete_cases() {
        let expected_requests = responses.len();
        let (mut reader, calls) = reader(responses, ATTEMPT, max_pages);
        let failed = reader
            .fetch_generation(Some(&previous), Uuid::parse(CANDIDATE).unwrap())
            .await
            .expect_err(name);
        assert_eq!(failed.error.code, ErrorCode::Pagination, "{name}");
        assert_eq!(failed.error.message, ErrorCode::Pagination.message());
        assert_eq!(failed.error.at.as_str(), ATTEMPT);
        let proposed = failed.cache.as_ref().unwrap();
        assert_eq!(proposed.status, CacheState::Error);
        assert_eq!(proposed.generation_id, saved_cache.generation_id);
        assert_eq!(
            proposed.last_successful_fetch_at,
            saved_cache.last_successful_fetch_at
        );
        assert_eq!(proposed.last_attempt_at.as_ref().unwrap().as_str(), ATTEMPT);
        assert_eq!(proposed.error.as_ref(), Some(&failed.error));
        assert_eq!(failed.quarantine_transition, QuarantineTransition::Preserve);
        assert_eq!(failed.quarantine, Some(false));
        assert_eq!(previous.cache(), &saved_cache);
        assert_eq!(previous.entities(), saved_entities);
        assert_eq!(failed.stats.requests, expected_requests);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), expected_requests);
        for call in calls.iter() {
            // Abort before any detail/maintenance and expose no partial records.
            assert_eq!(call.path(), "/api/v1/entities");
            assert!(
                call.query()
                    .contains(&("includeArchived".into(), "true".into()))
            );
            assert!(!call.query().iter().any(|(key, _)| key == "parentIds"));
        }
        let serialized = serde_json::to_value(&failed).unwrap();
        assert!(serialized.get("homeboxEntities").is_none());
        assert!(!serialized.to_string().contains(CANDIDATE));
        let (aged, age) = cache_freshness(proposed, &Timestamp::parse(ATTEMPT).unwrap(), 1000);
        assert_eq!(age, Some(3_600_000));
        assert_eq!(aged.status, CacheState::Error);
        assert_eq!(
            aged.last_successful_fetch_at,
            saved_cache.last_successful_fetch_at
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn incomplete_first_stock_generation_is_unavailable_not_empty_success() {
    let (_, responses, max_pages) = incomplete_cases().remove(1);
    let (mut reader, _) = reader(responses, ATTEMPT, max_pages);
    let failed = reader
        .fetch_generation(None, Uuid::parse(CANDIDATE).unwrap())
        .await
        .unwrap_err();
    assert_eq!(failed.error.code, ErrorCode::Pagination);
    let proposed = failed.cache.unwrap();
    assert_eq!(proposed.status, CacheState::Error);
    assert!(proposed.generation_id.is_none());
    assert!(proposed.last_successful_fetch_at.is_none());
    let (aged, age) = cache_freshness(&proposed, &Timestamp::parse(ATTEMPT).unwrap(), 1000);
    assert_eq!(age, None);
    assert_eq!(aged.status, CacheState::Error);
}

#[tokio::test(flavor = "current_thread")]
async fn cached_generation_age_uses_success_time_at_the_exact_boundary() {
    let previous = previous().await;
    for (now, status, age) in [
        ("2026-10-25T10:00:01Z", CacheState::Fresh, 1000),
        ("2026-10-25T10:00:01.001Z", CacheState::Stale, 1001),
    ] {
        let (cache, actual_age) =
            cache_freshness(previous.cache(), &Timestamp::parse(now).unwrap(), 1000);
        assert_eq!(cache.status, status);
        assert_eq!(actual_age, Some(age));
        assert_eq!(cache.generation_id, previous.cache().generation_id);
        assert_eq!(
            cache.last_successful_fetch_at,
            previous.cache().last_successful_fetch_at
        );
        assert_eq!(cache.last_attempt_at, previous.cache().last_attempt_at);
    }
    assert_eq!(previous.cache().status, CacheState::Fresh);
}
