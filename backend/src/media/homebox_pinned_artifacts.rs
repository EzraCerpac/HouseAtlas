//! Measured local snapshots from the actual configured native HomeBox owner.
//! No upstream version/CAS, preview, recapture or authority from selectors/MIME.
//! Access commits precede publication and response release. Source mutex guards
//! are scoped inside original Access read fences and never retained by handles.
use super::{
    MAX_BYTES, MediaError, MediaResult, WorkBudget,
    download_lifetime::{DownloadAvailability, project_issuer_lifetime},
    native::{RetainedPrincipal, access_error},
    service::{MediaResponse, ReadMethod},
};
use crate::{
    access as a,
    contracts::stock::StockTarget,
    domain::stock::{OperationId, ValidatedRequest},
    providers::homebox::read::{
        self as hb,
        query::{
            CurrentPinnedFileSnapshot, HomeBoxReadQuery, LocalPinnedFileSnapshotIdentity,
            NativePinnedFileOwner, ReadSelection,
        },
    },
};
use serde::Serialize;
use sha2::{Digest as _, Sha256};
use std::{collections::VecDeque, io::Write, sync::Arc, time::Instant};

const MAX_HANDLES: usize = 64;
const MAX_RETAINED_BYTES: usize = 40 * 1024 * 1024;
const MAX_FACT_BYTES: usize = 1024 * 1024;

struct FenceError(MediaError);
impl From<a::AccessError> for FenceError {
    fn from(error: a::AccessError) -> Self {
        Self(access_error(error))
    }
}
impl From<MediaError> for FenceError {
    fn from(error: MediaError) -> Self {
        Self(error)
    }
}

/// Descriptive local capture facts, preserving the source's exact lexical
/// retrieval times. These three GET observations establish no remote version,
/// remote-current availability or future freshness promise.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPinnedCaptureFacts {
    semantics: &'static str,
    before_retrieved_at: String,
    body_retrieved_at: String,
    after_retrieved_at: String,
    statuses: [u16; 3],
}
impl LocalPinnedCaptureFacts {
    pub fn semantics(&self) -> &str {
        self.semantics
    }
    pub fn before_retrieved_at(&self) -> &str {
        &self.before_retrieved_at
    }
    pub fn body_retrieved_at(&self) -> &str {
        &self.body_retrieved_at
    }
    pub fn after_retrieved_at(&self) -> &str {
        &self.after_retrieved_at
    }
    pub fn statuses(&self) -> &[u16; 3] {
        &self.statuses
    }
}

