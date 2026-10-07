//! Finite transport metadata joined from the shared and domain catalogs.
//! Mapping an operation grants no admission, authority or route qualification.

use crate::{contracts::stock as wire, domain::stock as domain};

use super::PortError;

/// A closed MCP tool name backed by the published ten-family enum.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct ToolName {
    family: wire::ToolFamily,
}

impl ToolName {
    pub fn parse(name: &str) -> Result<Self, PortError> {
        wire::ToolFamily::parse(name)
            .map(Self::from)
            .ok_or(PortError::UnknownTool)
    }

    pub const fn family(self) -> wire::ToolFamily {
        self.family
    }

    pub const fn as_str(self) -> &'static str {
        self.family.as_str()
    }
}

impl From<wire::ToolFamily> for ToolName {
    fn from(family: wire::ToolFamily) -> Self {
        Self { family }
    }
}

/// Immutable metadata for one published operation, including held and
/// unsupported forms. Runtime admission and disposition remain owner decisions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationMapping {
    operation: wire::OperationId,
    family: wire::ToolFamily,
    native: domain::OperationId,
    input_schema: &'static str,
    output_schema: &'static str,
    output_kind: domain::OutputKind,
}

impl OperationMapping {
    pub fn for_operation(operation: wire::OperationId) -> Result<Self, PortError> {
        let published = wire::operation(operation).map_err(|_| PortError::Unavailable)?;
        // This is a metadata join between two closed enums, never request routing
        // through a client-supplied string or a copied operation table.
        let native =
            domain::OperationId::parse(operation.as_str()).ok_or(PortError::Unavailable)?;
        let descriptor = native.operation();
        let native_family =
            wire::ToolFamily::parse(descriptor.family).ok_or(PortError::Unavailable)?;
        let effect = match published.effect {
            wire::Effect::Read => domain::Effect::Read,
            wire::Effect::Write => domain::Effect::Write,
            wire::Effect::Variant => domain::Effect::Variant,
        };
        let authority = match published.authority {
            wire::Authority::Atlas => domain::Authority::Atlas,
            wire::Authority::Homebox => domain::Authority::Homebox,
            wire::Authority::Network => domain::Authority::Network,
        };
        if published.tool_family != native_family
            || published.input_schema != descriptor.input_schema
            || published.output_schema != descriptor.output_schema
            || effect != descriptor.effect
            || authority != descriptor.authority
        {
            return Err(PortError::Unavailable);
        }
        Ok(Self {
            operation,
            family: published.tool_family,
            native,
            input_schema: descriptor.input_schema,
            output_schema: descriptor.output_schema,
            output_kind: descriptor.output_kind,
        })
    }

    pub fn all() -> Result<Vec<Self>, PortError> {
        wire::OperationId::ALL
            .iter()
            .copied()
            .map(Self::for_operation)
            .collect()
    }

    pub const fn operation(self) -> wire::OperationId {
        self.operation
    }

    pub const fn family(self) -> wire::ToolFamily {
        self.family
    }

    pub const fn native(self) -> domain::OperationId {
        self.native
    }

    pub const fn input_schema(self) -> &'static str {
        self.input_schema
    }

    pub const fn output_schema(self) -> &'static str {
        self.output_schema
    }

    pub const fn output_kind(self) -> domain::OutputKind {
        self.output_kind
    }
}
