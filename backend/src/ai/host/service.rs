//! Actual host execution of the accepted runner and exact user-review continuation.
use super::{
    HostAuthority,
    status::{RequestMeter, StatusJournal},
};
use crate::ai::{
    AiError, AiRunner, CancelPort, CancelReceipt, Cancellation, ConnectionPort, DomainCatalog,
    InferencePort, PortFuture, ReviewContinuationPort, RunInput, RunLimits,
    runtime::{
        ConnectionActionPort, ConnectionActionRequest, HumanReviewPort, ModelsPort, ReviewInput,
    },
};
use serde_json::{Value, json};
use std::sync::atomic::AtomicBool;

/// Peers are the one existing application composition. In particular Catalog
/// and Continuations must retain original native authority and trusted human
/// review; this host does not issue approval or reconstruct prepared commands.
pub trait HostPeers: Send + Sync {
    type Context: Send + Sync;
    type Connection: ConnectionPort<Self::Context> + Sync;
    type Inference: InferencePort<Self::Context> + Sync;
    type Catalog: DomainCatalog<Self::Context> + Sync;
    type Continuations: ReviewContinuationPort<
            Self::Context,
            <Self::Catalog as DomainCatalog<Self::Context>>::Prepared,
        > + Sync;
    type Human: HumanReviewPort<Self::Context> + Sync;
    type Actions: ConnectionActionPort<Self::Context> + Sync;
    type Models: ModelsPort<Self::Context> + Sync;
    fn connection(&self) -> &Self::Connection;
    fn inference(&self) -> &Self::Inference;
    fn catalog(&self) -> &Self::Catalog;
    fn continuations(&self) -> &Self::Continuations;
    fn human(&self) -> &Self::Human;
    fn actions(&self) -> &Self::Actions;
    fn models(&self) -> &Self::Models;
    /// Current account-specific setting resolved on the server, never a model
    /// slug chosen by an HTTP argument or a presumed consumer subscription tier.
    fn selected_model(&self, context: &Self::Context) -> Result<String, AiError>;
}

pub enum HostCommand {
    Run(RunInput),
    Resume(ReviewInput),
    Review(ReviewInput),
    Status(String),
    Cancel(String),
    Connection,
    Models,
    Action(ConnectionActionRequest),
    ActionStatus(String),
}
impl HostCommand {
    pub fn mutating(&self) -> bool {
        matches!(
            self,
            Self::Run(_) | Self::Resume(_) | Self::Review(_) | Self::Cancel(_) | Self::Action(_)
        )
    }
}
pub trait HostApi: Send + Sync {
    type Context: Send + Sync;
    fn call<'a>(
        &'a self,
        context: &'a Self::Context,
        command: HostCommand,
    ) -> PortFuture<'a, Value>;
}

