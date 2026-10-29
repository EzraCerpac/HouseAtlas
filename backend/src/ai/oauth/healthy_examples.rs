use super::*;
use std::{
    future::Future,
    pin::pin,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    task::{Context, Poll, Waker},
};

const NOW: u64 = 1_791_244_800_000;
const CALLBACK: &str = "http://127.0.0.1:55431/auth/callback";
const CLIENT: &str = "synthetic_issued_client";
const STATE: &str = "sssssssssssssssssssssssssssssssssssssssssss";
const NONCE: &str = "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn";
const VERIFIER: &str = "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv";
const CHALLENGE: &str = "ccccccccccccccccccccccccccccccccccccccccccc";

fn protected(value: &str) -> ProtectedValue {
    ProtectedValue::from_trusted_adapter(value.into()).expect("healthy synthetic value")
}
fn material() -> FreshAuthorization {
    FreshAuthorization {
        state: protected(STATE),
        nonce: protected(NONCE),
        verifier: protected(VERIFIER),
        s256_challenge: CHALLENGE.into(),
    }
}
fn binding() -> RegistrationBinding {
    RegistrationBinding {
        registration_id: "synthetic-registration".into(),
        actor_id: "synthetic-actor".into(),
        workspace_id: "synthetic-workspace".into(),
        home_id: "synthetic-home".into(),
        authority_epoch: "synthetic-authority-1".into(),
        cancellation_epoch: "synthetic-cancellation-1".into(),
    }
}
fn token_reply(offline_access: bool) -> TokenReply {
    let mut granted_scopes = vec!["openid".into(), DIRECT_USAGE_SCOPE.into()];
    if offline_access {
        granted_scopes.push("offline_access".into());
    }
    TokenReply {
        id_token: Some(protected("opaque-synthetic-id-token")),
        access_token: Some(protected("opaque-synthetic-access-token")),
        refresh_token: offline_access.then(|| protected("opaque-synthetic-refresh-token")),
        token_type: Some("Bearer".into()),
        expires_at_ms: Some(NOW + 3_600_000),
        granted_scopes: Some(granted_scopes),
        received_at_ms: NOW,
    }
}

// This fixture supplies known values and assumes signature validation. It
// performs no entropy generation, SHA256, JOSE/JWKS work or qualification.
struct SyntheticSecurity;
impl SecurityPort for SyntheticSecurity {
    fn fresh<'a>(&'a self) -> PortFuture<'a, FreshAuthorization> {
        Box::pin(async { Ok(material()) })
    }
    fn state_matches(&self, expected: &ProtectedValue, returned: &str) -> bool {
        expected.expose_in_trusted_boundary() == returned
    }
    fn validate_website_callback(&self, _: &str, _: &str) -> Result<(), AiError> {
        Ok(())
    }
    fn verify_identity<'a>(
        &'a self,
        token: &'a ProtectedValue,
        requirements: IdentityRequirements<'a>,
    ) -> PortFuture<'a, IdentityValidation> {
        Box::pin(async move {
            assert_eq!(
                token.expose_in_trusted_boundary(),
                "opaque-synthetic-id-token"
            );
            assert_eq!(requirements.issuer, OIDC_ISSUER);
            assert_eq!(requirements.audience, CLIENT);
            assert_eq!(
                requirements
                    .nonce
                    .map(ProtectedValue::expose_in_trusted_boundary),
                Some(NONCE)
            );
            Ok(IdentityValidation::Verified(VerifiedIdentity {
                subject: "synthetic-verified-subject".into(),
                name: Some("Synthetic account".into()),
                email: None,
            }))
        })
    }
}

