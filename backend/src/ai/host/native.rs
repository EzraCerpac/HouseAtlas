//! Shared native authority/catalog/service binding for qualified local reads.
//! Reviewed writes use the integrator's exact SharedStockPort and continuation;
//! this adapter has no approval engine and does not admit a write implicitly.
use super::HostAuthority;
use crate::{
    access,
    ai::{
        AiError, Cancellation, PortFuture, ToolDescriptor, ToolEffect,
        oauth::RegistrationBinding,
        stock::{
            AcceptedStockCommand, DomainDispatch, ReviewChallenge, STOCK_CONTRACT_VERSION,
            STOCK_WIRE_VERSION, SharedStockPort, StockCatalogEffect, StockCatalogProjection,
            StockCommandProjection, StockFamilyProjection, StockRequestMetadata, StockScope,
            StockToolFamily,
        },
    },
    contracts::stock as wire,
    domain::stock as domain,
    transports::mcp,
};
use mcp::{CatalogPort, PrincipalPort, ServicePort};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
};

pub struct NativeHostContext {
    native: mcp::NativeContext,
    principal: mcp::NativePrincipal,
    binding: RegistrationBinding,
}
impl NativeHostContext {
    /// Supply an actually issued AT11 principal and registration binding from
    /// the trusted enrollment boundary. No DTO can manufacture that principal.
    pub async fn capture(
        principal: access::Principal,
        binding: RegistrationBinding,
        boundary: &mcp::NativePrincipalPort,
    ) -> Result<Self, AiError> {
        if principal.actor_id().as_str() != binding.actor_id
            || principal.scope().workspace_id.as_str() != binding.workspace_id
            || principal.scope().home_id.as_str() != binding.home_id
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let native = mcp::NativeContext::from_principal(principal);
        let principal = boundary.resolve(&native).await.map_err(peer_error)?;
        Ok(Self {
            native,
            principal,
            binding,
        })
    }
    pub fn original(&self) -> &access::Principal {
        self.principal.original()
    }
    pub fn registration(&self) -> &RegistrationBinding {
        &self.binding
    }
}

