//! Concrete passive HTTPS inventory read. Trusted configuration and current
//! authority come from host ports; upstream JSON never supplies Atlas scope.
use super::{InventoryGet, InventoryResponse, InventoryTransport, model::*, projection::*};
use reqwest::{
    Client, Url,
    header::{
        ACCEPT, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING, CONTENT_TYPE, COOKIE,
        HeaderValue, LOCATION,
    },
};
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct ReviewedNetworkOrigin {
    endpoint: Url,
}
impl ReviewedNetworkOrigin {
    /// Validate an exact canonical HTTPS origin supplied by trusted host config.
    /// Structural validation does not grant source access or target acceptance.
    pub fn https(origin: &str) -> Result<Self> {
        let mut endpoint =
            Url::parse(origin).map_err(|_| NetworkError::new(ErrorCode::WrongScope))?;
        if endpoint.scheme() != "https"
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
            || endpoint.origin().ascii_serialization() != origin
        {
            return Err(NetworkError::new(ErrorCode::WrongScope));
        }
        endpoint.set_path(InventoryGet.path());
        Ok(Self { endpoint })
    }
    pub(crate) fn custody_fingerprint(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(b"houseatlas-network-origin/1\0GET\0/api/inventory\0");
        hash.update(self.origin().as_bytes());
        format!("{:x}", hash.finalize())
    }
    pub fn origin(&self) -> String {
        self.endpoint.origin().ascii_serialization()
    }
}

/// Opaque evidence from this concrete verified inventory read. No public
/// issuer, Clone, serialization or URL/header disclosure. It is provenance,
/// never an authority grant; the provider consumes it against exact bytes.
pub struct InventoryOriginCustody {
    registration: SourceRegistration,
    origin_sha256: String,
    body_sha256: String,
}
impl InventoryOriginCustody {
    pub(crate) fn consume(
        self,
        registration: &SourceRegistration,
        body_sha256: &str,
    ) -> Result<String> {
        if self.registration != *registration || self.body_sha256 != body_sha256 {
            return Err(NetworkError::new(ErrorCode::WrongScope));
        }
        Ok(self.origin_sha256)
    }
}
/// An existing response and optional concrete origin witness travel together.
/// Injected/offline transports can supply only an unattested response.
pub struct CustodiedInventoryResponse {
    response: InventoryResponse,
    origin: Option<InventoryOriginCustody>,
}
impl CustodiedInventoryResponse {
    pub fn unattested(response: InventoryResponse) -> Self {
        Self {
            response,
            origin: None,
        }
    }
    pub fn into_parts(self) -> (InventoryResponse, Option<InventoryOriginCustody>) {
        (self.response, self.origin)
    }
    fn verified(config: &NetworkHttpConfig, response: InventoryResponse) -> Self {
        let origin = (response.status == 200).then(|| InventoryOriginCustody {
            registration: config.source.clone(),
            origin_sha256: config.origin.custody_fingerprint(),
            body_sha256: format!("{:x}", Sha256::digest(&response.body)),
        });
        Self { response, origin }
    }
}

/// Server-owned existing-session material, never acquired or persisted here.
/// Header bytes are sensitive, private, bounded and limited to these two names.
pub struct ExistingNetworkSession {
    kind: SessionKind,
    value: HeaderValue,
}
enum SessionKind {
    Cookie,
    Authorization,
}
impl ExistingNetworkSession {
    pub fn cookie(value: &str) -> Result<Self> {
        Self::header(value).map(|value| Self {
            kind: SessionKind::Cookie,
            value,
        })
    }
    pub fn authorization(value: &str) -> Result<Self> {
        Self::header(value).map(|value| Self {
            kind: SessionKind::Authorization,
            value,
        })
    }
    fn header(value: &str) -> Result<HeaderValue> {
        guard(!value.is_empty() && value.len() <= 4096)?;
        let mut header = HeaderValue::from_str(value)
            .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?;
        header.set_sensitive(true);
        Ok(header)
    }
}
/// The lease is the original current-authority handle, distinct from SQLite's
/// cache epoch/fence. No permissive default, serialization or grant acquisition.
/// Callbacks must be bounded and nonblocking: no network/file I/O or unbounded
/// lock waits. Synchronous callbacks cannot be preempted by Tokio timers; the
/// transport checks its absolute deadline before and after each callback.
pub trait NetworkReadAuthority: Send + Sync {
    type Lease: Send + Sync;
    fn authorize_inventory(
        &self,
        source: &SourceRegistration,
        origin: &ReviewedNetworkOrigin,
    ) -> Result<Self::Lease>;
    fn revalidate_inventory(
        &self,
        lease: &Self::Lease,
        source: &SourceRegistration,
        origin: &ReviewedNetworkOrigin,
    ) -> Result<()>;
    fn existing_session(&self, lease: &Self::Lease) -> Result<Option<ExistingNetworkSession>>;
    fn authorize_generation(
        &self,
        lease: &Self::Lease,
        source: &SourceRegistration,
        generation: &NetworkGeneration,
    ) -> Result<()>;
}

