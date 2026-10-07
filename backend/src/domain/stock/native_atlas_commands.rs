//! Thin Atlas stock command binding to the published native transaction.
//!
//! The host constructs this inside its genuine original-grant authorization
//! fence. B must borrow the original principal and prepared witness/graph and
//! implement both native and stock phase checks using the same retained handles.
//! It must reject new presence admission until atomic witness integration exists.
//! This adapter issues no authority and performs no access calls that could
//! reenter the held guard. The outer stock dispatch still controls disclosure.

use crate::domain::{
    native_storage::native_error,
    stock::{
        Authority, Effect, OwnerResult, PreparedRequest, StockCommandPort, StockContractPort,
        StockError, StockResult,
    },
};
use crate::storage::{AtlasStore, Authorization, Contract, Runtime, StockAuthorization};

/// A borrowed store and the required original scoped authorizer/schema peer.
/// No private SQL handle, runtime or authority state is exposed or replaced.
pub struct NativeAtlasCommands<
    'store,
    'authorization,
    'contracts,
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
    S: StockContractPort,
> {
    store: &'store mut AtlasStore<C, A, R>,
    authorization: &'authorization B,
    contracts: &'contracts S,
}

impl<'store, 'authorization, 'contracts, C, A, R, B, S>
    NativeAtlasCommands<'store, 'authorization, 'contracts, C, A, R, B, S>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
    S: StockContractPort,
{
    /// B must retain this call's immutable original P/witness/graph under its
    /// actual guard. Reacquisition, grant substitution and authority refresh do
    /// not satisfy the native stock transaction's phase obligations.
    pub fn from_store(
        store: &'store mut AtlasStore<C, A, R>,
        authorization: &'authorization B,
        contracts: &'contracts S,
    ) -> Self {
        Self {
            store,
            authorization,
            contracts,
        }
    }
}

impl<C, A, R, B, S, W, G> StockCommandPort<A::Principal, W, G>
    for NativeAtlasCommands<'_, '_, '_, C, A, R, B, S>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: StockAuthorization<Principal = A::Principal>,
    S: StockContractPort,
{
    fn execute(
        &mut self,
        principal: &A::Principal,
        prepared: &PreparedRequest<W, G>,
    ) -> StockResult<OwnerResult> {
        let request = prepared.request();
        if request.operation().authority != Authority::Atlas
            || request.operation().effect != Effect::Write
        {
            return Err(StockError::CapabilityHeld);
        }
        let commit = self
            .store
            .execute_stock_json_with_authorization(
                self.authorization,
                principal,
                self.contracts,
                request.raw(),
            )
            .map_err(|error| StockError::Domain(native_error(error)))?;
        // These envelopes were mapped and validated inside the owner's atomic
        // stock commit. No frozen receipt, UUID, actor or result is relabeled.
        Ok(commit.owner_result())
    }
}
