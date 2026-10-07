//! Framework-free Atlas queries, current-output assembly and command delegation.
//!
//! AT07 owns transactions and frozen contract validation. AT11 owns verified
//! principals and current source grants. This module supplies neither authority
//! nor a provider transport. See README.md for the integration port contracts.

mod commands;
mod integer;
mod model;
pub mod native_semantics;
pub mod native_storage;
pub mod queue_recovery;
mod ports;
mod presence;
mod projection;
mod queries;
pub mod stock;

#[cfg(test)]
mod healthy;

pub use commands::*;
pub use model::*;
pub use ports::*;
pub use presence::*;
pub use projection::*;
pub use queries::*;

use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainError {
    Unauthenticated,
    InvalidContract,
    RevisionRequired {
        current_revision: Option<u64>,
    },
    /// Revision values come only from an authorized storage transaction.
    RevisionConflict {
        current_revision: Option<u64>,
    },
    GuardConflict {
        current_revision: Option<u64>,
    },
    IdentityConflict,
    IdempotencyConflict,
    InvalidTransition,
    NotFound,
    Forbidden,
    UpstreamIncomplete,
    UpstreamUnavailable,
}

impl DomainError {
    pub fn current_revision(self) -> Option<u64> {
        match self {
            Self::RevisionRequired { current_revision }
            | Self::RevisionConflict { current_revision }
            | Self::GuardConflict { current_revision } => current_revision,
            _ => None,
        }
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unauthenticated => "unauthenticated",
            Self::InvalidContract => "invalid-contract",
            Self::RevisionRequired { .. } => "revision-required",
            Self::RevisionConflict { .. } => "revision-conflict",
            Self::GuardConflict { .. } => "guard-conflict",
            Self::IdentityConflict => "identity-conflict",
            Self::IdempotencyConflict => "idempotency-conflict",
            Self::InvalidTransition => "invalid-transition",
            Self::NotFound => "not-found",
            Self::Forbidden => "forbidden",
            Self::UpstreamIncomplete => "upstream-incomplete",
            Self::UpstreamUnavailable => "upstream-unavailable",
        })
    }
}

impl std::error::Error for DomainError {}

pub type DomainResult<T> = Result<T, DomainError>;
