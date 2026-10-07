//! Trusted optional Network mount using the canonical Core Access allocation.
use crate::{
    access as a,
    app::Core,
    config::providers::network::NetworkSettings,
    providers::network::{self as n, host_runtime as native},
};
use std::{collections::BTreeSet, sync::Arc};

/// Typed configured selectors are data. Each fresh request still captures real
/// original grants; the native owner checks the complete generation membership.
pub struct NetworkBinding {
    access: Arc<native::NetworkAccess>,
    runtime: Arc<native::HostNetworkRuntime>,
    entities: Vec<a::SourceRef>,
}
impl NetworkBinding {
    pub fn from_trusted_configuration(
        core: &Core,
        settings: NetworkSettings,
        entities: Vec<a::SourceRef>,
    ) -> Result<Self, n::NetworkError> {
        let source = settings.configured_source();
        let scope = source.partition();
        let mut unique = BTreeSet::new();
        for reference in &entities {
            let key = serde_json::to_string(reference)
                .map_err(|_| n::NetworkError::new(n::ErrorCode::InvalidSchema))?;
            if !unique.insert(key) {
                return Err(n::NetworkError::new(n::ErrorCode::InvalidSchema));
            }
        }
        if entities.len() > 10_000
            || !core.homes.iter().any(|home| {
                home.scope.workspace_id == scope.workspace_id.as_str()
                    && home.scope.home_id == scope.home_id.as_str()
            })
            || entities.iter().any(|reference| {
                !source.contains(reference)
                    || !matches!(
                        reference.key.source_kind,
                        a::SourceKind::NetworkDevice
                            | a::SourceKind::NetworkGroup
                            | a::SourceKind::NetworkInterface
                            | a::SourceKind::NetworkSegment
                    )
            })
        {
            return Err(n::NetworkError::new(n::ErrorCode::WrongScope));
        }
        let access =
            native::NetworkAccess::from_shared(a::SharedAccess::from_existing(core.access.clone()));
        Ok(Self {
            access,
            runtime: Arc::new(native::HostNetworkRuntime::open(settings)?),
            entities,
        })
    }
    pub fn access(&self) -> &Arc<native::NetworkAccess> {
        &self.access
    }
    pub fn runtime(&self) -> &Arc<native::HostNetworkRuntime> {
        &self.runtime
    }
    pub fn entities(&self) -> &[a::SourceRef] {
        &self.entities
    }
}
