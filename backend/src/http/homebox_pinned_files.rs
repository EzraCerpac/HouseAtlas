//! Configured local HomeBox attachment capture and Media-owned delivery.
//! The artifact describes one process-local snapshot, never a provider version.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, authorized_read_unlocked, evidence, failure,
    json_response,
};
use crate::{
    access as a,
    config::providers::homebox::TrustedHomeBoxSource,
    domain::{self as d, stock as st},
    media::{self as m, homebox_pinned_artifacts::AuthenticatedPinnedRedemption},
    providers::homebox::read::{
        self as hb,
        query::{HomeBoxReadQuery, NativePinnedFileOwner, ReadSelection},
    },
    storage,
};
use axum::{
    extract::{Extension, Path, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, Uri},
    response::IntoResponse,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const QUERY_MAX_BYTES: usize = 32_768;
const WIRE_MAX_BYTES: usize = 16_384;
const MAX_CAPTURE_REQUESTS: usize = 1024;
const MAX_SESSION_CAPTURE_REQUESTS: usize = 128;

type CaptureRequestKey = ([u8; 32], String, String, String);
struct ConsumedCaptureRequest {
    wire: Vec<u8>,
    session_expires_at_ms: i64,
    original: a::Principal,
}
/// Process-local at-most-once admission, not a delivery or issuance receipt.
/// Spent IDs survive every later failure while their native session can return.
/// Only absolute expiry or authoritative native session retirement reclaims IDs.
/// Capacity exhaustion refuses new work rather than evicting a live spent ID.
/// Each authenticated session has a smaller quota so one session cannot spend
/// the entire shared budget. The global bound still limits aggregate retention.
#[derive(Default)]
pub(super) struct CaptureRequests {
    spent: BTreeMap<CaptureRequestKey, ConsumedCaptureRequest>,
    observed_wall_time_ms: i64,
}
impl CaptureRequests {
    fn consume(
        &mut self,
        access: &a::AccessBoundary,
        original: &a::Principal,
        session: [u8; 32],
        session_expires_at_ms: i64,
        request: &st::ValidatedRequest,
    ) -> Result<(), super::HttpFailure> {
        if access
            .authenticated_session_binding(original)
            .map_err(access_error)?
            != session
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|time| i64::try_from(time.as_millis()).ok())
            .ok_or_else(unavailable)?;
        // Once expired tombstones are reclaimed, a backward wall-clock change
        // must not make their original sessions admissible again.
        let now = now.max(self.observed_wall_time_ms);
        self.observed_wall_time_ms = now;
        if session_expires_at_ms <= now {
            return Err(unavailable());
        }
        self.spent
            .retain(|_, spent| spent.session_expires_at_ms > now);
        let mut checked = BTreeSet::new();
        let mut ended = BTreeSet::new();
        for (key, spent) in &self.spent {
            if checked.insert(key.0)
                && access
                    .session_binding_has_ended(&spent.original)
                    .map_err(access_error)?
            {
                ended.insert(key.0);
            }
        }
        // No transient membership/source denial or clock rollback can release
        // an ID. A failed authoritative read leaves live tombstones retained.
        self.spent.retain(|key, _| !ended.contains(&key.0));
        let key = (
            session,
            request.context().workspace_id.clone(),
            request.context().home_id.clone(),
            request.request_id().to_owned(),
        );
        let wire = serde_json::to_vec(request.raw()).map_err(|_| unavailable())?;
        if wire.len() > WIRE_MAX_BYTES {
            return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
        }
        if let Some(spent) = self.spent.get(&key) {
            // A repeat carries no assertion about how the first attempt ended.
            return Err(if spent.wire == wire {
                failure(StatusCode::CONFLICT)
            } else {
                invalid()
            });
        }
        if self.spent.len() >= MAX_CAPTURE_REQUESTS
            || self
                .spent
                .keys()
                .filter(|key| key.0 == session)
                .take(MAX_SESSION_CAPTURE_REQUESTS)
                .count()
                >= MAX_SESSION_CAPTURE_REQUESTS
        {
            return Err(unavailable());
        }
        self.spent.insert(
            key,
            ConsumedCaptureRequest {
                wire,
                session_expires_at_ms,
                original: original.clone(),
            },
        );
        Ok(())
    }
}

