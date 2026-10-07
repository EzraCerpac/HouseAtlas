//! Concrete lifecycle bridge over the accepted OAuthLifecycle, never an approval issuer.
use super::{HostAuthority, status::StatusJournal};
use crate::ai::{
    AiError, Cancellation, ConnectionPort, ConnectionSnapshot, PortFuture, RuntimeRoute,
    oauth::{
        self, AuthorizationLaunch, CallbackRequest, CallbackSelection, CredentialBoundary,
        LifecycleReceipt, OAuthLifecycle, OAuthProviderPort, RegistrationBinding, SecurityPort,
        SignInPurpose,
    },
    runtime::{
        ConnectionAction, ConnectionActionPort, ConnectionActionRequest, ConnectionActionResult,
        ConnectionActionStatus,
    },
};
use serde_json::json;

/// Trusted runtime/OS actions. A local helper is not an inference companion;
/// selecting a candidate does not mark availability/qualification or paid use.
pub trait LifecycleEnvironment<C>: HostAuthority<C> {
    fn select_candidate(&self, context: &C, route: RuntimeRoute) -> Result<(), AiError>;
    fn callback_selection(&self, context: &C) -> Result<CallbackSelection, AiError>;
    /// Open this exact launch only in the selected local credential host. URLs,
    /// verifier/state/code/token material must never enter browser IPC or logs.
    fn launch<'a>(&'a self, context: &'a C, launch: AuthorizationLaunch) -> PortFuture<'a, ()>;
    fn manage_usage<'a>(&'a self, context: &'a C) -> PortFuture<'a, ()>;
    /// Cached credential-free display/configuration only, after local stop-use.
    /// Infallible and synchronous: no provider/runtime I/O, credential lease,
    /// new grant or fresh observation. The host clears admission/readiness.
    fn disconnect_display(&self, context: &C) -> ConnectionSnapshot;
    fn snapshot<'a>(
        &'a self,
        context: &'a C,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot>;
}

pub struct LifecycleHost<S, P, B, E> {
    pub security: S,
    pub provider: P,
    pub credentials: B,
    pub environment: E,
    pub journal: StatusJournal,
}
impl<S, P, B, E> LifecycleHost<S, P, B, E>
where
    S: SecurityPort,
    P: OAuthProviderPort,
{
    fn lifecycle(&self) -> OAuthLifecycle<'_, S, P, B> {
        OAuthLifecycle {
            security: &self.security,
            provider: &self.provider,
            credentials: &self.credentials,
        }
    }
    /// Called only by the trusted callback host retaining query duplicates and
    /// the exact actual callback URI. This is deliberately absent from HTTP IPC.
    pub async fn complete<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        action_id: &str,
        callback: CallbackRequest,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
        E: LifecycleEnvironment<C>,
    {
        self.environment.revalidate(context, binding)?;
        let mut states = callback.parameters.iter().filter(|(key, _)| key == "state");
        let state = &states.next().ok_or(AiError::InvalidInput)?.1;
        if states.next().is_some() {
            return Err(AiError::InvalidInput);
        }
        self.journal
            .check_launch(binding, action_id, &state_digest(state))?;
        let receipt = self
            .lifecycle()
            .complete(context, binding, callback)
            .await?;
        let status = if matches!(
            receipt.issue,
            Some(
                oauth::OAuthIssue::ExchangeUnconfirmed
                    | oauth::OAuthIssue::IdentityUnavailable
                    | oauth::OAuthIssue::StorageUnavailable
            )
        ) {
            ConnectionActionStatus::Unconfirmed
        } else if receipt.issue == Some(oauth::OAuthIssue::CallbackInvalid) {
            ConnectionActionStatus::Pending
        } else {
            ConnectionActionStatus::Completed
        };
        let result = ConnectionActionResult {
            action_id: action_id.into(),
            status,
            snapshot: self
                .environment
                .snapshot(context, &Cancellation::default())
                .await?,
        };
        self.journal
            .action_finish(binding, action_id, json!(&result))?;
        Ok(receipt)
    }
    /// Explicit host refresh; the accepted durable rotation checkpoints decide
    /// reuse/uncertainty. No inference, automatic replay or live refresh starts.
    pub async fn refresh<C>(&self, context: &C) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
        E: LifecycleEnvironment<C>,
    {
        let binding = self.environment.binding(context)?;
        self.environment.revalidate(context, &binding)?;
        self.lifecycle().refresh(context, &binding).await
    }
}
impl<
    C: Sync,
    S: SecurityPort,
    P: OAuthProviderPort,
    B: CredentialBoundary<C>,
    E: LifecycleEnvironment<C>,
