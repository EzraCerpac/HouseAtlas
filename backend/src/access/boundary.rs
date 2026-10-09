use std::{
    net::IpAddr,
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use url::Url;

use super::{
    AccessError, AccessResult, Action, CanonicalId, Capability, LifecyclePolicy, Method,
    PartitionGrant, PasswordVerifier, Principal, RequestEvidence, Role, SESSION_COOKIE, Scope,
    SessionInfo, SessionReceipt, SourceGrant,
    credentials::{digest, hex, nonce, random_bytes, verify_password},
    store::{self, Session, Store, User, UserVerifier},
    trusted_proxy::TrustedProxyPolicy,
    types::{LoopbackLocalIdentity, RestoreEpoch},
};

/// Trusted server configuration, with the published defaults and ceilings.
pub struct AccessLimits {
    pub absolute_ms: i64,
    pub idle_ms: i64,
    pub max_sessions: u32,
    pub login_limit: u32,
    pub global_login_limit: u32,
    pub request_limit: u32,
}

impl Default for AccessLimits {
    fn default() -> Self {
        Self {
            absolute_ms: 604_800_000,
            idle_ms: 28_800_000,
            max_sessions: 5,
            login_limit: 10,
            global_login_limit: 60,
            request_limit: 300,
        }
    }
}

impl AccessLimits {
    fn validate(&self) -> AccessResult<()> {
        if !(1..=604_800_000).contains(&self.absolute_ms)
            || !(1..=self.absolute_ms).contains(&self.idle_ms)
            || !(1..=100).contains(&self.max_sessions)
            || !(1..=1000).contains(&self.login_limit)
            || !(1..=10_000).contains(&self.global_login_limit)
            || !(1..=10_000).contains(&self.request_limit)
        {
            return Err(AccessError::InvalidInput);
        }
        Ok(())
    }
}

pub struct AccessConfig {
    origins: Vec<String>,
    loopback_local: Option<LoopbackLocalIdentity>,
    trusted_proxy: Option<Arc<TrustedProxyPolicy>>,
    limits: AccessLimits,
    clock: Box<dyn Fn() -> i64 + Send + Sync>,
    pub(super) lifecycle: LifecyclePolicy,
}

impl AccessConfig {
    pub fn new(origins: Vec<String>) -> AccessResult<Self> {
        if origins.is_empty() {
            return Err(AccessError::InvalidInput);
        }
        for origin in &origins {
            let parsed = Url::parse(origin).map_err(|_| AccessError::InvalidInput)?;
            if parsed.scheme() != "https"
                || parsed.origin().ascii_serialization() != *origin
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err(AccessError::InvalidInput);
            }
        }
        Ok(Self {
            origins,
            loopback_local: None,
            trusted_proxy: None,
            limits: AccessLimits::default(),
            lifecycle: LifecyclePolicy::default(),
            clock: Box::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .and_then(|v| i64::try_from(v.as_millis()).ok())
                    .unwrap_or(-1)
            }),
        })
    }

    pub fn with_loopback_local(mut self, identity: LoopbackLocalIdentity) -> AccessResult<Self> {
        if self.trusted_proxy.is_some()
            || self.origins.len() != 1
            || !self.origins.iter().all(|origin| {
                Url::parse(origin).is_ok_and(|url| {
                    url.scheme() == "https"
                        && url.origin().ascii_serialization() == *origin
                        && url.port() == Some(48743)
                        && match url.host() {
                            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
                            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
                            _ => false,
                        }
                })
            })
        {
            return Err(AccessError::InvalidInput);
        }
        validate_local_identity(&identity)?;
        self.loopback_local = Some(identity);
        Ok(self)
    }

    /// Select the singleton identity through the separate checked Unix gateway.
    /// A policy is configuration DATA, never evidence of a gateway request.
    pub fn with_trusted_proxy(
        mut self,
        identity: LoopbackLocalIdentity,
        policy: Arc<TrustedProxyPolicy>,
    ) -> AccessResult<Self> {
        if self.loopback_local.is_some() || self.trusted_proxy.is_some() || self.origins.len() != 1
        {
            return Err(AccessError::InvalidInput);
        }
        validate_trusted_proxy_origin(&self.origins[0])?;
        policy.validate()?;
        validate_local_identity(&identity)?;
        // Existing native sentinel, singleton provisioning and session checks
        // continue to use this same selected identity in both local modes.
        self.loopback_local = Some(identity);
        self.trusted_proxy = Some(policy);
        Ok(self)
    }

    pub fn with_limits(mut self, limits: AccessLimits) -> AccessResult<Self> {
        limits.validate()?;
        self.limits = limits;
        Ok(self)
    }

    /// Startup-only owner policy; never populate from request/registry metadata.
    /// The default policy has no lifecycle rules.
    pub fn with_lifecycle_policy(mut self, policy: LifecyclePolicy) -> Self {
        self.lifecycle = policy;
        self
    }

    /// Trusted clock seam, useful for deterministic synthetic checkpoints.
    pub fn with_clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.clock = Box::new(clock);
        self
    }

    pub(super) fn now(&self) -> AccessResult<i64> {
        let now = (self.clock)();
        if !(0..=8_640_000_000_000_000 - self.limits.absolute_ms).contains(&now) {
            return Err(AccessError::Unavailable);
        }
        Ok(now)
    }
}

