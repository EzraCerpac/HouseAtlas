//! Concrete host composition of published AT07 activity and stock HTTP peers.
//! No new activity store, authority policy, queue engine or epoch translation.
use super::TrustedDispatcherConfig;
use super::{
    archive::PrivateStockArchive,
    capture::NativeArchiveAuthorization,
    retention::{RetainingActivity, Retention},
};
use crate::{
    access,
    config::provider_dispatch::stock_http::TrustedStockHttpConfig,
    providers::homebox::{recovery as codec, write::stock as native, write_transport as transport},
    storage,
};
use serde_json::Value;
use std::{
    marker::PhantomData,
    sync::{Arc, Mutex},
};
use uuid::Uuid;
#[cfg(test)]
#[path = "healthy_activity.rs"]
mod healthy_activity;

/// Original opaque AT11 handles and the mandatory owner evidence policy.
/// Public command/authority DTOs supply no grant or evidence by themselves.
pub struct OriginalStockBinding<P, G, S> {
    pub original: Arc<P>,
    pub authorization: Arc<G>,
    pub contracts: Arc<S>,
    pub command: native::StockCommand,
    pub captured_authority: native::StockAuthority,
}

/// Actual owner ports retaining that original binding. The caller must supply
/// genuine route/graph/preflight/readback/credential/staging peers; no defaults.
pub struct OriginalStockIo<X, F, H, B> {
    pub access: X,
    pub preparation: F,
    pub resources: H,
    pub readback: B,
}

#[derive(Debug)]
pub enum HostError {
    Profile6Required,
    Transport(transport::TransportFault),
    Activity(native::StockPortFault),
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Profile6Required => {
                f.write_str("Fresh stock activity database profile 6 required")
            }
            Self::Transport(error) => write!(f, "Stock transport configuration: {error:?}"),
            Self::Activity(error) => write!(f, "Original stock activity binding: {error:?}"),
        }
    }
}
impl std::error::Error for HostError {}

/// Own once per deployment and route all configured provider mutations here.
/// Root supplies the existing canonical store/access connections. The concrete
/// activity leaf guards the physical database across jobs and stock aliases.
pub struct DurableStockHost<C, A, R> {
    store: Arc<Mutex<storage::AtlasStore<C, A, R>>>,
    access: Arc<Mutex<access::AccessBoundary>>,
    queue: TrustedDispatcherConfig,
    archive: Arc<PrivateStockArchive>,
    native_contracts: Arc<codec::NativeWriterContracts>,
}

