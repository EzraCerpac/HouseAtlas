//! Explicit named-Editor inventory publication. Browsing and polling never call this.
use super::{
    homebox_refresh::{Running, mutation_principal},
    network::{collection, unavailable},
};
use crate::{
    access as a, domain as d,
    http::{CheckedHeaders, Host, HttpResult, access_error, json_response},
    providers::network::{
        self as n,
        host_runtime::{NetworkAuthority, RefreshResult},
    },
};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, Uri},
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

pub(super) fn may_refresh(
    binding: &crate::config::providers::network_host::NetworkBinding,
    principal: &a::Principal,
) -> bool {
    principal.role() == a::Role::Editor && binding.refresh_editors.contains(principal.actor_id())
}

pub(in crate::http) async fn refresh(
    State(host): State<Host>,
    Path((workspace_id, home_id, source)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let scope = d::Scope { workspace_id, home_id };
        let principal = mutation_principal(&host, &headers, &uri, &method, &scope)?;
        let (collection, revalidate) = selection(&uri)?;
        let binding = host.network_bindings.iter().find(|b| {
            let s = &b.runtime().settings().source().scope;
            s.workspace_id == scope.workspace_id && s.home_id == scope.home_id
                && s.source_instance_id == source && s.collection_id == collection
                && !b.refresh_editors.is_empty()
        });
        let Some(binding) = binding else {
            return Ok(json_response(json!({"status":"not-configured"})));
        };
        let original = principal.principal.principal();
        let configured = binding.runtime().settings().configured_source();
        if !may_refresh(binding, original) || binding.access().shared().try_lock().map_err(access_error)?
            .capture_lifecycle(original, configured.access_registration(), a::LifecycleCapability::ConfigureSource).is_err() {
            return Ok(json_response(json!({"status":"refused","reason":"not-approved"})));
        }
        let Some(_running) = Running::acquire(&host.network_refresh_running) else {
            return Ok(json_response(json!({"status":"running"})));
        };
        // Only absence triggers registration. A disabled or changed registration
        // remains governed by the original ConfigureSource owner and Access policy.
        if !revalidate && binding.access().partition_grant(original, &configured.partition()).is_err()
            && binding.access().configure(&host.core, original, configured).is_err() {
            return Ok(json_response(json!({"status":"failed","reason":"registration-unavailable","quarantined":false})));
        }
        let lease = (|| {
            let partition = binding.access().partition_grant(original, &configured.partition())?;
            let entities = binding.entities().iter().map(|r| binding.access().source_grant(original, r)).collect::<a::AccessResult<Vec<_>>>()?;
            if revalidate {
                binding.access().retain_revalidation(original.clone(), configured.clone(), partition, entities)
            } else {
                binding.access().retain_original(original.clone(), configured.clone(), partition, entities)
            }
        })();
        let Ok(lease) = lease else {
            return Ok(json_response(json!({"status":"refused","reason":"not-approved"})));
        };
        let authority = NetworkAuthority::new(lease.clone(), &binding.runtime().settings().transport(), None)
            .map_err(|_| unavailable())?;
        let clock = || crate::app::now().unwrap_or_default();
        let outcome = runtime.block_on(binding.runtime().refresh_reviewed(&host.core, authority, lease, CancellationToken::new(), clock));
        let held = binding.runtime().cache_reads_held();
        // Return the native committed receipt without a fallible post-commit
        // disclosure/read that could hide a successful publication.
        let value = match outcome {
            Ok(RefreshResult::Published { cache, source_revision, unchanged }) => json!({
                "status":if unchanged {"unchanged"} else {"refreshed"}, "inventoryRevision":source_revision, "cache":cache_facts(&cache)
            }),
            Ok(RefreshResult::AlreadyRunning) => json!({"status":"running"}),
            Ok(RefreshResult::NeedsReview { reviewed_revision, collector_revision }) => json!({"status":"needs-review", "reviewedInventoryRevision":reviewed_revision, "collectorInventoryRevision":collector_revision}),
            Ok(RefreshResult::SourceFailure(cache)) => json!({"status":"failed", "reason":cache.error.as_ref().map(|e| e.code), "quarantined":held || cache.status == crate::storage::CacheState::AccessRevoked, "cache":cache_facts(&cache)}),
            Err(n::NetworkPublicationError::Network(e)) => json!({"status":"failed","reason":e.code,"quarantined":held}),
            Err(n::NetworkPublicationError::Storage(e)) => json!({"status":"failed","reason":e.code,"quarantined":held || e.code == "access-revoked"}),
        };
        Ok(json_response(value))
    }).await.map_err(|_| unavailable())?
}

fn cache_facts(cache: &crate::storage::CacheStatus) -> serde_json::Value {
    json!({"status":cache.status,"lastSuccessfulFetchAt":cache.last_successful_fetch_at,"lastAttemptAt":cache.last_attempt_at,"errorCode":cache.error.as_ref().map(|e| e.code)})
}

// Keep the original opaque collection decoder, permitting only the explicit
// recovery switch after it. Repeated/unknown switches remain rejected.
fn selection(uri: &Uri) -> Result<(String, bool), crate::http::HttpFailure> {
    let Some(query) = uri.query().and_then(|q| q.strip_suffix("&revalidate=true")) else {
        return collection(uri).map(|collection| (collection, false));
    };
    let selected: Uri = format!("{}?{}", uri.path(), query)
        .parse()
        .map_err(|_| unavailable())?;
    collection(&selected).map(|collection| (collection, true))
}
