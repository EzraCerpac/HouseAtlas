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
use serde_json::Value;
use std::{
    collections::BTreeMap,
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
}
/// Process-local at-most-once admission, not a delivery or issuance receipt.
/// Spent IDs survive every later failure until the original session expires.
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
        session: [u8; 32],
        session_expires_at_ms: i64,
        request: &st::ValidatedRequest,
    ) -> Result<(), super::HttpFailure> {
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
}
impl PinnedHomeBoxFileBinding {
    pub fn new(
        source: Arc<TrustedHomeBoxSource>,
        credentials: Arc<hb::NativeReadCredentialConfig>,
    ) -> storage::Result<Self> {
        let endpoint = source.endpoint().map_err(|_| binding_error())?;
        let partition = source.partition();
        if source.metadata_dialect() != crate::providers::homebox::wire::DIALECT
            || !credentials.matches_endpoint(&endpoint)
        {
            return Err(binding_error());
        }
        Ok(Self {
            source,
            credentials,
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
    capture_selected(host, workspace_id, home_id, headers, uri, method, false).await
}

pub(super) async fn capture_v4(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    capture_selected(host, workspace_id, home_id, headers, uri, method, true).await
}

async fn capture_selected(
    host: Host, workspace_id: String, home_id: String,
    headers: CheckedHeaders, uri: Uri, method: Method, v4: bool,
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
                    let url = format!(
                        "{}{}",
                        host.origin,
                        uri.path_and_query().map_or("/", |path| path.as_str())
                    );
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
                host.pinned_homebox_capture_requests
                    .lock()
                    .map_err(|_| unavailable())?
                    .consume(session, session_expires_at_ms, &request)?;
                // No Core/Store/Access/Broker guard survives these three real GETs.
                let owner = Arc::new(
                    runtime
                        .block_on(NativePinnedFileOwner::capture_configured(
                            &binding.source,
                            &binding.credentials,
                            Arc::clone(&access),
                            original.clone(),
                            source_grant.clone(),
                            partition_grant,
                            &request,
                        ))
                        .map_err(media_error)?,
                );
                budget.check().map_err(media_error)?;
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
    let url = format!("{}{}", host.origin, uri.path());
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
