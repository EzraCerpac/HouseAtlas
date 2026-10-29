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

mod authorize;
mod callback;
mod checks;
mod disconnect;
mod refresh;

use checks::{
    authorization_url, check_binding, finite_time, one_parameter, optional_parameter, plan_state,
    provider_issue, receipt, saved_tokens, valid_client, validate_material, validate_tokens,
};

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
    /// An explicit authorization begin may adopt only this active operation's
    /// already captured cancellation epoch, after clearing older session material.
    /// The original lease/proof stays unchanged; a stopped lease cannot adopt it.
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

#[cfg(test)]
mod healthy_examples;

// Exact denial entrypoint is separate from healthy examples and ordinary CI.
#[cfg(test)]
#[path = "oauth_begin_denial_checks.rs"]
mod begin_denial_checks;