struct SyntheticProvider {
    offline_access: bool,
    exchanges: AtomicUsize,
    refreshes: AtomicUsize,
}
impl OAuthProviderPort for SyntheticProvider {
    fn exchange<'a>(
        &'a self,
        scope: &'a RegistrationBinding,
        grant: CodeExchange<'a>,
    ) -> PortFuture<'a, ProviderTokens> {
        Box::pin(async move {
            self.exchanges.fetch_add(1, Ordering::Relaxed);
            assert_eq!(scope, &binding());
            assert_eq!(grant.client_id, CLIENT);
            assert_eq!(grant.redirect_uri, CALLBACK);
            assert_eq!(grant.resource, Some(OAUTH_RESOURCE));
            assert_eq!(
                grant.code.expose_in_trusted_boundary(),
                "opaque-synthetic-code"
            );
            assert_eq!(grant.verifier.expose_in_trusted_boundary(), VERIFIER);
            assert_eq!(grant.authentication, ClientAuthentication::Public);
            Ok(ProviderTokens::Received(token_reply(self.offline_access)))
        })
    }
    fn refresh<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: RefreshGrant<'a>,
    ) -> PortFuture<'a, ProviderTokens> {
        Box::pin(async move {
            self.refreshes.fetch_add(1, Ordering::Relaxed);
            Ok(ProviderTokens::Received(token_reply(true)))
        })
    }
    fn revoke<'a>(
        &'a self,
        _: &'a RegistrationBinding,
        _: &'a str,
        _: &'a ProtectedValue,
    ) -> PortFuture<'a, ProviderRevocation> {
        Box::pin(async { Ok(ProviderRevocation::Confirmed) })
    }
}

// This private in-memory peer stands in for encrypted atomic storage and a
// registration lease. It neither encrypts bytes nor tests concurrency.
struct SyntheticBoundary(Mutex<RegistrationRecord>);
fn duplicate(value: &ProtectedValue) -> ProtectedValue {
    protected(value.expose_in_trusted_boundary())
}
fn duplicate_record(record: &RegistrationRecord) -> RegistrationRecord {
    RegistrationRecord {
        binding: record.binding.clone(),
        kind: record.kind.clone(),
        app_name: record.app_name.clone(),
        stable_host_id: record.stable_host_id.clone(),
        issued_client_id: record.issued_client_id.clone(),
        identity: record.identity.clone(),
        credentials: record.credentials.as_ref().map(|saved| SavedCredentials {
            id_token: saved.id_token.as_ref().map(duplicate),
            access_token: saved.access_token.as_ref().map(duplicate),
            refresh_token: saved.refresh_token.as_ref().map(duplicate),
            expires_at_ms: saved.expires_at_ms,
            granted_scopes: saved.granted_scopes.clone(),
        }),
        pending_authorization: record.pending_authorization.as_ref().map(|pending| {
            AuthorizationAttempt {
                binding: pending.binding.clone(),
                material: FreshAuthorization {
                    state: duplicate(&pending.material.state),
                    nonce: duplicate(&pending.material.nonce),
                    verifier: duplicate(&pending.material.verifier),
                    s256_challenge: pending.material.s256_challenge.clone(),
                },
                redirect_uri: pending.redirect_uri.clone(),
                callback_host: pending.callback_host.clone(),
                purpose: pending.purpose,
                client_id: pending.client_id.clone(),
                authentication: pending.authentication,
                expires_at_ms: pending.expires_at_ms,
            }
        }),
        refresh_checkpoint: match &record.refresh_checkpoint {
            RefreshCheckpoint::None => RefreshCheckpoint::None,
            RefreshCheckpoint::InvocationUnconfirmed(binding) => {
                RefreshCheckpoint::InvocationUnconfirmed(binding.clone())
            }
            RefreshCheckpoint::Received { binding, reply } => RefreshCheckpoint::Received {
                binding: binding.clone(),
                reply: duplicate_reply(reply),
            },
            RefreshCheckpoint::ExchangeReceived {
                binding,
                client_id,
                nonce,
                reply,
            } => RefreshCheckpoint::ExchangeReceived {
                binding: binding.clone(),
                client_id: client_id.clone(),
                nonce: duplicate(nonce),
                reply: duplicate_reply(reply),
            },
        },
        state: record.state,
        revocation: record.revocation,
    }
}
impl CredentialBoundary<()> for SyntheticBoundary {
    type Lease = ();
    fn acquire<'a>(&'a self, _: &'a (), expected: &'a RegistrationBinding) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(expected, &binding());
            Ok(())
        })
    }
    fn load<'a>(&'a self, _: &'a ()) -> PortFuture<'a, RegistrationRecord> {
        Box::pin(async { Ok(duplicate_record(&self.0.lock().expect("synthetic storage"))) })
    }
    fn persist_atomic<'a>(
        &'a self,
        _: &'a mut (),
        record: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            *self.0.lock().expect("synthetic storage") = duplicate_record(record);
            Ok(())
        })
    }
    fn revalidate<'a>(
        &'a self,
        _: &'a (),
        _: &'a (),
        expected: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(expected, &binding());
            Ok(())
        })
    }
    fn stop_use<'a>(&'a self, _: &'a mut ()) -> PortFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        Ok(NOW)
    }
}
fn duplicate_reply(reply: &TokenReply) -> TokenReply {
    TokenReply {
        id_token: reply.id_token.as_ref().map(duplicate),
        access_token: reply.access_token.as_ref().map(duplicate),
        refresh_token: reply.refresh_token.as_ref().map(duplicate),
        token_type: reply.token_type.clone(),
        expires_at_ms: reply.expires_at_ms,
        granted_scopes: reply.granted_scopes.clone(),
        received_at_ms: reply.received_at_ms,
    }
}
fn ready<F: Future>(future: F) -> F::Output {
    match pin!(future)
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("healthy fixture ports complete immediately"),
    }
}

