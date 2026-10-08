//! One ordinary fresh synthetic origin rebind and native gateway session.
//! Actual private Unix listener/OS peer; the selected synthetic gateway header
//! is supplied by this fixture. No native Tailscale WhoIs, deployment, old-cookie
//! denial, replay, expiry, failure injection, populated restore or provider I/O.
use houseatlas_backend::{
    access as a,
    app::trusted_gateway::{GatewayConnection, GatewaySocket},
    config::server::ServerConfig,
    http::{Host, router},
    lifecycle::persistent,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    sync::Arc,
    time::Duration,
};
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
const ORIGIN: &str = "https://houseatlas.synthetic.ts.net";
const HEADER: &str = r#"{"schemaVersion":1,"kind":"user","value":"synthetic@gateway"}"#;
fn call(client: &reqwest::Client, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
    client
        .request(method, format!("http://houseatlas.synthetic.ts.net{path}"))
        .header("host", "houseatlas.synthetic.ts.net")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("x-houseatlas-gateway-identity", HEADER)
}
async fn json_response(
    mut response: reqwest::Response,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 4096 {
            return Err("Synthetic native response exceeds its bound".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let old: ServerConfig = serde_json::from_value(json!({
        "schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),
        "logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),
        "listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743",
        "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
            "userId":id(4),"actorId":id(5),"username":"synthetic-gateway",
            "scope":{"workspaceId":id(2),"homeId":id(3)}}}
    }))?;
    persistent::initialize_without_password(&old)?;
    let old_receipt = fs::read(root.join("data/server-state.json"))?;
    let before = [
        fs::metadata(root.join("data/access.sqlite"))?,
        fs::metadata(root.join("data/atlas.sqlite"))?,
    ];
    let mut wire = serde_json::to_value(&old)?;
    let identity = wire["authentication"]["identity"].clone();
    wire["origin"] = json!(ORIGIN);
    wire["authentication"] = json!({"mode":"trusted-proxy","identity":identity,
        "policy":{"userLogin":"synthetic@gateway","nodeTag":"tag:synthetic","peerUid":rustix::process::geteuid().as_raw()},
        "socket":root.join("data/gateway.sock")});
    let config: ServerConfig = serde_json::from_value(wire)?;
    persistent::rebind_origin(&old, &config)?;
    assert!(fs::read(root.join("data/server-state.json"))? != old_receipt);
    for (name, original) in ["access.sqlite", "atlas.sqlite"].into_iter().zip(before) {
        let current = fs::metadata(root.join("data").join(name))?;
        assert_eq!(
            (current.dev(), current.ino()),
            (original.dev(), original.ino())
        );
    }
    {
        let db = rusqlite::Connection::open(root.join("data/access.sqlite"))?;
        let counts: (i64, i64, i64) = db.query_row("SELECT (SELECT count(*) FROM access_users),(SELECT count(*) FROM access_memberships),(SELECT count(*) FROM access_sessions)", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
        assert_eq!(counts, (1, 1, 0));
    }
    let (core, lease) = persistent::reopen(&config)?;
    let access = Arc::clone(&core.access);
    let policy = access
        .lock()
        .unwrap()
        .trusted_proxy_policy()
        .cloned()
        .unwrap();
    let path = root.join("data/gateway.sock");
    let (listener, socket) = GatewaySocket::bind(&path, policy).await?;
    assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_trusted_gateway(Arc::clone(&socket))?;
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            router(host).into_make_service_with_connect_info::<GatewayConnection>(),
        )
        .with_graceful_shutdown(async move {
            let _ = stopped.await;
        })
        .await
    });
    let client = reqwest::Client::builder()
        .unix_socket(path)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()?;
    let response = call(&client, reqwest::Method::GET, "/api/atlas/auth/mode")
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let mode: Value = json_response(response).await?;
    assert_eq!(mode, json!({"schemaVersion":1,"mode":"trusted-proxy"}));
    let response = call(&client, reqwest::Method::POST, "/api/atlas/auth/proxy")
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let set_cookie = response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()?
        .to_owned();
    assert!(
        set_cookie.contains("Secure")
            && set_cookie.contains("HttpOnly")
            && set_cookie.contains("SameSite=Strict")
    );
    let cookie = set_cookie.split(';').next().unwrap().to_owned();
    let info: Value = json_response(response).await?;
    assert_eq!(info["actorId"], id(5));
    assert_eq!(info["schemaVersion"], 1);
    let response = call(&client, reqwest::Method::GET, "/api/atlas/auth/session")
        .header("cookie", &cookie)
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let current: Value = json_response(response).await?;
    assert_eq!(current["actorId"], id(5));
    let csrf = current["csrfToken"].as_str().unwrap();
    let mutation_url = format!("{ORIGIN}/api/atlas/stock");
    let scope: a::Scope = serde_json::from_value(json!({"workspaceId":id(2),"homeId":id(3)}))?;
    let principal = access.lock().unwrap().authorize(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: &mutation_url,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(&cookie),
            authorization: None,
            csrf: Some(csrf),
        },
        &scope,
        a::Action::Mutate,
    )?;
    assert_eq!(principal.actor_id().as_str(), id(5));
    assert_eq!(principal.role(), a::Role::Editor);
    access
        .lock()
        .unwrap()
        .with_mutation_authorization(&principal, |guard| {
            guard.authorize(&scope, a::Capability::Mutate).map(|_| ())
        })?;
    let path = format!("/api/atlas/homes/{}/{}/view", id(2), id(3));
    let response = call(&client, reqwest::Method::GET, &path)
        .header("cookie", &cookie)
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    drop(response);
    drop(client);
    stop.send(())
        .map_err(|_| "Synthetic gateway server stopped early")?;
    server.await??;
    socket.remove_after_shutdown()?;
    drop(access);
    drop(lease);
    println!(
        "PASS fresh synthetic native init and explicit origin rebind preserves both DB inodes/one scoped Editor; actual private Unix socket/OS peer; simulated selected gateway identity; native mode, session cookie, refreshed-CSRF session read, genuine Editor mutation guard and scoped view. No native Tailscale WhoIs, deployment, provider I/O, old-cookie denial or held control case."
    );
    Ok(())
}
