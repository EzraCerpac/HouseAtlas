//! Pure bindings to AT07 full-image queue validation. Image data never creates
//! authority, an original approval, a provider permit or proof of remote effects.
//!
//! Owners must supply independently qualified recovery authority, original
//! enqueue provenance and native/media codecs. No permissive implementation or
//! production constructor for those owner proofs is provided here. Callbacks
//! run under storage's read transaction: no SQL reentry, provider I/O or borrowed
//! source-store access/vault handles that would prevent strict source close.

mod attempt;
mod discovery;
mod ports;

pub use attempt::*;
pub use discovery::*;
pub use ports::*;

use crate::storage;

fn incompatible() -> storage::Error {
    storage::Error::new(
        "schema-incompatible",
        "Retained queue correlation is incompatible",
    )
}

fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Required retained queue proof is unavailable",
    )
}
