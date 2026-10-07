//! Canonical sanitized errors and private headers for every HTTP response.
use crate::{contracts as c, storage as s};
use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};

/// Initialized from OS randomness before serving. Request identifiers derive
/// from a private per-listener seed and sequence, without a fallible error-path
/// entropy call or a fabricated empty identifier. These IDs confer no authority.
pub(super) struct ResponseIds {
    seed: [u8; 32],
    sequence: AtomicU64,
}
impl ResponseIds {
    pub fn new() -> s::Result<Self> {
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed)
            .map_err(|_| s::Error::new("unavailable", "Randomness unavailable"))?;
        Ok(Self {
            seed,
            sequence: AtomicU64::new(0),
        })
    }
    pub fn next(&self) -> String {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let mut digest = Sha256::new();
        digest.update(self.seed);
        digest.update(sequence.to_be_bytes());
        let mut bytes = digest.finalize();
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        let h: String = bytes[..16].iter().map(|b| format!("{b:02x}")).collect();
        format!(
            "{}-{}-{}-{}-{}",
            &h[..8],
            &h[8..12],
            &h[12..16],
            &h[16..20],
            &h[20..]
        )
    }
}
#[derive(Clone)]
pub(super) struct HttpFailure {
    pub status: StatusCode,
    pub code: c::ApiErrorCode,
    pub current_revision: Option<u64>,
}
impl HttpFailure {
    pub fn for_status(status: StatusCode) -> Self {
        Self {
            status,
            code: match status {
                StatusCode::UNAUTHORIZED => c::ApiErrorCode::Unauthenticated,
                StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => c::ApiErrorCode::Forbidden,
                StatusCode::NOT_FOUND => c::ApiErrorCode::NotFound,
                StatusCode::METHOD_NOT_ALLOWED
                | StatusCode::BAD_REQUEST
                | StatusCode::PAYLOAD_TOO_LARGE
                | StatusCode::UNPROCESSABLE_ENTITY => c::ApiErrorCode::InvalidContract,
                _ => c::ApiErrorCode::UpstreamUnavailable,
            },
            current_revision: None,
        }
    }
    pub fn response(&self, request_id: String) -> Response {
        let message = match self.code {
            c::ApiErrorCode::Unauthenticated => "Authentication required",
            c::ApiErrorCode::Forbidden => "Request denied",
            c::ApiErrorCode::NotFound => "Resource unavailable",
            c::ApiErrorCode::InvalidContract => "Invalid request",
            c::ApiErrorCode::RevisionRequired => "Revision preconditions required",
            c::ApiErrorCode::RevisionConflict | c::ApiErrorCode::GuardConflict => {
                "Re-read and review the current record before retrying"
            }
            c::ApiErrorCode::IdentityConflict => "Identity conflict",
            c::ApiErrorCode::IdempotencyConflict => "Request identity conflict",
            c::ApiErrorCode::InvalidTransition => "Invalid transition",
            c::ApiErrorCode::UpstreamIncomplete => "Saved information incomplete",
            c::ApiErrorCode::UpstreamUnavailable => "Service unavailable",
        };
        (
            self.status,
            Json(c::ApiError {
                schema_version: c::ConstInt,
                code: self.code,
                message: message.into(),
                request_id,
                current_revision: self.current_revision.map(c::JsonInteger::from),
            }),
        )
            .into_response()
    }
}
impl IntoResponse for HttpFailure {
    fn into_response(self) -> Response {
        // The outer adapter assigns the server identifier and emits the body.
        let mut response = self.status.into_response();
        response.extensions_mut().insert(self);
        response
    }
}
pub(super) fn private_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        header::VARY,
        HeaderValue::from_static("Cookie, Origin, Sec-Fetch-Site"),
    );
}
