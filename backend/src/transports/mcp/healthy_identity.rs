//! Positive identity lifecycle over the existing real local Atlas composition.
//! No provider, fake service, authority replacement or held lifecycle control.

use super::{Client, ORIGIN, command, guard, id, target};
use crate::{
    access as a,
    app::{Core, ReadAuthority, ServerRuntime, Store, access_scope},
    contracts::stock as wire,
    domain::stock::AtlasListPages,
    http::contracts::NativeContracts,
    lifecycle::{self, Failure},
    media::native::NativeMediaRuntime,
    storage,
    transports::mcp::LocalAtlasSession,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, sync::Arc, sync::Mutex};

const QUERY: &str = "00000000-0000-4000-8000-0000000031";

pub(super) struct Fixture {
    core: Core,
    scratch: tempfile::TempDir,
    scope: a::Scope,
    pub(super) context: Value,
    url: String,
    cookie: String,
    csrf: String,
}

impl Fixture {
    pub(super) fn new() -> Result<Self, Failure> {
        let scratch = tempfile::Builder::new()
            .prefix("houseatlas-mcp288-identity-")
            .tempdir_in("/tmp")?;
        let directory = scratch.path().join("fixture");
        let core = lifecycle::prepare(&directory, ORIGIN)?;
        let scope = access_scope(&core.home.scope)?;
        let context = json!({"workspaceId":core.home.scope.workspace_id,
            "homeId":core.home.scope.home_id});
        let url = format!(
            "{ORIGIN}/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
            core.home.scope.workspace_id, core.home.scope.home_id
        );
        let (cookie, csrf) = {
            let receipt: Value =
                serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
            let login_body =
                serde_json::to_vec(receipt.get("editorLogin").ok_or("Missing login")?)?;
            let login_url = format!("{ORIGIN}/api/atlas/auth/login");
            let login = core
                .access
                .lock()
                .map_err(|_| "Access unavailable")?
                .login(
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
                    "mcp288-identity-positive",
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
        Ok(Self {
            core,
            scratch,
            scope,
            context,
            url,
            cookie,
            csrf,
        })
    }

    pub(super) fn client(&self) -> Client<'_> {
        Client {
            core: &self.core,
            scope: &self.scope,
            url: &self.url,
            cookie: &self.cookie,
            csrf: &self.csrf,
        }
    }

    pub(super) fn reopen(mut self) -> Result<Self, Failure> {
        let Core {
            access,
            store,
            vault,
            home,
            homes,
            ..
        } = self.core;
        Arc::try_unwrap(store)
            .map_err(|_| "Store retained")?
            .into_inner()
            .map_err(|_| "Store unavailable")?
            .close()?;
        let reopened = Store::open(
            self.scratch.path().join("fixture/atlas.sqlite"),
            NativeContracts,
            ReadAuthority(Arc::clone(&access)),
            NativeMediaRuntime {
                vault: Arc::clone(&vault),
                server: ServerRuntime,
            },
            storage::StoreOptions::default(),
        )?;
        self.core = Core {
            access,
            store: Arc::new(Mutex::new(reopened)),
            vault,
            home,
            homes,
            atlas_list_pages: AtlasListPages::default(),
            media_policy_evidence: Mutex::default(),
        };
        Ok(self)
    }
}

fn committed(
    outcome: &Value,
    intent: &Value,
    revision: u64,
    lifecycle: &str,
    payload: &Value,
) -> Value {
    assert_eq!(outcome["status"], "committed");
    assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
    let expected = json!({"target":intent["target"],"revision":revision,
        "lifecycle":lifecycle,"payload":payload});
    assert_eq!(outcome["data"]["records"], json!([expected]));
    expected
}

async fn get(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: &Value,
    request_id: u32,
) {
    let request = json!({"schemaVersion":3,"commandId":"atlas.identity.get",
        "requestId":id(request_id),"context":context,
        "target":expected["target"],"payload":{}});
    let result = client.call(session, &request).await;
    assert_eq!(result["status"], "read");
    assert_eq!(result["data"]["records"], json!([expected]));
    assert_eq!(result["data"]["sourceStatus"], "current");
    assert_eq!(result["data"]["nextCursor"], Value::Null);
}

async fn list(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: &[Value],
    include_archived: bool,
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut request = json!({"schemaVersion":3,"commandId":"atlas.identity.list",
        "requestId":id(first_request_id),"context":context,
        "target":{"authority":"atlas","recordType":"identity"},
        "payload":{"pageSize":1,"cursor":null,"includeArchived":include_archived,
            "q":QUERY}});
    let mut seen = Vec::new();
    let mut tokens = BTreeSet::new();
    for (index, record) in expected.iter().enumerate() {
        request["requestId"] = json!(id(first_request_id + index as u32));
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["sourceStatus"], "current");
        assert_eq!(result["data"]["records"], json!([record]));
        seen.push(result["data"]["records"][0].clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 < expected.len() {
            let cursor = next
                .as_str()
                .ok_or("Native identity list cursor required")?;
            assert!(!cursor.is_empty());
            assert!(tokens.insert(cursor.to_owned()));
            request["payload"]["cursor"] = next.clone();
        } else {
            assert_eq!(next, &Value::Null);
        }
    }
    assert_eq!(seen.as_slice(), expected);
    Ok(seen)
}

async fn history(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    steps: &[(Value, Value)],
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut request = json!({"schemaVersion":3,"commandId":"atlas.identity.history",
        "requestId":id(first_request_id),"context":context,
        "target":target("identity",3102),
        "payload":{"pageSize":1,"cursor":null,"includeArchived":false,
            "q":"atlas.identity."}});
    let validation = wire::StockValidation::new()?;
    let mut entries: Vec<Value> = Vec::new();
    let mut tokens = BTreeSet::new();
    for (index, (intent, outcome)) in steps.iter().enumerate() {
        request["requestId"] = json!(id(first_request_id + index as u32));
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["completeness"], "atlas-owned-audit");
        let page = result["data"]["entries"]
            .as_array()
            .ok_or("Missing native identity history")?;
        assert_eq!(page.len(), 1);
        let entry = &page[0];
        let parsed = wire::StockRequest::parse(&validation, intent.clone())?;
        assert_eq!(entry["eventId"], outcome["data"]["auditIds"][0]);
        assert_eq!(entry["commandId"], intent["commandId"]);
        assert_eq!(entry["requestDigest"], parsed.intent_digest());
        assert_eq!(entry["actorId"], id(7));
        assert_eq!(entry["target"], intent["target"]);
        assert_eq!(entry["state"], "committed");
        // The native owner includes explicit null for create's missing preimage.
        assert!(entry.get("beforeDigest").is_some());
        if index == 0 {
            assert_eq!(entry["beforeDigest"], Value::Null);
            assert_eq!(intent["preconditions"]["target"], Value::Null);
        } else {
            assert_eq!(entry["beforeDigest"], entries[index - 1]["afterDigest"]);
        }
        assert_eq!(entry["afterDigest"].as_str().unwrap().len(), 64);
        assert_eq!(intent["approvalReceiptId"], Value::Null);
        entries.push(entry.clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 < steps.len() {
            let cursor = next
                .as_str()
                .ok_or("Native identity history cursor required")?;
            assert!(!cursor.is_empty());
            assert!(tokens.insert(cursor.to_owned()));
            request["payload"]["cursor"] = next.clone();
        } else {
            assert_eq!(next, &Value::Null);
        }
    }
    Ok(entries)
}

#[test]
fn healthy_native_identity_lifecycle_lists_history_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let context = fixture.context.clone();
    let (expected, steps, before_history) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let initial_payload = json!({"kind":"item","evidenceIds":[]});
        let mut records = Vec::new();
        let mut steps = Vec::new();
        // The closed identity payload has no label/null/unknown fields.
        // Search uses its canonical UUID prefix, never invented payload keys.
        for (index, record_id) in [3103, 3101, 3102].into_iter().enumerate() {
            let intent = command(
                &context,
                "atlas.identity.create",
                target("identity", record_id),
                initial_payload.clone(),
                None,
                vec![],
                400 + index as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            records.push(committed(&outcome, &intent, 1, "active", &initial_payload));
            if record_id == 3102 {
                steps.push((intent, outcome));
            }
        }
        records.sort_by(|left, right| {
            left["target"]["recordId"]
                .as_str()
                .cmp(&right["target"]["recordId"].as_str())
        });
        assert_eq!(
            records
                .iter()
                .map(|r| r["target"]["recordId"].clone())
                .collect::<Vec<_>>(),
            vec![json!(id(3101)), json!(id(3102)), json!(id(3103))]
        );
        list(&client, &mut session, &context, &records, false, 6000).await?;
        let revised_payload = json!({"kind":"item","evidenceIds":[id(100)]});
        // Physical kind is immutable. Replace changes only the evidence links,
        // with the actual evidence revision guard and target precondition.
        for (index, operation, revision, lifecycle, payload) in [
            (0, "replace", 2, "active", revised_payload.clone()),
            (1, "tombstone", 3, "tombstoned", json!({})),
            (2, "restore", 4, "active", json!({})),
        ] {
            let intent = command(
                &context,
                &format!("atlas.identity.{operation}"),
                target("identity", 3102),
                payload,
                Some(revision - 1),
                vec![guard("evidence", 100)],
                410 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            records[1] = committed(&outcome, &intent, revision, lifecycle, &revised_payload);
            get(&client, &mut session, &context, &records[1], 6050 + index).await;
            let visible = if operation == "tombstone" {
                vec![records[0].clone(), records[2].clone()]
            } else {
                records.clone()
            };
            list(
                &client,
                &mut session,
                &context,
                &visible,
                false,
                6100 + 10 * index,
            )
            .await?;
            if operation == "tombstone" {
                list(&client, &mut session, &context, &records, true, 6150).await?;
            }
            steps.push((intent, outcome));
        }
        let before_history = history(&client, &mut session, &context, &steps, 6300).await?;
        session.close();
        (records, steps, before_history)
    };
    // Strict store reopen, retained Access: no process/session restart claim.
    let fixture = fixture.reopen()?;
    {
        let client = fixture.client();
        let mut session = client.open().await;
        assert_eq!(
            list(&client, &mut session, &context, &expected, false, 7000).await?,
            expected
        );
        list(&client, &mut session, &context, &expected, true, 7010).await?;
        for (index, record) in expected.iter().enumerate() {
            get(&client, &mut session, &context, record, 7100 + index as u32).await;
        }
        assert_eq!(
            history(&client, &mut session, &context, &steps, 7200).await?,
            before_history
        );
        session.close();
    }
    drop(fixture);
    Ok(())
}