/// Serializable output DATA, distinct from HomeBox provider-version artifacts.
/// MIME absence/empty/unknown spelling is preserved; this DTO grants nothing.
#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPinnedArtifact {
    scope: hb::SourceScope,
    target: StockTarget,
    download_token: String,
    sha256: String,
    byte_size: u64,
    content_type: Option<String>,
    local_capture: LocalPinnedCaptureFacts,
}
impl LocalPinnedArtifact {
    pub fn scope(&self) -> &hb::SourceScope {
        &self.scope
    }
    pub fn target(&self) -> &StockTarget {
        &self.target
    }
    pub fn download_token(&self) -> &str {
        &self.download_token
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub fn byte_size(&self) -> u64 {
        self.byte_size
    }
    pub fn content_type(&self) -> Option<&str> {
        self.content_type.as_deref()
    }
    pub fn local_capture(&self) -> &LocalPinnedCaptureFacts {
        &self.local_capture
    }
}
struct ArtifactIssuer;
/// Actual opaque issuance brand. No Clone, serde or public constructor; DTO or
/// UUID copies cannot replace this original issuer allocation.
pub struct IssuedLocalPinnedArtifact {
    issuer: Arc<ArtifactIssuer>,
    artifact: LocalPinnedArtifact,
}
impl IssuedLocalPinnedArtifact {
    pub fn artifact(&self) -> &LocalPinnedArtifact {
        &self.artifact
    }
}

/// Minted only by actual GET/HEAD RequestEvidence authorization at Action::Media.
/// No constructor from a principal DTO, session string or method enum exists.
pub struct AuthenticatedPinnedRedemption {
    principal: RetainedPrincipal,
    method: ReadMethod,
}
impl AuthenticatedPinnedRedemption {
    pub fn authenticate(
        access: &mut a::AccessBoundary,
        evidence: &a::RequestEvidence<'_>,
        scope: &a::Scope,
    ) -> MediaResult<Self> {
        let method = match evidence.method {
            a::Method::Get => ReadMethod::Get,
            a::Method::Head => ReadMethod::Head,
            _ => return Err(MediaError::MethodNotAllowed),
        };
        let principal = RetainedPrincipal::new(
            access
                .authorize(evidence, scope, a::Action::Media)
                .map_err(access_error)?,
        );
        Ok(Self { principal, method })
    }
}
struct OwnedPinnedArtifact {
    issuer: Arc<ArtifactIssuer>,
    artifact: LocalPinnedArtifact,
    owner: Arc<NativePinnedFileOwner>,
    original: RetainedPrincipal,
    grant: a::SourceGrant,
    session: [u8; 32],
    request: ValidatedRequest,
    metadata: a::SourceAuthorityMetadata,
    identity: LocalPinnedFileSnapshotIdentity,
    deadline: Instant,
    bytes: Vec<u8>,
}
struct PendingSnapshot {
    artifact: LocalPinnedArtifact,
    metadata: a::SourceAuthorityMetadata,
    identity: LocalPinnedFileSnapshotIdentity,
    deadline: Instant,
    bytes: Vec<u8>,
}

/// Concrete local broker with bounded process-local custody. Default allocates
/// an empty 64-handle/40-MiB owner; it supplies no source, grant or callback.
/// Host serializes this broker and supplies the actual configured native owner.
#[derive(Default)]
pub struct NativePinnedArtifactBroker {
    files: VecDeque<OwnedPinnedArtifact>,
}
impl NativePinnedArtifactBroker {
    /// Retain measured source bytes only after the original Access read fence
    /// commits successfully, using the source's actual 60-second local deadline.
    #[allow(clippy::too_many_arguments)]
    pub fn issue(
        &mut self,
        access: &mut a::AccessBoundary,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &ValidatedRequest,
        owner: Arc<NativePinnedFileOwner>,
        budget: &WorkBudget,
    ) -> MediaResult<IssuedLocalPinnedArtifact> {
        budget.check()?;
        let session = access
            .authenticated_session_binding(original.principal())
            .map_err(access_error)?;
        access.revalidate_source(grant).map_err(access_error)?;
        check_request(original, grant, request)?;
        // No broker/Access reentry from Source: the output slot contains only
        // detached facts. Unit closure result propagates final Access commit.
        let mut pending = None;
        access
            .with_read_authorization(original.principal(), |guard| -> Result<(), FenceError> {
                authorize_original(guard, original, grant, budget)?;
                let snapshot = owner.current_snapshot(guard, original, grant, request, budget)?;
                snapshot.revalidate(budget)?;
                check_snapshot_selection(&snapshot, request)?;
                bound_facts(snapshot.request().raw(), snapshot.source_metadata(), budget)?;
                let (bytes, digest, byte_size) = measure(snapshot.bytes(), true, budget)?;
                let mut artifact = snapshot_artifact(&snapshot, digest, byte_size)?;
                artifact.download_token.clear();
                let deadline = snapshot.local_snapshot_deadline(budget)?;
                let captured = PendingSnapshot {
                    artifact,
                    metadata: snapshot.source_metadata().clone(),
                    identity: snapshot.retain_local_identity(),
                    deadline,
                    bytes,
                };
                snapshot.revalidate(budget)?;
                authorize_original(guard, original, grant, budget)?;
                budget.check()?;
                pending = Some(captured);
                Ok(())
            })
            .map_err(|error| error.0)?;
        let mut pending = pending.ok_or(MediaError::Unavailable)?;
        if access
            .authenticated_session_binding(original.principal())
            .map_err(access_error)?
            != session
        {
            return Err(MediaError::Forbidden);
        }
        if project_issuer_lifetime(pending.deadline).is_none() {
            return Err(MediaError::Unavailable);
        }
        // Capacity and selector publication happen only after Access commit.
        self.files.retain(|file| file.deadline > Instant::now());
        let retained: usize = self.files.iter().map(|file| file.bytes.len()).sum();
        if self.files.len() >= MAX_HANDLES
            || pending.bytes.len() > MAX_RETAINED_BYTES.saturating_sub(retained)
        {
            return Err(MediaError::TooLarge);
        }
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| MediaError::Unavailable)?;
        let token = uuid::Builder::from_random_bytes(nonce)
            .into_uuid()
            .to_string();
        if self
            .files
            .iter()
            .any(|file| file.artifact.download_token == token)
        {
            return Err(MediaError::Conflict);
        }
        pending.artifact.download_token = token;
        let issuer = Arc::new(ArtifactIssuer);
        let issued = IssuedLocalPinnedArtifact {
            issuer: Arc::clone(&issuer),
            artifact: pending.artifact.clone(),
        };
        budget.check()?;
        if project_issuer_lifetime(pending.deadline).is_none() {
            return Err(MediaError::Unavailable);
        }
        self.files.push_back(OwnedPinnedArtifact {
            issuer,
            artifact: pending.artifact,
            owner,
            original: original.clone(),
            grant: grant.clone(),
            session,
            request: request.clone(),
            metadata: pending.metadata,
            identity: pending.identity,
            deadline: pending.deadline,
            bytes: pending.bytes,
        });
        Ok(issued)
    }