#[derive(Clone)]
pub struct NetworkHttpConfig {
    source: SourceRegistration,
    origin: ReviewedNetworkOrigin,
    limits: Limits,
    connect_timeout: Duration,
    idle_timeout: Duration,
    extra_roots: Vec<reqwest::Certificate>,
}
impl NetworkHttpConfig {
    pub fn new(
        source: SourceRegistration,
        origin: ReviewedNetworkOrigin,
        limits: Limits,
        connect_timeout_ms: u64,
        idle_timeout_ms: u64,
    ) -> Result<Self> {
        validate_registration(&source)?;
        validate_limits(limits)?;
        guard(
            limits.max_response_bytes <= 10 * 1024 * 1024
                && limits.request_timeout_ms <= 60_000
                && connect_timeout_ms > 0
                && connect_timeout_ms <= limits.request_timeout_ms
                && idle_timeout_ms > 0
                && idle_timeout_ms <= limits.request_timeout_ms,
        )?;
        Ok(Self {
            source,
            origin,
            limits,
            connect_timeout: Duration::from_millis(connect_timeout_ms),
            idle_timeout: Duration::from_millis(idle_timeout_ms),
            extra_roots: Vec::new(),
        })
    }
    /// Extra verified trust roots are a reviewed host setting, not a TLS bypass.
    /// The configured Rustls verifier and certificate/hostname checks remain active.
    pub fn with_reviewed_ca_pem(mut self, pem: &[u8]) -> Result<Self> {
        guard(!pem.is_empty() && pem.len() <= 64 * 1024 && self.extra_roots.len() < 16)?;
        let cert = reqwest::Certificate::from_pem(pem)
            .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?;
        self.extra_roots.push(cert);
        Ok(self)
    }
    pub(crate) fn limits(&self) -> Limits {
        self.limits
    }
    pub fn source(&self) -> &SourceRegistration {
        &self.source
    }
    pub fn reviewed_origin(&self) -> &ReviewedNetworkOrigin {
        &self.origin
    }
}

