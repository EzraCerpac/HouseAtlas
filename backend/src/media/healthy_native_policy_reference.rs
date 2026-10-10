//! Fresh actual publication, one-time reference persistence and descriptor reopen.
//! No mask/settings changes, cold-start trust, restore, replay or held controls.
use houseatlas_backend::{
    access as a,
    config::provider_dispatch::archive::TrustedStockArchiveConfig,
    domain::{native_semantics::NativeSemantics, stock},
    lifecycle::provider_dispatch::archive::PrivateStockArchive,
    media::{
        AssetVault, Cancellation, WorkBudget, content,
        native::{NativeMediaRuntime, RetainedPrincipal},
        native_policy_archive::{
            NativeMediaArchiveBinding, NativeMediaArchiveOwner, NativeMediaArchiveReadOwner,
        },
        native_policy_reference::{
            MAX_NATIVE_MEDIA_REFERENCE_BYTES, MAX_NATIVE_MEDIA_REFERENCE_MEMBERS,
            MAX_NATIVE_MEDIA_REFERENCE_STORE_BYTES, NativeMediaPolicyReferenceConfig,
            NativeMediaPolicyReferenceStore,
        },
        recovery_policy_archive::{
            MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES, MediaPolicyArchiveOrigin,
        },
        staged_upload::{NativeUploadStages, UploadAdmission},
        types::{
            AssetPurpose, ContentType, LicenseStatus, PreviewPolicy, Scope, SourceLicense, sha256,
        },
    },
    storage as s,
};
use png::{BitDepth, ColorType};
use serde_json::json;
use std::{
    cell::Cell,
    fs,
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    sync::Arc,
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

// This required native authorizer uses the SAME actual AT11 transaction fence.
// It never reenters Access or SQLite in a Storage callback.
struct FencedAuthority<'a, 'g> {
    guard: &'a a::TransactionAuthorization<'g>,
}
impl FencedAuthority<'_, '_> {
    fn checked(
        &self,
        p: &a::Principal,
        scope: &s::Scope,
        capability: a::Capability,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(p, self.guard.principal()) {
            return Err(s::Error::new("forbidden", "Original allocation required"));
        }
        let scope: a::Scope = serde_json::from_value(json!(scope))?;
        let p = self
            .guard
            .authorize(&scope, capability)
            .map_err(|e| s::Error::new(e.code(), "Actual Access fence required"))?;
        Ok(s::VerifiedActor {
            workspace_id: p.scope().workspace_id.as_str().into(),
            home_id: p.scope().home_id.as_str().into(),
            actor_id: p.actor_id().as_str().into(),
        })
    }
}
impl s::Authorization for FencedAuthority<'_, '_> {
    type Principal = a::Principal;
    fn authorize(
        &self,
        p: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let capability = match request.capability {
            s::Capability::Read => a::Capability::Read,
            s::Capability::ReadAssetManifest => a::Capability::ReadAssetManifest,
            s::Capability::ReadHistory => a::Capability::ReadHistory,
            s::Capability::Mutate => a::Capability::Mutate,
            _ => return Err(s::Error::new("forbidden", "Unsupported fixture capability")),
        };
        self.checked(p, request.scope, capability)
    }
}
impl s::StockAuthorization for FencedAuthority<'_, '_> {
    fn authorize_stock_mutation(
        &self,
        p: &a::Principal,
        frame: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if frame.plan.scope() != &frame.native.scope {
            return Err(s::Error::new("forbidden", "Exact stock scope required"));
        }
        self.checked(p, &frame.native.scope, a::Capability::Mutate)
    }
    fn authorize_stock_history(
        &self,
        _: &a::Principal,
        _: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        Err(s::Error::new("forbidden", "No fixture history authority"))
    }
}
struct Clock(Cell<u32>);
impl s::Runtime for Clock {
    fn now(&self) -> s::Result<String> {
        Ok("2026-10-08T12:00:00Z".into())
    }
    fn new_id(&self) -> s::Result<String> {
        let n = self.0.get() + 1;
        self.0.set(n);
        Ok(u(n))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new("asset-unavailable", "Actual vault required"))
    }
}

