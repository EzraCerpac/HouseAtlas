//! Explicit, bounded synthetic status lifecycle regression cases.
//!
//! This fixture is intentionally outside ordinary CI and has no provider,
//! credential, network, HTTP, replay, expiry or revocation adapters. A caller
//! must select the named cases explicitly in the separate PR108 regression
//! lane; there is no aggregate test entrypoint here.
use super::*;
use std::{
    sync::{Barrier, TryLockError},
    thread,
    time::{Duration, Instant},
};

fn binding(cancellation_epoch: &str) -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-status-registration".into(),
        actor_id: "synthetic-status-actor".into(),
        workspace_id: "synthetic-status-workspace".into(),
        home_id: "synthetic-status-home".into(),
        authority_epoch: "synthetic-status-authority".into(),
        cancellation_epoch: cancellation_epoch.into(),
    }
}

fn journal() -> StatusJournal {
    StatusJournal::new(Connection::open_in_memory().expect("in-memory SQLite")).unwrap()
}

fn review() -> RunOutcome {
    RunOutcome::ReviewRequired {
        calls: Vec::new(),
        continuation_id: "synthetic-status-continuation".into(),
        reviews: Vec::new(),
        usage: Usage {
            input_tokens: Some(7),
            output_tokens: Some(3),
            total_tokens: Some(10),
        },
    }
}

fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !predicate() {
        assert!(
            Instant::now() < deadline,
            "barrier-controlled case timed out"
        );
        thread::yield_now();
    }
}

fn retained_cancelled_review(journal: &StatusJournal, b: &RegistrationBinding, id: &str) -> Value {
    let db = journal.db.lock().unwrap();
    let raw: String = db
        .query_row(
            "SELECT payload FROM ai_host_observation
             WHERE scope=?1 AND id=?2 AND category='cancelled-review-required'",
            params![scope_key(b).unwrap(), id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}

/// Absent action IDs are ordinary missing receipts, not journal corruption.
pub fn missing_action_status_is_unconfirmed_lookup() {
    let journal = journal();
    assert_eq!(
        journal
            .action_read(&binding("synthetic-status-cancel-1"), "unknown-action")
            .unwrap(),
        None
    );
}

/// Registration stop wins while finish is blocked behind the SQLite mutex.
pub fn registration_stop_before_finish_keeps_late_review_unpublished() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-1");
    let run = journal.begin(&original, "status-stop-first", None).unwrap();
    let db_guard = journal.db.lock().unwrap();
    let stopped = Arc::new(Barrier::new(2));
    let stop_gate = stopped.clone();
    let stopping_journal = journal.clone();
    let stopping_binding = original.clone();
    let stop_worker = thread::spawn(move || {
        stop_gate.wait();
        stopping_journal.stop_registration(&stopping_binding)
    });
    stopped.wait();
    wait_until(|| run.cancel.is_requested());
    let finish_barrier = Arc::new(Barrier::new(2));
    let finishing_journal = journal.clone();
    let finishing_binding = original.clone();
    let finish_gate = finish_barrier.clone();
    let finish_worker = thread::spawn(move || {
        finish_gate.wait();
        finishing_journal.finish(&finishing_binding, "status-stop-first", Some(&review()))
    });
    finish_barrier.wait();
    drop(db_guard);
    stop_worker.join().unwrap().unwrap();
    assert!(matches!(
        finish_worker.join().unwrap().unwrap(),
        RequestStatus::Finished {
            outcome: RunOutcome::Stopped { .. },
            ..
        }
    ));
    assert!(matches!(
        journal.read(&original, "status-stop-first", false).unwrap(),
        RequestStatus::Unconfirmed { .. }
    ));
    let current = binding("synthetic-status-cancel-after");
    assert!(matches!(
        journal
            .read_cancelled_receipt(&current, "status-stop-first")
            .unwrap(),
        Some(RequestStatus::Finished {
            outcome: RunOutcome::Stopped {
                usage: Usage {
                    input_tokens: Some(7),
                    output_tokens: Some(3),
                    total_tokens: Some(10)
                }
            },
            ..
        })
    ));
    assert_eq!(
        retained_cancelled_review(&journal, &original, "status-stop-first")["continuationId"],
        "synthetic-status-continuation"
    );
}

/// Finish may publish first, but registration stop retires its review receipt.
pub fn finish_before_registration_stop_publishes_stopped() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-1");
    let _run = journal
        .begin(&original, "status-finish-first", None)
        .unwrap();
    let db_guard = journal.db.lock().unwrap();
    let finish_barrier = Arc::new(Barrier::new(2));
    let finishing_journal = journal.clone();
    let finishing_binding = original.clone();
    let finish_gate = finish_barrier.clone();
    let finish_worker = thread::spawn(move || {
        finish_gate.wait();
        finishing_journal.finish(&finishing_binding, "status-finish-first", Some(&review()))
    });
    finish_barrier.wait();
    wait_until(|| matches!(journal.active.try_lock(), Err(TryLockError::WouldBlock)));
    let stop_barrier = Arc::new(Barrier::new(2));
    let stopping_journal = journal.clone();
    let stopping_binding = original.clone();
    let stop_gate = stop_barrier.clone();
    let stop_worker = thread::spawn(move || {
        stop_gate.wait();
        stopping_journal.stop_registration(&stopping_binding)
    });
    stop_barrier.wait();
    drop(db_guard);
    finish_worker.join().unwrap().unwrap();
    stop_worker.join().unwrap().unwrap();
    assert!(matches!(
        journal
            .read(&original, "status-finish-first", false)
            .unwrap(),
        RequestStatus::Unconfirmed { .. }
    ));
    let current = binding("synthetic-status-cancel-after");
    match journal
        .read_cancelled_receipt(&current, "status-finish-first")
        .unwrap()
    {
        Some(RequestStatus::Finished {
            outcome: RunOutcome::Stopped { usage },
            ..
        }) => assert_eq!(usage.input_tokens, Some(7)),
        other => panic!("registration stop leaked a pending review: {other:?}"),
    }
    assert_eq!(
        retained_cancelled_review(&journal, &original, "status-finish-first")["continuationId"],
        "synthetic-status-continuation"
    );
}

