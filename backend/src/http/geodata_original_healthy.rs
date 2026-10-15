//! Healthy generated originals through the real in-process authenticated router.
use crate::{
    config::server::ServerConfig,
    http::{Host, router},
    lifecycle::persistent,
};
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc};
use tower::ServiceExt;
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn request(method: &str, path: &str, body: Vec<u8>, mime: &str) -> Request<Body> {
    let mut r = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", "https://127.0.0.1:48743")
        .header("sec-fetch-site", "same-origin")
        .header("content-type", mime)
        .body(Body::from(body))
        .unwrap();
    r.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
    ));
    r
}
#[tokio::test]
async fn healthy_native_geodata_original_intake_read_reopen()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
    let (core, lease) = persistent::reopen(&config)?;
    assert_eq!(fs::read(root.join("data/server-state.json"))?, receipt);
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let app = router(host.clone());
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/atlas/auth/mode",
            vec![],
            "application/json",
        ))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let mode: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    assert_eq!(mode, json!({"schemaVersion":1,"mode":"loopback-local"}));
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/atlas/auth/local",
            b"{}".to_vec(),
            "application/json",
        ))
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
    let csrf = info["csrfToken"].as_str().unwrap();
    let mut tiff = b"II\x2a\x00\x08\x00\x00\x00\x02\x00".to_vec();
    for tag in [256u16, 257] {
        tiff.extend(tag.to_le_bytes());
        tiff.extend(3u16.to_le_bytes());
        tiff.extend(1u32.to_le_bytes());
        tiff.extend([1, 0, 0, 0]);
    }
    tiff.extend([0, 0, 0, 0]);
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(&[20, 40, 60, 255])?;
    }
    let sources = [
        ("image/png", "synthetic-catalogue.png", png_bytes),
        (
            "application/pdf",
            "synthetic-catalogue.pdf",
            b"%PDF-1.7\nGenerated catalogue framing example\n%%EOF\n".to_vec(),
        ),
        ("image/tiff", "synthetic.tif", tiff),
        (
            "application/geo+json",
            "synthetic.geojson",
            br#"{"type":"FeatureCollection","features":[]}"#.to_vec(),
        ),
        (
            "application/city+json",
            "synthetic.city.json",
            br#"{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}"#.to_vec(),
        ),
    ];
    let mut retained = Vec::new();
    for (n, (mime, filename, bytes)) in sources.into_iter().enumerate() {
        let metadata = json!({"schemaVersion":1,"requestId":id(100+n as u32*2),
            "idempotencyKey":id(101+n as u32*2),"context":{"workspaceId":id(2),"homeId":id(3)},
            "reason":"Retain generated GIS original", "filename":filename,"contentType":mime,
            "sourceLicense":{"status":"unknown","reference":null}});
        let mut body = format!("--generated-boundary\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n--generated-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n").into_bytes();
        body.extend_from_slice(&bytes);
        body.extend_from_slice(b"\r\n--generated-boundary--\r\n");
        let path = format!(
            "/api/atlas/documents/v1/workspaces/{}/homes/{}/originals",
            id(2),
            id(3)
        );
        let mut req = request(
            "POST",
            &path,
            body,
            "multipart/form-data; boundary=generated-boundary",
        );
        req.headers_mut().insert("cookie", cookie.parse()?);
        req.headers_mut().insert("x-atlas-csrf", csrf.parse()?);
        let response = app.clone().oneshot(req).await?;
        let status = response.status();
        let output: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 128 * 1024).await?)?;
        assert_eq!(status, StatusCode::OK, "{mime}: {output}");
        // Native authorized readback supplies the authoritative immutable asset.
        let records_path = format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}/records/asset",
            id(2),
            id(3)
        );
        let mut req = request("GET", &records_path, vec![], "application/json");
        req.headers_mut().insert("cookie", cookie.parse()?);
        let response = app.clone().oneshot(req).await?;
        let status = response.status();
        let records: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 128 * 1024).await?)?;
        assert_eq!(status, StatusCode::OK, "{records}");
        let text = serde_json::to_string(&records)?;
        assert!(
            text.contains(&crate::media::types::sha256(&bytes)),
            "{records}"
        );
        // Select committed ID from native store, then exercise the existing private download route.
        let core = host.core.lock().unwrap();
        let mut access = core.access.lock().unwrap();
        let native_scope = crate::access::Scope {
            workspace_id: crate::access::CanonicalId::parse(id(2))?,
            home_id: crate::access::CanonicalId::parse(id(3))?,
        };
        let principal = access.authorize(
            &crate::access::RequestEvidence {
                method: crate::access::Method::Get,
                url: "https://127.0.0.1:48743/api/atlas/stock",
                origin: Some("https://127.0.0.1:48743"),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: None,
            },
            &native_scope,
            crate::access::Action::Read,
        )?;
        drop(access);
        let p = crate::app::RequestPrincipal::new(principal);
        let snapshot = core.store.lock().unwrap().read_snapshot(
            &p,
            &crate::storage::Scope {
                workspace_id: id(2),
                home_id: id(3),
            },
        )?;
        let record = snapshot
            .records
            .iter()
            .find(|r| r.payload["sha256"] == crate::media::types::sha256(&bytes))
            .unwrap();
        assert_eq!(record.revision, 1);
        assert_eq!(record.payload["byteSize"], bytes.len());
        assert_eq!(record.payload["contentType"], mime);
        assert_eq!(record.payload["previewPolicy"], "download-only");
        assert_eq!(record.payload["sourceLicense"], metadata["sourceLicense"]);
        let digest = crate::contracts::semantics::canonical_digest(
            &json!({"kind":"atlas-asset","assetId":record.record_id}),
        )?;
        retained.push((
            record.record_id.clone(),
            record.payload.clone(),
            digest.clone(),
            bytes.clone(),
            mime,
        ));
        drop(core);
        let path = format!("/api/atlas/media/{}/{}/{digest}/download", id(2), id(3));
        let mut req = request("GET", &path, vec![], "application/json");
        req.headers_mut().insert("cookie", cookie.parse()?);
        let response = app.clone().oneshot(req).await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], mime);
        assert_eq!(response.headers()["cache-control"], "private, no-store");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert!(
            response.headers()["content-disposition"]
                .to_str()?
                .starts_with("attachment")
        );
        assert_eq!(
            to_bytes(response.into_body(), crate::media::MAX_BYTES)
                .await?
                .as_ref(),
            bytes
        );
    }
    drop(app);
    drop(host);
    drop(lease);
    let (core, _lease) = persistent::reopen(&config)?;
    assert_eq!(retained.len(), 5);
    let host = Host::new(
        core,
        config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?
    .with_loopback_local()?;
    let reopened = router(host);
    for (asset_id, payload, digest, bytes, mime) in retained {
        let path = format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}/records/asset/{asset_id}",
            id(2),
            id(3)
        );
        let mut req = request("GET", &path, vec![], "application/json");
        req.headers_mut().insert("cookie", cookie.parse()?);
        let response = reopened.clone().oneshot(req).await?;
        assert_eq!(response.status(), StatusCode::OK);
        let output: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 128 * 1024).await?)?;
        assert!(serde_json::to_string(&output)?.contains(payload["sha256"].as_str().unwrap()));
        let path = format!("/api/atlas/media/{}/{}/{digest}/download", id(2), id(3));
        let mut req = request("GET", &path, vec![], "application/json");
        req.headers_mut().insert("cookie", cookie.parse()?);
        let response = reopened.clone().oneshot(req).await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], mime);
        assert_eq!(
            to_bytes(response.into_body(), crate::media::MAX_BYTES)
                .await?
                .as_ref(),
            bytes
        );
    }
    Ok(())
}
