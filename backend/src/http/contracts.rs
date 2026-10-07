//! Native schema and graph validation for the read-only HomeBox slice.
//! Unsupported graph families and every command fail closed. No JS oracle or
//! fixture-specific validator is used by the application.
use crate::storage::*;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub struct ReadContracts;

fn invalid(message: &'static str) -> Error {
    Error::new("invalid-contract", message)
}
fn require(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(invalid(message))
    }
}
fn unavailable<T>() -> Result<T> {
    Err(Error::new(
        "unavailable",
        "Native command and asset integration is unavailable",
    ))
}
fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str()
        .ok_or(invalid("Required graph string is missing"))
}
fn array<'a>(v: &'a Value, k: &str) -> Result<&'a [Value]> {
    v[k].as_array()
        .map(Vec::as_slice)
        .ok_or(invalid("Required graph array is missing"))
}
fn date(v: &Value) -> Result<i64> {
    ReadContracts
        .timestamp_millis(v.as_str().ok_or(invalid("Missing date"))?)?
        .ok_or(invalid("Unorderable date"))
}
fn scope(v: &Value) -> Value {
    json!([v["workspaceId"], v["homeId"]])
}
fn partition(v: &Value, key: &Value) -> String {
    json!([
        v["workspaceId"],
        v["homeId"],
        key["sourceInstanceId"],
        key["collectionId"]
    ])
    .to_string()
}
fn source_key(v: &Value, key: &Value) -> String {
    json!([
        v["workspaceId"],
        key["sourceInstanceId"],
        key["collectionId"],
        key["sourceKind"],
        key["externalId"]
    ])
    .to_string()
}
fn record_key(v: &Value, kind: &str, id: &Value) -> String {
    json!([v["workspaceId"], v["homeId"], kind, id]).to_string()
}
fn get<'a>(
    records: &'a BTreeMap<String, &'a Value>,
    v: &Value,
    kind: &str,
    id: &Value,
) -> Result<&'a Value> {
    records
        .get(&record_key(v, kind, id))
        .copied()
        .ok_or(invalid("Missing scoped graph reference"))
}
fn source<'a>(sources: &'a BTreeMap<String, &'a Value>, v: &Value, key: &Value) -> Result<()> {
    let registration = sources
        .get(&partition(v, key))
        .ok_or(invalid("Unregistered source"))?;
    require(
        registration["owner"] == "homebox" && key["sourceKind"] == "homebox-entity",
        "Unsupported source family",
    )?;
    crate::access::CanonicalId::parse(text(key, "externalId")?)
        .map_err(|_| invalid("Invalid HomeBox identity"))?;
    require(
        registration["partitionMode"] != "reviewed-entity-allowlist"
            || array(registration, "allowedExternalIds")?.contains(&key["externalId"]),
        "Source outside reviewed partition",
    )
}

impl ReadContracts {
    pub fn shape(&self, name: &str, value: &Value) -> Result<()> {
        // The real generated peer performs checked numeric preprocessing before
        // frozen schema validation and typed decoding. Do not bypass its boundary.
        fn typed<T: crate::contracts::Contract>(value: &Value) -> Result<()> {
            crate::contracts::decode::<T>(&serde_json::to_vec(value)?)
                .map(|_| ())
                .map_err(|error| match error {
                    crate::contracts::ContractError::UnsupportedNumber(_)
                    | crate::contracts::ContractError::Setup(_) => {
                        Error::new("unavailable", "Native contract processing unavailable")
                    }
                    _ => invalid("Typed contract validation failed"),
                })
        }
        use crate::contracts as dto;
        match name {
            "scope" => typed::<dto::Scope>(value),
            "snapshot" => typed::<dto::Snapshot>(value),
            "record" => typed::<dto::Record>(value),
            "recordRef" => typed::<dto::RecordRef>(value),
            "audit" => typed::<dto::Audit>(value),
            "sourceRegistration" => typed::<dto::SourceRegistration>(value),
            "homeboxProjection" => typed::<dto::HomeboxProjection>(value),
            "cacheStatus" => typed::<dto::CacheStatus>(value),
            _ => unavailable(),
        }
    }

