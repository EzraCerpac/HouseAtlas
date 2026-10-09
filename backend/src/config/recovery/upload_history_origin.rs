//! Dedicated producer signatures over bounded original-upload catalog bytes.
//! The independently selected key, issuer and archive destination are trust
//! inputs. A valid signature neither approves recovery nor reconstructs owners.
use crate::{
    app::homebox_queued_upload_history_catalog::{
        ProducedQueuedUploadHistoryCatalog, UnadmittedQueuedUploadHistoryCatalog,
    },
    lifecycle::provider_dispatch::archive::{ArchiveDestination, PrivateStockArchive},
    media::WorkBudget,
    storage::{self, Error},
};
use ring::signature::{ED25519, Ed25519KeyPair, UnparsedPublicKey};
use sha2::{Digest, Sha256};
use std::os::unix::ffi::OsStrExt;

const MAGIC: &[u8] = b"houseatlas-queued-upload-catalog-ed25519-sha256/1\0";
const ENVELOPE_MAX: usize = 5 * 1024 * 1024;
const CATALOG_MAX: usize = 4 * 1024 * 1024;
const ISSUER_MAX: usize = 128;
const PATH_MAX: usize = 4096;
const KEY_MAX: usize = 4096;
const CHUNK: usize = 64 * 1024;

fn invalid() -> Error {
    Error::new(
        "upload-history-origin-invalid",
        "Upload history origin could not be qualified",
    )
}
fn unavailable() -> Error {
    Error::new(
        "upload-history-origin-unavailable",
        "Upload history origin work could not complete",
    )
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn valid_issuer(issuer: &str) -> bool {
    !issuer.is_empty() && issuer.len() <= ISSUER_MAX
}
fn valid_origin(origin: &ArchiveDestination) -> bool {
    origin.directory().is_absolute()
        && !origin.directory().as_os_str().as_bytes().is_empty()
        && origin.directory().as_os_str().as_bytes().len() <= PATH_MAX
}
fn digest(bytes: &[u8], budget: &WorkBudget) -> storage::Result<[u8; 32]> {
    let mut hash = Sha256::new();
    for chunk in bytes.chunks(CHUNK) {
        check(budget)?;
        hash.update(chunk);
    }
    check(budget)?;
    Ok(hash.finalize().into())
}

/// Explicit dedicated private producer key; no environment or file key loader.
/// Construction does not approve an archive or release a recovery operation.
pub struct TrustedUploadHistoryOriginSigner {
    key: Ed25519KeyPair,
    issuer_id: String,
    origin: ArchiveDestination,
    envelope_limit: usize,
}
impl TrustedUploadHistoryOriginSigner {
    pub fn new(
        pkcs8: &[u8],
        issuer_id: String,
        archive: &PrivateStockArchive,
    ) -> storage::Result<Self> {
        if pkcs8.is_empty()
            || pkcs8.len() > KEY_MAX
            || !valid_issuer(&issuer_id)
            || !valid_origin(archive.destination())
        {
            return Err(invalid());
        }
        let key = Ed25519KeyPair::from_pkcs8(pkcs8).map_err(|_| invalid())?;
        Ok(Self {
            key,
            issuer_id,
            origin: archive.destination().clone(),
            envelope_limit: archive.max_frame_bytes().min(ENVELOPE_MAX),
        })
    }

    /// Consumes an actual producer catalog. There is no arbitrary-byte signer.
    /// Ed25519 signs the SHA-256 transcript including the fixed domain/version,
    /// issuer, exact opened-directory identity and complete catalog bytes.
    pub fn sign(
        &self,
        catalog: ProducedQueuedUploadHistoryCatalog,
        budget: &WorkBudget,
    ) -> storage::Result<SignedQueuedUploadHistoryCatalog> {
        check(budget)?;
        if catalog.catalog_bytes().len() > CATALOG_MAX {
            return Err(invalid());
        }
        let path = self.origin.directory().as_os_str().as_bytes();
        let mut out = Output::new(self.envelope_limit);
        out.append(MAGIC, budget)?;
        out.field(self.issuer_id.as_bytes(), budget)?;
        out.field(path, budget)?;
        out.append(&self.origin.device().to_be_bytes(), budget)?;
        out.append(&self.origin.inode().to_be_bytes(), budget)?;
        out.append(&self.origin.owner().to_be_bytes(), budget)?;
        let catalog_len = u64::try_from(catalog.catalog_bytes().len()).map_err(|_| invalid())?;
        out.append(&catalog_len.to_be_bytes(), budget)?;
        out.append(catalog.catalog_bytes(), budget)?;
        let transcript_digest = digest(&out.bytes, budget)?;
        let signed = self.key.sign(&transcript_digest);
        check(budget)?;
        let signature: [u8; 64] = signed.as_ref().try_into().map_err(|_| invalid())?;
        out.append(&signature, budget)?;
        check(budget)?;
        Ok(SignedQueuedUploadHistoryCatalog {
            catalog,
            issuer_id: self.issuer_id.clone(),
            signature,
            origin: self.origin.clone(),
            envelope: out.bytes,
        })
    }
}

/// Genuine signed producer output, without a deserialization constructor.
pub struct SignedQueuedUploadHistoryCatalog {
    catalog: ProducedQueuedUploadHistoryCatalog,
    issuer_id: String,
    signature: [u8; 64],
    origin: ArchiveDestination,
    envelope: Vec<u8>,
}
impl SignedQueuedUploadHistoryCatalog {
    pub fn catalog(&self) -> &ProducedQueuedUploadHistoryCatalog {
        &self.catalog
    }
    pub fn issuer_id(&self) -> &str {
        &self.issuer_id
    }
    pub fn signature(&self) -> &[u8; 64] {
        &self.signature
    }
    pub fn origin(&self) -> &ArchiveDestination {
        &self.origin
    }
    pub fn envelope_bytes(&self) -> &[u8] {
        &self.envelope
    }
    pub fn matches_destination(&self, destination: &ArchiveDestination) -> bool {
        &self.origin == destination
    }
}

/// Independently pinned verification settings, never read from the envelope.
pub struct TrustedUploadHistoryOriginVerifier {
    public_key: [u8; 32],
    issuer_id: String,
    expected_origin: ArchiveDestination,
}
impl TrustedUploadHistoryOriginVerifier {
    pub fn new(
        public_key: [u8; 32],
        issuer_id: String,
        expected_origin: ArchiveDestination,
    ) -> storage::Result<Self> {
        if !valid_issuer(&issuer_id) || !valid_origin(&expected_origin) {
            return Err(invalid());
        }
        Ok(Self {
            public_key,
            issuer_id,
            expected_origin,
        })
    }

    pub fn verify<'a>(
        &'a self,
        envelope: &'a [u8],
        budget: &WorkBudget,
    ) -> storage::Result<VerifiedQueuedUploadHistoryCatalog<'a>> {
        let parsed = UnadmittedSignedQueuedUploadHistoryCatalog::parse(envelope, budget)?;
        if parsed.issuer_id != self.issuer_id
            || !parsed.origin.matches_destination(&self.expected_origin)
        {
            return Err(invalid());
        }
        let transcript_digest = digest(&envelope[..parsed.signed_length], budget)?;
        UnparsedPublicKey::new(&ED25519, self.public_key)
            .verify(&transcript_digest, parsed.signature)
            .map_err(|_| invalid())?;
        check(budget)?;
        let catalog_digest = digest(parsed.catalog_bytes(), budget)?;
        let public_key_fingerprint = digest(&self.public_key, budget)?;
        check(budget)?;
        Ok(VerifiedQueuedUploadHistoryCatalog {
            parsed,
            expected_origin: &self.expected_origin,
            digest: catalog_digest,
            public_key_fingerprint,
        })
    }
}

