//! Actual configurable native startup consumers. Construction performs no OAuth,
//! key lookup, first enrollment, provider request, listener or inference action.
pub mod authority;
pub mod callback;
pub mod configuration;
pub mod credentials;
pub mod environment;
pub mod peers;
pub mod provider;
pub mod security;
pub mod selection;
pub mod stock;

use crate::ai::{
    AiError, Cancellation, RunLimits,
    host::{
        HostAuthority,
        continuation::{ExactReviewReady, HostContinuations},
        credentials::NativeCredentialAuthority,
        enrollment::EnrollmentOwner,
        lifecycle::{ConnectionFacts, StoredSession},
        native::NativeHostContext,
        status::StatusJournal,
        transport::{HttpResponses, HttpTarget},
        trusted_startup::{AiReceiptIdentity, TrustedAiStartup},
    },
    oauth::LifecycleReceipt,
    runtime::HumanReviewPort,
    stock::{AcceptedStockCommand, SharedStockPort, StockCatalog},
    transport::{ResponsesAdapter, TransportLimits},
};
use authority::StartupAuthority;
use callback::{LocalCredentialHost, NativeBrowser};
use configuration::StartupConfiguration;
use credentials::StartupCredentials;
use environment::{AccountFacts, NativeEnvironment};
use peers::{NativeActions, NativeHostPeers, NativeLifecycle, OriginalReview};
use selection::{ModelSelection, NativeModels};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

