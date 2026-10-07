//! One healthy disposable native persistence/access/media composition.
//! AT52 full native semantics remain a required peer: only this example uses
//! the published pure semantic oracle. No JavaScript database adapter is used.
use std::cell::Cell;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::{access as a, storage as s};
use serde_json::{Value, json};

use super::AssetVault;
use super::healthy_examples::{budget, license, png_fixture, record, scope, u};
use super::native::{
    NativeMediaAccess, NativeMediaRuntime, NativeMediaStorage, NativeReadAuthority,
    RetainedPrincipal,
};
use super::service::{DeliveryMode, MediaService, OwnedDescriptor, ReadMethod};
use super::types::{AssetPurpose, ContentType};

struct SemanticOracle {
    process: Mutex<OracleProcess>,
}

struct OracleProcess {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Drop for OracleProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl SemanticOracle {
    fn start() -> Self {
        let helper = Path::new(file!())
            .parent()
            .unwrap()
            .join("checks/semantic-oracle.mjs");
        let mut child = Command::new("node")
            .arg(helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            process: Mutex::new(OracleProcess {
                child,
                input,
                output,
            }),
        }
    }

    fn call(&self, operation: &str, args: Value) -> s::Result<Value> {
        let error = || s::Error::new("example-unavailable", "Published semantic peer unavailable");
        let mut process = self.process.lock().map_err(|_| error())?;
        writeln!(
            process.input,
            "{}",
            json!({"operation":operation,"args":args})
        )
        .map_err(|_| error())?;
        process.input.flush().map_err(|_| error())?;
        let mut line = String::new();
        process.output.read_line(&mut line).map_err(|_| error())?;
        let response: Value = serde_json::from_str(&line)?;
        if response["ok"] != true {
            return Err(error());
        }
        Ok(response["value"].clone())
    }
}

impl s::Contract for SemanticOracle {
    fn validate_shape(&self, name: &str, value: &Value) -> s::Result<()> {
        self.call("shape", json!({"name":name,"value":value}))
            .map(|_| ())
    }
    fn validate_snapshot(&self, snapshot: &s::Snapshot) -> s::Result<()> {
        self.call("snapshot", json!({"snapshot":snapshot}))
            .map(|_| ())
    }
    fn assert_transition(
        &self,
        current: Option<&s::Record>,
        command: &s::Mutation,
        target: &s::ScopedTarget,
    ) -> s::Result<u64> {
        self.call(
            "transition",
            json!({"current":current,"command":command,"target":target}),
        )?
        .as_u64()
        .ok_or(s::Error::new("example-unavailable", "Revision missing"))
    }
    fn assert_guards(
        &self,
        snapshot: &s::Snapshot,
        current: Option<&s::Record>,
        command: &s::Mutation,
        target: &s::ScopedTarget,
        created: &[s::ScopedTarget],
    ) -> s::Result<()> {
        self.call("guards", json!({"snapshot":snapshot,"current":current,"command":command,"target":target,"created":created})).map(|_| ())
    }
    fn assert_final_mutation(
        &self,
        snapshot: &s::Snapshot,
        current: Option<&s::Record>,
        command: &s::Mutation,
        target: &s::ScopedTarget,
    ) -> s::Result<()> {
        self.call(
            "final",
            json!({"snapshot":snapshot,"current":current,"command":command,"target":target}),
        )
        .map(|_| ())
    }
    fn validate_result(&self, result: &s::MutationResult, prior: s::Prior<'_>) -> s::Result<()> {
        let (kind, record) = match prior {
            s::Prior::Unspecified => ("unspecified", None),
            s::Prior::Missing => ("missing", None),
            s::Prior::Record(record) => ("record", Some(record)),
        };
        self.call(
            "result",
            json!({"result":result,"priorKind":kind,"prior":record}),
        )
        .map(|_| ())
    }
    fn canonical_json(&self, value: &Value) -> s::Result<String> {
        self.call("canonical", json!({"value":value}))?
            .as_str()
            .map(str::to_owned)
            .ok_or(s::Error::new(
                "example-unavailable",
                "Canonical JSON missing",
            ))
    }
    fn timestamp_millis(&self, value: &str) -> s::Result<Option<i64>> {
        let result = self.call("timestamp", json!({"value":value}))?;
        if result.is_null() {
            Ok(None)
        } else {
            result
                .as_i64()
                .map(Some)
                .ok_or(s::Error::new("example-unavailable", "Timestamp missing"))
        }
    }
}

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
        s::NativeContract::new(SemanticOracle::start()),
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
    let storage_scope: s::Scope =
        serde_json::from_value(serde_json::to_value(scope()).unwrap()).unwrap();
    boundary.lock().unwrap().with_mutation_authorization(mutation.principal(), |guard| -> Result<(), Box<dyn std::error::Error>> {
        let authority = FencedMutation { guard, original: &mutation };
        let mut store = store.lock().unwrap();
        store.execute_json_with_authorization(&authority, &mutation, &storage_scope, &s::RecordRef { record_type:s::RecordType::Asset, record_id:u(611) }, &tombstone(8312))?;
        store.execute_batch_json_with_authorization(&authority, &mutation, &storage_scope, &json!({"schemaVersion":1,"batchId":u(8320),"reason":"Healthy synthetic retained PDF","commands":[{"target":{"recordType":"asset","recordId":u(612)},"command":tombstone(8314)}]}))?;
        Ok(())
    }).unwrap();
    let adapter = NativeMediaStorage::new(&store);
    let service = MediaService::new(&adapter, &access, &vault);
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
    println!(
        "healthy native Rust storage + actual AT11 login/principals/fenced single+batch mutation; actual media availability proof, private GET/HEAD and ordered history; semantic/JCS oracle TEST-ONLY; native backup/restore peer API PENDING"
    );
}
