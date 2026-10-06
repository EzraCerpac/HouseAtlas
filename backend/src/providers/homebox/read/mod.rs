//! AT08: scoped, injected HomeBox GET reads. No network driver or access authority.
mod client;
mod decode;
mod error;
mod navigation;
mod publication;
mod types;

pub use client::{Body, Clock, GetRequest, GetResponse, HomeBoxReader, Limits, Transport};
pub use error::{ErrorCode, ReadError};
pub use navigation::{NativeNavigation, NativeRoute};
pub use publication::{GenerationPublisher, PublicationFence, PublishError};
pub use types::*;

pub const HOMEBOX_REFERENCE_VERSION: &str = "v0.26.2";
pub const METADATA_DIALECT: &str = "atlas-normalized-synthetic-v1";
pub const CONSISTENCY: &str = "non-transactional-offset-pages";

#[cfg(test)]
mod healthy;
