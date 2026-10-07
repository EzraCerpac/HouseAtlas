//! Positive saved-data examples only. Principal/witness/disclosure are explicit
//! fixture peers; native schemas, stock dispatch and Network projection are real.
//! No access issuer/login/grant, Store, transport, listener or held control runs.
use super::*;
use crate::contracts::stock::{StockRequest, StockResponse, StockValidation};
use std::cell::Cell;
use stock::{StockAuthorityPort, StockCommandPort, StockPreparerPort};

const AT: &str = "2026-01-02T12:00:00Z";
const WIRE: &[u8] = include_bytes!("../../../../adapters/network/fixtures/inventory.wire.json");
const REVIEW: &str = include_str!("../../../../adapters/network/fixtures/link-review.json");

struct FixturePrincipal;
struct Witness {
    principal: usize,
    request: Value,
}
struct FixtureAuthority {
    releases: Cell<usize>,
}
impl StockAuthorityPort<FixturePrincipal> for FixtureAuthority {
    type Witness = Witness;
    type Graph = SourceScope;
    fn capture(
        &self,
        principal: &FixturePrincipal,
        request: &stock::ValidatedRequest,
    ) -> stock::StockResult<Witness> {
        Ok(Witness {
            principal: std::ptr::from_ref(principal).addr(),
            request: request.raw().clone(),
        })
    }
    fn authorize_graph(
        &self,
        principal: &FixturePrincipal,
        witness: &Witness,
        request: &stock::ValidatedRequest,
        graph: &SourceScope,
    ) -> stock::StockResult<()> {
        self.revalidate(principal, witness, request)?;
        assert_eq!(graph.workspace_id, request.context().workspace_id);
        assert_eq!(graph.home_id, request.context().home_id);
        assert_eq!(
            graph.source_instance_id,
            request.target()["sourceInstanceId"]
        );
        assert_eq!(graph.collection_id, request.target()["collectionId"]);
        Ok(())
    }
    fn revalidate(
        &self,
        principal: &FixturePrincipal,
        witness: &Witness,
        request: &stock::ValidatedRequest,
    ) -> stock::StockResult<()> {
        assert_eq!(witness.principal, std::ptr::from_ref(principal).addr());
        assert_eq!(witness.request, *request.raw());
        Ok(())
    }
    fn authorize_result(
        &self,
        principal: &FixturePrincipal,
        prepared: &stock::PreparedRequest<Witness, SourceScope>,
        request: &stock::ValidatedRequest,
        result: &Value,
    ) -> stock::StockResult<()> {
        self.authorize_graph(principal, prepared.witness(), request, prepared.graph())?;
        // The actual contract owner checks every typed node and relation and
        // emits current-authority obligations, including an empty result.
        let validation = StockValidation::new().unwrap();
        let checked = StockRequest::parse(&validation, request.raw().clone()).unwrap();
        let output = StockResponse::parse(&validation, &checked, result.clone(), &[]).unwrap();
        assert_eq!(
            output.obligations().len(),
            1 + result["data"]["devices"].as_array().unwrap().len()
                + result["data"]["relations"].as_array().unwrap().len()
        );
        self.releases.set(self.releases.get() + 1);
        Ok(())
    }
    fn disclose(
        &self,
        _: &FixturePrincipal,
        _: &stock::PreparedRequest<Witness, SourceScope>,
        _: &stock::ValidatedRequest,
        _: &Value,
        _: &Value,
        _: stock::DisclosurePurpose,
    ) -> stock::StockResult<()> {
        Ok(())
    }
}
struct FixturePreparer(SourceScope);
impl StockPreparerPort<FixturePrincipal, Witness> for FixturePreparer {
    type Graph = SourceScope;
    fn resolve(
        &mut self,
        _: &FixturePrincipal,
        _: &Witness,
        _: &stock::ValidatedRequest,
    ) -> stock::StockResult<SourceScope> {
        Ok(self.0.clone())
    }
}
struct NoCommands;
impl StockCommandPort<FixturePrincipal, Witness, SourceScope> for NoCommands {
    fn execute(
        &mut self,
        _: &FixturePrincipal,
        _: &stock::PreparedRequest<Witness, SourceScope>,
    ) -> stock::StockResult<stock::OwnerResult> {
        Err(stock::StockError::OwnerUnavailable)
    }
}
fn retained() -> (
    super::super::SourceRegistration,
    super::super::RetainedState,
) {
    let source = super::super::healthy::source();
    let review = serde_json::from_str(REVIEW).unwrap();
    let generation = super::super::project_capture(
        &source,
        super::super::NetworkCapture {
            source: &source.scope,
            document: WIRE,
            retrieved_at: AT,
            source_snapshot_at: None,
        },
        &review,
        super::super::Limits::default(),
    )
    .unwrap();
    let mut state = super::super::RetainedState::empty(source.scope.clone());
    state.cache.status = super::super::CacheStatus::Fresh;
    state.cache.last_attempt_at = Some(AT.into());
    state.cache.last_successful_fetch_at = Some(AT.into());
    state.cache.generation_id = Some("00000000-0000-4000-8000-000000000901".into());
    state.generation = Some(generation);
    (source, state)
}
fn facet(now: &str) -> NetworkFacet {
    let (source, state) = retained();
    super::super::build_facet(&source, &state, now, 300_000).unwrap()
}
fn run(facet: &NetworkFacet, operation: stock::OperationId, resource: Option<&str>) -> Value {
    let contracts = stock::NativeStockContract::new().unwrap();
    let principal = FixturePrincipal;
    let authority = FixtureAuthority {
        releases: Cell::new(0),
    };
    let mut target = json!({"authority":"network", "sourceInstanceId":facet.scope.source_instance_id,
        "collectionId":facet.scope.collection_id});
    if let Some(resource) = resource {
        target["resourceId"] = json!(resource);
    }
    let request = json!({"schemaVersion":3,"commandId":operation.as_str(),
        "requestId":"00000000-0000-4000-8000-000000060007",
        "context":{"workspaceId":facet.scope.workspace_id,"homeId":facet.scope.home_id},
        "target":target,"payload":{}});
    let prepared = stock::prepare(
        &principal,
        request,
        &contracts,
        &authority,
        &mut FixturePreparer(facet.scope.clone()),
    )
    .unwrap();
    let calls = Cell::new(0);
    let reader =
        |original: &FixturePrincipal,
         original_prepared: &stock::PreparedRequest<Witness, SourceScope>| {
            assert!(std::ptr::eq(original, &principal));
            assert!(std::ptr::eq(original_prepared, &prepared));
            assert_eq!(original_prepared.graph(), &facet.scope);
            authority.revalidate(
                original,
                original_prepared.witness(),
                original_prepared.request(),
            )?;
            calls.set(calls.get() + 1);
            Ok(facet.clone())
        };
    let mut queries = SavedNetworkQueries::new(reader, contracts.clone());
    let result = stock::dispatch_prepared(
        &principal,
        &prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut NoCommands,
    )
    .unwrap();
    assert_eq!(calls.get(), 1);
    assert_eq!(authority.releases.get(), 1);
    assert!(result.children.is_empty());
    result.wire
}

