//! One positive process-local Media policy qualification/matcher example.
//! Real bounded renderer and Access, native Domain mapping, private 2x1 original.
//! Rows/commit association are explicit synthetic projections; no Store commit,
//! original admission, archive custody, recovery execution or host integration.
//! No provider, listener, retry, replay or held controls.
use houseatlas_backend::{
    access as a, contracts,
    domain::{native_semantics::NativeSemantics, stock},
    media::{
        AssetVault, Cancellation, WorkBudget, content,
        native::RetainedPrincipal,
        recovery_policy::MediaPolicyEvidence,
        types::{
            AssetPayload, AssetPurpose, AssetRecord, AssetRecordType, BlobIdentity, ContentType,
            LicenseStatus, Lifecycle, PreviewPolicy, Scope, SourceLicense, sha256,
        },
        vault::PreparedOriginal,
    },
    storage as s,
};
use png::{BitDepth, ColorType};
use serde_json::json;
use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    time::Duration,
};

fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default()).unwrap()
}

fn u(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn scope() -> Scope {
    Scope {
        workspace_id: u(1),
        home_id: u(2),
    }
}

fn record(id: u32, payload: AssetPayload) -> AssetRecord {
    AssetRecord {
        schema_version: 1,
        record_type: AssetRecordType::Asset,
        record_id: u(id),
        workspace_id: u(1),
        home_id: u(2),
        revision: 1,
        lifecycle: Lifecycle::Active,
        created_at: "2026-01-02T12:00:00Z".to_owned(),
        updated_at: "2026-01-02T12:00:00Z".to_owned(),
        last_audit_id: u(10000 + id),
        payload,
    }
}

fn license() -> SourceLicense {
    SourceLicense {
        status: LicenseStatus::Unknown,
        reference: None,
    }
}

fn fixture(
    color: ColorType,
    depth: BitDepth,
    pixels: &[u8],
    palette: Option<&[u8]>,
    alpha: Option<&[u8]>,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
        encoder.set_color(color);
        encoder.set_depth(depth);
        if let Some(value) = palette {
            encoder.set_palette(value);
        }
        if let Some(value) = alpha {
            encoder.set_trns(value);
        }
        encoder
            .add_text_chunk("Description".into(), "Fresh synthetic metadata".into())
            .unwrap();
        encoder
            .write_header()
            .unwrap()
            .write_image_data(pixels)
            .unwrap();
    }
    content::validate_original_content(&bytes, ContentType::Png, &budget()).unwrap();
    bytes
}

fn evidence<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/media/uploads",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

fn authorized_editor() -> (a::AccessBoundary, RetainedPrincipal) {
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    let id = |number| a::CanonicalId::parse(u(number)).unwrap();
    let selected: a::Scope =
        serde_json::from_value(serde_json::to_value(scope()).unwrap()).unwrap();
    access
        .provision_user(
            &id(50),
            &id(51),
            "synthetic-quota",
            &a::hash_password("Synthetic-quota-password-only!").unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&id(50), &selected, a::Role::Editor, true)
        .unwrap();
    let session = access
        .login(
            &evidence(None, None),
            &serde_json::to_vec(
                &json!({"username":"synthetic-quota", "password":"Synthetic-quota-password-only!"}),
            )
            .unwrap(),
            "synthetic",
        )
        .unwrap();
    let principal = RetainedPrincipal::new(
        access
            .authorize(
                &evidence(
                    Some(session.set_cookie().split(';').next().unwrap()),
                    Some(session.info().csrf_token()),
                ),
                &selected,
                a::Action::Mutate,
            )
            .unwrap(),
    );
    (access, principal)
}

