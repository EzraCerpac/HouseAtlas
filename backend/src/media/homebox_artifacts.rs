//! Measured, process-local HomeBox file custody. No transport, guessed native
//! URL, preview, source registration or downloadable authority from metadata.
//! The host serializes this broker, acquires Access before it, and supplies its
//! actual qualified retained-source owner. Native capture/IO precedes this API.
use std::{
    collections::VecDeque,
    io::Read,
    time::{Duration, Instant},
};

use crate::{access as a, domain::stock as st, providers::homebox::read as hb};
use hb::query::{FileDownload, HomeBoxReadQuery, ReadSelection};

use super::download_lifetime::{DownloadAvailability, project_issuer_lifetime};
use super::native::{RetainedPrincipal, access_error};
use super::service::{MediaResponse, ReadMethod};
use super::types::{is_digest, sha256};
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget};

const MAX_HANDLES: usize = 64;
const MAX_RETAINED_BYTES: usize = 40 * 1024 * 1024;
const HANDLE_LIFETIME: Duration = Duration::from_secs(300);

enum FencedError {
    Access(a::AccessError),
    Media(MediaError),
}

impl From<a::AccessError> for FencedError {
    fn from(error: a::AccessError) -> Self {
        Self::Access(error)
    }
}

impl From<MediaError> for FencedError {
    fn from(error: MediaError) -> Self {
        Self::Media(error)
    }
}

impl FencedError {
    fn media(self) -> MediaError {
        match self {
            Self::Access(error) => access_error(error),
            Self::Media(error) => error,
        }
    }
}

/// Source-owner version DATA, not permission, presence or provider CAS. The
/// owner supplies the actual captured source version, retaining its spelling;
/// target IDs/retrieval clocks/attachment MIME alone cannot establish it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HomeboxFileVersion {
    pub source_version: String,
    pub content_type: String,
    pub declared_byte_size: Option<u64>,
    pub declared_sha256: Option<String>,
}

/// A local owned stream from an already qualified source capture. This type
/// deliberately provides no URL/path or credential interface.
pub struct CapturedHomeboxFile<R> {
    pub scope: hb::SourceScope,
    pub target: crate::contracts::stock::StockTarget,
    pub version: HomeboxFileVersion,
    pub body: R,
}

/// Trusted source-owner integration, never browser input. open_file resolves an
/// actual stored-file member of the selected native owner (not an external
/// link), and returns its local captured bytes/version. No provider request may
/// run here. revalidate_file checks current exact target membership, source
/// version and actual source artifact size/digest under the supplied original
/// read guard, using the owning Store/capture without reentering Access/broker.
/// Neither successful source metadata reads nor SourceGrant alone satisfy it.
pub trait HomeboxFileSource {
    type Body: Read;

    fn open_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<CapturedHomeboxFile<Self::Body>>;

    fn revalidate_file(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        binding: &HomeboxFileBinding,
        budget: &WorkBudget,
    ) -> MediaResult<()>;
}

/// Sealed exact request/source/version plus measured byte facts. No constructor,
/// Clone or serde; descriptive public facts cannot reconstruct retained custody.
pub struct HomeboxFileBinding {
    request: st::ValidatedRequest,
    request_digest: String,
    source: a::SourceRef,
    version: HomeboxFileVersion,
    sha256: String,
    byte_size: u64,
}

