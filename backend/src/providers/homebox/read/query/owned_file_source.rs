//! HomeBox producer for the existing Media owned-file source port.
//! Native observations and measured digests are data, never authentication.
use super::{HomeBoxReadQuery, ReadSelection};
use crate::{
    access as a,
    contracts::stock::StockTarget,
    domain::stock as st,
    media::{
        MAX_BYTES, MediaError, MediaResult, WorkBudget,
        homebox_artifacts::{
            CapturedHomeboxFile, HomeboxFileBinding, HomeboxFileSource, HomeboxFileVersion,
        },
        native::RetainedPrincipal,
        types::sha256,
    },
    providers::homebox::{read, wire},
};
use serde_json::Value;
use std::io::{Cursor, Read};

/// Already captured local input from the original source owner. No URL/path is
/// opened by this adapter. Evidence must retain genuine response/body linkage,
/// current source generation, stored-file membership and authoritative version.
pub struct NativeStoredFileCapture<E, R> {
    pub scope: read::SourceScope,
    pub target: StockTarget,
    pub owner_get_path: String,
    pub owner_get_query: Vec<(String, String)>,
    pub file_get_path: String,
    pub file_get_query: Vec<(String, String)>,
    pub original_owner: Vec<u8>,
    pub observed_at: read::Timestamp,
    pub evidence: E,
    pub body: R,
}

/// Immutable bounded original capture and measured local bytes for the genuine
/// owner to qualify. No constructor, serde, complete flag or authority surrogate.
pub struct DecodedStoredFile<E> {
    capture: NativeStoredFileCapture<E, ()>,
    source: Value,
    member: Value,
    measured_sha256: String,
    measured_byte_size: u64,
}
impl<E> DecodedStoredFile<E> {
    pub fn original(&self) -> &NativeStoredFileCapture<E, ()> {
        &self.capture
    }
    pub fn source(&self) -> &Value {
        &self.source
    }
    pub fn member(&self) -> &Value {
        &self.member
    }
    pub fn measured_sha256(&self) -> &str {
        &self.measured_sha256
    }
    pub fn measured_byte_size(&self) -> u64 {
        self.measured_byte_size
    }
}

/// Mandatory trusted original-source owner, never instantiated from browser
/// input or cached projection. qualify_file authenticates exact original native
/// membership/body response linkage, finite freshness/source revision/build
/// policy and supplies its real authoritative version.
/// Missing original facts MUST return Unavailable, not infer a file from MIME,
/// path, URL, timestamp, source grant, capture digest or measured bytes alone.
pub trait NativeStoredFileOwner {
    type Evidence;
    type Body: Read;

    /// Capture local inputs before the Access transaction. No provider request,
    /// credential use or live file retrieval is allowed in this port.
    fn capture_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<NativeStoredFileCapture<Self::Evidence, Self::Body>>;

    /// Run inspect while holding the current authoritative source/Store critical
    /// section. Check original registration/generation/membership and prepare a
    /// fresh local reader/version proof there; keep the lock through inspect.
    /// Lock order is Access -> broker -> source/Store. Never reenter Access,
    /// broker or this same source lock. No cross-database atomicity is implied.
    fn with_current_file<T>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
        inspect: impl FnOnce(NativeStoredFileCapture<Self::Evidence, Self::Body>) -> MediaResult<T>,
    ) -> MediaResult<T>;

    /// Qualify only against the opaque original owner proof and these exact
    /// bytes/member/measurements. This callback must not reacquire a source lock:
    /// it also runs inside with_current_file. Retain originals privately; this
    /// adapter supplies no production proof store, source registration or grant.
    fn qualify_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        capture: &DecodedStoredFile<Self::Evidence>,
        budget: &WorkBudget,
    ) -> MediaResult<HomeboxFileVersion>;
}

pub struct OwnedHomeboxFileSource<O> {
    owner: O,
    limits: wire::DecodeLimits,
}
impl<O> OwnedHomeboxFileSource<O> {
    pub fn new(owner: O, limits: wire::DecodeLimits) -> Self {
        Self { owner, limits }
    }
}
impl<O: NativeStoredFileOwner> HomeboxFileSource for OwnedHomeboxFileSource<O> {
    type Body = Cursor<Vec<u8>>;

    fn open_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<CapturedHomeboxFile<Self::Body>> {
        let query = selected(original, grant, request, budget)?;
        let input = self.owner.capture_file(original, grant, request, budget)?;
        let (capture, bytes) = decode(input, &query, self.limits, budget)?;
        let version = self
            .owner
            .qualify_file(original, grant, request, &capture, budget)?;
        check_version(&version, &capture)?;
        budget.check()?;
        Ok(CapturedHomeboxFile {
            scope: capture.capture.scope,
            target: capture.capture.target,
            version,
            body: Cursor::new(bytes),
        })
    }

    fn revalidate_file(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        binding: &HomeboxFileBinding,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        authorize(guard, original, grant, budget)?;
        let query = selected(original, grant, binding.request(), budget)?;
        if binding.source() != grant.reference()
            || st::canonical_digest(binding.request().raw())
                .map_err(|_| MediaError::InvalidInput)?
                != binding.request_digest()
        {
            return Err(MediaError::Conflict);
        }
        self.owner
            .with_current_file(guard, original, grant, binding.request(), budget, |input| {
                // Independently read actual current bytes under the source lock;
                // never accept a source-supplied measured hash as a substitute.
                let (capture, _) = decode(input, &query, self.limits, budget)?;
                let version = self.owner.qualify_file(
                    original,
                    grant,
                    binding.request(),
                    &capture,
                    budget,
                )?;
                check_version(&version, &capture)?;
                if &version != binding.version()
                    || capture.measured_sha256 != binding.sha256()
                    || capture.measured_byte_size != binding.byte_size()
                {
                    return Err(MediaError::Conflict);
                }
                authorize(guard, original, grant, budget)
            })
    }
}

