//! Original AT11 handle checks and the exact missing atomic AT07 read seam.
use super::{
    CapturedPresenceContent, ConfiguredCacheAge, CurrentPresenceRead, PresenceChange, carrier,
    current_presence_requirement,
};
use crate::{
    access as a,
    contracts::stock as wire,
    domain::{DomainError, DomainResult},
    storage as s,
};

/// Borrow only previously captured handles. This module never issues grants.
pub struct OriginalPresenceAccess<'a> {
    pub principal: &'a a::Principal,
    pub sources: &'a [a::SourceGrant],
    pub partitions: &'a [a::PartitionGrant],
}
impl OriginalPresenceAccess<'_> {
    pub fn revalidate(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        candidate: &s::Record,
    ) -> DomainResult<()> {
        if !std::ptr::eq(self.principal, guard.principal())
            || self.principal.scope().workspace_id.as_str() != candidate.workspace_id
            || self.principal.scope().home_id.as_str() != candidate.home_id
        {
            return Err(DomainError::Forbidden);
        }
        guard.assert_mutation().map_err(access_error)?;
        // Entire original captured closure, including grants beyond this binding.
        for source in self.sources {
            guard.revalidate_source(source).map_err(access_error)?;
        }
        for partition in self.partitions {
            guard
                .revalidate_source_partition(partition)
                .map_err(access_error)?;
        }
        let reference: a::SourceRef = carrier(&serde_json::json!({
            "workspaceId": candidate.workspace_id, "homeId": candidate.home_id,
            "key": candidate.payload["source"],
        }))?;
        if !self
            .sources
            .iter()
            .any(|grant| grant.reference() == &reference)
            || !self
                .partitions
                .iter()
                .any(|grant| grant.partition() == &reference.partition())
        {
            return Err(DomainError::Forbidden);
        }
        Ok(())
    }
}

/// REQUIRED implementation on the store owner's opaque active mutation handle.
/// No implementation is possible through AtlasStore's current public reads:
/// they open their own transactions and expose no durable authority metadata.
/// Do not implement this using a detached read, access DTO or newly issued grant.
pub trait AtomicPresenceTransaction {
    /// Resolve the assertion from actual phase-specific transaction graph rows,
    /// retaining original rows and ordered mutation operation. No client rows.
    fn binding_change(
        &self,
        phase: crate::domain::QualificationPhase,
        assertion: &crate::domain::PresenceAssertion,
    ) -> DomainResult<PresenceChange<'_>>;
    /// Authorize actual original/candidate/touched/guarded/referenced/final graph
    /// against these exact original handles, including the active identity.
    fn assert_presence_graph(
        &self,
        original: Option<&s::Record>,
        candidate: &s::Record,
        identity: &s::Record,
        access: &OriginalPresenceAccess<'_>,
    ) -> DomainResult<()>;
    /// Read latest visible successfully published complete state, integer epoch,
    /// full durable registration and exact immutable Network row under the SAME
    /// transaction. HomeBox rows must come from that publication, never a view.
    fn current_presence(&self, candidate: &s::Record) -> DomainResult<CurrentPresenceRead>;
    /// Export genuine original context/version, persisted opaque access epoch,
    /// enabled-row registration version and digest through the held AT11 guard.
    /// contextId is correlation-only. Check captured metadata, never replace it.
    fn original_presence_authority(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        access: &OriginalPresenceAccess<'_>,
        candidate: &s::Record,
    ) -> DomainResult<wire::PresenceAuthority>;
}

/// Concrete adapter for the existing domain PresenceQualifier/PresenceCapture
/// ports. The required missing transaction implementation is deliberately not
/// supplied by a detached store read or a synthetic authority fallback.
pub struct NativePresenceQualifier<'a, 'tx> {
    guard: &'a a::TransactionAuthorization<'tx>,
    access: &'a OriginalPresenceAccess<'a>,
    age: &'a ConfiguredCacheAge,
    now: &'a dyn Fn() -> DomainResult<String>,
    captures: Option<Vec<CapturedPresenceContent>>,
    precommit_validated: bool,
}

impl<'a, 'tx> NativePresenceQualifier<'a, 'tx> {
    pub fn new(
        guard: &'a a::TransactionAuthorization<'tx>,
        access: &'a OriginalPresenceAccess<'a>,
        age: &'a ConfiguredCacheAge,
        now: &'a dyn Fn() -> DomainResult<String>,
    ) -> Self {
        Self {
            guard,
            access,
            age,
            now,
            captures: None,
            precommit_validated: false,
        }
    }

    /// Immutable content for AT07's later final audit/binding witness stamping.
    /// Only use after PresenceCapture::revalidate in the same active transaction.
    pub fn captured_content(&self) -> Option<&[CapturedPresenceContent]> {
        if self.precommit_validated {
            self.captures.as_deref()
        } else {
            None
        }
    }
}

