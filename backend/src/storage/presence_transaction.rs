//! Private active-Store presence adapter. Mount as a child of `store`; Root
//! alone wires engine phases/schema. This source does not enable admission.
use super::super::{
    cache_repository as cache, context, presence_witness_repository as witnesses,
    repository as repo, *,
};
use super::AtlasStore;
use crate::app::homebox_presence::ConfiguredPresenceReleased;
use crate::{
    access as a,
    contracts::{self, stock as wire},
    domain as d,
    providers::network as net,
};
use d::qualified as presence;
use net::DurableNetworkSidecar;
use rusqlite::{Connection, Transaction};
use serde::{Serialize, de::DeserializeOwned};
use std::sync::{Arc, OnceLock};

/// Capture from the original Store before its connection is mutably borrowed.
/// Pointer values are compared only; never dereferenced or exposed publicly.
pub(super) struct PresenceStoreAllocation {
    connection: *const Connection,
    instance: Arc<()>,
}
impl PresenceStoreAllocation {
    pub(super) fn capture<C, A, R>(store: &AtlasStore<C, A, R>) -> Self {
        Self {
            connection: std::ptr::from_ref(&store.db),
            instance: Arc::clone(&store.instance),
        }
    }
}

/// All inputs are borrowed from the same owner invocation. No caller graph,
/// access DTO, newly issued grant or synthetic version/epoch fallback. The
/// explicitly accepted trusted owner version remains a required input.
pub(super) struct PresenceMutationInputs<'a, 'access, 'origin, 'reader> {
    pub context: &'a MutationAuthorizationContext,
    pub principal: &'a a::Principal,
    pub guard: &'a a::TransactionAuthorization<'access>,
    pub access: &'a presence::OriginalPresenceAccess<'a>,
    /// Explicit accepted Access owner version; never inferred from Cargo/schema.
    pub accepted_access_package_version: &'a str,
    /// Borrow the actual immutable Native owner for the whole active phase.
    pub network: Option<(&'a net::SqliteNetworkSidecar, &'a net::LinkReview)>,
    pub publications: &'a [&'a ConfiguredPresenceReleased<'origin, 'reader>],
}

