//! Thin synchronous native-domain composition; no provider or persistence rules.
use std::sync::Mutex;

use super::{
    AssetDownloadCodec, AssetDownloadPort, NativeOperation, NativeOutput, NativePrincipal,
    PortError, PortFuture, ServicePort,
};
use crate::{access, domain::stock};

/// Query composition with one independently injected download owner. This
/// returns unreleased owner results through the same domain dispatch boundary.
pub struct NativeQueries<Q, D> {
    queries: Q,
    downloads: AssetDownloadCodec<D>,
}

impl<Q, D> NativeQueries<Q, D> {
    pub fn new(queries: Q, downloads: D) -> stock::StockResult<Self> {
        Ok(Self {
            queries,
            downloads: AssetDownloadCodec::new(downloads)?,
        })
    }
}

impl<P, W, G, Q, D> stock::StockQueryPort<P, W, G> for NativeQueries<Q, D>
where
    Q: stock::StockQueryPort<P, W, G>,
    D: AssetDownloadPort<P, W, G>,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &stock::PreparedRequest<W, G>,
    ) -> stock::StockResult<stock::OwnerResult> {
        match prepared.request().id() {
            stock::OperationId::AtlasAssetDownload => self.downloads.query(principal, prepared),
            _ => self.queries.query(principal, prepared),
        }
    }
}

struct Owners<R, Q, M> {
    preparer: R,
    queries: Q,
    commands: M,
}

pub struct NativeStockService<A, R, Q, M> {
    contracts: stock::NativeStockContract,
    authority: A,
    owners: Mutex<Owners<R, Q, M>>,
}

impl<A, R, Q, M> NativeStockService<A, R, Q, M> {
    pub fn new(authority: A, preparer: R, queries: Q, commands: M) -> Result<Self, PortError> {
        Ok(Self {
            contracts: stock::NativeStockContract::new()
                .map_err(super::native_catalog::stock_error)?,
            authority,
            owners: Mutex::new(Owners {
                preparer,
                queries,
                commands,
            }),
        })
    }
}

impl<A, R, Q, M> ServicePort<NativePrincipal, NativeOperation> for NativeStockService<A, R, Q, M>
where
    A: stock::StockAuthorityPort<access::Principal> + Send + Sync,
    R: stock::StockPreparerPort<access::Principal, A::Witness, Graph = A::Graph> + Send,
    Q: stock::StockQueryPort<access::Principal, A::Witness, A::Graph> + Send,
    M: stock::StockCommandPort<access::Principal, A::Witness, A::Graph> + Send,
{
    type Output = NativeOutput;

    fn execute<'a>(
        &'a self,
        principal: &'a NativePrincipal,
        operation: NativeOperation,
    ) -> PortFuture<'a, NativeOutput> {
        // The synchronous owners complete before constructing this future. No
        // mutex guard crosses await, and access revalidation never reenters a
        // borrowed mutation fence. Hosts must provide that fence inside M.
        let result = (|| {
            let mut owners = self.owners.lock().map_err(|_| PortError::Unavailable)?;
            let prepared = stock::prepare(
                principal.original(),
                operation.request.raw().clone(),
                &self.contracts,
                &self.authority,
                &mut owners.preparer,
            )
            .map_err(super::native_catalog::stock_error)?;
            let Owners {
                queries, commands, ..
            } = &mut *owners;
            let result = stock::dispatch(
                principal.original(),
                prepared,
                &self.contracts,
                &self.authority,
                queries,
                commands,
            )
            .map_err(super::native_catalog::stock_error)?;
            Ok(NativeOutput {
                request: operation.request,
                result,
            })
        })();
        Box::pin(std::future::ready(result))
    }
}

/// Explicit absence of the stock atomic write owner; never a mock commit.
pub struct UnavailableCommands;
impl<P, W, G> stock::StockCommandPort<P, W, G> for UnavailableCommands {
    fn execute(
        &mut self,
        _: &P,
        _: &stock::PreparedRequest<W, G>,
    ) -> stock::StockResult<stock::OwnerResult> {
        Err(stock::StockError::OwnerUnavailable)
    }
}
