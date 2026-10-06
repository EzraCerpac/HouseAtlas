use super::{
    AiError, CancelReceipt, Cancellation, ConnectionSnapshot, InferenceOutcome, ProviderDiagnostic,
    ResponsesRequest, RuntimeSnapshot, ToolCall, ToolDescriptor, Usage,
};
use super::{
    ToolEffect,
    runner::AiCheckpoint,
    stock::{DomainDispatch, ReviewChallenge},
};
use serde_json::Value;
use std::{future::Future, pin::Pin};

pub type PortFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, AiError>> + Send + 'a>>;

/// Read a scoped runtime observation without starting or waking any host. The
/// connection adapter may compose this port when constructing its snapshot.
pub trait RuntimePort<C> {
    fn status<'a>(
        &'a self,
        context: &'a C,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, RuntimeSnapshot>;
}

/// C is the peer's opaque, current server authorization context. No Serialize or
/// Clone bound is imposed and context never enters provider request JSON.
pub trait ConnectionPort<C> {
    /// Recheck selected account, direct scope, eligibility, current model slug
    /// and runtime. Identity or a cached model listing alone is insufficient.
    fn check<'a>(
        &'a self,
        context: &'a C,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot>;
}

pub trait InferencePort<C> {
    /// Credentials are owned by the adapter. Enforce stream/body/deadline bounds,
    /// observe cancel during I/O, preserve output items and await response.completed.
    /// Known admission/terminal failures use Failed with diagnostic fields;
    /// local interruption uses Stopped. Err ProviderUnavailable is reserved
    /// for unresolved transport uncertainty. Never report successful deltas.
    fn infer<'a>(
        &'a self,
        context: &'a C,
        request_id: &'a str,
        request: &'a ResponsesRequest,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, InferenceOutcome>;
}

pub trait CancelPort<C> {
    /// Host binds request_id to current context before forwarding. Requested ACK
    /// differs from terminal confirmation; SIWC HTTP has no background cancel.
    fn cancel<'a>(&'a self, context: &'a C, request_id: &'a str) -> PortFuture<'a, CancelReceipt>;
}

pub trait DomainCatalog<C> {
    type Prepared: Send + Sync;
    /// Only tools authorized for current C; source schemas come from the shared
    /// domain catalog. Source refresh/diagnostic/write tools require review.
    fn tools(&self, context: &C) -> Result<Vec<ToolDescriptor>, AiError>;
    /// Resolve exact stock wire3 command arm and effect using the shared typed
    /// validator and current server actor/home. Family-level effects are invalid.
    fn prepare(&self, context: &C, call: &ToolCall) -> Result<Self::Prepared, AiError>;
    fn effect(&self, prepared: &Self::Prepared) -> ToolEffect;
    /// Preparing intent neither issues approval nor submits a mutation.
    fn review<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>>;
    /// Revalidate context and exact result schema/correlation before disclosure.
    /// Keep history arrays and authorized resource targets intact.
    fn execute_read<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Value>;
    /// Uses only the shared service's separate trusted-human approval record.
    /// Revalidates immutable intent, rights/epochs, impact and receipt at dispatch;
    /// uses the existing durable dispatcher. Never blindly replays unknown work.
    fn execute_reviewed<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch>;
}

/// Host storage binds checkpoints to actor/home/provider registration and epoch.
/// No checkpoint/history/approval receipt is serialized to browser or model.
pub trait ReviewContinuationPort<C, P> {
    fn retain<'a>(
        &'a self,
        context: &'a C,
        checkpoint: AiCheckpoint<P>,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, String>;
    /// Atomically claim once, only after the separate trusted review UI is ready.
    /// Check current authority, expiry and every pending review before returning.
    fn claim<'a>(
        &'a self,
        context: &'a C,
        continuation_id: &'a str,
        request_id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, AiCheckpoint<P>>;
}

pub trait UsagePort<C> {
    /// Exactly one observation for each terminal inference round, not a cost or
    /// an audit receipt. The host decides private retention; unknown stays null.
    fn observed(&self, context: &C, request_id: &str, usage: Usage);
    /// Preserve structured provider evidence privately, without raw content.
    fn provider_failed(&self, context: &C, request_id: &str, diagnostic: &ProviderDiagnostic);
    /// Durably retain each dispatch before a later call can fail. Preserve exact
    /// validated effects/verification/activity in scoped host request status.
    fn domain_observed(
        &self,
        context: &C,
        request_id: &str,
        dispatch: &DomainDispatch,
    ) -> Result<(), AiError>;
}