/// A unique cancelled request receipt remains readable after epoch rotation.
pub fn rotated_binding_reads_unique_cancelled_original_request_receipt() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-before");
    let _run = journal.begin(&original, "status-receipt", None).unwrap();
    journal.stop_registration(&original).unwrap();
    let current = binding("synthetic-status-cancel-after");
    assert!(matches!(
        journal
            .read_cancelled_receipt(&current, "status-receipt")
            .unwrap(),
        Some(RequestStatus::Unconfirmed { .. })
    ));
    assert!(matches!(
        journal
            .stop_cancelled_receipt(&current, "status-receipt")
            .unwrap(),
        Some(CancelReceipt {
            status: CancelStatus::Requested,
            ..
        })
    ));
    // The retained row remains under its original six-field scope.
    assert!(matches!(
        journal.read(&original, "status-receipt", false).unwrap(),
        RequestStatus::Unconfirmed { .. }
    ));
}

/// Receipt lookup requires exact trusted original scope and rejects ambiguity.
pub fn rotated_binding_receipt_denies_scope_mismatch_and_ambiguity() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-before");
    let _run = journal
        .begin(&original, "status-scope-denial", None)
        .unwrap();
    journal.stop_registration(&original).unwrap();
    let current = binding("synthetic-status-cancel-after");
    for altered in [
        RegistrationBinding {
            actor_id: "other-actor".into(),
            ..current.clone()
        },
        RegistrationBinding {
            workspace_id: "other-workspace".into(),
            ..current.clone()
        },
        RegistrationBinding {
            home_id: "other-home".into(),
            ..current.clone()
        },
        RegistrationBinding {
            registration_id: "other-registration".into(),
            ..current.clone()
        },
        RegistrationBinding {
            authority_epoch: "other-authority".into(),
            ..current.clone()
        },
    ] {
        assert!(
            journal
                .read_cancelled_receipt(&altered, "status-scope-denial")
                .unwrap()
                .is_none()
        );
    }

    for epoch in [
        "synthetic-status-cancel-second",
        "synthetic-status-cancel-third",
    ] {
        let prior = binding(epoch);
        let _run = journal.begin(&prior, "status-ambiguous", None).unwrap();
        journal.stop_registration(&prior).unwrap();
    }
    assert!(matches!(
        journal.read_cancelled_receipt(&current, "status-ambiguous"),
        Err(AiError::DomainUnavailable)
    ));
}

/// Cancellation must retain a terminal completed result observed by the runner.
pub fn late_terminal_completion_survives_cancel_latch() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-late-completion");
    let _run = journal
        .begin(&original, "status-late-completion", None)
        .unwrap();
    journal.stop_registration(&original).unwrap();
    let outcome = RunOutcome::Completed {
        text: "synthetic completion evidence".into(),
        usage: Usage {
            input_tokens: Some(9),
            output_tokens: Some(4),
            total_tokens: Some(13),
        },
    };
    assert!(matches!(
        journal
            .finish(&original, "status-late-completion", Some(&outcome))
            .unwrap(),
        RequestStatus::Finished {
            outcome: RunOutcome::Completed { .. },
            ..
        }
    ));
}

