//! Focused synthetic checks for the known-complete manage-usage workflow.
//! An external disposable test target compiles this file against the actual
//! backend library. It is not mounted in the module or ordinary CI.
use houseatlas_backend::ai::{
    self, AiError, Cancellation, ConnectionSnapshot, PortFuture,
    host::{
        HostAuthority,
        lifecycle::{LifecycleEnvironment, LifecycleHost},
        status::StatusJournal,
    },
    oauth::{self, ProtectedValue, RegistrationBinding},
    runtime::{
        ConnectionAction, ConnectionActionPort, ConnectionActionRequest, ConnectionActionStatus,
    },
};
use rusqlite::Connection;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-manage-registration".into(),
        actor_id: "synthetic-manage-actor".into(),
        workspace_id: "synthetic-manage-workspace".into(),
        home_id: "synthetic-manage-home".into(),
        authority_epoch: "synthetic-manage-authority".into(),
        cancellation_epoch: "synthetic-manage-cancellation".into(),
    }
}

#[derive(Clone, Default)]
struct UnusedPorts;
fn unused<'a, T>() -> PortFuture<'a, T> {
    Box::pin(async { panic!("Manage-usage check invoked an unrelated port") })
}
impl oauth::SecurityPort for UnusedPorts {
    fn fresh<'a>(&'a self) -> PortFuture<'a, oauth::FreshAuthorization> {
        unused()
    }
    fn state_matches(&self, _: &ProtectedValue, _: &str) -> bool {
        panic!("Unused security")
    }
    fn validate_website_callback(&self, _: &str, _: &str) -> Result<(), AiError> {
        panic!("Unused security")
    }
    fn verify_identity<'a>(
        &'a self,
        _: &'a ProtectedValue,
        _: oauth::IdentityRequirements<'a>,
    ) -> PortFuture<'a, oauth::IdentityValidation> {
        unused()
    }
}
impl oauth::OAuthProviderPort for UnusedPorts {
    fn exchange<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: oauth::CodeExchange<'a>,
    ) -> PortFuture<'a, oauth::ProviderTokens> {
        unused()
    }
    fn refresh<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: oauth::RefreshGrant<'a>,
    ) -> PortFuture<'a, oauth::ProviderTokens> {
        unused()
    }
    fn revoke<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: &'a str,
        _: &'a ProtectedValue,
    ) -> PortFuture<'a, oauth::ProviderRevocation> {
        unused()
    }
}
impl oauth::CredentialBoundary<()> for UnusedPorts {
    type Lease = ();
    fn acquire<'a>(&'a self, _: &'a (), _: &'a RegistrationBinding) -> PortFuture<'a, ()> {
        unused()
    }
    fn load<'a>(&'a self, _: &'a ()) -> PortFuture<'a, oauth::RegistrationRecord> {
        unused()
    }
    fn persist_atomic<'a>(
        &'a self,
        _: &'a mut (),
        _: &'a oauth::RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        unused()
    }
    fn revalidate<'a>(
        &'a self,
        _: &'a (),
        _: &'a (),
        _: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        unused()
    }
    fn stop_use<'a>(&'a self, _: &'a mut ()) -> PortFuture<'a, ()> {
        unused()
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        panic!("Unused credential clock")
    }
}

struct Environment {
    manage_error: Option<AiError>,
    fail_snapshot_after_manage: bool,
    manages: Arc<AtomicUsize>,
    snapshots: Arc<AtomicUsize>,
}
impl HostAuthority<()> for Environment {
    fn binding(&self, _: &()) -> Result<RegistrationBinding, AiError> {
        Ok(binding())
    }
    fn revalidate(&self, _: &(), captured: &RegistrationBinding) -> Result<(), AiError> {
        assert_eq!(captured, &binding());
        Ok(())
    }
}
impl LifecycleEnvironment<()> for Environment {
    fn select_candidate(&self, _: &(), _: ai::RuntimeRoute) -> Result<(), AiError> {
        panic!("Unused candidate selector")
    }
    fn callback_selection(&self, _: &()) -> Result<oauth::CallbackSelection, AiError> {
        panic!("Unused callback selector")
    }
    fn launch<'a>(&'a self, _: &'a (), _: oauth::AuthorizationLaunch) -> PortFuture<'a, ()> {
        unused()
    }
    fn manage_usage<'a>(&'a self, _: &'a ()) -> PortFuture<'a, ()> {
        self.manages.fetch_add(1, Ordering::SeqCst);
        let error = self.manage_error;
        Box::pin(async move { error.map_or(Ok(()), Err) })
    }
    fn cached_display(&self, _: &()) -> ConnectionSnapshot {
        serde_json::from_value(json!({
            "method":"sign-in-with-chatgpt", "authorization":"connected",
            "account":{"accountId":"synthetic-manage-account","workspaceId":"synthetic-manage-workspace","label":"Cached synthetic account"},
            "permission":"granted", "eligibility":"eligible", "paidUseAdmission":"verified-zero-paid-use", "usageSupported":true,
            "runtime":{"kind":"local","route":"local-sign-in-helper","qualification":"qualified","availability":"ready","checkedAt":"2026-01-01T00:00:00Z"}
        })).expect("Valid credential-free cached display")
    }
    fn snapshot<'a>(
        &'a self,
        _: &'a (),
        _: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        self.snapshots.fetch_add(1, Ordering::SeqCst);
        if self.fail_snapshot_after_manage {
            Box::pin(async { Err(AiError::ProviderUnavailable) })
        } else {
            Box::pin(async {
                Ok(serde_json::from_value(json!({
                "method":"sign-in-with-chatgpt", "authorization":"connected",
                "permission":"unknown", "eligibility":"unknown", "paidUseAdmission":"held", "usageSupported":true,
                "runtime":{"kind":"local","route":"local-sign-in-helper","qualification":"held","availability":"unknown"}
            })).expect("Valid synthetic snapshot"))
            })
        }
    }
}