/// Registration owner checks the current same-actor/home registration and both
/// original epochs. No string comparison here is promoted to app authority.
pub trait RegistrationAuthority: Send + Sync {
    fn revalidate(
        &self,
        original: &access::Principal,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError>;
}
pub struct NativeHostAuthority<R> {
    pub access: Arc<Mutex<access::AccessBoundary>>,
    pub registrations: R,
}
impl<R: RegistrationAuthority> HostAuthority<NativeHostContext> for NativeHostAuthority<R> {
    fn binding(&self, context: &NativeHostContext) -> Result<RegistrationBinding, AiError> {
        self.revalidate(context, &context.binding)?;
        Ok(context.binding.clone())
    }
    fn revalidate(
        &self,
        context: &NativeHostContext,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        if binding != &context.binding {
            return Err(AiError::ConnectionUnavailable);
        }
        self.access
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?
            .revalidate(context.original())
            .map_err(|_| AiError::ConnectionUnavailable)?;
        self.registrations.revalidate(context.original(), binding)
    }
}

pub struct NativeReadStock<S, A> {
    service: S,
    authority: A,
    principal: mcp::NativePrincipalPort,
    schemas: mcp::NativeSchemas,
    admitted: BTreeSet<wire::OperationId>,
}
impl<S, A> NativeReadStock<S, A> {
    pub fn new(
        service: S,
        authority: A,
        principal: mcp::NativePrincipalPort,
        schemas: mcp::NativeSchemas,
        admitted: impl IntoIterator<Item = wire::OperationId>,
    ) -> Result<Self, AiError> {
        let admitted: BTreeSet<_> = admitted.into_iter().collect();
        for id in &admitted {
            let op = wire::operation(*id).map_err(|_| AiError::InvalidCatalog)?;
            if op.effect != wire::Effect::Read || op.authority != wire::Authority::Atlas {
                return Err(AiError::InvalidCatalog);
            }
        }
        Ok(Self {
            service,
            authority,
            principal,
            schemas,
            admitted,
        })
    }
    fn catalog(&self, context: &NativeHostContext) -> Result<mcp::NativeCatalog, AiError> {
        mcp::NativeCatalog::with_admitted_operations(
            &self.schemas,
            &context.principal,
            self.admitted.iter().copied(),
        )
        .map_err(peer_error)
    }
}
pub struct NativePreparedRead {
    catalog: mcp::NativeCatalog,
    operation: Mutex<Option<mcp::NativeOperation>>,
    requirement: mcp::NativeRequirement,
    name: String,
}
impl<S, A> SharedStockPort<NativeHostContext> for NativeReadStock<S, A>
where
    S: ServicePort<mcp::NativePrincipal, mcp::NativeOperation, Output = mcp::NativeOutput>,
    A: HostAuthority<NativeHostContext>,
{
    type Prepared = NativePreparedRead;
    fn projection(&self, context: &NativeHostContext) -> Result<StockCatalogProjection, AiError> {
        self.authority.revalidate(context, &context.binding)?;
        let catalog = self.catalog(context)?;
        let tools = catalog
            .list(&context.principal, None)
            .map_err(peer_error)?
            .tools;
        let mut families = Vec::new();
        for family in wire::families().map_err(|_| AiError::InvalidCatalog)? {
            let commands = family
                .command_ids
                .iter()
                .map(|id| {
                    let op = wire::operation(*id).map_err(|_| AiError::InvalidCatalog)?;
                    let text = |name| {
                        op.metadata
                            .get(name)
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                            .ok_or(AiError::InvalidCatalog)
                    };
                    Ok(StockCommandProjection {
                        command_id: op.id.as_str().into(),
                        input_schema: op.input_schema.clone(),
                        output_schema: op.output_schema.clone(),
                        effect: match op.effect {
                            wire::Effect::Read => StockCatalogEffect::Read,
                            wire::Effect::Write => StockCatalogEffect::Write,
                            wire::Effect::Variant => StockCatalogEffect::Variant,
                        },
                        permission: text("permission")?,
                        confirmation: text("confirmation")?,
                        capability_status: op.status.as_str().into(),
                        disposition: op
                            .metadata
                            .get("disposition")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        first_release_required: op
                            .metadata
                            .get("firstReleaseRequired")
                            .and_then(Value::as_bool)
                            .ok_or(AiError::InvalidCatalog)?,
                    })
                })
                .collect::<Result<Vec<_>, AiError>>()?;
            let descriptor = tools
                .iter()
                .find(|t| t.name == family.name.as_str())
                .map(|t| ToolDescriptor {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    parameters: Value::Object(t.input_schema.clone()),
                });
            families.push(StockFamilyProjection {
                family: StockToolFamily::from_tool_name(family.name.as_str())?,
                commands,
                descriptor,
            });
        }
        Ok(StockCatalogProjection {
            contract_version: STOCK_CONTRACT_VERSION.into(),
            wire_version: STOCK_WIRE_VERSION,
            families,
        })
    }
    fn prepare(
        &self,
        context: &NativeHostContext,
        family: StockToolFamily,
        arguments: &Value,
    ) -> Result<AcceptedStockCommand<Self::Prepared>, AiError> {
        self.authority.revalidate(context, &context.binding)?;
        let catalog = self.catalog(context)?;
        let prepared = catalog
            .prepare(
                &context.principal,
                family.as_str(),
                arguments.as_object().ok_or(AiError::InvalidInput)?.clone(),
            )
            .map_err(peer_error)?;
        let contracts = domain::NativeStockContract::new().map_err(|_| AiError::InvalidCatalog)?;
        let native = domain::ValidatedRequest::parse(&contracts, arguments.clone())
            .map_err(|_| AiError::InvalidInput)?;
        if native.is_mutation() {
            return Err(AiError::DomainUnavailable);
        }
        let metadata = StockRequestMetadata {
            family,
            command_id: native.operation().id.as_str().into(),
            request_id: native.request_id().into(),
            request_digest: native.intent_digest().into(),
            resolved_scope: StockScope {
                workspace_id: native.context().workspace_id.clone(),
                home_id: native.context().home_id.clone(),
            },
            effect: ToolEffect::Read,
        };
        Ok(AcceptedStockCommand::from_shared(
            metadata,
            NativePreparedRead {
                catalog,
                operation: Mutex::new(Some(prepared.operation)),
                requirement: prepared.requirement,
                name: family.as_str().into(),
            },
        ))
    }
    fn review<'a>(
        &'a self,
        _: &'a NativeHostContext,
        _: &'a Self::Prepared,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
    fn execute_read<'a>(
        &'a self,
        context: &'a NativeHostContext,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Value> {
        Box::pin(async move {
            cancel.checkpoint()?;
            self.authority.revalidate(context, &context.binding)?;
            let principal = self
                .principal
                .authorize(&context.native, &prepared.requirement)
                .await
                .map_err(peer_error)?;
            let operation = prepared
                .operation
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .take()
                .ok_or(AiError::DomainUnavailable)?;
            let output = self
                .service
                .execute(&principal, operation)
                .await
                .map_err(peer_error)?;
            self.principal
                .revalidate(&context.native, &principal)
                .await
                .map_err(peer_error)?;
            self.authority.revalidate(context, &context.binding)?;
            let result = prepared
                .catalog
                .render(&prepared.name, output)
                .map_err(peer_error)?;
            // Render validates the exact owner output/error arm. Preserve that
            // wire envelope intact, including canonical error DTOs.
            Ok(Value::Object(
                result.structured_content.ok_or(AiError::InvalidCatalog)?,
            ))
        })
    }
    fn execute_reviewed<'a>(
        &'a self,
        _: &'a NativeHostContext,
        _: &'a Self::Prepared,
        _: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
}
fn peer_error(error: mcp::PortError) -> AiError {
    match error {
        mcp::PortError::Unauthenticated | mcp::PortError::Forbidden => {
            AiError::ConnectionUnavailable
        }
        mcp::PortError::UnknownTool => AiError::UnknownTool,
        _ => AiError::DomainUnavailable,
    }
}