fn main() {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()
        .unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let pixels = [17, 34, 51, 255, 68, 85, 102, 127];
    let original = fixture(ColorType::Rgba, BitDepth::Eight, &pixels, None, None);
    // Seed only this disposable existing-original fixture, with explicit private
    // modes. Original admission/barriers are outside this review example. These
    // public metadata facts cannot construct the opaque renderer proof below.
    let digest = sha256(&original);
    let vault_path = root.join("media");
    let blobs = vault_path.join("blobs");
    let partition = blobs.join(scope().storage_partition().unwrap());
    for directory in [&vault_path, &blobs, &partition] {
        fs::DirBuilder::new().mode(0o700).create(directory).unwrap();
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o400)
        .open(partition.join(format!("{digest}.blob")))
        .unwrap();
    file.write_all(&original).unwrap();
    file.sync_all().unwrap();
    drop(file);
    let vault = std::sync::Arc::new(AssetVault::open(&vault_path).unwrap());
    let measured = PreparedOriginal {
        purpose: AssetPurpose::EvidenceOriginal,
        storage_key: scope().storage_key(&digest).unwrap(),
        identity: BlobIdentity {
            sha256: digest,
            byte_size: original.len() as u64,
        },
        content_type: ContentType::Png,
    };
    let before = record(
        280_000,
        measured.with_provenance(license(), vec![]).unwrap(),
    );
    assert_eq!(before.payload.preview_policy, PreviewPolicy::DownloadOnly);
    let current: s::Record = serde_json::from_value(json!(&before)).unwrap();
    let (mut access, principal) = authorized_editor();
    access
        .with_mutation_authorization(
            principal.principal(),
            |guard| -> Result<(), Box<dyn std::error::Error>> {
                let rendered = vault.qualify_asset_review(guard, &principal, &current, &budget())?;
                let schemas = stock::NativeStockContract::new()?;
                let request = stock::ValidatedRequest::parse(
                    &schemas,
                    json!({
                        "schemaVersion":3,"commandId":"atlas.asset.review",
                        "requestId":u(280_001),"context":scope(),
                        "target":{"authority":"atlas","recordType":"asset","recordId":before.record_id},
                        "payload":{"treatment":"request-preview","rendererReceiptId":rendered.receipt_id(),"evidenceIds":[]},
                        "idempotencyKey":u(280_002),"reason":"Fresh bounded synthetic original renderer review",
                        "preconditions":{"target":{"kind":"atlas","value":1},"guards":[]},"approvalReceiptId":null
                    }),
                )?;
                let proof = rendered.bind_request(guard, &principal, &request, &budget())?;
                assert!(std::ptr::eq(proof.original_principal().principal(), principal.principal()));
                proof.revalidate_before_commit(guard, &principal, &current, &request, &budget())?;
                let retained = serde_json::to_value(proof.retained_facts())?;
                assert_eq!(retained["requestDigest"], stock::canonical_digest(request.raw())?);

                // The existing Domain owner supplies the exact native successor
                // payload. This is mapping/release projection, not a Store commit.
                let native = s::NativeContract::new(NativeSemantics::native());
                let plan = stock::plan_derived_atlas_commands(
                    &request,
                    &stock::AtlasDerivation::AssetReview {
                        original: current.clone(),
                        preview_policy: contracts::AssetPayloadPreviewPolicy::SafeRendered,
                        renderer_receipt_id: Some(proof.facts().receipt_id().to_owned()),
                    },
                    &native,
                )?;
                let mut successor = current.clone();
                successor.revision = 2;
                successor.payload = plan.groups()[0].native_entries()[0].command.value.as_ref().unwrap().payload.clone();
                successor.updated_at = "2026-01-02T12:00:01Z".into();
                successor.last_audit_id = u(280_003);
                proof.revalidate_release(guard, &principal, &successor, &request, &budget())?;
                // Association projection DATA cannot construct qualification. The
                // actual host must supply its actual postcommit Store receipt.
                let native_entry = &plan.groups()[0].native_entries()[0];
                let audit = s::Audit {
                    schema_version: 1, audit_id: successor.last_audit_id.clone(),
                    workspace_id: successor.workspace_id.clone(), home_id: successor.home_id.clone(),
                    record: native_entry.target.clone(), operation: native_entry.command.operation,
                    previous_revision: Some(current.revision), result_revision: successor.revision,
                    actor_id: principal.principal().actor_id().as_str().into(),
                    at: successor.updated_at.clone(), reason: native_entry.command.reason.clone(),
                    mutation_id: native_entry.command.mutation_id.clone(),
                    before_digest: Some(contracts::semantics::canonical_digest(&json!(current))?),
                    after_digest: contracts::semantics::canonical_digest(&json!(successor))?,
                };
                let operation_id = u(280_004);
                let association = s::StockAtlasCommit {
                    original_request: request.raw().clone(), request_digest: request.intent_digest().into(),
                    operation_id: operation_id.clone(), actor_id: audit.actor_id.clone(), replayed: false,
                    groups: vec![s::StockCommitGroup {
                        child_index: None, original_request: request.raw().clone(),
                        request_digest: request.intent_digest().into(), operation_id,
                        native_entries: plan.groups()[0].native_entries().to_vec(),
                        native_results: vec![s::MutationResult { schema_version: 1,
                            record: successor.clone(), audit, replayed: false }],
                    }],
                    derivation_format: Some(stock::ATLAS_DERIVATION_FORMAT.into()),
                    derivation: None, child_derivations: None,
                    asset_review: Some(serde_json::from_value(serde_json::to_value(proof.retained_facts())?)?),
                    wire: serde_json::Value::Null, children: vec![],
                };
                let mut evidence = MediaPolicyEvidence::default();
                evidence.retain_review(&proof, guard, &principal, &successor, &association, &budget())?;
                evidence.validate_frame(s::MediaPolicyRecoveryFrame::Asset(&successor))?;
                let archive_data = evidence.archive_facts();
                assert_eq!(archive_data["format"], "houseatlas-media-policy-evidence/1");
                assert_eq!(archive_data["entries"][0]["producer"]["originalSha256"], sha256(&original));
                assert_eq!(archive_data["entries"][0]["asset"], json!(successor));
                Ok(())
            },
        )
        .unwrap();
    println!(
        "healthy recovery policy: real private retained 2x1 renderer qualification and original Access allocation, exact submitted review plus Domain-mapped successor and synthetic commit association, positive process-local Asset frame match; no Store commit, upload admission, durable archive/restart validation, restore or held controls"
    );
}
