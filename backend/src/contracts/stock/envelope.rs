//! Immutable wire envelopes. Only the local stock validator can construct them.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Operation, OperationId, StockError, StockResult, StockValidation, operation};

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockContext {
    pub workspace_id: String,
    pub home_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AtlasRecordKind {
    Identity,
    Binding,
    Evidence,
    LocationSemantics,
    Circuit,
    Valve,
    Relation,
    Geometry,
    Asset,
    Reconciliation,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HomeboxResourceKind {
    Entity,
    Tag,
    EntityType,
    Attachment,
    Field,
    Maintenance,
    Template,
    Collection,
}

/// Collection/page targets retain an omitted identity. None is never rewritten
/// to JSON null; the original schema-checked target remains in the envelope.
#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(tag = "authority", rename_all = "lowercase")]
pub enum StockTarget {
    Atlas {
        #[serde(flatten)]
        target: AtlasTarget,
    },
    Homebox {
        #[serde(rename = "sourceInstanceId")]
        source_instance_id: String,
        #[serde(rename = "collectionId")]
        collection_id: String,
        #[serde(rename = "resourceKind")]
        resource_kind: HomeboxResourceKind,
        #[serde(rename = "entityId", skip_serializing_if = "Option::is_none")]
        entity_id: Option<String>,
        #[serde(rename = "resourceId", skip_serializing_if = "Option::is_none")]
        resource_id: Option<String>,
    },
    Network {
        #[serde(rename = "sourceInstanceId")]
        source_instance_id: String,
        #[serde(rename = "collectionId")]
        collection_id: String,
        #[serde(rename = "resourceId", skip_serializing_if = "Option::is_none")]
        resource_id: Option<String>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AtlasTarget {
    Record {
        #[serde(rename = "recordType")]
        record_type: AtlasRecordKind,
        #[serde(rename = "recordId", skip_serializing_if = "Option::is_none")]
        record_id: Option<String>,
    },
    Batch {
        kind: BatchKind,
        #[serde(rename = "batchId")]
        batch_id: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BatchKind {
    Batch,
}

/// Borrowing a field preserves the difference between omission and explicit
/// null, including optional approvals, zero/empty payload values and guards.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireField<'a> {
    Absent,
    Null,
    Value(&'a Value),
}

impl<'a> WireField<'a> {
    pub fn from_object(object: &'a Value, key: &str) -> Self {
        match object.get(key) {
            None => Self::Absent,
            Some(Value::Null) => Self::Null,
            Some(value) => Self::Value(value),
        }
    }
}

/// No public unchecked constructor or mutable JSON access is provided. Schema
/// acceptance is distinct from an operation's supported/unsupported catalog
/// status and never supplies runtime authorization or provider qualification.
#[derive(Clone, Debug)]
pub struct StockRequest {
    raw: Value,
    id: OperationId,
    context: StockContext,
    target: StockTarget,
    request_id: String,
    intent_digest: String,
    children: Vec<Self>,
}

impl StockRequest {
    pub fn parse(validator: &StockValidation, raw: Value) -> StockResult<Self> {
        let id = OperationId::parse(string(&raw, "commandId")?)
            .ok_or_else(|| StockError::invalid("unknown stock commandId"))?;
        let metadata = operation(id)?;
        validator.validate(&metadata.input_schema, &raw)?;
        let context: StockContext = serde_json::from_value(raw["context"].clone())?;
        let target = serde_json::from_value(raw["target"].clone())?;
        let request_id = string(&raw, "requestId")?.to_owned();
        let intent_digest = super::digest::intent_digest_value(&raw)?;
        let mut children = Vec::new();
        if id.as_str() == "atlas.batch.execute" {
            for child in array(&raw["payload"], "commands")? {
                let child = Self::parse(validator, child.clone())?;
                if child.context != context {
                    return Err(StockError::correlation(
                        "batch child context differs from root context",
                    ));
                }
                children.push(child);
            }
        }
        Ok(Self {
            raw,
            id,
            context,
            target,
            request_id,
            intent_digest,
            children,
        })
    }

    pub fn raw(&self) -> &Value {
        &self.raw
    }
    pub fn id(&self) -> OperationId {
        self.id
    }
    pub fn operation(&self) -> StockResult<&'static Operation> {
        operation(self.id)
    }
    pub fn context(&self) -> &StockContext {
        &self.context
    }
    pub fn target(&self) -> &StockTarget {
        &self.target
    }
    pub fn target_value(&self) -> &Value {
        &self.raw["target"]
    }
    pub fn request_id(&self) -> &str {
        &self.request_id
    }
    pub fn intent_digest(&self) -> &str {
        &self.intent_digest
    }
    pub fn payload(&self) -> &Value {
        &self.raw["payload"]
    }
    pub fn preconditions(&self) -> WireField<'_> {
        self.field("preconditions")
    }
    pub fn approval_receipt_id(&self) -> WireField<'_> {
        self.field("approvalReceiptId")
    }
    pub fn idempotency_key(&self) -> Option<&str> {
        self.raw.get("idempotencyKey").and_then(Value::as_str)
    }
    pub fn field(&self, key: &str) -> WireField<'_> {
        WireField::from_object(&self.raw, key)
    }
    pub fn children(&self) -> &[Self] {
        &self.children
    }
    pub(crate) fn is_batch(&self) -> bool {
        self.id.as_str() == "atlas.batch.execute"
    }
    pub(crate) fn is_provider_mutation(&self) -> bool {
        if self.id.as_str() == "homebox.label.output" {
            self.payload()["delivery"] == "print"
        } else {
            self.raw.get("idempotencyKey").is_some()
        }
    }
}

pub(crate) fn string<'a>(value: &'a Value, field: &str) -> StockResult<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| StockError::invalid(format!("schema-checked field {field} is not a string")))
}

pub(crate) fn array<'a>(value: &'a Value, field: &str) -> StockResult<&'a Vec<Value>> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| StockError::invalid(format!("schema-checked field {field} is not an array")))
}
