//! Positive native HomeBox root composition with real Access, Store and Domain.
//! The in-memory GET peer returns fixed original native bytes; it makes no socket.
use super::homebox_native::execute_with_reader;
use crate::{
    access as a,
    app::{Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store},
    config::providers::homebox::TrustedHomeBoxSource,
    contracts::stock as wire,
    domain as d,
    http::{Host, contracts::NativeContracts},
    lifecycle, media,
    providers::homebox::read as r,
    storage as s,
    transports::mcp,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

struct Body(Option<Vec<u8>>);
impl r::Body for Body {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, r::ReadError> {
        Ok(self.0.take())
    }
}
struct FixedGet {
    detail: Vec<u8>,
    maintenance: Vec<u8>,
    access: Arc<Mutex<a::AccessBoundary>>,
    store: Arc<Mutex<Store>>,
    core: Arc<Mutex<Core>>,
    observed: Arc<Mutex<Vec<String>>>,
}
impl r::Transport for FixedGet {
    type Body = Body;
    async fn get(
        &mut self,
        request: r::GetRequest,
    ) -> Result<r::GetResponse<Self::Body>, r::ReadError> {
        assert!(
            self.access.try_lock().is_ok(),
            "Access lock crossed original GET"
        );
        assert!(
            self.store.try_lock().is_ok(),
            "Store lock crossed original GET"
        );
        assert!(
            self.core.try_lock().is_ok(),
            "Core lock crossed original GET"
        );
        assert_eq!(request.method(), "GET");
        assert!(request.reject_redirects());
        assert_eq!(request.tenant(), id(11));
        let detail_path = format!("/api/v1/entities/{}", id(2));
        let maintenance_path = format!("{detail_path}/maintenance");
        let bytes = if request.path() == detail_path {
            assert!(request.query().is_empty());
            self.detail.clone()
        } else {
            assert_eq!(request.path(), maintenance_path);
            assert_eq!(request.query(), &[("status".into(), "both".into())]);
            self.maintenance.clone()
        };
        self.observed
            .lock()
            .unwrap()
            .push(request.path().to_owned());
        Ok(r::GetResponse {
            status: 200,
            scope: request.scope().clone(),
            redirected: false,
            body: Body(Some(bytes)),
        })
    }
}
struct FixedClock;
impl r::Clock for FixedClock {
    fn now(&self) -> r::Timestamp {
        r::Timestamp::parse("2026-10-08T12:00:00.1200+02:00").unwrap()
    }
}
fn evidence<'a>(method: a::Method, cookie: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/stock",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}

// Test-only transport glue. All domain preparation, source/grant checks, GET
// intake, graph authorization and result release stay in execute_with_reader.
// This is not OwnedStockService's configured HTTPS/credential/list-page path.
struct InjectedNativeService {
    host: Host,
    source: TrustedHomeBoxSource,
    registration: r::SourceRegistration,
    detail: Vec<u8>,
    maintenance: Vec<u8>,
    observed: Arc<Mutex<Vec<String>>>,
}
impl mcp::ServicePort<mcp::NativePrincipal, mcp::NativeOperation> for InjectedNativeService {
    type Output = mcp::NativeOutput;

    fn execute<'a>(
        &'a self,
        principal: &'a mcp::NativePrincipal,
        operation: mcp::NativeOperation,
    ) -> mcp::PortFuture<'a, Self::Output> {
        let host = self.host.clone();
        let source = self.source.clone();
        let registration = self.registration.clone();
        let detail = self.detail.clone();
        let maintenance = self.maintenance.clone();
        let observed = Arc::clone(&self.observed);
        let original = principal.original().clone();
        let handle = tokio::runtime::Handle::current();
        // Match the existing blocking-owner handoff. No RequestPrincipal or
        // Access/Store/Core guard crosses this await or the original GET.
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                let (access, store) = {
                    let core = host.core.lock().map_err(|_| mcp::PortError::Unavailable)?;
                    (Arc::clone(&core.access), Arc::clone(&core.store))
                };
                let mut reader = r::HomeBoxReader::new_stock(
                    registration,
                    FixedGet {
                        detail,
                        maintenance,
                        access,
                        store,
                        core: Arc::clone(&host.core),
                        observed,
                    },
                    FixedClock,
                    r::Limits::default(),
                    None,
                )
                .map_err(|_| mcp::PortError::Unavailable)?;
                let principal = RequestPrincipal::new(original);
                execute_with_reader(
                    &host,
                    &principal,
                    operation.request().raw().clone(),
                    &source,
                    &mut reader,
                    &handle,
                )
                .map(|result| mcp::NativeOutput {
                    request: operation.request,
                    result,
                })
                .map_err(|_| mcp::PortError::Unavailable)
            })
            .await
            .map_err(|_| mcp::PortError::Unavailable)?
        })
    }
}

