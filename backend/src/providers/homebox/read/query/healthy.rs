//! Ordinary positive offline fixtures. These authority/observation/artifact peers
//! are explicitly synthetic and prove no production grant or provider capability.
use super::super::{self as read, Timestamp, Uuid};
use super::*;
use crate::domain::stock::{self as st, OperationId as Op};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    collections::{BTreeSet, VecDeque},
};
const NOW: &str = "2026-10-07T10:00:00.000Z";
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn uuid(n: u64) -> Uuid {
    Uuid::parse(&id(n)).unwrap()
}
fn time() -> Timestamp {
    Timestamp::parse(NOW).unwrap()
}

struct Principal;
struct Witness<'a> {
    principal: &'a Principal,
    request: Value,
}
struct FixtureAuthority<'a> {
    principal: &'a Principal,
    releases: Cell<usize>,
    disclosures: Cell<usize>,
}
impl<'a> st::StockAuthorityPort<Principal> for FixtureAuthority<'a> {
    type Witness = Witness<'a>;
    type Graph = Value;
    fn capture(&self, p: &Principal, r: &st::ValidatedRequest) -> st::StockResult<Witness<'a>> {
        assert!(std::ptr::eq(p, self.principal));
        Ok(Witness {
            principal: self.principal,
            request: r.raw().clone(),
        })
    }
    fn authorize_graph(
        &self,
        p: &Principal,
        w: &Witness<'a>,
        r: &st::ValidatedRequest,
        g: &Value,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, w.principal));
        assert_eq!(w.request, *r.raw());
        assert_eq!(*g, *r.raw());
        Ok(())
    }
    fn revalidate(
        &self,
        p: &Principal,
        w: &Witness<'a>,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, w.principal));
        assert_eq!(w.request, *r.raw());
        Ok(())
    }
    fn authorize_result(
        &self,
        p: &Principal,
        prepared: &st::PreparedRequest<Witness<'a>, Value>,
        r: &st::ValidatedRequest,
        _: &Value,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, prepared.witness().principal));
        assert_eq!(r.raw(), prepared.graph());
        self.releases.set(self.releases.get() + 1);
        Ok(())
    }
    fn disclose(
        &self,
        p: &Principal,
        prepared: &st::PreparedRequest<Witness<'a>, Value>,
        _: &st::ValidatedRequest,
        _: &Value,
        _: &Value,
        _: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, prepared.witness().principal));
        self.disclosures.set(self.disclosures.get() + 1);
        Ok(())
    }
}
struct Preparer;
impl st::StockPreparerPort<Principal, Witness<'_>> for Preparer {
    type Graph = Value;
    fn resolve(
        &mut self,
        p: &Principal,
        w: &Witness<'_>,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<Value> {
        assert!(std::ptr::eq(p, w.principal));
        Ok(r.raw().clone())
    }
}
struct NoCommands;
impl st::StockCommandPort<Principal, Witness<'_>, Value> for NoCommands {
    fn execute(
        &mut self,
        _: &Principal,
        _: &st::PreparedRequest<Witness<'_>, Value>,
    ) -> st::StockResult<st::OwnerResult> {
        unreachable!("positive read examples have no write owner")
    }
}
fn request(op: Op) -> Value {
    let get = matches!(
        op,
        Op::HomeboxEntityGet
            | Op::HomeboxLocationGet
            | Op::HomeboxEntityPath
            | Op::HomeboxTagGet
            | Op::HomeboxEntityTagsGet
            | Op::HomeboxFieldGet
            | Op::HomeboxFileGet
            | Op::HomeboxFileDownload
            | Op::HomeboxDocumentLinkGet
            | Op::HomeboxMaintenanceGet
            | Op::HomeboxTemplateGet
            | Op::HomeboxEntityMediatedHistory
            | Op::HomeboxLocationMediatedHistory
    );
    let mut target = json!({"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":op.operation().resource_kind});
    if get {
        target["resourceId"] = json!(id(50));
    }
    if matches!(
        op,
        Op::HomeboxFieldList
            | Op::HomeboxFieldGet
            | Op::HomeboxFileList
            | Op::HomeboxFileGet
            | Op::HomeboxFileDownload
            | Op::HomeboxDocumentLinkList
            | Op::HomeboxDocumentLinkGet
            | Op::HomeboxMaintenanceList
            | Op::HomeboxMaintenanceGet
    ) {
        target["entityId"] = json!(id(5));
    }
    let page = !get
        || matches!(
            op,
            Op::HomeboxEntityMediatedHistory | Op::HomeboxLocationMediatedHistory
        );
    let payload = if page {
        json!({"cursor":null,"pageSize":10,"includeArchived":true})
    } else {
        json!({})
    };
    let mut r = json!({"schemaVersion":3,"commandId":op.as_str(),"requestId":id(100),"context":{"workspaceId":id(1),"homeId":id(2)},"target":target,"payload":payload});
    match op {
        Op::HomeboxExportCreate => {
            r["payload"] = json!({"format":"inventory-csv","maxRows":10,"maxBytes":1024})
        }
        Op::HomeboxQueryRead => r["payload"] = json!({"view":"currency","limit":10}),
        Op::HomeboxQrcodeRender => {
            r["payload"] = json!({"content":"bounded synthetic content","maxBytes":1024})
        }
        Op::HomeboxLabelOutput => {
            r["payload"] =
                json!({"subject":"item","delivery":"render","resourceId":id(50),"maxBytes":1024});
            r["idempotencyKey"] = json!(id(200));
            r["reason"] = json!("Synthetic offline render");
            r["preconditions"] = Value::Null;
            r["approvalReceiptId"] = Value::Null;
        }
        _ => (),
    }
    r
}
struct FixtureReads {
    calls: usize,
}
impl st::StockHistoryPort<Principal> for FixtureReads {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        _: &Principal,
        c: &C,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        self.calls += 1;
        let wire = json!({"schemaVersion":3,"commandId":r.id().as_str(),"requestId":r.request_id(),"resolvedScope":r.context(),"status":"read","replayed":false,"data":{"entries":[{"eventId":id(70),"commandId":"homebox.entity.update","at":NOW,"actorId":id(80),"requestDigest":"a".repeat(64),"state":"observed","target":r.target()}],"nextCursor":"synthetic-original-history-cursor","completeness":"atlas-mediated-only","coverage":"atlas-mediated-only"}});
        c.validate(r.operation().output_schema, &wire)?;
        Ok(st::OwnerResult {
            wire,
            children: vec![],
        })
    }
}
fn resource_data(r: &st::ValidatedRequest) -> Value {
    match r.operation().result_resource_kind {
        "entity" => json!({"name":"Synthetic entity","retrievedAt":NOW}),
        "tag" => json!({"name":"Synthetic tag","parentId":null}),
        "field" => {
            json!({"name":"Synthetic field","value":{"kind":"time","valueState":"unavailable","reason":"baseline-time-value-unexposed"}})
        }
        "attachment" => {
            json!({"title":"Synthetic file or link","type":"manual","primary":false,"storage":if r.id().as_str().contains("document-link") {"external-link"} else {"stored"},"url":if r.id().as_str().contains("document-link") {json!("https://example.invalid/manual?q=%2f")}else{Value::Null},"archived":false,"sha256":null,"byteSize":null})
        }
        "maintenance" => {
            json!({"name":"Calendar maintenance","scheduledDate":"2026-02-01","completedDate":null})
        }
        "entity-type" => {
            json!({"name":"Arbitrary container","icon":"","isLocation":false,"defaultTemplateId":null})
        }
        "template" => json!({"name":"Synthetic template","fields":[]}),
        _ => unreachable!(),
    }
}
fn query_data(feature: &FeatureQuery) -> Value {
    match feature.expected_kind() {
        "currency" => {
            json!({"kind":"currency","currency":{"code":"EUR","decimals":2,"name":"Euro","symbol":"€","local":"nl-NL"}})
        }
        "statistics" => {
            json!({"kind":"statistics","statistics":{"totalItemPrice":12.5,"totalItems":0,"totalLocations":0,"totalTags":0,"totalUsers":0,"totalWithWarranty":0}})
        }
        "statistics-locations" | "statistics-tags" => {
            json!({"kind":feature.expected_kind(),"rows":[{"id":id(50),"name":"Synthetic scoped aggregate","total":0}]})
        }
        "statistics-purchase-price" => {
            json!({"kind":"statistics-purchase-price","start":"2026-01-01T00:00:00Z","end":"2026-02-01T00:00:00Z","valueAtStart":0,"valueAtEnd":12.5,"entries":[{"date":"2026-02-01T00:00:00Z","value":12.5}]})
        }
        "maintenance" => {
            json!({"kind":"maintenance","rows":[{"target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":"maintenance","entityId":id(5),"resourceId":id(50)},"name":"Existing datetime-compatible fixture","description":"Unknown dates stay unknown","scheduledDate":null,"completedDate":null,"cost":"12.50"}]})
        }
        "barcode-product" => {
            json!({"kind":"barcode-product","rows":[{"barcode":"00000000000001","manufacturer":"","modelNumber":"","notes":"","sourceName":"Synthetic lookup","imageToken":null}]})
        }
        "asset-lookup" => {
            json!({"kind":"asset-lookup","rows":[{"target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":"entity","resourceId":id(50)},"observation":{"kind":"observation-only","digest":"b".repeat(64)},"data":{"retrievedAt":NOW},"retrievedAt":NOW}]})
        }
        _ => unreachable!(),
    }
}
impl HomeBoxReadOwner<Principal, Witness<'_>, Value> for FixtureReads {
    fn read(
        &mut self,
        p: &Principal,
        prepared: &st::PreparedRequest<Witness<'_>, Value>,
        q: &HomeBoxReadQuery,
    ) -> st::StockResult<HomeBoxReadResult> {
        assert!(std::ptr::eq(p, prepared.witness().principal));
        assert_eq!(prepared.graph(), prepared.request().raw());
        self.calls += 1;
        Ok(match q.selection() {
            ReadSelection::Resources { .. } => {
                let mut target = prepared.request().target().clone();
                if target.get("resourceId").is_none() {
                    target["resourceId"] = json!(id(50));
                }
                let data = resource_data(prepared.request());
                HomeBoxReadResult::Resources(ResourcePage {
                    scope: q.scope().clone(),
                    resources: vec![ResourceView {
                        target: serde_json::from_value(target).unwrap(),
                        observation: ReadObservation::ObservationOnly {
                            digest: "b".repeat(64),
                        },
                        data,
                        retrieved_at: time(),
                    }],
                    next_cursor: None,
                    source_status: SourceStatus::Stale,
                })
            }
            ReadSelection::Download => HomeBoxReadResult::Download(FileDownload {
                scope: q.scope().clone(),
                target: q.target().clone(),
                download_token: uuid(60),
                sha256: None,
                byte_size: 42,
                content_type: "application/pdf".into(),
            }),
            ReadSelection::Feature(feature) => HomeBoxReadResult::Feature(FeatureRead {
                scope: q.scope().clone(),
                retrieved_at: time(),
                data: if matches!(feature, FeatureQuery::Query { .. }) {
                    FeatureData::Query(query_data(feature))
                } else {
                    if matches!(feature, FeatureQuery::Label { .. }) {
                        assert_eq!(feature.label_print_query(), Some(("print", "false")));
                    }
                    FeatureData::Artifact(ReadArtifact {
                        download_token: uuid(60),
                        sha256: "c".repeat(64),
                        byte_size: 42,
                        content_type: if matches!(feature, FeatureQuery::Export { .. }) {
                            "text/csv"
                        } else {
                            "image/png"
                        }
                        .into(),
                        expires_at: Timestamp::parse("2026-10-07T11:00:00Z").unwrap(),
                    })
                },
            }),
            ReadSelection::MediatedHistory => unreachable!(),
        })
    }
}
fn run(
    raw: Value,
    reads: &mut impl for<'a> HomeBoxReadOwner<Principal, Witness<'a>, Value>,
) -> Value {
    let principal = Principal;
    let authority = FixtureAuthority {
        principal: &principal,
        releases: Cell::new(0),
        disclosures: Cell::new(0),
    };
    let contracts = st::NativeStockContract::new().unwrap();
    let prepared = st::prepare(
        &principal,
        raw.clone(),
        &contracts,
        &authority,
        &mut Preparer,
    )
    .unwrap();
    assert_eq!(prepared.request().raw(), &raw);
    let mut history = FixtureReads { calls: 0 };
    let mut queries = HomeBoxQueries::new(&contracts, reads, &mut history);
    let result = st::dispatch_prepared(
        &principal,
        &prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut NoCommands,
    )
    .unwrap();
    assert_eq!(authority.releases.get(), 1);
    assert_eq!(prepared.request().raw(), &raw);
    result.wire
}
#[test]
fn healthy_exact_catalog_and_all_required_read_selections() {
    let ids: BTreeSet<_> = REQUIRED_READ_OPERATIONS
        .iter()
        .map(|o| o.as_str())
        .collect();
    assert_eq!(ids.len(), 28);
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../../../../contracts/stock-wire3/agent/operation-catalog.json"
    ))
    .unwrap();
    let expected: BTreeSet<_> = catalog["commands"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| {
            o["commandId"].as_str().unwrap().starts_with("homebox.")
                && o["firstReleaseRequired"] == true
                && o["effect"] == "read"
        })
        .map(|o| o["commandId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, expected);
    let exclusions: Vec<_> = catalog["commands"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["firstReleaseRequired"] == false)
        .collect();
    assert_eq!(exclusions.len(), 14); // Static catalog inspection; no exclusion is invoked.
    let mut reads = FixtureReads { calls: 0 };
    for op in REQUIRED_READ_OPERATIONS {
        let result = run(request(op), &mut reads);
        assert_eq!(result["commandId"], op.as_str());
        if op == Op::HomeboxFileDownload {
            assert_eq!(result["data"]["disposition"], "attachment");
        }
        if matches!(
            op,
            Op::HomeboxEntityMediatedHistory | Op::HomeboxLocationMediatedHistory
        ) {
            assert_eq!(
                result["data"]["nextCursor"],
                "synthetic-original-history-cursor"
            );
        }
    }
    assert_eq!(reads.calls, 26); // Two histories use the distinct actual history interface.
}
#[test]
fn healthy_feature_variants_render_and_payload_representation() {
    let mut reads = FixtureReads { calls: 0 };
    for subject in ["asset", "item", "location"] {
        let mut raw = request(Op::HomeboxLabelOutput);
        raw["payload"]["subject"] = json!(subject);
        if subject == "asset" {
            raw["payload"].as_object_mut().unwrap().remove("resourceId");
            raw["payload"]["assetId"] = json!("00012");
        }
        let result = run(raw, &mut reads);
        assert_eq!(result["data"]["kind"], "label-image");
        assert!(result.get("replayed").is_none());
    }
    for view in [
        "asset-lookup",
        "currency",
        "statistics",
        "statistics-locations",
        "statistics-tags",
        "statistics-purchase-price",
        "maintenance",
        "barcode-product",
    ] {
        let mut raw = request(Op::HomeboxQueryRead);
        raw["payload"] = json!({"view":view,"limit":10.0});
        match view {
            "asset-lookup" => raw["payload"]["assetId"] = json!("00012"),
            "statistics-purchase-price" => {
                raw["payload"]["start"] = json!("2026-01-01");
                raw["payload"]["end"] = json!("2026-02-01");
            }
            "maintenance" => raw["payload"]["status"] = json!("both"),
            "barcode-product" => raw["payload"]["barcode"] = json!("00000000000001"),
            _ => (),
        }
        let result = run(raw, &mut reads);
        assert_eq!(result["data"]["kind"], view);
    }
    let mut raw = request(Op::HomeboxExportCreate);
    raw["payload"]["format"] = json!("bill-of-materials-csv");
    assert_eq!(
        run(raw, &mut reads)["data"]["kind"],
        "bill-of-materials-csv"
    );
    // Exact opaque request cursor/q and integral JSON spelling reach the owner.
    let mut raw = request(Op::HomeboxTagList);
    raw["payload"]["cursor"] = json!("synthetic/Σ/original-cursor");
    raw["payload"]["q"] = json!("");
    raw["payload"]["pageSize"] = json!(10.0);
    let result = run(raw, &mut reads);
    assert_eq!(result["data"]["sourceStatus"], "stale");
}

struct FixtureClock;
impl read::Clock for FixtureClock {
    fn now(&self) -> Timestamp {
        time()
    }
}
struct Chunks(VecDeque<Vec<u8>>);
impl read::Body for Chunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, read::ReadError> {
        Ok(self.0.pop_front())
    }
}
struct StockFixtureTransport {
    scope: read::SourceScope,
}
impl read::Transport for StockFixtureTransport {
    type Body = Chunks;
    async fn get(
        &mut self,
        r: read::GetRequest,
    ) -> Result<read::GetResponse<Chunks>, read::ReadError> {
        assert_eq!(r.scope(), &self.scope);
        let item: Value =
            serde_json::from_slice(include_bytes!("../../wire/fixtures/item.detail.json")).unwrap();
        let value = if r.path() == "/api/v1/entities" {
            let q: std::collections::BTreeMap<_, _> = r.query().iter().cloned().collect();
            let rows = if q["isLocation"] == "true" {
                vec![]
            } else {
                vec![item]
            };
            json!({"items":rows,"page":1,"pageSize":100,"total":rows.len()})
        } else if r.path().ends_with("/maintenance") {
            assert_eq!(r.query(), &[("status".into(), "both".into())]);
            serde_json::from_slice(include_bytes!("../../wire/fixtures/maintenance.json")).unwrap()
        } else {
            item
        };
        Ok(read::GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(
                serde_json::to_vec(&value)
                    .unwrap()
                    .chunks(7)
                    .map(|c| c.to_vec())
                    .collect(),
            ),
        })
    }
}
struct CachedOwner(read::PreviousGeneration);
impl HomeBoxReadOwner<Principal, Witness<'_>, Value> for CachedOwner {
    fn read(
        &mut self,
        p: &Principal,
        prepared: &st::PreparedRequest<Witness<'_>, Value>,
        q: &HomeBoxReadQuery,
    ) -> st::StockResult<HomeBoxReadResult> {
        assert!(std::ptr::eq(p, prepared.witness().principal));
        cached_entity_page(
            q,
            &self.0,
            &Timestamp::parse("2026-10-07T10:01:00Z").unwrap(),
            1000,
        )
        .map(HomeBoxReadResult::Resources)
    }
}
#[tokio::test(flavor = "current_thread")]
async fn healthy_actual_stock_cache_to_wire3_preserves_dates_status_and_unknown_facts() {
    let registration = read::SourceRegistration {
        workspace_id: uuid(1),
        home_id: uuid(2),
        source_instance_id: uuid(3),
        collection_id: id(4),
        owner: "homebox".into(),
        partition_mode: read::PartitionMode::ExclusiveHome,
        allowed_external_ids: vec![],
    };
    let mut reader = read::HomeBoxReader::new_stock(
        registration.clone(),
        StockFixtureTransport {
            scope: registration.scope(),
        },
        FixtureClock,
        read::Limits::default(),
        None,
    )
    .unwrap();
    let generation = reader.fetch_generation(None, uuid(99)).await.unwrap();
    assert_eq!(
        generation.entities()[0].maintenance[0]
            .scheduled_date
            .as_ref()
            .unwrap()
            .as_str(),
        "2026-02-01"
    );
    let before = serde_json::to_value(generation.cache()).unwrap();
    let mut owner = CachedOwner(generation.previous());
    let mut raw = request(Op::HomeboxEntityGet);
    raw["target"]["resourceId"] = json!(uuid(2));
    let result = run(raw, &mut owner);
    let data = &result["data"]["resources"][0]["data"];
    assert_eq!(data["updatedAt"], "2026-01-02T03:04:05.1200+02:00");
    assert_eq!(data["retrievedAt"], NOW);
    assert_eq!(result["data"]["sourceStatus"], "stale");
    assert_eq!(data["attachmentIds"].as_array().unwrap().len(), 3);
    assert_eq!(data["maintenanceIds"].as_array().unwrap().len(), 3);
    assert!(data.get("tagIds").is_none());
    assert!(data.get("fields").is_none());
    assert_eq!(serde_json::to_value(owner.0.cache()).unwrap(), before);
    assert_eq!(serde_json::to_value(generation.cache()).unwrap(), before);
}
