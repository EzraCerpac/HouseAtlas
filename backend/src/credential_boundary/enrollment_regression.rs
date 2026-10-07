//! Explicitly selected, bounded synthetic first-enrollment regression cases.
//! These cases use disposable private files and synthetic authority/key peers.

pub use houseatlas_backend::ai;

#[path = "authority.rs"]
mod authority;
#[path = "boundary.rs"]
mod boundary;
#[path = "crypto.rs"]
mod crypto;
#[cfg(unix)]
#[path = "filesystem.rs"]
mod filesystem;
#[cfg(not(unix))]
#[path = "filesystem_unavailable.rs"]
mod filesystem;
#[path = "keys.rs"]
mod keys;
#[path = "material.rs"]
mod material;
#[path = "record.rs"]
mod record;

use ai::{
    AiError, PortFuture,
    oauth::{
        ClientAuthentication, CredentialBoundary, LifecycleState, RefreshCheckpoint,
        RegistrationBinding, RegistrationKind, RegistrationRecord, RevocationState,
        VerifiedIdentity,
    },
};
use authority::CredentialAuthority;
use boundary::{Boundary, FileCredentialBoundary};
use keys::{KeyProvider, SecretKey};
use std::{
    path::Path,
    sync::{
        Arc, Barrier, Mutex,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    time::Duration,
};

const HOST_ID: &str = "synthetic-enrollment-host-19";
const KEY_BYTES: [u8; 32] = [
    0x31, 0x42, 0x53, 0x64, 0x75, 0x86, 0x97, 0xa8, 0xb9, 0xca, 0xdb, 0xec, 0xfd, 0x0e, 0x1f, 0x20,
    0x30, 0x41, 0x52, 0x63, 0x74, 0x85, 0x96, 0xa7, 0xb8, 0xc9, 0xda, 0xeb, 0xfc, 0x0d, 0x1e, 0x2f,
];
const CASES: [&str; 7] = [
    "empty-enrollment",
    "existing-enrollment-denied",
    "racing-enrollment",
    "blank-app-enrollment-denied",
    "blank-host-construction-denied",
    "invalid-issued-client-transition-denied",
    "known-subject-clear-denied",
];

fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-first-registration-29".into(),
        actor_id: "synthetic-actor-31".into(),
        workspace_id: "synthetic-workspace-37".into(),
        home_id: "synthetic-home-41".into(),
        authority_epoch: "synthetic-authority-43".into(),
        cancellation_epoch: "synthetic-cancellation-47".into(),
    }
}

fn initial_record(app_name: &str) -> RegistrationRecord {
    RegistrationRecord {
        binding: binding(),
        kind: RegistrationKind::IssuedWebsite {
            registered_callback: "https://synthetic.example.invalid/ai/callback".into(),
            callback_host: "synthetic.example.invalid".into(),
            authentication: ClientAuthentication::Public,
        },
        app_name: app_name.into(),
        stable_host_id: HOST_ID.into(),
        issued_client_id: None,
        identity: None,
        credentials: None,
        pending_authorization: None,
        refresh_checkpoint: RefreshCheckpoint::None,
        state: LifecycleState::Disconnected,
        revocation: RevocationState::NotRequested,
    }
}

#[derive(Clone)]
struct SyntheticAuthority {
    exact_scope: Arc<Mutex<RegistrationBinding>>,
    retain_calls: Arc<AtomicUsize>,
}

