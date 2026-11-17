//! Native cached reads and explicit Editor diagnostics. Browsing sends no demand.
use crate::{
    access as a,
    app::ServerRuntime,
    domain as d,
    http::{CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response},
    providers::network as n,
    storage as s,
};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use s::Runtime;
use std::sync::Arc;

fn unavailable() -> super::super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn native_error(error: n::NetworkPublicationError<s::Error>) -> super::super::HttpFailure {
    match error {
        n::NetworkPublicationError::Network(error) => failure(match error.code {
            n::ErrorCode::Auth | n::ErrorCode::WrongScope => StatusCode::FORBIDDEN,
            n::ErrorCode::Timeout => StatusCode::GATEWAY_TIMEOUT,
            n::ErrorCode::InvalidSchema | n::ErrorCode::SizeLimit => StatusCode::BAD_GATEWAY,
            n::ErrorCode::Transport | n::ErrorCode::Upstream => StatusCode::SERVICE_UNAVAILABLE,
        }),
        n::NetworkPublicationError::Storage(error) => {
            super::super::domain_error(crate::app::storage_error(error))
        }
    }
}
pub(in crate::http) async fn cached(
    State(host): State<Host>,
    Path((workspace_id, home_id, source_instance_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
        let collection = collection(&uri)?;
        let read = read_cached(
            &host,
            &headers,
            &uri,
            &method,
            &scope,
            &source_instance_id,
            &collection,
        )?;
        let facet = &read.facet;
        let value = serde_json::to_value(facet).map_err(|_| unavailable())?;
        let response = json_response(value);
        read.revalidate()?;
        Ok(response)
    })
    .await
    .map_err(|_| unavailable())?
}

/// The existing cached read, shared with the optional scene enrichment. No transport.
pub(in crate::http) struct CachedRead<'h> {
    pub facet: n::NetworkFacet,
    binding: &'h crate::config::providers::network_host::NetworkBinding,
    host: &'h Host,
    original: Arc<n::host_runtime::OriginalNetworkDisclosure>,
    now: String,
    collector: n::collector::Cached,
    observations: Option<Arc<n::observations::Observations>>,
}
impl CachedRead<'_> {
    pub fn enrich_collector(
        &self,
        id: &str,
        facts: &mut serde_json::Value,
    ) -> Result<(), super::super::HttpFailure> {
        if self.facet.status != n::FacetStatus::Revoked
            && self.facet.status != n::FacetStatus::Unavailable
            && let Some(observations) = &self.observations
            && observations.attempted
            && observations.newer_than(
                self.collector
                    .as_ref()
                    .filter(|s| self.original.generation_id() == Some(s.0.as_str()))
                    .and_then(|s| s.1.as_ref()),
            )
            && facts["status"] != "absent"
        {
            observations
                .enrich(self.facet.source_revision, id, &self.now, facts)
                .map_err(|_| unavailable())?;
            facts["measurementReason"] =
                serde_json::json!(observations.reason(self.facet.source_revision, &self.now));
            return Ok(());
        }
        n::collector::enrich(
            self.binding.runtime().settings().collector_measurements(),
            &self.collector,
            self.original.generation_id(),
            id,
            &self.now,
            facts,
        )
        .map_err(|_| unavailable())
    }
    pub fn revalidate(&self) -> Result<(), super::super::HttpFailure> {
        let current = self
            .binding
            .runtime()
            .collector_snapshot()
            .map_err(|_| unavailable())?;
        if !match (&current, &self.collector) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        } {
            return Err(unavailable());
        }
        let released = self
            .binding
            .runtime()
            .disclose(&self.host.core, &self.original, &self.now)
            .map_err(native_error)?;
        if released != self.facet {
            return Err(unavailable());
        }
        self.original.revalidate().map_err(access_error)
    }
}
pub(in crate::http) fn read_cached<'h>(
    host: &'h Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &d::Scope,
    source_instance_id: &str,
    collection: &str,
) -> Result<CachedRead<'h>, super::super::HttpFailure> {
    let access_scope =
        crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let core = host.core.lock().map_err(|_| unavailable())?;
    let url = crate::http::auth::url(host, uri);
    let request = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    // Fresh issuance is owned directly by the native disclosure. Never copy
    // a RequestPrincipal into a second issuer or reconstruct its grants.
    let principal = core
        .access
        .lock()
        .map_err(|_| unavailable())?
        .authorize(&request, &access_scope, a::Action::Read)
        .map_err(access_error)?;
    drop(core);
    read_cached_principal(host, principal, scope, source_instance_id, collection)
}
fn read_cached_principal<'h>(
    host: &'h Host,
    principal: a::Principal,
    scope: &d::Scope,
    source_instance_id: &str,
    collection: &str,
) -> Result<CachedRead<'h>, super::super::HttpFailure> {
    let core = host.core.lock().map_err(|_| unavailable())?;
    let binding = host
        .network_bindings
        .iter()
        .find(|binding| {
            let partition = binding.runtime().settings().configured_source().partition();
            partition.workspace_id.as_str() == scope.workspace_id
                && partition.home_id.as_str() == scope.home_id
                && partition.source_instance_id.as_str() == source_instance_id
                && partition.collection_id == collection
        })
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    if !Arc::ptr_eq(binding.access().shared().as_existing(), &core.access) {
        return Err(unavailable());
    }
    let partition = binding
        .access()
        .partition_grant(
            &principal,
            &binding.runtime().settings().configured_source().partition(),
        )
        .map_err(access_error)?;
    let entities = binding
        .entities()
        .iter()
        .map(|reference| binding.access().source_grant(&principal, reference))
        .collect::<a::AccessResult<Vec<_>>>()
        .map_err(access_error)?;
    // Native read/disclose borrow the exact owning Core themselves. Retain
    // the original grants, and release this earlier borrow before entry.
    drop(core);
    let now = ServerRuntime.now().map_err(|_| unavailable())?;
    let (facet, original) = binding
        .runtime()
        .read(
            &host.core,
            binding.access().clone(),
            principal,
            partition,
            entities,
            &now,
        )
        .map_err(native_error)?;
    let collector = binding
        .runtime()
        .collector_snapshot()
        .map_err(|_| unavailable())?;
    let observations = binding
        .observations
        .as_ref()
        .map(|h| h.snapshot())
        .transpose()
        .map_err(|_| unavailable())?;
    Ok(CachedRead {
        observations,
        collector,
        facet,
        binding,
        host,
        original,
        now,
    })
}

