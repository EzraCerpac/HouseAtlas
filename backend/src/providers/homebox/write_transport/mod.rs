//! Bounded one-attempt HTTP dispatch for the accepted stock writer.
//! No durable admission, authority grant, readback or remote-end proof lives here.
mod body;
mod endpoint;
mod http;
mod routes;

pub use endpoint::{DispatchBinding, SourceEndpoint};
pub use http::{HttpDispatcher, PreparedRequest};

use crate::providers::homebox::write::stock;
use reqwest::header::HeaderValue;
use std::{future::Future, time::Duration};
use tokio::time::Instant;

/// Explicit host bounds; these are not qualified provider profile settings.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_request_bytes: usize,
    pub max_response_bytes: usize,
    pub timeout: Duration,
}
impl Limits {
    fn validate(self) -> Result<Self, TransportFault> {
        if self.max_request_bytes == 0
            || self.max_response_bytes == 0
            || self.max_request_bytes > 64 * 1024 * 1024
            || self.max_response_bytes > 64 * 1024 * 1024
            || self.timeout.is_zero()
            || self.timeout > Duration::from_secs(300)
        {
            return Err(TransportFault::Configuration);
        }
        Ok(self)
    }
}

/// Sensitive transient header: deliberately no Debug, Serialize or getter.
pub struct AuthorizationHeader(pub(crate) HeaderValue);
impl AuthorizationHeader {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, TransportFault> {
        let mut header = HeaderValue::from_bytes(bytes).map_err(|_| TransportFault::Resources)?;
        if header.is_empty() {
            return Err(TransportFault::Resources);
        }
        header.set_sensitive(true);
        Ok(Self(header))
    }
}

/// Host-owned original authority/registry revalidation and credential injection.
/// The transport checks binding equality, not permission/approval/queue policy.
/// Revalidate the captured grant, current source/dispatcher epochs and exact
/// registered catalogue/build/route before returning authorization. Never obtain
/// new grants, use environment credentials, or substitute renewed authority.
/// Both futures must stop local work on drop and honor the absolute deadline.
pub trait DispatchResources: Send + Sync {
    fn authorization(
        &self,
        endpoint: &SourceEndpoint,
        permit: &stock::InvocationPermit,
        plan: &stock::NativePlan,
        authority: &stock::StockAuthority,
        deadline: Instant,
    ) -> impl Future<Output = Result<Option<AuthorizationHeader>, TransportFault>> + Send;

    /// Called only with an admitted permit, never during waiting/preflight.
    /// Load exact privately retained bytes within max_bytes. Admission/liability
    /// and stage ownership stay with the host. None fails before native I/O.
    fn staged_bytes(
        &self,
        permit: &stock::InvocationPermit,
        stage: &stock::StagedUpload,
        max_bytes: usize,
        deadline: Instant,
    ) -> impl Future<Output = Result<Vec<u8>, TransportFault>> + Send;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportFault {
    Configuration,
    Binding,
    Route,
    RequestBound,
    Stage,
    Resources,
    Deadline,
    Cancelled,
    Network,
    Redirect,
    ResponseBound,
    ResponseEncoding,
    ResponseFormat,
}

/// Conservative local observations; none establishes physical remote end.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PhysicalActivity {
    NotStarted,
    /// reqwest execution was polled; bytes may have reached the provider.
    MayHaveStarted,
    /// Actual response headers arrived, even if the body was later unavailable.
    ResponseReceived,
}

/// Contains only correlated IDs/digests/counts/categories, never secrets/bodies.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportEvidence {
    pub operation_id: uuid::Uuid,
    pub plan_digest: stock::Digest,
    pub activity: PhysicalActivity,
    pub request_body_digest: Option<stock::Digest>,
    pub request_body_bytes: usize,
    pub response_status: Option<u16>,
    /// Bytes observed, including a chunk which exceeds the configured bound.
    pub response_bytes_observed: u64,
    /// SHA256 of complete identity-encoded bytes, not a JSON reserialization.
    pub response_body_digest: Option<stock::Digest>,
    pub fault: Option<TransportFault>,
}
pub struct DispatchReport {
    pub dispatch: stock::NativeDispatch,
    pub evidence: TransportEvidence,
}

#[cfg(test)]
mod healthy;