impl SyntheticAuthority {
    fn new(binding: RegistrationBinding) -> Self {
        Self {
            exact_scope: Arc::new(Mutex::new(binding)),
            retain_calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn retain_calls(&self) -> usize {
        self.retain_calls.load(Ordering::SeqCst)
    }

    fn check(&self, binding: &RegistrationBinding) -> Result<(), AiError> {
        let exact = self
            .exact_scope
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?;
        if &*exact == binding {
            Ok(())
        } else {
            Err(AiError::DomainUnavailable)
        }
    }
}

impl CredentialAuthority<RegistrationBinding> for SyntheticAuthority {
    type Original = RegistrationBinding;
    type Stopped = ();

    fn retain(
        &self,
        context: &RegistrationBinding,
        binding: &RegistrationBinding,
    ) -> Result<Self::Original, AiError> {
        self.retain_calls.fetch_add(1, Ordering::SeqCst);
        if context != binding {
            return Err(AiError::DomainUnavailable);
        }
        self.check(binding)?;
        Ok(binding.clone())
    }

    fn revalidate(
        &self,
        context: &RegistrationBinding,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        if context != binding || original != binding {
            return Err(AiError::DomainUnavailable);
        }
        self.check(binding)
    }

    fn revalidate_retained(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        if original != binding {
            return Err(AiError::DomainUnavailable);
        }
        self.check(binding)
    }

    fn stop_use(
        &self,
        _: &Self::Original,
        _: &RegistrationBinding,
    ) -> Result<Self::Stopped, AiError> {
        // This fixture has no stop-use/cancellation behavior.
        Err(AiError::DomainUnavailable)
    }

    fn revalidate_stopped(
        &self,
        _: &Self::Original,
        _: &RegistrationBinding,
        _: &Self::Stopped,
    ) -> Result<(), AiError> {
        Err(AiError::DomainUnavailable)
    }

    fn with_persistence_fence<T, F>(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
        _: Option<&Self::Stopped>,
        commit: F,
    ) -> Result<T, AiError>
    where
        F: FnOnce() -> Result<T, AiError>,
    {
        if original != binding {
            return Err(AiError::DomainUnavailable);
        }
        let exact = self
            .exact_scope
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?;
        if &*exact != binding {
            return Err(AiError::DomainUnavailable);
        }
        commit()
    }
}

#[derive(Clone)]
struct SyntheticKeys {
    exact_key_id: String,
    load_calls: Arc<AtomicUsize>,
}

impl KeyProvider for SyntheticKeys {
    fn load<'a>(&'a self, id: &'a str) -> PortFuture<'a, SecretKey> {
        Box::pin(async move {
            self.load_calls.fetch_add(1, Ordering::SeqCst);
            if id != self.exact_key_id {
                return Err(AiError::DomainUnavailable);
            }
            SecretKey::new(KEY_BYTES.to_vec())
        })
    }
}

fn adapter(
    path: &Path,
    authority: Arc<SyntheticAuthority>,
    binding: &RegistrationBinding,
) -> Result<Boundary<RegistrationBinding, SyntheticAuthority, SyntheticKeys>, AiError> {
    adapter_with_key_counter(path, authority, binding, Arc::new(AtomicUsize::new(0)))
}

fn adapter_with_key_counter(
    path: &Path,
    authority: Arc<SyntheticAuthority>,
    binding: &RegistrationBinding,
    load_calls: Arc<AtomicUsize>,
) -> Result<Boundary<RegistrationBinding, SyntheticAuthority, SyntheticKeys>, AiError> {
    let (exact_key_id, _) = boundary::record_location(HOST_ID, binding)?;
    Boundary::with_keys(
        path,
        HOST_ID,
        authority,
        SyntheticKeys {
            exact_key_id,
            load_calls,
        },
    )
}

async fn empty_enrollment() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let store = adapter(directory.path(), Arc::clone(&authority), &b)?;
    let original = initial_record("Synthetic first enrollment");
    let lease = store.enroll_atomic(&b, &b, &original).await?;
    let loaded = store.load(&lease).await?;
    let expected = record::encode(&original)?;
    let actual = record::encode(&loaded)?;
    assert_eq!(
        expected.expose_for_encryption(),
        actual.expose_for_encryption()
    );
    drop(lease);

    let reopened = adapter(directory.path(), authority, &b)?;
    let lease = reopened.acquire(&b, &b).await?;
    let loaded_after_reopen = reopened.load(&lease).await?;
    let reopened_bytes = record::encode(&loaded_after_reopen)?;
    assert_eq!(
        expected.expose_for_encryption(),
        reopened_bytes.expose_for_encryption()
    );
    assert_initial_shape(&loaded_after_reopen);
    Ok(())
}

async fn existing_enrollment_denied() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let first = adapter(directory.path(), Arc::clone(&authority), &b)?;
    let original = initial_record("Original synthetic enrollment");
    let lease = first.enroll_atomic(&b, &b, &original).await?;
    drop(lease);

