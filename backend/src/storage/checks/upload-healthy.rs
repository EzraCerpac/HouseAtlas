//! Proposed fresh schema-5 upload composition. This binary uses the actual
//! AT11 principal/fence, AT12 vault/stages, AT51 native stock schema and AT30
//! semantics. The graph fixture is exact to this public synthetic snapshot;
//! it does not qualify general production graph authority.
use houseatlas_at07_checkpoint::{
    access as a,
    domain::{self as d, native_semantics::NativeSemantics, stock},
    jobs as j,
    media::{self as m, AssetVault, Cancellation, WorkBudget},
    storage as s,
};
use m::{
    native::{NativeMediaRuntime, NativeReadAuthority, RetainedPrincipal},
    staged_upload::{NativeUploadStages, UploadAdmission},
    types::{AssetPurpose, ContentType, LicenseStatus, PreviewPolicy, SourceLicense, sha256},
};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    fs,
    marker::PhantomData,
    path::PathBuf,
    rc::Rc,
    sync::{Arc, Mutex},
    time::Duration,
};

type Check = Result<(), Box<dyn std::error::Error>>;
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default())
        .expect("synthetic positive budget")
}

// Successful ordinary originals only. Wide PNGs are valid downloadable
// originals; no oversized preview request or stopped rejection is exercised.
fn original_example(
    mode: &str,
) -> Result<(Vec<u8>, ContentType, PreviewPolicy), Box<dyn std::error::Error>> {
    let (width, policy) = match mode {
        "text" => {
            return Ok((
                b"Fresh synthetic evidence; no household content.\n".to_vec(),
                ContentType::Text,
                PreviewPolicy::DownloadOnly,
            ));
        }
        "rendered-png" => (2, PreviewPolicy::SafeRendered),
        "download-only-png" => (20_000, PreviewPolicy::DownloadOnly),
        _ => return Err("Expected text, rendered-png or download-only-png".into()),
    };
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        let pixels = [40, 80, 120, 255].repeat(width as usize * 2);
        writer.write_image_data(&pixels)?;
    }
    Ok((bytes, ContentType::Png, policy))
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
fn guard(record_type: &str, record: &str) -> Value {
    json!({"target":{"authority":"atlas","recordType":record_type,
        "recordId":record},"revision":{"kind":"atlas","value":1}})
}

#[derive(Clone)]
struct ServerIds(Rc<Cell<u32>>);

// Independent original Media object and commit, kept before any image exists.
// It qualifies this one original render only. The configured Jobs lane is empty;
// these ports cannot qualify any job, grant or resumed invocation.
struct OriginalMediaEvidence<'a> {
    stage: &'a m::staged_upload::StagedAssetPlan,
    commit: &'a s::StockAtlasCommit,
    policy_checks: Cell<usize>,
}
impl s::QueueDiscovery for OriginalMediaEvidence<'_> {
    fn authorize_discovery(&self, _: &j::QueueRegistration) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in upload fixture",
        ))
    }
    fn validate_retained_enqueue(
        &self,
        _: &stock::ValidatedRequest,
        _: &j::EnqueueRequest,
        _: &j::CanonicalScope,
        _: &j::QueueConfig,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in upload fixture",
        ))
    }
}
impl s::QueueRecoveryEvidence for OriginalMediaEvidence<'_> {
    fn validate_attempt(
        &self,
        _: &j::QueueConfig,
        _: s::QueueRecoveryAttempt<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No Jobs owner in upload fixture",
        ))
    }
    fn validate_media_policy(&self, frame: s::MediaPolicyRecoveryFrame<'_>) -> s::Result<()> {
        let principal = self.stage.original_principal().principal();
        let expected = serde_json::to_value(self.stage.payload())?;
        let matches = match frame {
            s::MediaPolicyRecoveryFrame::Asset(asset) => {
                asset.record_type == s::RecordType::Asset
                    && asset.record_id == self.stage.asset_id()
                    && asset.workspace_id == principal.scope().workspace_id.as_str()
                    && asset.home_id == principal.scope().home_id.as_str()
                    && [
                        "owner",
                        "purpose",
                        "storageKey",
                        "sha256",
                        "byteSize",
                        "contentType",
                        "previewPolicy",
                    ]
                    .iter()
                    .all(|field| asset.payload[field] == expected[field])
            }
            s::MediaPolicyRecoveryFrame::Upload(upload) => {
                let group = self.commit.groups.first().ok_or_else(|| {
                    s::Error::new("owner-unavailable", "Original native upload commit missing")
                })?;
                let native = group.native_results.first().ok_or_else(|| {
                    s::Error::new("owner-unavailable", "Original native upload result missing")
                })?;
                upload.binding_digest() == self.stage.binding_digest()
                    && upload.asset_id() == self.stage.asset_id()
                    && upload.actor_id() == principal.actor_id().as_str()
                    && upload.scope().workspace_id == principal.scope().workspace_id.as_str()
                    && upload.scope().home_id == principal.scope().home_id.as_str()
                    && upload.asset_request() == self.stage.request().raw()
                    && upload.staged() == self.stage.staged()
                    && upload.asset_payload() == &expected
                    && upload.root_operation_id() == self.commit.operation_id
                    && upload.group_ordinal() == 0
                    && upload.group_operation_id() == group.operation_id
                    && upload.asset_audit_id() == native.audit.audit_id
            }
        };
        if self.stage.payload().preview_policy != PreviewPolicy::SafeRendered || !matches {
            return Err(s::Error::new(
                "owner-unavailable",
                "Original Media qualification missing",
            ));
        }
        self.policy_checks.set(self.policy_checks.get() + 1);
        Ok(())
    }
}
impl s::Runtime for ServerIds {
    fn now(&self) -> s::Result<String> {
        Ok("2026-10-07T12:00:00Z".into())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.0.get() + 1;
        self.0.set(next);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "Measured media runtime required",
        ))
    }
}
struct MeasuredRuntime<R> {
    native: R,
    proof_calls: Rc<Cell<usize>>,
}

