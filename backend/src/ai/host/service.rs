//! Actual host execution of the accepted runner and exact user-review continuation.
use super::{
    HostAuthority,
    continuation::ContinuationRetirement,
    status::{RequestMeter, StatusJournal},
};
use crate::ai::{
    AiError, AiRunner, CancelPort, CancelReceipt, Cancellation, ConnectionPort, DomainCatalog,
    InferencePort, PortFuture, ReviewContinuationPort, RunInput, RunLimits, RunOutcome, Usage,
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
        > + ContinuationRetirement<Self::Context>
        + Sync;
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
            let disconnect = matches!(&command,HostCommand::Action(request)
                if matches!(request.command,crate::ai::runtime::ConnectionAction::Disconnect));
            let receipt_only = disconnect
                || matches!(
                    &command,
                    HostCommand::Status(_) | HostCommand::Cancel(_) | HostCommand::ActionStatus(_)
                );
            let value = match command {
                HostCommand::Run(input) => {
                    let active = self.journal.begin(&binding, &input.request_id, None)?;
                    let model = match self.peers.selected_model(context) {
                        Ok(model) => model,
                        Err(reason) => {
                            let outcome = RunOutcome::Failed {
                                reason,
                                operation_ids: Vec::new(),
                                usage: Usage::default(),
                            };
                            self.journal
                                .finish(&binding, &input.request_id, Some(&outcome))?;
                            self.authority.revalidate(context, &binding)?;
                            return Ok(json!(outcome));
                        }
                    };
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
                    let receipt = self.journal.finish(&binding, &id, result.as_ref().ok())?;
                    self.authority.revalidate(context, &binding)?;
                    match result {
                        Ok(outcome) => match receipt {
                            crate::ai::runtime::RequestStatus::Finished { outcome, .. } => {
                                json!(outcome)
                            }
                            _ => json!(outcome),
                        },
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
                    let receipt =
                        self.journal
                            .finish(&binding, &input.request_id, result.as_ref().ok())?;
                    self.authority.revalidate(context, &binding)?;
                    match result {
                        Ok(outcome) => match receipt {
                            crate::ai::runtime::RequestStatus::Finished { outcome, .. } => {
                                json!(outcome)
                            }
                            _ => json!(outcome),
                        },
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
                HostCommand::Status(id) => {
                    self.authority
                        .revalidate_action_receipt(context, &binding)?;
                    let receipt = match self.journal.read_current_receipt(&binding, &id, true)? {
                        Some(receipt) => receipt,
                        None => self
                            .journal
                            .read_cancelled_receipt(&binding, &id)?
                            .ok_or(AiError::DomainUnavailable)?,
                    };
                    json!(receipt)
                }
                HostCommand::Cancel(id) => {
                    self.authority
                        .revalidate_action_receipt(context, &binding)?;
                    json!(self.cancel_request(context, &binding, &id)?)
                }
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
            if receipt_only {
                self.authority
                    .revalidate_action_receipt(context, &binding)?;
            } else {
                self.authority.revalidate(context, &binding)?;
            }
            Ok(value)
        })
    }
}
impl<C: Sync, P: HostPeers<Context = C>, A: HostAuthority<C>> CancelPort<C> for AiHost<P, A> {
    fn cancel<'a>(&'a self, context: &'a C, id: &'a str) -> PortFuture<'a, CancelReceipt> {
        Box::pin(async move {
            let binding = self.authority.binding(context)?;
            self.authority
                .revalidate_action_receipt(context, &binding)?;
            let receipt = self.cancel_request(context, &binding, id)?;
            self.authority
                .revalidate_action_receipt(context, &binding)?;
            Ok(receipt)
        })
    }
}

