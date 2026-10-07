use super::responses::{output_text, tool_calls, tool_output};
use super::{
    AiError, Cancellation, ConnectionPort, DomainCatalog, InferenceOutcome, InferencePort,
    ResponsesRequest, RunInput, RunOutcome, ToolDescriptor, ToolEffect, UnconfirmedRun, Usage,
    UsagePort,
};
use serde_json::{Value, json};
use std::collections::HashSet;

/// Local bounds, deliberately absent from unsupported SIWC request parameters.
#[derive(Debug, Clone, Copy)]
pub struct RunLimits {
    pub max_rounds: usize,
    pub max_calls: usize,
    pub max_prompt_bytes: usize,
    pub max_json_bytes: usize,
}
impl Default for RunLimits {
    fn default() -> Self {
        Self {
            max_rounds: 4,
            max_calls: 32,
            max_prompt_bytes: 16_384,
            max_json_bytes: 4 * 1024 * 1024,
        }
    }
}
impl RunLimits {
    fn validate(self) -> Result<Self, AiError> {
        if self.max_rounds == 0
            || self.max_rounds > 16
            || self.max_calls == 0
            || self.max_calls > 128
            || self.max_prompt_bytes == 0
            || self.max_prompt_bytes > 65_536
            || self.max_json_bytes == 0
            || self.max_json_bytes > 16 * 1024 * 1024
        {
            Err(AiError::InvalidInput)
        } else {
            Ok(self)
        }
    }
    fn bound<T: serde::Serialize>(&self, value: &T) -> Result<(), AiError> {
        if serde_json::to_vec(value)
            .map_err(|_| AiError::InvalidInput)?
            .len()
            > self.max_json_bytes
        {
            Err(AiError::LimitReached)
        } else {
            Ok(())
        }
    }
}

/// Retained only by the host's authenticated continuation store. The store binds
/// this to actor/home/registration/epoch and claims it once after trusted review.
/// Opaque prepared handles keep generated DTOs, digest and approvals in peers.
pub struct AiCheckpoint<P> {
    pub request_id: String,
    pub model: String,
    pub history: Vec<Value>,
    pub pending: Vec<(super::ToolCall, P)>,
    pub seen_calls: HashSet<String>,
    pub next_round: usize,
    pub usage: Usage,
    pub operation_ids: Vec<String>,
    pub limits: RunLimits,
}

enum StageFailure {
    Known(AiError),
    UnresolvedInference,
}
impl From<AiError> for StageFailure {
    fn from(value: AiError) -> Self {
        Self::Known(value)
    }
}
fn finish(
    result: Result<RunOutcome, StageFailure>,
    usage: Usage,
    operation_ids: Vec<String>,
) -> Result<RunOutcome, UnconfirmedRun> {
    match result {
        Ok(outcome) => Ok(outcome),
        Err(StageFailure::Known(AiError::CancelRequested)) => Ok(RunOutcome::Stopped { usage }),
        Err(StageFailure::Known(reason)) => Ok(RunOutcome::Failed {
            reason,
            operation_ids,
            usage,
        }),
        Err(StageFailure::UnresolvedInference) => Err(UnconfirmedRun {
            reason: AiError::ProviderUnavailable,
            usage,
        }),
    }
}

