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
    /// Cached credential-free display/configuration only, after lifecycle work.
    /// Infallible and synchronous: no provider/runtime I/O, credential lease,
    /// new grant or fresh observation. The host clears admission/readiness.
    fn cached_display(&self, context: &C) -> ConnectionSnapshot;
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
    /// Only these synchronous prerequisites precede OAuth begin/credential or
    /// launch work. A known failure ends this local workflow, not authentication
    /// or provider processing; later ambiguous lifecycle failures stay held.
    fn prepare_launch<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        action_id: &str,
        route: Option<RuntimeRoute>,
    ) -> Result<CallbackSelection, AiError>
    where
        E: LifecycleEnvironment<C>,
    {
        let selection = (|| {
            if let Some(route) = route {
                self.environment.select_candidate(context, route)?;
            }
            self.environment.callback_selection(context)
        })();
        if let Err(reason) = selection {
            // Preserve cached identity/configuration only. Neither failure nor
            // the terminal workflow receipt supplies fresh inference authority.
            let mut snapshot = self.environment.cached_display(context);
            snapshot.permission = crate::ai::InferencePermission::Unknown;
            snapshot.eligibility = crate::ai::Eligibility::Unknown;
            snapshot.paid_use_admission = crate::ai::PaidUseAdmission::Held;
            snapshot.runtime.qualification = crate::ai::RuntimeQualification::Held;
            snapshot.runtime.availability = crate::ai::RuntimeAvailability::Unknown;
            snapshot.runtime.checked_at = None;
            let result = ConnectionActionResult {
                action_id: action_id.into(),
                status: ConnectionActionStatus::Completed,
                snapshot,
            };
            self.journal
                .action_prelaunch_failure(binding, action_id, json!(&result), reason)?;
        }
        // Preserve the original typed failure on the action call. An original-ID
        // status read can subsequently retire its known terminal workflow.
        selection
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
        // Backfill nonce correlation for a pending launch created by an older
        // host, before its callback can consume the code. Drop the original
        // lease before the shared lifecycle acquires its operation lease.
        {
            let lease = self.credentials.acquire(context, binding).await?;
            self.credentials
                .revalidate(context, &lease, binding)
                .await?;
            let record = self.credentials.load(&lease).await?;
            let attempt = record
                .pending_authorization
                .as_ref()
                .ok_or(AiError::InvalidInput)?;
            if &attempt.binding != binding {
                return Err(AiError::ConnectionUnavailable);
            }
            self.journal.correlate_nonce(
                binding,
                action_id,
                &state_digest(attempt.material.nonce.expose_in_trusted_boundary()),
            )?;
        }
        let receipt = self
            .lifecycle()
            .complete(context, binding, callback)
            .await?;
        self.finish_receipt(context, binding, action_id, &receipt)?;
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
        let verification = {
            let lease = self.credentials.acquire(context, &binding).await?;
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            let record = self.credentials.load(&lease).await?;
            matches!(
                &record.refresh_checkpoint,
                oauth::RefreshCheckpoint::ExchangeReceived { .. }
            )
        };
        if verification {
            self.verify_received_exchange(context).await
        } else {
            self.lifecycle().refresh(context, &binding).await
        }
    }
    /// Trusted credential-host continuation only. Uses the durable original
    /// launch nonce to recover its exact action ID, and verifies the retained
    /// exchange without sending another code or refresh grant. Not an HTTP DTO.
    pub async fn verify_received_exchange<C>(
        &self,
        context: &C,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
        E: LifecycleEnvironment<C>,
    {
        let binding = self.environment.binding(context)?;
        self.environment.revalidate(context, &binding)?;
        let digest = {
            let lease = self.credentials.acquire(context, &binding).await?;
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            let record = self.credentials.load(&lease).await?;
            match &record.refresh_checkpoint {
                oauth::RefreshCheckpoint::ExchangeReceived {
                    binding: captured,
                    nonce,
                    ..
                } if captured == &binding => state_digest(nonce.expose_in_trusted_boundary()),
                _ => return Err(AiError::ConnectionUnavailable),
            }
        };
        let id = self.journal.nonce_action(&binding, &digest)?;
        // Reacquisition is checked against that exact checkpoint under the
        // existing serialized credential lease; no nested lease or rebasing.
        let bound = super::verification::BoundExchange {
            inner: &self.credentials,
            binding: &binding,
            nonce_digest: &digest,
        };
        let receipt = OAuthLifecycle {
            security: &self.security,
            provider: &self.provider,
            credentials: &bound,
        }
        .verify_received_exchange(context, &binding)
        .await?;
        self.finish_receipt(context, &binding, &id, &receipt)?;
        Ok(receipt)
    }
    fn finish_receipt<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        id: &str,
        receipt: &LifecycleReceipt,
    ) -> Result<(), AiError>
    where
        E: LifecycleEnvironment<C>,
    {
        self.environment.revalidate(context, binding)?;
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
        let mut snapshot = self.environment.cached_display(context);
        snapshot.authorization = if matches!(
            receipt.state,
            oauth::LifecycleState::Connected | oauth::LifecycleState::PlanUseDisabled
        ) {
            crate::ai::AuthorizationState::Connected
        } else {
            crate::ai::AuthorizationState::SignInRequired
        };
        // A workflow receipt is not a fresh paid-use/runtime/model observation.
        snapshot.permission = crate::ai::InferencePermission::Unknown;
        snapshot.eligibility = crate::ai::Eligibility::Unknown;
        snapshot.paid_use_admission = crate::ai::PaidUseAdmission::Held;
        snapshot.runtime.availability = crate::ai::RuntimeAvailability::Unknown;
        snapshot.runtime.checked_at = None;
        let result = ConnectionActionResult {
            action_id: id.into(),
            status,
            snapshot,
        };
        self.journal.action_finish(binding, id, result)?;
        self.environment.revalidate(context, binding)
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
            let mut manage_usage_completed = false;
            let status = match request.command {
                ConnectionAction::Connect { route } => {
                    let selection =
                        self.prepare_launch(context, &binding, &request.action_id, Some(route))?;
                    let launch = self
                        .lifecycle()
                        .begin(context, &binding, selection, SignInPurpose::Identity)
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
                    let nonce = launch_url
                        .query_pairs()
                        .find(|(key, _)| key == "nonce")
                        .ok_or(AiError::InvalidInput)?
                        .1
                        .into_owned();
                    self.journal.correlate_nonce(
                        &binding,
                        &request.action_id,
                        &state_digest(&nonce),
                    )?;
                    self.environment.launch(context, launch).await?;
                    ConnectionActionStatus::Pending
                }
                ConnectionAction::Consent => {
                    let selection =
                        self.prepare_launch(context, &binding, &request.action_id, None)?;
                    let launch = self
                        .lifecycle()
                        .begin(context, &binding, selection, SignInPurpose::EnablePlanUse)
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
                    let nonce = launch_url
                        .query_pairs()
                        .find(|(key, _)| key == "nonce")
                        .ok_or(AiError::InvalidInput)?
                        .1
                        .into_owned();
                    self.journal.correlate_nonce(
                        &binding,
                        &request.action_id,
                        &state_digest(&nonce),
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
                    let mut snapshot = self.environment.cached_display(context);
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
                    // Opening the usage-management surface is the complete
                    // local action. A later live observation may fail, but it
                    // cannot make that already completed action disappear.
                    manage_usage_completed = true;
                    ConnectionActionStatus::Completed
                }
            };
            if manage_usage_completed {
                // Cache the known local completion before any fallible display
                // observation. The caller can still receive the typed error,
                // while the original action ID already has a terminal receipt.
                let mut snapshot = self.environment.cached_display(context);
                snapshot.permission = crate::ai::InferencePermission::Unknown;
                snapshot.eligibility = crate::ai::Eligibility::Unknown;
                snapshot.paid_use_admission = crate::ai::PaidUseAdmission::Held;
                snapshot.runtime.qualification = crate::ai::RuntimeQualification::Held;
                snapshot.runtime.availability = crate::ai::RuntimeAvailability::Unknown;
                snapshot.runtime.checked_at = None;
                let result = ConnectionActionResult {
                    action_id: request.action_id.clone(),
                    status,
                    snapshot,
                };
                self.journal
                    .action_finish(&binding, &request.action_id, result)?;
            }
            let snapshot = match disconnected_snapshot {
                Some(snapshot) => snapshot,
                None => self.environment.snapshot(context, cancel).await?,
            };
            let result = ConnectionActionResult {
                action_id: request.action_id.clone(),
                status,
                snapshot,
            };
            self.journal
                .action_finish(&binding, &request.action_id, result)
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
            // An observed action is a receipt. Its journal key deliberately
            // excludes cancellation epoch, so disclosure uses the dedicated
            // receipt proof across intentional disconnect rotation. A missing
            // receipt still needs full current authority before fresh display.
            self.environment
                .revalidate_action_receipt(context, &binding)?;
            match self.journal.action_read(&binding, id)? {
                Some(value) => {
                    self.environment
                        .revalidate_action_receipt(context, &binding)?;
                    serde_json::from_value(value).map_err(|_| AiError::DomainUnavailable)
                }
                None => {
                    self.environment.revalidate(context, &binding)?;
                    Ok(ConnectionActionResult {
                        action_id: id.into(),
                        status: ConnectionActionStatus::Unconfirmed,
                        snapshot: self.environment.snapshot(context, cancel).await?,
                    })
                }
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

pub(super) fn state_digest(state: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(state.as_bytes()))
}
