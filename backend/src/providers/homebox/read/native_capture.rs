//! Original bounded GET observations, without completeness or write authority.
use super::{ErrorCode, Limits, ReadError, SourceScope, Timestamp, Uuid};
use crate::providers::homebox::wire::{self, DecodeLimits, WireError};
use serde_json::Value;

/// Constructed only by the registered reader after its bounded fixed GET and
/// native decoder succeed. Bytes may contain private inventory; keep captures
/// private. This does not qualify the installed build, credential, freshness,
/// hidden PUT fields, attachment version, source custody or write admission.
pub struct NativeCapture<T> {
    scope: SourceScope,
    entity_id: Uuid,
    path: String,
    query: Vec<(String, String)>,
    status: u16,
    retrieved_at: Timestamp,
    decoded: wire::Decoded<T>,
}

pub type CapturedStockEntity = NativeCapture<wire::Detail>;
pub type CapturedStockMaintenance = NativeCapture<wire::MaintenanceLog>;

impl<T> NativeCapture<T> {
    pub(super) fn new(
        scope: SourceScope,
        entity_id: Uuid,
        path: String,
        query: Vec<(String, String)>,
        status: u16,
        retrieved_at: Timestamp,
        decoded: wire::Decoded<T>,
    ) -> Self {
        Self {
            scope,
            entity_id,
            path,
            query,
            status,
            retrieved_at,
            decoded,
        }
    }

    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub fn entity_id(&self) -> &Uuid {
        &self.entity_id
    }
    pub fn method(&self) -> &'static str {
        "GET"
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn status(&self) -> u16 {
        self.status
    }
    /// Host clock observation after the complete bounded response body.
    pub fn retrieved_at(&self) -> &Timestamp {
        &self.retrieved_at
    }
    pub fn original_bytes(&self) -> &[u8] {
        &self.decoded.original
    }
    pub fn source_json(&self) -> &Value {
        &self.decoded.source
    }
    pub fn decoded(&self) -> &T {
        &self.decoded.value
    }
}

pub(super) fn decode_limits(limits: Limits) -> DecodeLimits {
    DecodeLimits {
        max_response_bytes: limits.max_response_bytes,
        max_entries: limits.max_pages * limits.max_page_size,
        max_text_chars: 16_384,
    }
}

pub(super) fn read_error(error: WireError) -> ReadError {
    ReadError(match error {
        WireError::Invalid => ErrorCode::InvalidSchema,
        WireError::Limit => ErrorCode::SizeLimit,
        WireError::WrongEntity => ErrorCode::WrongScope,
        WireError::Pagination => ErrorCode::Pagination,
    })
}
