//! Bounded original-owner persistence. Decoded data never revives a producer.
use super::{
    NativeWriterContracts,
    activity_archive_rows::*,
    activity_capture::*,
    activity_validation::{self, ActivityEventView},
    incompatible, unavailable,
};
use crate::{providers::homebox::write::stock as n, storage as s};
use s::retained_native_codec_bridge as peer;

pub const ACTIVITY_NATIVE_ARCHIVE_CODEC_V4: &str = "houseatlas-homebox-stock-activity-archive/4";
pub const ACTIVITY_ARCHIVE_STORAGE_COMMIT: &str = "2befc971bd8b5590ab6b139b1163fbcd82256c66";
pub const MAX_NATIVE_ACTIVITY_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_NATIVE_ACTIVITY_ARCHIVE_EVENTS: usize = 256;

/// Required original archive owner, independent of the image. The owner must
/// authenticate actual archive origin/destination/generation and exact bytes,
/// associated original producer identity and scope, and raw native provenance.
/// Public digests, DTOs or mirrored image rows do not establish this binding.
/// No default implementation. This does not issue a grant or perform native I/O.
/// Callbacks must not reenter SQL or refresh live principal/dispatcher authority.
pub trait NativeActivityArchiveReadAuthorization {
    fn authorize_archive(&self, bytes: &[u8], cut: &RestoredNativeActivityCut) -> s::Result<()>;
}
/// Immutable encoded owner cut. Serialization supplies no archive write power;
/// the dispatcher must authorize and durably write these exact bytes before I/O.
pub struct NativeActivityArchivePacket {
    bytes: Vec<u8>,
    cut: RestoredNativeActivityCut,
}
impl NativeActivityArchivePacket {
    pub fn encode<P: s::StockActivityPrincipal>(
        contracts: &NativeWriterContracts,
        retained: &RetainedNativeStockActivity<P>,
    ) -> s::Result<Self> {
        retained.archive_ready()?;
        let record = retained.producer().record();
        if record.events().len() > MAX_NATIVE_ACTIVITY_ARCHIVE_EVENTS
            || retained.native_events().len() > MAX_NATIVE_ACTIVITY_ARCHIVE_EVENTS
        {
            return Err(incompatible());
        }
        activity_validation::validate_prefix(
            contracts,
            record,
            record.events(),
            retained.native_events(),
        )?;
        let principal = retained.producer().original().original_activity_principal();
        if principal.actor_id().as_str() != record.original().actor_id.to_string()
            || principal.scope().workspace_id.as_str()
                != record.original().command.context.workspace_id.to_string()
            || principal.scope().home_id.as_str()
                != record.original().command.context.home_id.to_string()
        {
            return Err(incompatible());
        }
        let row = PacketRow {
            format: ACTIVITY_NATIVE_ARCHIVE_CODEC_V4.into(),
            writer_commit: super::WRITER_COMMIT.into(),
            storage_commit: ACTIVITY_ARCHIVE_STORAGE_COMMIT.into(),
            registration: record.registration().into(),
            original: peer::encode_operation(record.original())?,
            operation: peer::encode_operation(record.operation())?,
            permit: record.permit().map(peer::encode_permit).transpose()?,
            body_accepted: record.body_accepted(),
            physical_hold: record.physical_hold(),
            events: record
                .events()
                .iter()
                .map(|v| {
                    Ok(EventRow {
                        sequence: v.sequence(),
                        operation: peer::encode_operation(v.operation())?,
                        facts: FactRow::encode(v.facts())?,
                    })
                })
                .collect::<s::Result<_>>()?,
            native: retained
                .native_events()
                .iter()
                .map(NativeRow::encode)
                .collect::<s::Result<_>>()?,
        };
        let bytes = encode_bounded(&row)?;
        let cut = decode_data(contracts, &bytes)?;
        // Accepted peer codecs are exact-roundtrip checked as well as the outer
        // closed packet. Compare every typed field against the actual source.
        if !cut.matches_record(record) || cut.native.len() != retained.native_events().len() {
            return Err(incompatible());
        }
        for (restored, original) in cut.native.iter().zip(retained.native_events()) {
            if NativeRow::encode(restored)? != NativeRow::encode(original)? {
                return Err(incompatible());
            }
        }
        Ok(Self { bytes, cut })
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn cut(&self) -> &RestoredNativeActivityCut {
        &self.cut
    }
    pub fn decode<'a, A: NativeActivityArchiveReadAuthorization>(
        contracts: &NativeWriterContracts,
        bytes: &[u8],
        owner_binding: &'a A,
    ) -> s::Result<RestoredNativeActivityEvidence<'a, A>> {
        let cut = decode_data(contracts, bytes)?;
        owner_binding.authorize_archive(bytes, &cut)?;
        Ok(RestoredNativeActivityEvidence {
            bytes: bytes.to_vec(),
            cut,
            owner_binding,
        })
    }
}
/// Native journal DATA reconstructed by the accepted original storage codec.
/// It is deliberately not RetainedStockActivityEvent or a live producer brand.
pub struct RestoredNativeActivityEvent {
    sequence: u64,
    operation: n::StoredOperation,
    facts: s::StockActivityEventFacts,
}
impl RestoredNativeActivityEvent {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn operation(&self) -> &n::StoredOperation {
        &self.operation
    }
    pub fn facts(&self) -> &s::StockActivityEventFacts {
        &self.facts
    }
}
impl ActivityEventView for RestoredNativeActivityEvent {
    fn sequence(&self) -> u64 {
        self.sequence
    }
    fn operation(&self) -> &n::StoredOperation {
        &self.operation
    }
    fn facts(&self) -> &s::StockActivityEventFacts {
        &self.facts
    }
}
/// Evidence-only candidate available to the independent original archive owner.
/// No public constructor, Deserialize, producer factory or access handle exists.
pub struct RestoredNativeActivityCut {
    registration: s::StockActivityRegistration,
    original: n::StoredOperation,
    operation: n::StoredOperation,
    permit: Option<n::InvocationPermit>,
    body_accepted: bool,
    physical_hold: bool,
    events: Vec<RestoredNativeActivityEvent>,
    pub(super) native: Vec<RetainedStockNativeEvent>,
}
impl RestoredNativeActivityCut {
    pub fn registration(&self) -> &s::StockActivityRegistration {
        &self.registration
    }
    pub fn original(&self) -> &n::StoredOperation {
        &self.original
    }
    pub fn operation(&self) -> &n::StoredOperation {
        &self.operation
    }
    pub fn permit(&self) -> Option<&n::InvocationPermit> {
        self.permit.as_ref()
    }
    pub fn body_accepted(&self) -> bool {
        self.body_accepted
    }
    pub fn physical_hold(&self) -> bool {
        self.physical_hold
    }
    pub fn events(&self) -> &[RestoredNativeActivityEvent] {
        &self.events
    }
    pub fn native_events(&self) -> &[RetainedStockNativeEvent] {
        &self.native
    }
    pub(super) fn matches_event(
        &self,
        index: usize,
        event: &s::RetainedStockActivityEvent,
    ) -> bool {
        self.events.get(index).is_some_and(|v| {
            v.sequence == event.sequence()
                && v.operation == *event.operation()
                && v.facts == *event.facts()
        })
    }
    pub(super) fn matches_record(&self, record: &s::RetainedStockActivity) -> bool {
        self.registration == *record.registration()
            && self.original == *record.original()
            && self.operation == *record.operation()
            && self.permit.as_ref() == record.permit()
            && self.body_accepted == record.body_accepted()
            && self.physical_hold == record.physical_hold()
            && self.events.len() == record.events().len()
            && record
                .events()
                .iter()
                .enumerate()
                .all(|(i, e)| self.matches_event(i, e))
    }
    fn validate(&self, contracts: &NativeWriterContracts) -> s::Result<()> {
        let first = self.events.first().ok_or_else(incompatible)?;
        let last = self.events.last().ok_or_else(incompatible)?;
        let permit = self.events.iter().find_map(|e| match &e.facts {
            s::StockActivityEventFacts::Admit(c) => Some(&c.permit),
            _ => None,
        });
        let hold = matches!(
            self.operation.outcome.remote_activity,
            n::RemoteActivity::Active { .. } | n::RemoteActivity::EndUnproven { .. }
        );
        let native_count = self
            .events
            .iter()
            .filter(|e| {
                matches!(
                    e.facts,
                    s::StockActivityEventFacts::Dispatch(_)
                        | s::StockActivityEventFacts::Observation(_)
                        | s::StockActivityEventFacts::NeverInvoked
                )
            })
            .count();
        if self.original != first.operation
            || self.operation != last.operation
            || self.permit.as_ref() != permit
            || self.body_accepted != permit.is_some()
            || self.physical_hold != hold
            || native_count != self.native.len()
        {
            return Err(incompatible());
        }
        activity_validation::validate_event_prefix(
            contracts,
            &self.registration,
            &self.events,
            &self.native,
        )
    }
}
fn decode_data(
    contracts: &NativeWriterContracts,
    bytes: &[u8],
) -> s::Result<RestoredNativeActivityCut> {
    if bytes.is_empty() || bytes.len() > MAX_NATIVE_ACTIVITY_ARCHIVE_BYTES {
        return Err(incompatible());
    }
    let row = parse(bytes)?;
    if row.format != ACTIVITY_NATIVE_ARCHIVE_CODEC_V4
        || row.writer_commit != super::WRITER_COMMIT
        || row.storage_commit != ACTIVITY_ARCHIVE_STORAGE_COMMIT
        || row.events.is_empty()
        || row.events.len() > MAX_NATIVE_ACTIVITY_ARCHIVE_EVENTS
        || row.native.len() > MAX_NATIVE_ACTIVITY_ARCHIVE_EVENTS
    {
        return Err(incompatible());
    }
    let cut = RestoredNativeActivityCut {
        registration: row.registration.into(),
        original: peer::decode_operation(&row.original)?,
        operation: peer::decode_operation(&row.operation)?,
        permit: row.permit.as_deref().map(peer::decode_permit).transpose()?,
        body_accepted: row.body_accepted,
        physical_hold: row.physical_hold,
        events: row
            .events
            .into_iter()
            .map(|e| {
                Ok(RestoredNativeActivityEvent {
                    sequence: e.sequence,
                    operation: peer::decode_operation(&e.operation)?,
                    facts: e.facts.decode()?,
                })
            })
            .collect::<s::Result<_>>()?,
        native: row
            .native
            .into_iter()
            .map(NativeRow::decode)
            .collect::<s::Result<_>>()?,
    };
    cut.validate(contracts)?;
    Ok(cut)
}
/// Authenticated archive data with its independent original owner binding.
/// Revalidation preserves read authority, not a restored live invocation grant.
pub struct RestoredNativeActivityEvidence<'a, A> {
    bytes: Vec<u8>,
    cut: RestoredNativeActivityCut,
    owner_binding: &'a A,
}
impl<A: NativeActivityArchiveReadAuthorization> RestoredNativeActivityEvidence<'_, A> {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn cut(&self) -> &RestoredNativeActivityCut {
        &self.cut
    }
    pub(super) fn revalidate(&self, contracts: &NativeWriterContracts) -> s::Result<()> {
        self.cut.validate(contracts)?;
        self.owner_binding.authorize_archive(&self.bytes, &self.cut)
    }
}
pub struct RestoredNativeActivityArchive<'a, A> {
    records: Vec<RestoredNativeActivityEvidence<'a, A>>,
}
impl<'a, A: NativeActivityArchiveReadAuthorization> RestoredNativeActivityArchive<'a, A> {
    pub fn new(records: Vec<RestoredNativeActivityEvidence<'a, A>>) -> s::Result<Self> {
        let mut operations = std::collections::BTreeSet::new();
        let mut events = std::collections::BTreeSet::new();
        for record in &records {
            record
                .owner_binding
                .authorize_archive(&record.bytes, &record.cut)?;
            if !operations.insert(record.cut.operation.operation_id)
                || record.cut.events.iter().any(|e| !events.insert(e.sequence))
            {
                return Err(incompatible());
            }
        }
        Ok(Self { records })
    }
    pub fn retained(
        &self,
        operation_id: uuid::Uuid,
    ) -> s::Result<&RestoredNativeActivityEvidence<'a, A>> {
        self.records
            .iter()
            .find(|r| r.cut.operation.operation_id == operation_id)
            .ok_or_else(unavailable)
    }
}

fn encode_bounded(row: &PacketRow) -> s::Result<Vec<u8>> {
    struct Bounded(Vec<u8>);
    impl std::io::Write for Bounded {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self
                .0
                .len()
                .checked_add(bytes.len())
                .is_none_or(|size| size > MAX_NATIVE_ACTIVITY_ARCHIVE_BYTES)
            {
                return Err(std::io::Error::other("native activity archive limit"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut buffer = Bounded(Vec::new());
    serde_json::to_writer(&mut buffer, row).map_err(|_| incompatible())?;
    Ok(buffer.0)
}
