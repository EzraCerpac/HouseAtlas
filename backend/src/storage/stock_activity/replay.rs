//! Replay native admission occupancy at each global journal cut.
//! Per-operation reducers and independent owner evidence are checked separately.
use super::*;
use crate::storage::{Error, Result};
use std::collections::BTreeMap;

fn require(value: bool) -> Result<()> {
    if value {
        Ok(())
    } else {
        Err(Error::new(
            "schema-incompatible",
            "Retained stock activity is incompatible",
        ))
    }
}

struct Cut<'a> {
    reserve_sequence: u64,
    operation: &'a StoredOperation,
    body_accepted: bool,
}

fn occupied(cuts: &BTreeMap<Uuid, Cut<'_>>, active: &BTreeMap<Uuid, Uuid>, physical: Uuid) -> bool {
    active.contains_key(&physical)
        || cuts.values().any(|cut| {
            cut.operation
                .captured_authority
                .physical_binding
                .physical_database_id
                == physical
                && (cut.operation.outcome.unknown_scope_fence_retained
                    || repository::liability_hold(&cut.operation.outcome.storage_liability))
        })
}

/// Return exact physical owners after replay, never reconstructed authority.
pub(super) fn validate(
    records: &[RetainedStockActivity],
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<BTreeMap<Uuid, Uuid>> {
    let mut events = BTreeMap::new();
    for record in records {
        for event in record.events() {
            require(events.insert(event.sequence(), (record, event)).is_none())?;
        }
    }
    let mut cuts: BTreeMap<Uuid, Cut<'_>> = BTreeMap::new();
    let mut active = BTreeMap::new();
    for (index, (sequence, (record, event))) in events.into_iter().enumerate() {
        check()?;
        require(u64::try_from(index).ok().and_then(|n| n.checked_add(1)) == Some(sequence))?;
        let id = event.operation().operation_id;
        let physical = record.registration().physical_binding.physical_database_id;
        if matches!(event.facts(), StockActivityEventFacts::Reserve) {
            // Live baseline::fresh can produce Prepared only without a hold.
            // A Queued cut may instead reflect Jobs occupancy: its separate
            // journal supplies no shared native sequence to reconstruct here.
            if event.operation().outcome.state == OutcomeState::Prepared {
                require(!occupied(&cuts, &active, physical))?;
            }
            require(
                cuts.insert(
                    id,
                    Cut {
                        reserve_sequence: sequence,
                        operation: event.operation(),
                        body_accepted: false,
                    },
                )
                .is_none(),
            )?;
            continue;
        }
        let prior = cuts.get(&id).ok_or_else(|| {
            Error::new(
                "schema-incompatible",
                "Retained stock activity is incompatible",
            )
        })?;
        let mut accepted = prior.body_accepted;
        match event.facts() {
            StockActivityEventFacts::Admit(_) => {
                require(
                    !accepted
                        && matches!(
                            prior.operation.outcome.state,
                            OutcomeState::Prepared | OutcomeState::Queued
                        ),
                )?;
                require(!occupied(&cuts, &active, physical))?;
                // Match live FIFO and logical/liability exclusion using only
                // outcomes already present at this cut, never later readbacks.
                for cut in cuts.values().filter(|cut| {
                    cut.operation
                        .captured_authority
                        .physical_binding
                        .physical_database_id
                        == physical
                }) {
                    require(
                        !(cut.reserve_sequence < prior.reserve_sequence
                            && !cut.body_accepted
                            && matches!(
                                cut.operation.outcome.state,
                                OutcomeState::Prepared | OutcomeState::Queued
                            )),
                    )?;
                }
                require(active.insert(physical, id).is_none())?;
                accepted = true;
            }
            StockActivityEventFacts::NeverInvoked => {
                require(active.remove(&physical) == Some(id))?;
            }
            StockActivityEventFacts::Dispatch(facts)
                if matches!(facts.remote_activity, RemoteActivity::EndedProven { .. }) =>
            {
                require(active.remove(&physical) == Some(id))?;
            }
            _ => {}
        }
        let reserve_sequence = prior.reserve_sequence;
        cuts.insert(
            id,
            Cut {
                reserve_sequence,
                operation: event.operation(),
                body_accepted: accepted,
            },
        );
    }
    Ok(active)
}
