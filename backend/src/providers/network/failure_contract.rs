//! Synthetic Network failure/retention contracts for #285. No listener or Store.
use super::*;
use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};

const WIRE: &[u8] = include_bytes!("../../../../adapters/network/fixtures/inventory.wire.json");
const SUCCESS: &str = "2026-01-02T12:00:00Z";
const ATTEMPT: &str = "2026-01-02T13:00:00Z";
const ORIGINAL: &str = "00000000-0000-4000-8000-000000000901";
const CANDIDATE: &str = "00000000-0000-4000-8000-000000000902";

struct Reply {
    response: InventoryResponse,
    calls: AtomicUsize,
}
impl InventoryTransport for Reply {
    fn get_inventory(
        &self,
        request: InventoryGet,
        _: Limits,
    ) -> Pin<Box<dyn Future<Output = Result<InventoryResponse>> + Send + '_>> {
        assert_eq!((request.method(), request.path()), ("GET", "/api/inventory"));
        assert_eq!(self.calls.fetch_add(1, Ordering::SeqCst), 0, "no retry");
        Box::pin(async { Ok(self.response.clone()) })
    }
}
fn reply(scope: &SourceScope) -> Reply {
    Reply {
        response: InventoryResponse {
            status: 200,
            source: Some(scope.clone()),
            body: WIRE.to_vec(),
            source_snapshot_at: None,
            redirected: false,
            location: None,
            url: None,
        },
        calls: AtomicUsize::new(0),
    }
}
fn provider(source: &SourceRegistration) -> NetworkProvider {
    NetworkProvider::new(source.clone(), healthy::review(), Limits::default()).unwrap()
}
async fn previous(source: &SourceRegistration) -> RetainedState {
    let mut provider = provider(source);
    let empty = RetainedState::empty(source.scope.clone());
    let transport = reply(&source.scope);
    let RefreshOutcome::Complete(proposal) = provider
        .prepare_refresh(&empty, 7, ORIGINAL, &transport, || SUCCESS.into())
        .await.unwrap()
    else {
        panic!("positive generated input must produce a complete proposal");
    };
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    assert_eq!(proposal.precondition().expected_cache_epoch, 7);
    assert!(proposal.precondition().expected_generation_id.is_none());
    assert_eq!(proposal.original_capture().body(), WIRE);
    let state = proposal.state().clone();
    assert_eq!(state.cache.status, CacheStatus::Fresh);
    assert_eq!(state.cache.last_successful_fetch_at.as_deref(), Some(SUCCESS));
    assert!(!state.generation.as_ref().unwrap().inventory.devices.is_empty());
    state
}

