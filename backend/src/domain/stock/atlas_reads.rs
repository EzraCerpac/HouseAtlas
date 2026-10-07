//! Concrete Atlas wire3 record reads over the existing native ReadPort bridge.
//!
//! The original opaque principal reaches every storage read unchanged. These
//! methods produce an unreleased wire result: stock dispatch must still perform
//! its full current output-disclosure and captured-authority release checks.
//! No source state, grant, media availability or request provenance is minted.
//!
//! All ten Atlas list/get/history families are mapped.
//! Required stock history delegates paging, search and durable event provenance
//! to its actual owner. Byte downloads are outside this owner.

use super::{
    AtlasListBinding, AtlasListPagePort, AtlasListPages, AtlasListPrincipal, BoundAtlasListPages,
    OperationId, OwnerResult, PreparedRequest, StockContractPort, StockError, StockHistoryPort,
    StockQueryPort, StockResult, UnavailableAtlasDownloads, UnavailableAtlasListPages,
};
use crate::{
    contracts,
    domain::{DomainError, ReadPort, Record, RecordRef, RecordType, Scope},
};
use serde::Serialize;
use serde_json::{Value, json};

/// Supply the existing real ReadPort (including NativeStorage backed by AT07)
/// and the configured exact stock validator. Neither peer nor its authority is
/// rebound by this mapper. The stock validator must use the full offline closure.
pub struct AtlasReads<R, C, L = UnavailableAtlasListPages, D = UnavailableAtlasDownloads> {
    reads: R,
    contracts: C,
    lists: L,
    downloads: D,
}

impl<R, C> AtlasReads<R, C> {
    pub fn new(reads: R, contracts: C) -> Self {
        Self {
            reads,
            contracts,
            lists: UnavailableAtlasListPages,
            downloads: UnavailableAtlasDownloads,
        }
    }

    /// Bind a host-shared cursor cache to the exact original opaque principal.
    /// Capture binding from the same AT11 issuance forwarded to Storage.
    pub fn with_list_pages<'p, P: AtlasListPrincipal>(
        self,
        pages: AtlasListPages,
        binding: AtlasListBinding<'p>,
        principal: &'p P,
    ) -> AtlasReads<R, C, BoundAtlasListPages<'p, P>> {
        AtlasReads {
            reads: self.reads,
            contracts: self.contracts,
            lists: BoundAtlasListPages {
                pages,
                binding,
                principal,
            },
            downloads: self.downloads,
        }
    }
}

impl<R, C, L, D> AtlasReads<R, C, L, D> {
    pub fn with_downloads<N>(self, downloads: N) -> AtlasReads<R, C, L, N> {
        AtlasReads {
            reads: self.reads,
            contracts: self.contracts,
            lists: self.lists,
            downloads,
        }
    }
    pub fn into_parts(self) -> (R, C) {
        (self.reads, self.contracts)
    }
}

