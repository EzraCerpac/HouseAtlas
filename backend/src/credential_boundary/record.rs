//! Versioned plaintext codec for one complete private OAuth registration.
//!
//! This is an encoding prerequisite for the credential boundary, not encryption,
//! storage, authenticity verification, or permission to activate credentials.
//! The boundary must encrypt and authenticate the bytes for the same registration
//! before persistence. Neither the record nor these bytes belong in an HTTP DTO,
//! browser IPC, diagnostic, or log.

use crate::ai::{
    AiError,
    host::checkpoint,
    oauth::{
        AuthorizationAttempt, ClientAuthentication, FreshAuthorization, LifecycleState,
        ProtectedValue, RefreshCheckpoint, RegistrationBinding, RegistrationKind,
        RegistrationRecord, RevocationState, SavedCredentials, SignInPurpose, VerifiedIdentity,
    },
};
use serde::{Deserialize, Deserializer, Serialize};
use zeroize::Zeroize;

const VERSION: u8 = 1;
const MAX_BYTES: usize = 4 * 1024 * 1024;

/// An optional value is part of the complete envelope even when it is null.
/// `deserialize_with` makes serde reject a missing field instead of silently
/// supplying `None` for it.
fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// Plaintext for the trusted authenticated encryption adapter only. Deliberately
/// has no Debug, Display, Clone, or serde implementation.
pub struct RecordPlaintext(Vec<u8>);

impl RecordPlaintext {
    /// Supply solely to the trusted authenticated encryption adapter.
    pub fn expose_for_encryption(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for RecordPlaintext {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Serialize)]
struct FrameRef<'a> {
    version: u8,
    record: RecordRef<'a>,
}

#[derive(Serialize)]
struct RecordRef<'a> {
    binding: BindingRef<'a>,
    kind: KindRef<'a>,
    app_name: &'a str,
    stable_host_id: &'a str,
    issued_client_id: Option<&'a str>,
    identity: Option<IdentityRef<'a>>,
    credentials: Option<CredentialsRef<'a>>,
    pending_authorization: Option<AttemptRef<'a>>,
    /// The existing checkpoint codec owns the representation of every variant.
    refresh_checkpoint: &'a str,
    state: StateValue,
    revocation: RevocationValue,
}

#[derive(Serialize)]
struct BindingRef<'a> {
    registration_id: &'a str,
    actor_id: &'a str,
    workspace_id: &'a str,
    home_id: &'a str,
    authority_epoch: &'a str,
    cancellation_epoch: &'a str,
}

impl<'a> From<&'a RegistrationBinding> for BindingRef<'a> {
    fn from(value: &'a RegistrationBinding) -> Self {
        Self {
            registration_id: &value.registration_id,
            actor_id: &value.actor_id,
            workspace_id: &value.workspace_id,
            home_id: &value.home_id,
            authority_epoch: &value.authority_epoch,
            cancellation_epoch: &value.cancellation_epoch,
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum KindRef<'a> {
    LocalPublicClient,
    IssuedWebsite {
        registered_callback: &'a str,
        callback_host: &'a str,
        authentication: AuthenticationValue,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AuthenticationValue {
    Public,
    IssuedSecretBasic,
}

impl From<ClientAuthentication> for AuthenticationValue {
    fn from(value: ClientAuthentication) -> Self {
        match value {
            ClientAuthentication::Public => Self::Public,
            ClientAuthentication::IssuedSecretBasic => Self::IssuedSecretBasic,
        }
    }
}

impl From<AuthenticationValue> for ClientAuthentication {
    fn from(value: AuthenticationValue) -> Self {
        match value {
            AuthenticationValue::Public => Self::Public,
            AuthenticationValue::IssuedSecretBasic => Self::IssuedSecretBasic,
        }
    }
}

#[derive(Serialize)]
struct IdentityRef<'a> {
    subject: &'a str,
    name: Option<&'a str>,
    email: Option<&'a str>,
}

#[derive(Serialize)]
struct CredentialsRef<'a> {
    id_token: Option<&'a str>,
    access_token: Option<&'a str>,
    refresh_token: Option<&'a str>,
    expires_at_ms: Option<u64>,
    granted_scopes: &'a [String],
}

#[derive(Serialize)]
struct AttemptRef<'a> {
    binding: BindingRef<'a>,
    material: MaterialRef<'a>,
    redirect_uri: &'a str,
    callback_host: &'a str,
    purpose: PurposeValue,
    client_id: &'a str,
    authentication: AuthenticationValue,
    expires_at_ms: u64,
}

