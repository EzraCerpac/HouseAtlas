//! Sanitized wire3 transport errors; no automatic retry or invented operation.
use crate::domain::{DomainError, stock::StockError};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

#[derive(Clone)]
pub(super) struct StockResponse;

pub(super) fn wire(error: StockError, request_id: &str) -> Value {
    let (code, message, retry, _) = classify(error);
    json!({"schemaVersion":3,"requestId":request_id,"code":code,"message":message,"retry":retry,"operationId":null})
}
fn classify(error: StockError) -> (&'static str, &'static str, &'static str, StatusCode) {
    use StatusCode as S;
    match error {
        StockError::InvalidContract => (
            "INVALID_ARGUMENT",
            "Invalid request",
            "none",
            S::UNPROCESSABLE_ENTITY,
        ),
        StockError::AuthorityChanged | StockError::CapabilityDenied => {
            ("CAPABILITY_DENIED", "Request denied", "none", S::FORBIDDEN)
        }
        StockError::CapabilityHeld | StockError::ForbiddenAppendOnly => (
            "capability-held",
            "Operation is held",
            "none",
            S::SERVICE_UNAVAILABLE,
        ),
        StockError::UnsupportedCapability => (
            "unsupported-capability",
            "Operation is unavailable",
            "none",
            S::SERVICE_UNAVAILABLE,
        ),
        StockError::Domain(DomainError::Unauthenticated) => (
            "UNAUTHENTICATED",
            "Authentication required",
            "none",
            S::UNAUTHORIZED,
        ),
        StockError::Domain(DomainError::Forbidden) => {
            ("CAPABILITY_DENIED", "Request denied", "none", S::FORBIDDEN)
        }
        StockError::Domain(DomainError::NotFound) => (
            "RESOURCE_UNAVAILABLE",
            "Resource unavailable",
            "none",
            S::NOT_FOUND,
        ),
        StockError::Domain(DomainError::InvalidContract) => (
            "INVALID_ARGUMENT",
            "Invalid request",
            "none",
            S::UNPROCESSABLE_ENTITY,
        ),
        StockError::Domain(DomainError::RevisionRequired { .. }) => (
            "PRECONDITION_REQUIRED",
            "Revision preconditions required",
            "refresh-and-review",
            S::PRECONDITION_REQUIRED,
        ),
        StockError::Domain(
            DomainError::RevisionConflict { .. } | DomainError::GuardConflict { .. },
        ) => (
            "CONFLICT",
            "Re-read and review before retrying",
            "refresh-and-review",
            S::PRECONDITION_FAILED,
        ),
        StockError::Domain(DomainError::IdempotencyConflict) => (
            "IDEMPOTENCY_MISMATCH",
            "Request identity conflict",
            "none",
            S::CONFLICT,
        ),
        StockError::Domain(DomainError::IdentityConflict | DomainError::InvalidTransition) => (
            "CONFLICT",
            "Record conflict",
            "refresh-and-review",
            S::CONFLICT,
        ),
        StockError::Domain(DomainError::UpstreamIncomplete | DomainError::UpstreamUnavailable)
        | StockError::OwnerUnavailable => (
            "SOURCE_UNAVAILABLE",
            "Service unavailable",
            "none",
            S::SERVICE_UNAVAILABLE,
        ),
        _ => (
            "INTERNAL_ERROR",
            "Service unavailable",
            "none",
            S::SERVICE_UNAVAILABLE,
        ),
    }
}
pub(super) fn response(error: StockError, request_id: &str) -> super::super::HttpResult {
    let (_, _, _, status) = classify(error);
    let body = wire(error, request_id);
    crate::contracts::stock::StockValidation::new()
        .and_then(|c| c.validate("#/$defs/stockError", &body))
        .map_err(|_| super::super::failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let mut response: Response = (status, Json(body)).into_response();
    response.extensions_mut().insert(StockResponse);
    Ok(response)
}
