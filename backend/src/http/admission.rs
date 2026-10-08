//! Bounded HTTP work and streamed intake before blocking access/storage work.
use super::{CheckedHeaders, HttpFailure, failure};
use crate::access::{AccessError, AccessResult};
use axum::{
    body::{Body, Bytes, to_bytes},
    http::{Method, StatusCode},
};
use std::{
    collections::BTreeMap,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub(super) type Permit = Arc<OwnedSemaphorePermit>;
const BODY_DEADLINE: Duration = Duration::from_secs(10);
const GLOBAL_WINDOW: Duration = Duration::from_secs(60);
const CLIENT_WINDOW: Duration = Duration::from_secs(300);
const MAX_CLIENT_BUCKETS: usize = 1024;

struct Window {
    start: Instant,
    count: u32,
}
impl Window {
    fn new(now: Instant) -> Self {
        Self {
            start: now,
            count: 0,
        }
    }
}
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum LoginClient {
    Ip(IpAddr),
    Gateway,
}
struct LoginRates {
    global: Window,
    clients: BTreeMap<LoginClient, Window>,
}
pub(super) struct Admission {
    slots: Arc<Semaphore>,
    logins: Mutex<LoginRates>,
}
impl Default for Admission {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(64)),
            logins: Mutex::new(LoginRates {
                global: Window::new(Instant::now()),
                clients: BTreeMap::new(),
            }),
        }
    }
}
impl Admission {
    pub(super) fn admit(&self) -> Result<Permit, HttpFailure> {
        self.slots
            .clone()
            .try_acquire_owned()
            .map(Arc::new)
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))
    }

    /// Transport admission, before reading any password/body bytes. AT11 still
    /// performs its actual persisted global/client/username checks at login.
    /// This bounded process-local gate does not mint a login/session capability.
    pub(super) fn login(
        &self,
        headers: &CheckedHeaders,
        method: &Method,
        origin: &str,
        client: IpAddr,
    ) -> AccessResult<()> {
        self.login_key(headers, method, origin, LoginClient::Ip(client))
    }
    pub(super) fn login_gateway(
        &self,
        headers: &CheckedHeaders,
        method: &Method,
        origin: &str,
    ) -> AccessResult<()> {
        if headers.gateway.is_none() {
            return Err(AccessError::Forbidden);
        }
        self.login_key(headers, method, origin, LoginClient::Gateway)
    }
    fn login_key(
        &self,
        headers: &CheckedHeaders,
        method: &Method,
        origin: &str,
        client: LoginClient,
    ) -> AccessResult<()> {
        if method != Method::POST {
            return Err(AccessError::MethodNotAllowed);
        }
        if headers.origin.as_deref() != Some(origin)
            || headers
                .sec_fetch_site
                .as_deref()
                .is_some_and(|site| site != "same-origin")
        {
            return Err(AccessError::Forbidden);
        }
        let now = Instant::now();
        let mut rates = self.logins.lock().map_err(|_| AccessError::Unavailable)?;
        if now.duration_since(rates.global.start) >= GLOBAL_WINDOW {
            rates.global = Window::new(now);
        }
        rates
            .clients
            .retain(|_, window| now.duration_since(window.start) < CLIENT_WINDOW);
        if rates.global.count >= 60
            || rates.clients.get(&client).is_some_and(|w| w.count >= 10)
            || !rates.clients.contains_key(&client) && rates.clients.len() >= MAX_CLIENT_BUCKETS
        {
            return Err(AccessError::RateLimited);
        }
        rates.global.count += 1;
        rates
            .clients
            .entry(client)
            .or_insert_with(|| Window::new(now))
            .count += 1;
        Ok(())
    }
}

pub(super) async fn body(body: Body, limit: usize) -> Result<Bytes, HttpFailure> {
    tokio::time::timeout(BODY_DEADLINE, to_bytes(body, limit))
        .await
        .map_err(|_| failure(StatusCode::REQUEST_TIMEOUT))?
        .map_err(|_| failure(StatusCode::PAYLOAD_TOO_LARGE))
}
