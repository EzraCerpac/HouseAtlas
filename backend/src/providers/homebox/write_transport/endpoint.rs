use super::{TransportFault, stock};
use url::Url;
use uuid::Uuid;

/// Immutable host registry snapshot, not values accepted from wire input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatchBinding {
    pub context: stock::Context,
    pub source_instance_id: Uuid,
    pub collection_id: Uuid,
    pub physical_binding: stock::PhysicalBinding,
    pub owner_id: Uuid,
    pub dispatcher_epoch: u64,
    pub source_epoch: u64,
    pub qualification: stock::NativeQualification,
}

pub struct SourceEndpoint {
    pub(crate) origin: Url,
    pub(crate) binding: DispatchBinding,
    pub(crate) fixture: bool,
}
impl SourceEndpoint {
    /// The registry owner supplies genuine exact build/route qualification.
    /// Source pins or this constructor alone do not qualify a deployed provider.
    pub fn https(origin: &str, binding: DispatchBinding) -> Result<Self, TransportFault> {
        if !matches!(
            binding.qualification,
            stock::NativeQualification::Qualified { .. }
        ) {
            return Err(TransportFault::Binding);
        }
        let endpoint = Self::parse(origin, binding, false)?;
        if endpoint.origin.scheme() != "https" {
            return Err(TransportFault::Configuration);
        }
        Ok(endpoint)
    }
    fn parse(
        origin: &str,
        binding: DispatchBinding,
        fixture: bool,
    ) -> Result<Self, TransportFault> {
        fluent_uri::Uri::parse(origin).map_err(|_| TransportFault::Configuration)?;
        let origin = Url::parse(origin).map_err(|_| TransportFault::Configuration)?;
        if !origin.username().is_empty()
            || origin.password().is_some()
            || origin.host().is_none()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
            || [
                binding.context.workspace_id,
                binding.context.home_id,
                binding.source_instance_id,
                binding.collection_id,
                binding.physical_binding.deployment_id,
                binding.physical_binding.physical_database_id,
                binding.owner_id,
            ]
            .iter()
            .any(Uuid::is_nil)
            || binding.source_epoch == 0
            || binding.dispatcher_epoch == 0
        {
            return Err(TransportFault::Configuration);
        }
        Ok(Self {
            origin,
            binding,
            fixture,
        })
    }
    pub fn origin(&self) -> &Url {
        &self.origin
    }
    pub fn binding(&self) -> &DispatchBinding {
        &self.binding
    }

    pub(crate) fn check(
        &self,
        permit: &stock::InvocationPermit,
        plan: &stock::NativePlan,
        authority: &stock::StockAuthority,
    ) -> Result<(), TransportFault> {
        let b = &self.binding;
        if permit.operation_id.is_nil()
            || permit.actor_id.is_nil()
            || permit.actor_id != authority.actor_id
            || permit.owner_id != b.owner_id
            || permit.dispatcher_epoch != b.dispatcher_epoch
            || permit.source_epoch != b.source_epoch
            || authority.source_epoch != b.source_epoch
            || permit.physical_binding != b.physical_binding
            || authority.physical_binding != b.physical_binding
            || permit.qualification != b.qualification
            || authority.qualification != b.qualification
            || plan.readback.target.source_instance_id != b.source_instance_id
            || plan.readback.target.collection_id != b.collection_id
            || (!self.fixture
                && !matches!(
                    b.qualification,
                    stock::NativeQualification::Qualified { .. }
                ))
        {
            return Err(TransportFault::Binding);
        }
        let value = serde_json::to_value(plan).map_err(|_| TransportFault::Binding)?;
        let digest = crate::contracts::semantics::canonical_digest(&value)
            .map_err(|_| TransportFault::Binding)?;
        if digest != permit.plan_digest.as_str() {
            return Err(TransportFault::Binding);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn loopback(origin: &str, binding: DispatchBinding) -> Result<Self, TransportFault> {
        let endpoint = Self::parse(origin, binding, true)?;
        let loopback = match endpoint.origin.host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if !loopback
            || endpoint.origin.scheme() != "http"
            || endpoint.binding.qualification != stock::NativeQualification::SyntheticFixture
        {
            return Err(TransportFault::Configuration);
        }
        Ok(endpoint)
    }
}
