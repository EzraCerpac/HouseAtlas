//! Borrowed actual AT11 authority for actual AT07 stock callbacks.
//!
//! GraphAuthorization is a required semantic owner, not a permission default.
//! Nothing here issues a principal, reconstructs an authority DTO, locks access,
//! opens a storage transaction, or qualifies provider/source-presence admission.

use crate::{access as a, domain as d, storage as s};
use d::stock::{PreparedRequest, request_digest};
use serde_json::Value;

/// The constructor alone captures original entity/partition handles, all with
/// this exact borrowed principal. Fields are private; arbitrary mixed-principal
/// grant vectors cannot be admitted through the read-boundary context.
pub struct CapturedAccess<'p> {
    principal: &'p a::Principal,
    sources: Vec<a::SourceGrant>,
    partitions: Vec<a::PartitionGrant>,
}

impl<'p> CapturedAccess<'p> {
    /// Initial capture only: the original authority producer supplies complete
    /// original source refs/partitions, retains this capture in its witness,
    /// then prepares that same immutable intent. Never call after preparation
    /// to replace the witness's earlier handles with newly issued grants.
    /// This does not resolve or authorize a graph or certify completeness.
    pub fn capture(
        boundary: &a::AccessBoundary,
        principal: &'p a::Principal,
        references: &[a::SourceRef],
        partitions: &[a::SourcePartition],
    ) -> a::AccessResult<Self> {
        boundary.revalidate(principal)?;
        let sources = references
            .iter()
            .map(|reference| boundary.authorize_source(principal, reference))
            .collect::<a::AccessResult<Vec<_>>>()?;
        let mut complete_partitions = partitions.to_vec();
        for reference in references {
            let partition = reference.partition();
            if !complete_partitions.contains(&partition) {
                complete_partitions.push(partition);
            }
        }
        let partitions = complete_partitions
            .iter()
            .map(|partition| boundary.authorize_source_partition(principal, partition))
            .collect::<a::AccessResult<Vec<_>>>()?;
        boundary.revalidate(principal)?;
        Ok(Self {
            principal,
            sources,
            partitions,
        })
    }

    pub fn principal(&self) -> &a::Principal {
        self.principal
    }

    /// Opaque, immutable original handles for the required owner to bind to its
    /// captured witness. Grant metadata cannot be deserialized into authority.
    pub fn source_grants(&self) -> &[a::SourceGrant] {
        &self.sources
    }

    pub fn partition_grants(&self) -> &[a::PartitionGrant] {
        &self.partitions
    }
}

/// Read has no edit-role requirement. Mutation is built only inside AT11's
/// existing synchronous with_mutation_authorization callback. Neither variant
/// reacquires an access mutex or issues a replacement grant.
#[derive(Clone, Copy)]
pub enum AccessContext<'a, 'tx> {
    Read(&'a a::AccessBoundary),
    Mutation(&'a a::TransactionAuthorization<'tx>),
}

/// Mandatory original-witness/complete-graph authorization. Every callback
/// must check the original resolved graph and captured witness against the
/// actual supplied facts, including all record refs (present and missing),
/// guards, source refs/partitions, candidate effects, phase/replay facts and
/// output disclosure. Scope/actor/digest equality alone is insufficient.
/// Implementations must retain their own verified original witness provenance.
/// A synthetic healthy-example implementation is not production qualification.
pub trait GraphAuthorization<W, G> {
    /// Must prove this exact sealed capture belongs to prepared.witness(),
    /// including original grant provenance and original preparation epochs.
    /// A newly issued same-P capture cannot replace the original witness.
    fn revalidate_prepared(
        &self,
        principal: &a::Principal,
        captured: &CapturedAccess<'_>,
        prepared: &PreparedRequest<W, G>,
    ) -> s::Result<()>;

    fn authorize_native(
        &self,
        principal: &a::Principal,
        prepared: &PreparedRequest<W, G>,
        request: &s::AuthorizationRequest<'_>,
    ) -> s::Result<()>;

