//! Successful source-free native place labels on fresh disposable persistent state.
//! Actual password-disabled Editor session, canonical HTTP commands, SQLite and reopen.
//! No listener, provider, supplied principal/grant, household data or control case.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use houseatlas_backend::{
    config::server::ServerConfig,
    contracts::stock as wire,
    http::{Host, McpCommandProfile, router},
    lifecycle::{Failure, persistent},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc};
use tower::ServiceExt;
const ORIGIN: &str = "https://127.0.0.1:48743";
const MAX_RESPONSE: usize = 1024 * 1024;
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn target(kind: &str, n: u32) -> Value {
    json!({"authority":"atlas","recordType":kind,"recordId":id(n)})
}
fn guard(kind: &str, n: u32) -> Value {
    json!({"target":target(kind,n),"revision":{"kind":"atlas","value":1}})
}
fn endpoint(n: u32) -> Value {
    json!({"kind":"atlas-record","ref":{"recordType":"identity","recordId":id(n)}})
}
fn evidence(statement: &str) -> Value {
    json!({"statement":statement,"provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,"evidenceBasis":"owner-report","factAt":null,"retrievedAt":"2026-10-10T00:00:00Z","vantage":null,"uncertainty":{"status":"unknown","explanation":null}},"supersedesEvidenceIds":[],"references":[]})
}
fn request(
    method: &str,
    path: &str,
    body: Vec<u8>,
    cookie: Option<&str>,
    csrf: Option<&str>,
) -> Result<Request<Body>, Failure> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .header("accept", "application/json");
    if let Some(cookie) = cookie {
        builder = builder.header("cookie", cookie);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-atlas-csrf", csrf);
    }
    let mut request = builder.body(Body::from(body))?;
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:50123".parse::<SocketAddr>()?));
    Ok(request)
}
struct Client {
    app: Router,
    scope: Value,
    cookie: String,
    csrf: String,
    serial: u32,
    posts: u32,
}
impl Client {
    async fn open(config: &ServerConfig) -> Result<(Self, persistent::ServerLease), Failure> {
        let (core, lease) = persistent::reopen(config)?;
        let host = Host::new(
            core,
            config.origin.clone(),
            Arc::new(BTreeMap::new()),
            vec![],
        )?
        .with_loopback_local()?
        .with_mcp_command_profile(McpCommandProfile::ReadOnly);
        let app = router(host);
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/atlas/auth/local",
                b"{}".to_vec(),
                None,
                None,
            )?)
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get("set-cookie")
            .ok_or("Missing native cookie")?
            .to_str()?
            .split(';')
            .next()
            .ok_or("Missing cookie pair")?
            .to_owned();
        let info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
        assert_eq!(info["schemaVersion"], 1);
        assert_eq!(info["actorId"], id(5));
        let csrf = info["csrfToken"]
            .as_str()
            .ok_or("Missing native CSRF")?
            .to_owned();
        Ok((
            Self {
                app,
                scope: json!({"workspaceId":id(2),"homeId":id(3)}),
                cookie,
                csrf,
                serial: 5000,
                posts: 0,
            },
            lease,
        ))
    }
    fn command(
        &mut self,
        kind: &str,
        verb: &str,
        n: u32,
        payload: Value,
        revision: Option<u32>,
        guards: Vec<Value>,
    ) -> Value {
        self.serial += 2;
        json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(self.serial),"context":self.scope,"target":target(kind,n),"payload":payload,
            "idempotencyKey":id(self.serial+1),"reason":"Synthetic reviewed native place naming","approvalReceiptId":null,
            "preconditions":{"target":revision.map(|v|json!({"kind":"atlas","value":v})),"guards":guards}})
    }
    async fn call(&mut self, command: Value) -> Result<Value, Failure> {
        let validator = wire::StockValidation::new()?;
        let parsed = wire::StockRequest::parse(&validator, command.clone())?;
        let base = format!("/api/atlas/stock/v3/workspaces/{}/homes/{}", id(2), id(3));
        let writing = command.get("idempotencyKey").is_some();
        let (method, path, body) = if writing {
            self.posts += 1;
            (
                "POST",
                format!("{base}/commands"),
                serde_json::to_vec(&command)?,
            )
        } else {
            (
                "GET",
                format!(
                    "{base}/invoke?request={}",
                    url::form_urlencoded::byte_serialize(&serde_json::to_vec(&command)?)
                        .collect::<String>()
                ),
                Vec::new(),
            )
        };
        let response = self
            .app
            .clone()
            .oneshot(request(
                method,
                &path,
                body,
                Some(&self.cookie),
                writing.then_some(self.csrf.as_str()),
            )?)
            .await?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        let result: Value = serde_json::from_slice(&bytes)?;
        wire::StockResponse::parse(&validator, &parsed, result.clone(), &[])?;
        assert_eq!(result["requestId"], command["requestId"]);
        assert_eq!(result["commandId"], command["commandId"]);
        assert_eq!(result["resolvedScope"], self.scope);
        if writing {
            assert_eq!(result["status"], "committed");
            assert_eq!(result["replayed"], false);
            assert_eq!(result["data"]["requestDigest"], parsed.intent_digest());
        } else {
            assert_eq!(result["status"], "read");
        }
        Ok(result)
    }
    async fn batch(&mut self, commands: Vec<Value>, guards: Vec<Value>) -> Result<Value, Failure> {
        self.serial += 3;
        let root = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(self.serial),"context":self.scope,
            "target":{"authority":"atlas","kind":"batch","batchId":id(self.serial+1)},"payload":{"commands":commands},
            "idempotencyKey":id(self.serial+2),"reason":"Synthetic reviewed native place naming","approvalReceiptId":null,"preconditions":{"target":null,"guards":guards}});
        self.call(root).await
    }
    async fn read(
        &mut self,
        kind: &str,
        verb: &str,
        n: u32,
        payload: Value,
    ) -> Result<Value, Failure> {
        self.serial += 1;
        let command = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(self.serial),"context":self.scope,"target":if verb == "list" { json!({"authority":"atlas","recordType":kind}) } else { target(kind,n) },"payload":payload});
        self.call(command).await
    }
}
#[tokio::main]
async fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::time::timeout(std::time::Duration::from_secs(180), healthy()).await??;
    Ok(())
}
async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-native-place-labels-")
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir_in("/tmp")?;
    let root = fs::canonicalize(scratch.path())?;
    let config: ServerConfig = serde_json::from_value(
        json!({"schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("unused.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":ORIGIN,"homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}}}),
    )?;
    persistent::initialize_without_password(&config)?;
    let (mut client, lease) = Client::open(&config).await?;
    let empty = client
        .read(
            "identity",
            "list",
            0,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(empty["data"]["records"], json!([]));
    let mut children = vec![client.command(
        "evidence",
        "create",
        100,
        evidence("I report these synthetic place names and building membership."),
        None,
        vec![],
    )];
    for n in 101..=103 {
        children.push(client.command(
            "identity",
            "create",
            n,
            json!({"kind":"location","evidenceIds":[id(100)]}),
            None,
            vec![],
        ));
    }
    let building = json!({"atlasId":id(101),"semanticKind":"building","label":"Synthetic building","reviewStatus":"accepted","evidenceIds":[id(100)]});
    let room = json!({"atlasId":id(102),"semanticKind":"room","label":"Synthetic room","reviewStatus":"accepted","evidenceIds":[id(100)]});
    // Genuine legacy-shaped omitted label with a retained exact decimal token.
    let mut floor = json!({"atlasId":id(103),"semanticKind":"floor","reviewStatus":"accepted","evidenceIds":[id(100)],"elevation":{"status":"known","metres":0,"datumAtlasId":id(101)}});
    floor["elevation"]["metres"] = serde_json::from_str("1e-1000")?;
    for (n, payload) in [
        (201, building.clone()),
        (202, room.clone()),
        (203, floor.clone()),
    ] {
        children.push(client.command("location-semantics", "create", n, payload, None, vec![]));
    }
    children.push(client.command("relation","create",301,json!({"kind":"location-membership","membershipKind":"building","from":endpoint(101),"to":endpoint(102),"reviewStatus":"accepted","uncertainty":{"status":"supported","explanation":null},"evidenceIds":[id(100)]}),None,vec![]));
    let created = client.batch(children, vec![]).await?;
    assert_eq!(
        created["data"]["records"]
            .as_array()
            .ok_or("Missing records")?
            .len(),
        8
    );
    let omitted = client
        .read("location-semantics", "get", 203, json!({}))
        .await?;
    assert_eq!(omitted["data"]["records"][0]["payload"], floor);
    assert!(
        omitted["data"]["records"][0]["payload"]
            .get("label")
            .is_none()
    );
    let mut named = floor.clone();
    named["label"] = json!("Synthetic level");
    named["evidenceIds"] = json!([id(100), id(400)]);
    let guards = vec![
        guard("evidence", 100),
        guard("identity", 103),
        guard("identity", 101),
    ];
    let rename_evidence = client.command(
        "evidence",
        "create",
        400,
        evidence("I name this synthetic level."),
        None,
        vec![],
    );
    let rename = client.command(
        "location-semantics",
        "replace",
        203,
        named.clone(),
        Some(1),
        guards.clone(),
    );
    let mut root_guards = guards.clone();
    root_guards.push(guard("location-semantics", 203));
    client
        .batch(vec![rename_evidence, rename], root_guards)
        .await?;
    let renamed = client
        .read("location-semantics", "get", 203, json!({}))
        .await?;
    assert_eq!(renamed["data"]["records"][0]["revision"], 2);
    assert_eq!(renamed["data"]["records"][0]["payload"], named);
    let mut cleared = named.clone();
    cleared
        .as_object_mut()
        .ok_or("Missing payload")?
        .remove("label");
    cleared["evidenceIds"] = json!([id(100), id(400), id(401)]);
    let mut clear_guards = guards;
    clear_guards.push(guard("evidence", 400));
    let clear_evidence = client.command(
        "evidence",
        "create",
        401,
        evidence("I remove only the synthetic level display label."),
        None,
        vec![],
    );
    let clear = client.command(
        "location-semantics",
        "replace",
        203,
        cleared.clone(),
        Some(2),
        clear_guards.clone(),
    );
    clear_guards.push(
        json!({"target":target("location-semantics",203),"revision":{"kind":"atlas","value":2}}),
    );
    client
        .batch(vec![clear_evidence, clear], clear_guards)
        .await?;
    let history = client
        .read(
            "location-semantics",
            "history",
            203,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(
        history["data"]["entries"]
            .as_array()
            .ok_or("Missing history")?
            .len(),
        3
    );
    for entry in history["data"]["entries"]
        .as_array()
        .ok_or("Missing history")?
    {
        assert_eq!(entry["actorId"], id(5));
        assert_eq!(entry["state"], "committed");
    }
    let posts = client.posts;
    drop(client);
    drop(lease);
    let (mut reopened, reopened_lease) = Client::open(&config).await?;
    let actual = reopened
        .read("location-semantics", "get", 203, json!({}))
        .await?;
    assert_eq!(actual["data"]["records"][0]["revision"], 3);
    assert_eq!(actual["data"]["records"][0]["payload"], cleared);
    assert_eq!(
        actual["data"]["records"][0]["payload"]["elevation"]["metres"].to_string(),
        "1e-1000"
    );
    for (n, expected) in [(201, building), (202, room)] {
        let actual = reopened
            .read("location-semantics", "get", n, json!({}))
            .await?;
        assert_eq!(actual["data"]["records"][0]["payload"], expected);
    }
    let identities = reopened
        .read(
            "identity",
            "list",
            0,
            json!({"buildingId":id(101),"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(
        identities["data"]["records"]
            .as_array()
            .ok_or("Missing building records")?
            .len(),
        2
    );
    drop(reopened);
    drop(reopened_lease);
    scratch.close()?;
    println!(
        "PASS source-free native place labels: {posts} actual HTTP batches, fresh empty state, building/room explicit membership, omitted-label exact floor, guarded rename/clear, retained audit, strict persistent reopen, private cleanup; no provider/listener"
    );
    Ok(())
}