impl<P, W, G, R, C, L, D> StockQueryPort<P, W, G> for AtlasReads<R, C, L, D>
where
    R: ReadPort<P> + StockHistoryPort<P>,
    C: StockContractPort,
    L: AtlasListPagePort<P>,
    D: StockQueryPort<P, W, G>,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
    ) -> StockResult<OwnerResult> {
        let request = prepared.request();
        if request.id() == OperationId::AtlasAssetDownload {
            return self.downloads.query(principal, prepared);
        }
        let (record_type, mode) = read_arm(request.id()).ok_or(StockError::OwnerUnavailable)?;
        self.contracts
            .validate(request.operation().input_schema, request.raw())?;
        let scope = Scope {
            workspace_id: request.context().workspace_id.clone(),
            home_id: request.context().home_id.clone(),
        };
        let record_type_wire =
            serde_json::to_value(record_type).map_err(|_| StockError::InvalidContract)?;
        if request.target()["authority"] != "atlas"
            || request.target()["recordType"] != record_type_wire
        {
            return Err(StockError::InvalidContract);
        }

        let data = match mode {
            ReadMode::List => {
                let snapshot = self
                    .reads
                    .snapshot(principal, &scope)
                    .map_err(StockError::Domain)?;
                validate_frozen::<contracts::Snapshot>(&snapshot)?;
                let include_archived = request.payload()["includeArchived"]
                    .as_bool()
                    .ok_or(StockError::InvalidContract)?;
                let mut records = Vec::new();
                for record in &snapshot.records {
                    if record.scope != scope {
                        return Err(StockError::CorrelationMismatch);
                    }
                    if record.target.record_type != record_type
                        || !include_archived
                            && record.lifecycle == crate::domain::Lifecycle::Tombstoned
                    {
                        continue;
                    }
                    let target = json!({"authority":"atlas","recordType":record_type,
                        "recordId":record.target.record_id});
                    let public = public_record(record, &target)?;
                    if request
                        .payload()
                        .get("q")
                        .and_then(Value::as_str)
                        .is_none_or(|q| matches_query(&public, q))
                    {
                        records.push(public);
                    }
                }
                // Stable UUID order is independent of SQLite insertion order.
                records.sort_by(|left, right| {
                    left["target"]["recordId"]
                        .as_str()
                        .cmp(&right["target"]["recordId"].as_str())
                });
                if records
                    .windows(2)
                    .any(|rows| rows[0]["target"] == rows[1]["target"])
                {
                    return Err(StockError::CorrelationMismatch);
                }
                self.lists.page(principal, request, &snapshot, records)?
            }
            ReadMode::Record => {
                let target = RecordRef {
                    record_type,
                    record_id: request.target()["recordId"]
                        .as_str()
                        .ok_or(StockError::InvalidContract)?
                        .to_owned(),
                };
                let record = self
                    .reads
                    .record(principal, &scope, &target)
                    .map_err(StockError::Domain)?;
                validate_frozen::<contracts::AtlasRecord>(&record)?;
                if record.scope != scope || record.target != target {
                    return Err(StockError::CorrelationMismatch);
                }
                let public = public_record(&record, request.target())?;
                // This describes the current canonical Atlas read transaction.
                // It does not assert live provider presence, cache freshness or
                // asset availability; the exact frozen payload remains intact.
                json!({"records":[public],"nextCursor":null,"sourceStatus":"current"})
            }
            ReadMode::History => {
                let output = self
                    .reads
                    .stock_history(principal, &self.contracts, request)?;
                // Retain the actual owner envelope, command IDs, original intent
                // digests, audit IDs, order, completeness and opaque cursor.
                self.contracts
                    .validate(request.operation().output_schema, &output.wire)?;
                return Ok(output);
            }
        };
        let wire = json!({
            "schemaVersion":3,
            "commandId":request.id().as_str(),
            "requestId":request.request_id(),
            "resolvedScope":request.context(),
            "status":"read",
            "replayed":false,
            "data":data,
        });
        // Read arms do not declare data.requestDigest. Add no undeclared fields;
        // history event digests must come from their original durable intents.
        self.contracts
            .validate(request.operation().output_schema, &wire)?;
        Ok(OwnerResult {
            wire,
            children: Vec::new(),
        })
    }
}

fn public_record(record: &Record, target: &Value) -> StockResult<Value> {
    let mut payload = record.payload.clone();
    if record.target.record_type == RecordType::Asset {
        // The frozen asset was validated in full before this public projection.
        // assetPublicPayload intentionally omits only its private storageKey;
        // preserve the actual availability/preview policy and all other fields.
        payload
            .as_object_mut()
            .ok_or(StockError::Domain(DomainError::UpstreamIncomplete))?
            .remove("storageKey");
    }
    Ok(json!({"target":target,"revision":record.revision,
        "lifecycle":record.lifecycle,"payload":payload}))
}

