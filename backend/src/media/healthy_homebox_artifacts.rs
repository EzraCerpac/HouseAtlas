//! Bounded positive synthetic source-file custody and authenticated GET/HEAD.
//! The source owner below is explicitly local and synthetic, not a production
//! HomeBox presence/version witness. No native URL, provider, listener or replay.
use houseatlas_backend::{
    access as a,
    contracts::stock::StockTarget,
    domain::stock as st,
    media::{
        Cancellation, MAX_BYTES, MediaError, MediaResult, WorkBudget,
        homebox_artifacts::{
            AuthenticatedHomeboxRedemption, CapturedHomeboxFile, HomeboxArtifactBroker,
            HomeboxFileBinding, HomeboxFileSource, HomeboxFileVersion,
        },
        native::RetainedPrincipal,
        service::ReadMethod,
        types::sha256,
    },
    providers::homebox::read::{SourceScope, query::HomeBoxReadQuery},
};
use serde_json::json;
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
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
        json!({
            "schemaVersion":3,"commandId":"homebox.file.download","requestId":id(n),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),
                "resourceKind":"attachment","entityId":id(5),"resourceId":id(6)},
            "payload":{}
        }),
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

// This test-only owner retains an exact file membership tuple. Its actual
// content-addressed local version is computed from source bytes, not a fixture
// label, MIME, target ID, guessed native URL or retrieval timestamp. Real native
// source versions/presence must come from a separately qualified source owner.
struct LocalSource {
    path: PathBuf,
    scope: SourceScope,
    target: StockTarget,
}

impl LocalSource {
    fn inspect(&self, work: &WorkBudget) -> MediaResult<(File, Vec<u8>, HomeboxFileVersion)> {
        work.check()?;
        let mut file = File::open(&self.path)?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        work.check()?;
        if bytes.len() > MAX_BYTES {
            return Err(MediaError::TooLarge);
        }
        file.seek(SeekFrom::Start(0))?;
        let version = HomeboxFileVersion {
            source_version: format!("sha256:{}", sha256(&bytes)),
            content_type: "application/octet-stream".into(),
            // Native attachment metadata may omit both; measurement establishes
            // their real values independently rather than trusting these fields.
            declared_byte_size: None,
            declared_sha256: None,
        };
        Ok((file, bytes, version))
    }
}

impl HomeboxFileSource for LocalSource {
    type Body = File;

    fn open_file(
        &self,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        request: &st::ValidatedRequest,
        work: &WorkBudget,
    ) -> MediaResult<CapturedHomeboxFile<File>> {
        let query = HomeBoxReadQuery::from_request(request).unwrap();
        assert_eq!(query.scope(), &self.scope);
        assert_eq!(query.target(), &self.target);
        assert_eq!(
            grant.reference().workspace_id,
            original.principal().scope().workspace_id
        );
        assert_eq!(
            grant.reference().home_id,
            original.principal().scope().home_id
        );
        assert_eq!(grant.reference().key.external_id, id(5));
        let (body, _, version) = self.inspect(work)?;
        Ok(CapturedHomeboxFile {
            scope: self.scope.clone(),
            target: self.target.clone(),
            version,
            body,
        })
    }

    fn revalidate_file(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        grant: &a::SourceGrant,
        binding: &HomeboxFileBinding,
        work: &WorkBudget,
    ) -> MediaResult<()> {
        assert!(std::ptr::eq(guard.principal(), original.principal()));
        assert!(std::ptr::eq(guard.revalidate_source(grant).unwrap(), grant));
        assert_eq!(binding.source(), grant.reference());
        assert_eq!(
            binding.request_digest(),
            st::canonical_digest(binding.request().raw()).unwrap()
        );
        let query = HomeBoxReadQuery::from_request(binding.request()).unwrap();
        assert_eq!(query.scope(), &self.scope);
        assert_eq!(query.target(), &self.target);
        let (_, bytes, version) = self.inspect(work)?;
        assert_eq!(binding.version(), &version);
        assert_eq!(binding.byte_size(), bytes.len() as u64);
        assert_eq!(binding.sha256(), sha256(&bytes));
        Ok(())
    }
}

fn main() {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<HomeboxArtifactBroker>();
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()
        .unwrap();
    let path = temporary.path().join("fresh-synthetic-owned-file");
    let bytes = b"Fresh synthetic local attachment bytes.\n";
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o400)
        .open(&path)
        .unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
    drop(file);
    let get_request = request(20);
    let query = HomeBoxReadQuery::from_request(&get_request).unwrap();
    let source = LocalSource {
        path,
        scope: query.scope().clone(),
        target: query.target().clone(),
    };
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
    let password = "Synthetic-artifact-password-only!";
    access
        .provision_user(
            &cid(10),
            &cid(11),
            "synthetic-artifact",
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
            &serde_json::to_vec(&json!({"username":"synthetic-artifact","password":password}))
                .unwrap(),
            "synthetic-local-artifact",
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
    let mut broker = HomeboxArtifactBroker::default();

    // Two fresh native stock requests/issuances, one GET and one HEAD. This is
    // ordinary file delivery, without command replay/expiry/revocation controls.
    for (request, method, native_method) in [
        (get_request, ReadMethod::Get, a::Method::Get),
        (request(21), ReadMethod::Head, a::Method::Head),
    ] {
        let issued = broker
            .issue(&mut access, &original, &request, &source, &budget())
            .unwrap();
        let data = issued.file_download();
        assert_eq!(data.scope, source.scope);
        assert_eq!(data.target, source.target);
        assert_eq!(data.sha256.as_deref(), Some(sha256(bytes).as_str()));
        assert_eq!(data.byte_size, bytes.len() as u64);
        assert_eq!(data.content_type, "application/octet-stream");
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
        let fresh = AuthenticatedHomeboxRedemption::authorize(
            &mut access,
            &evidence(native_method, Some(cookie)),
            &scope,
        )
        .unwrap();
        assert!(!std::ptr::eq(
            fresh.principal().principal(),
            original.principal()
        ));
        let output = broker
            .redeem(
                &mut access,
                &fresh,
                data.download_token.as_str(),
                &source,
                &budget(),
            )
            .unwrap();
        assert_eq!(output.status, 200);
        if method == ReadMethod::Get {
            assert_eq!(output.body, bytes);
        } else {
            assert!(output.body.is_empty());
        }
        assert!(
            output
                .headers
                .contains(&("content-length", bytes.len().to_string()))
        );
        assert!(output.headers.contains(&(
            "content-disposition",
            "attachment; filename=\"homebox-file\"".into()
        )));
        assert!(
            output
                .headers
                .contains(&("cache-control", "private, no-store".into()))
        );
        assert!(
            output
                .headers
                .contains(&("x-content-type-options", "nosniff".into()))
        );
    }
    println!(
        "healthy HomeBox file broker: private fresh synthetic local file, actual measured bytes/hash, exact validated scoped attachment, real original Access/source grant, final issuance checks, fresh same-session GET and separate HEAD; production native source witness and HTTP remain unbound"
    );
}
