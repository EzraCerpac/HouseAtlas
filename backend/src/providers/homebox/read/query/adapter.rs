use super::*;
use crate::domain::stock::{
    self as st, PreparedRequest, StockContractPort, StockHistoryPort, StockQueryPort,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// Actual provider/cache/artifact owners implement this narrow read interface.
/// The original principal, prepared request, witness and graph are borrowed
/// unchanged. The owner must use captured source/collection/whole-scope/egress
/// obligations and return real observation/cursor/artifact facts. Async provider
/// intake belongs to the existing source owner before resolving the captured
/// graph; this synchronous adapter reads decoded/retained observations. No
/// authority implementation, decoder, arbitrary HTTP or dispatcher lives here.
pub trait HomeBoxReadOwner<P, W, G> {
    fn read(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
        query: &HomeBoxReadQuery,
    ) -> st::StockResult<HomeBoxReadResult>;
}

/// Mount as the HomeBox arm of the existing Domain StockQueryPort. The same
/// dispatch_prepared boundary must perform final authority/disclosure checks.
pub struct HomeBoxQueries<'a, C, Q, H> {
    contracts: &'a C,
    reads: &'a mut Q,
    history: &'a mut H,
}
impl<'a, C, Q, H> HomeBoxQueries<'a, C, Q, H> {
    pub fn new(contracts: &'a C, reads: &'a mut Q, history: &'a mut H) -> Self {
        Self {
            contracts,
            reads,
            history,
        }
    }
}
impl<P, W, G, C, Q, H> StockQueryPort<P, W, G> for HomeBoxQueries<'_, C, Q, H>
where
    C: StockContractPort,
    Q: HomeBoxReadOwner<P, W, G>,
    H: StockHistoryPort<P>,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        let request = prepared.request();
        let query = HomeBoxReadQuery::from_request(request)?;
        let result = if matches!(query.selection(), ReadSelection::MediatedHistory) {
            // Existing owner preserves durable event/intent/audit linkage and
            // scoped cursor. Current entities never reconstruct upstream history.
            self.history
                .stock_history(principal, self.contracts, request)?
        } else {
            let read = self.reads.read(principal, prepared, &query)?;
            st::OwnerResult {
                wire: envelope(request, &query, read)?,
                children: Vec::new(),
            }
        };
        self.contracts
            .validate(request.operation().output_schema, &result.wire)?;
        if !result.children.is_empty()
            || result.wire["commandId"] != request.id().as_str()
            || result.wire["requestId"] != request.request_id()
            || result.wire["resolvedScope"]
                != serde_json::to_value(request.context())
                    .map_err(|_| st::StockError::InvalidContract)?
            || result.wire["status"] != "read"
        {
            return Err(st::StockError::CorrelationMismatch);
        }
        Ok(result)
    }
}
fn scope_matches(
    query: &HomeBoxReadQuery,
    scope: &super::super::SourceScope,
) -> st::StockResult<()> {
    if query.scope() != scope {
        return Err(st::StockError::CorrelationMismatch);
    }
    Ok(())
}
pub(super) fn envelope(
    request: &st::ValidatedRequest,
    query: &HomeBoxReadQuery,
    read: HomeBoxReadResult,
) -> st::StockResult<Value> {
    let mut wire = json!({"schemaVersion":3,"commandId":request.id().as_str(),"requestId":request.request_id(),"resolvedScope":request.context(),"status":"read","replayed":false});
    let data = match (query.selection(), read) {
        (ReadSelection::Resources { page, .. }, HomeBoxReadResult::Resources(result)) => {
            scope_matches(query, &result.scope)?;
            if result.resources.len() > page.as_ref().map_or(100, |p| p.page_size as usize) {
                return Err(st::StockError::CorrelationMismatch);
            }
            let mut seen = BTreeSet::new();
            for resource in &result.resources {
                let target = serde_json::to_value(&resource.target)
                    .map_err(|_| st::StockError::InvalidContract)?;
                if target["sourceInstanceId"] != request.target()["sourceInstanceId"]
                    || target["collectionId"] != request.target()["collectionId"]
                    || request
                        .target()
                        .get("entityId")
                        .is_some_and(|id| target["entityId"] != *id)
                    || (request.id() != st::OperationId::HomeboxEntityPath
                        && request
                            .target()
                            .get("resourceId")
                            .is_some_and(|id| target["resourceId"] != *id))
                    || !seen.insert(
                        serde_json::to_string(&resource.target)
                            .map_err(|_| st::StockError::InvalidContract)?,
                    )
                {
                    return Err(st::StockError::CorrelationMismatch);
                }
            }
            json!({"resources":result.resources,"nextCursor":result.next_cursor,"sourceStatus":result.source_status,"historyCompleteness":"not-complete-upstream-audit"})
        }
        (ReadSelection::Download, HomeBoxReadResult::Download(result)) => {
            scope_matches(query, &result.scope)?;
            if result.target != *query.target() {
                return Err(st::StockError::CorrelationMismatch);
            }
            json!({"target":result.target,"downloadToken":result.download_token,"sha256":result.sha256,"byteSize":result.byte_size,"contentType":result.content_type,"disposition":"attachment"})
        }
        (ReadSelection::Feature(selected), HomeBoxReadResult::Feature(result)) => {
            scope_matches(query, &result.scope)?;
            wire.as_object_mut()
                .ok_or(st::StockError::InvalidContract)?
                .remove("replayed");
            wire["sourceInstanceId"] = json!(result.scope.source_instance_id);
            wire["collectionId"] = json!(result.scope.collection_id);
            wire["retrievedAt"] = json!(result.retrieved_at);
            match (&selected, result.data) {
                (
                    FeatureQuery::Export { max_bytes, .. }
                    | FeatureQuery::Label { max_bytes, .. }
                    | FeatureQuery::Qrcode { max_bytes },
                    FeatureData::Artifact(artifact),
                ) => {
                    if artifact.byte_size > *max_bytes {
                        return Err(st::StockError::CorrelationMismatch);
                    }
                    let correct_media = if matches!(selected, FeatureQuery::Export { .. }) {
                        artifact.content_type == "text/csv"
                    } else {
                        matches!(artifact.content_type.as_str(), "image/png" | "image/jpeg")
                    };
                    if !correct_media {
                        return Err(st::StockError::CorrelationMismatch);
                    }
                    json!({"kind":selected.expected_kind(),"artifact":artifact})
                }
                (FeatureQuery::Query { limit, .. }, FeatureData::Query(data)) => {
                    if data["kind"] != selected.expected_kind() {
                        return Err(st::StockError::CorrelationMismatch);
                    }
                    for key in ["rows", "entries"] {
                        if data[key]
                            .as_array()
                            .is_some_and(|r| r.len() as u64 > *limit)
                        {
                            return Err(st::StockError::CorrelationMismatch);
                        }
                    }
                    data
                }
                _ => return Err(st::StockError::CorrelationMismatch),
            }
        }
        _ => return Err(st::StockError::CorrelationMismatch),
    };
    wire["data"] = data;
    Ok(wire)
}