    let (name, _) = boundary::record_location(HOST_ID, &b)?;
    let ciphertext_path = directory.path().join(format!("{name}.bin"));
    let before = std::fs::read(&ciphertext_path).map_err(|_| AiError::DomainUnavailable)?;
    let second = adapter(directory.path(), Arc::clone(&authority), &b)?;
    let replacement = initial_record("Different trusted synthetic app label");
    let denied = second.enroll_atomic(&b, &b, &replacement).await;
    assert!(
        denied.is_err(),
        "existing registration cannot be overwritten by enrollment"
    );
    drop(denied);
    let after = std::fs::read(&ciphertext_path).map_err(|_| AiError::DomainUnavailable)?;
    assert_eq!(
        before, after,
        "denied enrollment leaves the original ciphertext unchanged"
    );

    let reopened = adapter(directory.path(), authority, &b)?;
    let lease = reopened.acquire(&b, &b).await?;
    let retained = reopened.load(&lease).await?;
    assert_eq!(retained.app_name, "Original synthetic enrollment");
    let retained_bytes = record::encode(&retained)?;
    let original_bytes = record::encode(&original)?;
    assert_eq!(
        retained_bytes.expose_for_encryption(),
        original_bytes.expose_for_encryption()
    );
    Ok(())
}

async fn blank_app_enrollment_denied() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let key_loads = Arc::new(AtomicUsize::new(0));
    let store = adapter_with_key_counter(
        directory.path(),
        Arc::clone(&authority),
        &b,
        Arc::clone(&key_loads),
    )?;

    let invalid = initial_record(" \t\n ");
    match store.enroll_atomic(&b, &b, &invalid).await {
        Err(error) => assert_eq!(error, AiError::InvalidInput),
        Ok(lease) => {
            drop(lease);
            panic!("whitespace-only app name must be rejected as invalid input")
        }
    }
    assert_eq!(
        authority.retain_calls(),
        0,
        "authority is untouched on invalid input"
    );
    assert_eq!(
        key_loads.load(Ordering::SeqCst),
        0,
        "key provider is untouched on invalid input"
    );
    let mut entries =
        std::fs::read_dir(directory.path()).map_err(|_| AiError::DomainUnavailable)?;
    assert!(
        entries.next().is_none(),
        "invalid input creates no lock or ciphertext files"
    );

    let valid = initial_record("Synthetic enrollment after local validation");
    let lease = store.enroll_atomic(&b, &b, &valid).await?;
    let loaded = store.load(&lease).await?;
    let expected = record::encode(&valid)?;
    let actual = record::encode(&loaded)?;
    assert_eq!(
        expected.expose_for_encryption(),
        actual.expose_for_encryption()
    );
    drop(lease);

    let reopened = adapter_with_key_counter(
        directory.path(),
        authority.clone(),
        &b,
        Arc::clone(&key_loads),
    )?;
    let lease = reopened.acquire(&b, &b).await?;
    let reloaded = reopened.load(&lease).await?;
    let reopened_bytes = record::encode(&reloaded)?;
    assert_eq!(
        expected.expose_for_encryption(),
        reopened_bytes.expose_for_encryption()
    );
    assert_eq!(
        reloaded.app_name,
        "Synthetic enrollment after local validation"
    );
    assert!(authority.retain_calls() > 0);
    assert!(key_loads.load(Ordering::SeqCst) > 0);
    Ok(())
}