fn empty_registration() -> RegistrationRecord {
    RegistrationRecord {
        binding: binding(),
        kind: RegistrationKind::LocalPublicClient,
        app_name: "HouseAtlas synthetic example".into(),
        stable_host_id: "synthetic-stable-host".into(),
        issued_client_id: None,
        identity: None,
        credentials: None,
        pending_authorization: None,
        refresh_checkpoint: RefreshCheckpoint::None,
        state: LifecycleState::Disconnected,
        revocation: RevocationState::NotRequested,
    }
}
fn provider(offline_access: bool) -> SyntheticProvider {
    SyntheticProvider {
        offline_access,
        exchanges: AtomicUsize::new(0),
        refreshes: AtomicUsize::new(0),
    }
}
fn healthy_local_callback(offline_access: bool) {
    let storage = SyntheticBoundary(Mutex::new(empty_registration()));
    let provider = provider(offline_access);
    let lifecycle = OAuthLifecycle {
        security: &SyntheticSecurity,
        provider: &provider,
        credentials: &storage,
    };
    let scope = binding();
    let launch = ready(lifecycle.begin(
        &(),
        &scope,
        CallbackSelection::AvailableLoopbackPort(NonZeroU16::new(55431).expect("healthy port")),
        SignInPurpose::EnablePlanUse,
    ))
    .expect("healthy authorization launch");
    let url = launch.trusted_authorization_url();
    assert!(url.starts_with(AUTHORIZATION_ENDPOINT));
    assert!(url.contains("client_id=dynamic_agent_client"));
    assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A55431%2Fauth%2Fcallback"));
    assert!(url.contains(&format!("state={STATE}")));
    assert!(url.contains(&format!("nonce={NONCE}")));
    assert!(url.contains(&format!(
        "code_challenge_method=S256&code_challenge={CHALLENGE}"
    )));
    assert!(url.contains(DIRECT_USAGE_SCOPE));
    let outcome = ready(lifecycle.complete(
        &(),
        &scope,
        CallbackRequest {
            method: "GET".into(),
            host: "127.0.0.1:55431".into(),
            redirect_uri: CALLBACK.into(),
            parameters: vec![
                ("state".into(), STATE.into()),
                ("code".into(), "opaque-synthetic-code".into()),
                ("client_id".into(), CLIENT.into()),
            ],
        },
    ))
    .expect("healthy callback completion");
    assert_eq!(outcome.state, LifecycleState::Connected);
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 1);
    let saved = storage.0.lock().expect("synthetic storage");
    assert_eq!(saved.issued_client_id.as_deref(), Some(CLIENT));
    assert_eq!(
        saved
            .identity
            .as_ref()
            .map(|identity| identity.subject.as_str()),
        Some("synthetic-verified-subject")
    );
    assert!(
        saved
            .credentials
            .as_ref()
            .expect("synthetic protected tokens")
            .granted_scopes
            .iter()
            .any(|scope| scope == DIRECT_USAGE_SCOPE)
    );
    let credentials = saved
        .credentials
        .as_ref()
        .expect("synthetic protected tokens");
    assert_eq!(
        credentials
            .granted_scopes
            .iter()
            .any(|scope| scope == "offline_access"),
        offline_access,
    );
    assert_eq!(credentials.refresh_token.is_some(), offline_access);
    // Application authorization, runtime qualification and independent
    // paid-use admission are still required. No inference is invoked here.
}

