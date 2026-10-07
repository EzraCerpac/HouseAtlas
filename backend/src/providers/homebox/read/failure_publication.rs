//! Retained original handles for explicit, currently authorized failure CAS.
use super::*;
use crate::storage::{self, AtlasStore, Authorization, Contract, Runtime};
use std::fmt;

/// Constructed only when the prepared full reader returns a failure proposal.
/// No Clone/Deserialize/raw constructor or mutable handle/proposal accessor.
pub struct FailedPublication<'a, P> {
    pub(super) principal: &'a P,
    pub(super) fence: storage::CachePublicationFence,
    pub(super) failure: FailedRead,
}
impl<P> fmt::Debug for FailedPublication<'_, P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FailedPublication")
            .field("code", &self.failure.error.code)
            .finish_non_exhaustive()
    }
}
impl<P> fmt::Display for FailedPublication<'_, P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.failure, f)
    }
}
impl<P> std::error::Error for FailedPublication<'_, P> {}
impl<'a, P> FailedPublication<'a, P> {
    pub fn failure(&self) -> &FailedRead {
        &self.failure
    }
    pub fn principal(&self) -> &'a P {
        self.principal
    }
    pub fn fence(&self) -> &storage::CachePublicationFence {
        &self.fence
    }
    /// Explicit handoff only. Native storage checks current authority, original
    /// issuer/registration, baseline generation/cache epoch, and revalidates the
    /// actor before commit. Host grant revalidation remains the host's obligation.
    /// Storage supplies durable timestamps and sanitized messages, preserving
    /// retained projections/generation. No unfenced status operation is used.
    pub fn commit_failure<C: Contract, A: Authorization<Principal = P>, R: Runtime>(
        self,
        store: &mut AtlasStore<C, A, R>,
    ) -> Result<storage::CacheStatus, PublishError> {
        let failure = self.failure_values()?;
        store
            .record_prepared_cache_failure(self.principal, self.fence, &failure)
            .map_err(|_| PublishError::StoreRejected)
    }
    /// Explicit same-store call with the host's current borrowed authority.
    /// No principal substitution, private fence extraction or unfenced fallback.
    pub fn commit_failure_with_authorization<
        C: Contract,
        A: Authorization,
        R: Runtime,
        B: Authorization<Principal = P>,
    >(
        self,
        store: &mut AtlasStore<C, A, R>,
        authorization: &B,
    ) -> Result<storage::CacheStatus, PublishError> {
        let failure = self.failure_values()?;
        store
            .record_prepared_cache_failure_with_authorization(
                authorization,
                self.principal,
                self.fence,
                &failure,
            )
            .map_err(|_| PublishError::StoreRejected)
    }
    fn failure_values(&self) -> Result<storage::CacheFailure, PublishError> {
        // Invalid retained state yields no writable cache proposal in the reader.
        let status = match self.failure.cache.as_deref().map(|cache| cache.status) {
            Some(CacheState::Error) => storage::FailureStatus::Error,
            Some(CacheState::Stale) => storage::FailureStatus::Stale,
            Some(CacheState::AccessRevoked) => storage::FailureStatus::AccessRevoked,
            _ => return Err(PublishError::InvalidRetainedState),
        };
        let code = match self.failure.error.code {
            ErrorCode::Timeout => storage::FailureCode::Timeout,
            ErrorCode::Auth => storage::FailureCode::Auth,
            ErrorCode::WrongScope => storage::FailureCode::WrongScope,
            ErrorCode::InvalidSchema => storage::FailureCode::InvalidSchema,
            ErrorCode::Pagination => storage::FailureCode::Pagination,
            ErrorCode::SizeLimit => storage::FailureCode::SizeLimit,
            ErrorCode::Transport => storage::FailureCode::Transport,
            ErrorCode::Upstream => storage::FailureCode::Upstream,
        };
        Ok(storage::CacheFailure {
            code,
            status: Some(status),
        })
    }
}