    /// Uses frame.closure, which includes stock root guards in addition to the
    /// native closure. Enforce required phase order, original/candidate/replay
    /// identity, preconditions and final/replay commit disclosure; do not refresh
    /// the graph/witness or substitute current grants for captured grants.
    fn authorize_stock_mutation(
        &self,
        principal: &a::Principal,
        prepared: &PreparedRequest<W, G>,
        frame: &s::StockMutationFrame<'_>,
    ) -> s::Result<()>;

    /// Both intake and result calls are required, even for empty pages. Check
    /// every supplied audit and the actual owner output against original graph
    /// facts, without reconstructing stock provenance from bare frozen audits.
    fn authorize_stock_history(
        &self,
        principal: &a::Principal,
        prepared: &PreparedRequest<W, G>,
        frame: &s::StockHistoryFrame<'_>,
    ) -> s::Result<()>;
}

/// Same borrowed original P/grants/prepared witness and graph at all domain
/// and storage checks. The host separately supplies trusted AuthorizedHome
/// metadata, whose labels/edit capability are not invented from a role DTO.
pub struct NativeStockAuthority<'a, 'tx, 'p, W, G, F> {
    context: AccessContext<'a, 'tx>,
    captured: &'a CapturedAccess<'p>,
    prepared: &'a PreparedRequest<W, G>,
    graph: &'a F,
    home: &'a d::AuthorizedHome,
}

impl<'a, 'tx, 'p, W, G, F: GraphAuthorization<W, G>> NativeStockAuthority<'a, 'tx, 'p, W, G, F> {
    pub fn new(
        context: AccessContext<'a, 'tx>,
        captured: &'a CapturedAccess<'p>,
        prepared: &'a PreparedRequest<W, G>,
        graph: &'a F,
        home: &'a d::AuthorizedHome,
    ) -> s::Result<Self> {
        let result = Self {
            context,
            captured,
            prepared,
            graph,
            home,
        };
        result.check_original(captured.principal)?;
        let scope = prepared.request().context();
        if home.home.scope.workspace_id != scope.workspace_id
            || home.home.scope.home_id != scope.home_id
            || (home.can_edit_homebox && captured.principal.role() != a::Role::Editor)
        {
            return Err(denied());
        }
        Ok(result)
    }

    fn check_original(&self, principal: &a::Principal) -> s::Result<()> {
        // Principal has private session/issuance provenance and no equality
        // interface. Exact borrow identity avoids comparing a public actor DTO.
        if !std::ptr::eq(principal, self.captured.principal) {
            return Err(denied());
        }
        let scope = self.prepared.request().context();
        if principal.scope().workspace_id.as_str() != scope.workspace_id
            || principal.scope().home_id.as_str() != scope.home_id
        {
            return Err(denied());
        }
        match self.context {
            AccessContext::Read(boundary) => {
                boundary.revalidate(principal).map_err(access_error)?;
                for grant in &self.captured.sources {
                    boundary.revalidate_source(grant).map_err(access_error)?;
                }
                for grant in &self.captured.partitions {
                    boundary
                        .revalidate_source_partition(grant)
                        .map_err(access_error)?;
                }
            }
            AccessContext::Mutation(guard) => {
                if !std::ptr::eq(guard.principal(), principal) {
                    return Err(denied());
                }
                guard.revalidate().map_err(access_error)?;
                for grant in &self.captured.sources {
                    guard.revalidate_source(grant).map_err(access_error)?;
                }
                for grant in &self.captured.partitions {
                    guard
                        .revalidate_source_partition(grant)
                        .map_err(access_error)?;
                }
            }
        }
        self.graph
            .revalidate_prepared(principal, self.captured, self.prepared)
    }

