//! Candidate/precommit content and transaction-derived witness linkage.
use super::{ConfiguredCacheAge, CurrentPresenceRead, carrier, digest, shape};
use crate::{
    contracts::{self, stock as wire},
    domain::{self as d, DomainError, DomainResult},
    storage as s,
};

/// All rows/operation must be derived by the active storage transaction.
pub struct PresenceChange<'a> {
    pub original: Option<&'a s::Record>,
    pub candidate: &'a s::Record,
    pub identity: &'a s::Record,
    pub operation: s::Operation,
}

pub fn current_presence_requirement(
    change: &PresenceChange<'_>,
) -> DomainResult<d::PresenceRequirement> {
    shape::<contracts::Record>(change.candidate)?;
    if let Some(original) = change.original {
        shape::<contracts::Record>(original)?;
    }
    let prior: Option<d::Record> = change.original.map(carrier).transpose()?;
    let next: d::Record = carrier(change.candidate)?;
    d::binding_presence_requirement(prior.as_ref(), &next, carrier(&change.operation)?)
}

/// Immutable producer content, not a stored witness or authority token.
/// The owner must retain this capture through its actual atomic transaction.
pub struct CapturedPresenceContent {
    original: Option<s::Record>,
    candidate: s::Record,
    identity: s::Record,
    operation: s::Operation,
    trigger: wire::PresenceTrigger,
    qualification: wire::PresenceQualification,
}

impl CapturedPresenceContent {
    /// Content-only mapping over trusted actual graph rows. Native authority
    /// composition calls this through capture_native_presence, not browser DTOs.
    /// Review status never supplies observation authority.
    pub fn from_current_read(
        original: Option<&s::Record>,
        candidate: &s::Record,
        identity: &s::Record,
        operation: s::Operation,
        current: &CurrentPresenceRead,
        authority: &wire::PresenceAuthority,
        clock: (&str, &ConfiguredCacheAge),
    ) -> DomainResult<Option<Self>> {
        let requirement = current_presence_requirement(&PresenceChange {
            original,
            candidate,
            identity,
            operation,
        })?;
        let trigger = match requirement {
            d::PresenceRequirement::NoNewObservation => return Ok(None),
            d::PresenceRequirement::OutsideCurrentSemanticScope(_) => {
                return Err(DomainError::UpstreamUnavailable);
            }
            d::PresenceRequirement::Qualify(trigger) => carrier(&trigger)?,
        };
        match (operation, original) {
            (s::Operation::Create, None) => {}
            (s::Operation::Replace | s::Operation::Restore, Some(prior))
                if prior.scope() == candidate.scope()
                    && prior.reference() == candidate.reference()
                    && prior.payload["source"] == candidate.payload["source"] => {}
            _ => return Err(DomainError::InvalidContract),
        }
        shape::<contracts::Record>(identity)?;
        if identity.scope() != candidate.scope()
            || current.registration.scope() != candidate.scope()
            || identity.record_type != s::RecordType::Identity
            || identity.lifecycle != s::Lifecycle::Active
            || candidate.payload["atlasId"] != identity.record_id
        {
            return Err(DomainError::InvalidContract);
        }
        let source: contracts::SourceKey =
            serde_json::from_value(candidate.payload["source"].clone())
                .map_err(|_| DomainError::InvalidContract)?;
        let identity_kind = identity.payload["kind"]
            .as_str()
            .ok_or(DomainError::InvalidContract)?;
        let qualification = current.qualify_member(
            &candidate.record_id,
            &source,
            identity_kind,
            authority,
            clock.0,
            clock.1,
        )?;
        Ok(Some(Self {
            original: original.cloned(),
            candidate: candidate.clone(),
            identity: identity.clone(),
            operation,
            trigger,
            qualification,
        }))
    }

    pub fn qualification(&self) -> &wire::PresenceQualification {
        &self.qualification
    }
    pub fn candidate(&self) -> &s::Record {
        &self.candidate
    }
    pub fn original(&self) -> Option<&s::Record> {
        self.original.as_ref()
    }
    pub fn identity(&self) -> &s::Record {
        &self.identity
    }

