//! Three fresh native stock writes followed by bounded retained-read disclosure.
//! This is an in-process, disposable Access and SQLite fixture, not an HTTP test.

use houseatlas_backend::{
    access as a,
    app::{Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store, access_scope},
    contracts::stock as wire,
    domain::stock::{AtlasListPages, NativeStockContract},
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
fn denied() -> s::Error {
    s::Error::new("forbidden", "Fixture retained-read authority changed")
}

/// A mandatory read owner backed by the same actual Access boundary as Store.
/// All callback facts are checked against the original issued GET principal.
struct FixtureReadAuthorization {
    read: ReadAuthority,
    owner: s::StockRetainedReadOwner,
    original: *const RequestPrincipal,
    scope: s::Scope,
}
impl s::Authorization for FixtureReadAuthorization {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(p, self.original)
            || request.scope != &self.scope
            || request.capability != s::Capability::ReadHistory
            || request.source.is_some()
            || request.source_partition.is_some()
            || request.mutation.is_some()
        {
            return Err(denied());
        }
        s::Authorization::authorize(&self.read, p, request)
    }
}
impl s::StockRetainedReadAuthorization for FixtureReadAuthorization {
    fn retained_read_owner(&self) -> &s::StockRetainedReadOwner {
        &self.owner
    }
    fn authorize_stock_retained_read(
        &self,
        p: &RequestPrincipal,
        frame: s::StockRetainedReadFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(p, self.original) || frame.scope != &self.scope {
            return Err(denied());
        }
        for record in frame.current_records {
            if record.scope() != self.scope || !frame.targets.contains(&record.reference()) {
                return Err(denied());
            }
            if record.record_type == s::RecordType::Identity
                && record.record_id == id(920)
                && (record.payload["kind"] != "item"
                    || record
                        .payload
                        .as_object()
                        .is_some_and(|payload| payload.contains_key("source")))
            {
                return Err(denied());
            }
        }
        for commit in frame.retained_commits.iter().chain(frame.commit) {
            for group in &commit.groups {
                if group.original_request["context"]
                    != json!({"workspaceId":self.scope.workspace_id,"homeId":self.scope.home_id})
                {
                    return Err(denied());
                }
                for result in &group.native_results {
                    if result.record.scope() != self.scope {
                        return Err(denied());
                    }
                }
            }
        }
        for audit in frame.audits {
            if audit.workspace_id != self.scope.workspace_id
                || audit.home_id != self.scope.home_id
                || !frame.targets.contains(&audit.record)
            {
                return Err(denied());
            }
        }
        for event in frame.events {
            if event.target.authority != "atlas"
                || event.state != "committed"
                || !frame.audits.iter().any(|audit| {
                    audit.audit_id == event.event_id
                        && audit.at == event.at
                        && audit.actor_id == event.actor_id
                        && audit.record.record_type == event.target.record_type
                        && audit.record.record_id == event.target.record_id
                })
            {
                return Err(denied());
            }
        }
        if frame.intent.is_some_and(|intent| {
            intent.raw()["context"]
                != json!({
                    "workspaceId":self.scope.workspace_id,"homeId":self.scope.home_id
                })
        }) {
            return Err(denied());
        }
        s::Authorization::authorize(
            self,
            p,
            s::AuthorizationRequest {
                scope: frame.scope,
                capability: s::Capability::ReadHistory,
                targets: frame.targets,
                source: None,
                source_partition: None,
                mutation: None,
            },
        )
    }
}