pub struct AiHost<P, A> {
    pub peers: P,
    pub authority: A,
    pub journal: StatusJournal,
    pub limits: RunLimits,
}
impl<P: HostPeers, A: HostAuthority<P::Context>> HostApi for AiHost<P, A> {
    type Context = P::Context;
    fn call<'a>(&'a self, context: &'a P::Context, command: HostCommand) -> PortFuture<'a, Value> {
        Box::pin(async move {
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            let value = match command {
                HostCommand::Run(input) => {
                    let model = self.peers.selected_model(context)?;
                    let active = self.journal.begin(&binding, &input.request_id, None)?;
                    let id = input.request_id.clone();
                    let meter = RequestMeter {
                        journal: &self.journal,
                        binding: &binding,
                        cancel: &active.cancel,
                        failed: AtomicBool::new(false),
                    };
                    let runner = AiRunner {
                        connection: self.peers.connection(),
                        inference: self.peers.inference(),
                        catalog: self.peers.catalog(),
                        usage: &meter,
                        continuations: self.peers.continuations(),
                    };
                    let result = runner
                        .run(context, &model, input, &active.cancel, self.limits)
                        .await;
                    if !meter.healthy() {
                        return Err(AiError::DomainUnavailable);
                    }
                    if let Err(unconfirmed) = &result {
                        self.journal.append(
                            &binding,
                            &id,
                            "unconfirmed-run",
                            json!({"reason":unconfirmed.reason,"usage":unconfirmed.usage}),
                        )?;
                    }
                    self.journal.finish(&binding, &id, result.as_ref().ok())?;
                    self.authority.revalidate(context, &binding)?;
                    match result {
                        Ok(outcome) => json!(outcome),
                        Err(_) => return Err(AiError::ProviderUnavailable),
                    }
                }
                HostCommand::Resume(input) => {
                    self.journal.review_allowed(
                        &binding,
                        &input.request_id,
                        &input.continuation_id,
                    )?;
                    let human = self
                        .peers
                        .human()
                        .open(context, &input, &Cancellation::default())
                        .await?;
                    if !matches!(
                        human.status,
                        crate::ai::runtime::HumanReviewStatus::ReadyToResume
                    ) {
                        return Err(AiError::DomainUnavailable);
                    }
                    let active = self.journal.begin(
                        &binding,
                        &input.request_id,
                        Some(&input.continuation_id),
                    )?;
                    let meter = RequestMeter {
                        journal: &self.journal,
                        binding: &binding,
                        cancel: &active.cancel,
                        failed: AtomicBool::new(false),
                    };
                    let runner = AiRunner {
                        connection: self.peers.connection(),
                        inference: self.peers.inference(),
                        catalog: self.peers.catalog(),
                        usage: &meter,
                        continuations: self.peers.continuations(),
                    };
                    // Original checkpoint claim owns human readiness, immutable
                    // intent and epochs. Browser supplies only these two IDs.
                    let result = runner
                        .resume(
                            context,
                            &input.request_id,
                            &input.continuation_id,
                            &active.cancel,
                        )
                        .await;
                    if !meter.healthy() {
                        return Err(AiError::DomainUnavailable);
                    }
                    if let Err(unconfirmed) = &result {
                        self.journal.append(
                            &binding,
                            &input.request_id,
                            "unconfirmed-run",
                            json!({"reason":unconfirmed.reason,"usage":unconfirmed.usage}),
                        )?;
                    }
                    self.journal
                        .finish(&binding, &input.request_id, result.as_ref().ok())?;
                    self.authority.revalidate(context, &binding)?;
                    match result {
                        Ok(outcome) => json!(outcome),
                        Err(_) => return Err(AiError::ProviderUnavailable),
                    }
                }
                HostCommand::Review(input) => {
                    self.journal.review_allowed(
                        &binding,
                        &input.request_id,
                        &input.continuation_id,
                    )?;
                    json!(
                        self.peers
                            .human()
                            .open(context, &input, &Cancellation::default())
                            .await?
                    )
                }
                HostCommand::Status(id) => json!(self.journal.read(&binding, &id, true)?),
                HostCommand::Cancel(id) => json!(self.journal.stop(&binding, &id)?),
                HostCommand::Connection => {
                    let model = self.peers.selected_model(context)?;
                    json!(
                        self.peers
                            .connection()
                            .check(context, &model, &Cancellation::default())
                            .await?
                    )
                }
                HostCommand::Models => {
                    let models = self
                        .peers
                        .models()
                        .discover(context, &Cancellation::default())
                        .await?;
                    if models.registration_id != binding.registration_id {
                        return Err(AiError::ConnectionUnavailable);
                    }
                    json!({"registrationId":models.registration_id,"checkedAt":models.checked_at,"modelSlugs":models.model_slugs})
                }
                HostCommand::Action(request) => {
                    request.command.validate()?;
                    json!(
                        self.peers
                            .actions()
                            .act(context, &request, &Cancellation::default())
                            .await?
                    )
                }
                HostCommand::ActionStatus(id) => json!(
                    self.peers
                        .actions()
                        .status(context, &id, &Cancellation::default())
                        .await?
                ),
            };
            self.authority.revalidate(context, &binding)?;
            Ok(value)
        })
    }
}
impl<C: Sync, P: HostPeers<Context = C>, A: HostAuthority<C>> CancelPort<C> for AiHost<P, A> {
    fn cancel<'a>(&'a self, context: &'a C, id: &'a str) -> PortFuture<'a, CancelReceipt> {
        Box::pin(async move {
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            let receipt = self.journal.stop(&binding, id)?;
            self.authority.revalidate(context, &binding)?;
            Ok(receipt)
        })
    }
}

impl<H: HostApi> HostApi for std::sync::Arc<H> {
    type Context = H::Context;
    fn call<'a>(
        &'a self,
        context: &'a Self::Context,
        command: HostCommand,
    ) -> PortFuture<'a, Value> {
        self.as_ref().call(context, command)
    }
}
