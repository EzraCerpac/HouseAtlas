//! Trusted process-local composition of the existing canonical access issuer.

use std::sync::{Arc, Mutex, MutexGuard};

use super::{AccessBoundary, AccessError, AccessResult};

/// Clones share the supplied canonical boundary, its mutex and complete state.
/// No database, principal, policy or replacement issuer is constructed here.
/// This is a trusted host handle, never a request DTO or provider capability.
#[derive(Clone)]
pub struct SharedAccess {
    boundary: Arc<Mutex<AccessBoundary>>,
}

impl SharedAccess {
    /// Wrap the SAME handle already used by Core/MCP. Moving the Arc preserves
    /// its allocation and the boundary's private issuer identity. It neither
    /// reopens persistence nor recreates principals or grants.
    pub fn from_existing(boundary: Arc<Mutex<AccessBoundary>>) -> Self {
        Self { boundary }
    }

    /// Borrow the exact canonical host handle for existing Core/lifecycle APIs
    /// that accept Arc<Mutex<AccessBoundary>>. Cloning it shares the same issuer;
    /// neither this handle nor the guarded boundary exposes its raw database.
    pub fn as_existing(&self) -> &Arc<Mutex<AccessBoundary>> {
        &self.boundary
    }

    /// Typed access to the canonical boundary. Mutex contention/poison maps to
    /// sanitized Unavailable without waiting, clearing poison or using a peer.
    /// Boundary operations remain synchronous SQLite/scrypt work; release this
    /// guard before provider I/O/await and avoid reentering the same mutex.
    pub fn try_lock(&self) -> AccessResult<MutexGuard<'_, AccessBoundary>> {
        self.boundary
            .try_lock()
            .map_err(|_| AccessError::Unavailable)
    }
}
