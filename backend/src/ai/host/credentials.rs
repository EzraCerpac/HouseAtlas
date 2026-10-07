//! Actual PR98 authority bridge over the same native enrollment owner.
use super::{
    enrollment::{EnrollmentOwner, OriginalEnrollment, StoppedEnrollment, TrustedRegistration},
    native::{NativeHostContext, RegistrationAuthority},
};
use crate::{
    ai::{AiError, oauth::RegistrationBinding},
    credential_boundary::{CredentialAuthority, FileCredentialBoundary},
};
use std::sync::Arc;

/// The extractor borrows the original native context; it cannot mint a new
/// principal, refresh a receipt proof or choose another registration binding.
pub struct NativeCredentialAuthority<C> {
    owner: Arc<EnrollmentOwner>,
    native: fn(&C) -> &NativeHostContext,
}
impl<C> NativeCredentialAuthority<C> {
    pub fn new(owner: Arc<EnrollmentOwner>, native: fn(&C) -> &NativeHostContext) -> Self {
        Self { owner, native }
    }
    fn context<'a>(
        &self,
        context: &'a C,
        binding: &RegistrationBinding,
    ) -> Result<&'a NativeHostContext, AiError> {
        let native = (self.native)(context);
        if native.registration() != binding {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(native)
    }
    /// Explicit trusted first-record operation; never a browser/Connect fallback.
    /// The same owner must already contain this existing approved configuration.
    /// PR98's enrollment API creates only absent authenticated ciphertext under
    /// its exclusive lease and original proof/fence; it provisions no native key.
    pub async fn enroll_initial_record(
        &self,
        boundary: &FileCredentialBoundary<C, Self>,
        context: &C,
        registration: &TrustedRegistration,
    ) -> Result<(), AiError>
    where
        C: Sync,
    {
        let native = self.context(context, registration.binding())?;
        let record = self.owner.initial_record(native.original(), registration)?;
        let lease = boundary
            .enroll_atomic(context, registration.binding(), &record)
            .await?;
        drop(lease);
        Ok(())
    }
}
impl<C> CredentialAuthority<C> for NativeCredentialAuthority<C> {
    type Original = OriginalEnrollment;
    type Stopped = StoppedEnrollment;
    fn retain(
        &self,
        context: &C,
        binding: &RegistrationBinding,
    ) -> Result<Self::Original, AiError> {
        self.owner
            .retain(self.context(context, binding)?.original(), binding)
    }
    fn revalidate(
        &self,
        context: &C,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        // Current context must still have actual native authority. Crucially,
        // the captured original proof is also checked, never replaced by this.
        self.owner
            .revalidate(self.context(context, binding)?.original(), binding)?;
        self.owner.revalidate_original(original, binding)
    }
    fn revalidate_retained(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        self.owner.revalidate_original(original, binding)
    }
    fn stop_use(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
    ) -> Result<Self::Stopped, AiError> {
        self.owner.stop_original(original, binding)
    }
    fn revalidate_stopped(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
        stopped: &Self::Stopped,
    ) -> Result<(), AiError> {
        self.owner.revalidate_stopped(original, binding, stopped)
    }
    fn with_persistence_fence<T, F>(
        &self,
        original: &Self::Original,
        binding: &RegistrationBinding,
        stopped: Option<&Self::Stopped>,
        commit: F,
    ) -> Result<T, AiError>
    where
        F: FnOnce() -> Result<T, AiError>,
    {
        self.owner
            .with_persistence_fence(original, binding, stopped, commit)
    }
}
