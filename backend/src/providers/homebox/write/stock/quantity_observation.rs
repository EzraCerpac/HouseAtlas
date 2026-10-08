//! Private registry of observations issued only after an original mutation GET.
use super::*;
use crate::{access as a, providers::homebox::read};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Instant,
};

/// Preview custody uses the actual original principal and already captured grants.
/// It creates no command and no replacement authority or source grant.
pub struct OriginalQuantityPreview<'p> {
    pub(super) principal: &'p a::Principal,
    pub(super) source: &'p a::SourceGrant,
    pub(super) partition: &'p a::PartitionGrant,
    pub(super) profile: &'p QuantityProfile,
}
impl<'p> OriginalQuantityPreview<'p> {
    pub fn new(
        principal: &'p a::Principal,
        source: &'p a::SourceGrant,
        partition: &'p a::PartitionGrant,
        profile: &'p QuantityProfile,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<Self, StockErrorCode> {
        let preview = Self {
            principal,
            source,
            partition,
            profile,
        };
        preview.check_guard(guard)?;
        Ok(preview)
    }
    pub(super) fn check_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<a::SourceAuthorityMetadata, StockErrorCode> {
        if !std::ptr::eq(self.principal, guard.principal()) {
            return Err(StockErrorCode::CapabilityDenied);
        }
        guard.assert_mutation().map_err(quantity_access_error)?;
        guard
            .revalidate_source(self.source)
            .map_err(quantity_access_error)?;
        guard
            .revalidate_source_partition(self.partition)
            .map_err(quantity_access_error)?;
        let e = &self.profile.expected;
        let r = self.source.reference();
        if r.partition() != *self.partition.partition()
            || r.key.source_kind != a::SourceKind::HomeboxEntity
            || r.key.external_id
                != e.target
                    .id()
                    .map_err(|_| StockErrorCode::InvalidArgument)?
                    .to_string()
            || self.principal.actor_id().as_str() != e.authority.actor_id.to_string()
            || self.principal.scope().workspace_id.as_str() != e.scope.workspace_id.to_string()
            || self.principal.scope().home_id.as_str() != e.scope.home_id.to_string()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let metadata = guard
            .persisted_source_metadata(self.partition)
            .map_err(quantity_access_error)?;
        if metadata != e.metadata {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(metadata)
    }
}
pub(super) struct IssuedQuantityObservation<'p, T, K> {
    pub(super) preview: &'p OriginalQuantityPreview<'p>,
    pub(super) capture: FreshNativeCapture,
    pub(super) revision: String,
    pub(super) metadata: a::SourceAuthorityMetadata,
    pub(super) issued_at: Instant,
    pub(super) access: Arc<Mutex<a::AccessBoundary>>,
    pub(super) reader: Arc<tokio::sync::Mutex<read::HomeBoxReader<T, K>>>,
}
pub struct QuantityObservationRegistry<'p, T, K> {
    pub(super) preview: &'p OriginalQuantityPreview<'p>,
    issued: Mutex<BTreeMap<uuid::Uuid, Arc<IssuedQuantityObservation<'p, T, K>>>>,
}
impl<'p, T: read::Transport, K: read::Clock + Send + Sync> QuantityObservationRegistry<'p, T, K> {
    pub fn new(preview: &'p OriginalQuantityPreview<'p>) -> Self {
        Self {
            preview,
            issued: Mutex::new(BTreeMap::new()),
        }
    }
    /// Call before building the immutable command containing the returned ID.
    pub async fn issue_observation(
        &self,
        reader: &'p Arc<tokio::sync::Mutex<read::HomeBoxReader<T, K>>>,
        access: &Arc<Mutex<a::AccessBoundary>>,
    ) -> Result<uuid::Uuid, StockErrorCode> {
        let metadata = self.fence(access)?;
        let id = read::Uuid::parse(
            &self
                .preview
                .profile
                .expected
                .target
                .id()
                .map_err(|_| StockErrorCode::InvalidArgument)?
                .to_string(),
        )
        .map_err(|_| StockErrorCode::InvalidArgument)?;
        let capture = {
            let mut configured = reader.lock().await;
            quantity_reader_check(&configured, &metadata)?;
            configured
                .capture_stock_entity(&id)
                .await
                .map_err(|_| StockErrorCode::ResourceUnavailable)?
        };
        let issued_at = Instant::now();
        if self.fence(access)? != metadata {
            return Err(StockErrorCode::PreflightConflict);
        }
        let revision = quantity_revision(capture.source_json())?.to_owned();
        let raw = capture.into_fresh(
            &self.preview.profile.expected.scope,
            self.preview.profile.expected.target.clone(),
        )?;
        let observation = Arc::new(IssuedQuantityObservation {
            preview: self.preview,
            capture: raw,
            revision,
            metadata,
            issued_at,
            access: Arc::clone(access),
            reader: Arc::clone(reader),
        });
        let mut registry = self
            .issued
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        registry.retain(|_, o| o.issued_at.elapsed() <= self.preview.profile.expected.freshness);
        if registry.len() >= 100 {
            return Err(StockErrorCode::ResourceUnavailable);
        }
        for _ in 0..8 {
            let mut bytes = [0u8; 16];
            getrandom::fill(&mut bytes).map_err(|_| StockErrorCode::ResourceUnavailable)?;
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            let handle = uuid::Uuid::from_bytes(bytes);
            if handle.is_nil() {
                continue;
            }
            if let std::collections::btree_map::Entry::Vacant(entry) = registry.entry(handle) {
                entry.insert(observation);
                return Ok(handle);
            }
        }
        Err(StockErrorCode::ResourceUnavailable)
    }
    pub(super) fn fence(
        &self,
        access: &Arc<Mutex<a::AccessBoundary>>,
    ) -> Result<a::SourceAuthorityMetadata, StockErrorCode> {
        let mut boundary = access
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let mut result = None;
        boundary
            .with_mutation_authorization(self.preview.principal, |guard| {
                result = Some(
                    self.preview
                        .check_guard(guard)
                        .map_err(QuantityFenceError)?,
                );
                Ok::<(), QuantityFenceError>(())
            })
            .map_err(|e| e.0)?;
        result.ok_or(StockErrorCode::ResourceUnavailable)
    }
    pub(super) fn lookup(
        &self,
        handle: uuid::Uuid,
    ) -> Result<Arc<IssuedQuantityObservation<'p, T, K>>, StockErrorCode> {
        let registry = self
            .issued
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let observation = registry
            .get(&handle)
            .ok_or(StockErrorCode::PreflightConflict)?;
        if !std::ptr::eq(observation.preview, self.preview)
            || observation.issued_at.elapsed() > self.preview.profile.expected.freshness
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(Arc::clone(observation))
    }
}
pub(super) struct QuantityFenceError(pub(super) StockErrorCode);
impl From<a::AccessError> for QuantityFenceError {
    fn from(error: a::AccessError) -> Self {
        Self(quantity_access_error(error))
    }
}
pub(super) fn quantity_revision(source: &serde_json::Value) -> Result<&str, StockErrorCode> {
    let revision = source
        .get("updatedAt")
        .and_then(serde_json::Value::as_str)
        .ok_or(StockErrorCode::PreflightConflict)?;
    read::Timestamp::parse(revision).map_err(|_| StockErrorCode::PreflightConflict)?;
    Ok(revision)
}
pub(super) fn quantity_reader_check<T: read::Transport, K: read::Clock>(
    reader: &read::HomeBoxReader<T, K>,
    metadata: &a::SourceAuthorityMetadata,
) -> Result<(), StockErrorCode> {
    let actual = reader.registration();
    let expected = metadata.registration();
    let actual_ids: Vec<_> = actual
        .allowed_external_ids
        .iter()
        .map(|id| id.as_str())
        .collect();
    let expected_ids: Vec<_> = expected
        .allowed_external_ids
        .iter()
        .map(String::as_str)
        .collect();
    let mode_matches = matches!(
        (actual.partition_mode, expected.partition_mode),
        (
            read::PartitionMode::ExclusiveHome,
            a::PartitionMode::ExclusiveHome
        ) | (
            read::PartitionMode::ReviewedEntityAllowlist,
            a::PartitionMode::ReviewedEntityAllowlist
        )
    );
    if reader.metadata_dialect() != crate::providers::homebox::wire::DIALECT
        || actual.workspace_id.as_str() != expected.workspace_id.as_str()
        || actual.home_id.as_str() != expected.home_id.as_str()
        || actual.source_instance_id.as_str() != expected.source_instance_id.as_str()
        || actual.collection_id != expected.collection_id
        || actual.owner != "homebox"
        || expected.owner != a::SourceOwner::Homebox
        || !mode_matches
        || actual_ids != expected_ids
    {
        return Err(StockErrorCode::PreflightConflict);
    }
    Ok(())
}
pub(super) fn quantity_access_error(error: a::AccessError) -> StockErrorCode {
    match error {
        a::AccessError::Unauthenticated => StockErrorCode::Unauthenticated,
        a::AccessError::Forbidden | a::AccessError::MethodNotAllowed => {
            StockErrorCode::CapabilityDenied
        }
        a::AccessError::InvalidInput | a::AccessError::BodyTooLarge => {
            StockErrorCode::InvalidArgument
        }
        _ => StockErrorCode::ResourceUnavailable,
    }
}
