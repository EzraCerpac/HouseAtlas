//! AT08: scoped HomeBox GET reads. Source approval and credentials are host-owned.
mod client;
mod decode;
mod error;
mod failure_publication;
mod http_transport;
mod native_capture;
mod native_file_capture;
mod native_presence_capture;
pub mod native_presence_owner;
mod native_query;
mod navigation;
mod publication;
pub mod query;
mod retained;
mod stock;
mod types;

pub use client::{Body, Clock, GetRequest, GetResponse, HomeBoxReader, Limits, Transport};
pub use error::{ErrorCode, ReadError};
pub use failure_publication::FailedPublication;
pub use http_transport::{
    AuthorizationHeader, CredentialProvider, HttpBody, HttpTransport, SourceEndpoint,
};
pub use native_capture::{CapturedStockEntity, CapturedStockMaintenance, NativeCapture};
pub use native_file_capture::CapturedNativeFileSnapshot;
pub use native_presence_capture::{
    NativePresenceCapture, NativePresenceGeneration, NativePresenceIdentity, NativePresenceResponse,
};
pub use native_presence_owner::{
    ConfiguredNativePresenceCapture, ConfiguredNativePresenceOrigin, NativePresenceCaptureError,
    NativePresenceOwnerError, NativePresenceReader, PreparedConfiguredNativePresence,
};
pub use native_query::{NativeReadCapture, NativeReadOwner};
pub use navigation::{NativeNavigation, NativeRoute};
pub use publication::{PreparedGeneration, PublishError, RefreshError, StagedPublication};
pub use stock::StockNavigation;
pub use types::*;

pub const HOMEBOX_REFERENCE_VERSION: &str = "v0.26.2";
pub const METADATA_DIALECT: &str = "atlas-normalized-synthetic-v1";
pub const CONSISTENCY: &str = "non-transactional-offset-pages";

#[cfg(test)]
mod healthy;
#[cfg(test)]
mod healthy_http;
#[cfg(test)]
#[path = "numeric_healthy.rs"]
mod healthy_numeric;

#[cfg(test)]
mod native_capture_healthy;

mod credentials;
#[cfg(test)]
mod native_query_healthy;
pub use credentials::{NativeReadCredentialConfig, NativeReadCredentials};
#[cfg(test)]
mod credentials_healthy;
