use serde::{Deserialize, Serialize};

pub const DIRECT_USAGE_SCOPE: &str = "chatgpt.tokens.use.direct";
pub const RESPONSES_ENDPOINT: &str = "https://api.openai.com/v1/responses";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionMethod {
    SignInWithChatgpt,
    ApiKey,
    LocalRuntime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Eligibility {
    Unknown,
    Eligible,
    Ineligible,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InferencePermission {
    Unknown,
    Granted,
    Denied,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorizationState {
    Unconfigured,
    SignInRequired,
    Connected,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeKind {
    Hosted,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeAvailability {
    Unknown,
    Ready,
    Sleeping,
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeSnapshot {
    pub kind: RuntimeKind,
    pub availability: RuntimeAvailability,
    /// Observation time, never a promise of permanent availability.
    pub checked_at: Option<String>,
}

/// Credential-free display data supplied by a trusted connection adapter.
/// Identity-only SIWC must not be represented as eligible plan usage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionSnapshot {
    pub method: ConnectionMethod,
    /// Granted SIWC permission requires the validated direct-use OAuth scope.
    /// Identity-only sign-in is insufficient; no consumer tier is assumed.
    pub permission: InferencePermission,
    pub eligibility: Eligibility,
    pub authorization: AuthorizationState,
    pub runtime: RuntimeSnapshot,
    pub usage_supported: bool,
}

impl ConnectionSnapshot {
    pub fn can_infer(&self) -> bool {
        let permitted = match self.method {
            ConnectionMethod::SignInWithChatgpt => self.permission == InferencePermission::Granted,
            _ => matches!(
                self.permission,
                InferencePermission::Granted | InferencePermission::NotApplicable
            ),
        };
        permitted
            && self.eligibility != Eligibility::Ineligible
            && self.authorization == AuthorizationState::Connected
            && self.runtime.availability == RuntimeAvailability::Ready
    }
}
