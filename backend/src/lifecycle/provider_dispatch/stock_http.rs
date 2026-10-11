//! Async stock host consuming the exact sibling HTTP implementation.
//! Durability is mandatory through the actual StockActivityPort; this namespace
//! does not implement it or translate the distinct native jobs protocol.
use crate::{
    config::provider_dispatch::stock_http::TrustedStockHttpConfig,
    providers::homebox::{
        write::stock::{
            StockAccessPort, StockActivityPort, StockContractPort, StockPreparationPort,
            StockReadbackPort, StockResult, StockWriter, StoredOperation,
        },
        write_transport::{DispatchResources, HttpDispatcher, TransportFault},
    },
};
use serde_json::Value;

/// Trusted owner peers. Activity must be the accepted durable implementation
/// bound to the original typed authority and the shared exclusive physical
/// queue, with transactions released before any preparation/transport await.
/// An in-memory stock activity implementation does not satisfy that contract.
pub struct StockHttpPeers<C, A, P, S, H, R> {
    pub contracts: C,
    pub access: A,
    pub preparation: P,
    pub activity: S,
    pub resources: H,
    pub readback: R,
}

/// One deployment-owned mutable entry into the actual stock workflow. A mutable
/// borrow serializes local callers for the complete async operation, without
/// retaining an application database mutex guard. Durable cross-alias admission
/// and proof-preserving state transitions remain the activity owner's duties.
pub struct StockHttpDispatcher<C, A, P, S, H, R> {
    writer: StockWriter<C, A, P, S, HttpDispatcher<H>, R>,
}

impl<
    C: StockContractPort,
    A: StockAccessPort,
    P: StockPreparationPort,
    S: StockActivityPort,
    H: DispatchResources,
    R: StockReadbackPort,
> StockHttpDispatcher<C, A, P, S, H, R>
{
    /// Build the real HTTP driver without dispatching, logging in, granting,
    /// reading stage bytes or preparing a provider operation. The configured
    /// source/dispatcher epochs must be the activity owner's authoritative
    /// epochs; no jobs fence is guessed or coerced into a stock epoch here.
    pub fn new(
        peers: StockHttpPeers<C, A, P, S, H, R>,
        config: TrustedStockHttpConfig,
    ) -> Result<Self, TransportFault> {
        let dispatch = config.into_http(peers.resources)?;
        Ok(Self {
            writer: StockWriter {
                contracts: peers.contracts,
                access: peers.access,
                preparation: peers.preparation,
                activity: peers.activity,
                dispatch,
                readback: peers.readback,
            },
        })
    }

    /// Preserve the caller's exact accepted JSON value. StockWriter owns closed
    /// validation, deduplication, original authority, preparation, admission,
    /// one invocation, readback and disclosure. This host adds no retry engine.
    pub async fn execute(&mut self, original_wire: &Value) -> StockResult {
        self.writer.execute(original_wire).await
    }

    /// Explicit durable-owner handoff for an authorized never-invoked prepared
    /// or queued operation. StockWriter revalidates its immutable facts and
    /// admits it atomically. This is not an automatic startup/recovery scan;
    /// accepted storage must supply the actual operation and original authority.
    pub async fn run_reserved(&mut self, operation: StoredOperation) -> StockResult {
        self.writer.run_reserved(operation).await
    }
}
