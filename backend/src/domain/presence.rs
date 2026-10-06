//! Source-presence semantic amendment 1.1.0, witness schema 1.
//!
//! Derived from the supplied language-neutral policy/qualification definitions.
//! Storage derives assertions from its real original/candidate/final graph and
//! stamps witness linkage atomically. This module never mints a stored witness,
//! grant, registration version, cache member or admission timestamp.

use super::{
    BindingPayload, BindingSourceState, DomainError, DomainResult, Lifecycle, MutationOperation,
    Record, RecordType, Scope, SourceKey, SourceKind,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const PRESENCE_SEMANTIC_VERSION: &str = "1.1.0";
pub const PRESENCE_WITNESS_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PresenceTrigger {
    CreatePresent,
    NonpresentToPresent,
    RestoreActivePresent,
    PresentEvidenceIdsReplaced,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PresenceRequirement {
    NoNewObservation,
    Qualify(PresenceTrigger),
    OutsideCurrentSemanticScope(PresenceTrigger),
}

/// Pure predicate only. The storage owner supplies validated actual graph rows,
/// not client-declared before/after values. Set comparison changes only trigger
/// detection; submitted evidence arrays and ordered batch intent stay untouched.
pub fn binding_presence_requirement(
    original: Option<&Record>,
    candidate: &Record,
    operation: MutationOperation,
) -> DomainResult<PresenceRequirement> {
    if candidate.target.record_type != RecordType::Binding
        || candidate.lifecycle != Lifecycle::Active
        || operation == MutationOperation::Tombstone
    {
        return Ok(PresenceRequirement::NoNewObservation);
    }
    let next: BindingPayload = serde_json::from_value(candidate.payload.clone())
        .map_err(|_| DomainError::InvalidContract)?;
    if next.source_state != BindingSourceState::Present {
        return Ok(PresenceRequirement::NoNewObservation);
    }
    let trigger = match operation {
        MutationOperation::Create => Some(PresenceTrigger::CreatePresent),
        MutationOperation::Restore => Some(PresenceTrigger::RestoreActivePresent),
        MutationOperation::Replace => {
            let prior = original.ok_or(DomainError::InvalidContract)?;
            if prior.scope != candidate.scope || prior.target != candidate.target {
                return Err(DomainError::InvalidContract);
            }
            let before: BindingPayload = serde_json::from_value(prior.payload.clone())
                .map_err(|_| DomainError::InvalidContract)?;
            if before.source != next.source {
                return Err(DomainError::IdentityConflict);
            }
            if before.source_state != BindingSourceState::Present {
                Some(PresenceTrigger::NonpresentToPresent)
            } else if before.evidence_ids.iter().collect::<HashSet<_>>()
                != next.evidence_ids.iter().collect::<HashSet<_>>()
            {
                Some(PresenceTrigger::PresentEvidenceIdsReplaced)
            } else {
                None
            }
        }
        MutationOperation::Tombstone => None,
    };
    let Some(trigger) = trigger else {
        return Ok(PresenceRequirement::NoNewObservation);
    };
    Ok(
        if matches!(
            next.source.source_kind,
            SourceKind::HomeboxEntity | SourceKind::NetworkDevice | SourceKind::NetworkGroup
        ) {
            PresenceRequirement::Qualify(trigger)
        } else {
            PresenceRequirement::OutsideCurrentSemanticScope(trigger)
        },
    )
}

/// Kept held until reviewed Rust transaction/authority/recovery composition.
/// Copied policy metadata, valid DTOs or successful synthetic shape examples do
/// not enable admission. Existing historical observations may still be read.
pub fn enforce_current_presence_hold(requirement: PresenceRequirement) -> DomainResult<()> {
    match requirement {
        PresenceRequirement::NoNewObservation => Ok(()),
        PresenceRequirement::Qualify(_) | PresenceRequirement::OutsideCurrentSemanticScope(_) => {
            Err(DomainError::UpstreamUnavailable)
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PresenceAssertion {
    pub scope: Scope,
    pub binding_record_id: String,
    pub source: SourceKey,
    pub trigger: PresenceTrigger,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QualificationPhase {
    Candidate,
    Precommit,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QualifiedCacheState {
    Fresh,
}

#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualifiedCache {
    pub generation_id: String,
    pub cache_epoch: u64,
    pub status: QualifiedCacheState,
    pub last_successful_fetch_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualifiedAuthority {
    pub authority_context_version: String,
    pub context_id: String,
    pub access_package_version: String,
    /// Genuine persisted opaque epoch; no hidden principal version substitute.
    pub access_epoch: String,
    pub source_registration_version: u64,
    pub source_registration_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QualifiedObservation {
    HomeboxEntity {
        member_sha256: String,
        member_retrieved_at: String,
        #[serde(deserialize_with = "required_nullable_date")]
        source_updated_at: Option<String>,
    },
    NetworkInventory {
        member_sha256: String,
        verified_generation_sha256: String,
        generation_retrieved_at: String,
        #[serde(deserialize_with = "required_nullable_date")]
        source_snapshot_at: Option<String>,
    },
}

/// Exact qualifier-owned fields. Binding revision, audit/mutation/actor/scope,
/// operation/trigger and admittedAt are intentionally not qualifier inputs.
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceQualification {
    pub binding_record_id: String,
    pub source: SourceKey,
    pub observed_at: String,
    pub cache: QualifiedCache,
    pub authority: QualifiedAuthority,
    pub observation: QualifiedObservation,
}

/// Authorized retained-metadata DTO only. The storage owner creates this row
/// inside the binding/audit/receipt transaction from actual committed linkage;
/// decoding a row here never grants new admission or validates its provenance.
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceWitness {
    pub schema_version: u8,
    pub semantic_amendment_version: String,
    pub workspace_id: String,
    pub home_id: String,
    pub binding_record_id: String,
    pub binding_revision: u64,
    pub audit_id: String,
    pub mutation_id: String,
    pub actor_id: String,
    pub operation: WitnessOperation,
    pub trigger: PresenceTrigger,
    pub source: SourceKey,
    pub observed_at: String,
    pub admitted_at: String,
    pub cache: QualifiedCache,
    pub authority: QualifiedAuthority,
    pub observation: QualifiedObservation,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WitnessOperation {
    Create,
    Replace,
    Restore,
}

/// T is AT07's opaque active transaction/authority capture. Qualification must
/// check the latest complete visible successful publication, exact compatible
/// inventory member, immutable canonical member digest, captured generation/cache
/// epoch and genuine enabled registration/grants. At precommit recheck original
/// grants and freshness without generation substitution or a provider fetch.
/// Filtered rows and relation endpoints never establish membership.
/// Assert every supplied scope against the active transaction and captured
/// principal; authorize the entire original/candidate/touched/guarded/referenced
/// graph. Qualification metadata is not an authorization token.
pub trait PresenceQualifier<P, T> {
    fn qualify(
        &mut self,
        principal: &P,
        transaction: &T,
        phase: QualificationPhase,
        assertions: &[PresenceAssertion],
    ) -> DomainResult<Vec<PresenceQualification>>;
}

/// Offline schema adapter supplied by AT51 from qualification.v1.schema.json
/// and witness.v1.schema.json plus exact frozen Atlas resource resolution.
pub trait PresenceContractPort {
    fn validate_qualification(&self, qualification: &PresenceQualification) -> DomainResult<()>;
}

/// Immutable captured facts, for storage's candidate/precommit pairing. Atomic
/// witness/binding/audit/receipt persistence and recovery remain storage-owned.
#[derive(Clone, Debug)]
pub struct PresenceCapture {
    assertions: Vec<PresenceAssertion>,
    facts: Vec<PresenceQualification>,
}

impl PresenceCapture {
    pub fn capture<P, T>(
        qualifier: &mut impl PresenceQualifier<P, T>,
        contracts: &impl PresenceContractPort,
        principal: &P,
        transaction: &T,
        assertions: &[PresenceAssertion],
    ) -> DomainResult<Self> {
        let facts = qualifier.qualify(
            principal,
            transaction,
            QualificationPhase::Candidate,
            assertions,
        )?;
        validate_facts(contracts, assertions, &facts)?;
        Ok(Self {
            assertions: assertions.to_vec(),
            facts,
        })
    }

    pub fn revalidate<P, T>(
        &self,
        qualifier: &mut impl PresenceQualifier<P, T>,
        contracts: &impl PresenceContractPort,
        principal: &P,
        transaction: &T,
    ) -> DomainResult<()> {
        let current = qualifier.qualify(
            principal,
            transaction,
            QualificationPhase::Precommit,
            &self.assertions,
        )?;
        validate_facts(contracts, &self.assertions, &current)?;
        if current != self.facts {
            return Err(DomainError::Forbidden);
        }
        Ok(())
    }

    pub fn facts(&self) -> &[PresenceQualification] {
        &self.facts
    }
}

fn validate_facts(
    contracts: &impl PresenceContractPort,
    assertions: &[PresenceAssertion],
    facts: &[PresenceQualification],
) -> DomainResult<()> {
    if assertions.len() != facts.len() {
        return Err(DomainError::UpstreamIncomplete);
    }
    for (assertion, fact) in assertions.iter().zip(facts) {
        contracts.validate_qualification(fact)?;
        if assertion.binding_record_id != fact.binding_record_id
            || assertion.source != fact.source
            || fact.observed_at != fact.cache.last_successful_fetch_at
        {
            return Err(DomainError::InvalidContract);
        }
        finite_date(&fact.observed_at)?;
        match (&fact.source.source_kind, &fact.observation) {
            (
                SourceKind::HomeboxEntity,
                QualifiedObservation::HomeboxEntity {
                    member_retrieved_at,
                    source_updated_at,
                    ..
                },
            ) => {
                finite_date(member_retrieved_at)?;
                if let Some(date) = source_updated_at {
                    finite_date(date)?
                }
            }
            (
                SourceKind::NetworkDevice | SourceKind::NetworkGroup,
                QualifiedObservation::NetworkInventory {
                    generation_retrieved_at,
                    source_snapshot_at,
                    ..
                },
            ) => {
                finite_date(generation_retrieved_at)?;
                if let Some(date) = source_snapshot_at {
                    finite_date(date)?
                }
            }
            _ => return Err(DomainError::InvalidContract),
        }
    }
    Ok(())
}

fn finite_date(value: &str) -> DomainResult<()> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(|_| ())
        .map_err(|_| DomainError::InvalidContract)
}

fn required_nullable_date<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}
