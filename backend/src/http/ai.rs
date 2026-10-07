//! Native app authority for an explicitly supplied AI enrollment and host.
use super::{CheckedHeaders, Host, admission, evidence};
use crate::{
    access,
    ai::{
        AiError, PortFuture,
        host::{
            HostAuthority,
            http::{ApplicationHttpAuthority, SessionHttpGate},
            native::{NativeHostContext, RegistrationAuthority},
            service::{HostApi, HostCommand},
        },
        oauth::RegistrationBinding,
    },
    domain,
    transports::mcp::NativePrincipalPort,
};
use axum::{Router, extract::OriginalUri, http::request::Parts};
use std::sync::Arc;

/// The enrollment owner resolves current server state for this actual principal.
/// A browser registration label cannot implement this boundary.
pub trait EnrollmentPort: RegistrationAuthority {
    fn capture(&self, original: &access::Principal) -> Result<RegistrationBinding, AiError>;
}

impl EnrollmentPort for crate::ai::host::enrollment::EnrollmentOwner {
    fn capture(&self, original: &access::Principal) -> Result<RegistrationBinding, AiError> {
        crate::ai::host::enrollment::EnrollmentOwner::capture(self, original)
    }
}

/// Wrap the same enrollment owner used by the host and lifecycle environment.
/// Only receipt checks resolve a new cancellation epoch; all other operations
/// retain the original full revalidation contract.
pub struct ReceiptEnrollment<R>(pub Arc<R>);
impl<R: EnrollmentPort> RegistrationAuthority for ReceiptEnrollment<R> {
    fn revalidate(
        &self,
        original: &access::Principal,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        self.0.revalidate(original, binding)
    }
    fn revalidate_action_receipt(
        &self,
        original: &access::Principal,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        let current = self.0.capture(original)?;
        crate::ai::host::native::revalidate_receipt_registration(
            self.0.as_ref(),
            original,
            binding,
            &current,
        )
    }
}
impl<R: EnrollmentPort> EnrollmentPort for ReceiptEnrollment<R> {
    fn capture(&self, original: &access::Principal) -> Result<RegistrationBinding, AiError> {
        self.0.capture(original)
    }
}

/// Opaque original native context and HTTP admission retained across awaits.
pub struct RequestContext {
    native: NativeHostContext,
    _admitted: admission::Permit,
}
impl RequestContext {
    pub fn native(&self) -> &NativeHostContext {
        &self.native
    }
}

