//! Native HostPeers consumers over the actual encrypted/HTTP and shared owners.
use super::{
    authority::StartupAuthority,
    credentials::StartupCredentials,
    environment::{NativeConnection, NativeEnvironment},
    provider::NativeOAuthProvider,
    security::NativeSecurity,
    selection::{ModelSelection, NativeModels},
};
use crate::ai::{
    AiError, Cancellation, PortFuture,
    host::{
        continuation::{ExactReviewReady, HostContinuations},
        lifecycle::{ConnectionFacts, LifecycleHost},
        native::NativeHostContext,
        service::HostPeers,
    },
    runner::AiCheckpoint,
    runtime::{
        ConnectionActionPort, ConnectionActionRequest, ConnectionActionResult, HumanReviewPort,
        HumanReviewResult, ReviewInput,
    },
    stock::{AcceptedStockCommand, SharedStockPort, StockCatalog},
    transport::ResponsesAdapter,
};
use std::sync::Arc;

pub struct OriginalReview<R>(pub(super) Arc<R>);
impl<R> Clone for OriginalReview<R> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}
impl<R, P> ExactReviewReady<NativeHostContext, P> for OriginalReview<R>
where
    R: ExactReviewReady<NativeHostContext, P>,
{
    fn ready(&self, c: &NativeHostContext, checkpoint: &AiCheckpoint<P>) -> Result<(), AiError> {
        self.0.ready(c, checkpoint)
    }
}
impl<R: HumanReviewPort<NativeHostContext> + Send + Sync> HumanReviewPort<NativeHostContext>
    for OriginalReview<R>
{
    fn open<'a>(
        &'a self,
        c: &'a NativeHostContext,
        input: &'a ReviewInput,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, HumanReviewResult> {
        self.0.open(c, input, cancel)
    }
}
pub type NativeLifecycle<O> =
    LifecycleHost<NativeSecurity, NativeOAuthProvider, StartupCredentials, NativeEnvironment<O>>;
pub struct NativeActions<O>(pub(super) Arc<NativeLifecycle<O>>);
impl<O: ConnectionFacts<NativeHostContext>> ConnectionActionPort<NativeHostContext>
    for NativeActions<O>
{
    fn act<'a>(
        &'a self,
        c: &'a NativeHostContext,
        input: &'a ConnectionActionRequest,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionActionResult> {
        self.0.act(c, input, cancel)
    }
    fn status<'a>(
        &'a self,
        c: &'a NativeHostContext,
        id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionActionResult> {
        self.0.status(c, id, cancel)
    }
}
pub struct NativeHostPeers<O, D: SharedStockPort<NativeHostContext>, R> {
    pub(super) connection: NativeConnection<O>,
    pub(super) inference:
        ResponsesAdapter<crate::ai::host::transport::HttpResponses<NativeConnection<O>>>,
    pub(super) catalog: StockCatalog<D>,
    pub(super) continuations:
        HostContinuations<StartupAuthority, OriginalReview<R>, AcceptedStockCommand<D::Prepared>>,
    pub(super) human: OriginalReview<R>,
    pub(super) actions: NativeActions<O>,
    pub(super) models: NativeModels,
    pub(super) selection: ModelSelection,
    pub(super) authority: StartupAuthority,
}
impl<O, D, R> HostPeers for NativeHostPeers<O, D, R>
where
    O: ConnectionFacts<NativeHostContext>,
    D: SharedStockPort<NativeHostContext> + Send + Sync,
    D::Prepared: Send + Sync,
    R: ExactReviewReady<NativeHostContext, AcceptedStockCommand<D::Prepared>>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync,
{
    type Context = NativeHostContext;
    type Connection = NativeConnection<O>;
    type Inference =
        ResponsesAdapter<crate::ai::host::transport::HttpResponses<NativeConnection<O>>>;
    type Catalog = StockCatalog<D>;
    type Continuations =
        HostContinuations<StartupAuthority, OriginalReview<R>, AcceptedStockCommand<D::Prepared>>;
    type Human = OriginalReview<R>;
    type Actions = NativeActions<O>;
    type Models = NativeModels;
    fn connection(&self) -> &Self::Connection {
        &self.connection
    }
    fn inference(&self) -> &Self::Inference {
        &self.inference
    }
    fn catalog(&self) -> &Self::Catalog {
        &self.catalog
    }
    fn continuations(&self) -> &Self::Continuations {
        &self.continuations
    }
    fn human(&self) -> &Self::Human {
        &self.human
    }
    fn actions(&self) -> &Self::Actions {
        &self.actions
    }
    fn models(&self) -> &Self::Models {
        &self.models
    }
    fn selected_model(&self, context: &Self::Context) -> Result<String, AiError> {
        self.selection.selected(&self.authority, context)
    }
}
