//! Stock wire3 request preparation, closed routing and result release.
//! All transports share this synchronous domain boundary. Storage, schema,
//! authority and provider queue owners are injected; this module opens no IO.

mod atlas_commands;
mod atlas_reads;
mod atlas_results;
mod catalog;
mod digest;
mod native_contract;
mod ports;
mod request;
mod result;
mod service;

pub use atlas_commands::*;
pub use atlas_reads::*;
pub use atlas_results::*;
pub use catalog::*;
pub use digest::*;
pub use native_contract::*;
pub use ports::*;
pub use request::*;
pub use result::*;
pub use service::*;

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
