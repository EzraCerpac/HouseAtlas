//! SIWC lifecycle orchestration inside injected trusted boundaries.
//!
//! This module opens no browser/listener and performs no HTTP or cryptography.
//! The host must separately approve the exact account, callback, grant and
//! credential runtime before installing live adapters. Sign-in never starts
//! inference or establishes a paid-use admission.
//!
//! Protocol references reviewed 2026-10-06:
//! - https://developers.openai.com/siwc/token-sharing-open-source/sign-in
//! - https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
//! - https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
//! - https://developers.openai.com/siwc/website
//! - https://github.com/openai/sign-in-with-chatgpt-devkit/tree/f723814abdccec135b519c451fb6e1992ee5e933/packages/local/src
//!
//! Application semantics follow the portable stock.2 wire3 AI integration
//! design. Website identity support does not qualify plan-use credentials or a
//! private server runtime; an OAuth helper is not an inference companion.

use super::{AiError, DIRECT_USAGE_SCOPE, PortFuture, ProviderDiagnostic};
use std::num::NonZeroU16;

pub const OIDC_ISSUER: &str = "https://auth.openai.com";
pub const AUTHORIZATION_ENDPOINT: &str = "https://auth.openai.com/api/accounts/authorize";
pub const OAUTH_RESOURCE: &str = "https://api.openai.com/v1";
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
const IDENTITY_SCOPES: &str = "openid profile email";
const PLAN_SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const ATTEMPT_LIFETIME_MS: u64 = 600_000;
const MAX_SAFE_TIME: u64 = 9_007_199_254_740_991;

/// Trusted-process value only. No Debug, Clone or serde implementation exists.
/// This wrapper prevents accidental ordinary serialization; it does not claim
/// memory zeroization. The host's secret boundary owns that requirement.
pub struct ProtectedValue(String);
impl ProtectedValue {
    pub fn from_trusted_adapter(value: String) -> Result<Self, AiError> {
        if value.is_empty() || value.len() > 65_536 {
            return Err(AiError::InvalidInput);
        }
        Ok(Self(value))
    }
    /// For the injected security/provider/encrypted-storage adapters only.
    pub fn expose_in_trusted_boundary(&self) -> &str {
        &self.0
    }
}

/// Resolved from application authentication, never deserialized from a model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrationBinding {
    pub registration_id: String,
    pub actor_id: String,
    pub workspace_id: String,
    pub home_id: String,
    pub authority_epoch: String,
    pub cancellation_epoch: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientAuthentication {
    Public,
    /// The provider adapter owns the provisioned secret; it is never a field
    /// in this module, a URL, a form body or a public-client fallback.
    IssuedSecretBasic,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistrationKind {
    LocalPublicClient,
    /// Provisioned identity-only website registration. The store supplies the
    /// exact registered HTTPS URI, Host and issued client/authentication method.
    IssuedWebsite {
        registered_callback: String,
        callback_host: String,
        authentication: ClientAuthentication,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallbackSelection {
    /// Reserved by the trusted callback host before launch. This component
    /// cannot observe or claim actual port availability.
    AvailableLoopbackPort(NonZeroU16),
    RegisteredWebsite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignInPurpose {
    Identity,
    /// Supplied only after the user's explicit enable/reconnect plan-use action.
    /// Uses documented prompt=consent; force_reconsent is not assumed deployed.
    EnablePlanUse,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

pub struct FreshAuthorization {
    pub state: ProtectedValue,
    pub nonce: ProtectedValue,
    pub verifier: ProtectedValue,
    pub s256_challenge: String,
}

pub struct IdentityRequirements<'a> {
    pub issuer: &'static str,
    pub audience: &'a str,
    pub nonce: Option<&'a ProtectedValue>,
    /// A rotated ID token is verified at its durable, trusted receipt time.
    pub received_at_ms: u64,
}

pub enum IdentityValidation {
    Verified(VerifiedIdentity),
    Invalid,
    TemporarilyUnavailable,
}

pub trait SecurityPort: Sync {
    /// CSPRNG with at least 256-bit independent state/nonce/verifier entropy;
    /// RFC7636 verifier and base64url(SHA256(verifier)) without padding. No
    /// deterministic production fallback or custom weak crypto is permitted.
    fn fresh<'a>(&'a self) -> PortFuture<'a, FreshAuthorization>;
    /// Constant-time comparison of the decoded callback state.
    fn state_matches(&self, expected: &ProtectedValue, returned: &str) -> bool;
    /// Parse the configured URI; require HTTPS, exact supplied Host, no userinfo
    /// or fragment, and the provisioned registration's exact callback. This is
    /// validation of trusted configuration, not discovery or registration.
    fn validate_website_callback(&self, uri: &str, host: &str) -> Result<(), AiError>;
    /// Verify signature/JWKS, issuer, audience/azp, expiry/iat, subject and the
    /// original nonce when present, using a maintained JWT implementation and
    /// bounded skew. Unavailable keys are distinct from invalid claims.
    fn verify_identity<'a>(
        &'a self,
        token: &'a ProtectedValue,
        requirements: IdentityRequirements<'a>,
    ) -> PortFuture<'a, IdentityValidation>;
}

/// Raw provider data, still unvalidated and never browser-serializable.
pub struct TokenReply {
    pub id_token: Option<ProtectedValue>,
    pub access_token: Option<ProtectedValue>,
    pub refresh_token: Option<ProtectedValue>,
    pub token_type: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub granted_scopes: Option<Vec<String>>,
    pub received_at_ms: u64,
}

pub struct SavedCredentials {
    pub id_token: Option<ProtectedValue>,
    pub access_token: Option<ProtectedValue>,
    pub refresh_token: Option<ProtectedValue>,
    pub expires_at_ms: Option<u64>,
    pub granted_scopes: Vec<String>,
}

pub enum ProviderTokens {
    Received(TokenReply),
    Rejected(ProviderDiagnostic),
}

pub struct CodeExchange<'a> {
    pub client_id: &'a str,
    pub code: &'a ProtectedValue,
    pub verifier: &'a ProtectedValue,
    pub redirect_uri: &'a str,
    pub resource: Option<&'static str>,
    pub authentication: ClientAuthentication,
}

pub struct RefreshGrant<'a> {
    pub client_id: &'a str,
    pub refresh_token: &'a ProtectedValue,
    pub resource: &'static str,
}