// Invoked only by the exact separate denial entrypoint, never a healthy
// test or aggregate. All peers complete synchronously with synthetic data.
pub(super) fn check_live_authorization_begin_refusal() {
    struct CountSecurity(AtomicUsize);
    impl SecurityPort for CountSecurity {
        fn fresh<'a>(&'a self) -> PortFuture<'a, FreshAuthorization> {
            self.0.fetch_add(1, Ordering::Relaxed);
            SyntheticSecurity.fresh()
        }
        fn state_matches(&self, expected: &ProtectedValue, returned: &str) -> bool {
            SyntheticSecurity.state_matches(expected, returned)
        }
        fn validate_website_callback(&self, uri: &str, host: &str) -> Result<(), AiError> {
            SyntheticSecurity.validate_website_callback(uri, host)
        }
        fn verify_identity<'a>(
            &'a self,
            token: &'a ProtectedValue,
            requirements: IdentityRequirements<'a>,
        ) -> PortFuture<'a, IdentityValidation> {
            SyntheticSecurity.verify_identity(token, requirements)
        }
    }
    struct CountBoundary {
        inner: SyntheticBoundary,
        persists: AtomicUsize,
    }
    impl CredentialBoundary<()> for CountBoundary {
        type Lease = ();
        fn acquire<'a>(&'a self, c: &'a (), b: &'a RegistrationBinding) -> PortFuture<'a, ()> {
            self.inner.acquire(c, b)
        }
        fn load<'a>(&'a self, l: &'a ()) -> PortFuture<'a, RegistrationRecord> {
            self.inner.load(l)
        }
        fn persist_atomic<'a>(
            &'a self,
            l: &'a mut (),
            r: &'a RegistrationRecord,
        ) -> PortFuture<'a, ()> {
            self.persists.fetch_add(1, Ordering::Relaxed);
            self.inner.persist_atomic(l, r)
        }
        fn revalidate<'a>(
            &'a self,
            c: &'a (),
            l: &'a (),
            b: &'a RegistrationBinding,
        ) -> PortFuture<'a, ()> {
            self.inner.revalidate(c, l, b)
        }
        fn stop_use<'a>(&'a self, l: &'a mut ()) -> PortFuture<'a, ()> {
            self.inner.stop_use(l)
        }
        fn now_ms(&self) -> Result<u64, AiError> {
            self.inner.now_ms()
        }
    }
    let storage = CountBoundary {
        inner: SyntheticBoundary(Mutex::new(empty_registration())),
        persists: AtomicUsize::new(0),
    };
    let security = CountSecurity(AtomicUsize::new(0));
    let provider = provider(true);
    let lifecycle = OAuthLifecycle {
        security: &security,
        provider: &provider,
        credentials: &storage,
    };
    let original = ready(lifecycle.begin(
        &(),
        &binding(),
        CallbackSelection::AvailableLoopbackPort(NonZeroU16::new(55431).unwrap()),
        SignInPurpose::EnablePlanUse,
    ))
    .expect("synthetic original launch");
    let before = duplicate_record(&storage.inner.0.lock().unwrap());
    let denied = ready(lifecycle.begin(
        &(),
        &binding(),
        CallbackSelection::AvailableLoopbackPort(NonZeroU16::new(55432).unwrap()),
        SignInPurpose::Identity,
    ));
    assert!(matches!(denied, Err(AiError::ConnectionUnavailable)));
    assert_eq!(
        security.0.load(Ordering::Relaxed),
        1,
        "no second fresh material"
    );
    assert_eq!(
        storage.persists.load(Ordering::Relaxed),
        1,
        "no second persistence"
    );
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 0);
    assert_eq!(provider.refreshes.load(Ordering::Relaxed), 0);
    {
        let after = storage.inner.0.lock().unwrap();
        assert_eq!(after.binding, before.binding);
        let first = before.pending_authorization.as_ref().unwrap();
        let kept = after.pending_authorization.as_ref().unwrap();
        assert_eq!(kept.binding, first.binding);
        assert_eq!(kept.redirect_uri, first.redirect_uri);
        assert_eq!(kept.callback_host, first.callback_host);
        assert_eq!(kept.client_id, first.client_id);
        assert_eq!(kept.purpose, first.purpose);
        assert_eq!(kept.authentication, first.authentication);
        assert_eq!(kept.expires_at_ms, first.expires_at_ms);
        assert_eq!(kept.material.s256_challenge, first.material.s256_challenge);
        for (a, b) in [
            (&kept.material.state, &first.material.state),
            (&kept.material.nonce, &first.material.nonce),
            (&kept.material.verifier, &first.material.verifier),
        ] {
            assert_eq!(
                a.expose_in_trusted_boundary(),
                b.expose_in_trusted_boundary()
            );
        }
        assert_eq!(
            authorization_url(&after, kept),
            original.trusted_authorization_url()
        );
    }
    // A first ordinary callback still consumes the original attempt once;
    // this is not an authorization-code replay or expiry/revocation case.
    let receipt = ready(lifecycle.complete(
        &(),
        &binding(),
        CallbackRequest {
            method: "GET".into(),
            host: "127.0.0.1:55431".into(),
            redirect_uri: CALLBACK.into(),
            parameters: vec![
                ("state".into(), STATE.into()),
                ("code".into(), "opaque-synthetic-code".into()),
                ("client_id".into(), CLIENT.into()),
            ],
        },
    ))
    .expect("original callback remains valid");
    assert_eq!(receipt.state, LifecycleState::Connected);
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 1);
    assert_eq!(provider.refreshes.load(Ordering::Relaxed), 0);
    assert!(
        storage
            .inner
            .0
            .lock()
            .unwrap()
            .pending_authorization
            .is_none()
    );
}

