//! Positive, offline source-observation examples. The synthetic authority
//! recognizes only exact captured target and relationship facts.
use super::super::{SourceScope, Timestamp, Uuid};
use super::*;
use crate::{
    contracts::stock::{HomeboxResourceKind, StockTarget},
    domain::stock::{self as st, OperationId as Op},
    providers::homebox::wire,
};
use serde_json::{Value, json};
use std::{cell::Cell, collections::BTreeSet};

fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn uuid(n: u64) -> Uuid {
    Uuid::parse(&id(n)).unwrap()
}
fn at() -> Timestamp {
    Timestamp::parse("2026-10-07T12:34:56.1200+02:00").unwrap()
}
fn scope() -> SourceScope {
    SourceScope {
        workspace_id: uuid(1),
        home_id: uuid(2),
        source_instance_id: uuid(3),
        collection_id: id(4),
    }
}
fn request(op: Op, resource: Option<u64>, owner: Option<u64>) -> Value {
    let mut target = json!({"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":op.operation().resource_kind});
    if let Some(n) = resource {
        target["resourceId"] = json!(id(n));
    }
    if let Some(n) = owner {
        target["entityId"] = json!(id(n));
    }
    let payload = if resource.is_some() {
        json!({})
    } else {
        json!({"cursor":null,"pageSize":100,"includeArchived":true})
    };
    json!({"schemaVersion":3,"commandId":op.as_str(),"requestId":id(100),"context":{"workspaceId":id(1),"homeId":id(2)},"target":target,"payload":payload})
}
fn target(kind: HomeboxResourceKind, n: u64, owner: Option<u64>) -> StockTarget {
    StockTarget::Homebox {
        source_instance_id: id(3),
        collection_id: id(4),
        resource_kind: kind,
        entity_id: owner.map(id),
        resource_id: Some(id(n)),
    }
}

