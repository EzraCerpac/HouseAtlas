use super::super::{SourceScope, Timestamp, Uuid, types::deserialize_integral_u64};
use crate::{contracts::stock::StockTarget, domain::stock::OperationId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Deserialized only after actual frozen request validation. Cursor spelling,
/// omission and query text remain unchanged in the original prepared request.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListQuery {
    pub cursor: Option<String>,
    #[serde(deserialize_with = "deserialize_integral_u64")]
    pub page_size: u64,
    pub include_archived: bool,
    pub q: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QueryView {
    AssetLookup,
    Currency,
    Statistics,
    StatisticsLocations,
    StatisticsTags,
    StatisticsPurchasePrice,
    Maintenance,
    BarcodeProduct,
}
#[derive(Clone, Debug)]
pub enum FeatureQuery {
    Export {
        format: String,
        max_rows: u64,
        max_bytes: u64,
    },
    Query {
        view: QueryView,
        limit: u64,
    },
    /// Read-only label selection. The exact asset/resource ID remains in the
    /// original prepared payload; delivery=print cannot construct this arm.
    Label {
        subject: String,
        max_bytes: u64,
    },
    Qrcode {
        max_bytes: u64,
    },
}
impl FeatureQuery {
    pub fn expected_kind(&self) -> &'static str {
        match self {
            Self::Export { format, .. } if format == "inventory-csv" => "inventory-csv",
            Self::Export { .. } => "bill-of-materials-csv",
            Self::Query { view, .. } => match view {
                QueryView::AssetLookup => "asset-lookup",
                QueryView::Currency => "currency",
                QueryView::Statistics => "statistics",
                QueryView::StatisticsLocations => "statistics-locations",
                QueryView::StatisticsTags => "statistics-tags",
                QueryView::StatisticsPurchasePrice => "statistics-purchase-price",
                QueryView::Maintenance => "maintenance",
                QueryView::BarcodeProduct => "barcode-product",
            },
            Self::Label { .. } => "label-image",
            Self::Qrcode { .. } => "qrcode-image",
        }
    }
    /// The provider owner must apply this to the existing fixed label route.
    pub fn label_print_query(&self) -> Option<(&'static str, &'static str)> {
        matches!(self, Self::Label { .. }).then_some(("print", "false"))
    }
}
#[derive(Clone, Debug)]
pub enum ReadSelection {
    Resources {
        operation: OperationId,
        page: Option<ListQuery>,
    },
    MediatedHistory,
    Download,
    Feature(FeatureQuery),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceStatus {
    Current,
    Stale,
    Unavailable,
    Unresolved,
}

/// An observation is evidence, never authority or provider CAS. Provider handles
/// must be issued/resolved by the actual observation owner in the captured graph.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ReadObservation {
    ObservationOnly { digest: String },
    ProviderObservation { handle: Uuid },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceView {
    pub target: StockTarget,
    pub observation: ReadObservation,
    /// Exact resource-specific wire3 data, validated with the actual owner's
    /// output schema. No stripping/coercion or generic extension object allowed.
    pub data: Value,
    pub retrieved_at: Timestamp,
}
#[derive(Clone, Debug)]
pub struct ResourcePage {
    pub scope: SourceScope,
    pub resources: Vec<ResourceView>,
    pub next_cursor: Option<String>,
    pub source_status: SourceStatus,
}
/// Scoped handles supplied by the actual artifact broker. This adapter neither
/// mints tokens nor accepts native paths/URLs as downloadable capabilities.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArtifact {
    pub download_token: Uuid,
    pub sha256: String,
    pub byte_size: u64,
    pub content_type: String,
    pub expires_at: Timestamp,
}
#[derive(Clone, Debug)]
pub enum FeatureData {
    Artifact(ReadArtifact),
    /// Exact selected currency/statistics/maintenance/product data object.
    /// Its closed selected arm is checked by the frozen feature output schema.
    Query(Value),
}
#[derive(Clone, Debug)]
pub struct FeatureRead {
    pub scope: SourceScope,
    pub retrieved_at: Timestamp,
    pub data: FeatureData,
}
#[derive(Clone, Debug)]
pub struct FileDownload {
    pub scope: SourceScope,
    pub target: StockTarget,
    pub download_token: Uuid,
    pub sha256: Option<String>,
    pub byte_size: u64,
    pub content_type: String,
}
#[derive(Clone, Debug)]
pub enum HomeBoxReadResult {
    Resources(ResourcePage),
    Feature(FeatureRead),
    Download(FileDownload),
}