type NativeAdapter =
    mcp::McpAdapter<mcp::NativePrincipalPort, mcp::NativeCatalog, InjectedNativeService>;

async fn rpc(
    adapter: &NativeAdapter,
    session: &mut mcp::Session<mcp::NativeContext>,
    message: Value,
) -> Result<Value, lifecycle::Failure> {
    let bytes = adapter
        .handle(session, &serde_json::to_vec(&message)?)
        .await
        .ok_or("Missing actual MCP response")?;
    let reply: Value = serde_json::from_slice(&bytes)?;
    assert_eq!(reply["jsonrpc"], "2.0");
    assert_eq!(reply["id"], message["id"]);
    assert!(reply.get("error").is_none());
    Ok(reply)
}

fn snapshot(host: &Host, original: &a::Principal) -> Result<s::Snapshot, lifecycle::Failure> {
    let (access, store, scope) = {
        let core = host.core.lock().map_err(|_| "Core unavailable")?;
        (
            Arc::clone(&core.access),
            Arc::clone(&core.store),
            serde_json::from_value::<s::Scope>(serde_json::to_value(&core.home.scope)?)?,
        )
    };
    let principal = RequestPrincipal::new(original.clone());
    let value = store
        .lock()
        .map_err(|_| "Store unavailable")?
        .read_snapshot_with_authorization(&ReadAuthority(access), &principal, &scope)?;
    Ok(value)
}

