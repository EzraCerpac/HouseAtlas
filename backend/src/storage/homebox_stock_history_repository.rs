//! Bounded, watermark-pinned projections of retained HomeBox stock activity.
//!
//! Each public row represents one operation at its greatest retained event
//! sequence no later than the fixed watermark. The selected event is always
//! taken from the validated immutable chain, never from the current operation
//! summary when that summary may contain a post-watermark suffix.
use super::*;
use crate::providers::homebox::write::stock as native;
use rusqlite::{Connection, params};
use uuid::Uuid;

/// Retained rows are bounded before `repository::retained` decodes the full
/// immutable chain. Larger chains remain retained but this history projection
/// reports unavailable instead of partially validating or silently omitting
/// them.
const MAX_EVENTS_PER_OPERATION: i64 = 128;
const MAX_BYTES_PER_OPERATION: i64 = 2 * 1024 * 1024;
const MAX_BYTES_PER_PAGE: i64 = 16 * 1024 * 1024;

pub(crate) struct Page {
    /// Fixed for all continuations of this query.
    pub watermark: i64,
    /// Contains at most `page_size + 1` actual selected cuts. The final item,
    /// when present, is the lookahead used to establish `has_more`.
    pub items: Vec<RetainedStockActivityEvent>,
    pub has_more: bool,
}

