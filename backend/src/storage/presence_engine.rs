//! Private same-transaction phase peer; no public or production peer constructor.
//! Explicit fresh profile remains unavailable without independent historical custody.
use super::super::*;
use super::presence_transaction::{
    PresenceMutationInputs, PresenceMutationTransaction, PresenceStoreAllocation,
};
use super::stock_presence::{
    MAX_ACCEPTED_FRAME_BYTES, PreparedIdentity, PresencePhaseProofInputs,
    StockPresenceAuthorizationPhase, StockPresenceQualifiedPhase, bounded_size,
};
use crate::{access as a, domain as d, providers::network as net};
use crate::{app, contracts::stock as wire};
use crate::{app::homebox_presence::ConfiguredPresenceReleased, contracts::stock::PresenceWitness};
use d::qualified as p;
use rusqlite::Transaction;
use std::sync::Arc;

/// Only Commands constructs this frame from its actual authorized phase.
/// C is a trait parameter of CommandExtension<C>, preserving object safety.
pub(crate) struct ActiveCommandFrame<'phase, 'db, C> {
    pub(super) transaction: &'phase Transaction<'db>,
    pub(super) allocation: &'phase PresenceStoreAllocation,
    pub(super) instance: &'phase Arc<()>,
    pub(super) contract: &'phase C,
    pub(super) context: &'phase MutationAuthorizationContext,
    pub(super) results: &'phase [MutationResult],
    pub(super) command_hashes: &'phase [String],
    pub(super) batch_hash: Option<&'phase str>,
    /// From the owning Store's explicitly selected and validated fresh profile.
    pub(super) fresh_witness_profile: bool,
}

/// Exact original invocation inputs. Root supplies the accepted native version;
/// the type has no version, age, review, grant or guard fallback.
pub(super) struct OriginalPresenceEngine<'owner, 'access, 'origin, 'reader> {
    guard: &'owner a::TransactionAuthorization<'access>,
    access: &'owner p::OriginalPresenceAccess<'owner>,
    version: &'owner str,
    network: Option<(&'owner net::SqliteNetworkSidecar, &'owner net::LinkReview)>,
    age: &'owner p::ConfiguredCacheAge,
    now: &'owner dyn Fn() -> d::DomainResult<String>,
    qualifier: p::NativePresenceQualifier<'owner, 'access>,
    assertions: Vec<d::PresenceAssertion>,
    candidate_bindings: Vec<(Record, Operation)>,
    context_id: Option<String>,
    transaction_identity: Option<*const ()>,
    store_instance: Option<Arc<()>>,
    candidate_context: Option<MutationAuthorizationContext>,
    release_context: Option<MutationAuthorizationContext>,
    candidate_context_identity: Option<*const MutationAuthorizationContext>,
    precommit_context_identity: Option<*const MutationAuthorizationContext>,
    qualified_phase: Option<StockPresenceAuthorizationPhase>,
    qualifications: Vec<wire::PresenceQualification>,
    principal: &'owner app::RequestPrincipal,
    prepared: PreparedIdentity,
    invocation: Arc<()>,
    publications: &'owner [&'owner ConfiguredPresenceReleased<'origin, 'reader>],
}

