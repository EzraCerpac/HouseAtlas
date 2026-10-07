//! AT08: scoped HomeBox GET reads. Source approval and credentials are host-owned.
mod client;
mod decode;
mod error;
mod failure_publication;
mod http_transport;
mod navigation;
mod publication;
mod retained;
mod stock;
mod types;

pub use client::{Body, Clock, GetRequest, GetResponse, HomeBoxReader, Limits, Transport};
pub use error::{ErrorCode, ReadError};
pub use failure_publication::FailedPublication;
pub use http_transport::{
    AuthorizationHeader, CredentialProvider, HttpBody, HttpTransport, SourceEndpoint,
};
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