fn collection(uri: &Uri) -> Result<String, super::super::HttpFailure> {
    let value = super::super::query::one_utf8(uri, "collection", 3 * 4096 * 4 + 11, 4096 * 4)?;
    if value.is_empty() || value.chars().count() > 4096 {
        return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
    }
    Ok(value)
}
fn configured<'h>(
    host: &'h Host,
    scope: &d::Scope,
    source: &str,
    collection: &str,
) -> Option<&'h crate::config::providers::network_host::NetworkBinding> {
    host.network_bindings.iter().find(|b| {
        let s = &b.runtime().settings().source().scope;
        s.workspace_id == scope.workspace_id
            && s.home_id == scope.home_id
            && s.source_instance_id == source
            && s.collection_id == collection
            && b.observations.is_some()
    })
}
pub(in crate::http) async fn results(
    State(host): State<Host>,
    Path((workspace_id, home_id, source)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        let collection = collection(&uri)?;
        // Authenticate even when no collector is configured.
        crate::http::authorized_read_unlocked(&host, &headers, &uri, &method, scope.clone(), |_| {
            if configured(&host, &scope, &source, &collection).is_none() {
                return Ok(json_response(serde_json::json!({"status":"unavailable"})));
            }
            let read = read_cached(&host, &headers, &uri, &method, &scope, &source, &collection)?;
            let observations = read.observations.as_ref().ok_or_else(unavailable)?;
            let mut value = observations.results();
            value["inventoryRevision"] = serde_json::json!(observations.revision());
            value["servedInventoryRevision"] = serde_json::json!(read.facet.source_revision);
            value["measurementReason"] =
                serde_json::json!(observations.reason(read.facet.source_revision, &read.now));
            // Property-level speed/Wi-Fi facts are independent of device grants.
            // Device diagnostics disclose only served members at the same revision.
            if let Some(actions) = value
                .get_mut("results")
                .and_then(|r| r.get_mut("actions"))
                .and_then(serde_json::Value::as_array_mut)
            {
                actions.retain(|a| {
                    a["kind"] == "speed"
                        || (observations
                            .reason(read.facet.source_revision, &read.now)
                            .is_none()
                            && a["inventoryRevision"].as_u64() == read.facet.source_revision
                            && a["deviceId"].as_str().is_some_and(|id| {
                                read.facet.devices.iter().any(|d| d.external_id == id)
                            }))
                });
            }
            read.revalidate()?;
            Ok(json_response(value))
        })
    })
    .await
    .map_err(|_| unavailable())?
}

