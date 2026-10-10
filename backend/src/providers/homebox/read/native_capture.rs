//! Original bounded GET observations, without completeness or write authority.
use super::{ErrorCode, Limits, ReadError, SourceScope, Timestamp, Uuid};
use crate::providers::homebox::wire::{self, DecodeLimits, WireError};
use crate::providers::homebox::write::stock::{
    Context, FreshNativeCapture, ResourceKind, StockErrorCode, StockTarget,
};
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

/// Complete bounded response to the reader's fixed owner GET, retained before
/// status, scope, schema and parent checks. Observation alone issues no proof.
pub struct CapturedStockEntityObservation {
    facts: NativeEntityObservationFacts,
    original: Vec<u8>,
}
pub(super) struct NativeEntityObservationFacts {
    pub(super) scope: SourceScope,
    pub(super) expected_scope: SourceScope,
    pub(super) entity_id: Uuid,
    pub(super) path: String,
    pub(super) query: Vec<(String, String)>,
    pub(super) status: u16,
    pub(super) redirected: bool,
    pub(super) retrieved_at: Timestamp,
    pub(super) limits: Limits,
    pub(super) partition_mode: super::PartitionMode,
    pub(super) allowed: Vec<Uuid>,
    pub(super) response_deadline: tokio::time::Instant,
}
impl CapturedStockEntityObservation {
    pub(super) fn new(facts: NativeEntityObservationFacts, original: Vec<u8>) -> Self {
        Self { facts, original }
    }
    pub fn scope(&self) -> &SourceScope {
        &self.facts.scope
    }
    pub fn entity_id(&self) -> &Uuid {
        &self.facts.entity_id
    }
    pub fn method(&self) -> &'static str {
        "GET"
    }
    pub fn path(&self) -> &str {
        &self.facts.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.facts.query
    }
    pub fn status(&self) -> u16 {
        self.facts.status
    }
    pub fn redirected(&self) -> bool {
        self.facts.redirected
    }
    pub fn retrieved_at(&self) -> &Timestamp {
        &self.facts.retrieved_at
    }
    pub fn original_bytes(&self) -> &[u8] {
        &self.original
    }
    pub(crate) fn decode_entity(&self) -> Result<wire::Decoded<wire::Detail>, ReadError> {
        let facts = &self.facts;
        if facts.redirected || (300..400).contains(&facts.status) {
            return Err(ReadError(ErrorCode::Upstream));
        }
        if matches!(facts.status, 401 | 403) {
            return Err(ReadError(ErrorCode::Auth));
        }
        if facts.status != 200 {
            return Err(ReadError(ErrorCode::Upstream));
        }
        if facts.scope != facts.expected_scope {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        if tokio::time::Instant::now() >= facts.response_deadline {
            return Err(ReadError(ErrorCode::Timeout));
        }
        let decoded = wire::decode_detail(
            &self.original,
            &facts.entity_id,
            decode_limits(facts.limits),
        )
        .map_err(read_error)?;
        if decoded.value.entity.parent.as_ref().is_some_and(|parent| {
            facts.partition_mode != super::PartitionMode::ExclusiveHome
                && !facts.allowed.contains(&parent.id)
        }) {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        if tokio::time::Instant::now() >= facts.response_deadline {
            return Err(ReadError(ErrorCode::Timeout));
        }
        Ok(decoded)
    }
    pub(super) fn into_entity(self) -> Result<CapturedStockEntity, ReadError> {
        let decoded = self.decode_entity()?;
        let facts = self.facts;
        Ok(NativeCapture::new(
            facts.scope,
            facts.entity_id,
            facts.path,
            facts.query,
            facts.status,
            facts.retrieved_at,
            decoded,
        ))
    }
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

    pub(super) fn wire_decoded(&self) -> &wire::Decoded<T> {
        &self.decoded
    }

    fn check_fresh_scope(
        &self,
        context: &Context,
        target: &StockTarget,
    ) -> Result<(), StockErrorCode> {
        // collection_id is opaque registration text. Do not parse or normalize
        // it to make a stock UUID target fit a different original partition.
        if self.scope.workspace_id.as_str() != context.workspace_id.to_string()
            || self.scope.home_id.as_str() != context.home_id.to_string()
            || self.scope.source_instance_id.as_str() != target.source_instance_id.to_string()
            || self.scope.collection_id != target.collection_id.to_string()
            || self.status != 200
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }

    fn fresh(self, target: StockTarget) -> FreshNativeCapture {
        FreshNativeCapture {
            scope: self.scope,
            target,
            path: self.path,
            query: self.query,
            original: self.decoded.original,
            observed_at: self.retrieved_at.as_str().to_owned(),
        }
    }
}

impl CapturedStockEntity {
    /// Mechanically correlate this successful GET with an existing stock target.
    /// The resulting input still requires the fresh adapter's original owner
    /// qualification; it carries no evidence, completeness or admission proof.
    pub fn into_fresh(
        self,
        context: &Context,
        target: StockTarget,
    ) -> Result<FreshNativeCapture, StockErrorCode> {
        self.check_fresh_scope(context, &target)?;
        if !matches!(
            target.resource_kind,
            ResourceKind::Entity | ResourceKind::Field | ResourceKind::Attachment
        ) {
            return Err(StockErrorCode::UnsupportedCapability);
        }
        let id = target.id().map_err(|_| StockErrorCode::InvalidArgument)?;
        if id.is_nil() {
            return Err(StockErrorCode::InvalidArgument);
        }
        let owner = match target.resource_kind {
            ResourceKind::Entity if target.entity_id.is_none() => id,
            ResourceKind::Entity => return Err(StockErrorCode::InvalidArgument),
            ResourceKind::Field | ResourceKind::Attachment => target
                .owner()
                .map_err(|_| StockErrorCode::InvalidArgument)?,
            _ => return Err(StockErrorCode::UnsupportedCapability),
        };
        if owner.is_nil()
            || self.entity_id.as_str() != owner.to_string()
            || self.decoded.value.summary.id != self.entity_id
            || self.path != format!("/api/v1/entities/{owner}")
            || !self.query.is_empty()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        if target.resource_kind != ResourceKind::Entity {
            let member_key = if target.resource_kind == ResourceKind::Field {
                "fields"
            } else {
                "attachments"
            };
            exact_member(&self.decoded.source[member_key], &id)?;
        }
        Ok(self.fresh(target))
    }
}

impl CapturedStockMaintenance {
    /// Bind an actually captured maintenance member to its original owner GET.
    /// No source qualification, write admission or causality is established.
    pub fn into_fresh(
        self,
        context: &Context,
        target: StockTarget,
    ) -> Result<FreshNativeCapture, StockErrorCode> {
        self.check_fresh_scope(context, &target)?;
        if target.resource_kind != ResourceKind::Maintenance {
            return Err(StockErrorCode::UnsupportedCapability);
        }
        let id = target.id().map_err(|_| StockErrorCode::InvalidArgument)?;
        let owner = target
            .owner()
            .map_err(|_| StockErrorCode::InvalidArgument)?;
        if id.is_nil() || owner.is_nil() {
            return Err(StockErrorCode::InvalidArgument);
        }
        if self.entity_id.as_str() != owner.to_string()
            || self.decoded.value.entity_id() != &self.entity_id
            || self.path != format!("/api/v1/entities/{owner}/maintenance")
            || self.query != [("status".into(), "both".into())]
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        exact_member(&self.decoded.source, &id)?;
        Ok(self.fresh(target))
    }
}

fn exact_member(rows: &Value, id: &uuid::Uuid) -> Result<(), StockErrorCode> {
    let id = id.to_string();
    let rows = rows.as_array().ok_or(StockErrorCode::ResourceUnavailable)?;
    if rows
        .iter()
        .filter(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .count()
        != 1
    {
        return Err(StockErrorCode::ResourceUnavailable);
    }
    Ok(())
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
