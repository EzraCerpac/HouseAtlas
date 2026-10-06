//! Application boundary DTOs and trusted-runtime admission interfaces. These
//! ports install no listener, acquire no grant and select no live runtime.
use super::{AiError, Cancellation, ConnectionSnapshot, PortFuture, RunOutcome, RuntimeRoute};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ConnectionAction {
    Connect { route: RuntimeRoute },
    Consent,
    Disconnect,
    ManageUsage,
}
impl ConnectionAction {
    pub fn validate(&self) -> Result<(), AiError> {
        if matches!(
            self,
            Self::Connect {
                route: RuntimeRoute::Unset
            }
        ) {
            Err(AiError::InvalidInput)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionActionStatus {
    Completed,
    Pending,
    Unconfirmed,
}

/// Correlation is captured before submission and bound to the scoped actor,
/// registration and original command by the host. It supplies no authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionActionRequest {
    pub action_id: String,
    pub command: ConnectionAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionActionResult {
    pub action_id: String,
    /// End of this workflow does not establish grant or runtime readiness.
    pub status: ConnectionActionStatus,
    pub snapshot: ConnectionSnapshot,
}

pub trait ConnectionActionPort<C> {
    /// Explicit scoped human action. Connect selects a candidate, not qualified
    /// credential placement; consent cannot issue a paid-use approval. Manage
    /// usage opens a provider-supported host action without changing billing.
    /// Disconnect immediately stops local use; failed revocation stays visible.
    fn act<'a>(
        &'a self,
        context: &'a C,
        request: &'a ConnectionActionRequest,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionActionResult>;
    /// Read the original scoped action. Never submit or replay from a lookup.
    /// Echo its exact ID; an unavailable lookup cannot establish completion.
    fn status<'a>(
        &'a self,
        context: &'a C,
        action_id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionActionResult>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case", deny_unknown_fields)]
pub enum RequestStatus {
    Running {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Unconfirmed {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Finished {
        #[serde(rename = "requestId")]
        request_id: String,
        outcome: RunOutcome,
    },
}

pub trait RequestStatusPort<C> {
    /// Authoritative scoped status, including retained domain operations and
    /// submitted inference uncertainty. A poll never resubmits an operation.
    fn status<'a>(
        &'a self,
        context: &'a C,
        request_id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, RequestStatus>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    pub request_id: String,
    pub continuation_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HumanReviewStatus {
    Pending,
    Closed,
    ReadyToResume,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HumanReviewResult {
    pub status: HumanReviewStatus,
}

pub trait HumanReviewPort<C> {
    /// Opens the separate trusted human UI. Its own server record owns approval;
    /// claim() independently verifies that record before any resumed dispatch.
    /// Models and this input cannot supply approval receipts or changed payloads.
    fn open<'a>(
        &'a self,
        context: &'a C,
        input: &'a ReviewInput,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, HumanReviewResult>;
}

/// Credential-free model discovery observation, separate from a completed
/// inference or runtime/grant qualification. Slugs are account-specific.
#[derive(Debug, Clone)]
pub struct AccountModels {
    pub registration_id: String,
    pub checked_at: String,
    pub model_slugs: Vec<String>,
}
pub trait ModelsPort<C> {
    fn discover<'a>(
        &'a self,
        context: &'a C,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, AccountModels>;
}

/// Captured only after application authentication and bridge admission. It is
/// not browser/model-serializable and confers no SIWC or paid-use permission.
pub struct RuntimeTurnBinding {
    pub actor_id: String,
    pub workspace_id: String,
    pub home_id: String,
    pub registration_id: String,
    pub cancellation_epoch: String,
    pub request_id: String,
}
pub struct BridgeRequest<'a> {
    pub origin: &'a str,
    pub host: &'a str,
    pub installation_capability: &'a super::oauth::ProtectedValue,
    pub registration_id: &'a str,
    pub request_id: &'a str,
    pub cancellation_epoch: &'a str,
}
pub trait RuntimeBridgePort<C> {
    /// Require exact approved server Origin and loopback Host, constant-time
    /// per-install capability validation, current actor/home/registration/epoch
    /// and bounded request validation. No wildcard CORS or LAN listener. Mobile
    /// relay, secure-context behavior and permanent companion choice stay held.
    fn admit(
        &self,
        context: &C,
        request: &BridgeRequest<'_>,
    ) -> Result<RuntimeTurnBinding, AiError>;
}
