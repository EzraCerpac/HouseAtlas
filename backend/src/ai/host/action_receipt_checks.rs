//! Explicit synthetic callback/launch ordering cases in the PR108 lane.
//! Unmounted child of status in a disposable compiler facade only. No OAuth
//! callback, credential, provider, account, socket or replay is executed.
use super::*;
use crate::ai::ConnectionSnapshot;

fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-action-registration".into(),
        actor_id: "synthetic-action-actor".into(),
        workspace_id: "synthetic-action-workspace".into(),
        home_id: "synthetic-action-home".into(),
        authority_epoch: "synthetic-action-authority".into(),
        cancellation_epoch: "synthetic-action-cancellation".into(),
    }
}
fn receipt(id: &str, status: ConnectionActionStatus, connected: bool) -> ConnectionActionResult {
    let snapshot: ConnectionSnapshot = serde_json::from_value(json!({
        "method": "sign-in-with-chatgpt",
        "authorization": if connected { "connected" } else { "sign-in-required" },
        "permission": "unknown", "eligibility": "unknown", "paidUseAdmission": "held",
        "usageSupported": true,
        "runtime": {"kind": "local", "route": "local-sign-in-helper",
            "qualification": "held", "availability": "unknown"}
    }))
    .unwrap();
    ConnectionActionResult {
        action_id: id.into(),
        status,
        snapshot,
    }
}
fn journal(id: &str) -> StatusJournal {
    let journal = StatusJournal::new(Connection::open_in_memory().unwrap()).unwrap();
    journal
        .action_begin(
            &binding(),
            id,
            json!(crate::ai::runtime::ConnectionAction::Consent),
        )
        .unwrap();
    journal
}
fn assert_canonical(journal: &StatusJournal, id: &str, receipt: &ConnectionActionResult) {
    assert_eq!(
        journal.action_read(&binding(), id).unwrap(),
        Some(json!(receipt))
    );
}

/// The callback's Completed receipt arrives before the delayed launch returns.
pub fn completed_callback_receipt_survives_delayed_launch() {
    let id = "synthetic-completed-callback";
    let journal = journal(id);
    let terminal = receipt(id, ConnectionActionStatus::Completed, true);
    journal
        .action_finish(&binding(), id, terminal.clone())
        .unwrap();
    let returned = journal
        .action_finish(
            &binding(),
            id,
            receipt(id, ConnectionActionStatus::Pending, false),
        )
        .unwrap();
    assert_eq!(json!(returned), json!(terminal));
    assert_canonical(&journal, id, &terminal);
}

/// Ambiguous callback completion must retain its uncertainty and exact snapshot.
pub fn unconfirmed_callback_receipt_survives_delayed_launch() {
    let id = "synthetic-unconfirmed-callback";
    let journal = journal(id);
    let terminal = receipt(id, ConnectionActionStatus::Unconfirmed, false);
    journal
        .action_finish(&binding(), id, terminal.clone())
        .unwrap();
    let returned = journal
        .action_finish(
            &binding(),
            id,
            receipt(id, ConnectionActionStatus::Pending, true),
        )
        .unwrap();
    assert_eq!(json!(returned), json!(terminal));
    assert_canonical(&journal, id, &terminal);
}

/// Forward completion and Completed metadata refresh remain available.
pub fn pending_action_completes_and_completed_display_refreshes() {
    let id = "synthetic-forward-completion";
    let journal = journal(id);
    let pending = receipt(id, ConnectionActionStatus::Pending, false);
    journal
        .action_finish(&binding(), id, pending.clone())
        .unwrap();
    assert_canonical(&journal, id, &pending);
    let terminal = receipt(id, ConnectionActionStatus::Completed, false);
    journal
        .action_finish(&binding(), id, terminal.clone())
        .unwrap();
    assert_canonical(&journal, id, &terminal);
    let refreshed = receipt(id, ConnectionActionStatus::Completed, true);
    let returned = journal
        .action_finish(&binding(), id, refreshed.clone())
        .unwrap();
    assert_eq!(json!(returned), json!(refreshed));
    assert_canonical(&journal, id, &refreshed);
}
