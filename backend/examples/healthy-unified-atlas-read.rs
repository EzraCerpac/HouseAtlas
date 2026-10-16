//! Positive unified source publication through actual Read/Media/session owners.
//! No listener, provider, private household input, denial or lifecycle probes.
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
#[path = "support/unified_atlas_fixture.rs"]
mod fixture;
use houseatlas_backend::{
    config::{
        atlas_scene::ServerAtlasSceneSelection, model_overview::ServerModelOverviewSelection,
        server::ServerConfig,
    },
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
    let (glb, manifest, companion) =
        fixture::generate(json!({"workspaceId":id(2),"homeId":id(3)}), id(6));
    private(&publication_dir.join("overview.glb"), &glb)?;
    private(&publication_dir.join("atlas-scene.json"), &companion)?;
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
    let atlas_args = vec![
        "serve".into(),
        "--atlas-scene-manifest".into(),
        publication_dir
            .join("atlas-scene.json")
            .to_str()
            .unwrap()
            .into(),
        "--atlas-scene-manifest-sha256".into(),
        sha(&companion),
    ];
    let (remaining, atlas) =
        ServerAtlasSceneSelection::from_arguments(&atlas_args, Some(&selection))?;
    assert_eq!(remaining, vec!["serve"]);
    let atlas = atlas.unwrap();
    selection.validate_config(&config)?;
    let (core, lease) = persistent::reopen(&config)?;
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let atlas_before = fs::read(root.join("data/atlas.sqlite"))?;
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
    let app = router(
        host.with_model_overview(selection)?
            .with_atlas_scene(atlas)?,
    );
    for path in [
        "/api/atlas/view".to_owned(),
        format!("/api/atlas/homes/{}/{}/view", id(2), id(3)),
    ] {
        let response = app.clone().oneshot(get(&path)).await?;
        assert_eq!(response.status(), StatusCode::OK);
        let view: Value = serde_json::from_slice(&to_bytes(response.into_body(), 100000).await?)?;
        assert!(view.get("atlasSceneService").is_none());
        assert_eq!(view["modelOverviewService"]["available"], true);
    }
    let path = format!(
        "/api/atlas/models/v1/workspaces/{}/homes/{}/atlas",
        id(2),
        id(3)
    );
    let response = app.clone().oneshot(get(&path)).await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    let revision = response.headers()["x-atlas-selection-revision"]
        .to_str()?
        .to_owned();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await?;
    let descriptor: Value = serde_json::from_slice(&bytes)?;
    assert_eq!(descriptor["profile"], "houseatlas.unified-atlas-scene.v1");
    assert_eq!(descriptor["selection"]["revision"], revision);
    assert_eq!(
        descriptor["publication"]["semanticsSha256"],
        sha(&companion)
    );
    let producer: Value = serde_json::from_slice(&companion)?;
    for key in [
        "scope",
        "frame",
        "buildings",
        "levels",
        "rooms",
        "occurrences",
        "meshBindings",
        "plans",
        "overlayBindings",
        "coverage",
    ] {
        assert_eq!(descriptor[key], producer[key]);
    }
    assert_eq!(
        descriptor["rooms"][0]["occurrenceIds"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        descriptor["occurrences"][1]["geometryBasis"]["kind"],
        "owner-estimated-pick-proxy"
    );
    assert_eq!(descriptor["meshBindings"][3]["role"], "structure");
    assert_eq!(
        descriptor["meshBindings"][3]["levelIds"],
        json!(["lower", "upper"])
    );
    assert!(descriptor["meshBindings"][3]["spaceOccurrenceId"].is_null());
    assert_eq!(descriptor["meshBindings"][4]["role"], "slab");
    assert_eq!(descriptor["meshBindings"][4]["levelIds"], json!(["lower"]));
    assert_eq!(descriptor["occurrences"].as_array().unwrap().len(), 4);
    assert_eq!(
        descriptor["meshBindings"][5]["spaceOccurrenceId"],
        "courtyard-upper"
    );
    let courtyard = &descriptor["plans"][1]["features"][1]["polygons"][0];
    assert_eq!(courtyard["outer"].as_array().unwrap().len(), 8);
    assert_eq!(courtyard["holes"].as_array().unwrap().len(), 1);
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(get(descriptor["artifacts"][0]["href"].as_str().unwrap()))
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-atlas-selection-revision"], revision);
        assert_eq!(response.headers()["content-type"], "model/gltf-binary");
        assert_eq!(
            response.headers()["content-length"].to_str()?,
            glb.len().to_string()
        );
        assert_eq!(
            response.headers()["content-digest"].to_str()?,
            format!("sha-256=:{}:", STANDARD.encode(Sha256::digest(&glb)))
        );
        assert_eq!(
            to_bytes(response.into_body(), 100000).await?.as_ref(),
            glb.as_slice()
        );
    }
    let response = app.clone().oneshot(get(&path)).await?;
    assert_eq!(to_bytes(response.into_body(), 1024 * 1024).await?, bytes);
    let overview_path = format!(
        "/api/atlas/models/v1/workspaces/{}/homes/{}/overview",
        id(2),
        id(3)
    );
    let response = app.oneshot(get(&overview_path)).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let old: Value = serde_json::from_slice(&to_bytes(response.into_body(), 100000).await?)?;
    assert_eq!(old.as_object().unwrap().len(), 10);
    assert!(old.get("atlasSceneService").is_none());
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if !args.is_empty() {
        if args.len() != 2 || args[0] != "--fixture-output" {
            return Err("Use --fixture-output /absolute/new/tmp/directory".into());
        }
        let output = std::path::Path::new(&args[1]);
        if !output.is_absolute()
            || !output.starts_with("/tmp")
            || output
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("Fixture output must be a new canonical /tmp directory".into());
        }
        fs::create_dir(output)?;
        fs::set_permissions(output, fs::Permissions::from_mode(0o700))?;
        for (name, body) in [
            ("overview.glb", glb.as_slice()),
            ("publication.json", manifest.as_slice()),
            ("atlas-scene.json", companion.as_slice()),
            ("scene-response.json", bytes.as_ref()),
        ] {
            private(&output.join(name), body)?;
        }
        println!(
            "Generated fixture {} companionSha256={} modelSha256={}",
            output.display(),
            sha(&companion),
            sha(&glb)
        );
    }
    assert_eq!(fs::read(root.join("data/atlas.sqlite"))?, atlas_before);
    assert_eq!(fs::read(root.join("server.json"))?, config_bytes);
    assert_eq!(fs::read(root.join("data/server-state.json"))?, receipt);
    assert_eq!(
        fs::read(publication_dir.join("atlas-scene.json"))?,
        companion
    );
    assert_eq!(fs::read(manifest_path)?, manifest);
    assert_eq!(fs::read(publication_dir.join("overview.glb"))?, glb);
    drop(lease);
    println!(
        "PASS generated unified scene: actual native session/Read/Media; two levels, logical multi-occurrence room, explicit estimated pick geometry+matching plans; validated normals/indices, single-level slab and shared structure; matching concave courtyard footprint with hole, collinear subdivisions and positive sub-tolerance edges; unchanged current/scoped ReadyView; exact descriptor/publication/selection; repeated original/query/hash/headers; unchanged overview/config/receipt/source bytes. No listener/provider/private household/probe."
    );
    Ok(())
}
