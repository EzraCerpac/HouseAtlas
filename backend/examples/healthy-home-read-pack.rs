//! Generated coherent home read packs through real native owners and in-process GETs.
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
#[path = "support/unified_atlas_fixture.rs"]
mod fixture;
#[path = "support/home_read_pack_geometry.rs"]
mod scan_fixture;
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
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Separate generated positive, held for exact-source review and release.
    // The existing baseline and fixture-output entry paths stay unchanged.
    if args.as_slice() == ["--retained-identity-bodies"] {
        return retained_identity_bodies_positive().await;
    }
    let output = match args.as_slice() {
        [] => None,
        [flag, path] if flag == "--fixture-output" => {
            let path = std::path::PathBuf::from(path);
            assert!(path.is_absolute() && !path.exists());
            let path = fs::canonicalize(path.parent().unwrap())?.join(path.file_name().unwrap());
            fs::create_dir(&path)?;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
            Some(path)
        }
        _ => return Err("Use only --fixture-output with a fresh absolute directory".into()),
    };
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
    let mut producer: Value = serde_json::from_slice(&companion)?;
    producer["rooms"][0]["nativePlaceId"] = json!(id(7));
    producer["rooms"][0]["nativeBinding"]["status"] = json!("historical");
    producer["overlayBindings"][0]["nativePlaceId"] = json!(id(7));
    let mut companion = serde_json::to_vec(&producer)?;
    // Valid generated whitespace exercises exact companion bytes above the
    // generic 8 MiB section parser bound, without inventing model geometry.
    companion.resize(8 * 1024 * 1024 + 17, b' ');
    let links = serde_json::to_vec_pretty(
        &json!({"profile":"houseatlas.unified-atlas-room-links.v1",
        "workspaceId":id(2),"homeId":id(3),"publicationId":id(6),"semanticsSha256":sha(&companion),
        "links":[{"roomId":"hall","nativePlaceId":id(7),"packagePlaceKey":"generated:hall","packagePlaceUuid":id(8)}]}),
    )?;
    private(&publication_dir.join("overview.glb"), &glb)?;
    private(&publication_dir.join("atlas-scene.json"), &companion)?;
    private(&publication_dir.join("atlas-room-links.json"), &links)?;
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
    let core_owner = host.core.clone();
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
    seed_records(&ordinary, &cookie, session["csrfToken"].as_str().unwrap()).await?;
    scan_fixture::seed(&ordinary, &cookie, session["csrfToken"].as_str().unwrap()).await?;
    let source_before = database_bytes(&root.join("data"))?;
    verify_pack(&ordinary, &cookie, false, false, false, output.as_deref()).await?;
    let response = ordinary.oneshot(get("/api/atlas/view")).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let v: Value = serde_json::from_slice(&to_bytes(response.into_body(), 100000).await?)?;
    assert_eq!(v["modelOverviewService"]["available"], false);
    let app = router(host.clone().with_model_overview(selection)?);
    verify_pack(&app, &cookie, true, false, false, output.as_deref()).await?;
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
    assert_eq!(
        descriptor["sourceNote"],
        serde_json::from_slice::<Value>(&manifest)?["sourceNote"]
    );
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
    let (_, overview) = ServerModelOverviewSelection::from_arguments(&args)?;
    let overview = overview.unwrap();
    let scene = ServerAtlasSceneSelection::read_pinned(
        &publication_dir.join("atlas-scene.json"),
        &sha(&companion),
        &overview,
    )?;
    let mapping = ServerAtlasRoomLinksSelection::read_pinned(
        &publication_dir.join("atlas-room-links.json"),
        &sha(&links),
        &scene,
        &overview,
    )?;
    let unified = router(
        host.with_model_overview(overview)?
            .with_atlas_scene(scene)?
            .with_atlas_room_links(mapping)?,
    );
    verify_pack(&unified, &cookie, true, false, true, output.as_deref()).await?;
    drop(unified);
    assert_eq!(database_bytes(&root.join("data"))?, source_before);
    assert_eq!(
        fs::read(publication_dir.join("atlas-scene.json"))?,
        companion
    );
    assert_eq!(
        fs::read(publication_dir.join("atlas-room-links.json"))?,
        links
    );
    assert_eq!(fs::read(root.join("server.json"))?, config_bytes);
    assert_eq!(fs::read(root.join("data/server-state.json"))?, receipt);
    assert_eq!(fs::read(manifest_path)?, manifest);
    assert_eq!(fs::read(publication_dir.join("overview.glb"))?, glb);
    let access = core_owner.lock().unwrap().access.clone();
    let vault = core_owner.lock().unwrap().vault.clone();
    drop(core_owner);
    drop(lease);
    let (_, selected_again) = ServerModelOverviewSelection::from_arguments(&args)?;
    full_pack(
        &root,
        access,
        vault,
        &cookie,
        session["csrfToken"].as_str().unwrap(),
        selected_again.unwrap(),
        output.as_deref(),
    )
    .await?;
    println!(
        "PASS generated home read packs: ordinary native records, full selected GLB, same-dataset source Document, immutable manifests/resources/ranges/digests, current native Read/Media/session and original source-policy owners. No listener, provider or private household input."
    );
    Ok(())
}