pub struct ApplicationAuthority<R> {
    host: Host,
    registrations: Arc<R>,
}
impl<R> Clone for ApplicationAuthority<R> {
    fn clone(&self) -> Self {
        Self {
            host: self.host.clone(),
            registrations: Arc::clone(&self.registrations),
        }
    }
}
impl<R: EnrollmentPort + 'static> ApplicationHttpAuthority for ApplicationAuthority<R> {
    type Context = RequestContext;
    fn capture<'a>(&'a self, head: &'a Parts, mutating: bool) -> PortFuture<'a, RequestContext> {
        Box::pin(async move {
            let checked = head
                .extensions
                .get::<CheckedHeaders>()
                .cloned()
                .ok_or(AiError::ConnectionUnavailable)?;
            let admitted = checked
                .admission_permit()
                .map_err(|_| AiError::ConnectionUnavailable)?;
            // Axum strips nested prefixes from URI. Only the actual original URI
            // can supply this app route's complete qualified home and origin.
            let original = head
                .extensions
                .get::<OriginalUri>()
                .ok_or(AiError::ConnectionUnavailable)?
                .0
                .clone();
            if original.query().is_some() {
                return Err(AiError::InvalidInput);
            }
            let parts = original.path().split('/').collect::<Vec<_>>();
            if parts.len() < 10
                || parts[..5] != ["", "api", "atlas", "v1", "workspaces"]
                || parts[6] != "homes"
                || parts[8] != "ai"
                || parts.iter().skip(1).any(|part| part.is_empty())
            {
                return Err(AiError::InvalidInput);
            }
            let scope = domain::Scope {
                workspace_id: parts[5].into(),
                home_id: parts[7].into(),
            };
            let selected = crate::app::access_scope(&scope).map_err(|_| AiError::InvalidInput)?;
            let method = head.method.clone();
            if mutating != (method == axum::http::Method::POST)
                || !matches!(method, axum::http::Method::GET | axum::http::Method::POST)
            {
                return Err(AiError::InvalidInput);
            }
            let host = self.host.clone();
            let registrations = Arc::clone(&self.registrations);
            let (principal, binding, boundary) = tokio::task::spawn_blocking(move || {
                let core = host.core.lock().map_err(|_| AiError::DomainUnavailable)?;
                if !core.homes.iter().any(|home| home.scope == scope) {
                    return Err(AiError::ConnectionUnavailable);
                }
                let access = Arc::clone(&core.access);
                drop(core);
                let url = format!("{}{}", host.origin, original.path());
                let observed = evidence(&host.origin, &checked, &original, &url, &method)
                    .map_err(|_| AiError::ConnectionUnavailable)?;
                let principal = access
                    .lock()
                    .map_err(|_| AiError::DomainUnavailable)?
                    .authorize(
                        &observed,
                        &selected,
                        if mutating {
                            access::Action::Mutate
                        } else {
                            access::Action::Read
                        },
                    )
                    .map_err(|_| AiError::ConnectionUnavailable)?;
                let binding = registrations.capture(&principal)?;
                registrations.revalidate(&principal, &binding)?;
                Ok((principal, binding, NativePrincipalPort::new(access)))
            })
            .await
            .map_err(|_| AiError::DomainUnavailable)??;
            let native = NativeHostContext::capture(principal, binding, &boundary).await?;
            let context = RequestContext {
                native,
                _admitted: admitted,
            };
            self.revalidate(&context, context.native.registration())?;
            Ok(context)
        })
    }
    fn release(&self, context: &RequestContext) -> Result<(), AiError> {
        self.revalidate(context, context.native.registration())
    }
    fn release_after_disconnect(&self, context: &RequestContext) -> Result<(), AiError> {
        self.revalidate_action_receipt(context, context.native.registration())
    }
}
impl<R: EnrollmentPort> HostAuthority<RequestContext> for ApplicationAuthority<R> {
    fn binding(&self, context: &RequestContext) -> Result<RegistrationBinding, AiError> {
        self.revalidate(context, context.native.registration())?;
        Ok(context.native.registration().clone())
    }
    fn revalidate(
        &self,
        context: &RequestContext,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        if context.native.registration() != binding {
            return Err(AiError::ConnectionUnavailable);
        }
        let access = {
            let core = self
                .host
                .core
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?;
            Arc::clone(&core.access)
        };
        access
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?
            .revalidate(context.native.original())
            .map_err(|_| AiError::ConnectionUnavailable)?;
        self.registrations
            .revalidate(context.native.original(), binding)
    }
    fn revalidate_action_receipt(
        &self,
        context: &RequestContext,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        if context.native.registration() != binding {
            return Err(AiError::ConnectionUnavailable);
        }
        let access = {
            let core = self
                .host
                .core
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?;
            Arc::clone(&core.access)
        };
        access
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?
            .revalidate(context.native.original())
            .map_err(|_| AiError::ConnectionUnavailable)?;
        let current = self.registrations.capture(context.native.original())?;
        crate::ai::host::native::revalidate_receipt_registration(
            self.registrations.as_ref(),
            context.native.original(),
            binding,
            &current,
        )
    }
}

struct NativeApi<H>(Arc<H>);
impl<H: HostApi<Context = NativeHostContext>> HostApi for NativeApi<H> {
    type Context = RequestContext;
    fn call<'a>(
        &'a self,
        context: &'a RequestContext,
        command: HostCommand,
    ) -> PortFuture<'a, serde_json::Value> {
        self.0.call(context.native(), command)
    }
}

/// No default host or enrollment is installed. The real supplied API retains
/// its credential, model, catalog, continuation and separate human-review peers.
pub fn mounted_router<H, R>(host: Host, api: Arc<H>, registrations: Arc<R>) -> Router
where
    H: HostApi<Context = NativeHostContext> + 'static,
    R: EnrollmentPort + 'static,
{
    let application = ApplicationAuthority {
        host,
        registrations,
    };
    crate::ai::host::http::router(
        Arc::new(NativeApi(api)),
        SessionHttpGate {
            application: application.clone(),
            authority: application,
        },
    )
}
