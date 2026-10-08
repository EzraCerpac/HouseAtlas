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

#[path = "healthy_mixed_derived_atlas.rs"]
mod healthy_mixed_derived_atlas;
#[path = "healthy_verified_asset_review.rs"]
mod healthy_verified_asset_review;

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

struct Client<'a> {
    core: &'a Core,
    cookie: &'a str,
    csrf: &'a str,
    validator: &'a wire::StockValidation,
}

fn command(
    client: &Client<'_>,
    command_id: &str,
    target: Value,
    payload: Value,
    revision: Option<u64>,
    guards: Vec<Value>,
    serial: u32,
) -> Result<Value, Failure> {
    let Client {
        core,
        cookie,
        csrf,
        validator,
    } = client;
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
    let output = stock_dispatch::execute(core, &issued, raw)
        .map_err(|error| format!("Healthy {command_id} failed: {error}"))?;
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
    // Select only the one-home Atlas graph used by this case. The optional
    // fixture also carries unrelated Network partitions and another home; they
    // require their own original disclosure peers and are outside this check.
    published["sources"]
        .as_array_mut()
        .ok_or("Missing sources")?
        .retain(|source| source["sourceInstanceId"] == id(10));
    let selected = [100, 200, 201, 300, 301, 400, 600, 601];
    published["records"]
        .as_array_mut()
        .ok_or("Missing records")?
        .retain(|record| {
            selected
                .iter()
                .any(|number| record["recordId"] == id(*number))
        });
    published["homeboxEntities"]
        .as_array_mut()
        .ok_or("Missing projections")?
        .truncate(2);
    published["networkRelations"] = json!([]);
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
    healthy_verified_asset_review::seed_existing(&core, &directory, &mut published)?;
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
    let client = Client {
        core: &core,
        cookie: &cookie,
        csrf: &csrf,
        validator: &validator,
    };
    let evidence = vec![guard("evidence", 100, 1)];
    let binding_guards = vec![guard("identity", 200, 1), guard("evidence", 100, 1)];
    let created = command(
        &client,
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
        &client,
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
        &client,
        "atlas.binding.tombstone",
        target("binding", 300),
        json!({}),
        Some(1),
        vec![guard("identity", 200, 1), guard("evidence", 100, 1)],
        3,
    )?;
    assert_eq!(tombstoned["data"]["records"][0]["lifecycle"], "tombstoned");
    let restored = command(
        &client,
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
        &client,
        "atlas.binding.remap",
        target("binding", 301),
        json!({"oldBindingId":id(301),"newBindingId":id(931),"journalId":id(932),
            "source":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
                "sourceKind":"homebox-entity","externalId":id(504)},
            "reason":"import-id-remap","evidenceIds":[id(100)]}),
        Some(1),
        vec![
            guard("identity", 201, 1),
            guard("evidence", 100, 1),
            guard("binding", 301, 1),
        ],
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
        &client,
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
            &client,
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

    // Ordinary preparation for a positive restore child; no held control is
    // exercised. The entire batch reads this one real transaction prestate.
    let batch_tombstone = command(
        &client,
        "atlas.binding.tombstone",
        target("binding", 300),
        json!({}),
        Some(3),
        vec![guard("identity", 200, 1), guard("evidence", 100, 1)],
        9,
    )?;
    assert_eq!(batch_tombstone["data"]["records"][0]["revision"], 4);
    let mixed = healthy_mixed_derived_atlas::healthy(&core, &cookie, &csrf)?;
    let verified_review = healthy_verified_asset_review::healthy(&core, &cookie, &csrf)?;

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
        media_policy_evidence: Mutex::default(),
        vault,
        home,
        homes,
    };
    for (serial, kind, n, revision) in [
        (1, "binding", 930, 3),
        (2, "binding", 300, 5),
        (3, "binding", 301, 2),
        (4, "binding", 931, 2),
        (5, "reconciliation", 932, 1),
        (6, "geometry", 933, 1),
        (7, "asset", 600, 4),
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
    // Every mixed output is read after normal reopen. Each history load
    // validates the saved batch plan, including all seven original children,
    // fixed import time and each derived preimage's own audit beforeDigest.
    let mut mixed_outputs = 0;
    for (group_index, group) in mixed.groups.iter().enumerate() {
        for (entry_index, native) in group.native_results.iter().enumerate() {
            let selector = json!({"authority":"atlas",
                "recordType":native.record.record_type.as_str(),"recordId":native.record.record_id});
            let read_serial = 100 + (group_index * 3 + entry_index) as u32;
            let got = read(
                &core,
                &cookie,
                &validator,
                &format!("atlas.{}.get", native.record.record_type.as_str()),
                selector.clone(),
                json!({}),
                read_serial,
            )?;
            assert_eq!(
                got["data"]["records"][0],
                mixed.children[group_index]["data"]["records"][entry_index]
            );
            let history = read(
                &core,
                &cookie,
                &validator,
                &format!("atlas.{}.history", native.record.record_type.as_str()),
                selector,
                json!({"pageSize":20,"cursor":null,"includeArchived":false,
                    "q":group.original_request["commandId"]}),
                read_serial + 50,
            )?;
            let events = history["data"]["entries"]
                .as_array()
                .ok_or("Missing mixed history")?;
            assert!(
                events
                    .iter()
                    .any(|event| event["eventId"] == native.audit.audit_id
                        && event["requestDigest"] == group.request_digest
                        && event["beforeDigest"] == json!(native.audit.before_digest)
                        && event["afterDigest"] == json!(native.audit.after_digest))
            );
            mixed_outputs += 1;
        }
    }
    assert_eq!(mixed_outputs, 9);
    println!(
        "PASS healthy mixed derived Atlas batch: seven ordered children, nine native entries/audits, genuine Access guard; nine reopened record/history pairs"
    );
    let reviewed = &verified_review.groups[0].native_results[0];
    let got = read(
        &core,
        &cookie,
        &validator,
        "atlas.asset.get",
        target("asset", 950),
        json!({}),
        301,
    )?;
    assert_eq!(
        got["data"]["records"][0],
        verified_review.wire["data"]["records"][0]
    );
    let history = read(
        &core,
        &cookie,
        &validator,
        "atlas.asset.history",
        target("asset", 950),
        json!({"pageSize":20,"cursor":null,"includeArchived":false,"q":"atlas.asset.review"}),
        302,
    )?;
    let events = history["data"]["entries"]
        .as_array()
        .ok_or("Missing verified review history")?;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["eventId"], reviewed.audit.audit_id);
    assert_eq!(events[0]["commandId"], "atlas.asset.review");
    assert_eq!(events[0]["actorId"], verified_review.actor_id);
    assert_eq!(events[0]["requestDigest"], verified_review.request_digest);
    assert_eq!(
        events[0]["beforeDigest"],
        json!(reviewed.audit.before_digest)
    );
    assert_eq!(events[0]["afterDigest"], json!(reviewed.audit.after_digest));
    println!(
        "PASS healthy verified asset review: actual retained PNG render, original Store pin and Access guard, durable linked successor release; reopened record/history data"
    );
    drop(core);
    scratch.close()?;
    println!(
        "PASS healthy specialized Atlas stock: binding create/review/restore/remap, geometry create, asset review; durable native readback"
    );
    Ok(())
}
