//! Opt-in, unexecuted pending exact-case review. Test-only storage peers below
//! qualify transaction behavior, not Access/security. The no-argument healthy
//! example and the outcome-reader HTTP path keep their original actual owners.
use super::*;
use houseatlas_backend::{access, domain::stock::NativeStockContract, storage as s};
use rusqlite::types::ValueRef;
use std::{
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Barrier, Condvar,
        atomic::{AtomicUsize, Ordering},
    },
    time::Instant,
};

const WAIT: Duration = Duration::from_secs(10);
const CHILD_BYTES: u64 = 64 * 1024;
type ProbeStore = s::AtlasStore<NativeContracts, Probe, ServerRuntime>;

struct Fixture {
    app: Router,
    host: Host,
    editor: Session,
    directory: PathBuf,
    scratch: tempfile::TempDir, // Last field: close handles before removing data.
}
impl Fixture {
    async fn new() -> Result<Self, Failure> {
        let scratch = tempfile::Builder::new()
            .prefix("houseatlas-offline06-case-")
            .tempdir_in("/tmp")?;
        let directory = scratch.path().canonicalize()?.join("fixture");
        let core = lifecycle::prepare(&directory, ORIGIN)?;
        let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
        let app = router(host.clone());
        let logins: Value =
            serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
        let editor = login(&app, &logins["editorLogin"]).await?;
        Ok(Self {
            app,
            host,
            editor,
            directory,
            scratch,
        })
    }
    fn database(&self) -> PathBuf {
        self.directory.join("atlas.sqlite")
    }
    fn context(&self) -> Result<Value, Failure> {
        let core = self.host.core.lock().map_err(|_| "Core unavailable")?;
        Ok(serde_json::to_value(&core.home.scope)?)
    }
    fn principal(&self) -> Result<s::VerifiedActor, Failure> {
        let context = self.context()?;
        // Existing lifecycle::prepare's generated editor, not a real account.
        Ok(s::VerifiedActor {
            workspace_id: context["workspaceId"]
                .as_str()
                .ok_or("Missing workspace")?
                .into(),
            home_id: context["homeId"].as_str().ok_or("Missing home")?.into(),
            actor_id: id(7),
        })
    }
    fn store(&self, probe: Probe, busy_ms: u64) -> Result<ProbeStore, Failure> {
        Ok(s::AtlasStore::open_existing(
            self.database(),
            NativeContracts,
            probe,
            ServerRuntime,
            s::StoreOptions {
                busy_timeout_ms: busy_ms,
                ..Default::default()
            },
        )?)
    }
    fn close(self) -> Result<tempfile::TempDir, Failure> {
        let Self {
            app,
            host,
            editor,
            directory: _,
            scratch,
        } = self;
        drop(app);
        let core = Arc::clone(&host.core);
        drop(host);
        let Core {
            store,
            access,
            vault,
            ..
        } = Arc::try_unwrap(core)
            .map_err(|_| "Core still borrowed")?
            .into_inner()
            .map_err(|_| "Core unavailable")?;
        Arc::try_unwrap(store)
            .map_err(|_| "Store still borrowed")?
            .into_inner()
            .map_err(|_| "Store unavailable")?
            .close()?;
        drop(access);
        drop(vault);
        drop(editor);
        Ok(scratch)
    }
}

fn intent(context: Value, offset: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.identity.create","requestId":id(32000+offset),
        "context":context,"target":{"authority":"atlas","recordType":"identity","recordId":id(30000+offset)},
        "payload":{"kind":"item","evidenceIds":[id(100)]},"idempotencyKey":id(31000+offset),
        "reason":"Generated opt-in offline06 regression", "approvalReceiptId":null,
        "preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":id(100)},
            "revision":{"kind":"atlas","value":1}}]}})
}

#[derive(Default)]
struct GateState {
    entered: bool,
    released: bool,
}
#[derive(Default)]
struct Gate {
    state: Mutex<GateState>,
    changed: Condvar,
}
impl Gate {
    fn hold(&self) -> s::Result<()> {
        let mut state = self.state.lock().unwrap();
        state.entered = true;
        self.changed.notify_all();
        let (state, timeout) = self
            .changed
            .wait_timeout_while(state, WAIT, |v| !v.released)
            .unwrap();
        if timeout.timed_out() || !state.released {
            return Err(s::Error::new(
                "offline06-gate-timeout",
                "Generated writer gate timed out",
            ));
        }
        Ok(())
    }
    fn entered(&self) {
        let (state, timeout) = self
            .changed
            .wait_timeout_while(self.state.lock().unwrap(), WAIT, |v| !v.entered)
            .unwrap();
        assert!(
            !timeout.timed_out() && state.entered,
            "Writer never reached precommit"
        );
    }
    fn release(&self) {
        self.state.lock().unwrap().released = true;
        self.changed.notify_all();
    }
}

