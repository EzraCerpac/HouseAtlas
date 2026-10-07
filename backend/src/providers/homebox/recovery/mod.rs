//! Retained accepted stock-writer facts, never recovery or invocation authority.
mod adapter;
mod codec;
mod contracts;
mod record;

pub use adapter::HomeboxRetainedEvidence;
pub use codec::{
    NATIVE_CODEC, NEVER_INVOKED_CODEC, READBACK_CODEC, REMOTE_END_CODEC, WRITER_COMMIT,
};
pub use contracts::NativeWriterContracts;
pub use record::{RetainedWriterArchive, RetainedWriterAttempt};

use crate::storage;
fn incompatible() -> storage::Error {
    storage::Error::new(
        "schema-incompatible",
        "Retained HomeBox evidence is incompatible",
    )
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Independent retained HomeBox evidence is unavailable",
    )
}

#[cfg(test)]
mod healthy;
