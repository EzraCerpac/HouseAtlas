//! Ordinary local positives over exact published native peers. Session material
//! stays private to disposable memory. No listener, provider or stock command
//! runs, and no synthetic stock authority/preparer supplies a release decision.

use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
};

use crate::{access, app, contracts::stock as wire, domain, http::contracts, storage};
use serde_json::{Value, json};

use super::{
    AdapterConfig, CatalogPort, JsonObject, NativeCatalog, NativeContext, NativePrincipalPort,
    NativeSchemas, PrincipalPort,
};

const SNAPSHOT: &[u8] =
    include_bytes!("../../../../packages/contracts/fixtures/plan-free.snapshot.json");
const ORIGIN: &str = "https://atlas.synthetic.invalid";
const PASSWORD: &str = "Synthetic-at38-local-checkpoint-only!";

fn shared_source() -> PathBuf {
    std::env::var_os("HOUSEATLAS_AT38_SHARED_SOURCE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("backend manifest has a repository parent")
                .to_path_buf()
        })
}

fn evidence<'a>(method: access::Method, cookie: Option<&'a str>) -> access::RequestEvidence<'a> {
    access::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}

fn object(value: Value) -> JsonObject {
    let Value::Object(object) = value else {
        panic!("healthy stock envelope is an object");
    };
    object
}

fn descriptor(schema: &JsonObject) -> jsonschema::Validator {
    assert_eq!(schema.get("type"), Some(&Value::String("object".into())));
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .offline()
        .build(&Value::Object(schema.clone()))
        .expect("published descriptor resolves entirely offline")
}

// Ready local access peers use this safe single-thread executor. No listener,
// thread spawn, timer or concurrency qualification is introduced.
struct ThreadWake(std::thread::Thread);
impl Wake for ThreadWake {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}
fn run<T>(future: impl Future<Output = T>) -> T {
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(value) => return value,
            Poll::Pending => std::thread::park(),
        }
    }
}