#[derive(Clone)]
struct Probe {
    principal: s::VerifiedActor,
    expected: Value,
    fail: bool,
    gate: Option<Arc<Gate>>,
    intakes: Arc<AtomicUsize>,
    observed: Arc<Mutex<Option<s::StockAtlasCommit>>>,
}
impl Probe {
    fn new(principal: s::VerifiedActor, expected: Value) -> Self {
        Self {
            principal,
            expected,
            fail: false,
            gate: None,
            intakes: Arc::new(AtomicUsize::new(0)),
            observed: Arc::new(Mutex::new(None)),
        }
    }
    fn actor(&self, principal: &s::VerifiedActor, scope: &s::Scope) -> s::Result<s::VerifiedActor> {
        if principal != &self.principal
            || scope.workspace_id != principal.workspace_id
            || scope.home_id != principal.home_id
        {
            return Err(s::Error::new(
                "forbidden",
                "Generated test peer scope differs",
            ));
        }
        Ok(principal.clone())
    }
}
impl s::Authorization for Probe {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        principal: &s::VerifiedActor,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if request.capability != s::Capability::Mutate
            || request.source.is_some()
            || request.source_partition.is_some()
        {
            return Err(s::Error::new(
                "forbidden",
                "Generated peer is mutation-only",
            ));
        }
        if request
            .mutation
            .is_some_and(|c| c.phase == s::MutationPhase::Intake)
        {
            self.intakes.fetch_add(1, Ordering::SeqCst);
        }
        self.actor(principal, request.scope)
    }
}
impl s::StockAuthorization for Probe {
    fn authorize_stock_mutation(
        &self,
        principal: &s::VerifiedActor,
        frame: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let actor = self.actor(principal, frame.plan.scope())?;
        assert_eq!(frame.plan.original_request(), &self.expected);
        if frame.native.phase == s::MutationPhase::Precommit {
            // commands.rs calls extension.persist(&tx, ...) BEFORE this existing
            // callback. No new runtime hook or mutable SQL handle is introduced.
            let commit = frame
                .commit
                .expect("Precommit must include staged Stock DATA");
            assert!(!commit.replayed);
            assert_eq!(commit.original_request, self.expected);
            assert_eq!(commit.groups.len(), 1);
            assert_eq!(commit.groups[0].native_results.len(), 1);
            assert_eq!(frame.native.entries.len(), 1);
            assert!(
                frame
                    .native
                    .candidate
                    .as_ref()
                    .expect("Missing candidate")
                    .records
                    .iter()
                    .any(|r| r.reference() == frame.native.entries[0].target)
            );
            *self.observed.lock().unwrap() = Some(commit.clone());
            if self.fail {
                return Err(s::Error::new(
                    "offline06-late-fault",
                    "Generated precommit failure after persistence",
                ));
            }
            if let Some(gate) = &self.gate {
                gate.hold()?;
            }
        }
        Ok(actor)
    }
    fn authorize_stock_history(
        &self,
        _: &s::VerifiedActor,
        _: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        Err(s::Error::new(
            "forbidden",
            "History is outside generated mutation peer",
        ))
    }
}

#[derive(Debug, Eq, PartialEq, Ord, PartialOrd)]
enum Cell {
    Null,
    Integer(i64),
    Real(u64),
    Text(Vec<u8>),
    Blob(Vec<u8>),
}
type Tables = Vec<Vec<Vec<Cell>>>;
fn tables(path: &Path) -> Result<Tables, Failure> {
    let db = sql(path)?;
    TABLES
        .iter()
        .map(|table| {
            let mut statement = db.prepare(&format!("SELECT * FROM {table} LIMIT 257"))?;
            let columns = statement.column_count();
            let mut rows = statement.query([])?;
            let mut values = Vec::new();
            while let Some(row) = rows.next()? {
                let cells = (0..columns)
                    .map(|i| {
                        Ok(match row.get_ref(i)? {
                            ValueRef::Null => Cell::Null,
                            ValueRef::Integer(v) => Cell::Integer(v),
                            ValueRef::Real(v) => Cell::Real(v.to_bits()),
                            ValueRef::Text(v) => Cell::Text(v.to_vec()),
                            ValueRef::Blob(v) => Cell::Blob(v.to_vec()),
                        })
                    })
                    .collect::<Result<Vec<_>, rusqlite::Error>>()?;
                values.push(cells);
            }
            assert!(
                values.len() <= 256,
                "Generated fixture table exceeded bound"
            );
            values.sort();
            Ok(values)
        })
        .collect()
}

