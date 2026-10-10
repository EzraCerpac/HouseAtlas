//! Source-presence content production; runtime admission remains held.
//!
//! Integration must mount this child from the existing presence.rs. No helper
//! here opens an atomic mutation transaction or persists/adopts a witness.
mod authority;
mod current;
mod qualifier;

pub use authority::*;
pub use current::*;
pub use qualifier::*;

use crate::{contracts, domain::DomainError};
use serde::{Serialize, de::DeserializeOwned};

fn carrier<T: DeserializeOwned>(value: &impl Serialize) -> Result<T, DomainError> {
    serde_json::from_value(serde_json::to_value(value).map_err(|_| DomainError::InvalidContract)?)
        .map_err(|_| DomainError::InvalidContract)
}

fn digest(value: &impl Serialize) -> Result<String, DomainError> {
    contracts::semantics::canonical_digest(
        &serde_json::to_value(value).map_err(|_| DomainError::InvalidContract)?,
    )
    .map_err(|_| DomainError::InvalidContract)
}

fn shape<T: contracts::Contract>(value: &impl Serialize) -> Result<T, DomainError> {
    contracts::decode(&serde_json::to_vec(value).map_err(|_| DomainError::InvalidContract)?)
        .map_err(|_| DomainError::InvalidContract)
}