fn issued(
    core: &Core,
    cookie: &str,
    csrf: Option<&str>,
    path: &str,
) -> Result<RequestPrincipal, Failure> {
    let scope = access_scope(&core.home.scope)?;
    let url = format!("{ORIGIN}{path}");
    let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
    Ok(RequestPrincipal::new(access.authorize(
        &a::RequestEvidence {
            method: if csrf.is_some() {
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
            csrf,
        },
        &scope,
        if csrf.is_some() {
            a::Action::Mutate
        } else {
            a::Action::Read
        },
    )?))
}

fn write(
    core: &Core,
    cookie: &str,
    csrf: &str,
    raw: &Value,
    schemas: &wire::StockValidation,
) -> Result<Value, Failure> {
    let path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let principal = issued(core, cookie, Some(csrf), &path)?;
    let parsed = wire::StockRequest::parse(schemas, raw.clone())?;
    let result = stock_dispatch::execute(core, &principal, raw.clone())?;
    wire::StockResponse::parse(schemas, &parsed, result.wire.clone(), &result.children)?;
    assert!(result.children.is_empty());
    assert_eq!(result.wire["status"], "committed");
    assert_eq!(result.wire["replayed"], false);
    Ok(result.wire)
}

fn assert_send_sync<T: Send + Sync>() {}

fn assert_committed_result(
    result: &s::StockRetainedReconciliation,
    lookup_request_id: &str,
    original_request_id: &str,
    original_wire: &Value,
) {
    assert!(!result.format.is_empty());
    assert_eq!(result.lookup_request_id.as_str(), lookup_request_id);
    assert_eq!(result.inspection.outcome, "retained-commit");
    assert_eq!(result.inspection.retry_safety, "not-established");
    let committed = result
        .committed_result
        .as_ref()
        .expect("Genuine retained result");
    assert_eq!(committed.original_request_id.as_str(), original_request_id);
    assert_eq!(&committed.wire, original_wire);
    assert!(committed.children.is_empty());
    assert_eq!(
        committed.wire["requestId"].as_str(),
        Some(original_request_id)
    );
    assert_eq!(committed.wire["replayed"], false);
    assert_eq!(committed.original_media_release, "not-established");
    assert_eq!(committed.original_http_delivery, "not-established");
}

fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    assert_send_sync::<s::StockRetainedContinuation>();
    assert_send_sync::<s::StockOperationEventPreparation>();
    assert_send_sync::<s::StockOperationEventSnapshot>();
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-retained-read-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let mut core = lifecycle::prepare(&directory, ORIGIN)?;
    let receipt: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login_body = serde_json::to_vec(receipt.get("editorLogin").ok_or("Missing editor login")?)?;
    let (cookie, csrf) = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        let login = access.login(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &format!("{ORIGIN}/api/atlas/auth/login"),
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: None,
                authorization: None,
                csrf: None,
            },
            &login_body,
            "healthy-stock-retained-read",
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
    let scope = s::Scope {
        workspace_id: core.home.scope.workspace_id.clone(),
        home_id: core.home.scope.home_id.clone(),
    };
    let context = json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id});
    let schemas = wire::StockValidation::new()?;

    // The ordinary Core starts with six records. Bootstrap a separate actual
    // Store from the published optional-geometry graph to supply the missing,
    // blocked asset and geometry metadata used by the derived mapping.
    let mut published: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/optional-geometry.snapshot.json"
    ))?;
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
    let mut geometry_payload = published["records"]
        .as_array()
        .ok_or("Missing records")?
        .iter()
        .find(|record| record["recordId"] == id(601))
        .ok_or("Missing synthetic geometry")?["payload"]
        .clone();
    geometry_payload
        .as_object_mut()
        .ok_or("Geometry payload required")?
        .remove("importedAt");
    // Keep this bounded read fixture source-less; production HTTP separately
    // qualifies original and current source graphs under retained handles.
    for mapping in geometry_payload["mappings"]
        .as_array_mut()
        .ok_or("Missing mappings")?
    {
        mapping["homeboxEntity"] = Value::Null;
    }
    let database = directory.join("retained-atlas.sqlite");
    let open = |options| {
        Store::open(
            &database,
            NativeContracts,
            ReadAuthority(Arc::clone(&core.access)),
            NativeMediaRuntime {
                vault: Arc::clone(&core.vault),
                server: ServerRuntime,
            },
            options,
        )
    };
    let mut selected_store = open(s::StoreOptions {
        allow_synthetic_bootstrap: true,
        ..Default::default()
    })?;
    selected_store.initialize_synthetic(&serde_json::from_value(published)?)?;
    selected_store.close()?;
    let replacement = open(s::StoreOptions::default())?;
    let old = std::mem::replace(
        core.store.get_mut().map_err(|_| "Store unavailable")?,
        replacement,
    );
    old.close()?;

    // The new item identity has no source reference or inferred classification.
    let direct = json!({"schemaVersion":3,"commandId":"atlas.identity.create",
        "requestId":id(921),"context":context,"target":target("identity",920),
        "payload":{"kind":"item","evidenceIds":[id(100)]},
        "idempotencyKey":id(1920),"reason":"Fresh synthetic item identity",
        "preconditions":{"target":null,"guards":[guard("evidence",100,1)]},"approvalReceiptId":null});
    let direct_result = write(&core, &cookie, &csrf, &direct, &schemas)?;
    let derived = json!({"schemaVersion":3,"commandId":"atlas.geometry.create",
        "requestId":id(922),"context":context,"target":target("geometry",921),
        "payload":geometry_payload,
        "idempotencyKey":id(1921),"reason":"Fresh synthetic derived geometry",
        "preconditions":{"target":null,"guards":[guard("asset",600,1),guard("identity",200,1),guard("evidence",100,1)]},
        "approvalReceiptId":null});
    let derived_result = write(&core, &cookie, &csrf, &derived, &schemas)?;
    // Third root is beyond page1+lookahead. Initial preparation must still
    // provide it for historical qualification before the host seals grants.
    let mut third = direct.clone();
    third["requestId"] = json!(id(923));
    third["target"] = target("identity", 922);
    third["idempotencyKey"] = json!(id(1922));
    third["reason"] = json!("Fresh third synthetic history root");
    let third_result = write(&core, &cookie, &csrf, &third, &schemas)?;

    assert_eq!(direct_result["data"]["records"][0]["revision"], 1);
    assert_eq!(derived_result["data"]["records"][0]["revision"], 1);
    // Compare SQLite and its WAL while Store remains open. No retained read
    // should append a durable cursor or otherwise alter the Atlas database.
    let wal_path = database.with_extension("sqlite-wal");
    let before = (
        fs::read(&database)?,
        fs::read(&wal_path).unwrap_or_default(),
    );

    let history_path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/records/identity/{}/history",
        scope.workspace_id,
        scope.home_id,
        id(920)
    );
    let original_box = Box::new(issued(&core, &cookie, None, &history_path)?);
    let read_authority = FixtureReadAuthorization {
        read: ReadAuthority(Arc::clone(&core.access)),
        owner: s::StockRetainedReadOwner::new(),
        original: &*original_box,
        scope: scope.clone(),
    };
    let stock = NativeStockContract::new()?;
    let original = original_box.principal.retained();
    let mut store = core.store.lock().map_err(|_| "Store unavailable")?;
    for (raw, result) in [
        (&direct, &direct_result),
        (&derived, &derived_result),
        (&third, &third_result),
    ] {
        let prepared = store.prepare_stock_retained_intent_with_authorization(
            &read_authority,
            &original_box,
            &stock,
            raw,
            original,
        )?;
        assert_eq!(prepared.scope(), &scope);
        let disclosed = store.disclose_stock_retained_intent_with_authorization(
            &read_authority,
            &original_box,
            &stock,
            &prepared,
        )?;
        assert_eq!(disclosed.outcome, "retained-commit");
        assert_eq!(disclosed.retry_safety, "not-established");
        assert_eq!(
            Some(disclosed.command_id.as_str()),
            raw["commandId"].as_str()
        );
        assert_eq!(
            disclosed.operation_id.as_deref(),
            result["operationId"].as_str()
        );
        assert_eq!(
            Some(disclosed.request_digest.as_str()),
            result["data"]["requestDigest"].as_str()
        );
        let reconciled = store.disclose_stock_retained_committed_result_with_authorization(
            &read_authority,
            &original_box,
            &stock,
            &prepared,
        )?;
        assert_eq!(reconciled.inspection, disclosed);
        assert_committed_result(
            &reconciled,
            raw["requestId"]
                .as_str()
                .ok_or("Missing original request ID")?,
            raw["requestId"]
                .as_str()
                .ok_or("Missing original request ID")?,
            result,
        );
    }
    // This is a lookup only. A new requestId is not a write or a replay;
    // disclosure must still return the exact first committed stock result.
    let mut direct_lookup = direct.clone();
    direct_lookup["requestId"] = json!(id(940));
    let prepared = store.prepare_stock_retained_intent_with_authorization(
        &read_authority,
        &original_box,
        &stock,
        &direct_lookup,
        original,
    )?;
    let reconciled = store.disclose_stock_retained_committed_result_with_authorization(
        &read_authority,
        &original_box,
        &stock,
        &prepared,
    )?;
    assert_committed_result(&reconciled, &id(940), &id(921), &direct_result);
    let mut continuation = None;
    let mut collected = Vec::new();
    let mut pinned_watermark = None;
    loop {
        let prepared = store.prepare_stock_operation_events_with_authorization(
            &read_authority,
            &original_box,
            &stock,
            original,
            &scope,
            1,
            continuation.as_ref(),
        )?;
        let closure = prepared.snapshot_closure();
        assert_eq!(closure.retained_commits().len(), 3);
        assert!(closure.retained_commits().iter().any(
            |commit| Some(commit.operation_id.as_str()) == third_result["operationId"].as_str()
        ));
        assert_eq!(closure.targets(), prepared.targets());
        if let Some(watermark) = pinned_watermark {
            assert_eq!(closure.watermark(), watermark);
        } else {
            pinned_watermark = Some(closure.watermark());
        }
        let disclosed = store.disclose_stock_operation_events_with_authorization(
            &read_authority,
            &original_box,
            &stock,
            &prepared,
        )?;
        assert_eq!(disclosed.page.entries.len(), 1);
        collected.extend(disclosed.page.entries);
        continuation = disclosed.continuation;
        if continuation.is_none() {
            break;
        }
    }
    assert_eq!(collected.len(), 3);
    for (event, raw, result) in [
        (&collected[0], &direct, &direct_result),
        (&collected[1], &derived, &derived_result),
        (&collected[2], &third, &third_result),
    ] {
        assert_eq!(
            Some(event.event_id.as_str()),
            result["data"]["auditIds"][0].as_str()
        );
        assert_eq!(
            Some(event.root_operation_id.as_str()),
            result["operationId"].as_str()
        );
        assert_eq!(
            Some(event.operation_id.as_str()),
            result["operationId"].as_str()
        );
        assert_eq!(Some(event.command_id.as_str()), raw["commandId"].as_str());
        assert_eq!(
            Some(event.request_digest.as_str()),
            result["data"]["requestDigest"].as_str()
        );
        assert!(!event.at.is_empty());
    }
    assert_eq!(
        before,
        (
            fs::read(&database)?,
            fs::read(&wal_path).unwrap_or_default()
        )
    );
    drop(store);
    drop(read_authority);
    drop(original_box);

    // A regular close/reopen and a fresh GET principal give a new preparation.
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
    let fresh = Box::new(issued(&core, &cookie, None, &history_path)?);
    let fresh_authority = FixtureReadAuthorization {
        read: ReadAuthority(Arc::clone(&core.access)),
        owner: s::StockRetainedReadOwner::new(),
        original: &*fresh,
        scope: scope.clone(),
    };
    let mut store = core.store.lock().map_err(|_| "Store unavailable")?;
    let prepared = store.prepare_stock_retained_intent_with_authorization(
        &fresh_authority,
        &fresh,
        &stock,
        &derived,
        fresh.principal.retained(),
    )?;
    let disclosed = store.disclose_stock_retained_intent_with_authorization(
        &fresh_authority,
        &fresh,
        &stock,
        &prepared,
    )?;
    assert_eq!(disclosed.outcome, "retained-commit");
    assert_eq!(
        disclosed.operation_id.as_deref(),
        derived_result["operationId"].as_str()
    );
    let reconciled = store.disclose_stock_retained_committed_result_with_authorization(
        &fresh_authority,
        &fresh,
        &stock,
        &prepared,
    )?;
    assert_eq!(reconciled.inspection, disclosed);
    assert_committed_result(&reconciled, &id(922), &id(922), &derived_result);
    println!(
        "healthy-stock-retained-read: three genuine writes, exact committed results, alternate lookup ID, three event pages and ordinary reopen verified"
    );
    Ok(())
}
