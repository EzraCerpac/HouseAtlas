//! Adapter for the shared stock.2 wire3 domain service. The shared service owns
//! generated schemas, catalog dispositions, authorization, canonical digests,
//! mutation admission and result disclosure. This module carries their typed
//! boundary; it does not implement another command service.
use super::{
    AiError, Cancellation, DomainCatalog, PortFuture, ToolCall, ToolDescriptor, ToolEffect,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const STOCK_CONTRACT_VERSION: &str = "0.3.0-at34.stock.2";
pub const STOCK_WIRE_VERSION: u8 = 3;
pub const STOCK_COMMAND_COUNT: usize = 164;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StockToolFamily {
    AtlasRecords,
    AtlasBindings,
    AtlasMediaGeometry,
    HomeboxEntitiesLocations,
    HomeboxTagsFields,
    HomeboxTemplatesTypes,
    HomeboxFilesLinks,
    HomeboxMaintenance,
    NetworkQueries,
    HomeboxProductFeatures,
}

pub const STOCK_TOOL_FAMILIES: [StockToolFamily; 10] = [
    StockToolFamily::AtlasRecords,
    StockToolFamily::AtlasBindings,
    StockToolFamily::AtlasMediaGeometry,
    StockToolFamily::HomeboxEntitiesLocations,
    StockToolFamily::HomeboxTagsFields,
    StockToolFamily::HomeboxTemplatesTypes,
    StockToolFamily::HomeboxFilesLinks,
    StockToolFamily::HomeboxMaintenance,
    StockToolFamily::NetworkQueries,
    StockToolFamily::HomeboxProductFeatures,
];

impl StockToolFamily {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AtlasRecords => "atlas_records",
            Self::AtlasBindings => "atlas_bindings",
            Self::AtlasMediaGeometry => "atlas_media_geometry",
            Self::HomeboxEntitiesLocations => "homebox_entities_locations",
            Self::HomeboxTagsFields => "homebox_tags_fields",
            Self::HomeboxTemplatesTypes => "homebox_templates_types",
            Self::HomeboxFilesLinks => "homebox_files_links",
            Self::HomeboxMaintenance => "homebox_maintenance",
            Self::NetworkQueries => "network_queries",
            Self::HomeboxProductFeatures => "homebox_product_features",
        }
    }

    pub fn from_tool_name(name: &str) -> Result<Self, AiError> {
        STOCK_TOOL_FAMILIES
            .into_iter()
            .find(|family| family.as_str() == name)
            .ok_or(AiError::UnknownTool)
    }
}

/// Published catalog metadata; a variant needs shared per-argument resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StockCatalogEffect {
    Read,
    Write,
    Variant,
}

/// Full catalog membership remains visible to the host even when an arm is
/// unsupported, held or unavailable to this context. Missing disposition in
/// the six feature groups remains None rather than an invented permission.
#[derive(Debug, Clone)]
pub struct StockCommandProjection {
    pub command_id: String,
    pub input_schema: String,
    pub output_schema: String,
    pub effect: StockCatalogEffect,
    pub permission: String,
    pub confirmation: String,
    pub capability_status: String,
    pub disposition: Option<String>,
    pub first_release_required: bool,
}

#[derive(Debug, Clone)]
pub struct StockFamilyProjection {
    pub family: StockToolFamily,
    pub commands: Vec<StockCommandProjection>,
    /// None when no arm can be advertised. Its parameters are the shared
    /// offline-resolved projection of currently authorized exact request arms.
    pub descriptor: Option<ToolDescriptor>,
}

#[derive(Debug, Clone)]
pub struct StockCatalogProjection {
    pub contract_version: String,
    pub wire_version: u8,
    pub families: Vec<StockFamilyProjection>,
}

impl StockCatalogProjection {
    fn check_identity(&self) -> Result<(), AiError> {
        let mut families = HashSet::new();
        let mut commands = HashSet::new();
        if self.contract_version != STOCK_CONTRACT_VERSION
            || self.wire_version != STOCK_WIRE_VERSION
            || self.families.len() != STOCK_TOOL_FAMILIES.len()
        {
            return Err(AiError::InvalidCatalog);
        }
        for projection in &self.families {
            if !families.insert(projection.family)
                || projection
                    .descriptor
                    .as_ref()
                    .is_some_and(|descriptor| descriptor.name != projection.family.as_str())
            {
                return Err(AiError::InvalidCatalog);
            }
            for command in &projection.commands {
                if command.command_id.is_empty() || !commands.insert(&command.command_id) {
                    return Err(AiError::InvalidCatalog);
                }
            }
        }
        if commands.len() != STOCK_COMMAND_COUNT {
            return Err(AiError::InvalidCatalog);
        }
        Ok(())
    }
}

