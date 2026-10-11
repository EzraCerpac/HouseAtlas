//! Positive synthetic full-record codec fixture. No encryption or storage.

pub use houseatlas_backend::ai;

#[path = "record.rs"]
mod record;

use houseatlas_backend::ai::{
    AiError,
    oauth::{
        self, ClientAuthentication, FreshAuthorization, LifecycleState, ProtectedValue,
        RefreshCheckpoint, RegistrationBinding, RegistrationKind, RegistrationRecord,
        RevocationState, SavedCredentials, SignInPurpose, TokenReply, VerifiedIdentity,
    },
};

fn protected(value: &str) -> Result<ProtectedValue, AiError> {
    ProtectedValue::from_trusted_adapter(value.to_owned())
}

fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-registration-41".into(),
        actor_id: "synthetic-actor-17".into(),
        workspace_id: "synthetic-workspace-23".into(),
        home_id: "synthetic-home-29".into(),
        authority_epoch: "synthetic-authority-31".into(),
        cancellation_epoch: "synthetic-cancellation-37".into(),
    }
}

fn reply() -> Result<TokenReply, AiError> {
    Ok(TokenReply {
        id_token: Some(protected("synthetic-raw-id-token")?),
        access_token: Some(protected("synthetic-raw-access-token")?),
        refresh_token: Some(protected("synthetic-raw-refresh-token")?),
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

fn checkpoint(variant: usize) -> Result<RefreshCheckpoint, AiError> {
    let b = binding();
    Ok(match variant {
        0 => RefreshCheckpoint::None,
        1 => RefreshCheckpoint::InvocationUnconfirmed(b),
        2 => RefreshCheckpoint::Received {
            binding: b,
            reply: reply()?,
        },
        3 => RefreshCheckpoint::ExchangeReceived {
            binding: b,
            client_id: "synthetic-issued-client-43".into(),
            nonce: protected("synthetic-original-nonce")?,
            reply: reply()?,
        },
        _ => unreachable!("fixture uses only the four checkpoint variants"),
    })
}

fn registration(
    kind: RegistrationKind,
    state: LifecycleState,
    revocation: RevocationState,
    checkpoint: RefreshCheckpoint,
) -> Result<RegistrationRecord, AiError> {
    Ok(RegistrationRecord {
        binding: binding(),
        kind,
        app_name: "Synthetic HouseAtlas AI host".into(),
        stable_host_id: "synthetic-host-47".into(),
        issued_client_id: Some("synthetic-issued-client-43".into()),
        identity: Some(VerifiedIdentity {
            subject: "synthetic-subject-53".into(),
            name: Some("Synthetic Person".into()),
            email: Some("person@example.invalid".into()),
        }),
        credentials: Some(SavedCredentials {
            id_token: Some(protected("synthetic-saved-id-token")?),
            access_token: Some(protected("synthetic-saved-access-token")?),
            refresh_token: Some(protected("synthetic-saved-refresh-token")?),
            expires_at_ms: Some(1_900_000_000_321),
            granted_scopes: vec!["openid".into(), "resource.invoke".into()],
        }),
        pending_authorization: Some(oauth::AuthorizationAttempt {
            binding: binding(),
            material: FreshAuthorization {
                state: protected("synthetic-pending-state")?,
                nonce: protected("synthetic-pending-nonce")?,
                verifier: protected("synthetic-pending-verifier")?,
                s256_challenge: "synthetic-s256-challenge".into(),
            },
            redirect_uri: "http://127.0.0.1:43123/ai/callback".into(),
            callback_host: "127.0.0.1:43123".into(),
            purpose: SignInPurpose::EnablePlanUse,
            client_id: "synthetic-issued-client-43".into(),
            authentication: ClientAuthentication::IssuedSecretBasic,
            expires_at_ms: 1_800_000_600_123,
        }),
        refresh_checkpoint: checkpoint,
        state,
        revocation,
    })
}

fn check_record(
    record: &RegistrationRecord,
    expected_kind: &RegistrationKind,
    expected_state: LifecycleState,
    expected_revocation: RevocationState,
    checkpoint_variant: usize,
) -> Result<(), AiError> {
    assert_eq!(record.binding, binding());
    assert_eq!(&record.kind, expected_kind);
    assert_eq!(record.app_name, "Synthetic HouseAtlas AI host");
    assert_eq!(record.stable_host_id, "synthetic-host-47");
    assert_eq!(
        record.issued_client_id.as_deref(),
        Some("synthetic-issued-client-43")
    );
    let identity = record
        .identity
        .as_ref()
        .expect("synthetic identity retained");
    assert_eq!(identity.subject, "synthetic-subject-53");
    assert_eq!(identity.name.as_deref(), Some("Synthetic Person"));
    assert_eq!(identity.email.as_deref(), Some("person@example.invalid"));
    let credentials = record
        .credentials
        .as_ref()
        .expect("existing credentials retained");
    assert_eq!(
        credentials
            .id_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "synthetic-saved-id-token"
    );
    assert_eq!(
        credentials
            .access_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "synthetic-saved-access-token"
    );
    assert_eq!(
        credentials
            .refresh_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "synthetic-saved-refresh-token"
    );
    assert_eq!(credentials.expires_at_ms, Some(1_900_000_000_321));
    assert_eq!(credentials.granted_scopes, ["openid", "resource.invoke"]);
    let pending = record
        .pending_authorization
        .as_ref()
        .expect("pending authorization retained");
    assert_eq!(pending.binding, binding());
    assert_eq!(
        pending.material.state.expose_in_trusted_boundary(),
        "synthetic-pending-state"
    );
    assert_eq!(
        pending.material.nonce.expose_in_trusted_boundary(),
        "synthetic-pending-nonce"
    );
    assert_eq!(
        pending.material.verifier.expose_in_trusted_boundary(),
        "synthetic-pending-verifier"
    );
    assert_eq!(pending.material.s256_challenge, "synthetic-s256-challenge");
    assert_eq!(pending.redirect_uri, "http://127.0.0.1:43123/ai/callback");
    assert_eq!(pending.callback_host, "127.0.0.1:43123");
    assert_eq!(pending.purpose, SignInPurpose::EnablePlanUse);
    assert_eq!(pending.client_id, "synthetic-issued-client-43");
    assert_eq!(
        pending.authentication,
        ClientAuthentication::IssuedSecretBasic
    );
    assert_eq!(pending.expires_at_ms, 1_800_000_600_123);
    assert_eq!(record.state, expected_state);
    assert_eq!(record.revocation, expected_revocation);

    match (&record.refresh_checkpoint, checkpoint_variant) {
        (RefreshCheckpoint::None, 0) => {}
        (RefreshCheckpoint::InvocationUnconfirmed(b), 1) => assert_eq!(b, &binding()),
        (
            RefreshCheckpoint::Received {
                binding: b,
                reply: r,
            },
            2,
        ) => {
            assert_eq!(b, &binding());
            check_reply(r);
        }
        (
            RefreshCheckpoint::ExchangeReceived {
                binding: b,
                client_id,
                nonce,
                reply: r,
            },
            3,
        ) => {
            assert_eq!(b, &binding());
            assert_eq!(client_id, "synthetic-issued-client-43");
            assert_eq!(
                nonce.expose_in_trusted_boundary(),
                "synthetic-original-nonce"
            );
            check_reply(r);
        }
        _ => panic!("checkpoint variant changed in full-record round trip"),
    }
    Ok(())
}

fn check_reply(reply: &TokenReply) {
    assert_eq!(
        reply
            .id_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "synthetic-raw-id-token"
    );
    assert_eq!(
        reply
            .access_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "synthetic-raw-access-token"
    );
    assert_eq!(
        reply
            .refresh_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "synthetic-raw-refresh-token"
    );
    assert_eq!(reply.token_type.as_deref(), Some("Bearer"));
    assert_eq!(reply.expires_at_ms, Some(1_900_000_000_123));
    assert_eq!(
        reply.granted_scopes.as_deref().unwrap(),
        ["openid", "profile", "email", "offline_access"]
    );
    assert_eq!(reply.received_at_ms, 1_800_000_000_123);
}

fn main() -> Result<(), AiError> {
    let kinds = [
        RegistrationKind::LocalPublicClient,
        RegistrationKind::IssuedWebsite {
            registered_callback: "https://synthetic.example.invalid/oauth/callback".into(),
            callback_host: "synthetic.example.invalid".into(),
            authentication: ClientAuthentication::Public,
        },
        RegistrationKind::IssuedWebsite {
            registered_callback: "https://synthetic.example.invalid/oauth/callback".into(),
            callback_host: "synthetic.example.invalid".into(),
            authentication: ClientAuthentication::IssuedSecretBasic,
        },
    ];
    let states = [
        LifecycleState::Disconnected,
        LifecycleState::Connected,
        LifecycleState::PlanUseDisabled,
        LifecycleState::ReauthorizationRequired,
        LifecycleState::ConfigurationRepairRequired,
        LifecycleState::IdentityVerificationPending,
        LifecycleState::RefreshUnconfirmed,
    ];
    let revocations = [
        RevocationState::NotRequested,
        RevocationState::Confirmed,
        RevocationState::Unconfirmed,
    ];
    let mut cases = 0usize;
    for kind in kinds {
        for state in states {
            for revocation in revocations {
                for variant in 0..4 {
                    let original =
                        registration(kind.clone(), state, revocation, checkpoint(variant)?)?;
                    let plaintext = record::encode(&original)?;
                    let decoded = record::decode(plaintext.expose_for_encryption())?;
                    check_record(&decoded, &kind, state, revocation, variant)?;
                    let reencoded = record::encode(&decoded)?;
                    assert_eq!(
                        reencoded.expose_for_encryption(),
                        plaintext.expose_for_encryption(),
                        "synthetic full-record codec bytes remain stable after decode/re-encode"
                    );
                    cases += 1;
                }
            }
        }
    }
    println!(
        "PASS synthetic full RegistrationRecord codec: {cases} healthy round trips across all checkpoint variants, registration kinds, lifecycle states, and revocation states"
    );
    println!("No encryption, credential storage, OAuth exchange, or inference was exercised.");
    Ok(())
}
