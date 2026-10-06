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
            max_json_bytes: 262_144,
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
            || self.max_json_bytes > 1_048_576
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

/// A small host-owned component, with no task registry, executor or domain copy.
pub struct AiRunner<'a, Conn, Infer, Catalog, Meter> {
    pub connection: &'a Conn,
    pub inference: &'a Infer,
    pub catalog: &'a Catalog,
    pub usage: &'a Meter,
}
impl<Conn, Infer, Catalog, Meter> AiRunner<'_, Conn, Infer, Catalog, Meter> {
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
    {
        let mut usage = Usage::default();
        match self
            .run_inner(context, model, input, cancel, limits, &mut usage)
            .await
        {
            Ok(outcome) => Ok(outcome),
            Err(AiError::CancelRequested) => Ok(RunOutcome::Stopped { usage }),
            Err(AiError::ProviderUnavailable) => Err(UnconfirmedRun {
                reason: AiError::ProviderUnavailable,
                usage,
            }),
            Err(reason) => Ok(RunOutcome::Failed { reason, usage }),
        }
    }

    async fn run_inner<C>(
        &self,
        context: &C,
        model: &str,
        input: RunInput,
        cancel: &Cancellation,
        limits: RunLimits,
        usage: &mut Usage,
    ) -> Result<RunOutcome, AiError>
    where
        Conn: ConnectionPort<C>,
        Infer: InferencePort<C>,
        Catalog: DomainCatalog<C>,
        Meter: UsagePort<C>,
    {
        let limits = limits.validate()?;
        if input.prompt.trim().is_empty()
            || input.prompt.len() > limits.max_prompt_bytes
            || input.request_id.is_empty()
            || input.request_id.len() > 128
        {
            return Err(AiError::InvalidInput);
        }
        let mut history = vec![json!({ "role": "user", "content": input.prompt })];
        let mut seen_calls = HashSet::new();
        for round in 0..limits.max_rounds {
            cancel.checkpoint()?;
            let connection = self.connection.check(context, model, cancel).await?;
            cancel.checkpoint()?;
            if !connection.can_infer() {
                return Err(AiError::ConnectionUnavailable);
            }
            let tools = self.catalog.tools(context)?;
            validate_tools(&tools, limits.max_calls)?;
            let request = ResponsesRequest::new(model, history.clone(), &tools)?;
            limits.bound(&request)?;
            let inferred = self
                .inference
                .infer(context, &input.request_id, &request, cancel)
                .await;
            let outcome = match inferred {
                Ok(outcome) => outcome,
                Err(reason) => {
                    // No authoritative measurement for this attempted round.
                    // Prior measured rounds stay in UsagePort; run totals are
                    // unknown rather than silently omitting this request.
                    usage.accumulate(Usage::default(), round == 0);
                    return Err(reason);
                }
            };
            let (output, observed) = match outcome {
                InferenceOutcome::Completed { output, usage } => (output, usage),
                InferenceOutcome::Cancelled { usage: observed } => {
                    self.usage.observed(context, &input.request_id, observed);
                    usage.accumulate(observed, round == 0);
                    return Ok(RunOutcome::Cancelled { usage: *usage });
                }
                InferenceOutcome::Stopped { usage: observed } => {
                    self.usage.observed(context, &input.request_id, observed);
                    usage.accumulate(observed, round == 0);
                    return Ok(RunOutcome::Stopped { usage: *usage });
                }
                InferenceOutcome::Failed {
                    reason,
                    usage: observed,
                    diagnostic,
                } => {
                    self.usage.observed(context, &input.request_id, observed);
                    self.usage
                        .provider_failed(context, &input.request_id, &diagnostic);
                    usage.accumulate(observed, round == 0);
                    return Ok(RunOutcome::Failed {
                        reason,
                        usage: *usage,
                    });
                }
            };
            self.usage.observed(context, &input.request_id, observed);
            usage.accumulate(observed, round == 0);
            cancel.checkpoint()?;
            limits.bound(&output)?;
            let calls = tool_calls(&output)?;
            if calls.len() + seen_calls.len() > limits.max_calls {
                return Err(AiError::LimitReached);
            }
            for call in &calls {
                if !call.arguments.is_object()
                    || call.call_id.len() > 256
                    || !seen_calls.insert(call.call_id.clone())
                {
                    return Err(AiError::InvalidProviderOutput);
                }
                if !tools.iter().any(|tool| tool.name == call.name) {
                    return Err(AiError::UnknownTool);
                }
            }
            if calls.is_empty() {
                return Ok(RunOutcome::Completed {
                    text: output_text(&output),
                    usage: *usage,
                });
            }
            // Surface proposals together before any tool executes in this round.
            // Resumption needs a later exact access/catalog review capability.
            if calls.iter().any(|call| {
                tools
                    .iter()
                    .any(|tool| tool.name == call.name && tool.effect == ToolEffect::RequiresReview)
            }) {
                return Ok(RunOutcome::ReviewRequired {
                    calls,
                    usage: *usage,
                });
            }
            // Do not execute a read whose result cannot be returned to inference.
            if round + 1 == limits.max_rounds {
                return Err(AiError::LimitReached);
            }
            history.extend(output);
            for call in calls {
                cancel.checkpoint()?;
                let current = self.catalog.tools(context)?;
                validate_tools(&current, limits.max_calls)?;
                let advertised = tools
                    .iter()
                    .find(|tool| tool.name == call.name)
                    .ok_or(AiError::UnknownTool)?;
                let now = current
                    .iter()
                    .find(|tool| tool.name == call.name)
                    .ok_or(AiError::UnknownTool)?;
                if now.effect != ToolEffect::Read || now.parameters != advertised.parameters {
                    return Err(AiError::InvalidCatalog);
                }
                let result: Value = self.catalog.execute_read(context, &call, cancel).await?;
                cancel.checkpoint()?;
                limits.bound(&result)?;
                history.push(tool_output(&call, result)?);
                limits.bound(&history)?;
            }
        }
        Err(AiError::LimitReached)
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
