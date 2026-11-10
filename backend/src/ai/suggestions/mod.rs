//! Review-only generated suggestions over caller-admitted canonical inputs.
//! This module has no provider, dispatcher, persistence, approval or write port.
//! Structural grounding is checked; correctness of extracted text is not proven.
mod types;
mod validate;
mod disclosure;
mod completion;
pub mod evaluation;

pub use types::*;
pub use validate::{AdmittedSnapshot, ReviewProposal, SuggestionError, validate_generated};
pub use disclosure::{ReviewDisclosure, disclose_review};
pub use completion::{CompletionRejection, SuggestionCompletion, disclose_completed};

#[cfg(test)]
mod synthetic_contracts;
