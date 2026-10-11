//! Actual account-specific model-list HTTP, without inference or billing changes.
use super::transport::{HttpTarget, SYNTHETIC_BEARER, bounded};
use crate::ai::{
    AiError, Cancellation, PortFuture,
    runtime::{AccountModels, ModelsPort},
};
use reqwest::{Client, header};
use std::time::{Duration, Instant};

/// Separate discovery admission. Model listing may be allowed while paid use is
/// held. The selected runtime still owns direct-use credentials and authority.
pub trait ModelLease: Send + Sync {
    fn bearer(&self) -> &crate::ai::oauth::ProtectedValue;
    fn binding(&self) -> &crate::ai::oauth::RegistrationBinding;
}
pub trait ModelSession<C>: Send + Sync {
    type Lease: ModelLease;
    fn acquire_models<'a>(
        &'a self,
        context: &'a C,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Self::Lease>;
    fn revalidate_models<'a>(
        &'a self,
        context: &'a C,
        lease: &'a Self::Lease,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, ()>;
}
pub struct HttpAccountModels<S> {
    sessions: S,
    client: Client,
    target: HttpTarget,
}
impl<S> HttpAccountModels<S> {
    pub fn new(sessions: S, target: HttpTarget) -> Result<Self, AiError> {
        target.models()?;
        Ok(Self {
            sessions,
            target,
            client: super::transport::client()?,
        })
    }
}
impl<C: Sync, S: ModelSession<C>> ModelsPort<C> for HttpAccountModels<S> {
    fn discover<'a>(
        &'a self,
        context: &'a C,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, AccountModels> {
        Box::pin(async move {
            let deadline = Instant::now() + Duration::from_secs(30);
            let lease = bounded(
                cancel,
                deadline,
                self.sessions.acquire_models(context, cancel),
            )
            .await
            .map_err(|_| AiError::ConnectionUnavailable)??;
            bounded(
                cancel,
                deadline,
                self.sessions.revalidate_models(context, &lease, cancel),
            )
            .await
            .map_err(|_| AiError::ConnectionUnavailable)??;
            let bearer = lease.bearer().expose_in_trusted_boundary();
            if matches!(self.target, HttpTarget::SyntheticLoopback(_)) && bearer != SYNTHETIC_BEARER
            {
                return Err(AiError::InvalidInput);
            }
            let mut auth = header::HeaderValue::from_str(&format!("Bearer {bearer}"))
                .map_err(|_| AiError::ConnectionUnavailable)?;
            auth.set_sensitive(true);
            let request = self
                .client
                .get(self.target.models()?)
                .header(header::AUTHORIZATION, auth)
                .header(header::ACCEPT, "application/json")
                .build()
                .map_err(|_| AiError::InvalidInput)?;
            let mut response = bounded(cancel, deadline, self.client.execute(request))
                .await
                .map_err(|_| AiError::ProviderUnavailable)?
                .map_err(|_| AiError::ProviderUnavailable)?;
            if !response.status().is_success() {
                return Err(AiError::ConnectionUnavailable);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = bounded(cancel, deadline, response.chunk())
                .await
                .map_err(|_| AiError::ProviderUnavailable)?
                .map_err(|_| AiError::ProviderUnavailable)?
            {
                if bytes.len().saturating_add(chunk.len()) > 1024 * 1024 {
                    return Err(AiError::LimitReached);
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| AiError::InvalidProviderOutput)?;
            let models = value
                .get("models")
                .and_then(serde_json::Value::as_array)
                .ok_or(AiError::InvalidProviderOutput)?;
            if models.len() > 1024 {
                return Err(AiError::LimitReached);
            }
            let mut slugs = Vec::new();
            for model in models
                .iter()
                .filter(|m| m.get("visibility").and_then(serde_json::Value::as_str) == Some("list"))
            {
                let slug = model
                    .get("slug")
                    .and_then(serde_json::Value::as_str)
                    .ok_or(AiError::InvalidProviderOutput)?;
                if slug.is_empty()
                    || slug.len() > 256
                    || slug.chars().any(char::is_control)
                    || slugs.iter().any(|s| s == slug)
                {
                    return Err(AiError::InvalidProviderOutput);
                }
                slugs.push(slug.to_owned());
            }
            bounded(
                cancel,
                deadline,
                self.sessions.revalidate_models(context, &lease, cancel),
            )
            .await
            .map_err(|_| AiError::ConnectionUnavailable)??;
            Ok(AccountModels {
                registration_id: lease.binding().registration_id.clone(),
                checked_at: time::OffsetDateTime::now_utc()
                    .format(&time::format_description::well_known::Rfc3339)
                    .map_err(|_| AiError::ProviderUnavailable)?,
                model_slugs: slugs,
            })
        })
    }
}

/// Actual encrypted account lease for model discovery; sign-in, model listing
/// and inference/paid-use admission remain separate operations.
pub struct StoredModels<B, A> {
    pub credentials: B,
    pub authority: A,
}
pub struct StoredModelLease<L> {
    lease: L,
    record: crate::ai::oauth::RegistrationRecord,
}
impl<L: Send + Sync> ModelLease for StoredModelLease<L> {
    fn bearer(&self) -> &crate::ai::oauth::ProtectedValue {
        self.record
            .credentials
            .as_ref()
            .and_then(|c| c.access_token.as_ref())
            .expect("StoredModels validates an access token before constructing its lease")
    }
    fn binding(&self) -> &crate::ai::oauth::RegistrationBinding {
        &self.record.binding
    }
}
impl<C: Sync, B: crate::ai::oauth::CredentialBoundary<C> + Send, A: super::HostAuthority<C>>
    ModelSession<C> for StoredModels<B, A>
where
    B::Lease: Sync,
{
    type Lease = StoredModelLease<B::Lease>;
    fn acquire_models<'a>(
        &'a self,
        context: &'a C,
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
            let credentials = record
                .credentials
                .as_ref()
                .ok_or(AiError::ConnectionUnavailable)?;
            if record.binding != binding
                || record.kind != crate::ai::oauth::RegistrationKind::LocalPublicClient
                || record.state != crate::ai::oauth::LifecycleState::Connected
                || record.identity.is_none()
                || credentials.access_token.is_none()
                || !credentials
                    .granted_scopes
                    .iter()
                    .any(|s| s == crate::ai::DIRECT_USAGE_SCOPE)
                || !matches!(
                    record.refresh_checkpoint,
                    crate::ai::oauth::RefreshCheckpoint::None
                )
                || credentials.expires_at_ms.is_none_or(|expiry| {
                    self.credentials.now_ms().map_or(true, |now| now >= expiry)
                })
            {
                return Err(AiError::ConnectionUnavailable);
            }
            self.authority.revalidate(context, &binding)?;
            Ok(StoredModelLease { lease, record })
        })
    }
    fn revalidate_models<'a>(
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
            Ok(())
        })
    }
}