pub struct StartupOwners {
    pub host: crate::http::Host,
    pub configuration: Arc<StartupConfiguration>,
    pub enrollment: Arc<EnrollmentOwner>,
    pub journal: StatusJournal,
}
/// Original review and observation owners are mandatory typed inputs. They must
/// be the application's existing trusted owners; startup invents no approvals.
/// HeldConnectionFacts is available for an explicitly held source installation.
pub struct StartupInputs<R, O> {
    pub original_review: Arc<R>,
    pub original_observation: Arc<O>,
    pub browser: NativeBrowser,
    pub run_limits: RunLimits,
    pub transport_limits: TransportLimits,
    pub continuation_lifetime: Duration,
}
pub struct NativeStartup<O, D, R>
where
    O: ConnectionFacts<NativeHostContext>,
    D: SharedStockPort<NativeHostContext> + Send + Sync,
    D::Prepared: Send + Sync,
    R: ExactReviewReady<NativeHostContext, AcceptedStockCommand<D::Prepared>>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync,
{
    mounted: TrustedAiStartup<NativeHostPeers<O, D, R>>,
    authority: StartupAuthority,
    credential_authority: Arc<NativeCredentialAuthority<NativeHostContext>>,
    credentials: StartupCredentials,
    selection: ModelSelection,
    callbacks: Arc<LocalCredentialHost>,
    lifecycle: Arc<NativeLifecycle<O>>,
}
impl<O, R> NativeStartup<O, stock::NativeReadDomain, R>
where
    O: ConnectionFacts<NativeHostContext> + 'static,
    R: ExactReviewReady<NativeHostContext, stock::NativeReadPrepared>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync
        + 'static,
{
    /// Concrete shared native Atlas read consumer. The original review owner is
    /// still required for the accepted runtime's exact continuation semantics.
    pub fn assemble_native_reads(
        owners: StartupOwners,
        inputs: StartupInputs<R, O>,
    ) -> Result<Self, AiError> {
        Self::assemble(owners, inputs, stock::native_read_catalog)
    }
}
impl<O, D, R> NativeStartup<O, D, R>
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
    /// `stock` must construct the existing shared native domain owner, using the
    /// supplied original authority. native_read_catalog is the concrete stock
    /// read consumer; reviewed writes require the existing reviewed stock owner.
    pub fn assemble(
        owners: StartupOwners,
        inputs: StartupInputs<R, O>,
        stock: impl FnOnce(&crate::http::Host, StartupAuthority) -> Result<StockCatalog<D>, AiError>,
    ) -> Result<Self, AiError> {
        let StartupOwners {
            host,
            configuration,
            enrollment,
            journal,
        } = owners;
        if host.origin != configuration.application_origin() {
            return Err(AiError::ConnectionUnavailable);
        }
        let access = Arc::clone(
            &host
                .core
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .access,
        );
        if !enrollment.owns(&access, &journal) {
            return Err(AiError::ConnectionUnavailable);
        }
        let authority = StartupAuthority {
            access,
            enrollment: Arc::clone(&enrollment),
            configuration: Arc::clone(&configuration),
        };
        let credential_authority = Arc::new(NativeCredentialAuthority::new(
            Arc::clone(&enrollment),
            |context| context,
        ));
        let credentials =
            StartupCredentials(Arc::new(credentials::NativeCredentialStore::new_existing(
                configuration.credential_directory(),
                configuration.stable_host_id(),
                Arc::clone(&credential_authority),
            )?));
        let selection = ModelSelection::default();
        let facts = AccountFacts {
            original: inputs.original_observation,
            selection: selection.clone(),
            authority: authority.clone(),
        };
        let callbacks = Arc::new(LocalCredentialHost::new(
            authority.clone(),
            journal.clone(),
            inputs.browser,
        ));
        let lifecycle = Arc::new(crate::ai::host::lifecycle::LifecycleHost {
            security: security::NativeSecurity::new()?,
            provider: provider::NativeOAuthProvider::new()?,
            credentials: credentials.clone(),
            environment: NativeEnvironment {
                authority: authority.clone(),
                credentials: credentials.clone(),
                facts: facts.clone(),
                callbacks: Arc::clone(&callbacks),
                display: Mutex::default(),
            },
            journal: journal.clone(),
        });
        let human = OriginalReview(inputs.original_review);
        let catalog = stock(&host, authority.clone())?;
        let peers = NativeHostPeers {
            connection: StoredSession {
                credentials: credentials.clone(),
                observation: facts.clone(),
                authority: authority.clone(),
            },
            inference: ResponsesAdapter::new(
                HttpResponses::new(
                    StoredSession {
                        credentials: credentials.clone(),
                        observation: facts,
                        authority: authority.clone(),
                    },
                    HttpTarget::OpenAi,
                )?,
                inputs.transport_limits,
            )?,
            continuations: HostContinuations::new(
                authority.clone(),
                human.clone(),
                journal.clone(),
                inputs.continuation_lifetime,
            )?,
            catalog,
            human,
            actions: NativeActions(Arc::clone(&lifecycle)),
            models: NativeModels {
                credentials: credentials.clone(),
                authority: authority.clone(),
                selection: selection.clone(),
            },
            selection: selection.clone(),
            authority: authority.clone(),
        };
        let mounted =
            TrustedAiStartup::assemble(host, peers, enrollment, journal, inputs.run_limits)?;
        Ok(Self {
            mounted,
            authority,
            credential_authority,
            credentials,
            selection,
            callbacks,
            lifecycle,
        })
    }
    pub fn mounted_router(&self) -> axum::Router {
        self.mounted.mounted_router()
    }
    pub fn receipt_identity(
        &self,
        context: &NativeHostContext,
    ) -> Result<AiReceiptIdentity, AiError> {
        self.authority
            .revalidate_action_receipt(context, context.registration())?;
        self.mounted.receipt_identity(context)
    }
    pub fn choose_model(&self, context: &NativeHostContext, model: &str) -> Result<(), AiError> {
        self.selection.choose(&self.authority, context, model)
    }

    /// Explicit trusted administrative operation only, absent from mounted HTTP
    /// Connect and all browser/model inputs. The caller must separately possess
    /// existing external approval for this pinned private configuration. This
    /// reuses genuine AT11 mutation authority and the actual original file seal;
    /// it neither creates a key nor makes sign-in, eligibility or paid-use claims.
    pub async fn enroll_existing_approval(
        &self,
        original: &crate::access::Principal,
    ) -> Result<(), AiError> {
        let binding = self
            .authority
            .configuration
            .original_registration(original)?;
        let registration = self
            .authority
            .configuration
            .trusted_registration(&binding)?;
        self.authority
            .enrollment
            .install_existing_approval(original, &registration)?;
        let captured = self.authority.enrollment.capture(original)?;
        if captured != binding {
            return Err(AiError::ConnectionUnavailable);
        }
        let context = NativeHostContext::capture(
            original.clone(),
            captured,
            &crate::transports::mcp::NativePrincipalPort::new(Arc::clone(&self.authority.access)),
        )
        .await?;
        self.credential_authority
            .enroll_initial_record(&self.credentials.0, &context, &registration)
            .await
    }
    /// Explicit native callback consumer. The root may drive this worker while
    /// the app is running; construction starts neither a worker nor a listener.
    /// Only the original local callback capability reaches OAuthLifecycle; no
    /// HTTP DTO can submit a code or replace its action/binding/principal.
    pub async fn process_next_callback(
        &self,
        cancel: &Cancellation,
    ) -> Result<LifecycleReceipt, AiError> {
        let deadline = std::time::Instant::now() + Duration::from_secs(600);
        let captured = crate::ai::host::transport::bounded(cancel, deadline, self.callbacks.next())
            .await
            .map_err(|_| AiError::ConnectionUnavailable)??;
        cancel.checkpoint()?;
        let context = NativeHostContext::capture(
            captured.original,
            captured.binding.clone(),
            &crate::transports::mcp::NativePrincipalPort::new(Arc::clone(&self.authority.access)),
        )
        .await?;
        self.authority.revalidate(&context, &captured.binding)?;
        self.lifecycle
            .complete(
                &context,
                &captured.binding,
                &captured.action_id,
                captured.request?,
            )
            .await
    }
    /// Trusted explicit refresh consumer, retaining the accepted durable
    /// exchange/rotation checkpoints. No timer, replay or refresh starts here.
    pub async fn refresh(&self, context: &NativeHostContext) -> Result<LifecycleReceipt, AiError> {
        self.lifecycle.refresh(context).await
    }
}
