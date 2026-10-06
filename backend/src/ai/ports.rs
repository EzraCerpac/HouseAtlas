use super::{
    AiError, CancelReceipt, Cancellation, ConnectionSnapshot, InferenceOutcome, ProviderDiagnostic,
    ResponsesRequest, RuntimeSnapshot, ToolCall, ToolDescriptor, Usage,
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
    /// Only tools authorized for current C; source schemas come from the shared
    /// domain catalog. Source refresh/diagnostic/write tools require review.
    fn tools(&self, context: &C) -> Result<Vec<ToolDescriptor>, AiError>;
    /// Revalidate C and call arguments against shared contracts immediately at
    /// dispatch. Keep scoped reads, history ordering/arrays, source status and
    /// mutation preconditions intact. AI supplies no route, actor or grant.
    fn execute_read<'a>(
        &'a self,
        context: &'a C,
        call: &'a ToolCall,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Value>;
}

pub trait UsagePort<C> {
    /// Exactly one observation for each terminal inference round, not a cost or
    /// an audit receipt. The host decides private retention; unknown stays null.
    fn observed(&self, context: &C, request_id: &str, usage: Usage);
    /// Preserve structured provider evidence privately, without raw content.
    fn provider_failed(&self, context: &C, request_id: &str, diagnostic: &ProviderDiagnostic);
}
