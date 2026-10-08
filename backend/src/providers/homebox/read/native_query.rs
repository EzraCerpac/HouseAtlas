//! Configured native GET intake and retained, original-preparation read owner.
use super::{
    CapturedStockEntity, CapturedStockMaintenance, Clock, HomeBoxReader, SourceScope, Timestamp,
    Transport, Uuid,
    query::{
        DecodedReadObservation, DecodedReadOwner, HomeBoxReadOwner, HomeBoxReadQuery,
        HomeBoxReadResult, SourceStatus,
    },
};
use crate::{
    access as a,
    domain::{self as d, stock as st},
    storage,
};
use std::sync::{Arc, Mutex};

struct OriginalSource<'a, 'p> {
    access: Arc<Mutex<a::AccessBoundary>>,
    captured: &'a st::CapturedAccess<'p>,
}
struct OriginalRead<'a, 'p, W, G, F> {
    source: OriginalSource<'a, 'p>,
    prepared: &'a st::PreparedRequest<W, G>,
    graph_owner: &'a F,
}
impl OriginalSource<'_, '_> {
    fn access_check(&self) -> st::StockResult<()> {
        let access = self
            .access
            .lock()
            .map_err(|_| st::StockError::OwnerUnavailable)?;
        access
            .revalidate(self.captured.principal())
            .map_err(access_error)?;
        for grant in self.captured.source_grants() {
            access.revalidate_source(grant).map_err(access_error)?;
        }
        for grant in self.captured.partition_grants() {
            access
                .revalidate_source_partition(grant)
                .map_err(access_error)?;
        }
        Ok(())
    }
    fn source(&self, scope: &SourceScope, owner: &Uuid) -> st::StockResult<()> {
        let partition = |p: &a::SourcePartition| {
            p.workspace_id.as_str() == scope.workspace_id.as_str()
                && p.home_id.as_str() == scope.home_id.as_str()
                && p.source_instance_id.as_str() == scope.source_instance_id.as_str()
                && p.collection_id == scope.collection_id
        };
        let principal = self.captured.principal();
        if principal.scope().workspace_id.as_str() != scope.workspace_id.as_str()
            || principal.scope().home_id.as_str() != scope.home_id.as_str()
            || !self
                .captured
                .partition_grants()
                .iter()
                .any(|g| partition(g.partition()))
            || !self.captured.source_grants().iter().any(|g| {
                let r = g.reference();
                partition(&r.partition())
                    && r.key.source_kind == a::SourceKind::HomeboxEntity
                    && r.key.external_id == owner.as_str()
            })
        {
            return Err(st::StockError::CapabilityDenied);
        }
        Ok(())
    }
}

impl<W, G, F: st::GraphAuthorization<W, G>> OriginalRead<'_, '_, W, G, F> {
    fn revalidate(&self) -> st::StockResult<()> {
        self.source.access_check()?;
        // No Access lock is held while the semantic owner checks its original
        // graph/witness. The owner may use its own Store critical section.
        self.graph_owner
            .revalidate_prepared(
                self.source.captured.principal(),
                self.source.captured,
                self.prepared,
            )
            .map_err(|error| st::StockError::Domain(d::native_storage::native_error(error)))?;
        self.source.access_check()
    }
}

enum RetainedCapture {
    Detail(Box<CapturedStockEntity>),
    Maintenance(Box<CapturedStockMaintenance>),
}
impl RetainedCapture {
    fn original_bytes(&self) -> &[u8] {
        match self {
            Self::Detail(c) => c.original_bytes(),
            Self::Maintenance(c) => c.original_bytes(),
        }
    }
    fn retrieved_at(&self) -> &Timestamp {
        match self {
            Self::Detail(c) => c.retrieved_at(),
            Self::Maintenance(c) => c.retrieved_at(),
        }
    }
}

