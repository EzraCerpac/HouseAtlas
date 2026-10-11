//! Immutable same-process catalog made only from fully accepted owner cuts.
//! Its facts support strict history checks; they never revive mutation authority.
use super::super::{
    presence_validation::{self, OriginalPresenceHistoryEvidence},
    repository as repo, stock_repository, *,
};
use super::stock_presence::bounded_size;
use crate::{app::homebox_presence_history::RecordedPresenceHistory, contracts::stock as wire};
use rusqlite::{Connection, OptionalExtension, params};
use std::{collections::BTreeMap, sync::Arc};

type WitnessKey = (String, String, u64);
const MAX_ENTRIES: usize = 4_096;
const MAX_WITNESSES: usize = 100_000;
const MAX_RAW_BYTES: usize = 512 * 1024 * 1024;
const MAX_NORMALIZED_BYTES: usize = 128 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// No serde, Clone, caller row constructor, or successful evidence callback.
/// The nonempty constructor is crate-only and accepts the Root owner's sealed
/// post-Access records, retaining their original Native allocation.
pub struct PresenceHistoryCatalog {
    entries: Vec<Arc<RecordedPresenceHistory>>,
    witnesses: BTreeMap<WitnessKey, (usize, wire::PresenceWitness)>,
    commits: BTreeMap<(String, String, String, String), usize>,
}
impl PresenceHistoryCatalog {
    pub fn empty() -> Self {
        Self {
            entries: Vec::new(),
            witnesses: BTreeMap::new(),
            commits: BTreeMap::new(),
        }
    }

    pub(crate) fn from_accepted(entries: Vec<Arc<RecordedPresenceHistory>>) -> Result<Self> {
        if entries.len() > MAX_ENTRIES {
            return Err(incompatible());
        }
        let mut witnesses = BTreeMap::new();
        let mut commits = BTreeMap::new();
        let mut raw_total = 0_usize;
        let mut normalized_total = 0_usize;
        let mut frame_total = 0_usize;
        for (index, entry) in entries.iter().enumerate() {
            let frame = entry.frame();
            let commit = frame.commit();
            let scope = &frame.precommit().scope;
            if commit.replayed
                || commit.original_request != *entry.request().raw()
                || commit.request_digest != entry.request().intent_digest()
                || frame.candidate().phase != MutationPhase::Candidate
                || frame.precommit().phase != MutationPhase::Precommit
                || frame.candidate().context_id != frame.precommit().context_id
                || frame.candidate().scope != frame.precommit().scope
                || frame.witnesses().is_empty()
                || frame.witnesses().len() > 100
                || commits
                    .insert(
                        (
                            scope.workspace_id.clone(),
                            scope.home_id.clone(),
                            commit.actor_id.clone(),
                            commit.operation_id.clone(),
                        ),
                        index,
                    )
                    .is_some()
            {
                return Err(incompatible());
            }
            let (raw, normalized) = entry.capture_sizes();
            raw_total = raw_total.checked_add(raw).ok_or_else(incompatible)?;
            normalized_total = normalized_total
                .checked_add(normalized)
                .ok_or_else(incompatible)?;
            frame_total = frame_total
                .checked_add(bounded_size(frame.precommit(), MAX_FRAME_BYTES)?)
                .ok_or_else(incompatible)?;
            frame_total = frame_total
                .checked_add(bounded_size(frame.candidate(), MAX_FRAME_BYTES)?)
                .ok_or_else(incompatible)?;
            frame_total = frame_total
                .checked_add(bounded_size(commit, MAX_FRAME_BYTES)?)
                .ok_or_else(incompatible)?;
            frame_total = frame_total
                .checked_add(bounded_size(frame.witnesses(), MAX_FRAME_BYTES)?)
                .ok_or_else(incompatible)?;
            if raw_total > MAX_RAW_BYTES
                || normalized_total > MAX_NORMALIZED_BYTES
                || frame_total > MAX_FRAME_BYTES
            {
                return Err(incompatible());
            }
            for witness in frame.witnesses() {
                let key = witness_key(witness)?;
                if witnesses.insert(key, (index, witness.clone())).is_some()
                    || witnesses.len() > MAX_WITNESSES
                {
                    return Err(incompatible());
                }
            }
        }
        Ok(Self {
            entries,
            witnesses,
            commits,
        })
    }