async fn blank_host_construction_denied() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let key_loads = Arc::new(AtomicUsize::new(0));
    let (exact_key_id, _) = boundary::record_location(" \t\n ", &b)?;
    let invalid = Boundary::with_keys(
        directory.path(),
        " \t\n ",
        Arc::clone(&authority),
        SyntheticKeys {
            exact_key_id,
            load_calls: Arc::clone(&key_loads),
        },
    );
    match invalid {
        Err(error) => assert_eq!(error, AiError::InvalidInput),
        Ok(_) => panic!("whitespace-only host ID must be rejected at construction"),
    }
    assert_eq!(
        authority.retain_calls(),
        0,
        "authority is untouched at construction"
    );
    assert_eq!(
        key_loads.load(Ordering::SeqCst),
        0,
        "key provider is untouched at construction"
    );
    let mut entries =
        std::fs::read_dir(directory.path()).map_err(|_| AiError::DomainUnavailable)?;
    assert!(
        entries.next().is_none(),
        "invalid host construction creates no files"
    );

    let mut valid_record = initial_record("Synthetic local host enrollment");
    valid_record.kind = RegistrationKind::LocalPublicClient;
    let valid = adapter_with_key_counter(
        directory.path(),
        Arc::clone(&authority),
        &b,
        Arc::clone(&key_loads),
    )?;
    let lease = valid.enroll_atomic(&b, &b, &valid_record).await?;
    let loaded = valid.load(&lease).await?;
    let expected = record::encode(&valid_record)?;
    let actual = record::encode(&loaded)?;
    assert_eq!(
        expected.expose_for_encryption(),
        actual.expose_for_encryption()
    );
    assert_eq!(loaded.kind, RegistrationKind::LocalPublicClient);
    drop(lease);

    let reopened = adapter_with_key_counter(
        directory.path(),
        authority.clone(),
        &b,
        Arc::clone(&key_loads),
    )?;
    let lease = reopened.acquire(&b, &b).await?;
    let reloaded = reopened.load(&lease).await?;
    let reloaded_bytes = record::encode(&reloaded)?;
    assert_eq!(
        expected.expose_for_encryption(),
        reloaded_bytes.expose_for_encryption()
    );
    assert_eq!(reloaded.kind, RegistrationKind::LocalPublicClient);
    assert_initial_shape(&reloaded);
    assert!(authority.retain_calls() > 0);
    assert!(key_loads.load(Ordering::SeqCst) > 0);
    Ok(())
}

async fn invalid_issued_client_transition_denied() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let store = adapter(directory.path(), Arc::clone(&authority), &b)?;
    let initial = initial_record("Synthetic configured website");
    let mut lease = store.enroll_atomic(&b, &b, &initial).await?;
    let mut candidate = store.load(&lease).await?;
    let (name, _) = boundary::record_location(HOST_ID, &b)?;
    let ciphertext_path = directory.path().join(format!("{name}.bin"));
    let before = std::fs::read(&ciphertext_path).map_err(|_| AiError::DomainUnavailable)?;

    let invalid_ids = [
        String::new(),
        "dynamic_agent_client".to_owned(),
        "A".repeat(201),
        "client.with.dot".to_owned(),
    ];
    for client_id in &invalid_ids {
        candidate.issued_client_id = Some(client_id.clone());
        assert_eq!(
            store.persist_atomic(&mut lease, &candidate).await,
            Err(AiError::DomainUnavailable),
            "invalid synthetic configured client ID must be rejected"
        );
        let current = std::fs::read(&ciphertext_path).map_err(|_| AiError::DomainUnavailable)?;
        assert_eq!(
            current, before,
            "denied metadata transition preserves ciphertext"
        );
    }

    candidate.issued_client_id = Some("syntheticClient981".into());
    store.persist_atomic(&mut lease, &candidate).await?;
    let expected = record::encode(&candidate)?;
    drop(lease);

    let reopened = adapter(directory.path(), authority, &b)?;
    let lease = reopened.acquire(&b, &b).await?;
    let loaded = reopened.load(&lease).await?;
    assert_eq!(
        loaded.issued_client_id.as_deref(),
        Some("syntheticClient981")
    );
    let actual = record::encode(&loaded)?;
    assert_eq!(
        expected.expose_for_encryption(),
        actual.expose_for_encryption()
    );
    Ok(())
}

