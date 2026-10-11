//! Concrete schema/digest binding to the accepted native shared contracts.
use super::*;
use crate::{
    contracts::{semantics, stock as native},
    providers::homebox::write::stock as writer,
};
use serde_json::Value;
use uuid::Uuid;

pub struct NativeWriterContracts(native::StockValidation);
impl NativeWriterContracts {
    pub fn new() -> storage::Result<Self> {
        native::StockValidation::new()
            .map(Self)
            .map_err(|_| unavailable())
    }
}
impl writer::StockContractPort for NativeWriterContracts {
    fn validate_request(&self, wire: &Value) -> Result<writer::StockCommand, writer::StockError> {
        let error = || {
            writer::retained_bridge::invalid_request(
                wire["requestId"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .unwrap_or(Uuid::nil()),
            )
        };
        let original = native::StockRequest::parse(&self.0, wire.clone()).map_err(|_| error())?;
        let operation = original.operation().map_err(|_| error())?;
        if operation.authority != native::Authority::Homebox
            || !(operation.effect == native::Effect::Write
                || original.id().as_str() == "homebox.label.output"
                    && wire["payload"]["delivery"] == "print")
        {
            return Err(error());
        }
        let uuid = |v: &Value| {
            v.as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .filter(|id| !id.is_nil())
                .ok_or_else(error)
        };
        let mut target = wire["target"].clone();
        target
            .as_object_mut()
            .ok_or_else(error)?
            .remove("authority");
        let command = writer::StockCommand {
            command_id: original.id().as_str().to_owned(),
            request_id: uuid(&wire["requestId"])?,
            idempotency_key: uuid(&wire["idempotencyKey"])?,
            context: serde_json::from_value(wire["context"].clone()).map_err(|_| error())?,
            target: serde_json::from_value(target).map_err(|_| error())?,
            payload: wire["payload"].clone(),
            native_sync_behavior: wire
                .get("nativeSyncBehavior")
                .map(|v| v["observed"].as_bool().ok_or_else(error))
                .transpose()?,
            provider_observation: uuid(&wire["preconditions"]["providerObservation"]["handle"])?,
            approval_receipt_id: wire
                .get("approvalReceiptId")
                .filter(|v| !v.is_null())
                .map(uuid)
                .transpose()?,
            original_wire: wire.clone(),
            request_digest: writer::Digest::parse(original.intent_digest().to_owned())
                .map_err(|_| error())?,
        };
        Ok(command)
    }
    fn digest_native(&self, value: &Value) -> Result<writer::Digest, writer::StockPortFault> {
        semantics::canonical_digest(value)
            .ok()
            .and_then(|s| writer::Digest::parse(s).ok())
            .ok_or(writer::StockPortFault::EvidenceConflict)
    }
    fn validate_outcome(
        &self,
        outcome: &writer::StockOutcome,
    ) -> Result<(), writer::StockPortFault> {
        let operation = native::OperationId::parse(&outcome.command_id)
            .and_then(|id| native::operation(id).ok())
            .ok_or(writer::StockPortFault::EvidenceConflict)?;
        if !outcome.well_formed() {
            return Err(writer::StockPortFault::EvidenceConflict);
        }
        self.0
            .validate(
                &operation.output_schema,
                &serde_json::to_value(outcome)
                    .map_err(|_| writer::StockPortFault::EvidenceConflict)?,
            )
            .map_err(|_| writer::StockPortFault::EvidenceConflict)
    }
    fn validate_observed_at(&self, value: &str) -> Result<(), writer::StockPortFault> {
        semantics::timestamp_millis(value)
            .map(|_| ())
            .ok_or(writer::StockPortFault::EvidenceConflict)
    }
}