pub(super) struct OriginalPresenceEngineInputs<'owner, 'access, 'origin, 'reader> {
    pub principal: &'owner a::Principal,
    pub command_principal: &'owner app::RequestPrincipal,
    pub prepared: PreparedIdentity,
    pub invocation: Arc<()>,
    pub guard: &'owner a::TransactionAuthorization<'access>,
    pub access: &'owner p::OriginalPresenceAccess<'owner>,
    pub network: Option<(&'owner net::SqliteNetworkSidecar, &'owner net::LinkReview)>,
    pub age: &'owner p::ConfiguredCacheAge,
    pub now: &'owner dyn Fn() -> d::DomainResult<String>,
    pub publications: &'owner [&'owner ConfiguredPresenceReleased<'origin, 'reader>],
}
pub(super) struct PresencePhaseRetention {
    pub candidate: MutationAuthorizationContext,
    pub precommit: MutationAuthorizationContext,
    pub witnesses: Vec<PresenceWitness>,
}
impl<'owner, 'access, 'origin, 'reader> OriginalPresenceEngine<'owner, 'access, 'origin, 'reader> {
    pub(super) fn revalidate_release<'phase, C: Contract>(
        &'phase self,
        transaction: &'phase Transaction<'_>,
        allocation: &PresenceStoreAllocation,
        instance: &'phase Arc<()>,
        contract: &C,
        context: &'phase MutationAuthorizationContext,
    ) -> Result<StockPresenceQualifiedPhase<'phase>> {
        if self.qualified_phase != Some(StockPresenceAuthorizationPhase::Precommit)
            || self.candidate_context.is_some()
            || context.phase != MutationPhase::Precommit
            || self.context_id.as_deref() != Some(context.context_id.as_str())
            || self.release_context.as_ref() != Some(context)
            || !self
                .store_instance
                .as_ref()
                .is_some_and(|saved| Arc::ptr_eq(saved, instance))
            || self.qualifications.len() != self.assertions.len()
            || self.qualifications.len() > 100
            || self
                .qualifier
                .captured_content()
                .is_none_or(|captured| captured.len() != self.qualifications.len())
        {
            return Err(incompatible());
        }
        let adapter = PresenceMutationTransaction::from_release(
            transaction,
            allocation,
            instance,
            contract,
            PresenceMutationInputs {
                context,
                principal: self.access.principal,
                guard: self.guard,
                access: self.access,
                accepted_access_package_version: self.version,
                network: self.network,
                publications: self.publications,
            },
        )
        .map_err(domain_error)?;
        let now = (self.now)().map_err(domain_error)?;
        adapter
            .revalidate_release_capture(&self.qualifier, &now, self.age)
            .map_err(domain_error)?;
        self.guard.revalidate().map_err(|_| unavailable())?;
        Ok(StockPresenceQualifiedPhase::issued(
            PresencePhaseProofInputs {
                phase: StockPresenceAuthorizationPhase::Release,
                context,
                qualifications: &self.qualifications,
                principal: self.principal,
                guard: self.guard,
                prepared: self.prepared,
                instance,
                invocation: &self.invocation,
                transaction,
            },
        ))
    }
    pub(super) fn new(
        input: OriginalPresenceEngineInputs<'owner, 'access, 'origin, 'reader>,
    ) -> Result<Self> {
        if !std::ptr::eq(input.principal, input.access.principal)
            || !std::ptr::eq(input.principal, input.guard.principal())
            || !std::ptr::eq(
                input.command_principal.principal.principal(),
                input.principal,
            )
        {
            return Err(Error::new(
                "forbidden",
                "Original presence principal allocation is required",
            ));
        }
        Ok(Self {
            guard: input.guard,
            access: input.access,
            version: a::NATIVE_ACCESS_PACKAGE_VERSION,
            network: input.network,
            age: input.age,
            now: input.now,
            qualifier: p::NativePresenceQualifier::new(
                input.guard,
                input.access,
                input.age,
                input.now,
            ),
            assertions: Vec::new(),
            candidate_bindings: Vec::new(),
            context_id: None,
            transaction_identity: None,
            store_instance: None,
            candidate_context: None,
            release_context: None,
            candidate_context_identity: None,
            precommit_context_identity: None,
            qualified_phase: None,
            qualifications: Vec::new(),
            principal: input.command_principal,
            prepared: input.prepared,
            invocation: input.invocation,
            publications: input.publications,
        })
    }
    pub(super) fn candidate<C: Contract>(
        &mut self,
        frame: &ActiveCommandFrame<'_, '_, C>,
    ) -> Result<()> {
        bounded_size(frame.context, MAX_ACCEPTED_FRAME_BYTES)?;
        if !frame.fresh_witness_profile
            || frame.context.phase != MutationPhase::Candidate
            || self.context_id.is_some()
        {
            return Err(incompatible());
        }
        let adapter = PresenceMutationTransaction::from_active(
            frame.transaction,
            frame.allocation,
            frame.instance,
            frame.contract,
            PresenceMutationInputs {
                context: frame.context,
                principal: self.access.principal,
                guard: self.guard,
                access: self.access,
                accepted_access_package_version: self.version,
                network: self.network,
                publications: self.publications,
            },
        )
        .map_err(domain_error)?;
        let candidate = frame.context.candidate.as_ref().ok_or_else(incompatible)?;
        let mut assertions = Vec::new();
        let mut bindings = Vec::new();
        for entry in &frame.context.entries {
            if entry.target.record_type != RecordType::Binding {
                continue;
            }
            let record = candidate
                .records
                .iter()
                .find(|r| r.matches(&frame.context.scope, &entry.target))
                .ok_or_else(incompatible)?;
            let prior = frame
                .context
                .original
                .records
                .iter()
                .find(|r| r.matches(&frame.context.scope, &entry.target));
            let original_domain: Option<d::Record> = prior.map(carrier).transpose()?;
            let requirement = d::binding_presence_requirement(
                original_domain.as_ref(),
                &carrier(record)?,
                carrier(&entry.command.operation)?,
            )
            .map_err(domain_error)?;
            match requirement {
                d::PresenceRequirement::NoNewObservation => {}
                d::PresenceRequirement::OutsideCurrentSemanticScope(_) => return Err(unavailable()),
                d::PresenceRequirement::Qualify(trigger) => {
                    assertions.push(d::PresenceAssertion {
                        scope: carrier(&frame.context.scope)?,
                        binding_record_id: record.record_id.clone(),
                        source: carrier(&record.payload["source"])?,
                        trigger,
                    });
                    bindings.push((record.clone(), entry.command.operation));
                }
            }
        }
        let facts: Vec<d::PresenceQualification> = d::PresenceQualifier::qualify(
            &mut self.qualifier,
            self.access.principal,
            &adapter,
            d::QualificationPhase::Candidate,
            &assertions,
        )
        .map_err(domain_error)?;
        if facts.len() != assertions.len() || facts.len() > 100 {
            return Err(incompatible());
        }
        self.qualifications = facts.iter().map(carrier).collect::<Result<_>>()?;
        self.assertions = assertions;
        self.candidate_bindings = bindings;
        self.context_id = Some(frame.context.context_id.clone());
        self.transaction_identity = Some(std::ptr::from_ref(frame.transaction).cast::<()>());
        self.store_instance = Some(Arc::clone(frame.instance));
        self.candidate_context = Some(frame.context.clone());
        self.candidate_context_identity = Some(std::ptr::from_ref(frame.context));
        self.qualified_phase = Some(StockPresenceAuthorizationPhase::Candidate);
        Ok(())
    }
    /// Future stage gate ONLY after actual Candidate capture. Root must preserve
    /// the existing default hold; no production call to this method is supplied.
    pub(super) fn check_staged_binding(&self, record: &Record, operation: Operation) -> Result<()> {
        if self.context_id.is_none()
            || !self
                .candidate_bindings
                .iter()
                .any(|(saved, op)| saved == record && *op == operation)
        {
            return Err(unavailable());
        }
        Ok(())
    }
    pub(super) fn qualify_precommit<C: Contract>(
        &mut self,
        frame: &ActiveCommandFrame<'_, '_, C>,
    ) -> Result<()> {
        bounded_size(frame.context, MAX_ACCEPTED_FRAME_BYTES)?;
        if !frame.fresh_witness_profile
            || frame.context.phase != MutationPhase::Precommit
            || self.transaction_identity != Some(std::ptr::from_ref(frame.transaction).cast::<()>())
            || !self
                .store_instance
                .as_ref()
                .is_some_and(|original| Arc::ptr_eq(original, frame.instance))
            || self.context_id.as_deref() != Some(frame.context.context_id.as_str())
        {
            return Err(incompatible());
        }
        let adapter = PresenceMutationTransaction::from_active(
            frame.transaction,
            frame.allocation,
            frame.instance,
            frame.contract,
            PresenceMutationInputs {
                context: frame.context,
                principal: self.access.principal,
                guard: self.guard,
                access: self.access,
                accepted_access_package_version: self.version,
                network: self.network,
                publications: self.publications,
            },
        )
        .map_err(domain_error)?;
        let facts: Vec<d::PresenceQualification> = d::PresenceQualifier::qualify(
            &mut self.qualifier,
            self.access.principal,
            &adapter,
            d::QualificationPhase::Precommit,
            &self.assertions,
        )
        .map_err(domain_error)?;
        let current: Vec<wire::PresenceQualification> =
            facts.iter().map(carrier).collect::<Result<_>>()?;
        if current != self.qualifications || current.len() != self.assertions.len() {
            return Err(incompatible());
        }
        self.precommit_context_identity = Some(std::ptr::from_ref(frame.context));
        self.qualified_phase = Some(StockPresenceAuthorizationPhase::Precommit);
        Ok(())
    }
    pub(super) fn qualified<'phase, C: Contract>(
        &'phase self,
        frame: &'phase ActiveCommandFrame<'_, '_, C>,
    ) -> Result<StockPresenceQualifiedPhase<'phase>> {
        let phase = self.qualified_phase.ok_or_else(incompatible)?;
        let identity = match phase {
            StockPresenceAuthorizationPhase::Candidate => self.candidate_context_identity,
            StockPresenceAuthorizationPhase::Precommit => self.precommit_context_identity,
            StockPresenceAuthorizationPhase::Release => None,
        };
        if identity != Some(std::ptr::from_ref(frame.context))
            || self.transaction_identity != Some(std::ptr::from_ref(frame.transaction).cast())
            || !self
                .store_instance
                .as_ref()
                .is_some_and(|saved| Arc::ptr_eq(saved, frame.instance))
            || self.context_id.as_deref() != Some(frame.context.context_id.as_str())
            || !frame.fresh_witness_profile
        {
            return Err(incompatible());
        }
        self.guard.revalidate().map_err(|_| unavailable())?;
        Ok(StockPresenceQualifiedPhase::issued(
            PresencePhaseProofInputs {
                phase,
                context: frame.context,
                qualifications: &self.qualifications,
                principal: self.principal,
                guard: self.guard,
                prepared: self.prepared,
                instance: self.store_instance.as_ref().ok_or_else(incompatible)?,
                invocation: &self.invocation,
                transaction: frame.transaction,
            },
        ))
    }
    /// After typed Precommit authorization, stamp the already validated capture
    /// into the same active transaction before its one SQL commit.
    pub(super) fn finish_precommit<C: Contract>(
        &mut self,
        frame: &ActiveCommandFrame<'_, '_, C>,
    ) -> Result<PresencePhaseRetention> {
        if self.qualified_phase != Some(StockPresenceAuthorizationPhase::Precommit)
            || self.precommit_context_identity != Some(std::ptr::from_ref(frame.context))
        {
            return Err(incompatible());
        }
        let adapter = PresenceMutationTransaction::from_active(
            frame.transaction,
            frame.allocation,
            frame.instance,
            frame.contract,
            PresenceMutationInputs {
                context: frame.context,
                principal: self.access.principal,
                guard: self.guard,
                access: self.access,
                accepted_access_package_version: self.version,
                network: self.network,
                publications: self.publications,
            },
        )
        .map_err(domain_error)?;
        let now = (self.now)().map_err(domain_error)?;
        let witnesses = adapter
            .retain_witnesses(
                &self.qualifier,
                frame.results,
                frame.command_hashes,
                frame.batch_hash,
                (&now, self.age),
            )
            .map_err(domain_error)?;
        bounded_size(&witnesses, MAX_ACCEPTED_FRAME_BYTES)?;
        let candidate = self.candidate_context.take().ok_or_else(incompatible)?;
        self.release_context = Some(frame.context.clone());
        Ok(PresencePhaseRetention {
            candidate,
            precommit: frame.context.clone(),
            witnesses,
        })
    }
}
fn carrier<T: serde::de::DeserializeOwned>(data: &impl serde::Serialize) -> Result<T> {
    Ok(serde_json::from_value(serde_json::to_value(data)?)?)
}
fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Original presence phase is incompatible",
    )
}
fn unavailable() -> Error {
    Error::new(
        "upstream-unavailable",
        "Original atomic presence qualification is held or unavailable",
    )
}
fn domain_error(error: d::DomainError) -> Error {
    Error::new(
        match error {
            d::DomainError::Unauthenticated => "unauthenticated",
            d::DomainError::Forbidden => "forbidden",
            d::DomainError::NotFound => "not-found",
            d::DomainError::InvalidContract => "invalid-contract",
            d::DomainError::UpstreamIncomplete => "upstream-incomplete",
            _ => "upstream-unavailable",
        },
        "Original presence qualification could not complete",
    )
}

/// Core has no original presence peer. The new fresh profile may mutate
/// existing bindings without a new observation, but cannot create qualification
/// through an unqualified Core path. Legacy profile behavior is preserved.
pub(crate) fn assert_core_presence_hold<C: Contract>(
    frame: &ActiveCommandFrame<'_, '_, C>,
) -> Result<()> {
    if !frame.fresh_witness_profile {
        return Ok(());
    }
    let candidate = frame.context.candidate.as_ref().ok_or_else(incompatible)?;
    for entry in &frame.context.entries {
        if entry.target.record_type != RecordType::Binding {
            continue;
        }
        let record = candidate
            .records
            .iter()
            .find(|r| r.matches(&frame.context.scope, &entry.target))
            .ok_or_else(incompatible)?;
        let prior = frame
            .context
            .original
            .records
            .iter()
            .find(|r| r.matches(&frame.context.scope, &entry.target));
        let original: Option<d::Record> = prior.map(carrier).transpose()?;
        let requirement = d::binding_presence_requirement(
            original.as_ref(),
            &carrier(record)?,
            carrier(&entry.command.operation)?,
        )
        .map_err(domain_error)?;
        d::enforce_current_presence_hold(requirement).map_err(domain_error)?;
    }
    Ok(())
}
