//! Stock wire3 views of an already disclosed complete retained generation.
//! The injected peer owns genuine original authority and native baseline checks.
//! There is no transport, refresh, capture, admission or write capability here.
use super::{FacetStatus, NetworkFacet, NetworkRelation, QualifiedRecord, SourceKind, SourceScope};
use crate::{contracts::stock as wire, domain::stock};
use serde_json::{Value, json};

/// Owner support describes routing, never permission or runtime admission.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SavedNetworkQuerySupport {
    pub operation: stock::OperationId,
    pub agent_operation: wire::OperationId,
    pub view: stock::NetworkView,
}

pub const SAVED_NETWORK_QUERY_SUPPORT: [SavedNetworkQuerySupport; 3] = [
    SavedNetworkQuerySupport {
        operation: stock::OperationId::NetworkInventoryGet,
        agent_operation: wire::OperationId::NetworkInventoryGet,
        view: stock::NetworkView::Inventory,
    },
    SavedNetworkQuerySupport {
        operation: stock::OperationId::NetworkSnapshotGet,
        agent_operation: wire::OperationId::NetworkSnapshotGet,
        view: stock::NetworkView::Snapshot,
    },
    SavedNetworkQuerySupport {
        operation: stock::OperationId::NetworkHistoryGet,
        agent_operation: wire::OperationId::NetworkHistoryGet,
        view: stock::NetworkView::History,
    },
];

pub const SAVED_NETWORK_RESULT_LIMIT: usize = 100;

pub fn saved_network_query_support(
    operation: stock::OperationId,
) -> Option<&'static SavedNetworkQuerySupport> {
    SAVED_NETWORK_QUERY_SUPPORT
        .iter()
        .find(|support| support.operation == operation)
}

/// Required host peer, with no default decision or unchecked retained-state API.
/// Bind this exact principal/prepared witness/graph to the original owning Core,
/// original partition/entity/link/observation grants and captured native cache
/// baseline. Re-disclose through the actual host runtime, including empty views,
/// without replacement grant capture or independent issuer/Store construction.
/// The returned facet must come from the same complete retained generation.
/// Stock dispatch must still authorize the exact output and revalidate its
/// original captured authority before release to HTTP, MCP or WebMCP.
pub trait SavedNetworkReadPort<P, W, G> {
    fn disclose_retained_facet(
        &mut self,
        principal: &P,
        prepared: &stock::PreparedRequest<W, G>,
    ) -> stock::StockResult<NetworkFacet>;
}
impl<P, W, G, F> SavedNetworkReadPort<P, W, G> for F
where
    F: FnMut(&P, &stock::PreparedRequest<W, G>) -> stock::StockResult<NetworkFacet>,
{
    fn disclose_retained_facet(
        &mut self,
        principal: &P,
        prepared: &stock::PreparedRequest<W, G>,
    ) -> stock::StockResult<NetworkFacet> {
        self(principal, prepared)
    }
}