/// Untrusted envelope framing DATA. This parser does not verify a signature or
/// select trust settings, and cannot construct a verified producer result.
pub struct UnadmittedSignedQueuedUploadHistoryCatalog<'a> {
    catalog: UnadmittedQueuedUploadHistoryCatalog<'a>,
    catalog_bytes: &'a [u8],
    envelope: &'a [u8],
    signature: &'a [u8; 64],
    issuer_id: &'a str,
    origin: UploadHistoryArchiveOrigin<'a>,
    signed_length: usize,
}
impl<'a> UnadmittedSignedQueuedUploadHistoryCatalog<'a> {
    pub fn parse(envelope: &'a [u8], budget: &WorkBudget) -> storage::Result<Self> {
        check(budget)?;
        if envelope.len() > ENVELOPE_MAX || !envelope.starts_with(MAGIC) {
            return Err(invalid());
        }
        let mut reader = Reader {
            bytes: envelope,
            at: MAGIC.len(),
        };
        let issuer_id = std::str::from_utf8(reader.field(ISSUER_MAX)?).map_err(|_| invalid())?;
        let directory_bytes = reader.field(PATH_MAX)?;
        let origin = UploadHistoryArchiveOrigin {
            directory_bytes,
            device: reader.u64()?,
            inode: reader.u64()?,
            owner: reader.u32()?,
        };
        // Only absolute raw Unix paths are emitted by the genuine producer.
        // The exact path is still untrusted DATA until independent pin matching.
        if !directory_bytes.starts_with(b"/") || directory_bytes.contains(&0) {
            return Err(invalid());
        }
        let length = usize::try_from(reader.u64()?).map_err(|_| invalid())?;
        if length > CATALOG_MAX {
            return Err(invalid());
        }
        let catalog_bytes = reader.take(length)?;
        let signed_length = reader.at;
        let signature: &[u8; 64] = reader.take(64)?.try_into().map_err(|_| invalid())?;
        if reader.at != envelope.len() {
            return Err(invalid());
        }
        let catalog = UnadmittedQueuedUploadHistoryCatalog::parse(catalog_bytes, budget)?;
        check(budget)?;
        Ok(Self {
            catalog,
            catalog_bytes,
            envelope,
            signature,
            issuer_id,
            origin,
            signed_length,
        })
    }
    pub fn catalog(&self) -> &UnadmittedQueuedUploadHistoryCatalog<'a> {
        &self.catalog
    }
    pub fn catalog_bytes(&self) -> &'a [u8] {
        self.catalog_bytes
    }
    pub fn envelope_bytes(&self) -> &'a [u8] {
        self.envelope
    }
    pub fn issuer_id(&self) -> &str {
        self.issuer_id
    }
    pub fn signature(&self) -> &[u8; 64] {
        self.signature
    }
    pub fn origin(&self) -> &UploadHistoryArchiveOrigin<'a> {
        &self.origin
    }
}

