//! One healthy disposable native persistence/access/media composition.
//! Uses the actual published native semantic, SQLite, access and media peers.
//! Synthetic identities/time only; no JavaScript semantic/database adapter.
use std::cell::Cell;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::{access as a, domain::native_semantics::NativeSemantics, storage as s};
use serde_json::{Value, json};

use super::AssetVault;
use super::healthy_examples::{budget, license, png_fixture, record, scope, u};
use super::native::{
    NativeMediaAccess, NativeMediaRuntime, NativeMediaStorage, NativeReadAuthority,
    RetainedPrincipal,
};
use super::recovery::{capture_recovery, restore_recovery, verify_recovery};
use super::service::{DeliveryMode, MediaService, OwnedDescriptor, ReadMethod};
use super::types::{AssetPurpose, ContentType};

struct SyntheticClockIds(Cell<u32>);
impl s::Runtime for SyntheticClockIds {
    fn now(&self) -> s::Result<String> {
        Ok("2026-02-01T12:00:00Z".to_owned())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.0.get() + 1;
        self.0.set(next);
        Ok(u(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "Actual media runtime required",
        ))
    }
}

struct FencedMutation<'a> {
    guard: &'a a::TransactionAuthorization<'a>,
    original: &'a RetainedPrincipal,
}
impl s::Authorization for FencedMutation<'_> {
    type Principal = RetainedPrincipal;
    fn authorize(
        &self,
        principal: &RetainedPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(principal.principal(), self.original.principal())
            || request.capability != s::Capability::Mutate
        {
            return Err(s::Error::new(
                "forbidden",
                "Original mutation capability required",
            ));
        }
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(request.scope)?)?;
        let original = self
            .guard
            .authorize(&scope, a::Capability::Mutate)
            .map_err(|e| s::Error::new(e.code(), "Mutation authority unavailable"))?;
        Ok(s::VerifiedActor {
            workspace_id: original.scope().workspace_id.as_str().to_owned(),
            home_id: original.scope().home_id.as_str().to_owned(),
            actor_id: original.actor_id().as_str().to_owned(),
        })
    }
}

fn request<'a>(
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/media",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

fn tombstone(mutation: u32) -> Value {
    json!({
        "schemaVersion":1,"mutationId":u(mutation),"operation":"tombstone",
        "expectedRevision":1,"reason":"Healthy synthetic retained original",
        "guards":[{"record":{"recordType":"evidence","recordId":u(100)},"expectedRevision":1}]
    })
}

