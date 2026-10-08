//! Concrete account-only observation of the original encrypted SIWC session.
//!
//! The accepted lifecycle has already validated the ID token's signature,
//! issuer, issued-client audience and nonce before storing VerifiedIdentity.
//! This consumer reads that same authenticated record under its original native
//! authority/credential lease; it never reparses an unverified token or calls a
//! provider. `sub` identifies the account, never its ChatGPT workspace.
//!
//! The shared ConnectionSnapshot requires a workspace in AccountDisplay. Until
//! an independent original workspace source exists, its `account` stays None.
//! NativeAccountObservation separately exposes the real account-only identity.
//! Eligibility, runtime qualification/availability and paid admission stay held
//! or unknown, so neither this observation nor consent can authorize inference.
use super::{
    authority::StartupAuthority, credentials::StartupCredentials, environment::held_snapshot,
};
use crate::ai::{
    AiError, AuthorizationState, Cancellation, ConnectionSnapshot, InferencePermission, PortFuture,
    host::{HostAuthority, lifecycle::ConnectionFacts, native::NativeHostContext},
    oauth::{
        CredentialBoundary, LifecycleState, RefreshCheckpoint, RegistrationKind, RegistrationRecord,
    },
};
use serde::Serialize;

/// Credential-free display data from a stored, previously validated ID token.
/// Private construction and no Deserialize keep request JSON out of this
/// provenance path. Serialized copies are correlation data, never authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccountIdentity {
    account_id: String,
    label: String,
}
impl NativeAccountIdentity {
    pub fn account_id(&self) -> &str {
        &self.account_id
    }
    pub fn label(&self) -> &str {
        &self.label
    }
}

/// A local credential-record observation, independent of model selection.
/// observedAt timestamps this local read; it is not a provider freshness claim.
/// An identity may be retained with Expired authorization: the old validated
/// subject identifies the account but supplies no current credential grant.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccountObservation {
    account_identity: Option<NativeAccountIdentity>,
    connection: ConnectionSnapshot,
    observed_at: String,
}
impl NativeAccountObservation {
    pub fn account_identity(&self) -> Option<&NativeAccountIdentity> {
        self.account_identity.as_ref()
    }
    pub fn connection(&self) -> &ConnectionSnapshot {
        &self.connection
    }
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
}

/// Actual account-only ConnectionFacts consumer. Only startup constructs it
/// from the same authority and encrypted-store allocations used by lifecycle,
/// discovery and Responses. It has no store/configuration or token fallback.
#[derive(Clone)]
pub struct NativeAccountFacts {
    authority: StartupAuthority,
    credentials: StartupCredentials,
}
impl NativeAccountFacts {
    pub(super) fn new(authority: StartupAuthority, credentials: StartupCredentials) -> Self {
        Self {
            authority,
            credentials,
        }
    }

    /// Called only while the existing environment/StoredSession retains the
    /// original credential lease. Do not reacquire the same lease from here.
    pub(super) fn project(
        &self,
        context: &NativeHostContext,
        record: &RegistrationRecord,
    ) -> Result<NativeAccountObservation, AiError> {
        self.authority.revalidate(context, &record.binding)?;
        let config = &self.authority.configuration;
        if record.kind != RegistrationKind::LocalPublicClient
            || record.app_name != config.app_name()
            || record.stable_host_id != config.stable_host_id()
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let registration = config.registration(&record.binding)?;
        let now = self.credentials.now_ms()?;
        let mut connection = held_snapshot(None);
        // Pending/ambiguous rotations and unfinished authorization cannot make
        // old identity or token material an active account observation.
        let settled = matches!(
            record.state,
            LifecycleState::Connected | LifecycleState::PlanUseDisabled
        ) && record.pending_authorization.is_none()
            && matches!(record.refresh_checkpoint, RefreshCheckpoint::None);
        let client_present = record.issued_client_id.as_deref().is_some_and(|id| {
            !id.is_empty()
                && id.len() <= 200
                && id != "dynamic_agent_client"
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        });
        let identity = record.identity.as_ref().filter(|identity| {
            !identity.subject.is_empty()
                && identity.subject.len() <= 1024
                && !identity.subject.chars().any(char::is_control)
        });
        let stored = record
            .credentials
            .as_ref()
            .filter(|credentials| credentials.id_token.is_some());
        let account_identity = match (settled && client_present, identity, stored) {
            (true, Some(identity), Some(credentials)) => {
                // A stored ID token establishes only account identity. Current
                // authorization additionally needs the actual saved access
                // credential and its known unexpired receipt-bound lifetime.
                connection.authorization =
                    match (credentials.access_token.as_ref(), credentials.expires_at_ms) {
                        (Some(_), Some(expiry)) if now < expiry => AuthorizationState::Connected,
                        (Some(_), Some(_)) => AuthorizationState::Expired,
                        _ => AuthorizationState::SignInRequired,
                    };
                if connection.authorization == AuthorizationState::Connected {
                    connection.permission = if record.state == LifecycleState::Connected
                        && credentials
                            .granted_scopes
                            .iter()
                            .any(|scope| scope == crate::ai::DIRECT_USAGE_SCOPE)
                    {
                        InferencePermission::Granted
                    } else {
                        InferencePermission::Denied
                    };
                }
                Some(NativeAccountIdentity {
                    account_id: identity.subject.clone(),
                    // The configured label or original registration ID is
                    // application display metadata, not a provider claim.
                    label: registration
                        .account_label()
                        .unwrap_or(&record.binding.registration_id)
                        .to_owned(),
                })
            }
            _ => None,
        };
        let observed_at =
            time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(now) * 1_000_000)
                .map_err(|_| AiError::ConnectionUnavailable)?
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|_| AiError::ConnectionUnavailable)?;
        self.authority.revalidate(context, &record.binding)?;
        Ok(NativeAccountObservation {
            account_identity,
            connection,
            observed_at,
        })
    }

    pub(super) fn read_current<'a>(
        &'a self,
        context: &'a NativeHostContext,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, NativeAccountObservation> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            let lease = self.credentials.acquire(context, &binding).await?;
            let record = self.credentials.load(&lease).await?;
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            cancel.checkpoint()?;
            // Projection uses the current clock after the last await. The same
            // exclusive encrypted lease is still retained through this return.
            let observation = self.project(context, &record)?;
            cancel.checkpoint()?;
            Ok(observation)
        })
    }
}
impl ConnectionFacts<NativeHostContext> for NativeAccountFacts {
    fn observe<'a>(
        &'a self,
        context: &'a NativeHostContext,
        record: &'a RegistrationRecord,
        _: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let observation = self.project(context, record)?;
            cancel.checkpoint()?;
            Ok(observation.connection)
        })
    }
}
