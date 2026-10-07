//! Pure snapshot graph validation, in the canonical validator's check order.

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use url::Url;

use super::common::{
    date_greater, date_less, items, js_equal, number, qualified_source_key, record_key,
    record_ref_key, same_scope, source_scope_key, text,
};
use super::{SemanticCode, SemanticError};

type Result<T> = std::result::Result<T, SemanticError>;
type ScopedKey = [String; 4];

struct Graph<'a> {
    records: HashMap<ScopedKey, &'a Value>,
    registrations: HashMap<ScopedKey, &'a Value>,
}

impl<'a> Graph<'a> {
    fn get(&self, scope: &Value, kind: &str, id: &str) -> Result<&'a Value> {
        self.records
            .get(&record_ref_key(scope, kind, id)?)
            .copied()
            .ok_or_else(|| {
                SemanticError::new(
                    SemanticCode::NotFound,
                    &format!("Missing scoped {kind} reference"),
                )
            })
    }

    fn source(&self, scope: &Value, key: &Value) -> Result<()> {
        self.source_parts(
            scope,
            key,
            text(&key["sourceKind"])?,
            text(&key["externalId"])?,
        )
    }

    fn source_parts(
        &self,
        scope: &Value,
        key: &Value,
        kind: &str,
        external_id: &str,
    ) -> Result<()> {
        let registration = self
            .registrations
            .get(&scoped_source_key(scope, key)?)
            .copied()
            .filter(|registration| registration["owner"] == owner_of(kind))
            .ok_or_else(|| {
                SemanticError::new(
                    SemanticCode::Forbidden,
                    "Unregistered or wrong-owner source",
                )
            })?;
        if registration["partitionMode"] == "reviewed-entity-allowlist"
            && !items(&registration["allowedExternalIds"])?
                .iter()
                .any(|id| id.as_str() == Some(external_id))
        {
            return Err(SemanticError::new(
                SemanticCode::Forbidden,
                "Source entity outside reviewed home partition",
            ));
        }
        if kind == "homebox-entity" && !canonical_uuid(external_id) {
            return Err(SemanticError::invalid(
                "HomeBox entity ID must be canonical lowercase UUID",
            ));
        }
        Ok(())
    }

    fn evidence(&self, scope: &Value, ids: &Value) -> Result<Vec<&'a Value>> {
        items(ids)?
            .iter()
            .map(|id| self.get(scope, "evidence", text(id)?))
            .collect()
    }

    fn endpoint(&self, scope: &Value, endpoint: &Value) -> Result<Option<&'a Value>> {
        if endpoint["kind"] == "unresolved" {
            Ok(None)
        } else {
            self.get(
                scope,
                text(&endpoint["ref"]["recordType"])?,
                text(&endpoint["ref"]["recordId"])?,
            )
            .map(Some)
        }
    }
}

fn scoped_source_key(scope: &Value, key: &Value) -> Result<ScopedKey> {
    Ok([
        text(&scope["workspaceId"])?.to_owned(),
        text(&scope["homeId"])?.to_owned(),
        text(&key["sourceInstanceId"])?.to_owned(),
        text(&key["collectionId"])?.to_owned(),
    ])
}

fn owner_of(kind: &str) -> &'static str {
    if kind.starts_with("homebox-") {
        "homebox"
    } else if kind.starts_with("network-") {
        "network"
    } else {
        "magicplan"
    }
}

fn canonical_uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
            }
        })
}