impl HomeboxFileBinding {
    pub fn request(&self) -> &st::ValidatedRequest {
        &self.request
    }
    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub fn source(&self) -> &a::SourceRef {
        &self.source
    }
    pub fn version(&self) -> &HomeboxFileVersion {
        &self.version
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub fn byte_size(&self) -> u64 {
        self.byte_size
    }
}

struct OwnedHomeboxFile {
    original: RetainedPrincipal,
    grant: a::SourceGrant,
    session: [u8; 32],
    binding: HomeboxFileBinding,
    bytes: Vec<u8>,
    download: FileDownload,
    expires: Instant,
}

/// Owner-produced issuance correlation, not bearer authority. Only the broker
/// retains bytes/principal/grant. Keeping this value cannot retain expired bytes.
/// The DTO accessor returns the existing HomeBox read-owner output DATA.
pub struct IssuedHomeboxFile {
    download: FileDownload,
    request_digest: String,
}

impl IssuedHomeboxFile {
    pub fn file_download(&self) -> &FileDownload {
        &self.download
    }
}

/// Genuine current GET/HEAD Media authorization, never a caller-supplied Read
/// principal or method enum alone. The host supplies actual transport evidence
/// for each request; private fields preserve the native issuance and method.
pub struct AuthenticatedHomeboxRedemption {
    principal: RetainedPrincipal,
    method: ReadMethod,
}

impl AuthenticatedHomeboxRedemption {
    pub fn authorize(
        access: &mut a::AccessBoundary,
        evidence: &a::RequestEvidence<'_>,
        scope: &a::Scope,
    ) -> MediaResult<Self> {
        let method = match evidence.method {
            a::Method::Get => ReadMethod::Get,
            a::Method::Head => ReadMethod::Head,
            _ => return Err(MediaError::MethodNotAllowed),
        };
        let principal = access
            .authorize(evidence, scope, a::Action::Media)
            .map_err(access_error)?;
        Ok(Self {
            principal: RetainedPrincipal::new(principal),
            method,
        })
    }

    pub fn principal(&self) -> &RetainedPrincipal {
        &self.principal
    }
}

/// One serialized host owner; no restart persistence or adopted client tokens.
/// At most 64 five-minute handles and 40 MiB retained body bytes; each received
/// body is at most the existing 10 MiB Media limit. Temporary input/output copies
/// are additional. Exclusive mutable operations prevent concurrent admissions.
#[derive(Default)]
pub struct HomeboxArtifactBroker {
    files: VecDeque<OwnedHomeboxFile>,
}

fn request_digest(request: &st::ValidatedRequest) -> MediaResult<String> {
    st::canonical_digest(request.raw()).map_err(|_| MediaError::InvalidInput)
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

fn check_version(version: &HomeboxFileVersion) -> MediaResult<()> {
    let media = version
        .content_type
        .split(';')
        .next()
        .ok_or(MediaError::InvalidInput)?;
    let token = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
    };
    let mut parts = media.split('/');
    if version.source_version.is_empty()
        || version.source_version.chars().count() > 4096
        || version.content_type.len() > 255
        || !version
            .content_type
            .bytes()
            .all(|b| (32..=126).contains(&b))
        || !parts.next().is_some_and(token)
        || !parts.next().is_some_and(token)
        || parts.next().is_some()
        || version
            .declared_byte_size
            .is_some_and(|n| n > MAX_BYTES as u64)
        || version
            .declared_sha256
            .as_ref()
            .is_some_and(|s| !is_digest(s))
    {
        return Err(MediaError::InvalidInput);
    }
    Ok(())
}

impl HomeboxArtifactBroker {
    /// Resolve presentation availability from this actual retained issuer.
    /// No URL/HTTP fetch or byte response. Host still supplies the genuine source
    /// owner; an unbound production source must not call this with a substitute.
    /// Source/authority can change before expiry; re-resolve on host changes.
    pub fn resolve_availability<S: HomeboxFileSource>(
        &self,
        access: &mut a::AccessBoundary,
        redemption: &AuthenticatedHomeboxRedemption,
        token: &str,
        source: &S,
        budget: &WorkBudget,
    ) -> MediaResult<DownloadAvailability> {
        budget.check()?;
        let current = &redemption.principal;
        access
            .revalidate(current.principal())
            .map_err(access_error)?;
        let Some(file) = self
            .files
            .iter()
            .find(|f| f.download.download_token.as_str() == token)
        else {
            return Ok(DownloadAvailability::Unavailable);
        };
        // Authenticate the exact session/scope/source and retained ORIGINAL
        // before revealing even the lifetime of a found private handle.
        match Self::current(access, current, file, source, budget) {
            Ok(()) => (),
            Err(MediaError::NotFound) => return Ok(DownloadAvailability::Unavailable),
            Err(error) => return Err(error),
        }
        budget.check()?;
        Ok(project_issuer_lifetime(file.expires)
            .map_or(DownloadAvailability::Unavailable, |lifetime| {
                DownloadAvailability::Available { lifetime }
            }))
    }

