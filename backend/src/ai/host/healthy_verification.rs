//! Positive retained-checkpoint fixture. Crypto/encryption/account peers are
//! synthetic. No callback exchange, refresh grant, revocation or inference.
use super::{Synthetic, binding};
use houseatlas_backend::ai::{
    self, AiError, Cancellation, PortFuture,
    host::{checkpoint, lifecycle::LifecycleHost, status::StatusJournal},
    oauth::{self, ProtectedValue},
    runtime::{self, ConnectionActionPort},
};
use rusqlite::Connection;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::{Mutex, OwnedMutexGuard};

fn protected(value: &str) -> Result<ProtectedValue, AiError> {
    ProtectedValue::from_trusted_adapter(value.into())
}
fn copy_protected(value: &ProtectedValue) -> Result<ProtectedValue, AiError> {
    protected(value.expose_in_trusted_boundary())
}
fn copy_record(r: &oauth::RegistrationRecord) -> Result<oauth::RegistrationRecord, AiError> {
    Ok(oauth::RegistrationRecord {
        binding: r.binding.clone(),
        kind: r.kind.clone(),
        app_name: r.app_name.clone(),
        stable_host_id: r.stable_host_id.clone(),
        issued_client_id: r.issued_client_id.clone(),
        identity: r.identity.clone(),
        credentials: r
            .credentials
            .as_ref()
            .map(|c| {
                Ok::<_, AiError>(oauth::SavedCredentials {
                    id_token: c.id_token.as_ref().map(copy_protected).transpose()?,
                    access_token: c.access_token.as_ref().map(copy_protected).transpose()?,
                    refresh_token: c.refresh_token.as_ref().map(copy_protected).transpose()?,
                    expires_at_ms: c.expires_at_ms,
                    granted_scopes: c.granted_scopes.clone(),
                })
            })
            .transpose()?,
        pending_authorization: r
            .pending_authorization
            .as_ref()
            .map(|a| {
                Ok::<_, AiError>(oauth::AuthorizationAttempt {
                    binding: a.binding.clone(),
                    material: oauth::FreshAuthorization {
                        state: copy_protected(&a.material.state)?,
                        nonce: copy_protected(&a.material.nonce)?,
                        verifier: copy_protected(&a.material.verifier)?,
                        s256_challenge: a.material.s256_challenge.clone(),
                    },
                    redirect_uri: a.redirect_uri.clone(),
                    callback_host: a.callback_host.clone(),
                    purpose: a.purpose,
                    client_id: a.client_id.clone(),
                    authentication: a.authentication,
                    expires_at_ms: a.expires_at_ms,
                })
            })
            .transpose()?,
        // Actual private codec, exercised solely on these synthetic values.
        refresh_checkpoint: checkpoint::decode(
            checkpoint::encode(&r.refresh_checkpoint)?.expose_for_encryption(),
        )?,
        state: r.state,
        revocation: r.revocation,
    })
}
struct Boundary(Arc<Mutex<oauth::RegistrationRecord>>);
impl oauth::CredentialBoundary<()> for Boundary {
    type Lease = OwnedMutexGuard<oauth::RegistrationRecord>;
    fn acquire<'a>(
        &'a self,
        _: &'a (),
        b: &'a oauth::RegistrationBinding,
    ) -> PortFuture<'a, Self::Lease> {
        Box::pin(async move {
            assert_eq!(b, &binding());
            Ok(self.0.clone().lock_owned().await)
        })
    }
    fn load<'a>(&'a self, lease: &'a Self::Lease) -> PortFuture<'a, oauth::RegistrationRecord> {
        Box::pin(async move { copy_record(lease) })
    }
    fn persist_atomic<'a>(
        &'a self,
        lease: &'a mut Self::Lease,
        r: &'a oauth::RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            **lease = copy_record(r)?;
            Ok(())
        })
    }
    fn revalidate<'a>(
        &'a self,
        _: &'a (),
        lease: &'a Self::Lease,
        b: &'a oauth::RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(&lease.binding, b);
            Ok(())
        })
    }
    fn stop_use<'a>(&'a self, _: &'a mut Self::Lease) -> PortFuture<'a, ()> {
        Box::pin(async { Err(AiError::ConnectionUnavailable) })
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        Ok(1_700_000_000_000)
    }
}
struct Verifier {
    fixture: Synthetic,
    calls: Arc<AtomicUsize>,
}
impl oauth::SecurityPort for Verifier {
    fn fresh<'a>(&'a self) -> PortFuture<'a, oauth::FreshAuthorization> {
        oauth::SecurityPort::fresh(&self.fixture)
    }
    fn state_matches(&self, _: &ProtectedValue, _: &str) -> bool {
        false
    }
    fn validate_website_callback(&self, _: &str, _: &str) -> Result<(), AiError> {
        Err(AiError::ConnectionUnavailable)
    }
    fn verify_identity<'a>(
        &'a self,
        token: &'a ProtectedValue,
        requirements: oauth::IdentityRequirements<'a>,
    ) -> PortFuture<'a, oauth::IdentityValidation> {
        Box::pin(async move {
            assert_eq!(token.expose_in_trusted_boundary(), "synthetic-retained-id");
            assert_eq!(requirements.issuer, oauth::OIDC_ISSUER);
            assert_eq!(requirements.audience, "synthetic-issued-client");
            assert_eq!(
                requirements.nonce.unwrap().expose_in_trusted_boundary(),
                "n".repeat(43)
            );
            assert_eq!(requirements.received_at_ms, 1_700_000_000_000);
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(oauth::IdentityValidation::Verified(
                oauth::VerifiedIdentity {
                    subject: "synthetic-verified-subject".into(),
                    name: None,
                    email: None,
                },
            ))
        })
    }
}
struct Provider(Arc<AtomicUsize>);
impl oauth::OAuthProviderPort for Provider {
    fn exchange<'a>(
        &'a self,
        _: &'a oauth::RegistrationBinding,
        _: oauth::CodeExchange<'a>,
    ) -> PortFuture<'a, oauth::ProviderTokens> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(AiError::ProviderUnavailable)
        })
    }
    fn refresh<'a>(
        &'a self,
        _: &'a oauth::RegistrationBinding,
        _: oauth::RefreshGrant<'a>,
    ) -> PortFuture<'a, oauth::ProviderTokens> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(AiError::ProviderUnavailable)
        })
    }
    fn revoke<'a>(
        &'a self,
        _: &'a oauth::RegistrationBinding,
        _: &'a str,
        _: &'a ProtectedValue,
    ) -> PortFuture<'a, oauth::ProviderRevocation> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(AiError::ProviderUnavailable)
        })
    }
}
pub(super) async fn run(
    private: &std::path::Path,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let fixture = Synthetic::default();
    let record = oauth::RegistrationRecord {
        binding: binding(),
        kind: oauth::RegistrationKind::LocalPublicClient,
        app_name: "Synthetic verification fixture".into(),
        stable_host_id: "synthetic-verification-host".into(),
        issued_client_id: None,
        identity: None,
        credentials: None,
        pending_authorization: None,
        refresh_checkpoint: oauth::RefreshCheckpoint::None,
        state: oauth::LifecycleState::Disconnected,
        revocation: oauth::RevocationState::NotRequested,
    };
    let boundary = Boundary(Arc::new(Mutex::new(record)));
    let verified = Arc::new(AtomicUsize::new(0));
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let journal = StatusJournal::new(Connection::open(private.join("verification.sqlite"))?)?;
    let host = LifecycleHost {
        security: Verifier {
            fixture: fixture.clone(),
            calls: verified.clone(),
        },
        provider: Provider(provider_calls.clone()),
        credentials: boundary,
        environment: fixture.clone(),
        journal,
    };
    let launched = host
        .act(
            &(),
            &runtime::ConnectionActionRequest {
                action_id: "synthetic-verification-action".into(),
                command: runtime::ConnectionAction::Connect {
                    route: ai::RuntimeRoute::LocalSignInHelper,
                },
            },
            &Cancellation::default(),
        )
        .await?;
    assert!(matches!(
        launched.status,
        runtime::ConnectionActionStatus::Pending
    ));
    // Well-formed received-session input, as in the core's positive fixture.
    // The remote exchange is not executed or simulated as an outage/failure.
    {
        let mut saved = host.credentials.0.lock().await;
        let nonce = saved.pending_authorization.take().unwrap().material.nonce;
        saved.issued_client_id = Some("synthetic-issued-client".into());
        saved.state = oauth::LifecycleState::IdentityVerificationPending;
        saved.refresh_checkpoint = oauth::RefreshCheckpoint::ExchangeReceived {
            binding: binding(),
            client_id: "synthetic-issued-client".into(),
            nonce,
            reply: oauth::TokenReply {
                id_token: Some(protected("synthetic-retained-id")?),
                access_token: Some(protected("synthetic-retained-access")?),
                refresh_token: None,
                token_type: Some("Bearer".into()),
                expires_at_ms: Some(1_700_003_600_000),
                granted_scopes: Some(vec!["openid".into(), "profile".into(), "email".into()]),
                received_at_ms: 1_700_000_000_000,
            },
        };
        let decoded = checkpoint::decode(
            checkpoint::encode(&saved.refresh_checkpoint)?.expose_for_encryption(),
        )?;
        assert!(
            matches!(&decoded,oauth::RefreshCheckpoint::ExchangeReceived {binding:b,client_id,nonce,..}
            if b==&binding() && client_id=="synthetic-issued-client" && nonce.expose_in_trusted_boundary()=="n".repeat(43))
        );
        saved.refresh_checkpoint = decoded;
    }
    let receipt = host.refresh(&()).await?;
    assert_eq!(receipt.state, oauth::LifecycleState::PlanUseDisabled);
    assert_eq!(receipt.issue, Some(oauth::OAuthIssue::PlanScopeMissing));
    assert_eq!(verified.load(Ordering::SeqCst), 1);
    assert_eq!(provider_calls.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.observations.load(Ordering::SeqCst), 1);
    let completed = host
        .status(
            &(),
            "synthetic-verification-action",
            &Cancellation::default(),
        )
        .await?;
    assert_eq!(completed.action_id, launched.action_id);
    assert!(matches!(
        completed.status,
        runtime::ConnectionActionStatus::Completed
    ));
    assert_eq!(
        completed.snapshot.authorization,
        ai::AuthorizationState::Connected
    );
    assert_eq!(
        completed.snapshot.paid_use_admission,
        ai::PaidUseAdmission::Held
    );
    assert!(!completed.snapshot.can_infer());
    let saved = host.credentials.0.lock().await;
    assert!(matches!(
        saved.refresh_checkpoint,
        oauth::RefreshCheckpoint::None
    ));
    assert_eq!(
        saved.identity.as_ref().unwrap().subject,
        "synthetic-verified-subject"
    );
    assert!(saved.credentials.as_ref().unwrap().access_token.is_some());
    // No token, nonce, encoded checkpoint or private identity enters this DTO.
    Ok(serde_json::to_value(completed)?)
}