// Positive cleared-record reconnect peer. The binding stands in for the
// opaque original host proof; this is not a credential/authority adapter.
struct ReconnectBoundary {
    record: Mutex<RegistrationRecord>,
    captures: AtomicUsize,
    validations: AtomicUsize,
}
impl CredentialBoundary<()> for ReconnectBoundary {
    type Lease = RegistrationBinding;
    fn acquire<'a>(
        &'a self,
        _: &'a (),
        expected: &'a RegistrationBinding,
    ) -> PortFuture<'a, Self::Lease> {
        Box::pin(async move {
            assert_eq!(expected, &binding());
            self.captures.fetch_add(1, Ordering::Relaxed);
            Ok(expected.clone())
        })
    }
    fn load<'a>(&'a self, lease: &'a Self::Lease) -> PortFuture<'a, RegistrationRecord> {
        Box::pin(async move {
            assert_eq!(lease, &binding());
            Ok(duplicate_record(
                &self.record.lock().expect("synthetic record"),
            ))
        })
    }
    fn persist_atomic<'a>(
        &'a self,
        lease: &'a mut Self::Lease,
        record: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(lease, &binding(), "captured lease binding stays unchanged");
            assert_eq!(&record.binding, lease, "record adopts the captured binding");
            *self.record.lock().expect("synthetic record") = duplicate_record(record);
            Ok(())
        })
    }
    fn revalidate<'a>(
        &'a self,
        _: &'a (),
        lease: &'a Self::Lease,
        expected: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(lease, expected);
            assert_eq!(expected, &binding());
            self.validations.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
    }
    fn stop_use<'a>(&'a self, _: &'a mut Self::Lease) -> PortFuture<'a, ()> {
        Box::pin(async { panic!("positive reconnect never stops its active lease") })
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        Ok(NOW)
    }
}