// Optional arrays and objects are truthy even when empty in the source validator.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Input has already passed snapshot shape validation and JS number normalization.
pub(super) fn validate_snapshot(snapshot: &Value) -> Result<()> {
    let sources = items(&snapshot["sources"])?;
    let records = items(&snapshot["records"])?;
    let homebox_entities = items(&snapshot["homeboxEntities"])?;
    let mut graph = Graph {
        records: HashMap::new(),
        registrations: HashMap::new(),
    };
    let mut permanent_ids = HashSet::new();

    for source in sources {
        let key = source_scope_key(source)?;
        if graph.registrations.contains_key(&key) {
            return Err(SemanticError::new(
                SemanticCode::IdentityConflict,
                "Duplicate source registration",
            ));
        }
        graph.registrations.insert(key, source);
        if source["partitionMode"] == "exclusive-home"
            && !items(&source["allowedExternalIds"])?.is_empty()
        {
            return Err(SemanticError::invalid(
                "Exclusive source has no entity allowlist",
            ));
        }
    }
    for (a_index, a) in sources.iter().enumerate() {
        for (b_index, b) in sources.iter().enumerate() {
            if a_index == b_index
                || a["workspaceId"] != b["workspaceId"]
                || a["sourceInstanceId"] != b["sourceInstanceId"]
                || a["collectionId"] != b["collectionId"]
            {
                continue;
            }
            if a["owner"] != b["owner"] {
                return Err(SemanticError::new(
                    SemanticCode::IdentityConflict,
                    "Source owner is immutable",
                ));
            }
            let a_allowed = items(&a["allowedExternalIds"])?;
            let b_allowed = items(&b["allowedExternalIds"])?;
            if a["partitionMode"] == "exclusive-home"
                || b["partitionMode"] == "exclusive-home"
                || a_allowed.iter().any(|id| b_allowed.contains(id))
            {
                return Err(SemanticError::new(
                    SemanticCode::IdentityConflict,
                    "Source partitions must be disjoint across homes",
                ));
            }
        }
    }
    for record in records {
        let permanent_id = [
            text(&record["workspaceId"])?.to_owned(),
            text(&record["recordId"])?.to_owned(),
        ];
        if !permanent_ids.insert(permanent_id) {
            return Err(SemanticError::new(
                SemanticCode::IdentityConflict,
                "Permanent record ID reused",
            ));
        }
        graph.records.insert(record_key(record)?, record);
        if date_less(text(&record["updatedAt"])?, text(&record["createdAt"])?) {
            return Err(SemanticError::invalid("Record time moves backwards"));
        }
    }

    let mut binding_keys = HashSet::new();
    let mut semantic_keys = HashSet::new();
    for record in records {
        let payload = &record["payload"];
        if truthy(&payload["evidenceIds"]) {
            graph.evidence(record, &payload["evidenceIds"])?;
        }
        if record["recordType"] == "evidence" {
            let provenance = &payload["provenance"];
            if truthy(&provenance["source"]) {
                if !same_scope(record, &provenance["source"])? {
                    return Err(SemanticError::new(
                        SemanticCode::Forbidden,
                        "Cross-home provenance",
                    ));
                }
                graph.source(record, &provenance["source"]["key"])?;
            }
            graph.evidence(record, &payload["supersedesEvidenceIds"])?;
            if items(&payload["supersedesEvidenceIds"])?.contains(&record["recordId"]) {
                return Err(SemanticError::invalid("Evidence cannot supersede itself"));
            }
            if provenance["evidenceBasis"] == "inference"
                && provenance["uncertainty"]["status"] == "supported"
            {
                return Err(SemanticError::invalid("Inference must stay inferred"));
            }
            if provenance["evidenceBasis"] == "unknown"
                && !["unknown", "disputed", "withdrawn", "superseded"]
                    .contains(&text(&provenance["uncertainty"]["status"])?)
            {
                return Err(SemanticError::invalid(
                    "Unknown basis cannot support a claim",
                ));
            }
            for reference in items(&payload["references"])? {
                if reference["kind"] == "atlas-asset" {
                    graph.get(record, "asset", text(&reference["assetId"])?)?;
                }
                if reference["kind"] == "homebox-attachment" {
                    if !same_scope(record, &reference["entity"])?
                        || reference["entity"]["key"]["sourceKind"] != "homebox-entity"
                    {
                        return Err(SemanticError::new(
                            SemanticCode::Forbidden,
                            "Attachment must be a scoped HomeBox entity",
                        ));
                    }
                    graph.source(record, &reference["entity"]["key"])?;
                }
            }
        }
        if record["recordType"] == "binding" {
            let identity = graph.get(record, "identity", text(&payload["atlasId"])?)?;
            graph.source(record, &payload["source"])?;
            let source_kind = text(&payload["source"]["sourceKind"])?;
            if ["network-segment", "network-interface"].contains(&source_kind) {
                return Err(SemanticError::invalid(
                    "Abstract segments/interfaces cannot be physical bindings",
                ));
            }
            if ["network-group", "magicplan-room"].contains(&source_kind)
                && identity["payload"]["kind"] != "location"
            {
                return Err(SemanticError::invalid(
                    "Place reference requires location identity",
                ));
            }
            if source_kind == "network-device" && identity["payload"]["kind"] != "item" {
                return Err(SemanticError::invalid(
                    "Network device requires item identity",
                ));
            }
            if !binding_keys.insert(qualified_source_key(record, &payload["source"])?) {
                return Err(SemanticError::new(
                    SemanticCode::IdentityConflict,
                    "Qualified source key already reserved, including retired bindings",
                ));
            }
            if record["lifecycle"] == "active"
                && payload["reviewStatus"] == "accepted"
                && identity["lifecycle"] != "active"
            {
                return Err(SemanticError::new(
                    SemanticCode::InvalidTransition,
                    "Accepted binding needs active identity",
                ));
            }
        }
        if record["recordType"] == "location-semantics" {
            if graph.get(record, "identity", text(&payload["atlasId"])?)?["payload"]["kind"]
                != "location"
            {
                return Err(SemanticError::invalid(
                    "Semantic classification requires location identity",
                ));
            }
            if record["lifecycle"] == "active" && payload["reviewStatus"] == "accepted" {
                let key = [
                    text(&record["workspaceId"])?.to_owned(),
                    text(&record["homeId"])?.to_owned(),
                    text(&payload["atlasId"])?.to_owned(),
                ];
                if !semantic_keys.insert(key) {
                    return Err(SemanticError::new(
                        SemanticCode::IdentityConflict,
                        "Only one active accepted classification per location",
                    ));
                }
            }
        }
        if record["recordType"] == "circuit" && payload["panel"]["kind"] == "atlas-record" {
            let panel = graph.get(
                record,
                text(&payload["panel"]["ref"]["recordType"])?,
                text(&payload["panel"]["ref"]["recordId"])?,
            )?;
            if panel["recordType"] != "identity" || panel["payload"]["kind"] != "item" {
                return Err(SemanticError::invalid(
                    "Circuit panel must reference a physical item",
                ));
            }
        }
        if record["recordType"] == "relation" {
            // Resolve both endpoints before checking either endpoint's domain type.
            let endpoints = [
                graph.endpoint(record, &payload["from"])?,
                graph.endpoint(record, &payload["to"])?,
            ];
            for endpoint in endpoints.iter().flatten() {
                if !["identity", "circuit", "valve"].contains(&text(&endpoint["recordType"])?) {
                    return Err(SemanticError::invalid("Invalid domain endpoint type"));
                }
            }
            if payload["kind"] == "circuit-supplies" {
                if endpoints[0].is_none_or(|endpoint| endpoint["recordType"] != "circuit")
                    || payload["medium"] != "electricity"
                {
                    return Err(SemanticError::invalid(
                        "Circuit relation must start at a circuit with electricity medium",
                    ));
                }
                if endpoints[1].is_some_and(|endpoint| {
                    endpoint["recordType"] != "identity" || endpoint["payload"]["kind"] != "item"
                }) {
                    return Err(SemanticError::invalid(
                        "Circuit endpoint must be item or unresolved",
                    ));
                }
                let claims = graph.evidence(record, &payload["evidenceIds"])?;
                if claims.iter().all(|claim| {
                    claim["payload"]["provenance"]["source"]["key"]["sourceKind"]
                        .as_str()
                        .is_some_and(|kind| kind.starts_with("network-"))
                }) {
                    return Err(SemanticError::invalid(
                        "Network evidence alone cannot assert an electrical relation",
                    ));
                }
            }
            if payload["kind"] == "valve-controls" {
                if endpoints[0].is_none_or(|endpoint| endpoint["recordType"] != "valve")
                    || !["water", "gas", "heating", "other", "unknown"]
                        .contains(&text(&payload["medium"])?)
                {
                    return Err(SemanticError::invalid(
                        "Valve relation must start at a valve with fluid medium",
                    ));
                }
                if endpoints[0].is_some_and(|endpoint| {
                    endpoint["payload"]["medium"] != "unknown"
                        && endpoint["payload"]["medium"] != payload["medium"]
                }) {
                    return Err(SemanticError::invalid("Valve medium mismatch"));
                }
            }
        }
        if record["recordType"] == "geometry" {
            let original = graph.get(record, "asset", text(&payload["originalAssetId"])?)?;
            if original["payload"]["purpose"] != "geometry-original" {
                return Err(SemanticError::invalid(
                    "Geometry must preserve an original asset",
                ));
            }
            if payload["coordinateUnits"] == "unknown"
                && (!payload["scale"].is_null() || !payload["transform"].is_null())
            {
                return Err(SemanticError::invalid(
                    "Unknown geometry units cannot imply scale or transform",
                ));
            }
            if truthy(&payload["previousGeometryId"]) {
                let previous =
                    graph.get(record, "geometry", text(&payload["previousGeometryId"])?)?;
                if number(&previous["payload"]["geometryVersion"])?
                    >= number(&payload["geometryVersion"])?
                {
                    return Err(SemanticError::invalid("Geometry versions must increase"));
                }
            }
            let mut rooms = HashSet::new();
            for mapping in items(&payload["mappings"])? {
                if !rooms.insert(text(&mapping["producerRoomId"])?) {
                    return Err(SemanticError::new(
                        SemanticCode::IdentityConflict,
                        "Duplicate producer room mapping",
                    ));
                }
                if graph.get(record, "identity", text(&mapping["atlasId"])?)?["payload"]["kind"]
                    != "location"
                {
                    return Err(SemanticError::invalid(
                        "Geometry mapping requires location identity",
                    ));
                }
                graph.evidence(record, &mapping["evidenceIds"])?;
                if truthy(&mapping["homeboxEntity"]) {
                    if !same_scope(record, &mapping["homeboxEntity"])?
                        || mapping["homeboxEntity"]["key"]["sourceKind"] != "homebox-entity"
                    {
                        return Err(SemanticError::new(
                            SemanticCode::Forbidden,
                            "Cross-home geometry binding",
                        ));
                    }
                    graph.source(record, &mapping["homeboxEntity"]["key"])?;
                    if mapping["reviewStatus"] == "accepted" {
                        let mut found = false;
                        for binding in records {
                            if same_scope(record, binding)?
                                && binding["recordType"] == "binding"
                                && binding["payload"]["atlasId"] == mapping["atlasId"]
                                && js_equal(
                                    &binding["payload"]["source"],
                                    &mapping["homeboxEntity"]["key"],
                                )
                            {
                                found = true;
                                break;
                            }
                        }
                        if !found {
                            return Err(SemanticError::invalid(
                                "Historical accepted geometry requires a retained exact compatible binding",
                            ));
                        }
                    }
                }
            }
        }
        if record["recordType"] == "reconciliation" {
            graph.get(record, "identity", text(&payload["atlasId"])?)?;
            let from = graph.get(record, "binding", text(&payload["fromBindingId"])?)?;
            let to = graph.get(record, "binding", text(&payload["toBindingId"])?)?;
            if from["recordId"] == to["recordId"]
                || from["payload"]["atlasId"] != payload["atlasId"]
                || to["payload"]["atlasId"] != payload["atlasId"]
            {
                return Err(SemanticError::invalid(
                    "Remap journal requires retained compatible bindings for the same permanent identity",
                ));
            }
        }
    }

    validate_evidence_cycles(&graph, records)?;
    // Journals retain historical endpoints irrespective of later retirement.
    validate_remap_cycles(&graph, records)?;

    let mut projections = HashMap::new();
    for projection in homebox_entities {
        if projection["source"]["sourceKind"] != "homebox-entity"
            || projection["source"]["externalId"] != projection["entity"]["id"]
        {
            return Err(SemanticError::invalid(
                "Projection source/entity ID mismatch",
            ));
        }
        graph.source(projection, &projection["source"])?;
        let key = qualified_source_key(projection, &projection["source"])?;
        if projections.contains_key(&key) {
            return Err(SemanticError::new(
                SemanticCode::IdentityConflict,
                "Duplicate projection ID",
            ));
        }
        projections.insert(key, projection);
        for link in items(&projection["nativeLinks"])? {
            if !same_scope(projection, &link["entity"])?
                || !js_equal(&link["entity"]["key"], &projection["source"])
            {
                return Err(SemanticError::new(
                    SemanticCode::Forbidden,
                    "Native link source mismatch",
                ));
            }
            // The published URL constructor throws a raw TypeError on parse failure.
            // This typed native boundary reports that failure as invalid-contract;
            // successfully parsed URLs are checked without rewriting the wire href.
            let url = Url::parse(text(&link["href"])?)
                .map_err(|_| SemanticError::invalid("Invalid URL"))?;
            if !url.username().is_empty()
                || url.password().is_some_and(|password| !password.is_empty())
                || url.query().is_some_and(|query| !query.is_empty())
                || url.fragment().is_some_and(|fragment| !fragment.is_empty())
            {
                return Err(SemanticError::invalid(
                    "Native link must use a verified credential-free route without query/fragment",
                ));
            }
        }
    }
    for binding in records {
        if binding["recordType"] != "binding"
            || binding["payload"]["source"]["sourceKind"] != "homebox-entity"
        {
            continue;
        }
        if let Some(projection) = projections.get(&qualified_source_key(
            binding,
            &binding["payload"]["source"],
        )?) {
            if !same_scope(binding, projection)? {
                return Err(SemanticError::new(
                    SemanticCode::Forbidden,
                    "Projection in wrong home",
                ));
            }
            if truthy(&projection["entity"]["entityType"]) {
                let kind = if truthy(&projection["entity"]["entityType"]["isLocation"]) {
                    "location"
                } else {
                    "item"
                };
                if graph.get(binding, "identity", text(&binding["payload"]["atlasId"])?)?["payload"]
                    ["kind"]
                    != kind
                {
                    return Err(SemanticError::invalid(
                        "Explicit HomeBox location/item flag mismatch",
                    ));
                }
            }
        }
    }
    for start in homebox_entities {
        let mut visited = HashSet::new();
        let mut next = Some(start);
        while let Some(projection) = next {
            if !visited.insert(text(&projection["entity"]["id"])?) {
                return Err(SemanticError::invalid("HomeBox parent cycle"));
            }
            next = if truthy(&projection["entity"]["parent"]) {
                let mut key = qualified_source_key(projection, &projection["source"])?;
                key[4] = text(&projection["entity"]["parent"]["id"])?.to_owned();
                projections.get(&key).copied()
            } else {
                None
            };
            if let Some(parent) = next {
                if !same_scope(start, parent)? {
                    return Err(SemanticError::new(
                        SemanticCode::Forbidden,
                        "Cross-home parentage",
                    ));
                }
            }
        }
    }

    let mut caches = HashMap::new();
    for cache in items(&snapshot["caches"])? {
        let key = source_scope_key(cache)?;
        if !graph.registrations.contains_key(&key) {
            return Err(SemanticError::new(
                SemanticCode::Forbidden,
                "Cache source outside registered scope",
            ));
        }
        if caches.contains_key(&key) {
            return Err(SemanticError::new(
                SemanticCode::IdentityConflict,
                "Duplicate cache scope",
            ));
        }
        caches.insert(key, cache);
        if cache["lastSuccessfulFetchAt"].is_null() != cache["generationId"].is_null() {
            return Err(SemanticError::invalid(
                "Cache generation and success timestamp must coexist",
            ));
        }
        if cache["status"] == "fresh"
            && (!truthy(&cache["lastSuccessfulFetchAt"]) || truthy(&cache["error"]))
        {
            return Err(SemanticError::invalid(
                "Fresh cache needs successful generation without error",
            ));
        }
        if cache["status"] == "empty" && !cache["lastSuccessfulFetchAt"].is_null() {
            return Err(SemanticError::invalid(
                "Empty cache cannot discard prior success",
            ));
        }
        if cache["status"] == "error" && !truthy(&cache["error"]) {
            return Err(SemanticError::invalid("Error cache needs an error"));
        }
    }
    for projection in homebox_entities {
        let cache = caches
            .get(&scoped_source_key(projection, &projection["source"])?)
            .copied()
            .filter(|cache| {
                truthy(&cache["lastSuccessfulFetchAt"]) && truthy(&cache["generationId"])
            })
            .ok_or_else(|| {
                SemanticError::invalid("Cached projection requires successful generation metadata")
            })?;
        if date_greater(
            text(&projection["retrievedAt"])?,
            text(&cache["lastSuccessfulFetchAt"])?,
        ) {
            return Err(SemanticError::invalid(
                "Projection retrieval cannot follow its successful generation",
            ));
        }
    }
    for relation in items(&snapshot["networkRelations"])? {
        graph.source_parts(
            relation,
            relation,
            "network-segment",
            text(&relation["externalId"])?,
        )?;
        if relation["kind"] == "network-segment-membership"
            && !(relation["to"]["kind"] == "segment"
                && ["device", "interface"].contains(&text(&relation["from"]["kind"])?))
        {
            return Err(SemanticError::invalid(
                "Segment membership is member-to-segment, never a chain",
            ));
        }
        if relation["kind"] == "network-association"
            && relation["temporalStatus"] == "current-claim"
        {
            return Err(SemanticError::invalid(
                "Historical associations cannot become current connections",
            ));
        }
        for endpoint in [&relation["from"], &relation["to"]] {
            if (endpoint["kind"] == "unresolved") != endpoint["id"].is_null() {
                return Err(SemanticError::invalid(
                    "Unknown endpoint must remain unresolved",
                ));
            }
            if endpoint["kind"] != "unresolved" {
                let kind = format!("network-{}", text(&endpoint["kind"])?);
                graph.source_parts(relation, relation, &kind, text(&endpoint["id"])?)?;
            }
        }
    }
    Ok(())
}