// PREPARED ONLY: do not execute until independent review separately releases
// this exact source and command:
// cargo run --offline --locked -p houseatlas-backend --example healthy-home-read-pack -- --retained-identity-bodies
async fn retained_identity_bodies_positive() -> Outcome<()> {
    use houseatlas_backend::contracts::v2;
    use rusqlite::params;
    #[derive(serde::Deserialize)]
    struct LexicalRevision {
        revision: Box<serde_json::value::RawValue>,
    }
    #[derive(serde::Deserialize)]
    struct LexicalMembers {
        members: Vec<LexicalRevision>,
    }
    #[derive(serde::Deserialize)]
    struct LexicalAtlas {
        #[serde(rename = "retainedIdentityBodies")]
        bodies: LexicalMembers,
    }
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let config_bytes = serde_json::to_vec(&json!({"schemaVersion":1,"deploymentId":id(1),
        "dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),
        "frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused.pem"),
        "tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743",
        "origin":"https://127.0.0.1:48743","homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
            "userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}}}))?;
    let config: ServerConfig = serde_json::from_slice(&config_bytes)?;
    persistent::initialize_without_password(&config)?;
    let (core, _lease) = persistent::reopen(&config)?;
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let app = router(host);
    let response = app
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
    let session = v2::parse_value(&to_bytes(response.into_body(), 4096).await?)?;
    let csrf = session["csrfToken"].as_str().unwrap();
    seed_records(&app, &cookie, csrf).await?;
    // Create valid identities through the existing native mutation owner in
    // deliberately non-key order. No referenced evidence is added by capture.
    for n in [305, 303, 304] {
        let body = json!({"schemaVersion":1,"mutationId":id(n+10000),"operation":"create",
            "expectedRevision":null,"reason":"Generated retained identity positive","guards":[],
            "value":{"recordType":"identity","payload":{"kind":"item","evidenceIds":[]}}});
        let path = format!(
            "/api/atlas/v1/workspaces/{}/homes/{}/records/identity/{}/mutations",
            id(2),
            id(3),
            id(n)
        );
        let mut req = request("POST", &path, &serde_json::to_string(&body)?);
        req.headers_mut().insert("cookie", cookie.parse()?);
        req.headers_mut().insert("x-atlas-csrf", csrf.parse()?);
        let response = app.clone().oneshot(req).await?;
        assert_eq!(response.status(), StatusCode::OK);
    }
    let db = rusqlite::Connection::open(root.join("data/atlas.sqlite"))?;
    let mut originals = BTreeMap::new();
    // Synthetic setup only: select valid retained encodings and a large SQL
    // revision without billions of mutations. This is not an audit-history or
    // recovery qualification. All setup finishes before read-only observation.
    for (n, revision, token) in [
        (305, 1u64, "10e-1"),
        (101, 1, "1.0"),
        (304, 9_007_199_254_740_991, "90071992547409910e-1"),
        (303, 1, "1E+0"),
    ] {
        let body: String = db.query_row(
            "SELECT body FROM records WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3",
            params![id(2), id(3), id(n)],
            |r| r.get(0),
        )?;
        let mut value = v2::parse_value(body.as_bytes())?;
        value["revision"] = json!(revision);
        v2::validate_value("identityRecord", &value)?;
        let encoded = serde_json::to_string_pretty(&value)?.replace(
            &format!("\"revision\": {revision}"),
            &format!("\"revision\": {token}"),
        );
        let mut body = format!("\n\t{encoded}\r\n").into_bytes();
        if n == 303 {
            body.resize(1024 * 1024, b' ');
        }
        assert_eq!(db.execute("UPDATE records SET revision=?1,body=?2 WHERE workspace_id=?3 AND home_id=?4 AND record_type='identity' AND record_id=?5",
            params![revision as i64,std::str::from_utf8(&body)?,id(2),id(3),id(n)])?,1);
        originals.insert(id(n), (revision, token.to_owned(), body));
    }
    let logical_rows = || -> Outcome<Vec<(String, String, i64, String)>> {
        Ok(db
            .prepare("SELECT record_type,record_id,revision,body FROM records ORDER BY record_id")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    };
    let before_rows = logical_rows()?;
    let before_files = database_bytes(&root.join("data"))?;
    let before_changes = db.total_changes();
    let before_version: i64 = db.pragma_query_value(None, "data_version", |r| r.get(0))?;
    let get = |path: &str| {
        let mut req = request("GET", path, "");
        req.headers_mut().insert("cookie", cookie.parse().unwrap());
        req
    };
    let base = format!("/api/atlas/offline/v1/workspaces/{}/homes/{}", id(2), id(3));
    let mut prior_descriptor = None;
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(get(&format!("{base}/manifest")))
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let manifest_bytes = to_bytes(response.into_body(), 1024 * 1024).await?;
        let manifest = v2::parse_value(&manifest_bytes)?;
        assert_eq!(manifest["completeness"], "complete");
        assert_eq!(manifest["sections"]["atlas"]["state"], "complete");
        assert_eq!(manifest["sections"]["atlas"]["requiredBytesComplete"], true);
        assert!(manifest["exclusions"].as_array().unwrap().is_empty());
        let resources = manifest["resources"].as_array().unwrap();
        let atlas_resource = resources
            .iter()
            .find(|r| r["sha256"] == manifest["sections"]["atlas"]["resourceSha256"])
            .unwrap();
        let response = app
            .clone()
            .oneshot(get(atlas_resource["href"].as_str().unwrap()))
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let atlas_bytes = to_bytes(response.into_body(), 4 * 1024 * 1024).await?;
        assert_eq!(sha(&atlas_bytes), atlas_resource["sha256"]);
        let atlas = v2::parse_value(&atlas_bytes)?;
        let lexical: LexicalAtlas = serde_json::from_slice(&atlas_bytes)?;
        let descriptor = &atlas["retainedIdentityBodies"];
        assert_eq!(
            descriptor["profile"],
            "houseatlas.home-read-pack.retained-identity-bodies.v1"
        );
        let aggregates = resources
            .iter()
            .filter(|r| r["sha256"] == descriptor["resourceSha256"])
            .collect::<Vec<_>>();
        assert_eq!(aggregates.len(), 1);
        let aggregate = aggregates[0];
        assert_eq!(aggregate["section"], "atlas");
        assert_eq!(aggregate["role"], "original");
        assert_eq!(aggregate["contentType"], "application/octet-stream");
        assert!(aggregate["record"].is_null());
        assert_eq!(descriptor["resourceSha256"], aggregate["sha256"]);
        assert_eq!(descriptor["bytes"], aggregate["bytes"]);
        assert!(descriptor["omissions"].as_array().unwrap().is_empty());
        let response = app
            .clone()
            .oneshot(get(aggregate["href"].as_str().unwrap()))
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["content-type"],
            "application/octet-stream"
        );
        let body = to_bytes(response.into_body(), 2 * 1024 * 1024).await?;
        let expected = originals
            .values()
            .flat_map(|(_, _, b)| b.iter().copied())
            .collect::<Vec<_>>();
        assert_eq!(body.as_ref(), expected);
        assert_eq!(sha(&expected), aggregate["sha256"]);
        assert_eq!(sha(&body), descriptor["resourceSha256"]);
        assert_eq!(body.len() as u64, descriptor["bytes"].as_u64().unwrap());
        let members = descriptor["members"].as_array().unwrap();
        assert_eq!(members.len(), originals.len());
        assert_eq!(lexical.bodies.members.len(), members.len());
        let mut offset = 0usize;
        for ((member, raw), (id, (revision, token, original))) in
            members.iter().zip(&lexical.bodies.members).zip(&originals)
        {
            assert_eq!(member["workspaceId"], config.homes[0].workspace_id.as_str());
            assert_eq!(member["homeId"], config.homes[0].home_id.as_str());
            assert_eq!(member["recordType"], "identity");
            assert_eq!(member["recordId"], *id);
            assert_eq!(raw.revision.get(), token);
            assert_eq!(member["offset"].as_u64(), Some(offset as u64));
            assert_eq!(member["bytes"].as_u64(), Some(original.len() as u64));
            let slice = &body[offset..offset + original.len()];
            assert_eq!(slice, original);
            assert_eq!(sha(slice), member["sha256"]);
            assert_eq!(sha(original), member["sha256"]);
            let mut parsed = v2::parse_value(slice)?;
            parsed["revision"] = json!(revision);
            let projected = atlas["records"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["recordId"] == *id)
                .unwrap();
            assert_eq!(&parsed, projected);
            offset += original.len();
        }
        assert_eq!(offset, body.len());
        if let Some(prior) = &prior_descriptor {
            assert_eq!(descriptor, prior);
        }
        prior_descriptor = Some(descriptor.clone());
        let retained = format!(
            "{base}/snapshots/{}/manifest",
            manifest["snapshotId"].as_str().unwrap()
        );
        let response = app.clone().oneshot(get(&retained)).await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(response.into_body(), 1024 * 1024).await?,
            manifest_bytes
        );
    }
    assert_eq!(logical_rows()?, before_rows);
    assert_eq!(database_bytes(&root.join("data"))?, before_files);
    assert_eq!(db.total_changes(), before_changes);
    assert_eq!(
        db.pragma_query_value(None, "data_version", |r| r.get::<_, i64>(0))?,
        before_version
    );
    println!(
        "PASS generated retained identity bodies: exact stored/member bytes, independent hashes, ordered closure, original numeric revisions and unchanged read-only cut. Audit history and recovery are not qualified."
    );
    Ok(())
}
type Outcome<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
async fn seed_records(app: &axum::Router, cookie: &str, csrf: &str) -> Outcome<()> {
    let evidence = json!({"statement":"Generated offline reading building","provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,"evidenceBasis":"owner-report","factAt":null,"retrievedAt":"2026-10-16T00:00:00Z","vantage":null,"uncertainty":{"status":"unknown","explanation":null}},"supersedesEvidenceIds":[],"references":[]});
    for (index,(kind,n,payload,guards)) in [
        ("evidence",100,evidence,vec![]),
        ("identity",101,json!({"kind":"location","evidenceIds":[id(100)]}),vec![json!({"record":{"recordType":"evidence","recordId":id(100)},"expectedRevision":1})]),
        ("location-semantics",201,json!({"atlasId":id(101),"semanticKind":"building","label":"Synthetic saved building","reviewStatus":"accepted","evidenceIds":[id(100)]}),vec![json!({"record":{"recordType":"identity","recordId":id(101)},"expectedRevision":1}),json!({"record":{"recordType":"evidence","recordId":id(100)},"expectedRevision":1})]),
    ].into_iter().enumerate() {
        let path=format!("/api/atlas/v1/workspaces/{}/homes/{}/records/{kind}/{}/mutations",id(2),id(3),id(n));
        let body=json!({"schemaVersion":1,"mutationId":id(1000+index as u32),"operation":"create","expectedRevision":null,"reason":"Generated healthy home-read capture","guards":guards,"value":{"recordType":kind,"payload":payload}});
        let mut req=request("POST",&path,&serde_json::to_string(&body)?);req.headers_mut().insert("cookie",cookie.parse()?);req.headers_mut().insert("x-atlas-csrf",csrf.parse()?);
        let response=app.clone().oneshot(req).await?;let status=response.status();let bytes=to_bytes(response.into_body(),100000).await?;
        assert_eq!(status,StatusCode::OK,"{}",String::from_utf8_lossy(&bytes));
    }
    let metadata = json!({"schemaVersion":1,"requestId":id(2000),"idempotencyKey":id(2001),"context":{"workspaceId":id(2),"homeId":id(3)},"reason":"Generated ordinary native original for read pack","filename":"generated.txt","contentType":"text/plain","sourceLicense":{"status":"unknown","reference":null}});
    let body = format!(
        "--synthetic-boundary\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{}\r\n--synthetic-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"generated.txt\"\r\nContent-Type: text/plain\r\n\r\nGenerated native offline original.\r\n--synthetic-boundary--\r\n",
        metadata
    );
    let mut req = request(
        "POST",
        &format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}/assets",
            id(2),
            id(3)
        ),
        &body,
    );
    req.headers_mut().insert(
        "content-type",
        "multipart/form-data; boundary=synthetic-boundary".parse()?,
    );
    req.headers_mut().insert("cookie", cookie.parse()?);
    req.headers_mut().insert("x-atlas-csrf", csrf.parse()?);
    let response = app.clone().oneshot(req).await?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100000).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    Ok(())
}
async fn verify_pack(
    app: &axum::Router,
    cookie: &str,
    model: bool,
    documents: bool,
    unified: bool,
    output: Option<&std::path::Path>,
) -> Outcome<()> {
    let get = |path: &str| {
        let mut r = request("GET", path, "");
        r.headers_mut().insert("cookie", cookie.parse().unwrap());
        r
    };
    let base = format!("/api/atlas/offline/v1/workspaces/{}/homes/{}", id(2), id(3));
    let result = app
        .clone()
        .oneshot(get(&format!("{base}/manifest")))
        .await?;
    let status = result.status();
    let bytes = to_bytes(result.into_body(), 1024 * 1024).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    let manifest: Value = serde_json::from_slice(&bytes)?;
    assert_eq!(manifest["profile"], "houseatlas.home-read-pack.v1");
    assert_eq!(
        manifest["completeness"],
        if model && !unified {
            "partial"
        } else {
            "complete"
        }
    );
    if model && !unified {
        assert!(
            manifest["exclusions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["code"] == "unified-atlas-not-configured")
        );
    } else {
        assert!(manifest["exclusions"].as_array().unwrap().is_empty());
    }
    assert_eq!(
        manifest["sections"]["model"]["state"],
        if unified {
            "complete"
        } else if model {
            "partial"
        } else {
            "not-configured"
        }
    );
    assert_eq!(
        manifest["sections"]["documents"]["state"],
        if documents {
            "complete"
        } else {
            "not-configured"
        }
    );
    let fixture = output.map(|root| {
        root.join(if documents {
            "documents"
        } else if unified {
            "unified"
        } else if model {
            "partial"
        } else {
            "records"
        })
    });
    if let Some(root) = &fixture {
        fs::create_dir(root)?;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
        private(&root.join("manifest.json"), &bytes)?;
    }
    let snapshot = manifest["snapshotId"].as_str().unwrap();
    let mut unhashed = manifest.clone();
    unhashed.as_object_mut().unwrap().remove("snapshotId");
    for resource in unhashed["resources"].as_array_mut().unwrap() {
        resource.as_object_mut().unwrap().remove("href");
    }
    assert_eq!(sha(&serde_json::to_vec(&unhashed)?), snapshot);
    let result = app
        .clone()
        .oneshot(get(&format!("{base}/snapshots/{snapshot}/manifest")))
        .await?;
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(to_bytes(result.into_body(), 1024 * 1024).await?, bytes);
    let mut total = 0u64;
    let mut seen = std::collections::BTreeSet::new();
    let mut found_asset = false;
    let mut found_model = false;
    let mut found_document = false;
    let mut found_companion = false;
    let mut found_mapping = false;
    let mut section_model = Value::Null;
    let mut section_documents = Value::Null;
    let mut section_atlas = Value::Null;
    let mut unattributed_atlas_originals = BTreeMap::new();
    for resource in manifest["resources"].as_array().unwrap() {
        let href = resource["href"].as_str().unwrap();
        let hash = resource["sha256"].as_str().unwrap();
        assert!(seen.insert(hash.to_owned()));
        let result = app.clone().oneshot(get(href)).await?;
        assert_eq!(result.status(), StatusCode::OK);
        assert_eq!(
            result.headers()["content-type"].to_str()?,
            resource["contentType"].as_str().unwrap()
        );
        assert_eq!(result.headers()["cache-control"], "private, no-store");
        assert_eq!(result.headers()["x-content-type-options"], "nosniff");
        assert_eq!(result.headers()["x-atlas-offline-resource-sha256"], hash);
        let body = to_bytes(result.into_body(), 16 * 1024 * 1024).await?;
        assert_eq!(sha(&body), hash);
        if let Some(root) = &fixture {
            private(&root.join(hash), &body)?;
        }

        assert_eq!(body.len() as u64, resource["bytes"].as_u64().unwrap());
        total += body.len() as u64;
        if resource["section"] == "atlas"
            && resource["role"] == "original"
            && resource["record"].is_null()
        {
            assert!(
                unattributed_atlas_originals
                    .insert(hash.to_owned(), body.to_vec())
                    .is_none()
            );
        }
        if resource["section"] == "atlas"
            && resource["role"] == "original"
            && resource["record"]["recordType"] == "asset"
        {
            found_asset = true;
            if resource["contentType"] == "text/plain" {
                assert_eq!(body.as_ref(), b"Generated native offline original.");
            }
        }
        if resource["contentType"] == "model/gltf-binary" {
            found_model = true;
        }
        if resource["section"] == "documents" && resource["role"] == "original" {
            found_document = true;
            if resource["contentType"] == "application/json" {
                assert!(String::from_utf8_lossy(&body).contains("12345678901234567890123456.789"));
            }
        }
        if resource["section"] == "model"
            && resource["contentType"] == "application/json"
            && resource["role"] == "model"
        {
            let parsed: Value = serde_json::from_slice(&body)?;
            if parsed["profile"] == "houseatlas.unified-atlas-publication.v1" {
                found_companion = true;
                assert_eq!(body.len(), 8 * 1024 * 1024 + 17);
                assert_eq!(parsed["plans"].as_array().unwrap().len(), 2);
                assert_eq!(
                    parsed["overlayBindings"][0]["sourceRevision"],
                    "generated-documentary-v1"
                );
                assert_eq!(parsed["rooms"][0]["nativeBinding"]["status"], "historical");
            } else {
                assert_eq!(parsed["profile"], "houseatlas.unified-atlas-room-links.v1");
                assert_eq!(parsed["links"][0]["packagePlaceKey"], "generated:hall");
                found_mapping = true;
            }
        }
        if resource["role"] == "section" {
            let section: Value = serde_json::from_slice(&body)?;
            assert!(!String::from_utf8_lossy(&body).contains("storageKey"));
            if resource["section"] == "model" {
                section_model = section.clone();
            }
            if resource["section"] == "documents" {
                section_documents = section.clone();
            }
            if resource["section"] == "atlas" {
                section_atlas = section.clone();
                assert!(section["records"].as_array().unwrap().len() >= 4);
                assert_eq!(
                    section["revisions"].as_array().unwrap().len(),
                    section["records"].as_array().unwrap().len()
                );
            }
        }
        if body.len() > 4 * 1024 * 1024 {
            let mut assembled = Vec::new();
            for start in (0..body.len()).step_by(4 * 1024 * 1024) {
                let end = (start + 4 * 1024 * 1024).min(body.len()) - 1;
                let mut ranged = get(href);
                ranged
                    .headers_mut()
                    .insert("range", format!("bytes={start}-{end}").parse()?);
                let response = app.clone().oneshot(ranged).await?;
                assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
                assert_eq!(
                    response.headers()["content-range"].to_str()?,
                    format!("bytes {start}-{end}/{}", body.len())
                );
                let expected = format!(
                    "sha-256=:{}:",
                    STANDARD.encode(Sha256::digest(&body[start..=end]))
                );
                assert_eq!(response.headers()["content-digest"].to_str()?, expected);
                assembled.extend(to_bytes(response.into_body(), 4 * 1024 * 1024).await?);
            }
            assert_eq!(assembled.as_slice(), body.as_ref());
            assert_eq!(sha(&assembled), hash);
        }
        let end = body.len().min(16) - 1;
        let mut ranged = get(href);
        ranged
            .headers_mut()
            .insert("range", format!("bytes=0-{end}").parse()?);
        let result = app.clone().oneshot(ranged).await?;
        assert_eq!(result.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            result.headers()["content-range"].to_str()?,
            format!("bytes 0-{end}/{}", body.len())
        );
        assert_eq!(
            result.headers()["content-digest"].to_str()?,
            format!(
                "sha-256=:{}:",
                STANDARD.encode(Sha256::digest(&body[..=end]))
            )
        );
        assert_eq!(
            to_bytes(result.into_body(), 1024 * 1024).await?.as_ref(),
            &body[..=end]
        );
    }
    assert_eq!(total, manifest["totals"]["bytes"].as_u64().unwrap());
    assert!(found_asset);
    // The existing records/overview/unified/Documents variants keep their
    // documentary identity projection, with one independently pinned original.
    let retained = &section_atlas["retainedIdentityBodies"];
    assert_eq!(
        retained["profile"],
        "houseatlas.home-read-pack.retained-identity-bodies.v1"
    );
    let identity_hash = retained["resourceSha256"].as_str().unwrap();
    let identity_bytes = unattributed_atlas_originals.remove(identity_hash).unwrap();
    assert!(unattributed_atlas_originals.is_empty());
    let aggregate = manifest["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["sha256"] == identity_hash)
        .unwrap();
    assert_eq!(aggregate["section"], "atlas");
    assert_eq!(aggregate["role"], "original");
    assert_eq!(aggregate["contentType"], "application/octet-stream");
    assert!(aggregate["record"].is_null());
    assert_eq!(sha(&identity_bytes), retained["resourceSha256"]);
    assert_eq!(
        identity_bytes.len() as u64,
        retained["bytes"].as_u64().unwrap()
    );
    assert!(retained["omissions"].as_array().unwrap().is_empty());
    let identities = section_atlas["records"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["recordType"] == "identity")
        .collect::<Vec<_>>();
    let members = retained["members"].as_array().unwrap();
    assert_eq!(members.len(), identities.len());
    assert_eq!(members.len(), 1);
    assert_eq!(members[0]["offset"], 0);
    assert_eq!(members[0]["bytes"], retained["bytes"]);
    assert_eq!(members[0]["sha256"], retained["resourceSha256"]);
    assert_eq!(members[0]["recordId"], identities[0]["recordId"]);
    assert_eq!(members[0]["revision"], identities[0]["revision"]);
    assert_eq!(serde_json::to_vec(identities[0])?, identity_bytes);
    let geometry = &section_atlas["nativeGeometry"][0];
    assert_eq!(geometry["state"], "complete");
    assert_eq!(geometry["physicalScale"], "unknown");
    assert_eq!(geometry["stageToHouseTransform"], Value::Null);
    assert_eq!(geometry["floors"].as_array().unwrap().len(), 1);
    let floor = &geometry["floors"][0];
    for (key, pin) in [
        ("originalResourceSha256", "originalSha256"),
        ("derivativeResourceSha256", "derivativeSha256"),
    ] {
        assert_eq!(floor[key], floor["floor"][pin]);
        assert!(seen.contains(floor[key].as_str().unwrap()));
    }
    assert!(!serde_json::to_string(&section_atlas)?.contains("readPath"));

    assert_eq!(found_model, model);
    assert_eq!(found_document, documents);
    if documents {
        assert_eq!(section_documents["documents"].as_array().unwrap().len(), 2);
        assert_eq!(section_documents["originals"].as_array().unwrap().len(), 2);
        assert_eq!(section_documents["previews"].as_array().unwrap().len(), 1);
        for r in section_documents["originals"]
            .as_array()
            .unwrap()
            .iter()
            .chain(section_documents["previews"].as_array().unwrap())
        {
            assert_eq!(r["availability"], "available");
            assert!(seen.contains(r["resourceSha256"].as_str().unwrap()));
        }
        assert_eq!(
            section_documents["documents"][0]["payload"]["provenance"]["url"],
            "https://source.invalid/original"
        );
    }
    assert_eq!(found_companion, unified);
    assert_eq!(found_mapping, unified);
    if model {
        assert_eq!(
            section_model["profile"],
            "houseatlas.home-read-pack.model.v2"
        );
        assert!(
            seen.contains(
                section_model["overview"]["original"]["resourceSha256"]
                    .as_str()
                    .unwrap()
            )
        );
    }
    if unified {
        let u = &section_model["unifiedAtlas"];
        assert!(seen.contains(u["companion"]["resourceSha256"].as_str().unwrap()));
        assert_eq!(u["companion"]["resourceSha256"], u["semanticsSha256"]);
        assert!(seen.contains(u["originalResourceSha256"].as_str().unwrap()));
        assert!(seen.contains(u["roomLinks"]["resourceSha256"].as_str().unwrap()));
    }
    eprintln!(
        "PASS read-pack closure: model={model}, documents={documents}, unified={unified}, resources={}, bytes={total}",
        seen.len()
    );
    Ok(())
}
async fn full_pack(
    root: &std::path::Path,
    access: houseatlas_backend::app::Access,
    source_vault: Arc<houseatlas_backend::media::AssetVault>,
    cookie: &str,
    csrf: &str,
    model: ServerModelOverviewSelection,
    output: Option<&std::path::Path>,
) -> Outcome<()> {
    use houseatlas_backend::{
        app, domain::stock::NativeStockContract, http::contracts::NativeContracts,
        lifecycle::backup, media, storage as s,
    };
    use s::{geodata::GeodataOwners, geodata_policy::PinnedGeodataSourcePolicy};
    let predecessor = root.join("data/atlas.sqlite");
    let db = rusqlite::Connection::open(&predecessor)?;
    db.pragma_update(None, "journal_mode", "DELETE")?;
    db.close().map_err(|(_, e)| e)?;
    let before = fs::read(&predecessor)?;
    let original=br#"{"sourceValue":12345678901234567890123456.789,"label":"Generated documentary original"}"#;
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()?
            .write_image_data(&[20, 40, 60, 255])?;
    }
    let provenance = json!({"agency":"Generated read-pack source","url":"https://source.invalid/original","license":{"status":"permitted","reference":"CC-BY-4.0"},"retrievedAt":"2026-10-16T00:00:00Z","published":null,"observed":null,"frame":{"crs":null,"axes":[],"linearUnit":null,"extent":null}});
    let mut policy_value = json!({"profile":"houseatlas.reviewed-document-source-policy.v1","scope":{"workspaceId":id(2),"homeId":id(3)},"sourceManifestSha256":sha(b"Generated read pack source receipt"),"documents":[{"documentId":id(8101),"original":{"assetId":id(8102),"revision":1,"sha256":sha(original),"bytes":original.len()},"contentType":"application/json","provenance":provenance}]});
    policy_value["documents"].as_array_mut().unwrap().push(json!({"documentId":id(8201),
        "original":{"assetId":id(8202),"revision":1,"sha256":sha(&png_bytes),"bytes":png_bytes.len()},
        "contentType":"image/png","provenance":provenance}));
    let policy = Arc::new(PinnedGeodataSourcePolicy::decode_reviewed(
        &serde_json::to_vec(&policy_value)?,
    )?);
    let owners = GeodataOwners::new(access.clone(), source_vault, policy.clone());
    let queue = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
    let stock = NativeStockContract::new()?;
    let peers = s::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &queue,
        evidence: &queue,
    };
    let destination = root.join("generated-full");
    s::geodata_full::copy_v5_to_full(
        &predecessor,
        &destination,
        &sha(&before),
        &NativeContracts,
        &peers,
        &owners,
        &mut || Ok(()),
    )?;
    assert_eq!(fs::read(&predecessor)?, before);
    let vault = Arc::new(media::AssetVault::open_existing(
        &destination.join("media"),
    )?);
    let owners = GeodataOwners::new(access.clone(), vault.clone(), policy);
    let store = app::Store::open_existing_geodata_full(
        &destination.join("atlas.sqlite"),
        NativeContracts,
        app::ReadAuthority(access.clone()),
        media::native::NativeMediaRuntime {
            vault: vault.clone(),
            server: app::ServerRuntime,
        },
        s::StoreOptions::default(),
        owners,
        &peers,
        &mut || Ok(()),
    )?;
    let home = houseatlas_backend::domain::HomeSummary {
        scope: houseatlas_backend::domain::Scope {
            workspace_id: id(2),
            home_id: id(3),
        },
        label: "Synthetic Home".into(),
    };
    let core = app::Core {
        access,
        store: Arc::new(std::sync::Mutex::new(store)),
        vault,
        home: home.clone(),
        homes: vec![home],
        atlas_list_pages: Default::default(),
        media_policy_evidence: Default::default(),
    };
    let parent = root.join("publication");
    let scene = ServerAtlasSceneSelection::read_pinned(
        &parent.join("atlas-scene.json"),
        &sha(&fs::read(parent.join("atlas-scene.json"))?),
        &model,
    )?;
    let mapping = ServerAtlasRoomLinksSelection::read_pinned(
        &parent.join("atlas-room-links.json"),
        &sha(&fs::read(parent.join("atlas-room-links.json"))?),
        &scene,
        &model,
    )?;
    let host = Host::new(
        core,
        "https://127.0.0.1:48743".into(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?
    .with_full_geodata()?
    .with_model_overview(model)?;
    let app = router(
        host.with_atlas_scene(scene)?
            .with_atlas_room_links(mapping)?,
    );
    let body = json!({"request":{"mutationId":id(8100),"documentId":id(8101),"assetId":id(8102),"title":"Synthetic offline Document","contentType":"application/json","provenance":provenance,"reason":"Generated healthy retained read-pack original"},"originalBase64":STANDARD.encode(original)});
    let mut req = request(
        "POST",
        &format!(
            "/api/atlas/documents/v2/workspaces/{}/homes/{}/documents",
            id(2),
            id(3)
        ),
        &serde_json::to_string(&body)?,
    );
    req.headers_mut().insert("cookie", cookie.parse()?);
    req.headers_mut().insert("x-atlas-csrf", csrf.parse()?);
    let result = app.clone().oneshot(req).await?;
    let status = result.status();
    let bytes = to_bytes(result.into_body(), 1024 * 1024).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    let body = json!({"request":{"mutationId":id(8200),"documentId":id(8201),"assetId":id(8202),
        "title":"Synthetic preview Document","contentType":"image/png","provenance":provenance,
        "reason":"Generated healthy read-pack preview closure"},"originalBase64":STANDARD.encode(&png_bytes)});
    let mut req = request(
        "POST",
        &format!(
            "/api/atlas/documents/v2/workspaces/{}/homes/{}/documents",
            id(2),
            id(3)
        ),
        &serde_json::to_string(&body)?,
    );
    req.headers_mut().insert("cookie", cookie.parse()?);
    req.headers_mut().insert("x-atlas-csrf", csrf.parse()?);
    let result = app.clone().oneshot(req).await?;
    let status = result.status();
    let bytes = to_bytes(result.into_body(), 1024 * 1024).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    let before = database_bytes(&destination)?;
    verify_pack(&app, cookie, true, true, true, output).await?;
    assert_eq!(database_bytes(&destination)?, before);
    Ok(())
}

fn database_bytes(root: &std::path::Path) -> Outcome<Vec<Option<Vec<u8>>>> {
    ["atlas.sqlite", "atlas.sqlite-wal"]
        .into_iter()
        .map(|name| {
            let path = root.join(name);
            Ok(if path.exists() {
                Some(fs::read(path)?)
            } else {
                None
            })
        })
        .collect()
}