> ConnectionActionPort<C> for LifecycleHost<S, P, B, E>
{
    fn act<'a>(
        &'a self,
        context: &'a C,
        request: &'a ConnectionActionRequest,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionActionResult> {
        Box::pin(async move {
            cancel.checkpoint()?;
            request.command.validate()?;
            let binding = self.environment.binding(context)?;
            self.environment.revalidate(context, &binding)?;
            self.journal
                .action_begin(&binding, &request.action_id, json!(&request.command))?;
            // The durable action ID is captured before any OS/provider action.
            let mut disconnected_snapshot = None;
            let status = match request.command {
                ConnectionAction::Connect { route } => {
                    self.environment.select_candidate(context, route)?;
                    let launch = self
                        .lifecycle()
                        .begin(
                            context,
                            &binding,
                            self.environment.callback_selection(context)?,
                            SignInPurpose::Identity,
                        )
                        .await?;
                    let launch_url = url::Url::parse(launch.trusted_authorization_url())
                        .map_err(|_| AiError::InvalidInput)?;
                    let state = launch_url
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .ok_or(AiError::InvalidInput)?
                        .1
                        .into_owned();
                    self.journal.correlate_launch(
                        &binding,
                        &request.action_id,
                        &state_digest(&state),
                    )?;
                    self.environment.launch(context, launch).await?;
                    ConnectionActionStatus::Pending
                }
                ConnectionAction::Consent => {
                    let launch = self
                        .lifecycle()
                        .begin(
                            context,
                            &binding,
                            self.environment.callback_selection(context)?,
                            SignInPurpose::EnablePlanUse,
                        )
                        .await?;
                    let launch_url = url::Url::parse(launch.trusted_authorization_url())
                        .map_err(|_| AiError::InvalidInput)?;
                    let state = launch_url
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .ok_or(AiError::InvalidInput)?
                        .1
                        .into_owned();
                    self.journal.correlate_launch(
                        &binding,
                        &request.action_id,
                        &state_digest(&state),
                    )?;
                    self.environment.launch(context, launch).await?;
                    ConnectionActionStatus::Pending
                }
                ConnectionAction::Disconnect => {
                    self.journal.stop_registration(&binding)?;
                    let receipt = self.lifecycle().disconnect(context, &binding).await?;
                    self.environment
                        .revalidate_action_receipt(context, &binding)?;
                    // Display collection cannot prevent or precede local stop.
                    let mut snapshot = self.environment.disconnect_display(context);
                    // Only local credential-use facts are cleared. Preserve the
                    // previously authorized display; infer no remote revocation.
                    snapshot.authorization = crate::ai::AuthorizationState::SignInRequired;
                    snapshot.permission = crate::ai::InferencePermission::Unknown;
                    snapshot.eligibility = crate::ai::Eligibility::Unknown;
                    snapshot.paid_use_admission = crate::ai::PaidUseAdmission::Held;
                    snapshot.runtime.availability = crate::ai::RuntimeAvailability::Unknown;
                    snapshot.runtime.checked_at = None;
                    disconnected_snapshot = Some(snapshot);
                    if receipt.revocation == oauth::RevocationState::Unconfirmed {
                        ConnectionActionStatus::Unconfirmed
                    } else {
                        ConnectionActionStatus::Completed
                    }
                }
                ConnectionAction::ManageUsage => {
                    self.environment.manage_usage(context).await?;
                    ConnectionActionStatus::Completed
                }
            };
            let result = ConnectionActionResult {
                action_id: request.action_id.clone(),
                status,
                snapshot: match disconnected_snapshot {
                    Some(snapshot) => snapshot,
                    None => self.environment.snapshot(context, cancel).await?,
                },
            };
            self.journal
                .action_finish(&binding, &request.action_id, json!(&result))?;
            Ok(result)
        })
    }
    fn status<'a>(
        &'a self,
        context: &'a C,
        id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionActionResult> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.environment.binding(context)?;
            self.environment.revalidate(context, &binding)?;
            match self.journal.action_read(&binding, id)? {
                Some(value) => {
                    serde_json::from_value(value).map_err(|_| AiError::DomainUnavailable)
                }
                None => Ok(ConnectionActionResult {
                    action_id: id.into(),
                    status: ConnectionActionStatus::Unconfirmed,
                    snapshot: self.environment.snapshot(context, cancel).await?,
                }),
            }
        })
    }
}

/// Trusted facts computed for this exact encrypted registration record. Model
/// membership, runtime observation, eligibility and paid-use admission retain
/// their existing independent owners; this interface issues none of them.
pub trait ConnectionFacts<C>: Send + Sync {
    fn observe<'a>(
        &'a self,
        context: &'a C,
        record: &'a oauth::RegistrationRecord,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot>;
}