fn validate_local_identity(identity: &LoopbackLocalIdentity) -> AccessResult<()> {
    const NIL: &str = "00000000-0000-0000-0000-000000000000";
    if [
        &identity.user_id,
        &identity.actor_id,
        &identity.scope.workspace_id,
        &identity.scope.home_id,
    ]
    .iter()
    .any(|id| id.as_str() == NIL)
        || store::username_key(&identity.username)? != identity.username
    {
        return Err(AccessError::InvalidInput);
    }
    Ok(())
}

fn validate_trusted_proxy_origin(origin: &str) -> AccessResult<()> {
    let parsed = Url::parse(origin).map_err(|_| AccessError::InvalidInput)?;
    let Some(url::Host::Domain(host)) = parsed.host() else {
        return Err(AccessError::InvalidInput);
    };
    if parsed.scheme() != "https"
        || parsed.origin().ascii_serialization() != origin
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !host.is_ascii()
        || host.len() > 253
        || !host.ends_with(".ts.net")
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
    {
        return Err(AccessError::InvalidInput);
    }
    Ok(())
}

/// Synchronous modular-monolith component. The embedding runtime owns routing,
/// bounded body streaming and scheduling blocking SQLite/scrypt work.
pub struct AccessBoundary {
    pub(super) store: Store,
    pub(super) config: AccessConfig,
    pub(super) instance: [u8; 32],
}

impl AccessBoundary {
    pub fn loopback_local_enabled(&self) -> bool {
        self.config.loopback_local.is_some() && self.config.trusted_proxy.is_none()
    }

    pub fn trusted_proxy_enabled(&self) -> bool {
        self.config.trusted_proxy.is_some()
    }

    pub fn trusted_proxy_policy(&self) -> Option<&Arc<TrustedProxyPolicy>> {
        self.config.trusted_proxy.as_ref()
    }

    pub fn trusted_proxy_origin(&self) -> Option<&str> {
        self.config
            .trusted_proxy
            .as_ref()
            .map(|_| self.config.origins[0].as_str())
    }

    pub fn configured_local_identity(&self) -> Option<&LoopbackLocalIdentity> {
        self.config.loopback_local.as_ref()
    }

    pub fn provision_loopback_local_user(&mut self) -> AccessResult<()> {
        let identity = self
            .config
            .loopback_local
            .as_ref()
            .ok_or(AccessError::Forbidden)?;
        self.store.provision_loopback_local_user(identity)
    }

    pub fn validate_loopback_local_user(&mut self) -> AccessResult<()> {
        let identity = self
            .config
            .loopback_local
            .as_ref()
            .ok_or(AccessError::Forbidden)?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        store::validate_loopback_local_user(&tx, identity)?;
        tx.commit()?;
        Ok(())
    }

