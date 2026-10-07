//! Stock family envelopes delegate validation and routing to their published owners.
use std::collections::BTreeSet;

use crate::{access, contracts::stock as wire, domain::stock as domain};
use serde_json::Value;

use super::{
    CatalogPort, JsonObject, NativePrincipal, NativeRequirement, NativeSchemas, PortError,
    PreparedOperation, ToolAnnotations, ToolDefinition, ToolPage, ToolResult,
};

/// Private immutable envelope; only the real stock validator constructs it.
pub struct NativeOperation {
    pub(crate) request: wire::StockRequest,
}

/// Only native domain dispatch can construct a releasable result.
pub struct NativeOutput {
    pub(crate) request: wire::StockRequest,
    pub(crate) result: domain::OwnerResult,
}

pub struct NativeCatalog {
    principal: NativePrincipal,
    validator: wire::StockValidation,
    contracts: domain::NativeStockContract,
    admitted: BTreeSet<wire::OperationId>,
    tools: Vec<ToolDefinition>,
}

impl NativeCatalog {
    /// Principal-scoped admission is supplied by the host's qualified owner composition. Published
    /// capabilityStatus metadata alone never enables an operation. Family schemas
    /// retain the full published union; prepare also checks this exact admission.
    pub fn with_admitted_operations(
        schemas: &NativeSchemas,
        principal: &NativePrincipal,
        admitted: impl IntoIterator<Item = wire::OperationId>,
    ) -> Result<Self, PortError> {
        let admitted: BTreeSet<_> = admitted.into_iter().collect();
        let validator = wire::StockValidation::new().map_err(|_| PortError::Unavailable)?;
        let contracts = domain::NativeStockContract::new().map_err(stock_error)?;
        let mut tools = Vec::new();
        for family in wire::families().map_err(|_| PortError::Unavailable)? {
            let selected: Vec<_> = family
                .command_ids
                .iter()
                .filter(|id| admitted.contains(id))
                .collect();
            if selected.is_empty() {
                continue;
            }
            let read_only = selected
                .iter()
                .all(|id| wire::operation(**id).is_ok_and(|op| op.effect == wire::Effect::Read));
            tools.push(ToolDefinition {
                name: family.name.as_str().into(),
                title: None,
                description: "Published stock wire3 envelope. The host admits individual operations; catalog disposition is not runtime authority.".into(),
                input_schema: schemas.schema(&family.input_schema)?,
                output_schema: Some(schemas.schema(&family.output_schema)?),
                annotations: Some(ToolAnnotations {
                    read_only_hint: Some(read_only),
                    ..ToolAnnotations::default()
                }),
            });
        }
        Ok(Self {
            principal: principal.clone(),
            validator,
            contracts,
            admitted,
            tools,
        })
    }
}

impl CatalogPort<NativePrincipal> for NativeCatalog {
    type Operation = NativeOperation;
    type Output = NativeOutput;
    type Requirement = NativeRequirement;

    fn list(
        &self,
        principal: &NativePrincipal,
        cursor: Option<&str>,
    ) -> Result<ToolPage, PortError> {
        if !self.principal.same_context(principal) {
            return Err(PortError::Forbidden);
        }
        if cursor.is_some() {
            return Err(PortError::InvalidCursor);
        }
        Ok(ToolPage {
            tools: self.tools.clone(),
            next_cursor: None,
        })
    }

    fn prepare(
        &self,
        principal: &NativePrincipal,
        name: &str,
        arguments: JsonObject,
    ) -> Result<PreparedOperation<NativeOperation, NativeRequirement>, PortError> {
        if !self.principal.same_context(principal) {
            return Err(PortError::Forbidden);
        }
        if !self.tools.iter().any(|tool| tool.name == name) {
            return Err(PortError::UnknownTool);
        }
        let request = wire::StockRequest::parse(&self.validator, Value::Object(arguments))
            .map_err(|_| invalid_contract())?;
        let metadata = wire::operation(request.id()).map_err(|_| PortError::Unavailable)?;
        if metadata.tool_family.as_str() != name {
            return Err(invalid_contract());
        }
        if !admitted_request(&self.admitted, &request) {
            return Err(PortError::Unavailable);
        }
        // No transport route switch: the native domain owns disposition, route,
        // print variant, batching and exact unmodified request intent.
        let native = domain::ValidatedRequest::parse(&self.contracts, request.raw().clone())
            .map_err(stock_error)?;
        let scope = access::Scope {
            workspace_id: access::CanonicalId::parse(&request.context().workspace_id)
                .map_err(|_| invalid_contract())?,
            home_id: access::CanonicalId::parse(&request.context().home_id)
                .map_err(|_| invalid_contract())?,
        };
        let requirement = if native.is_mutation() {
            NativeRequirement::mutation(scope)
        } else if native.operation().output_kind == domain::OutputKind::History
            || matches!(
                native.route(),
                domain::Route::NetworkPassive {
                    view: domain::NetworkView::History,
                    ..
                }
            )
        {
            NativeRequirement::history(scope)
        } else {
            NativeRequirement::read(scope)
        };
        Ok(PreparedOperation {
            operation: NativeOperation { request },
            requirement,
        })
    }

    fn render(&self, name: &str, output: NativeOutput) -> Result<ToolResult, PortError> {
        if wire::operation(output.request.id())
            .map_err(|_| PortError::Unavailable)?
            .tool_family
            .as_str()
            != name
        {
            return Err(PortError::Unavailable);
        }
        // Domain dispatch already discharged current authority/disclosure. This
        // additional owner validator retains the exact wire and ordered children.
        let response = wire::StockResponse::parse(
            &self.validator,
            &output.request,
            output.result.wire,
            &output.result.children,
        )
        .map_err(|_| PortError::Unavailable)?;
        let mut result = ToolResult::json(response.raw().clone());
        result.is_error = matches!(response.kind(), wire::ResponseKind::Error);
        Ok(result)
    }
}

fn admitted_request(admitted: &BTreeSet<wire::OperationId>, request: &wire::StockRequest) -> bool {
    admitted.contains(&request.id())
        && request
            .children()
            .iter()
            .all(|child| admitted_request(admitted, child))
}

fn invalid_contract() -> PortError {
    PortError::ToolFailure(super::PublicToolFailure {
        code: "invalid-contract",
        message: "Stock request validation failed",
        data: None,
    })
}

pub(crate) fn stock_error(error: domain::StockError) -> PortError {
    use domain::StockError::*;
    match error {
        InvalidContract => invalid_contract(),
        AuthorityChanged | CapabilityDenied => PortError::Forbidden,
        UnsupportedCapability | CapabilityHeld | ForbiddenAppendOnly => {
            PortError::ToolFailure(super::PublicToolFailure {
                code: match error {
                    UnsupportedCapability => "unsupported-capability",
                    CapabilityHeld => "held-policy",
                    _ => "forbidden-append-only",
                },
                message: "Stock operation is unavailable",
                data: None,
            })
        }
        // Correlation, raw storage/domain diagnostics and uncertain owner state
        // never become public data or a fabricated successful wire envelope.
        _ => PortError::Unavailable,
    }
}
