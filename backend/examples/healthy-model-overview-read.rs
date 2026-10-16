//! One positive generated publication, fresh native session and in-process GETs.
//! No listener, provider, private household input, denial or lifecycle probes.
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use houseatlas_backend::{
    config::{model_overview::ServerModelOverviewSelection, server::ServerConfig},
    http::{Host, router},
    lifecycle::persistent,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc};
use tower::ServiceExt;
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn private(
    path: &std::path::Path,
    bytes: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    fs::write(path, bytes)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}
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
    let config_bytes = serde_json::to_vec(
        &json!({"schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743","homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],"mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}}}),
    )?;
    private(&root.join("server.json"), &config_bytes)?;
    let config: ServerConfig = serde_json::from_slice(&config_bytes)?;
    persistent::initialize_without_password(&config)?;
    let receipt = fs::read(root.join("data/server-state.json"))?;
    let publication_dir = root.join("publication");
    fs::create_dir(&publication_dir)?;
    fs::set_permissions(&publication_dir, fs::Permissions::from_mode(0o700))?;
    let mut json_bytes = serde_json::to_vec(
        &json!({"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],"meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],"buffers":[{"byteLength":36}],"bufferViews":[{"buffer":0,"byteLength":36}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]}]}),
    )?;
    while !json_bytes.len().is_multiple_of(4) {
        json_bytes.push(b' ');
    }
    let mut glb = Vec::new();
    glb.extend_from_slice(b"glTF");
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&((28 + json_bytes.len() + 36) as u32).to_le_bytes());
    glb.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    glb.extend_from_slice(&0x4e4f534au32.to_le_bytes());
    glb.extend(json_bytes);
    glb.extend_from_slice(&36u32.to_le_bytes());
    glb.extend_from_slice(&0x004e4942u32.to_le_bytes());
    for v in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        glb.extend_from_slice(&v.to_le_bytes());
    }
    private(&publication_dir.join("overview.glb"), &glb)?;
    let manifest = serde_json::to_vec(
        &json!({"profile":"houseatlas.model-overview-publication.v1","scope":{"workspaceId":id(2),"homeId":id(3)},"publicationId":id(6),"label":"Synthetic overview","qualification":"provisional-overview","frame":{"linearUnit":"m","upAxis":"Y","placement":"baked-in-asset","physicalRegistration":null},"components":[{"id":"synthetic-building","kind":"building","label":"Synthetic building"}],"sourceNote":"Generated triangle only","original":{"file":"overview.glb","contentType":"model/gltf-binary","sha256":sha(&glb),"bytes":glb.len()}}),
    )?;
    let manifest_path = publication_dir.join("publication.json");
    private(&manifest_path, &manifest)?;
    let args = vec![
        "serve".into(),
        "--model-overview-manifest".into(),
        manifest_path.to_str().unwrap().into(),
        "--model-overview-manifest-sha256".into(),
        sha(&manifest),
    ];
    let (remaining, selection) = ServerModelOverviewSelection::from_arguments(&args)?;
    assert_eq!(remaining, vec!["serve"]);
    let selection = selection.unwrap();
    selection.validate_config(&config)?;
    let (core, lease) = persistent::reopen(&config)?;
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let ordinary = router(host.clone());
    let response = ordinary
        .clone()
        .oneshot(request("POST", "/api/atlas/auth/local", "{}"))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()?
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let session: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    assert_eq!(session["actorId"], id(5));
    let get = |path: &str| {
        let mut r = request("GET", path, "");
        r.headers_mut().insert("cookie", cookie.parse().unwrap());
        r
    };
    let response = ordinary.oneshot(get("/api/atlas/view")).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let v: Value = serde_json::from_slice(&to_bytes(response.into_body(), 100000).await?)?;
    assert_eq!(v["modelOverviewService"]["available"], false);
    let app = router(host.with_model_overview(selection)?);
    for path in [
        "/api/atlas/view".to_owned(),
        format!("/api/atlas/homes/{}/{}/view", id(2), id(3)),
    ] {
        let response = app.clone().oneshot(get(&path)).await?;
        assert_eq!(response.status(), StatusCode::OK);
        let v: Value = serde_json::from_slice(&to_bytes(response.into_body(), 100000).await?)?;
        assert_eq!(
            v["modelOverviewService"],
            json!({"profile":"houseatlas.model-overview-read.v1","available":true,"publicationId":id(6),"manifestSha256":sha(&manifest)})
        );
    }
    let response = app
        .clone()
        .oneshot(get(&format!(
            "/api/atlas/models/v1/workspaces/{}/homes/{}/overview",
            id(2),
            id(3)
        )))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let descriptor: Value = serde_json::from_slice(&to_bytes(response.into_body(), 100000).await?)?;
    assert_eq!(descriptor["sourceNote"], "Generated triangle only");
    assert_eq!(descriptor["original"]["sha256"], sha(&glb));
    let response = app
        .oneshot(get(descriptor["original"]["href"].as_str().unwrap()))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.headers()["content-type"], "model/gltf-binary");
    assert_eq!(
        response.headers()["content-length"].to_str()?,
        glb.len().to_string()
    );
    assert_eq!(
        response.headers()["content-digest"].to_str()?,
        format!("sha-256=:{}:", STANDARD.encode(Sha256::digest(&glb)))
    );
    let frame: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD.decode(response.headers()["x-atlas-model-frame"].to_str()?)?,
    )?;
    assert_eq!(
        frame,
        json!({"profile":"houseatlas.model-overview-bytes.v1","scope":{"workspaceId":id(2),"homeId":id(3)},"publicationId":id(6),"manifestSha256":sha(&manifest),"original":{"contentType":"model/gltf-binary","sha256":sha(&glb),"bytes":glb.len()}})
    );
    assert_eq!(
        to_bytes(response.into_body(), 100000).await?.as_ref(),
        glb.as_slice()
    );
    assert_eq!(fs::read(root.join("server.json"))?, config_bytes);
    assert_eq!(fs::read(root.join("data/server-state.json"))?, receipt);
    assert_eq!(fs::read(manifest_path)?, manifest);
    assert_eq!(fs::read(publication_dir.join("overview.glb"))?, glb);
    drop(lease);
    println!(
        "PASS generated selected overview: absent/selected current and scoped views; fresh genuine native actor/session; authenticated descriptor/source note; Media-authorized exact original/hash/headers/frame; unchanged config, receipt and private input bytes. No listener/provider/household/probe."
    );
    Ok(())
}