/// Borrowed comparison scalars from an unadmitted envelope, not a destination
/// constructor or a qualification of the filesystem currently at this path.
pub struct UploadHistoryArchiveOrigin<'a> {
    directory_bytes: &'a [u8],
    device: u64,
    inode: u64,
    owner: u32,
}
impl UploadHistoryArchiveOrigin<'_> {
    pub fn directory_bytes(&self) -> &[u8] {
        self.directory_bytes
    }
    pub fn device(&self) -> u64 {
        self.device
    }
    pub fn inode(&self) -> u64 {
        self.inode
    }
    pub fn owner(&self) -> u32 {
        self.owner
    }
    pub fn matches_destination(&self, destination: &ArchiveDestination) -> bool {
        self.directory_bytes == destination.directory().as_os_str().as_bytes()
            && self.device == destination.device()
            && self.inode == destination.inode()
            && self.owner == destination.owner()
    }
}

/// Signature and framing qualification only. This carries no operator approval,
/// discovery grant, historical owner, current permission or invocation permit.
pub struct VerifiedQueuedUploadHistoryCatalog<'a> {
    parsed: UnadmittedSignedQueuedUploadHistoryCatalog<'a>,
    expected_origin: &'a ArchiveDestination,
    digest: [u8; 32],
    public_key_fingerprint: [u8; 32],
}
impl<'a> VerifiedQueuedUploadHistoryCatalog<'a> {
    pub fn catalog(&self) -> &UnadmittedQueuedUploadHistoryCatalog<'a> {
        self.parsed.catalog()
    }
    pub fn catalog_bytes(&self) -> &'a [u8] {
        self.parsed.catalog_bytes()
    }
    pub fn envelope_bytes(&self) -> &'a [u8] {
        self.parsed.envelope_bytes()
    }
    pub fn registry_bytes(&self) -> &[u8] {
        self.catalog().registry_bytes()
    }
    pub fn signature(&self) -> &[u8; 64] {
        self.parsed.signature()
    }
    pub fn issuer_id(&self) -> &str {
        self.parsed.issuer_id()
    }
    pub fn expected_origin(&self) -> &ArchiveDestination {
        self.expected_origin
    }
    pub fn digest(&self) -> [u8; 32] {
        self.digest
    }
    pub fn public_key_fingerprint(&self) -> [u8; 32] {
        self.public_key_fingerprint
    }
    pub fn generation(&self) -> u64 {
        self.catalog().generation()
    }
    pub fn deployment_id(&self) -> &str {
        self.catalog().deployment_id()
    }
}

struct Output {
    bytes: Vec<u8>,
    limit: usize,
}
impl Output {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
        }
    }
    fn append(&mut self, bytes: &[u8], budget: &WorkBudget) -> storage::Result<()> {
        let end = self
            .bytes
            .len()
            .checked_add(bytes.len())
            .ok_or_else(invalid)?;
        if end > self.limit {
            return Err(invalid());
        }
        for chunk in bytes.chunks(CHUNK) {
            check(budget)?;
            self.bytes
                .try_reserve(chunk.len())
                .map_err(|_| unavailable())?;
            self.bytes.extend_from_slice(chunk);
        }
        check(budget)
    }
    fn field(&mut self, bytes: &[u8], budget: &WorkBudget) -> storage::Result<()> {
        let length = u32::try_from(bytes.len()).map_err(|_| invalid())?;
        self.append(&length.to_be_bytes(), budget)?;
        self.append(bytes, budget)
    }
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> storage::Result<&'a [u8]> {
        let end = self.at.checked_add(length).ok_or_else(invalid)?;
        let value = self.bytes.get(self.at..end).ok_or_else(invalid)?;
        self.at = end;
        Ok(value)
    }
    fn u32(&mut self) -> storage::Result<u32> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().map_err(|_| invalid())?,
        ))
    }
    fn u64(&mut self) -> storage::Result<u64> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().map_err(|_| invalid())?,
        ))
    }
    fn field(&mut self, maximum: usize) -> storage::Result<&'a [u8]> {
        let length = usize::try_from(self.u32()?).map_err(|_| invalid())?;
        if length == 0 || length > maximum {
            return Err(invalid());
        }
        self.take(length)
    }
}
