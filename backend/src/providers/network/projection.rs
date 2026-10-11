use super::{
    json::{bounded_json, safe_revision},
    model::*,
};
use chrono::DateTime;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn text(value: &str, max: usize) -> bool {
    value.encode_utf16().count() <= max
}
pub(crate) fn id(value: &str) -> bool {
    !value.is_empty() && text(value, 4096)
}
// JSON Schema string lengths count Unicode code points. Keep this separate
// from the pinned upstream text/opaque-ID rules, which count UTF-16 code units.
fn schema_id(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 4096
}
pub(crate) fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, b)| {
            if [8, 13, 18, 23].contains(&index) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
pub(crate) fn stamp(value: &str) -> Result<i64> {
    guard(value.as_bytes().get(10) == Some(&b'T'))?;
    DateTime::parse_from_rfc3339(value)
        .map(|at| at.timestamp_millis())
        .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))
}
fn optional_stamp(value: &Option<String>) -> Result<()> {
    if let Some(value) = value {
        stamp(value)?;
    }
    Ok(())
}
pub(crate) fn validate_limits(limits: Limits) -> Result<()> {
    guard(
        limits.max_response_bytes > 0
            && limits.max_records > 0
            && limits.request_timeout_ms > 0
            && limits.request_timeout_ms <= 9_007_199_254_740_991,
    )
}
pub(crate) fn validate_registration(source: &SourceRegistration) -> Result<()> {
    let scope = &source.scope;
    if source.owner != "network"
        || !uuid(&scope.workspace_id)
        || !uuid(&scope.home_id)
        || !uuid(&scope.source_instance_id)
        || !schema_id(&scope.collection_id)
        || source
            .allowed_external_ids
            .iter()
            .any(|value| !schema_id(value))
        || source
            .allowed_external_ids
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != source.allowed_external_ids.len()
        || source.partition_mode == PartitionMode::ExclusiveHome
            && !source.allowed_external_ids.is_empty()
    {
        return Err(NetworkError::new(ErrorCode::WrongScope));
    }
    Ok(())
}
pub(crate) fn allowed(source: &SourceRegistration, external_id: &str) -> Result<()> {
    if source.partition_mode == PartitionMode::ReviewedEntityAllowlist
        && !source
            .allowed_external_ids
            .iter()
            .any(|value| value == external_id)
    {
        return Err(NetworkError::new(ErrorCode::WrongScope));
    }
    Ok(())
}
pub(crate) fn same_scope(source: &SourceRegistration, actual: &SourceScope) -> Result<()> {
    if &source.scope == actual {
        Ok(())
    } else {
        Err(NetworkError::new(ErrorCode::WrongScope))
    }
}
fn decode<T: DeserializeOwned>(value: &Value) -> Result<T> {
    serde_json::from_value(value.clone()).map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))
}
fn object(value: &Value) -> Result<&serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))
}
fn field_id<'a>(row: &'a Value, key: &str) -> Result<&'a str> {
    let value = row
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    guard(id(value))?;
    Ok(value)
}
fn source_text(value: &str) -> Result<()> {
    guard(text(value, 2000))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Group {
    id: String,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Device {
    id: String,
    name: String,
    kind: String,
    #[serde(default, deserialize_with = "present")]
    role: Option<String>,
    #[serde(default, deserialize_with = "present")]
    mobility: Option<String>,
    #[serde(default, deserialize_with = "present")]
    room_id: Option<String>,
    #[serde(default, deserialize_with = "present")]
    notes: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Interface {
    id: String,
    device_id: String,
    name: String,
    addresses: Vec<String>,
    #[serde(default, deserialize_with = "present")]
    mac: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Segment {
    id: String,
    name: String,
    kind: String,
    #[serde(default, deserialize_with = "present")]
    room_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Link {
    id: String,
    from: String,
    to: String,
    medium: Medium,
    confidence: String,
    #[serde(default, deserialize_with = "present")]
    observed_at: Option<String>,
    #[serde(default, deserialize_with = "present")]
    notes: Option<String>,
    #[serde(default, deserialize_with = "present")]
    reported_rate: Option<Rate>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rate {
    kind: String,
    mbps: f64,
    source: String,
    observed_at: String,
}
struct InventoryInput {
    revision: u64,
    groups: Vec<Value>,
    devices: Vec<Value>,
    interfaces: Vec<Value>,
    segments: Vec<Value>,
    links: Vec<Value>,
    observations: Vec<Value>,
    endpoints: BTreeMap<String, EndpointKind>,
}
fn rows(document: &Value, key: &str) -> Result<Vec<Value>> {
    document
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))
}
fn unique(rows: &[Value], max_records: usize, source: &SourceRegistration) -> Result<()> {
    if rows.len() > max_records {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    let mut ids = BTreeSet::new();
    for row in rows {
        let external_id = field_id(row, "id")?;
        guard(ids.insert(external_id))?;
        allowed(source, external_id)?;
    }
    Ok(())
}
fn inventory_input(
    document: &Value,
    source: &SourceRegistration,
    max_records: usize,
) -> Result<InventoryInput> {
    object(document)?;
    let revision = safe_revision(
        document
            .get("revision")
            .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?,
    )?;
    let inv = document
        .get("inventory")
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    object(inv)?;
    let mut input = InventoryInput {
        revision,
        groups: rows(inv, "rooms")?,
        devices: rows(inv, "devices")?,
        interfaces: rows(inv, "interfaces")?,
        segments: rows(inv, "segments")?,
        links: rows(inv, "links")?,
        observations: match document.get("observations") {
            Some(value) => value
                .as_array()
                .cloned()
                .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?,
            None => Vec::new(),
        },
        endpoints: BTreeMap::new(),
    };
    let mut all = BTreeSet::new();
    for list in [
        &input.groups,
        &input.devices,
        &input.interfaces,
        &input.segments,
        &input.links,
    ] {
        unique(list, max_records, source)?;
        for row in list {
            guard(all.insert(field_id(row, "id")?))?;
        }
    }
    if all.len() > max_records {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    let groups: BTreeSet<_> = input
        .groups
        .iter()
        .map(|row| field_id(row, "id"))
        .collect::<Result<_>>()?;
    let devices: BTreeSet<_> = input
        .devices
        .iter()
        .map(|row| field_id(row, "id"))
        .collect::<Result<_>>()?;
    for row in &input.groups {
        let value: Group = decode(row)?;
        guard(id(&value.id))?;
        source_text(&value.name)?;
    }
    for row in &input.devices {
        let value: Device = decode(row)?;
        guard(id(&value.id))?;
        source_text(&value.name)?;
        source_text(&value.kind)?;
        guard(
            value
                .room_id
                .as_ref()
                .is_none_or(|group| groups.contains(group.as_str())),
        )?;
        guard(
            value
                .role
                .as_deref()
                .is_none_or(|value| ["infrastructure", "client"].contains(&value)),
        )?;
        guard(
            value
                .mobility
                .as_deref()
                .is_none_or(|value| ["fixed", "mobile"].contains(&value)),
        )?;
        guard(value.mobility.as_deref() != Some("mobile") || value.room_id.is_none())?;
        if let Some(notes) = value.notes {
            source_text(&notes)?;
        }
        input.endpoints.insert(value.id, EndpointKind::Device);
    }
    for row in &input.interfaces {
        let value: Interface = decode(row)?;
        guard(id(&value.id) && devices.contains(value.device_id.as_str()))?;
        source_text(&value.name)?;
        guard(value.addresses.iter().all(|value| text(value, 200)))?;
        if let Some(mac) = value.mac {
            guard(
                mac.len() == 17
                    && mac.bytes().enumerate().all(|(index, b)| {
                        if index % 3 == 2 {
                            b == b':'
                        } else {
                            b.is_ascii_hexdigit()
                        }
                    }),
            )?;
        }
        input.endpoints.insert(value.id, EndpointKind::Interface);
    }
    for row in &input.segments {
        let value: Segment = decode(row)?;
        guard(id(&value.id))?;
        source_text(&value.name)?;
        guard(["powerline", "lan", "unknown"].contains(&value.kind.as_str()))?;
        guard(
            value
                .room_id
                .as_ref()
                .is_none_or(|group| groups.contains(group.as_str())),
        )?;
        input.endpoints.insert(value.id, EndpointKind::Segment);
    }
    for row in &input.links {
        let value: Link = decode(row)?;
        guard(
            id(&value.id)
                && input.endpoints.contains_key(&value.from)
                && input.endpoints.contains_key(&value.to),
        )?;
        guard(matches!(
            value.medium,
            Medium::Ethernet | Medium::Wifi | Medium::Powerline | Medium::Unknown
        ))?;
        guard(
            ["confirmed", "reported", "inferred", "unknown"].contains(&value.confidence.as_str()),
        )?;
        optional_stamp(&value.observed_at)?;
        if let Some(notes) = &value.notes {
            source_text(notes)?;
        }
        if let Some(rate) = value.reported_rate {
            guard(
                rate.kind == "negotiated-port"
                    && rate.mbps.is_finite()
                    && rate.mbps > 0.0
                    && rate.mbps <= 1_000_000.0
                    && id(&rate.source),
            )?;
            stamp(&rate.observed_at)?;
        }
    }
    let positions = inv
        .get("positions")
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    for position in object(positions)?.values() {
        let position = object(position)?;
        guard(["x", "y"].iter().all(|key| {
            position
                .get(*key)
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite)
        }))?;
    }
    Ok(input)
}
fn validate_review(review: &LinkReview, input: &InventoryInput) -> Result<()> {
    guard(review.revision == input.revision && review.links.len() == input.links.len())?;
    for link in &input.links {
        guard(review.links.contains_key(field_id(link, "id")?))?;
    }
    for evidence in review.links.values() {
        optional_stamp(&evidence.fact_at)?;
        guard(evidence.vantage.as_ref().is_none_or(|value| id(value)))?;
        guard(
            evidence
                .unresolved_to
                .as_ref()
                .is_none_or(|value| id(value)),
        )?;
    }
    Ok(())
}

/// Offline input only. The document may be a retained snapshot, but the live
/// transport can request only GET /api/inventory. Graph positions are discarded.
pub struct NetworkCapture<'a> {
    pub source: &'a SourceScope,
    pub document: &'a [u8],
    pub retrieved_at: &'a str,
    pub source_snapshot_at: Option<&'a str>,
}
pub fn project_capture(
    source: &SourceRegistration,
    capture: NetworkCapture<'_>,
    review: &LinkReview,
    limits: Limits,
) -> Result<NetworkGeneration> {
    validate_registration(source)?;
    validate_limits(limits)?;
    same_scope(source, capture.source)?;
    stamp(capture.retrieved_at)?;
    if let Some(at) = capture.source_snapshot_at {
        stamp(at)?;
    }
    let document = bounded_json(capture.document, limits.max_response_bytes)?;
    let input = inventory_input(&document, source, limits.max_records)?;
    validate_review(review, &input)?;
    let mut relations = Vec::with_capacity(input.links.len());
    for row in &input.links {
        let link: Link = decode(row)?;
        let evidence = &review.links[&link.id];
        let mut from = NetworkEndpoint {
            kind: input.endpoints[&link.from],
            id: Some(link.from),
            description: None,
        };
        let mut to = NetworkEndpoint {
            kind: input.endpoints[&link.to],
            id: Some(link.to),
            description: None,
        };
        guard(
            evidence.kind == RelationKind::Membership
                || (from.kind != EndpointKind::Segment && to.kind != EndpointKind::Segment),
        )?;
        if evidence.kind == RelationKind::Membership && from.kind == EndpointKind::Segment {
            std::mem::swap(&mut from, &mut to);
        }
        if let Some(description) = &evidence.unresolved_to {
            to = NetworkEndpoint {
                kind: EndpointKind::Unresolved,
                id: None,
                description: Some(description.clone()),
            };
        }
        guard(
            evidence.kind != RelationKind::Membership
                || (to.kind == EndpointKind::Segment
                    && matches!(from.kind, EndpointKind::Device | EndpointKind::Interface)),
        )?;
        guard(
            evidence.kind != RelationKind::Association
                || evidence.temporal_status != TemporalStatus::CurrentClaim,
        )?;
        relations.push(NetworkRelation {
            schema_version: 1,
            scope: source.scope.clone(),
            external_id: link.id,
            kind: evidence.kind,
            from,
            to,
            medium: link.medium,
            source_revision: input.revision,
            source_snapshot_at: capture.source_snapshot_at.map(str::to_owned),
            retrieved_at: capture.retrieved_at.into(),
            vantage: evidence.vantage.clone(),
            source_confidence: link.confidence,
            evidence_basis: evidence.evidence_basis,
            temporal_status: evidence.temporal_status,
            fact_at: link.observed_at.or_else(|| evidence.fact_at.clone()),
            notes: link.notes.unwrap_or_default(),
        });
    }
    let project = |list: &[Value], kind| -> Result<Vec<QualifiedRecord>> {
        list.iter()
            .map(|row| {
                Ok(QualifiedRecord {
                    schema_version: 1,
                    scope: source.scope.clone(),
                    source_kind: kind,
                    external_id: field_id(row, "id")?.into(),
                    source_revision: input.revision,
                    source_snapshot_at: capture.source_snapshot_at.map(str::to_owned),
                    retrieved_at: capture.retrieved_at.into(),
                    value: row.clone(),
                })
            })
            .collect()
    };
    unique(&input.observations, limits.max_records, source)?;
    let mut observations = Vec::new();
    for row in &input.observations {
        let external_id = field_id(row, "id")?;
        field_id(row, "collectorId")?;
        field_id(row, "kind")?;
        let vantage = field_id(row, "vantagePoint")?;
        let fact_at = row
            .get("timestamp")
            .and_then(Value::as_str)
            .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
        stamp(fact_at)?;
        object(
            row.get("value")
                .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?,
        )?;
        if let Some(at) = row.get("invalidatedAt") {
            stamp(
                at.as_str()
                    .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?,
            )?;
        }
        for (key, kind) in [
            ("deviceId", EndpointKind::Device),
            ("interfaceId", EndpointKind::Interface),
        ] {
            if row.get(key).is_some() {
                let endpoint = field_id(row, key)?;
                guard(input.endpoints.get(endpoint) == Some(&kind))?;
                allowed(source, endpoint)?;
            }
        }
        guard(
            source.partition_mode != PartitionMode::ReviewedEntityAllowlist
                || row.get("deviceId").is_some()
                || row.get("interfaceId").is_some(),
        )?;
        observations.push(RetainedObservation {
            scope: source.scope.clone(),
            external_id: external_id.into(),
            source_revision: input.revision,
            source_snapshot_at: capture.source_snapshot_at.map(str::to_owned),
            retrieved_at: capture.retrieved_at.into(),
            fact_at: fact_at.into(),
            vantage: vantage.into(),
            value: row.clone(),
        });
    }
    Ok(NetworkGeneration {
        schema_version: 1,
        scope: source.scope.clone(),
        source_revision: input.revision,
        source_snapshot_at: capture.source_snapshot_at.map(str::to_owned),
        retrieved_at: capture.retrieved_at.into(),
        inventory: ProjectedInventory {
            groups: project(&input.groups, SourceKind::Group)?,
            devices: project(&input.devices, SourceKind::Device)?,
            interfaces: project(&input.interfaces, SourceKind::Interface)?,
            segments: project(&input.segments, SourceKind::Segment)?,
            links: project(&input.links, SourceKind::Link)?,
        },
        network_relations: relations,
        observations,
        link_review: review.clone(),
        provenance: Provenance {
            input: "network-inventory-document".into(),
            link_review_revision: review.revision,
            graph_positions_establish_geometry: false,
            groups_establish_placement: false,
            segments_establish_circuits: false,
            source_history_is_complete: false,
        },
    })
}

pub(crate) fn inventory_values(generation: &NetworkGeneration) -> Value {
    let values =
        |rows: &[QualifiedRecord]| rows.iter().map(|row| row.value.clone()).collect::<Vec<_>>();
    json!({ "rooms": values(&generation.inventory.groups), "devices": values(&generation.inventory.devices),
        "interfaces": values(&generation.inventory.interfaces), "segments": values(&generation.inventory.segments),
        "links": values(&generation.inventory.links), "positions": {} })
}
/// Rebuild every relation from its retained link and its retained review. A
/// newer configured review does not reinterpret an older cached generation.
pub fn validate_state(
    source: &SourceRegistration,
    state: &RetainedState,
    configured_review: Option<&LinkReview>,
) -> Result<()> {
    validate_registration(source)?;
    same_scope(source, &state.cache.scope)?;
    let cache = &state.cache;
    guard(cache.schema_version == 1 && cache.consistency == "non-transactional-offset-pages")?;
    optional_stamp(&cache.last_attempt_at)?;
    optional_stamp(&cache.last_successful_fetch_at)?;
    guard(cache.generation_id.is_none() == cache.last_successful_fetch_at.is_none())?;
    guard(cache.generation_id.as_ref().is_none_or(|value| uuid(value)))?;
    if let Some(error) = &cache.error {
        stamp(&error.at)?;
        guard(schema_id(&error.message))?;
    }
    guard(
        cache.status != CacheStatus::Fresh || (state.generation.is_some() && cache.error.is_none()),
    )?;
    guard(
        (cache.status == CacheStatus::AccessRevoked && state.generation.is_none())
            || state.generation.is_none() == cache.last_successful_fetch_at.is_none(),
    )?;
    if let Some(generation) = &state.generation {
        same_scope(source, &generation.scope)?;
        let success = cache
            .last_successful_fetch_at
            .as_ref()
            .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
        guard(stamp(&generation.retrieved_at)? <= stamp(success)?)?;
        if let Some(review) =
            configured_review.filter(|review| review.revision == generation.source_revision)
        {
            guard(review == &generation.link_review)?;
        }
        validate_generation(source, generation)?;
    }
    Ok(())
}

/// Reconstruct the complete original capture using its retained review. This
/// validates raw members and every projected relation together; it issues no
/// grants and performs no cache read, provider request or freshness decision.
pub fn validate_generation(
    source: &SourceRegistration,
    generation: &NetworkGeneration,
) -> Result<()> {
    let document = json!({"revision": generation.source_revision, "inventory": inventory_values(generation),
        "observations": generation.observations.iter().map(|row| row.value.clone()).collect::<Vec<_>>()});
    let bytes =
        serde_json::to_vec(&document).map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?;
    let expected = project_capture(
        source,
        NetworkCapture {
            source: &generation.scope,
            document: &bytes,
            retrieved_at: &generation.retrieved_at,
            source_snapshot_at: generation.source_snapshot_at.as_deref(),
        },
        &generation.link_review,
        Limits {
            max_response_bytes: 10 * 1024 * 1024,
            ..Limits::default()
        },
    )?;
    guard(generation == &expected)?;
    Ok(())
}
