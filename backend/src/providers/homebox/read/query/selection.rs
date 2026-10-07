use super::super::{SourceScope, Uuid};
use super::*;
use crate::{
    contracts::stock::StockTarget,
    domain::stock::{self as st, OperationId as Op},
};
use serde::Deserialize;

/// Exact catalog-required read IDs. Label's non-print variant is separate.
pub const REQUIRED_READ_OPERATIONS: [Op; 28] = [
    Op::HomeboxEntityGet,
    Op::HomeboxEntityList,
    Op::HomeboxLocationGet,
    Op::HomeboxLocationList,
    Op::HomeboxEntityMediatedHistory,
    Op::HomeboxLocationMediatedHistory,
    Op::HomeboxLocationTree,
    Op::HomeboxEntityPath,
    Op::HomeboxTagList,
    Op::HomeboxTagGet,
    Op::HomeboxEntityTagsGet,
    Op::HomeboxFieldList,
    Op::HomeboxFieldGet,
    Op::HomeboxEntityFieldNames,
    Op::HomeboxEntityFieldValues,
    Op::HomeboxFileList,
    Op::HomeboxFileGet,
    Op::HomeboxFileDownload,
    Op::HomeboxDocumentLinkList,
    Op::HomeboxDocumentLinkGet,
    Op::HomeboxMaintenanceList,
    Op::HomeboxMaintenanceGet,
    Op::HomeboxEntityTypeList,
    Op::HomeboxTemplateList,
    Op::HomeboxTemplateGet,
    Op::HomeboxExportCreate,
    Op::HomeboxQueryRead,
    Op::HomeboxQrcodeRender,
];

/// Only a validated immutable Domain request can select a read operation.
/// No public unchecked constructor, mutation/printing arm or HTTP override.
#[derive(Clone, Debug)]
pub struct HomeBoxReadQuery {
    scope: SourceScope,
    target: StockTarget,
    selection: ReadSelection,
}
impl HomeBoxReadQuery {
    pub fn from_request(request: &st::ValidatedRequest) -> st::StockResult<Self> {
        let id = request.id();
        if request.is_mutation()
            || !(REQUIRED_READ_OPERATIONS.contains(&id) || id == Op::HomeboxLabelOutput)
        {
            return Err(st::StockError::OwnerUnavailable);
        }
        let t = request.target();
        let uuid = |value: &serde_json::Value| {
            Uuid::parse(value.as_str().ok_or(st::StockError::InvalidContract)?)
                .map_err(|_| st::StockError::InvalidContract)
        };
        let scope = SourceScope {
            workspace_id: Uuid::parse(&request.context().workspace_id)
                .map_err(|_| st::StockError::InvalidContract)?,
            home_id: Uuid::parse(&request.context().home_id)
                .map_err(|_| st::StockError::InvalidContract)?,
            source_instance_id: uuid(&t["sourceInstanceId"])?,
            collection_id: t["collectionId"]
                .as_str()
                .ok_or(st::StockError::InvalidContract)?
                .into(),
        };
        let target =
            serde_json::from_value(t.clone()).map_err(|_| st::StockError::InvalidContract)?;
        let payload = request.payload();
        let number = |key: &str| -> st::StockResult<u64> {
            struct Integer(u64);
            impl<'de> Deserialize<'de> for Integer {
                fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                    super::super::types::deserialize_integral_u64(d).map(Self)
                }
            }
            serde_json::from_value::<Integer>(payload[key].clone())
                .map(|v| v.0)
                .map_err(|_| st::StockError::InvalidContract)
        };
        let string = |key: &str| {
            payload[key]
                .as_str()
                .map(str::to_owned)
                .ok_or(st::StockError::InvalidContract)
        };
        let selection = match id {
            Op::HomeboxEntityMediatedHistory | Op::HomeboxLocationMediatedHistory => {
                ReadSelection::MediatedHistory
            }
            Op::HomeboxFileDownload => ReadSelection::Download,
            Op::HomeboxExportCreate => ReadSelection::Feature(FeatureQuery::Export {
                format: string("format")?,
                max_rows: number("maxRows")?,
                max_bytes: number("maxBytes")?,
            }),
            Op::HomeboxQueryRead => ReadSelection::Feature(FeatureQuery::Query {
                view: serde_json::from_value(payload["view"].clone())
                    .map_err(|_| st::StockError::InvalidContract)?,
                limit: number("limit")?,
            }),
            Op::HomeboxLabelOutput => {
                if payload["delivery"] != "render"
                    || !matches!(
                        request.route(),
                        st::Route::HomeboxFeature { print: false, .. }
                    )
                {
                    return Err(st::StockError::OwnerUnavailable);
                }
                ReadSelection::Feature(FeatureQuery::Label {
                    subject: string("subject")?,
                    max_bytes: number("maxBytes")?,
                })
            }
            Op::HomeboxQrcodeRender => ReadSelection::Feature(FeatureQuery::Qrcode {
                max_bytes: number("maxBytes")?,
            }),
            _ => ReadSelection::Resources {
                operation: id,
                page: if payload.get("pageSize").is_some() {
                    Some(
                        serde_json::from_value(payload.clone())
                            .map_err(|_| st::StockError::InvalidContract)?,
                    )
                } else {
                    None
                },
            },
        };
        Ok(Self {
            scope,
            target,
            selection,
        })
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub fn target(&self) -> &StockTarget {
        &self.target
    }
    pub fn selection(&self) -> &ReadSelection {
        &self.selection
    }
}
