//! Explicit assembly of the already configured native AI host.
//!
//! The caller must separately establish external registration approval and
//! genuine peer, model and credential origins. Assembly neither verifies that
//! external provenance nor activates a route until `mounted_router` is used.
use super::{
    HostAuthority,
    enrollment::EnrollmentOwner,
    native::{NativeHostAuthority, NativeHostContext},
    service::{AiHost, HostApi, HostCommand, HostPeers},
    status::StatusJournal,
};
use crate::{
    ai::{AiError, PortFuture, RunLimits},
    http::{Host, ai::ReceiptEnrollment},
};
use axum::Router;
use serde::Serialize;
use std::sync::Arc;

type NativeAiHost<P> = AiHost<P, NativeHostAuthority<ReceiptEnrollment<EnrollmentOwner>>>;

/// Original native custody owner supplied by the application, never an HTTP
/// assertion. It checks the retained physical stores/handles without creating
/// credentials, granting authority or qualifying a runtime. The account-only
/// SELECT custody is not a writable inference-store implementation.
pub trait StartupCustody: Send + Sync {
    fn revalidate(&self) -> Result<(), AiError>;
}

struct CustodiedApi<H, C: ?Sized> {
    api: Arc<H>,
    custody: Arc<C>,
}
impl<H: HostApi, C: StartupCustody + ?Sized> HostApi for CustodiedApi<H, C> {
    type Context = H::Context;

    fn call<'a>(
        &'a self,
        context: &'a Self::Context,
        command: HostCommand,
    ) -> PortFuture<'a, serde_json::Value> {
        Box::pin(async move {
            self.custody.revalidate()?;
            let result = self.api.call(context, command).await;
            // Fence successful and failed results alike. The original host
            // retains submitted work and receipts; custody loss never retries.
            self.custody.revalidate()?;
            result
        })
    }
}

/// Also used by direct native entry points, which do not pass through HostApi.
/// A lost release fence preserves original journals/results but discloses no
/// success, never retries and never recreates credentials.
pub(crate) async fn fence_custody<T>(
    custody: Option<&dyn StartupCustody>,
    operation: impl std::future::Future<Output = Result<T, AiError>>,
) -> Result<T, AiError> {
    if let Some(custody) = custody {
        custody.revalidate()?;
    }
    let result = operation.await;
    if let Some(custody) = custody {
        custody.revalidate()?;
    }
    result
}

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

    /// Explicit full-host composition with the same retained native custody
    /// around every authenticated call. Starts no listener or native operation.
    pub fn mounted_router_with_custody<C: StartupCustody + 'static>(
        &self,
        custody: Arc<C>,
    ) -> Result<Router, AiError> {
        custody.revalidate()?;
        Ok(self.mounted_router_retained(custody))
    }

    pub(crate) fn mounted_router_retained(&self, custody: Arc<dyn StartupCustody>) -> Router {
        crate::http::ai::mounted_router(
            self.host.clone(),
            Arc::new(CustodiedApi {
                api: Arc::clone(&self.api),
                custody,
            }),
            Arc::clone(&self.enrollment),
        )
    }
}

#[cfg(test)]
mod custody_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    struct Custody {
        current: AtomicBool,
        checks: AtomicUsize,
    }
    impl StartupCustody for Custody {
        fn revalidate(&self) -> Result<(), AiError> {
            self.checks.fetch_add(1, Ordering::SeqCst);
            if self.current.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(AiError::ConnectionUnavailable)
            }
        }
    }
    struct Api {
        custody: Arc<Custody>,
        calls: AtomicUsize,
        lose_custody: bool,
        fail: bool,
    }
    impl HostApi for Api {
        type Context = ();
        fn call<'a>(&'a self, _: &'a (), _: HostCommand) -> PortFuture<'a, serde_json::Value> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if self.lose_custody {
                    self.custody.current.store(false, Ordering::SeqCst);
                }
                if self.fail {
                    Err(AiError::DomainUnavailable)
                } else {
                    Ok(serde_json::json!({"synthetic": true}))
                }
            })
        }
    }
    fn fixture(current: bool, lose_custody: bool, fail: bool) -> CustodiedApi<Api, Custody> {
        let custody = Arc::new(Custody {
            current: AtomicBool::new(current),
            checks: AtomicUsize::new(0),
        });
        CustodiedApi {
            api: Arc::new(Api {
                custody: Arc::clone(&custody),
                calls: AtomicUsize::new(0),
                lose_custody,
                fail,
            }),
            custody,
        }
    }
    #[tokio::test]
    async fn original_custody_fences_calls_and_preserves_typed_results() {
        for fail in [false, true] {
            let host = fixture(true, false, fail);
            let result = host.call(&(), HostCommand::Connection).await;
            if fail {
                assert_eq!(result, Err(AiError::DomainUnavailable));
            } else {
                assert_eq!(result, Ok(serde_json::json!({"synthetic": true})));
            }
            assert_eq!(host.api.calls.load(Ordering::SeqCst), 1);
            assert_eq!(host.custody.checks.load(Ordering::SeqCst), 2);
        }
    }
    #[tokio::test]
    async fn custody_loss_blocks_dispatch_or_release_without_replay() {
        let host = fixture(false, false, false);
        assert_eq!(
            host.call(&(), HostCommand::Connection).await,
            Err(AiError::ConnectionUnavailable)
        );
        assert_eq!(host.api.calls.load(Ordering::SeqCst), 0);
        assert_eq!(host.custody.checks.load(Ordering::SeqCst), 1);
        for fail in [false, true] {
            let host = fixture(true, true, fail);
            assert_eq!(
                host.call(&(), HostCommand::Connection).await,
                Err(AiError::ConnectionUnavailable)
            );
            assert_eq!(host.api.calls.load(Ordering::SeqCst), 1);
            assert_eq!(host.custody.checks.load(Ordering::SeqCst), 2);
        }
    }

    #[tokio::test]
    async fn direct_native_boundary_fences_the_original_result_without_replay() {
        for fail in [false, true] {
            let host = fixture(true, false, fail);
            let result = fence_custody(
                Some(host.custody.as_ref()),
                host.api.call(&(), HostCommand::Connection),
            )
            .await;
            assert_eq!(result.is_err(), fail);
            assert_eq!(host.api.calls.load(Ordering::SeqCst), 1);
            assert_eq!(host.custody.checks.load(Ordering::SeqCst), 2);

            let lost = fixture(true, true, fail);
            assert_eq!(
                fence_custody(
                    Some(lost.custody.as_ref()),
                    lost.api.call(&(), HostCommand::Connection),
                )
                .await,
                Err(AiError::ConnectionUnavailable)
            );
            assert_eq!(lost.api.calls.load(Ordering::SeqCst), 1);

            let absent = fixture(false, false, fail);
            assert_eq!(
                fence_custody(
                    Some(absent.custody.as_ref()),
                    absent.api.call(&(), HostCommand::Connection),
                )
                .await,
                Err(AiError::ConnectionUnavailable)
            );
            assert_eq!(absent.api.calls.load(Ordering::SeqCst), 0);
        }
        // This exercises the same boundary utility used by native entry points,
        // not an actual callback, refresh, credential lease or provider.
    }
}
