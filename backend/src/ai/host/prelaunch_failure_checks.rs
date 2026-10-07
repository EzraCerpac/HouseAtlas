//! Explicitly requested prelaunch-selection failure checks, outside ordinary CI.
//! An external disposable test target compiles this file against the actual
//! backend library. It is not a library module or healthy-example replacement.
//! No credential, security, provider, launch, network or inference port is used.
use houseatlas_backend::ai::{
    self, AiError, Cancellation, ConnectionSnapshot, PortFuture, RuntimeRoute,
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
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-failure-registration".into(),
        actor_id: "synthetic-failure-actor".into(),
        workspace_id: "synthetic-failure-workspace".into(),
        home_id: "synthetic-failure-home".into(),
        authority_epoch: "synthetic-failure-authority".into(),
        cancellation_epoch: "synthetic-failure-cancellation".into(),
    }
}

#[derive(Clone, Default)]
struct UnusedPorts;
fn unused<'a, T>() -> PortFuture<'a, T> {
    Box::pin(async { panic!("Prelaunch check must not invoke this port") })
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
    candidate_fails: bool,
    selections: Arc<AtomicUsize>,
    callbacks: Arc<AtomicUsize>,
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
    fn select_candidate(&self, _: &(), route: RuntimeRoute) -> Result<(), AiError> {
        assert_eq!(route, RuntimeRoute::LocalSignInHelper);
        self.selections.fetch_add(1, Ordering::SeqCst);
        if self.candidate_fails {
            Err(AiError::ConnectionUnavailable)
        } else {
            Ok(())
        }
    }
    fn callback_selection(&self, _: &()) -> Result<oauth::CallbackSelection, AiError> {
        self.callbacks.fetch_add(1, Ordering::SeqCst);
        Err(AiError::InvalidInput)
    }
    fn launch<'a>(&'a self, _: &'a (), _: oauth::AuthorizationLaunch) -> PortFuture<'a, ()> {
        unused()
    }
    fn manage_usage<'a>(&'a self, _: &'a ()) -> PortFuture<'a, ()> {
        unused()
    }
    fn cached_display(&self, _: &()) -> ConnectionSnapshot {
        serde_json::from_value(json!({
            "method": "sign-in-with-chatgpt", "authorization": "connected",
            "account": {"accountId":"synthetic-previous-account", "workspaceId":"synthetic-failure-workspace", "label":"Synthetic previous display"},
            "permission": "granted", "eligibility": "eligible", "paidUseAdmission": "verified-zero-paid-use", "usageSupported": true,
            "runtime": {"kind":"local", "route":"local-sign-in-helper", "qualification":"qualified", "availability":"ready", "checkedAt":"2026-01-01T00:00:00Z"}
        })).expect("Well-formed cached synthetic display only")
    }
    fn snapshot<'a>(
        &'a self,
        _: &'a (),
        _: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        unused()
    }
}

async fn check_prelaunch_failure(candidate_fails: bool) -> Result<(), Box<dyn std::error::Error>> {
    let private = tempfile::tempdir()?;
    let path = private.path().join("synthetic-prelaunch.sqlite");
    let journal = StatusJournal::new(Connection::open(&path)?)?;
    let selections = Arc::new(AtomicUsize::new(0));
    let callbacks = Arc::new(AtomicUsize::new(0));
    let host = LifecycleHost {
        security: UnusedPorts,
        provider: UnusedPorts,
        credentials: UnusedPorts,
        environment: Environment {
            candidate_fails,
            selections: selections.clone(),
            callbacks: callbacks.clone(),
        },
        journal,
    };
    let command = if candidate_fails {
        ConnectionAction::Connect {
            route: RuntimeRoute::LocalSignInHelper,
        }
    } else {
        ConnectionAction::Consent
    };
    let reason = if candidate_fails {
        AiError::ConnectionUnavailable
    } else {
        AiError::InvalidInput
    };
    let mut saved = Vec::new();
    for id in ["synthetic-prelaunch-first", "synthetic-prelaunch-fresh"] {
        let request = ConnectionActionRequest {
            action_id: id.into(),
            command: command.clone(),
        };
        assert_eq!(
            host.act(&(), &request, &Cancellation::default())
                .await
                .unwrap_err(),
            reason
        );
        let result = host.status(&(), id, &Cancellation::default()).await?;
        assert_eq!(result.action_id, id);
        assert!(matches!(result.status, ConnectionActionStatus::Completed));
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
        assert!(result.snapshot.runtime.checked_at.is_none());
        assert_eq!(
            result.snapshot.account.as_ref().unwrap().label,
            "Synthetic previous display"
        );
        saved.push(result);
    }
    assert_eq!(
        selections.load(Ordering::SeqCst),
        if candidate_fails { 2 } else { 0 }
    );
    assert_eq!(
        callbacks.load(Ordering::SeqCst),
        if candidate_fails { 0 } else { 2 }
    );
    // Reopen the actual journal; both terminal receipts and original input/cause
    // survive. No provider completion, login or available runtime is asserted.
    drop(host);
    let db = Connection::open(&path)?;
    let count: i64 = db.query_row(
        "SELECT count(*) FROM ai_host_observation WHERE category='action-prelaunch-failure'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(count, 2);
    let mut query = db.prepare(
        "SELECT payload FROM ai_host_observation WHERE category='action-prelaunch-failure'",
    )?;
    for raw in query.query_map([], |row| row.get::<_, String>(0))? {
        let record: Value = serde_json::from_str(&raw?)?;
        assert_eq!(record, json!({"command":command,"reason":reason}));
    }
    drop(query);
    drop(db);
    let reopened = LifecycleHost {
        security: UnusedPorts,
        provider: UnusedPorts,
        credentials: UnusedPorts,
        environment: Environment {
            candidate_fails,
            selections,
            callbacks,
        },
        journal: StatusJournal::new(Connection::open(&path)?)?,
    };
    for original in saved {
        let recovered = reopened
            .status(&(), &original.action_id, &Cancellation::default())
            .await?;
        assert_eq!(
            serde_json::to_value(recovered)?,
            serde_json::to_value(original)?
        );
    }
    if let Ok(folder) = std::env::var("HOUSEATLAS_FOCUSED_PEER_OUTPUT") {
        let result = reopened
            .status(&(), "synthetic-prelaunch-first", &Cancellation::default())
            .await?;
        let filename = if candidate_fails {
            "candidate-selection.json"
        } else {
            "callback-selection.json"
        };
        std::fs::write(
            std::path::Path::new(&folder).join(filename),
            serde_json::to_vec(&json!({"result":result,"reason":reason}))?,
        )?;
    }
    Ok(())
}

#[tokio::test]
async fn candidate_selection_failure_has_recoverable_terminal_receipt() {
    check_prelaunch_failure(true).await.unwrap();
}
#[tokio::test]
async fn callback_selection_failure_before_begin_has_recoverable_terminal_receipt() {
    check_prelaunch_failure(false).await.unwrap();
}
