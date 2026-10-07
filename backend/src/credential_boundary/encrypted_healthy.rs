//! Positive encrypted credential-boundary fixture with synthetic key and authority peers.

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
        self, ClientAuthentication, CredentialBoundary, FreshAuthorization, LifecycleState,
        ProtectedValue, RefreshCheckpoint, RegistrationBinding, RegistrationKind,
        RegistrationRecord, RevocationState, SavedCredentials, SignInPurpose, TokenReply,
        VerifiedIdentity,
    },
};
use authority::CredentialAuthority;
use boundary::{Boundary, FileCredentialBoundary};
use keys::{KeyProvider, SecretKey};
use std::{path::Path, sync::Arc};

const HOST_ID: &str = "synthetic-credential-host-9";
const KEY_BYTES: [u8; 32] = [
    0x11, 0x02, 0x23, 0x34, 0x45, 0x56, 0x67, 0x78, 0x89, 0x9a, 0xab, 0xbc, 0xcd, 0xde, 0xef, 0xf0,
    0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87, 0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f,
];

fn protected(value: &str) -> Result<ProtectedValue, AiError> {
    ProtectedValue::from_trusted_adapter(value.to_owned())
}

fn binding(index: usize) -> RegistrationBinding {
    RegistrationBinding {
        registration_id: format!("synthetic-registration-{index}"),
        actor_id: "synthetic-actor-17".into(),
        workspace_id: "synthetic-workspace-23".into(),
        home_id: "synthetic-home-29".into(),
        authority_epoch: "synthetic-authority-31".into(),
        cancellation_epoch: format!("synthetic-cancellation-{index}"),
    }
}

fn raw_reply() -> Result<TokenReply, AiError> {
    Ok(TokenReply {
        id_token: Some(protected("fixture-raw-id-token-should-not-be-on-disk")?),
        access_token: Some(protected("fixture-raw-access-token-should-not-be-on-disk")?),
        refresh_token: Some(protected(
            "fixture-raw-refresh-token-should-not-be-on-disk",
        )?),
        token_type: Some("Bearer".into()),
        expires_at_ms: Some(1_900_000_000_123),
        granted_scopes: Some(vec![
            "openid".into(),
            "profile".into(),
            "email".into(),
            "offline_access".into(),
        ]),
        received_at_ms: 1_800_000_000_123,
    })
}

fn checkpoint(index: usize, b: RegistrationBinding) -> Result<RefreshCheckpoint, AiError> {
    Ok(match index {
        0 => RefreshCheckpoint::None,
        1 => RefreshCheckpoint::InvocationUnconfirmed(b),
        2 => RefreshCheckpoint::Received {
            binding: b,
            reply: raw_reply()?,
        },
        3 => RefreshCheckpoint::ExchangeReceived {
            binding: b,
            client_id: "synthetic-issued-client-43".into(),
            nonce: protected("fixture-original-exchange-nonce-should-not-be-on-disk")?,
            reply: raw_reply()?,
        },
        _ => unreachable!("fixture covers exactly four checkpoint variants"),
    })
}

fn fixture_record(index: usize) -> Result<RegistrationRecord, AiError> {
    let b = binding(index);
    Ok(RegistrationRecord {
        binding: b.clone(),
        kind: RegistrationKind::IssuedWebsite {
            registered_callback: "https://synthetic.example.invalid/ai/callback".into(),
            callback_host: "synthetic.example.invalid".into(),
            authentication: ClientAuthentication::IssuedSecretBasic,
        },
        app_name: "Synthetic HouseAtlas AI host".into(),
        stable_host_id: HOST_ID.into(),
        issued_client_id: Some("synthetic-issued-client-43".into()),
        identity: Some(VerifiedIdentity {
            subject: "synthetic-subject-53".into(),
            name: Some("Synthetic Person".into()),
            email: Some("person@example.invalid".into()),
        }),
        // The saved set is intentionally present with a pending checkpoint.
        credentials: Some(SavedCredentials {
            id_token: Some(protected("fixture-saved-id-token-should-not-be-on-disk")?),
            access_token: Some(protected(
                "fixture-saved-access-token-should-not-be-on-disk",
            )?),
            refresh_token: Some(protected(
                "fixture-saved-refresh-token-should-not-be-on-disk",
            )?),
            expires_at_ms: Some(1_900_000_000_321),
            granted_scopes: vec!["openid".into(), "resource.invoke".into()],
        }),
        pending_authorization: Some(oauth::AuthorizationAttempt {
            binding: b.clone(),
            material: FreshAuthorization {
                state: protected("fixture-pending-state-should-not-be-on-disk")?,
                nonce: protected("fixture-pending-nonce-should-not-be-on-disk")?,
                verifier: protected("fixture-pending-verifier-should-not-be-on-disk")?,
                s256_challenge: "synthetic-s256-challenge".into(),
            },
            redirect_uri: "https://synthetic.example.invalid/ai/callback".into(),
            callback_host: "synthetic.example.invalid".into(),
            purpose: SignInPurpose::EnablePlanUse,
            client_id: "synthetic-issued-client-43".into(),
            authentication: ClientAuthentication::IssuedSecretBasic,
            expires_at_ms: 1_800_000_600_123,
        }),
        refresh_checkpoint: checkpoint(index, b)?,
        state: [
            LifecycleState::Connected,
            LifecycleState::RefreshUnconfirmed,
            LifecycleState::IdentityVerificationPending,
            LifecycleState::RefreshUnconfirmed,
        ][index],
        revocation: RevocationState::NotRequested,
    })
}

