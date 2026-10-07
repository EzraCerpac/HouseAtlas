//! Retained accepted stock-writer facts, never recovery or invocation authority.
mod activity_adapter;
mod activity_archive;
mod activity_archive_rows;
mod activity_capture;
mod activity_restored_adapter;
mod activity_validation;
mod adapter;
mod binding;
mod codec;
mod contracts;
mod record;

pub use activity_adapter::{HomeboxStockActivityEvidence, RetainedNativeStockActivityArchive};
pub use activity_archive::{
    ACTIVITY_ARCHIVE_STORAGE_COMMIT, ACTIVITY_NATIVE_ARCHIVE_CODEC_V4,
    MAX_NATIVE_ACTIVITY_ARCHIVE_BYTES, MAX_NATIVE_ACTIVITY_ARCHIVE_EVENTS,
    NativeActivityArchivePacket, NativeActivityArchiveReadAuthorization,
    RestoredNativeActivityArchive, RestoredNativeActivityCut, RestoredNativeActivityEvent,
    RestoredNativeActivityEvidence,
};
pub use activity_capture::{
    ACTIVITY_DISPATCH_CODEC_V3, ACTIVITY_NATIVE_CODEC_V3, ACTIVITY_OBSERVATION_CODEC_V3,
    ArchivedNativeStockActivity, CapturingStockDispatch, CapturingStockReadback,
    RetainedNativeStockActivity, RetainedStockNativeEvent, StockActivityNativeCapture,
};
pub use activity_restored_adapter::HomeboxRestoredStockActivityEvidence;
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

#[cfg(test)]
mod healthy_activity_v3;