impl<C: storage::Contract + Send, A: storage::Authorization + Send, R: storage::Runtime + Send>
    DurableStockHost<C, A, R>
{
    /// Requires an already-open fresh opt-in profile-6 store. This never opens,
    /// upgrades, replaces or migrates a database and starts no dispatcher task.
    pub fn new(
        store: Arc<Mutex<storage::AtlasStore<C, A, R>>>,
        access: Arc<Mutex<access::AccessBoundary>>,
        queue: TrustedDispatcherConfig,
        archive: Arc<PrivateStockArchive>,
    ) -> Result<Self, HostError> {
        let version = store
            .try_lock()
            .map_err(|_| HostError::Activity(native::StockPortFault::Unavailable))?
            .database_version();
        if version != storage::STOCK_ACTIVITY_DATABASE_VERSION {
            return Err(HostError::Profile6Required);
        }
        let native_contracts = Arc::new(
            codec::NativeWriterContracts::new()
                .map_err(|_| HostError::Activity(native::StockPortFault::ContentConflict))?,
        );
        Ok(Self {
            store,
            access,
            queue,
            archive,
            native_contracts,
        })
    }

    /// Create the actual original-authority SQL session and HTTP driver. The
    /// exclusive host borrow lasts through the bound workflow, while SQL/access
    /// mutex guards end inside the accepted synchronous session operations.
    // Preserve each accepted peer's concrete type instead of hiding ownership
    // and Send/Sync requirements behind an alternative erased port bundle.
    #[allow(clippy::type_complexity)]
    pub fn bind<'h, P, G, S, X, F, H, B>(
        &'h mut self,
        binding: OriginalStockBinding<P, G, S>,
        io: OriginalStockIo<X, F, H, B>,
        config: TrustedStockHttpConfig,
    ) -> Result<BoundStockHttp<'h, C, A, R, P, G, S, X, F, H, B>, HostError>
    where
        P: storage::StockActivityPrincipal,
        G: NativeArchiveAuthorization<P>,
        S: native::StockContractPort + Send + Sync,
        X: native::StockAccessPort,
        F: native::StockPreparationPort,
        H: transport::DispatchResources,
        B: native::StockReadbackPort + Sync,
    {
        config
            .check_queue(&self.queue)
            .map_err(HostError::Transport)?;
        let transport_binding = config.binding();
        if transport_binding.context != binding.command.context
            || transport_binding.source_instance_id != binding.command.target.source_instance_id
            || transport_binding.collection_id != binding.command.target.collection_id
        {
            return Err(HostError::Transport(transport::TransportFault::Binding));
        }
        let registration = config.activity_registration();
        let command = binding.command.clone();
        let actor_id = binding.captured_authority.actor_id;
        let physical_binding = binding.captured_authority.physical_binding.clone();
        let contracts = SharedContracts(Arc::clone(&binding.contracts));
        let retention = Retention::new(
            Arc::clone(&self.archive),
            Arc::clone(&binding.authorization),
            Arc::clone(&self.native_contracts),
        );
        // HttpDispatcher construction performs no request or credential lookup.
        let dispatch = config
            .into_http(io.resources)
            .map_err(HostError::Transport)?;
        let activity = RetainingActivity {
            session: self.activity(binding, registration)?,
            retention: retention.clone(),
        };
        Ok(BoundStockHttp {
            writer: native::StockWriter {
                contracts,
                access: io.access,
                preparation: io.preparation,
                activity,
                dispatch: retention.capture.dispatch_port(dispatch),
                readback: retention.capture.readback_port(io.readback),
            },
            command,
            actor_id,
            physical_binding,
            deployment: PhantomData,
            retention,
        })
    }

    fn activity<P, G, S>(
        &mut self,
        binding: OriginalStockBinding<P, G, S>,
        registration: storage::StockActivityRegistration,
    ) -> Result<storage::StockActivitySession<C, A, R, P, G, S>, HostError>
    where
        P: storage::StockActivityPrincipal,
        G: NativeArchiveAuthorization<P>,
        S: native::StockContractPort + Send + Sync,
    {
        let queue = &self.queue.queue().registration;
        if registration.physical_binding.deployment_id.to_string() != queue.identity.deployment_id
            || registration
                .physical_binding
                .physical_database_id
                .to_string()
                != queue.identity.physical_database_id
            || registration.physical_binding.configuration_digest.as_str()
                != queue.identity.configuration_digest.as_hex()
            || registration.owner_id.to_string() != queue.dispatcher_owner_id
            || !queue.aliases.iter().any(|alias| {
                alias.partition.workspace_id == binding.command.context.workspace_id.to_string()
                    && alias.partition.home_id == binding.command.context.home_id.to_string()
                    && alias.partition.source_instance_id
                        == binding.command.target.source_instance_id.to_string()
                    && alias.partition.collection_id
                        == binding.command.target.collection_id.to_string()
            })
        {
            return Err(HostError::Activity(
                native::StockPortFault::EvidenceConflict,
            ));
        }
        storage::StockActivitySession::new(
            Arc::clone(&self.store),
            Arc::clone(&self.access),
            binding.original,
            binding.authorization,
            binding.contracts,
            registration,
            binding.command,
            binding.captured_authority,
        )
        .map_err(HostError::Activity)
    }
}

struct SharedContracts<S>(Arc<S>);
impl<S: native::StockContractPort> native::StockContractPort for SharedContracts<S> {
    fn validate_request(&self, wire: &Value) -> Result<native::StockCommand, native::StockError> {
        self.0.validate_request(wire)
    }
    fn digest_native(&self, value: &Value) -> Result<native::Digest, native::StockPortFault> {
        self.0.digest_native(value)
    }
    fn validate_outcome(
        &self,
        outcome: &native::StockOutcome,
    ) -> Result<(), native::StockPortFault> {
        self.0.validate_outcome(outcome)
    }
    fn validate_observed_at(&self, value: &str) -> Result<(), native::StockPortFault> {
        self.0.validate_observed_at(value)
    }
}

pub type BoundStockHttp<'h, C, A, R, P, G, S, X, F, H, B> =
    BoundStock<'h, C, A, R, P, G, S, X, F, transport::HttpDispatcher<H>, B>;

type DurableWriter<C, A, R, P, G, S, X, F, D, B> = native::StockWriter<
    SharedContracts<S>,
    X,
    F,
    RetainingActivity<C, A, R, P, G, S>,
    codec::CapturingStockDispatch<D>,
    codec::CapturingStockReadback<B>,
>;

/// Private fields prevent construction without the original-host binding.
/// Production bind returns the concrete HTTP specialization above.
pub struct BoundStock<'h, C, A, R, P: storage::StockActivityPrincipal, G, S, X, F, D, B> {
    writer: DurableWriter<C, A, R, P, G, S, X, F, D, B>,
    command: native::StockCommand,
    actor_id: Uuid,
    physical_binding: native::PhysicalBinding,
    deployment: PhantomData<&'h mut DurableStockHost<C, A, R>>,
    retention: Arc<Retention<P, G>>,
}