fn execute(store: &mut ProbeStore, probe: &Probe, raw: &Value) -> s::Result<s::StockAtlasCommit> {
    let contracts = NativeStockContract::new()
        .map_err(|_| s::Error::new("offline06-contract", "Native schemas unavailable"))?;
    store.execute_stock_json_with_authorization(probe, &probe.principal, &contracts, raw)
}
fn single_delta(before: &[i64], after: &[i64]) {
    assert_eq!(after, before.iter().map(|n| n + 1).collect::<Vec<_>>());
}
async fn absent(fixture: &Fixture, raw: &Value) -> Result<(), Failure> {
    let digest = houseatlas_backend::domain::stock::request_digest(raw)?;
    assert_absent(
        &inspect(&fixture.app, raw, &fixture.editor).await?,
        raw,
        &digest,
    );
    Ok(())
}

async fn late_failure() -> Result<(), Failure> {
    let fixture = Fixture::new().await?;
    let raw = intent(fixture.context()?, 1);
    let before = tables(&fixture.database())?;
    let before_counts = counts(&fixture.database())?;
    let mut fault = Probe::new(fixture.principal()?, raw.clone());
    fault.fail = true;
    let mut store = fixture.store(fault.clone(), 5000)?;
    let error = execute(&mut store, &fault, &raw).expect_err("Late fault did not abort");
    assert_eq!(error.code, "offline06-late-fault");
    let witnessed = fault
        .observed
        .lock()
        .unwrap()
        .clone()
        .expect("Fault phase was never reached");
    assert_eq!(witnessed.original_request, raw);
    assert_eq!(
        tables(&fixture.database())?,
        before,
        "Any of the seven complete tables changed"
    );
    absent(&fixture, &raw).await?;
    store.close()?;
    // A DIFFERENT intent is a positive control, not a retry of the failed ID.
    let control = intent(fixture.context()?, 2);
    let probe = Probe::new(fixture.principal()?, control.clone());
    let mut store = fixture.store(probe.clone(), 5000)?;
    let commit = execute(&mut store, &probe, &control)?;
    single_delta(&before_counts, &counts(&fixture.database())?);
    assert_receipt(
        &inspect(&fixture.app, &control, &fixture.editor).await?,
        &control,
        &commit.wire,
    );
    absent(&fixture, &raw).await?;
    store.close()?;
    fixture.close()?.close()?;
    report(
        "late-precommit-rollback",
        json!({"lateWitness":true,"tablesUnchanged":7,"distinctPositiveControl":true}),
    );
    Ok(())
}

async fn shared_store() -> Result<(), Failure> {
    let fixture = Fixture::new().await?;
    let raw = intent(fixture.context()?, 3);
    let before = counts(&fixture.database())?;
    let probe = Probe::new(fixture.principal()?, raw.clone());
    let shared = Arc::new(Mutex::new(fixture.store(probe.clone(), 5000)?));
    let barrier = Arc::new(Barrier::new(3));
    let active = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);
    let worker = || {
        barrier.wait();
        let mut store = shared.lock().unwrap();
        let entered = active.fetch_add(1, Ordering::SeqCst) + 1;
        peak.fetch_max(entered, Ordering::SeqCst);
        let result = execute(&mut store, &probe, &raw);
        active.fetch_sub(1, Ordering::SeqCst);
        result
    };
    let commits = std::thread::scope(|scope| {
        let a = scope.spawn(&worker);
        let b = scope.spawn(&worker);
        barrier.wait();
        (a.join().unwrap(), b.join().unwrap())
    });
    let (a, b) = (commits.0?, commits.1?);
    assert_eq!(peak.load(Ordering::SeqCst), 1);
    assert_eq!(a.operation_id, b.operation_id);
    assert_eq!(a.wire["data"]["auditIds"], b.wire["data"]["auditIds"]);
    assert_eq!(a.request_digest, b.request_digest);
    assert_ne!(a.replayed, b.replayed);
    let original = if a.replayed { &b } else { &a };
    single_delta(&before, &counts(&fixture.database())?);
    assert_receipt(
        &inspect(&fixture.app, &raw, &fixture.editor).await?,
        &raw,
        &original.wire,
    );
    Arc::try_unwrap(shared)
        .map_err(|_| "Store still shared")?
        .into_inner()
        .unwrap()
        .close()?;
    fixture.close()?.close()?;
    report(
        "duplicate-shared-store",
        json!({"connections":1,"mutexSerialized":true,"sqliteConcurrencyClaim":false,"durableOperations":1}),
    );
    Ok(())
}