// Used only by the separately selected isolated record-read regression. This
// narrows a synthetic query's capability; it creates no grant or principal.
struct ManifestOnlyQuery<'a> {
    native: &'a NativeReadAuthority,
    target: &'a s::RecordRef,
    granted_manifests: Cell<usize>,
    denied_records: Cell<usize>,
}
impl s::Authorization for ManifestOnlyQuery<'_> {
    type Principal = RetainedPrincipal;
    fn authorize(
        &self,
        principal: &RetainedPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if request.capability == s::Capability::Read {
            assert_eq!(request.targets, std::slice::from_ref(self.target));
            self.denied_records.set(self.denied_records.get() + 1);
            return Err(s::Error::new(
                "forbidden",
                "Synthetic record read unavailable",
            ));
        }
        let manifest = request.capability == s::Capability::ReadAssetManifest;
        let actor = s::Authorization::authorize(self.native, principal, request)?;
        if manifest {
            self.granted_manifests.set(self.granted_manifests.get() + 1);
        }
        Ok(actor)
    }
}
impl<R: s::Runtime> s::Runtime for MeasuredRuntime<R> {
    fn now(&self) -> s::Result<String> {
        self.native.now()
    }
    fn new_id(&self) -> s::Result<String> {
        self.native.new_id()
    }
    fn verify_available_asset(&self, record: &s::Record) -> s::Result<s::AssetProof> {
        let proof = self.native.verify_available_asset(record)?;
        self.proof_calls.set(self.proof_calls.get() + 1);
        Ok(proof)
    }
}

