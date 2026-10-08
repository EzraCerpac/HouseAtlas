//! Bounded, watermark-pinned projections of retained HomeBox stock activity.
//!
//! Each public row represents one operation at its greatest retained event
//! sequence no later than the fixed watermark. The selected event is always
//! taken from the validated immutable chain, never from the current operation
//! summary when that summary may contain a post-watermark suffix.
use super::*;
use crate::providers::homebox::write::stock as native;
use crate::{domain::stock as domain, storage as s};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use uuid::Uuid;

/// Retained rows are bounded before `repository::retained` decodes the full
/// immutable chain. Larger chains remain retained but this history projection
/// reports unavailable instead of partially validating or silently omitting
/// them.
pub(crate) const HOMEBOX_HISTORY_CURSOR_FORMAT: &str = "homebox-stock-activity-cut/1";

// Paging and strict cursor validation must use exactly the same immutable-cut
// eligibility predicate, including generated actual targets and query filters.
// NOT INDEXED still permits the INTEGER PRIMARY KEY sequence range; it prevents
// the operation/version index from scanning an unbounded post-watermark suffix
// merely to satisfy GROUP BY. Pin the existing operation TEXT primary-key index
// for each bounded event lookup. No schema/index is installed by this reader.
const SELECTED_CUTS: &str = "WITH selected AS (
                SELECT e.operation_id, MAX(e.sequence) AS sequence
                FROM stock_activity_events AS e NOT INDEXED
                CROSS JOIN stock_activity_operations AS o INDEXED BY sqlite_autoindex_stock_activity_operations_1
                  ON o.operation_id=e.operation_id
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
             CROSS JOIN stock_activity_events AS e NOT INDEXED
               ON e.sequence=s.sequence AND e.operation_id=s.operation_id
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
             LIMIT ?10";

// Bound the ENTIRE indexed event range before JSON predicates, joins, GROUP
// BY or sorting. Scope/target filters must not hide work from this ceiling.
const MAX_SELECTION_EVENTS: i64 = 4096;
const MAX_SELECTION_JSON_BYTES: i64 = 16 * 1024 * 1024;

// Data-only input accounting on the caller's existing read snapshot. It issues
// no authority, grants, permits or ability to skip retained-chain validation.
struct BoundedSelection<'a> {
    db: &'a Connection,
    watermark: i64,
}
fn bounded_selection<'a>(
    db: &'a Connection,
    watermark: i64,
    check: &mut dyn FnMut() -> s::Result<()>,
) -> s::Result<BoundedSelection<'a>> {
    check()?;
    // INTEGER PRIMARY KEY sequence supplies the ordered range. There are no
    // JSON/scope predicates or grouping before LIMIT; the extra row means
    // unavailable, never a silently truncated selected history.
    let mut statement = db.prepare(
        "SELECT length(CAST(operation_json AS BLOB)) FROM stock_activity_events NOT INDEXED
         WHERE sequence<=?1 ORDER BY sequence LIMIT ?2",
    )?;
    let mut rows = statement.query(params![watermark, MAX_SELECTION_EVENTS + 1])?;
    let mut count = 0_i64;
    let mut bytes = 0_i64;
    while let Some(row) = rows.next()? {
        check()?;
        count += 1;
        let size: i64 = row.get(0)?;
        bytes = bytes.checked_add(size).ok_or_else(selection_unavailable)?;
        if count > MAX_SELECTION_EVENTS || size < 0 || bytes > MAX_SELECTION_JSON_BYTES {
            return Err(selection_unavailable());
        }
    }
    check()?;
    Ok(BoundedSelection { db, watermark })
}
fn selection_unavailable() -> s::Error {
    s::Error::new(
        "upstream-unavailable",
        "Native HomeBox history selection exceeds its work budget",
    )
}

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

    let selection = bounded_selection(db, watermark, &mut || Ok(()))
        .map_err(|_| StockPortFault::Unavailable)?;
    page_in_selection(
        &selection,
        schemas,
        scope,
        target,
        location_route,
        query,
        after_sequence,
        page_size,
    )
}

