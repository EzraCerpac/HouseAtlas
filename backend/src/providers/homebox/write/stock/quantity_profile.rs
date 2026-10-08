//! Quantity-only expectations. Descriptor equality is never installed authority.
use super::*;
use crate::access::SourceAuthorityMetadata;
use std::time::Duration;

/// Explicit expectations supplied by the source owner, not a qualification proof.
pub struct QuantityProfileDescriptor {
    pub source_commit: String,
    pub version: String,
    pub build_digest: Digest,
    pub catalog_digest: Digest,
    pub route_digest: Digest,
    pub group_id: String,
    pub account_id: String,
    pub scope: Context,
    pub target: StockTarget,
    pub metadata: SourceAuthorityMetadata,
    pub authority: StockAuthority,
    pub dispatcher_epoch: u64,
    pub policy_digest: Digest,
    pub policy: QuantityPolicy,
    pub freshness: Duration,
}
#[derive(Clone, Copy)]
pub enum QuantityPolicy {
    HumanRequired,
    /// Exact target and bounded quantity, explicitly configured by the owner.
    NoHuman {
        maximum: u64,
    },
}
pub struct QuantityProfile {
    pub(super) expected: QuantityProfileDescriptor,
    fixture: bool,
}
impl QuantityProfile {
    pub fn production(expected: QuantityProfileDescriptor) -> Result<Self, StockErrorCode> {
        Self::validate(&expected)?;
        if matches!(
            expected.authority.qualification,
            NativeQualification::SyntheticFixture
        ) {
            return Err(StockErrorCode::UnsupportedCapability);
        }
        Ok(Self {
            expected,
            fixture: false,
        })
    }
    fn validate(e: &QuantityProfileDescriptor) -> Result<(), StockErrorCode> {
        if e.source_commit != NATIVE_SOURCE_COMMIT
            || e.version != crate::providers::homebox::read::HOMEBOX_REFERENCE_VERSION
            || e.group_id.is_empty() || e.account_id.is_empty()
            || e.group_id.len() > 4096 || e.account_id.len() > 4096
            || e.authority.physical_binding.deployment_id.is_nil()
            || e.authority.physical_binding.physical_database_id.is_nil()
            || e.scope.workspace_id.is_nil() || e.scope.home_id.is_nil()
            || e.target.source_instance_id.is_nil() || e.target.collection_id.is_nil()
            || e.authority.actor_id.is_nil()
            || e.metadata.registration().owner != crate::access::SourceOwner::Homebox
            || e.dispatcher_epoch == 0 || e.authority.source_epoch == 0
            // This mechanical slice explicitly uses the actual persisted
            // registration version as its source epoch. Other mappings are held.
            || e.authority.source_epoch != e.metadata.source_registration_version()
            || e.freshness.is_zero() || e.freshness > Duration::from_secs(60)
            || e.target.resource_kind != ResourceKind::Entity
            || e.target.entity_id.is_some() || e.target.id().is_err()
            || e.target.id().is_ok_and(|id| id.is_nil())
            || matches!(e.policy, QuantityPolicy::NoHuman { maximum } if maximum > 9_007_199_254_740_991)
        {
            return Err(StockErrorCode::InvalidArgument);
        }
        let p = e.metadata.registration().partition();
        if p.workspace_id.as_str() != e.scope.workspace_id.to_string()
            || p.home_id.as_str() != e.scope.home_id.to_string()
            || p.source_instance_id.as_str() != e.target.source_instance_id.to_string()
            || p.collection_id != e.target.collection_id.to_string()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        if let NativeQualification::Qualified {
            catalog_digest,
            registered_build_digest,
            route_qualification_digest,
        } = &e.authority.qualification
            && (catalog_digest != &e.catalog_digest
                || registered_build_digest != &e.build_digest
                || route_qualification_digest != &e.route_digest)
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }
    #[cfg(test)]
    pub(super) fn synthetic_fixture(
        expected: QuantityProfileDescriptor,
    ) -> Result<Self, StockErrorCode> {
        Self::validate(&expected)?;
        if !matches!(
            expected.authority.qualification,
            NativeQualification::SyntheticFixture
        ) {
            return Err(StockErrorCode::UnsupportedCapability);
        }
        Ok(Self {
            expected,
            fixture: true,
        })
    }
    pub(super) fn check_data(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<(), StockErrorCode> {
        if command.command_id != "homebox.entity.quantity.set"
            || command.context != self.expected.scope
            || command.target != self.expected.target
            || authority != &self.expected.authority
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        // Reject alternate numeric spellings rather than round an original
        // quantity through f64 before checking its exact integer value.
        let quantity = command
            .payload
            .get("quantity")
            .and_then(serde_json::Value::as_u64)
            .ok_or(StockErrorCode::InvalidArgument)?;
        if quantity > 9_007_199_254_740_991 {
            return Err(StockErrorCode::InvalidArgument);
        }
        match self.expected.policy {
            QuantityPolicy::HumanRequired => return Err(StockErrorCode::UnsupportedCapability),
            QuantityPolicy::NoHuman { maximum } if quantity > maximum => {
                return Err(StockErrorCode::CapabilityDenied);
            }
            _ => {}
        }
        Ok(())
    }
    pub(super) fn require_installed_authority(&self) -> Result<(), StockErrorCode> {
        // No opaque installed-build/policy receipt producer is available here.
        // Public Qualified fields, profile hashes, role and tenant are not proof.
        if !self.fixture {
            return Err(StockErrorCode::UnsupportedCapability);
        }
        Ok(())
    }
}