#[test]
fn healthy_native_owned_media_records_and_history() {
    let temp = tempfile::Builder::new()
        .prefix("houseatlas-at12-native-")
        .tempdir()
        .unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let vault = Arc::new(AssetVault::open(&root.join("media")).unwrap());
    let (png, _) = png_fixture(false, 0);
    let mut assets = Vec::new();
    for (id, content_type, mut original) in [
        (610, ContentType::Png, png.as_slice()),
        (
            611,
            ContentType::Text,
            b"Healthy native retained text\n".as_slice(),
        ),
        (
            612,
            ContentType::Pdf,
            b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n".as_slice(),
        ),
    ] {
        let prepared = vault
            .prepare_original(
                &scope(),
                AssetPurpose::EvidenceOriginal,
                content_type,
                &mut original,
                &budget(),
            )
            .unwrap();
        assets.push(record(
            id,
            prepared.with_provenance(license(), vec![u(100)]).unwrap(),
        ));
    }
    let fixture = Path::new(file!())
        .parent()
        .unwrap()
        .join("../../../packages/contracts/fixtures/optional-geometry.snapshot.json");
    let mut snapshot: s::Snapshot = serde_json::from_slice(&fs::read(fixture).unwrap()).unwrap();
    for asset in &assets {
        snapshot
            .records
            .push(serde_json::from_value(serde_json::to_value(asset).unwrap()).unwrap());
    }

    let config = a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".to_owned()])
        .unwrap()
        .with_clock(|| 1_800_000_000_000);
    let mut boundary = a::AccessBoundary::in_memory(config).unwrap();
    let id = |n| a::CanonicalId::parse(u(n)).unwrap();
    let access_scope: a::Scope =
        serde_json::from_value(serde_json::to_value(scope()).unwrap()).unwrap();
    let password = "Synthetic-test-password-only!";
    let verifier = a::hash_password(password).unwrap();
    boundary
        .provision_user(&id(50), &id(51), "synthetic-editor", &verifier, None)
        .unwrap();
    boundary
        .set_membership(&id(50), &access_scope, a::Role::Editor, true)
        .unwrap();
    let session = boundary
        .login(
            &request(a::Method::Post, None, None),
            &serde_json::to_vec(&json!({"username":"synthetic-editor","password":password}))
                .unwrap(),
            "synthetic-loopback",
        )
        .unwrap();
    let cookie = session.set_cookie().split(';').next().unwrap();
    let mutation = RetainedPrincipal::new(
        boundary
            .authorize(
                &request(
                    a::Method::Post,
                    Some(cookie),
                    Some(session.info().csrf_token()),
                ),
                &access_scope,
                a::Action::Mutate,
            )
            .unwrap(),
    );
    let boundary = Arc::new(Mutex::new(boundary));
    let access = NativeMediaAccess::new(Arc::clone(&boundary));
    let reader = access
        .authorize_request(&request(a::Method::Get, Some(cookie), None), &scope())
        .unwrap();
    let runtime = NativeMediaRuntime {
        vault: Arc::clone(&vault),
        server: SyntheticClockIds(Cell::new(50_000)),
    };
    let mut store = s::AtlasStore::open(
        root.join("atlas.sqlite"),
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(Arc::clone(&boundary)),
        runtime,
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )
    .unwrap();
    store.initialize_synthetic(&snapshot).unwrap();
    let store = Mutex::new(store);
    let adapter = NativeMediaStorage::new(&store);
    let service = MediaService::new(&adapter, &access, &vault);
    let text_download = service
        .deliver(
            &reader,
            &scope(),
            &OwnedDescriptor::AtlasAsset { asset_id: u(611) },
            ReadMethod::Get,
            DeliveryMode::Download,
            &budget(),
        )
        .unwrap();
    assert_eq!(text_download.body, b"Healthy native retained text\n");
    assert_eq!(text_download.status, 200);
    let storage_scope: s::Scope =
        serde_json::from_value(serde_json::to_value(scope()).unwrap()).unwrap();
    boundary.lock().unwrap().with_mutation_authorization(mutation.principal(), |guard| -> Result<(), Box<dyn std::error::Error>> {
        let authority = FencedMutation { guard, original: &mutation };
        let mut store = store.lock().unwrap();
        store.execute_json_with_authorization(&authority, &mutation, &storage_scope, &s::RecordRef { record_type:s::RecordType::Asset, record_id:u(611) }, &tombstone(8312))?;
        store.execute_batch_json_with_authorization(&authority, &mutation, &storage_scope, &json!({"schemaVersion":1,"batchId":u(8320),"reason":"Healthy synthetic retained PDF","commands":[{"target":{"recordType":"asset","recordId":u(612)},"command":tombstone(8314)}]}))?;
        Ok(())
    }).unwrap();
    let descriptor = OwnedDescriptor::AtlasAsset { asset_id: u(610) };
    let original = service
        .deliver(
            &reader,
            &scope(),
            &descriptor,
            ReadMethod::Get,
            DeliveryMode::Download,
            &budget(),
        )
        .unwrap();
    assert_eq!(original.body, png);
    assert_eq!(original.status, 200);
    let head = service
        .deliver(
            &reader.clone(),
            &scope(),
            &descriptor,
            ReadMethod::Head,
            DeliveryMode::Preview,
            &budget(),
        )
        .unwrap();
    assert!(head.body.is_empty());
    assert!(
        head.headers
            .iter()
            .any(|(key, value)| *key == "cache-control" && value == "private, no-store")
    );
    for id in [611, 612] {
        let target = s::RecordRef {
            record_type: s::RecordType::Asset,
            record_id: u(id),
        };
        let history = store
            .lock()
            .unwrap()
            .history(&reader, &storage_scope, &target)
            .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].operation, s::Operation::Tombstone);
        assert_eq!(
            store
                .lock()
                .unwrap()
                .read_record(&reader, &storage_scope, &target)
                .unwrap()
                .lifecycle,
            s::Lifecycle::Tombstoned
        );
    }
    let snapshot_before = store
        .lock()
        .unwrap()
        .read_snapshot(&reader, &storage_scope)
        .unwrap();
    let captured_path = root.join("native-bundle");
    let manifest = capture_recovery(&adapter, &vault, &captured_path, &budget()).unwrap();
    assert_eq!(manifest.format, "houseatlas-rust-owned-recovery/1");
    assert_eq!(manifest.database_schema, 2);
    assert_eq!(manifest.contract_version, s::CONTRACT_VERSION);
    assert_eq!(
        manifest.database_lineage.as_deref(),
        Some(s::DATABASE_LINEAGE)
    );
    assert_eq!(manifest.assets.len(), 4);
    let missing = manifest
        .assets
        .iter()
        .find(|asset| asset.asset_id == u(600))
        .unwrap();
    assert_eq!(missing.availability, super::types::Availability::Missing);
    assert!(missing.blob.is_none());
    for id in [611, 612] {
        let retained = manifest
            .assets
            .iter()
            .find(|asset| asset.asset_id == u(id))
            .unwrap();
        assert_eq!(retained.lifecycle, super::types::Lifecycle::Tombstoned);
        assert!(retained.blob.is_some());
    }
    let verified = verify_recovery(&adapter, &captured_path, &budget()).unwrap();
    assert_eq!(verified.manifest, manifest);
    let restored = restore_recovery(
        &adapter,
        &captured_path,
        &root.join("native-restored"),
        &budget(),
    )
    .unwrap();
    // Compare the complete closed image before normal opening enables WAL.
    // This preserves original audit/receipt bodies without invoking replay.
    assert_eq!(
        fs::read(&restored.database_path).unwrap(),
        fs::read(captured_path.join("atlas.sqlite")).unwrap()
    );
    let restored_vault = Arc::new(AssetVault::open(&restored.vault_root).unwrap());
    for asset in &verified.assets {
        if asset.payload.availability == super::types::Availability::Available
            || [u(611), u(612)].contains(&asset.record_id)
        {
            assert_eq!(
                restored_vault.read_retained(asset, &budget()).unwrap(),
                vault.read_retained(asset, &budget()).unwrap()
            );
        }
    }
    let restored_store = Mutex::new(
        s::AtlasStore::open(
            &restored.database_path,
            s::NativeContract::new(NativeSemantics::native()),
            NativeReadAuthority(Arc::clone(&boundary)),
            NativeMediaRuntime {
                vault: Arc::clone(&restored_vault),
                server: SyntheticClockIds(Cell::new(60_000)),
            },
            s::StoreOptions::default(),
        )
        .unwrap(),
    );
    let snapshot_after = restored_store
        .lock()
        .unwrap()
        .read_snapshot(&reader, &storage_scope)
        .unwrap();
    assert_eq!(
        serde_json::to_value(snapshot_after).unwrap(),
        serde_json::to_value(snapshot_before).unwrap()
    );
    for id in [611, 612] {
        let target = s::RecordRef {
            record_type: s::RecordType::Asset,
            record_id: u(id),
        };
        let before = store
            .lock()
            .unwrap()
            .history(&reader, &storage_scope, &target)
            .unwrap();
        let after = restored_store
            .lock()
            .unwrap()
            .history(&reader, &storage_scope, &target)
            .unwrap();
        assert_eq!(
            serde_json::to_value(after).unwrap(),
            serde_json::to_value(before).unwrap()
        );
    }
    let restored_adapter = NativeMediaStorage::new(&restored_store);
    let restored_service = MediaService::new(&restored_adapter, &access, &restored_vault);
    let restored_original = restored_service
        .deliver(
            &reader,
            &scope(),
            &descriptor,
            ReadMethod::Get,
            DeliveryMode::Download,
            &budget(),
        )
        .unwrap();
    assert_eq!(restored_original.body, png);
    println!(
        "healthy native Rust storage + actual AT11 login/principals/fenced single+batch mutation; SafeRendered PNG download/preview HEAD and DownloadOnly text download; actual native schema2 owned backup, read-only image validation, capture/verify/restore with missing original and retained tombstones; closed database/audit/receipt bytes, originals, scoped graph and ordered history preserved; stock journals EMPTY ONLY; actual native semantic/JCS/timestamp peers"
    );
}
