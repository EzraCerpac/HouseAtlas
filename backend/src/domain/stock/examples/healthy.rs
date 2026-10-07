//! Synthetic consumer only: native offline exact-schema validator plus injected
//! graph/authority/query/command peers. No provider IO, storage, replay or controls.
use houseatlas_at36_stock_harness::*;
use serde_json::{Value, json};
use std::cell::Cell;

struct SyntheticAuthority {
    revalidations: Cell<u32>,
    disclosures: Cell<u32>,
}
impl StockAuthorityPort<()> for SyntheticAuthority {
    type Witness = &'static str;
    type Graph = Value;
    fn capture(&self, _: &(), _: &ValidatedRequest) -> StockResult<Self::Witness> {
        Ok("synthetic-captured-authority")
    }
    fn authorize_graph(
        &self,
        _: &(),
        _: &&str,
        _: &ValidatedRequest,
        _: &Value,
    ) -> StockResult<()> {
        Ok(())
    }
    fn revalidate(&self, _: &(), _: &&str, _: &ValidatedRequest) -> StockResult<()> {
        self.revalidations.set(self.revalidations.get() + 1);
        Ok(())
    }
    fn authorize_result(
        &self,
        _: &(),
        _: &PreparedRequest<&str, Value>,
        _: &ValidatedRequest,
        _: &Value,
    ) -> StockResult<()> {
        Ok(())
    }
    fn disclose(
        &self,
        _: &(),
        _: &PreparedRequest<&str, Value>,
        _: &ValidatedRequest,
        _: &Value,
        _: &Value,
        _: DisclosurePurpose,
    ) -> StockResult<()> {
        self.disclosures.set(self.disclosures.get() + 1);
        Ok(())
    }
}
struct SyntheticPreparer;
impl StockPreparerPort<(), &'static str> for SyntheticPreparer {
    type Graph = Value;
    fn resolve(&mut self, _: &(), _: &&str, request: &ValidatedRequest) -> StockResult<Value> {
        Ok(json!({"synthetic":true,"originalRequest":request.raw()}))
    }
}
struct SyntheticOwner {
    calls: Vec<&'static str>,
}
impl StockQueryPort<(), &'static str, Value> for SyntheticOwner {
    fn query(
        &mut self,
        _: &(),
        prepared: &PreparedRequest<&str, Value>,
    ) -> StockResult<OwnerResult> {
        let request = prepared.request();
        self.calls.push(request.id().as_str());
        let data = match request.id() {
            OperationId::AtlasIdentityGet => {
                json!({"records":[record(request)],"nextCursor":null,"sourceStatus":"current"})
            }
            OperationId::HomeboxQueryRead => json!({"kind":"maintenance","rows":[{
                "target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":"maintenance","entityId":id(5),"resourceId":id(6)},
                "name":"Synthetic service","description":"Synthetic task","scheduledDate":null,"completedDate":null,"cost":"0"}]}),
            OperationId::HomeboxLabelOutput => json!({"kind":"label-image","artifact":{
                "downloadToken":id(13),"sha256":"a".repeat(64),"byteSize":42,"contentType":"image/png","expiresAt":"2026-10-06T12:30:00Z"}}),
            _ => return Err(StockError::OwnerUnavailable),
        };
        let mut wire = json!({"schemaVersion":3,"commandId":request.id().as_str(),"requestId":request.request_id(),
            "resolvedScope":request.context(),"status":"read","data":data});
        if request.operation().authority == Authority::Atlas {
            wire["replayed"] = json!(false);
        } else {
            wire["sourceInstanceId"] = request.target()["sourceInstanceId"].clone();
            wire["collectionId"] = request.target()["collectionId"].clone();
            wire["retrievedAt"] = json!("2026-10-06T12:00:00Z");
        }
        Ok(OwnerResult {
            wire,
            children: Vec::new(),
        })
    }
}
impl StockCommandPort<(), &'static str, Value> for SyntheticOwner {
    fn execute(
        &mut self,
        _: &(),
        prepared: &PreparedRequest<&str, Value>,
    ) -> StockResult<OwnerResult> {
        let request = prepared.request();
        self.calls.push(request.id().as_str());
        if request.id() == OperationId::AtlasBatchExecute {
            let children: Vec<_> = request
                .children()
                .iter()
                .enumerate()
                .map(|(i, r)| receipt(r, id(31 + i)))
                .collect();
            let records: Vec<_> = children
                .iter()
                .flat_map(|c| c["data"]["records"].as_array().unwrap().clone())
                .collect();
            let audits: Vec<_> = children
                .iter()
                .flat_map(|c| c["data"]["auditIds"].as_array().unwrap().clone())
                .collect();
            let mut wire = receipt(request, id(30));
            wire["data"]["records"] = json!(records);
            wire["data"]["auditIds"] = json!(audits);
            Ok(OwnerResult { wire, children })
        } else {
            Ok(OwnerResult {
                wire: receipt(request, id(30)),
                children: Vec::new(),
            })
        }
    }
}
fn id(n: usize) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn context() -> Value {
    json!({"workspaceId":id(1),"homeId":id(2)})
}
fn record(request: &ValidatedRequest) -> Value {
    json!({"target":request.target(),"revision":1,"lifecycle":"active","payload":{"kind":"item","evidenceIds":[]}})
}
fn receipt(request: &ValidatedRequest, audit: String) -> Value {
    json!({"schemaVersion":3,"commandId":request.id().as_str(),"requestId":request.request_id(),"resolvedScope":request.context(),
        "status":"committed","replayed":false,"operationId":id(29),"data":{"records":[record(request)],"auditIds":[audit],"requestDigest":request.intent_digest()}})
}
fn create(n: usize) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.identity.create","requestId":id(n+100),"context":context(),
        "target":{"authority":"atlas","recordType":"identity","recordId":id(n)},"payload":{"kind":"item","evidenceIds":[]},
        "idempotencyKey":id(n+200),"reason":"Synthetic healthy example","preconditions":{"target":null,"guards":[]},"approvalReceiptId":null})
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let contracts = NativeStockContract::new()?;
    let authority = SyntheticAuthority {
        revalidations: Cell::new(0),
        disclosures: Cell::new(0),
    };
    let mut preparer = SyntheticPreparer;
    let mut queries = SyntheticOwner { calls: Vec::new() };
    let mut commands = SyntheticOwner { calls: Vec::new() };
    assert_eq!(OPERATIONS.len(), 164);
    assert_eq!(FEATURE_ROUTES.len(), 21);
    for op in OPERATIONS {
        assert_eq!(OperationId::parse(op.id.as_str()), Some(op.id));
    }
    let single = prepare(&(), create(10), &contracts, &authority, &mut preparer)?;
    dispatch(
        &(),
        single,
        &contracts,
        &authority,
        &mut queries,
        &mut commands,
    )?;
    let read = json!({"schemaVersion":3,"commandId":"atlas.identity.get","requestId":id(111),"context":context(),
        "target":{"authority":"atlas","recordType":"identity","recordId":id(10)},"payload":{}});
    dispatch(
        &(),
        prepare(&(), read, &contracts, &authority, &mut preparer)?,
        &contracts,
        &authority,
        &mut queries,
        &mut commands,
    )?;
    let batch = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(130),"context":context(),
        "target":{"authority":"atlas","kind":"batch","batchId":id(20)},"idempotencyKey":id(220),"reason":"Synthetic ordered batch",
        "approvalReceiptId":null,"preconditions":{"target":null,"guards":[]},"payload":{"commands":[create(11),create(12)]}});
    let prepared = prepare(&(), batch.clone(), &contracts, &authority, &mut preparer)?;
    assert_eq!(
        prepared.request().children()[0].raw(),
        &batch["payload"]["commands"][0]
    );
    assert_eq!(
        prepared.request().children()[1].raw(),
        &batch["payload"]["commands"][1]
    );
    let batch_digest = prepared.request().intent_digest().to_owned();
    dispatch(
        &(),
        prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut commands,
    )?;
    let provider = json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set","requestId":id(115),"context":context(),
        "target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":"entity","resourceId":id(5)},
        "payload":{"quantity":0},"idempotencyKey":id(215),"reason":"Synthetic zero quantity","approvalReceiptId":null,
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":id(16)},"atlasGuards":[]}});
    let prepared = prepare(&(), provider.clone(), &contracts, &authority, &mut preparer)?;
    assert!(prepared.request().is_mutation());
    assert_eq!(prepared.request().raw(), &provider);
    assert!(matches!(
        prepared.request().route(),
        Route::HomeboxNative(NativeRoute {
            method: Method::Patch,
            path: "/api/v1/entities/{id}"
        })
    ));
    let provider_digest = prepared.request().intent_digest().to_owned();
    let collection = json!({"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":"collection"});
    let query = json!({"schemaVersion":3,"commandId":"homebox.query.read","requestId":id(116),"context":context(),"target":collection,
        "payload":{"view":"maintenance","status":"both","limit":10}});
    let prepared = prepare(&(), query, &contracts, &authority, &mut preparer)?;
    assert!(prepared.request().whole_collection_required());
    dispatch(
        &(),
        prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut commands,
    )?;
    let label = json!({"schemaVersion":3,"commandId":"homebox.label.output","requestId":id(117),"context":context(),"target":collection,
        "payload":{"subject":"item","delivery":"render","resourceId":id(5),"maxBytes":1000},"idempotencyKey":id(217),"reason":"Synthetic label", "preconditions":null,"approvalReceiptId":null});
    let prepared = prepare(&(), label, &contracts, &authority, &mut preparer)?;
    assert!(matches!(
        prepared.request().route(),
        Route::HomeboxFeature { print: false, .. }
    ));
    dispatch(
        &(),
        prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut commands,
    )?;
    let canonical_value = json!({"\u{e000}":"private-use", "\u{10000}":"supplementary", "number":1e21, "text":"🙂", "ordered":[1.0,0.000001]});
    let canonical_hash = canonical_digest(&canonical_value)?;
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"scope":"healthy synthetic only; no replay or held controls","catalogueOperations":OPERATIONS.len(),"featureRoutes":FEATURE_ROUTES.len(),
        "queryCalls":queries.calls,"commandCalls":commands.calls,"providerPreparationOnly":true,"batchDigest":batch_digest,"providerDigest":provider_digest,
        "batchRequest":batch,"providerRequest":provider,"canonicalValue":canonical_value,"canonicalDigest":canonical_hash,"revalidationCalls":authority.revalidations.get(),"targetDisclosureCalls":authority.disclosures.get()})
        )?
    );
    Ok(())
}