    pub fn login_loopback_local(
        &mut self,
        request: &RequestEvidence<'_>,
        actual_peer: IpAddr,
    ) -> AccessResult<SessionReceipt> {
        if self.config.trusted_proxy.is_some() {
            return Err(AccessError::Unauthenticated);
        }
        let identity = self
            .config
            .loopback_local
            .as_ref()
            .ok_or(AccessError::Unauthenticated)?;
        if !actual_peer.is_loopback() {
            return Err(AccessError::Forbidden);
        }
        if request.method != Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let username = identity.username.clone();
        let origin = self.check_origin(request, true, None)?;
        self.rate(
            "login:global",
            self.config.limits.global_login_limit,
            60_000,
        )?;
        self.rate(
            &format!("login:client:{actual_peer}"),
            self.config.limits.login_limit,
            300_000,
        )?;
        self.rate(
            &format!("login:username:{username}"),
            self.config.limits.login_limit,
            300_000,
        )?;
        let identity = self
            .config
            .loopback_local
            .as_ref()
            .ok_or(AccessError::Unauthenticated)?;
        let user = store::validate_loopback_local_user(&self.store.db, identity)?;
        let previous = token_hash(request, false)?;
        self.issue(&user, &origin, previous.as_deref(), false)
    }

    /// Consume the root's one-shot checked gateway identity. Native WhoIs runs
    /// in the separate gateway, while Access preserves its native session path.
    pub(crate) fn login_trusted_proxy<'request, 'evidence>(
        &mut self,
        request: &'request RequestEvidence<'evidence>,
        checked: crate::app::trusted_gateway::CheckedGatewayIdentity<'request, 'evidence>,
    ) -> AccessResult<SessionReceipt> {
        let policy = self
            .config
            .trusted_proxy
            .as_ref()
            .ok_or(AccessError::Unauthenticated)?;
        if !std::ptr::eq(request, checked.request())
            || !Arc::ptr_eq(policy, checked.policy())
            || checked.actual_peer_uid() != policy.peer_uid
        {
            return Err(AccessError::Forbidden);
        }
        if request.method != Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let selected_uid = policy.peer_uid;
        let username = self
            .config
            .loopback_local
            .as_ref()
            .ok_or(AccessError::Unauthenticated)?
            .username
            .clone();
        let origin = self.check_origin(request, true, None)?;
        self.rate(
            "login:global",
            self.config.limits.global_login_limit,
            60_000,
        )?;
        self.rate(
            &format!("login:client:trusted-proxy:{selected_uid}"),
            self.config.limits.login_limit,
            300_000,
        )?;
        self.rate(
            &format!("login:username:{username}"),
            self.config.limits.login_limit,
            300_000,
        )?;
        let identity = self
            .config
            .loopback_local
            .as_ref()
            .ok_or(AccessError::Unauthenticated)?;
        let user = store::validate_loopback_local_user(&self.store.db, identity)?;
        let previous = token_hash(request, false)?;
        self.issue(&user, &origin, previous.as_deref(), false)
    }

    pub fn in_memory(config: AccessConfig) -> AccessResult<Self> {
        Self::from_store(Store::memory()?, config)
    }

    /// The operator selects the private directory and recovery policy separately.
    pub fn open(path: impl AsRef<Path>, config: AccessConfig) -> AccessResult<Self> {
        Self::from_store(Store::open(path.as_ref())?, config)
    }

    /// Reopen separately provisioned trusted access state without creation,
    /// initialization, migration, permission changes or session/epoch reset.
    /// Compatibility requires the full compiled schema, not only its version.
    pub fn open_existing(path: impl AsRef<Path>, config: AccessConfig) -> AccessResult<Self> {
        Self::from_store(Store::open_existing(path.as_ref())?, config)
    }

    fn from_store(store: Store, config: AccessConfig) -> AccessResult<Self> {
        Ok(Self {
            store,
            config,
            instance: random_bytes()?,
        })
    }

    /// Administrative persistence seam; never mount as a route or agent tool.
    pub fn provision_user(
        &mut self,
        user_id: &CanonicalId,
        actor_id: &CanonicalId,
        username: &str,
        verifier: &PasswordVerifier,
        enabled: Option<bool>,
    ) -> AccessResult<()> {
        self.store
            .provision_user(user_id, actor_id, username, verifier, enabled)
    }

    pub fn set_membership(
        &mut self,
        user_id: &CanonicalId,
        scope: &Scope,
        role: Role,
        enabled: bool,
    ) -> AccessResult<()> {
        self.store.set_membership(user_id, scope, role, enabled)
    }

    pub fn set_user_enabled(&mut self, user_id: &CanonicalId, enabled: bool) -> AccessResult<()> {
        self.store.db.execute(
            "UPDATE access_users SET enabled=?1,version=version+1 WHERE user_id=?2",
            params![enabled, user_id.as_str()],
        )?;
        Ok(())
    }

