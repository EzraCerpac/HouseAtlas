//! One exact positive source-owner fixture. Fresh private synthetic files only;
//! no native retrieval, listener, provider, replay, expiry or mutation controls.
use crate::{
    access as a,
    contracts::stock::StockTarget,
    domain::stock as st,
    media::{
        Cancellation, MediaError, MediaResult, WorkBudget,
        homebox_artifacts::{
            AuthenticatedHomeboxRedemption, HomeboxArtifactBroker, HomeboxFileVersion,
        },
        native::RetainedPrincipal,
        types::sha256,
    },
    providers::homebox::{
        read::{SourceScope, Timestamp, query::*},
        wire,
    },
};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default()).unwrap()
}
fn request(n: u32) -> st::ValidatedRequest {
    st::ValidatedRequest::parse(
        &st::NativeStockContract::new().unwrap(),
        json!({"schemaVersion":3,"commandId":"homebox.file.download","requestId":id(n),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),
                "resourceKind":"attachment","entityId":id(5),"resourceId":id(6)},
            "payload":{}}),
    )
    .unwrap()
}
fn evidence(method: a::Method, cookie: Option<&str>) -> a::RequestEvidence<'_> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/media/homebox/files",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}

// This is the actual owner of the fresh local fixture file and its membership
// index. Generation is allocated by this owner when it creates the file/member;
// native production generation/version semantics are not inferred from hashes.
struct SyntheticStore {
    path: PathBuf,
    scope: SourceScope,
    target: StockTarget,
    native: Vec<u8>,
    version: HomeboxFileVersion,
    digest: String,
    size: u64,
    captures: usize,
    current_checks: usize,
}
struct LocalOwner {
    original: RetainedPrincipal,
    store: Arc<Mutex<SyntheticStore>>,
}
struct OriginalFileEvidence {
    original: RetainedPrincipal,
    request: Value,
    source: a::SourceRef,
    native: Vec<u8>,
    version: HomeboxFileVersion,
    digest: String,
    size: u64,
}
impl LocalOwner {
    fn capture(
        &self,
        store: &SyntheticStore,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<NativeStoredFileCapture<OriginalFileEvidence, File>> {
        budget.check()?;
        assert!(std::ptr::eq(
            self.original.principal(),
            original.principal()
        ));
        let query = HomeBoxReadQuery::from_request(request).unwrap();
        assert_eq!(query.scope(), &store.scope);
        assert_eq!(query.target(), &store.target);
        assert_eq!(grant.reference().key.external_id, id(5));
        // No native key/URL opens this file. The authoritative synthetic store
        // owns the exact local file it created and indexes it under this member.
        let body = File::open(&store.path)?;
        assert!(body.metadata()?.is_file());
        Ok(NativeStoredFileCapture {
            scope: store.scope.clone(),
            target: store.target.clone(),
            owner_get_path: format!("/api/v1/entities/{}", id(5)),
            owner_get_query: vec![],
            file_get_path: format!("/api/v1/entities/{}/attachments/{}", id(5), id(6)),
            file_get_query: vec![],
            original_owner: store.native.clone(),
            observed_at: Timestamp::parse("2026-10-08T05:00:00.1200+00:00").unwrap(),
            evidence: OriginalFileEvidence {
                original: self.original.clone(),
                request: request.raw().clone(),
                source: grant.reference().clone(),
                native: store.native.clone(),
                version: store.version.clone(),
                digest: store.digest.clone(),
                size: store.size,
            },
            body,
        })
    }
}
impl NativeStoredFileOwner for LocalOwner {
    type Evidence = OriginalFileEvidence;
    type Body = File;

    fn capture_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<NativeStoredFileCapture<Self::Evidence, File>> {
        let mut store = self.store.lock().map_err(|_| MediaError::Unavailable)?;
        store.captures += 1;
        self.capture(&store, original, grant, request, budget)
    }

    fn with_current_file<T>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        budget: &WorkBudget,
        inspect: impl FnOnce(NativeStoredFileCapture<Self::Evidence, File>) -> MediaResult<T>,
    ) -> MediaResult<T> {
        assert!(std::ptr::eq(guard.principal(), original.principal()));
        assert!(std::ptr::eq(guard.revalidate_source(grant).unwrap(), grant));
        let mut store = self.store.lock().map_err(|_| MediaError::Unavailable)?;
        store.current_checks += 1;
        let capture = self.capture(&store, original, grant, request, budget)?;
        // Keep the authoritative source lock across actual decoding, local-file
        // measurement, original-proof qualification and sealed-binding checks.
        let result = inspect(capture);
        drop(store);
        result
    }

    fn qualify_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        capture: &DecodedStoredFile<Self::Evidence>,
        budget: &WorkBudget,
    ) -> MediaResult<HomeboxFileVersion> {
        budget.check()?;
        let proof = &capture.original().evidence;
        assert!(std::ptr::eq(
            proof.original.principal(),
            original.principal()
        ));
        assert_eq!(&proof.request, request.raw());
        assert_eq!(&proof.source, grant.reference());
        assert_eq!(&proof.native, &capture.original().original_owner);
        assert_eq!(capture.source()["id"], id(5));
        assert_eq!(capture.member()["id"], id(6));
        assert_eq!(capture.member()["path"], "opaque/synthetic-owned-member");
        assert_eq!(capture.member()["mimeType"], "application/octet-stream");
        assert_eq!(
            capture.member()["updatedAt"],
            "2026-01-02T03:04:05.1200+02:00"
        );
        assert_eq!(capture.measured_sha256(), proof.digest);
        assert_eq!(capture.measured_byte_size(), proof.size);
        assert_eq!(
            proof.version.source_version,
            "synthetic-store-owned-generation:1"
        );
        // This proof belongs to the actual synthetic local store. Production
        // requires its own authentic endpoint/response/version/membership inputs.
        Ok(proof.version.clone())
    }
}