async fn failure_case(code: ErrorCode) {
    let source = healthy::source();
    let previous = previous(&source).await;
    let saved = previous.clone();
    for with_previous in [true, false] {
        let prior = if with_previous { previous.clone() } else { RetainedState::empty(source.scope.clone()) };
        let baseline = prior.clone();
        let mut transport = reply(&source.scope);
        match code {
            ErrorCode::InvalidSchema => transport.response.body = b"{".to_vec(),
            ErrorCode::WrongScope => transport.response.source.as_mut().unwrap().collection_id = "other-synthetic-collection".into(),
            ErrorCode::Auth => transport.response.status = 403,
            _ => unreachable!("only the finite source-response cases are supported"),
        }
        let mut provider = provider(&source);
        let RefreshOutcome::Failed(failed) = provider
            .prepare_refresh(&prior, 8, CANDIDATE, &transport, || ATTEMPT.into())
            .await.unwrap()
        else {
            panic!("rejected response must not produce a complete/native publication proposal");
        };
        let expected_status = if code == ErrorCode::Auth { CacheStatus::AccessRevoked } else { CacheStatus::Error };
        assert_eq!(failed.error.code, code);
        assert_eq!(failed.error.message(), NetworkError::new(code).message());
        assert_eq!(failed.state.cache.status, expected_status);
        assert_eq!(failed.state.cache.last_attempt_at.as_deref(), Some(ATTEMPT));
        let error = failed.state.cache.error.as_ref().unwrap();
        assert_eq!(error.code, code);
        assert_eq!(error.at, ATTEMPT);
        assert_eq!(error.message, failed.error.message());
        assert_eq!(failed.state.cache.generation_id, baseline.cache.generation_id);
        assert_eq!(failed.state.cache.last_successful_fetch_at, baseline.cache.last_successful_fetch_at);
        // Complete equality covers retained inventory, raw relations, observations,
        // review, fact/snapshot/retrieval times and source revision.
        assert_eq!(failed.state.generation, baseline.generation);
        assert_eq!(prior, baseline);
        assert_eq!(previous, saved);
        assert_ne!(failed.state.cache.generation_id.as_deref(), Some(CANDIDATE));
        if !with_previous {
            assert!(failed.state.generation.is_none());
            assert!(failed.state.cache.generation_id.is_none());
            assert!(failed.state.cache.last_successful_fetch_at.is_none());
        }
        let public = provider.read(&failed.state).unwrap();
        assert_eq!(public.cache, failed.state.cache);
        if code == ErrorCode::Auth {
            assert!(public.generation.is_none());
        } else {
            assert_eq!(public.generation, baseline.generation);
        }
        // Facet consumes validated INTERNAL state; public_read's deliberately
        // withheld generation is not a substitute for retained-state validation.
        let facet = build_facet(&source, &failed.state, ATTEMPT, 1000).unwrap();
        let expected_facet = if code == ErrorCode::Auth {
            FacetStatus::Revoked
        } else if with_previous {
            FacetStatus::Stale
        } else {
            FacetStatus::Unavailable
        };
        assert_eq!(facet.status, expected_facet);
        assert_eq!(facet.age_ms, with_previous.then_some(3_600_000));
        assert_eq!(facet.cache, failed.state.cache);
        assert!(facet.read_only);
        assert!(!facet.capabilities.demand && !facet.capabilities.diagnostics && !facet.capabilities.writes);
        if code == ErrorCode::Auth || !with_previous {
            assert!(facet.groups.is_empty() && facet.devices.is_empty());
            assert!(facet.interfaces.is_empty() && facet.segments.is_empty());
            assert!(facet.current_claims.is_empty() && facet.history.is_empty() && facet.observations.is_empty());
            assert!(facet.source_revision.is_none() && facet.source_snapshot_at.is_none());
        } else {
            let retained = baseline.generation.as_ref().unwrap();
            assert_eq!(facet.devices, retained.inventory.devices);
            assert_eq!(facet.interfaces, retained.inventory.interfaces);
            assert_eq!(facet.groups, retained.inventory.groups);
            assert_eq!(facet.segments, retained.inventory.segments);
            assert_eq!(facet.current_claims.len() + facet.history.len(), retained.network_relations.len());
            assert_eq!(facet.source_revision, Some(retained.source_revision));
            assert_eq!(facet.source_snapshot_at, retained.source_snapshot_at);
        }
        // Only explicit preparation made one passive inventory GET. Repeated
        // reads/facets have no transport input and cannot refresh/scan/demand.
        assert_eq!(provider.read(&failed.state).unwrap(), public);
        assert_eq!(build_facet(&source, &failed.state, ATTEMPT, 1000).unwrap(), facet);
        assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
        assert_eq!(previous, saved);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn malformed_response_keeps_complete_cache_without_empty_success() {
    failure_case(ErrorCode::InvalidSchema).await;
}
#[tokio::test(flavor = "current_thread")]
async fn wrong_scope_response_keeps_existing_network_error_semantics() {
    failure_case(ErrorCode::WrongScope).await;
}
#[tokio::test(flavor = "current_thread")]
async fn auth_failure_retains_internal_generation_but_withholds_public_records() {
    failure_case(ErrorCode::Auth).await;
}