/// Credential-backed current connection check. The same facts source is used by
/// StoredSession inside its retained lease immediately before actual HTTP I/O.
impl<C: Sync, B: CredentialBoundary<C> + Send, O: ConnectionFacts<C>, A: HostAuthority<C>>
    ConnectionPort<C> for StoredSession<B, O, A>
where
    B::Lease: Sync,
{
    fn check<'a>(
        &'a self,
        context: &'a C,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            let lease = self.credentials.acquire(context, &binding).await?;
            let record = self.credentials.load(&lease).await?;
            if record.binding != binding {
                return Err(AiError::ConnectionUnavailable);
            }
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            let snapshot = self
                .observation
                .observe(context, &record, model, cancel)
                .await?;
            self.authority.revalidate(context, &binding)?;
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            Ok(snapshot)
        })
    }
}

/// Lease-backed HTTP session using the actual accepted encrypted credential
/// boundary and a current trusted connection observation. No plaintext fallback.
pub struct StoredSession<B, O, A> {
    pub credentials: B,
    pub observation: O,
    pub authority: A,
}
pub struct StoredLease<L> {
    lease: L,
    record: oauth::RegistrationRecord,
    snapshot: ConnectionSnapshot,
    model: String,
}
impl<L: Send + Sync> super::transport::InferenceLease for StoredLease<L> {
    fn bearer(&self) -> &oauth::ProtectedValue {
        self.record
            .credentials
            .as_ref()
            .and_then(|c| c.access_token.as_ref())
            .expect("StoredSession validates access token before constructing lease")
    }
    fn binding(&self) -> &RegistrationBinding {
        &self.record.binding
    }
    fn snapshot(&self) -> &ConnectionSnapshot {
        &self.snapshot
    }
}
impl<C: Sync, B: CredentialBoundary<C> + Send, O: ConnectionFacts<C>, A: HostAuthority<C>>
    super::transport::InferenceSession<C> for StoredSession<B, O, A>
where
    B::Lease: Sync,
{
    type Lease = StoredLease<B::Lease>;
    fn acquire<'a>(
        &'a self,
        context: &'a C,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Self::Lease> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            let lease = self.credentials.acquire(context, &binding).await?;
            let record = self.credentials.load(&lease).await?;
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            let snapshot = self
                .observation
                .observe(context, &record, model, cancel)
                .await?;
            let credentials = record
                .credentials
                .as_ref()
                .ok_or(AiError::ConnectionUnavailable)?;
            let now = self.credentials.now_ms()?;
            if record.binding != binding
                || record.state != oauth::LifecycleState::Connected
                || record.kind != oauth::RegistrationKind::LocalPublicClient
                || record.identity.is_none()
                || credentials.access_token.is_none()
                || !credentials
                    .granted_scopes
                    .iter()
                    .any(|s| s == crate::ai::DIRECT_USAGE_SCOPE)
                || credentials.expires_at_ms.is_none_or(|expiry| now >= expiry)
                || !matches!(record.refresh_checkpoint, oauth::RefreshCheckpoint::None)
                || snapshot.method != crate::ai::ConnectionMethod::SignInWithChatgpt
                || !snapshot.can_infer()
            {
                return Err(AiError::ConnectionUnavailable);
            }
            self.authority.revalidate(context, &binding)?;
            Ok(StoredLease {
                lease,
                record,
                snapshot,
                model: model.to_owned(),
            })
        })
    }
    fn revalidate<'a>(
        &'a self,
        context: &'a C,
        lease: &'a Self::Lease,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            cancel.checkpoint()?;
            self.authority.revalidate(context, &lease.record.binding)?;
            self.credentials
                .revalidate(context, &lease.lease, &lease.record.binding)
                .await?;
            if lease
                .record
                .credentials
                .as_ref()
                .and_then(|c| c.expires_at_ms)
                .is_none_or(|expiry| self.credentials.now_ms().map_or(true, |now| now >= expiry))
            {
                return Err(AiError::ConnectionUnavailable);
            }
            let current = self
                .observation
                .observe(context, &lease.record, &lease.model, cancel)
                .await?;
            if !current.can_infer()
                || current.account != lease.snapshot.account
                || current.method != lease.snapshot.method
                || current.runtime.route != lease.snapshot.runtime.route
            {
                return Err(AiError::ConnectionUnavailable);
            }
            Ok(())
        })
    }
}

fn state_digest(state: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(state.as_bytes()))
}
