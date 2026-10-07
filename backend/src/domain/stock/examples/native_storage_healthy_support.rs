//! Explicit synthetic authority/runtime peers for one fresh accepted example.
//! They preserve original P/request/witness/graph coupling for fixture checks;
//! they supply no session, live access grant, provider or production authority.
use houseatlas_at36_stock_harness::{
    domain::stock::*,
    storage::{self, *},
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub type CheckResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub type Observations = Rc<RefCell<Vec<Value>>>;

/// The split dispatch ports require an unused peer. This closed unavailable
/// disposition is never invoked by the accepted examples; it invents no success.
pub struct InactiveOwner;
impl StockQueryPort<VerifiedActor, SyntheticWitness, SyntheticGraph> for InactiveOwner {
    fn query(
        &mut self,
        _: &VerifiedActor,
        _: &PreparedRequest<SyntheticWitness, SyntheticGraph>,
    ) -> StockResult<OwnerResult> {
        Err(StockError::OwnerUnavailable)
    }
}
impl StockCommandPort<VerifiedActor, SyntheticWitness, SyntheticGraph> for InactiveOwner {
    fn execute(
        &mut self,
        _: &VerifiedActor,
        _: &PreparedRequest<SyntheticWitness, SyntheticGraph>,
    ) -> StockResult<OwnerResult> {
        Err(StockError::OwnerUnavailable)
    }
}
pub fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}

#[derive(Clone)]
pub struct SyntheticWitness {
    raw: Value,
    digest: String,
}

pub struct SyntheticGraph {
    targets: Vec<Value>,
}

pub struct SyntheticAuthority<'p> {
    pub principal: &'p VerifiedActor,
    pub observations: Observations,
}

impl SyntheticAuthority<'_> {
    fn principal(&self, principal: &VerifiedActor) {
        assert!(std::ptr::eq(principal, self.principal));
    }
    fn scoped(&self, principal: &VerifiedActor, request: &ValidatedRequest) {
        self.principal(principal);
        assert_eq!(request.context().workspace_id, principal.workspace_id);
        assert_eq!(request.context().home_id, principal.home_id);
    }
    fn coupled(
        &self,
        principal: &VerifiedActor,
        prepared: &PreparedRequest<SyntheticWitness, SyntheticGraph>,
        request: &ValidatedRequest,
    ) {
        self.scoped(principal, request);
        assert_eq!(prepared.witness().raw, *prepared.request().raw());
        assert_eq!(
            prepared.witness().digest,
            prepared.request().intent_digest()
        );
        assert!(
            request.raw() == prepared.request().raw()
                || prepared
                    .request()
                    .children()
                    .iter()
                    .any(|child| child.raw() == request.raw())
        );
    }
}

impl StockAuthorityPort<VerifiedActor> for SyntheticAuthority<'_> {
    type Witness = SyntheticWitness;
    type Graph = SyntheticGraph;
    fn capture(
        &self,
        principal: &VerifiedActor,
        request: &ValidatedRequest,
    ) -> StockResult<SyntheticWitness> {
        self.scoped(principal, request);
        self.observations
            .borrow_mut()
            .push(json!({"kind":"capture","requestId":request.request_id()}));
        Ok(SyntheticWitness {
            raw: request.raw().clone(),
            digest: request.intent_digest().to_owned(),
        })
    }
    fn authorize_graph(
        &self,
        principal: &VerifiedActor,
        witness: &SyntheticWitness,
        request: &ValidatedRequest,
        graph: &SyntheticGraph,
    ) -> StockResult<()> {
        self.scoped(principal, request);
        assert_eq!(witness.raw, *request.raw());
        assert_eq!(witness.digest, request.intent_digest());
        assert!(!graph.targets.is_empty());
        Ok(())
    }
    fn revalidate(
        &self,
        principal: &VerifiedActor,
        witness: &SyntheticWitness,
        request: &ValidatedRequest,
    ) -> StockResult<()> {
        self.scoped(principal, request);
        assert_eq!(witness.raw, *request.raw());
        assert_eq!(witness.digest, request.intent_digest());
        self.observations
            .borrow_mut()
            .push(json!({"kind":"revalidate","requestId":request.request_id()}));
        Ok(())
    }
    fn authorize_result(
        &self,
        principal: &VerifiedActor,
        prepared: &PreparedRequest<SyntheticWitness, SyntheticGraph>,
        request: &ValidatedRequest,
        result: &Value,
    ) -> StockResult<()> {
        self.coupled(principal, prepared, request);
        assert_eq!(result["requestId"], request.request_id());
        assert_eq!(result["commandId"], request.id().as_str());
        self.observations
            .borrow_mut()
            .push(json!({"kind":"resultDisclosure","requestId":request.request_id()}));
        Ok(())
    }
    fn disclose(
        &self,
        principal: &VerifiedActor,
        prepared: &PreparedRequest<SyntheticWitness, SyntheticGraph>,
        request: &ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: DisclosurePurpose,
    ) -> StockResult<()> {
        self.coupled(principal, prepared, request);
        assert_eq!(target, request.target());
        assert_eq!(&row["target"], target);
        assert!(prepared.graph().targets.contains(target));
        self.observations.borrow_mut().push(json!({"kind":"rowDisclosure","requestId":request.request_id(),"purpose":format!("{purpose:?}")}));
        Ok(())
    }
}

pub struct SyntheticPreparer;
impl StockPreparerPort<VerifiedActor, SyntheticWitness> for SyntheticPreparer {
    type Graph = SyntheticGraph;
    fn resolve(
        &mut self,
        _: &VerifiedActor,
        witness: &SyntheticWitness,
        request: &ValidatedRequest,
    ) -> StockResult<SyntheticGraph> {
        assert_eq!(witness.raw, *request.raw());
        let targets = if request.children().is_empty() {
            vec![request.target().clone()]
        } else {
            request
                .children()
                .iter()
                .map(|child| child.target().clone())
                .collect()
        };
        Ok(SyntheticGraph { targets })
    }
}