pub(super) struct PresenceMutationTransaction<'a, 'db, 'access, 'origin, 'reader, C> {
    transaction: &'a Transaction<'db>,
    contract: &'a C,
    input: PresenceMutationInputs<'a, 'access, 'origin, 'reader>,
}
impl<'a, 'db, 'access, 'origin, 'reader, C: Contract>
    PresenceMutationTransaction<'a, 'db, 'access, 'origin, 'reader, C>
{
    /// Private engine hook only, after its normal Candidate/Precommit checks.
    /// Never opens a connection/transaction or accepts an arbitrary Connection.
    pub(super) fn from_active(
        transaction: &'a Transaction<'db>,
        allocation: &PresenceStoreAllocation,
        current_store_instance: &Arc<()>,
        contract: &'a C,
        input: PresenceMutationInputs<'a, 'access, 'origin, 'reader>,
    ) -> d::DomainResult<Self> {
        if allocation.connection != std::ptr::from_ref(&**transaction)
            || !Arc::ptr_eq(&allocation.instance, current_store_instance)
            || transaction.is_autocommit()
            || !std::ptr::eq(input.principal, input.guard.principal())
            || !std::ptr::eq(input.principal, input.access.principal)
        {
            return Err(d::DomainError::Forbidden);
        }
        let this = Self {
            transaction,
            contract,
            input,
        };
        this.check_phase_graph()?;
        Ok(this)
    }

    fn check_phase_graph(&self) -> d::DomainResult<()> {
        let facts = self.input.context;
        if self.transaction.is_autocommit()
            || facts.format != MUTATION_AUTHORIZATION_CONTEXT_FORMAT
            || facts.schema_version != 1
            || facts.entries.is_empty()
            || facts.entries.len() > 100
            || facts.replay.is_some()
            || !matches!(
                facts.phase,
                MutationPhase::Candidate | MutationPhase::Precommit
            )
            || self.input.principal.scope().workspace_id.as_str() != facts.scope.workspace_id
            || self.input.principal.scope().home_id.as_str() != facts.scope.home_id
        {
            return Err(d::DomainError::InvalidContract);
        }
        self.input.guard.assert_mutation().map_err(access_error)?;
        a::CanonicalId::parse(facts.context_id.clone())
            .map_err(|_| d::DomainError::InvalidContract)?;
        let mut targets = std::collections::BTreeSet::new();
        let mut mutations = std::collections::BTreeSet::new();
        for entry in &facts.entries {
            if !targets.insert((
                entry.target.record_type.as_str(),
                entry.target.record_id.as_str(),
            )) || !mutations.insert(entry.command.mutation_id.as_str())
            {
                return Err(d::DomainError::InvalidContract);
            }
        }
        match &facts.batch {
            Some(batch) if batch.commands == facts.entries => {}
            None if facts.entries.len() == 1 => {}
            _ => return Err(d::DomainError::InvalidContract),
        }
        let candidate = facts
            .candidate
            .as_ref()
            .ok_or(d::DomainError::InvalidContract)?;
        self.contract
            .validate_snapshot(&facts.original)
            .map_err(storage_error)?;
        self.contract
            .validate_snapshot(candidate)
            .map_err(storage_error)?;
        let visible = repo::snapshot(self.transaction).map_err(storage_error)?;
        let expected = if facts.phase == MutationPhase::Candidate {
            &facts.original
        } else {
            candidate
        };
        if visible != *expected
            || facts.targets
                != facts
                    .entries
                    .iter()
                    .map(|entry| entry.target.clone())
                    .collect::<Vec<_>>()
        {
            return Err(d::DomainError::InvalidContract);
        }
        let closure = context::closure(
            self.contract,
            &facts.scope,
            &facts.original,
            Some(candidate),
            &facts.entries,
            None,
        )
        .map_err(storage_error)?;
        if closure != facts.closure {
            return Err(d::DomainError::InvalidContract);
        }
        Ok(())
    }

    fn candidate(&self) -> d::DomainResult<&Snapshot> {
        self.input
            .context
            .candidate
            .as_ref()
            .ok_or(d::DomainError::InvalidContract)
    }
    fn find<'r>(&self, rows: &'r Snapshot, target: &RecordRef) -> d::DomainResult<&'r Record> {
        let mut found = rows
            .records
            .iter()
            .filter(|row| row.matches(&self.input.context.scope, target));
        let row = found.next().ok_or(d::DomainError::NotFound)?;
        if found.next().is_some() {
            return Err(d::DomainError::InvalidContract);
        }
        Ok(row)
    }
    fn partition(&self, candidate: &Record) -> d::DomainResult<SourcePartition> {
        if candidate.scope() != self.input.context.scope
            || candidate.record_type != RecordType::Binding
        {
            return Err(d::DomainError::InvalidContract);
        }
        let source: contracts::SourceKey = convert(&candidate.payload["source"])?;
        Ok(SourcePartition {
            workspace_id: candidate.workspace_id.clone(),
            home_id: candidate.home_id.clone(),
            source_instance_id: source.source_instance_id,
            collection_id: source.collection_id,
        })
    }

    /// Root calls only AFTER genuine qualifier precommit and normal final engine
    /// authorization; propagates every error before the engine's single COMMIT.
    /// Replays never call this hook. No retention proof or witness is returned.
    pub(super) fn retain_witnesses(
        &self,
        qualifier: &presence::NativePresenceQualifier<'_, '_>,
        results: &[MutationResult],
        hashes: &[String],
        original_batch_hash: Option<&str>,
        clock: (&str, &presence::ConfiguredCacheAge),
    ) -> d::DomainResult<Vec<wire::PresenceWitness>> {
        self.check_phase_graph()?;
        if self.input.context.phase != MutationPhase::Precommit
            || results.len() != self.input.context.entries.len()
            || hashes.len() != results.len()
        {
            return Err(d::DomainError::InvalidContract);
        }
        match (&self.input.context.batch, original_batch_hash) {
            (Some(batch), Some(hash)) => witnesses::check_batch_receipt(
                self.transaction,
                self.contract,
                &self.input.context.scope,
                self.input.principal.actor_id().as_str(),
                batch,
                hash,
                results,
            )
            .map_err(storage_error)?,
            (None, None) => {}
            _ => return Err(d::DomainError::InvalidContract),
        }
        let captured = qualifier
            .captured_content()
            .ok_or(d::DomainError::InvalidTransition)?;
        let mut expected = Vec::new();
        for (entry, result) in self.input.context.entries.iter().zip(results) {
            if result.replayed
                || result.record.reference() != entry.target
                || result.record.scope() != self.input.context.scope
                || self.find(self.candidate()?, &entry.target)? != &result.record
                || result.audit.operation != entry.command.operation
                || result.audit.mutation_id != entry.command.mutation_id
                || result.audit.actor_id != self.input.principal.actor_id().as_str()
            {
                return Err(d::DomainError::InvalidContract);
            }
            if entry.target.record_type == RecordType::Binding {
                let identity = self.find(
                    self.candidate()?,
                    &RecordRef {
                        record_type: RecordType::Identity,
                        record_id: result.record.payload["atlasId"]
                            .as_str()
                            .ok_or(d::DomainError::InvalidContract)?
                            .into(),
                    },
                )?;
                let original = self
                    .input
                    .context
                    .original
                    .records
                    .iter()
                    .find(|row| row.matches(&self.input.context.scope, &entry.target));
                let change = presence::PresenceChange {
                    original,
                    candidate: &result.record,
                    identity,
                    operation: entry.command.operation,
                };
                match presence::current_presence_requirement(&change)? {
                    d::PresenceRequirement::Qualify(_) => {
                        expected.push(result.record.record_id.as_str())
                    }
                    d::PresenceRequirement::NoNewObservation => {}
                    d::PresenceRequirement::OutsideCurrentSemanticScope(_) => {
                        return Err(d::DomainError::UpstreamUnavailable);
                    }
                }
            }
        }
        if captured.len() != expected.len()
            || captured
                .iter()
                .map(|capture| capture.candidate().record_id.as_str())
                .collect::<Vec<_>>()
                != expected
        {
            return Err(d::DomainError::InvalidContract);
        }
        // Build/verify every witness before any append. No partial set can be
        // committed: append errors escape the original engine transaction.
        let mut stamped = Vec::with_capacity(captured.len());
        for capture in captured {
            presence::revalidate_native_presence(
                capture,
                self,
                self.input.guard,
                self.input.access,
                clock,
            )?;
            let index = results
                .iter()
                .position(|result| result.record.reference() == capture.candidate().reference())
                .ok_or(d::DomainError::InvalidContract)?;
            let result = &results[index];
            let witness = capture.witness_content(&result.record, &result.audit)?;
            if witness.authority.context_id != self.input.context.context_id {
                return Err(d::DomainError::InvalidContract);
            }
            witnesses::check_final_rows(self.transaction, self.contract, result, &hashes[index])
                .map_err(storage_error)?;
            stamped.push(witness);
        }
        witnesses::append(self.transaction, self.contract, &stamped).map_err(storage_error)?;
        Ok(stamped)
    }
}

