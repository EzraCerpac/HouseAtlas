//! Bounded offline-06 qualification of existing native commit and outcome reads.
//! One generated local Stock write; all later commands are read-only POST lookups.
//! Real Axum/Access/SQLite owners, no listener/provider/Node ledger or replay.
//! Checks committed SQL coherence, not injected rollback or crash atomicity.
//! Registration and publication-manifest adoption belong to the source owner.

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
    response::Response,
};
use houseatlas_backend::{
    app::{Core, ReadAuthority, ServerRuntime, Store},
    contracts::stock as wire,
    domain::stock::AtlasListPages,
    http::{Host, contracts::NativeContracts, router},
    lifecycle::{self, Failure},
    media::native::NativeMediaRuntime,
    storage,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    net::SocketAddr,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;

const ORIGIN: &str = "https://127.0.0.1:48743";
const LOOKUP: &str = "/api/atlas/retained-intent";
const LOOKUP_INPUT_BYTES: usize = 16 * 1024;
const RESPONSE_BYTES: usize = 1024 * 1024;
const TABLES: [&str; 7] = [
    "records",
    "audits",
    "receipts",
    "stock_operations",
    "stock_groups",
    "stock_keys",
    "stock_audit_links",
];

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

struct Session {
    cookie: String,
    csrf: String,
}

fn request(
    path: &str,
    bytes: Vec<u8>,
    session: Option<&Session>,
) -> Result<Request<Body>, Failure> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .header("content-length", bytes.len())
        .header("accept", "application/json");
    if let Some(session) = session {
        builder = builder
            .header("cookie", &session.cookie)
            .header("x-atlas-csrf", &session.csrf);
    }
    let mut request = builder.body(Body::from(bytes))?;
    // Synthetic in-process transport metadata only; no network connection exists.
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:50123".parse::<SocketAddr>()?));
    Ok(request)
}

async fn post(
    app: &Router,
    path: &str,
    bytes: Vec<u8>,
    session: &Session,
) -> Result<Response, Failure> {
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        app.clone().oneshot(request(path, bytes, Some(session))?),
    )
    .await??;
    let cache = response
        .headers()
        .get("cache-control")
        .ok_or("Missing private cache policy")?
        .to_str()?;
    assert!(cache.contains("private") && cache.contains("no-store"));
    Ok(response)
}

async fn login(app: &Router, login: &Value) -> Result<Session, Failure> {
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        app.clone().oneshot(request(
            "/api/atlas/auth/login",
            serde_json::to_vec(login)?,
            None,
        )?),
    )
    .await??;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .ok_or("Missing generated cookie")?
        .to_str()?
        .split(';')
        .next()
        .ok_or("Missing cookie pair")?
        .to_owned();
    let info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    Ok(Session {
        cookie,
        csrf: info["csrfToken"]
            .as_str()
            .ok_or("Missing generated CSRF")?
            .to_owned(),
    })
}

async fn inspect(app: &Router, intent: &Value, session: &Session) -> Result<Value, Failure> {
    let response = post(app, LOOKUP, serde_json::to_vec(intent)?, session).await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(serde_json::from_slice(
        &to_bytes(response.into_body(), RESPONSE_BYTES).await?,
    )?)
}

fn sql(path: &Path) -> Result<Connection, Failure> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}

fn counts(path: &Path) -> Result<Vec<i64>, Failure> {
    let db = sql(path)?;
    TABLES
        .iter()
        .map(|table| {
            Ok(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?,
            )
        })
        .collect()
}

// Like the existing retained-read example, compare Atlas DB/WAL bytes, not the
// shared-memory reader marks. Access session bookkeeping is a separate database.
fn disk(path: &Path) -> Result<Vec<Option<Vec<u8>>>, Failure> {
    [path.to_path_buf(), path.with_extension("sqlite-wal")]
        .iter()
        .map(|p| match fs::read(p) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        })
        .collect()
}

fn assert_receipt(value: &Value, intent: &Value, committed: &Value) {
    assert_eq!(value["format"], "atlas-retained-reconciliation/1");
    assert_eq!(value["lookupRequestId"], intent["requestId"]);
    let inspection = &value["inspection"];
    assert_eq!(inspection["format"], "atlas-retained-intent-inspection/1");
    assert_eq!(inspection["resolvedScope"], intent["context"]);
    assert_eq!(inspection["coverage"], "retained-atlas-stock-only");
    assert_eq!(inspection["outcome"], "retained-commit");
    assert_eq!(inspection["retrySafety"], "not-established");
    assert_eq!(inspection["commandId"], intent["commandId"]);
    assert_eq!(inspection["rootOperationId"], committed["operationId"]);
    assert_eq!(inspection["operationId"], committed["operationId"]);
    assert_eq!(
        inspection["requestDigest"],
        committed["data"]["requestDigest"]
    );
    let saved = &value["committedResult"];
    assert_eq!(saved["originalRequestId"], committed["requestId"]);
    assert_eq!(saved["wire"], *committed);
    assert_eq!(saved["wire"]["replayed"], false);
    assert_eq!(saved["children"], json!([]));
    assert_eq!(saved["originalMediaRelease"], "not-established");
    assert_eq!(saved["originalHttpDelivery"], "not-established");
}

