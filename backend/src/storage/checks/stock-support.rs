//! Check-only exact schemas and pure Rust semantics with synthetic authority.
//! No transport, real grants or held controls are supplied.
use houseatlas_at07_checkpoint::{contracts as native, domain::stock, storage::*};
use native::semantics as sem;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    fs,
    path::Path,
    rc::Rc,
};

pub(crate) type CheckResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn decoded<T: native::Contract>(value: &impl Serialize) -> Result<T> {
    native::decode(&serde_json::to_vec(value)?)
        .map_err(|_| Error::new("invalid-contract", "Native checked DTO conversion failed"))
}
fn semantic<T>(value: std::result::Result<T, sem::SemanticError>) -> Result<T> {
    value.map_err(|error| Error::new(error.code.as_str(), "Native semantic check failed"))
}
fn target(value: &ScopedTarget) -> Result<sem::MutationTarget> {
    Ok(sem::MutationTarget {
        scope: decoded(&Scope {
            workspace_id: value.workspace_id.clone(),
            home_id: value.home_id.clone(),
        })?,
        record: decoded(&RecordRef {
            record_type: value.record_type,
            record_id: value.record_id.clone(),
        })?,
    })
}

#[derive(Clone, Default)]
pub(crate) struct PureRustSemantics {
    pub(crate) counts: Rc<RefCell<BTreeMap<String, usize>>>,
}
impl PureRustSemantics {
    fn count(&self, name: &str) {
        *self.counts.borrow_mut().entry(name.into()).or_default() += 1;
    }
    pub(crate) fn storage_contract(&self) -> NativeContract<Self> {
        NativeContract::new(self.clone())
    }
}
impl Contract for PureRustSemantics {
    fn validate_shape(&self, _: &str, _: &Value) -> Result<()> {
        Err(Error::new(
            "schema-incompatible",
            "Use the native generated shape adapter",
        ))
    }
    fn validate_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        self.count("snapshot");
        semantic(sem::validate_snapshot(&decoded(snapshot)?))
    }
    fn assert_transition(
        &self,
        current: Option<&Record>,
        command: &Mutation,
        route: &ScopedTarget,
    ) -> Result<u64> {
        self.count("transition");
        let current = current.map(serde_json::to_value).transpose()?;
        semantic(sem::assert_transition_from_value(
            current.as_ref(),
            &decoded(command)?,
            &target(route)?,
        ))
        .map(|transition| transition.next_revision)
    }
    fn assert_guards(
        &self,
        snapshot: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        route: &ScopedTarget,
        created: &[ScopedTarget],
    ) -> Result<()> {
        self.count("guards");
        let current = current.map(decoded::<native::AtlasRecord>).transpose()?;
        let created = created
            .iter()
            .map(|created| {
                if created.workspace_id != route.workspace_id || created.home_id != route.home_id {
                    return Err(Error::new(
                        "invalid-contract",
                        "Created target scope differs",
                    ));
                }
                decoded(&RecordRef {
                    record_type: created.record_type,
                    record_id: created.record_id.clone(),
                })
            })
            .collect::<Result<Vec<native::RecordRef>>>()?;
        semantic(sem::assert_guards(
            &decoded(snapshot)?,
            current.as_ref(),
            &decoded(command)?,
            &target(route)?,
            &created,
        ))
    }
    fn assert_final_mutation(
        &self,
        snapshot: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        route: &ScopedTarget,
    ) -> Result<()> {
        self.count("final");
        let current = current.map(decoded::<native::AtlasRecord>).transpose()?;
        semantic(sem::assert_final_mutation(
            &decoded(snapshot)?,
            current.as_ref(),
            &decoded(command)?,
            &target(route)?,
        ))
    }
    fn validate_result(&self, result: &MutationResult, prior: Prior<'_>) -> Result<()> {
        self.count("result");
        let original = match prior {
            Prior::Record(record) => Some(decoded::<native::AtlasRecord>(record)?),
            _ => None,
        };
        let prior = match prior {
            Prior::Unspecified => sem::PriorRecord::Unspecified,
            Prior::Missing => sem::PriorRecord::Absent,
            Prior::Record(_) => sem::PriorRecord::Record(original.as_ref().expect("record branch")),
        };
        semantic(sem::validate_result(&decoded(result)?, prior))
    }
    fn canonical_json(&self, value: &Value) -> Result<String> {
        self.count("canonical");
        semantic(sem::canonical_json(value))
    }
    fn timestamp_millis(&self, value: &str) -> Result<Option<i64>> {
        self.count("timestamp");
        Ok(sem::timestamp_millis(value))
    }
}

