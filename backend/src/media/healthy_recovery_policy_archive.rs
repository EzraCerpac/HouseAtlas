//! Positive durable packet publication and fresh-reader matching only.
//! Real Access, bounded private 2x1 renderer and actual native Store review commit.
//! An independent in-memory SYNTHETIC native owner retains the exact producer
//! bytes across writer drop/new descriptor reader; no production origin policy,
//! process restart, restored SQL image, recovery execution or held controls.
use houseatlas_backend::{
    access as a,
    config::provider_dispatch::archive::TrustedStockArchiveConfig,
    domain::{native_semantics::NativeSemantics, stock},
    lifecycle::provider_dispatch::{
        archive::{ArchiveDestination, PrivateStockArchive},
        media_policy_archive::NativeMediaPolicyArchive,
    },
    media::{
        AssetVault, Cancellation, MediaError, MediaResult, WorkBudget, content,
        native::{NativeMediaRuntime, RetainedPrincipal},
        recovery_policy_archive::{
            AuthenticatedMediaPolicyArchive, MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES,
            MediaPolicyArchiveCatalogEntry, MediaPolicyArchiveOrigin, MediaPolicyArchivePacket,
            MediaPolicyArchiveReadAuthorization, MediaPolicyArchiveWriteAuthorization,
            RestoredMediaPolicyArchiveCut,
        },
        types::{
            AssetPurpose, BlobIdentity, ContentType, LicenseStatus, Scope, SourceLicense, sha256,
        },
        vault::PreparedOriginal,
    },
    storage as s,
};
use png::{BitDepth, ColorType};
use serde_json::json;
use std::{
    cell::Cell,
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    sync::{Arc, Mutex},
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

// SYNTHETIC independent native ownership: retain the exact fresh factory packet
// after approving its actual original principal and opened descriptor. Candidate
// archive fields cannot initialize this state. No keys or production grant exist.
struct OwnedPublication {
    destination: ArchiveDestination,
    origin: MediaPolicyArchiveOrigin,
    member: String,
    bytes: Vec<u8>,
}
#[derive(Clone, Default)]
struct FixtureReadOwner(Arc<Mutex<Option<OwnedPublication>>>);
struct FixtureWriteOwner {
    original: RetainedPrincipal,
    expected_destination: ArchiveDestination,
    expected_origin: MediaPolicyArchiveOrigin,
    reader: FixtureReadOwner,
}
impl MediaPolicyArchiveWriteAuthorization for FixtureWriteOwner {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        packet: &MediaPolicyArchivePacket,
    ) -> MediaResult<()> {
        if !std::ptr::eq(
            packet.original_principal().principal(),
            self.original.principal(),
        ) || destination != &self.expected_destination
            || packet.cut().origin() != &self.expected_origin
            || packet.cut().scope() != &scope()
            || packet.cut().actor_id() != self.original.principal().actor_id().as_str()
        {
            return Err(MediaError::Forbidden);
        }
        *self.reader.0.lock().map_err(|_| MediaError::Unavailable)? = Some(OwnedPublication {
            destination: destination.clone(),
            origin: self.expected_origin.clone(),
            member: packet.member_name().into(),
            bytes: packet.bytes().to_vec(),
        });
        Ok(())
    }
}
impl MediaPolicyArchiveReadAuthorization for FixtureReadOwner {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        member: &str,
        bytes: &[u8],
        cut: &RestoredMediaPolicyArchiveCut,
    ) -> s::Result<()> {
        let state = self.0.lock().map_err(|_| unavailable())?;
        let actual = state.as_ref().ok_or_else(unavailable)?;
        if destination != &actual.destination
            || cut.origin() != &actual.origin
            || member != actual.member
            || bytes != actual.bytes
        {
            return Err(unavailable());
        }
        Ok(())
    }
    fn authorize_catalog(
        &self,
        destination: &ArchiveDestination,
        origin: &MediaPolicyArchiveOrigin,
        members: &[MediaPolicyArchiveCatalogEntry],
    ) -> s::Result<()> {
        let state = self.0.lock().map_err(|_| unavailable())?;
        let actual = state.as_ref().ok_or_else(unavailable)?;
        let expected = MediaPolicyArchiveCatalogEntry::new(
            &actual.member,
            sha256(&actual.bytes),
            actual.bytes.len() as u64,
        )
        .map_err(|_| unavailable())?;
        if destination != &actual.destination || origin != &actual.origin || members != [expected] {
            return Err(unavailable());
        }
        Ok(())
    }
}
fn unavailable() -> s::Error {
    s::Error::new("owner-unavailable", "Synthetic native owner unavailable")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<MediaPolicyArchivePacket>();
    assert_send_sync::<AuthenticatedMediaPolicyArchive<'_, FixtureReadOwner>>();
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let original = fixture(
        ColorType::Rgba,
        BitDepth::Eight,
        &[17, 34, 51, 255, 68, 85, 102, 127],
        None,
        None,
    );
    let digest = sha256(&original);
    let vault_path = root.join("media");
    let blobs = vault_path.join("blobs");
    let partition = blobs.join(scope().storage_partition()?);
    for directory in [&vault_path, &blobs, &partition] {
        fs::DirBuilder::new().mode(0o700).create(directory)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o400)
        .open(partition.join(format!("{digest}.blob")))?;
    file.write_all(&original)?;
    file.sync_all()?;
    drop(file);
    let vault = Arc::new(AssetVault::open(&vault_path)?);
    let measured = PreparedOriginal {
        purpose: AssetPurpose::EvidenceOriginal,
        storage_key: scope().storage_key(&digest)?,
        identity: BlobIdentity {
            sha256: digest,
            byte_size: original.len() as u64,
        },
        content_type: ContentType::Png,
    };
    let archive_path = root.join("archive");
    fs::DirBuilder::new().mode(0o700).create(&archive_path)?;
    let origin = MediaPolicyArchiveOrigin::new(
        "synthetic-deployment",
        "synthetic-native-sql",
        "synthetic-media-custody",
        "fresh-1",
    )?;
    let read_owner = FixtureReadOwner::default();
    let (mut access, principal) = authorized_editor();
    let mut committed_record = None;
    access.with_mutation_authorization(principal.principal(), |guard| -> Result<(), Box<dyn std::error::Error>> {
        let authority = FencedAuthority { guard };
        let mut store = s::AtlasStore::open(
            root.join("atlas.sqlite"), s::NativeContract::new(NativeSemantics::native()),
            FencedAuthority { guard }, NativeMediaRuntime { vault: vault.clone(), server: Clock(Cell::new(400_000)) },
            s::StoreOptions::default(),
        )?;
        let selected: s::Scope = serde_json::from_value(json!(scope()))?;
        let target = s::RecordRef { record_type: s::RecordType::Asset, record_id: u(280_000) };
        let created = store.execute_json_with_authorization(&authority, principal.principal(), &selected, &target, &json!({
            "schemaVersion":1,"mutationId":u(280_010),"operation":"create","expectedRevision":null,
            "reason":"Fresh private synthetic original","guards":[],"value":{"recordType":"asset","payload": measured.with_provenance(license(), vec![])?}
        }))?;
        assert_eq!(created.record.revision, 1);
        let retained = store.capture_asset_review_original(principal.principal(), &principal, &selected, &target)?;
        let rendered = vault.qualify_asset_review(guard, &principal, retained.record(), &budget())?;
        let schemas = stock::NativeStockContract::new()?;
        let request = stock::ValidatedRequest::parse(&schemas, json!({
            "schemaVersion":3,"commandId":"atlas.asset.review","requestId":u(280_001),"context":scope(),
            "target":{"authority":"atlas","recordType":"asset","recordId":target.record_id},
            "payload":{"treatment":"request-preview","rendererReceiptId":rendered.receipt_id(),"evidenceIds":[]},
            "idempotencyKey":u(280_002),"reason":"Fresh native renderer review commit",
            "preconditions":{"target":{"kind":"atlas","value":1},"guards":[]},"approvalReceiptId":null
        }))?;
        let proof = rendered.bind_request(guard, &principal, &request, &budget())?;
        let plan = store.prepare_verified_asset_review(principal.principal(), &schemas, request.raw(), &retained, &proof)?;
        let work = budget();
        let commit = store.execute_verified_asset_review_stock_json_with_authorization(
            &authority, principal.principal(), &schemas, request.raw(), s::AssetReviewCommitPeers::new(&plan, guard, &work),
        )?;
        let successor = commit.groups[0].native_results[0].record.clone();
        let packet = MediaPolicyArchivePacket::encode_review(&proof, guard, &principal, &successor, &commit, &origin, MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES, &budget())?;
        let archive = PrivateStockArchive::open(TrustedStockArchiveConfig::new(archive_path.clone(), MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES)?)?;
        let write_owner = FixtureWriteOwner { original: principal.clone(), expected_destination: archive.destination().clone(), expected_origin: origin.clone(), reader: read_owner.clone() };
        let native = NativeMediaPolicyArchive::new(archive, origin.clone(), write_owner, read_owner.clone());
        let receipt = native.append(&packet, &budget())?;
        assert_eq!(receipt.name(), packet.member_name());
        assert_eq!(receipt.sha256(), sha256(packet.bytes()));
        assert_eq!(fs::metadata(archive_path.join(receipt.name()))?.permissions().mode() & 0o777, 0o600);
        drop(native);
        drop(packet);
        drop(plan);
        drop(proof);
        drop(retained);
        store.close()?;
        committed_record = Some(successor);
        Ok(())
    })?;
    let successor = committed_record.ok_or_else(unavailable)?;
    drop(principal);
    drop(access);
    drop(vault);
    // Open a NEW native directory descriptor, preserving only the independent
    // synthetic read owner's producer/custody evidence. No Store is reopened.
    let reopened = PrivateStockArchive::open(TrustedStockArchiveConfig::new(
        archive_path,
        MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES,
    )?)?;
    // No fresh write authority is retained after publication. This required write
    // port is unavailable, while the independent existing read owner remains.
    struct NoWrite;
    impl MediaPolicyArchiveWriteAuthorization for NoWrite {
        fn authorize_archive(
            &self,
            _: &ArchiveDestination,
            _: &MediaPolicyArchivePacket,
        ) -> MediaResult<()> {
            Err(MediaError::Forbidden)
        }
    }
    let reader = NativeMediaPolicyArchive::new(reopened, origin, NoWrite, read_owner);
    let authenticated = reader.read(&budget())?;
    assert_eq!(authenticated.catalog().len(), 1);
    authenticated.validate_frame(s::MediaPolicyRecoveryFrame::Asset(&successor))?;
    println!(
        "healthy recovery policy archive: actual Access and original allocation, private retained 2x1 renderer, genuine Store review commit, durable native packet publication (0600), writer/proof/principal/vault/Store drop, NEW descriptor full catalog/read authentication under independent SYNTHETIC in-memory native owner, exact offline Asset frame match; no production origin authority, process restart, restored SQL image, recovery execution or held controls"
    );
    Ok(())
}
