//! Positive, in-process cached HomeBox stock/MCP read example. No listener or provider IO.
//! A private clone of the public fixture uses a UUID collection ID for stock wire3.
use houseatlas_backend::{
    access as a,
    app::{Access, Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store, access_scope},
    contracts::stock as wire,
    domain as d,
    http::{
        agents::{mcp as host_mcp, stock_dispatch},
        contracts::NativeContracts,
    },
    lifecycle::{self, Failure},
    storage as s,
    transports::mcp,
};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    sync::{Arc, Mutex},
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

// A new store from a cloned public fixture. Only synthetic collection IDs are
// rebound for the published stock UUID schema; source observations stay intact.
fn prepare_local(directory: &Path) -> Result<Core, Failure> {
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let directory = fs::canonicalize(directory)?;
    let mut fixture = lifecycle::fixture()?;
    fn rebind(value: &mut Value) -> usize {
        match value {
            Value::Object(fields) => {
                let mut count = 0;
                if fields.get("collectionId") == Some(&json!("synthetic-collection-a")) {
                    fields.insert("collectionId".into(), json!(id(11)));
                    count += 1;
                }
                count + fields.values_mut().map(rebind).sum::<usize>()
            }
            Value::Array(rows) => rows.iter_mut().map(rebind).sum(),
            _ => 0,
        }
    }
    assert!(rebind(&mut fixture) > 0);
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic home".into(),
    };
    let scope = access_scope(&home.scope)?;
    let vault = Arc::new(houseatlas_backend::media::AssetVault::open(
        &directory.join("media"),
    )?);
    let access_path = directory.join("access.sqlite");
    let mut access =
        a::AccessBoundary::open(&access_path, a::AccessConfig::new(vec![ORIGIN.into()])?)?;
    let password = format!("Disposable-{}", houseatlas_backend::app::new_id()?);
    let user = a::CanonicalId::parse(id(4))?;
    let actor = a::CanonicalId::parse(id(5))?;
    access.provision_user(
        &user,
        &actor,
        "synthetic-viewer",
        &a::hash_password(&password)?,
        None,
    )?;
    access.set_membership(&user, &scope, a::Role::Viewer, true)?;
    for source in fixture["sources"]
        .as_array()
        .ok_or("Missing fixture sources")?
    {
        access.put_source(&serde_json::from_value(source.clone())?, None)?;
    }
    let login_url = format!("{ORIGIN}/api/atlas/auth/login");
    let receipt = access.login(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: &login_url,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: None,
            authorization: None,
            csrf: None,
        },
        &serde_json::to_vec(&json!({"username":"synthetic-viewer","password":password}))?,
        "homebox-stock-read",
    )?;
    let cookie = receipt
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing session cookie")?;
    let mut receipt_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(directory.join("smoke-session.json"))?;
    receipt_file.write_all(&serde_json::to_vec(&json!({"cookie":cookie}))?)?;
    receipt_file.sync_all()?;
    drop(receipt);
    drop(access);
    let access: Access = Arc::new(Mutex::new(a::AccessBoundary::open_existing(
        &access_path,
        a::AccessConfig::new(vec![ORIGIN.into()])?,
    )?));
    let path = directory.join("atlas.sqlite");
    let make_runtime = || houseatlas_backend::media::native::NativeMediaRuntime {
        vault: Arc::clone(&vault),
        server: ServerRuntime,
    };
    let mut store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        make_runtime(),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(fixture)?)?;
    store.close()?;
    let store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        make_runtime(),
        s::StoreOptions::default(),
    )?;
    Ok(Core {
        access,
        store: Mutex::new(store),
        atlas_list_pages: d::stock::AtlasListPages::default(),
        vault,
        homes: vec![home.clone()],
        home,
    })
}