/// Sealed original GET response observed before graph preparation. Its members
/// and parent edges are source data for the existing original graph resolver,
/// never grants, authority, a completeness claim or a replacement witness.
/// No response is dispatched until bind_prepared and Domain disclosure succeed.
pub struct NativeReadCapture<'a, 'p> {
    source: OriginalSource<'a, 'p>,
    capture: RetainedCapture,
    observation: DecodedReadObservation,
}
impl<'a, 'p> NativeReadCapture<'a, 'p> {
    pub fn original_bytes(&self) -> &[u8] {
        self.capture.original_bytes()
    }
    pub fn retrieved_at(&self) -> &Timestamp {
        self.capture.retrieved_at()
    }
    pub fn observation(&self) -> &DecodedReadObservation {
        &self.observation
    }
    /// Consume this original capture into the exact original prepared request.
    /// The mandatory owner checks the original captured access and immutable G;
    /// no discovered reference is added to G by this conversion.
    pub fn bind_prepared<W, G, F: st::GraphAuthorization<W, G>>(
        self,
        prepared: &'a st::PreparedRequest<W, G>,
        graph_owner: &'a F,
    ) -> st::StockResult<NativeReadOwner<'a, 'p, W, G, F>> {
        if prepared.request().raw() != self.observation.original_request() {
            return Err(st::StockError::CorrelationMismatch);
        }
        let original = OriginalRead {
            source: self.source,
            prepared,
            graph_owner,
        };
        original.revalidate()?;
        let references = self.observation.references().to_vec();
        let read = DecodedReadOwner::bind(
            original.source.captured.principal(),
            prepared,
            self.observation,
        )?;
        Ok(NativeReadOwner {
            original,
            capture: self.capture,
            read,
            references,
        })
    }
}

/// Actual retained native read input, bound to the original opaque principal,
/// grants, prepared witness/graph and semantic owner. No lock crosses GET await.
/// This must remain inside the existing Domain dispatch_prepared boundary;
/// graph completeness and final result disclosure remain its owners' duties.
pub struct NativeReadOwner<'a, 'p, W, G, F> {
    original: OriginalRead<'a, 'p, W, G, F>,
    capture: RetainedCapture,
    read: DecodedReadOwner<'a, a::Principal, W, G>,
    references: Vec<crate::contracts::stock::StockTarget>,
}
impl<W, G, F> NativeReadOwner<'_, '_, W, G, F> {
    pub fn original_bytes(&self) -> &[u8] {
        self.capture.original_bytes()
    }
    pub fn retrieved_at(&self) -> &Timestamp {
        self.capture.retrieved_at()
    }
    /// Retained source selectors are data, never a complete authorized graph.
    pub fn references(&self) -> &[crate::contracts::stock::StockTarget] {
        &self.references
    }
}
impl<W, G, F: st::GraphAuthorization<W, G>> HomeBoxReadOwner<a::Principal, W, G>
    for NativeReadOwner<'_, '_, W, G, F>
{
    fn read(
        &mut self,
        principal: &a::Principal,
        prepared: &st::PreparedRequest<W, G>,
        query: &HomeBoxReadQuery,
    ) -> st::StockResult<HomeBoxReadResult> {
        if !std::ptr::eq(principal, self.original.source.captured.principal())
            || !std::ptr::eq(prepared, self.original.prepared)
        {
            return Err(st::StockError::AuthorityChanged);
        }
        self.original.revalidate()?;
        // Borrow our retained observation through the existing original-pointer
        // owner, without cloning/replacing its request, witness or graph.
        let result = self.read.read(principal, prepared, query)?;
        self.original.revalidate()?;
        Ok(result)
    }
}