impl<P: HostPeers, A: HostAuthority<P::Context>> AiHost<P, A> {
    fn cancel_request(
        &self,
        context: &P::Context,
        binding: &crate::ai::oauth::RegistrationBinding,
        id: &str,
    ) -> Result<CancelReceipt, AiError> {
        if self
            .journal
            .read_current_receipt(binding, id, false)?
            .is_some()
        {
            // Current continuation retirement retains full dispatch authority.
            self.authority.revalidate(context, binding)?;
            self.journal.stop(binding, id, |continuation| {
                self.peers.continuations().retire(context, id, continuation)
            })
        } else {
            // This is the already latched original cancellation receipt only.
            // No old continuation is claimed, retired, approved or replayed.
            self.journal
                .stop_cancelled_receipt(binding, id)?
                .ok_or(AiError::DomainUnavailable)
        }
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

#[cfg(test)]
mod selected_model_failure_tests {
    use super::*;
    use crate::ai::{
        ConnectionSnapshot, InferenceOutcome, ResponsesRequest, ToolCall, ToolDescriptor,
        ToolEffect,
        oauth::RegistrationBinding,
        runner::AiCheckpoint,
        runtime::{AccountModels, ConnectionActionResult, HumanReviewResult},
        stock::{DomainDispatch, ReviewChallenge},
    };
    use rusqlite::Connection;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    struct Authority {
        binding: RegistrationBinding,
        validations: AtomicUsize,
    }
    impl HostAuthority<()> for Authority {
        fn binding(&self, _: &()) -> Result<RegistrationBinding, AiError> {
            Ok(self.binding.clone())
        }
        fn revalidate(&self, _: &(), binding: &RegistrationBinding) -> Result<(), AiError> {
            assert_eq!(binding, &self.binding);
            self.validations.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    // Every unused peer accessor and port method records invocation. Typed errors
    // keep the fixture inert if the host unexpectedly enters the normal path.
    #[derive(Default)]
    struct Unused(AtomicUsize);
    impl Unused {
        fn called(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    macro_rules! unused_async {
        ($name:ident ($($arg:ident : $ty:ty),* $(,)?) -> $result:ty) => {
            fn $name<'a>(&'a self, $($arg: $ty),*) -> PortFuture<'a, $result> {
                $(let _ = $arg;)*
                self.called();
                Box::pin(async { Err(AiError::DomainUnavailable) })
            }
        };
    }
    impl ConnectionPort<()> for Unused {
        unused_async!(check(c: &'a (), m: &'a str, stop: &'a Cancellation) -> ConnectionSnapshot);
    }
    impl InferencePort<()> for Unused {
        unused_async!(
            infer(
                c: &'a (),
                id: &'a str,
                r: &'a ResponsesRequest,
                stop: &'a Cancellation,
            ) -> InferenceOutcome
        );
    }
    impl DomainCatalog<()> for Unused {
        type Prepared = ();
        fn tools(&self, _: &()) -> Result<Vec<ToolDescriptor>, AiError> {
            self.called();
            Err(AiError::DomainUnavailable)
        }
        fn prepare(&self, _: &(), _: &ToolCall) -> Result<(), AiError> {
            self.called();
            Err(AiError::DomainUnavailable)
        }
        fn effect(&self, _: &()) -> ToolEffect {
            self.called();
            ToolEffect::Read
        }
        unused_async!(
            review(c: &'a (), p: &'a (), stop: &'a Cancellation) -> Option<ReviewChallenge>
        );
        unused_async!(execute_read(c: &'a (), p: &'a (), stop: &'a Cancellation) -> Value);
        unused_async!(
            execute_reviewed(c: &'a (), p: &'a (), stop: &'a Cancellation) -> DomainDispatch
        );
    }
    impl ReviewContinuationPort<(), ()> for Unused {
        unused_async!(retain(c: &'a (), p: AiCheckpoint<()>, stop: &'a Cancellation) -> String);
        unused_async!(
            claim(
                c: &'a (),
                continuation: &'a str,
                request: &'a str,
                stop: &'a Cancellation,
            ) -> AiCheckpoint<()>
        );
    }
    impl ContinuationRetirement<()> for Unused {
        fn retire(&self, _: &(), _: &str, _: &str) -> Result<(), AiError> {
            self.called();
            Err(AiError::DomainUnavailable)
        }
    }
    impl HumanReviewPort<()> for Unused {
        unused_async!(
            open(c: &'a (), input: &'a ReviewInput, stop: &'a Cancellation) -> HumanReviewResult
        );
    }
    impl ConnectionActionPort<()> for Unused {
        unused_async!(
            act(
                c: &'a (),
                input: &'a ConnectionActionRequest,
                stop: &'a Cancellation,
            ) -> ConnectionActionResult
        );
        unused_async!(
            status(c: &'a (), id: &'a str, stop: &'a Cancellation) -> ConnectionActionResult
        );
    }
    impl ModelsPort<()> for Unused {
        unused_async!(discover(c: &'a (), stop: &'a Cancellation) -> AccountModels);
    }

    struct Peers {
        file: PathBuf,
        selected: AtomicUsize,
        unused: Unused,
    }
    macro_rules! unused_peer {
        ($name:ident, $ty:ident) => {
            fn $name(&self) -> &Self::$ty {
                self.unused.called();
                &self.unused
            }
        };
    }
    impl HostPeers for Peers {
        type Context = ();
        type Connection = Unused;
        type Inference = Unused;
        type Catalog = Unused;
        type Continuations = Unused;
        type Human = Unused;
        type Actions = Unused;
        type Models = Unused;
        unused_peer!(connection, Connection);
        unused_peer!(inference, Inference);
        unused_peer!(catalog, Catalog);
        unused_peer!(continuations, Continuations);
        unused_peer!(human, Human);
        unused_peer!(actions, Actions);
        unused_peer!(models, Models);
        fn selected_model(&self, _: &()) -> Result<String, AiError> {
            self.selected.fetch_add(1, Ordering::SeqCst);
            let reader = Connection::open(&self.file).unwrap();
            let admitted: (String, Option<String>) = reader
                .query_row(
                    "SELECT state,payload FROM ai_host_status WHERE id='model_lookup_failure' AND kind='request'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("durable admission must precede selected_model failure");
            assert_eq!(admitted, ("unconfirmed".into(), None));
            Err(AiError::ConnectionUnavailable)
        }
    }

    #[tokio::test]
    async fn selected_model_failure_is_durably_finished_without_execution() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("synthetic-status.sqlite");
        let binding = RegistrationBinding {
            registration_id: "synthetic_registration".into(),
            actor_id: "synthetic_actor".into(),
            workspace_id: "synthetic_workspace".into(),
            home_id: "synthetic_home".into(),
            authority_epoch: "synthetic_authority".into(),
            cancellation_epoch: "synthetic_cancellation".into(),
        };
        let host = AiHost {
            peers: Peers {
                file: file.clone(),
                selected: AtomicUsize::new(0),
                unused: Unused::default(),
            },
            authority: Authority {
                binding: binding.clone(),
                validations: AtomicUsize::new(0),
            },
            journal: StatusJournal::new(Connection::open(&file).unwrap()).unwrap(),
            limits: RunLimits::default(),
        };
        let id = "model_lookup_failure";
        let outcome = json!({
            "status": "failed",
            "reason": "connection-unavailable",
            "operationIds": [],
            "usage": {"inputTokens": null, "outputTokens": null, "totalTokens": null},
        });
        assert_eq!(
            host.call(
                &(),
                HostCommand::Run(RunInput {
                    request_id: id.into(),
                    prompt: "synthetic prompt".into()
                })
            )
            .await
            .unwrap(),
            outcome,
        );
        assert_eq!(host.authority.validations.load(Ordering::SeqCst), 2);
        let finished = json!({"status": "finished", "requestId": id, "outcome": outcome});
        assert_eq!(
            host.call(&(), HostCommand::Status(id.into()))
                .await
                .unwrap(),
            finished
        );
        assert_eq!(
            host.call(&(), HostCommand::Cancel(id.into()))
                .await
                .unwrap(),
            json!({"requestId": id, "status": "already-finished"})
        );
        assert_eq!(host.peers.selected.load(Ordering::SeqCst), 1);
        assert_eq!(host.peers.unused.0.load(Ordering::SeqCst), 0);
        let reader = Connection::open(&file).unwrap();
        let observations: i64 = reader
            .query_row("SELECT COUNT(*) FROM ai_host_observation", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(observations, 0);
        drop(reader);
        drop(host);
        let reopened = StatusJournal::new(Connection::open(&file).unwrap()).unwrap();
        assert_eq!(json!(reopened.read(&binding, id, true).unwrap()), finished);
    }
}
