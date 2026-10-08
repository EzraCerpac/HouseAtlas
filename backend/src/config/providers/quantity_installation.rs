//! Explicit trusted startup inputs. These data select an installation and
//! policy; only original artifact custody and current native fences admit use.
use super::{homebox::TrustedHomeBoxSource, registry::ConfiguredSource};
use crate::{
    access, app,
    jobs::QueueConfig,
    providers::homebox::{read::NativeReadCredentialConfig, write::stock as native},
    storage,
};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuantityConfigurationError {
    InvalidConfiguration,
    Unavailable,
}
impl std::fmt::Display for QuantityConfigurationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Quantity installation configuration is unavailable")
    }
}
impl std::error::Error for QuantityConfigurationError {}

/// Operator-selected paths only. No lookup, network or file read occurs here.
pub struct QuantityInstallationArtifacts {
    executable: PathBuf,
    build_provenance: PathBuf,
    entity_repository: PathBuf,
    entity_handler: PathBuf,
    swagger: PathBuf,
}
impl QuantityInstallationArtifacts {
    pub fn new(
        executable: PathBuf,
        build_provenance: PathBuf,
        entity_repository: PathBuf,
        entity_handler: PathBuf,
        swagger: PathBuf,
    ) -> Result<Self, QuantityConfigurationError> {
        let paths = [
            &executable,
            &build_provenance,
            &entity_repository,
            &entity_handler,
            &swagger,
        ];
        if paths.iter().any(|path| {
            !path.is_absolute()
                || path
                    .components()
                    .any(|part| matches!(part, Component::ParentDir))
                || path.as_os_str().as_encoded_bytes().len() > 4096
        }) || paths.iter().collect::<BTreeSet<_>>().len() != paths.len()
        {
            return Err(QuantityConfigurationError::InvalidConfiguration);
        }
        Ok(Self {
            executable,
            build_provenance,
            entity_repository,
            entity_handler,
            swagger,
        })
    }
    pub fn executable(&self) -> &Path {
        &self.executable
    }
    pub fn build_provenance(&self) -> &Path {
        &self.build_provenance
    }
    pub fn entity_repository(&self) -> &Path {
        &self.entity_repository
    }
    pub fn entity_handler(&self) -> &Path {
        &self.entity_handler
    }
    pub fn swagger(&self) -> &Path {
        &self.swagger
    }
}

/// Explicit reviewed host selection. No Deserialize or browser constructor.
/// Account/group/deployment correspondence is a required operator fact, not a
/// deduction from these fields, a credential header or an Editor role.
pub struct QuantityInstallationInput {
    pub descriptor: native::QuantityProfileDescriptor,
    pub artifacts: QuantityInstallationArtifacts,
    pub reviewed_policy: Value,
    pub queue: QueueConfig,
    pub physical: storage::StockActivityPhysicalRegistration,
}

