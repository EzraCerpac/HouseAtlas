//! Stock wire3 request preparation, closed routing and result release.
//! All transports share this synchronous domain boundary. Storage, schema,
//! authority and provider queue owners are injected; intake measurement delegates
//! to the actual Media owner.

mod atlas_commands;
mod atlas_downloads;
mod atlas_lists;
mod atlas_reads;
mod atlas_results;
mod attachment_measurement;
mod catalog;
mod derived_atlas_commands;
mod digest;
mod existing_asset_attachment;
mod native_atlas_commands;
mod native_authority;
mod native_contract;
mod native_reads;
mod ports;
mod request;
mod result;
mod retained_staged_atlas_commands;
mod service;
mod staged_atlas_commands;

pub use atlas_commands::*;
pub use atlas_downloads::*;
pub use atlas_lists::*;
pub use atlas_reads::*;
pub use atlas_results::*;
pub use attachment_measurement::*;
pub use catalog::*;
pub use derived_atlas_commands::*;
pub use digest::*;
pub use existing_asset_attachment::*;
pub use native_atlas_commands::*;
pub use native_authority::*;
pub use native_contract::*;
pub use native_reads::*;
pub use ports::*;
pub use request::*;
pub use result::*;
pub use retained_staged_atlas_commands::*;
pub use service::*;
pub use staged_atlas_commands::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StockError {
    /// Preserve the real native store's authorized error category. No revision
    /// is invented by a stock adapter or recovered through a detached read.
    Domain(super::DomainError),
    InvalidContract,
    UnsupportedCapability,
    CapabilityHeld,
    ForbiddenAppendOnly,
    AuthorityChanged,
    CapabilityDenied,
    CorrelationMismatch,
    InvalidClock,
    OwnerUnavailable,
}

pub type StockResult<T> = Result<T, StockError>;

impl std::fmt::Display for StockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for StockError {}