#[test]
fn healthy_original_owned_file_membership_and_measured_get_head() {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()
        .unwrap();
    let path = temporary.path().join("fresh-synthetic-owned-file");
    let bytes = b"Original locally owned synthetic member bytes.\n";
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o400)
        .open(&path)
        .unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
    drop(file);
    // Exact native fixture shape with explicit synthetic owner/member facts.
    // No missing archived/file version value is filled into native metadata.
    let mut native: Value =
        serde_json::from_slice(include_bytes!("../../wire/fixtures/item.detail.json")).unwrap();
    native["id"] = json!(id(5));
    native["attachments"] = json!([{
        "id":id(6),"createdAt":"2026-01-02T03:04:05.1200+02:00",
        "updatedAt":"2026-01-02T03:04:05.1200+02:00","type":"attachment",
        "primary":false,"path":"opaque/synthetic-owned-member",
        "title":"Synthetic file","mimeType":"application/octet-stream"
    }]);
    native["sourceExtension"] = json!({"retained":"original unknown source fact"});
    let cid = |n| a::CanonicalId::parse(id(n)).unwrap();
    let scope = a::Scope {
        workspace_id: cid(1),
        home_id: cid(2),
    };
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    let password = "Synthetic-owned-file-password-only!";
    access
        .provision_user(
            &cid(10),
            &cid(11),
            "synthetic-owned-file",
            &a::hash_password(password).unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&cid(10), &scope, a::Role::Viewer, true)
        .unwrap();
    access
        .put_source(
            &a::SourceRegistration {
                workspace_id: cid(1),
                home_id: cid(2),
                source_instance_id: cid(3),
                collection_id: id(4),
                owner: a::SourceOwner::Homebox,
                partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
                allowed_external_ids: vec![id(5)],
            },
            None,
        )
        .unwrap();
    let session = access
        .login(
            &evidence(a::Method::Post, None),
            &serde_json::to_vec(&json!({"username":"synthetic-owned-file","password":password}))
                .unwrap(),
            "synthetic-local-owned-file",
        )
        .unwrap();
    let cookie = session.set_cookie().split(';').next().unwrap();
    let original = RetainedPrincipal::new(
        access
            .authorize(
                &evidence(a::Method::Get, Some(cookie)),
                &scope,
                a::Action::Read,
            )
            .unwrap(),
    );
    let query = HomeBoxReadQuery::from_request(&request(20)).unwrap();
    let owner = LocalOwner {
        original: original.clone(),
        store: Arc::new(Mutex::new(SyntheticStore {
            path,
            scope: query.scope().clone(),
            target: query.target().clone(),
            native: serde_json::to_vec(&native).unwrap(),
            version: HomeboxFileVersion {
                source_version: "synthetic-store-owned-generation:1".into(),
                content_type: "application/octet-stream".into(),
                declared_byte_size: None,
                declared_sha256: None,
            },
            digest: sha256(bytes),
            size: bytes.len() as u64,
            captures: 0,
            current_checks: 0,
        })),
    };
    let retained_store = owner.store.clone();
    let source = OwnedHomeboxFileSource::new(owner, wire::DecodeLimits::default());
    let mut broker = HomeboxArtifactBroker::default();
    for (request, method) in [
        (request(20), a::Method::Get),
        (request(21), a::Method::Head),
    ] {
        let issued = broker
            .issue(&mut access, &original, &request, &source, &budget())
            .unwrap();
        let data = issued.file_download();
        assert_eq!(data.target, *query.target());
        assert_eq!(data.sha256.as_deref(), Some(sha256(bytes).as_str()));
        assert_eq!(data.byte_size, bytes.len() as u64);
        broker
            .validate_issued(
                &mut access,
                &original,
                &issued,
                &request,
                &source,
                &budget(),
            )
            .unwrap();
        let redemption = AuthenticatedHomeboxRedemption::authorize(
            &mut access,
            &evidence(method, Some(cookie)),
            &scope,
        )
        .unwrap();
        assert!(!std::ptr::eq(
            redemption.principal().principal(),
            original.principal()
        ));
        let response = broker
            .redeem(
                &mut access,
                &redemption,
                data.download_token.as_str(),
                &source,
                &budget(),
            )
            .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(
            response.body,
            if method == a::Method::Get {
                bytes.to_vec()
            } else {
                vec![]
            }
        );
        assert!(
            response
                .headers
                .contains(&("content-length", bytes.len().to_string()))
        );
    }
    let store = retained_store.lock().unwrap();
    assert_eq!(store.captures, 2);
    assert_eq!(store.current_checks, 8);
    assert_eq!(
        serde_json::from_slice::<Value>(&store.native).unwrap(),
        native
    );
}
