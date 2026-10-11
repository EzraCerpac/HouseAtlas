//! Explicit trusted selection for an optional queued attachment upload.
//! These immutable data and paths are not captured artifacts or admission.
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
pub enum QueuedUploadConfigurationError {
    InvalidConfiguration,
    Unavailable,
}
impl std::fmt::Display for QueuedUploadConfigurationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Queued upload installation configuration is unavailable")
    }
}
impl std::error::Error for QueuedUploadConfigurationError {}

/// Operator-selected immutable path set. No artifact is opened here.
pub struct QueuedUploadInstallationArtifacts {
    executable: PathBuf,
    build_provenance: PathBuf,
    effective_configuration: PathBuf,
    entity_repository: PathBuf,
    entity_handler: PathBuf,
    attachment_repository: PathBuf,
    attachment_handler: PathBuf,
    attachment_service: PathBuf,
    attachment_schema: PathBuf,
    routes: PathBuf,
    configuration_schema: PathBuf,
    swagger: PathBuf,
}
impl QueuedUploadInstallationArtifacts {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        executable: PathBuf,
        build_provenance: PathBuf,
        effective_configuration: PathBuf,
        entity_repository: PathBuf,
        entity_handler: PathBuf,
        attachment_repository: PathBuf,
        attachment_handler: PathBuf,
        attachment_service: PathBuf,
        attachment_schema: PathBuf,
        routes: PathBuf,
        configuration_schema: PathBuf,
        swagger: PathBuf,
    ) -> Result<Self, QueuedUploadConfigurationError> {
        let paths = [
            &executable,
            &build_provenance,
            &effective_configuration,
            &entity_repository,
            &entity_handler,
            &attachment_repository,
            &attachment_handler,
            &attachment_service,
            &attachment_schema,
            &routes,
            &configuration_schema,
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
            return Err(QueuedUploadConfigurationError::InvalidConfiguration);
        }
        Ok(Self {
            executable,
            build_provenance,
            effective_configuration,
            entity_repository,
            entity_handler,
            attachment_repository,
            attachment_handler,
            attachment_service,
            attachment_schema,
            routes,
            configuration_schema,
            swagger,
        })
    }
    pub fn executable(&self) -> &Path {
        &self.executable
    }
    pub fn build_provenance(&self) -> &Path {
        &self.build_provenance
    }
    pub fn effective_configuration(&self) -> &Path {
        &self.effective_configuration
    }
    pub fn entity_repository(&self) -> &Path {
        &self.entity_repository
    }
    pub fn entity_handler(&self) -> &Path {
        &self.entity_handler
    }
    pub fn attachment_repository(&self) -> &Path {
        &self.attachment_repository
    }
    pub fn attachment_handler(&self) -> &Path {
        &self.attachment_handler
    }
    pub fn attachment_service(&self) -> &Path {
        &self.attachment_service
    }
    pub fn attachment_schema(&self) -> &Path {
        &self.attachment_schema
    }
    pub fn routes(&self) -> &Path {
        &self.routes
    }
    pub fn configuration_schema(&self) -> &Path {
        &self.configuration_schema
    }
    pub fn swagger(&self) -> &Path {
        &self.swagger
    }
}

pub struct QueuedUploadInstallationInput {
    pub descriptor: native::QueuedUploadProfileDescriptor,
    pub metadata: access::SourceAuthorityMetadata,
    pub artifacts: QueuedUploadInstallationArtifacts,
    pub reviewed_policy: Value,
    pub queue: QueueConfig,
    pub physical: storage::StockActivityPhysicalRegistration,
}