#[test]
fn healthy_trusted_reconnect_cancellation_binding() {
    // These are valid already-cleared records, not injected revocation or
    // cancellation failures. No stop/rotate/revoke control is executed.
    for state in [
        LifecycleState::Disconnected,
        LifecycleState::ReauthorizationRequired,
    ] {
        let mut record = empty_registration();
        record.binding.cancellation_epoch = "synthetic-retired-cancellation".into();
        record.issued_client_id = Some(CLIENT.into());
        record.identity = Some(VerifiedIdentity {
            subject: "synthetic-verified-subject".into(),
            name: Some("Synthetic account".into()),
            email: None,
        });
        record.state = state;
        record.revocation = RevocationState::Confirmed;
        let storage = ReconnectBoundary {
            record: Mutex::new(record),
            captures: AtomicUsize::new(0),
            validations: AtomicUsize::new(0),
        };
        let provider = provider(true);
        let lifecycle = OAuthLifecycle {
            security: &SyntheticSecurity,
            provider: &provider,
            credentials: &storage,
        };
        let scope = binding();
        let launch = ready(lifecycle.begin(
            &(),
            &scope,
            CallbackSelection::AvailableLoopbackPort(NonZeroU16::new(55431).unwrap()),
            SignInPurpose::EnablePlanUse,
        ))
        .expect("healthy trusted reconnect launch");
        assert!(
            launch
                .trusted_authorization_url()
                .contains(&format!("client_id={CLIENT}"))
        );
        assert!(!launch.trusted_authorization_url().contains(DYNAMIC_CLIENT));
        {
            let saved = storage.record.lock().expect("synthetic record");
            assert_eq!(saved.binding, scope);
            assert_eq!(saved.pending_authorization.as_ref().unwrap().binding, scope);
            assert_eq!(saved.state, state);
            assert_eq!(saved.revocation, RevocationState::Confirmed);
            assert!(saved.credentials.is_none());
            assert!(matches!(saved.refresh_checkpoint, RefreshCheckpoint::None));
            assert_eq!(saved.issued_client_id.as_deref(), Some(CLIENT));
            assert_eq!(saved.stable_host_id, "synthetic-stable-host");
            assert_eq!(
                saved.identity.as_ref().unwrap().subject,
                "synthetic-verified-subject"
            );
        }
        assert_eq!(storage.captures.load(Ordering::Relaxed), 1);
        assert_eq!(storage.validations.load(Ordering::Relaxed), 2);
        assert_eq!(provider.exchanges.load(Ordering::Relaxed), 0);
        assert_eq!(provider.refreshes.load(Ordering::Relaxed), 0);
        let receipt = ready(lifecycle.complete(
            &(),
            &scope,
            CallbackRequest {
                method: "GET".into(),
                host: "127.0.0.1:55431".into(),
                redirect_uri: CALLBACK.into(),
                parameters: vec![
                    ("state".into(), STATE.into()),
                    ("code".into(), "opaque-synthetic-code".into()),
                ],
            },
        ))
        .expect("healthy synthetic reconnect callback");
        assert_eq!(receipt.state, LifecycleState::Connected);
        let saved = storage.record.lock().expect("synthetic record");
        assert_eq!(
            saved.binding, scope,
            "full binding required by StoredSession/StoredModels"
        );
        assert_eq!(saved.issued_client_id.as_deref(), Some(CLIENT));
        assert_eq!(saved.stable_host_id, "synthetic-stable-host");
        assert_eq!(
            saved.identity.as_ref().unwrap().subject,
            "synthetic-verified-subject"
        );
        assert!(saved.pending_authorization.is_none());
        assert!(matches!(saved.refresh_checkpoint, RefreshCheckpoint::None));
        assert!(saved.credentials.is_some());
        assert_eq!(storage.captures.load(Ordering::Relaxed), 2);
        assert_eq!(provider.exchanges.load(Ordering::Relaxed), 1);
        assert_eq!(provider.refreshes.load(Ordering::Relaxed), 0);
    }
}

