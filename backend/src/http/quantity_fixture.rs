//! Test-only per-client TLS custody for one already-selected original source.
use crate::{config::providers::quantity_installation::OriginalQuantityConfigured, storage};
use std::sync::Arc;

pub(super) struct PrivateLoopbackQuantityTls {
    configured: Arc<OriginalQuantityConfigured>,
    certificate_der: Vec<u8>,
}
impl PrivateLoopbackQuantityTls {
    pub(super) fn certificate_for(
        &self,
        configured: &Arc<OriginalQuantityConfigured>,
    ) -> Option<&[u8]> {
        Arc::ptr_eq(&self.configured, configured).then_some(self.certificate_der.as_slice())
    }
}
impl super::Host {
    pub(crate) fn with_quantity_tls_fixture(
        mut self,
        configured: Arc<OriginalQuantityConfigured>,
        certificate_der: Vec<u8>,
    ) -> storage::Result<Self> {
        let invalid =
            || storage::Error::new("invalid-fixture", "Selected loopback TLS source required");
        if self.quantity_tls_fixture.is_some()
            || !self
                .quantity_installations
                .iter()
                .any(|selected| Arc::ptr_eq(selected, &configured))
            || certificate_der.is_empty()
            || certificate_der.len() > 64 * 1024
        {
            return Err(invalid());
        }
        let endpoint = configured.homebox().endpoint().map_err(|_| invalid())?;
        let loopback = match endpoint.origin().host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if endpoint.origin().scheme() != "https" || !loopback {
            return Err(invalid());
        }
        let certificate =
            reqwest::Certificate::from_der(&certificate_der).map_err(|_| invalid())?;
        // Building validates the root bytes without connecting or installing trust.
        reqwest::Client::builder()
            .no_proxy()
            .tls_certs_only([certificate])
            .build()
            .map_err(|_| invalid())?;
        self.quantity_tls_fixture = Some(Arc::new(PrivateLoopbackQuantityTls {
            configured,
            certificate_der,
        }));
        Ok(self)
    }
}