// Both callers must first account for the complete range on the SAME snapshot.
// The private descriptor binds the actual connection and pinned watermark so
// recovery's boundary/lookahead read reuses its preflight without rescanning.
#[allow(clippy::too_many_arguments)]
fn page_in_selection<S: StockContractPort>(
    selection: &BoundedSelection<'_>,
    schemas: &S,
    scope: &native::Context,
    target: &native::StockTarget,
    location_route: bool,
    query: Option<&str>,
    after_sequence: i64,
    page_size: usize,
) -> PortResult<Page> {
    let db = selection.db;
    let watermark = selection.watermark;
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
    let mut statement = db.prepare(SELECTED_CUTS).map_err(unavailable)?;
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

/// Data fields from an immutable cursor row. These are not an original request,
/// principal, permission, producer, or resumable operation authorization.
pub(crate) struct RetainedHistoryCursor<'a> {
    pub id: &'a str,
    pub scope: &'a s::Scope,
    pub actor: &'a str,
    pub query_json: &'a str,
    pub watermark: i64,
    pub after_sequence: i64,
    pub codec_version: i64,
}

/// Validate only retained data, after the caller has completely validated native
/// activity with the actual recovery contracts on this SAME read snapshot. No
/// producer, guard, admission, dispatch, delivery, or authority is reconstructed.
pub(crate) fn validate_cursor<
    C: s::Contract,
    S: domain::StockContractPort,
    N: StockContractPort,
>(
    db: &Connection,
    native: &C,
    stock: &S,
    activity: &N,
    cursor: RetainedHistoryCursor<'_>,
    check: &mut dyn FnMut() -> s::Result<()>,
) -> s::Result<()> {
    check()?;
    let RetainedHistoryCursor {
        id,
        scope,
        actor,
        query_json,
        watermark,
        after_sequence,
        codec_version,
    } = cursor;
    require_cursor(codec_version == 1 && 0 < after_sequence && after_sequence < watermark)?;
    native.validate_shape("scope", &serde_json::to_value(scope)?)?;
    for identity in [id, actor] {
        native.validate_shape(
            "recordRef",
            &json!({"recordType":"identity","recordId":identity}),
        )?;
    }
    let query: Value = serde_json::from_str(query_json)?;
    require_cursor(
        query["format"] == HOMEBOX_HISTORY_CURSOR_FORMAT
            && native.canonical_json(&query)? == query_json,
    )?;
    let mut payload = query["payload"]
        .as_object()
        .ok_or_else(cursor_incompatible)?
        .clone();
    require_cursor(!payload.contains_key("cursor"))?;
    payload.insert("cursor".into(), Value::Null);
    // ID and NULL cursor are schema-only carriers. They grant no authority and
    // are never handed to a mutation/resume API as an original request.
    let request = domain::ValidatedRequest::parse(
        stock,
        json!({
            "schemaVersion":3,"commandId":query["commandId"],"context":scope,
            "requestId":id,"target":query["target"],"payload":payload
        }),
    )
    .map_err(|_| cursor_incompatible())?;
    let location_route = match request.id().as_str() {
        "homebox.entity.mediated-history" => false,
        "homebox.location.mediated-history" => true,
        _ => return Err(cursor_incompatible()),
    };
    let operation = request.operation();
    require_cursor(
        operation.authority == domain::Authority::Homebox
            && operation.effect == domain::Effect::Read
            && operation.disposition == domain::Disposition::MediatedHistory
            && operation.output_kind == domain::OutputKind::History,
    )?;
    let mut stripped = request.payload().clone();
    stripped
        .as_object_mut()
        .ok_or_else(cursor_incompatible)?
        .remove("cursor");
    require_cursor(
        native.canonical_json(&json!({"format":HOMEBOX_HISTORY_CURSOR_FORMAT,
        "commandId":request.id().as_str(),"target":request.target(),"payload":stripped}))?
            == query_json,
    )?;
    let wire: native::WireTarget = serde_json::from_value(request.target().clone())?;
    require_cursor(wire.resource_kind == native::ResourceKind::Entity && wire.entity_id.is_none())?;
    let context: native::Context = serde_json::from_value(serde_json::to_value(scope)?)?;
    let target = native::StockTarget {
        source_instance_id: wire.source_instance_id,
        collection_id: wire.collection_id,
        resource_kind: wire.resource_kind,
        resource_id: Some(wire.resource_id),
        entity_id: None,
    };
    let partition = s::SourcePartition {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
        source_instance_id: wire.source_instance_id.to_string(),
        collection_id: wire.collection_id.to_string(),
    };
    let registration = s::cache_repository::source(db, &partition)?;
    native.validate_shape("sourceRegistration", &serde_json::to_value(&registration)?)?;
    require_cursor(
        registration.partition() == partition
            && registration.owner == s::SourceOwner::Homebox
            && (registration.partition_mode != s::PartitionMode::ReviewedEntityAllowlist
                || registration
                    .allowed_external_ids
                    .contains(&wire.resource_id.to_string())),
    )?;
    let watermark_exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM stock_activity_events WHERE sequence=?1)",
        [watermark],
        |row| row.get(0),
    )?;
    require_cursor(watermark_exists)?;
    let page_size = s::numeric::safe_integer(&request.payload()["pageSize"])
        .filter(|n| (1..=100).contains(n))
        .ok_or_else(cursor_incompatible)?;
    let q = request.payload().get("q").and_then(Value::as_str);
    let (route, create) = if location_route {
        ("homebox.location.", "homebox.location.create")
    } else {
        ("homebox.entity.", "homebox.entity.create")
    };
    // Already validated retained chains supply these selected rows. Scan only
    // sequence metadata, with progress per row; never decode every prior page
    // again for each cursor. SQL eligibility is shared verbatim with paging.
    let selection = bounded_selection(db, watermark, check)?;
    let mut statement = selection.db.prepare(SELECTED_CUTS)?;
    let mut rows = statement.query(params![
        watermark,
        scope.workspace_id,
        scope.home_id,
        wire.source_instance_id.to_string(),
        wire.collection_id.to_string(),
        wire.resource_id.to_string(),
        route,
        0_i64,
        q,
        -1_i64,
        create
    ])?;
    let mut rank = 0_u64;
    let mut boundary = false;
    let mut remaining = false;
    while let Some(row) = rows.next()? {
        check()?;
        let sequence: i64 = row.get(1)?;
        if sequence <= after_sequence {
            rank = rank.checked_add(1).ok_or_else(cursor_incompatible)?;
            boundary |= sequence == after_sequence;
        } else {
            remaining = true;
            break;
        }
    }
    require_cursor(boundary && rank > 0 && rank.is_multiple_of(page_size) && remaining)?;
    check()?;
    // Validate the exact original operation cuts at the boundary and lookahead
    // through the existing bounded retained-chain decoder and native contracts.
    let cuts = page_in_selection(
        &selection,
        activity,
        &context,
        &target,
        location_route,
        q,
        after_sequence - 1,
        1,
    )
    .map_err(cursor_fault)?;
    require_cursor(
        cuts.items
            .first()
            .is_some_and(|event| event.sequence() == after_sequence as u64)
            && cuts.has_more
            && cuts.items.len() == 2,
    )?;
    check()
}

