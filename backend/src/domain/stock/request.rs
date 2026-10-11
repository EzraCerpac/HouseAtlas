use super::{
    Authority, Disposition, Effect, FEATURE_ROUTES, FeatureScope, NativeRoute, Operation,
    OperationId, StockContractPort, StockError, StockResult, request_digest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockContext {
    pub workspace_id: String,
    pub home_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NetworkView {
    Inventory,
    Snapshot,
    History,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Route {
    AtlasLocal,
    AtlasMediatedHomeboxHistory,
    /// Snapshot/history use saved authorized owner data; the only permitted
    /// upstream inventory route remains this fixed passive GET source.
    NetworkPassive {
        view: NetworkView,
        inventory_route: NativeRoute,
    },
    HomeboxNative(NativeRoute),
    HomeboxFeature {
        native: NativeRoute,
        variant: &'static str,
        scope: FeatureScope,
        /// Rendering explicitly sends print=false. Printing joins the write
        /// owner and requires separate qualified printer and approval facts.
        print: bool,
    },
}

/// Immutable original stock request, including omitted/null/empty distinctions.
/// Private fields ensure callers cannot mutate a prepared request or digest.
#[derive(Clone, Debug)]
pub struct ValidatedRequest {
    raw: Value,
    id: OperationId,
    context: StockContext,
    request_id: String,
    digest: String,
    route: Route,
    children: Vec<ValidatedRequest>,
}

impl ValidatedRequest {
    /// Local pinned capture only. The generic stock dispatcher keeps its wire3 catalog.
    pub fn parse_pinned_homebox_download_v4(
        contracts: &impl StockContractPort,
        raw: Value,
    ) -> StockResult<Self> {
        if string(&raw, "commandId")? != "homebox.file.download" {
            return Err(StockError::InvalidContract);
        }
        contracts.validate(
            "urn:houseatlas:pinned-homebox-file:4#/$defs/request_homebox_file_download_v4",
            &raw,
        )?;
        let id = OperationId::HomeboxFileDownload;
        let route = route(id.operation(), &raw)?;
        let context = serde_json::from_value(raw["context"].clone())
            .map_err(|_| StockError::InvalidContract)?;
        let request_id = string(&raw, "requestId")?.to_owned();
        let digest = request_digest(&raw)?;
        Ok(Self {
            raw,
            id,
            context,
            request_id,
            digest,
            route,
            children: Vec::new(),
        })
    }

    pub fn parse(contracts: &impl StockContractPort, raw: Value) -> StockResult<Self> {
        let id =
            OperationId::parse(string(&raw, "commandId")?).ok_or(StockError::InvalidContract)?;
        let operation = id.operation();
        contracts.validate(operation.input_schema, &raw)?;
        let route = route(operation, &raw)?;
        let context = serde_json::from_value(raw["context"].clone())
            .map_err(|_| StockError::InvalidContract)?;
        let request_id = string(&raw, "requestId")?.to_owned();
        let digest = request_digest(&raw)?;
        let mut children = Vec::new();
        if id == OperationId::AtlasBatchExecute {
            for child in raw["payload"]["commands"]
                .as_array()
                .ok_or(StockError::InvalidContract)?
            {
                let child = Self::parse(contracts, child.clone())?;
                if child.context != context
                    || child.operation().authority != Authority::Atlas
                    || child.operation().effect != Effect::Write
                    || child.id == OperationId::AtlasBatchExecute
                {
                    return Err(StockError::InvalidContract);
                }
                children.push(child);
            }
        }
        Ok(Self {
            raw,
            id,
            context,
            request_id,
            digest,
            route,
            children,
        })
    }

    pub fn raw(&self) -> &Value {
        &self.raw
    }
    pub fn operation(&self) -> &'static Operation {
        self.id.operation()
    }
    pub fn id(&self) -> OperationId {
        self.id
    }
    pub fn context(&self) -> &StockContext {
        &self.context
    }
    pub fn request_id(&self) -> &str {
        &self.request_id
    }
    pub fn intent_digest(&self) -> &str {
        &self.digest
    }
    pub fn target(&self) -> &Value {
        &self.raw["target"]
    }
    pub fn payload(&self) -> &Value {
        &self.raw["payload"]
    }
    pub fn route(&self) -> &Route {
        &self.route
    }
    pub fn children(&self) -> &[ValidatedRequest] {
        &self.children
    }
    pub fn is_mutation(&self) -> bool {
        self.operation().effect == Effect::Write
            || matches!(self.route, Route::HomeboxFeature { print: true, .. })
    }
    pub fn whole_collection_required(&self) -> bool {
        matches!(
            self.route,
            Route::HomeboxFeature {
                scope: FeatureScope::Collection,
                ..
            }
        )
    }
    pub fn external_egress_required(&self) -> bool {
        matches!(
            self.route,
            Route::HomeboxFeature {
                scope: FeatureScope::ExternalLookup,
                ..
            }
        )
    }
}

pub(crate) fn string<'a>(value: &'a Value, field: &str) -> StockResult<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or(StockError::InvalidContract)
}

fn route(operation: &Operation, raw: &Value) -> StockResult<Route> {
    Ok(match operation.disposition {
        Disposition::Unsupported => return Err(StockError::UnsupportedCapability),
        Disposition::Held => return Err(StockError::CapabilityHeld),
        Disposition::AppendOnlyForbidden => return Err(StockError::ForbiddenAppendOnly),
        Disposition::AtlasOwned => Route::AtlasLocal,
        Disposition::MediatedHistory => Route::AtlasMediatedHomeboxHistory,
        Disposition::NetworkPassive => Route::NetworkPassive {
            view: match operation.id {
                OperationId::NetworkInventoryGet => NetworkView::Inventory,
                OperationId::NetworkSnapshotGet => NetworkView::Snapshot,
                OperationId::NetworkHistoryGet => NetworkView::History,
                _ => return Err(StockError::InvalidContract),
            },
            inventory_route: NativeRoute {
                method: super::Method::Get,
                path: "/api/inventory",
            },
        },
        Disposition::Native | Disposition::NativeContractRevision => {
            Route::HomeboxNative(operation.route.ok_or(StockError::InvalidContract)?)
        }
        Disposition::Feature => {
            let payload = &raw["payload"];
            let selector = match operation.id {
                OperationId::HomeboxBulkExecute => "action",
                OperationId::HomeboxImportCsv | OperationId::HomeboxExportCreate => "format",
                OperationId::HomeboxQueryRead => "view",
                OperationId::HomeboxLabelOutput => "subject",
                OperationId::HomeboxQrcodeRender => "bounded-content",
                _ => return Err(StockError::InvalidContract),
            };
            let variant = if selector == "bounded-content" {
                selector
            } else {
                string(payload, selector)?
            };
            let feature = FEATURE_ROUTES
                .iter()
                .find(|route| route.id == operation.id && route.variant == variant)
                .ok_or(StockError::InvalidContract)?;
            Route::HomeboxFeature {
                native: feature.native,
                variant: feature.variant,
                scope: feature.scope,
                print: operation.id == OperationId::HomeboxLabelOutput
                    && string(payload, "delivery")? == "print",
            }
        }
    })
}
