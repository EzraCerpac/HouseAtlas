//! Compile-only ordinary valid numeric-equivalence example.
//! Actual offline schemas, native plans and owner canonical JSON; no authority,
//! storage execution, retained receipt construction, replay or control probes.
use houseatlas_at36_stock_harness::{
    domain::{native_semantics::NativeSemantics, stock::*},
    storage::{Contract, NativeContract},
};
use serde_json::{Value, json};

type ExampleResult<T> = Result<T, Box<dyn std::error::Error>>;

fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}

fn check_equivalent_requests(
    integer: Value,
    decimal: Value,
    stock: &NativeStockContract,
    native: &NativeContract<NativeSemantics>,
) -> ExampleResult<()> {
    let original_integer = integer.clone();
    let original_decimal = decimal.clone();
    let integer = ValidatedRequest::parse(stock, integer)?;
    let decimal = ValidatedRequest::parse(stock, decimal)?;
    let integer_plan = plan_atlas_commands(&integer, native)?;
    let decimal_plan = plan_atlas_commands(&decimal, native)?;
    assert_eq!(integer.intent_digest(), decimal.intent_digest());
    assert_eq!(integer_plan.groups().len(), decimal_plan.groups().len());
    for (integer, decimal) in integer_plan.groups().iter().zip(decimal_plan.groups()) {
        assert_eq!(integer.child_index(), decimal.child_index());
        assert_eq!(integer.request_digest(), decimal.request_digest());
        assert_eq!(
            native.canonical_json(integer.original_request())?,
            native.canonical_json(decimal.original_request())?,
        );
        assert_eq!(
            native.canonical_json(&serde_json::to_value(integer.native_entries())?)?,
            native.canonical_json(&serde_json::to_value(decimal.native_entries())?)?,
        );
    }
    assert_eq!(integer.raw(), &original_integer);
    assert_eq!(decimal.raw(), &original_decimal);
    Ok(())
}

fn main() -> ExampleResult<()> {
    let snapshot: Value = serde_json::from_str(include_str!(
        "../../../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    let mut payload = snapshot["records"]
        .as_array()
        .ok_or("Published records required")?
        .iter()
        .find(|record| {
            record["recordType"] == "evidence"
                && !record["payload"]["provenance"]["source"].is_null()
        })
        .ok_or("Published evidence payload required")?["payload"]
        .clone();
    payload["provenance"]["sourceRevision"] = json!(1);
    let integer = json!({
        "schemaVersion":3,"commandId":"atlas.evidence.create","requestId":id(95_020),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":"evidence","recordId":id(420)},
        "payload":payload,"idempotencyKey":id(1_020),
        "reason":"Synthetic equivalent numeric provenance",
        "preconditions":{"target":null,"guards":[]},"approvalReceiptId":null
    });
    let mut decimal = integer.clone();
    decimal["payload"]["provenance"]["sourceRevision"] = serde_json::from_str("1.0")?;
    let stock = NativeStockContract::new()?;
    let native = NativeContract::new(NativeSemantics::native());
    assert_eq!(
        native.canonical_json(&decimal["payload"]["provenance"]["sourceRevision"])?,
        "1"
    );
    check_equivalent_requests(integer.clone(), decimal.clone(), &stock, &native)?;

    let batch = |child| {
        json!({
            "schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(95_021),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"atlas","kind":"batch","batchId":id(1_022)},
            "idempotencyKey":id(1_021),"reason":"Synthetic ordered numeric provenance",
            "preconditions":{"target":null,"guards":[]},"approvalReceiptId":null,
            "payload":{"commands":[child]}
        })
    };
    check_equivalent_requests(batch(integer), batch(decimal), &stock, &native)?;
    Ok(())
}
