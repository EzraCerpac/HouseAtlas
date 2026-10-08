//! Authenticated account-only GET from the original native encrypted session.
use super::{Host, ai::ApplicationAuthority, auth, response::HttpFailure};
use crate::ai::{
    AiError, Cancellation,
    host::{
        continuation::ExactReviewReady,
        enrollment::EnrollmentOwner,
        http::{HttpAuthority, SessionHttpGate},
        native::NativeHostContext,
        startup::{
            NativeStartup,
            account::{NativeAccountFacts, NativeAccountObservation},
            stock::{NativeReadDomain, NativeReadPrepared},
        },
    },
    runtime::HumanReviewPort,
};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::StatusCode,
    routing::get,
};
use std::sync::Arc;

struct AccountMount<R>
where
    R: ExactReviewReady<NativeHostContext, NativeReadPrepared>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync,
{
    startup: Arc<NativeStartup<NativeAccountFacts, NativeReadDomain, R>>,
    gate: SessionHttpGate<
        ApplicationAuthority<EnrollmentOwner>,
        ApplicationAuthority<EnrollmentOwner>,
    >,
}

/// Called by the native application with the same Host/enrollment allocations
/// already checked by native assembly. No inference or lifecycle route mounts.
pub(crate) fn mounted_router<R>(
    host: Host,
    startup: Arc<NativeStartup<NativeAccountFacts, NativeReadDomain, R>>,
    enrollment: Arc<EnrollmentOwner>,
) -> Router
where
    R: ExactReviewReady<NativeHostContext, NativeReadPrepared>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync
        + 'static,
{
    let application = ApplicationAuthority::new(host, enrollment);
    Router::new()
        .route(
            "/account",
            get(account::<R>)
                .head(auth::session_head)
                .fallback(auth::session_head),
        )
        .with_state(Arc::new(AccountMount {
            startup,
            gate: SessionHttpGate {
                application: application.clone(),
                authority: application,
            },
        }))
}

async fn account<R>(
    State(mount): State<Arc<AccountMount<R>>>,
    request: Request,
) -> Result<Json<NativeAccountObservation>, HttpFailure>
where
    R: ExactReviewReady<NativeHostContext, NativeReadPrepared>
        + HumanReviewPort<NativeHostContext>
        + Send
        + Sync
        + 'static,
{
    let (head, _) = request.into_parts();
    let context = mount
        .gate
        .authenticate(&head, false)
        .await
        .map_err(failure)?;
    let cancel = Cancellation::default();
    let result = mount
        .startup
        .observe_account(context.native(), &cancel)
        .await;
    // Revalidate every result after await. A stale principal or enrollment
    // replaces either observation or error before any response is constructed.
    mount.gate.release(&context).map_err(failure)?;
    result.map(Json).map_err(failure)
}

fn failure(error: AiError) -> HttpFailure {
    HttpFailure::for_status(match error {
        AiError::InvalidInput | AiError::LimitReached => StatusCode::BAD_REQUEST,
        AiError::ConnectionUnavailable => StatusCode::FORBIDDEN,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    })
}
