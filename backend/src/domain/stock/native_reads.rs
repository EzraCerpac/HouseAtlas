//! Borrow the actual native store and its required scoped stock-history peer.
//! History uses B throughout its owner transaction. Frozen ReadPort methods use
//! the store's configured A through the existing NativeStorage adapter; they
//! are not rebound to B. Under a held access fence, A must already be guard-safe,
//! or the host must dispatch those frozen record reads outside that held fence.
//! This module opens no connection, issues no authority and guesses no history.
use super::{
    OwnerResult, StockContractPort, StockError, StockHistoryPort, StockResult, ValidatedRequest,
};
use crate::{
    domain::{
        Audit, DomainResult, ReadPort, Record, RecordRef, Scope, Snapshot,
        native_storage::{NativeStorage, native_error},
    },
    storage::{AtlasStore, Authorization, Contract, Runtime, StockAuthorization},
};

pub struct NativeStockReads<'store, 'contracts, 'authorization, C, A, R, B>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
{
    store: &'store mut AtlasStore<C, A, R>,
    contracts: &'contracts C,
    authorization: &'authorization B,
}

impl<'store, 'contracts, 'authorization, C, A, R, B>
    NativeStockReads<'store, 'contracts, 'authorization, C, A, R, B>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
{
    /// Keep the same store, native contract profile and original borrowed
    /// StockAuthorization. This constructor acquires no access/storage fence.
    pub fn from_store(
        store: &'store mut AtlasStore<C, A, R>,
        contracts: &'contracts C,
        authorization: &'authorization B,
    ) -> Self {
        Self {
            store,
            contracts,
            authorization,
        }
    }
}

impl<C, A, R, B> ReadPort<A::Principal> for NativeStockReads<'_, '_, '_, C, A, R, B>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
{
    fn snapshot(&mut self, principal: &A::Principal, scope: &Scope) -> DomainResult<Snapshot> {
        NativeStorage::from_store(self.store, self.contracts).snapshot(principal, scope)
    }

    fn record(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Record> {
        NativeStorage::from_store(self.store, self.contracts).record(principal, scope, target)
    }

    fn history(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Vec<Audit>> {
        NativeStorage::from_store(self.store, self.contracts).history(principal, scope, target)
    }
}

impl<C, A, R, B> StockHistoryPort<A::Principal> for NativeStockReads<'_, '_, '_, C, A, R, B>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
{
    fn stock_history<S: StockContractPort>(
        &mut self,
        principal: &A::Principal,
        contracts: &S,
        request: &ValidatedRequest,
    ) -> StockResult<OwnerResult> {
        self.store
            .stock_history_json_with_authorization(
                self.authorization,
                principal,
                contracts,
                request.raw(),
            )
            .map_err(|error| StockError::Domain(native_error(error)))
    }
}
