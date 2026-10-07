//! Native-key authenticated complete-record credential storage.
//! Application authority and runtime provisioning remain separately owned.
pub mod authority;
mod boundary;
mod crypto;
#[cfg(unix)]
mod filesystem;
#[cfg(not(unix))]
#[path = "filesystem_unavailable.rs"]
mod filesystem;
mod keys;
mod material;
pub mod record;

pub use authority::CredentialAuthority;
pub use boundary::{CredentialLease, FileCredentialBoundary};
