//! Positive encrypted enrollment fixture, compiled only in a disposable facade.
//! Actual AT11 and host authority, actual PR98 codec/lease/filesystem; synthetic key.
//! The integrator may mount this file under credential_boundary for scoped checks.
//! No native key API, provider, account, inference or held control is called.
use crate::{
    access::{
        self, AccessBoundary, AccessConfig, Action, CanonicalId, Method, RequestEvidence, Role,
        Scope,
    },
    ai::{
        AiError,
        host::{
            credentials::NativeCredentialAuthority,
            enrollment::{EnrollmentOwner, TrustedRegistration},
            native::NativeHostContext,
            status::StatusJournal,
        },
        oauth::{
            CredentialBoundary, LifecycleState, RefreshCheckpoint, RegistrationBinding,
            RegistrationKind, RevocationState,
        },
    },
    transports::mcp::NativePrincipalPort,
};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

use super::{
    boundary::Boundary,
    keys::{KeyProvider, SecretKey},
};
use crate::ai::PortFuture;
struct SyntheticKey;
impl KeyProvider for SyntheticKey {
    fn load<'a>(&'a self, _: &'a str) -> PortFuture<'a, SecretKey> {
        Box::pin(async { SecretKey::new(vec![0x31; 32]) })
    }
}
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
pub async fn run() -> Result<(), AiError> {
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
    let owner = Arc::new(EnrollmentOwner::new(
        Connection::open(&owner_path).unwrap(),
        Arc::clone(&access),
        journal.clone(),
    )?);
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
    let credential_path = directory.path().join("credentials");
    std::fs::create_dir(&credential_path).map_err(|_| AiError::DomainUnavailable)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&credential_path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| AiError::DomainUnavailable)?;
    }
    let authority = Arc::new(NativeCredentialAuthority::new(
        Arc::clone(&owner),
        |context: &NativeHostContext| context,
    ));
    let boundary = Boundary::with_keys(
        &credential_path,
        "synthetic-existing-key-host",
        Arc::clone(&authority),
        SyntheticKey,
    )?;
    let mut lease = boundary.enroll_atomic(&native, &binding, &initial).await?;
    let loaded = boundary.load(&lease).await?;
    assert_eq!(loaded.binding, binding);
    assert_eq!(loaded.state, LifecycleState::Disconnected);
    assert!(loaded.credentials.is_none() && loaded.identity.is_none());
    boundary.revalidate(&native, &lease, &binding).await?;
    boundary.persist_atomic(&mut lease, &loaded).await?;
    boundary.stop_use(&mut lease).await?;
    let current = owner.capture(&principal)?;
    assert_ne!(current.cancellation_epoch, binding.cancellation_epoch);
    assert_eq!(current.authority_epoch, binding.authority_epoch);
    // Exact original record stays under the original stopped capability. No
    // rebased original proof or invented reconnect adoption is introduced.
    boundary.persist_atomic(&mut lease, &loaded).await?;
    assert_eq!(binding, original_binding);
    drop(lease);
    drop(boundary);
    drop(authority);
    drop(original);
    drop(owner);
    let reopened = Arc::new(EnrollmentOwner::new(
        Connection::open(&owner_path).unwrap(),
        Arc::clone(&access),
        journal,
    )?);
    assert_eq!(reopened.capture(&principal)?, current);
    let current_native = NativeHostContext::capture(
        principal,
        current.clone(),
        &NativePrincipalPort::new(Arc::clone(&access)),
    )
    .await?;
    let fresh_authority = Arc::new(NativeCredentialAuthority::new(
        reopened,
        |context: &NativeHostContext| context,
    ));
    let fresh_boundary = Boundary::with_keys(
        &credential_path,
        "synthetic-existing-key-host",
        fresh_authority,
        SyntheticKey,
    )?;
    let fresh_lease = fresh_boundary.acquire(&current_native, &current).await?;
    let restored = fresh_boundary.load(&fresh_lease).await?;
    assert_eq!(restored.binding, original_binding);
    assert_eq!(restored.state, LifecycleState::Disconnected);
    assert!(restored.credentials.is_none() && restored.identity.is_none());
    println!(
        "PASS encrypted first-record enrollment, actual AT11 native authority/original proof/fence, stopped terminal persistence and healthy encrypted reopen"
    );
    println!(
        "Synthetic key only; public native-key wrapper is compiled, not executed. No reconnect, native key, provider or inference qualification."
    );
    Ok(())
}
