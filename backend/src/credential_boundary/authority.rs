//! Original application authority required by encrypted credential persistence.
//!
//! The host implements this using its existing enrollment/session/cancellation
//! owner. An implementation must not issue a second authority from record data
//! or reuse the receipt-only capture that permits newer cancellation epochs.

use crate::ai::{AiError, oauth::RegistrationBinding};

/// Delegation to the same trusted owner used by the application's AI host.
/// No default implementation can silently substitute an allow-all authority.
pub trait CredentialAuthority<C>: Send + Sync {
    /// Original opaque principal/session and registration proof retained for the
    /// entire lease. Neither record labels nor a fresh receipt establish it.
    type Original: Send + Sync;
    /// Owner-issued narrow proof of completed local stop and cancellation
    /// rotation. It permits only terminal bookkeeping under the original lease.
    type Stopped: Send + Sync;

    fn retain(&self, context: &C, binding: &RegistrationBinding)
    -> Result<Self::Original, AiError>;
    fn revalidate(
        &self,
        context: &C,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError>;
    fn revalidate_retained(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError>;
    /// Stop local use and advance cancellation before returning the capability.
    /// Failure must not claim that either action completed.
    fn stop_use(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<Self::Stopped, AiError>;
    fn revalidate_stopped(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
        stopped: &Self::Stopped,
    ) -> Result<(), AiError>;
    /// Hold the original owner's current epoch/stop guard through this bounded
    /// filesystem commit, excluding authority changes during the callback.
    /// Run it at most once and only after validating the exact original proof.
    /// This is never inference, dispatch, reconnect, or receipt authorization.
    fn with_persistence_fence<T, F>(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
        stopped: Option<&Self::Stopped>,
        commit: F,
    ) -> Result<T, AiError>
    where
        F: FnOnce() -> Result<T, AiError>;
}