    /// A historical Store read may select this frame only by exact identity
    /// and entire commit equality with a post-Access opaque archive entry.
    pub(crate) fn accepted_frame_for_commit(
        &self,
        commit: &StockAtlasCommit,
    ) -> Option<&super::StockPresenceAcceptedFrame> {
        let scope = &commit.groups.first()?.native_results.first()?.record;
        let index = self.commits.get(&(
            scope.workspace_id.clone(),
            scope.home_id.clone(),
            commit.actor_id.clone(),
            commit.operation_id.clone(),
        ))?;
        let entry = &self.entries[*index];
        (entry.frame().commit() == commit && entry.request().raw() == &commit.original_request)
            .then(|| entry.frame())
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Root has already validated the complete native, stock, queue and activity
    /// closure on this very read transaction. This pass joins every accepted
    /// command to historical immutable rows, then delegates all Binding history
    /// and Source observations to the existing exhaustive validator.
    pub(crate) fn validate_connection<C: Contract>(
        &self,
        db: &Connection,
        contract: &C,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()> {
        migrations::validate_presence(db)?;
        // Bound SQL intake before the exhaustive validator decodes any body.
        // This checks the full table, including rows absent from this catalog.
        let (count, bytes): (i64, i64) = db.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(body AS BLOB))),0) FROM presence_witnesses",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let (Ok(count), Ok(bytes)) = (usize::try_from(count), usize::try_from(bytes)) else {
            return Err(incompatible());
        };
        if count != self.witnesses.len() || bytes > MAX_FRAME_BYTES {
            return Err(incompatible());
        }
        for entry in &self.entries {
            check()?;
            self.validate_accepted_frame(db, contract, entry, check)?;
        }
        let total = presence_validation::validate_all(db, contract, self, check)?;
        if total != self.witnesses.len() {
            return Err(incompatible());
        }
        check()?;
        Ok(())
    }

    fn validate_accepted_frame<C: Contract>(
        &self,
        db: &Connection,
        contract: &C,
        entry: &RecordedPresenceHistory,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()> {
        let frame = entry.frame();
        let commit = frame.commit();
        let scope = &frame.precommit().scope;
        if frame.candidate().entries != frame.precommit().entries
            || frame
                .precommit()
                .entries
                .iter()
                .map(|e| &e.target)
                .collect::<Vec<_>>()
                != frame.precommit().targets.iter().collect::<Vec<_>>()
            || frame.command_hashes().len()
                != commit
                    .groups
                    .iter()
                    .map(|g| g.native_results.len())
                    .sum::<usize>()
            || commit
                .groups
                .iter()
                .flat_map(|g| &g.native_entries)
                .collect::<Vec<_>>()
                != frame.precommit().entries.iter().collect::<Vec<_>>()
        {
            return Err(incompatible());
        }
        let saved =
            stock_repository::load(db, contract, scope, &commit.actor_id, &commit.operation_id)?;
        if saved != *commit {
            return Err(incompatible());
        }
        let results = commit
            .groups
            .iter()
            .flat_map(|g| &g.native_results)
            .collect::<Vec<_>>();
        if results.len() != frame.precommit().entries.len() {
            return Err(incompatible());
        }
        for ((result, hash), mutation) in results
            .iter()
            .zip(frame.command_hashes())
            .zip(&frame.precommit().entries)
        {
            check()?;
            if result.replayed
                || result.record.reference() != mutation.target
                || result.audit.mutation_id != mutation.command.mutation_id
                || result.audit.actor_id != commit.actor_id
                || result.record.scope() != *scope
            {
                return Err(incompatible());
            }
            let audit_body: String = db.query_row(
                "SELECT body FROM audits WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND audit_id=?4",
                params![result.record.workspace_id,result.record.home_id,result.record.record_id,result.audit.audit_id], |r| r.get(0),
            )?;
            let receipt = repo::receipt(
                db,
                repo::ReceiptKind::Command,
                scope,
                &commit.actor_id,
                &result.audit.mutation_id,
            )?
            .ok_or_else(incompatible)?;
            if audit_body != repo::json(contract, &result.audit)?
                || receipt.hash != *hash
                || !repo::retained_json_matches(contract, result, &receipt.body)?
            {
                return Err(incompatible());
            }
        }
        match (&frame.precommit().batch, frame.batch_hash()) {
            (Some(batch), Some(hash)) => {
                let results = results.into_iter().cloned().collect::<Vec<_>>();
                let receipt = repo::receipt(
                    db,
                    repo::ReceiptKind::Batch,
                    scope,
                    &commit.actor_id,
                    &batch.batch_id,
                )?
                .ok_or_else(incompatible)?;
                if receipt.hash != hash
                    || !repo::retained_json_matches(contract, &results, &receipt.body)?
                {
                    return Err(incompatible());
                }
            }
            (None, None) => {}
            _ => return Err(incompatible()),
        }
        for witness in frame.witnesses() {
            check()?;
            let body: Option<String> = db.query_row(
                "SELECT body FROM presence_witnesses WHERE workspace_id=?1 AND binding_record_id=?2 AND binding_revision=?3",
                params![witness.workspace_id,witness.binding_record_id,i64::try_from(witness_key(witness)?.2).map_err(|_| incompatible())?],
                |r| r.get(0),
            ).optional()?;
            if body.as_deref() != Some(repo::json(contract, witness)?.as_str()) {
                return Err(incompatible());
            }
        }
        Ok(())
    }
}

impl OriginalPresenceHistoryEvidence for PresenceHistoryCatalog {
    fn validate_original_observation(
        &self,
        witness: &wire::PresenceWitness,
        final_record: &Record,
        prior: Option<&Record>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()> {
        let (entry_index, accepted) = self
            .witnesses
            .get(&witness_key(witness)?)
            .ok_or_else(incompatible)?;
        if accepted != witness {
            return Err(incompatible());
        }
        self.entries[*entry_index].validate_original_observation(
            witness,
            final_record,
            prior,
            check,
        )
    }
}

fn witness_key(witness: &wire::PresenceWitness) -> Result<WitnessKey> {
    let revision =
        super::super::numeric::safe_integer(&serde_json::to_value(&witness.binding_revision)?)
            .filter(|n| *n > 0)
            .ok_or_else(incompatible)?;
    Ok((
        witness.workspace_id.clone(),
        witness.binding_record_id.clone(),
        revision,
    ))
}
fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Original presence history catalog is incompatible",
    )
}
