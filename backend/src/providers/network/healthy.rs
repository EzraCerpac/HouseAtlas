//! Authorized positive examples only. No denial, mutation/omission control,
//! adversarial, failure, crash, concurrency or negative-consumer execution.
use super::*;
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};

const WIRE: &str = include_str!("../../../../adapters/network/fixtures/inventory.wire.json");
const REVIEW: &str = include_str!("../../../../adapters/network/fixtures/link-review.json");
const AT: &str = "2026-01-02T12:00:00Z";
const ID: &str = "00000000-0000-4000-8000-000000000901";
pub(super) fn source() -> SourceRegistration {
    SourceRegistration {
        scope: SourceScope {
            workspace_id: "00000000-0000-4000-8000-000000000001".into(),
            home_id: "00000000-0000-4000-8000-000000000002".into(),
            source_instance_id: "00000000-0000-4000-8000-000000000012".into(),
            collection_id: "inventory".into(),
        },
        owner: "network".into(),
        partition_mode: PartitionMode::ExclusiveHome,
        allowed_external_ids: vec![],
    }
}
pub(super) fn review() -> LinkReview {
    serde_json::from_str(REVIEW).unwrap()
}
fn generation(source: &SourceRegistration, document: &[u8]) -> NetworkGeneration {
    project_capture(
        source,
        NetworkCapture {
            source: &source.scope,
            document,
            retrieved_at: AT,
            source_snapshot_at: None,
        },
        &review(),
        Limits::default(),
    )
    .unwrap()
}
fn state(source: &SourceRegistration, generation: NetworkGeneration) -> RetainedState {
    RetainedState {
        cache: CacheMetadata {
            schema_version: 1,
            scope: source.scope.clone(),
            status: CacheStatus::Fresh,
            last_successful_fetch_at: Some(AT.into()),
            last_attempt_at: Some(AT.into()),
            generation_id: Some(ID.into()),
            consistency: "non-transactional-offset-pages".into(),
            error: None,
        },
        generation: Some(generation),
    }
}
struct HealthyTransport {
    source: SourceScope,
    calls: AtomicUsize,
}
impl InventoryTransport for HealthyTransport {
    fn get_inventory(
        &self,
        request: InventoryGet,
        limits: Limits,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<InventoryResponse, NetworkError>> + Send + '_>,
    > {
        assert_eq!(
            (request.method(), request.path()),
            ("GET", "/api/inventory")
        );
        assert!(limits.max_response_bytes >= WIRE.len());
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(InventoryResponse {
                status: 200,
                source: Some(self.source.clone()),
                body: WIRE.as_bytes().to_vec(),
                source_snapshot_at: None,
                redirected: false,
                location: None,
                url: None,
            })
        })
    }
}
#[test]
fn healthy_published_projection_and_facet() {
    let source = source();
    let generation = generation(&source, WIRE.as_bytes());
    let member = &generation.network_relations[0];
    assert_eq!(member.kind, RelationKind::Membership);
    assert_eq!(member.from.id.as_deref(), Some("interface-a"));
    assert_eq!(member.to.id.as_deref(), Some("segment-a"));
    assert_eq!(member.source_confidence, "confirmed");
    assert_eq!(member.evidence_basis, EvidenceBasis::OwnerReport);
    assert_eq!(member.fact_at.as_deref(), Some("2025-12-01T00:00:00Z"));
    assert_eq!(
        generation.network_relations[2].fact_at.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
    assert_eq!(
        generation.network_relations[3].to,
        NetworkEndpoint {
            kind: EndpointKind::Unresolved,
            id: None,
            description: Some("Unknown peer".into())
        }
    );
    assert_eq!(generation.inventory.links[0].value["from"], "segment-a");
    let state = state(&source, generation);
    let facet = build_facet(&source, &state, AT, 300_000).unwrap();
    assert_eq!(facet.status, FacetStatus::Fresh);
    assert_eq!(facet.current_claims.len(), 3);
    assert_eq!(facet.history.len(), 1);
    assert_eq!(facet.history[0].temporal_status, TemporalStatus::Disputed);
    assert_eq!(facet.groups[0].source_kind, SourceKind::Group);
    assert_eq!(facet.segments[0].source_kind, SourceKind::Segment);
    assert!(
        !facet.capabilities.writes
            && !facet.capabilities.physical_placement
            && !facet.capabilities.electrical_circuits
    );
    let later = build_facet(&source, &state, "2026-01-02T13:00:00Z", 300_000).unwrap();
    assert_eq!(later.status, FacetStatus::Stale);
    assert_eq!(later.age_ms, Some(3_600_000));
}
#[tokio::test(flavor = "current_thread")]
async fn healthy_transport_complete_proposal_and_sidecar_reopen() {
    let source = source();
    let transport = HealthyTransport {
        source: source.scope.clone(),
        calls: AtomicUsize::new(0),
    };
    let mut provider = NetworkProvider::new(source.clone(), review(), Limits::default()).unwrap();
    let prior = RetainedState::empty(source.scope.clone());
    assert_eq!(provider.read(&prior).unwrap(), prior);
    let RefreshOutcome::Complete(proposal) = provider
        .prepare_refresh(&prior, 7, ID, &transport, || AT.into())
        .await
        .unwrap()
    else {
        panic!("healthy fixture must produce complete proposal")
    };
    assert_eq!(prior.cache.status, CacheStatus::Empty);
    assert_eq!(
        proposal.precondition(),
        &PublicationPrecondition {
            expected_generation_id: None,
            expected_cache_epoch: 7
        }
    );
    let row = stage_row(&source, &proposal).unwrap();
    validate_immutable_replay(None, &row).unwrap();
    validate_immutable_replay(Some(&row), &row).unwrap();
    let complete = proposal.state();
    let relations = &complete.generation.as_ref().unwrap().network_relations;
    let reopened =
        reopen_sidecar(&source, &complete.cache, relations, &row, Some(&review())).unwrap();
    assert_eq!(reopened, *complete);
    assert_eq!(provider.read(&reopened).unwrap(), reopened);
    build_facet(&source, &reopened, AT, 300_000).unwrap();
    build_facet(&source, &reopened, "2026-01-02T13:00:00Z", 300_000).unwrap();
    let packet = SidecarPacket {
        format: SIDECAR_FORMAT.into(),
        rows: vec![row],
    };
    assert_eq!(
        validate_sidecar_packet(&packet, &[source]).unwrap(),
        vec![reopened]
    );
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
}
#[test]
fn healthy_partitioned_observations_preserve_source_times_and_invalidation() {
    let mut document: Value = serde_json::from_str(WIRE).unwrap();
    document["observations"] = json!([
        {"id":"observation-invalidated","collectorId":"synthetic-collector","deviceId":"device-a","interfaceId":"interface-a",
            "kind":"association","timestamp":"2025-12-01T00:00:00Z","vantagePoint":"synthetic-router",
            "invalidatedAt":"2025-12-02T00:00:00Z","value":{"status":"unreachable"}},
        {"id":"observation-recent","collectorId":"synthetic-collector","deviceId":"device-a","kind":"association",
            "timestamp":"2026-01-02T11:59:00Z","vantagePoint":"synthetic-router","value":{"status":"reported"}},
        {"id":"observation-stale","collectorId":"synthetic-collector","deviceId":"device-b","kind":"association",
            "timestamp":"2025-12-01T00:00:00Z","vantagePoint":"synthetic-router","value":{"status":"unknown"}}
    ]);
    let mut source = source();
    source.partition_mode = PartitionMode::ReviewedEntityAllowlist;
    source.allowed_external_ids = [
        "group-a",
        "device-a",
        "device-b",
        "interface-a",
        "segment-a",
        "member-a",
        "association-a",
        "connection-a",
        "gap-a",
        "observation-invalidated",
        "observation-recent",
        "observation-stale",
    ]
    .iter()
    .map(|value| (*value).into())
    .collect();
    let bytes = serde_json::to_vec(&document).unwrap();
    let generation = project_capture(
        &source,
        NetworkCapture {
            source: &source.scope,
            document: &bytes,
            retrieved_at: AT,
            source_snapshot_at: Some("2026-01-02T11:00:00Z"),
        },
        &review(),
        Limits::default(),
    )
    .unwrap();
    assert_eq!(
        generation.observations[0].value,
        document["observations"][0]
    );
    assert_eq!(generation.observations[0].retrieved_at, AT);
    let facet = build_facet(&source, &state(&source, generation), AT, 300_000).unwrap();
    assert_eq!(
        facet.source_snapshot_at.as_deref(),
        Some("2026-01-02T11:00:00Z")
    );
    assert_eq!(
        facet
            .observations
            .iter()
            .map(|row| row.freshness)
            .collect::<Vec<_>>(),
        vec![
            ObservationFreshness::Invalidated,
            ObservationFreshness::Recent,
            ObservationFreshness::Stale
        ]
    );
}
#[test]
fn healthy_verbatim_blank_and_unicode_source_labels() {
    let mut document: Value = serde_json::from_str(WIRE).unwrap();
    document["inventory"]["rooms"][0]["name"] = json!("");
    document["inventory"]["devices"][0]["name"] = json!(" ".repeat(2000));
    document["inventory"]["devices"][0]["kind"] = json!("");
    document["inventory"]["interfaces"][0]["name"] = json!("🧭".repeat(1000));
    let source = source();
    let generation = generation(&source, &serde_json::to_vec(&document).unwrap());
    assert_eq!(generation.inventory.groups[0].value["name"], "");
    assert_eq!(
        generation.inventory.devices[0].value["name"],
        " ".repeat(2000)
    );
    assert_eq!(generation.inventory.devices[0].value["kind"], "");
    assert_eq!(
        generation.inventory.interfaces[0].value["name"],
        "🧭".repeat(1000)
    );
    let facet = build_facet(&source, &state(&source, generation), AT, 300_000).unwrap();
    assert_eq!(facet.devices[0].external_id, "device-a");
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_retained_old_review_then_new_revision_proposal() {
    let source = source();
    let old_state = state(&source, generation(&source, WIRE.as_bytes()));
    let mut next_review = review();
    next_review.revision = 43;
    // This is a healthy new source revision, with an explicitly retained review.
    let mut next_document: Value = serde_json::from_str(WIRE).unwrap();
    next_document["revision"] = json!(43);
    let body = serde_json::to_vec(&next_document).unwrap();
    struct NextTransport {
        source: SourceScope,
        body: Vec<u8>,
    }
    impl InventoryTransport for NextTransport {
        fn get_inventory(
            &self,
            request: InventoryGet,
            _limits: Limits,
        ) -> Pin<
            Box<
                dyn Future<Output = std::result::Result<InventoryResponse, NetworkError>>
                    + Send
                    + '_,
            >,
        > {
            assert_eq!(request.path(), "/api/inventory");
            Box::pin(async {
                Ok(InventoryResponse {
                    status: 200,
                    source: Some(self.source.clone()),
                    body: self.body.clone(),
                    source_snapshot_at: Some("2026-01-02T12:30:00Z".into()),
                    redirected: false,
                    location: None,
                    url: None,
                })
            })
        }
    }
    let transport = NextTransport {
        source: source.scope.clone(),
        body,
    };
    let mut provider =
        NetworkProvider::new(source.clone(), next_review, Limits::default()).unwrap();
    assert_eq!(provider.read(&old_state).unwrap(), old_state);
    let RefreshOutcome::Complete(proposal) = provider
        .prepare_refresh(
            &old_state,
            8,
            "00000000-0000-4000-8000-000000000902",
            &transport,
            || "2026-01-02T13:00:00Z".into(),
        )
        .await
        .unwrap()
    else {
        panic!("healthy newer revision")
    };
    assert_eq!(
        old_state.generation.as_ref().unwrap().link_review.revision,
        42
    );
    assert_eq!(
        proposal.precondition().expected_generation_id.as_deref(),
        Some(ID)
    );
    assert_eq!(proposal.precondition().expected_cache_epoch, 8);
    let generation = proposal.state().generation.as_ref().unwrap();
    assert_eq!(generation.source_revision, 43);
    assert_eq!(generation.link_review.revision, 43);
    assert_eq!(
        generation.network_relations[0].fact_at.as_deref(),
        Some("2025-12-01T00:00:00Z")
    );
    assert_eq!(
        generation.network_relations[0].retrieved_at,
        "2026-01-02T13:00:00Z"
    );
    stage_row(&source, &proposal).unwrap();
}

#[test]
fn healthy_js_numbers_keep_the_same_value_through_canonical_reopen() {
    use super::json::{bounded_json, canonical_json};
    let original = br#"{"positive":9007199254740993,"negative":-9007199254740993,"u64Edge":18446744073709551615,"integer":42,"decimal":42.0,"exponent":42e0,"fraction":0.10000000000000002,"tiny":1e-7,"large":1e21}"#;
    let normalized = bounded_json(original, 10_000).unwrap();
    assert_eq!(normalized["positive"], json!(9_007_199_254_740_992_u64));
    assert_eq!(normalized["negative"], json!(-9_007_199_254_740_992_i64));
    assert_eq!(
        normalized["u64Edge"].as_f64(),
        Some(18_446_744_073_709_551_616.0)
    );
    assert_eq!(normalized["integer"], normalized["decimal"]);
    assert_eq!(normalized["integer"], normalized["exponent"]);
    let body = canonical_json(&normalized).unwrap();
    assert_eq!(bounded_json(body.as_bytes(), 10_000).unwrap(), normalized);
}

#[test]
fn healthy_integral_revision_spellings_and_schema_collection_lengths() {
    let mut source = source();
    source.scope.collection_id = "🧭".repeat(4096);
    for spelling in ["42", "42.0", "42e0"] {
        let document = WIRE.replacen("\"revision\": 42", &format!("\"revision\": {spelling}"), 1);
        let annotations =
            REVIEW.replacen("\"revision\": 42", &format!("\"revision\": {spelling}"), 1);
        let review: LinkReview = serde_json::from_str(&annotations).unwrap();
        assert_eq!(review.revision, 42);
        let generation = project_capture(
            &source,
            NetworkCapture {
                source: &source.scope,
                document: document.as_bytes(),
                retrieved_at: AT,
                source_snapshot_at: None,
            },
            &review,
            Limits::default(),
        )
        .unwrap();
        assert_eq!(generation.source_revision, 42);
        let state = state(&source, generation);
        validate_state(&source, &state, Some(&review)).unwrap();
        let facet = build_facet(&source, &state, AT, 300_000).unwrap();
        assert_eq!(facet.scope.collection_id.chars().count(), 4096);
    }
}