#[derive(Serialize)]
struct MaterialRef<'a> {
    state: &'a str,
    nonce: &'a str,
    verifier: &'a str,
    s256_challenge: &'a str,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PurposeValue {
    Identity,
    EnablePlanUse,
}

impl From<SignInPurpose> for PurposeValue {
    fn from(value: SignInPurpose) -> Self {
        match value {
            SignInPurpose::Identity => Self::Identity,
            SignInPurpose::EnablePlanUse => Self::EnablePlanUse,
        }
    }
}

impl From<PurposeValue> for SignInPurpose {
    fn from(value: PurposeValue) -> Self {
        match value {
            PurposeValue::Identity => Self::Identity,
            PurposeValue::EnablePlanUse => Self::EnablePlanUse,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum StateValue {
    Disconnected,
    Connected,
    PlanUseDisabled,
    ReauthorizationRequired,
    ConfigurationRepairRequired,
    IdentityVerificationPending,
    RefreshUnconfirmed,
}

impl From<LifecycleState> for StateValue {
    fn from(value: LifecycleState) -> Self {
        match value {
            LifecycleState::Disconnected => Self::Disconnected,
            LifecycleState::Connected => Self::Connected,
            LifecycleState::PlanUseDisabled => Self::PlanUseDisabled,
            LifecycleState::ReauthorizationRequired => Self::ReauthorizationRequired,
            LifecycleState::ConfigurationRepairRequired => Self::ConfigurationRepairRequired,
            LifecycleState::IdentityVerificationPending => Self::IdentityVerificationPending,
            LifecycleState::RefreshUnconfirmed => Self::RefreshUnconfirmed,
        }
    }
}

impl From<StateValue> for LifecycleState {
    fn from(value: StateValue) -> Self {
        match value {
            StateValue::Disconnected => Self::Disconnected,
            StateValue::Connected => Self::Connected,
            StateValue::PlanUseDisabled => Self::PlanUseDisabled,
            StateValue::ReauthorizationRequired => Self::ReauthorizationRequired,
            StateValue::ConfigurationRepairRequired => Self::ConfigurationRepairRequired,
            StateValue::IdentityVerificationPending => Self::IdentityVerificationPending,
            StateValue::RefreshUnconfirmed => Self::RefreshUnconfirmed,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RevocationValue {
    NotRequested,
    Confirmed,
    Unconfirmed,
}

impl From<RevocationState> for RevocationValue {
    fn from(value: RevocationState) -> Self {
        match value {
            RevocationState::NotRequested => Self::NotRequested,
            RevocationState::Confirmed => Self::Confirmed,
            RevocationState::Unconfirmed => Self::Unconfirmed,
        }
    }
}

impl From<RevocationValue> for RevocationState {
    fn from(value: RevocationValue) -> Self {
        match value {
            RevocationValue::NotRequested => Self::NotRequested,
            RevocationValue::Confirmed => Self::Confirmed,
            RevocationValue::Unconfirmed => Self::Unconfirmed,
        }
    }
}

/// Encode a complete record without changing or validating its lifecycle state.
/// The returned bytes require authenticated encryption before storage.
pub fn encode(record: &RegistrationRecord) -> Result<RecordPlaintext, AiError> {
    let checkpoint_bytes = checkpoint::encode(&record.refresh_checkpoint)?;
    let checkpoint_text = std::str::from_utf8(checkpoint_bytes.expose_for_encryption())
        .map_err(|_| AiError::DomainUnavailable)?;
    let kind = match &record.kind {
        RegistrationKind::LocalPublicClient => KindRef::LocalPublicClient,
        RegistrationKind::IssuedWebsite {
            registered_callback,
            callback_host,
            authentication,
        } => KindRef::IssuedWebsite {
            registered_callback,
            callback_host,
            authentication: (*authentication).into(),
        },
    };
    let identity = record.identity.as_ref().map(|v| IdentityRef {
        subject: &v.subject,
        name: v.name.as_deref(),
        email: v.email.as_deref(),
    });
    let credentials = record.credentials.as_ref().map(|v| CredentialsRef {
        id_token: v
            .id_token
            .as_ref()
            .map(ProtectedValue::expose_in_trusted_boundary),
        access_token: v
            .access_token
            .as_ref()
            .map(ProtectedValue::expose_in_trusted_boundary),
        refresh_token: v
            .refresh_token
            .as_ref()
            .map(ProtectedValue::expose_in_trusted_boundary),
        expires_at_ms: v.expires_at_ms,
        granted_scopes: &v.granted_scopes,
    });
    let pending_authorization = record.pending_authorization.as_ref().map(|v| AttemptRef {
        binding: (&v.binding).into(),
        material: MaterialRef {
            state: v.material.state.expose_in_trusted_boundary(),
            nonce: v.material.nonce.expose_in_trusted_boundary(),
            verifier: v.material.verifier.expose_in_trusted_boundary(),
            s256_challenge: &v.material.s256_challenge,
        },
        redirect_uri: &v.redirect_uri,
        callback_host: &v.callback_host,
        purpose: v.purpose.into(),
        client_id: &v.client_id,
        authentication: v.authentication.into(),
        expires_at_ms: v.expires_at_ms,
    });
    let bytes = serde_json::to_vec(&FrameRef {
        version: VERSION,
        record: RecordRef {
            binding: (&record.binding).into(),
            kind,
            app_name: &record.app_name,
            stable_host_id: &record.stable_host_id,
            issued_client_id: record.issued_client_id.as_deref(),
            identity,
            credentials,
            pending_authorization,
            refresh_checkpoint: checkpoint_text,
            state: record.state.into(),
            revocation: record.revocation.into(),
        },
    })
    .map_err(|_| AiError::DomainUnavailable)?;
    if bytes.len() > MAX_BYTES {
        return Err(AiError::LimitReached);
    }
    Ok(RecordPlaintext(bytes))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FrameValue {
    version: u8,
    record: RecordValue,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordValue {
    binding: BindingValue,
    kind: KindValue,
    app_name: String,
    stable_host_id: String,
    #[serde(deserialize_with = "required_option")]
    issued_client_id: Option<String>,
    #[serde(deserialize_with = "required_option")]
    identity: Option<IdentityValue>,
    #[serde(deserialize_with = "required_option")]
    credentials: Option<CredentialsValue>,
    #[serde(deserialize_with = "required_option")]
    pending_authorization: Option<AttemptValue>,
    refresh_checkpoint: String,
    state: StateValue,
    revocation: RevocationValue,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BindingValue {
    registration_id: String,
    actor_id: String,
    workspace_id: String,
    home_id: String,
    authority_epoch: String,
    cancellation_epoch: String,
}

impl From<BindingValue> for RegistrationBinding {
    fn from(v: BindingValue) -> Self {
        Self {
            registration_id: v.registration_id,
            actor_id: v.actor_id,
            workspace_id: v.workspace_id,
            home_id: v.home_id,
            authority_epoch: v.authority_epoch,
            cancellation_epoch: v.cancellation_epoch,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum KindValue {
    LocalPublicClient,
    IssuedWebsite {
        registered_callback: String,
        callback_host: String,
        authentication: AuthenticationValue,
    },
}

impl From<KindValue> for RegistrationKind {
    fn from(value: KindValue) -> Self {
        match value {
            KindValue::LocalPublicClient => Self::LocalPublicClient,
            KindValue::IssuedWebsite {
                registered_callback,
                callback_host,
                authentication,
            } => Self::IssuedWebsite {
                registered_callback,
                callback_host,
                authentication: authentication.into(),
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdentityValue {
    subject: String,
    #[serde(deserialize_with = "required_option")]
    name: Option<String>,
    #[serde(deserialize_with = "required_option")]
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialsValue {
    #[serde(deserialize_with = "required_option")]
    id_token: Option<String>,
    #[serde(deserialize_with = "required_option")]
    access_token: Option<String>,
    #[serde(deserialize_with = "required_option")]
    refresh_token: Option<String>,
    #[serde(deserialize_with = "required_option")]
    expires_at_ms: Option<u64>,
    granted_scopes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttemptValue {
    binding: BindingValue,
    material: MaterialValue,
    redirect_uri: String,
    callback_host: String,
    purpose: PurposeValue,
    client_id: String,
    authentication: AuthenticationValue,
    expires_at_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MaterialValue {
    state: String,
    nonce: String,
    verifier: String,
    s256_challenge: String,
}

/// Call only on bytes already decrypted and authenticated by the trusted
/// same-registration credential boundary. Never accept browser or model input.
pub fn decode(decrypted: &[u8]) -> Result<RegistrationRecord, AiError> {
    if decrypted.len() > MAX_BYTES {
        return Err(AiError::LimitReached);
    }
    let frame: FrameValue =
        serde_json::from_slice(decrypted).map_err(|_| AiError::DomainUnavailable)?;
    if frame.version != VERSION {
        return Err(AiError::DomainUnavailable);
    }
    let v = frame.record;
    let credentials = v
        .credentials
        .map(|c| -> Result<SavedCredentials, AiError> {
            Ok(SavedCredentials {
                id_token: c
                    .id_token
                    .map(ProtectedValue::from_trusted_adapter)
                    .transpose()?,
                access_token: c
                    .access_token
                    .map(ProtectedValue::from_trusted_adapter)
                    .transpose()?,
                refresh_token: c
                    .refresh_token
                    .map(ProtectedValue::from_trusted_adapter)
                    .transpose()?,
                expires_at_ms: c.expires_at_ms,
                granted_scopes: c.granted_scopes,
            })
        })
        .transpose()?;
    let pending_authorization = v
        .pending_authorization
        .map(|a| -> Result<AuthorizationAttempt, AiError> {
            Ok(AuthorizationAttempt {
                binding: a.binding.into(),
                material: FreshAuthorization {
                    state: ProtectedValue::from_trusted_adapter(a.material.state)?,
                    nonce: ProtectedValue::from_trusted_adapter(a.material.nonce)?,
                    verifier: ProtectedValue::from_trusted_adapter(a.material.verifier)?,
                    s256_challenge: a.material.s256_challenge,
                },
                redirect_uri: a.redirect_uri,
                callback_host: a.callback_host,
                purpose: a.purpose.into(),
                client_id: a.client_id,
                authentication: a.authentication.into(),
                expires_at_ms: a.expires_at_ms,
            })
        })
        .transpose()?;
    let refresh_checkpoint: RefreshCheckpoint =
        checkpoint::decode(v.refresh_checkpoint.as_bytes())?;
    // Version 1 stores the exact original codec output. Requiring that complete
    // frame also prevents its optional reply members from being silently absent.
    // This is format validation after authentication, never authentication itself.
    let complete_checkpoint = checkpoint::encode(&refresh_checkpoint)?;
    if complete_checkpoint.expose_for_encryption() != v.refresh_checkpoint.as_bytes() {
        return Err(AiError::DomainUnavailable);
    }
    Ok(RegistrationRecord {
        binding: v.binding.into(),
        kind: v.kind.into(),
        app_name: v.app_name,
        stable_host_id: v.stable_host_id,
        issued_client_id: v.issued_client_id,
        identity: v.identity.map(|i| VerifiedIdentity {
            subject: i.subject,
            name: i.name,
            email: i.email,
        }),
        credentials,
        pending_authorization,
        refresh_checkpoint,
        state: v.state.into(),
        revocation: v.revocation.into(),
    })
}
