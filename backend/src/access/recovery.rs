//! Explicit administrative startup authority for offline discovery/validation.
//! No browser session, access connection or restored data is an authority input.

use std::sync::Arc;

use crate::{
    domain::queue_recovery::{RecoveryDiscoveryAuthority, TrustedQueueRegistry},
    jobs::{QueueConfig, QueueRegistration},
    storage,
};

use super::{AccessError, AccessResult, types::opaque_text};

/// Records an explicit trusted administrative approval for discovery/validation
/// only, over one deployment's COMPLETE queue registry, including empty queues.
/// Construction does not authenticate an operator or release an operational
/// gate. Only the trusted startup owner may call it after independent approval;
/// never derive that approval from image/registry metadata or queued actor IDs.
/// No production approval is configured by this component.
pub struct OfflineRecoveryApproval {
    deployment_id: String,
    registry: TrustedQueueRegistry,
}

impl OfflineRecoveryApproval {
    pub fn discovery_validation(
        deployment_id: impl Into<String>,
        registry: &[QueueConfig],
    ) -> AccessResult<Self> {
        let deployment_id = deployment_id.into();
        opaque_text(&deployment_id)?;
        let registry =
            TrustedQueueRegistry::new(registry).map_err(|_| AccessError::InvalidInput)?;
        if registry
            .configs()
            .iter()
            .any(|config| config.registration.identity.deployment_id != deployment_id)
        {
            return Err(AccessError::InvalidInput);
        }
        Ok(Self {
            deployment_id,
            registry,
        })
    }
}

// Every construction allocates a distinct private issuer. Grants keep that
// allocation alive; Arc::ptr_eq compares identity, not equal metadata. The
// approved preimage is immutable and cannot be swapped on an existing issuer.
struct RecoveryIssuer {
    approval: Option<OfflineRecoveryApproval>,
}

/// Independent offline owner. Default is disabled. Keep this issuer alive
/// outside the source Core across close/reopen and explicit browser-session
/// reset. It retains metadata only: no SQL handle, access/vault Arc or mutex.
pub struct OfflineRecoveryAuthority {
    issuer: Arc<RecoveryIssuer>,
}

impl Default for OfflineRecoveryAuthority {
    fn default() -> Self {
        Self {
            issuer: Arc::new(RecoveryIssuer { approval: None }),
        }
    }
}

/// Opaque nonserializable grant for discovery/validation only. The retained
/// issuer privately pins the complete approval/deployment/registry preimage.
/// It grants no read disclosure, dispatch, resume, reconciliation or mutation.
pub struct RecoveryDiscoveryGrant {
    issuer: Arc<RecoveryIssuer>,
}

impl OfflineRecoveryAuthority {
    pub fn from_trusted_administrative_approval(approval: OfflineRecoveryApproval) -> Self {
        Self {
            issuer: Arc::new(RecoveryIssuer {
                approval: Some(approval),
            }),
        }
    }

    /// Capture only from this explicitly approved issuer and its exact full
    /// registry. Caller-provided registry/configuration is matching data only.
    pub fn capture_discovery(
        &self,
        registry: &[QueueConfig],
    ) -> AccessResult<RecoveryDiscoveryGrant> {
        self.checked_registry(registry)?;
        Ok(RecoveryDiscoveryGrant {
            issuer: Arc::clone(&self.issuer),
        })
    }

    /// Recheck the original issuer, complete registry and full registration.
    /// Configuration and alias ordering are exact: no subset, sorting or
    /// normalization grants authority. No session refresh or DB access occurs.
    pub fn revalidate_discovery(
        &self,
        grant: &RecoveryDiscoveryGrant,
        registry: &[QueueConfig],
        registration: &QueueRegistration,
    ) -> AccessResult<()> {
        if !Arc::ptr_eq(&self.issuer, &grant.issuer) {
            return Err(AccessError::Forbidden);
        }
        let approval = self.checked_registry(registry)?;
        if registration.identity.deployment_id != approval.deployment_id
            || !approval
                .registry
                .configs()
                .iter()
                .any(|config| config.registration == *registration)
        {
            return Err(AccessError::Forbidden);
        }
        Ok(())
    }

    fn checked_registry(&self, registry: &[QueueConfig]) -> AccessResult<&OfflineRecoveryApproval> {
        let approval = self
            .issuer
            .approval
            .as_ref()
            .ok_or(AccessError::Forbidden)?;
        if registry != approval.registry.configs() {
            return Err(AccessError::Forbidden);
        }
        Ok(approval)
    }
}

// Implements the existing domain port directly; no additional authority trait
// or storage/access reentry. Image validation and retained original/media/native
// evidence remain independent mandatory checks owned by the existing peers.
impl RecoveryDiscoveryAuthority for OfflineRecoveryAuthority {
    type Grant = RecoveryDiscoveryGrant;

    fn revalidate(
        &self,
        grant: &Self::Grant,
        registry: &[QueueConfig],
        registration: &QueueRegistration,
    ) -> storage::Result<()> {
        self.revalidate_discovery(grant, registry, registration)
            .map_err(|_| {
                storage::Error::new(
                    "owner-unavailable",
                    "Offline recovery discovery authority unavailable",
                )
            })
    }
}