fn validate_frozen<T: contracts::Contract>(value: &impl Serialize) -> StockResult<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| StockError::Domain(DomainError::UpstreamIncomplete))?;
    // Validate the original carrier through AT51's real pure frozen validator,
    // without using the decoded DTO to normalize or reconstruct the payload.
    contracts::decode::<T>(&bytes).map(|_| ()).map_err(|error| {
        StockError::Domain(match error {
            contracts::ContractError::Setup(_) => DomainError::UpstreamUnavailable,
            _ => DomainError::UpstreamIncomplete,
        })
    })
}

#[derive(Clone, Copy)]
enum ReadMode {
    Record,
    List,
    History,
}

fn read_arm(id: OperationId) -> Option<(RecordType, ReadMode)> {
    use OperationId::*;
    use ReadMode::*;
    Some(match id {
        AtlasIdentityList => (RecordType::Identity, List),
        AtlasIdentityGet => (RecordType::Identity, Record),
        AtlasBindingList => (RecordType::Binding, List),
        AtlasBindingGet => (RecordType::Binding, Record),
        AtlasEvidenceList => (RecordType::Evidence, List),
        AtlasEvidenceGet => (RecordType::Evidence, Record),
        AtlasLocationSemanticsList => (RecordType::LocationSemantics, List),
        AtlasLocationSemanticsGet => (RecordType::LocationSemantics, Record),
        AtlasCircuitList => (RecordType::Circuit, List),
        AtlasCircuitGet => (RecordType::Circuit, Record),
        AtlasValveList => (RecordType::Valve, List),
        AtlasValveGet => (RecordType::Valve, Record),
        AtlasRelationList => (RecordType::Relation, List),
        AtlasRelationGet => (RecordType::Relation, Record),
        AtlasGeometryList => (RecordType::Geometry, List),
        AtlasGeometryGet => (RecordType::Geometry, Record),
        AtlasAssetList => (RecordType::Asset, List),
        AtlasAssetGet => (RecordType::Asset, Record),
        AtlasReconciliationList => (RecordType::Reconciliation, List),
        AtlasReconciliationGet => (RecordType::Reconciliation, Record),
        AtlasIdentityHistory => (RecordType::Identity, History),
        AtlasBindingHistory => (RecordType::Binding, History),
        AtlasEvidenceHistory => (RecordType::Evidence, History),
        AtlasLocationSemanticsHistory => (RecordType::LocationSemantics, History),
        AtlasCircuitHistory => (RecordType::Circuit, History),
        AtlasValveHistory => (RecordType::Valve, History),
        AtlasRelationHistory => (RecordType::Relation, History),
        AtlasGeometryHistory => (RecordType::Geometry, History),
        AtlasAssetHistory => (RecordType::Asset, History),
        AtlasReconciliationHistory => (RecordType::Reconciliation, History),
        _ => return None,
    })
}

// Literal case-insensitive terms over public string values and the record ID.
// Never search private asset storageKey, JSON property names or encoded bytes.
fn matches_query(public: &Value, query: &str) -> bool {
    fn strings(value: &Value, text: &mut String) {
        match value {
            Value::String(value) => {
                text.push(' ');
                text.push_str(value);
            }
            Value::Array(values) => {
                for value in values {
                    strings(value, text);
                }
            }
            Value::Object(values) => {
                for value in values.values() {
                    strings(value, text);
                }
            }
            _ => {}
        }
    }
    let mut text = public["target"]["recordId"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    strings(&public["payload"], &mut text);
    let text = text.to_lowercase();
    query
        .to_lowercase()
        .split_whitespace()
        .all(|term| text.contains(term))
}

/// Closed list admission for host adapters. Catalog dispositions are unchanged.
pub fn atlas_list_record_type(id: OperationId) -> Option<RecordType> {
    match read_arm(id) {
        Some((kind, ReadMode::List)) => Some(kind),
        _ => None,
    }
}