pub struct SavedNetworkQueries<R, C> {
    reads: R,
    contracts: C,
}
impl<R, C> SavedNetworkQueries<R, C> {
    pub fn new(reads: R, contracts: C) -> Self {
        Self { reads, contracts }
    }
    pub fn into_parts(self) -> (R, C) {
        (self.reads, self.contracts)
    }
}
impl<P, W, G, R, C> stock::StockQueryPort<P, W, G> for SavedNetworkQueries<R, C>
where
    R: SavedNetworkReadPort<P, W, G>,
    C: stock::StockContractPort,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &stock::PreparedRequest<W, G>,
    ) -> stock::StockResult<stock::OwnerResult> {
        let request = prepared.request();
        let support =
            saved_network_query_support(request.id()).ok_or(stock::StockError::OwnerUnavailable)?;
        self.contracts
            .validate(request.operation().input_schema, request.raw())?;
        ensure(
            matches!(request.route(), stock::Route::NetworkPassive { view, .. }
            if view == &support.view),
        )?;
        let scope = SourceScope {
            workspace_id: request.context().workspace_id.clone(),
            home_id: request.context().home_id.clone(),
            source_instance_id: string(request.target(), "sourceInstanceId")?.to_owned(),
            collection_id: string(request.target(), "collectionId")?.to_owned(),
        };
        let facet = self.reads.disclose_retained_facet(principal, prepared)?;
        ensure(facet.scope == scope && facet.cache.scope == scope && facet.read_only)?;
        let nodes = [
            (&facet.groups, SourceKind::Group),
            (&facet.devices, SourceKind::Device),
            (&facet.interfaces, SourceKind::Interface),
            (&facet.segments, SourceKind::Segment),
        ];
        for (rows, kind) in &nodes {
            ensure(
                rows.iter()
                    .all(|row| row.scope == scope && row.source_kind == *kind),
            )?;
        }
        for row in facet.current_claims.iter().chain(&facet.history) {
            ensure(row.scope == scope)?;
        }
        ensure(
            facet
                .current_claims
                .iter()
                .all(|row| row.temporal_status == super::TemporalStatus::CurrentClaim)
                && facet
                    .history
                    .iter()
                    .all(|row| row.temporal_status != super::TemporalStatus::CurrentClaim),
        )?;
        let visible = matches!(facet.status, FacetStatus::Fresh | FacetStatus::Stale);
        if !visible {
            ensure(
                nodes.iter().all(|(rows, _)| rows.is_empty())
                    && facet.current_claims.is_empty()
                    && facet.history.is_empty(),
            )?;
        }
        let selected = request
            .target()
            .get("resourceId")
            .map(|value| value.as_str().ok_or(stock::StockError::InvalidContract))
            .transpose()?;
        // resourceId is an exact opaque-ID filter, preserving every matching
        // typed node/link identity. It grants no incident-neighbor expansion.
        let matches_id = |id: &str| selected.is_none_or(|selected| selected == id);
        let relations = match support.view {
            stock::NetworkView::Inventory | stock::NetworkView::Snapshot => &facet.current_claims,
            stock::NetworkView::History => &facet.history,
        };
        let relations: Vec<&NetworkRelation> = relations
            .iter()
            .filter(|row| matches_id(&row.external_id))
            .take(SAVED_NETWORK_RESULT_LIMIT + 1)
            .collect();
        let selected_nodes: Vec<&QualifiedRecord> = nodes
            .iter()
            .flat_map(|(rows, _)| rows.iter())
            .filter(|row| matches_id(&row.external_id))
            .take(SAVED_NETWORK_RESULT_LIMIT + 1)
            .collect();
        // The frozen result has no cursor/completeness field. Never truncate a
        // larger view or invent paging/history completeness to fit its bounds.
        if selected_nodes.len() > SAVED_NETWORK_RESULT_LIMIT
            || relations.len() > SAVED_NETWORK_RESULT_LIMIT
        {
            return Err(stock::StockError::OwnerUnavailable);
        }
        let devices: Vec<Value> = selected_nodes
            .into_iter()
            .map(device)
            .collect::<stock::StockResult<_>>()?;
        let capability = match support.view {
            stock::NetworkView::Inventory => "inventory",
            stock::NetworkView::Snapshot => "snapshot",
            stock::NetworkView::History => "history",
        };
        let source_status = match facet.status {
            // This reports retained-capture freshness, never live presence.
            FacetStatus::Fresh => "current",
            FacetStatus::Stale => "stale",
            FacetStatus::Unavailable | FacetStatus::Revoked => "unavailable",
        };
        let wire = json!({
            "schemaVersion":3, "commandId":request.id().as_str(),
            "requestId":request.request_id(), "resolvedScope":request.context(),
            "status":"read", "replayed":false,
            "data": {"capability":capability, "relations":relations,
                "devices":devices, "sourceStatus":source_status, "readOnly":true},
        });
        self.contracts
            .validate(request.operation().output_schema, &wire)?;
        Ok(stock::OwnerResult {
            wire,
            children: vec![],
        })
    }
}
fn device(row: &QualifiedRecord) -> stock::StockResult<Value> {
    Ok(json!({"source": {
        "sourceInstanceId":row.scope.source_instance_id,
        "collectionId":row.scope.collection_id,
        "sourceKind":row.source_kind, "externalId":row.external_id,
    }, "label":optional_text(&row.value, "name")?,
       "confidence":optional_text(&row.value, "confidence")?}))
}
fn optional_text<'a>(value: &'a Value, key: &str) -> stock::StockResult<Option<&'a str>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        _ => Err(stock::StockError::InvalidContract),
    }
}
fn string<'a>(value: &'a Value, key: &str) -> stock::StockResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(stock::StockError::InvalidContract)
}
fn ensure(valid: bool) -> stock::StockResult<()> {
    if valid {
        Ok(())
    } else {
        Err(stock::StockError::CorrelationMismatch)
    }
}

#[cfg(test)]
#[path = "saved_queries_healthy.rs"]
mod healthy;