struct Principal;
struct Witness<'a> {
    principal: &'a Principal,
    original: Value,
}
#[derive(Clone)]
struct Graph {
    original: Value,
    targets: Vec<StockTarget>,
    edges: Vec<(StockTarget, StockTarget)>,
}
struct Authority<'a> {
    principal: &'a Principal,
    graph: Graph,
    released: Cell<usize>,
    disclosed: Cell<usize>,
}
impl<'a> st::StockAuthorityPort<Principal> for Authority<'a> {
    type Witness = Witness<'a>;
    type Graph = Graph;
    fn capture(&self, p: &Principal, r: &st::ValidatedRequest) -> st::StockResult<Self::Witness> {
        assert!(std::ptr::eq(p, self.principal));
        assert_eq!(r.raw(), &self.graph.original);
        Ok(Witness {
            principal: self.principal,
            original: r.raw().clone(),
        })
    }
    fn authorize_graph(
        &self,
        p: &Principal,
        w: &Self::Witness,
        r: &st::ValidatedRequest,
        g: &Graph,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, w.principal));
        assert_eq!(w.original, *r.raw());
        assert_eq!(g.original, *r.raw());
        assert_eq!(g.targets, self.graph.targets);
        assert_eq!(g.edges, self.graph.edges);
        Ok(())
    }
    fn revalidate(
        &self,
        p: &Principal,
        w: &Self::Witness,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, w.principal));
        assert_eq!(w.original, *r.raw());
        Ok(())
    }
    fn authorize_result(
        &self,
        p: &Principal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        r: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, prepared.witness().principal));
        assert_eq!(r.raw(), &prepared.graph().original);
        if let Some(rows) = result["data"]["resources"].as_array() {
            for row in rows {
                let t: StockTarget = serde_json::from_value(row["target"].clone()).unwrap();
                assert!(
                    prepared.graph().targets.contains(&t),
                    "unresolved output target: {t:?}"
                );
                if let Some(parent) = row["data"]["parentId"].as_str() {
                    let kind = match &t {
                        StockTarget::Homebox {
                            resource_kind: HomeboxResourceKind::Tag,
                            ..
                        } => HomeboxResourceKind::Tag,
                        _ => HomeboxResourceKind::Entity,
                    };
                    let n = parent.rsplit('-').next().unwrap().parse::<u64>().unwrap();
                    assert!(
                        prepared
                            .graph()
                            .edges
                            .contains(&(t.clone(), target(kind, n, None)))
                    );
                }
            }
        }
        self.released.set(self.released.get() + 1);
        Ok(())
    }
    fn disclose(
        &self,
        p: &Principal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        _: &st::ValidatedRequest,
        t: &Value,
        _: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, prepared.witness().principal));
        let t: StockTarget = serde_json::from_value(t.clone()).unwrap();
        assert!(
            prepared.graph().targets.contains(&t),
            "undisclosed target {t:?}"
        );
        if purpose == st::DisclosurePurpose::AncestorPath {
            assert!(
                prepared
                    .graph()
                    .edges
                    .iter()
                    .any(|(child, parent)| child == &t || parent == &t)
            );
        }
        self.disclosed.set(self.disclosed.get() + 1);
        Ok(())
    }
}
struct Preparer {
    graph: Graph,
}
impl st::StockPreparerPort<Principal, Witness<'_>> for Preparer {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &Principal,
        w: &Witness<'_>,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        assert!(std::ptr::eq(p, w.principal));
        assert_eq!(w.original, *r.raw());
        Ok(self.graph.clone())
    }
}
struct NoCommands;
impl st::StockCommandPort<Principal, Witness<'_>, Graph> for NoCommands {
    fn execute(
        &mut self,
        _: &Principal,
        _: &st::PreparedRequest<Witness<'_>, Graph>,
    ) -> st::StockResult<st::OwnerResult> {
        unreachable!()
    }
}
struct NoHistory;
impl st::StockHistoryPort<Principal> for NoHistory {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        _: &Principal,
        _: &C,
        _: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        unreachable!()
    }
}
enum Source<'a> {
    Detail(&'a wire::Decoded<wire::Detail>),
    Maintenance(&'a wire::Decoded<wire::MaintenanceLog>),
    Native(&'a [u8]),
}
fn run(
    raw: Value,
    source: Source<'_>,
    expected: Vec<StockTarget>,
    edges: Vec<(StockTarget, StockTarget)>,
) -> Value {
    let principal = Principal;
    let graph = Graph {
        original: raw.clone(),
        targets: expected,
        edges,
    };
    let authority = Authority {
        principal: &principal,
        graph: graph.clone(),
        released: Cell::new(0),
        disclosed: Cell::new(0),
    };
    let contracts = st::NativeStockContract::new().unwrap();
    let mut preparer = Preparer { graph };
    let prepared = st::prepare(
        &principal,
        raw.clone(),
        &contracts,
        &authority,
        &mut preparer,
    )
    .unwrap();
    assert_eq!(prepared.request().raw(), &raw);
    let observation = match source {
        Source::Detail(d) => DecodedReadObservation::from_detail(
            &contracts,
            prepared.request(),
            &scope(),
            d,
            &at(),
            SourceStatus::Stale,
        ),
        Source::Maintenance(d) => DecodedReadObservation::from_maintenance(
            &contracts,
            prepared.request(),
            &scope(),
            d,
            &at(),
            SourceStatus::Stale,
        ),
        Source::Native(bytes) => DecodedReadObservation::from_native(
            &contracts,
            prepared.request(),
            &scope(),
            bytes,
            &at(),
            SourceStatus::Stale,
            wire::DecodeLimits::default(),
        ),
    }
    .unwrap();
    assert_eq!(observation.original_request(), &raw);
    for t in observation.references() {
        assert!(
            preparer.graph.targets.contains(t),
            "missing graph reference {t:?}"
        );
    }
    for edge in observation.parent_relations() {
        assert!(preparer.graph.edges.contains(edge));
    }
    if let Some(path) = observation.ordered_path() {
        for pair in path.windows(2) {
            assert!(
                preparer
                    .graph
                    .edges
                    .contains(&(pair[1].clone(), pair[0].clone()))
            );
        }
        assert_eq!(
            serde_json::to_value(path.last().unwrap()).unwrap(),
            raw["target"]
        );
    }
    let mut owner = DecodedReadOwner::bind(&principal, &prepared, observation).unwrap();
    let mut history = NoHistory;
    let mut queries = HomeBoxQueries::new(&contracts, &mut owner, &mut history);
    let output = st::dispatch_prepared(
        &principal,
        &prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut NoCommands,
    )
    .unwrap()
    .wire;
    assert_eq!(authority.released.get(), 1);
    assert_eq!(prepared.request().raw(), &raw);
    assert_eq!(
        output["retrievedAt"]
            .as_str()
            .or_else(|| output["data"]["resources"][0]["retrievedAt"].as_str()),
        Some(at().as_str())
    );
    output
}
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}

#[test]
fn healthy_decoded_detail_and_maintenance_resources() {
    let mut detail: Value =
        serde_json::from_str(include_str!("../../wire/fixtures/item.detail.json")).unwrap();
    detail["id"] = json!(id(5));
    detail["assetId"] = json!("00012");
    detail["tags"] = json!([{"id":id(60),"name":"Scoped tag"}]);
    detail["fields"] = json!([
        {"id":id(61),"name":"Text","type":"text","textValue":"A"},
        {"id":id(62),"name":"Number","type":"number","numberValue":9007199254740991_i64},
        {"id":id(63),"name":"Boolean","type":"boolean","booleanValue":true},
        {"id":id(64),"name":"Time","type":"time"}
    ]);
    let original = bytes(&detail);
    let decoded = wire::decode_detail(&original, &uuid(5), wire::DecodeLimits::default()).unwrap();
    let entity = target(HomeboxResourceKind::Entity, 5, None);
    let fields = (61..=64)
        .map(|n| target(HomeboxResourceKind::Field, n, Some(5)))
        .collect::<Vec<_>>();
    let link = target(HomeboxResourceKind::Attachment, 202, Some(5));
    let mut graph = vec![entity.clone(), target(HomeboxResourceKind::Tag, 60, None)];
    graph.extend(fields.clone());
    graph.push(link.clone());
    let mut lookup = request(Op::HomeboxQueryRead, None, None);
    lookup["payload"] = json!({"view":"asset-lookup","assetId":"00012","limit":10});
    let mut lookup_graph = graph.clone();
    lookup_graph.push(target(HomeboxResourceKind::Entity, 1, None));
    lookup_graph.push(target(HomeboxResourceKind::EntityType, 102, None));
    let lookup = run(lookup, Source::Detail(&decoded), lookup_graph, vec![]);
    assert_eq!(lookup["data"]["kind"], "asset-lookup");
    assert_eq!(lookup["data"]["rows"][0]["target"]["resourceId"], id(5));
    let tags = run(
        request(Op::HomeboxEntityTagsGet, Some(5), None),
        Source::Detail(&decoded),
        graph.clone(),
        vec![],
    );
    assert_eq!(
        tags["data"]["resources"][0]["data"]["tagIds"],
        json!([id(60)])
    );
    let listed = run(
        request(Op::HomeboxFieldList, None, Some(5)),
        Source::Detail(&decoded),
        graph.clone(),
        vec![],
    );
    assert_eq!(listed["data"]["resources"].as_array().unwrap().len(), 4);
    assert_eq!(
        listed["data"]["resources"][1]["data"]["value"]["value"],
        json!(9007199254740991_i64)
    );
    assert_eq!(
        listed["data"]["resources"][3]["data"]["value"]["reason"],
        "baseline-time-value-unexposed"
    );
    assert_eq!(listed["data"]["nextCursor"], Value::Null);
    for n in 61..=64 {
        let got = run(
            request(Op::HomeboxFieldGet, Some(n), Some(5)),
            Source::Detail(&decoded),
            graph.clone(),
            vec![],
        );
        assert_eq!(got["data"]["resources"][0]["target"]["resourceId"], id(n));
    }
    let links = run(
        request(Op::HomeboxDocumentLinkList, None, Some(5)),
        Source::Detail(&decoded),
        graph.clone(),
        vec![],
    );
    assert_eq!(
        links["data"]["resources"][0]["data"]["storage"],
        "external-link"
    );
    assert_eq!(
        links["data"]["resources"][0]["data"]["url"],
        "https://example.invalid/manual?q=%2f"
    );
    let got = run(
        request(Op::HomeboxDocumentLinkGet, Some(202), Some(5)),
        Source::Detail(&decoded),
        graph,
        vec![],
    );
    assert_eq!(got["data"]["resources"][0]["target"]["resourceId"], id(202));
    assert_eq!(decoded.original, original);

    let maintenance = json!([{"id":id(71),"name":"Check","description":"Calendar","completedDate":"","scheduledDate":"2026-02-01","cost":"12.50","itemID":id(5),"itemName":"Item"}]);
    let original = bytes(&maintenance);
    let decoded =
        wire::decode_maintenance(&original, &uuid(5), wire::DecodeLimits::default()).unwrap();
    let graph = vec![
        entity,
        target(HomeboxResourceKind::Maintenance, 71, Some(5)),
    ];
    let list = run(
        request(Op::HomeboxMaintenanceList, None, Some(5)),
        Source::Maintenance(&decoded),
        graph.clone(),
        vec![],
    );
    let row = &list["data"]["resources"][0]["data"];
    assert_eq!(row["cost"], "12.50");
    assert_eq!(row["scheduledDate"], "2026-02-01");
    assert_eq!(row["completedDate"], Value::Null);
    let get = run(
        request(Op::HomeboxMaintenanceGet, Some(71), Some(5)),
        Source::Maintenance(&decoded),
        graph,
        vec![],
    );
    assert_eq!(get["data"]["resources"][0]["data"]["cost"], "12.50");
    assert_eq!(decoded.original, original);
}

#[test]
fn healthy_decoded_native_resource_graphs() {
    let tag_root = target(HomeboxResourceKind::Tag, 60, None);
    let tag_child = target(HomeboxResourceKind::Tag, 61, None);
    let tags = json!([{"id":id(60),"name":"Root","parentId":null},{"id":id(61),"name":"Child","parentId":id(60)}]);
    let graph = vec![tag_root.clone(), tag_child.clone()];
    let edges = vec![(tag_child.clone(), tag_root.clone())];
    let listed = run(
        request(Op::HomeboxTagList, None, None),
        Source::Native(&bytes(&tags)),
        graph.clone(),
        edges.clone(),
    );
    assert_eq!(
        listed["data"]["resources"][0]["data"]["parentId"],
        Value::Null
    );
    assert_eq!(listed["data"]["resources"][1]["data"]["parentId"], id(60));
    let got = run(
        request(Op::HomeboxTagGet, Some(61), None),
        Source::Native(&bytes(&tags[1])),
        graph,
        edges,
    );
    assert_eq!(got["data"]["resources"][0]["data"]["parentId"], id(60));

    let entity_type = target(HomeboxResourceKind::EntityType, 70, None);
    let type_source = json!([{"id":id(70),"name":"Container","icon":"box","isLocation":true,"defaultTemplateId":null}]);
    let types = run(
        request(Op::HomeboxEntityTypeList, None, None),
        Source::Native(&bytes(&type_source)),
        vec![entity_type],
        vec![],
    );
    assert_eq!(
        types["data"]["resources"][0]["data"]["defaultTemplateId"],
        Value::Null
    );

    let template = target(HomeboxResourceKind::Template, 80, None);
    let location = target(HomeboxResourceKind::Entity, 81, None);
    let source = json!({"id":id(80),"name":"Known refs","fields":[{"id":id(82),"name":"When","type":"time","timeValue":"2026-01-02T03:04:05.1200+02:00"}],"defaultLocation":{"id":id(81)},"defaultTags":[{"id":id(60)}],"includePurchaseFields":true,"includeSoldFields":false,"includeWarrantyFields":true});
    let output = run(
        request(Op::HomeboxTemplateGet, Some(80), None),
        Source::Native(&bytes(&source)),
        vec![template, location, tag_root],
        vec![],
    );
    let data = &output["data"]["resources"][0]["data"];
    assert_eq!(
        data["fields"][0]["value"]["value"],
        "2026-01-02T03:04:05.1200+02:00"
    );
    assert_eq!(data["includePurchaseDetails"], true);
    assert_eq!(data["includeSoldDetails"], false);
    assert_eq!(data["defaultLocation"]["resourceId"], id(81));

    let a = target(HomeboxResourceKind::Entity, 91, None);
    let b = target(HomeboxResourceKind::Entity, 92, None);
    let c = target(HomeboxResourceKind::Entity, 93, None);
    let edges = vec![(b.clone(), a.clone()), (c.clone(), b.clone())];
    let graph = vec![a.clone(), b.clone(), c.clone()];
    let path = json!([{"id":id(91),"name":"Root"},{"id":id(92),"name":"Room"},{"id":id(93),"name":"Item"}]);
    let output = run(
        request(Op::HomeboxEntityPath, Some(93), None),
        Source::Native(&bytes(&path)),
        graph.clone(),
        edges.clone(),
    );
    assert_eq!(output["data"]["resources"].as_array().unwrap().len(), 3);
    let tree = json!([{"id":id(91),"name":"Root","children":[{"id":id(92),"name":"Room","children":[{"id":id(93),"name":"Shelf","children":null}]}]}]);
    let output = run(
        request(Op::HomeboxLocationTree, None, None),
        Source::Native(&bytes(&tree)),
        graph,
        edges,
    );
    assert_eq!(output["data"]["resources"][2]["data"]["parentId"], id(92));
}

#[test]
fn healthy_decoded_native_query_metadata() {
    let cases = [
        (
            "currency",
            json!({"code":"EUR","decimals":2,"name":"Euro","symbol":"€","local":"nl-NL"}),
        ),
        (
            "statistics",
            json!({"totalItemPrice":123.00,"totalItems":1,"totalLocations":2,"totalTags":3,"totalUsers":1,"totalWithWarranty":0}),
        ),
        (
            "statistics-locations",
            json!([{"id":id(91),"name":"Room","total":1}]),
        ),
        (
            "statistics-tags",
            json!([{"id":id(60),"name":"Tag","total":1}]),
        ),
        (
            "statistics-purchase-price",
            json!({"start":"2026-01-01T00:00:00Z","end":"2026-02-01T00:00:00Z","valueAtStart":0,"valueAtEnd":123,"entries":[{"date":"2026-02-01T00:00:00Z","value":123}]}),
        ),
        (
            "barcode-product",
            json!([{"barcode":"00000000000001","manufacturer":"","modelNumber":"","notes":"","search_engine_name":"Catalog"}]),
        ),
    ];
    let mut seen = BTreeSet::new();
    for (view, source) in cases {
        let mut raw = request(Op::HomeboxQueryRead, None, None);
        raw["payload"] = if view == "barcode-product" {
            json!({"view":view,"limit":10,"barcode":"00000000000001"})
        } else {
            json!({"view":view,"limit":10})
        };
        if view == "statistics-purchase-price" {
            raw["payload"]["start"] = json!("2026-01-01");
            raw["payload"]["end"] = json!("2026-02-01");
        }
        let refs = match view {
            "statistics-locations" => vec![target(HomeboxResourceKind::Entity, 91, None)],
            "statistics-tags" => vec![target(HomeboxResourceKind::Tag, 60, None)],
            _ => vec![],
        };
        let original = bytes(&source);
        let output = run(raw, Source::Native(&original), refs, vec![]);
        assert_eq!(output["data"]["kind"], view);
        assert!(output["data"]["rows"].as_array().map(Vec::len).unwrap_or(0) <= 10);
        assert_eq!(output["retrievedAt"], at().as_str());
        seen.insert(view);
    }
    assert_eq!(seen.len(), 6);
    let mut raw = request(Op::HomeboxQueryRead, None, None);
    raw["payload"] = json!({"view":"statistics-purchase-price","limit":10,"start":"2026-01-01","end":"2026-02-01"});
    let numeric=b"{\"start\":\"2026-01-01T00:00:00Z\",\"end\":\"2026-02-01T00:00:00Z\",\"valueAtStart\":9007199254740991,\"valueAtEnd\":1.2300e+2,\"entries\":[]}";
    let out = run(raw, Source::Native(numeric), vec![], vec![]);
    assert_eq!(out["data"]["valueAtStart"], json!(9007199254740991_i64));
    assert_eq!(
        out["data"]["valueAtEnd"].as_number().unwrap().to_string(),
        "1.2300e+2"
    );
}
