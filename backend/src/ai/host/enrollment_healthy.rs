//! Healthy actual native-principal/enrollment/fence fixture on disposable state.
//! No account, provider, native key API, inference or held control is called.
use houseatlas_backend::{
    access::{
        self, AccessBoundary, AccessConfig, Action, CanonicalId, Method, RequestEvidence, Role,
        Scope,
    },
    ai::{
        AiError,
        host::{
            enrollment::{EnrollmentOwner, TrustedRegistration},
            native::NativeHostContext,
            status::StatusJournal,
        },
        oauth::{
            LifecycleState, RefreshCheckpoint, RegistrationBinding, RegistrationKind,
            RevocationState,
        },
    },
    transports::mcp::NativePrincipalPort,
};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> CanonicalId {
    CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
}
fn request<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> RequestEvidence<'a> {
    RequestEvidence {
        method: Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf,
        authorization: None,
    }
}
#[tokio::main]
async fn main() -> Result<(), AiError> {
    let directory = tempfile::tempdir().map_err(|_| AiError::DomainUnavailable)?;
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let config = AccessConfig::new(vec![ORIGIN.into()])
        .unwrap()
        .with_clock(|| 1_800_000_000_000);
    let mut access = AccessBoundary::in_memory(config).unwrap();
    let password = "Synthetic-enrollment-fixture-only!";
    access
        .provision_user(
            &id(6),
            &id(7),
            "synthetic-editor",
            &access::hash_password(password).unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&id(6), &scope, Role::Editor, true)
        .unwrap();
    let body =
        serde_json::to_vec(&serde_json::json!({"username":"synthetic-editor","password":password}))
            .unwrap();
    let session = access
        .login(&request(None, None), &body, "synthetic-local")
        .unwrap();
    let cookie = session.set_cookie().split(';').next().unwrap();
    let principal = access
        .authorize(
            &request(Some(cookie), Some(session.info().csrf_token())),
            &scope,
            Action::Mutate,
        )
        .unwrap();
    let access = Arc::new(Mutex::new(access));
    let binding = RegistrationBinding {
        registration_id: "synthetic-existing-approved-registration".into(),
        actor_id: id(7).as_str().into(),
        workspace_id: id(1).as_str().into(),
        home_id: id(2).as_str().into(),
        authority_epoch: "synthetic-original-authority".into(),
        cancellation_epoch: "synthetic-original-cancellation".into(),
    };
    let original_binding = binding.clone();
    let registration = TrustedRegistration::from_existing_approval(
        binding.clone(),
        RegistrationKind::LocalPublicClient,
        "Synthetic HouseAtlas host".into(),
        "synthetic-existing-key-host".into(),
    )?;
    let journal_path = directory.path().join("journal.sqlite");
    let owner_path = directory.path().join("enrollment.sqlite");
    let journal = StatusJournal::new(Connection::open(&journal_path).unwrap())?;
    let owner = EnrollmentOwner::new(
        Connection::open(&owner_path).unwrap(),
        Arc::clone(&access),
        journal.clone(),
    )?;
    owner.install_existing_approval(&principal, &registration)?;
    assert_eq!(owner.capture(&principal)?, binding);
    let native = NativeHostContext::capture(
        principal.clone(),
        binding.clone(),
        &NativePrincipalPort::new(Arc::clone(&access)),
    )
    .await?;
    let original = owner.retain(native.original(), native.registration())?;
    owner.revalidate_original(&original, &binding)?;
    let initial = owner.initial_record(&principal, &registration)?;
    assert_eq!(initial.binding, binding);
    assert_eq!(initial.state, LifecycleState::Disconnected);
    assert_eq!(initial.revocation, RevocationState::NotRequested);
    assert!(
        initial.credentials.is_none()
            && initial.identity.is_none()
            && initial.issued_client_id.is_none()
            && initial.pending_authorization.is_none()
            && matches!(initial.refresh_checkpoint, RefreshCheckpoint::None)
    );
    let mut commits = 0;
    let output = owner.with_persistence_fence(&original, &binding, None, || {
        commits += 1;
        Ok("bounded synthetic file-commit callback")
    })?;
    assert_eq!(output, "bounded synthetic file-commit callback");
    assert_eq!(commits, 1);
    let stopped = owner.stop_original(&original, &binding)?;
    let current = owner.capture(&principal)?;
    assert_ne!(current.cancellation_epoch, binding.cancellation_epoch);
    assert_eq!(current.authority_epoch, binding.authority_epoch);
    assert_eq!(current.registration_id, binding.registration_id);
    owner.revalidate_stopped(&original, &binding, &stopped)?;
    owner.with_persistence_fence(&original, &binding, Some(&stopped), || {
        commits += 1;
        Ok(())
    })?;
    assert_eq!(commits, 2);
    assert_eq!(
        binding, original_binding,
        "original operation binding is not rebased"
    );
    drop(stopped);
    drop(original);
    drop(owner);
    let reopened = EnrollmentOwner::new(
        Connection::open(&owner_path).unwrap(),
        Arc::clone(&access),
        journal,
    )?;
    assert_eq!(reopened.capture(&principal)?, current);
    let next = reopened.retain(&principal, &current)?;
    reopened.revalidate_original(&next, &current)?;
    println!(
        "PASS actual AT11 native principal, original enrollment proof, bounded writer fence, local stop/cancellation rotation and durable reopen on disposable synthetic state"
    );
    println!(
        "This fixture does not qualify encrypted first-record storage, native keys, reconnect, providers or inference."
    );
    Ok(())
}