    pub fn revoke_user_sessions(&mut self, user_id: &CanonicalId) -> AccessResult<()> {
        self.store.db.execute(
            "DELETE FROM access_sessions WHERE user_id=?1",
            [user_id.as_str()],
        )?;
        Ok(())
    }

    /// Recovery seam. Rotates the opaque restore epoch and clears sessions/rates
    /// atomically; detecting a restored old DB still needs the recovery owner.
    pub fn invalidate_all_sessions(&mut self) -> AccessResult<()> {
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE access_meta SET epoch=?1 WHERE id=1",
            [hex(&random_bytes::<32>()?)],
        )?;
        tx.execute_batch("DELETE FROM access_sessions; DELETE FROM access_rates;")?;
        tx.commit()?;
        Ok(())
    }

    /// Strict bounded login JSON; transport must also bound the actual stream.
    /// One mutable boundary can run only one synchronous derivation at a time.
    pub fn login(
        &mut self,
        request: &RequestEvidence<'_>,
        body: &[u8],
        client_key: &str,
    ) -> AccessResult<SessionReceipt> {
        if request.method != Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let origin = self.check_origin(request, true, None)?;
        if client_key.is_empty() || client_key.len() > 256 {
            return Err(AccessError::InvalidInput);
        }
        self.rate(
            "login:global",
            self.config.limits.global_login_limit,
            60_000,
        )?;
        self.rate(
            &format!("login:client:{client_key}"),
            self.config.limits.login_limit,
            300_000,
        )?;
        if body.len() > 4096 {
            return Err(AccessError::BodyTooLarge);
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct LoginBody {
            username: String,
            password: String,
        }
        let body: LoginBody =
            serde_json::from_slice(body).map_err(|_| AccessError::InvalidInput)?;
        let username =
            store::username_key(&body.username).map_err(|_| AccessError::Unauthenticated)?;
        self.rate(
            &format!("login:username:{username}"),
            self.config.limits.login_limit,
            300_000,
        )?;
        if self.config.loopback_local.is_some() {
            return Err(AccessError::Unauthenticated);
        }
        let user = store::user_by_name(&self.store.db, &username)?;
        let verifier = user
            .as_ref()
            .filter(|u| u.enabled)
            .and_then(|u| match &u.verifier {
                UserVerifier::Password(verifier) => Some(verifier),
                UserVerifier::LoopbackLocal => None,
            });
        let verified = verify_password(&body.password, verifier)?;
        let user = user
            .filter(|u| verified && u.enabled)
            .ok_or(AccessError::Unauthenticated)?;
        let previous = token_hash(request, false)?;
        self.issue(&user, &origin, previous.as_deref(), false)
    }

    /// Authorize before mutation parsing or receipt lookup; revalidate after any
    /// asynchronous work. Mutation issuance requires POST + current CSRF + editor.
    pub fn authorize(
        &mut self,
        request: &RequestEvidence<'_>,
        scope: &Scope,
        action: Action,
    ) -> AccessResult<Principal> {
        let unsafe_request = action == Action::Mutate;
        if if unsafe_request {
            request.method != Method::Post
        } else {
            !matches!(request.method, Method::Get | Method::Head)
        } {
            return Err(AccessError::MethodNotAllowed);
        }
        let (session, user, now) = self.authenticate(request, unsafe_request)?;
        let member = store::membership(&self.store.db, &user.user_id, scope)?
            .filter(|m| m.enabled)
            .ok_or(AccessError::NotFound)?;
        if unsafe_request && member.role != Role::Editor {
            return Err(AccessError::Forbidden);
        }
        let principal = Principal {
            instance: self.instance,
            token_hash: session.token_hash.clone(),
            origin: session.origin,
            user_id: user.user_id,
            actor_id: user.actor_id,
            scope: scope.clone(),
            role: member.role,
            membership_version: member.version,
            action,
        };
        self.revalidate(&principal)?;
        self.store.db.execute(
            "UPDATE access_sessions SET last_seen=MAX(last_seen,?1) WHERE token_hash=?2",
            params![now, principal.token_hash],
        )?;
        Ok(principal)
    }

    /// Authorize the retained-intent transport's explicitly read-only POST.
    /// This requires the same origin and CSRF checks as a mutation request but
    /// issues only a Read principal, so the caller cannot use it for writes.
    pub fn authorize_post_read(
        &mut self,
        request: &RequestEvidence<'_>,
        scope: &Scope,
    ) -> AccessResult<Principal> {
        if request.method != Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let (session, user, now) = self.authenticate(request, true)?;
        let member = store::membership(&self.store.db, &user.user_id, scope)?
            .filter(|m| m.enabled)
            .ok_or(AccessError::NotFound)?;
        let principal = Principal {
            instance: self.instance,
            token_hash: session.token_hash.clone(),
            origin: session.origin,
            user_id: user.user_id,
            actor_id: user.actor_id,
            scope: scope.clone(),
            role: member.role,
            membership_version: member.version,
            action: Action::Read,
        };
        self.revalidate(&principal)?;
        self.store.db.execute(
            "UPDATE access_sessions SET last_seen=MAX(last_seen,?1) WHERE token_hash=?2",
            params![now, principal.token_hash],
        )?;
        Ok(principal)
    }

    pub fn revalidate<'p>(&self, principal: &'p Principal) -> AccessResult<&'p Principal> {
        self.current().revalidate(principal)
    }

    /// Opaque equality key for this boundary instance and authenticated session.
    /// This supplies no authority or durable identity; revalidate each request.
    /// Rotation or a new login changes the session and therefore the binding.
    pub fn authenticated_session_binding(&self, original: &Principal) -> AccessResult<[u8; 32]> {
        self.revalidate(original)?;
        let mut binding = Sha256::new();
        binding.update(b"HouseAtlas.Access.authenticated_session_binding.v1\0");
        binding.update(self.instance);
        // The private digest is exactly 64 lowercase hex bytes, never cookie text.
        binding.update(original.token_hash.as_bytes());
        Ok(binding.finalize().into())
    }

    pub fn assert_mutation<'p>(&self, principal: &'p Principal) -> AccessResult<&'p Principal> {
        self.current().assert_mutation(principal)
    }

    pub fn authorize_storage<'p>(
        &self,
        principal: &'p Principal,
        scope: &Scope,
        capability: Capability<'_>,
    ) -> AccessResult<&'p Principal> {
        self.current().authorize(principal, scope, capability)
    }

    /// Access DB BEGIN IMMEDIATE fence around synchronous storage work.
    /// The callback's unit result cannot return a future. Capture owned storage
    /// output locally if needed. Check through the guard before replay and just
    /// before storage COMMIT; this fence is not a cross-database transaction.
    pub fn with_mutation_authorization<E>(
        &mut self,
        principal: &Principal,
        operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<(), E>,
    ) -> Result<(), E>
    where
        E: From<AccessError>,
    {
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(AccessError::from)
            .map_err(E::from)?;
        let guard = TransactionAuthorization {
            authority: CurrentAuthority {
                db: &tx,
                config: &self.config,
                instance: &self.instance,
            },
            principal,
        };
        guard.assert_mutation().map_err(E::from)?;
        operation(&guard)?;
        tx.commit().map_err(AccessError::from).map_err(E::from)?;
        Ok(())
    }

    /// Current-authority fence around an actual synchronous storage read and
    /// disclosure. The guard borrows the exact supplied principal. Retained
    /// grants must be checked through it; source/generation membership remains
    /// the provider/storage owners' responsibility. No raw connection escapes.
    pub fn with_read_authorization<E: From<AccessError>>(
        &mut self,
        principal: &Principal,
        operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<(), E>,
    ) -> Result<(), E> {
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(AccessError::from)
            .map_err(E::from)?;
        let guard = TransactionAuthorization {
            authority: CurrentAuthority {
                db: &tx,
                config: &self.config,
                instance: &self.instance,
            },
            principal,
        };
        guard
            .authorize(principal.scope(), Capability::Read)
            .map_err(E::from)?;
        operation(&guard)?;
        guard.revalidate().map_err(E::from)?;
        tx.commit().map_err(AccessError::from).map_err(E::from)?;
        Ok(())
    }

    pub fn session_info(&mut self, request: &RequestEvidence<'_>) -> AccessResult<SessionInfo> {
        if request.method != Method::Get {
            return Err(AccessError::MethodNotAllowed);
        }
        let (session, _, _) = self.authenticate(request, false)?;
        let csrf = session_csrf_token(request)?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let authority = CurrentAuthority {
            db: &tx,
            config: &self.config,
            instance: &self.instance,
        };
        let (session, user, now) = authority.session_state(&session.token_hash, &session.origin)?;
        tx.execute(
            "UPDATE access_sessions SET last_seen=MAX(last_seen,?1) WHERE token_hash=?2",
            params![now, session.token_hash],
        )?;
        tx.commit()?;
        Ok(SessionInfo {
            actor_id: user.actor_id,
            csrf_token: csrf,
            expires_at_ms: session.expires_at,
        })
    }

    pub fn rotate_session(
        &mut self,
        request: &RequestEvidence<'_>,
    ) -> AccessResult<SessionReceipt> {
        if request.method != Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let (session, user, _) = self.authenticate(request, true)?;
        self.issue(&user, &session.origin, Some(&session.token_hash), true)
    }

    /// Returns the expiring cookie for the transport's signedOut response.
    pub fn logout(&mut self, request: &RequestEvidence<'_>) -> AccessResult<String> {
        if request.method != Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let (session, _, _) = self.authenticate(request, true)?;
        self.store.db.execute(
            "DELETE FROM access_sessions WHERE token_hash=?1",
            [session.token_hash],
        )?;
        Ok(cookie("", 0))
    }

    pub(super) fn current(&self) -> CurrentAuthority<'_> {
        CurrentAuthority {
            db: &self.store.db,
            config: &self.config,
            instance: &self.instance,
        }
    }

    fn authenticate(
        &mut self,
        request: &RequestEvidence<'_>,
        unsafe_request: bool,
    ) -> AccessResult<(Session, User, i64)> {
        let origin = self.check_origin(request, unsafe_request, None)?;
        let token = token_hash(request, true)?.ok_or(AccessError::Unauthenticated)?;
        let state = self.current().session_state(&token, &origin)?;
        if unsafe_request {
            check_csrf(request, &state.0)?;
        }
        self.rate(
            &format!("request:user:{}", state.1.user_id.as_str()),
            self.config.limits.request_limit,
            60_000,
        )?;
        Ok(state)
    }

    fn rate(&mut self, bucket: &str, limit: u32, window: i64) -> AccessResult<()> {
        self.store
            .consume_rate(&digest(bucket), self.config.now()?, window, limit)
    }

    fn issue(
        &mut self,
        observed: &User,
        origin: &str,
        old_token: Option<&str>,
        preserve_lifetime: bool,
    ) -> AccessResult<SessionReceipt> {
        let token = nonce()?;
        let csrf = nonce()?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let authority = CurrentAuthority {
            db: &tx,
            config: &self.config,
            instance: &self.instance,
        };
        let user =
            store::user_with_loopback(&tx, &observed.user_id, self.config.loopback_local.as_ref())?
                .filter(|u| u.enabled && u.version == observed.version)
                .ok_or(AccessError::Unauthenticated)?;
        if matches!(user.verifier, UserVerifier::LoopbackLocal) {
            store::validate_loopback_local_user(
                &tx,
                self.config
                    .loopback_local
                    .as_ref()
                    .ok_or(AccessError::Unauthenticated)?,
            )?;
        } else if self.config.loopback_local.is_some() {
            return Err(AccessError::Unauthenticated);
        }
        let now = self.config.now()?;
        let previous = if preserve_lifetime {
            Some(
                authority
                    .session_state(old_token.ok_or(AccessError::Unauthenticated)?, origin)?
                    .0,
            )
        } else {
            None
        };
        if let Some(old) = old_token {
            tx.execute("DELETE FROM access_sessions WHERE token_hash=?1", [old])?;
        }
        let session = Session {
            token_hash: digest(&token),
            csrf_hash: digest(&csrf),
            user_id: user.user_id,
            user_version: user.version,
            epoch: store::epoch(&tx)?,
            origin: origin.to_owned(),
            created_at: previous.as_ref().map_or(now, |s| s.created_at),
            last_seen: now,
            expires_at: previous
                .as_ref()
                .map_or(now + self.config.limits.absolute_ms, |s| s.expires_at),
        };
        store::insert_session(&tx, &session, self.config.limits.max_sessions, now)?;
        tx.commit()?;
        Ok(SessionReceipt {
            info: SessionInfo {
                actor_id: user.actor_id,
                csrf_token: csrf,
                expires_at_ms: session.expires_at,
            },
            cookie: cookie(&token, ((session.expires_at - now) / 1000).max(1)),
        })
    }

    fn check_origin(
        &self,
        request: &RequestEvidence<'_>,
        unsafe_request: bool,
        expected: Option<&str>,
    ) -> AccessResult<String> {
        let url = Url::parse(request.url).map_err(|_| AccessError::Forbidden)?;
        let origin = url.origin().ascii_serialization();
        if !self.config.origins.contains(&origin)
            || expected.is_some_and(|e| e != origin)
            || !url.username().is_empty()
            || url.password().is_some()
            || request
                .sec_fetch_site
                .is_some_and(|site| site != "same-origin")
        {
            return Err(AccessError::Forbidden);
        }
        match request.origin {
            Some(supplied) if supplied == origin => {}
            Some(_) => return Err(AccessError::Forbidden),
            None => {
                if unsafe_request
                    || !matches!(request.method, Method::Get | Method::Head)
                    || request.sec_fetch_site != Some("same-origin")
                {
                    return Err(AccessError::Forbidden);
                }
                let referer = request
                    .referer
                    .and_then(|r| Url::parse(r).ok())
                    .ok_or(AccessError::Forbidden)?;
                if referer.origin().ascii_serialization() != origin
                    || !referer.username().is_empty()
                    || referer.password().is_some()
                {
                    return Err(AccessError::Forbidden);
                }
            }
        }
        Ok(origin)
    }
}