    fn authorize_capability(
        &self,
        principal: &a::Principal,
        scope: &s::Scope,
        capability: a::Capability<'_>,
    ) -> s::Result<()> {
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(scope)?)?;
        match self.context {
            AccessContext::Read(boundary) => {
                // Mutation must remain inside the actual access transaction.
                if matches!(capability, a::Capability::Mutate) {
                    return Err(denied());
                }
                boundary
                    .authorize_storage(principal, &scope, capability)
                    .map_err(access_error)?;
            }
            AccessContext::Mutation(guard) => {
                guard.authorize(&scope, capability).map_err(access_error)?;
            }
        }
        Ok(())
    }

    fn source(&self, reference: &Value) -> s::Result<()> {
        let reference: a::SourceRef = serde_json::from_value(reference.clone())?;
        if !self
            .captured
            .sources
            .iter()
            .any(|grant| grant.reference() == &reference)
        {
            return Err(denied());
        }
        self.partition(&serde_json::to_value(reference.partition())?)
    }

    fn partition(&self, partition: &Value) -> s::Result<()> {
        let partition: a::SourcePartition = serde_json::from_value(partition.clone())?;
        if self
            .captured
            .partitions
            .iter()
            .any(|grant| grant.partition() == &partition)
        {
            Ok(())
        } else {
            Err(denied())
        }
    }

    fn closure(&self, closure: &s::MutationClosure) -> s::Result<()> {
        for reference in &closure.source_refs {
            self.source(reference)?;
        }
        for partition in &closure.source_partitions {
            self.partition(&serde_json::to_value(partition)?)?;
        }
        // Complete record and missing-record authorization belongs to the
        // required GraphAuthorization callback, which receives this full frame.
        Ok(())
    }

    fn actor(&self) -> s::VerifiedActor {
        let principal = self.captured.principal;
        s::VerifiedActor {
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
            actor_id: principal.actor_id().as_str().into(),
        }
    }

    fn correlate_mutation(&self, frame: &s::StockMutationFrame<'_>) -> s::Result<()> {
        let request = self.prepared.request();
        let plan = frame.plan;
        if !request.is_mutation()
            || plan.original_request() != request.raw()
            || plan.request_digest() != request.intent_digest()
            || plan.scope() != &frame.native.scope
            || plan.scope().workspace_id != request.context().workspace_id
            || plan.scope().home_id != request.context().home_id
        {
            return Err(denied());
        }
        let expected: Vec<_> = if request.children().is_empty() {
            vec![(None, request)]
        } else {
            request
                .children()
                .iter()
                .enumerate()
                .map(|(i, child)| (Some(i), child))
                .collect()
        };
        if expected.len() != plan.groups().len() {
            return Err(denied());
        }
        for ((index, request), group) in expected.iter().zip(plan.groups()) {
            if *index != group.child_index()
                || request.raw() != group.original_request()
                || request.intent_digest() != group.request_digest()
            {
                return Err(denied());
            }
        }
        let entries: Vec<_> = plan
            .groups()
            .iter()
            .flat_map(|group| group.native_entries().iter().cloned())
            .collect();
        if entries != frame.native.entries {
            return Err(denied());
        }
        if let Some(commit) = frame.commit {
            // Genuine replay retains its original root transport ID. Compare
            // the published root-only intent digest, never require a fresh ID.
            if commit.request_digest != request.intent_digest()
                || request_digest(&commit.original_request).map_err(|_| denied())?
                    != request.intent_digest()
                || commit.actor_id != self.actor().actor_id
                || commit.groups.len() != plan.groups().len()
            {
                return Err(denied());
            }
            for (retained, planned) in commit.groups.iter().zip(plan.groups()) {
                if retained.child_index != planned.child_index()
                    || retained.request_digest != planned.request_digest()
                    || !canonical_equal(
                        retained.native_entries.as_slice(),
                        planned.native_entries(),
                    )?
                    || (planned.child_index().is_some()
                        && !canonical_equal(
                            &retained.original_request,
                            planned.original_request(),
                        )?)
                {
                    return Err(denied());
                }
            }
        }
        Ok(())
    }
}