async fn known_subject_clear_denied() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let store = adapter(directory.path(), Arc::clone(&authority), &b)?;
    let initial = initial_record("Synthetic subject retention");
    let mut lease = store.enroll_atomic(&b, &b, &initial).await?;
    let mut candidate = store.load(&lease).await?;
    candidate.issued_client_id = Some("syntheticClient981".into());
    candidate.identity = Some(VerifiedIdentity {
        subject: "synthetic-subject-A".into(),
        name: None,
        email: None,
    });
    store.persist_atomic(&mut lease, &candidate).await?;

    let (name, _) = boundary::record_location(HOST_ID, &b)?;
    let ciphertext_path = directory.path().join(format!("{name}.bin"));
    let before = std::fs::read(&ciphertext_path).map_err(|_| AiError::DomainUnavailable)?;
    candidate.identity = None;
    assert_eq!(
        store.persist_atomic(&mut lease, &candidate).await,
        Err(AiError::DomainUnavailable),
        "a previously known subject cannot be cleared"
    );
    let after = std::fs::read(&ciphertext_path).map_err(|_| AiError::DomainUnavailable)?;
    assert_eq!(
        before, after,
        "denied subject clearing preserves ciphertext"
    );
    drop(lease);

    let reopened = adapter(directory.path(), authority, &b)?;
    let lease = reopened.acquire(&b, &b).await?;
    let loaded = reopened.load(&lease).await?;
    let identity = loaded
        .identity
        .as_ref()
        .expect("known subject remains present");
    assert_eq!(identity.subject, "synthetic-subject-A");
    assert!(identity.name.is_none());
    assert!(identity.email.is_none());
    assert_eq!(
        loaded.issued_client_id.as_deref(),
        Some("syntheticClient981")
    );
    Ok(())
}

fn assert_initial_shape(record: &RegistrationRecord) {
    assert_eq!(record.state, LifecycleState::Disconnected);
    assert_eq!(record.revocation, RevocationState::NotRequested);
    assert!(record.issued_client_id.is_none());
    assert!(record.identity.is_none());
    assert!(record.credentials.is_none());
    assert!(record.pending_authorization.is_none());
    assert!(matches!(record.refresh_checkpoint, RefreshCheckpoint::None));
}

async fn racing_enrollment() -> Result<(), AiError> {
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-enrollment-regression-")
        .tempdir()
        .map_err(|_| AiError::DomainUnavailable)?;
    let path = directory.path().to_owned();
    let b = binding();
    let authority = Arc::new(SyntheticAuthority::new(b.clone()));
    let first = adapter(&path, Arc::clone(&authority), &b)?;
    let second = adapter(&path, Arc::clone(&authority), &b)?;
    let gate = Arc::new(Barrier::new(3));
    let (release_a_tx, release_a_rx) = mpsc::channel::<()>();
    let (release_b_tx, release_b_rx) = mpsc::channel::<()>();

    enum RaceResult {
        Won(String),
        Denied,
        SetupFailed,
    }
    let (result_tx, result_rx) = mpsc::channel::<RaceResult>();

    let winner = std::thread::scope(|scope| {
        let launch = |store: Boundary<RegistrationBinding, SyntheticAuthority, SyntheticKeys>,
                      label: &'static str,
                      release_rx: mpsc::Receiver<()>| {
            let gate = Arc::clone(&gate);
            let result_tx = result_tx.clone();
            let b = b.clone();
            let _worker = scope.spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build();
                gate.wait();
                let Ok(runtime) = runtime else {
                    let _ = result_tx.send(RaceResult::SetupFailed);
                    let _ = release_rx.recv_timeout(Duration::from_secs(3));
                    return;
                };
                let record = initial_record(label);
                let result = runtime.block_on(store.enroll_atomic(&b, &b, &record));
                match result {
                    Ok(lease) => {
                        let _ = result_tx.send(RaceResult::Won(label.to_owned()));
                        let _ = release_rx.recv_timeout(Duration::from_secs(3));
                        drop(lease);
                    }
                    Err(_) => {
                        let _ = result_tx.send(RaceResult::Denied);
                        let _ = release_rx.recv_timeout(Duration::from_secs(3));
                    }
                }
            });
        };

        launch(first, "Race candidate A", release_a_rx);
        launch(second, "Race candidate B", release_b_rx);
        gate.wait();

        let first_result = result_rx.recv_timeout(Duration::from_secs(3));
        let second_result = result_rx.recv_timeout(Duration::from_secs(3));
        let _ = release_a_tx.send(());
        let _ = release_b_tx.send(());
        let first_result = first_result.expect("first racing adapter reports within the bound");
        let second_result = second_result.expect("second racing adapter reports within the bound");
        assert!(
            (matches!(&first_result, RaceResult::Won(_))
                && matches!(&second_result, RaceResult::Denied))
                || (matches!(&first_result, RaceResult::Denied)
                    && matches!(&second_result, RaceResult::Won(_))),
            "exactly one racing enrollment wins and the other is denied"
        );
        match (first_result, second_result) {
            (RaceResult::Won(name), RaceResult::Denied)
            | (RaceResult::Denied, RaceResult::Won(name)) => name,
            _ => unreachable!("the race outcome was checked above"),
        }
    });

    let reopened = adapter(&path, authority, &b)?;
    let lease = reopened.acquire(&b, &b).await?;
    let loaded = reopened.load(&lease).await?;
    assert_eq!(
        loaded.app_name, winner,
        "the persisted record belongs to the winner"
    );
    assert_initial_shape(&loaded);
    Ok(())
}