impl<T: AtomicPresenceTransaction> crate::domain::PresenceQualifier<a::Principal, T>
    for NativePresenceQualifier<'_, '_>
{
    fn qualify(
        &mut self,
        principal: &a::Principal,
        transaction: &T,
        phase: crate::domain::QualificationPhase,
        assertions: &[crate::domain::PresenceAssertion],
    ) -> DomainResult<Vec<crate::domain::PresenceQualification>> {
        use crate::domain::{PresenceRequirement, QualificationPhase};
        self.precommit_validated = false;
        if !std::ptr::eq(principal, self.access.principal) {
            return Err(DomainError::Forbidden);
        }
        let now = (self.now)()?;
        match phase {
            QualificationPhase::Candidate => {
                if self.captures.is_some() {
                    return Err(DomainError::InvalidTransition);
                }
                let mut captures = Vec::with_capacity(assertions.len());
                for assertion in assertions {
                    let change = transaction.binding_change(phase, assertion)?;
                    let requirement = current_presence_requirement(&change)?;
                    if assertion.scope != carrier(&change.candidate.scope())?
                        || assertion.binding_record_id != change.candidate.record_id
                        || serde_json::to_value(&assertion.source)
                            .map_err(|_| DomainError::InvalidContract)?
                            != change.candidate.payload["source"]
                        || requirement != PresenceRequirement::Qualify(assertion.trigger)
                    {
                        return Err(DomainError::InvalidContract);
                    }
                    captures.push(
                        capture_native_presence(
                            transaction,
                            self.guard,
                            self.access,
                            &change,
                            (&now, self.age),
                        )?
                        .ok_or(DomainError::InvalidContract)?,
                    );
                }
                let facts = captures
                    .iter()
                    .map(|c| carrier(c.qualification()))
                    .collect::<DomainResult<_>>()?;
                self.captures = Some(captures);
                Ok(facts)
            }
            QualificationPhase::Precommit => {
                let captures = self
                    .captures
                    .as_ref()
                    .ok_or(DomainError::InvalidTransition)?;
                if captures.len() != assertions.len() {
                    return Err(DomainError::InvalidContract);
                }
                for (captured, assertion) in captures.iter().zip(assertions) {
                    let change = transaction.binding_change(phase, assertion)?;
                    if change.original != captured.original()
                        || change.candidate != captured.candidate()
                        || change.identity != captured.identity()
                        || assertion.scope != carrier(&change.candidate.scope())?
                        || assertion.binding_record_id != captured.qualification().binding_record_id
                        || carrier::<crate::domain::SourceKey>(&captured.qualification().source)?
                            != assertion.source
                        || current_presence_requirement(&change)?
                            != PresenceRequirement::Qualify(assertion.trigger)
                    {
                        return Err(DomainError::InvalidContract);
                    }
                    revalidate_native_presence(
                        captured,
                        transaction,
                        self.guard,
                        self.access,
                        (&now, self.age),
                    )?;
                }
                let facts = captures
                    .iter()
                    .map(|c| carrier(c.qualification()))
                    .collect::<DomainResult<_>>()?;
                self.precommit_validated = true;
                Ok(facts)
            }
        }
    }
}

/// Concrete original-grant checks plus native current-read content mapping.
/// Storage must derive each supplied row/operation from its actual transaction.
pub fn capture_native_presence(
    transaction: &impl AtomicPresenceTransaction,
    guard: &a::TransactionAuthorization<'_>,
    access: &OriginalPresenceAccess<'_>,
    change: &PresenceChange<'_>,
    clock: (&str, &ConfiguredCacheAge),
) -> DomainResult<Option<CapturedPresenceContent>> {
    match current_presence_requirement(change)? {
        crate::domain::PresenceRequirement::NoNewObservation => return Ok(None),
        crate::domain::PresenceRequirement::OutsideCurrentSemanticScope(_) => {
            return Err(DomainError::UpstreamUnavailable);
        }
        crate::domain::PresenceRequirement::Qualify(_) => {}
    }
    access.revalidate(guard, change.candidate)?;
    transaction.assert_presence_graph(
        change.original,
        change.candidate,
        change.identity,
        access,
    )?;
    let current = transaction.current_presence(change.candidate)?;
    let authority = transaction.original_presence_authority(guard, access, change.candidate)?;
    CapturedPresenceContent::from_current_read(
        change.original,
        change.candidate,
        change.identity,
        change.operation,
        &current,
        &authority,
        clock,
    )
}

pub fn revalidate_native_presence(
    captured: &CapturedPresenceContent,
    transaction: &impl AtomicPresenceTransaction,
    guard: &a::TransactionAuthorization<'_>,
    access: &OriginalPresenceAccess<'_>,
    clock: (&str, &ConfiguredCacheAge),
) -> DomainResult<()> {
    access.revalidate(guard, captured.candidate())?;
    transaction.assert_presence_graph(
        captured.original(),
        captured.candidate(),
        captured.identity(),
        access,
    )?;
    let current = transaction.current_presence(captured.candidate())?;
    let authority = transaction.original_presence_authority(guard, access, captured.candidate())?;
    captured.revalidate_content(&current, &authority, clock)
}

fn access_error(error: a::AccessError) -> DomainError {
    match error {
        a::AccessError::Unauthenticated => DomainError::Unauthenticated,
        a::AccessError::NotFound => DomainError::NotFound,
        a::AccessError::Unavailable => DomainError::UpstreamUnavailable,
        _ => DomainError::Forbidden,
    }
}