    /// Recompute with the same graph/authority at the owner's precommit phase.
    /// Any generation/epoch/member/registration change is a mismatch, never a
    /// generation rebase. Freshness is recomputed using the configured policy.
    pub fn revalidate_content(
        &self,
        current: &CurrentPresenceRead,
        authority: &wire::PresenceAuthority,
        clock: (&str, &ConfiguredCacheAge),
    ) -> DomainResult<()> {
        let fresh = Self::from_current_read(
            self.original.as_ref(),
            &self.candidate,
            &self.identity,
            self.operation,
            current,
            authority,
            clock,
        )?
        .ok_or(DomainError::InvalidContract)?;
        if fresh.qualification != self.qualification || fresh.trigger != self.trigger {
            return Err(DomainError::Forbidden);
        }
        Ok(())
    }

    /// Produce schema-valid durable content using actual final binding/audit
    /// rows. No timestamp/ID is generated here. AT07 must call after revalidation
    /// and insert append-only alongside binding/audit/receipt before COMMIT.
    /// Returning this value is NOT evidence that a durable write occurred.
    pub fn witness_content(
        &self,
        record: &s::Record,
        audit: &s::Audit,
    ) -> DomainResult<wire::PresenceWitness> {
        shape::<contracts::Record>(record)?;
        shape::<contracts::Audit>(audit)?;
        if record.scope() != self.candidate.scope()
            || record.reference() != self.candidate.reference()
            || record.schema_version != self.candidate.schema_version
            || record.created_at != self.candidate.created_at
            || record.lifecycle != s::Lifecycle::Active
            || record.payload != self.candidate.payload
            || audit.workspace_id != record.workspace_id
            || audit.home_id != record.home_id
            || audit.record != record.reference()
            || audit.operation != self.operation
            || audit.result_revision != record.revision
            || audit.previous_revision != self.original.as_ref().map(|record| record.revision)
            || record.revision
                != self
                    .original
                    .as_ref()
                    .map_or(Some(1), |r| r.revision.checked_add(1))
                    .ok_or(DomainError::InvalidContract)?
            || record.last_audit_id != audit.audit_id
            || record.updated_at != audit.at
            || audit.after_digest != digest(record)?
            || audit.before_digest != self.original.as_ref().map(digest).transpose()?
        {
            return Err(DomainError::InvalidContract);
        }
        let witness = wire::PresenceWitness {
            schema_version: contracts::ConstInt::<1>,
            semantic_amendment_version: wire::PresenceAmendmentVersion::V1_1_0,
            workspace_id: record.workspace_id.clone(),
            home_id: record.home_id.clone(),
            binding_record_id: record.record_id.clone(),
            binding_revision: carrier(&record.revision)?,
            audit_id: audit.audit_id.clone(),
            mutation_id: audit.mutation_id.clone(),
            actor_id: audit.actor_id.clone(),
            operation: carrier(&audit.operation)?,
            trigger: self.trigger,
            source: self.qualification.source.clone(),
            observed_at: self.qualification.observed_at.clone(),
            admitted_at: audit.at.clone(),
            cache: self.qualification.cache.clone(),
            authority: self.qualification.authority.clone(),
            observation: self.qualification.observation.clone(),
        };
        wire::validate_presence_witness(&witness).map_err(|_| DomainError::InvalidContract)?;
        Ok(witness)
    }
}

/// Bind the existing legacy domain qualification validator to the accepted
/// native schema implementation. No duplicate schema or permissive fallback.
pub struct NativePresenceContracts;
impl d::PresenceContractPort for NativePresenceContracts {
    fn validate_qualification(&self, value: &d::PresenceQualification) -> DomainResult<()> {
        let value: wire::PresenceQualification = carrier(value)?;
        wire::validate_presence_qualification(&value).map_err(|_| DomainError::InvalidContract)
    }
}
