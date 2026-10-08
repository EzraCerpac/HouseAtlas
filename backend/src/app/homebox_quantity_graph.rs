//! Target-only quantity graph under the original installed source phase.
//! This prepares the existing Domain/native carrier. It issues no approval,
//! queue admission, invocation permit, output release or replacement grant.
use crate::{
    access,
    app::{
        homebox_quantity_startup::OriginalQuantityPhysical,
        stock_activity_principal::OriginalStockActivityPrincipal,
    },
    config::providers::quantity_installation::OriginalQuantityConfigured,
    domain::stock as domain,
    providers::homebox::write::stock as native,
    storage,
};
use serde_json::Value;
use std::sync::Arc;
use storage::StockActivityPrincipal as _;

type QuantityContracts = crate::providers::homebox::recovery::NativeWriterContracts;
type PreparedQuantity<'native, 'p, 'owner, T, K> = domain::PreparedRequest<
    QuantityWitness<'native, 'p, 'owner, QuantityContracts, native::QuantitySource<'p, T, K>>,
    QuantityGraph<'native, 'p, 'owner, QuantityContracts, native::QuantitySource<'p, T, K>>,
>;

/// The original prepared allocations survive between phases, but no original
/// transaction guard does. Only the genuine graph constructor can bind this
/// bundle; every activity transaction rebuilds the current phase authority.
pub struct OriginalQuantityPreparation<
    'native,
    'p,
    'owner,
    T: crate::providers::homebox::read::Transport,
    K: crate::providers::homebox::read::Clock + Send + Sync,
> {
    prepared: &'native PreparedQuantity<'native, 'p, 'owner, T, K>,
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native native::RetainedFreshPreparation<
        'owner,
        QuantityContracts,
        native::QuantitySource<'p, T, K>,
    >,
    original: &'p OriginalStockActivityPrincipal,
    configured: Arc<OriginalQuantityConfigured>,
}

impl<
    'native,
    'p,
    'owner,
    T: crate::providers::homebox::read::Transport,
    K: crate::providers::homebox::read::Clock + Send + Sync,
> OriginalQuantityPreparation<'native, 'p, 'owner, T, K>
{
    pub fn bind<'phase>(
        prepared: &'native PreparedQuantity<'native, 'p, 'owner, T, K>,
        authority: &QuantityGraphAuthority<
            'phase,
            '_,
            'native,
            'p,
            'owner,
            QuantityContracts,
            native::QuantitySource<'p, T, K>,
        >,
    ) -> domain::StockResult<Self>
    where
        'native: 'phase,
    {
        domain::GraphAuthorization::revalidate_prepared(
            authority,
            authority.captured.principal(),
            authority.captured,
            prepared,
        )
        .map_err(|_| changed())?;
        Ok(Self {
            prepared,
            captured: authority.captured,
            native: authority.native,
            original: authority.original,
            configured: Arc::clone(&authority.configured),
        })
    }
    pub fn prepared(&self) -> &PreparedQuantity<'native, 'p, 'owner, T, K> {
        self.prepared
    }
    pub fn captured(&self) -> &domain::CapturedAccess<'p> {
        self.captured
    }
    pub fn native(
        &self,
    ) -> &native::RetainedFreshPreparation<
        'owner,
        QuantityContracts,
        native::QuantitySource<'p, T, K>,
    > {
        self.native
    }
    pub fn original(&self) -> &'p OriginalStockActivityPrincipal {
        self.original
    }
    pub fn configured(&self) -> &Arc<OriginalQuantityConfigured> {
        &self.configured
    }

    pub fn revalidate_activity_transaction<'phase>(
        &self,
        guard: &'phase access::TransactionAuthorization<'_>,
        transaction: &'phase storage::QuantityInstallationTransaction<
            'phase,
            'p,
            OriginalStockActivityPrincipal,
        >,
    ) -> domain::StockResult<()>
    where
        'native: 'phase,
    {
        let physical = OriginalQuantityPhysical::from_activity_transaction(
            &self.configured,
            transaction,
            guard,
        )
        .map_err(|_| changed())?;
        let authority = QuantityGraphAuthority::new(guard, self.captured, self.native, &physical)?;
        let retained = domain::NativeQueueOriginalPreparation::bind_with_quantity_installation(
            guard,
            self.prepared,
            self.captured,
            &authority,
            self.native,
            &physical,
        )?;
        retained.revalidate_with_quantity_installation(guard, self.native.authority(), &physical)
    }
}