pub struct HttpInventoryTransport<A: NetworkReadAuthority> {
    client: Client,
    config: NetworkHttpConfig,
    authority: Arc<A>,
    lease: Arc<A::Lease>,
    cancellation: CancellationToken,
}
impl<A: NetworkReadAuthority> HttpInventoryTransport<A> {
    /// Lease is captured once by the host before its storage prepare. Reuse that
    /// same lease across request, stream, generation validation and publication.
    pub fn new(
        config: NetworkHttpConfig,
        authority: Arc<A>,
        lease: Arc<A::Lease>,
        cancellation: CancellationToken,
    ) -> Result<Self> {
        let mut builder = Client::builder()
            .use_rustls_tls()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .http1_only()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .pool_max_idle_per_host(0)
            .connect_timeout(config.connect_timeout)
            .read_timeout(config.idle_timeout)
            .timeout(Duration::from_millis(config.limits.request_timeout_ms));
        for cert in &config.extra_roots {
            builder = builder.add_root_certificate(cert.clone());
        }
        let client = builder.build().map_err(transport_error)?;
        Ok(Self {
            client,
            config,
            authority,
            lease,
            cancellation,
        })
    }
    fn check_deadline(&self, deadline: Instant) -> Result<()> {
        if self.cancellation.is_cancelled() || Instant::now() >= deadline {
            return Err(NetworkError::new(ErrorCode::Timeout));
        }
        Ok(())
    }
    fn checked_authority<T>(
        &self,
        deadline: Instant,
        callback: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        self.check_deadline(deadline)?;
        let result = callback();
        self.check_deadline(deadline)?;
        result
    }
    fn revalidate(&self, deadline: Instant) -> Result<()> {
        self.checked_authority(deadline, || {
            self.authority.revalidate_inventory(
                &self.lease,
                &self.config.source,
                &self.config.origin,
            )
        })
    }
    async fn read_once(&self, limits: Limits, deadline: Instant) -> Result<InventoryResponse> {
        self.revalidate(deadline)?;
        let mut request = self
            .client
            .get(self.config.origin.endpoint.clone())
            .header(ACCEPT, "application/json")
            .header(ACCEPT_ENCODING, "identity")
            .timeout(Duration::from_millis(limits.request_timeout_ms));
        if let Some(session) =
            self.checked_authority(deadline, || self.authority.existing_session(&self.lease))?
        {
            request = match session.kind {
                SessionKind::Cookie => request.header(COOKIE, session.value),
                SessionKind::Authorization => request.header(AUTHORIZATION, session.value),
            };
        }
        let mut response = request.send().await.map_err(transport_error)?;
        self.revalidate(deadline)?;
        let status = response.status().as_u16();
        // An inventory authorization failure remains Auth even when a provider
        // supplies a login Location header. No redirect is followed.
        if matches!(status, 401 | 403) {
            return Err(NetworkError::new(ErrorCode::Auth));
        }
        if response.url() != &self.config.origin.endpoint
            || response.headers().contains_key(LOCATION)
            || response.status().is_redirection()
        {
            return Err(NetworkError::new(ErrorCode::Upstream));
        }
        if status != 200 {
            return Ok(self.response(status, Vec::new()));
        }
        let json = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(';')
                    .next()
                    .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
            });
        guard(json)?;
        guard(
            response
                .headers()
                .get(CONTENT_ENCODING)
                .is_none_or(|v| v == "identity"),
        )?;
        if response
            .content_length()
            .is_some_and(|n| n > limits.max_response_bytes as u64)
        {
            return Err(NetworkError::new(ErrorCode::SizeLimit));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
            self.revalidate(deadline)?;
            if chunk.len() > limits.max_response_bytes.saturating_sub(body.len()) {
                return Err(NetworkError::new(ErrorCode::SizeLimit));
            }
            body.extend_from_slice(&chunk);
        }
        self.revalidate(deadline)?;
        Ok(self.response(status, body))
    }
    fn response(&self, status: u16, body: Vec<u8>) -> InventoryResponse {
        InventoryResponse {
            status,
            source: Some(self.config.source.scope.clone()),
            body,
            source_snapshot_at: None,
            redirected: false,
            location: None,
            url: None,
        }
    }
}
impl<A: NetworkReadAuthority> InventoryTransport for HttpInventoryTransport<A> {
    fn get_inventory(
        &self,
        _request: InventoryGet,
        limits: Limits,
    ) -> Pin<Box<dyn Future<Output = Result<InventoryResponse>> + Send + '_>> {
        let response = self.get_inventory_with_custody(_request, limits);
        Box::pin(async move { Ok(response.await?.into_parts().0) })
    }
    fn get_inventory_with_custody(
        &self,
        _request: InventoryGet,
        limits: Limits,
    ) -> Pin<Box<dyn Future<Output = Result<CustodiedInventoryResponse>> + Send + '_>> {
        Box::pin(async move {
            validate_limits(limits)?;
            let limits = Limits {
                max_response_bytes: limits
                    .max_response_bytes
                    .min(self.config.limits.max_response_bytes),
                max_records: limits.max_records.min(self.config.limits.max_records),
                request_timeout_ms: limits
                    .request_timeout_ms
                    .min(self.config.limits.request_timeout_ms),
            };
            let deadline = Instant::now() + Duration::from_millis(limits.request_timeout_ms);
            let result = tokio::select! { biased;
                _ = self.cancellation.cancelled() => Err(NetworkError::new(ErrorCode::Timeout)),
                result = tokio::time::timeout_at(tokio::time::Instant::from_std(deadline), self.read_once(limits, deadline)) =>
                    result.map_err(|_| NetworkError::new(ErrorCode::Timeout))?,
            };
            // A timer cannot interrupt a synchronous callback in a poll. Reject
            // any result that finishes after the original absolute deadline.
            self.check_deadline(deadline)?;
            // The concrete client alone issues custody after successful TLS,
            // exact endpoint, full bounded body and final original authority
            // checks. Hashing is bounded and remains inside the same deadline.
            let response = CustodiedInventoryResponse::verified(&self.config, result?);
            self.check_deadline(deadline)?;
            Ok(response)
        })
    }
}
fn transport_error(error: reqwest::Error) -> NetworkError {
    NetworkError::new(if error.is_timeout() {
        ErrorCode::Timeout
    } else {
        ErrorCode::Transport
    })
}
