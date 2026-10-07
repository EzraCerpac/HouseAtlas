//! Offline synthetic peers shared only by the scoped checkpoint binaries.
use houseatlas_at07_checkpoint::storage::*;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    rc::Rc,
};
pub(crate) type CheckResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;
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
#[derive(Clone)]
pub(crate) struct Oracle {
    process: Rc<RefCell<OracleProcess>>,
    pub(crate) counts: Rc<RefCell<BTreeMap<String, usize>>>,
}
impl Oracle {
    pub(crate) fn start(root: &Path) -> CheckResult<Self> {
        let mut child = Command::new("node")
            .arg(root.join("backend/src/storage/checks/oracle.mjs"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let input = child.stdin.take().ok_or("oracle stdin missing")?;
        let output = BufReader::new(child.stdout.take().ok_or("oracle stdout missing")?);
        Ok(Self {
            process: Rc::new(RefCell::new(OracleProcess {
                child,
                input,
                output,
            })),
            counts: Rc::new(RefCell::new(BTreeMap::new())),
        })
    }
    pub(crate) fn call(&self, operation: &str, args: Value) -> Result<Value> {
        let fail = || {
            Error::new(
                "checkpoint-error",
                "Offline contract oracle could not complete",
            )
        };
        *self
            .counts
            .borrow_mut()
            .entry(operation.into())
            .or_default() += 1;
        let mut process = self.process.borrow_mut();
        writeln!(
            process.input,
            "{}",
            json!({"operation":operation,"args":args})
        )
        .map_err(|_| fail())?;
        process.input.flush().map_err(|_| fail())?;
        let mut line = String::new();
        process.output.read_line(&mut line).map_err(|_| fail())?;
        let response: Value = serde_json::from_str(&line).map_err(|_| fail())?;
        if response["ok"] != true {
            return Err(Error::new(
                match response["code"].as_str() {
                    Some("invalid-contract") => "invalid-contract",
                    Some("invalid-transition") => "invalid-transition",
                    Some("revision-conflict") => "revision-conflict",
                    Some("guard-conflict") => "guard-conflict",
                    Some("identity-conflict") => "identity-conflict",
                    _ => "checkpoint-error",
                },
                "Published contract oracle returned an error",
            ));
        }
        Ok(response["value"].clone())
    }
    fn unit(&self, operation: &str, args: Value) -> Result<()> {
        self.call(operation, args).map(|_| ())
    }
    pub(crate) fn canonical<T: Serialize>(&self, value: &T) -> Result<String> {
        self.canonical_json(&serde_json::to_value(value)?)
    }
    pub(crate) fn storage_contract(&self) -> NativeContract<Self> {
        NativeContract::new(self.clone())
    }
    pub(crate) fn digest(&self, value: &Value) -> Result<String> {
        self.call("digest", json!({"value":value}))?
            .as_str()
            .map(str::to_owned)
            .ok_or(Error::new("checkpoint-error", "Digest missing"))
    }
}
impl Contract for Oracle {
    fn validate_shape(&self, name: &str, value: &Value) -> Result<()> {
        self.unit("shape", json!({"name":name,"value":value}))
    }
    fn validate_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        self.unit("snapshot", json!({"snapshot":snapshot}))
    }
    fn assert_transition(
        &self,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<u64> {
        self.call(
            "transition",
            json!({"current":current,"command":command,"target":target}),
        )?
        .as_u64()
        .ok_or(Error::new("checkpoint-error", "Revision missing"))
    }
    fn assert_guards(
        &self,
        snapshot: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
        created: &[ScopedTarget],
    ) -> Result<()> {
        self.unit("guards",json!({"snapshot":snapshot,"current":current,"command":command,"target":target,"created":created}))
    }
    fn assert_final_mutation(
        &self,
        snapshot: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<()> {
        self.unit(
            "final",
            json!({"snapshot":snapshot,"current":current,"command":command,"target":target}),
        )
    }
    fn validate_result(&self, result: &MutationResult, prior: Prior<'_>) -> Result<()> {
        let (kind, record) = match prior {
            Prior::Unspecified => ("unspecified", None),
            Prior::Missing => ("missing", None),
            Prior::Record(r) => ("record", Some(r)),
        };
        self.unit(
            "result",
            json!({"result":result,"priorKind":kind,"prior":record}),
        )
    }
    fn canonical_json(&self, value: &Value) -> Result<String> {
        self.call("canonical", json!({"value":value}))?
            .as_str()
            .map(str::to_owned)
            .ok_or(Error::new("checkpoint-error", "Canonical JSON missing"))
    }
    fn timestamp_millis(&self, value: &str) -> Result<Option<i64>> {
        let timestamp = self.call("timestamp", json!({"value":value}))?;
        if timestamp.is_null() {
            Ok(None)
        } else {
            timestamp
                .as_i64()
                .map(Some)
                .ok_or(Error::new("checkpoint-error", "Timestamp missing"))
        }
    }
}
#[derive(Clone)]
pub(crate) struct SyntheticAuthorization {
    pub(crate) oracle: Oracle,
    pub(crate) contexts: Rc<RefCell<Vec<MutationAuthorizationContext>>>,
}
impl Authorization for SyntheticAuthorization {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        // Synthetic principal only. This is not the real access boundary.
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        if let Some(context) = request.mutation {
            // Compare every detached Rust context with the published extractor.
            let expected = self
                .oracle
                .call("context", serde_json::to_value(context)?)?;
            assert_eq!(
                self.oracle.canonical(context)?,
                self.oracle.canonical_json(&expected)?
            );
            for snapshot in std::iter::once(&context.original).chain(context.candidate.as_ref()) {
                assert!(snapshot.records.iter().all(|r| r.scope() == *request.scope));
            }
            assert!(context.replay.is_none());
            self.contexts.borrow_mut().push(context.clone());
        }
        Ok(principal.clone())
    }
}
#[derive(Clone)]
pub(crate) struct SyntheticRuntime {
    pub(crate) next: Rc<Cell<u64>>,
}
impl Runtime for SyntheticRuntime {
    fn now(&self) -> Result<String> {
        Ok("2026-01-03T12:00:00Z".into())
    }
    fn new_id(&self) -> Result<String> {
        let n = self.next.get();
        self.next.set(n + 1);
        Ok(id(n))
    }
    fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
        // No assets are made available by this checkpoint.
        Err(Error::new(
            "checkpoint-error",
            "Checkpoint has no staged media",
        ))
    }
}
pub(crate) fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
pub(crate) fn reference(kind: RecordType, n: u64) -> RecordRef {
    RecordRef {
        record_type: kind,
        record_id: id(n),
    }
}
pub(crate) fn load<T: DeserializeOwned>(root: &Path, name: &str) -> CheckResult<T> {
    Ok(serde_json::from_slice(&fs::read(
        root.join("packages/contracts/fixtures").join(name),
    )?)?)
}
pub(crate) fn healthy_command(
    n: u64,
    operation: Operation,
    revision: Option<u64>,
    value: Option<RecordValue>,
) -> Mutation {
    Mutation {
        schema_version: 1,
        mutation_id: id(n),
        operation,
        expected_revision: revision,
        reason: "Healthy synthetic room/item checkpoint".into(),
        guards: vec![Guard {
            record: reference(RecordType::Evidence, 100),
            expected_revision: 1,
        }],
        value,
    }
}