/// Explicit startup selection only. No source, credential or handle is created
/// by an HTTP selector; each capture uses the current original request grants.
#[derive(Clone)]
pub struct PinnedHomeBoxFileBinding {
    source: Arc<TrustedHomeBoxSource>,
    credentials: Arc<hb::NativeReadCredentialConfig>,
    #[cfg(test)]
    certificate: Option<Vec<u8>>,
}
impl PinnedHomeBoxFileBinding {
    pub fn new(
        source: Arc<TrustedHomeBoxSource>,
        credentials: Arc<hb::NativeReadCredentialConfig>,
    ) -> storage::Result<Self> {
        let endpoint = source.endpoint().map_err(|_| binding_error())?;
        if source.metadata_dialect() != crate::providers::homebox::wire::DIALECT
            || !credentials.matches_endpoint(&endpoint)
        {
            return Err(binding_error());
        }
        Ok(Self {
            source,
            credentials,
            #[cfg(test)]
            certificate: None,
        })
    }
    pub(super) fn source(&self) -> &Arc<TrustedHomeBoxSource> {
        &self.source
    }
    fn matches(&self, query: &HomeBoxReadQuery) -> bool {
        let partition = self.source.partition();
        partition.workspace_id == query.scope().workspace_id.as_str()
            && partition.home_id == query.scope().home_id.as_str()
            && partition.source_instance_id == query.scope().source_instance_id.as_str()
            && partition.collection_id == query.scope().collection_id
    }
}