fn assert_absent(value: &Value, intent: &Value, request_digest: &str) {
    assert_eq!(value["format"], "atlas-retained-reconciliation/1");
    assert_eq!(value["lookupRequestId"], intent["requestId"]);
    assert_eq!(
        value["inspection"]["format"],
        "atlas-retained-intent-inspection/1"
    );
    assert_eq!(value["inspection"]["coverage"], "retained-atlas-stock-only");
    assert_eq!(value["inspection"]["commandId"], intent["commandId"]);
    assert_eq!(value["inspection"]["requestDigest"], request_digest);
    assert_eq!(value["inspection"]["resolvedScope"], intent["context"]);
    assert_eq!(value["inspection"]["outcome"], "not-retained-at-snapshot");
    assert_eq!(value["inspection"]["retrySafety"], "not-established");
    assert!(value["inspection"]["rootOperationId"].is_null());
    assert!(value["inspection"]["operationId"].is_null());
    assert!(value["committedResult"].is_null());
}

fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(qualify())
}

async fn qualify() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-offline06-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    let context =
        json!({"workspaceId":core.home.scope.workspace_id,"homeId":core.home.scope.home_id});
    let command_path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
    let app = router(host.clone());
    let logins: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let editor = login(&app, &logins["editorLogin"]).await?;
    let viewer = login(&app, &logins["login"]).await?;
    drop(logins); // Generated credentials stay in private fixture memory/files.
    let database = directory.join("atlas.sqlite");
    let before = counts(&database)?;
    let intent = json!({"schemaVersion":3,"commandId":"atlas.identity.create",
        "requestId":id(920),"context":context,
        "target":{"authority":"atlas","recordType":"identity","recordId":id(921)},
        "payload":{"kind":"item","evidenceIds":[id(100)]},
        "idempotencyKey":id(922),"reason":"Generated offline intent qualification",
        "preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":id(100)},
            "revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null});
    let response = post(&app, &command_path, serde_json::to_vec(&intent)?, &editor).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let committed: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), RESPONSE_BYTES).await?)?;
    let contracts = wire::StockValidation::new()?;
    let parsed = wire::StockRequest::parse(&contracts, intent.clone())?;
    wire::StockResponse::parse(&contracts, &parsed, committed.clone(), &[])?;
    assert_eq!(committed["status"], "committed");
    assert_eq!(committed["replayed"], false);
    let after = counts(&database)?;
    assert_eq!(
        after,
        before.iter().map(|count| count + 1).collect::<Vec<_>>()
    );
    {
        let db = sql(&database)?;
        let (original, saved, key): (String, String, String) = db.query_row(
            "SELECT original_json,commit_json,idempotency_key FROM stock_operations WHERE operation_id=?1",
            [committed["operationId"].as_str().ok_or("Missing operation ID")?],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        assert_eq!(serde_json::from_str::<Value>(&original)?, intent);
        assert_eq!(serde_json::from_str::<Value>(&saved)?["wire"], committed);
        assert_eq!(key, id(922));
        let linked: i64 = db.query_row(
            "SELECT count(*) FROM stock_audit_links l JOIN audits a ON a.audit_id=l.audit_id
             JOIN receipts r ON r.workspace_id=l.workspace_id AND r.home_id=l.home_id
              AND r.actor_id=l.actor_id AND r.mutation_id=l.mutation_id
             WHERE l.root_operation_id=?1",
            [committed["operationId"]
                .as_str()
                .ok_or("Missing operation ID")?],
            |row| row.get(0),
        )?;
        assert_eq!(linked, 1);
    }

    let saved_disk = disk(&database)?;
    let first = inspect(&app, &intent, &editor).await?;
    assert_receipt(&first, &intent, &committed);
    assert_eq!(inspect(&app, &intent, &editor).await?, first);
    let mut alternate = intent.clone();
    alternate["requestId"] = json!(id(923));
    assert_receipt(
        &inspect(&app, &alternate, &editor).await?,
        &alternate,
        &committed,
    );

    let mut conflict = intent.clone();
    conflict["payload"]["evidenceIds"] = json!([]);
    let response = post(&app, LOOKUP, serde_json::to_vec(&conflict)?, &editor).await?;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let _ = to_bytes(response.into_body(), RESPONSE_BYTES).await?;
    assert_absent(
        &inspect(&app, &intent, &viewer).await?,
        &intent,
        parsed.intent_digest(),
    );
    let mut missing = intent.clone();
    missing["idempotencyKey"] = json!(id(924));
    let missing_request = wire::StockRequest::parse(&contracts, missing.clone())?;
    assert_absent(
        &inspect(&app, &missing, &editor).await?,
        &missing,
        missing_request.intent_digest(),
    );
    for field in ["workspaceId", "homeId"] {
        let mut other = intent.clone();
        other["context"][field] = json!(id(925));
        let response = post(&app, LOOKUP, serde_json::to_vec(&other)?, &editor).await?;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let _ = to_bytes(response.into_body(), RESPONSE_BYTES).await?;
    }

    // Exact existing lookup input boundary; trailing JSON whitespace changes
    // byte count without changing or reconstructing the original command.
    let mut boundary = serde_json::to_vec(&intent)?;
    assert!(boundary.len() < LOOKUP_INPUT_BYTES);
    boundary.resize(LOOKUP_INPUT_BYTES, b' ');
    let response = post(&app, LOOKUP, boundary.clone(), &editor).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), RESPONSE_BYTES).await?;
    assert_receipt(&serde_json::from_slice(&body)?, &intent, &committed);
    boundary.push(b' ');
    let response = post(&app, LOOKUP, boundary, &editor).await?;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let _ = to_bytes(response.into_body(), RESPONSE_BYTES).await?;
    // Client-side bounded response consumption, not a server response ceiling.
    let exact_response_bytes = body.len();
    assert!(exact_response_bytes > 0 && exact_response_bytes < RESPONSE_BYTES);
    let response = post(&app, LOOKUP, serde_json::to_vec(&intent)?, &editor).await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(response.into_body(), exact_response_bytes).await?,
        body
    );
    let response = post(&app, LOOKUP, serde_json::to_vec(&intent)?, &editor).await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        to_bytes(response.into_body(), exact_response_bytes - 1)
            .await
            .is_err()
    );
    assert_eq!(counts(&database)?, after);
    assert_eq!(disk(&database)?, saved_disk);

    // Drop every Router/Host reference, close the actual Store, then reopen it.
    // Access remains the genuine generated owner; each HTTP lookup issues a
    // fresh request principal. This is not a full-process or power-loss test.
    drop(app);
    let core_handle = Arc::clone(&host.core);
    drop(host);
    let core = Arc::try_unwrap(core_handle)
        .map_err(|_| "Core still borrowed")?
        .into_inner()
        .map_err(|_| "Core unavailable")?;
    let Core {
        access,
        store,
        vault,
        home,
        homes,
        ..
    } = core;
    Arc::try_unwrap(store)
        .map_err(|_| "Store still borrowed")?
        .into_inner()
        .map_err(|_| "Store unavailable")?
        .close()?;
    let reopened = Store::open(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
    )?;
    let reopened_host = Host::new(
        Core {
            access,
            store: Arc::new(Mutex::new(reopened)),
            atlas_list_pages: AtlasListPages::default(),
            media_policy_evidence: Mutex::default(),
            vault,
            home,
            homes,
        },
        ORIGIN.into(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?;
    let reopened_app = router(reopened_host.clone());
    let reopened_disk = disk(&database)?;
    assert_eq!(counts(&database)?, after);
    assert_receipt(
        &inspect(&reopened_app, &intent, &editor).await?,
        &intent,
        &committed,
    );
    assert_eq!(counts(&database)?, after);
    assert_eq!(disk(&database)?, reopened_disk);
    drop(reopened_app);
    drop(reopened_host);
    drop(editor);
    drop(viewer);
    scratch.close()?;
    println!(
        "{}",
        json!({
            "format":"houseatlas-offline06-native-qualification/1", "result":"pass",
            "stockWrites":1, "replayedWrites":0, "listeners":0,
            "checks":["coherent-seven-table-native-commit", "repeated-read-only-outcome",
                "original-receipt-and-alternate-lookup-id", "conflicting-payload-lookup",
                "actor-miss-and-unconfigured-scope-rejection", "absence-does-not-authorize-retry",
                "unchanged-atlas-db-and-wal", "clean-store-reopen",
                "lookup-input-16384-accepted-16385-rejected", "exact-and-short-response-reader"],
            "responseReaderBytes":exact_response_bytes,
            "limits":"No injected rollback, crash, concurrency, server-response-ceiling or offline-edit/sync qualification"
        })
    );
    Ok(())
}
