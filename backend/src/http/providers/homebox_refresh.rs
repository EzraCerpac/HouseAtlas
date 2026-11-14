//! One explicit Editor-requested HomeBox cache refresh. Browsing never calls
//! it; there is no timer, retry or startup refresh. HomeBox receives GETs only.
use crate::{
    access as a,
    app::RequestPrincipal,
    config::providers::{homebox::TrustedHomeBoxSource, registry::ConfiguredSource},
    domain as d,
    http::{CheckedHeaders, Host, HttpFailure, HttpResult, access_error, auth, failure},
    lifecycle::providers::{
        authority::{NativeLifecycleAuthority, ProviderLease},
        homebox_refresh::{self, RefreshOutcome},
    },
    providers::homebox::read::NativeReadCredentialConfig,
    storage as s,
};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
    response::IntoResponse,
};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

/// Trusted startup selection: one configured source and its owner-only header.
#[derive(Clone)]
pub struct HomeBoxRefreshBinding {
    source: Arc<TrustedHomeBoxSource>,
    configured: Arc<ConfiguredSource>,
    credentials: Arc<NativeReadCredentialConfig>,
    #[cfg(test)]
    pub(crate) certificate: Option<Vec<u8>>,
}
impl HomeBoxRefreshBinding {
    pub fn new(
        source: Arc<TrustedHomeBoxSource>,
        configured: Arc<ConfiguredSource>,
        credentials: Arc<NativeReadCredentialConfig>,
    ) -> s::Result<Self> {
        let endpoint = source.endpoint().map_err(|_| binding_error())?;
        if configured.registration() != source.registration()
            || source.registration().owner != s::SourceOwner::Homebox
            || !credentials.matches_endpoint(&endpoint)
        {
            return Err(binding_error());
        }
        Ok(Self {
            source,
            configured,
            credentials,
            #[cfg(test)]
            certificate: None,
        })
    }
    pub(crate) fn source(&self) -> &Arc<TrustedHomeBoxSource> {
        &self.source
    }
}
fn binding_error() -> s::Error {
    s::Error::new("invalid-contract", "HomeBox refresh source unavailable")
}

/// At most one refresh runs in this process; a second request is answered.
struct Running<'a>(&'a AtomicBool);
impl<'a> Running<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}
impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Every structured outcome is 200 with a `status`; HTTP errors stay for
/// authentication, CSRF, role and scope refusals.
fn answer(value: Value) -> HttpResult {
    Ok(Json(value).into_response())
}
fn unavailable() -> HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn cache_facts(cache: &s::CacheStatus) -> Value {
    json!({
        "status": cache.status,
        "lastSuccessfulFetchAt": cache.last_successful_fetch_at,
        "lastAttemptAt": cache.last_attempt_at,
        "errorCode": cache.error.as_ref().map(|error| error.code),
    })
}

pub(in crate::http) async fn refresh(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    let runtime = tokio::runtime::Handle::current();
    let scope = d::Scope {
        workspace_id,
        home_id,
    };
    tokio::task::spawn_blocking(move || run(&host, &headers, &uri, &method, scope, &runtime))
        .await
        .map_err(|_| unavailable())?
}

fn run(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: d::Scope,
    runtime: &tokio::runtime::Handle,
) -> HttpResult {
    let _admitted = headers.admission_permit()?;
    let selected = crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    // POST + current CSRF + Editor membership, from the caller's own session.
    let principal = {
        let core = host.core.lock().map_err(|_| unavailable())?;
        if !core.homes.iter().any(|home| home.scope == scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        let url = auth::url(host, uri);
        let observed = crate::http::evidence(&host.origin, headers, uri, &url, method)
            .map_err(access_error)?;
        let original = core
            .access
            .lock()
            .map_err(|_| unavailable())?
            .authorize(&observed, &selected, a::Action::Mutate)
            .map_err(access_error)?;
        RequestPrincipal::new(original)
    };
    let mut bindings = host.homebox_refresh_bindings.iter().filter(|binding| {
        let partition = binding.configured.partition();
        partition.workspace_id.as_str() == scope.workspace_id
            && partition.home_id.as_str() == scope.home_id
    });
    let (Some(binding), None) = (bindings.next(), bindings.next()) else {
        // No credential selected for this home: nothing is sent upstream.
        return answer(json!({"status": "not-configured"}));
    };
    let Some(_running) = Running::acquire(&host.homebox_refresh_running) else {
        return answer(json!({"status": "running"}));
    };
    let authority = NativeLifecycleAuthority;
    let access = Arc::clone(&host.core.lock().map_err(|_| unavailable())?.access);
    // Register only when the exact enabled source is not already readable;
    // re-registering would advance the Access version for open grants.
    let readable = access
        .lock()
        .map_err(|_| unavailable())?
        .authorize_source_partition(
            principal.principal.principal(),
            &binding.configured.partition(),
        )
        .is_ok();
    if !readable {
        let core = host.core.lock().map_err(|_| unavailable())?;
        if homebox_refresh::register(
            &core,
            &authority,
            &principal,
            Arc::clone(&binding.configured),
            &binding.source,
        )
        .is_err()
        {
            return answer(json!({"status": "failed", "reason": "registration-unavailable"}));
        }
    }
    let Ok(lease) = ProviderLease::capture(
        &access,
        &authority,
        principal.principal.principal(),
        Arc::clone(&binding.configured),
        &[],
    ) else {
        return answer(json!({"status": "failed", "reason": "not-approved"}));
    };
    let lease = Arc::new(lease);
    let outcome = runtime.block_on(homebox_refresh::refresh_configured(
        &host.core,
        &lease,
        &binding.source,
        &binding.credentials,
        #[cfg(test)]
        binding.certificate.as_deref(),
    ));
    let response = match outcome {
        Ok(RefreshOutcome::Published { cache }) => {
            json!({"status": "refreshed", "cache": cache_facts(&cache)})
        }
        Ok(RefreshOutcome::FailureRecorded { cache, .. }) => json!({
            "status": "failed",
            "reason": cache.error.as_ref().map(|error| error.code),
            "cache": cache_facts(&cache),
        }),
        Err(_) => json!({"status": "failed", "reason": "unavailable"}),
    };
    let access = access.lock().map_err(|_| unavailable())?;
    principal.release(&access).map_err(access_error)?;
    answer(response)
}

#[cfg(test)]
mod tests;