fn authorize(
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
    Ok(())
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
fn selected(
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    request: &st::ValidatedRequest,
    budget: &WorkBudget,
) -> MediaResult<HomeBoxReadQuery> {
    budget.check()?;
    let query = HomeBoxReadQuery::from_request(request).map_err(|_| MediaError::InvalidInput)?;
    if request.id() != st::OperationId::HomeboxFileDownload
        || !matches!(query.selection(), ReadSelection::Download)
    {
        return Err(MediaError::Unsupported);
    }
    let scope = query.scope();
    let reference = grant.reference();
    if reference.workspace_id.as_str() != scope.workspace_id.as_str()
        || reference.home_id.as_str() != scope.home_id.as_str()
        || reference.key.source_instance_id.as_str() != scope.source_instance_id.as_str()
        || reference.key.collection_id != scope.collection_id
        || reference.key.source_kind != a::SourceKind::HomeboxEntity
        || reference.key.external_id != request.target()["entityId"]
        || original.principal().scope().workspace_id != reference.workspace_id
        || original.principal().scope().home_id != reference.home_id
    {
        return Err(MediaError::Forbidden);
    }
    Ok(query)
}
fn decode<E, R: Read>(
    input: NativeStoredFileCapture<E, R>,
    query: &HomeBoxReadQuery,
    limits: wire::DecodeLimits,
    budget: &WorkBudget,
) -> MediaResult<(DecodedStoredFile<E>, Vec<u8>)> {
    budget.check()?;
    let cap = wire::DecodeLimits::default();
    if limits.max_response_bytes == 0
        || limits.max_response_bytes > cap.max_response_bytes
        || limits.max_entries == 0
        || limits.max_entries > cap.max_entries
        || limits.max_text_chars == 0
        || limits.max_text_chars > cap.max_text_chars
    {
        return Err(MediaError::InvalidInput);
    }
    if &input.scope != query.scope() || &input.target != query.target() {
        return Err(MediaError::Conflict);
    }
    let StockTarget::Homebox {
        entity_id: Some(owner),
        resource_id: Some(member_id),
        ..
    } = query.target()
    else {
        return Err(MediaError::InvalidInput);
    };
    if input.owner_get_path != format!("/api/v1/entities/{owner}")
        || input.file_get_path != format!("/api/v1/entities/{owner}/attachments/{member_id}")
        || !input.owner_get_query.is_empty()
        || !input.file_get_query.is_empty()
    {
        return Err(MediaError::Conflict);
    }
    let owner_id = read::Uuid::parse(owner).map_err(|_| MediaError::InvalidInput)?;
    let decoded = wire::decode_detail(&input.original_owner, &owner_id, limits)
        .map_err(|_| MediaError::Unavailable)?;
    let rows = decoded.source["attachments"]
        .as_array()
        .ok_or(MediaError::Unavailable)?;
    let mut members = rows
        .iter()
        .filter(|row| row["id"].as_str() == Some(member_id.as_str()));
    let member = members.next().ok_or(MediaError::Unavailable)?.clone();
    if members.next().is_some() {
        return Err(MediaError::Conflict);
    }
    // Native MIME is descriptive only. Absence/empty/link cannot establish a
    // stored file. Genuine stored-file/body/version proof is mandatory below.
    let mime = member["mimeType"]
        .as_str()
        .filter(|mime| !mime.is_empty() && *mime != "link/url")
        .ok_or(MediaError::Unavailable)?;
    if mime.len() > 255 || member["path"].as_str().is_none_or(str::is_empty) {
        return Err(MediaError::Unavailable);
    }
    let NativeStoredFileCapture {
        scope,
        target,
        owner_get_path,
        owner_get_query,
        file_get_path,
        file_get_query,
        original_owner,
        observed_at,
        evidence,
        body,
    } = input;
    let bytes = measure(body, budget)?;
    let measured_sha256 = sha256(&bytes);
    let measured_byte_size = bytes.len() as u64;
    Ok((
        DecodedStoredFile {
            capture: NativeStoredFileCapture {
                scope,
                target,
                owner_get_path,
                owner_get_query,
                file_get_path,
                file_get_query,
                original_owner,
                observed_at,
                evidence,
                body: (),
            },
            source: decoded.source,
            member,
            measured_sha256,
            measured_byte_size,
        },
        bytes,
    ))
}
fn measure(mut body: impl Read, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 65536];
    let mut chunks = 0usize;
    loop {
        budget.check()?;
        let n = body.read(&mut buffer)?;
        budget.check()?;
        if n == 0 {
            return Ok(bytes);
        }
        chunks += 1;
        if chunks > 65536 || n > MAX_BYTES.saturating_sub(bytes.len()) {
            return Err(MediaError::TooLarge);
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
}
fn check_version<E>(
    version: &HomeboxFileVersion,
    capture: &DecodedStoredFile<E>,
) -> MediaResult<()> {
    if version.source_version.is_empty()
        || version.source_version.chars().count() > 4096
        || capture.member["mimeType"].as_str() != Some(version.content_type.as_str())
        || version
            .declared_byte_size
            .is_some_and(|size| size != capture.measured_byte_size)
        || version
            .declared_sha256
            .as_ref()
            .is_some_and(|digest| digest != &capture.measured_sha256)
    {
        return Err(MediaError::Conflict);
    }
    Ok(())
}
