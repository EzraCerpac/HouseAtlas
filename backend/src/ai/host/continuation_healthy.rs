//! Finite in-process handle fences. Fake review/authority are not approval;
//! no credential, provider, native domain operation or mounted route is used.
use super::*;
use crate::ai::{RunLimits, ToolCall, Usage};
use rusqlite::{Connection, OpenFlags};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct Authority {
    checks: AtomicUsize,
    stop_on_release: bool,
    cancel: Cancellation,
}
impl HostAuthority<RegistrationBinding> for Authority {
    fn binding(&self, context: &RegistrationBinding) -> Result<RegistrationBinding, AiError> {
        Ok(context.clone())
    }
    fn revalidate(&self, _: &RegistrationBinding, _: &RegistrationBinding) -> Result<(), AiError> {
        if self.checks.fetch_add(1, Ordering::SeqCst) == 1 && self.stop_on_release {
            self.cancel.request();
        }
        Ok(())
    }
}
struct Review {
    calls: AtomicUsize,
    stop: bool,
    cancel: Cancellation,
}
impl ExactReviewReady<RegistrationBinding, Arc<()>> for Review {
    fn ready(&self, _: &RegistrationBinding, _: &AiCheckpoint<Arc<()>>) -> Result<(), AiError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.stop {
            self.cancel.request();
        }
        Ok(())
    }
}
struct Fixture {
    host: HostContinuations<Authority, Review, Arc<()>>,
    binding: RegistrationBinding,
    cancel: Cancellation,
    prepared: Arc<()>,
    id: String,
    directory: tempfile::TempDir,
}
impl Fixture {
    async fn new(stop_in_review: bool, stop_in_authority: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let journal = StatusJournal::new(
            Connection::open(directory.path().join("synthetic-journal.sqlite")).unwrap(),
        )
        .unwrap();
        let cancel = Cancellation::default();
        let host = HostContinuations::new(
            Authority {
                checks: AtomicUsize::new(0),
                stop_on_release: stop_in_authority,
                cancel: cancel.clone(),
            },
            Review {
                calls: AtomicUsize::new(0),
                stop: stop_in_review,
                cancel: cancel.clone(),
            },
            journal,
            Duration::from_secs(60),
        )
        .unwrap();
        let binding = RegistrationBinding {
            registration_id: "synthetic-registration".into(),
            actor_id: "synthetic-actor".into(),
            workspace_id: "synthetic-workspace".into(),
            home_id: "synthetic-home".into(),
            authority_epoch: "synthetic-authority".into(),
            cancellation_epoch: "synthetic-cancellation".into(),
        };
        let prepared = Arc::new(());
        let checkpoint = AiCheckpoint {
            request_id: "synthetic-request".into(),
            model: "synthetic-model".into(),
            history: vec![serde_json::json!({"role":"user","content":"Synthetic input"})],
            pending: vec![(
                ToolCall {
                    call_id: "synthetic-call".into(),
                    name: "synthetic-tool".into(),
                    arguments: serde_json::json!({}),
                },
                Arc::clone(&prepared),
            )],
            seen_calls: ["synthetic-call".into()].into_iter().collect(),
            next_round: 1,
            usage: Usage::default(),
            operation_ids: vec!["synthetic-earlier-operation".into()],
            limits: RunLimits::default(),
        };
        let id = host.retain(&binding, checkpoint, &cancel).await.unwrap();
        host.authority.checks.store(0, Ordering::SeqCst);
        Self {
            host,
            binding,
            cancel,
            prepared,
            id,
            directory,
        }
    }
    fn observations(&self) -> Vec<String> {
        let db = Connection::open_with_flags(
            self.directory.path().join("synthetic-journal.sqlite"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let mut statement = db
            .prepare("SELECT category FROM ai_host_observation ORDER BY sequence")
            .unwrap();
        let rows = statement.query_map([], |row| row.get(0)).unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }
    fn assert_retained(&self) {
        let entries = self.host.entries.lock().unwrap();
        let checkpoint = &entries.get(&self.id).unwrap().checkpoint;
        assert!(Arc::ptr_eq(&checkpoint.pending[0].1, &self.prepared));
        assert_eq!(checkpoint.usage, Usage::default());
        assert_eq!(checkpoint.operation_ids, ["synthetic-earlier-operation"]);
        assert_eq!(self.observations(), ["continuation-retained"]);
    }
}

#[tokio::test]
async fn stop_during_original_checks_preserves_unclaimed_checkpoint() {
    for stop_in_review in [true, false] {
        let fixture = Fixture::new(stop_in_review, !stop_in_review).await;
        let result = fixture
            .host
            .claim(
                &fixture.binding,
                &fixture.id,
                "synthetic-request",
                &fixture.cancel,
            )
            .await;
        assert_eq!(result.err(), Some(AiError::CancelRequested));
        assert_eq!(fixture.host.review.calls.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.host.authority.checks.load(Ordering::SeqCst), 2);
        fixture.assert_retained();
        fixture
            .host
            .retire(&fixture.binding, "synthetic-request", &fixture.id)
            .unwrap();
        assert!(fixture.host.entries.lock().unwrap().is_empty());
        assert_eq!(
            fixture.observations(),
            ["continuation-retained", "continuation-retired"]
        );
    }
}

#[tokio::test]
async fn expiry_during_original_checks_preserves_unclaimed_checkpoint() {
    let fixture = Fixture::new(false, false).await;
    let expires = fixture.host.entries.lock().unwrap()[&fixture.id].expires;
    let observations = AtomicUsize::new(0);
    let result = fixture.host.claim_current(
        &fixture.binding,
        &fixture.id,
        "synthetic-request",
        &fixture.cancel,
        || {
            if observations.fetch_add(1, Ordering::SeqCst) == 0 {
                expires - Duration::from_nanos(1)
            } else {
                expires
            }
        },
    );
    assert_eq!(result.err(), Some(AiError::ConnectionUnavailable));
    assert_eq!(observations.load(Ordering::SeqCst), 2);
    assert_eq!(fixture.host.review.calls.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.host.authority.checks.load(Ordering::SeqCst), 2);
    fixture.assert_retained();
}

#[tokio::test]
async fn original_checkpoint_is_claimed_once_without_replacing_usage() {
    let fixture = Fixture::new(false, false).await;
    let checkpoint = fixture
        .host
        .claim(
            &fixture.binding,
            &fixture.id,
            "synthetic-request",
            &fixture.cancel,
        )
        .await
        .unwrap();
    assert!(Arc::ptr_eq(&checkpoint.pending[0].1, &fixture.prepared));
    assert_eq!(checkpoint.request_id, "synthetic-request");
    assert_eq!(checkpoint.usage, Usage::default());
    assert_eq!(checkpoint.operation_ids, ["synthetic-earlier-operation"]);
    assert!(fixture.host.entries.lock().unwrap().is_empty());
    assert_eq!(
        fixture.observations(),
        ["continuation-retained", "continuation-claimed"]
    );
    assert_eq!(
        fixture
            .host
            .claim(
                &fixture.binding,
                &fixture.id,
                "synthetic-request",
                &fixture.cancel,
            )
            .await
            .err(),
        Some(AiError::DomainUnavailable)
    );
    assert_eq!(fixture.host.review.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        fixture.observations(),
        ["continuation-retained", "continuation-claimed"]
    );
}