/// One in-flight action across every configured source, plus one second between
/// admissions. No queued retries; cancellation of an HTTP caller keeps the guard
/// on the bounded blocking worker until the collector response/deadline settles.
#[derive(Default)]
pub(in crate::http) struct ActionGate(std::sync::Mutex<(bool, Option<std::time::Instant>)>);
struct ActionFlight<'a>(&'a ActionGate);
impl ActionGate {
    fn acquire(&self) -> Option<ActionFlight<'_>> {
        let mut state = self.0.lock().ok()?;
        let now = std::time::Instant::now();
        if state.0
            || state
                .1
                .is_some_and(|at| now.duration_since(at) < std::time::Duration::from_secs(1))
        {
            return None;
        }
        *state = (true, Some(now));
        Some(ActionFlight(self))
    }
}
impl Drop for ActionFlight<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.0.lock() {
            state.0 = false;
        }
    }
}
pub(in crate::http) async fn action(
    State(host): State<Host>,
    Path((workspace_id, home_id, source)): Path<(String, String, String)>,
    request: axum::extract::Request,
) -> HttpResult {
    let headers = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(unavailable)?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let scope = d::Scope {
        workspace_id,
        home_id,
    };
    let auth_host = host.clone();
    let auth_headers = headers.clone();
    let auth_uri = uri.clone();
    let auth_scope = scope.clone();
    let auth_method = method.clone();
    // Same owner as HomeBox refresh: session, POST, current CSRF and Editor.
    // Reject before body parsing, configured-source lookup or collector access.
    let principal = tokio::task::spawn_blocking(move || {
        super::homebox_refresh::mutation_principal(
            &auth_host,
            &auth_headers,
            &auth_uri,
            &auth_method,
            &auth_scope,
        )
    })
    .await
    .map_err(|_| unavailable())??;
    if super::super::headers::single(request.headers(), "content-type")
        .map_err(access_error)?
        .as_deref()
        != Some("application/json")
    {
        return Err(failure(StatusCode::UNSUPPORTED_MEDIA_TYPE));
    }
    let bytes = super::super::admission::body(request.into_body(), 8192).await?;
    let action = n::observations::Action::parse(&bytes)
        .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        run_action(
            &host, &headers, &uri, principal, scope, &source, action, &runtime,
        )
    })
    .await
    .map_err(|_| unavailable())?
}
#[allow(clippy::too_many_arguments)]
fn run_action(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    principal: crate::app::RequestPrincipal,
    scope: d::Scope,
    source: &str,
    action: n::observations::Action,
    runtime: &tokio::runtime::Handle,
) -> HttpResult {
    let _admitted = headers.admission_permit()?;
    {
        let core = host.core.lock().map_err(|_| unavailable())?;
        principal
            .release(&*core.access.lock().map_err(|_| unavailable())?)
            .map_err(access_error)?;
    }
    let collection = collection(uri)?;
    let Some(binding) = configured(host, &scope, source, &collection) else {
        return Ok(json_response(serde_json::json!({"status":"unavailable"})));
    };
    let read = read_cached_principal(
        host,
        principal.principal.principal().clone(),
        &scope,
        source,
        &collection,
    )?;
    let observations = read.observations.as_ref().ok_or_else(unavailable)?;
    if let Some(reason) = observations.reason(read.facet.source_revision, &read.now) {
        return Ok(json_response(
            serde_json::json!({"status":"refused","reason":reason}),
        ));
    }
    if action
        .device_id()
        .is_some_and(|id| !read.facet.devices.iter().any(|d| d.external_id == id))
    {
        return Ok(json_response(
            serde_json::json!({"status":"refused","reason":"unknown-device"}),
        ));
    }
    if let n::observations::Action::Port { port, .. } = &action
        && !binding
            .runtime()
            .settings()
            .collector_action_ports()
            .contains(port)
    {
        return Ok(json_response(
            serde_json::json!({"status":"refused","reason":"port-not-allowed"}),
        ));
    }
    let Some(_flight) = host.network_action_gate.acquire() else {
        return Ok(json_response(
            serde_json::json!({"status":"busy","reason":"process-limit"}),
        ));
    };
    let peer = binding.collector_peer.as_ref().ok_or_else(unavailable)?;
    let revision = read.facet.source_revision.ok_or_else(unavailable)?;
    let body = action.collector_body(revision).map_err(|_| unavailable())?;
    read.revalidate()?;
    // Recheck the observed revision immediately before dispatch, without
    // holding any Access, Core, sidecar or observation lock across I/O.
    let current = binding
        .observations
        .as_ref()
        .ok_or_else(unavailable)?
        .snapshot()
        .map_err(|_| unavailable())?;
    if !Arc::ptr_eq(observations, &current) {
        return Ok(json_response(
            serde_json::json!({"status":"refused","reason":"observations-changed"}),
        ));
    }
    let value = runtime.block_on(async {
        match tokio::time::timeout(n::observations::ACTION_TIMEOUT, peer.post(body)).await {
            Ok(Ok((status, bytes))) => n::observations::decode_action(
                status, &bytes, &action, revision,
            )
            .unwrap_or_else(
                |_| serde_json::json!({"status":"unknown","reason":"invalid-collector-response"}),
            ),
            Ok(Err(e)) if e.code != n::ErrorCode::Timeout => {
                serde_json::json!({"status":"unknown","reason":"collector-unavailable"})
            }
            _ => serde_json::json!({"status":"timeout","reason":"outcome-unknown"}),
        }
    });
    read.revalidate()?;
    principal
        .release(
            &*host
                .core
                .lock()
                .map_err(|_| unavailable())?
                .access
                .lock()
                .map_err(|_| unavailable())?,
        )
        .map_err(access_error)?;
    Ok(json_response(value))
}

#[cfg(test)]
#[path = "network_healthy.rs"]
mod tests;
