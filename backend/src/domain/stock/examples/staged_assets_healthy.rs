//! Fresh actual media stages and pure qualified native single/batch mappings.
//! Synthetic in-memory access and server IDs; no asset commit/token consumption,
//! source witness, provider, queue, replay, reopen or rejection control executes.
use houseatlas_at36_stock_harness::{
    access as a,
    domain::{native_semantics::NativeSemantics, stock::*},
    media::{
        AssetVault, Cancellation, WorkBudget,
        native::RetainedPrincipal,
        staged_upload::{NativeUploadStages, UploadAdmission},
        types::{AssetPurpose, ContentType, LicenseStatus, SourceLicense},
    },
    storage::{self as s, NativeContract},
};
use serde_json::{Value, json};
use std::{cell::Cell, fs, path::PathBuf, time::Duration};

type CheckResult<T> = Result<T, Box<dyn std::error::Error>>;

fn id(value: u32) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}

fn context() -> Value {
    json!({"workspaceId":id(1),"homeId":id(2)})
}

fn guards() -> Value {
    json!([{"target":{"authority":"atlas","recordType":"evidence","recordId":id(100)},
        "revision":{"kind":"atlas","value":1}}])
}

fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default()).unwrap()
}

struct ServerIds(Cell<u32>);
impl s::Runtime for ServerIds {
    fn now(&self) -> s::Result<String> {
        Ok("2026-10-07T12:00:00Z".to_owned())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.0.get() + 1;
        self.0.set(next);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "No committed asset in this example",
        ))
    }
}

fn evidence<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/media/uploads",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