// Closed type bound, with no qualification callback or data constructor. Only
// the concrete native quantity source can supply this production graph. Its
// installed observation/reader custody is checked by the existing qualifier.
mod installed_source {
    use crate::providers::homebox::{read, write::stock as native};
    pub trait Source: native::FreshPreparationSourcePort {}
    impl<T: read::Transport, K: read::Clock + Send + Sync> Source for native::QuantitySource<'_, T, K> {}
}

/// The same genuine native preparation is retained in the original graph.
/// No constructor, Clone or serialized reconstruction of this graph exists.
pub struct QuantityGraph<'native, 'p, 'owner, C, S: installed_source::Source> {
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native native::RetainedFreshPreparation<'owner, C, S>,
    original: &'p OriginalStockActivityPrincipal,
    configured: Arc<OriginalQuantityConfigured>,
}
impl<'owner, C, S: installed_source::Source> domain::NativeQueueOriginalGraph<'owner, C, S>
    for QuantityGraph<'_, '_, 'owner, C, S>
{
    fn original_native_preparation(&self) -> &native::RetainedFreshPreparation<'owner, C, S> {
        self.native
    }
}

/// Captures original allocations, rather than matching actor or digest DATA.
pub struct QuantityWitness<'native, 'p, 'owner, C, S: installed_source::Source> {
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native native::RetainedFreshPreparation<'owner, C, S>,
    original: &'p OriginalStockActivityPrincipal,
    configured: Arc<OriginalQuantityConfigured>,
}

/// One synchronous phase. The host retains its actual Store borrow and guard;
/// there is no lock acquisition, provider I/O or authority refresh here.
pub struct QuantityGraphAuthority<'phase, 'tx, 'native, 'p, 'owner, C, S: installed_source::Source>
{
    qualification: native::FreshQualification<'phase, 'tx, 'p>,
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native native::RetainedFreshPreparation<'owner, C, S>,
    original: &'p OriginalStockActivityPrincipal,
    configured: Arc<OriginalQuantityConfigured>,
}

impl<
    'phase,
    'tx,
    'native: 'phase,
    'p,
    'owner,
    C: native::StockContractPort + Sync,
    S: installed_source::Source,
