//! One actual encrypted store allocation shared by lifecycle, models and HTTP.
use crate::ai::{
    AiError, PortFuture,
    host::{credentials::NativeCredentialAuthority, native::NativeHostContext},
    oauth::{CredentialBoundary, RegistrationBinding, RegistrationRecord},
};
use std::sync::Arc;

pub type NativeCredentialStore = crate::credential_boundary::FileCredentialBoundary<
    NativeHostContext,
    NativeCredentialAuthority<NativeHostContext>,
>;
pub type NativeCredentialLease = crate::credential_boundary::CredentialLease<
    crate::ai::host::enrollment::OriginalEnrollment,
    crate::ai::host::enrollment::StoppedEnrollment,
>;
#[derive(Clone)]
pub struct StartupCredentials(pub(super) Arc<NativeCredentialStore>);
impl CredentialBoundary<NativeHostContext> for StartupCredentials {
    type Lease = NativeCredentialLease;
    fn acquire<'a>(
        &'a self,
        context: &'a NativeHostContext,
        binding: &'a RegistrationBinding,
    ) -> PortFuture<'a, Self::Lease> {
        self.0.acquire(context, binding)
    }
    fn load<'a>(&'a self, lease: &'a Self::Lease) -> PortFuture<'a, RegistrationRecord> {
        self.0.load(lease)
    }
    fn persist_atomic<'a>(
        &'a self,
        lease: &'a mut Self::Lease,
        record: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        self.0.persist_atomic(lease, record)
    }
    fn revalidate<'a>(
        &'a self,
        context: &'a NativeHostContext,
        lease: &'a Self::Lease,
        binding: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        self.0.revalidate(context, lease, binding)
    }
    fn stop_use<'a>(&'a self, lease: &'a mut Self::Lease) -> PortFuture<'a, ()> {
        self.0.stop_use(lease)
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        self.0.now_ms()
    }
}