pub enum ProviderRevocation {
    Confirmed,
    Unconfirmed(Option<ProviderDiagnostic>),
}

pub trait OAuthProviderPort: Sync {
    /// Form-encoded authorization_code with the exact saved redirect URI and
    /// issued client. Do not retry a one-time code after uncertainty.
    fn exchange<'a>(
        &'a self,
        binding: &'a RegistrationBinding,
        grant: CodeExchange<'a>,
    ) -> PortFuture<'a, ProviderTokens>;
    /// Form-encoded refresh_token, issued client and resource, omitting scope.
    /// No automatic replay after an ambiguous/consumed refresh.
    fn refresh<'a>(
        &'a self,
        binding: &'a RegistrationBinding,
        grant: RefreshGrant<'a>,
    ) -> PortFuture<'a, ProviderTokens>;
    /// Discover and validate the issuer's revocation_endpoint. POST the refresh
    /// token, token_type_hint=refresh_token and issued client. Only qualified
    /// HTTP 200 confirms this renewable session's revocation. A bounded network/
    /// 5xx backoff may happen within the adapter while the token remains local.
    fn revoke<'a>(
        &'a self,
        binding: &'a RegistrationBinding,
        client_id: &'a str,
        refresh_token: &'a ProtectedValue,
    ) -> PortFuture<'a, ProviderRevocation>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleState {
    Disconnected,
    Connected,
    PlanUseDisabled,
    ReauthorizationRequired,
    ConfigurationRepairRequired,
    IdentityVerificationPending,
    RefreshUnconfirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthIssue {
    ConsentDeclined,
    RegistrationIncomplete,
    CallbackInvalid,
    IdentityInvalid,
    IdentityUnavailable,
    PlanScopeMissing,
    ExchangeUnconfirmed,
    RefreshUnconfirmed,
    ExplicitReauthorizationRequired,
    ClientConfigurationInvalid,
    ProviderRejected,
    StorageUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevocationState {
    NotRequested,
    Confirmed,
    Unconfirmed,
}

/// Safe lifecycle metadata; diagnostics remain private and are not serde DTOs.
pub struct LifecycleReceipt {
    pub state: LifecycleState,
    pub issue: Option<OAuthIssue>,
    pub revocation: RevocationState,
    pub diagnostic: Option<ProviderDiagnostic>,
}

pub struct AuthorizationAttempt {
    pub binding: RegistrationBinding,
    pub material: FreshAuthorization,
    pub redirect_uri: String,
    pub callback_host: String,
    pub purpose: SignInPurpose,
    pub client_id: String,
    pub authentication: ClientAuthentication,
    pub expires_at_ms: u64,
}

/// Persist received exchanges/rotations before identity verification/activation.
/// A sent refresh can have consumed its token, so persist its invocation too.
/// No checkpoint authorizes inference or replay of a code/previous token.
pub enum RefreshCheckpoint {
    None,
    InvocationUnconfirmed(RegistrationBinding),
    Received {
        binding: RegistrationBinding,
        reply: TokenReply,
    },
    ExchangeReceived {
        binding: RegistrationBinding,
        client_id: String,
        nonce: ProtectedValue,
        reply: TokenReply,
    },
}

/// Private per-registration encrypted record. Never export it or use a global
/// selected-profile slot across people. Subject/email are not workspace IDs.
pub struct RegistrationRecord {
    pub binding: RegistrationBinding,
    pub kind: RegistrationKind,
    pub app_name: String,
    pub stable_host_id: String,
    pub issued_client_id: Option<String>,
    pub identity: Option<VerifiedIdentity>,
    pub credentials: Option<SavedCredentials>,
    pub pending_authorization: Option<AuthorizationAttempt>,
    pub refresh_checkpoint: RefreshCheckpoint,
    pub state: LifecycleState,
    pub revocation: RevocationState,
}

pub trait CredentialBoundary<C>: Sync {
    /// Exclusive per-registration lease spanning refresh/exchange/disconnect,
    /// shared by every process/alias accessing this credential session. Release
    /// on Drop; never serialize unrelated people's sessions through one slot.
    type Lease: Send;
    fn acquire<'a>(
        &'a self,
        context: &'a C,
        binding: &'a RegistrationBinding,
    ) -> PortFuture<'a, Self::Lease>;
    /// Require absolute storage location, available OS-backed encryption,
    /// protected permissions and intact state. Preserve corrupt/inaccessible
    /// ciphertext; fail closed without plaintext or an in-memory fallback.
    fn load<'a>(&'a self, lease: &'a Self::Lease) -> PortFuture<'a, RegistrationRecord>;
    /// Atomically encrypt/persist the complete same-registration record. Durable
    /// pending rotation is not active credentials. Never replace another account
    /// or rebase the captured binding to a different actor/home/authority epoch.
    fn persist_atomic<'a>(
        &'a self,
        lease: &'a mut Self::Lease,
        record: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()>;
    fn revalidate<'a>(
        &'a self,
        context: &'a C,
        lease: &'a Self::Lease,
        binding: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()>;
    /// Stop current local use and invalidate the registration's cancellation
    /// epoch before disconnect/terminal loss. This cannot undo submitted work.
    fn stop_use<'a>(&'a self, lease: &'a mut Self::Lease) -> PortFuture<'a, ()>;
    /// Trusted finite operational clock, not supplied by a browser/model.
    fn now_ms(&self) -> Result<u64, AiError>;
}