/// No connection, administration, provider work or deferred work is exposed.
pub struct TransactionAuthorization<'a> {
    pub(super) authority: CurrentAuthority<'a>,
    pub(super) principal: &'a Principal,
}

impl TransactionAuthorization<'_> {
    pub fn principal(&self) -> &Principal {
        self.principal
    }

    pub fn revalidate(&self) -> AccessResult<&Principal> {
        self.authority.revalidate(self.principal)
    }

    pub fn assert_mutation(&self) -> AccessResult<&Principal> {
        self.authority.assert_mutation(self.principal)
    }

    pub fn authorize(&self, scope: &Scope, capability: Capability<'_>) -> AccessResult<&Principal> {
        self.authority.authorize(self.principal, scope, capability)
    }

    /// Recheck a retained entity grant through this guard's held access
    /// transaction. Success returns the original handle without reissuing it.
    pub fn revalidate_source<'g>(
        &self,
        original: &'g SourceGrant,
    ) -> AccessResult<&'g SourceGrant> {
        self.authority.revalidate_source(self.principal, original)
    }

    /// Recheck retained partition metadata authority, including empty
    /// generations, without replacing the original handle or opening a fence.
    pub fn revalidate_source_partition<'g>(
        &self,
        original: &'g PartitionGrant,
    ) -> AccessResult<&'g PartitionGrant> {
        self.authority
            .revalidate_source_partition(self.principal, original)
    }
}