> QuantityGraphAuthority<'phase, 'tx, 'native, 'p, 'owner, C, S>
{
    pub fn new(
        guard: &'phase access::TransactionAuthorization<'tx>,
        captured: &'native domain::CapturedAccess<'p>,
        native: &'native native::RetainedFreshPreparation<'owner, C, S>,
        physical: &'phase OriginalQuantityPhysical<'phase, 'p>,
    ) -> domain::StockResult<Self> {
        let qualification =
            native::FreshQualification::with_quantity_installation(guard, captured, physical)
                .map_err(|_| changed())?;
        let owner = Self {
            qualification,
            captured,
            native,
            original: physical.observation().original(),
            configured: Arc::clone(physical.configured()),
        };
        owner.revalidate_original()?;
        Ok(owner)
    }

    /// The complete supported effect is one exact existing entity's quantity.
    /// Unsupported Atlas guards and collection/cascade effects stay unavailable.
    pub fn prepare(
        &self,
        contracts: &impl domain::StockContractPort,
    ) -> domain::StockResult<
        domain::PreparedRequest<
            QuantityWitness<'native, 'p, 'owner, C, S>,
            QuantityGraph<'native, 'p, 'owner, C, S>,
        >,
    > {
        let mut resolver = QuantityResolver {
            captured: self.captured,
            native: self.native,
            original: self.original,
            configured: Arc::clone(&self.configured),
        };
        domain::prepare(
            self.captured.principal(),
            self.native.command().original_wire.clone(),
            contracts,
            self,
            &mut resolver,
        )
    }

    fn revalidate_original(&self) -> domain::StockResult<()> {
        let principal = self.captured.principal();
        let command = self.native.command();
        let target = &command.target;
        let source = self.original.original_activity_source();
        let partition = self.original.original_activity_partition();
        let expected = self.configured.descriptor();
        if !std::ptr::eq(principal, self.original.original_activity_principal())
            || !std::ptr::eq(principal, self.qualification.guard().principal())
            || command != self.original.command()
            || self.native.authority() != self.original.captured_authority()
            || command.command_id != "homebox.entity.quantity.set"
            || command.context != expected.scope
            || *target != expected.target
            || target.resource_kind != native::ResourceKind::Entity
            || target.entity_id.is_some()
            || command.native_sync_behavior.is_some()
            || command.approval_receipt_id.is_some()
            || !matches!(expected.policy, native::QuantityPolicy::NoHuman { .. })
            || self.captured.source_grants().len() != 1
            || self.captured.partition_grants().len() != 1
            || self.captured.source_grants()[0].reference() != source.reference()
            || self.captured.partition_grants()[0].partition() != partition.partition()
            || source.reference().partition() != *partition.partition()
            || command.original_wire["preconditions"]["atlasGuards"]
                .as_array()
                .is_none_or(|guards| !guards.is_empty())
        {
            return Err(changed());
        }
        self.native
            .revalidate_in_guard(&self.qualification, command, self.native.authority())
            .map_err(|_| domain::StockError::OwnerUnavailable)?;
        let preflight = self.native.preflight();
        let plan = self.native.plan();
        let path = format!("/api/v1/entities/{}", target.id().map_err(|_| changed())?);
        if preflight.preparation.snapshots.len() != 1
            || preflight.preparation.snapshots[0].target != *target
            || !preflight.preparation.snapshots[0].complete
            || preflight.preparation.staged_upload.is_some()
            || !preflight.preparation.native_clear_values.is_empty()
            || self.native.capture().snapshots().len() != 1
            || plan.request.method != native::NativeMethod::Patch
            || plan.request.path != path
            || !plan.request.query.is_empty()
            || plan.request.body != native::NativeBody::Json(command.payload.clone())
            || plan.readback.path != path
            || plan.readback.target != *target
            || !plan.readback.query.is_empty()
            || plan.readback.selector != native::ReadbackSelector::Whole
            || plan.readback.expected != command.payload
            || plan.readback.absence
            || plan.generated != native::GeneratedIdentity::None
            || plan.requires_complete_impact
            || command
                .payload
                .as_object()
                .is_none_or(|payload| payload.len() != 1 || !payload.contains_key("quantity"))
            || command.payload["quantity"].as_u64().is_none()
        {
            return Err(domain::StockError::UnsupportedCapability);
        }
        Ok(())
    }

    fn request(
        &self,
        principal: &access::Principal,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<()> {
        self.revalidate_original()?;
        if !std::ptr::eq(principal, self.captured.principal())
            || request.id() != domain::OperationId::HomeboxEntityQuantitySet
            || request.raw() != &self.native.command().original_wire
            || request.intent_digest() != self.native.command().request_digest.as_str()
            || !request.children().is_empty()
            || request.whole_collection_required()
        {
            return Err(changed());
        }
        Ok(())
    }

    fn witness(&self, witness: &QuantityWitness<'_, '_, 'owner, C, S>) -> domain::StockResult<()> {
        if !std::ptr::eq(witness.captured, self.captured)
            || !std::ptr::eq(witness.native, self.native)
            || !std::ptr::eq(witness.original, self.original)
            || !Arc::ptr_eq(&witness.configured, &self.configured)
        {
            return Err(changed());
        }
        Ok(())
    }
    fn graph(&self, graph: &QuantityGraph<'_, '_, 'owner, C, S>) -> domain::StockResult<()> {
        if !std::ptr::eq(graph.captured, self.captured)
            || !std::ptr::eq(graph.native, self.native)
            || !std::ptr::eq(graph.original, self.original)
            || !Arc::ptr_eq(&graph.configured, &self.configured)
        {
            return Err(changed());
        }
        Ok(())
    }
}

impl<
    'phase,
    'tx,
    'native: 'phase,
    'p,
    'owner,
    C: native::StockContractPort + Sync,
    S: installed_source::Source,
> domain::StockAuthorityPort<access::Principal>
    for QuantityGraphAuthority<'phase, 'tx, 'native, 'p, 'owner, C, S>
{
    type Witness = QuantityWitness<'native, 'p, 'owner, C, S>;
    type Graph = QuantityGraph<'native, 'p, 'owner, C, S>;
    fn capture(
        &self,
        principal: &access::Principal,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<Self::Witness> {
        self.request(principal, request)?;
        Ok(QuantityWitness {
            captured: self.captured,
            native: self.native,
            original: self.original,
            configured: Arc::clone(&self.configured),
        })
    }
    fn authorize_graph(
        &self,
        principal: &access::Principal,
        witness: &Self::Witness,
        request: &domain::ValidatedRequest,
        graph: &Self::Graph,
    ) -> domain::StockResult<()> {
        self.request(principal, request)?;
        self.witness(witness)?;
        self.graph(graph)
    }
    fn revalidate(
        &self,
        principal: &access::Principal,
        witness: &Self::Witness,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<()> {
        self.request(principal, request)?;
        self.witness(witness)
    }
    fn authorize_result(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<Self::Witness, Self::Graph>,
        _: &domain::ValidatedRequest,
        _: &Value,
    ) -> domain::StockResult<()> {
        // Original activity outcome and final HTTP disclosure are separate owners.
        Err(domain::StockError::OwnerUnavailable)
    }
    fn disclose(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<Self::Witness, Self::Graph>,
        _: &domain::ValidatedRequest,
        _: &Value,
        _: &Value,
        _: domain::DisclosurePurpose,
    ) -> domain::StockResult<()> {
        Err(domain::StockError::OwnerUnavailable)
    }
}

struct QuantityResolver<'native, 'p, 'owner, C, S: installed_source::Source> {
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native native::RetainedFreshPreparation<'owner, C, S>,
    original: &'p OriginalStockActivityPrincipal,
    configured: Arc<OriginalQuantityConfigured>,
}
impl<'native, 'p, 'owner, C: native::StockContractPort + Sync, S: installed_source::Source>
    domain::StockPreparerPort<access::Principal, QuantityWitness<'native, 'p, 'owner, C, S>>
    for QuantityResolver<'native, 'p, 'owner, C, S>
{
    type Graph = QuantityGraph<'native, 'p, 'owner, C, S>;
    fn resolve(
        &mut self,
        principal: &access::Principal,
        witness: &QuantityWitness<'native, 'p, 'owner, C, S>,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<Self::Graph> {
        if !std::ptr::eq(principal, self.captured.principal())
            || !std::ptr::eq(witness.captured, self.captured)
            || !std::ptr::eq(witness.native, self.native)
            || !std::ptr::eq(witness.original, self.original)
            || !Arc::ptr_eq(&witness.configured, &self.configured)
            || request.raw() != &self.native.command().original_wire
        {
            return Err(changed());
        }
        Ok(QuantityGraph {
            captured: self.captured,
            native: self.native,
            original: self.original,
            configured: Arc::clone(&self.configured),
        })
    }
}

impl<
    'phase,
    'tx,
    'native: 'phase,
    'p,
    'owner,
    C: native::StockContractPort + Sync,
    S: installed_source::Source,
>
    domain::GraphAuthorization<
        QuantityWitness<'native, 'p, 'owner, C, S>,
        QuantityGraph<'native, 'p, 'owner, C, S>,
    > for QuantityGraphAuthority<'phase, 'tx, 'native, 'p, 'owner, C, S>
{
    fn revalidate_prepared(
        &self,
        principal: &access::Principal,
        captured: &domain::CapturedAccess<'_>,
        prepared: &domain::PreparedRequest<
            QuantityWitness<'native, 'p, 'owner, C, S>,
            QuantityGraph<'native, 'p, 'owner, C, S>,
        >,
    ) -> storage::Result<()> {
        if !std::ptr::eq(captured, self.captured) {
            return Err(unavailable());
        }
        self.request(principal, prepared.request())
            .map_err(|_| unavailable())?;
        self.witness(prepared.witness())
            .map_err(|_| unavailable())?;
        self.graph(prepared.graph()).map_err(|_| unavailable())
    }
    fn authorize_native(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<
            QuantityWitness<'native, 'p, 'owner, C, S>,
            QuantityGraph<'native, 'p, 'owner, C, S>,
        >,
        _: &storage::AuthorizationRequest<'_>,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
    fn authorize_stock_mutation(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<
            QuantityWitness<'native, 'p, 'owner, C, S>,
            QuantityGraph<'native, 'p, 'owner, C, S>,
        >,
        _: &storage::StockMutationFrame<'_>,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
    fn authorize_stock_history(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<
            QuantityWitness<'native, 'p, 'owner, C, S>,
            QuantityGraph<'native, 'p, 'owner, C, S>,
        >,
        _: &storage::StockHistoryFrame<'_>,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
}
fn changed() -> domain::StockError {
    domain::StockError::AuthorityChanged
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "upstream-unavailable",
        "Quantity preparation does not authorize this owner action",
    )
}
