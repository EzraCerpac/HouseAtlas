//! Review-only generated suggestions over caller-admitted canonical inputs.
//! This module has no provider, dispatcher, persistence, approval or write port.
//! Structural grounding is checked; correctness of extracted text is not proven.
mod completion;
mod disclosure;
pub mod evaluation;
mod types;
mod validate;

pub use completion::{CompletionRejection, SuggestionCompletion, disclose_completed};
pub use disclosure::{ReviewDisclosure, disclose_review};
pub use types::*;
pub use validate::{AdmittedSnapshot, ReviewProposal, SuggestionError, validate_generated};

#[cfg(test)]
mod synthetic_contracts;