pub(super) struct CurrentAuthority<'a> {
    pub(super) db: &'a Connection,
    pub(super) config: &'a AccessConfig,
    pub(super) instance: &'a [u8; 32],
}

impl CurrentAuthority<'_> {
    pub(super) fn session_state(
        &self,
        token: &str,
        origin: &str,
    ) -> AccessResult<(Session, User, i64)> {
        let session = store::session(self.db, token)?.ok_or(AccessError::Unauthenticated)?;
        let now = self.config.now()?;
        let epoch: RestoreEpoch = store::epoch(self.db)?;
        if session.epoch != epoch
            || session.origin != origin
            || (self.config.loopback_local.is_some() && self.config.origins[0] != origin)
            || now < session.created_at
            || now < session.last_seen
            || now >= session.expires_at
            || now - session.last_seen >= self.config.limits.idle_ms
        {
            return Err(AccessError::Unauthenticated);
        }
        let user = store::user_with_loopback(
            self.db,
            &session.user_id,
            self.config.loopback_local.as_ref(),
        )?
        .filter(|u| u.enabled && u.version == session.user_version)
        .ok_or(AccessError::Unauthenticated)?;
        if matches!(user.verifier, UserVerifier::LoopbackLocal) {
            store::validate_loopback_local_user(
                self.db,
                self.config
                    .loopback_local
                    .as_ref()
                    .ok_or(AccessError::Unauthenticated)?,
            )?;
        } else if self.config.loopback_local.is_some() {
            return Err(AccessError::Unauthenticated);
        }
        Ok((session, user, now))
    }

    pub(super) fn revalidate<'p>(&self, principal: &'p Principal) -> AccessResult<&'p Principal> {
        if principal.instance != *self.instance {
            return Err(AccessError::Unauthenticated);
        }
        let (_, user, _) = self.session_state(&principal.token_hash, &principal.origin)?;
        if user.user_id != principal.user_id || user.actor_id != principal.actor_id {
            return Err(AccessError::Unauthenticated);
        }
        let member = store::membership(self.db, &user.user_id, &principal.scope)?
            .filter(|m| {
                m.enabled && m.version == principal.membership_version && m.role == principal.role
            })
            .ok_or(AccessError::Forbidden)?;
        if principal.action == Action::Mutate && member.role != Role::Editor {
            return Err(AccessError::Forbidden);
        }
        Ok(principal)
    }

    pub(super) fn assert_mutation<'p>(
        &self,
        principal: &'p Principal,
    ) -> AccessResult<&'p Principal> {
        self.revalidate(principal)?;
        if principal.action != Action::Mutate || principal.role != Role::Editor {
            return Err(AccessError::Forbidden);
        }
        Ok(principal)
    }

    pub(super) fn authorize<'p>(
        &self,
        principal: &'p Principal,
        scope: &Scope,
        capability: Capability<'_>,
    ) -> AccessResult<&'p Principal> {
        self.revalidate(principal)?;
        if principal.scope != *scope {
            return Err(AccessError::NotFound);
        }
        match capability {
            Capability::Mutate => {
                self.assert_mutation(principal)?;
            }
            Capability::ReadCacheEntity(reference) => {
                self.source_grant(principal, reference)?;
            }
            Capability::ReadCachePartition(partition) => {
                self.partition_grant(principal, partition)?;
            }
            Capability::Read | Capability::ReadHistory | Capability::ReadAssetManifest => {}
        }
        Ok(principal)
    }
}