async fn independent_connections() -> Result<(), Failure> {
    let fixture = Fixture::new().await?;
    let raw = intent(fixture.context()?, 4);
    let before = tables(&fixture.database())?;
    let before_counts = counts(&fixture.database())?;
    let gate = Arc::new(Gate::default());
    let mut a = Probe::new(fixture.principal()?, raw.clone());
    a.gate = Some(Arc::clone(&gate));
    let b = Probe::new(fixture.principal()?, raw.clone());
    // Both actual Store/SQLite connections open BEFORE the first write starts.
    let mut first = fixture.store(a.clone(), 0)?;
    let mut second = fixture.store(b.clone(), 0)?;
    let commit = std::thread::scope(|scope| -> Result<s::StockAtlasCommit, Failure> {
        let writer = scope.spawn(|| execute(&mut first, &a, &raw));
        gate.entered();
        // Direct raw SQLite proof of an existing write reservation. This probe
        // has busy_timeout=0 and issues no data write or production hook.
        let lock_probe =
            Connection::open_with_flags(fixture.database(), OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        lock_probe.busy_timeout(Duration::ZERO)?;
        let locked = lock_probe
            .execute_batch("BEGIN IMMEDIATE")
            .expect_err("No SQLite contention observed");
        assert!(
            matches!(locked, rusqlite::Error::SqliteFailure(e, _) if matches!(e.code,
            rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked))
        );
        let competing = scope.spawn(|| execute(&mut second, &b, &raw));
        let rejected = competing
            .join()
            .unwrap()
            .expect_err("Competing zero-timeout writer unexpectedly succeeded");
        assert_eq!(rejected.code, "storage-unavailable");
        assert_eq!(
            b.intakes.load(Ordering::SeqCst),
            0,
            "Second connection reached intake despite BEGIN contention"
        );
        assert_eq!(
            tables(&fixture.database())?,
            before,
            "Uncommitted first writer leaked to independent reader"
        );
        gate.release();
        Ok(writer.join().unwrap()?)
    })?;
    assert!(!commit.replayed);
    single_delta(&before_counts, &counts(&fixture.database())?);
    assert_receipt(
        &inspect(&fixture.app, &raw, &fixture.editor).await?,
        &raw,
        &commit.wire,
    );
    // No retry of the busy request: only a read of the one committed outcome.
    first.close()?;
    second.close()?;
    fixture.close()?.close()?;
    report(
        "duplicate-independent-connections",
        json!({"connections":2,"verifiedSqliteBusy":true,"secondRequestRetried":false,"durableOperations":1}),
    );
    Ok(())
}

async fn process_reader() -> Result<(), Failure> {
    let fixture = Fixture::new().await?;
    let raw = intent(fixture.context()?, 5);
    let core = fixture.host.core.lock().map_err(|_| "Core unavailable")?;
    let home = serde_json::to_value(&core.home)?;
    let command_path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    drop(core);
    let response = post(
        &fixture.app,
        &command_path,
        serde_json::to_vec(&raw)?,
        &fixture.editor,
    )
    .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let committed: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), RESPONSE_BYTES).await?)?;
    let token = houseatlas_backend::app::new_id()?;
    let ticket = json!({"format":"offline06-generated-child/1","root":fixture.scratch.path().canonicalize()?,
        "parentPid":std::process::id(),"token":token,"home":home,"intent":raw,"committed":committed});
    let bytes = serde_json::to_vec(&ticket)?;
    let mut marker = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(fixture.scratch.path().join("generated-child.json"))?;
    marker.write_all(&bytes)?;
    marker.sync_all()?;
    drop(marker);
    let scratch = fixture.close()?; // All parent Store/Access handles are gone.
    let mut child = Command::new(std::env::current_exe()?)
        .arg("--child-outcome")
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let child_pid = child.id();
    assert_ne!(child_pid, std::process::id());
    if let Err(error) = child
        .stdin
        .take()
        .ok_or("Missing child stdin")?
        .write_all(&bytes)
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.into());
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill()?;
            child.wait()?;
            return Err("Generated child exceeded protective deadline".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut output = Vec::new();
    child
        .stdout
        .take()
        .ok_or("Missing stdout")?
        .take(CHILD_BYTES + 1)
        .read_to_end(&mut output)?;
    let mut errors = Vec::new();
    child
        .stderr
        .take()
        .ok_or("Missing stderr")?
        .take(CHILD_BYTES + 1)
        .read_to_end(&mut errors)?;
    assert!(
        status.success(),
        "Generated child failed; captured error bytes={}",
        errors.len()
    );
    assert!(output.len() <= CHILD_BYTES as usize && errors.is_empty());
    let result: Value = serde_json::from_slice(&output)?;
    assert_eq!(result["pid"], child_pid);
    assert_eq!(result["token"], token);
    assert_eq!(result["operationId"], committed["operationId"]);
    assert_eq!(result["result"], "pass");
    scratch.close()?;
    report(
        "child-process-outcome",
        json!({"distinctPid":true,"parentHandlesClosed":true,"automaticRetry":false}),
    );
    Ok(())
}

