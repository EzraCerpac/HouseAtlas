use super::*;
use reqwest::{
    Client, Method, Request,
    header::{
        ACCEPT, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE,
    },
};
use tokio::time::timeout_at;
use tokio_util::sync::CancellationToken;

/// Built only by the configured dispatcher, after a genuine admission permit.
/// No mutable request/header/URL accessor is exported. Credentials are injected
/// immediately before sending; the original deadline cannot be renewed.
pub struct PreparedRequest {
    request: Request,
    permit: stock::InvocationPermit,
    plan: stock::NativePlan,
    authority: stock::StockAuthority,
    deadline: Instant,
    response_bound: usize,
    body_digest: stock::Digest,
}
impl PreparedRequest {
    pub fn body(&self) -> &[u8] {
        self.request
            .body()
            .and_then(reqwest::Body::as_bytes)
            .unwrap_or_default()
    }
    pub fn body_digest(&self) -> &stock::Digest {
        &self.body_digest
    }
    pub fn deadline(&self) -> Instant {
        self.deadline
    }
}

pub struct HttpDispatcher<P> {
    client: Client,
    endpoint: SourceEndpoint,
    resources: P,
    limits: Limits,
}
impl<P: DispatchResources> HttpDispatcher<P> {
    pub fn new(
        endpoint: SourceEndpoint,
        resources: P,
        limits: Limits,
    ) -> Result<Self, TransportFault> {
        let limits = limits.validate()?;
        let client = Self::client_builder(&endpoint, limits)
            .build()
            .map_err(|_| TransportFault::Configuration)?;
        Ok(Self {
            client,
            endpoint,
            resources,
            limits,
        })
    }

    fn client_builder(endpoint: &SourceEndpoint, limits: Limits) -> reqwest::ClientBuilder {
        Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .http1_only()
            .http1_max_headers(64)
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .https_only(!endpoint.fixture)
            .connect_timeout(limits.timeout)
            .timeout(limits.timeout)
            .read_timeout(limits.timeout)
            .pool_max_idle_per_host(0)
    }

    /// A test-only trust root for an actual authenticated HTTPS loopback peer.
    #[cfg(test)]
    pub(crate) fn new_with_loopback_certificate(
        endpoint: SourceEndpoint,
        resources: P,
        limits: Limits,
        certificate_der: &[u8],
    ) -> Result<Self, TransportFault> {
        let limits = limits.validate()?;
        let loopback = match endpoint.origin.host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if endpoint.fixture || endpoint.origin.scheme() != "https" || !loopback {
            return Err(TransportFault::Configuration);
        }
        let certificate = reqwest::Certificate::from_der(certificate_der)
            .map_err(|_| TransportFault::Configuration)?;
        let client = Self::client_builder(&endpoint, limits)
            .tls_certs_only([certificate])
            .build()
            .map_err(|_| TransportFault::Configuration)?;
        Ok(Self {
            client,
            endpoint,
            resources,
            limits,
        })
    }

