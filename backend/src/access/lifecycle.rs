//! Explicit startup policy and opaque provider lifecycle authority.

use rusqlite::TransactionBehavior;

use super::{
    AccessBoundary, AccessError, AccessResult, Action, CanonicalId, PartitionGrant, Principal,
    SourceRegistration, TransactionAuthorization, boundary::CurrentAuthority, source, store,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleCapability {
    ConfigureSource,
    PublishCache,
}

/// Trusted owner approval for one subject, full registration, operation and
/// principal issuance action. Neither this rule nor registry metadata is a grant.
pub struct LifecycleRule {
    user_id: CanonicalId,
    actor_id: CanonicalId,
    registration: SourceRegistration,
    capability: LifecycleCapability,
    action: Action,
}

impl LifecycleRule {
    pub fn new(
        user_id: CanonicalId,
        actor_id: CanonicalId,
        registration: SourceRegistration,
        capability: LifecycleCapability,
        action: Action,
    ) -> AccessResult<Self> {
        registration.validate()?;
        // Configuration changes require the existing CSRF-checked mutation
        // principal in addition to an explicit independent owner approval.
        if capability == LifecycleCapability::ConfigureSource && action != Action::Mutate {
            return Err(AccessError::InvalidInput);
        }
        Ok(Self {
            user_id,
            actor_id,
            registration,
            capability,
            action,
        })
    }
}

/// Immutable after boundary construction. Empty by default; populate only from
/// trusted owner configuration, never a client claim or provider registry alone.
#[derive(Default)]
pub struct LifecyclePolicy {
    rules: Vec<LifecycleRule>,
}

impl LifecyclePolicy {
    pub fn from_trusted_configuration(rules: Vec<LifecycleRule>) -> Self {
        Self { rules }
    }
}

/// Nonserializable, nonconstructible provider authority. It retains complete
/// genuine principal provenance and the exact approved registration/operation.
/// Publication also pins the original enabled partition version. No read/entity
/// disclosure permission or source administration is exposed by this handle.
pub struct LifecycleGrant {
    principal: Principal,
    registration: SourceRegistration,
    capability: LifecycleCapability,
    partition: Option<PartitionGrant>,
}

impl AccessBoundary {
    pub fn capture_lifecycle(
        &self,
        principal: &Principal,
        registration: &SourceRegistration,
        capability: LifecycleCapability,
    ) -> AccessResult<LifecycleGrant> {
        let current = self.current();
        current.check_lifecycle_policy(principal, registration, capability)?;
        let partition = match capability {
            LifecycleCapability::ConfigureSource => None,
            LifecycleCapability::PublishCache => {
                let partition = current.partition_grant(principal, &registration.partition())?;
                current.check_registration(registration)?;
                Some(partition)
            }
        };
        Ok(LifecycleGrant {
            principal: principal.clone(),
            registration: registration.clone(),
            capability,
            partition,
        })
    }

    /// Check the original grant; do not issue replacement authority.
    pub fn revalidate_lifecycle<'g>(
        &self,
        principal: &Principal,
        grant: &'g LifecycleGrant,
        registration: &SourceRegistration,
        capability: LifecycleCapability,
    ) -> AccessResult<&'g LifecycleGrant> {
        self.current()
            .revalidate_lifecycle(principal, grant, registration, capability)
    }

    /// Dedicated owner fence for configured lifecycle work, separate from an
    /// ordinary mutation/read capability. The guard borrows this exact principal.
    /// Release this synchronous fence before provider I/O. This does not make
    /// separate access/storage databases atomically committed.
    pub fn with_lifecycle_authorization<E: From<AccessError>>(
        &mut self,
        principal: &Principal,
        grant: &LifecycleGrant,
        registration: &SourceRegistration,
        capability: LifecycleCapability,
        operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<(), E>,
    ) -> Result<(), E> {
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(AccessError::from)
            .map_err(E::from)?;
        let guard = TransactionAuthorization {
            authority: CurrentAuthority {
                db: &tx,
                config: &self.config,
                instance: &self.instance,
            },
            principal,
        };
        guard
            .revalidate_lifecycle(grant, registration, capability)
            .map_err(E::from)?;
        operation(&guard)?;
        guard
            .revalidate_lifecycle(grant, registration, capability)
            .map_err(E::from)?;
        tx.commit().map_err(AccessError::from).map_err(E::from)?;
        Ok(())
    }

    /// Revalidate ConfigureSource and write in the SAME access transaction.
    /// New registrations are possible without an existing readable source.
    /// Replacement preserves the existing enabled/quarantine state.
    pub fn install_source_authorized(
        &mut self,
        principal: &Principal,
        grant: &LifecycleGrant,
        registration: &SourceRegistration,
    ) -> AccessResult<()> {
        self.with_lifecycle_authorization(
            principal,
            grant,
            registration,
            LifecycleCapability::ConfigureSource,
            |guard| source::write_source(guard.authority.db, registration, None),
        )
    }
}

impl TransactionAuthorization<'_> {
    /// Check the retained lifecycle grant through the held access transaction.
    /// Entity/partition disclosure grants still require their separate checks.
    pub fn revalidate_lifecycle<'g>(
        &self,
        grant: &'g LifecycleGrant,
        registration: &SourceRegistration,
        capability: LifecycleCapability,
    ) -> AccessResult<&'g LifecycleGrant> {
        self.authority
            .revalidate_lifecycle(self.principal, grant, registration, capability)
    }
}

impl CurrentAuthority<'_> {
    fn check_lifecycle_policy(
        &self,
        principal: &Principal,
        registration: &SourceRegistration,
        capability: LifecycleCapability,
    ) -> AccessResult<()> {
        self.revalidate(principal)?;
        registration.validate()?;
        if registration.partition().scope() != principal.scope {
            return Err(AccessError::NotFound);
        }
        if capability == LifecycleCapability::ConfigureSource {
            self.assert_mutation(principal)?;
        }
        if !self.config.lifecycle.rules.iter().any(|rule| {
            rule.user_id == principal.user_id
                && rule.actor_id == principal.actor_id
                && rule.registration == *registration
                && rule.capability == capability
                && rule.action == principal.action
        }) {
            return Err(AccessError::Forbidden);
        }
        Ok(())
    }

    fn check_registration(&self, registration: &SourceRegistration) -> AccessResult<()> {
        store::source(self.db, &registration.partition())?
            .filter(|row| row.enabled && row.registration == *registration)
            .ok_or(AccessError::NotFound)?;
        Ok(())
    }

    fn revalidate_lifecycle<'g>(
        &self,
        principal: &Principal,
        grant: &'g LifecycleGrant,
        registration: &SourceRegistration,
        capability: LifecycleCapability,
    ) -> AccessResult<&'g LifecycleGrant> {
        self.check_grant_principal(principal, &grant.principal)?;
        if grant.registration != *registration || grant.capability != capability {
            return Err(AccessError::Forbidden);
        }
        self.check_lifecycle_policy(principal, registration, capability)?;
        match (capability, &grant.partition) {
            (LifecycleCapability::ConfigureSource, None) => {}
            (LifecycleCapability::PublishCache, Some(partition)) => {
                if partition.partition() != &registration.partition() {
                    return Err(AccessError::NotFound);
                }
                self.revalidate_source_partition(principal, partition)?;
                self.check_registration(registration)?;
            }
            _ => return Err(AccessError::Forbidden),
        }
        Ok(grant)
    }
}
