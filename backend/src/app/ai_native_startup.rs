//! Explicit application composition retaining the original native AI owners.
//! Construction is opt-in and supplies no configuration, approval or admission.
use crate::ai::{
    AiError,
    host::{
        continuation::ExactReviewReady,
        lifecycle::ConnectionFacts,
        native::NativeHostContext,
        startup::{
            NativeStartup, StartupInputs, StartupOwners,
            account::NativeAccountStartup,
            authority::StartupAuthority,
            stock::{NativeReadDomain, NativeReadPrepared},
        },
        trusted_startup::StartupCustody,
    },
    runtime::HumanReviewPort,
    stock::{AcceptedStockCommand, SharedStockPort, StockCatalog},
};
use axum::Router;
use std::sync::Arc;

/// Explicit account observation composition. Retains the original native
/// startup, while mounting only its authenticated local account GET consumer.
/// Construction supplies no enrollment, sign-in, callback worker or listener.
pub struct NativeAccountAiApplication {
    startup: Arc<NativeAccountStartup>,
    router: Router,
}

impl NativeAccountAiApplication {
    /// The same Host and enrollment allocations reach both native startup and
    /// HTTP capture. Native assembly verifies their original Access/journal
    /// ownership. Pinned configuration remains an explicit input.
    pub fn assemble_account_only_reads(owners: StartupOwners) -> Result<Self, AiError> {
        Self::assemble_with_custody(owners, None)
    }

    pub(crate) fn assemble_with_custody(
        owners: StartupOwners,
        custody: Option<Arc<crate::lifecycle::ai_account::NativeAccountCustody>>,
    ) -> Result<Self, AiError> {
        let host = owners.host.clone();
        let enrollment = Arc::clone(&owners.enrollment);
        let startup = Arc::new(NativeAccountStartup::assemble(owners)?);
        let account = crate::http::ai_account::mounted_router(
            host.clone(),
            Arc::clone(&startup),
            enrollment,
            custody,
        );
        let router = crate::http::router_with_ai(host, Some(account));
        Ok(Self { startup, router })
    }

    pub fn router(&self) -> &Router {
        &self.router
    }

    pub fn startup(&self) -> &NativeAccountStartup {
        &self.startup
    }
}

/// Keep this application owner alive while serving its router and driving any
/// separately authorized native operation. No worker or listener starts here.
pub struct NativeAiApplication<O, R, D = NativeReadDomain>
where
    O: ConnectionFacts<NativeHostContext>,
    D: SharedStockPort<NativeHostContext> + Send + Sync,
    D::Prepared: Send + Sync,
    R: ExactReviewReady<NativeHostContext, AcceptedStockCommand<D::Prepared>>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync,
{
    startup: NativeStartup<O, D, R>,
    router: Router,
}

impl<O, R> NativeAiApplication<O, R>
where
    O: ConnectionFacts<NativeHostContext> + 'static,
    R: ExactReviewReady<NativeHostContext, NativeReadPrepared>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync
        + 'static,
{
    /// Compose only explicitly supplied original owners and inputs. The HTTP
    /// router receives a clone of the exact Host consumed by native assembly,
    /// retaining the same Core and Access allocations. Assembly checks that the
    /// enrollment and journal belong to that original Access owner.
    pub fn assemble_native_reads(
        owners: StartupOwners,
        inputs: StartupInputs<R, O>,
    ) -> Result<Self, AiError> {
        let host = owners.host.clone();
        let startup = NativeStartup::assemble_native_reads(owners, inputs)?;
        let router = crate::http::router_with_ai(host, Some(startup.mounted_router()));
        Ok(Self { startup, router })
    }

    /// The existing read factory with explicit original native custody. No
    /// account-only database is reopened or promoted to a writable journal.
    pub fn assemble_native_reads_with_custody<C: StartupCustody + 'static>(
        owners: StartupOwners,
        inputs: StartupInputs<R, O>,
        custody: Arc<C>,
    ) -> Result<Self, AiError> {
        Self::assemble(
            owners,
            inputs,
            crate::ai::host::startup::stock::native_read_catalog,
            custody,
        )
    }
}

impl<O, R, D> NativeAiApplication<O, R, D>
where
    O: ConnectionFacts<NativeHostContext> + 'static,
    D: SharedStockPort<NativeHostContext> + Send + Sync + 'static,
    D::Prepared: Send + Sync + 'static,
    R: ExactReviewReady<NativeHostContext, AcceptedStockCommand<D::Prepared>>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync
        + 'static,
{
    /// Retain the supplied shared stock/review owners through the actual
    /// application router. The factory may compose reviewed operations only
    /// through their existing approval/outcome owner; it grants no approval.
    pub fn assemble<C: StartupCustody + 'static>(
        owners: StartupOwners,
        inputs: StartupInputs<R, O>,
        stock: impl FnOnce(&crate::http::Host, StartupAuthority) -> Result<StockCatalog<D>, AiError>,
        custody: Arc<C>,
    ) -> Result<Self, AiError> {
        custody.revalidate()?;
        let host = owners.host.clone();
        let startup =
            NativeStartup::assemble_with_custody(owners, inputs, stock, Arc::clone(&custody))?;
        let mounted = startup.mounted_router_with_custody(custody)?;
        let router = crate::http::router_with_ai(host, Some(mounted));
        Ok(Self { startup, router })
    }

    pub fn router(&self) -> &Router {
        &self.router
    }

    pub fn startup(&self) -> &NativeStartup<O, D, R> {
        &self.startup
    }
}
