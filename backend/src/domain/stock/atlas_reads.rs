//! Concrete Atlas wire3 record reads over the existing native ReadPort bridge.
//!
//! The original opaque principal reaches every storage read unchanged. These
//! methods produce an unreleased wire result: stock dispatch must still perform
//! its full current output-disclosure and captured-authority release checks.
//! No source state, grant, media availability or request provenance is minted.
//!
//! All ten Atlas record-get forms and all ten stock history forms are mapped.
//! Required stock history delegates paging, search and durable event provenance
//! to its actual owner. Lists and byte downloads are outside this owner.

use super::{
    OperationId, OwnerResult, PreparedRequest, StockContractPort, StockError, StockHistoryPort,
    StockQueryPort, StockResult,
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
pub struct AtlasReads<R, C> {
    reads: R,
    contracts: C,
}

impl<R, C> AtlasReads<R, C> {
    pub fn new(reads: R, contracts: C) -> Self {
        Self { reads, contracts }
    }

    pub fn into_parts(self) -> (R, C) {
        (self.reads, self.contracts)
    }
}

impl<P, W, G, R, C> StockQueryPort<P, W, G> for AtlasReads<R, C>
where
    R: ReadPort<P> + StockHistoryPort<P>,
    C: StockContractPort,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
    ) -> StockResult<OwnerResult> {
        let request = prepared.request();
        let (record_type, mode) = read_arm(request.id()).ok_or(StockError::OwnerUnavailable)?;
        self.contracts
            .validate(request.operation().input_schema, request.raw())?;
        let scope = Scope {
            workspace_id: request.context().workspace_id.clone(),
            home_id: request.context().home_id.clone(),
        };
        let target = RecordRef {
            record_type,
            record_id: request.target()["recordId"]
                .as_str()
                .ok_or(StockError::InvalidContract)?
                .to_owned(),
        };
        let record_type_wire =
            serde_json::to_value(record_type).map_err(|_| StockError::InvalidContract)?;
        if request.target()["authority"] != "atlas"
            || request.target()["recordType"] != record_type_wire
        {
            return Err(StockError::InvalidContract);
        }

        let data = match mode {
            ReadMode::Record => {
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
    History,
}

fn read_arm(id: OperationId) -> Option<(RecordType, ReadMode)> {
    use OperationId::*;
    use ReadMode::*;
    Some(match id {
        AtlasIdentityGet => (RecordType::Identity, Record),
        AtlasBindingGet => (RecordType::Binding, Record),
        AtlasEvidenceGet => (RecordType::Evidence, Record),
        AtlasLocationSemanticsGet => (RecordType::LocationSemantics, Record),
        AtlasCircuitGet => (RecordType::Circuit, Record),
        AtlasValveGet => (RecordType::Valve, Record),
        AtlasRelationGet => (RecordType::Relation, Record),
        AtlasGeometryGet => (RecordType::Geometry, Record),
        AtlasAssetGet => (RecordType::Asset, Record),
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
