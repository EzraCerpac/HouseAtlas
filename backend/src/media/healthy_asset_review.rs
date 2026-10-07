//! One bounded positive existing-original review example. Real Media/Access and
//! native Domain mapping; private retained fixture bytes and synthetic row
//! projections, no original admission, Store commit or host receipt lifecycle.
//! No provider, listener, retry, replay or held controls.
use houseatlas_backend::{
    access as a, contracts,
    domain::{native_semantics::NativeSemantics, stock},
    media::{
        AssetVault, Cancellation, WorkBudget, content,
        native::RetainedPrincipal,
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
    io::{Cursor, Write},
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

fn rgba(bytes: &[u8]) -> Vec<u8> {
    let mut reader = png::Decoder::new(Cursor::new(bytes)).read_info().unwrap();
    assert_eq!(reader.info().width, 2);
    assert_eq!(reader.info().height, 1);
    assert_eq!(reader.info().color_type, ColorType::Rgba);
    assert_eq!(reader.info().bit_depth, BitDepth::Eight);
    assert!(!reader.info().interlaced);
    let mut raw = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut raw).unwrap();
    reader.finish().unwrap();
    let mut offset = 8;
    let mut kinds = Vec::new();
    while offset < bytes.len() {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        kinds.push(&bytes[offset + 4..offset + 8]);
        offset += length + 12;
    }
    assert_eq!(kinds, [b"IHDR", b"IDAT", b"IEND"]);
    raw
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
                let facts = serde_json::to_value(rendered.facts())?;
                let output = content::render_png(&original, &budget())?;
                assert_eq!(rgba(&output), pixels);
                assert_eq!(facts["format"], "houseatlas-existing-asset-renderer-review/1");
                assert_eq!(facts["scope"], json!(scope()));
                assert_eq!(facts["assetId"], before.record_id);
                assert_eq!(facts["revision"], before.revision);
                assert_eq!(facts["originalSha256"], sha256(&original));
                assert_eq!(facts["originalByteSize"], original.len() as u64);
                assert_eq!(facts["renderedSha256"], sha256(&output));
                assert_eq!(facts["renderedByteSize"], output.len() as u64);
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
                assert_eq!(vault.read_retained(&before, &budget())?, original);
                assert_eq!(proof.original_record().payload.preview_policy, PreviewPolicy::DownloadOnly);
                Ok(())
            },
        )
        .unwrap();
    println!(
        "healthy existing-original review: private retained 2x1 PNG fixture, known stripped dimensions/pixels and measured output/original facts, exact AT11 allocation, native submitted request binding, preimage and Domain-mapped successor checks; no original admission, Store commit, host receipt lifecycle, replay or held controls"
    );
}