/// Actual published native offline stock schema port; no local validator copy.
pub(crate) struct OfflineStockSchemas {
    native: native::stock::StockValidation,
    pub(crate) calls: RefCell<BTreeMap<String, usize>>,
    pub(crate) resources: Value,
}
impl OfflineStockSchemas {
    pub(crate) fn load(root: &Path) -> CheckResult<Self> {
        let map: Value = load(root, "contracts/stock-wire3/resource-map.json")?;
        assert_eq!(map["networkResolution"], false);
        for resource in map["resources"]
            .as_array()
            .ok_or("Resource map entries missing")?
        {
            let bytes =
                fs::read(root.join(resource["path"].as_str().ok_or("Resource path missing")?))?;
            assert_eq!(
                format!("{:x}", Sha256::digest(&bytes)),
                resource["sha256"]
                    .as_str()
                    .ok_or("Resource digest missing")?
            );
        }
        Ok(Self {
            native: native::stock::StockValidation::new()?,
            calls: RefCell::new(BTreeMap::new()),
            resources: map,
        })
    }
}
impl stock::StockContractPort for OfflineStockSchemas {
    fn validate(&self, name: &str, value: &Value) -> stock::StockResult<()> {
        *self.calls.borrow_mut().entry(name.into()).or_default() += 1;
        self.native
            .validate(name, value)
            .map_err(|error| match error {
                native::stock::StockError::InvalidContract(_) => stock::StockError::InvalidContract,
                native::stock::StockError::Correlation(_) => stock::StockError::CorrelationMismatch,
                native::stock::StockError::Setup(_)
                | native::stock::StockError::UnknownSchema(_) => {
                    stock::StockError::OwnerUnavailable
                }
            })
    }
}

#[derive(Clone, Default)]
pub(crate) struct SyntheticAuthorization {
    pub(crate) native_frames: Rc<RefCell<Vec<MutationAuthorizationContext>>>,
    pub(crate) stock_frames: Rc<RefCell<Vec<Value>>>,
    pub(crate) history_frames: Rc<RefCell<Vec<Value>>>,
}
impl Authorization for SyntheticAuthorization {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        if let Some(context) = request.mutation {
            assert!(context.replay.is_none());
            assert_eq!(context.scope, *request.scope);
            let entries: Vec<native::BatchMutationCommandsItem> =
                serde_json::from_value(serde_json::to_value(&context.entries)?)?;
            let closure = semantic(sem::reference_closure(
                &decoded(&context.scope)?,
                &decoded(&context.original)?,
                context
                    .candidate
                    .as_ref()
                    .map(decoded::<native::Snapshot>)
                    .transpose()?
                    .as_ref(),
                &entries,
                None,
            ))?;
            assert_eq!(
                serde_json::to_value(closure)?,
                serde_json::to_value(&context.closure)?
            );
            self.native_frames.borrow_mut().push(context.clone());
        }
        Ok(principal.clone())
    }
}
impl StockAuthorization for SyntheticAuthorization {
    fn authorize_stock_mutation(
        &self,
        principal: &VerifiedActor,
        frame: StockMutationFrame<'_>,
    ) -> Result<VerifiedActor> {
        assert_eq!(frame.plan.scope(), &frame.native.scope);
        assert_eq!(
            frame.plan.original_request()["context"],
            serde_json::to_value(frame.native.scope.clone())?
        );
        if frame.plan.batch_target_id().is_some() {
            let root = frame.plan.root_guards();
            assert_eq!(root.len(), 1);
            assert_eq!(root[0].record, reference(RecordType::Identity, 201));
            assert!(frame.closure.record_refs.contains(&root[0].record));
            assert!(!frame.native.closure.record_refs.contains(&root[0].record));
            for group in frame.plan.groups() {
                assert_eq!(group.native_entries().len(), 1);
                assert_eq!(group.native_entries()[0].command.guards.len(), 1);
                assert_eq!(
                    group.native_entries()[0].command.guards[0].record,
                    reference(RecordType::Evidence, 100)
                );
            }
        }
        self.stock_frames
            .borrow_mut()
            .push(json!({"phase":frame.native.phase,
            "rootKey":frame.plan.root_idempotency_key(),"rootGuards":frame.plan.root_guards(),
            "closure":frame.closure,"commitPresent":frame.commit.is_some()}));
        Ok(principal.clone())
    }
    fn authorize_stock_history(
        &self,
        principal: &VerifiedActor,
        frame: StockHistoryFrame<'_>,
    ) -> Result<VerifiedActor> {
        assert_eq!(frame.scope.workspace_id, principal.workspace_id);
        assert_eq!(frame.scope.home_id, principal.home_id);
        assert_eq!(frame.request["target"]["recordId"], frame.target.record_id);
        for audit in frame.audits {
            assert_eq!(audit.record, *frame.target);
            assert_eq!(audit.workspace_id, frame.scope.workspace_id);
            assert_eq!(audit.home_id, frame.scope.home_id);
        }
        if let Some(result) = frame.result {
            assert_eq!(result.wire["requestId"], frame.request["requestId"]);
            for entry in result.wire["data"]["entries"]
                .as_array()
                .expect("History entries")
            {
                assert_eq!(entry["target"], frame.request["target"]);
            }
        }
        self.history_frames
            .borrow_mut()
            .push(json!({"requestId":frame.request["requestId"],
            "auditCount":frame.audits.len(),"resultPresent":frame.result.is_some()}));
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
        let value = self.next.get();
        self.next.set(value + 1);
        Ok(id(value))
    }
    fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
        Err(Error::new(
            "checkpoint-error",
            "This check has no staged media",
        ))
    }
}
pub(crate) fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}
pub(crate) fn reference(record_type: RecordType, value: u64) -> RecordRef {
    RecordRef {
        record_type,
        record_id: id(value),
    }
}
pub(crate) fn load<T: DeserializeOwned>(root: &Path, relative: &str) -> CheckResult<T> {
    Ok(serde_json::from_slice(&fs::read(root.join(relative))?)?)
}
