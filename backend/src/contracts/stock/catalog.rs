//! Immutable typed views of the adopted stock catalog. Catalog dispositions
//! describe the specification; they do not admit a runtime capability.

use std::{collections::BTreeSet, fmt, sync::OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::StockError;

macro_rules! wire_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $wire)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $wire),+ }
            }

            pub fn parse(value: &str) -> Option<Self> {
                match value { $($wire => Some(Self::$variant)),+, _ => None }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }
    };
}

include!("catalog-generated.rs");

wire_enum!(CapabilityStatus {
    SupportedPendingQualification => "supported-pending-qualification",
    UnsupportedCapability => "unsupported-capability",
    ForbiddenAppendOnly => "forbidden-append-only",
    HeldPolicy => "held-policy",
});

wire_enum!(Effect {
    Read => "read",
    Write => "write",
    Variant => "variant",
});

wire_enum!(Authority {
    Atlas => "atlas",
    Homebox => "homebox",
    Network => "network",
});

/// A catalog operation with its entire adopted metadata retained. Optional
/// metadata stays absent when absent in the source catalog.
#[derive(Debug, Clone)]
pub struct Operation {
    pub id: OperationId,
    pub input_schema: String,
    pub output_schema: String,
    pub tool_family: ToolFamily,
    pub status: CapabilityStatus,
    pub effect: Effect,
    pub authority: Authority,
    pub resource_kind: String,
    pub result_resource_kind: Option<String>,
    pub result_identity: Option<String>,
    pub data_authority: Option<String>,
    pub metadata: Value,
}

/// A proposed transport grouping, preserving its published command order.
#[derive(Debug, Clone)]
pub struct Family {
    pub name: ToolFamily,
    pub command_ids: Vec<OperationId>,
    pub input_schema: String,
    pub output_schema: String,
    pub metadata: Value,
}

struct Catalog {
    operations: Vec<Operation>,
    families: Vec<Family>,
    metadata: Value,
    family_metadata: Value,
}

static CATALOG: OnceLock<Result<Catalog, String>> = OnceLock::new();

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("catalog metadata requires string {key}"))
}

fn optional_text(value: &Value, key: &str) -> Result<Option<String>, String> {
    value
        .get(key)
        .map(|_| text(value, key).map(str::to_owned))
        .transpose()
}

