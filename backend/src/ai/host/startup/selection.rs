//! Selected models are original credential-session observations, never defaults.
use super::{authority::StartupAuthority, credentials::StartupCredentials};
use crate::ai::{
    AiError, Cancellation, PortFuture,
    host::{
        HostAuthority,
        models::{HttpAccountModels, ModelLease, ModelSession, StoredModelLease, StoredModels},
        native::NativeHostContext,
        transport::HttpTarget,
    },
    oauth::{RegistrationBinding, RegistrationRecord},
    runtime::{AccountModels, ModelsPort},
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Origin {
    binding: RegistrationBinding,
    token_digest: [u8; 32],
}
struct Observed {
    origin: Origin,
    checked: Instant,
    models: Vec<String>,
    selected: Option<String>,
}
#[derive(Clone, Default)]
pub struct ModelSelection {
    rows: Arc<Mutex<BTreeMap<String, Observed>>>,
}
fn key(binding: &RegistrationBinding) -> Result<String, AiError> {
    serde_json::to_string(&(
        &binding.actor_id,
        &binding.workspace_id,
        &binding.home_id,
        &binding.registration_id,
        &binding.authority_epoch,
    ))
    .map_err(|_| AiError::DomainUnavailable)
}
fn token_digest(token: &crate::ai::oauth::ProtectedValue) -> [u8; 32] {
    Sha256::digest(token.expose_in_trusted_boundary().as_bytes()).into()
}
impl ModelSelection {
    fn observe(
        &self,
        origin: Origin,
        models: &AccountModels,
        candidate: Option<&str>,
    ) -> Result<(), AiError> {
        if models.registration_id != origin.binding.registration_id {
            return Err(AiError::ConnectionUnavailable);
        }
        let mut rows = self.rows.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row_key = key(&origin.binding)?;
        // Retain an explicit user choice only within this exact original
        // credential session, and only if refreshed membership still lists it.
        let previous = rows
            .get(&row_key)
            .filter(|row| {
                row.origin.binding == origin.binding
                    && row.origin.token_digest == origin.token_digest
            })
            .and_then(|row| row.selected.as_deref());
        let selected = previous
            .or(candidate)
            .filter(|candidate| models.model_slugs.iter().any(|m| m == candidate))
            .map(str::to_owned);
        rows.insert(
            row_key,
            Observed {
                origin,
                checked: Instant::now(),
                models: models.model_slugs.clone(),
                selected,
            },
        );
        Ok(())
    }
    /// Consume an explicit trusted user selection after actual account discovery.
    /// The native original mutation proof remains required; browser IDs alone
    /// cannot set another registration's model or create membership.
    pub fn choose(
        &self,
        authority: &StartupAuthority,
        context: &NativeHostContext,
        model: &str,
    ) -> Result<(), AiError> {
        let binding = authority.binding(context)?;
        {
            let access = authority
                .access
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?;
            access
                .authorize_storage(
                    context.original(),
                    context.original().scope(),
                    crate::access::Capability::Mutate,
                )
                .map_err(|_| AiError::ConnectionUnavailable)?;
        }
        let mut rows = self.rows.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row = rows
            .get_mut(&key(&binding)?)
            .ok_or(AiError::ConnectionUnavailable)?;
        if row.origin.binding != binding
            || row.checked.elapsed() > Duration::from_secs(300)
            || !row.models.iter().any(|m| m == model)
        {
            return Err(AiError::ConnectionUnavailable);
        }
        authority.revalidate(context, &binding)?;
        row.selected = Some(model.to_owned());
        Ok(())
    }
    pub(super) fn selected(
        &self,
        authority: &StartupAuthority,
        context: &NativeHostContext,
    ) -> Result<String, AiError> {
        let binding = authority.binding(context)?;
        let rows = self.rows.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row = rows
            .get(&key(&binding)?)
            .ok_or(AiError::ConnectionUnavailable)?;
        if row.origin.binding != binding || row.checked.elapsed() > Duration::from_secs(300) {
            return Err(AiError::ConnectionUnavailable);
        }
        let model = row.selected.clone().ok_or(AiError::ConnectionUnavailable)?;
        authority.revalidate(context, &binding)?;
        Ok(model)
    }
    pub(super) fn check_record(
        &self,
        record: &RegistrationRecord,
        model: &str,
    ) -> Result<(), AiError> {
        let bearer = record
            .credentials
            .as_ref()
            .and_then(|c| c.access_token.as_ref())
            .ok_or(AiError::ConnectionUnavailable)?;
        let rows = self.rows.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row = rows
            .get(&key(&record.binding)?)
            .ok_or(AiError::ConnectionUnavailable)?;
        if row.origin.binding != record.binding
            || row.origin.token_digest != token_digest(bearer)
            || row.checked.elapsed() > Duration::from_secs(300)
            || !row.models.iter().any(|m| m == model)
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(())
    }
}

/// One observation collector per discovery call avoids cross-call token/catalog
/// pairing. Only the session's post-HTTP original lease revalidation records it.
struct OriginSession {
    inner: StoredModels<StartupCredentials, StartupAuthority>,
    original: Arc<Mutex<Option<Origin>>>,
}
impl ModelSession<NativeHostContext> for OriginSession {
    type Lease = StoredModelLease<super::credentials::NativeCredentialLease>;
    fn acquire_models<'a>(
        &'a self,
        context: &'a NativeHostContext,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Self::Lease> {
        self.inner.acquire_models(context, cancel)
    }
    fn revalidate_models<'a>(
        &'a self,
        context: &'a NativeHostContext,
        lease: &'a Self::Lease,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            self.inner.revalidate_models(context, lease, cancel).await?;
            *self
                .original
                .lock()
                .map_err(|_| AiError::DomainUnavailable)? = Some(Origin {
                binding: lease.binding().clone(),
                token_digest: token_digest(lease.bearer()),
            });
            Ok(())
        })
    }
}
pub struct NativeModels {
    pub(super) credentials: StartupCredentials,
    pub(super) authority: StartupAuthority,
    pub(super) selection: ModelSelection,
}
impl ModelsPort<NativeHostContext> for NativeModels {
    fn discover<'a>(
        &'a self,
        context: &'a NativeHostContext,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, AccountModels> {
        Box::pin(async move {
            let binding = self.authority.binding(context)?;
            let original = Arc::new(Mutex::new(None));
            let transport = HttpAccountModels::new(
                OriginSession {
                    inner: StoredModels {
                        credentials: self.credentials.clone(),
                        authority: self.authority.clone(),
                    },
                    original: Arc::clone(&original),
                },
                HttpTarget::OpenAi,
            )?;
            let models = transport.discover(context, cancel).await?;
            self.authority.revalidate(context, &binding)?;
            let origin = original
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .take()
                .ok_or(AiError::ConnectionUnavailable)?;
            if origin.binding != binding {
                return Err(AiError::ConnectionUnavailable);
            }
            let candidate = self.authority.configuration.registration(&binding)?.model();
            self.selection.observe(origin, &models, candidate)?;
            self.authority.revalidate(context, &binding)?;
            Ok(models)
        })
    }
}