fn make_host(
    path: &std::path::Path,
    manage_error: Option<AiError>,
    fail_snapshot_after_manage: bool,
) -> LifecycleHost<UnusedPorts, UnusedPorts, UnusedPorts, Environment> {
    LifecycleHost {
        security: UnusedPorts,
        provider: UnusedPorts,
        credentials: UnusedPorts,
        environment: Environment {
            manage_error,
            fail_snapshot_after_manage,
            manages: Arc::new(AtomicUsize::new(0)),
            snapshots: Arc::new(AtomicUsize::new(0)),
        },
        journal: StatusJournal::new(Connection::open(path).expect("Open synthetic SQLite journal"))
            .expect("Initialize synthetic journal"),
    }
}

#[tokio::test]
async fn manage_usage_success_snapshot_failure_returns_original_error_and_status_is_completed() {
    let private = tempfile::tempdir().unwrap();
    let path = private.path().join("synthetic-manage.sqlite");
    let host = make_host(&path, None, true);
    let request = ConnectionActionRequest {
        action_id: "synthetic-manage-snapshot-failure".into(),
        command: ConnectionAction::ManageUsage,
    };

    assert_eq!(
        host.act(&(), &request, &Cancellation::default())
            .await
            .unwrap_err(),
        AiError::ProviderUnavailable
    );
    let completed = host
        .status(&(), &request.action_id, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(completed.action_id, request.action_id);
    assert!(matches!(
        completed.status,
        ConnectionActionStatus::Completed
    ));
    assert_eq!(
        completed.snapshot.permission,
        ai::InferencePermission::Unknown
    );
    assert_eq!(completed.snapshot.eligibility, ai::Eligibility::Unknown);
    assert_eq!(
        completed.snapshot.paid_use_admission,
        ai::PaidUseAdmission::Held
    );
    assert_eq!(
        completed.snapshot.runtime.qualification,
        ai::RuntimeQualification::Held
    );
    assert_eq!(
        completed.snapshot.runtime.availability,
        ai::RuntimeAvailability::Unknown
    );
    assert!(completed.snapshot.runtime.checked_at.is_none());

    drop(host);
    let reopened = make_host(&path, None, true);
    let recovered = reopened
        .status(&(), &request.action_id, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(recovered).unwrap(),
        serde_json::to_value(completed).unwrap()
    );
}

#[tokio::test]
async fn manage_usage_success_snapshot_success_returns_live_snapshot_and_completed_status() {
    let private = tempfile::tempdir().unwrap();
    let path = private.path().join("synthetic-manage-success.sqlite");
    let host = make_host(&path, None, false);
    let request = ConnectionActionRequest {
        action_id: "synthetic-manage-snapshot-success".into(),
        command: ConnectionAction::ManageUsage,
    };

    let result = host
        .act(&(), &request, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.action_id, request.action_id);
    assert!(matches!(result.status, ConnectionActionStatus::Completed));
    assert_eq!(result.snapshot.permission, ai::InferencePermission::Unknown);
    assert_eq!(
        result.snapshot.paid_use_admission,
        ai::PaidUseAdmission::Held
    );
    let status = host
        .status(&(), &request.action_id, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(status).unwrap(),
        serde_json::to_value(result).unwrap()
    );
}

#[tokio::test]
async fn manage_usage_failure_keeps_original_error_and_action_unconfirmed() {
    let private = tempfile::tempdir().unwrap();
    let path = private.path().join("synthetic-manage-failure.sqlite");
    let host = make_host(&path, Some(AiError::ConnectionUnavailable), false);
    let request = ConnectionActionRequest {
        action_id: "synthetic-manage-operation-failure".into(),
        command: ConnectionAction::ManageUsage,
    };

    assert_eq!(
        host.act(&(), &request, &Cancellation::default())
            .await
            .unwrap_err(),
        AiError::ConnectionUnavailable
    );
    let unresolved = host
        .status(&(), &request.action_id, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(unresolved.action_id, request.action_id);
    assert!(matches!(
        unresolved.status,
        ConnectionActionStatus::Unconfirmed
    ));
}

#[tokio::test]
async fn missing_action_status_returns_unconfirmed_receipt() {
    let private = tempfile::tempdir().unwrap();
    let path = private.path().join("synthetic-missing-action.sqlite");
    let host = make_host(&path, None, false);
    let requested_id = "synthetic-never-admitted-action";

    let result = host
        .status(&(), requested_id, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.action_id, requested_id);
    assert!(matches!(result.status, ConnectionActionStatus::Unconfirmed));
    assert_eq!(result.snapshot.permission, ai::InferencePermission::Unknown);
    assert_eq!(result.snapshot.eligibility, ai::Eligibility::Unknown);
    assert_eq!(
        result.snapshot.paid_use_admission,
        ai::PaidUseAdmission::Held
    );
    assert_eq!(
        result.snapshot.runtime.qualification,
        ai::RuntimeQualification::Held
    );
    assert_eq!(
        result.snapshot.runtime.availability,
        ai::RuntimeAvailability::Unknown
    );
    assert_eq!(host.environment.manages.load(Ordering::SeqCst), 0);
    assert_eq!(host.environment.snapshots.load(Ordering::SeqCst), 1);

    let action_rows: i64 = Connection::open(&path)
        .unwrap()
        .query_row(
            "SELECT count(*) FROM ai_host_status WHERE id=?1 AND kind='action'",
            [requested_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(action_rows, 0);
}
