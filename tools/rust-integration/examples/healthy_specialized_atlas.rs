//! Positive, disposable native stock checks for six specialized Atlas forms.
//! This uses real Access principals and a freshly bootstrapped SQLite store;
//! fixture sources and missing media stay synthetic. No socket or provider runs.

use houseatlas_backend::{
    access as a,
    app::{Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store, access_scope},
    contracts::stock as wire,
    domain::stock::AtlasListPages,
    http::{agents::stock_dispatch, contracts::NativeContracts},
    lifecycle::{self, Failure},
    media::native::NativeMediaRuntime,
    storage as s,
};
use serde_json::{Value, json};
use std::{
    fs,
    sync::{Arc, Mutex},
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn target(kind: &str, n: u32) -> Value {
    json!({"authority":"atlas","recordType":kind,"recordId":id(n)})
}
fn guard(kind: &str, n: u32, revision: u64) -> Value {
    json!({"target":target(kind,n),"revision":{"kind":"atlas","value":revision}})
}

fn principal(
    core: &Core,
    cookie: &str,
    csrf: &str,
    post: bool,
    path: &str,
) -> Result<RequestPrincipal, Failure> {
    let scope = access_scope(&core.home.scope)?;
    let url = format!("{ORIGIN}{path}");
    let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
    Ok(RequestPrincipal::new(access.authorize(
        &a::RequestEvidence {
            method: if post {
                a::Method::Post
            } else {
                a::Method::Get
            },
            url: &url,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(cookie),
            authorization: None,
            csrf: if post { Some(csrf) } else { None },
        },
        &scope,
        if post {
            a::Action::Mutate
        } else {
            a::Action::Read
        },
    )?))
}

fn command(
    core: &Core,
    cookie: &str,
    csrf: &str,
    validator: &wire::StockValidation,
    command_id: &str,
    target: Value,
    payload: Value,
    revision: Option<u64>,
    guards: Vec<Value>,
    serial: u32,
) -> Result<Value, Failure> {
    let raw = json!({"schemaVersion":3,"commandId":command_id,
        "requestId":id(3000+serial),
        "context":{"workspaceId":core.home.scope.workspace_id,"homeId":core.home.scope.home_id},
        "target":target,"payload":payload,"idempotencyKey":id(4000+serial),
        "reason":"Positive disposable specialized Atlas command",
        "preconditions":{"target":revision.map(|value|json!({"kind":"atlas","value":value})),"guards":guards},
        "approvalReceiptId":null});
    let parsed = wire::StockRequest::parse(validator, raw.clone())?;
    let path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let issued = principal(core, cookie, csrf, true, &path)?;
    let output = stock_dispatch::execute(core, &issued, raw)?;
    wire::StockResponse::parse(validator, &parsed, output.wire.clone(), &output.children)?;
    assert!(output.children.is_empty());
    assert_eq!(output.wire["status"], "committed");
    assert_eq!(output.wire["replayed"], false);
    assert_eq!(output.wire["commandId"], command_id);
    assert_eq!(output.wire["requestId"], parsed.raw()["requestId"]);
    assert_eq!(
        output.wire["data"]["records"][0]["revision"],
        revision.unwrap_or(0) + 1
    );
    assert!(output.wire["data"]["requestDigest"].as_str().is_some());
    assert_eq!(
        output.wire["data"]["auditIds"]
            .as_array()
            .ok_or("Missing audit IDs")?
            .len(),
        output.wire["data"]["records"]
            .as_array()
            .ok_or("Missing records")?
            .len()
    );
    Ok(output.wire)
}

fn read(
    core: &Core,
    cookie: &str,
    validator: &wire::StockValidation,
    command_id: &str,
    target: Value,
    payload: Value,
    serial: u32,
) -> Result<Value, Failure> {
    let path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/records/{}/{}{}",
        core.home.scope.workspace_id,
        core.home.scope.home_id,
        target["recordType"].as_str().ok_or("Missing read type")?,
        target["recordId"].as_str().ok_or("Missing read ID")?,
        if command_id.ends_with(".history") {
            "/history"
        } else {
            ""
        },
    );
    let raw = json!({"schemaVersion":3,"commandId":command_id,"requestId":id(5000+serial),
        "context":{"workspaceId":core.home.scope.workspace_id,"homeId":core.home.scope.home_id},
        "target":target,"payload":payload});
    let parsed = wire::StockRequest::parse(validator, raw.clone())?;
    let issued = principal(core, cookie, "", false, &path)?;
    let output = stock_dispatch::execute(core, &issued, raw)?;
    wire::StockResponse::parse(validator, &parsed, output.wire.clone(), &output.children)?;
    assert_eq!(output.wire["status"], "read");
    Ok(output.wire)
}