#[test]
fn healthy_saved_inventory_snapshot_history_dispatch() {
    let facet = facet(AT);
    for support in &SAVED_NETWORK_QUERY_SUPPORT {
        assert_eq!(support.operation.as_str(), support.agent_operation.as_str());
        let wire = run(&facet, support.operation, None);
        assert_eq!(wire["data"]["readOnly"], true);
        assert_eq!(wire["data"]["sourceStatus"], "current");
        assert_eq!(wire["data"]["devices"].as_array().unwrap().len(), 5);
        let expected = if support.view == stock::NetworkView::History {
            &facet.history
        } else {
            &facet.current_claims
        };
        assert_eq!(
            wire["data"]["relations"],
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(
            wire["data"]["capability"],
            match support.view {
                stock::NetworkView::Inventory => "inventory",
                stock::NetworkView::Snapshot => "snapshot",
                stock::NetworkView::History => "history",
            }
        );
    }
}
#[test]
fn healthy_saved_resource_filter_keeps_typed_source_identity() {
    let facet = facet(AT);
    for (resource, kind, label) in [
        ("device-a", "network-device", "Synthetic endpoint"),
        ("group-a", "network-group", "Synthetic arbitrary group"),
    ] {
        let wire = run(
            &facet,
            stock::OperationId::NetworkInventoryGet,
            Some(resource),
        );
        assert_eq!(wire["data"]["devices"].as_array().unwrap().len(), 1);
        assert_eq!(wire["data"]["devices"][0]["source"]["sourceKind"], kind);
        assert_eq!(wire["data"]["devices"][0]["source"]["externalId"], resource);
        assert_eq!(wire["data"]["devices"][0]["label"], label);
        assert_eq!(wire["data"]["devices"][0]["confidence"], Value::Null);
    }
    let wire = run(
        &facet,
        stock::OperationId::NetworkHistoryGet,
        Some("association-a"),
    );
    assert_eq!(wire["data"]["devices"], json!([]));
    assert_eq!(
        wire["data"]["relations"],
        serde_json::to_value(&facet.history).unwrap()
    );
}
#[test]
fn healthy_saved_stale_snapshot_preserves_dates_and_evidence() {
    let facet = facet("2026-01-02T13:00:00Z");
    let wire = run(&facet, stock::OperationId::NetworkSnapshotGet, None);
    assert_eq!(wire["data"]["sourceStatus"], "stale");
    assert_eq!(
        wire["data"]["relations"],
        serde_json::to_value(&facet.current_claims).unwrap()
    );
    assert_eq!(wire["data"]["relations"][0]["retrievedAt"], AT);
    assert_eq!(
        wire["data"]["relations"][0]["factAt"],
        "2025-12-01T00:00:00Z"
    );
    assert_eq!(
        wire["data"]["relations"][0]["evidenceBasis"],
        "owner-report"
    );
}

#[test]
fn healthy_retained_links_bind_original_members_and_projection() {
    let (source, state) = retained();
    let generation = state.generation.as_ref().unwrap();
    let bindings = super::super::retained_link_bindings(&source, generation).unwrap();
    assert_eq!(bindings.len(), generation.inventory.links.len());
    for (binding, original) in bindings.iter().zip(&generation.inventory.links) {
        assert!(std::ptr::eq(binding.link, original));
        assert_eq!(binding.from.external_id, original.value["from"]);
        assert_eq!(binding.to.external_id, original.value["to"]);
        assert_eq!(binding.from.scope, source.scope);
        assert_eq!(binding.to.scope, source.scope);
        assert!(generation.network_relations.iter().any(|relation| {
            relation.external_id == original.external_id && std::ptr::eq(binding.relation, relation)
        }));
    }
    let gap = bindings
        .iter()
        .find(|row| row.link.external_id == "gap-a")
        .unwrap();
    assert_eq!(gap.from.source_kind, SourceKind::Interface);
    assert_eq!(gap.to.source_kind, SourceKind::Device);
    assert_eq!(gap.to.external_id, "device-b");
    assert_eq!(gap.relation.to.kind, super::super::EndpointKind::Unresolved);
    assert_eq!(gap.relation.to.id, None);
    assert_eq!(gap.relation.to.description.as_deref(), Some("Unknown peer"));
    let membership = bindings
        .iter()
        .find(|row| row.link.external_id == "member-a")
        .unwrap();
    assert_eq!(membership.from.source_kind, SourceKind::Segment);
    assert_eq!(membership.to.source_kind, SourceKind::Interface);
    // Public membership normalizes direction; the private binding does not.
    assert_eq!(membership.relation.from.id.as_deref(), Some("interface-a"));
    assert_eq!(membership.relation.to.id.as_deref(), Some("segment-a"));
}

#[test]
fn healthy_saved_unknown_peer_preserves_partition_and_resolved_links() {
    let facet = facet(AT);
    assert_eq!(facet.status, FacetStatus::Fresh);
    assert_eq!(facet.cache.status, super::super::CacheStatus::Fresh);
    let gap = facet
        .current_claims
        .iter()
        .find(|row| row.external_id == "gap-a")
        .unwrap();
    for operation in [
        stock::OperationId::NetworkInventoryGet,
        stock::OperationId::NetworkSnapshotGet,
    ] {
        let wire = run(&facet, operation, None);
        assert_eq!(wire["data"]["sourceStatus"], "current");
        assert_eq!(
            wire["data"]["relations"],
            serde_json::to_value(&facet.current_claims).unwrap()
        );
        assert_eq!(wire["data"]["relations"].as_array().unwrap().len(), 3);
        let selected = run(&facet, operation, Some("gap-a"));
        assert_eq!(selected["data"]["devices"], json!([]));
        assert_eq!(selected["data"]["relations"], json!([gap]));
        assert_eq!(
            selected["data"]["relations"][0]["to"],
            json!({"kind":"unresolved","id":null,"description":"Unknown peer"})
        );
    }
    let history = run(&facet, stock::OperationId::NetworkHistoryGet, None);
    assert_eq!(
        history["data"]["relations"],
        serde_json::to_value(&facet.history).unwrap()
    );
    assert_eq!(history["data"]["sourceStatus"], "current");
}