fn cursor_incompatible() -> s::Error {
    s::Error::new(
        "schema-incompatible",
        "Retained HomeBox history cursor is incompatible",
    )
}
fn require_cursor(condition: bool) -> s::Result<()> {
    if condition {
        Ok(())
    } else {
        Err(cursor_incompatible())
    }
}
fn cursor_fault(fault: StockPortFault) -> s::Error {
    if fault == StockPortFault::Unavailable {
        s::Error::new(
            "upstream-unavailable",
            "Native HomeBox history validation is unavailable",
        )
    } else {
        cursor_incompatible()
    }
}

/// Called only within the same Immediate transaction as cursor insertion.
/// Caps apply to future HomeBox-format admissions; existing rows are retained,
/// and Atlas cursors neither consume nor acquire these native-reader budgets.
pub(crate) fn admit_cursor(db: &Connection, scope: &s::Scope, actor: &str) -> s::Result<()> {
    const GLOBAL: i64 = 4096;
    const ACTOR_SCOPE: i64 = 256;
    let global: i64 = db.query_row(
        "SELECT COUNT(*) FROM (SELECT 1 FROM stock_history_cursors
         WHERE json_extract(query_json,'$.format')=?1 LIMIT ?2)",
        params![HOMEBOX_HISTORY_CURSOR_FORMAT, GLOBAL],
        |row| row.get(0),
    )?;
    let local: i64 = db.query_row(
        "SELECT COUNT(*) FROM (SELECT 1 FROM stock_history_cursors
         WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3
         AND json_extract(query_json,'$.format')=?4 LIMIT ?5)",
        params![
            scope.workspace_id,
            scope.home_id,
            actor,
            HOMEBOX_HISTORY_CURSOR_FORMAT,
            ACTOR_SCOPE
        ],
        |row| row.get(0),
    )?;
    if global >= GLOBAL || local >= ACTOR_SCOPE {
        return Err(s::Error::new(
            "upstream-unavailable",
            "Native HomeBox history cursor capacity is exhausted",
        ));
    }
    Ok(())
}