/// Cancellation must retain observed domain operation correlations and state.
pub fn late_domain_dispatch_survives_cancel_latch() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-late-domain");
    let _run = journal
        .begin(&original, "status-late-domain", None)
        .unwrap();
    journal.stop_registration(&original).unwrap();
    let outcome = RunOutcome::DomainHeld {
        operation_id: Some("synthetic-operation-current".into()),
        operation_ids: vec![
            "synthetic-operation-prior".into(),
            "synthetic-operation-current".into(),
        ],
        state: crate::ai::stock::DomainDispatchState::UnknownHeld,
        usage: Usage::default(),
    };
    match journal
        .finish(&original, "status-late-domain", Some(&outcome))
        .unwrap()
    {
        RequestStatus::Finished {
            outcome: RunOutcome::DomainHeld { operation_ids, .. },
            ..
        } => assert_eq!(
            operation_ids,
            vec![
                "synthetic-operation-prior".to_owned(),
                "synthetic-operation-current".to_owned()
            ]
        ),
        other => panic!("cancellation discarded domain evidence: {other:?}"),
    }
}

/// A known local stop retains its usage, while a missing outcome stays unknown.
pub fn stopped_receipt_retains_usage_and_missing_outcome_stays_unconfirmed() {
    let journal = journal();
    let original = binding("synthetic-status-cancel-stopped");
    let _run = journal
        .begin(&original, "status-stopped-receipt", None)
        .unwrap();
    journal.stop_registration(&original).unwrap();
    let stopped = RunOutcome::Stopped {
        usage: Usage {
            input_tokens: Some(5),
            output_tokens: None,
            total_tokens: None,
        },
    };
    assert!(matches!(
        journal
            .finish(&original, "status-stopped-receipt", Some(&stopped))
            .unwrap(),
        RequestStatus::Finished {
            outcome: RunOutcome::Stopped {
                usage: Usage {
                    input_tokens: Some(5),
                    output_tokens: None,
                    total_tokens: None
                }
            },
            ..
        }
    ));
    let current = binding("synthetic-status-cancel-stopped-after");
    assert!(matches!(
        journal
            .read_cancelled_receipt(&current, "status-stopped-receipt")
            .unwrap(),
        Some(RequestStatus::Finished {
            outcome: RunOutcome::Stopped { .. },
            ..
        })
    ));
    // The mounted current-epoch receipt path also recovers known local stop
    // after a lost response; no rotation or remote completion is required.
    assert!(matches!(
        journal
            .read_current_receipt(&original, "status-stopped-receipt", true)
            .unwrap(),
        Some(RequestStatus::Finished {
            outcome: RunOutcome::Stopped { .. },
            ..
        })
    ));
    assert!(matches!(
        journal
            .read(&original, "status-stopped-receipt", false)
            .unwrap(),
        RequestStatus::Unconfirmed { .. }
    ));
    let db = journal.db.lock().unwrap();
    let (state, cancelled, raw): (String, bool, String) = db
        .query_row(
            "SELECT state,cancelled,payload FROM ai_host_status
             WHERE scope=?1 AND id='status-stopped-receipt' AND kind='request'",
            params![scope_key(&original).unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, "unconfirmed");
    assert!(cancelled);
    assert!(matches!(
        serde_json::from_str::<RunOutcome>(&raw).unwrap(),
        RunOutcome::Stopped {
            usage: Usage {
                input_tokens: Some(5),
                output_tokens: None,
                total_tokens: None
            }
        }
    ));
    drop(db);

    let no_outcome = binding("synthetic-status-cancel-no-outcome");
    let _run = journal
        .begin(&no_outcome, "status-no-outcome", None)
        .unwrap();
    journal.stop_registration(&no_outcome).unwrap();
    assert!(matches!(
        journal
            .finish(&no_outcome, "status-no-outcome", None)
            .unwrap(),
        RequestStatus::Unconfirmed { .. }
    ));
    let no_outcome_current = binding("synthetic-status-cancel-no-outcome-after");
    assert!(matches!(
        journal
            .read_cancelled_receipt(&no_outcome_current, "status-no-outcome")
            .unwrap(),
        Some(RequestStatus::Unconfirmed { .. })
    ));

    let precedence = binding("synthetic-status-cancel-current-precedence");
    let prior = binding("synthetic-status-cancel-current-precedence-before");
    let _prior = journal
        .begin(&prior, "status-current-precedence", None)
        .unwrap();
    journal.stop_registration(&prior).unwrap();
    let _current = journal
        .begin(&precedence, "status-current-precedence", None)
        .unwrap();
    assert!(
        journal
            .read_cancelled_receipt(&precedence, "status-current-precedence")
            .unwrap()
            .is_none()
    );
}
