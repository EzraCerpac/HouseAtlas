//! Configured GET transport. Credentials and source approval remain host-owned.
use super::error::invalid;
use super::*;
use reqwest::{
    Client, Response,
    header::{ACCEPT, ACCEPT_ENCODING, AUTHORIZATION, HeaderValue},
};
use std::{future::Future, time::Duration};
use tokio::time::{Instant, timeout_at};
use url::Url;

/// Server-reviewed configuration, never an origin or tenant supplied by a browser.
/// This configuration receipt does not prove a provider's tenant enforcement.
pub struct SourceEndpoint {
    origin: Url,
    scope: SourceScope,
    fixture: bool,
}
impl SourceEndpoint {
    pub fn https(origin: &str, scope: SourceScope) -> Result<Self, ReadError> {
        let endpoint = Self::parse(origin, scope, false)?;
        if endpoint.origin.scheme() != "https" {
            return Err(invalid());
        }
        Ok(endpoint)
    }
    fn parse(origin: &str, scope: SourceScope, fixture: bool) -> Result<Self, ReadError> {
        fluent_uri::Uri::parse(origin).map_err(|_| invalid())?;
        let origin = Url::parse(origin).map_err(|_| invalid())?;
        if !matches!(origin.scheme(), "http" | "https")
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err(invalid());
        }
        super::types::text(&scope.collection_id, 1, 4096)?;
        HeaderValue::from_bytes(scope.collection_id.as_bytes()).map_err(|_| invalid())?;
        Ok(Self {
            origin,
            scope,
            fixture,
        })
    }
    pub fn origin(&self) -> &Url {
        &self.origin
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    #[cfg(test)]
    pub(super) fn loopback_fixture(origin: &str, scope: SourceScope) -> Result<Self, ReadError> {
        let endpoint = Self::parse(origin, scope, true)?;
        let loopback = match endpoint.origin.host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if !loopback || endpoint.origin.scheme() != "http" {
            return Err(invalid());
        }
        Ok(endpoint)
    }
}

/// Opaque, transient header. No Debug/Serialize/accessor exposes its contents.
pub struct AuthorizationHeader(HeaderValue);
impl AuthorizationHeader {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ReadError> {
        let mut value = HeaderValue::from_bytes(bytes).map_err(|_| ReadError(ErrorCode::Auth))?;
        if value.is_empty() {
            return Err(ReadError(ErrorCode::Auth));
        }
        value.set_sensitive(true);
        Ok(Self(value))
    }
}
/// The host checks current original grants and configured origin/scope before
/// returning a header. It must cancel pending work when this future is dropped.
/// None is accepted only by the test-only credential-free loopback endpoint.
pub trait CredentialProvider: Send {
    fn read_authorization(
        &mut self,
        endpoint: &SourceEndpoint,
        deadline: Instant,
    ) -> impl Future<Output = Result<Option<AuthorizationHeader>, ReadError>> + Send;
}

pub struct HttpTransport<P> {
    client: Client,
    endpoint: SourceEndpoint,
    credentials: P,
    limits: Limits,
}
impl<P: CredentialProvider> HttpTransport<P> {
    pub fn new(
        endpoint: SourceEndpoint,
        credentials: P,
        limits: Limits,
    ) -> Result<Self, ReadError> {
        limits.validate()?;
        let client = Self::client_builder(&endpoint, limits)
            .build()
            .map_err(|_| ReadError(ErrorCode::Transport))?;
        Ok(Self {
            client,
            endpoint,
            credentials,
            limits,
        })
    }

    fn client_builder(endpoint: &SourceEndpoint, limits: Limits) -> reqwest::ClientBuilder {
        Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .https_only(!endpoint.fixture)
            .timeout(Duration::from_millis(limits.request_timeout_ms))
            .connect_timeout(Duration::from_millis(limits.request_timeout_ms))
            .read_timeout(Duration::from_millis(limits.request_timeout_ms))
            .pool_max_idle_per_host(0)
    }

