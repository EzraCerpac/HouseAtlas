//! One fresh synthetic local identity, strict reopen and native session issuance.
//! No socket, real user data, password, provider, denial or recovery-control case.
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use houseatlas_backend::{
    access as a,
    config::server::ServerConfig,
    http::{Host, router},
    lifecycle::persistent,
};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc};
use tower::ServiceExt;

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn request(method: &str, path: &str, body: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", "https://127.0.0.1:48743")
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap();
    // Explicit in-process synthetic transport metadata; no listener is claimed.
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
    ));
    request
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let config: ServerConfig = serde_json::from_value(json!({
        "schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),
        "logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),
        "listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743",
        "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
            "userId":id(4),"actorId":id(5),"username":"synthetic-local",
            "scope":{"workspaceId":id(2),"homeId":id(3)}}}
    }))?;
    persistent::initialize_without_password(&config)?;
    let receipt = fs::read(root.join("data/server-state.json"))?;
    {
        let db = Connection::open(root.join("data/access.sqlite"))?;
        let counts: (i64,i64,i64) = db.query_row("SELECT (SELECT count(*) FROM access_users),(SELECT count(*) FROM access_memberships),(SELECT count(*) FROM access_sessions)", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        assert_eq!(counts, (1, 1, 0));
    }
    let (core, lease) = persistent::reopen(&config)?;
    assert_eq!(fs::read(root.join("data/server-state.json"))?, receipt);
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let access = host.core.lock().unwrap().access.clone();
    let app = router(host);
    let response = app
        .clone()
        .oneshot(request("GET", "/api/atlas/auth/mode", ""))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let mode: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    assert_eq!(mode, json!({"schemaVersion":1,"mode":"loopback-local"}));
    let response = app
        .clone()
        .oneshot(request("POST", "/api/atlas/auth/local", "{}"))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()?
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    assert_eq!(info["actorId"], id(5));
    assert_eq!(info["schemaVersion"], 1);
    let csrf = info["csrfToken"].as_str().unwrap();
    let scope: a::Scope = serde_json::from_value(json!({"workspaceId":id(2),"homeId":id(3)}))?;
    let principal = access.lock().unwrap().authorize(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: "https://127.0.0.1:48743/api/atlas/stock",
            origin: Some("https://127.0.0.1:48743"),
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
    let mut read = request("GET", "/api/atlas/auth/session", "");
    read.headers_mut().insert("cookie", cookie.parse()?);
    let response = app.oneshot(read).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let checked: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    assert_eq!(checked["actorId"], id(5));
    drop(access);
    drop(lease);
    println!(
        "PASS one synthetic password-disabled Editor: fresh init zero sessions; strict reopen; informational mode; native local session/cookie/CSRF; actual Editor mutation authorization and session GET. In-process router only, no listener/provider/control case."
    );
    Ok(())
}
