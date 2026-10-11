//! Detached, same-process custody of an originally accepted Presence command.
//! Only a cut promoted after the full original Access commit can create this.
use crate::{
    access as a,
    app::homebox_presence::ConfiguredPresenceReleased,
    contracts::{self, stock as wire},
    domain::stock,
    providers::homebox::read as hb,
    storage as s,
};
use serde::Serialize;
use std::{
    io::{self, Write},
    sync::Arc,
};

const MAX_RAW_BYTES: usize = 512 * 1024 * 1024;
const MAX_NORMALIZED_BYTES: usize = 128 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_PUBLICATIONS: usize = 4096;
const MAX_WITNESSES: usize = 100_000;

fn incompatible() -> s::Error {
    s::Error::new(
        "schema-incompatible",
        "Original Presence history is incompatible",
    )
}
fn require(accepted: bool) -> s::Result<()> {
    if accepted {
        Ok(())
    } else {
        Err(incompatible())
    }
}

struct CountedWriter {
    bytes: usize,
    limit: usize,
}
impl Write for CountedWriter {
    fn write(&mut self, value: &[u8]) -> io::Result<usize> {
        self.bytes = self
            .bytes
            .checked_add(value.len())
            .ok_or_else(|| io::Error::other("size"))?;
        if self.bytes > self.limit {
            return Err(io::Error::other("size"));
        }
        Ok(value.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn bounded<T: Serialize + ?Sized>(value: &T, limit: usize) -> s::Result<usize> {
    let mut writer = CountedWriter { bytes: 0, limit };
    serde_json::to_writer(&mut writer, value).map_err(|_| incompatible())?;
    Ok(writer.bytes)
}

struct OriginalPublication {
    native: hb::NativePresenceIdentity,
    complete: hb::CompleteGeneration,
    normalized: s::CacheGeneration,
    registration: s::SourceRegistration,
    metadata: a::SourceAuthorityMetadata,
    source: a::SourceRef,
    partition: a::SourcePartition,
    access_package_version: String,
    successor_epoch: u64,
}

/// An opaque archive from one successful original stock command. It retains
/// native bytes and immutable facts, never a principal, grant, database handle,
/// provider reader, credential, or current configuration authority.
pub struct RecordedPresenceHistory {
    frame: s::StockPresenceAcceptedFrame,
    request: stock::ValidatedRequest,
    publications: Vec<OriginalPublication>,
    raw_bytes: usize,
    normalized_bytes: usize,
}

/// Refuse unsupported predecessor history and oversized or unverifiable native
/// captures before any new command can mutate Storage. This issues no history
/// evidence; only the later fully accepted cut can do that.
pub(crate) fn validate_publications_for_archive(
    publications: &[&ConfiguredPresenceReleased<'_, '_>],
) -> s::Result<(usize, usize)> {
    require(!publications.is_empty() && publications.len() <= MAX_PUBLICATIONS)?;
    let mut raw_bytes = 0usize;
    let mut normalized_bytes = 0usize;
    for publication in publications {
        let native = publication.retain_native_identity();
        let complete = publication.normalized_generation();
        let origin = publication.origin();
        let committed = publication.committed();
        // Without an archived predecessor, missing IDs and quarantine have no
        // independently verifiable historical meaning.
        require(
            origin.baseline_generation_id().is_none()
                && origin.baseline_cache_epoch().value() == 0
                && complete.missing_external_ids().is_empty()
                && !complete.quarantine(),
        )?;
        for response in native.generation().responses() {
            raw_bytes = raw_bytes
                .checked_add(response.body().len())
                .ok_or_else(incompatible)?;
            require(raw_bytes <= MAX_RAW_BYTES)?;
        }
        let remaining = MAX_NORMALIZED_BYTES
            .checked_sub(normalized_bytes)
            .ok_or_else(incompatible)?;
        normalized_bytes = normalized_bytes
            .checked_add(bounded(
                &(
                    complete,
                    committed.generation(),
                    committed.registration(),
                    origin.source_metadata().access_epoch(),
                    origin.source_metadata().source_registration_version(),
                    origin.source_metadata().source_registration_sha256(),
                ),
                remaining,
            )?)
            .ok_or_else(incompatible)?;
        require(normalized_bytes <= MAX_NORMALIZED_BYTES)?;
        let registration: hb::SourceRegistration = serde_json::from_value(
            serde_json::to_value(committed.registration()).map_err(|_| incompatible())?,
        )
        .map_err(|_| incompatible())?;
        native
            .validate_retained_generation(&registration, complete)
            .map_err(|_| incompatible())?;
        require(
            committed.registration() == origin.registration()
                && committed.generation().network_relations.is_empty()
                && complete.cache().generation_id.as_ref().map(|v| v.as_str())
                    == committed.cache().generation_id.as_deref()
                && origin.original_source().reference().partition()
                    == *origin.original_partition().partition()
                && committed.cache().partition() == *origin.partition(),
        )?;
    }
    Ok((raw_bytes, normalized_bytes))
}

/// Public composition entry: only opaque records minted from original accepted
/// cuts can populate this catalog. It does not issue current authority.
pub fn catalog_from_accepted(
    entries: Vec<Arc<RecordedPresenceHistory>>,
) -> s::Result<s::PresenceHistoryCatalog> {
    s::PresenceHistoryCatalog::from_accepted(entries)
}

impl RecordedPresenceHistory {
    pub(crate) fn from_accepted(cut: s::StockPresenceAcceptedCut<'_, '_, '_>) -> s::Result<Self> {
        let publications = cut.publications();
        let (raw_bytes, normalized_bytes) = validate_publications_for_archive(publications)?;
        let frame = cut.frame();
        require(frame.witnesses().len() <= MAX_WITNESSES)?;
        bounded(
            &(
                cut.original_request().raw(),
                frame.commit(),
                frame.candidate(),
                frame.precommit(),
                frame.command_hashes(),
                frame.batch_hash(),
                frame.witnesses(),
            ),
            MAX_FRAME_BYTES,
        )?;
        require(cut.original_request().raw() == &frame.commit().original_request)?;

        let mut originals = Vec::with_capacity(publications.len());
        for publication in publications {
            let native = publication.retain_native_identity();
            let complete = publication.normalized_generation();
            let origin = publication.origin();
            let committed = publication.committed();
            originals.push(OriginalPublication {
                native,
                complete: complete.clone(),
                normalized: committed.generation().clone(),
                registration: committed.registration().clone(),
                metadata: origin.source_metadata().clone(),
                source: origin.original_source().reference().clone(),
                partition: origin.original_partition().partition().clone(),
                access_package_version: publication.native_access_package_version().to_owned(),
                successor_epoch: committed.successor_cache_epoch(),
            });
        }
        let request = cut.original_request().clone();
        Ok(Self {
            frame: cut.into_history_frame(),
            request,
            publications: originals,
            raw_bytes,
            normalized_bytes,
        })
    }

    pub fn frame(&self) -> &s::StockPresenceAcceptedFrame {
        &self.frame
    }
    pub fn request(&self) -> &stock::ValidatedRequest {
        &self.request
    }
    pub fn capture_sizes(&self) -> (usize, usize) {
        (self.raw_bytes, self.normalized_bytes)
    }

    /// Validate one witness against this independently retained original
    /// command and native read. Current grants or cache rows play no role.
    pub fn validate_original_observation(
        &self,
        witness: &wire::PresenceWitness,
        record: &s::Record,
        prior: Option<&s::Record>,
        check: &mut dyn FnMut() -> s::Result<()>,
    ) -> s::Result<()> {
        check()?;
        require(
            self.frame
                .witnesses()
                .iter()
                .filter(|saved| *saved == witness)
                .count()
                == 1,
        )?;
        require(
            self.request.raw() == &self.frame.commit().original_request
                && self.request.intent_digest() == self.frame.commit().request_digest
                && !self.frame.commit().replayed
                && self.frame.candidate().context_id == witness.authority.context_id
                && self.frame.precommit().context_id == witness.authority.context_id
                && record.workspace_id == witness.workspace_id
                && record.home_id == witness.home_id
                && record.record_id == witness.binding_record_id
                && record.payload["source"]
                    == serde_json::to_value(&witness.source).map_err(|_| incompatible())?
                && prior.is_none_or(|prior| prior.scope() == record.scope()),
        )?;
        let linked = self
            .frame
            .commit()
            .groups
            .iter()
            .flat_map(|group| &group.native_results)
            .filter(|result| {
                result.record == *record
                    && result.audit.audit_id == witness.audit_id
                    && result.audit.actor_id == witness.actor_id
                    && result.audit.mutation_id == witness.mutation_id
            })
            .count();
        require(linked == 1)?;
        let source = witness.source_ref();
        let mut matches = self.publications.iter().filter(|saved| {
            saved.registration.workspace_id == witness.workspace_id
                && saved.registration.home_id == witness.home_id
                && saved.registration.source_instance_id == witness.source.source_instance_id
                && saved.registration.collection_id == witness.source.collection_id
        });
        let saved = matches.next().ok_or_else(incompatible)?;
        require(matches.next().is_none())?;
        let source_ref: a::SourceRef =
            serde_json::from_value(serde_json::to_value(&source).map_err(|_| incompatible())?)
                .map_err(|_| incompatible())?;
        require(
            saved.source == source_ref
                && saved.partition.workspace_id.as_str() == witness.workspace_id
                && saved.partition.home_id.as_str() == witness.home_id
                && saved.registration.partition().source_instance_id
                    == witness.source.source_instance_id
                && saved.normalized.cache.generation_id.as_deref()
                    == Some(witness.cache.generation_id.as_str())
                && saved.normalized.cache.last_successful_fetch_at.as_deref()
                    == Some(witness.observed_at.as_str())
                && Some(saved.successor_epoch) == witness.cache.cache_epoch.as_number().as_u64()
                && saved.metadata.access_epoch() == witness.authority.access_epoch
                && saved.metadata.source_registration_version()
                    == witness
                        .authority
                        .source_registration_version
                        .as_number()
                        .as_u64()
                        .ok_or_else(incompatible)?
                && saved.metadata.source_registration_sha256()
                    == witness.authority.source_registration_sha256
                && witness.authority.access_package_version == saved.access_package_version,
        )?;
        let registration: hb::SourceRegistration = serde_json::from_value(
            serde_json::to_value(&saved.registration).map_err(|_| incompatible())?,
        )
        .map_err(|_| incompatible())?;
        saved
            .native
            .validate_retained_generation(&registration, &saved.complete)
            .map_err(|_| incompatible())?;
        let source_value = serde_json::to_value(&witness.source).map_err(|_| incompatible())?;
        let mut members = saved
            .normalized
            .homebox_entities
            .iter()
            .filter(|row| row["source"] == source_value);
        let member = members.next().ok_or_else(incompatible)?;
        require(members.next().is_none())?;
        let wire::PresenceObservation::HomeboxEntity {
            member_sha256,
            member_retrieved_at,
            source_updated_at,
        } = &witness.observation
        else {
            return Err(incompatible());
        };
        let digest = contracts::semantics::canonical_digest(member).map_err(|_| incompatible())?;
        require(
            member["entity"]["id"] == witness.source.external_id
                && member["entity"]["archived"] == false
                && digest == *member_sha256
                && member["retrievedAt"] == *member_retrieved_at
                && member["sourceUpdatedAt"]
                    == serde_json::to_value(source_updated_at).map_err(|_| incompatible())?,
        )?;
        check()
    }
}