/// Exact current server-resolved scope. A client context selection does not
/// supply authority; the shared service resolves and captures that authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockScope {
    pub workspace_id: String,
    pub home_id: String,
}

/// Facts returned after the shared service validates the generated request arm,
/// command/family membership, current authority and argument-dependent effect.
/// The digest is computed by that service with the shared canonical contract.
#[derive(Debug, Clone)]
pub struct StockRequestMetadata {
    pub family: StockToolFamily,
    pub command_id: String,
    pub request_id: String,
    pub request_digest: String,
    pub resolved_scope: StockScope,
    pub effect: ToolEffect,
}

/// No Serialize, Deserialize or Clone implementation: a model/browser cannot
/// construct, carry or duplicate the peer's captured authorization/preparation.
pub struct AcceptedStockCommand<P> {
    metadata: StockRequestMetadata,
    handle: P,
}

impl<P> AcceptedStockCommand<P> {
    /// Called only by the injected shared service after its exact validation.
    /// Wrapping a value alone supplies no authority or approval.
    pub fn from_shared(metadata: StockRequestMetadata, handle: P) -> Self {
        Self { metadata, handle }
    }

    pub fn metadata(&self) -> &StockRequestMetadata {
        &self.metadata
    }

    pub fn handle(&self) -> &P {
        &self.handle
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Recoverability {
    ReversibleTombstone,
    ProviderPermanent,
    UnresolvedProviderEffects,
}

/// Exact outer stock challenge DTO. The shared generated validator still owns
/// UUID/digest/time limits and the target schema constraints.
/// This is a disclosed review challenge, never an approval receipt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewChallenge {
    pub challenge_id: String,
    pub command_id: String,
    pub request_digest: String,
    pub target_digest: String,
    pub impact_id: String,
    pub impact_digest: String,
    pub affected_targets: Vec<Value>,
    pub recoverability: Recoverability,
    pub expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DomainDispatchState {
    Observed,
    Prepared,
    Queued,
    Dispatching,
    RejectedBeforeDispatch,
    Partial,
    UnknownHeld,
    Resolved,
}

/// Internal routing observation. `value` retains the full exact validated wire
/// result, including its verification/activity/uncertainty fields. Only
/// Observed/Resolved results may continue to inference; neither proves causality.
#[derive(Debug, Clone)]
pub struct DomainDispatch {
    pub value: Value,
    pub state: DomainDispatchState,
    pub operation_id: Option<String>,
}

/// The application injects its one shared command service here. It uses AT51's
/// generated stock/Atlas DTOs behind Prepared, not model-supplied authority.
pub trait SharedStockPort<C> {
    type Prepared: Send + Sync;

    /// Preserve all 164 catalog entries across the ten original families, while
    /// advertising only authorized supported arms. Resolve schema resources
    /// offline; catalog design status does not enable provider/live readiness.
    fn projection(&self, context: &C) -> Result<StockCatalogProjection, AiError>;

    /// Validate the exact wire3 arm and current complete scope. Resolve variants
    /// (notably label render versus print) from validated arguments. Reject
    /// unsupported/held/forbidden forms before invocation. Capture immutable
    /// intent, original guards and current authority in the opaque handle.
    fn prepare(
        &self,
        context: &C,
        family: StockToolFamily,
        arguments: &Value,
    ) -> Result<AcceptedStockCommand<Self::Prepared>, AiError>;

    /// Preparation does not issue or consume approval. A confirmation-none
    /// mutation can need the trusted review flow without an impact challenge.
    /// Authorize the challenge's complete disclosed graph in current context.
    fn review<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>>;

    /// Revalidate captured authority/preparation before dispatch. Validate the
    /// exact output arm, request/command/scope/target/resource correlations and
    /// current disclosure rights before returning any JSON to inference.
    fn execute_read<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Value>;

    /// The peer looks up its separately trusted human review/receipt and binds
    /// it to this immutable intent in current context at every dispatch. There
    /// is deliberately no approval JSON, actor, grant or receipt argument here.
    /// Admission/queue/local transaction/provider semantics remain in the peer;
    /// completed Atlas results must match the accepted data.requestDigest.
    fn execute_reviewed<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch>;
}

pub struct StockCatalog<D> {
    domain: D,
}

impl<D> StockCatalog<D> {
    pub fn new(domain: D) -> Self {
        Self { domain }
    }

    pub fn domain(&self) -> &D {
        &self.domain
    }
}

/// Narrow outer-wire correlation supplements the shared generated validator.
/// It does not determine result kind, validate the resource graph, recalculate
/// intent digests or replace current disclosure authorization in the peer.
fn correlate_result(value: &Value, metadata: &StockRequestMetadata) -> Result<(), AiError> {
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(u64::from(STOCK_WIRE_VERSION))
        || value.get("commandId").and_then(Value::as_str) != Some(metadata.command_id.as_str())
        || value.get("requestId").and_then(Value::as_str) != Some(metadata.request_id.as_str())
        || scope_field(value, "resolvedScope")? != metadata.resolved_scope
    {
        return Err(AiError::InvalidCatalog);
    }
    if metadata.effect == ToolEffect::RequiresReview
        && metadata.command_id.starts_with("atlas.")
        && value.get("status").and_then(Value::as_str) == Some("committed")
        && value
            .get("data")
            .and_then(|data| data.get("requestDigest"))
            .and_then(Value::as_str)
            != Some(metadata.request_digest.as_str())
    {
        return Err(AiError::InvalidCatalog);
    }
    if value
        .get("requestDigest")
        .is_some_and(|digest| digest.as_str() != Some(metadata.request_digest.as_str()))
    {
        return Err(AiError::InvalidCatalog);
    }
    Ok(())
}

fn scope_field(value: &Value, field: &str) -> Result<StockScope, AiError> {
    let scope = value.get(field).ok_or(AiError::InvalidCatalog)?;
    serde_json::from_value(scope.clone()).map_err(|_| AiError::InvalidCatalog)
}

impl<C: Sync, D: SharedStockPort<C> + Sync> DomainCatalog<C> for StockCatalog<D> {
    type Prepared = AcceptedStockCommand<D::Prepared>;

    fn tools(&self, context: &C) -> Result<Vec<ToolDescriptor>, AiError> {
        let projection = self.domain.projection(context)?;
        projection.check_identity()?;
        Ok(projection
            .families
            .into_iter()
            .filter_map(|family| family.descriptor)
            .collect())
    }

    fn prepare(&self, context: &C, call: &ToolCall) -> Result<Self::Prepared, AiError> {
        let family = StockToolFamily::from_tool_name(&call.name)?;
        let prepared = self.domain.prepare(context, family, &call.arguments)?;
        let metadata = prepared.metadata();
        if metadata.family != family
            || call.arguments.get("schemaVersion").and_then(Value::as_u64)
                != Some(u64::from(STOCK_WIRE_VERSION))
            || call.arguments.get("commandId").and_then(Value::as_str)
                != Some(metadata.command_id.as_str())
            || call.arguments.get("requestId").and_then(Value::as_str)
                != Some(metadata.request_id.as_str())
            || scope_field(&call.arguments, "context")? != metadata.resolved_scope
        {
            return Err(AiError::InvalidCatalog);
        }
        Ok(prepared)
    }

    fn effect(&self, prepared: &Self::Prepared) -> ToolEffect {
        prepared.metadata.effect
    }

    fn review<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>> {
        self.domain.review(context, prepared.handle(), cancel)
    }

    fn execute_read<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, Value> {
        Box::pin(async move {
            if prepared.metadata.effect != ToolEffect::Read {
                return Err(AiError::InvalidCatalog);
            }
            let value = self
                .domain
                .execute_read(context, prepared.handle(), cancel)
                .await?;
            correlate_result(&value, prepared.metadata())?;
            Ok(value)
        })
    }

    fn execute_reviewed<'a>(
        &'a self,
        context: &'a C,
        prepared: &'a Self::Prepared,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch> {
        Box::pin(async move {
            if prepared.metadata.effect != ToolEffect::RequiresReview {
                return Err(AiError::InvalidCatalog);
            }
            let dispatch = self
                .domain
                .execute_reviewed(context, prepared.handle(), cancel)
                .await?;
            correlate_result(&dispatch.value, prepared.metadata())?;
            Ok(dispatch)
        })
    }
}
