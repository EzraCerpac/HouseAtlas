//! Passive Network inventory component. The host owns authorization, transport
//! configuration, single-flight scheduling and atomic durable publication.
mod adapter;
mod archive;
mod durable;
mod facet;
pub mod host_runtime;
mod http;
mod json;
mod link_binding;
mod model;
mod native;
#[path = "host_runtime/native_owner.rs"]
mod native_owner;
mod projection;
mod publication;
mod saved_queries;
mod sidecar;

pub use adapter::*;
pub use archive::{
    MAX_ACTIVE_SEGMENT_BYTES, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ROW_BYTES,
    MAX_RETAINED_SEGMENT_BYTES, NetworkArchiveReceipt, NetworkArchiveReferenceState,
    NetworkArchiveReservation, NetworkImmutableArchive, ReopenedNetworkCapture,
};
pub use durable::*;
pub use facet::*;
pub use http::*;
pub use link_binding::*;
pub use model::*;
pub use native::*;
pub use projection::{NetworkCapture, project_capture, validate_generation, validate_state};
pub use publication::*;
pub use saved_queries::*;
pub use sidecar::*;

#[cfg(test)]
mod healthy;

#[cfg(test)]
mod transport_healthy;
