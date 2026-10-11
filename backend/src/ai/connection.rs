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

/// Candidate placement is not a live runtime selection or grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeRoute {
    Unset,
    LocalSignInHelper,
    IssuedWebsiteClient,
    LocalInferenceCompanion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeQualification {
    Held,
    Qualified,
}

/// Trusted admission, independently checked for the selected registration.
/// No model/browser request can approve credit spending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaidUseAdmission {
    Held,
    VerifiedZeroPaidUse,
    ExplicitSpendApproval,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountDisplay {
    pub account_id: String,
    pub workspace_id: String,
    pub label: String,
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
    pub route: RuntimeRoute,
    pub qualification: RuntimeQualification,
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
    pub account: Option<AccountDisplay>,
    pub paid_use_admission: PaidUseAdmission,
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
            && self.account.is_some()
            && self.paid_use_admission != PaidUseAdmission::Held
            && self.runtime.route != RuntimeRoute::Unset
            && self.runtime.qualification == RuntimeQualification::Qualified
            && self.runtime.availability == RuntimeAvailability::Ready
    }
}