impl<C, A, R, P, G, S, X, F, D, B> BoundStock<'_, C, A, R, P, G, S, X, F, D, B>
where
    C: storage::Contract + Send,
    A: storage::Authorization + Send,
    R: storage::Runtime + Send,
    P: storage::StockActivityPrincipal,
    G: NativeArchiveAuthorization<P>,
    S: native::StockContractPort + Send + Sync,
    X: native::StockAccessPort,
    F: native::StockPreparationPort,
    D: native::StockDispatchPort + Sync,
    B: native::StockReadbackPort + Sync,
{
    /// Execute only the original command validated when this session was bound.
    pub async fn execute(&mut self) -> native::StockResult {
        if self.retention.ready().is_err() {
            return self.sticky_retention_error().await;
        }
        let result = self.writer.execute(&self.command.original_wire).await;
        self.finish(result)
    }

    /// Get a sealed current original-owner carrier for never-invoked metadata.
    /// This performs no discovery scan, principal reconstruction or dispatch.
    pub fn queued_handoff(
        &self,
        operation_id: Uuid,
    ) -> Result<storage::QueuedStockActivity, native::StockPortFault> {
        self.writer.activity.session.queued_handoff(operation_id)
    }

    /// Revalidate the same session's sealed carrier immediately before using
    /// StockWriter's explicit queued handoff. No raw StoredOperation is accepted.
    pub async fn run_queued(
        &mut self,
        handoff: &storage::QueuedStockActivity,
    ) -> Result<native::StockResult, native::StockPortFault> {
        if self.retention.ready().is_err() {
            return Ok(self.sticky_retention_error().await);
        }
        let operation = self.writer.activity.session.retain_handoff(handoff)?;
        let result = self.writer.run_reserved(operation).await;
        Ok(self.finish(result))
    }

    /// Original-authority journal lookup; this cannot reconcile or release holds.
    pub async fn snapshot(
        &self,
        operation_id: Uuid,
    ) -> Result<native::StoredOperation, native::StockPortFault> {
        use native::StockActivityPort;
        self.writer
            .activity
            .load(&self.command, self.actor_id, operation_id)
            .await
    }

    /// Genuine original-owner objects for the native codec owner. These APIs
    /// issue no invocation, recovery, principal or disclosure authority.
    pub fn retained_record(
        &self,
    ) -> Result<storage::RetainedStockActivity, native::StockPortFault> {
        self.retention.record()
    }
    /// Consume only live retained data; closes codec capture without releasing
    /// physical activity. No SQL store enters the original codec archive.
    pub fn into_retained_native(
        self,
    ) -> Result<codec::ArchivedNativeStockActivity<P>, native::StockPortFault> {
        self.retention.seal()
    }
    pub fn archive_receipts(
        &self,
    ) -> Result<Vec<super::archive::ArchiveReceipt>, native::StockPortFault> {
        self.retention.receipts()
    }
    fn finish(&self, result: native::StockResult) -> native::StockResult {
        if self.retention.ready().is_ok() {
            return result;
        }
        // Preserve the accepted writer's access-denial sanitization even when
        // its preceding fact commit could not be independently retained.
        if let native::StockResult::Error(error) = &result
            && matches!(
                error.code,
                native::StockErrorCode::CapabilityDenied | native::StockErrorCode::Unauthenticated
            )
        {
            return result;
        }
        self.retention_error()
    }
    async fn sticky_retention_error(&self) -> native::StockResult {
        // Run the actual current access peer even though this binding's
        // retention latch prevents every subsequent native invocation.
        let code = match self
            .writer
            .access
            .authorize(&self.command, native::AuthorityPhase::Execute)
            .await
        {
            Ok(current)
                if current.actor_id == self.actor_id
                    && current.physical_binding == self.physical_binding =>
            {
                return self.retention_error();
            }
            Ok(_) => native::StockErrorCode::CapabilityDenied,
            Err(code) => code,
        };
        native::StockResult::Error(native::StockError {
            schema_version: 3,
            request_id: self.command.request_id,
            code,
            message: "Current authority does not permit this operation or disclosure.".into(),
            retry: native::RetryAdvice::None,
            operation_id: None,
        })
    }
    fn retention_error(&self) -> native::StockResult {
        native::StockResult::Error(native::StockError {
            schema_version: 3,
            request_id: self.command.request_id,
            code: native::StockErrorCode::UnknownHeld,
            message:
                "Independent producer retention is unavailable; inspect the retained operation."
                    .into(),
            retry: native::RetryAdvice::None,
            // The current disclosure fence can be the reason retention failed.
            // Do not reveal an earlier cut's ID without that authorization.
            operation_id: None,
        })
    }
}