impl<T: Transport, K: Clock> HomeBoxReader<T, K> {
    /// Convenience intake when the original graph already independently
    /// qualifies every result member. It cannot extend that immutable graph.
    pub async fn capture_prepared_read<'a, 'p, C, W, G, F>(
        &mut self,
        contracts: &C,
        access: &Arc<Mutex<a::AccessBoundary>>,
        captured: &'a st::CapturedAccess<'p>,
        prepared: &'a st::PreparedRequest<W, G>,
        graph_owner: &'a F,
    ) -> st::StockResult<NativeReadOwner<'a, 'p, W, G, F>>
    where
        C: st::StockContractPort,
        F: st::GraphAuthorization<W, G>,
    {
        let original = OriginalRead {
            source: OriginalSource {
                access: Arc::clone(access),
                captured,
            },
            prepared,
            graph_owner,
        };
        original.revalidate()?;
        self.capture_native_read(contracts, access, captured, prepared.request())
            .await?
            .bind_prepared(prepared, graph_owner)
    }

    /// Capture real fixed GET data under the same original source handles,
    /// before the existing preparer resolves and authorizes the full graph.
    /// Credentials remain the configured transport owner's mandatory input.
    /// The Access mutex is used only in short synchronous phases; no guard is
    /// retained across I/O or while the graph owner takes its own Store lock.
    pub async fn capture_native_read<'a, 'p, C: st::StockContractPort>(
        &mut self,
        contracts: &C,
        access: &Arc<Mutex<a::AccessBoundary>>,
        captured: &'a st::CapturedAccess<'p>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<NativeReadCapture<'a, 'p>> {
        let query = HomeBoxReadQuery::from_request(request)?;
        if query.scope() != self.scope() {
            return Err(st::StockError::CorrelationMismatch);
        }
        let operation = request.id();
        let (owner_key, maintenance) = match operation {
            st::OperationId::HomeboxEntityTagsGet => ("resourceId", false),
            st::OperationId::HomeboxFieldList | st::OperationId::HomeboxFieldGet => {
                ("entityId", false)
            }
            st::OperationId::HomeboxMaintenanceList | st::OperationId::HomeboxMaintenanceGet => {
                ("entityId", true)
            }
            _ => return Err(st::StockError::OwnerUnavailable),
        };
        let owner = Uuid::parse(
            request.target()[owner_key]
                .as_str()
                .ok_or(st::StockError::InvalidContract)?,
        )
        .map_err(|_| st::StockError::InvalidContract)?;
        let original = OriginalSource {
            access: Arc::clone(access),
            captured,
        };
        original.source(self.scope(), &owner)?;
        original.access_check()?;
        let (capture, observation) = if maintenance {
            let c = self
                .capture_stock_maintenance(&owner)
                .await
                .map_err(|_| st::StockError::OwnerUnavailable)?;
            if c.entity_id() != &owner
                || c.scope() != query.scope()
                || c.status() != 200
                || c.path() != format!("/api/v1/entities/{}/maintenance", owner.as_str())
                || c.query() != [("status".into(), "both".into())]
            {
                return Err(st::StockError::CorrelationMismatch);
            }
            original.access_check()?;
            let observation = DecodedReadObservation::from_maintenance(
                contracts,
                request,
                c.scope(),
                c.wire_decoded(),
                c.retrieved_at(),
                SourceStatus::Unresolved,
            )?;
            (RetainedCapture::Maintenance(Box::new(c)), observation)
        } else {
            let c = self
                .capture_stock_entity(&owner)
                .await
                .map_err(|_| st::StockError::OwnerUnavailable)?;
            if c.entity_id() != &owner
                || c.scope() != query.scope()
                || c.status() != 200
                || c.path() != format!("/api/v1/entities/{}", owner.as_str())
                || !c.query().is_empty()
            {
                return Err(st::StockError::CorrelationMismatch);
            }
            original.access_check()?;
            let observation = DecodedReadObservation::from_detail(
                contracts,
                request,
                c.scope(),
                c.wire_decoded(),
                c.retrieved_at(),
                SourceStatus::Unresolved,
            )?;
            (RetainedCapture::Detail(Box::new(c)), observation)
        };
        Ok(NativeReadCapture {
            source: original,
            capture,
            observation,
        })
    }
}

fn access_error(error: a::AccessError) -> st::StockError {
    st::StockError::Domain(d::native_storage::native_error(storage::Error::new(
        error.code(),
        "Original source access is unavailable",
    )))
}