#[test]
fn healthy_same_binding_authorization_preserves_current_session() {
    let mut record = empty_registration();
    record.state = LifecycleState::Connected;
    record.issued_client_id = Some(CLIENT.into());
    record.identity = Some(VerifiedIdentity {
        subject: "synthetic-verified-subject".into(),
        name: Some("Synthetic account".into()),
        email: None,
    });
    record.credentials = Some(saved_tokens(token_reply(true), vec![]));
    let storage = SyntheticBoundary(Mutex::new(record));
    let provider = provider(true);
    let lifecycle = OAuthLifecycle {
        security: &SyntheticSecurity,
        provider: &provider,
        credentials: &storage,
    };
    ready(lifecycle.begin(
        &(),
        &binding(),
        CallbackSelection::AvailableLoopbackPort(NonZeroU16::new(55431).unwrap()),
        SignInPurpose::EnablePlanUse,
    ))
    .expect("healthy unchanged-binding authorization");
    let saved = storage.0.lock().expect("synthetic record");
    assert_eq!(saved.binding, binding());
    assert_eq!(saved.state, LifecycleState::Connected);
    assert_eq!(
        saved
            .credentials
            .as_ref()
            .unwrap()
            .access_token
            .as_ref()
            .unwrap()
            .expose_in_trusted_boundary(),
        "opaque-synthetic-access-token"
    );
    assert!(saved.pending_authorization.is_some());
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 0);
    assert_eq!(provider.refreshes.load(Ordering::Relaxed), 0);
}

#[test]
fn healthy_local_oauth_components() {
    healthy_local_callback(true);
}

#[test]
fn healthy_local_oauth_direct_scope_without_offline() {
    healthy_local_callback(false);
}

// The scenario module reuses these synthetic peers without installing live
// adapters or changing the separate historical regression entrypoints.
mod lifecycle_scenarios {
    use super::*;
    include!("../oauth_lifecycle_scenarios.rs");
}
mod connection_readiness_scenarios {
    include!("../connection_readiness_scenarios.rs");
}

#[test]
fn healthy_received_exchange_verification() {
    // A valid received checkpoint is a positive storage fixture, not a
    // simulated key outage or failed exchange. No provider I/O is invoked.
    let mut record = empty_registration();
    record.issued_client_id = Some(CLIENT.into());
    record.state = LifecycleState::IdentityVerificationPending;
    record.refresh_checkpoint = RefreshCheckpoint::ExchangeReceived {
        binding: binding(),
        client_id: CLIENT.into(),
        nonce: protected(NONCE),
        reply: token_reply(true),
    };
    let storage = SyntheticBoundary(Mutex::new(record));
    let provider = provider(true);
    let lifecycle = OAuthLifecycle {
        security: &SyntheticSecurity,
        provider: &provider,
        credentials: &storage,
    };
    let outcome = ready(lifecycle.verify_received_exchange(&(), &binding()))
        .expect("healthy received exchange verification");
    assert_eq!(outcome.state, LifecycleState::Connected);
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 0);
    assert_eq!(provider.refreshes.load(Ordering::Relaxed), 0);
    let saved = storage.0.lock().expect("synthetic storage");
    assert!(matches!(saved.refresh_checkpoint, RefreshCheckpoint::None));
    assert_eq!(
        saved
            .identity
            .as_ref()
            .map(|identity| identity.subject.as_str()),
        Some("synthetic-verified-subject")
    );
    assert!(
        saved
            .credentials
            .as_ref()
            .is_some_and(|tokens| tokens.refresh_token.is_some())
    );
}
