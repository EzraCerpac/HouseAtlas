use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, TransactionBehavior, params};
use serde::Deserialize;
use subtle::ConstantTimeEq;
use url::Url;

use super::{
    AccessError, AccessResult, Action, CanonicalId, Capability, Method, PasswordVerifier,
    Principal, RequestEvidence, Role, SESSION_COOKIE, Scope, SessionInfo, SessionReceipt,
    credentials::{digest, hex, nonce, random_bytes, verify_password},
    store::{self, Session, Store, User},
    types::RestoreEpoch,
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
    limits: AccessLimits,
    clock: Box<dyn Fn() -> i64 + Send + Sync>,
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
            limits: AccessLimits::default(),
            clock: Box::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .and_then(|v| i64::try_from(v.as_millis()).ok())
                    .unwrap_or(-1)
            }),
        })
    }

    pub fn with_limits(mut self, limits: AccessLimits) -> AccessResult<Self> {
        limits.validate()?;
        self.limits = limits;
        Ok(self)
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

/// Synchronous modular-monolith component. The embedding runtime owns routing,
/// bounded body streaming and scheduling blocking SQLite/scrypt work.
pub struct AccessBoundary {
    pub(super) store: Store,
    pub(super) config: AccessConfig,
    pub(super) instance: [u8; 32],
}

impl AccessBoundary {
    pub fn in_memory(config: AccessConfig) -> AccessResult<Self> {
        Self::from_store(Store::memory()?, config)
    }

    /// The operator selects the private directory and recovery policy separately.
    pub fn open(path: impl AsRef<Path>, config: AccessConfig) -> AccessResult<Self> {
        Self::from_store(Store::open(path.as_ref())?, config)
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
        let user = store::user_by_name(&self.store.db, &username)?;
        let verifier = user.as_ref().filter(|u| u.enabled).map(|u| &u.verifier);
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

    pub fn revalidate<'p>(&self, principal: &'p Principal) -> AccessResult<&'p Principal> {
        self.current().revalidate(principal)
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

    pub fn session_info(&mut self, request: &RequestEvidence<'_>) -> AccessResult<SessionInfo> {
        if request.method != Method::Get {
            return Err(AccessError::MethodNotAllowed);
        }
        let (session, _, _) = self.authenticate(request, false)?;
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
        let (session, user, now) = authority.session_state(&session.token_hash, &session.origin)?;
        tx.execute(
            "UPDATE access_sessions SET csrf_hash=?1,last_seen=MAX(last_seen,?2) WHERE token_hash=?3",
            params![digest(&csrf), now, session.token_hash],
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
        let user = store::user(&tx, &observed.user_id)?
            .filter(|u| u.enabled && u.version == observed.version)
            .ok_or(AccessError::Unauthenticated)?;
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
    principal: &'a Principal,
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
            || now < session.created_at
            || now < session.last_seen
            || now >= session.expires_at
            || now - session.last_seen >= self.config.limits.idle_ms
        {
            return Err(AccessError::Unauthenticated);
        }
        let user = store::user(self.db, &session.user_id)?
            .filter(|u| u.enabled && u.version == session.user_version)
            .ok_or(AccessError::Unauthenticated)?;
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
    Ok(Some(digest(token)))
}

fn check_csrf(request: &RequestEvidence<'_>, session: &Session) -> AccessResult<()> {
    let candidate = request
        .csrf
        .filter(|c| token_format(c))
        .ok_or(AccessError::Forbidden)?;
    if !bool::from(
        digest(candidate)
            .as_bytes()
            .ct_eq(session.csrf_hash.as_bytes()),
    ) {
        return Err(AccessError::Forbidden);
    }
    Ok(())
}

fn cookie(token: &str, seconds: i64) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={seconds}"
    )
}