async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("homebox-stock-read-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = prepare_local(&directory)?;
    assert_eq!(
        fs::metadata(&directory)?.permissions().mode() & 0o777,
        0o700
    );
    let scope = access_scope(&core.home.scope)?;
    let receipt: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let cookie = receipt["cookie"]
        .as_str()
        .ok_or("Missing synthetic cookie")?
        .to_owned();
    drop(receipt);
    let get_url = format!(
        "{ORIGIN}/api/atlas/stock/v3/workspaces/{}/homes/{}/records/entity/{}",
        core.home.scope.workspace_id,
        core.home.scope.home_id,
        id(501)
    );
    let original = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        access.authorize(
            &a::RequestEvidence {
                method: a::Method::Get,
                url: &get_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: None,
            },
            &scope,
            a::Action::Read,
        )?
    };
    assert_eq!(original.scope(), &scope);
    drop(cookie);
    let capture = RequestPrincipal::new(original.clone());
    let native_scope = serde_json::from_value(serde_json::to_value(&core.home.scope)?)?;
    let before = {
        let snapshot_principal = RequestPrincipal::new(original.clone());
        let mut store = core.store.lock().map_err(|_| "Store unavailable")?;
        store.read_snapshot_with_authorization(
            &ReadAuthority(Arc::clone(&core.access)),
            &snapshot_principal,
            &native_scope,
        )?
    };
    let context = json!({"workspaceId":id(1), "homeId":id(2)});
    let validator = wire::StockValidation::new()?;
    let operations = [
        (
            wire::OperationId::HomeboxEntityGet,
            id(501),
            "Synthetic mobile item",
        ),
        (
            wire::OperationId::HomeboxEntityList,
            id(501),
            "Synthetic mobile item",
        ),
        (
            wire::OperationId::HomeboxLocationGet,
            id(500),
            "Synthetic cabinet",
        ),
        (
            wire::OperationId::HomeboxLocationList,
            id(500),
            "Synthetic cabinet",
        ),
    ];
    let mut requests = Vec::new();
    let mut native_results = Vec::new();
    for (index, (operation, resource_id, expected_name)) in operations.iter().enumerate() {
        let listed = matches!(
            *operation,
            wire::OperationId::HomeboxEntityList | wire::OperationId::HomeboxLocationList
        );
        let mut target = json!({"authority":"homebox", "sourceInstanceId":id(10),
            "collectionId":id(11), "resourceKind":"entity"});
        if !listed {
            target["resourceId"] = json!(resource_id);
        }
        let raw = json!({"schemaVersion":3, "commandId":operation.as_str(),
            "requestId":id(1600 + index as u32), "context":context,
            "target":target, "payload":if listed {
                json!({"pageSize":100,"cursor":null,"includeArchived":false})
            } else { json!({}) }});
        let parsed = wire::StockRequest::parse(&validator, raw.clone())?;
        let result = stock_dispatch::execute(&core, &capture, raw.clone())?;
        wire::StockResponse::parse(&validator, &parsed, result.wire.clone(), &result.children)?;
        assert!(result.children.is_empty());
        verify(&result.wire, expected_name, resource_id)?;
        requests.push((raw, *operation));
        native_results.push(result.wire);
    }
    let (adapter, mut session) = host_mcp::bind_read(&core, original.clone())
        .await
        .map_err(|_| "MCP read binding unavailable")?;
    let init = rpc(
        &adapter,
        &mut session,
        json!({"jsonrpc":"2.0","id":1,
        "method":"initialize","params":{"protocolVersion":mcp::PROTOCOL_VERSION,
        "capabilities":{},"clientInfo":{"name":"HomeBox stock example","version":"0.1.0"}}}),
    )
    .await?;
    assert_eq!(init["result"]["protocolVersion"], mcp::PROTOCOL_VERSION);
    let notification = serde_json::to_vec(&json!({"jsonrpc":"2.0",
        "method":"notifications/initialized"}))?;
    assert!(adapter.handle(&mut session, &notification).await.is_none());
    assert_eq!(session.state(), mcp::SessionState::Ready);
    for (index, (raw, operation)) in requests.into_iter().enumerate() {
        let family = wire::operation(operation)?.tool_family.as_str();
        let reply = rpc(
            &adapter,
            &mut session,
            json!({"jsonrpc":"2.0",
            "id":index + 2,"method":"tools/call",
            "params":{"name":family,"arguments":raw.clone()}}),
        )
        .await?;
        let result = tool_wire(&reply)?;
        let parsed = wire::StockRequest::parse(&validator, raw)?;
        wire::StockResponse::parse(&validator, &parsed, result.clone(), &[])?;
        assert_eq!(result, native_results[index]);
    }
    let after = {
        let snapshot_principal = RequestPrincipal::new(original);
        let mut store = core.store.lock().map_err(|_| "Store unavailable")?;
        store.read_snapshot_with_authorization(
            &ReadAuthority(Arc::clone(&core.access)),
            &snapshot_principal,
            &native_scope,
        )?
    };
    assert_eq!(before, after);
    session.close();
    drop(session);
    drop(adapter);
    drop(capture);
    drop(core);
    scratch.close()?;
    println!("PASS cached HomeBox stock/MCP reads from unchanged synthetic state");
    Ok(())
}

fn verify(wire: &Value, name: &str, resource_id: &str) -> Result<(), Failure> {
    assert_eq!(wire["status"], "read");
    assert_eq!(wire["replayed"], false);
    assert_eq!(wire["data"]["sourceStatus"], "stale");
    assert_eq!(wire["data"]["nextCursor"], Value::Null);
    let rows = wire["data"]["resources"]
        .as_array()
        .ok_or("Missing resources")?;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row["target"]["resourceId"], resource_id);
    assert_eq!(row["data"]["name"], name);
    assert_eq!(row["data"]["retrievedAt"], "2026-01-02T12:00:00Z");
    assert_eq!(row["data"]["updatedAt"], "2025-12-01T00:00:00Z");
    assert!(row["data"].get("tags").is_none());
    assert!(row["data"].get("fields").is_none());
    Ok(())
}

async fn rpc(
    adapter: &host_mcp::Adapter<'_>,
    session: &mut mcp::Session<mcp::NativeContext>,
    message: Value,
) -> Result<Value, Failure> {
    let response = adapter
        .handle(session, &serde_json::to_vec(&message)?)
        .await
        .ok_or("Missing MCP response")?;
    let response: Value = serde_json::from_slice(&response)?;
    assert_eq!(response["id"], message["id"]);
    assert!(response.get("error").is_none());
    Ok(response)
}
fn tool_wire(reply: &Value) -> Result<Value, Failure> {
    let result = &reply["result"];
    assert_eq!(result["isError"], false);
    let structured = result
        .get("structuredContent")
        .ok_or("Missing structured result")?;
    let text = result["content"][0]["text"]
        .as_str()
        .ok_or("Missing text result")?;
    assert_eq!(serde_json::from_str::<Value>(text)?, *structured);
    Ok(structured.clone())
}