fn compile_catalog() -> Result<Catalog, String> {
    let metadata: Value = serde_json::from_slice(include_bytes!(
        "../../../../contracts/stock-wire3/agent/operation-catalog.json"
    ))
    .map_err(|error| error.to_string())?;
    let family_metadata: Value = serde_json::from_slice(include_bytes!(
        "../../../../contracts/stock-wire3/agent/tool-families.json"
    ))
    .map_err(|error| error.to_string())?;
    super::super::ensure_numbers_supported(&metadata).map_err(str::to_owned)?;
    super::super::ensure_numbers_supported(&family_metadata).map_err(str::to_owned)?;
    if metadata["contractVersion"] != "0.3.0-at34.stock.2"
        || family_metadata["contractVersion"] != "0.3.0-at34.stock.2"
        || metadata["agentWireSchemaVersion"] != 3
    {
        return Err("embedded stock catalog identity differs from stock.2 wire3".to_owned());
    }
    let commands = metadata["commands"]
        .as_array()
        .ok_or_else(|| "catalog commands must be an array".to_owned())?;
    let mut seen = BTreeSet::new();
    let mut operations = Vec::with_capacity(commands.len());
    for command in commands {
        let id = OperationId::parse(text(command, "commandId")?)
            .ok_or_else(|| "catalog command ID is absent from generated typed IDs".to_owned())?;
        if !seen.insert(id) {
            return Err(format!("duplicate embedded catalog command {id}"));
        }
        let parse = |key: &str| text(command, key);
        operations.push(Operation {
            id,
            input_schema: parse("inputSchema")?.to_owned(),
            output_schema: parse("outputSchema")?.to_owned(),
            tool_family: ToolFamily::parse(parse("toolFamily")?)
                .ok_or_else(|| format!("unknown catalog tool family for {id}"))?,
            status: CapabilityStatus::parse(parse("capabilityStatus")?)
                .ok_or_else(|| format!("unknown catalog capability status for {id}"))?,
            effect: Effect::parse(parse("effect")?)
                .ok_or_else(|| format!("unknown catalog effect for {id}"))?,
            authority: Authority::parse(parse("authority")?)
                .ok_or_else(|| format!("unknown catalog authority for {id}"))?,
            resource_kind: parse("resourceKind")?.to_owned(),
            result_resource_kind: optional_text(command, "resultResourceKind")?,
            result_identity: optional_text(command, "resultIdentity")?,
            data_authority: optional_text(command, "dataAuthority")?,
            metadata: command.clone(),
        });
    }
    if seen.len() != OperationId::ALL.len() || seen.len() != 164 {
        return Err("embedded catalog must contain all 164 typed operation IDs".to_owned());
    }

    let groups = family_metadata["families"]
        .as_array()
        .ok_or_else(|| "tool families must be an array".to_owned())?;
    let mut family_names = BTreeSet::new();
    let mut grouped = BTreeSet::new();
    let mut families = Vec::with_capacity(groups.len());
    for group in groups {
        let name = ToolFamily::parse(text(group, "toolName")?)
            .ok_or_else(|| "unknown embedded tool family".to_owned())?;
        if !family_names.insert(name) {
            return Err(format!("duplicate embedded tool family {name}"));
        }
        let identifiers = group["commandIds"]
            .as_array()
            .ok_or_else(|| format!("tool family {name} command IDs must be an array"))?;
        let mut command_ids = Vec::with_capacity(identifiers.len());
        for identifier in identifiers {
            let id = identifier
                .as_str()
                .and_then(OperationId::parse)
                .ok_or_else(|| format!("unknown operation in tool family {name}"))?;
            let operation = operations
                .iter()
                .find(|operation| operation.id == id)
                .ok_or_else(|| format!("tool family operation {id} has no catalog entry"))?;
            if operation.tool_family != name || !grouped.insert(id) {
                return Err(format!("inconsistent or repeated tool family member {id}"));
            }
            command_ids.push(id);
        }
        families.push(Family {
            name,
            command_ids,
            input_schema: text(group, "inputSchema")?.to_owned(),
            output_schema: text(group, "outputSchema")?.to_owned(),
            metadata: group.clone(),
        });
    }
    if family_names.len() != ToolFamily::ALL.len() || family_names.len() != 10 || grouped != seen {
        return Err("ten tool families must partition all 164 catalog operations".to_owned());
    }
    Ok(Catalog {
        operations,
        families,
        metadata,
        family_metadata,
    })
}

fn catalog() -> Result<&'static Catalog, StockError> {
    CATALOG
        .get_or_init(compile_catalog)
        .as_ref()
        .map_err(|error| StockError::setup(error.clone()))
}

pub fn operations() -> Result<&'static [Operation], StockError> {
    Ok(&catalog()?.operations)
}

pub fn operation(id: OperationId) -> Result<&'static Operation, StockError> {
    operations()?
        .iter()
        .find(|operation| operation.id == id)
        .ok_or_else(|| StockError::setup(format!("missing embedded operation {id}")))
}

pub fn lookup(command_id: &str) -> Result<Option<&'static Operation>, StockError> {
    OperationId::parse(command_id).map(operation).transpose()
}

pub fn families() -> Result<&'static [Family], StockError> {
    Ok(&catalog()?.families)
}

pub fn family(name: ToolFamily) -> Result<&'static Family, StockError> {
    families()?
        .iter()
        .find(|family| family.name == name)
        .ok_or_else(|| StockError::setup(format!("missing embedded tool family {name}")))
}

pub fn metadata() -> Result<&'static Value, StockError> {
    Ok(&catalog()?.metadata)
}

pub fn family_metadata() -> Result<&'static Value, StockError> {
    Ok(&catalog()?.family_metadata)
}
