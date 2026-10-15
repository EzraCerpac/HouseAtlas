//! Disposable synthetic fixture, actual native sessions and in-process v2 HTTP.
//! No listener/provider/household source/renderer/converter/deployment.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use base64::Engine;
use houseatlas_backend::{
    access as a, app,
    config::server::ServerConfig,
    http::{Host, router},
    lifecycle::persistent,
    media as m,
    storage::{
        self as s,
        geodata::{GeodataSourcePolicy, GeodataStore},
    },
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc,
    time::Duration,
};
use tower::ServiceExt;
type Any = Box<dyn std::error::Error + Send + Sync>;
const ORIGIN: &str = "https://127.0.0.1:48743";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
struct SyntheticSourcePolicy {
    pins: BTreeMap<String, String>,
}
impl GeodataSourcePolicy for SyntheticSourcePolicy {
    fn authorize(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        d: &Value,
        _mutation: bool,
    ) -> s::Result<()> {
        let p = guard.principal();
        let pin = &d["payload"]["original"];
        if self
            .pins
            .get(pin["assetId"].as_str().unwrap_or(""))
            .is_some_and(|hash| pin["sha256"] == *hash)
            && pin["revision"] == 1
            && p.scope().workspace_id.as_str() == id(2)
            && p.scope().home_id.as_str() == id(3)
            && d["workspaceId"] == id(2)
            && d["homeId"] == id(3)
            && d["payload"]["provenance"]["url"]
                == "https://example.invalid/generated.geojson?bbox=0,0,1,1&f=json"
        {
            Ok(())
        } else {
            Err(s::Error::new(
                "forbidden",
                "Synthetic fixture policy unavailable",
            ))
        }
    }
}
struct FixtureNativeAuthority<'a>(&'a a::TransactionAuthorization<'a>);
impl s::Authorization for FixtureNativeAuthority<'_> {
    type Principal = app::RequestPrincipal;
    fn authorize(
        &self,
        p: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(self.0.principal(), p.principal.principal())
            || request.capability != s::Capability::Mutate
        {
            return Err(s::Error::new(
                "forbidden",
                "Original fixture native authority required",
            ));
        }
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(request.scope)?)?;
        self.0.authorize(&scope, a::Capability::Mutate)?;
        Ok(s::VerifiedActor {
            workspace_id: request.scope.workspace_id.clone(),
            home_id: request.scope.home_id.clone(),
            actor_id: self.0.principal().actor_id().as_str().into(),
        })
    }
}
fn request(
    method: &str,
    path: &str,
    body: Value,
    cookie: Option<&str>,
    csrf: Option<&str>,
) -> Request<Body> {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json");
    if let Some(c) = cookie {
        b = b.header("cookie", c);
    }
    if let Some(c) = csrf {
        b = b.header("x-atlas-csrf", c);
    }
    let mut r = b
        .body(Body::from(if method == "GET" {
            vec![]
        } else {
            serde_json::to_vec(&body).unwrap()
        }))
        .unwrap();
    r.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
    ));
    r
}
async fn call(
    app: &Router,
    method: &str,
    path: &str,
    body: Value,
    cookie: &str,
    csrf: &str,
) -> Result<Value, Any> {
    let response = app
        .clone()
        .oneshot(request(method, path, body, Some(cookie), Some(csrf)))
        .await?;
    let status = response.status();
    let body = to_bytes(response.into_body(), 2 * 1024 * 1024).await?;
    if status != StatusCode::OK {
        return Err(format!(
            "{method} {path}: {status} {}",
            String::from_utf8_lossy(&body)
        )
        .into());
    }
    Ok(serde_json::from_slice(&body)?)
}
fn fixture_license(n: usize) -> Value {
    match n % 4 {
        0 => json!({"status":"permitted","reference":"CC-BY-4.0"}),
        1 => json!({"status":"permitted","reference":"CC0-1.0"}),
        2 => json!({"status":"permitted","reference":"PDM-1.0"}),
        _ => json!({"status":"unknown","reference":null}),
    }
}
fn generated_sources() -> Result<Vec<(&'static str, Vec<u8>)>, Any> {
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
    Ok(vec![
        (
            "application/json",
            br#"{"agency":"Generated metadata","layers":["sample"]}"#.to_vec(),
        ),
        (
            "application/city+json",
            br#"{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}"#.to_vec(),
        ),
        ("image/tiff", tiff),
        ("image/png", png_bytes),
        (
            "application/pdf",
            b"%PDF-1.7\nGenerated catalogue framing example\n%%EOF\n".to_vec(),
        ),
    ])
}
#[tokio::main]
async fn main() -> Result<(), Any> {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let config: ServerConfig = serde_json::from_value(
        json!({"schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":ORIGIN,"homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],"mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}}}),
    )?;
    persistent::initialize_without_password(&config)?;
    let (core, _lease) = persistent::reopen(&config)?;
    let access = core.access.clone();
    let vault = core.vault.clone();
    let path = root.join("geodata.sqlite");
    let sources = generated_sources()?;
    let mut pins = BTreeMap::from([(
        id(12),
        m::types::sha256(b"{\"type\":\"FeatureCollection\",\"features\":[]}\n"),
    )]);
    for (n, (_, bytes)) in sources.iter().enumerate() {
        pins.insert(id(102 + n as u32 * 3), m::types::sha256(bytes));
    }
    let policy: Arc<dyn GeodataSourcePolicy> = Arc::new(SyntheticSourcePolicy { pins });
    let store = GeodataStore::create_fresh(&path, access.clone(), vault.clone(), policy.clone())?;
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_loopback_local()?
        .with_geodata_dataset(store)?;
    let core = host.core.clone();
    let app = router(host);
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/atlas/auth/local",
            json!({}),
            None,
            None,
        ))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()?
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let session: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    let csrf = session["csrfToken"].as_str().unwrap();
    let base = format!(
        "/api/atlas/documents/v2/workspaces/{}/homes/{}/documents",
        id(2),
        id(3)
    );
    let bytes = b"{\"type\":\"FeatureCollection\",\"features\":[]}\n";
    let provenance = json!({"agency":"Synthetic fixture generator","url":"https://example.invalid/generated.geojson?bbox=0,0,1,1&f=json","license":{"status":"unknown","reference":null},"retrievedAt":"2026-10-15T00:00:00Z","published":{"value":"2026","precision":"year"},"observed":null,"frame":{"crs":null,"axes":[],"linearUnit":null,"extent":null}});
    let input = json!({"request":{"mutationId":id(10),"documentId":id(11),"assetId":id(12),"title":"Synthetic source document","contentType":"application/geo+json","provenance":provenance,"reason":"Retain generated synthetic original"},"originalBase64":base64::engine::general_purpose::STANDARD.encode(bytes)});
    let created = call(&app, "POST", &base, input.clone(), &cookie, csrf).await?;
    let identical = call(&app, "POST", &base, input, &cookie, csrf).await?;
    assert_eq!(created, identical);
    assert_eq!(created["document"]["payload"]["preview"], Value::Null);
    let page = call(
        &app,
        "GET",
        &format!("{base}?limit=1"),
        Value::Null,
        &cookie,
        csrf,
    )
    .await?;
    assert_eq!(page["documents"].as_array().unwrap().len(), 1);
    let get = call(
        &app,
        "GET",
        &format!("{base}/{}", id(11)),
        Value::Null,
        &cookie,
        csrf,
    )
    .await?;
    assert_eq!(get["document"], created["document"]);
    assert_eq!(
        get["availability"],
        json!({"original":"available","preview":"not-qualified"})
    );
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("{base}/{}/original?expectedRevision=1", id(11)),
            Value::Null,
            Some(&cookie),
            None,
        ))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-disposition"],
        "attachment; filename=\"geodata-original\""
    );
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    let frame = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(response.headers()["x-atlas-document-frame"].to_str()?)?;
    let frame: Value = serde_json::from_slice(&frame)?;
    assert_eq!(frame["asset"], created["document"]["payload"]["original"]);
    assert_eq!(
        &to_bytes(response.into_body(), m::MAX_BYTES).await?[..],
        bytes
    );
    let guard = json!({"record":{"recordType":"asset","recordId":id(12)},"expectedRevision":1});
    let mut corrected = created["document"]["payload"].clone();
    corrected["title"] = json!("Synthetic corrected source title");
    let correction = json!({"schemaVersion":1,"mutationId":id(30),"operation":"replace","expectedRevision":1,"reason":"Correct generated display title","guards":[guard.clone()],"value":{"recordType":"geodata-document","payload":corrected}});
    let corrected = call(
        &app,
        "POST",
        &format!("{base}/{}", id(11)),
        correction,
        &cookie,
        csrf,
    )
    .await?;
    assert_eq!(corrected["record"]["revision"], 2);
    let association = json!({"schemaVersion":1,"mutationId":id(31),"operation":"create","expectedRevision":null,"reason":"Associate exact retained synthetic original","guards":[guard],"value":{"recordType":"geodata-document","payload":created["document"]["payload"]}});
    let associated = call(
        &app,
        "POST",
        &format!("{base}/{}", id(32)),
        association,
        &cookie,
        csrf,
    )
    .await?;
    assert_eq!(
        associated["record"]["payload"]["original"],
        created["document"]["payload"]["original"]
    );
    let first = call(
        &app,
        "GET",
        &format!("{base}?limit=1"),
        Value::Null,
        &cookie,
        csrf,
    )
    .await?;
    let cursor = first["nextCursor"]
        .as_str()
        .ok_or("Missing opaque continuation")?;
    assert_eq!(cursor.len(), 64);
    let second = call(
        &app,
        "GET",
        &format!("{base}?limit=1&cursor={cursor}"),
        Value::Null,
        &cookie,
        csrf,
    )
    .await?;
    assert_eq!(second["documents"].as_array().unwrap().len(), 1);
    assert_ne!(
        first["documents"][0]["document"]["recordId"],
        second["documents"][0]["document"]["recordId"]
    );
    for (n, (kind, original)) in sources.into_iter().enumerate() {
        let number = 100 + n as u32 * 3;
        let mut family_provenance = provenance.clone();
        family_provenance["license"] = fixture_license(n);
        let input = json!({"request":{"mutationId":id(number),"documentId":id(number+1),"assetId":id(number+2),"title":"Synthetic source family","contentType":kind,"provenance":family_provenance,"reason":"Retain generated source family"},"originalBase64":base64::engine::general_purpose::STANDARD.encode(&original)});
        let result = call(&app, "POST", &base, input, &cookie, csrf).await?;
        assert_eq!(result["asset"]["payload"]["contentType"], kind);
        assert_eq!(
            result["asset"]["payload"]["sourceLicense"],
            fixture_license(n)
        );
        assert_eq!(
            result["document"]["payload"]["provenance"]["license"],
            fixture_license(n)
        );
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("{base}/{}/original?expectedRevision=1", id(number + 1)),
                Value::Null,
                Some(&cookie),
                None,
            ))
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], kind);
        assert_eq!(
            &to_bytes(response.into_body(), m::MAX_BYTES).await?[..],
            &original
        );
    }
    // Exercise nonempty v1 adapter using original native transaction outcomes,
    // preserving exact original core SQL bodies in this fresh v2 dataset.
    let scope = s::Scope {
        workspace_id: id(2),
        home_id: id(3),
    };
    let p = access.lock().unwrap().authorize(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: ORIGIN,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(&cookie),
            authorization: None,
            csrf: Some(csrf),
        },
        &app::access_scope(&houseatlas_backend::domain::Scope {
            workspace_id: id(2),
            home_id: id(3),
        })?,
        a::Action::Mutate,
    )?;
    let legacy_command = json!({"schemaVersion":1,"mutationId":id(20),"operation":"create","expectedRevision":null,"reason":"Synthetic native v1 identity retained unchanged","guards":[],"value":{"recordType":"identity","payload":{"kind":"location","evidenceIds":[]}}});
    let original = app::RequestPrincipal::new(p);
    access.lock().unwrap().with_mutation_authorization(
        original.principal.principal(),
        |guard| -> s::Result<()> {
            core.lock()
                .unwrap()
                .store
                .lock()
                .unwrap()
                .execute_json_with_authorization(
                    &FixtureNativeAuthority(guard),
                    &original,
                    &scope,
                    &s::RecordRef {
                        record_type: s::RecordType::Identity,
                        record_id: id(21),
                    },
                    &legacy_command,
                )?;
            Ok(())
        },
    )?;
    let legacy_budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())?;
    let prepared = vault.prepare_original(
        &m::types::Scope {
            workspace_id: id(2),
            home_id: id(3),
        },
        m::types::AssetPurpose::EvidenceOriginal,
        m::types::ContentType::GeoJson,
        &mut bytes.as_slice(),
        &legacy_budget,
    )?;
    let payload = prepared.into_measured().with_provenance(
        m::types::SourceLicense {
            status: m::types::LicenseStatus::Unknown,
            reference: None,
        },
        vec![],
    )?;
    let legacy_asset = json!({"schemaVersion":1,"mutationId":id(22),"operation":"create","expectedRevision":null,"reason":"Synthetic native v1 original retained unchanged","guards":[],"value":{"recordType":"asset","payload":payload}});
    access.lock().unwrap().with_mutation_authorization(
        original.principal.principal(),
        |guard| -> s::Result<()> {
            core.lock()
                .unwrap()
                .store
                .lock()
                .unwrap()
                .execute_json_with_authorization(
                    &FixtureNativeAuthority(guard),
                    &original,
                    &scope,
                    &s::RecordRef {
                        record_type: s::RecordType::Asset,
                        record_id: id(23),
                    },
                    &legacy_asset,
                )?;
            Ok(())
        },
    )?;
    let batch = json!({"schemaVersion":1,"batchId":id(24),"reason":"Retain synthetic unchanged v1 native batch history","commands":[{"target":{"recordType":"identity","recordId":id(21)},"command":{"schemaVersion":1,"mutationId":id(25),"operation":"replace","expectedRevision":1,"reason":"Retain native identity batch revision","guards":[],"value":legacy_command["value"]}},{"target":{"recordType":"asset","recordId":id(23)},"command":{"schemaVersion":1,"mutationId":id(26),"operation":"replace","expectedRevision":1,"reason":"Retain native original batch revision","guards":[],"value":legacy_asset["value"]}}]});
    access.lock().unwrap().with_mutation_authorization(
        original.principal.principal(),
        |guard| -> s::Result<()> {
            core.lock()
                .unwrap()
                .store
                .lock()
                .unwrap()
                .execute_batch_json_with_authorization(
                    &FixtureNativeAuthority(guard),
                    &original,
                    &scope,
                    &batch,
                )?;
            Ok(())
        },
    )?;
    let legacy = rusqlite::Connection::open(root.join("data/atlas.sqlite"))?;
    let target = rusqlite::Connection::open(&path)?;
    for (table, sql) in [
        (
            "records",
            "SELECT workspace_id,home_id,record_id,record_type,revision,body FROM records",
        ),
        (
            "asset_manifests",
            "SELECT workspace_id,home_id,record_id,storage_key,body FROM asset_manifests",
        ),
        (
            "audits",
            "SELECT seq,workspace_id,home_id,record_id,audit_id,body FROM audits",
        ),
        (
            "batch_receipts",
            "SELECT workspace_id,home_id,actor_id,batch_id,payload_hash,body FROM batch_receipts",
        ),
        (
            "receipts",
            "SELECT workspace_id,home_id,actor_id,mutation_id,payload_hash,body FROM receipts",
        ),
    ] {
        let mut st = legacy.prepare(sql)?;
        let count = st.column_count();
        let mut rows = st.query([])?;
        while let Some(row) = rows.next()? {
            let values = (0..count)
                .map(|i| row.get::<_, rusqlite::types::Value>(i))
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let marks = vec!["?"; count].join(",");
            target.execute(
                &format!("INSERT INTO {table} VALUES({marks})"),
                rusqlite::params_from_iter(values),
            )?;
        }
    }
    let lookup = |db: &rusqlite::Connection| -> rusqlite::Result<Vec<String>> {
        db.prepare("SELECT json_array(seq,workspace_id,home_id,record_id,audit_id,command_id) FROM stock_history_lookup ORDER BY seq")?.query_map([],|r|r.get(0))?.collect()
    };
    assert_eq!(lookup(&legacy)?, lookup(&target)?);
    drop(target);
    drop(legacy);
    drop(app);
    drop(core);
    let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())?;
    let reopened =
        GeodataStore::open_existing(&path, access.clone(), vault, policy.clone(), &budget)?;
    let recovery = root.join("recovery");
    let manifest = reopened.capture_recovery(&recovery, &budget)?;
    assert_eq!(manifest["format"], s::geodata::RECOVERY_FORMAT);
    assert_eq!(
        GeodataStore::verify_recovery(&recovery, access.clone(), policy.clone(), &budget)?,
        manifest
    );
    let restored = GeodataStore::restore_recovery(
        &recovery,
        &root.join("restored"),
        access.clone(),
        policy.clone(),
        &budget,
    )?;
    restored.validate_recovery(&budget)?;
    drop(restored);
    let restored_vault = Arc::new(m::AssetVault::open_existing(&root.join("restored/media"))?);
    let restored = GeodataStore::open_existing(
        &root.join("restored/atlas.sqlite"),
        access,
        restored_vault,
        policy,
        &budget,
    )?;
    restored.validate_recovery(&budget)?;
    let checked = rusqlite::Connection::open_with_flags(
        root.join("restored/atlas.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    for n in 0..5 {
        let document = restored.get(
            original.principal.principal(),
            &scope,
            &id(101 + n as u32 * 3),
            &budget,
        )?;
        assert_eq!(
            document["document"]["payload"]["provenance"]["license"],
            fixture_license(n)
        );
        let body: String = checked.query_row(
            "SELECT body FROM geodata_records WHERE record_id=?1",
            [id(102 + n as u32 * 3)],
            |r| r.get(0),
        )?;
        let asset: Value = serde_json::from_str(&body)?;
        assert_eq!(asset["payload"]["sourceLicense"], fixture_license(n));
    }
    println!(
        "PASS actual native session; fresh exclusive v2 dataset; atomic original+Document+immutable custody; identical idempotent create; bounded opaque-session list/get; exact six-family attachment/frame/digest; native CAS title correction and exact-asset association; unchanged nonempty v1 native identity+asset/audit/receipt/manifest recovery; strict reopen; consistent SQL+immutable-media recovery copy, independent full verification, populated restore to new private path and strict reopen. Synthetic only, no renderer/ingestion/deploy."
    );
    Ok(())
}