/// The original prepared request and verified principal stay borrowed across
/// every callback. No callback reacquires access or reads a storage connection.
pub struct SyntheticScopedAuthorization<'p, 'r> {
    pub principal: &'p VerifiedActor,
    pub prepared: &'r PreparedRequest<SyntheticWitness, SyntheticGraph>,
    pub observations: Observations,
}
impl SyntheticScopedAuthorization<'_, '_> {
    fn scoped(&self, principal: &VerifiedActor, scope: &Scope) {
        assert!(std::ptr::eq(principal, self.principal));
        assert_eq!(scope.workspace_id, principal.workspace_id);
        assert_eq!(scope.home_id, principal.home_id);
        assert_eq!(self.prepared.witness().raw, *self.prepared.request().raw());
        assert_eq!(
            self.prepared.witness().digest,
            self.prepared.request().intent_digest()
        );
    }
}
impl Authorization for SyntheticScopedAuthorization<'_, '_> {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> storage::Result<VerifiedActor> {
        self.scoped(principal, request.scope);
        self.observations.borrow_mut().push(json!({
            "kind":"nativeAuthorization","capability":format!("{:?}",request.capability),
            "mutationPhase":request.mutation.map(|context| context.phase)
        }));
        Ok(principal.clone())
    }
}
impl StockAuthorization for SyntheticScopedAuthorization<'_, '_> {
    fn authorize_stock_mutation(
        &self,
        principal: &VerifiedActor,
        frame: StockMutationFrame<'_>,
    ) -> storage::Result<VerifiedActor> {
        self.scoped(principal, &frame.native.scope);
        assert_eq!(frame.plan.original_request(), self.prepared.request().raw());
        assert_eq!(
            frame.plan.request_digest(),
            self.prepared.request().intent_digest()
        );
        assert!(frame.native.replay.is_none());
        if frame.plan.batch_target_id().is_some() {
            assert_eq!(frame.plan.root_guards().len(), 1);
            let root = &frame.plan.root_guards()[0].record;
            assert_eq!(root.record_id, id(201));
            assert!(frame.closure.record_refs.contains(root));
            assert!(!frame.native.closure.record_refs.contains(root));
            for group in frame.plan.groups() {
                assert_eq!(group.native_entries().len(), 1);
                assert_eq!(group.native_entries()[0].command.guards.len(), 1);
                assert_eq!(
                    group.native_entries()[0].command.guards[0].record.record_id,
                    id(100)
                );
            }
        }
        if let Some(commit) = frame.commit {
            assert_eq!(commit.original_request, *self.prepared.request().raw());
            assert_eq!(
                commit.request_digest,
                self.prepared.request().intent_digest()
            );
            assert_eq!(commit.actor_id, principal.actor_id);
        }
        self.observations.borrow_mut().push(json!({
            "kind":"stockAuthorization","requestId":self.prepared.request().request_id(),
            "phase":frame.native.phase,"commitPresent":frame.commit.is_some()
        }));
        Ok(principal.clone())
    }
    fn authorize_stock_history(
        &self,
        principal: &VerifiedActor,
        frame: StockHistoryFrame<'_>,
    ) -> storage::Result<VerifiedActor> {
        self.scoped(principal, frame.scope);
        assert_eq!(frame.request, self.prepared.request().raw());
        assert_eq!(
            frame.target.record_id,
            self.prepared.request().target()["recordId"]
        );
        for audit in frame.audits {
            assert_eq!(audit.record, *frame.target);
            assert_eq!(audit.workspace_id, frame.scope.workspace_id);
            assert_eq!(audit.home_id, frame.scope.home_id);
        }
        if let Some(result) = frame.result {
            assert_eq!(
                result.wire["requestId"],
                self.prepared.request().request_id()
            );
            for entry in result.wire["data"]["entries"]
                .as_array()
                .expect("accepted history entries")
            {
                assert_eq!(entry["target"], *self.prepared.request().target());
                let audit = frame
                    .audits
                    .iter()
                    .find(|audit| entry["eventId"] == audit.audit_id)
                    .expect("durable event audit link");
                assert_eq!(entry["beforeDigest"], json!(audit.before_digest));
                assert_eq!(entry["afterDigest"], audit.after_digest);
            }
        }
        self.observations.borrow_mut().push(json!({
            "kind":"historyAuthorization","requestId":self.prepared.request().request_id(),
            "auditCount":frame.audits.len(),"resultPresent":frame.result.is_some()
        }));
        Ok(principal.clone())
    }
}

/// Store baseline peer is separately synthetic. It supplies no real live guard.
pub struct SyntheticStoreAuthorization;
impl Authorization for SyntheticStoreAuthorization {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> storage::Result<VerifiedActor> {
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        Ok(principal.clone())
    }
}

pub struct SyntheticRuntime {
    next: Cell<u64>,
}
impl SyntheticRuntime {
    pub fn new() -> Self {
        Self {
            next: Cell::new(90_000),
        }
    }
}
impl Runtime for SyntheticRuntime {
    fn now(&self) -> storage::Result<String> {
        Ok("2026-01-03T12:00:00Z".to_owned())
    }
    fn new_id(&self) -> storage::Result<String> {
        let next = self.next.get();
        self.next.set(next + 1);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &Record) -> storage::Result<AssetProof> {
        Err(storage::Error::new(
            "upstream-unavailable",
            "No staged media peer in this synthetic example",
        ))
    }
}