// Fixture graph is the exact one batch: existing evidence 100, server-issued
// asset, related new evidence and final location replacement. Its source grant
// comes only from the in-memory synthetic registration, with no provider access.
#[derive(Clone, Debug)]
struct FixtureGraph {
    root: Value,
    asset_id: String,
    evidence_id: String,
    place_id: String,
    source_ref: Value,
}
struct FixturePreparer {
    graph: FixtureGraph,
}
impl<'p> stock::StockPreparerPort<a::Principal, &'p a::Principal> for FixturePreparer {
    type Graph = FixtureGraph;
    fn resolve(
        &mut self,
        principal: &a::Principal,
        witness: &&'p a::Principal,
        request: &stock::ValidatedRequest,
    ) -> stock::StockResult<Self::Graph> {
        if !std::ptr::eq(principal, *witness)
            || request.raw() != &self.graph.root
            || request.children().len() != 3
            || request.children()[0].raw()["target"]["recordId"] != self.graph.asset_id
            || request.children()[1].raw()["target"]["recordId"] != self.graph.evidence_id
            || request.children()[2].raw()["target"]["recordId"] != self.graph.place_id
        {
            return Err(stock::StockError::AuthorityChanged);
        }
        Ok(self.graph.clone())
    }
}
struct FixtureAuthority<'g, 'tx, 'p> {
    guard: &'g a::TransactionAuthorization<'tx>,
    original: &'p a::Principal,
    graph: FixtureGraph,
}
impl FixtureAuthority<'_, '_, '_> {
    fn current(&self, principal: &a::Principal, raw: &Value) -> stock::StockResult<()> {
        if !std::ptr::eq(principal, self.original) || raw != &self.graph.root {
            return Err(stock::StockError::AuthorityChanged);
        }
        self.guard
            .revalidate()
            .map_err(|_| stock::StockError::AuthorityChanged)?;
        self.guard
            .authorize(principal.scope(), a::Capability::Mutate)
            .map_err(|_| stock::StockError::CapabilityDenied)?;
        Ok(())
    }
    fn current_storage(&self, principal: &a::Principal, raw: &Value) -> s::Result<()> {
        self.current(principal, raw)
            .map_err(|_| s::Error::new("forbidden", "Original upload graph changed"))
    }
}
impl<'p> stock::StockAuthorityPort<a::Principal> for FixtureAuthority<'_, '_, 'p> {
    type Witness = &'p a::Principal;
    type Graph = FixtureGraph;
    fn capture(
        &self,
        principal: &a::Principal,
        request: &stock::ValidatedRequest,
    ) -> stock::StockResult<Self::Witness> {
        self.current(principal, request.raw())?;
        Ok(self.original)
    }
    fn authorize_graph(
        &self,
        principal: &a::Principal,
        witness: &Self::Witness,
        request: &stock::ValidatedRequest,
        graph: &Self::Graph,
    ) -> stock::StockResult<()> {
        self.current(principal, request.raw())?;
        if !std::ptr::eq(*witness, self.original)
            || graph.root != self.graph.root
            || graph.asset_id != self.graph.asset_id
            || graph.evidence_id != self.graph.evidence_id
            || graph.place_id != self.graph.place_id
            || graph.source_ref != self.graph.source_ref
        {
            return Err(stock::StockError::AuthorityChanged);
        }
        Ok(())
    }
    fn revalidate(
        &self,
        principal: &a::Principal,
        witness: &Self::Witness,
        request: &stock::ValidatedRequest,
    ) -> stock::StockResult<()> {
        if !std::ptr::eq(*witness, self.original) {
            return Err(stock::StockError::AuthorityChanged);
        }
        self.current(principal, request.raw())
    }
    fn authorize_result(
        &self,
        principal: &a::Principal,
        prepared: &stock::PreparedRequest<Self::Witness, Self::Graph>,
        request: &stock::ValidatedRequest,
        result: &Value,
    ) -> stock::StockResult<()> {
        self.revalidate(principal, prepared.witness(), prepared.request())?;
        let requested = request.raw()["requestId"].as_str();
        if requested != result["requestId"].as_str() {
            return Err(stock::StockError::CorrelationMismatch);
        }
        Ok(())
    }
    fn disclose(
        &self,
        principal: &a::Principal,
        prepared: &stock::PreparedRequest<Self::Witness, Self::Graph>,
        _request: &stock::ValidatedRequest,
        target: &Value,
        row: &Value,
        _purpose: stock::DisclosurePurpose,
    ) -> stock::StockResult<()> {
        self.revalidate(principal, prepared.witness(), prepared.request())?;
        let record = target["recordId"].as_str();
        if !matches!(record, Some(id) if id == self.graph.asset_id.as_str()
            || id == self.graph.evidence_id.as_str() || id == self.graph.place_id.as_str())
            || row["target"]["recordId"] != target["recordId"]
        {
            return Err(stock::StockError::CapabilityDenied);
        }
        Ok(())
    }
}
impl<'p> stock::GraphAuthorization<&'p a::Principal, FixtureGraph>
    for FixtureAuthority<'_, '_, 'p>
{
    fn revalidate_prepared(
        &self,
        principal: &a::Principal,
        captured: &stock::CapturedAccess<'_>,
        prepared: &stock::PreparedRequest<&'p a::Principal, FixtureGraph>,
    ) -> s::Result<()> {
        self.current_storage(principal, prepared.request().raw())?;
        if !std::ptr::eq(captured.principal(), self.original)
            || !std::ptr::eq(*prepared.witness(), self.original)
            || prepared.graph().root != self.graph.root
            || captured.source_grants().len() != 1
            || captured.partition_grants().len() != 1
            || serde_json::to_value(captured.source_grants()[0].reference())?
                != self.graph.source_ref
        {
            return Err(s::Error::new("forbidden", "Original capture differs"));
        }
        Ok(())
    }
    fn authorize_native(
        &self,
        principal: &a::Principal,
        prepared: &stock::PreparedRequest<&'p a::Principal, FixtureGraph>,
        request: &s::AuthorizationRequest<'_>,
    ) -> s::Result<()> {
        self.current_storage(principal, prepared.request().raw())?;
        let native = request
            .mutation
            .ok_or_else(|| s::Error::new("forbidden", "Fixture authorizes one mutation only"))?;
        let prior = s::RecordRef {
            record_type: s::RecordType::Evidence,
            record_id: id(100),
        };
        let asset = s::RecordRef {
            record_type: s::RecordType::Asset,
            record_id: self.graph.asset_id.clone(),
        };
        let new_evidence = s::RecordRef {
            record_type: s::RecordType::Evidence,
            record_id: self.graph.evidence_id.clone(),
        };
        let place = s::RecordRef {
            record_type: s::RecordType::Identity,
            record_id: self.graph.place_id.clone(),
        };
        if request.capability != s::Capability::Mutate
            || native.replay.is_some()
            || native.entries.len() != 3
            || request.scope.workspace_id != id(1)
            || request.scope.home_id != id(2)
            || native.entries[0].target != asset
            || native.entries[1].target != new_evidence
            || native.entries[2].target != place
            || native.entries[0].command.operation != s::Operation::Create
            || native.entries[1].command.operation != s::Operation::Create
            || native.entries[2].command.operation != s::Operation::Replace
            || native.entries[2]
                .command
                .value
                .as_ref()
                .is_none_or(|value| {
                    value.payload["kind"] != "location"
                        || value.payload["evidenceIds"] != json!([id(100), self.graph.evidence_id])
                })
            || ![prior, asset, new_evidence, place]
                .iter()
                .all(|reference| native.closure.record_refs.contains(reference))
            || !native.closure.missing_record_refs.is_empty()
            || !native.closure.source_refs.contains(&self.graph.source_ref)
            || native.closure.source_partitions.len() != 1
            || native.candidate.as_ref().is_some_and(|candidate| {
                !candidate.records.iter().any(|record| {
                    record.record_type == s::RecordType::Identity
                        && record.record_id == self.graph.place_id
                        && record.revision == 2
                        && record.payload["kind"] == "location"
                        && record.payload["evidenceIds"] == json!([id(100), self.graph.evidence_id])
                })
            })
        {
            return Err(s::Error::new("forbidden", "Native upload graph differs"));
        }
        Ok(())
    }
    fn authorize_stock_mutation(
        &self,
        principal: &a::Principal,
        prepared: &stock::PreparedRequest<&'p a::Principal, FixtureGraph>,
        frame: &s::StockMutationFrame<'_>,
    ) -> s::Result<()> {
        self.current_storage(principal, prepared.request().raw())?;
        if frame.plan.original_request() != &self.graph.root
            || frame.plan.groups().len() != 3
            || frame.native.entries.len() != 3
            || frame.native.replay.is_some()
            || !frame.closure.source_refs.contains(&self.graph.source_ref)
            || frame.closure.source_partitions.len() != 1
            || frame.plan.groups()[0].original_request()
                != &self.graph.root["payload"]["commands"][0]
            || frame.plan.groups()[1].original_request()
                != &self.graph.root["payload"]["commands"][1]
            || frame.plan.groups()[2].original_request()
                != &self.graph.root["payload"]["commands"][2]
            || frame.commit.is_some_and(|commit| {
                commit.original_request != self.graph.root
                    || commit.groups.len() != 3
                    || commit.replayed
                    || commit.groups[2]
                        .native_results
                        .first()
                        .is_none_or(|result| {
                            result.record.record_id != self.graph.place_id
                                || result.record.revision != 2
                                || result.record.payload["evidenceIds"]
                                    != json!([id(100), self.graph.evidence_id])
                        })
            })
        {
            return Err(s::Error::new("forbidden", "Stock upload graph differs"));
        }
        Ok(())
    }
    fn authorize_stock_history(
        &self,
        _: &a::Principal,
        _: &stock::PreparedRequest<&'p a::Principal, FixtureGraph>,
        _: &s::StockHistoryFrame<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "forbidden",
            "No history release in upload fixture",
        ))
    }
}

