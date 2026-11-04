//! Actual native admission/root refusal without a remap approval owner.
//! Fictional disposable SQLite only; no approval mint, provider or listener.

use super::{Client, command, guard, id, identity::Fixture, target};
use crate::{
    app::RequestPrincipal,
    contracts::stock as wire,
    domain::stock::StockError,
    http::agents::{capabilities, stock_dispatch},
    lifecycle::Failure,
    transports::mcp::lifecycle::{AuthenticatedIdentity, Delivery},
};
use rusqlite::{Connection, OpenFlags, types::Value as SqlValue};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path, sync::Arc};

type Rows = BTreeMap<&'static str, Vec<Vec<SqlValue>>>;

fn retained_rows(path: &Path) -> Result<Rows, Failure> {
    // Fixed owned tables, read-only observation; no production SQL interface.
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut result = BTreeMap::new();
    for table in [
        "records",
        "binding_reservations",
        "audits",
        "receipts",
        "batch_receipts",
        "stock_operations",
        "stock_groups",
        "stock_keys",
        "stock_audit_links",
        "stock_history_lookup",
    ] {
        let mut query = database.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let columns = query.column_count();
        let values = query
            .query_map([], |row| {
                (0..columns)
                    .map(|column| row.get(column))
                    .collect::<Result<Vec<SqlValue>, _>>()
            })?
            .collect::<Result<Vec<_>, _>>()?;
        result.insert(table, values);
    }
    Ok(result)
}

fn remap(context: &Value, receipt: Value, serial: u32) -> Value {
    let mut request = command(
        context,
        "atlas.binding.remap",
        target("binding", 301),
        json!({"oldBindingId":id(301),"newBindingId":id(23100),"journalId":id(23101),
            "source":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
                "sourceKind":"homebox-entity","externalId":id(504)},
            "reason":"import-id-remap","evidenceIds":[id(100)]}),
        Some(1),
        vec![
            guard("binding", 301),
            guard("identity", 201),
            guard("evidence", 100),
        ],
        serial,
    );
    request["approvalReceiptId"] = receipt;
    request
}

fn circuit(context: &Value, serial: u32) -> Value {
    command(
        context,
        "atlas.circuit.create",
        target("circuit", 23200),
        json!({"label":"Synthetic permitted batch child α","panel":null,"evidenceIds":[id(100)]}),
        None,
        vec![guard("evidence", 100)],
        serial,
    )
}

fn batch(context: &Value, children: Vec<Value>, receipt: Value, serial: u32) -> Value {
    let mut guards = Vec::new();
    for child in &children {
        for guard in child["preconditions"]["guards"].as_array().unwrap() {
            if !guards.contains(guard) {
                guards.push(guard.clone());
            }
        }
    }
    let mut request = command(
        context,
        "atlas.batch.execute",
        json!({"authority":"atlas","kind":"batch","batchId":id(24000+serial)}),
        json!({"commands":children}),
        None,
        guards,
        serial,
    );
    request["approvalReceiptId"] = receipt;
    request
}