fn token_format(token: &str) -> bool {
    token.len() == 43
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}

fn token_hash(request: &RequestEvidence<'_>, required: bool) -> AccessResult<Option<String>> {
    Ok(session_token(request, required)?.map(digest))
}

fn session_token<'a>(
    request: &RequestEvidence<'a>,
    required: bool,
) -> AccessResult<Option<&'a str>> {
    if request.authorization.is_some() {
        return Err(AccessError::Unauthenticated);
    }
    let raw = request.cookie.unwrap_or("");
    if raw.len() > 8192 {
        return Err(AccessError::Unauthenticated);
    }
    let mut values = raw.split(';').map(str::trim).filter_map(|part| {
        let (name, value) = part.split_once('=').unwrap_or((part, ""));
        (name == SESSION_COOKIE).then_some(value)
    });
    let Some(token) = values.next() else {
        return if required {
            Err(AccessError::Unauthenticated)
        } else {
            Ok(None)
        };
    };
    if values.next().is_some() || !token_format(token) {
        return Err(AccessError::Unauthenticated);
    }
    Ok(Some(token))
}

// Stable for this exact cookie, independent of session reads in other tabs.
// The cookie remains HttpOnly; this domain-separated output cannot replace it.
fn session_csrf_token(request: &RequestEvidence<'_>) -> AccessResult<String> {
    let token = session_token(request, true)?.ok_or(AccessError::Unauthenticated)?;
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, token.as_bytes());
    let tag = ring::hmac::sign(&key, b"houseatlas:session-csrf:v1");
    Ok(URL_SAFE_NO_PAD.encode(tag.as_ref()))
}

fn check_csrf(request: &RequestEvidence<'_>, session: &Session) -> AccessResult<()> {
    let candidate = request
        .csrf
        .filter(|c| token_format(c))
        .ok_or(AccessError::Forbidden)?;
    let candidate_hash = digest(candidate);
    let issued_matches = candidate_hash
        .as_bytes()
        .ct_eq(session.csrf_hash.as_bytes());
    let stable_hash = digest(&session_csrf_token(request)?);
    let stable_matches = candidate_hash.as_bytes().ct_eq(stable_hash.as_bytes());
    // Keep the originally issued token valid without changing its stored hash.
    if !bool::from(issued_matches | stable_matches) {
        return Err(AccessError::Forbidden);
    }
    Ok(())
}

fn cookie(token: &str, seconds: i64) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={seconds}"
    )
}