#[derive(Clone)]
struct SyntheticAuthority;

impl CredentialAuthority<()> for SyntheticAuthority {
    type Original = RegistrationBinding;
    type Stopped = ();

    fn retain(&self, _: &(), binding: &RegistrationBinding) -> Result<Self::Original, AiError> {
        Ok(binding.clone())
    }

    fn revalidate(
        &self,
        _: &(),
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        assert_eq!(original, binding);
        Ok(())
    }

    fn revalidate_retained(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        assert_eq!(original, binding);
        Ok(())
    }

    fn stop_use(
        &self,
        _: &Self::Original,
        _: &RegistrationBinding,
    ) -> Result<Self::Stopped, AiError> {
        Ok(())
    }

    fn revalidate_stopped(
        &self,
        _: &Self::Original,
        _: &RegistrationBinding,
        _: &Self::Stopped,
    ) -> Result<(), AiError> {
        Ok(())
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
        assert_eq!(original, binding);
        commit()
    }
}

#[derive(Clone)]
struct SyntheticKeys;

impl KeyProvider for SyntheticKeys {
    fn load<'a>(&'a self, id: &'a str) -> PortFuture<'a, SecretKey> {
        Box::pin(async move {
            assert_eq!(id.len(), 64, "adapter derives installation key identifiers");
            SecretKey::new(KEY_BYTES.to_vec())
        })
    }
}

async fn round_trip(path: &Path, index: usize) -> Result<(), AiError> {
    let original = fixture_record(index)?;
    let (id, aad) = boundary::record_location(HOST_ID, &original.binding)?;
    let key = SecretKey::new(KEY_BYTES.to_vec())?;

    // Seed a disposable encrypted registration through the same file and AEAD
    // primitives so the ordinary boundary can load its required preimage.
    let files = filesystem::FileStore::open(path)?;
    let seed_lease = files.acquire(&id)?;
    let encoded = record::encode(&original)?;
    let ciphertext = crypto::seal(&key, &aad, encoded.expose_for_encryption())?;
    seed_lease.replace_atomic(None, &ciphertext)?;
    drop(seed_lease);

    let adapter = Boundary::<(), SyntheticAuthority, SyntheticKeys>::with_keys(
        path,
        HOST_ID,
        Arc::new(SyntheticAuthority),
        SyntheticKeys,
    )?;
    let now = adapter.now_ms()?;
    assert!(now > 0 && now < 9_007_199_254_740_991);
    let mut lease = adapter.acquire(&(), &original.binding).await?;
    adapter.revalidate(&(), &lease, &original.binding).await?;
    let loaded = adapter.load(&lease).await?;
    assert_record_round_trip(&original, &loaded, index)?;
    adapter.persist_atomic(&mut lease, &loaded).await?;

    let at_rest_path = path.join(format!("{id}.bin"));
    let at_rest = std::fs::read(&at_rest_path).map_err(|_| AiError::DomainUnavailable)?;
    for marker in [
        "fixture-raw-id-token-should-not-be-on-disk",
        "fixture-raw-access-token-should-not-be-on-disk",
        "fixture-raw-refresh-token-should-not-be-on-disk",
        "fixture-saved-access-token-should-not-be-on-disk",
        "fixture-pending-verifier-should-not-be-on-disk",
    ] {
        assert!(
            !at_rest
                .windows(marker.len())
                .any(|window| window == marker.as_bytes())
        );
    }
    drop(lease);

    // A new adapter instance and lease demonstrate a healthy encrypted reopen.
    let reopened = Boundary::<(), SyntheticAuthority, SyntheticKeys>::with_keys(
        path,
        HOST_ID,
        Arc::new(SyntheticAuthority),
        SyntheticKeys,
    )?;
    let lease = reopened.acquire(&(), &original.binding).await?;
    let after_reopen = reopened.load(&lease).await?;
    assert_record_round_trip(&original, &after_reopen, index)?;
    let reopened_bytes = record::encode(&after_reopen)?;
    assert_eq!(
        reopened_bytes.expose_for_encryption(),
        encoded.expose_for_encryption(),
        "complete synthetic record is preserved through encrypted persist and reopen"
    );
    Ok(())
}