// A host principal can carry its own opaque state while retaining the exact
// AT11 upload handle. Storage's staged seam asks for this narrow projection;
// the borrowed native authorizer still checks the original captured grants
// and transaction fence on every native and stock callback.
struct HostPrincipal<'p> {
    original: &'p RetainedPrincipal,
    captured_principal: &'p a::Principal,
}
impl s::StagedUploadPrincipal for HostPrincipal<'_> {
    fn original_upload_principal(&self) -> &a::Principal {
        self.original.principal()
    }
}
impl HostPrincipal<'_> {
    fn checked(&self) -> s::Result<&a::Principal> {
        let original = self.original.principal();
        if !std::ptr::eq(original, self.captured_principal) {
            return Err(s::Error::new(
                "forbidden",
                "Host lost original upload handle",
            ));
        }
        Ok(original)
    }
}
struct HostAuthorization<'p, T> {
    native: T,
    original: PhantomData<&'p RetainedPrincipal>,
}
impl<'p, T: s::StockAuthorization<Principal = a::Principal>> s::Authorization
    for HostAuthorization<'p, T>
{
    type Principal = HostPrincipal<'p>;
    fn authorize(
        &self,
        principal: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        s::Authorization::authorize(&self.native, principal.checked()?, request)
    }
}
impl<'p, T: s::StockAuthorization<Principal = a::Principal>> s::StockAuthorization
    for HostAuthorization<'p, T>
{
    fn authorize_stock_mutation(
        &self,
        principal: &Self::Principal,
        frame: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        s::StockAuthorization::authorize_stock_mutation(&self.native, principal.checked()?, frame)
    }
    fn authorize_stock_history(
        &self,
        principal: &Self::Principal,
        frame: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        s::StockAuthorization::authorize_stock_history(&self.native, principal.checked()?, frame)
    }
}