/// No identity/token hints are placed in the launch URL. It contains only this
/// attempt's authorization values; caller must still avoid logging the URL.
pub struct AuthorizationLaunch(String);
impl AuthorizationLaunch {
    pub fn trusted_authorization_url(&self) -> &str {
        &self.0
    }
}

/// The callback host decodes query values exactly once, retaining duplicates.
/// It must not serialize or log this request or expose it through browser IPC.
pub struct CallbackRequest {
    pub method: String,
    pub host: String,
    /// Base URI without query, obtained from the actual callback route.
    pub redirect_uri: String,
    pub parameters: Vec<(String, String)>,
}

pub struct OAuthLifecycle<'a, Security, Provider, Credentials> {
    pub security: &'a Security,
    pub provider: &'a Provider,
    pub credentials: &'a Credentials,
}

impl<S: SecurityPort, P: OAuthProviderPort, B> OAuthLifecycle<'_, S, P, B> {
    pub async fn begin<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        callback: CallbackSelection,
        purpose: SignInPurpose,
    ) -> Result<AuthorizationLaunch, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        if !matches!(record.refresh_checkpoint, RefreshCheckpoint::None) {
            // A new launch must not overwrite unverified session material.
            return Err(AiError::ConnectionUnavailable);
        }
        let now = finite_time(self.credentials.now_ms()?)?;
        let (redirect_uri, callback_host, authentication) = match (&record.kind, callback) {
            (
                RegistrationKind::LocalPublicClient,
                CallbackSelection::AvailableLoopbackPort(port),
            ) => (
                format!("http://127.0.0.1:{port}/auth/callback"),
                format!("127.0.0.1:{port}"),
                ClientAuthentication::Public,
            ),
            (
                RegistrationKind::IssuedWebsite {
                    registered_callback,
                    callback_host,
                    authentication,
                },
                CallbackSelection::RegisteredWebsite,
            ) if purpose == SignInPurpose::Identity => {
                self.security
                    .validate_website_callback(registered_callback, callback_host)?;
                (
                    registered_callback.clone(),
                    callback_host.clone(),
                    *authentication,
                )
            }
            _ => return Err(AiError::InvalidInput),
        };
        let client_id = match &record.issued_client_id {
            Some(client) if valid_client(client) => client.clone(),
            None if record.kind == RegistrationKind::LocalPublicClient => DYNAMIC_CLIENT.into(),
            _ => return Err(AiError::ConnectionUnavailable),
        };
        if record.app_name.trim().is_empty()
            || (record.kind == RegistrationKind::LocalPublicClient
                && record.stable_host_id.trim().is_empty())
        {
            return Err(AiError::InvalidInput);
        }
        let material = self.security.fresh().await?;
        validate_material(&material)?;
        let attempt = AuthorizationAttempt {
            binding: binding.clone(),
            material,
            redirect_uri,
            callback_host,
            purpose,
            client_id,
            authentication,
            expires_at_ms: finite_time(
                now.checked_add(ATTEMPT_LIFETIME_MS)
                    .ok_or(AiError::InvalidInput)?,
            )?,
        };
        let launch = authorization_url(&record, &attempt);
        // A new attempt does not replace a previously valid identity/token set.
        record.pending_authorization = Some(attempt);
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        self.credentials.persist_atomic(&mut lease, &record).await?;
        Ok(AuthorizationLaunch(launch))
    }

    pub async fn complete<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        callback: CallbackRequest,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        if !matches!(record.refresh_checkpoint, RefreshCheckpoint::None) {
            return Err(AiError::ConnectionUnavailable);
        }
        let attempt = record
            .pending_authorization
            .as_ref()
            .ok_or(AiError::InvalidInput)?;
        let now = finite_time(self.credentials.now_ms()?)?;
        let state = one_parameter(&callback, "state")?;
        if callback.method != "GET"
            || callback.host != attempt.callback_host
            || callback.redirect_uri != attempt.redirect_uri
            || &attempt.binding != binding
            || now >= attempt.expires_at_ms
            || !self.security.state_matches(&attempt.material.state, state)
        {
            // An unrelated request cannot consume the legitimate pending attempt.
            return Ok(receipt(&record, OAuthIssue::CallbackInvalid, None));
        }
        let error = optional_parameter(&callback, "error")?;
        let code = optional_parameter(&callback, "code")?;
        let returned_client = optional_parameter(&callback, "client_id")?;
        let client = returned_client.unwrap_or(&attempt.client_id).to_owned();
        let client_valid = valid_client(&client)
            && (attempt.client_id == DYNAMIC_CLIENT || client == attempt.client_id);
        let attempt = record
            .pending_authorization
            .take()
            .ok_or(AiError::InvalidInput)?;
        // Consume a verified one-time callback and retain the issued registration
        // before exchanging its code. Later failures require fresh authorization.
        if error.is_none() && client_valid {
            record.issued_client_id = Some(client.clone());
        }
        self.credentials.persist_atomic(&mut lease, &record).await?;
        if let Some(error) = error {
            let issue = if error == "access_denied" {
                OAuthIssue::ConsentDeclined
            } else {
                OAuthIssue::ProviderRejected
            };
            return Ok(receipt(&record, issue, None));
        }
        if !client_valid || code.is_none() {
            return Ok(receipt(&record, OAuthIssue::RegistrationIncomplete, None));
        }
        let code =
            ProtectedValue::from_trusted_adapter(code.ok_or(AiError::InvalidInput)?.to_owned())?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        let reply = self
            .provider
            .exchange(
                binding,
                CodeExchange {
                    client_id: &client,
                    code: &code,
                    verifier: &attempt.material.verifier,
                    redirect_uri: &attempt.redirect_uri,
                    resource: (record.kind == RegistrationKind::LocalPublicClient)
                        .then_some(OAUTH_RESOURCE),
                    authentication: attempt.authentication,
                },
            )
            .await;
        let reply = match reply {
            Ok(ProviderTokens::Received(reply)) => reply,
            Ok(ProviderTokens::Rejected(diagnostic)) => {
                return Ok(receipt(
                    &record,
                    provider_issue(&diagnostic),
                    Some(diagnostic),
                ));
            }
            Err(_) => return Ok(receipt(&record, OAuthIssue::ExchangeUnconfirmed, None)),
        };
        record.refresh_checkpoint = RefreshCheckpoint::ExchangeReceived {
            binding: binding.clone(),
            client_id: client,
            nonce: attempt.material.nonce,
            reply,
        };
        record.state = LifecycleState::IdentityVerificationPending;
        // Capture received remote session material before any validation await.
        // The encrypted checkpoint is not active credentials; persistence is
        // required even if keys/identity verification are temporarily unavailable.
        self.credentials.persist_atomic(&mut lease, &record).await?;
        self.activate_exchange(context, binding, &mut lease, &mut record)
            .await
    }

    /// Retry only verification of a durable received exchange. Never exchanges
    /// the consumed authorization code or starts a new grant/refresh/inference.
    pub async fn verify_received_exchange<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        if record.state != LifecycleState::IdentityVerificationPending {
            return Err(AiError::ConnectionUnavailable);
        }
        self.activate_exchange(context, binding, &mut lease, &mut record)
            .await
    }

    async fn activate_exchange<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        lease: &mut B::Lease,
        record: &mut RegistrationRecord,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let (client, nonce, reply) = match &record.refresh_checkpoint {
            RefreshCheckpoint::ExchangeReceived {
                binding: captured,
                client_id,
                nonce,
                reply,
            } if captured == binding && record.issued_client_id.as_ref() == Some(client_id) => {
                (client_id, nonce, reply)
            }
            _ => return Err(AiError::ConnectionUnavailable),
        };
        validate_tokens(reply, &record.kind, false)?;
        self.credentials.revalidate(context, lease, binding).await?;
        let token = reply
            .id_token
            .as_ref()
            .ok_or(AiError::InvalidProviderOutput)?;
        let identity = match self
            .security
            .verify_identity(
                token,
                IdentityRequirements {
                    issuer: OIDC_ISSUER,
                    audience: client,
                    nonce: Some(nonce),
                    received_at_ms: reply.received_at_ms,
                },
            )
            .await
        {
            Ok(IdentityValidation::Verified(identity))
                if !identity.subject.is_empty()
                    && record
                        .identity
                        .as_ref()
                        .is_none_or(|old| old.subject == identity.subject) =>
            {
                identity
            }
            Ok(IdentityValidation::TemporarilyUnavailable) | Err(_) => {
                return Ok(receipt(record, OAuthIssue::IdentityUnavailable, None));
            }
            _ => return Ok(receipt(record, OAuthIssue::IdentityInvalid, None)),
        };
        record.state = plan_state(&record.kind, reply.granted_scopes.as_deref().unwrap_or(&[]));
        record.identity = Some(identity);
        self.credentials.revalidate(context, lease, binding).await?;
        let reply = match std::mem::replace(&mut record.refresh_checkpoint, RefreshCheckpoint::None)
        {
            RefreshCheckpoint::ExchangeReceived { reply, .. } => reply,
            _ => return Err(AiError::ConnectionUnavailable),
        };
        // Website identity has no supported plan-use token contract. Retain
        // only its validated identity mapping; local plan-use registrations
        // keep their protected token set in the selected credential boundary.
        record.credentials = if record.kind == RegistrationKind::LocalPublicClient {
            Some(saved_tokens(reply, vec![]))
        } else {
            None
        };
        record.revocation = RevocationState::NotRequested;
        self.credentials.persist_atomic(lease, record).await?;
        Ok(LifecycleReceipt {
            state: record.state,
            issue: (record.state == LifecycleState::PlanUseDisabled)
                .then_some(OAuthIssue::PlanScopeMissing),
            revocation: record.revocation,
            diagnostic: None,
        })
    }

    pub async fn refresh<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        if matches!(
            record.refresh_checkpoint,
            RefreshCheckpoint::ExchangeReceived { .. }
        ) && record.state == LifecycleState::IdentityVerificationPending
        {
            // Explicit host refresh can finish verification without a second
            // exchange or refresh grant, including a first website identity.
            return self
                .activate_exchange(context, binding, &mut lease, &mut record)
                .await;
        }
        match record.state {
            LifecycleState::ConfigurationRepairRequired => {
                return Ok(receipt(
                    &record,
                    OAuthIssue::ClientConfigurationInvalid,
                    None,
                ));
            }
            LifecycleState::Disconnected | LifecycleState::ReauthorizationRequired => {
                return Ok(receipt(
                    &record,
                    OAuthIssue::ExplicitReauthorizationRequired,
                    None,
                ));
            }
            _ => {}
        }
        if record
            .identity
            .as_ref()
            .is_none_or(|identity| identity.subject.is_empty())
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let client = record
            .issued_client_id
            .as_deref()
            .filter(|client| valid_client(client))
            .ok_or(AiError::ConnectionUnavailable)?
            .to_owned();
        if record.kind != RegistrationKind::LocalPublicClient {
            return Err(AiError::ConnectionUnavailable);
        }
        if matches!(
            record.refresh_checkpoint,
            RefreshCheckpoint::InvocationUnconfirmed(_)
        ) {
            return Ok(LifecycleReceipt {
                state: LifecycleState::RefreshUnconfirmed,
                ..receipt(&record, OAuthIssue::RefreshUnconfirmed, None)
            });
        }
        if matches!(record.refresh_checkpoint, RefreshCheckpoint::None) {
            let refresh = record
                .credentials
                .as_ref()
                .and_then(|tokens| tokens.refresh_token.as_ref())
                .ok_or(AiError::ConnectionUnavailable)?;
            record.refresh_checkpoint = RefreshCheckpoint::InvocationUnconfirmed(binding.clone());
            record.state = LifecycleState::RefreshUnconfirmed;
            self.credentials.persist_atomic(&mut lease, &record).await?;
            self.credentials
                .revalidate(context, &lease, binding)
                .await?;
            let reply = self
                .provider
                .refresh(
                    binding,
                    RefreshGrant {
                        client_id: &client,
                        refresh_token: refresh,
                        resource: OAUTH_RESOURCE,
                    },
                )
                .await;
            match reply {
                Ok(ProviderTokens::Received(reply)) => {
                    record.refresh_checkpoint = RefreshCheckpoint::Received {
                        binding: binding.clone(),
                        reply,
                    };
                    record.state = LifecycleState::IdentityVerificationPending;
                    // A received rotation cannot be replayed or activated while
                    // verification is unavailable, including after restart.
                    self.credentials.persist_atomic(&mut lease, &record).await?;
                }
                Ok(ProviderTokens::Rejected(diagnostic)) => {
                    let issue = provider_issue(&diagnostic);
                    if issue == OAuthIssue::ExplicitReauthorizationRequired {
                        self.credentials.stop_use(&mut lease).await?;
                        record.credentials = None;
                        record.refresh_checkpoint = RefreshCheckpoint::None;
                        record.state = LifecycleState::ReauthorizationRequired;
                    } else if issue == OAuthIssue::ClientConfigurationInvalid {
                        record.refresh_checkpoint = RefreshCheckpoint::None;
                        record.state = LifecycleState::ConfigurationRepairRequired;
                    }
                    self.credentials.persist_atomic(&mut lease, &record).await?;
                    return Ok(receipt(&record, issue, Some(diagnostic)));
                }
                Err(_) => return Ok(receipt(&record, OAuthIssue::RefreshUnconfirmed, None)),
            }
        }
        let rotation = match &record.refresh_checkpoint {
            RefreshCheckpoint::Received {
                binding: captured,
                reply,
            } if captured == binding => reply,
            _ => return Err(AiError::ConnectionUnavailable),
        };
        validate_tokens(rotation, &record.kind, true)?;
        let mut new_identity = None;
        if let Some(token) = &rotation.id_token {
            match self
                .security
                .verify_identity(
                    token,
                    IdentityRequirements {
                        issuer: OIDC_ISSUER,
                        audience: &client,
                        nonce: None,
                        received_at_ms: rotation.received_at_ms,
                    },
                )
                .await
            {
                Ok(IdentityValidation::Verified(identity))
                    if record
                        .identity
                        .as_ref()
                        .is_some_and(|old| old.subject == identity.subject) =>
                {
                    new_identity = Some(identity)
                }
                Ok(IdentityValidation::TemporarilyUnavailable) | Err(_) => {
                    return Ok(receipt(&record, OAuthIssue::IdentityUnavailable, None));
                }
                _ => {
                    self.credentials.stop_use(&mut lease).await?;
                    record.credentials = None;
                    record.refresh_checkpoint = RefreshCheckpoint::None;
                    record.state = LifecycleState::ReauthorizationRequired;
                    self.credentials.persist_atomic(&mut lease, &record).await?;
                    return Ok(receipt(&record, OAuthIssue::IdentityInvalid, None));
                }
            }
        }
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        let previous_scopes = record
            .credentials
            .as_ref()
            .map(|old| old.granted_scopes.clone())
            .unwrap_or_default();
        let rotation =
            match std::mem::replace(&mut record.refresh_checkpoint, RefreshCheckpoint::None) {
                RefreshCheckpoint::Received {
                    binding: captured,
                    reply,
                } if &captured == binding => reply,
                _ => return Err(AiError::ConnectionUnavailable),
            };
        let mut tokens = saved_tokens(rotation, previous_scopes);
        if tokens.id_token.is_none() {
            tokens.id_token = record
                .credentials
                .as_mut()
                .and_then(|old| old.id_token.take());
        }
        record.state = plan_state(&record.kind, &tokens.granted_scopes);
        record.credentials = Some(tokens);
        if let Some(identity) = new_identity {
            record.identity = Some(identity);
        }
        self.credentials.persist_atomic(&mut lease, &record).await?;
        Ok(LifecycleReceipt {
            state: record.state,
            issue: (record.state == LifecycleState::PlanUseDisabled)
                .then_some(OAuthIssue::PlanScopeMissing),
            revocation: record.revocation,
            diagnostic: None,
        })
    }

    pub async fn disconnect<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        self.credentials.stop_use(&mut lease).await?;
        record.state = LifecycleState::Disconnected;
        record.pending_authorization = None;
        if record.credentials.is_some()
            || !matches!(record.refresh_checkpoint, RefreshCheckpoint::None)
        {
            // Existing session material creates a new remote-disconnection
            // obligation, even when no renewable token is available. An empty
            // repeated disconnect preserves the prior revocation evidence.
            record.revocation = RevocationState::Unconfirmed;
        }
        // Stop use durably before remote I/O; a failed revocation never silently
        // reconnects or destroys the saved issued-client/account registration.
        self.credentials.persist_atomic(&mut lease, &record).await?;
        let exchange = match &record.refresh_checkpoint {
            RefreshCheckpoint::ExchangeReceived {
                client_id, reply, ..
            } => Some((client_id, reply.refresh_token.as_ref())),
            _ => None,
        };
        let refresh = match &record.refresh_checkpoint {
            RefreshCheckpoint::Received { reply, .. }
            | RefreshCheckpoint::ExchangeReceived { reply, .. } => reply.refresh_token.as_ref(),
            _ => record
                .credentials
                .as_ref()
                .and_then(|tokens| tokens.refresh_token.as_ref()),
        };
        let mut diagnostic = None;
        let mut all_confirmed = false;
        if let (Some(client), Some(refresh)) = (
            exchange
                .map(|(client, _)| client)
                .or(record.issued_client_id.as_ref()),
            refresh,
        ) {
            match self.provider.revoke(binding, client, refresh).await {
                Ok(ProviderRevocation::Confirmed) => all_confirmed = true,
                Ok(ProviderRevocation::Unconfirmed(detail)) => diagnostic = detail,
                Err(_) => {}
            }
        }
        // A new authorization exchange is a separate renewable session from
        // any previously active credentials. Disconnect must attempt both;
        // success for one cannot stand in for revocation of the other.
        if exchange.is_some()
            && let Some(previous) = record.credentials.as_ref()
        {
            match (&record.issued_client_id, &previous.refresh_token) {
                (Some(client), Some(refresh)) => {
                    match self.provider.revoke(binding, client, refresh).await {
                        Ok(ProviderRevocation::Confirmed) => {}
                        Ok(ProviderRevocation::Unconfirmed(detail)) => {
                            all_confirmed = false;
                            if diagnostic.is_none() {
                                diagnostic = detail;
                            }
                        }
                        Err(_) => all_confirmed = false,
                    }
                }
                _ => all_confirmed = false,
            }
        }
        if all_confirmed {
            record.revocation = RevocationState::Confirmed;
        }
        // An unconfirmed exchange-session revocation must remain available for
        // a later explicit disconnect; disconnected state prevents activation.
        if !matches!(
            &record.refresh_checkpoint,
            RefreshCheckpoint::ExchangeReceived { reply, .. } if reply.refresh_token.is_some()
        ) || record.revocation == RevocationState::Confirmed
        {
            record.credentials = None;
            record.refresh_checkpoint = RefreshCheckpoint::None;
        }
        self.credentials.persist_atomic(&mut lease, &record).await?;
        Ok(LifecycleReceipt {
            state: record.state,
            issue: None,
            revocation: record.revocation,
            diagnostic,
        })
    }
}