impl<C: Contract> presence::AtomicPresenceTransaction
    for PresenceMutationTransaction<'_, '_, '_, '_, '_, C>
{
    fn binding_change(
        &self,
        phase: d::QualificationPhase,
        assertion: &d::PresenceAssertion,
    ) -> d::DomainResult<presence::PresenceChange<'_>> {
        self.check_phase_graph()?;
        let expected = match phase {
            d::QualificationPhase::Candidate => MutationPhase::Candidate,
            d::QualificationPhase::Precommit => MutationPhase::Precommit,
        };
        if self.input.context.phase != expected
            || convert::<Scope>(&assertion.scope)? != self.input.context.scope
        {
            return Err(d::DomainError::InvalidContract);
        }
        let target = RecordRef {
            record_type: RecordType::Binding,
            record_id: assertion.binding_record_id.clone(),
        };
        let mut entries = self
            .input
            .context
            .entries
            .iter()
            .filter(|entry| entry.target == target);
        let entry = entries.next().ok_or(d::DomainError::InvalidContract)?;
        if entries.next().is_some() {
            return Err(d::DomainError::InvalidContract);
        }
        let candidate = self.find(self.candidate()?, &target)?;
        if convert::<serde_json::Value>(&assertion.source)? != candidate.payload["source"] {
            return Err(d::DomainError::InvalidContract);
        }
        let identity = self.find(
            self.candidate()?,
            &RecordRef {
                record_type: RecordType::Identity,
                record_id: candidate.payload["atlasId"]
                    .as_str()
                    .ok_or(d::DomainError::InvalidContract)?
                    .into(),
            },
        )?;
        let original = self
            .input
            .context
            .original
            .records
            .iter()
            .find(|row| row.matches(&self.input.context.scope, &target));
        Ok(presence::PresenceChange {
            original,
            candidate,
            identity,
            operation: entry.command.operation,
        })
    }

    fn assert_presence_graph(
        &self,
        original: Option<&Record>,
        candidate: &Record,
        identity: &Record,
        access: &presence::OriginalPresenceAccess<'_>,
    ) -> d::DomainResult<()> {
        self.check_phase_graph()?;
        if !std::ptr::eq(access, self.input.access)
            || !std::ptr::eq(self.input.principal, access.principal)
            || self.find(self.candidate()?, &candidate.reference())? != candidate
            || self.find(self.candidate()?, &identity.reference())? != identity
            || identity.record_type != RecordType::Identity
            || identity.lifecycle != Lifecycle::Active
            || candidate.payload["atlasId"] != identity.record_id
            || self
                .input
                .context
                .original
                .records
                .iter()
                .find(|row| row.matches(&candidate.scope(), &candidate.reference()))
                != original
        {
            return Err(d::DomainError::Forbidden);
        }
        access.revalidate(self.input.guard, candidate)?;
        let scope: a::Scope = convert(&self.input.context.scope)?;
        self.input
            .guard
            .authorize(&scope, a::Capability::Mutate)
            .map_err(access_error)?;
        for reference in &self.input.context.closure.source_refs {
            let reference: a::SourceRef = convert(reference)?;
            let grant = access
                .sources
                .iter()
                .find(|grant| grant.reference() == &reference)
                .ok_or(d::DomainError::Forbidden)?;
            self.input
                .guard
                .revalidate_source(grant)
                .map_err(access_error)?;
        }
        for partition in &self.input.context.closure.source_partitions {
            let partition: a::SourcePartition = convert(partition)?;
            let grant = access
                .partitions
                .iter()
                .find(|grant| grant.partition() == &partition)
                .ok_or(d::DomainError::Forbidden)?;
            self.input
                .guard
                .revalidate_source_partition(grant)
                .map_err(access_error)?;
        }
        let created: Vec<_> = self
            .input
            .context
            .entries
            .iter()
            .filter(|entry| entry.command.operation == Operation::Create)
            .map(|entry| ScopedTarget::new(&self.input.context.scope, &entry.target))
            .collect();
        for entry in &self.input.context.entries {
            let prior = self
                .input
                .context
                .original
                .records
                .iter()
                .find(|row| row.matches(&self.input.context.scope, &entry.target));
            let target = ScopedTarget::new(&self.input.context.scope, &entry.target);
            self.contract
                .assert_guards(
                    &self.input.context.original,
                    prior,
                    &entry.command,
                    &target,
                    &created,
                )
                .map_err(storage_error)?;
            self.contract
                .assert_final_mutation(self.candidate()?, prior, &entry.command, &target)
                .map_err(storage_error)?;
        }
        Ok(())
    }

    fn current_presence(
        &self,
        candidate: &Record,
    ) -> d::DomainResult<presence::CurrentPresenceRead> {
        self.check_phase_graph()?;
        self.input.access.revalidate(self.input.guard, candidate)?;
        if self.find(self.candidate()?, &candidate.reference())? != candidate {
            return Err(d::DomainError::InvalidContract);
        }
        let partition = self.partition(candidate)?;
        let registration = cache::source(self.transaction, &partition).map_err(storage_error)?;
        let publication =
            cache::publication_state(self.transaction, &partition).map_err(storage_error)?;
        if registration.owner != SourceOwner::Homebox {
            return Err(d::DomainError::UpstreamUnavailable);
        }
        let matching = self
            .input
            .publications
            .iter()
            .filter(|closed| {
                let committed = closed.committed();
                closed.origin().partition() == &partition
                    && closed.origin().registration() == &registration
                    && committed.registration() == &registration
                    && committed.successor_cache_epoch() == publication.cache_epoch
                    && publication.cache.as_ref() == Some(committed.cache())
                    && publication.homebox_entities == committed.homebox_entities()
                    && publication.network_relations == committed.network_relations()
                    && closed.native_generation().generation_id().as_str()
                        == committed
                            .cache()
                            .generation_id
                            .as_deref()
                            .unwrap_or_default()
            })
            .count();
        if matching != 1 {
            return Err(d::DomainError::UpstreamIncomplete);
        }
        let generation = publication
            .cache
            .as_ref()
            .and_then(|row| row.generation_id.as_deref())
            .ok_or(d::DomainError::UpstreamUnavailable)?;
        if !cache::generation_reserved(self.transaction, &partition, generation)
            .map_err(storage_error)?
        {
            return Err(d::DomainError::UpstreamIncomplete);
        }
        let original_epoch = self
            .input
            .context
            .cache_partitions
            .iter()
            .find(|row| {
                row.workspace_id == partition.workspace_id
                    && row.home_id == partition.home_id
                    && row.source_instance_id == partition.source_instance_id
                    && row.collection_id == partition.collection_id
            })
            .ok_or(d::DomainError::UpstreamIncomplete)?;
        if original_epoch.cache_epoch != publication.cache_epoch {
            return Err(d::DomainError::Forbidden);
        }
        let (network_row, network_review) = match registration.owner {
            SourceOwner::Homebox => (None, None),
            SourceOwner::Network => {
                let (sidecar, review) = self
                    .input
                    .network
                    .ok_or(d::DomainError::UpstreamUnavailable)?;
                let source: net::SourceRegistration = convert(&registration)?;
                let row = sidecar
                    .load(&source, generation)
                    .map_err(|_| d::DomainError::UpstreamIncomplete)?;
                // The native immutable archive must corroborate the saved row,
                // full registration and configured review; projections alone
                // are not complete Native membership evidence.
                let capture = sidecar
                    .reopen_original_capture(&source, generation)
                    .map_err(|_| d::DomainError::UpstreamIncomplete)?;
                if capture.registration() != &source
                    || capture.projected_receipt_sha256() != row.sha256
                    || &capture.generation().link_review != review
                {
                    return Err(d::DomainError::UpstreamIncomplete);
                }
                (Some(row), Some(review.clone()))
            }
            SourceOwner::Magicplan => return Err(d::DomainError::UpstreamUnavailable),
        };
        Ok(presence::CurrentPresenceRead {
            registration,
            publication,
            network_row,
            network_review,
        })
    }

    fn original_presence_authority(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        access: &presence::OriginalPresenceAccess<'_>,
        candidate: &Record,
    ) -> d::DomainResult<wire::PresenceAuthority> {
        self.check_phase_graph()?;
        if !std::ptr::eq(access, self.input.access)
            || !std::ptr::eq(guard, self.input.guard)
            || !std::ptr::eq(guard.principal(), self.input.principal)
            || !std::ptr::eq(access.principal, self.input.principal)
        {
            return Err(d::DomainError::Forbidden);
        }
        access.revalidate(guard, candidate)?;
        if self.find(self.candidate()?, &candidate.reference())? != candidate {
            return Err(d::DomainError::InvalidContract);
        }
        let partition = self.partition(candidate)?;
        let registration = cache::source(self.transaction, &partition).map_err(storage_error)?;
        let partition: a::SourcePartition = convert(&partition)?;
        let original = access
            .partitions
            .iter()
            .find(|grant| grant.partition() == &partition)
            .ok_or(d::DomainError::Forbidden)?;
        let metadata = guard
            .persisted_source_metadata(original)
            .map_err(access_error)?;
        let digest = contracts::semantics::canonical_digest(
            &serde_json::to_value(&registration).map_err(|_| d::DomainError::InvalidContract)?,
        )
        .map_err(|_| d::DomainError::InvalidContract)?;
        if convert::<SourceRegistration>(metadata.registration())? != registration
            || metadata.source_registration_sha256() != digest
        {
            return Err(d::DomainError::Forbidden);
        }
        static VERSION: OnceLock<regex::Regex> = OnceLock::new();
        let version = VERSION.get_or_init(|| {
            regex::Regex::new(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
                .expect("frozen presence version-string pattern")
        });
        if !version.is_match(self.input.accepted_access_package_version) {
            return Err(d::DomainError::InvalidContract);
        }
        Ok(wire::PresenceAuthority {
            authority_context_version: wire::PresenceAuthorityContextVersion::V1,
            context_id: self.input.context.context_id.clone(),
            access_package_version: self.input.accepted_access_package_version.into(),
            access_epoch: metadata.access_epoch().into(),
            source_registration_version: convert(&metadata.source_registration_version())?,
            source_registration_sha256: digest,
        })
    }
}

fn convert<T: DeserializeOwned>(value: &impl Serialize) -> d::DomainResult<T> {
    serde_json::from_value(
        serde_json::to_value(value).map_err(|_| d::DomainError::InvalidContract)?,
    )
    .map_err(|_| d::DomainError::InvalidContract)
}
fn storage_error(error: Error) -> d::DomainError {
    d::native_storage::native_error(error)
}
fn access_error(error: a::AccessError) -> d::DomainError {
    match error {
        a::AccessError::Unauthenticated => d::DomainError::Unauthenticated,
        a::AccessError::NotFound => d::DomainError::NotFound,
        a::AccessError::Unavailable => d::DomainError::UpstreamUnavailable,
        _ => d::DomainError::Forbidden,
    }
}
