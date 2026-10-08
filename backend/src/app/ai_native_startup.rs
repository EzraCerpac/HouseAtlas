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
            stock::{NativeReadDomain, NativeReadPrepared},
        },
    },
    runtime::HumanReviewPort,
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
        let host = owners.host.clone();
        let enrollment = Arc::clone(&owners.enrollment);
        let startup = Arc::new(NativeAccountStartup::assemble(owners)?);
        let account =
            crate::http::ai_account::mounted_router(host.clone(), Arc::clone(&startup), enrollment);
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
pub struct NativeAiApplication<O, R>
where
    O: ConnectionFacts<NativeHostContext>,
    R: ExactReviewReady<NativeHostContext, NativeReadPrepared>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync,
{
    startup: NativeStartup<O, NativeReadDomain, R>,
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

    pub fn router(&self) -> &Router {
        &self.router
    }

    pub fn startup(&self) -> &NativeStartup<O, NativeReadDomain, R> {
        &self.startup
    }
}
