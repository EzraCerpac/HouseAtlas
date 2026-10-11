//! Explicit assembly of the already configured native AI host.
//!
//! The caller must separately establish external registration approval and
//! genuine peer, model and credential origins. Assembly neither verifies that
//! external provenance nor activates a route until `mounted_router` is used.
use super::{
    HostAuthority,
    enrollment::EnrollmentOwner,
    native::{NativeHostAuthority, NativeHostContext},
    service::{AiHost, HostPeers},
    status::StatusJournal,
};
use crate::{
    ai::{AiError, RunLimits},
    http::{Host, ai::ReceiptEnrollment},
};
use axum::Router;
use serde::Serialize;
use std::sync::Arc;

type NativeAiHost<P> = AiHost<P, NativeHostAuthority<ReceiptEnrollment<EnrollmentOwner>>>;

/// Correlation data only. It cannot recreate a native context, credential,
/// dispatch authority or HTTP admission. Cancellation epoch is omitted so a
/// terminal receipt can retain its original registration identity after stop.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReceiptIdentity {
    pub actor_id: String,
    pub workspace_id: String,
    pub home_id: String,
    pub registration_id: String,
    pub authority_epoch: String,
}

/// Held startup composition. The HTTP and native sides use the same actual
/// enrollment owner and access boundary; no listener is started here.
pub struct TrustedAiStartup<P: HostPeers<Context = NativeHostContext>> {
    host: Host,
    api: Arc<NativeAiHost<P>>,
    enrollment: Arc<ReceiptEnrollment<EnrollmentOwner>>,
}

impl<P: HostPeers<Context = NativeHostContext> + 'static> TrustedAiStartup<P> {
    /// Compare actual owner allocations before composing the service. This is
    /// only an identity check; it does not open, query or initialize a store.
    pub fn assemble(
        host: Host,
        peers: P,
        enrollment: Arc<EnrollmentOwner>,
        journal: StatusJournal,
        limits: RunLimits,
    ) -> Result<Self, AiError> {
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
        let api = Arc::new(AiHost {
            peers,
            authority: NativeHostAuthority {
                access,
                registrations: ReceiptEnrollment(Arc::clone(&enrollment)),
            },
            journal,
            limits,
        });
        Ok(Self {
            host,
            api,
            enrollment: Arc::new(ReceiptEnrollment(enrollment)),
        })
    }

    /// Project from the original opaque native capture after receipt-specific
    /// revalidation. Recheck after copying to fence a concurrent owner change.
    pub fn receipt_identity(
        &self,
        context: &NativeHostContext,
    ) -> Result<AiReceiptIdentity, AiError> {
        let binding = context.registration();
        self.api
            .authority
            .revalidate_action_receipt(context, binding)?;
        let identity = AiReceiptIdentity {
            actor_id: binding.actor_id.clone(),
            workspace_id: binding.workspace_id.clone(),
            home_id: binding.home_id.clone(),
            registration_id: binding.registration_id.clone(),
            authority_epoch: binding.authority_epoch.clone(),
        };
        self.api
            .authority
            .revalidate_action_receipt(context, binding)?;
        Ok(identity)
    }

    /// Explicit opt-in route assembly; application configuration must decide
    /// whether and where to mount the returned router.
    pub fn mounted_router(&self) -> Router {
        crate::http::ai::mounted_router(
            self.host.clone(),
            Arc::clone(&self.api),
            Arc::clone(&self.enrollment),
        )
    }
}
