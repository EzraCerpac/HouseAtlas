//! Healthy injected peers only. No SQLite, real access, native HTTP or clocks.
use super::*;
use serde_json::{Value, json};
use std::future::Future;
use std::pin::pin;
use std::sync::{Arc, Mutex};
use std::task::{Context as TaskContext, Poll, Waker};
use uuid::Uuid;

fn digest() -> Digest {
    Digest::parse("b".repeat(64)).unwrap()
}
fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
const TIME: &str = "2026-10-06T12:00:00Z";
#[derive(Clone)]
struct Peers(Arc<Mutex<State>>);
struct State {
    command: StockCommand,
    preparation: Preparation,
    authority: StockAuthority,
    operation: Option<StoredOperation>,
    dispatches: usize,
    readbacks: usize,
    authorizations: usize,
    events: Vec<&'static str>,
    generated_entity_id: Option<Uuid>,
    native_response: Option<Value>,
    authorized_readback: Option<ReadbackPlan>,
}
impl StockContractPort for Peers {
    fn validate_request(&self, wire: &Value) -> Result<StockCommand, StockError> {
        let s = self.0.lock().unwrap();
        assert_eq!(wire, &s.command.original_wire);
        Ok(s.command.clone())
    }
    fn digest_native(&self, _value: &Value) -> Result<Digest, StockPortFault> {
        Ok(digest())
    }
    fn validate_outcome(&self, outcome: &StockOutcome) -> Result<(), StockPortFault> {
        assert!(outcome.well_formed());
        let wire = serde_json::to_value(outcome).unwrap();
        assert_eq!(wire["atomicProviderCAS"], false);
        assert_eq!(
            serde_json::from_value::<StockOutcome>(wire).unwrap(),
            *outcome
        );
        Ok(())
    }
    fn validate_observed_at(&self, value: &str) -> Result<(), StockPortFault> {
        assert_eq!(value, TIME);
        Ok(())
    }
}
impl StockAccessPort for Peers {
    async fn authorize(
        &self,
        command: &StockCommand,
        phase: AuthorityPhase<'_>,
    ) -> Result<StockAuthority, StockErrorCode> {
        let mut s = self.0.lock().unwrap();
        assert_eq!(command, &s.command);
        s.authorizations += 1;
        if let AuthorityPhase::Readback(plan) = phase {
            let operation = s.operation.as_ref().unwrap();
            assert_eq!(operation.captured_authority, s.authority);
            if let Some(generated_id) = s.generated_entity_id {
                let actual = operation.actual_target.as_ref().unwrap();
                assert_eq!(actual.resource_id, Some(generated_id));
                assert_eq!(&plan.readback.target, actual);
                assert_eq!(
                    plan.readback.path,
                    format!("/api/v1/entities/{generated_id}")
                );
                assert_eq!(command.target.resource_id, None);
                assert_eq!(command.original_wire["target"].get("resourceId"), None);
            }
            s.authorized_readback = Some(plan.readback.clone());
            s.events.push("authorize-readback");
            return Ok(s.authority.clone());
        }
        let event = if s.dispatches == 0
            && s.operation.as_ref().is_some_and(|operation| {
                operation.outcome.state == OutcomeState::Dispatching
                    && operation.captured_authority == s.authority
            }) {
            "authorize-after-admission"
        } else {
            "authorize"
        };
        s.events.push(event);
        Ok(s.authority.clone())
    }
}
impl StockPreparationPort for Peers {
    async fn prepare(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<StockPreflight, StockErrorCode> {
        let s = self.0.lock().unwrap();
        assert_eq!(command, &s.command);
        assert_eq!(authority, &s.authority);
        Ok(StockPreflight {
            preparation: s.preparation.clone(),
            provider_observation: command.provider_observation,
            request_digest: command.request_digest.clone(),
            source_epoch: authority.source_epoch,
            preflight_digest: digest(),
        })
    }
}
impl StockActivityPort for Peers {
    async fn reserve(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<StockReservation, StockPortFault> {
        let mut s = self.0.lock().unwrap();
        assert!(s.operation.is_none());
        let operation = StoredOperation {
            actor_id: authority.actor_id,
            captured_authority: authority.clone(),
            operation_id: id(40),
            activity_version: 1,
            command: command.clone(),
            plan: None,
            actual_target: None,
            generated_members: vec![],
            outcome: StockOutcome {
                schema_version: 3,
                command_id: command.command_id.clone(),
                request_id: command.request_id,
                operation_id: id(40),
                resolved_scope: command.context.clone(),
                request_digest: command.request_digest.clone(),
                causality_proven: false,
                atomic_provider_cas: false,
                native_editor_race_possible: true,
                known_effects: vec![],
                observed_at: TIME.into(),
                response_digest: None,
                readback_digest: None,
                // A fresh reservation has no qualified generated identity yet.
                // Non-generating dispatch facts establish their existing target.
                generated_identity_resolved: false,
                unknown_scope_fence_retained: false,
                remote_activity: RemoteActivity::not_dispatched(),
                storage_liability: StorageLiability {
                    accounting_complete: true,
                    metadata_commit_evidence: MetadataEvidence::NotDispatched,
                    byte_disposition: ByteDisposition::None,
                    reference_closure_evidence: ReferenceClosure::Unassessed,
                    orphan_candidate_id: None,
                    unresolved_attempts: 0,
                    known_bytes: 0,
                    reserved_bytes: Some(0),
                },
                state: OutcomeState::Prepared,
                verification: Verification::Unresolved,
                response_success: false,
                readback_agrees: false,
                resolution_evidence_digest: None,
                resolution_actor_id: None,
            },
        };
        s.operation = Some(operation.clone());
        Ok(StockReservation::Reserved(Box::new(operation)))
    }
    async fn admit(
        &self,
        reserved: &StoredOperation,
        plan: &NativePlan,
        plan_digest: &Digest,
        _preflight: &StockPreflight,
        authority: &StockAuthority,
    ) -> Result<Admission, StockPortFault> {
        let mut s = self.0.lock().unwrap();
        assert_eq!(s.operation.as_ref(), Some(reserved));
        let mut operation = reserved.clone();
        operation.activity_version += 1;
        operation.plan = Some(plan.clone());
        operation.outcome.state = OutcomeState::Dispatching;
        operation.outcome.unknown_scope_fence_retained = true;
        operation.outcome.remote_activity = RemoteActivity::Active {
            termination_evidence_digest: None,
        };
        let permit = InvocationPermit {
            operation_id: operation.operation_id,
            actor_id: authority.actor_id,
            physical_binding: authority.physical_binding.clone(),
            owner_id: id(41),
            dispatcher_epoch: 1,
            source_epoch: authority.source_epoch,
            plan_digest: plan_digest.clone(),
            qualification: authority.qualification.clone(),
        };
        s.operation = Some(operation.clone());
        s.events.push("admit");
        Ok(Admission::Admitted {
            permit: Box::new(permit),
            operation: Box::new(operation),
        })
    }
    async fn reject(
        &self,
        _reserved: &StoredOperation,
        _reason: StockErrorCode,
    ) -> Result<StoredOperation, StockPortFault> {
        panic!("not part of the healthy group")
    }
    async fn record_never_invoked(
        &self,
        _permit: &InvocationPermit,
    ) -> Result<StoredOperation, StockPortFault> {
        panic!("not part of the healthy group")
    }
    async fn record_dispatch(
        &self,
        permit: &InvocationPermit,
        facts: &DispatchFacts,
    ) -> Result<StoredOperation, StockPortFault> {
        let mut s = self.0.lock().unwrap();
        let operation = s.operation.as_mut().unwrap();
        assert_eq!(permit.operation_id, operation.operation_id);
        operation.outcome = operation.outcome.with_dispatch(facts).unwrap();
        operation.actual_target = facts.generated_target.clone();
        operation.generated_members = facts.generated_members.clone();
        operation.activity_version += 1;
        Ok(operation.clone())
    }
    async fn save_observation(
        &self,
        prior: &StoredOperation,
        facts: &ObservationFacts,
    ) -> Result<StoredOperation, StockPortFault> {
        let mut s = self.0.lock().unwrap();
        let operation = s.operation.as_mut().unwrap();
        assert_eq!(operation, prior);
        operation.outcome = operation.outcome.with_observation(facts).unwrap();
        operation.activity_version += 1;
        Ok(operation.clone())
    }
    async fn load(
        &self,
        command: &StockCommand,
        actor_id: Uuid,
        operation_id: Uuid,
    ) -> Result<StoredOperation, StockPortFault> {
        let s = self.0.lock().unwrap();
        let operation = s.operation.as_ref().unwrap();
        assert_eq!(command, &operation.command);
        assert_eq!(actor_id, operation.actor_id);
        assert_eq!(operation_id, operation.operation_id);
        Ok(operation.clone())
    }
}
impl StockDispatchPort for Peers {
    async fn dispatch(
        &self,
        permit: &InvocationPermit,
        plan: &NativePlan,
        authority: &StockAuthority,
    ) -> NativeDispatch {
        let mut s = self.0.lock().unwrap();
        assert_eq!(s.events.last(), Some(&"authorize-after-admission"));
        s.events.push("dispatch");
        s.dispatches += 1;
        assert_eq!(authority, &s.authority);
        let mut value = if let Some(generated_id) = s.generated_entity_id {
            assert_eq!(plan.request.method, NativeMethod::Post);
            assert_eq!(plan.request.path, "/api/v1/entities");
            assert_eq!(
                plan.request.body,
                NativeBody::Json(s.command.payload.clone())
            );
            let body = &s.command.payload;
            let mut value = s.preparation.snapshots[0].value.clone();
            value["id"] = json!(generated_id);
            value["name"] = body["name"].clone();
            value["description"] = body["description"].clone();
            value["quantity"] = body["quantity"].clone();
            value["parent"] = if body["parentId"].is_null() {
                Value::Null
            } else {
                json!({"id":body["parentId"]})
            };
            value["entityType"]["id"] = body["entityTypeId"].clone();
            value["tags"] = json!(
                body["tagIds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|id| json!({"id":id}))
                    .collect::<Vec<_>>()
            );
            value["fields"] = json!([]);
            value["attachments"] = json!([]);
            value
        } else {
            assert_eq!(plan.request.method, NativeMethod::Patch);
            assert_eq!(plan.request.body, NativeBody::Json(json!({"quantity":0})));
            s.preparation
                .snapshot(&s.command.target)
                .unwrap()
                .value
                .clone()
        };
        if s.generated_entity_id.is_none() {
            value["quantity"] = json!(0);
        }
        s.native_response = Some(value.clone());
        NativeDispatch::Invoked(DispatchReceipt {
            operation_id: permit.operation_id,
            plan_digest: permit.plan_digest.clone(),
            context: s.command.context.clone(),
            source_instance_id: s.command.target.source_instance_id,
            collection_id: s.command.target.collection_id,
            response: Some(NativeResponse {
                status: plan.success_status,
                value,
                body_digest: digest(),
            }),
            remote_activity: RemoteActivity::end_unproven(),
        })
    }
}
impl StockReadbackPort for Peers {
    async fn readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> NativeObservation {
        let mut s = self.0.lock().unwrap();
        s.readbacks += 1;
        assert_eq!(authority, &s.authority);
        assert_eq!(s.authorized_readback.as_ref(), Some(plan));
        assert_eq!(s.events.last(), Some(&"authorize-readback"));
        s.events.push("readback");
        let value = s.native_response.as_ref().unwrap().clone();
        if let Some(generated_id) = s.generated_entity_id {
            assert_eq!(operation.actual_target.as_ref(), Some(&plan.target));
            assert_eq!(plan.target.resource_id, Some(generated_id));
            assert_eq!(plan.path, format!("/api/v1/entities/{generated_id}"));
            assert_eq!(value["id"], generated_id.to_string());
        } else {
            assert_eq!(plan.target, s.command.target);
        }
        NativeObservation::Present {
            context: operation.command.context.clone(),
            target: plan.target.clone(),
            value,
            observed_at: TIME.into(),
            complete: true,
            impact: None,
        }
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = pin!(future);
    match future
        .as_mut()
        .poll(&mut TaskContext::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("synthetic peers must be immediately ready"),
    }
}

fn healthy_authority() -> StockAuthority {
    StockAuthority {
        actor_id: id(30),
        source_epoch: 1,
        authority_digest: digest(),
        physical_binding: PhysicalBinding {
            deployment_id: id(31),
            physical_database_id: id(32),
            configuration_digest: digest(),
        },
        qualification: NativeQualification::SyntheticFixture,
    }
}

fn healthy_peers(command: StockCommand, preparation: Preparation) -> Peers {
    let generated_entity_id = (command.command_id == "homebox.entity.create").then(|| id(43));
    Peers(Arc::new(Mutex::new(State {
        command,
        preparation,
        authority: healthy_authority(),
        operation: None,
        dispatches: 0,
        readbacks: 0,
        authorizations: 0,
        events: vec![],
        generated_entity_id,
        native_response: None,
        authorized_readback: None,
    })))
}

/// Reuse the existing synthetic activity and contract peers to check a
/// positive exact-ID readback. The caller supplies the full native response
/// envelope; no transport or generated-identity inference occurs here.
pub(super) fn assert_healthy_observation(
    command: &StockCommand,
    preparation: &Preparation,
    plan: &NativePlan,
    native_value: Value,
) {
    let peers = healthy_peers(command.clone(), preparation.clone());
    let authority = healthy_authority();
    let StockReservation::Reserved(reserved) = ready(peers.reserve(command, &authority)).unwrap()
    else {
        panic!("healthy observation has a fresh reservation")
    };
    let preflight = ready(peers.prepare(command, &authority)).unwrap();
    let Admission::Admitted {
        permit,
        operation: _,
    } = ready(peers.admit(&reserved, plan, &digest(), &preflight, &authority)).unwrap()
    else {
        panic!("healthy observation has admitted native evidence")
    };
    let operation = ready(peers.record_dispatch(
        &permit,
        &DispatchFacts {
            response_success: true,
            response_digest: Some(digest()),
            generated_target: None,
            generated_identity_resolved: true,
            generated_members: vec![],
            remote_activity: RemoteActivity::end_unproven(),
        },
    ))
    .unwrap();
    let impact = plan.requires_complete_impact.then(|| ImpactObservation {
        effects: vec![EffectEvidence {
            target: WireTarget::try_from(&command.target).unwrap(),
            effect: Effect::Updated,
            digest: digest(),
        }],
        complete: true,
        evidence_digest: digest(),
    });
    let observation = NativeObservation::Present {
        context: command.context.clone(),
        target: command.target.clone(),
        value: native_value,
        observed_at: TIME.into(),
        complete: true,
        impact,
    };
    let facts = super::evidence::observation_facts(&peers, &operation, &observation)
        .expect("healthy native readback has exact scoped evidence");
    assert!(facts.agrees);
    assert!(facts.generated_identity_resolved);
    let observed = ready(peers.save_observation(&operation, &facts)).unwrap();
    assert_eq!(observed.outcome.state, OutcomeState::ConfirmedObserved);
    assert_eq!(observed.outcome.request_digest, command.request_digest);
    assert_eq!(observed.command.original_wire, command.original_wire);
    peers.validate_outcome(&observed.outcome).unwrap();
    println!(
        "HEALTHY_STOCK_OUTCOME={}",
        serde_json::to_string(&observed.outcome).unwrap()
    );
}

fn assert_healthy_dispatch_and_readback(command_id: &str) {
    let (command, preparation) = super::healthy_examples::healthy_cases()
        .into_iter()
        .find(|(c, _)| c.command_id == command_id)
        .unwrap();
    let peers = healthy_peers(command.clone(), preparation);
    let writer = StockWriter {
        contracts: peers.clone(),
        access: peers.clone(),
        preparation: peers.clone(),
        activity: peers.clone(),
        dispatch: peers.clone(),
        readback: peers.clone(),
    };
    let StockResult::Outcome(outcome) = ready(writer.execute(&command.original_wire)) else {
        panic!("healthy execution must produce an outcome")
    };
    assert_eq!(outcome.state, OutcomeState::ConfirmedObserved);
    assert_eq!(outcome.verification, Verification::ObservedAfterWrite);
    assert_eq!(outcome.remote_activity, RemoteActivity::end_unproven());
    assert_eq!(outcome.known_effects.len(), 1);
    let s = peers.0.lock().unwrap();
    assert_eq!(s.dispatches, 1);
    assert_eq!(s.readbacks, 1);
    assert!(s.authorizations >= 5);
    assert!(
        s.events
            .windows(3)
            .any(|events| { events == ["admit", "authorize-after-admission", "dispatch"] })
    );
    assert!(
        s.events
            .windows(2)
            .any(|events| events == ["authorize-readback", "readback"])
    );
    if let Some(generated_id) = s.generated_entity_id {
        let actual = s
            .operation
            .as_ref()
            .unwrap()
            .actual_target
            .as_ref()
            .unwrap();
        assert_eq!(actual.resource_id, Some(generated_id));
        assert_eq!(outcome.known_effects[0].target.resource_id, generated_id);
        assert_eq!(outcome.known_effects[0].effect, Effect::Created);
        assert_eq!(command.target.resource_id, None);
    }
    println!("HEALTHY_STOCK_REQUEST={}", command.original_wire);
    println!(
        "HEALTHY_STOCK_OUTCOME={}",
        serde_json::to_string(&*outcome).unwrap()
    );
}

#[test]
fn healthy_synthetic_stock_dispatch_and_readback() {
    for command_id in ["homebox.entity.quantity.set", "homebox.entity.create"] {
        assert_healthy_dispatch_and_readback(command_id);
    }
}