fn binding_error() -> storage::Error {
    storage::Error::new("invalid-contract", "Pinned HomeBox source unavailable")
}
fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn invalid() -> super::HttpFailure {
    failure(StatusCode::UNPROCESSABLE_ENTITY)
}
fn media_error(error: m::MediaError) -> super::HttpFailure {
    failure(StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}

struct CancelOnDrop(m::Cancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
fn budget() -> Result<(CancelOnDrop, m::WorkBudget), super::HttpFailure> {
    let cancellation = m::Cancellation::default();
    let cancel = CancelOnDrop(cancellation.clone());
    let budget = m::WorkBudget::new(Duration::from_secs(10), cancellation).map_err(media_error)?;
    Ok((cancel, budget))
}
// Dropping this future stops our reader from scheduling another GET after the
// budget is observed cancelled. A request already delivered to the provider
// may still complete remotely; cancellation is not a remote rollback receipt.
async fn capture_with_budget<T>(
    budget: &m::WorkBudget,
    capture: impl std::future::Future<Output = m::MediaResult<T>>,
) -> m::MediaResult<T> {
    tokio::pin!(capture);
    loop {
        budget.check()?;
        tokio::select! {
            result = &mut capture => {
                budget.check()?;
                return result;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }
}

fn original_wire(uri: &Uri) -> Result<Value, super::HttpFailure> {
    let query = uri.query().ok_or_else(invalid)?;
    if query.len() > QUERY_MAX_BYTES {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let mut fields = url::form_urlencoded::parse(query.as_bytes());
    let (key, value) = fields.next().ok_or_else(invalid)?;
    if key != "request" || fields.next().is_some() {
        return Err(invalid());
    }
    if value.len() > WIRE_MAX_BYTES {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    super::intake::json(value.as_bytes())
}

pub(super) async fn capture(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    capture_selected(
        host,
        workspace_id,
        home_id,
        headers,
        uri,
        method,
        false,
        false,
    )
    .await
}

pub(super) async fn capture_v4(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    capture_selected(
        host,
        workspace_id,
        home_id,
        headers,
        uri,
        method,
        true,
        false,
    )
    .await
}

pub(super) async fn offline_original(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    capture_selected(
        host,
        workspace_id,
        home_id,
        headers,
        uri,
        method,
        true,
        true,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn capture_selected(
    host: Host,
    workspace_id: String,
    home_id: String,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    v4: bool,
    offline: bool,
) -> HttpResult {
    let (_cancel, budget) = budget()?;
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read_unlocked(
            &host,
            &headers,
            &uri,
            &method,
            d::Scope {
                workspace_id,
                home_id,
            },
            |principal| {
                budget.check().map_err(media_error)?;
                let raw = original_wire(&uri)?;
                let contracts =
                    st::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
                let request = if v4 {
                    st::ValidatedRequest::parse_pinned_homebox_download_v4(&contracts, raw)
                } else {
                    st::ValidatedRequest::parse(&contracts, raw)
                }
                    .map_err(super::stock_reads::http_error)?;
                if request.is_mutation() || request.id() != st::OperationId::HomeboxFileDownload {
                    return Err(invalid());
                }
                let query = HomeBoxReadQuery::from_request(&request)
                    .map_err(super::stock_reads::http_error)?;
                if !matches!(query.selection(), ReadSelection::Download)
                    || request.context().workspace_id
                        != principal.principal.scope().workspace_id.as_str()
                    || request.context().home_id != principal.principal.scope().home_id.as_str()
                {
                    return Err(failure(StatusCode::FORBIDDEN));
                }
                let mut bindings = host
                    .pinned_homebox_file_bindings
                    .iter()
                    .filter(|binding| binding.matches(&query));
                let binding = bindings
                    .next()
                    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
                if bindings.next().is_some() {
                    return Err(unavailable());
                }
                let access = {
                    let core = host.core.lock().map_err(|_| unavailable())?;
                    if !Arc::ptr_eq(&core.access, &host.mcp_access) {
                        return Err(unavailable());
                    }
                    Arc::clone(&core.access)
                };
                let partition: a::SourcePartition = serde_json::from_value(
                    serde_json::to_value(binding.source.partition()).map_err(|_| unavailable())?,
                )
                .map_err(|_| unavailable())?;
                let owner = request.target()["entityId"].as_str().ok_or_else(invalid)?;
                let source = a::SourceRef {
                    workspace_id: principal.principal.scope().workspace_id.clone(),
                    home_id: principal.principal.scope().home_id.clone(),
                    key: a::SourceKey {
                        source_instance_id: partition.source_instance_id.clone(),
                        collection_id: partition.collection_id.clone(),
                        source_kind: a::SourceKind::HomeboxEntity,
                        external_id: owner.to_owned(),
                    },
                };
                let (source_grant, partition_grant, session, session_expires_at_ms) = {
                    let mut boundary = access.lock().map_err(|_| unavailable())?;
                    let url = super::auth::url(&host, &uri);
                    let request_evidence = evidence(&host.origin, &headers, &uri, &url, &method)
                        .map_err(access_error)?;
                    let session_info = boundary
                        .session_info(&request_evidence)
                        .map_err(access_error)?;
                    if session_info.actor_id() != principal.principal.actor_id() {
                        return Err(failure(StatusCode::FORBIDDEN));
                    }
                    principal
                        .capture_partition(&boundary, &partition)
                        .map_err(access_error)?;
                    principal
                        .capture_source(&boundary, &source)
                        .map_err(access_error)?;
                    (
                        principal.captured_source(&source).map_err(access_error)?,
                        principal
                            .captured_partition(&partition)
                            .map_err(access_error)?,
                        boundary
                            .authenticated_session_binding(&principal.principal)
                            .map_err(access_error)?,
                        session_info.expires_at_ms(),
                    )
                };
                principal.seal_source_capture();
                let original = principal.principal.retained().clone();
                // Burn admission before the first provider GET. No gate guard
                // crosses I/O, and no error or cancellation resets this entry.
                {
                    // Keep native retirement observations and consumption in
                    // the same Access->capture lock order, before provider I/O.
                    let boundary = access.lock().map_err(|_| unavailable())?;
                    host.pinned_homebox_capture_requests
                        .lock()
                        .map_err(|_| unavailable())?
                        .consume(&boundary, original.principal(), session, session_expires_at_ms, &request)?;
                }
                // No Core/Store/Access/Broker guard survives these three real GETs.
                let owner = Arc::new(runtime.block_on(async {
                    #[cfg(test)]
                    if let Some(certificate) = &binding.certificate {
                        return capture_with_budget(&budget, NativePinnedFileOwner::capture_loopback_fixture(
                            &binding.source, &binding.credentials, Arc::clone(&access), original.clone(),
                            source_grant.clone(), partition_grant, &request, certificate,
                        )).await;
                    }
                    let capture = NativePinnedFileOwner::capture_configured(
                        &binding.source, &binding.credentials, Arc::clone(&access), original.clone(),
                        source_grant.clone(), partition_grant, &request,
                    );
                    if offline { capture_with_budget(&budget, capture).await } else { capture.await }
                }).map_err(media_error)?);
                budget.check().map_err(media_error)?;
                if offline {
                    let (facts, bytes) = {
                        let mut boundary = access.lock().map_err(|_| unavailable())?;
                        m::homebox_pinned_artifacts::read_offline_original(
                            &mut boundary, &original, &source_grant, &request, &owner, &budget,
                        ).map_err(media_error)?
                    };
                    budget.check().map_err(media_error)?;
                    return offline_response(&facts, bytes);
                }
                let issued = {
                    let mut boundary = access.lock().map_err(|_| unavailable())?;
                    let mut broker = host
                        .pinned_homebox_artifacts
                        .lock()
                        .map_err(|_| unavailable())?;
                    broker
                        .issue(
                            &mut boundary,
                            &original,
                            &source_grant,
                            &request,
                            owner,
                            &budget,
                        )
                        .map_err(media_error)?
                };
                budget.check().map_err(media_error)?;
                let output = serde_json::to_value(issued.artifact()).map_err(|_| unavailable())?;
                if v4 {
                    let output = serde_json::json!({
                        "schemaVersion": 4,
                        "commandId": "homebox.file.download",
                        "requestId": request.request_id(),
                        "artifact": output,
                    });
                    st::StockContractPort::validate(
                        &contracts,
                        "urn:houseatlas:pinned-homebox-file:4#/$defs/result_homebox_file_capture_v4",
                        &output,
                    ).map_err(super::stock_reads::http_error)?;
                    Ok(json_response(output))
                } else {
                    Ok(json_response(output))
                }
            },
        )
    })
    .await
    .map_err(|_| unavailable())?
}

// The metadata is descriptive data, not a redemption capability. Raw bytes
// and their pins share one response, avoiding a second provider download.
fn offline_response(facts: &impl serde::Serialize, bytes: Vec<u8>) -> HttpResult {
    let encoded = STANDARD.encode(serde_json::to_vec(facts).map_err(|_| unavailable())?);
    if encoded.len() > WIRE_MAX_BYTES {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let mut response = bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        "content-type",
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        "cache-control",
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        "x-houseatlas-original",
        HeaderValue::from_str(&encoded).map_err(|_| unavailable())?,
    );
    Ok(response)
}

fn authenticated_redemption(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    workspace_id: &str,
    home_id: &str,
) -> Result<(crate::app::Access, AuthenticatedPinnedRedemption), super::HttpFailure> {
    let scope = d::Scope {
        workspace_id: workspace_id.into(),
        home_id: home_id.into(),
    };
    let native_scope =
        crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let access = {
        let core = host.core.lock().map_err(|_| unavailable())?;
        if !core.homes.iter().any(|home| home.scope == scope)
            || !Arc::ptr_eq(&core.access, &host.mcp_access)
        {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        Arc::clone(&core.access)
    };
    let url = super::auth::url(host, uri);
    let request = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let redemption = {
        let mut boundary = access.lock().map_err(|_| unavailable())?;
        AuthenticatedPinnedRedemption::authenticate(&mut boundary, &request, &native_scope)
            .map_err(media_error)?
    };
    Ok((access, redemption))
}

fn checked_token(token: &str) -> Result<(), super::HttpFailure> {
    if token.len() != 36
        || !uuid::Uuid::parse_str(token).is_ok_and(|value| value.to_string() == token)
    {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    Ok(())
}

pub(super) async fn availability(
    State(host): State<Host>,
    Path((workspace_id, home_id, token)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let (_cancel, budget) = budget()?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let (access, redemption) =
            authenticated_redemption(&host, &headers, &uri, &method, &workspace_id, &home_id)?;
        checked_token(&token)?;
        let observed = {
            let mut boundary = access.lock().map_err(|_| unavailable())?;
            let broker = host
                .pinned_homebox_artifacts
                .lock()
                .map_err(|_| unavailable())?;
            broker
                .resolve_availability(&mut boundary, &redemption, &token, &budget)
                .map_err(media_error)?
        };
        budget.check().map_err(media_error)?;
        Ok(json_response(
            serde_json::to_value(observed).map_err(|_| unavailable())?,
        ))
    })
    .await
    .map_err(|_| unavailable())?
}

pub(super) async fn redeem(
    State(host): State<Host>,
    Path((workspace_id, home_id, token)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let (_cancel, budget) = budget()?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let (access, redemption) =
            authenticated_redemption(&host, &headers, &uri, &method, &workspace_id, &home_id)?;
        checked_token(&token)?;
        let delivered = {
            let mut boundary = access.lock().map_err(|_| unavailable())?;
            let mut broker = host
                .pinned_homebox_artifacts
                .lock()
                .map_err(|_| unavailable())?;
            broker
                .redeem(&mut boundary, &redemption, &token, &budget)
                .map_err(media_error)?
        };
        let mut response = delivered.body.into_response();
        *response.status_mut() =
            StatusCode::from_u16(delivered.status).map_err(|_| unavailable())?;
        for (name, value) in delivered.headers {
            response.headers_mut().insert(
                HeaderName::from_static(name),
                HeaderValue::from_str(&value).map_err(|_| unavailable())?,
            );
        }
        budget.check().map_err(media_error)?;
        Ok(response)
    })
    .await
    .map_err(|_| unavailable())?
}

#[cfg(test)]
mod session_retirement_tests {
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};
    const ORIGIN: &str = "https://127.0.0.1:48743";
    fn id(n: u32) -> String {
        format!("10000000-0000-4000-8000-{n:012}")
    }
    fn evidence<'a>(
        method: a::Method,
        cookie: Option<&'a str>,
        csrf: Option<&'a str>,
    ) -> a::RequestEvidence<'a> {
        a::RequestEvidence {
            method,
            url: "https://127.0.0.1:48743/api/atlas/auth/session",
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie,
            csrf,
            authorization: None,
        }
    }
    fn cookie(receipt: &a::SessionReceipt) -> &str {
        receipt.set_cookie().split(';').next().unwrap()
    }
    fn request(contracts: &st::NativeStockContract, n: u32, resource: u32) -> st::ValidatedRequest {
        st::ValidatedRequest::parse(contracts, serde_json::json!({
            "schemaVersion":3,"commandId":"homebox.file.download","requestId":id(n),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),
                "resourceKind":"attachment","entityId":id(5),"resourceId":id(resource)},"payload":{}
        })).unwrap()
    }
    fn principal(
        access: &mut a::AccessBoundary,
        receipt: &a::SessionReceipt,
        scope: &a::Scope,
    ) -> a::Principal {
        access
            .authorize(
                &evidence(a::Method::Get, Some(cookie(receipt)), None),
                scope,
                a::Action::Read,
            )
            .unwrap()
    }
    fn consume(
        gate: &mut CaptureRequests,
        access: &a::AccessBoundary,
        original: &a::Principal,
        receipt: &a::SessionReceipt,
        request: &st::ValidatedRequest,
    ) -> Result<(), super::super::HttpFailure> {
        gate.consume(
            access,
            original,
            access
                .authenticated_session_binding(original)
                .map_err(access_error)?,
            receipt.info().expires_at_ms(),
            request,
        )
    }
    fn setup() -> (
        a::AccessBoundary,
        Arc<AtomicI64>,
        a::Scope,
        a::CanonicalId,
        i64,
    ) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let clock = Arc::new(AtomicI64::new(now));
        let current = clock.clone();
        let user = a::CanonicalId::parse(id(4)).unwrap();
        let scope = a::Scope {
            workspace_id: a::CanonicalId::parse(id(1)).unwrap(),
            home_id: a::CanonicalId::parse(id(2)).unwrap(),
        };
        let config = a::AccessConfig::new(vec![ORIGIN.into()])
            .unwrap()
            .with_loopback_local(a::LoopbackLocalIdentity {
                user_id: user.clone(),
                actor_id: a::CanonicalId::parse(id(5)).unwrap(),
                username: "generated-capture".into(),
                scope: scope.clone(),
            })
            .unwrap()
            .with_limits(a::AccessLimits {
                request_limit: 10_000,
                ..Default::default()
            })
            .unwrap()
            .with_clock(move || current.load(Ordering::Relaxed));
        let mut access = a::AccessBoundary::in_memory(config).unwrap();
        access.provision_loopback_local_user().unwrap();
        (access, clock, scope, user, now)
    }

    #[test]
    fn offline_capture_request_cannot_replay_after_an_unknown_outcome() {
        let (mut access, _clock, scope, _user, _now) = setup();
        let receipt = access
            .login_loopback_local(
                &evidence(a::Method::Post, None, None),
                "127.0.0.1".parse().unwrap(),
            )
            .unwrap();
        let original = principal(&mut access, &receipt, &scope);
        let contracts = st::NativeStockContract::new().unwrap();
        let first = request(&contracts, 100, 6);
        let mut gate = CaptureRequests::default();
        assert!(consume(&mut gate, &access, &original, &receipt, &first).is_ok());
        // This gate is spent before any provider GET, even if the caller never
        // receives a result. Reusing the ID cannot dispatch another download.
        assert_eq!(
            consume(&mut gate, &access, &original, &receipt, &first)
                .err()
                .unwrap()
                .status,
            StatusCode::CONFLICT
        );
        let changed = request(&contracts, 100, 7);
        assert_eq!(
            consume(&mut gate, &access, &original, &receipt, &changed)
                .err()
                .unwrap()
                .status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(gate.spent.len(), 1);
    }

    #[test]
    #[ignore = "HELD standalone capture replay/changed-wire/quota controls; source-only, no execution authorized"]
    fn live_capture_replay_controls_source_only() {
        let (mut access, clock, scope, user, now) = setup();
        let peer = "127.0.0.1".parse().unwrap();
        let first = access
            .login_loopback_local(&evidence(a::Method::Post, None, None), peer)
            .unwrap();
        let mut original = principal(&mut access, &first, &scope);
        let contracts = st::NativeStockContract::new().unwrap();
        let mut gate = CaptureRequests::default();
        for n in 0..128 {
            assert!(
                consume(
                    &mut gate,
                    &access,
                    &original,
                    &first,
                    &request(&contracts, 100 + n, 6)
                )
                .is_ok()
            );
        }
        let spent = request(&contracts, 100, 6);
        assert_eq!(
            consume(&mut gate, &access, &original, &first, &spent)
                .err()
                .unwrap()
                .status,
            StatusCode::CONFLICT
        );
        assert_eq!(
            consume(
                &mut gate,
                &access,
                &original,
                &first,
                &request(&contracts, 100, 7)
            )
            .err()
            .unwrap()
            .status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            consume(
                &mut gate,
                &access,
                &original,
                &first,
                &request(&contracts, 999, 6)
            )
            .err()
            .unwrap()
            .status,
            StatusCode::SERVICE_UNAVAILABLE
        );
        // A temporary membership denial can later recover with this same cookie.
        access
            .set_membership(&user, &scope, a::Role::Editor, false)
            .unwrap();
        assert!(!access.session_binding_has_ended(&original).unwrap());
        access
            .set_membership(&user, &scope, a::Role::Editor, true)
            .unwrap();
        original = principal(&mut access, &first, &scope);
        assert_eq!(
            consume(&mut gate, &access, &original, &first, &spent)
                .err()
                .unwrap()
                .status,
            StatusCode::CONFLICT
        );
        // Clock rollback is also transient and cannot release replay history.
        clock.store(now - 1, Ordering::Relaxed);
        assert!(!access.session_binding_has_ended(&original).unwrap());
        assert!(consume(&mut gate, &access, &original, &first, &spent).is_err());
        assert_eq!(gate.spent.len(), 128);
        clock.store(now, Ordering::Relaxed);
    }

    #[test]
    #[ignore = "Explicit isolated generated native-session retirement lifecycle; exact documented command only"]
    fn ended_native_sessions_release_capture_capacity() {
        let (mut access, _clock, scope, user, _now) = setup();
        let peer = "127.0.0.1".parse().unwrap();
        let first = access
            .login_loopback_local(&evidence(a::Method::Post, None, None), peer)
            .unwrap();
        let original = principal(&mut access, &first, &scope);
        let contracts = st::NativeStockContract::new().unwrap();
        let mut gate = CaptureRequests::default();
        for n in 0..128 {
            assert!(
                consume(
                    &mut gate,
                    &access,
                    &original,
                    &first,
                    &request(&contracts, 100 + n, 6)
                )
                .is_ok()
            );
        }
        assert_eq!(gate.spent.len(), 128);
        let mut receipt = access
            .rotate_session(&evidence(
                a::Method::Post,
                Some(cookie(&first)),
                Some(first.info().csrf_token()),
            ))
            .unwrap();
        assert_eq!(receipt.info().expires_at_ms(), first.info().expires_at_ms());
        assert!(access.session_binding_has_ended(&original).unwrap());
        for transition in 0..4 {
            let fresh = principal(&mut access, &receipt, &scope);
            assert!(
                consume(
                    &mut gate,
                    &access,
                    &fresh,
                    &receipt,
                    &request(&contracts, 5000 + transition, 6)
                )
                .is_ok()
            );
            assert_eq!(gate.spent.len(), 1);
            match transition {
                0 => {
                    access
                        .logout(&evidence(
                            a::Method::Post,
                            Some(cookie(&receipt)),
                            Some(receipt.info().csrf_token()),
                        ))
                        .unwrap();
                }
                1 => {
                    access.revoke_user_sessions(&user).unwrap();
                }
                2 => {
                    access.set_user_enabled(&user, false).unwrap();
                    access.set_user_enabled(&user, true).unwrap();
                }
                _ => {
                    access.invalidate_all_sessions().unwrap();
                }
            }
            assert!(access.session_binding_has_ended(&fresh).unwrap());
            receipt = access
                .login_loopback_local(&evidence(a::Method::Post, None, None), peer)
                .unwrap();
        }
        let final_principal = principal(&mut access, &receipt, &scope);
        assert!(
            consume(
                &mut gate,
                &access,
                &final_principal,
                &receipt,
                &request(&contracts, 6000, 6)
            )
            .is_ok()
        );
        assert_eq!(gate.spent.len(), 1);
    }
}

#[cfg(test)]
mod offline_response_tests {
    use super::*;

    #[tokio::test]
    async fn cancelled_capture_does_not_poll_or_release_a_result() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let cancellation = m::Cancellation::default();
        let budget = m::WorkBudget::new(Duration::from_secs(10), cancellation.clone()).unwrap();
        cancellation.cancel();
        let polled = AtomicBool::new(false);
        let result = capture_with_budget(&budget, async {
            polled.store(true, Ordering::SeqCst);
            Ok::<_, m::MediaError>(())
        })
        .await;
        assert!(result.is_err());
        assert!(!polled.load(Ordering::SeqCst));
        let pending_cancel = m::Cancellation::default();
        let pending_budget =
            m::WorkBudget::new(Duration::from_secs(10), pending_cancel.clone()).unwrap();
        let cancel_task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            pending_cancel.cancel();
        });
        let pending = capture_with_budget(
            &pending_budget,
            std::future::pending::<m::MediaResult<()>>(),
        )
        .await;
        assert!(pending.is_err());
        cancel_task.await.unwrap();
        let live = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default()).unwrap();
        assert_eq!(
            capture_with_budget(&live, async { Ok::<_, m::MediaError>(7) })
                .await
                .unwrap(),
            7
        );
    }

    #[test]
    fn metadata_roundtrips_and_remains_bounded() {
        let facts = serde_json::json!({"schemaVersion": 1, "contentType": null, "observationId": "fictional"});
        let Ok(response) = offline_response(&facts, b"original".to_vec()) else {
            panic!("synthetic response refused");
        };
        assert_eq!(
            response.headers()["content-type"],
            "application/octet-stream"
        );
        assert_eq!(response.headers()["cache-control"], "private, no-store");
        let encoded = response.headers()["x-houseatlas-original"]
            .to_str()
            .unwrap();
        let decoded: Value = serde_json::from_slice(&STANDARD.decode(encoded).unwrap()).unwrap();
        assert_eq!(decoded, facts);
        assert!(
            offline_response(
                &serde_json::json!({"large": "x".repeat(WIRE_MAX_BYTES)}),
                vec![]
            )
            .is_err()
        );
    }
}