pub(super) async fn child_outcome() -> Result<(), Failure> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(CHILD_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > CHILD_BYTES as usize {
        return Err("Child ticket exceeds bound".into());
    }
    let ticket: Value = serde_json::from_slice(&bytes)?;
    if ticket["format"] != "offline06-generated-child/1" {
        return Err("Generated ticket required".into());
    }
    let root =
        PathBuf::from(ticket["root"].as_str().ok_or("Missing generated root")?).canonicalize()?;
    let temporary = Path::new("/tmp").canonicalize()?;
    if root.parent() != Some(temporary.as_path())
        || !root
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("houseatlas-offline06-case-"))
        || fs::metadata(&root)?.permissions().mode() & 0o777 != 0o700
    {
        return Err("Only the parent's private generated temporary fixture is supported".into());
    }
    let marker = root.join("generated-child.json");
    if !fs::symlink_metadata(&marker)?.file_type().is_file()
        || fs::metadata(&marker)?.len() > CHILD_BYTES
        || fs::metadata(&marker)?.permissions().mode() & 0o777 != 0o600
        || fs::read(marker)? != bytes
    {
        return Err("Generated marker differs from bounded stdin ticket".into());
    }
    let directory = root.join("fixture");
    let access = Arc::new(Mutex::new(access::AccessBoundary::open_existing(
        &directory.join("access.sqlite"),
        access::AccessConfig::new(vec![ORIGIN.into()])?,
    )?));
    let vault = Arc::new(houseatlas_backend::media::AssetVault::open_existing(
        &directory.join("media"),
    )?);
    let store = Store::open_existing(
        directory.join("atlas.sqlite"),
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        s::StoreOptions::default(),
    )?;
    let home: houseatlas_backend::domain::HomeSummary =
        serde_json::from_value(ticket["home"].clone())?;
    let host = Host::new(
        Core {
            access,
            store: Arc::new(Mutex::new(store)),
            vault,
            atlas_list_pages: AtlasListPages::default(),
            media_policy_evidence: Mutex::default(),
            homes: vec![home.clone()],
            home,
        },
        ORIGIN.into(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?;
    let app = router(host.clone());
    let logins: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let editor = login(&app, &logins["editorLogin"]).await?;
    let before = tables(&directory.join("atlas.sqlite"))?;
    let disk_before = disk(&directory.join("atlas.sqlite"))?;
    let outcome = inspect(&app, &ticket["intent"], &editor).await?;
    assert_receipt(&outcome, &ticket["intent"], &ticket["committed"]);
    let mut missing = ticket["intent"].clone();
    missing["idempotencyKey"] = json!(id(31999));
    let missing_digest = houseatlas_backend::domain::stock::request_digest(&missing)?;
    assert_absent(
        &inspect(&app, &missing, &editor).await?,
        &missing,
        &missing_digest,
    );
    assert_eq!(tables(&directory.join("atlas.sqlite"))?, before);
    assert_eq!(disk(&directory.join("atlas.sqlite"))?, disk_before);
    drop(app);
    drop(host);
    drop(editor);
    drop(logins);
    println!(
        "{}",
        json!({"result":"pass","pid":std::process::id(),"token":ticket["token"],"operationId":ticket["committed"]["operationId"]})
    );
    Ok(())
}

fn report(case: &str, details: Value) {
    println!(
        "{}",
        json!({"format":"offline06-opt-in-case/1","case":case,"result":"pass","details":details,
        "limits":"Generated storage regressions only; no power-loss, Access/security, device or full offline sync qualification"})
    );
}
pub(super) async fn run(case: &str) -> Result<(), Failure> {
    match case {
        "late-precommit-rollback" => late_failure().await,
        "duplicate-shared-store" => shared_store().await,
        "duplicate-independent-connections" => independent_connections().await,
        "child-process-outcome" => process_reader().await,
        _ => Err("Unknown exact case; aggregate execution is not supported".into()),
    }
}
