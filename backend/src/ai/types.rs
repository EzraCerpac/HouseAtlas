use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiError {
    ConnectionUnavailable,
    InvalidInput,
    InvalidCatalog,
    InvalidProviderOutput,
    UnknownTool,
    LimitReached,
    CancelRequested,
    ProviderUnavailable,
    UsageLimitReached,
    DomainUnavailable,
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::ConnectionUnavailable => "AI connection unavailable",
            Self::InvalidInput => "Invalid AI input",
            Self::InvalidCatalog => "AI tool catalog unavailable",
            Self::InvalidProviderOutput => "AI response incomplete or invalid",
            Self::UnknownTool => "AI tool unavailable",
            Self::LimitReached => "AI request limit reached",
            Self::CancelRequested => "AI stop requested",
            Self::ProviderUnavailable => "AI runtime unavailable",
            Self::UsageLimitReached => "AI usage limit reached",
            Self::DomainUnavailable => "Atlas operation unavailable",
        })
    }
}
impl std::error::Error for AiError {}

/// Host retains this handle per authorized request; adapters must observe it
/// while awaiting I/O. This flag requests a stop and proves no provider outcome.
#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub fn request(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_requested(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
    pub fn checkpoint(&self) -> Result<(), AiError> {
        if self.is_requested() {
            Err(AiError::CancelRequested)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolEffect {
    Read,
    RequiresReview,
}

/// A projection of the shared catalog, never an independent AI domain catalog.
#[derive(Debug, Clone)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCall {
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}
impl Usage {
    /// Unknown measurements remain unknown; no zero/cost estimate is invented.
    pub fn accumulate(&mut self, next: Self, first: bool) {
        fn sum(a: Option<u64>, b: Option<u64>, first: bool) -> Option<u64> {
            if first {
                b
            } else {
                a.zip(b).and_then(|(a, b)| a.checked_add(b))
            }
        }
        self.input_tokens = sum(self.input_tokens, next.input_tokens, first);
        self.output_tokens = sum(self.output_tokens, next.output_tokens, first);
        self.total_tokens = sum(self.total_tokens, next.total_tokens, first);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum RunOutcome {
    Completed {
        text: String,
        usage: Usage,
    },
    ReviewRequired {
        calls: Vec<ToolCall>,
        #[serde(rename = "continuationId")]
        continuation_id: String,
        reviews: Vec<super::stock::ReviewChallenge>,
        usage: Usage,
    },
    DomainHeld {
        #[serde(rename = "operationId")]
        operation_id: Option<String>,
        /// Ordered, deduplicated correlations for all dispatches already
        /// observed in this request, including the current held operation.
        #[serde(rename = "operationIds", default)]
        operation_ids: Vec<String>,
        state: super::stock::DomainDispatchState,
        usage: Usage,
    },
    Cancelled {
        usage: Usage,
    },
    /// Local processing stopped; upstream completion is unconfirmed.
    Stopped {
        usage: Usage,
    },
    Failed {
        reason: AiError,
        #[serde(rename = "operationIds")]
        operation_ids: Vec<String>,
        usage: Usage,
    },
}

/// Internal, bounded, credential-free structured provider evidence. Preserve
/// exact machine-readable fields, excluding raw bodies, headers and contents.
/// The transport bounds these fields. No browser serialization is provided.
#[derive(Debug, Clone)]
pub struct ProviderDiagnostic {
    pub http_status: Option<u16>,
    pub code: Option<String>,
    pub parameter: Option<String>,
    pub request_id: Option<String>,
}

/// Only unresolved provider/transport failures use the rejected result channel.
#[derive(Debug, Clone)]
pub struct UnconfirmedRun {
    pub reason: AiError,
    pub usage: Usage,
}
impl std::fmt::Display for UnconfirmedRun {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.reason.fmt(f)
    }
}
impl std::error::Error for UnconfirmedRun {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CancelStatus {
    Requested,
    Confirmed,
    AlreadyFinished,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelReceipt {
    pub request_id: String,
    pub status: CancelStatus,
}

/// Internal response after the adapter has consumed a terminal provider event.
/// Partial deltas must never construct Completed. Preserve all reasoning and
/// function-call output items for explicit HTTP continuation.
#[derive(Debug, Clone)]
pub enum InferenceOutcome {
    Completed {
        output: Vec<Value>,
        usage: Usage,
    },
    Cancelled {
        usage: Usage,
    },
    Stopped {
        usage: Usage,
    },
    /// Submitted inference has no observed terminal. Local protocol/limit
    /// failure is not proof that the provider stopped processing the request.
    Unresolved {
        reason: AiError,
        usage: Usage,
        diagnostic: ProviderDiagnostic,
    },
    /// Known terminal/admission failure; never a successful partial delta.
    Failed {
        reason: AiError,
        usage: Usage,
        diagnostic: ProviderDiagnostic,
    },
}

/// Browser request identifiers and prompt text confer no actor/home authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunInput {
    pub request_id: String,
    pub prompt: String,
}