#[cfg(test)]
mod mounted_offline_original_tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        extract::ConnectInfo,
        http::Request,
    };
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use serde_json::json;
    use sha2::{Digest as _, Sha256};
    use std::{
        net::{Ipv4Addr, SocketAddr},
        sync::Arc,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    use tokio_rustls::{
        TlsAcceptor,
        rustls::{self, pki_types::PrivatePkcs8KeyDer},
    };
    use tower::ServiceExt;

    const ORIGIN: &str = "https://127.0.0.1:48743";
    const ORIGINAL: &[u8] = b"%PDF-1.7\nfictional original\n%%EOF\n";
    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn request(path: &str, cookie: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder()
            .method("GET")
            .uri(path)
            .header("host", "127.0.0.1:48743")
            .header("origin", ORIGIN)
            .header("sec-fetch-site", "same-origin");
        if let Some(cookie) = cookie {
            builder = builder.header("cookie", cookie);
        }
        let mut request = builder.body(Body::empty()).unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
        ));
        request
    }
    fn path(request_id: u32) -> String {
        let wire = json!({"schemaVersion":4,"commandId":"homebox.file.download","requestId":id(request_id),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"homebox","sourceInstanceId":id(300),"collectionId":id(301),
                "resourceKind":"attachment","entityId":id(2),"resourceId":id(201)},"payload":{}});
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("request", &wire.to_string())
            .finish();
        format!(
            "/api/atlas/stock/v4/workspaces/{}/homes/{}/homebox-offline-original?{}",
            id(1),
            id(2),
            query
        )
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn mounted_original_admission_disclosure_error_and_replay()
    -> Result<(), crate::lifecycle::Failure> {
        let scratch = tempfile::Builder::new()
            .prefix("homebox-offline-original-")
            .tempdir()?;
        let directory = scratch.path().join("fixture");
        let core = crate::lifecycle::prepare(&directory, ORIGIN)?;
        let cookie: Value =
            serde_json::from_slice(&std::fs::read(directory.join("smoke-session.json"))?)?;
        let cookie = cookie["cookie"]
            .as_str()
            .ok_or("missing synthetic session")?
            .to_owned();
        let registration: a::SourceRegistration = serde_json::from_value(json!({
            "workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(300),"collectionId":id(301),
            "owner":"homebox","partitionMode":"reviewed-entity-allowlist","allowedExternalIds":[id(2),id(1)]
        }))?;
        let access = Arc::clone(&core.access);
        access.lock().unwrap().put_source(&registration, None)?;
        let cert = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()])?;
        let leaf = cert.cert.der().to_vec();
        let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.cert.der().clone()],
            PrivatePkcs8KeyDer::from(cert.signing_key.serialize_der()).into(),
        )?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let provider_origin = format!("https://{}", listener.local_addr()?);
        let durable: storage::SourceRegistration =
            serde_json::from_value(serde_json::to_value(&registration)?)?;
        let source = Arc::new(TrustedHomeBoxSource::new_stock(
            &provider_origin,
            durable,
            hb::Limits::default(),
            None,
        )?);
        let credentials = Arc::new(hb::NativeReadCredentialConfig::from_trusted_header(
            &source.endpoint()?,
            b"Bearer generated-test-only".to_vec(),
        )?);
        let mut binding = PinnedHomeBoxFileBinding::new(source, credentials)?;
        binding.certificate = Some(leaf);
        let app = super::super::router(
            Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
                .with_pinned_homebox_files(vec![binding])?,
        );
        let acceptor = TlsAcceptor::from(Arc::new(tls));
        let server = tokio::spawn(async move {
            let detail = include_bytes!("../providers/homebox/wire/fixtures/item.detail.json");
            let expected = [
                format!("/api/v1/entities/{}", id(2)),
                format!("/api/v1/entities/{}/attachments/{}", id(2), id(201)),
                format!("/api/v1/entities/{}", id(2)),
                format!("/api/v1/entities/{}", id(2)),
            ];
            for (n, path) in expected.iter().enumerate() {
                let (socket, peer) = listener.accept().await.unwrap();
                assert!(peer.ip().is_loopback());
                let mut stream = acceptor.accept(socket).await.unwrap();
                let mut raw = Vec::new();
                while !raw.ends_with(b"\r\n\r\n") {
                    let mut b = [0];
                    stream.read_exact(&mut b).await.unwrap();
                    raw.push(b[0]);
                    assert!(raw.len() < 16384);
                }
                let line = String::from_utf8(raw).unwrap();
                assert_eq!(line.lines().next().unwrap(), format!("GET {path} HTTP/1.1"));
                let body: &[u8] = if n == 1 {
                    ORIGINAL
                } else if n == 3 {
                    b"unavailable"
                } else {
                    detail
                };
                let status = if n == 3 {
                    "503 Service Unavailable"
                } else {
                    "200 OK"
                };
                stream
                    .write_all(
                        format!(
                            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                stream.write_all(body).await.unwrap();
                let _ = stream.shutdown().await;
            }
        });
        let first = path(700);
        assert_ne!(
            app.clone().oneshot(request(&first, None)).await?.status(),
            StatusCode::OK
        );
        let response = app.clone().oneshot(request(&first, Some(&cookie))).await?;
        assert_eq!(response.status(), StatusCode::OK);
        let encoded = response.headers()["x-houseatlas-original"].to_str()?;
        let facts: Value = serde_json::from_slice(&STANDARD.decode(encoded)?)?;
        assert_eq!(facts["requestId"], id(700));
        assert_eq!(facts["scope"]["sourceInstanceId"], id(300));
        assert_eq!(facts["scope"]["collectionId"], id(301));
        assert_eq!(facts["target"]["entityId"], id(2));
        assert_eq!(facts["target"]["resourceId"], id(201));
        assert_eq!(facts["byteSize"], ORIGINAL.len());
        assert_eq!(facts["sha256"], format!("{:x}", Sha256::digest(ORIGINAL)));
        assert_eq!(facts["contentType"], "application/pdf");
        assert_eq!(&to_bytes(response.into_body(), 1024).await?[..], ORIGINAL);
        assert_eq!(
            app.clone()
                .oneshot(request(&first, Some(&cookie)))
                .await?
                .status(),
            StatusCode::CONFLICT
        );
        let failed = path(701);
        assert_ne!(
            app.clone()
                .oneshot(request(&failed, Some(&cookie)))
                .await?
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.clone()
                .oneshot(request(&failed, Some(&cookie)))
                .await?
                .status(),
            StatusCode::CONFLICT
        );
        server.await?;
        let scope = a::Scope {
            workspace_id: a::CanonicalId::parse(id(1))?,
            home_id: a::CanonicalId::parse(id(2))?,
        };
        access.lock().unwrap().set_membership(
            &a::CanonicalId::parse(id(4))?,
            &scope,
            a::Role::Viewer,
            false,
        )?;
        assert_ne!(
            app.oneshot(request(&path(702), Some(&cookie)))
                .await?
                .status(),
            StatusCode::OK
        );
        Ok(())
    }
}