impl<W, G, F: GraphAuthorization<W, G>> s::Authorization
    for NativeStockAuthority<'_, '_, '_, W, G, F>
{
    type Principal = a::Principal;

    fn authorize(
        &self,
        principal: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.check_original(principal)?;
        let capability = match request.capability {
            s::Capability::Read | s::Capability::ReadCache => a::Capability::Read,
            s::Capability::ReadHistory => a::Capability::ReadHistory,
            s::Capability::ReadAssetManifest => a::Capability::ReadAssetManifest,
            s::Capability::Mutate => a::Capability::Mutate,
            s::Capability::ConfigureSource | s::Capability::PublishCache => return Err(denied()),
        };
        self.authorize_capability(principal, request.scope, capability)?;
        if let Some(source) = request.source {
            self.source(source)?;
        }
        if let Some(partition) = request.source_partition {
            self.partition(&serde_json::to_value(partition)?)?;
        }
        if let Some(native) = request.mutation {
            self.closure(&native.closure)?;
        }
        self.graph
            .authorize_native(principal, self.prepared, &request)?;
        Ok(self.actor())
    }
}

impl<W, G, F: GraphAuthorization<W, G>> s::StockAuthorization
    for NativeStockAuthority<'_, '_, '_, W, G, F>
{
    fn authorize_stock_mutation(
        &self,
        principal: &a::Principal,
        frame: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.check_original(principal)?;
        self.authorize_capability(principal, &frame.native.scope, a::Capability::Mutate)?;
        self.correlate_mutation(&frame)?;
        self.closure(frame.closure)?;
        self.graph
            .authorize_stock_mutation(principal, self.prepared, &frame)?;
        Ok(self.actor())
    }

    fn authorize_stock_history(
        &self,
        principal: &a::Principal,
        frame: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.check_original(principal)?;
        self.authorize_capability(principal, frame.scope, a::Capability::ReadHistory)?;
        let request = self.prepared.request();
        if request.is_mutation()
            || frame.request != request.raw()
            || frame.scope.workspace_id != request.context().workspace_id
            || frame.scope.home_id != request.context().home_id
            || request.target()["recordType"] != frame.target.record_type.as_str()
            || request.target()["recordId"] != frame.target.record_id
        {
            return Err(denied());
        }
        self.graph
            .authorize_stock_history(principal, self.prepared, &frame)?;
        Ok(self.actor())
    }
}

impl<W, G, F: GraphAuthorization<W, G>> d::AccessPort<a::Principal>
    for NativeStockAuthority<'_, '_, '_, W, G, F>
{
    fn authorize(
        &self,
        principal: &a::Principal,
        scope: &d::Scope,
        capability: d::Capability,
    ) -> d::DomainResult<d::AuthorizedHome> {
        self.revalidate(principal, scope, capability)?;
        Ok(self.home.clone())
    }

    fn revalidate(
        &self,
        principal: &a::Principal,
        scope: &d::Scope,
        capability: d::Capability,
    ) -> d::DomainResult<()> {
        let check = || -> s::Result<()> {
            self.check_original(principal)?;
            let scope = s::Scope {
                workspace_id: scope.workspace_id.clone(),
                home_id: scope.home_id.clone(),
            };
            let capability = match capability {
                d::Capability::Read => a::Capability::Read,
                d::Capability::ReadHistory => a::Capability::ReadHistory,
                d::Capability::Mutate => a::Capability::Mutate,
            };
            self.authorize_capability(principal, &scope, capability)
        };
        check().map_err(d::native_storage::native_error)
    }
}

// Use the native owner's policy for complete retained carriers. Numeric JSON
// spellings may differ; array order, omitted/null fields and all metadata stay
// part of the comparison. Neither caller's original value is normalized.
fn canonical_equal<T: serde::Serialize + ?Sized>(retained: &T, planned: &T) -> s::Result<bool> {
    let native = d::native_semantics::NativeSemantics::native();
    let retained = s::Contract::canonical_json(&native, &serde_json::to_value(retained)?)?;
    let planned = s::Contract::canonical_json(&native, &serde_json::to_value(planned)?)?;
    Ok(retained == planned)
}

fn denied() -> s::Error {
    s::Error::new(
        "forbidden",
        "Original authority does not cover this operation",
    )
}

fn access_error(error: a::AccessError) -> s::Error {
    s::Error::new(error.code(), "Access authority check failed")
}