pub fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-specialized-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let mut core = lifecycle::prepare(&directory, ORIGIN)?;
    let receipt: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login_body = serde_json::to_vec(receipt.get("editorLogin").ok_or("Missing editor login")?)?;
    let login_url = format!("{ORIGIN}/api/atlas/auth/login");
    let (cookie, csrf) = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        let login = access.login(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &login_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: None,
                authorization: None,
                csrf: None,
            },
            &login_body,
            "healthy-specialized-atlas",
        )?;
        (
            login
                .set_cookie()
                .split(';')
                .next()
                .ok_or("Missing cookie")?
                .to_owned(),
            login.info().csrf_token().to_owned(),
        )
    };
    drop(login_body);
    drop(receipt);

    // Replace only this Core's standard synthetic database with a separate
    // actual Store bootstrapped from the published optional-geometry graph.
    let mut published: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/optional-geometry.snapshot.json"
    ))?;
    for row in published["records"]
        .as_array_mut()
        .ok_or("Missing fixture records")?
    {
        if row["recordType"] == "binding"
            && (row["recordId"] == id(300) || row["recordId"] == id(301))
        {
            row["payload"]["sourceState"] = json!("unresolved");
        }
    }
    let asset = published["records"]
        .as_array()
        .ok_or("Missing records")?
        .iter()
        .find(|row| row["recordId"] == id(600))
        .ok_or("Missing asset 600")?;
    assert_eq!(asset["payload"]["availability"], "missing");
    assert_eq!(asset["payload"]["previewPolicy"], "blocked");
    let geometry_payload = published["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["recordId"] == id(601))
        .ok_or("Missing geometry 601")?["payload"]
        .clone();
    {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        for source in published["sources"].as_array().ok_or("Missing sources")? {
            if source["sourceInstanceId"] != id(10) {
                access.put_source(&serde_json::from_value(source.clone())?, None)?;
            }
        }
    }
    let database = directory.join("specialized-atlas.sqlite");
    let store_access = Arc::clone(&core.access);
    let store_vault = Arc::clone(&core.vault);
    let new_store = |options| {
        Store::open(
            &database,
            NativeContracts,
            ReadAuthority(Arc::clone(&store_access)),
            NativeMediaRuntime {
                vault: Arc::clone(&store_vault),
                server: ServerRuntime,
            },
            options,
        )
    };
    let mut store = new_store(s::StoreOptions {
        allow_synthetic_bootstrap: true,
        ..Default::default()
    })?;
    store.initialize_synthetic(&serde_json::from_value(published)?)?;
    store.close()?;
    let replacement = new_store(s::StoreOptions::default())?;
    let old = std::mem::replace(
        core.store.get_mut().map_err(|_| "Store unavailable")?,
        replacement,
    );
    old.close()?;
    let validator = wire::StockValidation::new()?;
    let evidence = vec![guard("evidence", 100, 1)];
    let binding_guards = vec![guard("identity", 200, 1), guard("evidence", 100, 1)];
    let created = command(
        &core,
        &cookie,
        &csrf,
        &validator,
        "atlas.binding.create",
        target("binding", 930),
        json!({"atlasId":id(200),"source":{"sourceInstanceId":id(10),
            "collectionId":"synthetic-collection-a","sourceKind":"homebox-entity",
            "externalId":id(505)},"reviewStatus":"proposed","evidenceIds":[id(100)]}),
        None,
        binding_guards,
        1,
    )?;
    assert_eq!(
        created["data"]["records"][0]["payload"]["sourceState"],
        "unresolved"
    );
    assert_eq!(
        created["data"]["records"][0]["payload"]["reviewStatus"],
        "proposed"
    );
    let reviewed = command(
        &core,
        &cookie,
        &csrf,
        &validator,
        "atlas.binding.review",
        target("binding", 930),
        json!({"reviewStatus":"rejected","evidenceIds":[id(100)]}),
        Some(1),
        vec![guard("identity", 200, 1), guard("evidence", 100, 1)],
        2,
    )?;
    assert_eq!(
        reviewed["data"]["records"][0]["payload"]["reviewStatus"],
        "rejected"
    );
    let tombstoned = command(
        &core,
        &cookie,
        &csrf,
        &validator,
        "atlas.binding.tombstone",
        target("binding", 300),
        json!({}),
        Some(1),
        vec![guard("identity", 200, 1), guard("evidence", 100, 1)],
        3,
    )?;
    assert_eq!(tombstoned["data"]["records"][0]["lifecycle"], "tombstoned");
    let restored = command(
        &core,
        &cookie,
        &csrf,
        &validator,
        "atlas.binding.restore",
        target("binding", 300),
        json!({}),
        Some(2),
        vec![guard("identity", 200, 1), guard("evidence", 100, 1)],
        4,
    )?;
    assert_eq!(restored["data"]["records"][0]["lifecycle"], "active");
    assert_eq!(
        restored["data"]["records"][0]["payload"],
        tombstoned["data"]["records"][0]["payload"]
    );
    let remapped = command(
        &core,
        &cookie,
        &csrf,
        &validator,
        "atlas.binding.remap",
        target("binding", 301),
        json!({"oldBindingId":id(301),"newBindingId":id(931),"journalId":id(932),
            "source":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
                "sourceKind":"homebox-entity","externalId":id(504)},
            "reason":"import-id-remap","evidenceIds":[id(100)]}),
        Some(1),
        vec![guard("identity", 201, 1), guard("evidence", 100, 1)],
        5,
    )?;
    let remap_records = remapped["data"]["records"]
        .as_array()
        .ok_or("Missing remap records")?;
    assert_eq!(remap_records.len(), 3);
    assert_eq!(remap_records[0]["target"], target("binding", 301));
    assert_eq!(remap_records[1]["target"], target("binding", 931));
    assert_eq!(remap_records[2]["target"], target("reconciliation", 932));
    assert_eq!(remap_records[1]["revision"], 1);
    assert_eq!(remap_records[2]["revision"], 1);
    assert_eq!(remap_records[0]["payload"]["reviewStatus"], "retired");
    assert_eq!(remap_records[1]["payload"]["sourceState"], "unresolved");
    let mut geometry_input = geometry_payload;
    geometry_input
        .as_object_mut()
        .ok_or("Geometry payload object required")?
        .remove("importedAt");
    let geometry = command(
        &core,
        &cookie,
        &csrf,
        &validator,
        "atlas.geometry.create",
        target("geometry", 933),
        geometry_input,
        None,
        vec![
            guard("asset", 600, 1),
            guard("identity", 200, 1),
            guard("evidence", 100, 1),
        ],
        6,
    )?;
    assert_eq!(
        geometry["data"]["records"][0]["payload"]["originalAssetId"],
        id(600)
    );
    let mut asset_reviews = Vec::new();
    for (serial, treatment, policy, revision) in [
        (7, "download-only", "download-only", 1),
        (8, "block", "blocked", 2),
    ] {
        let result = command(
            &core,
            &cookie,
            &csrf,
            &validator,
            "atlas.asset.review",
            target("asset", 600),
            json!({"treatment":treatment,"rendererReceiptId":null,"evidenceIds":[id(100)]}),
            Some(revision),
            evidence.clone(),
            serial,
        )?;
        assert_eq!(
            result["data"]["records"][0]["payload"]["previewPolicy"],
            policy
        );
        assert_eq!(
            result["data"]["records"][0]["payload"]["availability"],
            "missing"
        );
        asset_reviews.push(result);
    }

    // Explicitly close and reopen the same specialized SQLite file before
    // querying the stock owner. The original session remains in actual Access.
    let Core {
        access,
        store,
        vault,
        home,
        homes,
        ..
    } = core;
    store
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
        s::StoreOptions::default(),
    )?;
    let core = Core {
        access,
        store: Mutex::new(reopened),
        atlas_list_pages: AtlasListPages::default(),
        vault,
        home,
        homes,
    };
    for (serial, kind, n, revision) in [
        (1, "binding", 930, 2),
        (2, "binding", 300, 3),
        (3, "binding", 301, 2),
        (4, "binding", 931, 1),
        (5, "reconciliation", 932, 1),
        (6, "geometry", 933, 1),
        (7, "asset", 600, 3),
    ] {
        let got = read(
            &core,
            &cookie,
            &validator,
            &format!("atlas.{kind}.get"),
            target(kind, n),
            json!({}),
            serial,
        )?;
        assert_eq!(got["data"]["records"][0]["revision"], revision);
    }
    for (serial, kind, n, operation, audit, index) in [
        (11, "binding", 930, "atlas.binding.create", &created, 0),
        (12, "binding", 930, "atlas.binding.review", &reviewed, 0),
        (
            13,
            "binding",
            300,
            "atlas.binding.tombstone",
            &tombstoned,
            0,
        ),
        (14, "binding", 300, "atlas.binding.restore", &restored, 0),
        (15, "binding", 301, "atlas.binding.remap", &remapped, 0),
        (16, "binding", 931, "atlas.binding.remap", &remapped, 1),
        (
            17,
            "reconciliation",
            932,
            "atlas.binding.remap",
            &remapped,
            2,
        ),
        (18, "geometry", 933, "atlas.geometry.create", &geometry, 0),
        (19, "asset", 600, "atlas.asset.review", &asset_reviews[0], 0),
        (20, "asset", 600, "atlas.asset.review", &asset_reviews[1], 0),
    ] {
        let history = read(
            &core,
            &cookie,
            &validator,
            &format!("atlas.{kind}.history"),
            target(kind, n),
            json!({"pageSize":20,"cursor":null,"includeArchived":false,"q":operation}),
            serial,
        )?;
        let events = history["data"]["entries"]
            .as_array()
            .ok_or("Missing stock history")?;
        assert!(!events.is_empty());
        assert!(events.iter().any(|event| event["commandId"] == operation
            && event["eventId"] == audit["data"]["auditIds"][index]));
    }
    drop(core);
    scratch.close()?;
    println!(
        "PASS healthy specialized Atlas stock: binding create/review/restore/remap, geometry create, asset review; durable native readback"
    );
    Ok(())
}
