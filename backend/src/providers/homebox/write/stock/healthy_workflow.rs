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
        _phase: AuthorityPhase<'_>,
    ) -> Result<StockAuthority, StockErrorCode> {
        let mut s = self.0.lock().unwrap();
        assert_eq!(command, &s.command);
        s.authorizations += 1;
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
                generated_identity_resolved: true,
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
        s.dispatches += 1;
        assert_eq!(authority, &s.authority);
        assert_eq!(plan.request.method, NativeMethod::Patch);
        assert_eq!(plan.request.body, NativeBody::Json(json!({"quantity":0})));
        let mut value = s
            .preparation
            .snapshot(&s.command.target)
            .unwrap()
            .value
            .clone();
        value["quantity"] = json!(0);
        NativeDispatch::Invoked(DispatchReceipt {
            operation_id: permit.operation_id,
            plan_digest: permit.plan_digest.clone(),
            context: s.command.context.clone(),
            source_instance_id: s.command.target.source_instance_id,
            collection_id: s.command.target.collection_id,
            response: Some(NativeResponse {
                status: 200,
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
        _authority: &StockAuthority,
    ) -> NativeObservation {
        let mut s = self.0.lock().unwrap();
        s.readbacks += 1;
        let mut value = s
            .preparation
            .snapshot(&s.command.target)
            .unwrap()
            .value
            .clone();
        value["quantity"] = json!(0);
        assert_eq!(plan.target, s.command.target);
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

#[test]
fn healthy_synthetic_stock_dispatch_and_readback() {
    let (command, preparation) = super::healthy_examples::healthy_cases()
        .into_iter()
        .find(|(c, _)| c.command_id == "homebox.entity.quantity.set")
        .unwrap();
    let authority = StockAuthority {
        actor_id: id(30),
        source_epoch: 1,
        authority_digest: digest(),
        physical_binding: PhysicalBinding {
            deployment_id: id(31),
            physical_database_id: id(32),
            configuration_digest: digest(),
        },
        qualification: NativeQualification::SyntheticFixture,
    };
    let peers = Peers(Arc::new(Mutex::new(State {
        command: command.clone(),
        preparation,
        authority,
        operation: None,
        dispatches: 0,
        readbacks: 0,
        authorizations: 0,
    })));
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
    println!("HEALTHY_STOCK_REQUEST={}", command.original_wire);
    println!(
        "HEALTHY_STOCK_OUTCOME={}",
        serde_json::to_string(&*outcome).unwrap()
    );
}
