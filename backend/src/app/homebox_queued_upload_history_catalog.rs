//! Ordered original-only publication catalog from genuine released Root cuts.
//! The registry is an independent complete host input, including empty queues.
//! A parsed catalog is DATA, never a complete-image or original-owner proof.
use super::{
    homebox_queued_upload_history::RecordedQueuedUploadOriginalHistory,
    homebox_queued_upload_history_publication::{
        ProducedQueuedUploadOriginalFrame, queue_registry_frame_bytes,
    },
};
use crate::{
    domain::queue_recovery::TrustedQueueRegistry, jobs::QueueConfig, media::WorkBudget, storage,
};
use sha2::{Digest, Sha256};

const MAGIC: &[u8] = b"houseatlas-upload-original-catalog/1\0";
pub const MAX_CATALOG_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CATALOG_MEMBERS: usize = 64;
pub const MAX_CATALOG_QUEUES: usize = 256;
pub const MAX_CATALOG_FRAME_BYTES: usize = 192 * 1024 * 1024;
pub const MAX_CATALOG_TOTAL_FRAME_BYTES: usize = 512 * 1024 * 1024;

pub struct ProducedUploadHistoryCatalogMember {
    queue_index: usize,
    job_id: String,
    name: String,
    sha256: [u8; 32],
    frame: ProducedQueuedUploadOriginalFrame,
}
impl ProducedUploadHistoryCatalogMember {
    pub fn queue_index(&self) -> usize {
        self.queue_index
    }
    pub fn job_id(&self) -> &str {
        &self.job_id
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn sha256(&self) -> [u8; 32] {
        self.sha256
    }
    pub fn byte_size(&self) -> u64 {
        self.frame.original_bytes().len() as u64
    }
    pub fn frame_bytes(&self) -> &[u8] {
        self.frame.original_bytes()
    }
}
/// No arbitrary-frame constructor: every member is produced from its actual
/// closed Root history while all owner comparisons remain immutable. Supplied
/// order is explicit catalog order, not inferred SQL or event chronology.
pub struct ProducedQueuedUploadHistoryCatalog {
    generation: u64,
    deployment_id: String,
    registry: TrustedQueueRegistry,
    registry_bytes: Vec<u8>,
    members: Vec<ProducedUploadHistoryCatalogMember>,
    bytes: Vec<u8>,
}
impl ProducedQueuedUploadHistoryCatalog {
    pub fn capture(
        generation: u64,
        deployment_id: &str,
        registry: &[QueueConfig],
        originals: &[&RecordedQueuedUploadOriginalHistory],
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        check(budget)?;
        validate_text(deployment_id)?;
        if generation == 0
            || registry.len() > MAX_CATALOG_QUEUES
            || originals.len() > MAX_CATALOG_MEMBERS
        {
            return Err(unavailable());
        }
        let registry_bytes = registry_bytes(registry, budget)?;
        if registry
            .iter()
            .any(|q| q.registration.identity.deployment_id != deployment_id)
        {
            return Err(unavailable());
        }
        // Bound encoding before cloning the complete registry or history facts.
        let registry = TrustedQueueRegistry::new(registry)?;
        check(budget)?;
        let mut members = Vec::new();
        members
            .try_reserve_exact(originals.len())
            .map_err(|_| unavailable())?;
        let mut total = 0usize;
        for history in originals {
            check(budget)?;
            let config = history.storage().config();
            let queue_index = registry
                .configs()
                .iter()
                .position(|q| q == config)
                .ok_or_else(unavailable)?;
            let job_id = &history.storage().initial_claim().lease.job_id.0;
            validate_text(job_id)?;
            if members
                .iter()
                .any(|m: &ProducedUploadHistoryCatalogMember| {
                    m.queue_index == queue_index && m.job_id == *job_id
                })
            {
                return Err(unavailable());
            }
            let frame = ProducedQueuedUploadOriginalFrame::capture(history, budget)?;
            total = total
                .checked_add(frame.original_bytes().len())
                .ok_or_else(unavailable)?;
            if total > MAX_CATALOG_TOTAL_FRAME_BYTES {
                return Err(unavailable());
            }
            let sha256 = hash_bytes(frame.original_bytes(), budget)?;
            let name = member_name(sha256);
            // Duplicate bytes may not stand in for a second original record.
            if members.iter().any(|m| m.name == name) {
                return Err(unavailable());
            }
            members.push(ProducedUploadHistoryCatalogMember {
                queue_index,
                job_id: job_id.clone(),
                name,
                sha256,
                frame,
            });
        }
        let mut out = Writer::new(budget);
        out.append(MAGIC)?;
        out.append(&generation.to_be_bytes())?;
        out.text(deployment_id)?;
        out.append(&(registry.configs().len() as u16).to_be_bytes())?;
        out.append(
            &u32::try_from(registry_bytes.len())
                .map_err(|_| unavailable())?
                .to_be_bytes(),
        )?;
        out.append(&registry_bytes)?;
        out.append(&(members.len() as u16).to_be_bytes())?;
        for m in &members {
            out.append(&(m.queue_index as u16).to_be_bytes())?;
            out.text(&m.job_id)?;
            out.text(&m.name)?;
            out.append(&m.byte_size().to_be_bytes())?;
            out.append(&m.sha256)?;
        }
        check(budget)?;
        Ok(Self {
            generation,
            deployment_id: deployment_id.to_owned(),
            registry,
            registry_bytes,
            members,
            bytes: out.bytes,
        })
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn deployment_id(&self) -> &str {
        &self.deployment_id
    }
    pub fn registry(&self) -> &[QueueConfig] {
        self.registry.configs()
    }
    pub fn registry_bytes(&self) -> &[u8] {
        &self.registry_bytes
    }
    pub fn members(&self) -> &[ProducedUploadHistoryCatalogMember] {
        &self.members
    }
    pub fn catalog_bytes(&self) -> &[u8] {
        &self.bytes
    }
}
/// Opaque signature-independent comparison DATA. No semantic QueueConfig or
/// history owner is reconstructed from its registry/frame declarations.
pub struct UnadmittedQueuedUploadHistoryCatalog<'a> {
    bytes: &'a [u8],
    generation: u64,
    deployment_id: &'a str,
    registry_bytes: &'a [u8],
    queue_count: usize,
    members: Vec<UnadmittedUploadHistoryCatalogMember<'a>>,
}
pub struct UnadmittedUploadHistoryCatalogMember<'a> {
    queue_index: usize,
    job_id: &'a str,
    name: &'a str,
    byte_size: u64,
    sha256: [u8; 32],
}
impl UnadmittedUploadHistoryCatalogMember<'_> {
    pub fn queue_index(&self) -> usize {
        self.queue_index
    }
    pub fn job_id(&self) -> &str {
        self.job_id
    }
    pub fn name(&self) -> &str {
        self.name
    }
    pub fn byte_size(&self) -> u64 {
        self.byte_size
    }
    pub fn sha256(&self) -> [u8; 32] {
        self.sha256
    }
}
impl<'a> UnadmittedQueuedUploadHistoryCatalog<'a> {
    pub fn parse(bytes: &'a [u8], budget: &WorkBudget) -> storage::Result<Self> {
        check(budget)?;
        if bytes.len() > MAX_CATALOG_BYTES || !bytes.starts_with(MAGIC) {
            return Err(unavailable());
        }
        let mut reader = Reader {
            rest: &bytes[MAGIC.len()..],
        };
        let generation = reader.u64()?;
        if generation == 0 {
            return Err(unavailable());
        }
        let deployment_id = reader.text()?;
        let queue_count = reader.u16()? as usize;
        if queue_count > MAX_CATALOG_QUEUES {
            return Err(unavailable());
        }
        let len = reader.u32()? as usize;
        let registry_bytes = reader.take(len)?;
        if len > MAX_CATALOG_BYTES
            || registry_bytes.len() < 8
            || u64::from_be_bytes(registry_bytes[..8].try_into().map_err(|_| unavailable())?)
                != queue_count as u64
        {
            return Err(unavailable());
        }
        let count = reader.u16()? as usize;
        if count > MAX_CATALOG_MEMBERS {
            return Err(unavailable());
        }
        let mut members = Vec::new();
        members
            .try_reserve_exact(count)
            .map_err(|_| unavailable())?;
        let mut total = 0u64;
        for _ in 0..count {
            check(budget)?;
            let queue_index = reader.u16()? as usize;
            let job_id = reader.text()?;
            let name = reader.text()?;
            let byte_size = reader.u64()?;
            let sha256 = reader.take(32)?.try_into().map_err(|_| unavailable())?;
            total = total.checked_add(byte_size).ok_or_else(unavailable)?;
            if queue_index >= queue_count
                || byte_size == 0
                || byte_size > MAX_CATALOG_FRAME_BYTES as u64
                || total > MAX_CATALOG_TOTAL_FRAME_BYTES as u64
                || name != member_name(sha256)
                || members
                    .iter()
                    .any(|m: &UnadmittedUploadHistoryCatalogMember<'_>| {
                        m.name == name || m.queue_index == queue_index && m.job_id == job_id
                    })
            {
                return Err(unavailable());
            }
            members.push(UnadmittedUploadHistoryCatalogMember {
                queue_index,
                job_id,
                name,
                byte_size,
                sha256,
            });
        }
        if !reader.rest.is_empty() {
            return Err(unavailable());
        }
        check(budget)?;
        Ok(Self {
            bytes,
            generation,
            deployment_id,
            registry_bytes,
            queue_count,
            members,
        })
    }
    pub fn catalog_bytes(&self) -> &'a [u8] {
        self.bytes
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn deployment_id(&self) -> &'a str {
        self.deployment_id
    }
    pub fn registry_bytes(&self) -> &'a [u8] {
        self.registry_bytes
    }
    pub fn queue_count(&self) -> usize {
        self.queue_count
    }
    pub fn members(&self) -> &[UnadmittedUploadHistoryCatalogMember<'a>] {
        &self.members
    }
    pub fn matches_registry(
        &self,
        registry: &[QueueConfig],
        budget: &WorkBudget,
    ) -> storage::Result<bool> {
        let expected = registry_bytes(registry, budget)?;
        equal_bytes(self.registry_bytes, &expected, budget)
    }
}
/// Independent host registry encoding; used only for exact comparison. Neither
/// this byte string nor a parsed equivalent can confer administrative approval.
pub fn registry_bytes(configs: &[QueueConfig], budget: &WorkBudget) -> storage::Result<Vec<u8>> {
    check(budget)?;
    if configs.len() > MAX_CATALOG_QUEUES {
        return Err(unavailable());
    }
    // Bound the existing registry's duplicate-alias comparisons before calling
    // its validator. These are publication input limits, not ordinary limits.
    let mut alias_count = 0usize;
    for config in configs {
        check(budget)?;
        let count = config.registration.aliases.len();
        alias_count = alias_count.checked_add(count).ok_or_else(unavailable)?;
        if count > 256 || alias_count > 1024 {
            return Err(unavailable());
        }
    }
    let bytes = queue_registry_frame_bytes(configs, budget)?;
    // Existing registry rejects duplicate physical IDs/alias registrations;
    // its clone happens only after bounded complete input encoding.
    TrustedQueueRegistry::new(configs)?;
    check(budget)?;
    Ok(bytes)
}
pub fn hash_bytes(bytes: &[u8], budget: &WorkBudget) -> storage::Result<[u8; 32]> {
    let mut hash = Sha256::new();
    for part in bytes.chunks(64 * 1024) {
        check(budget)?;
        hash.update(part);
    }
    check(budget)?;
    Ok(hash.finalize().into())
}
pub fn equal_bytes(left: &[u8], right: &[u8], budget: &WorkBudget) -> storage::Result<bool> {
    check(budget)?;
    if left.len() != right.len() {
        return Ok(false);
    }
    for (a, b) in left.chunks(64 * 1024).zip(right.chunks(64 * 1024)) {
        check(budget)?;
        if a != b {
            return Ok(false);
        }
    }
    check(budget)?;
    Ok(true)
}
fn member_name(digest: [u8; 32]) -> String {
    let mut name = String::from("upload-history-");
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(name, "{byte:02x}");
    }
    name.push_str(".frame");
    name
}
fn validate_text(value: &str) -> storage::Result<()> {
    if value.is_empty() || value.len() > 4096 {
        Err(unavailable())
    } else {
        Ok(())
    }
}
struct Writer<'a> {
    bytes: Vec<u8>,
    budget: &'a WorkBudget,
}
impl<'a> Writer<'a> {
    fn new(budget: &'a WorkBudget) -> Self {
        Self {
            bytes: Vec::new(),
            budget,
        }
    }
    fn append(&mut self, value: &[u8]) -> storage::Result<()> {
        check(self.budget)?;
        if self
            .bytes
            .len()
            .checked_add(value.len())
            .ok_or_else(unavailable)?
            > MAX_CATALOG_BYTES
        {
            return Err(unavailable());
        }
        self.bytes
            .try_reserve(value.len())
            .map_err(|_| unavailable())?;
        for part in value.chunks(64 * 1024) {
            check(self.budget)?;
            self.bytes.extend_from_slice(part);
        }
        check(self.budget)
    }
    fn text(&mut self, value: &str) -> storage::Result<()> {
        validate_text(value)?;
        self.append(&(value.len() as u16).to_be_bytes())?;
        self.append(value.as_bytes())
    }
}
struct Reader<'a> {
    rest: &'a [u8],
}
impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> storage::Result<&'a [u8]> {
        let value = self.rest.get(..len).ok_or_else(unavailable)?;
        self.rest = self.rest.get(len..).ok_or_else(unavailable)?;
        Ok(value)
    }
    fn u16(&mut self) -> storage::Result<u16> {
        Ok(u16::from_be_bytes(
            self.take(2)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn u32(&mut self) -> storage::Result<u32> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn u64(&mut self) -> storage::Result<u64> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn text(&mut self) -> storage::Result<&'a str> {
        let len = self.u16()? as usize;
        let value = std::str::from_utf8(self.take(len)?).map_err(|_| unavailable())?;
        validate_text(value)?;
        Ok(value)
    }
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn unavailable() -> storage::Error {
    storage::Error::new("owner-unavailable", "Upload history catalog unavailable")
}
