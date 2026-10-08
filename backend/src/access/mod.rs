//! Local session, current principal, and source authority boundary.
//!
//! Handles are server-only capabilities, not wire contracts. This module owns
//! its access SQLite connection; callers receive only typed authorization hooks.

mod boundary;
mod credentials;
mod error;
mod existing;
mod lifecycle;
mod network;
mod read;
mod recovery;
mod shared;
mod source;
mod store;
mod types;

pub use boundary::{AccessBoundary, AccessConfig, AccessLimits, TransactionAuthorization};
pub use credentials::{PasswordVerifier, hash_password};
pub use error::{AccessError, AccessResult};
pub use lifecycle::{LifecycleCapability, LifecycleGrant, LifecyclePolicy, LifecycleRule};
pub use network::{
    NetworkLinkGrant, NetworkLinkRef, NetworkObservationGrant, NetworkObservationRef,
};
pub use recovery::{OfflineRecoveryApproval, OfflineRecoveryAuthority, RecoveryDiscoveryGrant};
pub use shared::SharedAccess;
pub use types::{
    Action, CanonicalId, Capability, Method, PartitionGrant, PartitionMode, Principal,
    PrincipalView, RequestEvidence, Role, Scope, SessionInfo, SessionReceipt, SourceGrant,
    SourceKey, SourceKind, SourceOwner, SourcePartition, SourceRef, SourceRegistration,
};

pub const SESSION_COOKIE: &str = "__Host-houseatlas-session";
pub const ACCESS_SCHEMA_VERSION: i64 = 1;

#[cfg(test)]
mod healthy;

#[cfg(test)]
mod recovery_healthy;

#[cfg(test)]
mod network_healthy;

#[cfg(test)]
mod shared_healthy;