fn check_binding(
    record: &RegistrationRecord,
    expected: &RegistrationBinding,
) -> Result<(), AiError> {
    // Persistent ownership stays stable across cancellation-epoch changes.
    // The boundary revalidates this operation's original authority/cancellation
    // epochs immediately before dispatch and activation; they cannot be rebased.
    if record.binding.registration_id != expected.registration_id
        || record.binding.actor_id != expected.actor_id
        || record.binding.workspace_id != expected.workspace_id
        || record.binding.home_id != expected.home_id
    {
        Err(AiError::ConnectionUnavailable)
    } else {
        Ok(())
    }
}
fn finite_time(value: u64) -> Result<u64, AiError> {
    if value == 0 || value > MAX_SAFE_TIME {
        Err(AiError::InvalidInput)
    } else {
        Ok(value)
    }
}
fn valid_client(value: &str) -> bool {
    value != DYNAMIC_CLIENT
        && !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
}
fn validate_material(material: &FreshAuthorization) -> Result<(), AiError> {
    let valid = |value: &str| {
        (43..=128).contains(&value.len())
            && value
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b"-._~".contains(&ch))
    };
    let state = material.state.expose_in_trusted_boundary();
    let nonce = material.nonce.expose_in_trusted_boundary();
    let verifier = material.verifier.expose_in_trusted_boundary();
    if !valid(state)
        || !valid(nonce)
        || !valid(verifier)
        || state == nonce
        || state == verifier
        || nonce == verifier
        || material.s256_challenge.len() != 43
        || !material
            .s256_challenge
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_')
    {
        Err(AiError::InvalidInput)
    } else {
        Ok(())
    }
}
fn one_parameter<'a>(request: &'a CallbackRequest, key: &str) -> Result<&'a str, AiError> {
    optional_parameter(request, key)?.ok_or(AiError::InvalidInput)
}
fn optional_parameter<'a>(
    request: &'a CallbackRequest,
    key: &str,
) -> Result<Option<&'a str>, AiError> {
    let mut values = request.parameters.iter().filter(|(name, _)| name == key);
    let value = values.next().map(|(_, value)| value.as_str());
    if values.next().is_some() {
        Err(AiError::InvalidInput)
    } else {
        Ok(value)
    }
}
fn validate_tokens(
    reply: &TokenReply,
    kind: &RegistrationKind,
    refresh: bool,
) -> Result<(), AiError> {
    finite_time(reply.received_at_ms)?;
    let scopes = reply.granted_scopes.as_deref().unwrap_or(&[]);
    if kind == &RegistrationKind::LocalPublicClient && !refresh && reply.granted_scopes.is_none() {
        return Err(AiError::InvalidProviderOutput);
    }
    if reply.access_token.is_some()
        && (reply
            .token_type
            .as_deref()
            .is_none_or(|kind| !kind.eq_ignore_ascii_case("bearer"))
            || reply.expires_at_ms.is_none_or(|expires| {
                finite_time(expires).is_err() || expires <= reply.received_at_ms
            }))
    {
        return Err(AiError::InvalidProviderOutput);
    }
    let offline_access = scopes.iter().any(|scope| scope == "offline_access");
    let direct_use = scopes.iter().any(|scope| scope == DIRECT_USAGE_SCOPE);
    // The pinned DevKit requires access for direct use, but a renewable token
    // only for an offline grant or a refresh exchange. Direct use alone does
    // not imply offline access or invent a refresh token requirement.
    if ((refresh || offline_access || direct_use) && reply.access_token.is_none())
        || ((refresh || offline_access) && reply.refresh_token.is_none())
    {
        return Err(AiError::InvalidProviderOutput);
    }
    Ok(())
}
fn saved_tokens(reply: TokenReply, previous_scopes: Vec<String>) -> SavedCredentials {
    SavedCredentials {
        id_token: reply.id_token,
        access_token: reply.access_token,
        refresh_token: reply.refresh_token,
        expires_at_ms: reply.expires_at_ms,
        granted_scopes: reply.granted_scopes.unwrap_or(previous_scopes),
    }
}
fn plan_state(kind: &RegistrationKind, scopes: &[String]) -> LifecycleState {
    if kind == &RegistrationKind::LocalPublicClient
        && scopes.iter().any(|scope| scope == DIRECT_USAGE_SCOPE)
    {
        LifecycleState::Connected
    } else {
        LifecycleState::PlanUseDisabled
    }
}
fn provider_issue(diagnostic: &ProviderDiagnostic) -> OAuthIssue {
    match diagnostic.code.as_deref() {
        Some("invalid_client") => OAuthIssue::ClientConfigurationInvalid,
        Some(
            "invalid_grant"
            | "invalid_refresh_token"
            | "token_expired"
            | "refresh_token_expired"
            | "refresh_token_invalidated"
            | "refresh_token_reused",
        ) => OAuthIssue::ExplicitReauthorizationRequired,
        _ => OAuthIssue::ProviderRejected,
    }
}
fn receipt(
    record: &RegistrationRecord,
    issue: OAuthIssue,
    diagnostic: Option<ProviderDiagnostic>,
) -> LifecycleReceipt {
    LifecycleReceipt {
        state: record.state,
        issue: Some(issue),
        revocation: record.revocation,
        diagnostic,
    }
}
fn authorization_url(record: &RegistrationRecord, attempt: &AuthorizationAttempt) -> String {
    let mut parameters = vec![
        ("client_id", attempt.client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", attempt.redirect_uri.as_str()),
        (
            "scope",
            if attempt.purpose == SignInPurpose::EnablePlanUse {
                PLAN_SCOPES
            } else {
                IDENTITY_SCOPES
            },
        ),
        ("state", attempt.material.state.expose_in_trusted_boundary()),
        ("nonce", attempt.material.nonce.expose_in_trusted_boundary()),
        ("code_challenge_method", "S256"),
        ("code_challenge", attempt.material.s256_challenge.as_str()),
    ];
    if record.kind == RegistrationKind::LocalPublicClient {
        parameters.push(("resource", OAUTH_RESOURCE));
        parameters.push(("ext_agent_host_id", record.stable_host_id.as_str()));
        if attempt.client_id == DYNAMIC_CLIENT {
            parameters.push(("agent_name_hint", record.app_name.as_str()));
        }
    }
    if attempt.purpose == SignInPurpose::EnablePlanUse {
        parameters.push(("prompt", "consent"));
    }
    let query = parameters
        .into_iter()
        .map(|(key, value)| format!("{}={}", form_encode(key), form_encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{AUTHORIZATION_ENDPOINT}?{query}")
}
fn form_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                encoded.push(char::from(byte))
            }
            b' ' => encoded.push('+'),
            _ => {
                encoded.push('%');
                encoded.push(char::from(HEX[usize::from(byte >> 4)]));
                encoded.push(char::from(HEX[usize::from(byte & 15)]));
            }
        }
    }
    encoded
}

#[cfg(test)]
mod healthy_examples {
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
        fn acquire<'a>(
            &'a self,
            _: &'a (),
            expected: &'a RegistrationBinding,
        ) -> PortFuture<'a, ()> {
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

    #[test]
    fn healthy_local_oauth_components() {
        healthy_local_callback(true);
    }

    #[test]
    fn healthy_local_oauth_direct_scope_without_offline() {
        healthy_local_callback(false);
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
}