/// Read one bounded page of selected event cuts for the exact entity target.
/// Entity and location history use separate immutable command-route families;
/// both target a HomeBox entity identity.
// These inputs jointly bind one history read to its exact query/cursor tuple.
#[allow(clippy::too_many_arguments)]
pub(crate) fn page<S: StockContractPort>(
    db: &Connection,
    schemas: &S,
    scope: &native::Context,
    target: &native::StockTarget,
    location_route: bool,
    query: Option<&str>,
    watermark: Option<i64>,
    after_sequence: i64,
    page_size: usize,
) -> PortResult<Page> {
    if target.resource_kind != native::ResourceKind::Entity
        || target.resource_id.is_none()
        || target.entity_id.is_some()
        || !(1..=100).contains(&page_size)
        || after_sequence < 0
        || watermark.is_some_and(|value| value < 0 || after_sequence > value)
    {
        return Err(StockPortFault::EvidenceConflict);
    }

    let current_watermark: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(sequence),0) FROM stock_activity_events",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    let watermark = watermark.unwrap_or(current_watermark);
    if watermark > current_watermark {
        return Err(StockPortFault::EvidenceConflict);
    }

    let route_prefix = if location_route {
        "homebox.location."
    } else {
        "homebox.entity."
    };
    let create_command = if location_route {
        "homebox.location.create"
    } else {
        "homebox.entity.create"
    };
    let limit = i64::try_from(page_size + 1).map_err(evidence)?;
    let resource_id = target.resource_id.ok_or(StockPortFault::EvidenceConflict)?;

    // SQL applies immutable scope/source/collection/route constraints before
    // choosing each operation's greatest sequence at or below the watermark.
    // Target eligibility, including mutable generated actualTarget evidence,
    // is applied only to that selected event cut in the outer query.
    let mut statement = db
        .prepare(
            "WITH selected AS (
                SELECT e.operation_id, MAX(e.sequence) AS sequence
                FROM stock_activity_events AS e
                JOIN stock_activity_operations AS o ON o.operation_id=e.operation_id
                WHERE e.sequence<=?1
                  AND o.workspace_id=?2 AND o.home_id=?3
                  AND json_extract(e.operation_json,'$.payload.command.context.workspaceId')=?2
                  AND json_extract(e.operation_json,'$.payload.command.context.homeId')=?3
                  AND json_extract(e.operation_json,'$.payload.command.target.sourceInstanceId')=?4
                  AND json_extract(e.operation_json,'$.payload.command.target.collectionId')=?5
                  AND json_extract(e.operation_json,'$.payload.command.target.resourceKind')='entity'
                  AND json_extract(e.operation_json,'$.payload.command.target.entityId') IS NULL
                  AND substr(json_extract(e.operation_json,'$.payload.command.command_id'),1,length(?7))=?7
                GROUP BY e.operation_id
             )
             SELECT e.operation_id, e.sequence
             FROM selected AS s
             JOIN stock_activity_events AS e
               ON e.operation_id=s.operation_id AND e.sequence=s.sequence
             WHERE s.sequence>?8
               -- Never select an earlier matching actualTarget when the
               -- operation's latest cut under this watermark differs.
               AND (
                    json_extract(e.operation_json,'$.payload.command.target.resourceId')=?6
                    OR (
                        json_extract(e.operation_json,'$.payload.command.target.resourceId') IS NULL
                        AND json_extract(e.operation_json,'$.payload.command.command_id')=?11
                        AND json_extract(e.operation_json,'$.payload.actualTarget.sourceInstanceId')=?4
                        AND json_extract(e.operation_json,'$.payload.actualTarget.collectionId')=?5
                        AND json_extract(e.operation_json,'$.payload.actualTarget.resourceKind')='entity'
                        AND json_extract(e.operation_json,'$.payload.actualTarget.resourceId')=?6
                        AND json_extract(e.operation_json,'$.payload.actualTarget.entityId') IS NULL
                    )
               )
               AND (?9 IS NULL
                    OR instr(json_extract(e.operation_json,'$.payload.command.command_id'),?9)>0
                    OR instr(json_extract(e.operation_json,'$.payload.outcome.state'),?9)>0)
             ORDER BY s.sequence ASC
             LIMIT ?10",
        )
        .map_err(unavailable)?;
    let candidates = statement
        .query_map(
            params![
                watermark,
                scope.workspace_id.to_string(),
                scope.home_id.to_string(),
                target.source_instance_id.to_string(),
                target.collection_id.to_string(),
                resource_id.to_string(),
                route_prefix,
                after_sequence,
                query,
                limit,
                create_command
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(unavailable)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(unavailable)?;

    // Refuse oversized chains before `repository::retained` asks the original
    // codec to decode them. The page-wide byte budget bounds aggregate work
    // when a full lookahead page contains many operations.
    let mut total_bytes = 0_i64;
    for (operation_id, _) in &candidates {
        let (event_count, event_bytes, current_operation_bytes, permit_bytes): (
            i64,
            i64,
            i64,
            i64,
        ) = db
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM (
                        SELECT 1 FROM stock_activity_events
                        WHERE operation_id=?1 LIMIT ?2
                    )),
                    (SELECT COALESCE(SUM(event_bytes),0) FROM (
                        SELECT
                            length(CAST(kind AS BLOB))+
                            length(CAST(facts_json AS BLOB))+
                            length(CAST(operation_json AS BLOB))+
                            length(CAST(activity_version AS BLOB)) AS event_bytes
                        FROM stock_activity_events
                        WHERE operation_id=?1 LIMIT ?2
                    )),
                    length(CAST(o.operation_json AS BLOB)),
                    COALESCE(length(CAST(o.permit_json AS BLOB)),0)
                 FROM stock_activity_operations AS o WHERE o.operation_id=?1",
                params![operation_id, MAX_EVENTS_PER_OPERATION + 1],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(unavailable)?;
        let byte_count = event_bytes
            .checked_add(current_operation_bytes)
            .and_then(|value| value.checked_add(permit_bytes))
            .ok_or(StockPortFault::Unavailable)?;
        if event_count > MAX_EVENTS_PER_OPERATION || byte_count > MAX_BYTES_PER_OPERATION {
            return Err(StockPortFault::Unavailable);
        }
        total_bytes = total_bytes
            .checked_add(byte_count)
            .ok_or(StockPortFault::Unavailable)?;
        if total_bytes > MAX_BYTES_PER_PAGE {
            return Err(StockPortFault::Unavailable);
        }
    }

    let has_more = candidates.len() > page_size;
    let mut items = Vec::with_capacity(candidates.len());
    for (operation_id, selected_sequence) in candidates {
        let operation_id = Uuid::parse_str(&operation_id).map_err(evidence)?;
        if selected_sequence <= 0 {
            return Err(StockPortFault::EvidenceConflict);
        }
        let selected_sequence_u64 = u64::try_from(selected_sequence).map_err(evidence)?;

        // Decode the selected immutable cut only to obtain its captured
        // registration facts. The current suffix is validated as retained
        // journal data below, but is never selected or projected.
        let operation_json: String = db
            .query_row(
                "SELECT operation_json FROM stock_activity_events
                 WHERE operation_id=?1 AND sequence=?2 AND sequence<=?3",
                params![operation_id.to_string(), selected_sequence, watermark],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        let selected_operation = codec::decode_operation(&operation_json).map_err(evidence)?;
        if selected_operation.operation_id != operation_id
            || selected_operation.command.context != *scope
            || !selected_cut_target_matches(&selected_operation, target, create_command)
            || !selected_operation
                .command
                .command_id
                .starts_with(route_prefix)
            || !query_matches(
                query,
                &selected_operation.command.command_id,
                selected_operation.outcome.state,
            )
        {
            return Err(StockPortFault::EvidenceConflict);
        }

        let (owner_id, dispatcher_epoch): (String, String) = db
            .query_row(
                "SELECT p.owner_id,p.dispatcher_epoch
                 FROM stock_activity_physical AS p
                 WHERE p.physical_database_id=?1",
                [selected_operation
                    .captured_authority
                    .physical_binding
                    .physical_database_id
                    .to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(unavailable)?;
        let registration = StockActivityRegistration {
            physical_binding: selected_operation
                .captured_authority
                .physical_binding
                .clone(),
            owner_id: Uuid::parse_str(&owner_id).map_err(evidence)?,
            dispatcher_epoch: dispatcher_epoch.parse().map_err(evidence)?,
            source_epoch: selected_operation.captured_authority.source_epoch,
            qualification: selected_operation.captured_authority.qualification.clone(),
        };

        let retained = repository::retained(db, operation_id, &registration)?;
        retention::validate_record(&retained, schemas)?;
        let selected = retained
            .events()
            .iter()
            .find(|event| event.sequence() == selected_sequence_u64)
            .ok_or(StockPortFault::EvidenceConflict)?;
        if selected.operation().operation_id != operation_id
            || selected.operation().command.context != *scope
            || !selected_cut_target_matches(selected.operation(), target, create_command)
            || !selected
                .operation()
                .command
                .command_id
                .starts_with(route_prefix)
            || !query_matches(
                query,
                &selected.operation().command.command_id,
                selected.operation().outcome.state,
            )
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        items.push(selected.clone());
    }

    Ok(Page {
        watermark,
        items,
        has_more,
    })
}

fn target_matches(saved: &native::StockTarget, selected: &native::StockTarget) -> bool {
    saved.source_instance_id == selected.source_instance_id
        && saved.collection_id == selected.collection_id
        && saved.resource_kind == native::ResourceKind::Entity
        && saved.resource_kind == selected.resource_kind
        && saved.resource_id == selected.resource_id
        && saved.entity_id == selected.entity_id
        && saved.resource_id.is_some()
        && saved.entity_id.is_none()
}

/// Generated identities are disclosed only from the selected immutable cut's
/// original create intent and durable actual target. Current rows, effect notes
/// and a later operation suffix never supply this correlation. This branch
/// needs a durable dispatched cut and is not exercised by reserve-only fixtures;
/// the history reader never synthesizes dispatch evidence.
fn selected_cut_target_matches(
    operation: &StoredOperation,
    selected: &native::StockTarget,
    create_command: &str,
) -> bool {
    if target_matches(&operation.command.target, selected) {
        return true;
    }
    let original = &operation.command.target;
    operation.command.command_id == create_command
        && original.resource_kind == native::ResourceKind::Entity
        && original.resource_id.is_none()
        && original.entity_id.is_none()
        && original.source_instance_id == selected.source_instance_id
        && original.collection_id == selected.collection_id
        && operation
            .actual_target
            .as_ref()
            .is_some_and(|actual| target_matches(actual, selected))
}

fn query_matches(query: Option<&str>, command_id: &str, state: native::OutcomeState) -> bool {
    let Some(query) = query else {
        return true;
    };
    let state = serde_json::to_value(state)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned));
    command_id.contains(query) || state.is_some_and(|state| state.contains(query))
}