    /// Check original issuance brand and actual retained source allocation;
    /// identical DTO/hash/token metadata cannot establish this provenance.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_issued(
        &self,
        access: &mut a::AccessBoundary,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &ValidatedRequest,
        owner: &Arc<NativePinnedFileOwner>,
        issued: &IssuedLocalPinnedArtifact,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        access
            .revalidate(original.principal())
            .map_err(access_error)?;
        let file = self.selected(issued.artifact.download_token())?;
        if !Arc::ptr_eq(&file.issuer, &issued.issuer)
            || !Arc::ptr_eq(&file.owner, owner)
            || !file.original.same_original(original)
            || file.grant.reference() != grant.reference()
            || file.request.raw() != request.raw()
            || file.artifact != issued.artifact
        {
            return Err(MediaError::Conflict);
        }
        check_current(access, original, file)?;
        read_owned(access, file, None, budget)?;
        budget.check()?;
        if project_issuer_lifetime(file.deadline).is_none() {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }

    /// Authentication/current source authorization failures remain errors, never
    /// selector availability. Only a fully checked retained source may advertise
    /// a positive floored budget sampled after the original Access commit.
    pub fn resolve_availability(
        &self,
        access: &mut a::AccessBoundary,
        redemption: &AuthenticatedPinnedRedemption,
        token: &str,
        budget: &WorkBudget,
    ) -> MediaResult<DownloadAvailability> {
        budget.check()?;
        access
            .revalidate(redemption.principal.principal())
            .map_err(access_error)?;
        let Some(file) = self
            .files
            .iter()
            .find(|file| file.artifact.download_token == token)
        else {
            return Ok(DownloadAvailability::Unavailable);
        };
        check_current(access, &redemption.principal, file)?;
        if project_issuer_lifetime(file.deadline).is_none() {
            return Ok(DownloadAvailability::Unavailable);
        }
        read_owned(access, file, None, budget)?;
        budget.check()?;
        Ok(project_issuer_lifetime(file.deadline)
            .map_or(DownloadAvailability::Unavailable, |lifetime| {
                DownloadAvailability::Available { lifetime }
            }))
    }