/// Host-owned orchestration, without a second queue, task registry or domain.
pub struct AiRunner<'a, Conn, Infer, Catalog, Meter, Store> {
    pub connection: &'a Conn,
    pub inference: &'a Infer,
    pub catalog: &'a Catalog,
    pub usage: &'a Meter,
    pub continuations: &'a Store,
}
impl<Conn, Infer, Catalog, Meter, Store> AiRunner<'_, Conn, Infer, Catalog, Meter, Store> {
    pub async fn run<C>(
        &self,
        context: &C,
        model: &str,
        input: RunInput,
        cancel: &Cancellation,
        limits: RunLimits,
    ) -> Result<RunOutcome, UnconfirmedRun>
    where
        Conn: ConnectionPort<C>,
        Infer: InferencePort<C>,
        Catalog: DomainCatalog<C>,
        Meter: UsagePort<C>,
        Store: super::ReviewContinuationPort<C, Catalog::Prepared>,
    {
        let mut usage = Usage::default();
        let mut operation_ids = vec![];
        let result = async {
            let limits = limits.validate()?;
            if input.prompt.trim().is_empty()
                || input.prompt.len() > limits.max_prompt_bytes
                || input.request_id.is_empty()
                || input.request_id.len() > 128
            {
                return Err(AiError::InvalidInput.into());
            }
            let state = AiCheckpoint {
                request_id: input.request_id,
                model: model.to_owned(),
                history: vec![json!({ "role": "user", "content": input.prompt })],
                pending: vec![],
                seen_calls: HashSet::new(),
                next_round: 0,
                usage,
                operation_ids: vec![],
                limits,
            };
            self.run_inner(
                context,
                state,
                false,
                cancel,
                &mut usage,
                &mut operation_ids,
            )
            .await
        }
        .await;
        finish(result, usage, operation_ids)
    }

    /// The browser supplies only identifiers. claim() verifies the separate
    /// human UI, immutable intent and current context; the model sees no receipt.
    pub async fn resume<C>(
        &self,
        context: &C,
        request_id: &str,
        continuation_id: &str,
        cancel: &Cancellation,
    ) -> Result<RunOutcome, UnconfirmedRun>
    where
        Conn: ConnectionPort<C>,
        Infer: InferencePort<C>,
        Catalog: DomainCatalog<C>,
        Meter: UsagePort<C>,
        Store: super::ReviewContinuationPort<C, Catalog::Prepared>,
    {
        let mut usage = Usage::default();
        let mut operation_ids = vec![];
        let result = async {
            cancel.checkpoint()?;
            let state = self
                .continuations
                .claim(context, continuation_id, request_id, cancel)
                .await?;
            usage = state.usage;
            operation_ids = state.operation_ids.clone();
            if state.request_id != request_id || state.pending.is_empty() {
                return Err(AiError::InvalidInput.into());
            }
            self.run_inner(context, state, true, cancel, &mut usage, &mut operation_ids)
                .await
        }
        .await;
        finish(result, usage, operation_ids)
    }

    async fn run_inner<C>(
        &self,
        context: &C,
        mut state: AiCheckpoint<Catalog::Prepared>,
        mut reviewed: bool,
        cancel: &Cancellation,
        usage: &mut Usage,
        operation_ids: &mut Vec<String>,
    ) -> Result<RunOutcome, StageFailure>
    where
        Conn: ConnectionPort<C>,
        Infer: InferencePort<C>,
        Catalog: DomainCatalog<C>,
        Meter: UsagePort<C>,
        Store: super::ReviewContinuationPort<C, Catalog::Prepared>,
    {
        let limits = state.limits.validate()?;
        while state.next_round < limits.max_rounds {
            cancel.checkpoint()?;
            // A connection-stage ProviderUnavailable is a known failed check.
            let connection = self.connection.check(context, &state.model, cancel).await?;
            cancel.checkpoint()?;
            if !connection.can_infer() {
                return Err(AiError::ConnectionUnavailable.into());
            }
            limits.bound(&state.history)?;
            for (call, prepared) in &state.pending {
                cancel.checkpoint()?;
                let result = match self.catalog.effect(prepared) {
                    ToolEffect::Read => {
                        self.catalog.execute_read(context, prepared, cancel).await?
                    }
                    ToolEffect::RequiresReview if reviewed => {
                        let dispatch = self
                            .catalog
                            .execute_reviewed(context, prepared, cancel)
                            .await?;
                        if let Some(id) = &dispatch.operation_id
                            && !operation_ids.contains(id)
                        {
                            operation_ids.push(id.clone());
                        }
                        self.usage
                            .domain_observed(context, &state.request_id, &dispatch)?;
                        if !matches!(
                            dispatch.state,
                            super::stock::DomainDispatchState::Observed
                                | super::stock::DomainDispatchState::Resolved
                        ) {
                            return Ok(RunOutcome::DomainHeld {
                                operation_id: dispatch.operation_id,
                                state: dispatch.state,
                                usage: *usage,
                            });
                        }
                        dispatch.value
                    }
                    ToolEffect::RequiresReview => return Err(AiError::InvalidCatalog.into()),
                };
                // Domain failures after completed inference remain typed failures,
                // never unresolved inference. Submitted effects stay with peers.
                cancel.checkpoint()?;
                limits.bound(&result)?;
                state.history.push(tool_output(call, result)?);
                limits.bound(&state.history)?;
            }
            state.pending.clear();
            reviewed = false;
            cancel.checkpoint()?;
            let tools = self.catalog.tools(context)?;
            validate_tools(&tools, limits.max_calls)?;
            let request = ResponsesRequest::new(&state.model, state.history.clone(), &tools)?;
            limits.bound(&request)?;
            let first = state.next_round == 0;
            let outcome = match self
                .inference
                .infer(context, &state.request_id, &request, cancel)
                .await
            {
                Ok(outcome) => outcome,
                Err(reason) => {
                    usage.accumulate(Usage::default(), first);
                    return Err(if reason == AiError::ProviderUnavailable {
                        StageFailure::UnresolvedInference
                    } else {
                        StageFailure::Known(reason)
                    });
                }
            };
            state.next_round += 1;
            let (output, observed) = match outcome {
                InferenceOutcome::Completed { output, usage } => (output, usage),
                InferenceOutcome::Cancelled { usage: observed } => {
                    self.usage.observed(context, &state.request_id, observed);
                    usage.accumulate(observed, first);
                    return Ok(RunOutcome::Cancelled { usage: *usage });
                }
                InferenceOutcome::Stopped { usage: observed } => {
                    self.usage.observed(context, &state.request_id, observed);
                    usage.accumulate(observed, first);
                    return Ok(RunOutcome::Stopped { usage: *usage });
                }
                InferenceOutcome::Unresolved {
                    reason: _,
                    usage: observed,
                    diagnostic,
                } => {
                    self.usage
                        .provider_failed(context, &state.request_id, &diagnostic);
                    usage.accumulate(observed, first);
                    return Err(StageFailure::UnresolvedInference);
                }
                InferenceOutcome::Failed {
                    reason,
                    usage: observed,
                    diagnostic,
                } => {
                    self.usage.observed(context, &state.request_id, observed);
                    self.usage
                        .provider_failed(context, &state.request_id, &diagnostic);
                    usage.accumulate(observed, first);
                    return Ok(RunOutcome::Failed {
                        reason,
                        operation_ids: operation_ids.clone(),
                        usage: *usage,
                    });
                }
            };
            self.usage.observed(context, &state.request_id, observed);
            usage.accumulate(observed, first);
            cancel.checkpoint()?;
            limits.bound(&output)?;
            let calls = tool_calls(&output)?;
            if calls.len() + state.seen_calls.len() > limits.max_calls {
                return Err(AiError::LimitReached.into());
            }
            if calls.is_empty() {
                let text = output_text(&output);
                // Completion of the provider stream is not an answer. Only
                // accepted text/refusal content can complete a no-tool round.
                if text.trim().is_empty() {
                    return Err(AiError::InvalidProviderOutput.into());
                }
                return Ok(RunOutcome::Completed {
                    text,
                    usage: *usage,
                });
            }
            if state.next_round == limits.max_rounds {
                return Err(AiError::LimitReached.into());
            }
            let mut reviews = vec![];
            let mut requires_review = false;
            for call in &calls {
                if !call.arguments.is_object()
                    || call.call_id.len() > 256
                    || !state.seen_calls.insert(call.call_id.clone())
                {
                    return Err(AiError::InvalidProviderOutput.into());
                }
                if !tools.iter().any(|tool| tool.name == call.name) {
                    return Err(AiError::UnknownTool.into());
                }
                let prepared = self.catalog.prepare(context, call)?;
                if self.catalog.effect(&prepared) == ToolEffect::RequiresReview {
                    requires_review = true;
                    if let Some(challenge) = self.catalog.review(context, &prepared, cancel).await?
                    {
                        reviews.push(challenge);
                    }
                }
                state.pending.push((call.clone(), prepared));
            }
            state.history.extend(output);
            limits.bound(&state.history)?;
            if requires_review {
                // Retain every pending call before any read/write in this round.
                // Model receipts, new payloads and approval channels are absent.
                state.usage = *usage;
                state.operation_ids = operation_ids.clone();
                let continuation_id = self.continuations.retain(context, state, cancel).await?;
                if continuation_id.is_empty() || continuation_id.len() > 256 {
                    return Err(AiError::InvalidCatalog.into());
                }
                return Ok(RunOutcome::ReviewRequired {
                    calls,
                    continuation_id,
                    reviews,
                    usage: *usage,
                });
            }
        }
        Err(AiError::LimitReached.into())
    }
}

fn validate_tools(tools: &[ToolDescriptor], max: usize) -> Result<(), AiError> {
    let mut names = HashSet::new();
    if tools.len() > max {
        return Err(AiError::LimitReached);
    }
    for tool in tools {
        if tool.name.is_empty()
            || tool.name.len() > 64
            || !tool
                .name
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
            || !names.insert(&tool.name)
            || tool.description.is_empty()
            || tool.description.len() > 4096
            || !tool.parameters.is_object()
        {
            return Err(AiError::InvalidCatalog);
        }
    }
    Ok(())
}