    pub async fn prepare(
        &self,
        permit: &stock::InvocationPermit,
        plan: &stock::NativePlan,
        authority: &stock::StockAuthority,
        deadline: Instant,
        cancel: &CancellationToken,
    ) -> Result<PreparedRequest, TransportFault> {
        let deadline = deadline.min(Instant::now() + self.limits.timeout);
        ready(deadline, cancel)?;
        self.endpoint.check(permit, plan, authority)?;
        routes::check(plan)?;
        let response_bound = plan
            .max_response_bytes
            .map_or(self.limits.max_response_bytes, |n| {
                usize::try_from(n)
                    .unwrap_or(usize::MAX)
                    .min(self.limits.max_response_bytes)
            });
        if response_bound == 0 {
            return Err(TransportFault::ResponseBound);
        }
        let upload = if let stock::NativeBody::Multipart { stage, .. } = &plan.request.body {
            if stage.upload_token.is_nil()
                || stage.byte_size == 0
                || stage.byte_size > self.limits.max_request_bytes as u64
            {
                return Err(TransportFault::Stage);
            }
            Some(
                bounded(
                    deadline,
                    cancel,
                    self.resources.staged_bytes(
                        permit,
                        stage,
                        self.limits.max_request_bytes,
                        deadline,
                    ),
                )
                .await?,
            )
        } else {
            None
        };
        let (bytes, content_type) = body::encode(
            &plan.request.body,
            upload,
            permit.operation_id,
            self.limits.max_request_bytes,
        )?;
        let body_digest = body::digest(&bytes);
        let mut url = self.endpoint.origin.clone();
        url.set_path(&plan.request.path);
        if !plan.request.query.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(plan.request.query.iter().map(|(k, v)| (k, v)));
        }
        if url.origin() != self.endpoint.origin.origin() || url.path() != plan.request.path {
            return Err(TransportFault::Route);
        }
        let method = match plan.request.method {
            stock::NativeMethod::Get => Method::GET,
            stock::NativeMethod::Post => Method::POST,
            stock::NativeMethod::Put => Method::PUT,
            stock::NativeMethod::Patch => Method::PATCH,
            stock::NativeMethod::Delete => Method::DELETE,
        };
        let mut builder = self
            .client
            .request(method, url)
            .header("X-Tenant", self.endpoint.binding.collection_id.to_string())
            .header(ACCEPT_ENCODING, "identity")
            .header(
                ACCEPT,
                if plan.response == stock::ResponseKind::Printer {
                    "text/plain"
                } else {
                    "application/json"
                },
            );
        if let Some(content_type) = content_type {
            builder = builder.header(CONTENT_TYPE, content_type);
        }
        // Keep GET/DELETE/bodyless action requests bodyless. Every other request
        // uses precisely the prepared body, without reqwest json/multipart APIs.
        if !matches!(plan.request.body, stock::NativeBody::None) {
            builder = builder.header(CONTENT_LENGTH, bytes.len()).body(bytes);
        }
        let request = builder.build().map_err(|_| TransportFault::Route)?;
        ready(deadline, cancel)?;
        Ok(PreparedRequest {
            request,
            permit: permit.clone(),
            plan: plan.clone(),
            authority: authority.clone(),
            deadline,
            response_bound,
            body_digest,
        })
    }

    /// Sending consumes the preparation. There is no automatic retry/resend.
    /// Dropping this future supplies no report/proof; the durable owner's already
    /// admitted dispatch intent remains held. This method starts no detached task.
    pub async fn send(
        &self,
        prepared: PreparedRequest,
        cancel: &CancellationToken,
    ) -> DispatchReport {
        let PreparedRequest {
            mut request,
            permit,
            plan,
            authority,
            deadline,
            response_bound,
            body_digest,
        } = prepared;
        let mut evidence = TransportEvidence {
            operation_id: permit.operation_id,
            plan_digest: permit.plan_digest.clone(),
            activity: PhysicalActivity::NotStarted,
            request_body_digest: Some(body_digest.clone()),
            request_body_bytes: request
                .body()
                .and_then(reqwest::Body::as_bytes)
                .map_or(0, <[u8]>::len),
            response_status: None,
            response_bytes_observed: 0,
            response_body_digest: None,
            fault: None,
        };
        let result = async {
            ready(deadline, cancel)?;
            self.endpoint.check(&permit, &plan, &authority)?;
            // A prepared value from a different dispatcher cannot override this
            // instance's origin or configured bounds, even for the same source.
            if request.url().origin() != self.endpoint.origin.origin()
                || request
                    .body()
                    .and_then(reqwest::Body::as_bytes)
                    .map_or(0, <[u8]>::len)
                    > self.limits.max_request_bytes
                || response_bound > self.limits.max_response_bytes
            {
                return Err(TransportFault::Binding);
            }
            let authorization = self
                .resources
                .authorization(&self.endpoint, &permit, &plan, &authority, deadline)
                .await?;
            if let Some(header) = authorization {
                request.headers_mut().insert(AUTHORIZATION, header.0);
            } else if !self.endpoint.fixture {
                return Err(TransportFault::Resources);
            }
            ready(deadline, cancel)?;
            // No native I/O can precede this boundary. From this point all errors
            // are conservatively invoked, including connect/TLS/lost replies.
            evidence.activity = PhysicalActivity::MayHaveStarted;
            let mut response = self.client.execute(request).await.map_err(network_fault)?;
            evidence.activity = PhysicalActivity::ResponseReceived;
            evidence.response_status = Some(response.status().as_u16());
            if response.url().origin() != self.endpoint.origin.origin() {
                return Err(TransportFault::Binding);
            }
            if response.status().is_redirection() {
                return Err(TransportFault::Redirect);
            }
            if response
                .headers()
                .get(CONTENT_ENCODING)
                .is_some_and(|h| h.as_bytes() != b"identity")
            {
                return Err(TransportFault::ResponseEncoding);
            }
            if response
                .content_length()
                .is_some_and(|n| n > response_bound as u64)
            {
                return Err(TransportFault::ResponseBound);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(network_fault)? {
                evidence.response_bytes_observed = evidence
                    .response_bytes_observed
                    .saturating_add(chunk.len() as u64);
                if chunk.len() > response_bound - bytes.len() {
                    return Err(TransportFault::ResponseBound);
                }
                bytes.extend_from_slice(&chunk);
                ready(deadline, cancel)?;
            }
            ready(deadline, cancel)?;
            let digest = body::digest(&bytes);
            evidence.response_body_digest = Some(digest.clone());
            let value = if response.status().as_u16() == plan.success_status {
                match plan.response {
                    stock::ResponseKind::NoContent if bytes.is_empty() => serde_json::Value::Null,
                    stock::ResponseKind::NoContent => return Err(TransportFault::ResponseFormat),
                    // Pinned v1_ctrl_labelmaker.go returns these exact bytes
                    // after PrintLabel succeeds. It does not set a media type.
                    // Retain the actual text digest, without claiming physical
                    // printer acknowledgement or remote termination proof.
                    stock::ResponseKind::Printer if bytes == b"Printed!" => serde_json::Value::Null,
                    stock::ResponseKind::Printer => return Err(TransportFault::ResponseFormat),
                    _ => {
                        let value = body::json(&bytes)?;
                        if !value.is_object() {
                            return Err(TransportFault::ResponseFormat);
                        }
                        value
                    }
                }
            } else {
                // Retain an actual bounded JSON error response, never fabricate
                // success JSON for unexpected status or binary/error bodies.
                body::json(&bytes)?
            };
            ready(deadline, cancel)?;
            Ok(stock::NativeResponse {
                status: response.status().as_u16(),
                value,
                body_digest: digest,
            })
        };
        let response = match bounded(deadline, cancel, result).await {
            Ok(response) => Some(response),
            Err(fault) => {
                evidence.fault = Some(fault);
                None
            }
        };
        let dispatch = if evidence.activity == PhysicalActivity::NotStarted {
            stock::NativeDispatch::NeverInvoked
        } else {
            stock::NativeDispatch::Invoked(stock::DispatchReceipt {
                operation_id: permit.operation_id,
                plan_digest: permit.plan_digest,
                context: self.endpoint.binding.context.clone(),
                source_instance_id: self.endpoint.binding.source_instance_id,
                collection_id: self.endpoint.binding.collection_id,
                response,
                remote_activity: stock::RemoteActivity::end_unproven(),
            })
        };
        DispatchReport { dispatch, evidence }
    }

    pub async fn dispatch_until(
        &self,
        permit: &stock::InvocationPermit,
        plan: &stock::NativePlan,
        authority: &stock::StockAuthority,
        deadline: Instant,
        cancel: &CancellationToken,
    ) -> DispatchReport {
        match self
            .prepare(permit, plan, authority, deadline, cancel)
            .await
        {
            Ok(prepared) => self.send(prepared, cancel).await,
            Err(fault) => DispatchReport {
                dispatch: stock::NativeDispatch::NeverInvoked,
                evidence: TransportEvidence {
                    operation_id: permit.operation_id,
                    plan_digest: permit.plan_digest.clone(),
                    activity: PhysicalActivity::NotStarted,
                    request_body_digest: None,
                    request_body_bytes: 0,
                    response_status: None,
                    response_bytes_observed: 0,
                    response_body_digest: None,
                    fault: Some(fault),
                },
            },
        }
    }
}