    pub fn redeem(
        &mut self,
        access: &mut a::AccessBoundary,
        redemption: &AuthenticatedPinnedRedemption,
        token: &str,
        budget: &WorkBudget,
    ) -> MediaResult<MediaResponse> {
        budget.check()?;
        access
            .revalidate(redemption.principal.principal())
            .map_err(access_error)?;
        let file = self.selected(token)?;
        check_current(access, &redemption.principal, file)?;
        if project_issuer_lifetime(file.deadline).is_none() {
            return Err(MediaError::NotFound);
        }
        // Byte/header work and final original/source checks remain inside the
        // original fence. Emit only after that Access transaction commits.
        let response = read_owned(access, file, Some(redemption.method), budget)?
            .ok_or(MediaError::Unavailable)?;
        budget.check()?;
        if project_issuer_lifetime(file.deadline).is_none() {
            return Err(MediaError::NotFound);
        }
        Ok(response)
    }
    fn selected(&self, token: &str) -> MediaResult<&OwnedPinnedArtifact> {
        self.files
            .iter()
            .find(|file| file.artifact.download_token == token)
            .ok_or(MediaError::NotFound)
    }
}

fn check_current(
    access: &mut a::AccessBoundary,
    current: &RetainedPrincipal,
    file: &OwnedPinnedArtifact,
) -> MediaResult<()> {
    // This is done before status/expiry disclosure and before the Source lock.
    if access
        .authenticated_session_binding(current.principal())
        .map_err(access_error)?
        != file.session
        || access
            .authenticated_session_binding(file.original.principal())
            .map_err(access_error)?
            != file.session
        || current.principal().scope() != file.original.principal().scope()
    {
        return Err(MediaError::Forbidden);
    }
    access
        .authorize_source(current.principal(), file.grant.reference())
        .map_err(access_error)?;
    Ok(())
}
fn authorize_original(
    guard: &a::TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    if !std::ptr::eq(guard.principal(), original.principal()) {
        return Err(MediaError::Forbidden);
    }
    guard.revalidate_source(grant).map_err(access_error)?;
    guard
        .authorize(
            original.principal().scope(),
            a::Capability::ReadCacheEntity(grant.reference()),
        )
        .map_err(access_error)?;
    guard.revalidate().map_err(access_error)?;
    budget.check()
}
fn read_owned(
    access: &mut a::AccessBoundary,
    file: &OwnedPinnedArtifact,
    method: Option<ReadMethod>,
    budget: &WorkBudget,
) -> MediaResult<Option<MediaResponse>> {
    let mut response = None;
    access
        .with_read_authorization(
            file.original.principal(),
            |guard| -> Result<(), FenceError> {
                authorize_original(guard, &file.original, &file.grant, budget)?;
                let snapshot = file.owner.current_snapshot(
                    guard,
                    &file.original,
                    &file.grant,
                    &file.request,
                    budget,
                )?;
                snapshot.revalidate(budget)?;
                if !file.identity.matches(snapshot.local_snapshot_identity())
                    || file.deadline != snapshot.local_snapshot_deadline(budget)?
                    || snapshot.source_metadata() != &file.metadata
                    || snapshot.request().raw() != file.request.raw()
                    || snapshot.bytes() != file.bytes.as_slice()
                {
                    return Err(MediaError::Conflict.into());
                }
                let retain = matches!(method, Some(ReadMethod::Get));
                let (bytes, digest, size) = measure(snapshot.bytes(), retain, budget)?;
                let mut actual = snapshot_artifact(&snapshot, digest, size)?;
                actual.download_token = file.artifact.download_token.clone();
                if actual != file.artifact {
                    return Err(MediaError::Conflict.into());
                }
                if method.is_some() {
                    response = Some(MediaResponse {
                        status: 200,
                        headers: vec![
                            ("cache-control", "private, no-store".into()),
                            ("x-content-type-options", "nosniff".into()),
                            (
                                "content-security-policy",
                                "default-src 'none'; sandbox".into(),
                            ),
                            ("cross-origin-resource-policy", "same-origin".into()),
                            ("vary", "Cookie, Origin".into()),
                            // Observed MIME remains untouched in the DTO. A safe download
                            // fallback here neither qualifies inline use nor a preview.
                            ("content-type", "application/octet-stream".into()),
                            ("content-length", file.artifact.byte_size.to_string()),
                            (
                                "content-disposition",
                                "attachment; filename=\"homebox-file\"".into(),
                            ),
                        ],
                        body: bytes,
                    });
                }
                snapshot.revalidate(budget)?;
                authorize_original(guard, &file.original, &file.grant, budget)?;
                budget.check()?;
                Ok(())
            },
        )
        .map_err(|error| error.0)?;
    Ok(response)
}
fn check_request(
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    request: &ValidatedRequest,
) -> MediaResult<()> {
    let reference = grant.reference();
    if request.id() != OperationId::HomeboxFileDownload
        || request.context().workspace_id != original.principal().scope().workspace_id.as_str()
        || request.context().home_id != original.principal().scope().home_id.as_str()
        || reference.key.source_kind != a::SourceKind::HomeboxEntity
        || reference.workspace_id != original.principal().scope().workspace_id
        || reference.home_id != original.principal().scope().home_id
        || request.target()["entityId"].as_str() != Some(reference.key.external_id.as_str())
        || request.target()["sourceInstanceId"].as_str()
            != Some(reference.key.source_instance_id.as_str())
        || request.target()["collectionId"].as_str() != Some(reference.key.collection_id.as_str())
    {
        return Err(MediaError::Forbidden);
    }
    Ok(())
}
fn check_snapshot_selection(
    snapshot: &CurrentPinnedFileSnapshot<'_, '_, '_>,
    request: &ValidatedRequest,
) -> MediaResult<()> {
    let query = HomeBoxReadQuery::from_request(request).map_err(|_| MediaError::InvalidInput)?;
    if !matches!(query.selection(), ReadSelection::Download)
        || snapshot.scope() != query.scope()
        || snapshot.target() != query.target()
        || snapshot.request().raw() != request.raw()
    {
        return Err(MediaError::Conflict);
    }
    Ok(())
}
fn snapshot_artifact(
    snapshot: &CurrentPinnedFileSnapshot<'_, '_, '_>,
    digest: String,
    size: u64,
) -> MediaResult<LocalPinnedArtifact> {
    if snapshot
        .content_type()
        .is_some_and(|mime| mime.len() > 4096)
    {
        return Err(MediaError::TooLarge);
    }
    let capture = snapshot.capture();
    Ok(LocalPinnedArtifact {
        scope: snapshot.scope().clone(),
        target: snapshot.target().clone(),
        download_token: String::new(),
        sha256: digest,
        byte_size: size,
        content_type: snapshot.content_type().map(str::to_owned),
        local_capture: LocalPinnedCaptureFacts {
            semantics: "process-local-pinned-snapshot",
            before_retrieved_at: capture.before_retrieved_at().as_str().into(),
            body_retrieved_at: capture.body_retrieved_at().as_str().into(),
            after_retrieved_at: capture.after_retrieved_at().as_str().into(),
            statuses: *capture.statuses(),
        },
    })
}
fn measure(
    source: &[u8],
    retain: bool,
    budget: &WorkBudget,
) -> MediaResult<(Vec<u8>, String, u64)> {
    if source.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    let mut bytes = Vec::new();
    let mut measured = 0usize;
    let mut hash = Sha256::new();
    for chunk in source.chunks(64 * 1024) {
        budget.check()?;
        measured = measured
            .checked_add(chunk.len())
            .ok_or(MediaError::TooLarge)?;
        if measured > MAX_BYTES {
            return Err(MediaError::TooLarge);
        }
        hash.update(chunk);
        if retain {
            bytes.extend_from_slice(chunk);
        }
        budget.check()?;
    }
    budget.check()?;
    Ok((bytes, format!("{:x}", hash.finalize()), measured as u64))
}
struct FactCounter<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl Write for FactCounter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > MAX_FACT_BYTES.saturating_sub(self.bytes) {
            return Err(std::io::Error::other(MediaError::TooLarge));
        }
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn bound_facts(
    request: &serde_json::Value,
    metadata: &a::SourceAuthorityMetadata,
    budget: &WorkBudget,
) -> MediaResult<()> {
    let mut counter = FactCounter { bytes: 0, budget };
    serde_json::to_writer(&mut counter, request).map_err(|_| MediaError::TooLarge)?;
    serde_json::to_writer(&mut counter, metadata.registration())
        .map_err(|_| MediaError::TooLarge)?;
    budget.check()
}
