//! One pure retained projection check shared by replay and history.
use super::StockPresenceAcceptedFrame;
use super::{stock_repository as repo, *};
use crate::domain::stock::{
    self, AtlasCommandPlan, AtlasCommitGroupView, AtlasCommitView, OwnerResult, StockContractPort,
    ValidatedRequest,
};
use rusqlite::Connection;

enum RetainedPresence<'a> {
    Ordinary,
    Accepted(&'a StockPresenceAcceptedFrame),
}

fn incompatible(_: stock::StockError) -> Error {
    repo::incompatible()
}
pub(crate) fn project<C: Contract, S: StockContractPort>(
    request: &ValidatedRequest,
    plan: &AtlasCommandPlan,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
) -> Result<OwnerResult> {
    if commit.groups.len() != plan.groups().len() {
        return Err(repo::incompatible());
    }
    for (retained, expected) in commit.groups.iter().zip(plan.groups()) {
        if native.canonical_json(&serde_json::to_value(&retained.native_entries)?)?
            != native.canonical_json(&serde_json::to_value(expected.native_entries())?)?
        {
            return Err(repo::incompatible());
        }
    }
    let groups = commit
        .groups
        .iter()
        .map(|g| AtlasCommitGroupView {
            child_index: g.child_index,
            original_request: &g.original_request,
            request_digest: &g.request_digest,
            operation_id: &g.operation_id,
            replayed: commit.replayed,
            native_results: &g.native_results,
        })
        .collect::<Vec<_>>();
    stock::map_atlas_commit(
        request,
        plan,
        &AtlasCommitView {
            original_request: &commit.original_request,
            request_digest: &commit.request_digest,
            operation_id: &commit.operation_id,
            actor_id: &commit.actor_id,
            replayed: commit.replayed,
            groups: &groups,
        },
        stock,
        native,
    )
    .map_err(incompatible)
}
pub(crate) fn retained_plan<C: Contract, S: StockContractPort>(
    db: &Connection,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
) -> Result<(ValidatedRequest, AtlasCommandPlan)> {
    retained_plan_inner(db, commit, stock, native, RetainedPresence::Ordinary)
}

fn retained_plan_inner<C: Contract, S: StockContractPort>(
    db: &Connection,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
    presence: RetainedPresence<'_>,
) -> Result<(ValidatedRequest, AtlasCommandPlan)> {
    let original =
        ValidatedRequest::parse(stock, commit.original_request.clone()).map_err(incompatible)?;
    if commit.derivation.is_some()
        || commit.derivation_format.is_some()
        || commit.child_derivations.is_some()
        || commit.asset_review.is_some()
    {
        match presence {
            RetainedPresence::Ordinary => {
                super::stock_derivation::validate_retained_preimage(commit, stock, native)?;
            }
            RetainedPresence::Accepted(frame) => {
                if frame.commit() != commit
                    || frame.witnesses().is_empty()
                    || frame.candidate().phase != MutationPhase::Candidate
                    || frame.precommit().phase != MutationPhase::Precommit
                    || frame.candidate().context_id != frame.precommit().context_id
                    || frame.candidate().scope != frame.precommit().scope
                {
                    return Err(repo::incompatible());
                }
                super::stock_derivation::validate_retained_presence_preimage(
                    commit, stock, native,
                )?;
            }
        }
        if super::upload_repository::load_for_commit(db, native, stock, commit)?.is_some() {
            return Err(repo::incompatible());
        }
        // validate_retained_preimage has checked mutually exclusive format
        // carriers. Rebuild only saved data, with no current rows or fresh clock.
        let plan = match (&commit.derivation, &commit.child_derivations) {
            (Some(derivation), None) => {
                stock::plan_derived_atlas_commands(&original, derivation, native)
            }
            (None, Some(derivations)) => {
                stock::plan_derived_atlas_batch_commands(&original, derivations, native)
            }
            _ => return Err(repo::incompatible()),
        }
        .map_err(incompatible)?;
        return Ok((original, plan));
    }
    let consumed = super::upload_repository::load_for_commit(db, native, stock, commit)?;
    let plan = match consumed {
        Some(consumed) => stock::plan_retained_staged_atlas_commands(&original, &consumed, native),
        None => stock::plan_atlas_commands(&original, native),
    }
    .map_err(incompatible)?;
    Ok((original, plan))
}

pub(crate) fn validate_retained<C: Contract, S: StockContractPort>(
    db: &Connection,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
) -> Result<()> {
    validate_retained_with_plan(db, commit, stock, native).map(|_| ())
}

/// Return the same validated saved mapping, without reconstructing authority
/// or projecting a new request/replay result. Callers keep it inside their
/// actual read transaction until original disclosure qualification completes.
pub(crate) fn validate_retained_with_plan<C: Contract, S: StockContractPort>(
    db: &Connection,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
) -> Result<(ValidatedRequest, AtlasCommandPlan)> {
    validate_retained_inner(db, commit, stock, native, RetainedPresence::Ordinary)
}

/// The live engine's accepted frame or an exact opaque catalog record must be
/// supplied by the original owner. Generic reads still use the ordinary path.
pub(crate) fn validate_retained_with_accepted_presence<C: Contract, S: StockContractPort>(
    db: &Connection,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
    frame: &StockPresenceAcceptedFrame,
) -> Result<(ValidatedRequest, AtlasCommandPlan)> {
    validate_retained_inner(db, commit, stock, native, RetainedPresence::Accepted(frame))
}

fn validate_retained_inner<C: Contract, S: StockContractPort>(
    db: &Connection,
    commit: &StockAtlasCommit,
    stock: &S,
    native: &C,
    presence: RetainedPresence<'_>,
) -> Result<(ValidatedRequest, AtlasCommandPlan)> {
    if commit.replayed {
        return Err(repo::incompatible());
    }
    let (original, plan) = retained_plan_inner(db, commit, stock, native, presence)?;
    let output = project(&original, &plan, commit, stock, native)?;
    if native.canonical_json(&output.wire)? != native.canonical_json(&commit.wire)?
        || native.canonical_json(&serde_json::to_value(&output.children)?)?
            != native.canonical_json(&serde_json::to_value(&commit.children)?)?
    {
        return Err(repo::incompatible());
    }
    Ok((original, plan))
}