#[test]
fn healthy_native_catalog_context_and_core_reads() {
    let source = shared_source();
    let schemas = NativeSchemas::from_bytes(
        &std::fs::read(source.join("contracts/stock-wire3/agent/agent.schema.json")).unwrap(),
        &std::fs::read(source.join("packages/contracts/schemas/atlas.schema.json")).unwrap(),
    )
    .unwrap();
    let families = wire::families().unwrap();
    assert_eq!(families.len(), 10);
    let mut descriptor_bytes = 0;
    for family in families {
        for reference in [&family.input_schema, &family.output_schema] {
            let schema = schemas.schema(reference).unwrap();
            descriptor(&schema);
            descriptor_bytes += serde_json::to_vec(&schema).unwrap().len();
        }
    }
    assert!(descriptor_bytes <= AdapterConfig::default().max_response_bytes);

    let snapshot: storage::Snapshot = serde_json::from_slice(SNAPSHOT).unwrap();
    assert!(snapshot.synthetic);
    let original_record = snapshot
        .records
        .iter()
        .find(|record| {
            record.record_type == storage::RecordType::Evidence
                && record.payload["provenance"]["source"] == Value::Null
                && record.payload["references"] == json!([])
        })
        .expect("published source-free evidence")
        .clone();
    let scope = domain::Scope {
        workspace_id: original_record.workspace_id.clone(),
        home_id: original_record.home_id.clone(),
    };
    let target = domain::RecordRef {
        record_type: domain::RecordType::Evidence,
        record_id: original_record.record_id.clone(),
    };
    let access_scope = app::access_scope(&scope).unwrap();
    let user = access::CanonicalId::parse("10000000-0000-4000-8000-000000000004").unwrap();
    let actor = access::CanonicalId::parse("10000000-0000-4000-8000-000000000005").unwrap();
    let config = access::AccessConfig::new(vec![ORIGIN.into()])
        .unwrap()
        .with_clock(|| 1_800_000_000_000);
    let mut boundary = access::AccessBoundary::in_memory(config).unwrap();
    let verifier = access::hash_password(PASSWORD).unwrap();
    boundary
        .provision_user(&user, &actor, "synthetic-at38-viewer", &verifier, None)
        .unwrap();
    boundary
        .set_membership(&user, &access_scope, access::Role::Viewer, true)
        .unwrap();
    let login = serde_json::to_vec(&json!({
        "username":"synthetic-at38-viewer", "password":PASSWORD
    }))
    .unwrap();
    let session = boundary
        .login(
            &evidence(access::Method::Post, None),
            &login,
            "synthetic-at38-local",
        )
        .unwrap();
    // No token/cookie/CSRF value is printed, serialized or retained as evidence.
    let cookie = session.set_cookie().split(';').next().unwrap();
    let original = boundary
        .authorize(
            &evidence(access::Method::Get, Some(cookie)),
            &access_scope,
            access::Action::Read,
        )
        .unwrap();
    let access = Arc::new(Mutex::new(boundary));
    let context = NativeContext::from_principal(original.clone());
    let principal_port = NativePrincipalPort::new(Arc::clone(&access));
    let catalog_principal = run(principal_port.resolve(&context)).unwrap();
    run(principal_port.revalidate(&context, &catalog_principal)).unwrap();

    let catalog = NativeCatalog::with_admitted_operations(
        &schemas,
        &catalog_principal,
        [
            wire::OperationId::AtlasEvidenceGet,
            wire::OperationId::AtlasEvidenceHistory,
        ],
    )
    .unwrap();
    let page = catalog.list(&catalog_principal, None).unwrap();
    assert_eq!(page.tools.len(), 1);
    assert_eq!(page.tools[0].name, "atlas_records");
    assert!(
        serde_json::to_vec(&page).unwrap().len() <= AdapterConfig::default().max_response_bytes
    );
    let input_validator = descriptor(&page.tools[0].input_schema);
    let output_validator = descriptor(page.tools[0].output_schema.as_ref().unwrap());
    let selected_target = json!({
        "authority":"atlas", "recordType":"evidence", "recordId":target.record_id
    });
    let read = json!({
        "schemaVersion":3, "commandId":"atlas.evidence.get",
        "requestId":"00000000-0000-4000-8000-000000060038",
        "context":scope, "target":selected_target, "payload":{}
    });
    let history = json!({
        "schemaVersion":3, "commandId":"atlas.evidence.history",
        "requestId":"00000000-0000-4000-8000-000000060039",
        "context":scope, "target":selected_target,
        "payload":{"cursor":null,"pageSize":20,"includeArchived":false}
    });
    for request in [&read, &history] {
        input_validator.validate(request).unwrap();
        let prepared = catalog
            .prepare(&catalog_principal, "atlas_records", object(request.clone()))
            .unwrap();
        assert_eq!(prepared.operation.request.raw(), request);
        let action_principal =
            run(principal_port.authorize(&context, &prepared.requirement)).unwrap();
        assert!(std::ptr::eq(
            catalog_principal.original(),
            action_principal.original()
        ));
        run(principal_port.revalidate(&context, &action_principal)).unwrap();
    }

    let native_contracts = contracts::NativeContracts;
    let mut store = storage::AtlasStore::open(
        ":memory:",
        native_contracts,
        app::ReadAuthority(Arc::clone(&access)),
        app::ServerRuntime,
        storage::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )
    .unwrap();
    store.initialize_synthetic(&snapshot).unwrap();
    let request_principal = app::RequestPrincipal::new(original);
    let (record, audits) = {
        let mut queries = domain::Queries {
            store: domain::native_storage::NativeStorage::from_store(&mut store, &native_contracts),
            access: app::HomeAuthority {
                access: Arc::clone(&access),
                home: domain::HomeSummary {
                    scope: scope.clone(),
                    label: "Synthetic home".into(),
                },
            },
        };
        (
            queries.record(&request_principal, &scope, &target).unwrap(),
            queries
                .history(&request_principal, &scope, &target)
                .unwrap(),
        )
    };
    assert_eq!(
        serde_json::to_value(&record).unwrap(),
        serde_json::to_value(&original_record).unwrap()
    );
    assert_eq!(record.payload, original_record.payload);
    assert!(audits.is_empty());
    request_principal.release(&access.lock().unwrap()).unwrap();
    store.close().unwrap();

    // Shape/correlation checks over actual local reads are representation proof.
    // They do not construct NativeOutput or discharge stock's missing authority
    // witness, preparation graph and current result disclosure responsibilities.
    let read_wire = json!({
        "schemaVersion":3, "commandId":read["commandId"], "requestId":read["requestId"],
        "resolvedScope":scope, "status":"read", "replayed":false,
        "data":{"records":[{"target":selected_target,"revision":record.revision,
            "lifecycle":record.lifecycle,"payload":record.payload}],
            "nextCursor":null,"sourceStatus":"current"}
    });
    let history_wire = json!({
        "schemaVersion":3, "commandId":history["commandId"], "requestId":history["requestId"],
        "resolvedScope":scope, "status":"read", "replayed":false,
        "data":{"entries":[],"nextCursor":null,"completeness":"atlas-owned-audit"}
    });
    let validation = wire::StockValidation::new().unwrap();
    for (request, result) in [(read, read_wire), (history, history_wire)] {
        output_validator.validate(&result).unwrap();
        let request = wire::StockRequest::parse(&validation, request).unwrap();
        let response =
            wire::StockResponse::parse(&validation, &request, result.clone(), &[]).unwrap();
        assert_eq!(response.raw(), &result);
        assert_eq!(response.kind(), &wire::ResponseKind::Read);
    }
}
