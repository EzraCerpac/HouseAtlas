//! One fresh authorized upload and immutable plan-data binding. The held stock
//! asset-create mapper and transactional token consumption are not invoked.
use std::cell::Cell;
use std::fs;

use serde_json::{Value, json};

use crate::{access as a, domain::stock, storage as s};

use super::AssetVault;
use super::healthy_examples::{budget, scope, u};
use super::native::RetainedPrincipal;
use super::staged_upload::{NativeUploadStages, UploadAdmission};
use super::types::{
    AssetPurpose, ContentType, LicenseStatus, PreviewPolicy, SourceLicense, sha256,
};

struct ServerIds(Cell<u32>);
impl s::Runtime for ServerIds {
    fn now(&self) -> s::Result<String> {
        Ok("2026-10-07T12:00:00Z".to_owned())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.0.get() + 1;
        self.0.set(next);
        Ok(u(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "Actual committed record required",
        ))
    }
}

fn request<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
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

#[test]
fn healthy_native_durable_upload_and_bound_asset_plan_data() {
    let temporary = tempfile::Builder::new()
        .prefix("houseatlas-at12-upload-")
        .tempdir()
        .unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let vault = AssetVault::open(&root.join("media")).unwrap();
    let runtime = ServerIds(Cell::new(200_000));
    let stages = NativeUploadStages::open(&vault, &runtime).unwrap();
    let config = a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".to_owned()])
        .unwrap()
        .with_clock(|| 1_800_000_000_000);
    let mut access = a::AccessBoundary::in_memory(config).unwrap();
    let id = |n| a::CanonicalId::parse(u(n)).unwrap();
    let access_scope: a::Scope =
        serde_json::from_value(serde_json::to_value(scope()).unwrap()).unwrap();
    let password = "Synthetic-upload-password-only!";
    access
        .provision_user(
            &id(50),
            &id(51),
            "synthetic-uploader",
            &a::hash_password(password).unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&id(50), &access_scope, a::Role::Editor, true)
        .unwrap();
    let session = access
        .login(
            &request(None, None),
            &serde_json::to_vec(&json!({"username":"synthetic-uploader","password":password}))
                .unwrap(),
            "synthetic-loopback",
        )
        .unwrap();
    let cookie = session.set_cookie().split(';').next().unwrap();
    let principal = RetainedPrincipal::new(
        access
            .authorize(
                &request(Some(cookie), Some(session.info().csrf_token())),
                &access_scope,
                a::Action::Mutate,
            )
            .unwrap(),
    );
    let original_bytes = b"Fresh synthetic evidence; no household content.\n";
    let license = SourceLicense {
        status: LicenseStatus::Unknown,
        reference: None,
    };
    let mut receipt = None;
    access
        .with_mutation_authorization(
            principal.principal(),
            |guard| -> Result<(), Box<dyn std::error::Error>> {
                receipt = Some(stages.stage_original(
                    guard,
                    &principal,
                    UploadAdmission {
                        request_id: u(210_000),
                        purpose: AssetPurpose::EvidenceOriginal,
                        content_type: ContentType::Text,
                        filename: "synthetic-evidence.txt".to_owned(),
                        source_license: license.clone(),
                        evidence_ids: vec![u(100)],
                    },
                    &mut original_bytes.as_slice(),
                    &budget(),
                )?);
                Ok(())
            },
        )
        .unwrap();
    let receipt = receipt.unwrap();
    assert_eq!(runtime.0.get(), 200_001);
    assert_eq!(receipt.asset_id, u(200_001));
    assert_eq!(receipt.staged.sha256, sha256(original_bytes));
    assert_eq!(receipt.staged.byte_size, original_bytes.len() as u64);
    let stage_directory = root
        .join("media/uploads")
        .join(sha256(receipt.staged.upload_token.as_bytes()));
    let durable_stage: Value =
        serde_json::from_slice(&fs::read(stage_directory.join("stage.json")).unwrap()).unwrap();
    assert_eq!(durable_stage["requestId"], receipt.request_id);
    assert_eq!(
        durable_stage["actorId"],
        principal.principal().actor_id().as_str()
    );
    assert_eq!(
        durable_stage["scope"],
        serde_json::to_value(scope()).unwrap()
    );
    let raw = json!({
        "schemaVersion":3,"commandId":"atlas.asset.create", "requestId":receipt.request_id,
        "context":scope(),"target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
        "payload":{"staged":receipt.staged,"purpose":"evidence-original","sourceLicense":license,"evidenceIds":[u(100)]},
        "idempotencyKey":u(210_001),"reason":"Fresh healthy evidence upload",
        "preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":u(100)},"revision":{"kind":"atlas","value":1}}]},
        "approvalReceiptId":null,
    });
    let stock_contracts = stock::NativeStockContract::new().unwrap();
    let validated = stock::ValidatedRequest::parse(&stock_contracts, raw.clone()).unwrap();
    let mut plan = None;
    access
        .with_mutation_authorization(
            principal.principal(),
            |guard| -> Result<(), Box<dyn std::error::Error>> {
                plan = Some(stages.bind_asset_plan(
                    guard,
                    &principal.clone(),
                    &receipt.staged.upload_token,
                    &validated,
                    &budget(),
                )?);
                Ok(())
            },
        )
        .unwrap();
    let plan = plan.unwrap();
    assert_eq!(plan.request().raw(), &raw);
    assert_eq!(plan.request().intent_digest(), validated.intent_digest());
    assert_eq!(plan.asset_id(), receipt.asset_id);
    assert_eq!(
        plan.payload().storage_key,
        scope().storage_key(&sha256(original_bytes)).unwrap()
    );
    assert_eq!(plan.payload().source_license.status, LicenseStatus::Unknown);
    assert_eq!(plan.payload().preview_policy, PreviewPolicy::DownloadOnly);
    assert_eq!(plan.payload().evidence_ids, vec![u(100)]);
    assert!(std::ptr::eq(
        plan.original_principal().principal(),
        principal.principal()
    ));
    let binding: Value =
        serde_json::from_slice(&fs::read(stage_directory.join("plan/binding.json")).unwrap())
            .unwrap();
    assert_eq!(binding["originalRequest"], raw);
    assert_eq!(binding["requestDigest"], validated.intent_digest());
    assert_eq!(
        stock::canonical_digest(&binding).unwrap(),
        plan.binding_digest()
    );
    assert_eq!(
        binding["stage"]["payload"],
        serde_json::to_value(plan.payload()).unwrap()
    );
    assert_eq!(binding["originalRequest"]["approvalReceiptId"], Value::Null);
    let reopened = AssetVault::open(&root.join("media")).unwrap();
    let blob = root
        .join("media/blobs")
        .join(scope().storage_partition().unwrap())
        .join(format!("{}.blob", sha256(original_bytes)));
    assert_eq!(fs::read(blob).unwrap(), original_bytes);
    drop(reopened);
    println!(
        "healthy fresh upload: actual AT11 login and original mutation principal/fence; actual vault retention/content/hash/size/barriers; server-issued asset ID and random UUID token; durable measured receipt and immutable full genuine stock envelope/guard/null-approval/license/provenance binding; raw bytes survive vault reopen; plan DATA only, no held asset mapper, storage commit or transactional token consume executed"
    );
}
