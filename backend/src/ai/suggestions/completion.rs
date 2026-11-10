//! No inference is started here. Only the original transport owner may supply
//! a terminal outcome; constructing this enum is not proof of provider execution.
use super::{AdmittedSnapshot, MAX_OUTPUT_BYTES, ReviewDisclosure, SuggestionError, disclose_review, validate_generated};
use crate::ai::{InferenceOutcome, Usage};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompletionRejection {
    Cancelled,
    Stopped,
    Unresolved,
    Failed,
    Refused,
    InvalidEnvelope,
    Validation(SuggestionError),
}

/// Usage is the original observation on success AND refusal, never an estimate.
/// The caller retains the borrowed outcome, diagnostics and original journal.
#[derive(Debug)]
pub struct SuggestionCompletion {
    pub usage: Usage,
    pub review: Result<ReviewDisclosure, CompletionRejection>,
}

/// A strict no-tool completion-to-presentation seam, not a runtime or dispatcher.
/// Never use the general runner's flattened text: it also contains refusals.
/// Fresh snapshots and inspection availability must come from existing owners;
/// neither a context pin nor this function authenticates or approves anything.
pub fn disclose_completed(
    outcome: &InferenceOutcome,
    admitted: &AdmittedSnapshot,
    current: &AdmittedSnapshot,
    inspectable: &BTreeSet<String>,
) -> SuggestionCompletion {
    let (output, usage) = match outcome {
        InferenceOutcome::Completed { output, usage } => (output, *usage),
        InferenceOutcome::Cancelled { usage } => return withheld(*usage, CompletionRejection::Cancelled),
        InferenceOutcome::Stopped { usage } => return withheld(*usage, CompletionRejection::Stopped),
        InferenceOutcome::Unresolved { usage, .. } => return withheld(*usage, CompletionRejection::Unresolved),
        InferenceOutcome::Failed { usage, .. } => return withheld(*usage, CompletionRejection::Failed),
    };
    let review = (|| {
        // Bound the complete envelope too, including ignored reasoning metadata.
        if output.is_empty() || output.len() > 64
            || serde_json::to_vec(output).map_err(|_| CompletionRejection::InvalidEnvelope)?.len() > 1_048_576
        {
            return Err(CompletionRejection::InvalidEnvelope);
        }
        let mut text = None;
        for item in output {
            match item.get("type").and_then(serde_json::Value::as_str) {
                Some("reasoning") => {},
                Some("message") => {
                    if text.is_some() || item.get("role").and_then(serde_json::Value::as_str) != Some("assistant")
                        || item.get("status").and_then(serde_json::Value::as_str) != Some("completed")
                    {
                        return Err(CompletionRejection::InvalidEnvelope);
                    }
                    let parts = item.get("content").and_then(serde_json::Value::as_array)
                        .ok_or(CompletionRejection::InvalidEnvelope)?;
                    if parts.iter().any(|p| p.get("type").and_then(serde_json::Value::as_str) == Some("refusal")) {
                        return Err(CompletionRejection::Refused);
                    }
                    // Do not concatenate fragments, choose among messages or
                    // extract JSON from prose/markdown. One exact payload only.
                    if parts.len() != 1 || parts[0].get("type").and_then(serde_json::Value::as_str) != Some("output_text") {
                        return Err(CompletionRejection::InvalidEnvelope);
                    }
                    let payload = parts[0].get("text").and_then(serde_json::Value::as_str)
                        .ok_or(CompletionRejection::InvalidEnvelope)?;
                    if payload.is_empty() || payload.len() > MAX_OUTPUT_BYTES {
                        return Err(CompletionRejection::InvalidEnvelope);
                    }
                    text = Some(payload);
                },
                // Function calls, tool results and unknown output never reach
                // the domain catalog or get silently discarded as harmless.
                _ => return Err(CompletionRejection::InvalidEnvelope),
            }
        }
        let review = validate_generated(text.ok_or(CompletionRejection::InvalidEnvelope)?.as_bytes(), admitted, current)
            .map_err(CompletionRejection::Validation)?;
        disclose_review(&review, current, inspectable).map_err(CompletionRejection::Validation)
    })();
    SuggestionCompletion { usage, review }
}

fn withheld(usage: Usage, rejection: CompletionRejection) -> SuggestionCompletion {
    SuggestionCompletion { usage, review: Err(rejection) }
}
