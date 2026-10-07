//! Typed configuration consumption of the sibling async HTTP transport.
//! Matching a registration is not a jobs-to-stock activity/permit adapter.
use super::TrustedDispatcherConfig;
use crate::providers::homebox::write_transport::{
    DispatchBinding, DispatchResources, HttpDispatcher, Limits, SourceEndpoint, TransportFault,
};

/// Reviewed registry settings only: no request-selected endpoint, credential,
/// grant, default limits or inferred build/route qualification.
pub struct TrustedStockHttpConfig {
    endpoint: SourceEndpoint,
    limits: Limits,
}

impl TrustedStockHttpConfig {
    /// Check that the transport's complete partition, physical configuration
    /// and owner identify the same registered deployment queue. This does not
    /// translate a jobs lease into a stock permit or claim durable stock
    /// activity coverage. The activity owner must supply that accepted mapping.
    pub fn new(
        queue: &TrustedDispatcherConfig,
        origin: &str,
        binding: DispatchBinding,
        limits: Limits,
    ) -> Result<Self, TransportFault> {
        let registration = &queue.queue().registration;
        let physical = &binding.physical_binding;
        if registration.identity.deployment_id != physical.deployment_id.to_string()
            || registration.identity.physical_database_id
                != physical.physical_database_id.to_string()
            || registration.identity.configuration_digest.as_hex()
                != physical.configuration_digest.as_str()
            || registration.dispatcher_owner_id != binding.owner_id.to_string()
            || !registration.aliases.iter().any(|alias| {
                let partition = &alias.partition;
                partition.workspace_id == binding.context.workspace_id.to_string()
                    && partition.home_id == binding.context.home_id.to_string()
                    && partition.source_instance_id == binding.source_instance_id.to_string()
                    && partition.collection_id == binding.collection_id.to_string()
            })
        {
            return Err(TransportFault::Binding);
        }
        // The accepted transport validates HTTPS and genuine qualified binding;
        // this host never converts a source pin or fixture into qualification.
        let endpoint = SourceEndpoint::https(origin, binding)?;
        Ok(Self { endpoint, limits })
    }

    pub fn binding(&self) -> &DispatchBinding {
        self.endpoint.binding()
    }

    /// Construct the actual async StockDispatchPort. Resources must revalidate
    /// ORIGINAL captured authority and fetch only already-admitted stage bytes.
    /// No network operation runs during this construction. The caller supplies
    /// the distinct accepted StockActivityPort when constructing StockWriter.
    pub fn into_http<P: DispatchResources>(
        self,
        resources: P,
    ) -> Result<HttpDispatcher<P>, TransportFault> {
        HttpDispatcher::new(self.endpoint, resources, self.limits)
    }
}
