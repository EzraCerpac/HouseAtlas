//! Immutable received-checkpoint correlation around the existing credential
//! lease and lifecycle. It grants no verification, activation or epoch rebase.
use crate::ai::{
    AiError, PortFuture,
    oauth::{CredentialBoundary, RefreshCheckpoint, RegistrationBinding, RegistrationRecord},
};

pub(super) struct BoundExchange<'a, B> {
    pub inner: &'a B,
    pub binding: &'a RegistrationBinding,
    pub nonce_digest: &'a str,
}
impl<C, B: CredentialBoundary<C>> CredentialBoundary<C> for BoundExchange<'_, B> {
    type Lease = B::Lease;
    fn acquire<'a>(&'a self, c: &'a C, b: &'a RegistrationBinding) -> PortFuture<'a, Self::Lease> {
        self.inner.acquire(c, b)
    }
    fn load<'a>(&'a self, lease: &'a Self::Lease) -> PortFuture<'a, RegistrationRecord> {
        let loaded = self.inner.load(lease);
        Box::pin(async move {
            let record = loaded.await?;
            match &record.refresh_checkpoint {
                RefreshCheckpoint::ExchangeReceived { binding, nonce, .. }
                    if binding == self.binding
                        && super::lifecycle::state_digest(nonce.expose_in_trusted_boundary())
                            == self.nonce_digest => {}
                _ => return Err(AiError::ConnectionUnavailable),
            }
            Ok(record)
        })
    }
    fn persist_atomic<'a>(
        &'a self,
        lease: &'a mut Self::Lease,
        r: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        self.inner.persist_atomic(lease, r)
    }
    fn revalidate<'a>(
        &'a self,
        c: &'a C,
        lease: &'a Self::Lease,
        b: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        self.inner.revalidate(c, lease, b)
    }
    fn stop_use<'a>(&'a self, lease: &'a mut Self::Lease) -> PortFuture<'a, ()> {
        self.inner.stop_use(lease)
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        self.inner.now_ms()
    }
}