    /// Intake from the genuine retained source, never a request body or URL.
    /// Metadata is insufficient: the broker reads/measures the entire local
    /// stream, then checks original Access and current source bytes/version.
    pub fn issue<S: HomeboxFileSource>(
        &mut self,
        access: &mut a::AccessBoundary,
        original: &RetainedPrincipal,
        request: &st::ValidatedRequest,
        source: &S,
        budget: &WorkBudget,
    ) -> MediaResult<IssuedHomeboxFile> {
        budget.check()?;
        access
            .revalidate(original.principal())
            .map_err(access_error)?;
        self.files.retain(|f| f.expires > Instant::now());
        let retained = self.files.iter().map(|f| f.bytes.len()).sum::<usize>();
        if self.files.len() >= MAX_HANDLES || retained >= MAX_RETAINED_BYTES {
            return Err(MediaError::Busy);
        }
        let schemas = st::NativeStockContract::new().map_err(|_| MediaError::Unavailable)?;
        let request = st::ValidatedRequest::parse(&schemas, request.raw().clone())
            .map_err(|_| MediaError::InvalidInput)?;
        let query =
            HomeBoxReadQuery::from_request(&request).map_err(|_| MediaError::InvalidInput)?;
        if request.id() != st::OperationId::HomeboxFileDownload
            || !matches!(query.selection(), ReadSelection::Download)
        {
            return Err(MediaError::Unsupported);
        }
        let selected = query.scope();
        let reference = a::SourceRef {
            workspace_id: a::CanonicalId::parse(selected.workspace_id.as_str())
                .map_err(access_error)?,
            home_id: a::CanonicalId::parse(selected.home_id.as_str()).map_err(access_error)?,
            key: a::SourceKey {
                source_instance_id: a::CanonicalId::parse(selected.source_instance_id.as_str())
                    .map_err(access_error)?,
                collection_id: selected.collection_id.clone(),
                source_kind: a::SourceKind::HomeboxEntity,
                external_id: request.target()["entityId"]
                    .as_str()
                    .ok_or(MediaError::InvalidInput)?
                    .to_owned(),
            },
        };
        let session = access
            .authenticated_session_binding(original.principal())
            .map_err(access_error)?;
        let grant = access
            .authorize_source(original.principal(), &reference)
            .map_err(access_error)?;
        let mut capture = source.open_file(original, &grant, &request, budget)?;
        if capture.scope != *selected || capture.target != *query.target() {
            return Err(MediaError::Conflict);
        }
        check_version(&capture.version)?;
        let maximum = MAX_BYTES.min(MAX_RETAINED_BYTES - retained);
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 65536];
        let mut chunks = 0usize;
        loop {
            budget.check()?;
            let n = capture.body.read(&mut buffer)?;
            budget.check()?;
            if n == 0 {
                break;
            }
            chunks += 1;
            if chunks > 65536 || n > maximum.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&buffer[..n]);
        }
        let digest = sha256(&bytes);
        let size = bytes.len() as u64;
        if capture
            .version
            .declared_byte_size
            .is_some_and(|n| n != size)
            || capture
                .version
                .declared_sha256
                .as_ref()
                .is_some_and(|s| *s != digest)
        {
            return Err(MediaError::Conflict);
        }
        let binding = HomeboxFileBinding {
            request_digest: request_digest(&request)?,
            request,
            source: reference,
            version: capture.version,
            sha256: digest.clone(),
            byte_size: size,
        };
        access
            .with_read_authorization(original.principal(), |guard| -> Result<(), FencedError> {
                authorize(guard, original, &grant, budget)?;
                source.revalidate_file(guard, original, &grant, &binding, budget)?;
                authorize(guard, original, &grant, budget)?;
                Ok(())
            })
            .map_err(FencedError::media)?;
        if access
            .authenticated_session_binding(original.principal())
            .map_err(access_error)?
            != session
        {
            return Err(MediaError::Forbidden);
        }
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| MediaError::Unavailable)?;
        let token = uuid::Builder::from_random_bytes(random)
            .into_uuid()
            .to_string();
        let download = FileDownload {
            scope: capture.scope,
            target: capture.target,
            download_token: hb::Uuid::parse(&token).map_err(|_| MediaError::Unavailable)?,
            sha256: Some(digest),
            byte_size: size,
            content_type: binding.version.content_type.clone(),
        };
        let issued = IssuedHomeboxFile {
            download: download.clone(),
            request_digest: binding.request_digest.clone(),
        };
        budget.check()?;
        self.files.push_back(OwnedHomeboxFile {
            original: original.clone(),
            grant,
            session,
            binding,
            bytes,
            download,
            expires: Instant::now()
                .checked_add(HANDLE_LIFETIME)
                .ok_or(MediaError::Unavailable)?,
        });
        Ok(issued)
    }

    /// Final stock-result release: the actual opaque issuance must still be in
    /// this broker, with exact request/data, original allocation and source pin.
    /// The host additionally checks the prepared witness/full disclosure graph.
    pub fn validate_issued<S: HomeboxFileSource>(
        &self,
        access: &mut a::AccessBoundary,
        original: &RetainedPrincipal,
        issued: &IssuedHomeboxFile,
        request: &st::ValidatedRequest,
        source: &S,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        let file = self
            .files
            .iter()
            .find(|f| f.download.download_token == issued.download.download_token)
            .ok_or(MediaError::NotFound)?;
        if !file.original.same_original(original)
            || issued.request_digest != request_digest(request)?
            || file.binding.request_digest != issued.request_digest
            || file.download.scope != issued.download.scope
            || file.download.target != issued.download.target
            || file.download.sha256 != issued.download.sha256
            || file.download.byte_size != issued.download.byte_size
            || file.download.content_type != issued.download.content_type
        {
            return Err(MediaError::Conflict);
        }
        Self::current(access, original, file, source, budget)
    }

    fn current<S: HomeboxFileSource>(
        access: &mut a::AccessBoundary,
        current: &RetainedPrincipal,
        file: &OwnedHomeboxFile,
        source: &S,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        if file.expires <= Instant::now() {
            return Err(MediaError::NotFound);
        }
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
        // Fresh caller permissions also cover the exact source owner; its new
        // allocation never replaces the retained original principal/grant.
        access
            .authorize_source(current.principal(), &file.binding.source)
            .map_err(access_error)?;
        access
            .with_read_authorization(
                file.original.principal(),
                |guard| -> Result<(), FencedError> {
                    authorize(guard, &file.original, &file.grant, budget)?;
                    source.revalidate_file(
                        guard,
                        &file.original,
                        &file.grant,
                        &file.binding,
                        budget,
                    )?;
                    authorize(guard, &file.original, &file.grant, budget)?;
                    Ok(())
                },
            )
            .map_err(FencedError::media)?;
        if file.expires <= Instant::now() {
            return Err(MediaError::NotFound);
        }
        budget.check()
    }

    /// Authenticated GET/HEAD redemption. Token supplies no authority. The
    /// fresh caller is issued by the actual GET/HEAD Media boundary; native
    /// method/session/origin checks precede selector lookup. Complete byte/header work
    /// precedes the final original-authority/source check; emit on return.
    pub fn redeem<S: HomeboxFileSource>(
        &mut self,
        access: &mut a::AccessBoundary,
        redemption: &AuthenticatedHomeboxRedemption,
        token: &str,
        source: &S,
        budget: &WorkBudget,
    ) -> MediaResult<MediaResponse> {
        let current = &redemption.principal;
        // Authenticate before even resolving a selector or retiring handles.
        access
            .revalidate(current.principal())
            .map_err(access_error)?;
        self.files.retain(|f| f.expires > Instant::now());
        let file = self
            .files
            .iter()
            .find(|f| f.download.download_token.as_str() == token)
            .ok_or(MediaError::NotFound)?;
        Self::current(access, current, file, source, budget)?;
        let body = if redemption.method == ReadMethod::Head {
            Vec::new()
        } else {
            file.bytes.clone()
        };
        let response = MediaResponse {
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
                ("content-type", file.download.content_type.clone()),
                ("content-length", file.binding.byte_size.to_string()),
                (
                    "content-disposition",
                    "attachment; filename=\"homebox-file\"".into(),
                ),
            ],
            body,
        };
        Self::current(access, current, file, source, budget)?;
        Ok(response)
    }
}
