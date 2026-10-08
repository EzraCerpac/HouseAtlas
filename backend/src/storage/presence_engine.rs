//! SOURCE PROPOSAL, private Store child. No entry point or engine mount supplied.
use super::super::*;
use super::presence_transaction::{
    PresenceMutationInputs, PresenceMutationTransaction, PresenceStoreAllocation,
};
use crate::{access as a, domain as d, providers::network as net};
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
pub(super) struct OriginalPresenceEngine<'owner, 'access> {
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
}

pub(super) struct OriginalPresenceEngineInputs<'owner, 'access> {
    pub principal: &'owner a::Principal,
    pub guard: &'owner a::TransactionAuthorization<'access>,
    pub access: &'owner p::OriginalPresenceAccess<'owner>,
    pub network: Option<(&'owner net::SqliteNetworkSidecar, &'owner net::LinkReview)>,
    pub age: &'owner p::ConfiguredCacheAge,
    pub now: &'owner dyn Fn() -> d::DomainResult<String>,
}
impl<'owner, 'access> OriginalPresenceEngine<'owner, 'access> {
    pub(super) fn new(input: OriginalPresenceEngineInputs<'owner, 'access>) -> Result<Self> {
        if !std::ptr::eq(input.principal, input.access.principal)
            || !std::ptr::eq(input.principal, input.guard.principal())
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
        })
    }
    pub(super) fn candidate<C: Contract>(
        &mut self,
        frame: &ActiveCommandFrame<'_, '_, C>,
    ) -> Result<()> {
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
        d::PresenceQualifier::qualify(
            &mut self.qualifier,
            self.access.principal,
            &adapter,
            d::QualificationPhase::Candidate,
            &assertions,
        )
        .map_err(domain_error)?;
        self.assertions = assertions;
        self.candidate_bindings = bindings;
        self.context_id = Some(frame.context.context_id.clone());
        self.transaction_identity = Some(std::ptr::from_ref(frame.transaction).cast::<()>());
        self.store_instance = Some(Arc::clone(frame.instance));
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
    /// Root must invoke after normal final output authorization and receipt
    /// writes, propagate errors, then perform its one existing COMMIT.
    pub(super) fn precommit<C: Contract>(
        &mut self,
        frame: &ActiveCommandFrame<'_, '_, C>,
    ) -> Result<usize> {
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
            },
        )
        .map_err(domain_error)?;
        d::PresenceQualifier::qualify(
            &mut self.qualifier,
            self.access.principal,
            &adapter,
            d::QualificationPhase::Precommit,
            &self.assertions,
        )
        .map_err(domain_error)?;
        let now = (self.now)().map_err(domain_error)?;
        adapter
            .retain_witnesses(
                &self.qualifier,
                frame.results,
                frame.command_hashes,
                frame.batch_hash,
                (&now, self.age),
            )
            .map_err(domain_error)
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