fn verify_production_contract<T>()
where
    T: CredentialBoundary<()>,
    <T as CredentialBoundary<()>>::Lease: Send + Sync,
{
}

fn assert_record_round_trip(
    expected: &RegistrationRecord,
    actual: &RegistrationRecord,
    index: usize,
) -> Result<(), AiError> {
    let a = record::encode(expected)?;
    let b = record::encode(actual)?;
    assert_eq!(a.expose_for_encryption(), b.expose_for_encryption());
    assert_eq!(actual.binding, expected.binding);
    assert_eq!(actual.kind, expected.kind);
    assert_eq!(actual.stable_host_id, HOST_ID);
    assert_eq!(actual.state, expected.state);
    assert_eq!(actual.revocation, RevocationState::NotRequested);
    let credentials = actual
        .credentials
        .as_ref()
        .expect("prior credentials retained");
    assert_eq!(
        credentials
            .access_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "fixture-saved-access-token-should-not-be-on-disk"
    );
    let pending = actual
        .pending_authorization
        .as_ref()
        .expect("pending authorization retained");
    assert_eq!(
        pending.material.verifier.expose_in_trusted_boundary(),
        "fixture-pending-verifier-should-not-be-on-disk"
    );
    match (&actual.refresh_checkpoint, index) {
        (RefreshCheckpoint::None, 0) => {}
        (RefreshCheckpoint::InvocationUnconfirmed(binding), 1) => {
            assert_eq!(binding, &expected.binding);
        }
        (RefreshCheckpoint::Received { binding, reply }, 2) => {
            assert_eq!(binding, &expected.binding);
            assert_eq!(
                reply
                    .access_token
                    .as_ref()
                    .unwrap()
                    .expose_in_trusted_boundary(),
                "fixture-raw-access-token-should-not-be-on-disk"
            );
        }
        (
            RefreshCheckpoint::ExchangeReceived {
                binding,
                client_id,
                nonce,
                reply,
            },
            3,
        ) => {
            assert_eq!(binding, &expected.binding);
            assert_eq!(client_id, "synthetic-issued-client-43");
            assert_eq!(
                nonce.expose_in_trusted_boundary(),
                "fixture-original-exchange-nonce-should-not-be-on-disk"
            );
            assert_eq!(
                reply
                    .access_token
                    .as_ref()
                    .unwrap()
                    .expose_in_trusted_boundary(),
                "fixture-raw-access-token-should-not-be-on-disk"
            );
        }
        _ => panic!("checkpoint variant changed during encrypted workflow"),
    }
    Ok(())
}

#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), AiError> {
    verify_production_contract::<FileCredentialBoundary<(), SyntheticAuthority>>();
    let _native_constructor = FileCredentialBoundary::<(), SyntheticAuthority>::new_existing;
    let _native_enrollment = FileCredentialBoundary::<(), SyntheticAuthority>::enroll_atomic;
    let _native_website_client_initialization =
        FileCredentialBoundary::<(), SyntheticAuthority>::initialize_website_client;
    let mut cases = 0;
    for index in 0..4 {
        let directory = tempfile::tempdir().map_err(|_| AiError::DomainUnavailable)?;
        round_trip(directory.path(), index).await?;
        cases += 1;
    }
    println!(
        "PASS synthetic AEAD credential boundary: {cases} full-record checkpoints encrypted, persisted, reopened and verified on disposable private files"
    );
    println!(
        "Key and authority peers were synthetic; no native OS credential provider was called."
    );
    Ok(())
}

#[cfg(not(unix))]
fn main() {
    println!(
        "Synthetic encrypted credential fixture requires the supported Unix private-file adapter."
    );
}