#[test]
fn healthy_native_homebox_root_reads_preserve_original_authority() -> Result<(), lifecycle::Failure>
{
    let scratch = tempfile::Builder::new()
        .prefix("homebox-native-root-")
        .tempdir_in("/tmp")?;
    let directory = std::fs::canonicalize(scratch.path())?;
    let mut fixture = lifecycle::fixture()?;
    fn rebind(value: &mut Value) {
        match value {
            Value::Object(fields) => {
                if fields.get("collectionId") == Some(&json!("synthetic-collection-a")) {
                    fields.insert("collectionId".into(), json!(id(11)));
                }
                for field in fields.values_mut() {
                    rebind(field);
                }
            }
            Value::Array(rows) => {
                for row in rows {
                    rebind(row);
                }
            }
            _ => {}
        }
    }
    rebind(&mut fixture);
    let registration: s::SourceRegistration =
        serde_json::from_value(fixture["sources"][0].clone())?;
    assert_eq!(registration.source_instance_id, id(10));
    assert_eq!(registration.collection_id, id(11));
    let source = TrustedHomeBoxSource::new_stock(
        "https://homebox.synthetic.invalid",
        registration.clone(),
        r::Limits::default(),
        None,
    )?;
    let reader_registration: r::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration)?)?;
    let scope = a::Scope {
        workspace_id: a::CanonicalId::parse(id(1))?,
        home_id: a::CanonicalId::parse(id(2))?,
    };
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec![ORIGIN.into()])?.with_clock(|| 1_800_000_000_000),
    )?;
    let password = "Synthetic-native-root-password-only!";
    let user = a::CanonicalId::parse(id(4))?;
    boundary.provision_user(
        &user,
        &a::CanonicalId::parse(id(5))?,
        "native-root",
        &a::hash_password(password)?,
        None,
    )?;
    boundary.set_membership(&user, &scope, a::Role::Viewer, true)?;
    let access_registration: a::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration)?)?;
    boundary.put_source(&access_registration, None)?;
    let session = boundary.login(
        &evidence(a::Method::Post, None),
        &serde_json::to_vec(&json!({"username":"native-root","password":password}))?,
        "native-root",
    )?;
    let cookie = session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("missing original session cookie")?
        .to_owned();
    let access = Arc::new(Mutex::new(boundary));
    let vault = Arc::new(media::AssetVault::open(&directory.join("media"))?);
    let database = directory.join("atlas.sqlite");
    let runtime = || media::native::NativeMediaRuntime {
        vault: Arc::clone(&vault),
        server: ServerRuntime,
    };
    let mut store = Store::open(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        runtime(),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(fixture)?)?;
    store.close()?;
    let store = Arc::new(Mutex::new(Store::open(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        runtime(),
        s::StoreOptions::default(),
    )?));
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic home".into(),
    };
    let core = Core {
        access: Arc::clone(&access),
        store: Arc::clone(&store),
        atlas_list_pages: d::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault,
        home: home.clone(),
        homes: vec![home],
    };
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
    let mut detail: Value = serde_json::from_str(include_str!(
        "../../providers/homebox/wire/fixtures/item.detail.json"
    ))?;
    detail["fields"] = json!([{"id":id(61),"name":"Captured native number","type":"number","textValue":"","numberValue":9007199254740991_i64,"booleanValue":false}]);
    detail["tags"] = json!([{"id":id(501),"name":"Captured tag"}]);
    let detail_bytes = serde_json::to_vec(&detail)?;
    let mut maintenance: Value = serde_json::from_slice(include_bytes!(
        "../../providers/homebox/wire/fixtures/maintenance.json"
    ))?;
    maintenance
        .as_array_mut()
        .ok_or("missing native maintenance rows")?
        .truncate(2);
    let maintenance_bytes = serde_json::to_vec(&maintenance)?;
    let observed = Arc::new(Mutex::new(Vec::new()));
    let snapshot_original = access.lock().unwrap().authorize(
        &evidence(a::Method::Get, Some(&cookie)),
        &scope,
        a::Action::Read,
    )?;
    let before = snapshot(&host, &snapshot_original)?;
    let mut parity = Vec::new();
    let validation = wire::StockValidation::new()?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    for (index, operation) in [
        d::stock::OperationId::HomeboxEntityTagsGet,
        d::stock::OperationId::HomeboxFieldList,
        d::stock::OperationId::HomeboxFieldGet,
        d::stock::OperationId::HomeboxMaintenanceList,
        d::stock::OperationId::HomeboxMaintenanceGet,
    ]
    .into_iter()
    .enumerate()
    {
        let principal = access.lock().unwrap().authorize(
            &evidence(a::Method::Get, Some(&cookie)),
            &scope,
            a::Action::Read,
        )?;
        let p = RequestPrincipal::new(principal);
        let mut reader = r::HomeBoxReader::new_stock(
            reader_registration.clone(),
            FixedGet {
                detail: detail_bytes.clone(),
                maintenance: maintenance_bytes.clone(),
                access: Arc::clone(&access),
                store: Arc::clone(&store),
                core: Arc::clone(&host.core),
                observed: Arc::clone(&observed),
            },
            FixedClock,
            r::Limits::default(),
            None,
        )?;
        let list = matches!(
            operation,
            d::stock::OperationId::HomeboxFieldList | d::stock::OperationId::HomeboxMaintenanceList
        );
        let mut target = json!({"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),"resourceKind":operation.operation().resource_kind});
        if operation == d::stock::OperationId::HomeboxEntityTagsGet {
            target["resourceId"] = json!(id(2));
        } else {
            target["entityId"] = json!(id(2));
            if !list {
                target["resourceId"] =
                    json!(id(if operation == d::stock::OperationId::HomeboxFieldGet {
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
        let raw = json!({"schemaVersion":3,"commandId":operation.as_str(),"requestId":id(900+index as u32),"context":{"workspaceId":id(1),"homeId":id(2)},"target":target,"payload":payload});
        let result = execute_with_reader(
            &host,
            &p,
            raw.clone(),
            &source,
            &mut reader,
            runtime.handle(),
        )?;
        let parsed = wire::StockRequest::parse(&validation, raw.clone())?;
        wire::StockResponse::parse(&validation, &parsed, result.wire.clone(), &result.children)?;
        assert_eq!(result.wire["schemaVersion"], 3);
        assert_eq!(result.wire["requestId"], raw["requestId"]);
        assert_eq!(result.wire["resolvedScope"], raw["context"]);
        assert_eq!(result.wire["status"], "read");
        assert_eq!(result.wire["replayed"], false);
        assert!(result.children.is_empty());
        assert_eq!(result.wire["commandId"], operation.as_str());
        assert_eq!(result.wire["data"]["sourceStatus"], "unresolved");
        let resources = result.wire["data"]["resources"]
            .as_array()
            .ok_or("missing native resources")?;
        assert!(!resources.is_empty());
        assert!(
            resources
                .iter()
                .all(|row| row["observation"]["kind"] == "observation-only")
        );
        match operation {
            d::stock::OperationId::HomeboxEntityTagsGet => {
                assert_eq!(resources[0]["target"]["resourceId"], id(2));
                assert_eq!(resources[0]["data"]["tagIds"], json!([id(501)]));
            }
            d::stock::OperationId::HomeboxFieldList | d::stock::OperationId::HomeboxFieldGet => {
                assert!(
                    resources
                        .iter()
                        .any(|row| row["target"]["resourceId"] == id(61)
                            && row["data"]["name"] == "Captured native number")
                );
                assert!(
                    resources
                        .iter()
                        .all(|row| row["data"]["value"]["value"] == json!(9007199254740991_i64))
                );
            }
            d::stock::OperationId::HomeboxMaintenanceList
            | d::stock::OperationId::HomeboxMaintenanceGet => {
                assert!(
                    resources
                        .iter()
                        .any(|row| row["target"]["resourceId"] == id(302)
                            && row["data"]["name"] == "Completed check")
                );
                for row in resources {
                    let original = maintenance
                        .as_array()
                        .ok_or("Missing native maintenance input")?
                        .iter()
                        .find(|input| input["id"] == row["target"]["resourceId"])
                        .ok_or("Missing exact native maintenance member")?;
                    assert_eq!(row["data"]["cost"], original["cost"]);
                    for key in ["scheduledDate", "completedDate"] {
                        let expected = match original[key].as_str().ok_or("Missing native date")? {
                            "" => Value::Null,
                            text => json!(text),
                        };
                        assert_eq!(row["data"][key], expected);
                    }
                }
            }
            _ => unreachable!(),
        }
        if list {
            assert!(result.wire["data"]["nextCursor"].is_null());
            assert_eq!(
                resources.len(),
                if operation == d::stock::OperationId::HomeboxFieldList {
                    1
                } else {
                    2
                }
            );
        }
        parity.push((raw, result.wire));
    }
    assert_eq!(observed.lock().unwrap().len(), 5);
    assert_eq!(snapshot(&host, &snapshot_original)?, before);

    runtime.block_on(async {
        use mcp::PrincipalPort;
        let principal = access.lock().unwrap().authorize(
            &evidence(a::Method::Get, Some(&cookie)),
            &scope,
            a::Action::Read,
        )?;
        assert_eq!(principal.role(), a::Role::Viewer);
        let context = mcp::NativeContext::from_principal(principal);
        let principals = mcp::NativePrincipalPort::new(Arc::clone(&access));
        let current = principals
            .resolve(&context)
            .await
            .map_err(|_| "Actual MCP principal unavailable")?;
        let schemas = mcp::NativeSchemas::from_bytes(
            include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
            include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
        )
        .map_err(|_| "Actual schemas unavailable")?;
        // This finite synthetic profile is not the mounted configured Host.
        let catalog = mcp::NativeCatalog::with_admitted_operations(
            &schemas,
            &current,
            [
                wire::OperationId::HomeboxEntityTagsGet,
                wire::OperationId::HomeboxFieldList,
                wire::OperationId::HomeboxFieldGet,
                wire::OperationId::HomeboxMaintenanceList,
                wire::OperationId::HomeboxMaintenanceGet,
            ],
        )
        .map_err(|_| "Actual catalog unavailable")?;
        let adapter = mcp::McpAdapter::new(
            principals,
            catalog,
            InjectedNativeService {
                host: host.clone(),
                source: source.clone(),
                registration: reader_registration.clone(),
                detail: detail_bytes.clone(),
                maintenance: maintenance_bytes.clone(),
                observed: Arc::clone(&observed),
            },
            mcp::AdapterConfig::default(),
        )
        .map_err(|_| "MCP adapter unavailable")?;
        let mut session = adapter.open(context);
        let initialized = rpc(
            &adapter,
            &mut session,
            json!({"jsonrpc":"2.0","id":"initialize","method":"initialize",
            "params":{"protocolVersion":mcp::PROTOCOL_VERSION,"capabilities":{},
                "clientInfo":{"name":"Synthetic native read delegation","version":"0.1.0"}}}),
        )
        .await?;
        assert_eq!(
            initialized["result"]["protocolVersion"],
            mcp::PROTOCOL_VERSION
        );
        let notification =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))?;
        assert!(adapter.handle(&mut session, &notification).await.is_none());
        assert_eq!(session.state(), mcp::SessionState::Ready);
        for (raw, native) in parity {
            let parsed = wire::StockRequest::parse(&validation, raw.clone())?;
            let family = wire::operation(parsed.id())?.tool_family.as_str();
            let reply = rpc(
                &adapter,
                &mut session,
                json!({"jsonrpc":"2.0","id":raw["requestId"],
                "method":"tools/call","params":{"name":family,"arguments":raw}}),
            )
            .await?;
            let result = &reply["result"];
            assert_eq!(result["isError"], false);
            let structured = result
                .get("structuredContent")
                .ok_or("Missing actual native structured result")?;
            let content = result["content"]
                .as_array()
                .ok_or("Missing actual native text")?;
            assert_eq!(content.len(), 1);
            assert_eq!(content[0]["type"], "text");
            assert_eq!(
                serde_json::from_str::<Value>(
                    content[0]["text"]
                        .as_str()
                        .ok_or("Missing native text bytes")?
                )?,
                *structured
            );
            assert_eq!(structured, &native);
            wire::StockResponse::parse(&validation, &parsed, structured.clone(), &[])?;
        }
        session.close();
        drop(session);
        drop(adapter);
        Ok::<(), lifecycle::Failure>(())
    })?;
    assert_eq!(snapshot(&host, &snapshot_original)?, before);
    let detail_path = format!("/api/v1/entities/{}", id(2));
    let maintenance_path = format!("{detail_path}/maintenance");
    assert_eq!(
        *observed.lock().unwrap(),
        [
            detail_path.clone(),
            detail_path.clone(),
            detail_path.clone(),
            maintenance_path.clone(),
            maintenance_path.clone(),
            detail_path.clone(),
            detail_path.clone(),
            detail_path,
            maintenance_path.clone(),
            maintenance_path,
        ]
    );
    Ok(())
}