    fn graph(&self, v: &Value) -> Result<()> {
        self.shape("snapshot", v)?;
        require(
            array(v, "networkRelations")?.is_empty(),
            "Network graph integration is unavailable",
        )?;
        let mut sources = BTreeMap::new();
        for s in array(v, "sources")? {
            require(
                s["owner"] == "homebox",
                "Only HomeBox sources are integrated",
            )?;
            require(
                sources.insert(partition(s, s), s).is_none(),
                "Duplicate source partition",
            )?;
            require(
                s["partitionMode"] != "exclusive-home"
                    || array(s, "allowedExternalIds")?.is_empty(),
                "Exclusive source has an allowlist",
            )?;
        }
        for a in sources.values() {
            for b in sources.values() {
                if a["workspaceId"] == b["workspaceId"]
                    && a["sourceInstanceId"] == b["sourceInstanceId"]
                    && a["collectionId"] == b["collectionId"]
                    && a["homeId"] != b["homeId"]
                {
                    require(
                        a["owner"] == b["owner"]
                            && a["partitionMode"] != "exclusive-home"
                            && b["partitionMode"] != "exclusive-home"
                            && !array(a, "allowedExternalIds")?.iter().any(|id| {
                                array(b, "allowedExternalIds").is_ok_and(|ids| ids.contains(id))
                            }),
                        "Overlapping source partitions",
                    )?;
                }
            }
        }
        let mut records = BTreeMap::new();
        let mut permanent = BTreeSet::new();
        for r in array(v, "records")? {
            require(
                permanent.insert(json!([r["workspaceId"], r["recordId"]]).to_string()),
                "Duplicate permanent identity",
            )?;
            let kind = text(r, "recordType")?;
            require(
                matches!(
                    kind,
                    "identity" | "evidence" | "binding" | "location-semantics"
                ),
                "Unsupported record graph family",
            )?;
            require(
                date(&r["updatedAt"])? >= date(&r["createdAt"])?,
                "Record time moves backwards",
            )?;
            records.insert(record_key(r, kind, &r["recordId"]), r);
        }
        let mut bindings = BTreeSet::new();
        let mut semantics = BTreeSet::new();
        for r in records.values() {
            let p = &r["payload"];
            if let Some(ids) = p["evidenceIds"].as_array() {
                for id in ids {
                    get(&records, r, "evidence", id)?;
                }
            }
            match text(r, "recordType")? {
                "evidence" => {
                    let provenance = &p["provenance"];
                    if !provenance["source"].is_null() {
                        require(
                            scope(r) == scope(&provenance["source"]),
                            "Cross-home provenance",
                        )?;
                        source(&sources, r, &provenance["source"]["key"])?;
                    }
                    require(
                        array(p, "references")?.is_empty(),
                        "Asset and attachment evidence references are unavailable",
                    )?;
                    require(
                        provenance["evidenceBasis"] != "inference"
                            || provenance["uncertainty"]["status"] != "supported",
                        "Inference cannot support a claim",
                    )?;
                    require(
                        provenance["evidenceBasis"] != "unknown"
                            || ["unknown", "disputed", "withdrawn", "superseded"]
                                .iter()
                                .any(|s| provenance["uncertainty"]["status"] == *s),
                        "Unknown basis cannot support a claim",
                    )?;
                    for id in array(p, "supersedesEvidenceIds")? {
                        get(&records, r, "evidence", id)?;
                    }
                }
                "binding" => {
                    let identity = get(&records, r, "identity", &p["atlasId"])?;
                    source(&sources, r, &p["source"])?;
                    require(
                        bindings.insert(source_key(r, &p["source"])),
                        "Source key already reserved",
                    )?;
                    require(
                        r["lifecycle"] != "active"
                            || p["reviewStatus"] != "accepted"
                            || identity["lifecycle"] == "active",
                        "Accepted binding needs active identity",
                    )?;
                }
                "location-semantics" => {
                    require(
                        get(&records, r, "identity", &p["atlasId"])?["payload"]["kind"]
                            == "location",
                        "Semantic classification needs location identity",
                    )?;
                    if r["lifecycle"] == "active" && p["reviewStatus"] == "accepted" {
                        require(
                            semantics.insert(record_key(r, "identity", &p["atlasId"])),
                            "Duplicate accepted classification",
                        )?;
                    }
                }
                _ => {}
            }
        }
        fn evidence_cycle(
            records: &BTreeMap<String, &Value>,
            r: &Value,
            path: &mut BTreeSet<String>,
        ) -> Result<()> {
            let key = record_key(r, "evidence", &r["recordId"]);
            require(path.insert(key.clone()), "Evidence cycle")?;
            for id in array(&r["payload"], "supersedesEvidenceIds")? {
                evidence_cycle(records, get(records, r, "evidence", id)?, path)?;
            }
            path.remove(&key);
            Ok(())
        }
        for r in records.values().filter(|r| r["recordType"] == "evidence") {
            evidence_cycle(&records, r, &mut BTreeSet::new())?;
        }
        let mut projections = BTreeMap::new();
        for p in array(v, "homeboxEntities")? {
            require(
                p["source"]["externalId"] == p["entity"]["id"],
                "Projection identity mismatch",
            )?;
            source(&sources, p, &p["source"])?;
            require(
                projections.insert(source_key(p, &p["source"]), p).is_none(),
                "Duplicate projection",
            )?;
            for link in array(p, "nativeLinks")? {
                require(
                    scope(p) == scope(&link["entity"]) && link["entity"]["key"] == p["source"],
                    "Native route source mismatch",
                )?;
                require(
                    crate::domain::safe_web_url(text(link, "href")?, true),
                    "Unsafe native route",
                )?;
            }
        }
        for r in records.values().filter(|r| r["recordType"] == "binding") {
            if let Some(p) = projections.get(&source_key(r, &r["payload"]["source"])) {
                require(scope(r) == scope(p), "Cross-home projection")?;
                if !p["entity"]["entityType"].is_null() {
                    let kind = if p["entity"]["entityType"]["isLocation"] == true {
                        "location"
                    } else {
                        "item"
                    };
                    require(
                        get(&records, r, "identity", &r["payload"]["atlasId"])?["payload"]["kind"]
                            == kind,
                        "HomeBox identity kind mismatch",
                    )?;
                }
            }
        }
        for start in projections.values() {
            let mut next = Some(*start);
            let mut visited = BTreeSet::new();
            while let Some(p) = next {
                require(
                    visited.insert(p["entity"]["id"].to_string()),
                    "Parent cycle",
                )?;
                let mut key = p["source"].clone();
                key["externalId"] = p["entity"]["parent"]["id"].clone();
                next = if p["entity"]["parent"].is_null() {
                    None
                } else {
                    projections.get(&source_key(p, &key)).copied()
                };
                if let Some(parent) = next {
                    require(scope(start) == scope(parent), "Cross-home parent")?;
                }
            }
        }
        let mut caches = BTreeMap::new();
        for c in array(v, "caches")? {
            let key = partition(c, c);
            require(sources.contains_key(&key), "Cache outside registered scope")?;
            require(caches.insert(key, c).is_none(), "Duplicate cache")?;
            require(
                c["lastSuccessfulFetchAt"].is_null() == c["generationId"].is_null(),
                "Cache generation needs successful timestamp",
            )?;
            require(
                c["status"] != "fresh"
                    || (!c["lastSuccessfulFetchAt"].is_null() && c["error"].is_null()),
                "Fresh cache needs success",
            )?;
            require(
                c["status"] != "empty" || c["lastSuccessfulFetchAt"].is_null(),
                "Empty cache discards prior success",
            )?;
            require(
                c["status"] != "error" || !c["error"].is_null(),
                "Error cache needs error",
            )?;
        }
        for p in projections.values() {
            let c = caches
                .get(&partition(p, &p["source"]))
                .ok_or(invalid("Projection has no cache"))?;
            require(
                !c["generationId"].is_null()
                    && date(&p["retrievedAt"])? <= date(&c["lastSuccessfulFetchAt"])?,
                "Projection requires successful generation",
            )?;
        }
        Ok(())
    }
}
impl Contract for ReadContracts {
    fn validate_shape(&self, name: &str, value: &Value) -> Result<()> {
        self.shape(name, value)
    }
    fn validate_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        self.graph(&serde_json::to_value(snapshot)?)
    }
    fn assert_transition(&self, _: Option<&Record>, _: &Mutation, _: &ScopedTarget) -> Result<u64> {
        unavailable()
    }
    fn assert_guards(
        &self,
        _: &Snapshot,
        _: Option<&Record>,
        _: &Mutation,
        _: &ScopedTarget,
        _: &[ScopedTarget],
    ) -> Result<()> {
        unavailable()
    }
    fn assert_final_mutation(
        &self,
        _: &Snapshot,
        _: Option<&Record>,
        _: &Mutation,
        _: &ScopedTarget,
    ) -> Result<()> {
        unavailable()
    }
    fn validate_result(&self, _: &MutationResult, _: Prior<'_>) -> Result<()> {
        unavailable()
    }
    fn canonical_json(&self, value: &Value) -> Result<String> {
        serde_jcs::to_string(value).map_err(|_| invalid("Canonical JSON unavailable"))
    }
    fn timestamp_millis(&self, value: &str) -> Result<Option<i64>> {
        // time's parser supplies a leap-second stand-in. The frozen source
        // ordering profile has no orderable timestamp for that spelling.
        if value.as_bytes().get(17..19) == Some(b"60") {
            return Ok(None);
        }
        OffsetDateTime::parse(value, &Rfc3339)
            .ok()
            .map(|timestamp| {
                i64::try_from(timestamp.unix_timestamp_nanos().div_euclid(1_000_000))
                    .map_err(|_| Error::new("unavailable", "Timestamp processing unavailable"))
            })
            .transpose()
    }
}
