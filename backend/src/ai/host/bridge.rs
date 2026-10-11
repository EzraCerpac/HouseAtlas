//! Exact bridge admission around original app authority, never a LAN listener.
use super::{HostAuthority, valid_id};
use crate::ai::{
    AiError,
    oauth::ProtectedValue,
    runtime::{BridgeRequest, RuntimeBridgePort, RuntimeTurnBinding},
};
use subtle::ConstantTimeEq;

pub struct BridgeAdmission<A> {
    authority: A,
    origin: String,
    host: String,
    capability: ProtectedValue,
}
impl<A> BridgeAdmission<A> {
    pub fn new(
        authority: A,
        origin: String,
        host: String,
        capability: ProtectedValue,
    ) -> Result<Self, AiError> {
        let origin_uri = url::Url::parse(&origin).map_err(|_| AiError::InvalidInput)?;
        let host_uri =
            url::Url::parse(&format!("http://{host}/")).map_err(|_| AiError::InvalidInput)?;
        let loopback = match host_uri.host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if !loopback
            || host_uri.port().is_none()
            || host_uri.path() != "/"
            || host_uri.query().is_some()
            || host_uri.fragment().is_some()
            || !host_uri.username().is_empty()
            || host_uri.password().is_some()
            || origin_uri.origin().ascii_serialization() != origin
            || origin_uri.scheme() != "https"
            || capability.expose_in_trusted_boundary().len() < 32
        {
            return Err(AiError::InvalidInput);
        }
        Ok(Self {
            authority,
            origin,
            host,
            capability,
        })
    }
}
impl<C, A: HostAuthority<C>> RuntimeBridgePort<C> for BridgeAdmission<A> {
    fn admit(
        &self,
        context: &C,
        request: &BridgeRequest<'_>,
    ) -> Result<RuntimeTurnBinding, AiError> {
        let binding = self.authority.binding(context)?;
        self.authority.revalidate(context, &binding)?;
        let matches: bool = self
            .capability
            .expose_in_trusted_boundary()
            .as_bytes()
            .ct_eq(
                request
                    .installation_capability
                    .expose_in_trusted_boundary()
                    .as_bytes(),
            )
            .into();
        if !matches
            || request.origin != self.origin
            || request.host != self.host
            || request.registration_id != binding.registration_id
            || request.cancellation_epoch != binding.cancellation_epoch
            || !valid_id(request.request_id)
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(RuntimeTurnBinding {
            actor_id: binding.actor_id,
            workspace_id: binding.workspace_id,
            home_id: binding.home_id,
            registration_id: binding.registration_id,
            cancellation_epoch: binding.cancellation_epoch,
            request_id: request.request_id.into(),
        })
    }
}