/// Selection and actual Store identity, never a source or physical admission.
pub struct OriginalQueuedUploadConfigured {
    source: Arc<ConfiguredSource>,
    homebox: Arc<TrustedHomeBoxSource>,
    credentials: Arc<NativeReadCredentialConfig>,
    access: Arc<Mutex<access::AccessBoundary>>,
    store_identity: storage::QuantityInstallationStoreIdentity,
    input: QueuedUploadInstallationInput,
}
impl OriginalQueuedUploadConfigured {
    pub(crate) fn from_trusted_startup(
        core: &app::Core,
        source: Arc<ConfiguredSource>,
        homebox: Arc<TrustedHomeBoxSource>,
        credentials: Arc<NativeReadCredentialConfig>,
        input: QueuedUploadInstallationInput,
    ) -> Result<Arc<Self>, QueuedUploadConfigurationError> {
        let invalid = || QueuedUploadConfigurationError::InvalidConfiguration;
        let descriptor = &input.descriptor;
        let partition = source.partition();
        let queue = &input.queue.registration;
        let physical = &input.physical;
        input.queue.validate().map_err(|_| invalid())?;
        let policy_bytes = serde_json::to_vec(&input.reviewed_policy).map_err(|_| invalid())?;
        let policy_digest = crate::contracts::semantics::canonical_digest(&input.reviewed_policy)
            .map_err(|_| invalid())?;
        let owner_id = descriptor.owner.id().map_err(|_| invalid())?;
        let owner = access::SourceRef {
            workspace_id: partition.workspace_id.clone(),
            home_id: partition.home_id.clone(),
            key: access::SourceKey {
                source_instance_id: partition.source_instance_id.clone(),
                collection_id: partition.collection_id.clone(),
                source_kind: access::SourceKind::HomeboxEntity,
                external_id: owner_id.to_string(),
            },
        };
        if !input.reviewed_policy.is_object()
            || policy_bytes.is_empty()
            || policy_bytes.len() > 65_536
            || policy_digest != descriptor.policy_digest.as_str()
            || descriptor.owner.resource_kind != native::ResourceKind::Entity
            || descriptor.owner.entity_id.is_some()
            || !source.contains(&owner)
            || source.registration() != homebox.registration()
            || source.access_registration() != input.metadata.registration()
            || descriptor.authority.source_epoch != input.metadata.source_registration_version()
            || !matches!(
                descriptor.authority.qualification,
                native::NativeQualification::Qualified { .. }
            )
            || homebox.metadata_dialect() != crate::providers::homebox::wire::DIALECT
            || !credentials.matches_endpoint(&homebox.endpoint().map_err(|_| invalid())?)
            || descriptor.context.workspace_id.to_string() != partition.workspace_id.as_str()
            || descriptor.context.home_id.to_string() != partition.home_id.as_str()
            || descriptor.owner.source_instance_id.to_string()
                != partition.source_instance_id.as_str()
            || descriptor.owner.collection_id.to_string() != partition.collection_id
            || !core.homes.iter().any(|home| {
                home.scope.workspace_id == partition.workspace_id.as_str()
                    && home.scope.home_id == partition.home_id.as_str()
            })
            || descriptor.authority.physical_binding != physical.physical_binding
            || descriptor.authority.actor_id.is_nil()
            || physical.owner_id.is_nil()
            || queue.identity.deployment_id != physical.physical_binding.deployment_id.to_string()
            || queue.identity.physical_database_id
                != physical.physical_binding.physical_database_id.to_string()
            || queue.identity.configuration_digest.as_hex()
                != physical.physical_binding.configuration_digest.as_str()
            || queue.dispatcher_owner_id != physical.owner_id.to_string()
            || queue.aliases.len() > 1000
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
        let store_identity = {
            let store = core
                .store
                .try_lock()
                .map_err(|_| QueuedUploadConfigurationError::Unavailable)?;
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
        &self.input.metadata
    }
    pub fn descriptor(&self) -> &native::QueuedUploadProfileDescriptor {
        &self.input.descriptor
    }
    pub fn artifacts(&self) -> &QueuedUploadInstallationArtifacts {
        &self.input.artifacts
    }
    pub fn reviewed_policy(&self) -> &Value {
        &self.input.reviewed_policy
    }
}
