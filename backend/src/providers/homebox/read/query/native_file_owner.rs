//! Actual configured capture and finite, guarded LOCAL attachment snapshot.
//! This owner does not implement the provider-version file source contract.
use super::{HomeBoxReadQuery, ReadSelection};
use crate::{
    access as a,
    config::providers::homebox::TrustedHomeBoxSource,
    contracts::stock::StockTarget,
    domain::stock::{OperationId, ValidatedRequest},
    media::{MediaError, MediaResult, WorkBudget, native::RetainedPrincipal},
    providers::homebox::read::{self, CapturedNativeFileSnapshot},
};
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::{Instant, SystemTime},
};

use super::super::native_file_capture::PINNED_FILE_CAPTURE_WINDOW as CAPTURE_WINDOW;

/// Allocation identity of this one local capture, never an upstream version,
/// timestamp, content hash or serialized token. No public constructor/Clone.
pub struct LocalPinnedFileSnapshotIdentity {
    allocation: Arc<()>,
}
impl LocalPinnedFileSnapshotIdentity {
    pub fn matches(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.allocation, &other.allocation)
    }
}
struct PinnedFileState {
    capture: CapturedNativeFileSnapshot,
    metadata: a::SourceAuthorityMetadata,
    started_at: Instant,
    identity: LocalPinnedFileSnapshotIdentity,
}
/// Original configured and grant custody. No transport injection, recapture,
/// mutable file adoption, provider-version proof or credential accessor.
pub struct NativePinnedFileOwner {
    homebox: Arc<TrustedHomeBoxSource>,
    _access: Arc<Mutex<a::AccessBoundary>>,
    original: RetainedPrincipal,
    grant: a::SourceGrant,
    partition: a::PartitionGrant,
    request: ValidatedRequest,
    query: HomeBoxReadQuery,
    state: Mutex<PinnedFileState>,
}
impl NativePinnedFileOwner {
    pub async fn capture_configured(
        homebox: &Arc<TrustedHomeBoxSource>,
        credentials: &Arc<read::NativeReadCredentialConfig>,
        access: Arc<Mutex<a::AccessBoundary>>,
        original: RetainedPrincipal,
        grant: a::SourceGrant,
        partition: a::PartitionGrant,
        request: &ValidatedRequest,
    ) -> MediaResult<Self> {
        let query = selected(&original, &grant, &partition, request)?;
        if homebox.metadata_dialect() != crate::providers::homebox::wire::DIALECT
            || homebox.scope() != *query.scope()
            || !credentials
                .matches_endpoint(&homebox.endpoint().map_err(|_| MediaError::Unavailable)?)
        {
            return Err(MediaError::Conflict);
        }
        let before = source_fence(homebox, &access, &original, &grant, &partition)?;
        let (owner, attachment) = ids(&query)?;
        // No Access/Store/source guard survives either credential delivery or
        // the GET await. The credential peer freshly fences each real request.
        let capture = {
            let bound = credentials
                .bind_original(
                    Arc::clone(&access),
                    original.principal(),
                    grant.clone(),
                    partition.clone(),
                )
                .map_err(read_error)?;
            let mut reader = homebox
                .reader(bound, HostClock)
                .map_err(|_| MediaError::Unavailable)?;
            let expected: read::SourceRegistration = serde_json::from_value(
                serde_json::to_value(before.registration()).map_err(|_| MediaError::Unavailable)?,
            )
            .map_err(|_| MediaError::Unavailable)?;
            let actual = reader.registration();
            if actual.workspace_id != expected.workspace_id
                || actual.home_id != expected.home_id
                || actual.source_instance_id != expected.source_instance_id
                || actual.collection_id != expected.collection_id
                || actual.owner != expected.owner
                || actual.partition_mode != expected.partition_mode
                || actual.allowed_external_ids != expected.allowed_external_ids
            {
                return Err(MediaError::Conflict);
            }
            // One finite local window starts before the first actual detail GET.
            let started_at = Instant::now();
            let capture = reader
                .capture_native_file_snapshot(&owner, &attachment)
                .await
                .map_err(read_error)?;
            (capture, started_at)
        };
        // source_fence returns only AFTER its original Access commit completes.
        let after = source_fence(homebox, &access, &original, &grant, &partition)?;
        if before != after
            || capture.0.scope() != query.scope()
            || capture.0.owner() != &owner
            || capture.0.attachment() != &attachment
            || capture.1.elapsed() >= CAPTURE_WINDOW
        {
            return Err(MediaError::Conflict);
        }
        Ok(Self {
            homebox: Arc::clone(homebox),
            _access: access,
            original,
            grant,
            partition,
            request: request.clone(),
            query,
            state: Mutex::new(PinnedFileState {
                capture: capture.0,
                metadata: after,
                started_at: capture.1,
                identity: LocalPinnedFileSnapshotIdentity {
                    allocation: Arc::new(()),
                },
            }),
        })
    }
    pub fn current_snapshot<'owner, 'phase, 'tx>(
        &'owner self,
        guard: &'phase a::TransactionAuthorization<'tx>,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<CurrentPinnedFileSnapshot<'owner, 'phase, 'tx>> {
        budget.check()?;
        if !std::ptr::eq(original.principal(), self.original.principal())
            || grant.reference() != self.grant.reference()
            || request.raw() != self.request.raw()
            || request.intent_digest() != self.request.intent_digest()
            || request.id() != self.request.id()
        {
            return Err(MediaError::Forbidden);
        }
        guard.revalidate_source(grant).map_err(access_error)?;
        let current = CurrentPinnedFileSnapshot {
            owner: self,
            state: self.state.try_lock().map_err(|_| MediaError::Busy)?,
            guard,
        };
        current.revalidate(budget)?;
        Ok(current)
    }
}
/// Actual held source lock and current original Access guard. Byte and metadata
/// getters borrow this carrier; they provide no remote-current qualification.
pub struct CurrentPinnedFileSnapshot<'owner, 'phase, 'tx> {
    owner: &'owner NativePinnedFileOwner,
    state: MutexGuard<'owner, PinnedFileState>,
    guard: &'phase a::TransactionAuthorization<'tx>,
}
impl CurrentPinnedFileSnapshot<'_, '_, '_> {
    pub fn revalidate(&self, budget: &WorkBudget) -> MediaResult<()> {
        budget.check()?;
        if self.state.started_at.elapsed() >= CAPTURE_WINDOW
            || !std::ptr::eq(self.guard.principal(), self.owner.original.principal())
        {
            return Err(MediaError::Unavailable);
        }
        self.guard
            .revalidate_source_read(
                &self.owner.partition,
                std::slice::from_ref(&self.owner.grant),
            )
            .map_err(access_error)?;
        let metadata = self
            .guard
            .persisted_source_metadata(&self.owner.partition)
            .map_err(access_error)?;
        check_registration(&self.owner.homebox, &metadata)?;
        if metadata != self.state.metadata || self.state.capture.scope() != self.owner.query.scope()
        {
            return Err(MediaError::Conflict);
        }
        self.guard.revalidate().map_err(access_error)?;
        budget.check()?;
        if self.state.started_at.elapsed() >= CAPTURE_WINDOW {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }
    pub fn bytes(&self) -> &[u8] {
        self.state.capture.bytes()
    }
    pub fn scope(&self) -> &read::SourceScope {
        self.state.capture.scope()
    }
    pub fn target(&self) -> &StockTarget {
        self.owner.query.target()
    }
    pub fn local_snapshot_identity(&self) -> &LocalPinnedFileSnapshotIdentity {
        &self.state.identity
    }
    /// Retain only this existing local allocation, never a provider version.
    pub fn retain_local_identity(&self) -> LocalPinnedFileSnapshotIdentity {
        LocalPinnedFileSnapshotIdentity {
            allocation: Arc::clone(&self.state.identity.allocation),
        }
    }
    pub(crate) fn local_snapshot_deadline(&self, budget: &WorkBudget) -> MediaResult<Instant> {
        self.revalidate(budget)?;
        let deadline = self
            .state
            .started_at
            .checked_add(CAPTURE_WINDOW)
            .ok_or(MediaError::Unavailable)?;
        self.revalidate(budget)?;
        Ok(deadline)
    }
    pub fn content_type(&self) -> Option<&str> {
        self.state.capture.content_type()
    }
    pub fn capture(&self) -> &CapturedNativeFileSnapshot {
        &self.state.capture
    }
    pub fn source_metadata(&self) -> &a::SourceAuthorityMetadata {
        &self.state.metadata
    }
    pub fn request(&self) -> &ValidatedRequest {
        &self.owner.request
    }
}
struct HostClock;
impl read::Clock for HostClock {
    fn now(&self) -> read::Timestamp {
        let current: chrono::DateTime<chrono::Utc> = SystemTime::now().into();
        read::Timestamp::parse(&current.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
            .expect("SystemTime RFC3339 timestamp")
    }
}
fn ids(query: &HomeBoxReadQuery) -> MediaResult<(read::Uuid, read::Uuid)> {
    let StockTarget::Homebox {
        entity_id: Some(owner),
        resource_id: Some(attachment),
        ..
    } = query.target()
    else {
        return Err(MediaError::InvalidInput);
    };
    let owner_id = read::Uuid::parse(owner).map_err(|_| MediaError::InvalidInput)?;
    let attachment_id = read::Uuid::parse(attachment).map_err(|_| MediaError::InvalidInput)?;
    if owner_id.as_str() != owner
        || attachment_id.as_str() != attachment
        || [owner_id.as_str(), attachment_id.as_str()]
            .contains(&"00000000-0000-0000-0000-000000000000")
    {
        return Err(MediaError::InvalidInput);
    }
    Ok((owner_id, attachment_id))
}
fn selected(
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    partition: &a::PartitionGrant,
    request: &ValidatedRequest,
) -> MediaResult<HomeBoxReadQuery> {
    let query = HomeBoxReadQuery::from_request(request).map_err(|_| MediaError::InvalidInput)?;
    if request.id() != OperationId::HomeboxFileDownload
        || !matches!(query.selection(), ReadSelection::Download)
    {
        return Err(MediaError::Unsupported);
    }
    let (owner, _) = ids(&query)?;
    let scope = query.scope();
    let reference = grant.reference();
    if reference.key.source_kind != a::SourceKind::HomeboxEntity
        || reference.key.external_id != owner.as_str()
        || reference.partition() != *partition.partition()
        || reference.workspace_id.as_str() != scope.workspace_id.as_str()
        || reference.home_id.as_str() != scope.home_id.as_str()
        || reference.key.source_instance_id.as_str() != scope.source_instance_id.as_str()
        || reference.key.collection_id != scope.collection_id
        || original.principal().scope().workspace_id != reference.workspace_id
        || original.principal().scope().home_id != reference.home_id
        || request.context().workspace_id != scope.workspace_id.as_str()
        || request.context().home_id != scope.home_id.as_str()
        || request.target()["sourceInstanceId"].as_str() != Some(scope.source_instance_id.as_str())
    {
        return Err(MediaError::Forbidden);
    }
    Ok(query)
}
fn check_registration(
    homebox: &TrustedHomeBoxSource,
    metadata: &a::SourceAuthorityMetadata,
) -> MediaResult<()> {
    if metadata.registration().owner != a::SourceOwner::Homebox
        || serde_json::to_value(homebox.registration()).map_err(|_| MediaError::Unavailable)?
            != serde_json::to_value(metadata.registration()).map_err(|_| MediaError::Unavailable)?
    {
        return Err(MediaError::Conflict);
    }
    Ok(())
}
fn source_fence(
    homebox: &TrustedHomeBoxSource,
    access: &Arc<Mutex<a::AccessBoundary>>,
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    partition: &a::PartitionGrant,
) -> MediaResult<a::SourceAuthorityMetadata> {
    let mut boundary = access.try_lock().map_err(|_| MediaError::Busy)?;
    let mut metadata = None;
    boundary
        .with_source_read_authorization(
            original.principal(),
            partition,
            std::slice::from_ref(grant),
            |guard| {
                if !std::ptr::eq(guard.principal(), original.principal()) {
                    return Err(FenceError(MediaError::Forbidden));
                }
                let observed = guard
                    .persisted_source_metadata(partition)
                    .map_err(FenceError::from)?;
                check_registration(homebox, &observed).map_err(FenceError)?;
                metadata = Some(observed);
                Ok::<(), FenceError>(())
            },
        )
        .map_err(|error| error.0)?;
    metadata.ok_or(MediaError::Unavailable)
}
struct FenceError(MediaError);
impl From<a::AccessError> for FenceError {
    fn from(error: a::AccessError) -> Self {
        Self(access_error(error))
    }
}
fn access_error(error: a::AccessError) -> MediaError {
    match error {
        a::AccessError::Unauthenticated => MediaError::Unauthenticated,
        a::AccessError::Forbidden => MediaError::Forbidden,
        a::AccessError::NotFound => MediaError::NotFound,
        a::AccessError::InvalidInput => MediaError::InvalidInput,
        a::AccessError::MethodNotAllowed => MediaError::MethodNotAllowed,
        a::AccessError::BodyTooLarge => MediaError::TooLarge,
        a::AccessError::RateLimited => MediaError::Busy,
        a::AccessError::Unavailable => MediaError::Unavailable,
    }
}
fn read_error(error: read::ReadError) -> MediaError {
    match error.0 {
        read::ErrorCode::Auth => MediaError::Forbidden,
        read::ErrorCode::WrongScope => MediaError::Conflict,
        read::ErrorCode::SizeLimit => MediaError::TooLarge,
        _ => MediaError::Unavailable,
    }
}
