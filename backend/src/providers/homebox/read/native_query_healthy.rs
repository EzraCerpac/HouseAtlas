//! Exact ordinary positive native intake, retained reads and original Access handles.
use super::*;
use crate::{access as a, contracts::stock::StockTarget, domain::stock as st, storage as s};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn evidence(method: a::Method, cookie: Option<&str>) -> a::RequestEvidence<'_> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/stock",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}
struct FixtureCredentials;
impl CredentialProvider for FixtureCredentials {
    async fn read_authorization(
        &mut self,
        _: &SourceEndpoint,
        _: tokio::time::Instant,
    ) -> Result<Option<AuthorizationHeader>, ReadError> {
        Ok(None)
    }
}
struct FixtureClock;
impl Clock for FixtureClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse("2026-10-08T12:00:00.1200+02:00").unwrap()
    }
}

struct Witness<'a, 'p> {
    captured: &'a st::CapturedAccess<'p>,
    request: Value,
}
#[derive(Clone)]
struct Graph {
    request: Value,
    native: Value,
    targets: Vec<StockTarget>,
}
struct SemanticOwner<'a, 'p> {
    captured: &'a st::CapturedAccess<'p>,
    graph: Graph,
    checks: Cell<usize>,
    released: Cell<usize>,
}
impl<'a, 'p> st::StockAuthorityPort<a::Principal> for SemanticOwner<'a, 'p> {
    type Witness = Witness<'a, 'p>;
    type Graph = Graph;
    fn capture(
        &self,
        p: &a::Principal,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<Self::Witness> {
        assert!(std::ptr::eq(p, self.captured.principal()));
        assert_eq!(r.raw(), &self.graph.request);
        Ok(Witness {
            captured: self.captured,
            request: r.raw().clone(),
        })
    }
    fn authorize_graph(
        &self,
        p: &a::Principal,
        w: &Self::Witness,
        r: &st::ValidatedRequest,
        g: &Graph,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, w.captured.principal()));
        assert!(std::ptr::eq(w.captured, self.captured));
        assert_eq!(&w.request, r.raw());
        assert_eq!(&g.request, r.raw());
        assert_eq!(g.targets, self.graph.targets);
        for target in &g.targets {
            let value = serde_json::to_value(target).unwrap();
            assert_eq!(value["authority"], "homebox");
            assert_eq!(value["sourceInstanceId"], id(3));
            assert_eq!(value["collectionId"], id(4));
            let resource = value["resourceId"].as_str().unwrap();
            match value["resourceKind"].as_str().unwrap() {
                "entity" => assert_eq!(resource, id(2)),
                "tag" => assert!(
                    g.native["tags"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|row| row["id"] == resource)
                ),
                "field" => {
                    assert_eq!(value["entityId"], id(2));
                    assert!(
                        g.native["fields"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|row| row["id"] == resource)
                    );
                }
                "maintenance" => {
                    assert_eq!(value["entityId"], id(2));
                    assert!(
                        g.native
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|row| row["id"] == resource && row["itemID"] == id(2))
                    );
                }
                _ => panic!("no unobserved positive graph member"),
            }
        }
        Ok(())
    }
    fn revalidate(
        &self,
        p: &a::Principal,
        w: &Self::Witness,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, w.captured.principal()));
        assert!(std::ptr::eq(w.captured, self.captured));
        assert_eq!(&w.request, r.raw());
        Ok(())
    }
    fn authorize_result(
        &self,
        p: &a::Principal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        r: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, prepared.witness().captured.principal()));
        assert_eq!(r.raw(), &prepared.graph().request);
        assert_eq!(result["data"]["sourceStatus"], "unresolved");
        for row in result["data"]["resources"].as_array().unwrap() {
            let target: StockTarget = serde_json::from_value(row["target"].clone()).unwrap();
            assert!(prepared.graph().targets.contains(&target));
            assert_eq!(row["observation"]["kind"], "observation-only");
            let resource = row["target"]["resourceId"].as_str().unwrap();
            match r.id() {
                st::OperationId::HomeboxEntityTagsGet => {
                    assert_eq!(row["data"]["tagIds"], json!([id(501)]))
                }
                st::OperationId::HomeboxFieldList | st::OperationId::HomeboxFieldGet => {
                    assert_eq!(resource, id(61));
                    assert_eq!(
                        row["data"]["name"],
                        prepared.graph().native["fields"][0]["name"]
                    );
                    assert_eq!(
                        row["data"]["value"]["value"],
                        prepared.graph().native["fields"][0]["numberValue"]
                    );
                }
                st::OperationId::HomeboxMaintenanceList
                | st::OperationId::HomeboxMaintenanceGet => {
                    let raw = prepared
                        .graph()
                        .native
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|raw| raw["id"] == resource)
                        .unwrap();
                    assert_eq!(row["data"]["name"], raw["name"]);
                    assert_eq!(row["data"]["cost"], raw["cost"]);
                    for key in ["scheduledDate", "completedDate"] {
                        // The original wire decoder maps the native empty date
                        // to None; retained bytes preserve the original empty
                        // spelling while the published projection uses null.
                        let expected = match raw[key].as_str().unwrap() {
                            "" => Value::Null,
                            value => json!(value),
                        };
                        assert_eq!(row["data"][key], expected);
                    }
                }
                _ => panic!("exact positive operations only"),
            }
        }
        self.released.set(self.released.get() + 1);
        Ok(())
    }
    fn disclose(
        &self,
        p: &a::Principal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        _: &st::ValidatedRequest,
        target: &Value,
        _: &Value,
        _: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p, prepared.witness().captured.principal()));
        let target: StockTarget = serde_json::from_value(target.clone()).unwrap();
        assert!(prepared.graph().targets.contains(&target));
        Ok(())
    }
}
impl<'a, 'p> st::GraphAuthorization<Witness<'a, 'p>, Graph> for SemanticOwner<'a, 'p> {
    fn revalidate_prepared(
        &self,
        p: &a::Principal,
        c: &st::CapturedAccess<'_>,
        prepared: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
    ) -> s::Result<()> {
        assert!(std::ptr::eq(p, self.captured.principal()));
        assert!(std::ptr::eq(c, self.captured));
        assert!(std::ptr::eq(prepared.witness().captured, self.captured));
        assert_eq!(&prepared.witness().request, prepared.request().raw());
        assert_eq!(&prepared.graph().request, prepared.request().raw());
        assert_eq!(prepared.graph().targets, self.graph.targets);
        self.checks.set(self.checks.get() + 1);
        Ok(())
    }
    fn authorize_native(
        &self,
        _: &a::Principal,
        _: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
        _: &s::AuthorizationRequest<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "not-found",
            "No native storage operation is supplied",
        ))
    }
    fn authorize_stock_mutation(
        &self,
        _: &a::Principal,
        _: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
        _: &s::StockMutationFrame<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new("not-found", "No mutation owner is supplied"))
    }
    fn authorize_stock_history(
        &self,
        _: &a::Principal,
        _: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
        _: &s::StockHistoryFrame<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new("not-found", "No history owner is supplied"))
    }
}
struct Resolver(Graph);
impl<'a, 'p> st::StockPreparerPort<a::Principal, Witness<'a, 'p>> for Resolver {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &a::Principal,
        w: &Witness<'a, 'p>,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        assert!(std::ptr::eq(p, w.captured.principal()));
        assert_eq!(r.raw(), &self.0.request);
        Ok(self.0.clone())
    }
}
struct NoOtherOwner;
impl st::StockHistoryPort<a::Principal> for NoOtherOwner {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        _: &a::Principal,
        _: &C,
        _: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        Err(st::StockError::OwnerUnavailable)
    }
}
impl<W, G> st::StockCommandPort<a::Principal, W, G> for NoOtherOwner {
    fn execute(
        &mut self,
        _: &a::Principal,
        _: &st::PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        Err(st::StockError::OwnerUnavailable)
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_configured_native_queries_retain_original_authority() {
    let cid = |n| a::CanonicalId::parse(id(n)).unwrap();
    let scope = a::Scope {
        workspace_id: cid(1),
        home_id: cid(2),
    };
    let registration = a::SourceRegistration {
        workspace_id: cid(1),
        home_id: cid(2),
        source_instance_id: cid(3),
        collection_id: id(4),
        owner: a::SourceOwner::Homebox,
        partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(2), id(1)],
    };
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    let password = "Synthetic-native-query-password-only!";
    access
        .provision_user(
            &cid(10),
            &cid(11),
            "native-query",
            &a::hash_password(password).unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&cid(10), &scope, a::Role::Viewer, true)
        .unwrap();
    access.put_source(&registration, None).unwrap();
    let session = access
        .login(
            &evidence(a::Method::Post, None),
            &serde_json::to_vec(&json!({"username":"native-query","password":password})).unwrap(),
            "synthetic-native-query",
        )
        .unwrap();
    let principal = access
        .authorize(
            &evidence(
                a::Method::Get,
                Some(session.set_cookie().split(';').next().unwrap()),
            ),
            &scope,
            a::Action::Read,
        )
        .unwrap();
    let reference = a::SourceRef {
        workspace_id: cid(1),
        home_id: cid(2),
        key: a::SourceKey {
            source_instance_id: cid(3),
            collection_id: id(4),
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: id(2),
        },
    };
    let captured = st::CapturedAccess::capture(&access, &principal, &[reference], &[]).unwrap();
    let shared = Arc::new(Mutex::new(access));
    let reader_registration: SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let mut detail: Value =
        serde_json::from_str(include_str!("../wire/fixtures/item.detail.json")).unwrap();
    detail["fields"] = json!([{"id":id(61),"name":"Captured native number","type":"number","textValue":"","numberValue":9007199254740991_i64,"booleanValue":false}]);
    detail["tags"] = json!([{"id":id(501),"name":"Captured tag"}]);
    detail["nativeExtension"] = serde_json::from_str("9007199254740993").unwrap();
    detail["purchasePrice"] = serde_json::from_str("1.2300e+2").unwrap();
    let detail_bytes = serde_json::to_vec(&detail).unwrap();
    let mut log: Value =
        serde_json::from_slice(include_bytes!("../wire/fixtures/maintenance.json")).unwrap();
    log.as_array_mut().unwrap().truncate(2);
    let log_bytes = serde_json::to_vec(&log).unwrap();
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let endpoint = SourceEndpoint::loopback_fixture(
        &format!("http://{}", listener.local_addr().unwrap()),
        reader_registration.scope(),
    )
    .unwrap();
    let server_access = Arc::clone(&shared);
    let response_detail = detail_bytes.clone();
    let response_log = log_bytes.clone();
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for index in 0..5 {
            let (mut socket, peer) = listener.accept().await.unwrap();
            assert!(peer.ip().is_loopback());
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).await.unwrap();
                request.push(byte[0]);
                assert!(request.len() < 8192);
            }
            // Ordinary successful lock acquisition proves the source consumer
            // holds no shared Access guard while waiting on its HTTP response.
            {
                let _available = server_access.try_lock().unwrap();
            }
            let request = String::from_utf8(request).unwrap();
            let lower = request.to_ascii_lowercase();
            let path = if index < 3 {
                format!("/api/v1/entities/{}", id(2))
            } else {
                format!("/api/v1/entities/{}/maintenance?status=both", id(2))
            };
            assert_eq!(
                request.lines().next().unwrap(),
                format!("GET {path} HTTP/1.1")
            );
            assert!(lower.contains(&format!("x-tenant: {}\r\n", id(4))));
            assert!(!lower.contains("authorization:"));
            requests.push(path);
            let bytes = if index < 3 {
                &response_detail
            } else {
                &response_log
            };
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
            for chunk in bytes.chunks(17) {
                socket
                    .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                    .await
                    .unwrap();
                socket.write_all(chunk).await.unwrap();
                socket.write_all(b"\r\n").await.unwrap();
            }
            socket.write_all(b"0\r\n\r\n").await.unwrap();
            socket.shutdown().await.unwrap();
        }
        requests
    });
    let operation = async {
        let transport =
            HttpTransport::new(endpoint, FixtureCredentials, Limits::default()).unwrap();
        let mut reader = HomeBoxReader::new_stock(
            reader_registration,
            transport,
            FixtureClock,
            Limits::default(),
            None,
        )
        .unwrap();
        let contracts = st::NativeStockContract::new().unwrap();
        for (index, op) in [
            st::OperationId::HomeboxEntityTagsGet,
            st::OperationId::HomeboxFieldList,
            st::OperationId::HomeboxFieldGet,
            st::OperationId::HomeboxMaintenanceList,
            st::OperationId::HomeboxMaintenanceGet,
        ]
        .into_iter()
        .enumerate()
        {
            let list = matches!(
                op,
                st::OperationId::HomeboxFieldList | st::OperationId::HomeboxMaintenanceList
            );
            let mut target = json!({"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":op.operation().resource_kind});
            if op == st::OperationId::HomeboxEntityTagsGet {
                target["resourceId"] = json!(id(2));
            } else {
                target["entityId"] = json!(id(2));
                if !list {
                    target["resourceId"] = json!(id(if op == st::OperationId::HomeboxFieldGet {
                        61
                    } else {
                        302
                    }));
                }
            }
            let payload = if list {
                json!({"cursor":null,"pageSize":100,"includeArchived":true})
            } else {
                json!({})
            };
            let request = json!({"schemaVersion":3,"commandId":op.as_str(),"requestId":id(100+index as u32),"context":{"workspaceId":id(1),"homeId":id(2)},"target":target,"payload":payload});
            let validated = st::ValidatedRequest::parse(&contracts, request.clone()).unwrap();
            // Intake precedes original graph preparation. The source bytes and
            // observed selectors, rather than preseeded member identities,
            // supply the synthetic owner's exact graph input.
            let intake = reader
                .capture_native_read(&contracts, &shared, &captured, &validated)
                .await
                .unwrap();
            let graph = Graph {
                request: request.clone(),
                native: serde_json::from_slice(intake.original_bytes()).unwrap(),
                targets: intake.observation().references().to_vec(),
            };
            let owner = SemanticOwner {
                captured: &captured,
                graph: graph.clone(),
                checks: Cell::new(0),
                released: Cell::new(0),
            };
            let prepared = st::prepare(
                &principal,
                request,
                &contracts,
                &owner,
                &mut Resolver(graph),
            )
            .unwrap();
            let mut reads = intake.bind_prepared(&prepared, &owner).unwrap();
            assert_eq!(
                reads.original_bytes(),
                if index < 3 {
                    detail_bytes.as_slice()
                } else {
                    log_bytes.as_slice()
                }
            );
            assert_eq!(
                reads.retrieved_at().as_str(),
                "2026-10-08T12:00:00.1200+02:00"
            );
            for reference in reads.references() {
                assert!(prepared.graph().targets.contains(reference));
            }
            let mut history = NoOtherOwner;
            let mut commands = NoOtherOwner;
            let mut queries = query::HomeBoxQueries::new(&contracts, &mut reads, &mut history);
            let result = st::dispatch_prepared(
                &principal,
                &prepared,
                &contracts,
                &owner,
                &mut queries,
                &mut commands,
            )
            .unwrap();
            assert_eq!(result.wire["commandId"], op.as_str());
            assert_eq!(owner.checks.get(), 3);
            assert_eq!(owner.released.get(), 1);
        }
        assert_eq!(server.await.unwrap().len(), 5);
    };
    tokio::time::timeout(std::time::Duration::from_secs(15), operation)
        .await
        .unwrap();
}
