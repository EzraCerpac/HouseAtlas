//! One positive generated room-link read through the actual native session/Read owner.
//! No listener, provider, real data, native registration or held probes.
#[path = "support/unified_atlas_fixture.rs"]
mod fixture;
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use houseatlas_backend::{
    config::{
        atlas_room_links::ServerAtlasRoomLinksSelection, atlas_scene::ServerAtlasSceneSelection,
        model_overview::ServerModelOverviewSelection, server::ServerConfig,
    },
    http::{Host, router},
    lifecycle::persistent,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, path::Path, sync::Arc,
};
use tower::ServiceExt;
type Failure = Box<dyn std::error::Error + Send + Sync>;
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn private(path: &Path, bytes: &[u8]) -> Result<(), Failure> {
    fs::write(path, bytes)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}
fn request(method: &str, path: &str, body: &str) -> Request<Body> {
    let mut r = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", "https://127.0.0.1:48743")
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap();
    r.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
    ));
    r
}
#[tokio::main]
async fn main() -> Result<(), Failure> {
    assert_eq!(std::env::args().len(), 1);
    let temp = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temp.path())?;
    let config_bytes = serde_json::to_vec(
        &json!({"schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743","homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],"mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}}}),
    )?;
    private(&root.join("server.json"), &config_bytes)?;
    let config: ServerConfig = serde_json::from_slice(&config_bytes)?;
    persistent::initialize_without_password(&config)?;
    let receipt = fs::read(root.join("data/server-state.json"))?;
    let parent = root.join("publication");
    fs::create_dir(&parent)?;
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o700))?;
    let (glb, overview_bytes, companion) =
        fixture::generate(json!({"workspaceId":id(2),"homeId":id(3)}), id(6));
    // Synthetic source declaration and independent reviewed input are authored
    // separately. Neither claims an existing native room or a current source.
    let mut producer: Value = serde_json::from_slice(&companion)?;
    producer["rooms"][0]["nativePlaceId"] = json!(id(7));
    producer["rooms"][0]["nativeBinding"]["status"] = json!("historical");
    producer["overlayBindings"][0]["nativePlaceId"] = json!(id(7));
    let companion = serde_json::to_vec(&producer)?;
    let links_bytes = serde_json::to_vec_pretty(
        &json!({"profile":"houseatlas.unified-atlas-room-links.v1","workspaceId":id(2),"homeId":id(3),"publicationId":id(6),"semanticsSha256":sha(&companion),"links":[{"roomId":"hall","nativePlaceId":id(7),"packagePlaceKey":"generated:hall","packagePlaceUuid":id(8)}]}),
    )?;
    for (name, bytes) in [
        ("overview.glb", glb.as_slice()),
        ("publication.json", overview_bytes.as_slice()),
        ("atlas-scene.json", companion.as_slice()),
        ("atlas-room-links.json", links_bytes.as_slice()),
    ] {
        private(&parent.join(name), bytes)?;
    }
    let overview = ServerModelOverviewSelection::read_pinned(
        &parent.join("publication.json"),
        &sha(&overview_bytes),
    )?;
    overview.validate_config(&config)?;
    let scene = ServerAtlasSceneSelection::read_pinned(
        &parent.join("atlas-scene.json"),
        &sha(&companion),
        &overview,
    )?;
    let args = vec![
        "serve".into(),
        "--atlas-room-links-manifest".into(),
        parent
            .join("atlas-room-links.json")
            .to_str()
            .unwrap()
            .into(),
        "--atlas-room-links-manifest-sha256".into(),
        sha(&links_bytes),
    ];
    let (remaining, links) =
        ServerAtlasRoomLinksSelection::from_arguments(&args, Some(&scene), Some(&overview))?;
    assert_eq!(remaining, vec!["serve"]);
    let (core, lease) = persistent::reopen(&config)?;
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let atlas_before = fs::read(root.join("data/atlas.sqlite"))?;
    let app = router(host.clone());
    let login = app
        .oneshot(request("POST", "/api/atlas/auth/local", "{}"))
        .await?;
    assert_eq!(login.status(), StatusCode::OK);
    let cookie = login.headers()["set-cookie"]
        .to_str()?
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let session: Value = serde_json::from_slice(&to_bytes(login.into_body(), 4096).await?)?;
    assert_eq!(session["actorId"], id(5));
    let get = |path: &str| {
        let mut r = request("GET", path, "");
        r.headers_mut().insert("cookie", cookie.parse().unwrap());
        r
    };
    let host = host
        .with_model_overview(overview)?
        .with_atlas_scene(scene)?;
    let app = router(host.clone());
    let descriptor_path = format!(
        "/api/atlas/models/v1/workspaces/{}/homes/{}/atlas",
        id(2),
        id(3)
    );
    let response = app.clone().oneshot(get(&descriptor_path)).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let revision = response.headers()["x-atlas-selection-revision"]
        .to_str()?
        .to_owned();
    let descriptor_bytes = to_bytes(response.into_body(), 1024 * 1024).await?;
    let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
    assert_eq!(
        descriptor["rooms"][0]["nativeBinding"]["status"],
        "historical"
    );
    assert!(descriptor.get("roomLinks").is_none());
    let path = format!(
        "{}/{}/room-links?expectedSemanticsSha256={}&expectedSelectionRevision={}",
        descriptor_path,
        id(6),
        sha(&companion),
        revision
    );
    // Ordinary absence is a supported configuration, after genuine native Read.
    let response = app.oneshot(get(&path)).await?;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let app = router(host.with_atlas_room_links(links.unwrap())?);
    for _ in 0..2 {
        let response = app.clone().oneshot(get(&path)).await?;
        assert_eq!(response.status(), StatusCode::OK);
        for (key, value) in [
            ("content-type", "application/json".to_owned()),
            ("content-length", links_bytes.len().to_string()),
            (
                "content-digest",
                format!(
                    "sha-256=:{}:",
                    STANDARD.encode(Sha256::digest(&links_bytes))
                ),
            ),
            ("x-atlas-selection-revision", revision.clone()),
            ("cache-control", "private, no-store".to_owned()),
            ("x-content-type-options", "nosniff".to_owned()),
        ] {
            assert_eq!(response.headers()[key].to_str()?, value);
        }
        assert_eq!(
            to_bytes(response.into_body(), 1024 * 1024).await?.as_ref(),
            links_bytes.as_slice()
        );
    }
    let response = app.oneshot(get(&descriptor_path)).await?;
    assert_eq!(
        to_bytes(response.into_body(), 1024 * 1024).await?,
        descriptor_bytes
    );
    assert_eq!(fs::read(root.join("data/atlas.sqlite"))?, atlas_before);
    assert_eq!(fs::read(root.join("data/server-state.json"))?, receipt);
    assert_eq!(fs::read(root.join("server.json"))?, config_bytes);
    for (name, bytes) in [
        ("overview.glb", glb.as_slice()),
        ("publication.json", overview_bytes.as_slice()),
        ("atlas-scene.json", companion.as_slice()),
        ("atlas-room-links.json", links_bytes.as_slice()),
    ] {
        assert_eq!(fs::read(parent.join(name))?, bytes);
    }
    drop(lease);
    println!(
        "PASS generated independent room-link read: actual native session/Read pre/final; absent opt-in then exact raw JSON/hash/length/selection headers twice; unchanged descriptor, producer historical status, config, Atlas and receipt/source bytes. No current-native claim, import, listener, provider, household data or held probes."
    );
    Ok(())
}