/// One immutable original startup allocation. The application constructor
/// captures its actual Store token and Access/source/credential allocations.
/// Public descriptor getters return matching data and cannot issue admission.
pub struct OriginalQuantityConfigured {
    source: Arc<ConfiguredSource>,
    homebox: Arc<TrustedHomeBoxSource>,
    credentials: Arc<NativeReadCredentialConfig>,
    access: Arc<Mutex<access::AccessBoundary>>,
    _store_owner: Arc<Mutex<app::Store>>,
    store_identity: storage::QuantityInstallationStoreIdentity,
    input: QuantityInstallationInput,
}
impl OriginalQuantityConfigured {
    pub(crate) fn from_trusted_startup(
        core: &app::Core,
        source: Arc<ConfiguredSource>,
        homebox: Arc<TrustedHomeBoxSource>,
        credentials: Arc<NativeReadCredentialConfig>,
        input: QuantityInstallationInput,
    ) -> Result<Arc<Self>, QuantityConfigurationError> {
        let invalid = || QuantityConfigurationError::InvalidConfiguration;
        let e = &input.descriptor;
        input.queue.validate().map_err(|_| invalid())?;
        // Validate expected DATA without turning its public Qualified enum or
        // digests into installation authority. This profile remains unadmitted.
        let checked = native::QuantityProfile::production(native::QuantityProfileDescriptor {
            source_commit: e.source_commit.clone(),
            version: e.version.clone(),
            build_digest: e.build_digest.clone(),
            catalog_digest: e.catalog_digest.clone(),
            route_digest: e.route_digest.clone(),
            group_id: e.group_id.clone(),
            account_id: e.account_id.clone(),
            scope: e.scope.clone(),
            target: e.target.clone(),
            metadata: e.metadata.clone(),
            authority: e.authority.clone(),
            dispatcher_epoch: e.dispatcher_epoch,
            policy_digest: e.policy_digest.clone(),
            policy: e.policy,
            freshness: e.freshness,
        })
        .map_err(|_| invalid())?;
        drop(checked);
        let policy_bytes = serde_json::to_vec(&input.reviewed_policy).map_err(|_| invalid())?;
        let policy_digest = crate::contracts::semantics::canonical_digest(&input.reviewed_policy)
            .map_err(|_| invalid())?;
        let partition = source.partition();
        let physical = &input.physical;
        let queue = &input.queue.registration;
        if policy_bytes.is_empty()
            || policy_bytes.len() > 65_536
            || !input.reviewed_policy.is_object()
            || policy_digest != e.policy_digest.as_str()
            || source.registration() != homebox.registration()
            || source.access_registration() != e.metadata.registration()
            || homebox.metadata_dialect() != crate::providers::homebox::wire::DIALECT
            || !credentials.matches_endpoint(&homebox.endpoint().map_err(|_| invalid())?)
            || !core.homes.iter().any(|home| {
                home.scope.workspace_id == e.scope.workspace_id.to_string()
                    && home.scope.home_id == e.scope.home_id.to_string()
            })
            || physical.physical_binding != e.authority.physical_binding
            || physical.dispatcher_epoch != e.dispatcher_epoch
            || physical.owner_id.is_nil()
            || queue.identity.deployment_id != physical.physical_binding.deployment_id.to_string()
            || queue.identity.physical_database_id
                != physical.physical_binding.physical_database_id.to_string()
            || queue.identity.configuration_digest.as_hex()
                != physical.physical_binding.configuration_digest.as_str()
            || queue.dispatcher_owner_id != physical.owner_id.to_string()
            || input.queue.registration.aliases.len() > 1000
            || queue
                .aliases
                .iter()
                .filter(|alias| {
                    alias.partition.workspace_id == partition.workspace_id.as_str()
                        && alias.partition.home_id == partition.home_id.as_str()
                        && alias.partition.source_instance_id
                            == partition.source_instance_id.as_str()
                        && alias.partition.collection_id == partition.collection_id
                })
                .count()
                != 1
        {
            return Err(invalid());
        }
        let target = access::SourceRef {
            workspace_id: partition.workspace_id.clone(),
            home_id: partition.home_id.clone(),
            key: access::SourceKey {
                source_instance_id: partition.source_instance_id.clone(),
                collection_id: partition.collection_id.clone(),
                source_kind: access::SourceKind::HomeboxEntity,
                external_id: e.target.id().map_err(|_| invalid())?.to_string(),
            },
        };
        if !source.contains(&target) {
            return Err(invalid());
        }
        let store_identity = {
            let store = core
                .store
                .try_lock()
                .map_err(|_| QuantityConfigurationError::Unavailable)?;
            if !Arc::ptr_eq(&store.configured_authorization().0, &core.access) {
                return Err(invalid());
            }
            store.quantity_installation_store_identity()
        };
        Ok(Arc::new(Self {
            source,
            homebox,
            credentials,
            access: Arc::clone(&core.access),
            _store_owner: Arc::clone(&core.store),
            store_identity,
            input,
        }))
    }
    pub fn source(&self) -> &Arc<ConfiguredSource> {
        &self.source
    }
    pub fn homebox(&self) -> &Arc<TrustedHomeBoxSource> {
        &self.homebox
    }
    pub fn credentials(&self) -> &Arc<NativeReadCredentialConfig> {
        &self.credentials
    }
    pub fn access(&self) -> &Arc<Mutex<access::AccessBoundary>> {
        &self.access
    }
    pub fn store_identity(&self) -> &storage::QuantityInstallationStoreIdentity {
        &self.store_identity
    }
    pub fn queue(&self) -> &QueueConfig {
        &self.input.queue
    }
    pub fn physical(&self) -> &storage::StockActivityPhysicalRegistration {
        &self.input.physical
    }
    pub fn metadata(&self) -> &access::SourceAuthorityMetadata {
        &self.input.descriptor.metadata
    }
    pub fn descriptor(&self) -> &native::QuantityProfileDescriptor {
        &self.input.descriptor
    }
    pub fn artifacts(&self) -> &QuantityInstallationArtifacts {
        &self.input.artifacts
    }
    pub fn reviewed_policy(&self) -> &Value {
        &self.input.reviewed_policy
    }
}