fn verify_production_contract<T>()
where
    T: CredentialBoundary<RegistrationBinding>,
    <T as CredentialBoundary<RegistrationBinding>>::Lease: Send + Sync,
{
}

enum Case {
    Empty,
    ExistingDenied,
    Racing,
    BlankDenied,
    BlankHostDenied,
    InvalidClientTransition,
    SubjectClear,
}

fn select_case() -> Result<Case, AiError> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 || args[0] != "--case" || !CASES.contains(&args[1].as_str()) {
        return Err(AiError::InvalidInput);
    }
    match args[1].as_str() {
        "empty-enrollment" => Ok(Case::Empty),
        "existing-enrollment-denied" => Ok(Case::ExistingDenied),
        "racing-enrollment" => Ok(Case::Racing),
        "blank-app-enrollment-denied" => Ok(Case::BlankDenied),
        "blank-host-construction-denied" => Ok(Case::BlankHostDenied),
        "invalid-issued-client-transition-denied" => Ok(Case::InvalidClientTransition),
        "known-subject-clear-denied" => Ok(Case::SubjectClear),
        _ => Err(AiError::InvalidInput),
    }
}

#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), AiError> {
    verify_production_contract::<FileCredentialBoundary<RegistrationBinding, SyntheticAuthority>>();
    let _native_constructor =
        FileCredentialBoundary::<RegistrationBinding, SyntheticAuthority>::new_existing;
    let _native_enrollment =
        FileCredentialBoundary::<RegistrationBinding, SyntheticAuthority>::enroll_atomic;
    let selected = select_case()?;
    tokio::time::timeout(Duration::from_secs(10), async move {
        match selected {
            Case::Empty => empty_enrollment().await,
            Case::ExistingDenied => existing_enrollment_denied().await,
            Case::Racing => racing_enrollment().await,
            Case::BlankDenied => blank_app_enrollment_denied().await,
            Case::BlankHostDenied => blank_host_construction_denied().await,
            Case::InvalidClientTransition => invalid_issued_client_transition_denied().await,
            Case::SubjectClear => known_subject_clear_denied().await,
        }
    })
    .await
    .map_err(|_| AiError::DomainUnavailable)??;
    println!("PASS explicitly selected synthetic enrollment case completed");
    Ok(())
}

#[cfg(not(unix))]
fn main() {
    // The compiled unsupported-platform boundary remains unavailable.
}