fn main() -> CheckResult<()> {
    let output = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh output directory required")?,
    );
    fs::create_dir(&output)?;
    let vault = AssetVault::open(&output.join("media"))?;
    let runtime = ServerIds(Cell::new(200_000));
    let stages = NativeUploadStages::open(&vault, &runtime)?;
    let schemas = NativeStockContract::new()?;
    let native = NativeContract::new(NativeSemantics::native());
    let config = a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".to_owned()])?
        .with_clock(|| 1_800_000_000_000);
    let mut access = a::AccessBoundary::in_memory(config)?;
    let canonical = |value| a::CanonicalId::parse(id(value));
    let scope: a::Scope = serde_json::from_value(context())?;
    let password = "Synthetic-staged-mapping-only!";
    access.provision_user(
        &canonical(50)?,
        &canonical(51)?,
        "synthetic-planner",
        &a::hash_password(password)?,
        None,
    )?;
    access.set_membership(&canonical(50)?, &scope, a::Role::Editor, true)?;
    let session = access.login(
        &evidence(None, None),
        &serde_json::to_vec(&json!({"username":"synthetic-planner","password":password}))?,
        "synthetic-loopback",
    )?;
    let cookie = session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Synthetic cookie required")?;
    let principal = RetainedPrincipal::new(access.authorize(
        &evidence(Some(cookie), Some(session.info().csrf_token())),
        &scope,
        a::Action::Mutate,
    )?);
    let snapshot: Value = serde_json::from_str(include_str!(
        "../../../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    let evidence_template = snapshot["records"]
        .as_array()
        .ok_or("Published records required")?
        .iter()
        .find(|record| record["recordType"] == "evidence")
        .ok_or("Published evidence payload required")?["payload"]
        .clone();
    let bytes = b"Fresh synthetic staged evidence; no household content.\n";
    let mut cases = Vec::new();
    for (index, name, asset_link, evidence_link, evidence_first) in [
        (0, "asset-evidence-ids-only", true, false, true),
        (1, "evidence-asset-reference-only", false, true, false),
        (2, "both-explicit-links", true, true, false),
        (3, "ordered-place-upload-flow", true, true, false),
    ] {
        let base = 210_000 + index * 10;
        let evidence_id = id(base + 5);
        let license = SourceLicense {
            status: if index == 2 {
                LicenseStatus::Permitted
            } else {
                LicenseStatus::Unknown
            },
            reference: (index == 2).then(|| "Synthetic author-owned fixture".to_owned()),
        };
        let approval = if index == 2 {
            json!(id(base + 9))
        } else {
            Value::Null
        };
        let mut receipt = None;
        access.with_mutation_authorization(principal.principal(), |guard| -> CheckResult<()> {
            receipt = Some(stages.stage_original(
                guard,
                &principal,
                UploadAdmission {
                    request_id: id(base),
                    purpose: AssetPurpose::EvidenceOriginal,
                    content_type: ContentType::Text,
                    filename: "synthetic-evidence.txt".to_owned(),
                    source_license: license.clone(),
                    evidence_ids: if asset_link {
                        vec![evidence_id.clone()]
                    } else {
                        vec![]
                    },
                },
                &mut bytes.as_slice(),
                &budget(),
            )?);
            Ok(())
        })?;
        let receipt = receipt.ok_or("Fresh measured receipt required")?;
        let asset_raw = json!({"schemaVersion":3,"commandId":"atlas.asset.create",
            "requestId":receipt.request_id,"context":context(),
            "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
            "payload":{"staged":receipt.staged,"purpose":"evidence-original",
                "sourceLicense":license,"evidenceIds":if asset_link {vec![evidence_id.clone()]} else {vec![]}},
            "idempotencyKey":id(base+1),"reason":"Fresh qualified staged asset mapping",
            "preconditions":{"target":null,"guards":guards()},"approvalReceiptId":approval});
        let asset = ValidatedRequest::parse(&schemas, asset_raw.clone())?;
        let mut sealed = None;
        access.with_mutation_authorization(principal.principal(), |guard| -> CheckResult<()> {
            sealed = Some(stages.bind_asset_plan(
                guard,
                &principal.clone(),
                &receipt.staged.upload_token,
                &asset,
                &budget(),
            )?);
            Ok(())
        })?;
        let sealed = sealed.ok_or("Genuine sealed stage required")?;
        let single = plan_staged_atlas_commands(&asset, &sealed, &native)?;
        assert_eq!(single.plan().original_request(), &asset_raw);
        assert_eq!(single.plan().groups()[0].child_index(), None);
        assert_eq!(
            single.plan().groups()[0].native_entries()[0]
                .command
                .value
                .as_ref()
                .ok_or("Mapped asset value required")?
                .payload,
            serde_json::to_value(sealed.payload())?
        );
        let mut payload = evidence_template.clone();
        payload["statement"] = json!("Fresh synthetic upload mapping provenance");
        payload["references"] = if evidence_link {
            json!([{"kind":"atlas-asset","assetId":receipt.asset_id}])
        } else {
            json!([])
        };
        let evidence_raw = json!({"schemaVersion":3,"commandId":"atlas.evidence.create",
            "requestId":id(base+2),"context":context(),
            "target":{"authority":"atlas","recordType":"evidence","recordId":evidence_id},
            "payload":payload,"idempotencyKey":id(base+3),"reason":"Explicit upload evidence",
            "preconditions":{"target":null,"guards":guards()},"approvalReceiptId":approval});
        let mut children = if evidence_first {
            vec![evidence_raw, asset_raw.clone()]
        } else {
            vec![asset_raw.clone(), evidence_raw]
        };
        let mut root_guards = guards();
        if index == 3 {
            let place_guard = json!({"target":{"authority":"atlas","recordType":"identity","recordId":id(200)},
                "revision":{"kind":"atlas","value":7}});
            root_guards
                .as_array_mut()
                .ok_or("Original guard array required")?
                .push(place_guard.clone());
            let mut place_guards = guards();
            place_guards
                .as_array_mut()
                .ok_or("Original PLACE guard array required")?
                .push(place_guard);
            children.push(
                json!({"schemaVersion":3,"commandId":"atlas.identity.replace",
                "requestId":id(base+10),"context":context(),
                "target":{"authority":"atlas","recordType":"identity","recordId":id(200)},
                "payload":{"kind":"location","evidenceIds":[id(100),evidence_id]},
                "idempotencyKey":id(base+11),"reason":"Link new upload evidence to original PLACE",
                "preconditions":{"target":{"kind":"atlas","value":7},"guards":place_guards},
                "approvalReceiptId":approval}),
            );
        }
        let root_raw = json!({"schemaVersion":3,"commandId":"atlas.batch.execute",
            "requestId":id(base+6),"context":context(),
            "target":{"authority":"atlas","kind":"batch","batchId":id(base+7)},
            "payload":{"commands":children},"idempotencyKey":id(base+8),
            "reason":"Fresh ordered staged asset and evidence mapping",
            "preconditions":{"target":null,"guards":root_guards},"approvalReceiptId":approval});
        let root = ValidatedRequest::parse(&schemas, root_raw.clone())?;
        let qualified = plan_staged_atlas_commands(&root, &sealed, &native)?;
        let plan = qualified.plan();
        assert!(std::ptr::eq(qualified.staged(), &sealed));
        assert!(std::ptr::eq(
            qualified.staged().original_principal().principal(),
            principal.principal()
        ));
        assert_eq!(plan.original_request(), &root_raw);
        assert_eq!(plan.request_digest(), root.intent_digest());
        assert_eq!(plan.root_idempotency_key(), id(base + 8));
        assert_eq!(plan.batch_target_id(), Some(id(base + 7).as_str()));
        assert_eq!(plan.root_guards().len(), if index == 3 { 2 } else { 1 });
        assert_eq!(plan.groups().len(), if index == 3 { 3 } else { 2 });
        for (child_index, (group, child)) in plan.groups().iter().zip(root.children()).enumerate() {
            assert_eq!(group.child_index(), Some(child_index));
            assert_eq!(group.original_request(), child.raw());
            assert_eq!(group.request_digest(), child.intent_digest());
            assert_eq!(group.native_entries().len(), 1);
            let command = &group.native_entries()[0].command;
            let is_place = child.id() == OperationId::AtlasIdentityReplace;
            assert_eq!(
                command.operation,
                if is_place {
                    s::Operation::Replace
                } else {
                    s::Operation::Create
                }
            );
            assert_eq!(command.mutation_id, child.raw()["idempotencyKey"]);
            assert_eq!(command.reason, child.raw()["reason"]);
            assert_eq!(command.guards.len(), if is_place { 2 } else { 1 });
            assert_eq!(
                command.expected_revision,
                if is_place { Some(7) } else { None }
            );
            assert_eq!(command.guards[0].expected_revision, 1);
            assert_eq!(command.guards[0].record.record_id, id(100));
            if is_place {
                assert_eq!(child_index, 2);
                assert_eq!(command.guards[1].record.record_id, id(200));
                assert_eq!(command.guards[1].expected_revision, 7);
            }
            assert_eq!(
                group.native_entries()[0].target.record_id,
                child.target()["recordId"]
            );
            let expected_payload = if child.id() == OperationId::AtlasAssetCreate {
                serde_json::to_value(sealed.payload())?
            } else {
                child.payload().clone()
            };
            assert_eq!(
                command
                    .value
                    .as_ref()
                    .ok_or("Native value required")?
                    .payload,
                expected_payload
            );
        }
        assert_eq!(sealed.request().raw(), &asset_raw);
        assert_eq!(sealed.staged().byte_size, bytes.len() as u64);
        let stage_path =
            output
                .join("media/uploads")
                .join(houseatlas_at36_stock_harness::media::types::sha256(
                    receipt.staged.upload_token.as_bytes(),
                ));
        let binding: Value =
            serde_json::from_slice(&fs::read(stage_path.join("plan/binding.json"))?)?;
        assert_eq!(canonical_digest(&binding)?, sealed.binding_digest());
        cases.push(
            json!({"name":name,"assetLink":asset_link,"evidenceLink":evidence_link,
            "assetChildIndex":if evidence_first {1} else {0},"nativeEntries":if index == 3 {3} else {2},
            "guardedPlaceReplacement":index == 3,
            "fullOriginalEnvelopesPreserved":true,"sealedMeasuredPayloadUsed":true}),
        );
    }
    fs::write(
        output.join("result.json"),
        serde_json::to_vec_pretty(&json!({
            "fixtureOnly":true,"freshStages":4,"singlePlans":4,"batchPlans":4,"cases":cases,
            "assetCommits":0,"tokenConsumptions":0,"providerCalls":0,"sourceWitnesses":0,
            "queueExecutions":0,"replays":0,"reopens":0,"heldControls":0,
            "productionUploadAcceptance":false
        }))?,
    )?;
    println!(
        "healthy fresh staged asset/evidence mapping: four actual sealed stages, single and ordered one-way/both-link/guarded-PLACE batch plans; no commit or token consumption"
    );
    Ok(())
}