impl<P: DispatchResources> stock::StockDispatchPort for HttpDispatcher<P> {
    async fn dispatch(
        &self,
        permit: &stock::InvocationPermit,
        plan: &stock::NativePlan,
        authority: &stock::StockAuthority,
    ) -> stock::NativeDispatch {
        self.dispatch_until(
            permit,
            plan,
            authority,
            Instant::now() + self.limits.timeout,
            &CancellationToken::new(),
        )
        .await
        .dispatch
    }
}

fn ready(deadline: Instant, cancel: &CancellationToken) -> Result<(), TransportFault> {
    if cancel.is_cancelled() {
        Err(TransportFault::Cancelled)
    } else if Instant::now() >= deadline {
        Err(TransportFault::Deadline)
    } else {
        Ok(())
    }
}
async fn bounded<T>(
    deadline: Instant,
    cancel: &CancellationToken,
    future: impl std::future::Future<Output = Result<T, TransportFault>>,
) -> Result<T, TransportFault> {
    ready(deadline, cancel)?;
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(TransportFault::Cancelled),
        result = timeout_at(deadline, future) => result.map_err(|_| TransportFault::Deadline)?,
    }
}
fn network_fault(error: reqwest::Error) -> TransportFault {
    if error.is_timeout() {
        TransportFault::Deadline
    } else {
        TransportFault::Network
    }
}