fn unavailable() -> s::Error {
    s::Error::new("owner-unavailable", "Synthetic native owner unavailable")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<NativeMediaArchiveOwner>();
    assert_send_sync::<s::AssetUploadQualifiedCompletion>();
    assert_send_sync::<NativeMediaPolicyReferenceStore>();
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let bytes = fixture(
        ColorType::Rgba,
        BitDepth::Eight,
        &[17, 34, 51, 255, 68, 85, 102, 127],
        None,
        None,
    );
    let vault = Arc::new(AssetVault::open(&root.join("media"))?);
    let ids = Clock(Cell::new(280_000));
    let stages = NativeUploadStages::open(&vault, &ids)?;
    let archive_path = root.join("archive");
    fs::DirBuilder::new().mode(0o700).create(&archive_path)?;
    let reference_path = root.join("reference");
    fs::DirBuilder::new().mode(0o700).create(&reference_path)?;
    let origin = MediaPolicyArchiveOrigin::new(
        "synthetic-deployment",
        "synthetic-native-sql",
        "synthetic-media-custody",
        "fresh-reference-upload-1",
    )?;
    let (mut access, original) = authorized_editor();
    let mut retained = None;
    access.with_mutation_authorization(original.principal(), |guard| -> Result<(), Box<dyn std::error::Error>> {
        let receipt = stages.stage_original(guard, &original, UploadAdmission {
            request_id: u(280_010), purpose: AssetPurpose::EvidenceOriginal,
            content_type: ContentType::Png, filename: "fresh-synthetic-2x1.png".into(),
            source_license: license(), evidence_ids: vec![],
        }, &mut bytes.as_slice(), &budget())?;
        assert_eq!(receipt.staged.sha256, sha256(&bytes));
        assert_eq!(receipt.staged.byte_size, bytes.len() as u64);
        let schemas = stock::NativeStockContract::new()?;
        let request = stock::ValidatedRequest::parse(&schemas, json!({
            "schemaVersion":3,"commandId":"atlas.asset.create","requestId":receipt.request_id,"context":scope(),
            "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
            "payload":{"staged":receipt.staged,"purpose":"evidence-original","sourceLicense":license(),"evidenceIds":[]},
            "idempotencyKey":u(280_011),"reason":"Fresh bounded synthetic native reference handoff",
            "preconditions":{"target":null,"guards":[]},"approvalReceiptId":null
        }))?;
        let stage = stages.bind_asset_plan(guard, &original, &receipt.staged.upload_token, &request, &budget())?;
        assert_eq!(stage.payload().preview_policy, PreviewPolicy::SafeRendered);
        let stage_path = root.join("media/uploads").join(sha256(receipt.staged.upload_token.as_bytes()));
        for directory in [&stage_path, &stage_path.join("plan")] {
            assert_eq!(fs::metadata(directory)?.permissions().mode() & 0o777, 0o700);
        }
        let authority = FencedAuthority { guard };
        let mut store = s::AtlasStore::open(root.join("atlas.sqlite"),
            s::NativeContract::new(NativeSemantics::native()), FencedAuthority { guard },
            NativeMediaRuntime { vault: vault.clone(), server: Clock(Cell::new(400_000)) },
            s::StoreOptions::default())?;
        let identity = store.asset_review_store_identity();
        let observation = s::AssetUploadCommitObservation::new();
        let commit = store.execute_staged_stock_json_observing_with_authorization(
            &authority, original.principal(), &schemas, request.raw(), &stage, &observation)?;
        let completion = observation.take_qualified().ok_or_else(unavailable)?;
        assert!(identity.matches_upload_completion(&completion));
        assert!(std::ptr::eq(completion.original_principal().principal(), original.principal()));
        assert_eq!(completion.commit(), &commit);
        let consumed = completion.consumed_upload();
        assert_eq!(consumed.staged(), stage.staged());
        assert_eq!(consumed.asset_request(), stage.request().raw());
        assert_eq!(consumed.binding_digest(), stage.binding_digest());
        let successor = commit.groups[consumed.group_ordinal()].native_results[0].record.clone();
        let archive = PrivateStockArchive::open(TrustedStockArchiveConfig::new(
            archive_path.clone(), MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES)?)?;
        let binding = NativeMediaArchiveBinding::new(identity, archive.clone(), origin.clone(), vec![scope()])?;
        let mut owner = NativeMediaArchiveOwner::fresh(binding);
        let published = owner.publish_upload(completion, &stage, guard, &budget())?;
        assert_eq!(published.name(), format!("{}.media-policy.json", successor.last_audit_id));
        assert_eq!(fs::metadata(archive_path.join(published.name()))?.permissions().mode() & 0o777, 0o600);
        // Read-only strict Store loader supplies exact consumed DATA, not a new
        // completion or stage. All opaque publication owners are still held.
        let selected: s::Scope = serde_json::from_value(json!(scope()))?;
        let consumed = store.committed_upload_with_authorization(&authority, original.principal(),
            &schemas, &selected, &receipt.staged.upload_token)?.ok_or_else(unavailable)?;
        let capture = owner.take_published_reference().ok_or_else(unavailable)?;
        let references = NativeMediaPolicyReferenceStore::open(NativeMediaPolicyReferenceConfig::new(
            reference_path.clone(), archive.destination().clone(), MAX_NATIVE_MEDIA_REFERENCE_BYTES,
            MAX_NATIVE_MEDIA_REFERENCE_MEMBERS, MAX_NATIVE_MEDIA_REFERENCE_STORE_BYTES)?)?;
        let issued = references.persist(capture, &budget())?;
        let selection = issued.selection()?;
        assert_eq!(selection.member_name(), format!("{}.media-reference.json", successor.last_audit_id));
        assert_eq!(fs::metadata(reference_path.join(selection.member_name()))?.permissions().mode() & 0o777, 0o600);
        drop(references);
        drop(owner);
        drop(stage);
        store.close()?;
        retained = Some((issued, successor, consumed));
        Ok(())
    })?;
    drop(stages);
    drop(vault);
    drop(access);
    drop(original);
    let (issued, successor, consumed) = retained.ok_or_else(unavailable)?;
    let archive = PrivateStockArchive::open(TrustedStockArchiveConfig::new(
        archive_path,
        MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES,
    )?)?;
    let references = NativeMediaPolicyReferenceStore::open(NativeMediaPolicyReferenceConfig::new(
        reference_path,
        archive.destination().clone(),
        MAX_NATIVE_MEDIA_REFERENCE_BYTES,
        MAX_NATIVE_MEDIA_REFERENCE_MEMBERS,
        MAX_NATIVE_MEDIA_REFERENCE_STORE_BYTES,
    )?)?;
    let selection = issued.selection()?;
    let data = references.read_data(&selection, &budget())?;
    assert_eq!(data.origin(), &origin);
    assert_eq!(data.member_name(), selection.member_name());
    assert_eq!(data.member_count(), 1);
    assert!(data.byte_size() > 0 && data.byte_size() <= MAX_NATIVE_MEDIA_REFERENCE_BYTES);
    let expected_members = data.into_expected_members(&budget())?;
    assert_eq!(expected_members.len(), 1);
    // Independent DATA remains inert. Only the still-retained original issued
    // carrier qualifies this proof after reopening descriptor custody.
    let read = references.read_issued(&selection, Some(&issued), &budget())?;
    let reader = NativeMediaArchiveReadOwner::new(read.generation());
    let authenticated = reader.read(archive, &budget())?;
    assert_eq!(authenticated.catalog().len(), 1);
    authenticated.validate_frame(s::MediaPolicyRecoveryFrame::Asset(&successor))?;
    authenticated.validate_frame(s::MediaPolicyRecoveryFrame::Upload(&consumed))?;
    println!(
        "healthy native Media reference: actual fresh AT11 principal/guard, bounded 2x1 PNG renderer/stage and SAME-Store completion; genuine fsynced candidate publication/full catalog; one-time opaque capture persisted by value into separate descriptor custody at 0600 under inherited settings; original store/publisher/stage/vault/Access dropped; fresh reference descriptor reads closed DATA and exact bytes with STILL-retained original issued carrier, then authenticates exact Asset/ConsumedUpload through existing ReadOwner; durable handoff only, no cold-start admission, restore, replay, queued reservation or held controls"
    );
    Ok(())
}