    /// A test-only trust root for an actual authenticated HTTPS loopback peer.
    #[cfg(test)]
    pub(crate) fn new_with_loopback_certificate(
        endpoint: SourceEndpoint,
        credentials: P,
        limits: Limits,
        certificate_der: &[u8],
    ) -> Result<Self, ReadError> {
        limits.validate()?;
        let loopback = match endpoint.origin.host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if endpoint.fixture || endpoint.origin.scheme() != "https" || !loopback {
            return Err(invalid());
        }
        let certificate = reqwest::Certificate::from_der(certificate_der)
            .map_err(|_| ReadError(ErrorCode::Transport))?;
        let client = Self::client_builder(&endpoint, limits)
            .tls_certs_only([certificate])
            .build()
            .map_err(|_| ReadError(ErrorCode::Transport))?;
        Ok(Self {
            client,
            endpoint,
            credentials,
            limits,
        })
    }
}
pub struct HttpBody {
    response: Option<Response>,
    deadline: Instant,
    received: usize,
    limit: usize,
}
impl Body for HttpBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, ReadError> {
        let Some(response) = self.response.as_mut() else {
            return Ok(None);
        };
        let result = timeout_at(self.deadline, response.chunk()).await;
        let chunk = match result {
            Ok(Ok(chunk)) if Instant::now() < self.deadline => chunk,
            Ok(Err(e)) => {
                self.response.take();
                return Err(network_error(e));
            }
            _ => {
                self.response.take();
                return Err(ReadError(ErrorCode::Timeout));
            }
        };
        match chunk {
            Some(chunk) => {
                self.received = self
                    .received
                    .checked_add(chunk.len())
                    .ok_or(ReadError(ErrorCode::SizeLimit))?;
                if self.received > self.limit {
                    self.response.take();
                    return Err(ReadError(ErrorCode::SizeLimit));
                }
                Ok(Some(chunk.to_vec()))
            }
            None => {
                self.response.take();
                Ok(None)
            }
        }
    }
}
impl<P: CredentialProvider> Transport for HttpTransport<P> {
    type Body = HttpBody;
    async fn get(&mut self, request: GetRequest) -> Result<GetResponse<HttpBody>, ReadError> {
        if request.scope() != self.endpoint.scope()
            || request.tenant() != self.endpoint.scope.collection_id
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        if !stock_path(request.path()) {
            return Err(ReadError(ErrorCode::Transport));
        }
        let deadline = request
            .deadline()
            .min(Instant::now() + Duration::from_millis(self.limits.request_timeout_ms));
        let operation = async {
            let header = self
                .credentials
                .read_authorization(&self.endpoint, deadline)
                .await?;
            if header.is_none() && !self.endpoint.fixture {
                return Err(ReadError(ErrorCode::Auth));
            }
            let mut url = self.endpoint.origin.clone();
            url.set_path(request.path());
            if !request.query().is_empty() {
                url.query_pairs_mut()
                    .extend_pairs(request.query().iter().map(|(k, v)| (k, v)));
            }
            let mut builder = self
                .client
                .get(url)
                .header(
                    "X-Tenant",
                    HeaderValue::from_bytes(request.tenant().as_bytes()).map_err(|_| invalid())?,
                )
                .header(ACCEPT, "application/json")
                .header(ACCEPT_ENCODING, "identity");
            if let Some(header) = header {
                builder = builder.header(AUTHORIZATION, header.0);
            }
            let response = builder.send().await.map_err(network_error)?;
            if response.url().origin() != self.endpoint.origin.origin() {
                return Err(ReadError(ErrorCode::WrongScope));
            }
            if response
                .content_length()
                .is_some_and(|n| n > self.limits.max_response_bytes as u64)
            {
                return Err(ReadError(ErrorCode::SizeLimit));
            }
            let status = response.status().as_u16();
            if Instant::now() >= deadline {
                return Err(ReadError(ErrorCode::Timeout));
            }
            Ok(GetResponse {
                status,
                scope: self.endpoint.scope.clone(),
                redirected: false,
                body: HttpBody {
                    response: Some(response),
                    deadline,
                    received: 0,
                    limit: self.limits.max_response_bytes,
                },
            })
        };
        timeout_at(deadline, operation)
            .await
            .map_err(|_| ReadError(ErrorCode::Timeout))?
    }
}
fn network_error(error: reqwest::Error) -> ReadError {
    ReadError(if error.is_timeout() {
        ErrorCode::Timeout
    } else {
        ErrorCode::Transport
    })
}
fn stock_path(path: &str) -> bool {
    if path == "/api/v1/entities" {
        return true;
    }
    let Some(tail) = path.strip_prefix("/api/v1/entities/") else {
        return false;
    };
    let id = tail.strip_suffix("/maintenance").unwrap_or(tail);
    Uuid::parse(id).is_ok_and(|uuid| uuid.as_str() == id)
}