struct Frame<'a> {
    record: &'a Value,
    next: usize,
}

fn validate_evidence_cycles(graph: &Graph<'_>, records: &[Value]) -> Result<()> {
    for start in records {
        if start["recordType"] != "evidence" {
            continue;
        }
        let mut path = HashSet::new();
        path.insert(text(&start["recordId"])?);
        let mut stack = vec![Frame {
            record: start,
            next: 0,
        }];
        while let Some(frame) = stack.last_mut() {
            let ids = items(&frame.record["payload"]["supersedesEvidenceIds"])?;
            if let Some(id) = ids.get(frame.next) {
                frame.next += 1;
                let child = graph.get(frame.record, "evidence", text(id)?)?;
                if !path.insert(text(&child["recordId"])?) {
                    return Err(SemanticError::invalid("Evidence supersession cycle"));
                }
                stack.push(Frame {
                    record: child,
                    next: 0,
                });
            } else if let Some(finished) = stack.pop() {
                path.remove(text(&finished.record["recordId"])?);
            }
        }
    }
    Ok(())
}

fn validate_remap_cycles(graph: &Graph<'_>, records: &[Value]) -> Result<()> {
    for start in records {
        if start["recordType"] != "reconciliation" {
            continue;
        }
        let mut path = HashSet::new();
        path.insert(text(&start["payload"]["fromBindingId"])?);
        let to = graph.get(start, "binding", text(&start["payload"]["toBindingId"])?)?;
        if !path.insert(text(&to["recordId"])?) {
            return Err(SemanticError::invalid("Binding remap cycle"));
        }
        let mut stack = vec![Frame {
            record: to,
            next: 0,
        }];
        while let Some(frame) = stack.last_mut() {
            let mut next = None;
            while let Some(journal) = records.get(frame.next) {
                frame.next += 1;
                if same_scope(start, journal)?
                    && journal["recordType"] == "reconciliation"
                    && journal["payload"]["atlasId"] == start["payload"]["atlasId"]
                    && journal["payload"]["fromBindingId"] == frame.record["recordId"]
                {
                    next = Some(graph.get(
                        start,
                        "binding",
                        text(&journal["payload"]["toBindingId"])?,
                    )?);
                    break;
                }
            }
            if let Some(child) = next {
                if !path.insert(text(&child["recordId"])?) {
                    return Err(SemanticError::invalid("Binding remap cycle"));
                }
                stack.push(Frame {
                    record: child,
                    next: 0,
                });
            } else if let Some(finished) = stack.pop() {
                path.remove(text(&finished.record["recordId"])?);
            }
        }
    }
    Ok(())
}
