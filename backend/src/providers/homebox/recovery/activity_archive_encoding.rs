//! Stream exact accepted codec strings without collecting a complete wire row.
use super::{activity_archive::*, activity_archive_rows::*, activity_capture::*, incompatible};
use crate::{providers::homebox::write::stock as n, storage as s};
use s::retained_native_codec_bridge as peer;
use serde::{
    Serialize, Serializer,
    ser::{Error, SerializeSeq},
};
use std::io::Write;

// A nonallocating pass bounds every variable-size source field before the
// original peer's String-returning codecs and native row conversions allocate.
// It is not an alternative native codec or a substitute for the output bound.
struct SourceSize {
    used: usize,
    limit: usize,
}
impl Write for SourceSize {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.used = self
            .used
            .checked_add(bytes.len())
            .filter(|size| *size <= self.limit)
            .ok_or_else(|| std::io::Error::other("native activity source limit"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl SourceSize {
    fn measure<T: Serialize + ?Sized>(&mut self, value: &T) -> s::Result<()> {
        serde_json::to_writer(self, value).map_err(|_| incompatible())
    }
    fn operation(&mut self, value: &n::StoredOperation) -> s::Result<()> {
        self.measure(&(
            &value.command,
            &value.plan,
            &value.actual_target,
            &value.generated_members,
            &value.outcome,
        ))
    }
    fn impact(&mut self, value: &Option<n::ImpactObservation>) -> s::Result<()> {
        if let Some(value) = value {
            self.measure(&(&value.effects, value.complete, &value.evidence_digest))?;
        }
        Ok(())
    }
    fn observation(&mut self, value: &n::NativeObservation) -> s::Result<()> {
        match value {
            n::NativeObservation::Present {
                context,
                target,
                value,
                observed_at,
                complete,
                impact,
            } => {
                self.measure(&(context, target, value, observed_at, complete))?;
                self.impact(impact)
            }
            n::NativeObservation::Absent {
                context,
                target,
                evidence_digest,
                observed_at,
                impact,
            } => {
                self.measure(&(context, target, evidence_digest, observed_at))?;
                self.impact(impact)
            }
            n::NativeObservation::Effects {
                context,
                source_instance_id,
                collection_id,
                effects,
                complete,
                evidence_digest,
                observed_at,
            } => self.measure(&(
                context,
                source_instance_id,
                collection_id,
                effects,
                complete,
                evidence_digest,
                observed_at,
            )),
            n::NativeObservation::Unavailable => Ok(()),
        }
    }
}
pub(super) fn check_source_size(
    record: &s::RetainedStockActivity,
    native: &[RetainedStockNativeEvent],
    limit: usize,
) -> s::Result<()> {
    if limit == 0 {
        return Err(incompatible());
    }
    let mut count = SourceSize { used: 0, limit };
    count.operation(record.original())?;
    count.operation(record.operation())?;
    for event in record.events() {
        count.operation(event.operation())?;
        match event.facts() {
            s::StockActivityEventFacts::Admit(cut) => {
                count.measure(&cut.evidence)?;
                count.measure(&cut.preflight.preparation.staged_upload)?;
                for snapshot in &cut.preflight.preparation.snapshots {
                    count.measure(&(
                        &snapshot.target,
                        &snapshot.value,
                        &snapshot.digest,
                        snapshot.complete,
                        snapshot.hidden_fields_preserved,
                    ))?;
                }
                for clear in &cut.preflight.preparation.native_clear_values {
                    count.measure(&(
                        &clear.command_id,
                        &clear.field,
                        &clear.native_value,
                        &clear.native_readback_value,
                    ))?;
                }
            }
            s::StockActivityEventFacts::Dispatch(facts) => count.measure(&(
                &facts.generated_target,
                &facts.generated_members,
                &facts.remote_activity,
            ))?,
            s::StockActivityEventFacts::Observation(facts) => {
                count.measure(&(&facts.known_effects, &facts.observed_at))?
            }
            _ => {}
        }
    }
    for event in native {
        count.operation(&event.before)?;
        match &event.raw {
            RawNativeCut::Dispatch { plan, result, .. } => {
                count.measure(plan)?;
                if let n::NativeDispatch::Invoked(receipt) = result {
                    count.measure(&receipt.remote_activity)?;
                    if let Some(response) = &receipt.response {
                        count.measure(&(
                            &response.value,
                            response.status,
                            &response.body_digest,
                        ))?;
                    }
                }
            }
            RawNativeCut::Observation { plan, result, .. } => {
                count.measure(plan)?;
                count.observation(result)?;
            }
        }
    }
    Ok(())
}

struct EncodedOperation<'a>(&'a n::StoredOperation);
impl Serialize for EncodedOperation<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        peer::encode_operation(self.0)
            .map_err(S::Error::custom)?
            .serialize(serializer)
    }
}
struct EncodedPermit<'a>(&'a n::InvocationPermit);
impl Serialize for EncodedPermit<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        peer::encode_permit(self.0)
            .map_err(S::Error::custom)?
            .serialize(serializer)
    }
}
struct EncodedFacts<'a>(&'a s::StockActivityEventFacts);
impl Serialize for EncodedFacts<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        FactRow::encode(self.0)
            .map_err(S::Error::custom)?
            .serialize(serializer)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventSource<'a> {
    sequence: String,
    operation: EncodedOperation<'a>,
    facts: EncodedFacts<'a>,
}
struct EventSources<'a>(&'a [s::RetainedStockActivityEvent]);
impl Serialize for EventSources<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for event in self.0 {
            seq.serialize_element(&EventSource {
                sequence: event.sequence().to_string(),
                operation: EncodedOperation(event.operation()),
                facts: EncodedFacts(event.facts()),
            })?;
        }
        seq.end()
    }
}
struct NativeSources<'a>(&'a [RetainedStockNativeEvent]);
impl Serialize for NativeSources<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for event in self.0 {
            seq.serialize_element(&NativeRow::encode(event).map_err(S::Error::custom)?)?;
        }
        seq.end()
    }
}
// Field order and representations match the closed PacketRow decoder exactly.
// Only individual accepted codec strings/native rows are materialized at once.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PacketSource<'a> {
    format: &'static str,
    writer_commit: &'static str,
    storage_commit: &'static str,
    registration: RegistrationRow,
    original: EncodedOperation<'a>,
    operation: EncodedOperation<'a>,
    permit: Option<EncodedPermit<'a>>,
    body_accepted: bool,
    physical_hold: bool,
    events: EventSources<'a>,
    native: NativeSources<'a>,
}
struct BoundedOutput {
    bytes: Vec<u8>,
    limit: usize,
}
impl Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self
            .bytes
            .len()
            .checked_add(bytes.len())
            .is_none_or(|size| size > self.limit)
        {
            return Err(std::io::Error::other("native activity archive limit"));
        }
        let needed = self.bytes.len() + bytes.len();
        if needed > self.bytes.capacity() {
            let capacity = self
                .bytes
                .capacity()
                .saturating_mul(2)
                .max(needed)
                .min(self.limit);
            self.bytes
                .try_reserve_exact(capacity - self.bytes.len())
                .map_err(std::io::Error::other)?;
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(super) fn encode_record(
    record: &s::RetainedStockActivity,
    native: &[RetainedStockNativeEvent],
    limit: usize,
) -> s::Result<Vec<u8>> {
    let source = PacketSource {
        format: ACTIVITY_NATIVE_ARCHIVE_CODEC_V4,
        writer_commit: super::WRITER_COMMIT,
        storage_commit: ACTIVITY_ARCHIVE_STORAGE_COMMIT,
        registration: record.registration().into(),
        original: EncodedOperation(record.original()),
        operation: EncodedOperation(record.operation()),
        permit: record.permit().map(EncodedPermit),
        body_accepted: record.body_accepted(),
        physical_hold: record.physical_hold(),
        events: EventSources(record.events()),
        native: NativeSources(native),
    };
    let mut output = BoundedOutput {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut output, &source).map_err(|_| incompatible())?;
    Ok(output.bytes)
}
