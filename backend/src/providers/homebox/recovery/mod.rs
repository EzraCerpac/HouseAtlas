//! Retained accepted stock-writer facts, never recovery or invocation authority.
mod adapter;
mod binding;
mod codec;
mod contracts;
mod record;

pub use adapter::HomeboxRetainedEvidence;
pub use binding::{JOB_BINDING_FORMAT_V2, RetainedWriterJobBinding};
pub use codec::{
    NATIVE_CODEC, NATIVE_CODEC_V2, NEVER_INVOKED_CODEC, NEVER_INVOKED_CODEC_V2, READBACK_CODEC,
    READBACK_CODEC_V2, REMOTE_END_CODEC, REMOTE_END_CODEC_V2, WRITER_COMMIT,
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

#[cfg(test)]
mod healthy_v2_support;
