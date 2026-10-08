//! Concrete lifecycle environment, retaining separate runtime/paid-use owners.
use super::{
    authority::StartupAuthority, callback::LocalCredentialHost, credentials::StartupCredentials,
    selection::ModelSelection,
};
use crate::ai::{
    AiError, AuthorizationState, Cancellation, ConnectionMethod, ConnectionSnapshot, Eligibility,
    InferencePermission, PaidUseAdmission, PortFuture, RuntimeAvailability, RuntimeKind,
    RuntimeQualification, RuntimeRoute, RuntimeSnapshot,
    host::{
        HostAuthority,
        lifecycle::{ConnectionFacts, LifecycleEnvironment, StoredSession},
        native::NativeHostContext,
    },
    oauth::{
        AuthorizationLaunch, CallbackSelection, CredentialBoundary, LifecycleState,
        RegistrationBinding, RegistrationRecord,
    },
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

/// Explicit held observation source for a source-only installation. This is
/// never upgraded by sign-in, discovery, a callback, or an HTTP success.
pub struct HeldConnectionFacts;
impl ConnectionFacts<NativeHostContext> for HeldConnectionFacts {
    fn observe<'a>(
        &'a self,
        _: &'a NativeHostContext,
        record: &'a RegistrationRecord,
        _: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            cancel.checkpoint()?;
            Ok(held_snapshot(Some(record)))
        })
    }
}
pub(super) fn held_snapshot(record: Option<&RegistrationRecord>) -> ConnectionSnapshot {
    ConnectionSnapshot {
        method: ConnectionMethod::SignInWithChatgpt,
        permission: if record
            .and_then(|r| r.credentials.as_ref())
            .is_some_and(|c| {
                c.granted_scopes
                    .iter()
                    .any(|scope| scope == crate::ai::DIRECT_USAGE_SCOPE)
            }) {
            InferencePermission::Granted
        } else {
            InferencePermission::Unknown
        },
        eligibility: Eligibility::Unknown,
        authorization: if record.is_some_and(|r| {
            matches!(
                r.state,
                LifecycleState::Connected | LifecycleState::PlanUseDisabled
            ) && r.identity.is_some()
        }) {
            AuthorizationState::Connected
        } else {
            AuthorizationState::SignInRequired
        },
        // sub/email are not ChatGPT workspace IDs. Only an independently
        // qualified observation owner may supply an actual account display.
        account: None,
        paid_use_admission: PaidUseAdmission::Held,
        runtime: RuntimeSnapshot {
            kind: RuntimeKind::Local,
            route: RuntimeRoute::LocalSignInHelper,
            qualification: RuntimeQualification::Held,
            availability: RuntimeAvailability::Unknown,
            checked_at: None,
        },
        usage_supported: true,
    }
}

pub struct AccountFacts<O> {
    pub(super) original: Arc<O>,
    pub(super) selection: ModelSelection,
    pub(super) authority: StartupAuthority,
}
impl<O> Clone for AccountFacts<O> {
    fn clone(&self) -> Self {
        Self {
            original: Arc::clone(&self.original),
            selection: self.selection.clone(),
            authority: self.authority.clone(),
        }
    }
}
impl<O: ConnectionFacts<NativeHostContext>> ConnectionFacts<NativeHostContext> for AccountFacts<O> {
    fn observe<'a>(
        &'a self,
        context: &'a NativeHostContext,
        record: &'a RegistrationRecord,
        model: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            self.authority.revalidate(context, &record.binding)?;
            self.selection.check_record(record, model)?;
            let observed = self
                .original
                .observe(context, record, model, cancel)
                .await?;
            if observed.method != ConnectionMethod::SignInWithChatgpt {
                return Err(AiError::ConnectionUnavailable);
            }
            self.authority.revalidate(context, &record.binding)?;
            self.selection.check_record(record, model)?;
            // Preserve the original owner's facts; this adapter supplies no
            // eligibility, paid-use approval or runtime qualification engine.
            Ok(observed)
        })
    }
}

pub struct NativeEnvironment<O> {
    pub(super) authority: StartupAuthority,
    pub(super) credentials: StartupCredentials,
    pub(super) facts: AccountFacts<O>,
    pub(super) callbacks: Arc<LocalCredentialHost>,
    pub(super) display: Mutex<BTreeMap<String, ConnectionSnapshot>>,
}
fn key(b: &RegistrationBinding) -> String {
    serde_json::json!([
        b.actor_id,
        b.workspace_id,
        b.home_id,
        b.registration_id,
        b.authority_epoch
    ])
    .to_string()
}
impl<O: Send + Sync> HostAuthority<NativeHostContext> for NativeEnvironment<O> {
    fn binding(&self, c: &NativeHostContext) -> Result<RegistrationBinding, AiError> {
        self.authority.binding(c)
    }
    fn revalidate(&self, c: &NativeHostContext, b: &RegistrationBinding) -> Result<(), AiError> {
        self.authority.revalidate(c, b)
    }
    fn revalidate_action_receipt(
        &self,
        c: &NativeHostContext,
        b: &RegistrationBinding,
    ) -> Result<(), AiError> {
        self.authority.revalidate_action_receipt(c, b)
    }
}
impl<O: ConnectionFacts<NativeHostContext>> LifecycleEnvironment<NativeHostContext>
    for NativeEnvironment<O>
{
    fn select_candidate(
        &self,
        context: &NativeHostContext,
        route: RuntimeRoute,
    ) -> Result<(), AiError> {
        if route != RuntimeRoute::LocalSignInHelper {
            return Err(AiError::ConnectionUnavailable);
        }
        self.callbacks.reserve(context)?;
        Ok(())
    }
    fn callback_selection(
        &self,
        context: &NativeHostContext,
    ) -> Result<CallbackSelection, AiError> {
        self.callbacks.reserve(context)
    }
    fn launch<'a>(
        &'a self,
        context: &'a NativeHostContext,
        launch: AuthorizationLaunch,
    ) -> PortFuture<'a, ()> {
        self.callbacks.launch(context, launch)
    }
    fn manage_usage<'a>(&'a self, context: &'a NativeHostContext) -> PortFuture<'a, ()> {
        self.callbacks.manage_usage(context)
    }
    fn cached_display(&self, context: &NativeHostContext) -> ConnectionSnapshot {
        self.display
            .lock()
            .ok()
            .and_then(|d| d.get(&key(context.registration())).cloned())
            .unwrap_or_else(|| held_snapshot(None))
    }
    fn snapshot<'a>(
        &'a self,
        context: &'a NativeHostContext,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            let lease = self.credentials.acquire(context, &binding).await?;
            let record = self.credentials.load(&lease).await?;
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            if record.binding != binding {
                return Err(AiError::ConnectionUnavailable);
            }
            let snapshot = match self.facts.selection.selected(&self.authority, context) {
                Ok(model) => self.facts.observe(context, &record, &model, cancel).await?,
                Err(AiError::ConnectionUnavailable) => held_snapshot(Some(&record)),
                Err(error) => return Err(error),
            };
            self.credentials
                .revalidate(context, &lease, &binding)
                .await?;
            self.authority.revalidate(context, &binding)?;
            self.display
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .insert(key(&binding), snapshot.clone());
            Ok(snapshot)
        })
    }
}
pub type NativeConnection<O> = StoredSession<StartupCredentials, AccountFacts<O>, StartupAuthority>;
