//! One pure retained projection check shared by replay and history.
use super::{stock_repository as repo, *};
use crate::domain::stock::{
    self, AtlasCommandPlan, AtlasCommitGroupView, AtlasCommitView, OwnerResult, StockContractPort,
    ValidatedRequest,
};
use rusqlite::Connection;

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
    let original =
        ValidatedRequest::parse(stock, commit.original_request.clone()).map_err(incompatible)?;
    if commit.derivation.is_some() || commit.derivation_format.is_some() {
        super::stock_derivation::validate_retained_preimage(commit, stock, native)?;
        let derivation = commit.derivation.as_ref().ok_or_else(repo::incompatible)?;
        let plan = stock::plan_derived_atlas_commands(&original, derivation, native)
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
    if commit.replayed {
        return Err(repo::incompatible());
    }
    let (original, plan) = retained_plan(db, commit, stock, native)?;
    let output = project(&original, &plan, commit, stock, native)?;
    if native.canonical_json(&output.wire)? != native.canonical_json(&commit.wire)?
        || native.canonical_json(&serde_json::to_value(&output.children)?)?
            != native.canonical_json(&serde_json::to_value(&commit.children)?)?
    {
        return Err(repo::incompatible());
    }
    Ok(())
}