fn main() -> Check {
    let isolated_record_read = match std::env::args().nth(3).as_deref() {
        None => false,
        Some("isolated-record-read-regression") => true,
        Some(_) => return Err("Unknown isolated regression selection".into()),
    };
    let repository = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let output = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh output directory required")?,
    );
    fs::create_dir(&output)?;
    let output = fs::canonicalize(output)?;
    let database = output.join("upload.sqlite");
    let vault = Arc::new(AssetVault::open(&output.join("media"))?);
    let server = ServerIds(Rc::new(Cell::new(200_000)));
    let stages = NativeUploadStages::open(&vault, &server)?;
    let proof_calls = Rc::new(Cell::new(0));
    let storage_scope = s::Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let access_scope: a::Scope = serde_json::from_value(serde_json::to_value(&storage_scope)?)?;
    let initial: s::Snapshot = serde_json::from_slice(&fs::read(
        repository.join("packages/contracts/fixtures/plan-free.snapshot.json"),
    )?)?;
    let initial_json = serde_json::to_value(&initial)?;
    let source_registration: a::SourceRegistration = serde_json::from_value(
        initial_json["sources"]
            .as_array()
            .ok_or("Published sources missing")?
            .iter()
            .find(|source| source["sourceInstanceId"] == id(10) && source["homeId"] == id(2))
            .ok_or("Synthetic homebox source missing")?
            .clone(),
    )?;
    let source_key = &initial_json["records"]
        .as_array()
        .ok_or("Published records missing")?
        .iter()
        .find(|record| record["recordType"] == "binding" && record["recordId"] == id(300))
        .ok_or("Synthetic place binding missing")?["payload"]["source"];
    let source_ref = json!({"workspaceId":id(1),"homeId":id(2),"key":source_key});
    let source_grant_ref: a::SourceRef = serde_json::from_value(source_ref.clone())?;
    let config = a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])?
        .with_clock(|| 1_800_000_000_000);
    let mut access = a::AccessBoundary::in_memory(config)?;
    access.put_source(&source_registration, Some(true))?;
    let canonical = |n| a::CanonicalId::parse(id(n));
    let password = "Synthetic-upload-password-only!";
    access.provision_user(
        &canonical(50)?,
        &canonical(51)?,
        "synthetic-uploader",
        &a::hash_password(password)?,
        None,
    )?;
    access.set_membership(&canonical(50)?, &access_scope, a::Role::Editor, true)?;
    let session = access.login(
        &request(None, None),
        &serde_json::to_vec(&json!({"username":"synthetic-uploader","password":password}))?,
        "synthetic-loopback",
    )?;
    let cookie = session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Session cookie missing")?
        .to_owned();
    let original = RetainedPrincipal::new(access.authorize(
        &request(Some(&cookie), Some(session.info().csrf_token())),
        &access_scope,
        a::Action::Mutate,
    )?);
    let captured = stock::CapturedAccess::capture(
        &access,
        original.principal(),
        std::slice::from_ref(&source_grant_ref),
        &[],
    )?;
    assert_eq!(captured.source_grants().len(), 1);
    assert_eq!(captured.partition_grants().len(), 1);
    let schemas = stock::NativeStockContract::new()?;
    let mut evidence_payload = initial_json["records"]
        .as_array()
        .ok_or("Published records missing")?
        .iter()
        .find(|record| record["recordType"] == "evidence" && record["recordId"] == id(100))
        .ok_or("Synthetic evidence 100 missing")?["payload"]
        .clone();
    let mut place_payload = initial_json["records"]
        .as_array()
        .ok_or("Published records missing")?
        .iter()
        .find(|record| record["recordType"] == "identity" && record["recordId"] == id(200))
        .ok_or("Synthetic place identity 200 missing")?["payload"]
        .clone();
    assert_eq!(place_payload["kind"], "location");
    let example = std::env::args().nth(2).unwrap_or_else(|| "text".into());
    let (original_bytes, content_type, preview_policy) = original_example(&example)?;
    let bytes = original_bytes.as_slice();
    let license = SourceLicense {
        status: LicenseStatus::Unknown,
        reference: None,
    };
    let mut saved = None;

    // One actual AT11 transaction fence spans stage, immutable plan binding,
    // stock preparation, native+stock commit and final output authorization.
    access.with_mutation_authorization(original.principal(), |fence| -> Check {
        assert!(std::ptr::eq(fence.principal(), original.principal()));
        let mut body = bytes;
        let receipt = stages.stage_original(
            fence,
            &original,
            UploadAdmission {
                request_id: id(210_000),
                purpose: AssetPurpose::EvidenceOriginal,
                content_type,
                filename: format!("synthetic-evidence.{}", content_type.extension()),
                source_license: license.clone(),
                evidence_ids: vec![id(100)],
            },
            &mut body,
            &budget(),
        )?;
        assert_eq!(receipt.asset_id, id(200_001));
        assert_eq!(receipt.staged.sha256, sha256(bytes));
        assert_eq!(receipt.staged.byte_size, bytes.len() as u64);
        let asset = json!({
            "schemaVersion":3,"commandId":"atlas.asset.create","requestId":receipt.request_id,
            "context":storage_scope,
            "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
            "payload":{"staged":receipt.staged,"purpose":"evidence-original",
                "sourceLicense":license,"evidenceIds":[id(100)]},
            "idempotencyKey":id(210_001),"reason":"Fresh healthy evidence upload",
            "preconditions":{"target":null,"guards":[guard("evidence",&id(100))]},
            "approvalReceiptId":null
        });
        let validated_asset = stock::ValidatedRequest::parse(&schemas, asset.clone())?;
        let staged = stages.bind_asset_plan(
            fence,
            &original,
            &receipt.staged.upload_token,
            &validated_asset,
            &budget(),
        )?;
        assert_eq!(staged.request().raw(), &asset);
        assert_eq!(
            staged.request().intent_digest(),
            validated_asset.intent_digest()
        );
        assert_eq!(staged.asset_id(), receipt.asset_id);
        assert_eq!(staged.payload().preview_policy, preview_policy);
        assert!(std::ptr::eq(
            staged.original_principal().principal(),
            original.principal()
        ));
        evidence_payload["statement"] =
            json!("Synthetic evidence linked to the uploaded original.");
        evidence_payload["references"] = json!([{"kind":"atlas-asset","assetId":receipt.asset_id}]);
        let evidence = json!({
            "schemaVersion":3,"commandId":"atlas.evidence.create","requestId":id(210_020),
            "context":storage_scope,
            "target":{"authority":"atlas","recordType":"evidence","recordId":id(200_020)},
            "payload":evidence_payload,"idempotencyKey":id(210_021),
            "reason":"Link synthetic upload to evidence",
            "preconditions":{"target":null,"guards":[guard("evidence",&id(100))]},
            "approvalReceiptId":null
        });
        place_payload["evidenceIds"] = json!([id(100), id(200_020)]);
        let place = json!({
            "schemaVersion":3,"commandId":"atlas.identity.replace","requestId":id(210_040),
            "context":storage_scope,
            "target":{"authority":"atlas","recordType":"identity","recordId":id(200)},
            "payload":place_payload,"idempotencyKey":id(210_041),
            "reason":"Attach synthetic upload evidence to existing place",
            "preconditions":{"target":{"kind":"atlas","value":1},
                "guards":[guard("evidence",&id(100))]},
            "approvalReceiptId":null
        });
        let root = json!({
            "schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(210_030),
            "context":storage_scope,
            "target":{"authority":"atlas","kind":"batch","batchId":id(210_031)},
            "payload":{"commands":[asset,evidence,place]},
            "idempotencyKey":id(210_032),"reason":"Commit one synthetic original and evidence",
            "preconditions":{"target":null,"guards":[guard("evidence",&id(100))]},
            "approvalReceiptId":null
        });
        let graph = FixtureGraph {
            root: root.clone(),
            asset_id: receipt.asset_id.clone(),
            evidence_id: id(200_020),
            place_id: id(200),
            source_ref: source_ref.clone(),
        };
        let fixture = FixtureAuthority {
            guard: fence,
            original: original.principal(),
            graph: graph.clone(),
        };
        let mut preparer = FixturePreparer { graph };
        let prepared = stock::prepare(
            original.principal(),
            root.clone(),
            &schemas,
            &fixture,
            &mut preparer,
        )?;
        let home = d::AuthorizedHome {
            home: d::HomeSummary {
                scope: serde_json::from_value(serde_json::to_value(&storage_scope)?)?,
                label: "Synthetic home".into(),
            },
            other_homes: vec![],
            can_edit_homebox: true,
        };
        let authority = stock::NativeStockAuthority::new(
            stock::AccessContext::Mutation(fence),
            &captured,
            &prepared,
            &fixture,
            &home,
        )?;
        let runtime = MeasuredRuntime {
            native: NativeMediaRuntime {
                vault: Arc::clone(&vault),
                server: server.clone(),
            },
            proof_calls: Rc::clone(&proof_calls),
        };
        let mut store = s::AtlasStore::open(
            &database,
            s::NativeContract::new(NativeSemantics::native()),
            authority,
            runtime,
            s::StoreOptions {
                allow_synthetic_bootstrap: true,
                ..s::StoreOptions::default()
            },
        )?;
        assert_eq!(store.database_version(), 5);
        store.initialize_synthetic(&initial)?;
        let host = HostPrincipal {
            original: &original,
            captured_principal: captured.principal(),
        };
        let host_authority = HostAuthorization {
            native: stock::NativeStockAuthority::new(
                stock::AccessContext::Mutation(fence),
                &captured,
                &prepared,
                &fixture,
                &home,
            )?,
            original: PhantomData,
        };
        let commit = store.execute_staged_stock_json_with_authorization(
            &host_authority,
            &host,
            &schemas,
            &root,
            &staged,
        )?;
        assert!(!commit.replayed);
        assert_eq!(
            commit.groups[0].native_results[0].record.payload["previewPolicy"],
            serde_json::to_value(preview_policy)?
        );
        assert_eq!(commit.original_request, root);
        assert_eq!(commit.request_digest, prepared.request().intent_digest());
        assert_eq!(commit.groups.len(), 3);
        assert_eq!(commit.children.len(), 3);
        assert_eq!(commit.groups[0].child_index, Some(0));
        assert_eq!(commit.groups[0].original_request, asset);
        assert_eq!(commit.groups[1].child_index, Some(1));
        assert_eq!(commit.groups[1].original_request, evidence);
        assert_eq!(commit.groups[2].child_index, Some(2));
        assert_eq!(commit.groups[2].original_request, place);
        assert_eq!(
            commit.wire["data"]["records"]
                .as_array()
                .ok_or("Records missing")?
                .len(),
            3
        );
        assert_eq!(
            commit.wire["data"]["auditIds"]
                .as_array()
                .ok_or("Audits missing")?
                .len(),
            3
        );
        assert_eq!(
            commit.children[2]["data"]["records"][0]["target"]["recordId"],
            id(200)
        );
        assert_eq!(commit.children[2]["data"]["records"][0]["revision"], 2);
        assert_eq!(commit.groups[2].native_results[0].record.record_id, id(200));
        assert_eq!(commit.groups[2].native_results[0].record.revision, 2);
        assert_eq!(
            commit.groups[2].native_results[0].record.payload["evidenceIds"],
            json!([id(100), id(200_020)])
        );
        stock::validate_result(
            original.principal(),
            &prepared,
            &commit.owner_result(),
            &schemas,
            &fixture,
        )?;
        fence.revalidate()?;
        assert!(proof_calls.get() >= 1);
        store.close()?;
        saved = Some((
            receipt,
            staged.binding_digest().to_owned(),
            commit,
            validated_asset.intent_digest().to_owned(),
            staged,
        ));
        Ok(())
    })?;
    let (receipt, binding_digest, commit, asset_digest, original_stage) =
        saved.ok_or("Committed upload missing")?;

    // Observe committed artifacts only after the writer has closed. The one
    // immutable token row must point to the asset child, its audit and root.
    let sql = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let count: i64 = sql.query_row("SELECT COUNT(*) FROM upload_consumptions", [], |r| r.get(0))?;
    assert_eq!(count, 1);
    let consumed: (String,String,String,String,String,String,String,i64,String,String) = sql.query_row(
        "SELECT token_hash,workspace_id,home_id,actor_id,request_id,asset_id,binding_digest,group_ordinal,group_operation_id,asset_audit_id FROM upload_consumptions WHERE root_operation_id=?1",
        [&commit.operation_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?)))?;
    assert_eq!(consumed.0, sha256(receipt.staged.upload_token.as_bytes()));
    assert_eq!(
        (consumed.1.as_str(), consumed.2.as_str()),
        (id(1).as_str(), id(2).as_str())
    );
    assert_eq!(consumed.3, original.principal().actor_id().as_str());
    assert_eq!(consumed.4, receipt.request_id);
    assert_eq!(consumed.5, receipt.asset_id);
    assert_eq!(consumed.6, binding_digest);
    assert_eq!(consumed.7, 0);
    assert_eq!(consumed.8, commit.groups[0].operation_id);
    assert_eq!(
        consumed.9,
        commit.groups[0].native_results[0].audit.audit_id
    );
    let (binding_json, root_json, intent_digest): (String, String, String) = sql.query_row(
        "SELECT binding_json,root_request_json,intent_digest FROM upload_consumptions WHERE root_operation_id=?1",
        [&commit.operation_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let binding: Value = serde_json::from_str(&binding_json)?;
    assert_eq!(
        binding["originalRequest"],
        commit.groups[0].original_request
    );
    assert_eq!(binding["stage"]["staged"]["sha256"], sha256(bytes));
    assert_eq!(
        binding["stage"]["payload"]["previewPolicy"],
        serde_json::to_value(preview_policy)?
    );
    assert_eq!(
        serde_json::from_str::<Value>(&root_json)?,
        commit.original_request
    );
    assert_eq!(intent_digest, asset_digest);
    let root_count: i64 = sql.query_row(
        "SELECT COUNT(*) FROM stock_operations WHERE operation_id=?1",
        [&commit.operation_id],
        |r| r.get(0),
    )?;
    assert_eq!(root_count, 1);
    let groups: i64 = sql.query_row(
        "SELECT COUNT(*) FROM stock_groups WHERE root_operation_id=?1",
        [&commit.operation_id],
        |r| r.get(0),
    )?;
    assert_eq!(groups, 3);
    let stock_links: i64 = sql.query_row(
        "SELECT COUNT(*) FROM stock_audit_links WHERE root_operation_id=?1",
        [&commit.operation_id],
        |r| r.get(0),
    )?;
    assert_eq!(stock_links, 3);
    let stock_keys: i64 = sql.query_row(
        "SELECT COUNT(*) FROM stock_keys WHERE root_operation_id=?1",
        [&commit.operation_id],
        |r| r.get(0),
    )?;
    assert_eq!(stock_keys, 4);
    let ordinary_receipts: i64 =
        sql.query_row("SELECT COUNT(*) FROM receipts", [], |r| r.get(0))?;
    let batch_receipts: i64 =
        sql.query_row("SELECT COUNT(*) FROM batch_receipts", [], |r| r.get(0))?;
    assert_eq!((ordinary_receipts, batch_receipts), (3, 1));
    let new_records: i64 = sql.query_row(
        "SELECT COUNT(*) FROM records WHERE workspace_id=?1 AND record_id IN (?2,?3,?4)",
        params![id(1), receipt.asset_id, id(200_020), id(200)],
        |r| r.get(0),
    )?;
    let new_audits: i64 = sql.query_row(
        "SELECT COUNT(*) FROM audits WHERE workspace_id=?1 AND record_id IN (?2,?3,?4)",
        params![id(1), receipt.asset_id, id(200_020), id(200)],
        |r| r.get(0),
    )?;
    assert_eq!((new_records, new_audits), (3, 3));
    let manifests: i64 = sql.query_row(
        "SELECT COUNT(*) FROM asset_manifests WHERE workspace_id=?1 AND record_id=?2",
        params![id(1), receipt.asset_id],
        |r| r.get(0),
    )?;
    assert_eq!(manifests, 1);
    sql.close().map_err(|(_, error)| error)?;

    let access = Arc::new(Mutex::new(access));
    let reopened_vault = Arc::new(AssetVault::open(&output.join("media"))?);
    let read_proof_calls = Rc::new(Cell::new(0));
    let read_runtime = MeasuredRuntime {
        native: NativeMediaRuntime {
            vault: reopened_vault,
            server: server.clone(),
        },
        proof_calls: Rc::clone(&read_proof_calls),
    };
    let mut reader = s::AtlasStore::open(
        &database,
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(Arc::clone(&access)),
        read_runtime,
        s::StoreOptions::default(),
    )?;
    let asset_ref = s::RecordRef {
        record_type: s::RecordType::Asset,
        record_id: receipt.asset_id.clone(),
    };
    let evidence_ref = s::RecordRef {
        record_type: s::RecordType::Evidence,
        record_id: id(200_020),
    };
    let place_ref = s::RecordRef {
        record_type: s::RecordType::Identity,
        record_id: id(200),
    };
    let asset_record = reader.read_record(&original, &storage_scope, &asset_ref)?;
    let evidence_record = reader.read_record(&original, &storage_scope, &evidence_ref)?;
    let place_record = reader.read_record(&original, &storage_scope, &place_ref)?;
    assert_eq!(asset_record.revision, 1);
    assert_eq!(asset_record.payload["sha256"], sha256(bytes));
    assert_eq!(asset_record.payload["byteSize"], bytes.len() as u64);
    assert_eq!(asset_record.payload["availability"], "available");
    assert_eq!(
        asset_record.payload["previewPolicy"],
        serde_json::to_value(preview_policy)?
    );
    assert_eq!(
        evidence_record.payload["references"],
        json!([{"kind":"atlas-asset","assetId":receipt.asset_id}])
    );
    assert_eq!(place_record.revision, 2);
    assert_eq!(place_record.payload["kind"], "location");
    assert_eq!(
        place_record.payload["evidenceIds"],
        json!([id(100), id(200_020)])
    );
    let queries = NativeReadAuthority(Arc::clone(&access));
    let consumed = reader
        .committed_upload_with_authorization(
            &queries,
            &original,
            &schemas,
            &storage_scope,
            &receipt.staged.upload_token,
        )?
        .ok_or("Committed consumption missing")?;
    assert_eq!(consumed.asset_id(), receipt.asset_id);
    assert_eq!(consumed.asset_payload(), &asset_record.payload);
    assert_eq!(consumed.staged(), &receipt.staged);
    assert_eq!(consumed.root_operation_id(), commit.operation_id);
    assert_eq!(
        consumed.asset_audit_id(),
        commit.groups[0].native_results[0].audit.audit_id
    );
    let prepared = m::vault::PreparedOriginal {
        purpose: m::types::AssetPurpose::EvidenceOriginal,
        storage_key: asset_record.payload["storageKey"]
            .as_str()
            .ok_or("Original storage key")?
            .into(),
        identity: m::types::BlobIdentity {
            sha256: sha256(bytes),
            byte_size: bytes.len() as u64,
        },
        content_type: m::types::ContentType::parse(&receipt.staged.content_type)?,
    };
    let existing = reader
        .resolve_original_asset_with_authorization(&queries, &original, &storage_scope, &prepared)?
        .ok_or("Existing original missing")?;
    assert_eq!(existing.asset_id(), receipt.asset_id);
    assert_eq!(existing.revision(), 1);
    assert_eq!(existing.record(), &asset_record);
    assert_eq!(
        existing.payload()["sourceLicense"],
        asset_record.payload["sourceLicense"]
    );
    assert_eq!(
        existing.payload()["evidenceIds"],
        asset_record.payload["evidenceIds"]
    );
    if isolated_record_read {
        let before = serde_json::to_value(reader.read_snapshot(&original, &storage_scope)?)?;
        let byte_checks = read_proof_calls.get();
        let manifest_only = ManifestOnlyQuery {
            native: &queries,
            target: &asset_ref,
            granted_manifests: Cell::new(0),
            denied_records: Cell::new(0),
        };
        match reader.resolve_original_asset_with_authorization(
            &manifest_only,
            &original,
            &storage_scope,
            &prepared,
        ) {
            Err(error) => assert_eq!(error.code, "forbidden"),
            Ok(_) => return Err("Manifest-only authority must not disclose a full record".into()),
        }
        assert_eq!(manifest_only.granted_manifests.get(), 2);
        assert_eq!(manifest_only.denied_records.get(), 1);
        assert_eq!(read_proof_calls.get(), byte_checks);
        assert_eq!(
            serde_json::to_value(reader.read_snapshot(&original, &storage_scope)?)?,
            before
        );
    }
    let manifest = reader.read_asset_manifest(&original, &storage_scope, &asset_ref)?;
    assert_eq!(manifest["sha256"], sha256(bytes));
    assert_eq!(manifest["byteSize"], bytes.len() as u64);
    assert_eq!(
        reader.history(&original, &storage_scope, &asset_ref)?.len(),
        1
    );
    assert_eq!(
        reader
            .history(&original, &storage_scope, &evidence_ref)?
            .len(),
        1
    );
    assert_eq!(
        reader.history(&original, &storage_scope, &place_ref)?.len(),
        1
    );
    let snapshot = reader.read_snapshot(&original, &storage_scope)?;
    assert!(
        snapshot
            .records
            .iter()
            .any(|row| row.record_id == receipt.asset_id)
    );
    assert!(
        snapshot
            .records
            .iter()
            .any(|row| row.record_id == id(200_020))
    );
    assert!(snapshot.records.iter().any(|row| row.record_id == id(200)
        && row.revision == 2
        && row.payload["evidenceIds"] == json!([id(100), id(200_020)])));
    let media_evidence = OriginalMediaEvidence {
        stage: &original_stage,
        commit: &commit,
        policy_checks: Cell::new(0),
    };
    let peers = s::RecoveryValidationPeers {
        stock: &schemas,
        queues: &[],
        discovery: &media_evidence,
        evidence: &media_evidence,
    };
    let mut check = || Ok(());
    let image_path = output.join("recovery.sqlite");
    let restored_path = output.join("restored.sqlite");
    let image = reader.backup_recovery_to_with_peers(&image_path, &peers, &mut check)?;
    let image_bytes = fs::read(&image_path)?;
    assert_eq!(
        reader.validate_recovery_image_with_peers(&image_path, &peers, &mut check)?,
        image
    );
    assert_eq!(fs::read(&image_path)?, image_bytes);
    reader.close()?;
    fs::copy(&image_path, &restored_path)?;
    let mut restored = s::AtlasStore::open_existing_recovery_image_with_peers(
        &restored_path,
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(Arc::clone(&access)),
        NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: server.clone(),
        },
        s::StoreOptions::default(),
        &image,
        &peers,
        &mut check,
    )?;
    assert_eq!(
        restored.read_record(&original, &storage_scope, &asset_ref)?,
        asset_record
    );
    let restored_consumed = restored
        .committed_upload_with_authorization(
            &queries,
            &original,
            &schemas,
            &storage_scope,
            &receipt.staged.upload_token,
        )?
        .ok_or("Restored consumption missing")?;
    assert_eq!(restored_consumed.asset_payload(), consumed.asset_payload());
    assert_eq!(
        restored_consumed.binding_digest(),
        consumed.binding_digest()
    );
    assert_eq!(restored_consumed.root_operation_id(), commit.operation_id);
    restored.close()?;
    assert_eq!(
        media_evidence.policy_checks.get() > 0,
        preview_policy == PreviewPolicy::SafeRendered
    );
    fs::write(
        output.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 5, "scope": storage_scope,
            "ordinaryCommittedUploadTransactions": 1,
            "originalExample": example, "contentType": content_type.as_str(),
            "boundPreviewPolicy": preview_policy,
            "principal": "same-genuine-access-handle-in-host-wrapper",
            "graphAuthority": "exact-synthetic-fixture-only",
            "commands": ["atlas.asset.create", "atlas.evidence.create", "atlas.identity.replace"],
            "stockGroups": 3, "stockKeys": 4, "stockAuditLinks": 3,
            "nativeCommandReceipts": 3, "nativeBatchReceipts": 1,
            "uploadConsumptionRows": 1, "availableAssetProofCalls": proof_calls.get(),
            "asset": asset_record, "evidence": evidence_record,
            "place": place_record, "manifest": manifest,
            "commit": commit,
            "reopen": "ordinary-original-authorized-reads-pass",
            "fullRecovery": "native-stock-upload-closure-read-only-image-strict-profile5-reopen-pass",
            "recoveryQueueScope": "independent-empty-registry-evidence-unavailable-no-job-callback",
            "mediaPolicyChecks": media_evidence.policy_checks.get(),
            "mediaPolicyEvidence": "independent-original-opaque-Media-stage-and-native-commit-only",
            "committedConsumptionLookup":"strict-native-stock-audit-links-pass",
            "existingOriginalResolution":{"assetId":existing.asset_id(),"revision":existing.revision(),"scope":existing.scope(),"provenance":"preserved","retainedBytes":"independently-verified"},
            "isolatedRecordReadRegression":isolated_record_read,
            "recordReadRegressionResult":if isolated_record_read { "manifest grants retained; exact-target record read refused; no record/byte access/snapshot change" } else { "unrun" },
            "heldControls":if isolated_record_read { "all other campaigns deferred-and-unrun; only separately selected isolated record-read case executed" } else { "deferred-and-unrun" }
        }))?,
    )?;
    println!(
        "healthy staged upload: actual AT11 retained principal, actual vault and native measured proof, one atomic native+stock receipt and upload consumption, linked evidence, ordinary authorized reopen"
    );
    Ok(())
}