async fn refused(
    client: &Client<'_>,
    session: &mut super::LocalAtlasSession<'_>,
    request: &Value,
    path: &Path,
) -> Result<(), Failure> {
    let before = retained_rows(path)?;
    let validator = wire::StockValidation::new()?;
    wire::StockRequest::parse(&validator, request.clone())?;
    let current = AuthenticatedIdentity::authenticate_post(
        Arc::clone(&client.core.access),
        &client.evidence(),
        client.scope,
    )?;
    assert_eq!(current.original().actor_id().as_str(), id(7));
    assert_eq!(current.original().role(), crate::access::Role::Editor);
    assert!(
        !capabilities::admitted(client.core, current.original())
            .contains(&wire::OperationId::AtlasBindingRemap)
    );
    let principal = RequestPrincipal::new(current.original().clone());
    // Bypass discovery deliberately through the existing shared root entry:
    // even an old/direct caller with genuine Editor issuance stays held.
    assert!(matches!(
        stock_dispatch::execute(client.core, &principal, request.clone()),
        Err(StockError::CapabilityHeld)
    ));
    assert_eq!(retained_rows(path)?, before);
    {
        let access = client
            .core
            .access
            .lock()
            .map_err(|_| "Access unavailable")?;
        principal.release(&access)?;
    }

    let operation = wire::OperationId::parse(request["commandId"].as_str().unwrap()).unwrap();
    let family = wire::operation(operation)?.tool_family.as_str();
    let frame = json!({"jsonrpc":"2.0","id":request["requestId"],"method":"tools/call",
        "params":{"name":family,"arguments":request}});
    let delivery = session
        .handle(&current, &serde_json::to_vec(&frame)?)
        .await
        .map_err(|_| "Missing actual refusal")?;
    let Delivery::Reply(bytes) = delivery else {
        return Err("Expected refusal reply".into());
    };
    let reply: Value = serde_json::from_slice(&bytes)?;
    assert_eq!(reply["jsonrpc"], "2.0");
    assert_eq!(reply["id"], request["requestId"]);
    assert_eq!(reply["error"]["code"], -32603);
    assert_eq!(reply["error"]["message"], "Service unavailable");
    assert!(reply.get("result").is_none());
    assert_eq!(retained_rows(path)?, before);
    Ok(())
}

#[test]
fn native_remap_hold_preserves_store_and_permitted_batch() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let path = fixture.database_path();
    let context = fixture.context.clone();
    let original;
    {
        let client = fixture.client();
        let mut session = client.open().await;
        let listed = client
            .frame(
                &mut session,
                json!({"jsonrpc":"2.0","id":"remap-hold-tools",
            "method":"tools/list","params":{}}),
            )
            .await;
        let descriptor = serde_json::to_string(&listed["result"]["tools"])?;
        assert!(!descriptor.contains("\"atlas.binding.remap\""));
        for permitted in [
            "atlas.binding.create",
            "atlas.circuit.create",
            "atlas.batch.execute",
        ] {
            assert!(descriptor.contains(permitted));
        }
        original = retained_rows(&path)?;
        for (index, receipt) in [Value::Null, json!(id(23999))].into_iter().enumerate() {
            let serial = 22000 + index as u32 * 10;
            let remap = remap(&context, receipt.clone(), serial);
            refused(&client, &mut session, &remap, &path).await?;
            assert_eq!(retained_rows(&path)?, original);
            for (offset, children) in [
                vec![circuit(&context, serial + 1), remap.clone()],
                vec![remap.clone(), circuit(&context, serial + 2)],
            ]
            .into_iter()
            .enumerate()
            {
                let mixed = batch(
                    &context,
                    children,
                    receipt.clone(),
                    serial + 3 + offset as u32,
                );
                refused(&client, &mut session, &mixed, &path).await?;
                assert_eq!(retained_rows(&path)?, original);
            }
        }
        session.close();
    }
    let fixture = fixture.reopen()?;
    assert_eq!(retained_rows(&path)?, original);
    {
        let client = fixture.client();
        let mut session = client.open().await;
        let binding = command(
            &context,
            "atlas.binding.create",
            target("binding", 23201),
            json!({"atlasId":id(201),"source":{"sourceInstanceId":id(10),
                "collectionId":"synthetic-collection-a","sourceKind":"homebox-entity",
                "externalId":id(507)},"reviewStatus":"proposed","evidenceIds":[id(100)]}),
            None,
            vec![guard("identity", 201), guard("evidence", 100)],
            22301,
        );
        let permitted = batch(
            &context,
            vec![circuit(&context, 22300), binding],
            Value::Null,
            22302,
        );
        let result = client.call(&mut session, &permitted).await;
        assert_eq!(result["status"], "committed");
        assert_eq!(result["data"]["records"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["data"]["records"][0]["target"],
            target("circuit", 23200)
        );
        assert_eq!(
            result["data"]["records"][1]["target"],
            target("binding", 23201)
        );
        assert_eq!(
            result["data"]["records"][1]["payload"]["sourceState"],
            "unresolved"
        );
        assert_ne!(retained_rows(&path)?, original);
        session.close();
    }
    drop(fixture);
    Ok(())
}
