//! Fresh local stock commands through the actual native atomic owner and AT11 fence.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, intake,
    mutations::{self, MutateAuthority, WriteFailure},
    stock_reads::{capture_graph, http_error, snapshot},
};
use crate::{
    access as a,
    app::{
        Access, Core, RequestPrincipal, ServerRuntime, Store,
        homebox_presence::ConfiguredPresenceReleased,
        homebox_presence_command::{self, OriginalPresenceCommandExecutor, PresenceCommandError},
        homebox_presence_history::RecordedPresenceHistory,
    },
    contracts::semantics as sem,
    contracts::{AssetPayloadPreviewPolicy, BindingPayloadSourceState},
    domain::{self as d, stock as st},
    http::contracts::NativeContracts,
    media as m, storage as s,
};
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
};
use s::{Contract, Runtime};
use serde_json::Value;
use std::{
    cell::{Cell, OnceCell, RefCell},
    sync::Mutex,
};

fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}
fn domain(error: d::DomainError) -> st::StockError {
    st::StockError::Domain(error)
}
fn require(value: bool) -> st::StockResult<()> {
    if value { Ok(()) } else { Err(changed()) }
}
fn supported(request: &st::ValidatedRequest) -> st::StockResult<()> {
    use st::OperationId as O;
    let mapped = |id| st::atlas_direct_operation(id).is_some();
    if request.id() == O::AtlasBatchExecute {
        if !request.children().is_empty()
            && request
                .children()
                .iter()
                .all(|child| mapped(child.id()) || st::atlas_derived_operation(child.id()))
        {
            Ok(())
        } else {
            Err(st::StockError::CapabilityHeld)
        }
    } else if mapped(request.id()) || st::atlas_derived_operation(request.id()) {
        Ok(())
    } else {
        Err(st::StockError::CapabilityHeld)
    }
}
#[derive(Clone, Copy)]
pub(super) struct ReviewCapture<'a> {
    pub observation: &'a s::AssetReviewCommitObservation,
    pub archive: Option<&'a Mutex<m::native_policy_archive::NativeMediaArchiveOwner>>,
    pub qualified_commit: &'a RefCell<Option<s::StockAtlasCommit>>,
}
#[derive(Clone, Copy)]
struct UploadCapture<'a> {
    observation: &'a s::AssetUploadCommitObservation,
    archive: &'a Mutex<m::native_policy_archive::NativeMediaArchiveOwner>,
    qualified_commit: &'a RefCell<Option<s::StockAtlasCommit>>,
}
#[derive(Clone, Copy)]
enum UploadPlan<'a, 'u> {
    Staged(
        &'a st::StagedAtlasCommandPlan<'u>,
        Option<UploadCapture<'a>>,
    ),
    Existing(&'a st::ExistingAssetAttachmentPlan<'u>),
    Review(
        &'a s::VerifiedAssetReviewPlan<'u>,
        &'a m::WorkBudget,
        ReviewCapture<'a>,
    ),
}
impl<'a, 'u> UploadPlan<'a, 'u> {
    fn plan(self) -> &'a st::AtlasCommandPlan {
        match self {
            Self::Staged(plan, _) => plan.plan(),
            Self::Existing(plan) => plan.plan(),
            Self::Review(plan, _, _) => plan.plan(),
        }
    }
}
fn supported_profile(
    request: &st::ValidatedRequest,
    upload: Option<UploadPlan<'_, '_>>,
) -> st::StockResult<()> {
    if let Some(upload) = upload {
        require(upload.plan().original_request() == request.raw())
    } else {
        supported(request)
    }
}
#[derive(Clone)]
struct Graph {
    original: s::Snapshot,
    plan: st::AtlasCommandPlan,
    request: st::ValidatedRequest,
    derivation: Option<st::AtlasDerivation>,
    child_derivations: Option<Vec<Option<st::AtlasDerivation>>>,
    review_facts: Option<Value>,
}

// Derivation is owner data from the same authorized snapshot, never client
// authority. Newly asserted source presence and renderer receipts remain held.
fn derive(
    request: &st::ValidatedRequest,
    original: &s::Snapshot,
) -> st::StockResult<Option<st::AtlasDerivation>> {
    use st::{AtlasDerivation as D, OperationId as O};
    if !st::atlas_derived_operation(request.id()) {
        return Ok(None);
    }
    let preimage = || {
        original
            .records
            .iter()
            .find(|row| {
                row.workspace_id == request.context().workspace_id
                    && row.home_id == request.context().home_id
                    && request.target()["recordId"] == row.record_id
                    && request.target()["recordType"] == row.record_type.as_str()
            })
            .cloned()
            .ok_or(st::StockError::Domain(d::DomainError::NotFound))
    };
    Ok(Some(match request.id() {
        O::AtlasBindingCreate => D::BindingCreate {
            source_state: BindingPayloadSourceState::Unresolved,
        },
        O::AtlasBindingReview => D::BindingReview {
            original: preimage()?,
        },
        O::AtlasBindingRestore => D::BindingRestore {
            original: preimage()?,
        },
        O::AtlasBindingRemap => D::BindingRemap {
            original: preimage()?,
            source_state: BindingPayloadSourceState::Unresolved,
        },
        O::AtlasGeometryCreate => D::GeometryCreate {
            imported_at: ServerRuntime
                .now()
                .map_err(|e| domain(crate::app::storage_error(e)))?,
        },
        O::AtlasAssetReview => D::AssetReview {
            original: preimage()?,
            preview_policy: match request.payload()["treatment"].as_str() {
                Some("block") => AssetPayloadPreviewPolicy::Blocked,
                Some("download-only") => AssetPayloadPreviewPolicy::DownloadOnly,
                _ => return Err(st::StockError::CapabilityHeld),
            },
            renderer_receipt_id: None,
        },
        _ => return Err(st::StockError::CapabilityHeld),
    }))
}

#[derive(Clone, Copy)]
pub(super) struct ConfiguredPresenceInput<'a, 'origin, 'reader> {
    pub publications: &'a [&'a ConfiguredPresenceReleased<'origin, 'reader>],
    pub age: &'a d::qualified::ConfiguredCacheAge,
    pub observation: &'a s::StockPresenceCommittedObservation,
    pub history: &'a RefCell<Option<std::sync::Arc<RecordedPresenceHistory>>>,
}

/// An explicit, previously closed native publication may select Present for
/// one asserted HomeBox binding source. Actual atomic qualification remains in
/// Storage; the selected derivation is only planned command data.
fn derive_configured_presence(
    request: &st::ValidatedRequest,
    original: &s::Snapshot,
    publications: &[&ConfiguredPresenceReleased<'_, '_>],
) -> st::StockResult<st::AtlasDerivation> {
    require(request.children().is_empty())?;
    let source: crate::contracts::SourceKey =
        mutations::convert(&request.payload()["source"]).map_err(domain)?;
    require(source.source_kind == crate::contracts::SourceKeySourceKind::HomeboxEntity)?;
    let matches = publications
        .iter()
        .filter(|publication| {
            let registration = publication.origin().registration();
            registration.workspace_id == request.context().workspace_id
                && registration.home_id == request.context().home_id
                && registration.source_instance_id == source.source_instance_id
                && registration.collection_id == source.collection_id
                && registration.owner == s::SourceOwner::Homebox
                && publication.committed().cache().partition() == registration.partition()
        })
        .count();
    require(matches == 1)?;
    let mut derivation = derive(request, original)?.ok_or(st::StockError::CapabilityHeld)?;
    match &mut derivation {
        st::AtlasDerivation::BindingCreate { source_state }
        | st::AtlasDerivation::BindingRemap { source_state, .. } => {
            *source_state = BindingPayloadSourceState::Present;
        }
        _ => return Err(st::StockError::CapabilityHeld),
    }
    Ok(derivation)
}
struct Committed {
    candidate: s::Snapshot,
    durable: s::Snapshot,
    receipt: s::StockAtlasCommit,
}
struct Witness<'p> {
    principal: &'p RequestPrincipal,
    raw: Value,
    graph: OnceCell<Graph>,
    pending: RefCell<Option<Committed>>,
    committed: Cell<bool>,
}
struct Authority<'p, 'a, 'u> {
    principal: &'p RequestPrincipal,
    access: &'a Access,
    store: &'a Mutex<Store>,
    upload: Option<UploadPlan<'a, 'u>>,
}
impl Authority<'_, '_, '_> {
    fn original(
        &self,
        p: &RequestPrincipal,
        w: &Witness<'_>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        require(std::ptr::eq(p, self.principal) && std::ptr::eq(p, w.principal))?;
        let same = w.raw == *request.raw()
            || w.graph.get().is_some_and(|g| {
                g.request
                    .children()
                    .iter()
                    .any(|child| child.raw() == request.raw())
            });
        require(same)?;
        let scope: d::Scope = mutations::convert(request.context()).map_err(domain)?;
        let scope = crate::app::access_scope(&scope).map_err(|_| changed())?;
        let access = self.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(|_| changed())?;
        access
            .authorize_storage(&p.principal, &scope, a::Capability::Mutate)
            .map_err(|_| changed())?;
        Ok(())
    }
}
impl<'p> st::StockAuthorityPort<RequestPrincipal> for Authority<'p, '_, '_> {
    type Witness = Witness<'p>;
    type Graph = Graph;
    fn capture(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Self::Witness> {
        supported_profile(request, self.upload)?;
        let witness = Witness {
            principal: self.principal,
            raw: request.raw().clone(),
            graph: OnceCell::new(),
            pending: RefCell::new(None),
            committed: Cell::new(false),
        };
        self.original(p, &witness, request)?;
        Ok(witness)
    }
    fn authorize_graph(
        &self,
        p: &RequestPrincipal,
        w: &Witness<'_>,
        request: &st::ValidatedRequest,
        graph: &Graph,
    ) -> st::StockResult<()> {
        self.original(p, w, request)?;
        require(
            graph.request.raw() == request.raw() && graph.plan.original_request() == request.raw(),
        )?;
        capture_graph(self.access, p, &graph.original)?;
        let entries = graph
            .plan
            .groups()
            .iter()
            .flat_map(|g| g.native_entries().iter().cloned())
            .collect::<Vec<_>>();
        let closure =
            mutations::native_closure(graph.plan.scope(), &graph.original, None, &entries, None)
                .map_err(domain)?;
        {
            let access = self.access.lock().map_err(|_| unavailable())?;
            p.capture_sources(&access, &closure)
                .map_err(|_| changed())?;
        }
        w.graph.set(graph.clone()).map_err(|_| changed())?;
        p.seal_source_capture();
        self.original(p, w, request)
    }
    fn revalidate(
        &self,
        p: &RequestPrincipal,
        w: &Witness<'_>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        self.original(p, w, request)?;
        let graph = w.graph.get().ok_or_else(changed)?;
        let current = snapshot(self.store, p, &graph.request)?;
        if w.committed.get() {
            let pin = w.pending.borrow();
            require(pin.as_ref().is_some_and(|pin| pin.durable == current))?;
        } else {
            require(current == graph.original)?;
        }
        self.original(p, w, request)
    }
    fn authorize_result(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'_>, Graph>,
        request: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        let w = prepared.witness();
        self.revalidate(p, w, request)?;
        require(w.committed.get())?;
        let pin = w.pending.borrow();
        let pin = pin.as_ref().ok_or_else(changed)?;
        if request.raw() == prepared.request().raw() {
            require(pin.receipt.wire == *result)?;
        } else {
            let index = prepared
                .request()
                .children()
                .iter()
                .position(|child| child.raw() == request.raw())
                .ok_or_else(changed)?;
            require(pin.receipt.children.get(index) == Some(result))?;
        }
        Ok(())
    }
    fn disclose(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'_>, Graph>,
        request: &st::ValidatedRequest,
        target: &Value,
        _row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        require(prepared.witness().committed.get())?;
        if request.id() == st::OperationId::AtlasBindingRemap {
            let graph = prepared.graph();
            require(purpose == st::DisclosurePurpose::RemapRecord)?;
            let child_index = if prepared.request().raw() == request.raw() {
                None
            } else {
                Some(
                    prepared
                        .request()
                        .children()
                        .iter()
                        .position(|child| child.raw() == request.raw())
                        .ok_or_else(changed)?,
                )
            };
            let group = graph
                .plan
                .groups()
                .iter()
                .find(|group| {
                    group.child_index() == child_index
                        && group.original_request() == request.raw()
                        && group.request_digest() == request.intent_digest()
                })
                .ok_or_else(changed)?;
            require(group.native_entries().iter().any(|entry| {
                target["authority"] == "atlas"
                    && target["recordType"] == entry.target.record_type.as_str()
                    && target["recordId"] == entry.target.record_id
            }))?;
        } else {
            require(purpose == st::DisclosurePurpose::ExactTarget && target == request.target())?;
        }
        let pin = prepared.witness().pending.borrow();
        let pin = pin.as_ref().ok_or_else(changed)?;
        require(pin.candidate.records.iter().any(|row| {
            row.workspace_id == request.context().workspace_id
                && row.home_id == request.context().home_id
                && target["recordId"] == row.record_id
                && target["recordType"] == row.record_type.as_str()
        }))
    }
}
struct Preparer<'a, 'u, 'origin, 'reader>(
    &'a Mutex<Store>,
    Option<UploadPlan<'a, 'u>>,
    Option<ConfiguredPresenceInput<'a, 'origin, 'reader>>,
);
impl<'p> st::StockPreparerPort<RequestPrincipal, Witness<'p>> for Preparer<'_, '_, '_, '_> {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &RequestPrincipal,
        w: &Witness<'p>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        require(std::ptr::eq(p, w.principal) && w.raw == *request.raw())?;
        supported_profile(request, self.1)?;
        let original = snapshot(self.0, p, request)?;
        if let Some(UploadPlan::Review(plan, _, _)) = self.1 {
            let st::AtlasDerivation::AssetReview {
                original: pinned, ..
            } = plan.derivation()
            else {
                return Err(changed());
            };
            require(original.records.iter().any(|row| row == pinned))?;
        }
        let derivation = match self.1 {
            Some(UploadPlan::Review(plan, _, _)) => Some(plan.derivation().clone()),
            Some(_) => None,
            None => match self.2 {
                Some(input) => Some(derive_configured_presence(
                    request,
                    &original,
                    input.publications,
                )?),
                None => derive(request, &original)?,
            },
        };
        let review_facts = match self.1 {
            Some(UploadPlan::Review(plan, _, _)) => {
                Some(serde_json::to_value(plan.retained_facts()).map_err(|_| unavailable())?)
            }
            _ => None,
        };
        let child_derivations = if self.1.is_none()
            && self.2.is_none()
            && request.id() == st::OperationId::AtlasBatchExecute
        {
            let vector = request
                .children()
                .iter()
                .map(|child| derive(child, &original))
                .collect::<st::StockResult<Vec<_>>>()?;
            vector.iter().any(Option::is_some).then_some(vector)
        } else {
            None
        };
        Ok(Graph {
            plan: match self.1 {
                Some(upload) => upload.plan().clone(),
                None => match (&derivation, &child_derivations) {
                    (Some(derivation), None) => {
                        st::plan_derived_atlas_commands(request, derivation, &NativeContracts)?
                    }
                    (None, Some(vector)) => {
                        st::plan_derived_atlas_batch_commands(request, vector, &NativeContracts)?
                    }
                    (None, None) => st::plan_atlas_commands(request, &NativeContracts)?,
                    _ => return Err(changed()),
                },
            },
            original,
            derivation,
            child_derivations,
            review_facts,
            request: request.clone(),
        })
    }
}
fn same_plan(left: &st::AtlasCommandPlan, right: &st::AtlasCommandPlan) -> bool {
    left.original_request() == right.original_request()
        && left.request_digest() == right.request_digest()
        && left.scope() == right.scope()
        && left.root_idempotency_key() == right.root_idempotency_key()
        && left.batch_target_id() == right.batch_target_id()
        && left.root_guards() == right.root_guards()
        && left.groups().len() == right.groups().len()
        && left.groups().iter().zip(right.groups()).all(|(a, b)| {
            a.child_index() == b.child_index()
                && a.original_request() == b.original_request()
                && a.request_digest() == b.request_digest()
                && a.native_entries() == b.native_entries()
        })
}
struct Transaction<'g, 'tx, 'p, 'w, 'i> {
    native: MutateAuthority<'g, 'tx, 'p>,
    guard: &'g a::TransactionAuthorization<'tx>,
    witness: &'w Witness<'p>,
    prepared: &'w st::PreparedRequest<Witness<'p>, Graph>,
    presence_invocation: Option<&'i s::StockPresenceCommandInvocation>,
    phase: Cell<Option<s::MutationPhase>>,
    failure: RefCell<Option<d::DomainError>>,
}
impl Transaction<'_, '_, '_, '_, '_> {
    fn check(
        &self,
        p: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
    ) -> st::StockResult<s::VerifiedActor> {
        self.check_inner(p, frame, None)
    }
    fn check_presence(
        &self,
        p: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
        qualified: &s::StockPresenceQualifiedPhase<'_>,
    ) -> st::StockResult<s::VerifiedActor> {
        self.check_inner(p, frame, Some(qualified))
    }
    fn check_inner(
        &self,
        p: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
        qualified: Option<&s::StockPresenceQualifiedPhase<'_>>,
    ) -> st::StockResult<s::VerifiedActor> {
        let graph = self.witness.graph.get().ok_or_else(changed)?;
        require(std::ptr::eq(p, self.witness.principal) && !self.witness.committed.get())?;
        require(
            same_plan(frame.plan, &graph.plan)
                && frame.native.original == graph.original
                && frame.native.replay.is_none(),
        )?;
        let entries = graph
            .plan
            .groups()
            .iter()
            .flat_map(|g| g.native_entries().iter().cloned())
            .collect::<Vec<_>>();
        require(frame.native.entries == entries)?;
        let native_request = s::AuthorizationRequest {
            scope: frame.plan.scope(),
            capability: s::Capability::Mutate,
            targets: &frame.native.targets,
            source: None,
            source_partition: None,
            mutation: Some(frame.native),
        };
        let actor = if let Some(qualified) = qualified {
            require(
                self.presence_invocation
                    .is_some_and(|invocation| qualified.matches_invocation(invocation))
                    && qualified.matches_original_preparation(p, self.prepared)
                    && qualified.matches_principal_and_guard(self.guard, p, frame.native)
                    && matches!(
                        (qualified.phase(), frame.native.phase),
                        (
                            s::StockPresenceAuthorizationPhase::Candidate,
                            s::MutationPhase::Candidate
                        ) | (
                            s::StockPresenceAuthorizationPhase::Precommit,
                            s::MutationPhase::Precommit
                        )
                    ),
            )?;
            self.native
                .verify_presence(p, native_request, qualified)
                .map_err(domain)?
        } else {
            self.native.verify(p, native_request).map_err(domain)?
        };
        // This is detached data from the genuine owner's extended closure;
        // ReferenceClosure intentionally has no Deserialize implementation.
        let closure = sem::ReferenceClosure {
            record_refs: mutations::convert(&frame.closure.record_refs).map_err(domain)?,
            missing_record_refs: mutations::convert(&frame.closure.missing_record_refs)
                .map_err(domain)?,
            source_refs: mutations::convert(&frame.closure.source_refs).map_err(domain)?,
            source_partitions: mutations::convert(&frame.closure.source_partitions)
                .map_err(domain)?,
        };
        p.release_guard(self.guard, &closure)
            .map_err(|e| domain(mutations::access_domain(e)))?;
        let expected = match self.phase.get() {
            None => s::MutationPhase::Intake,
            Some(s::MutationPhase::Intake) => s::MutationPhase::Validate,
            Some(s::MutationPhase::Validate) => s::MutationPhase::Candidate,
            Some(s::MutationPhase::Candidate) => s::MutationPhase::Precommit,
            _ => return Err(changed()),
        };
        require(frame.native.phase == expected)?;
        match expected {
            s::MutationPhase::Intake | s::MutationPhase::Validate => {
                require(frame.native.candidate.is_none() && frame.commit.is_none())?
            }
            s::MutationPhase::Candidate | s::MutationPhase::Precommit => {
                let candidate = frame.native.candidate.as_ref().ok_or_else(changed)?;
                let receipt = frame.commit.ok_or_else(changed)?;
                require(
                    !receipt.replayed
                        && receipt.original_request == *graph.plan.original_request()
                        && receipt.request_digest == graph.plan.request_digest()
                        && receipt.wire["commandId"] == graph.request.id().as_str()
                        && receipt.wire["operationId"] == receipt.operation_id
                        && receipt.actor_id == actor.actor_id
                        && receipt.groups.len() == graph.plan.groups().len()
                        && receipt.derivation == graph.derivation
                        && receipt.child_derivations == graph.child_derivations
                        && serde_json::to_value(&receipt.asset_review)
                            .map_err(|_| unavailable())?
                            == graph.review_facts.clone().unwrap_or(Value::Null)
                        && receipt.derivation_format.as_deref()
                            == match (
                                &graph.derivation,
                                &graph.child_derivations,
                                &graph.review_facts,
                            ) {
                                (Some(_), None, Some(_)) => {
                                    Some(s::ATLAS_VERIFIED_ASSET_REVIEW_FORMAT)
                                }
                                (Some(_), None, None) => Some(st::ATLAS_DERIVATION_FORMAT),
                                (None, Some(_), None) => Some(st::ATLAS_BATCH_DERIVATION_FORMAT),
                                (None, None, None) => None,
                                _ => return Err(changed()),
                            },
                )?;
                for (actual, group) in receipt.groups.iter().zip(graph.plan.groups()) {
                    let expected_operation = match group.child_index() {
                        Some(index) => graph
                            .request
                            .children()
                            .get(index)
                            .ok_or_else(changed)?
                            .id(),
                        None => graph.request.id(),
                    };
                    require(
                        actual.child_index == group.child_index()
                            && actual.original_request == *group.original_request()
                            && actual.request_digest == group.request_digest()
                            && actual.original_request["commandId"] == expected_operation.as_str()
                            && match group.child_index() {
                                Some(index) => receipt.children.get(index).is_some_and(|child| {
                                    child["operationId"] == actual.operation_id
                                        && child["commandId"] == expected_operation.as_str()
                                }),
                                None => actual.operation_id == receipt.operation_id,
                            }
                            && actual.native_entries == group.native_entries(),
                    )?;
                }
                let mut pin = self.witness.pending.borrow_mut();
                if expected == s::MutationPhase::Candidate {
                    require(pin.is_none())?;
                    // The native owner persists canonical JSON. Preserve exact raw
                    // Candidate–Precommit equality separately from the durable image.
                    let durable = NativeContracts
                        .canonical_json(
                            &serde_json::to_value(candidate).map_err(|_| unavailable())?,
                        )
                        .map_err(|e| domain(crate::app::storage_error(e)))?;
                    let durable = serde_json::from_str(&durable).map_err(|_| unavailable())?;
                    *pin = Some(Committed {
                        candidate: candidate.clone(),
                        durable,
                        receipt: receipt.clone(),
                    });
                } else {
                    require(pin.as_ref().is_some_and(|pin| {
                        pin.candidate == *candidate && pin.receipt == *receipt
                    }))?;
                }
            }
            _ => return Err(changed()),
        }
        self.phase.set(Some(expected));
        Ok(actor)
    }
}
impl s::Authorization for Transaction<'_, '_, '_, '_, '_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        r: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.native.authorize(p, r)
    }
    fn authorize_presence_mutation(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
        qualified: &s::StockPresenceQualifiedPhase<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let phase = match (
            qualified.phase(),
            request.mutation.map(|context| context.phase),
        ) {
            (s::StockPresenceAuthorizationPhase::Candidate, Some(s::MutationPhase::Candidate)) => {
                self.phase.get() == Some(s::MutationPhase::Validate)
            }
            (s::StockPresenceAuthorizationPhase::Precommit, Some(s::MutationPhase::Precommit)) => {
                self.phase.get() == Some(s::MutationPhase::Candidate)
            }
            (s::StockPresenceAuthorizationPhase::Release, Some(s::MutationPhase::Precommit)) => {
                self.phase.get() == Some(s::MutationPhase::Precommit)
                    && self.witness.pending.borrow().is_some()
            }
            _ => false,
        };
        if !phase
            || !std::ptr::eq(p, self.witness.principal)
            || !self
                .presence_invocation
                .is_some_and(|invocation| qualified.matches_invocation(invocation))
            || !qualified.matches_original_preparation(p, self.prepared)
            || !request.mutation.is_some_and(|context| {
                qualified.matches_principal_and_guard(self.guard, p, context)
            })
        {
            return Err(s::Error::new(
                "upstream-unavailable",
                "Original presence invocation was not accepted",
            ));
        }
        self.native
            .authorize_presence_mutation(p, request, qualified)
    }
}
impl s::StockAuthorization for Transaction<'_, '_, '_, '_, '_> {
    fn authorize_stock_mutation(
        &self,
        p: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.check(p, frame).map_err(|error| {
            *self.failure.borrow_mut() = Some(match error {
                st::StockError::Domain(e) => e,
                _ => d::DomainError::UpstreamUnavailable,
            });
            s::Error::new(
                "upstream-unavailable",
                "Original stock transaction was not accepted",
            )
        })
    }
    fn authorize_presence_stock_mutation(
        &self,
        p: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
        qualified: &s::StockPresenceQualifiedPhase<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.check_presence(p, frame, qualified).map_err(|error| {
            *self.failure.borrow_mut() = Some(match error {
                st::StockError::Domain(e) => e,
                _ => d::DomainError::UpstreamUnavailable,
            });
            s::Error::new(
                "upstream-unavailable",
                "Qualified stock transaction was not accepted",
            )
        })
    }
    fn authorize_stock_history(
        &self,
        _: &RequestPrincipal,
        _: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        Err(s::Error::new(
            "upstream-unavailable",
            "Stock history is not mounted",
        ))
    }
}
struct ConfiguredExecutor<'call, 'principal, 'contracts> {
    principal: &'principal RequestPrincipal,
    prepared: &'call st::PreparedRequest<Witness<'principal>, Graph>,
    contracts: &'contracts st::NativeStockContract,
    observation: &'contracts s::StockPresenceCommittedObservation,
}
impl<'call, 'principal: 'call, 'contracts, 'origin, 'reader>
    OriginalPresenceCommandExecutor<'call, 'origin, 'reader, Witness<'principal>, Graph>
    for ConfiguredExecutor<'call, 'principal, 'contracts>
{
    fn execute<'phase, 'tx>(
        &mut self,
        store: &mut Store,
        guard: &'phase a::TransactionAuthorization<'tx>,
        peers: s::StockPresenceCommandPeers<'phase, 'call, 'tx, 'origin, 'reader>,
        invocation: &s::StockPresenceCommandInvocation,
    ) -> Result<s::StockPresenceStorageReleasedCut<'call, 'origin, 'reader>, PresenceCommandError>
    {
        let graph = self.prepared.graph();
        let entries = graph
            .plan
            .groups()
            .iter()
            .flat_map(|group| group.native_entries().iter().cloned())
            .collect();
        let transaction = Transaction {
            native: MutateAuthority::new(
                guard,
                self.principal,
                graph.plan.scope().clone(),
                entries,
                None,
            ),
            guard,
            witness: self.prepared.witness(),
            prepared: self.prepared,
            presence_invocation: Some(invocation),
            phase: Cell::new(None),
            failure: RefCell::new(None),
        };
        let mapping = match (&graph.derivation, &graph.child_derivations) {
            (Some(derivation), None) => s::PresenceCommandMapping::Derived(derivation),
            (None, Some(vector)) => s::PresenceCommandMapping::DerivedBatch(vector),
            (None, None) => s::PresenceCommandMapping::Direct,
            _ => return Err(PresenceCommandError::Unavailable),
        };
        let released = store.execute_presence_stock_json_with_authorization(
            &transaction,
            self.principal,
            self.contracts,
            self.prepared.request().raw(),
            mapping,
            peers,
            self.observation,
        )?;
        if transaction.phase.get() != Some(s::MutationPhase::Precommit)
            || self.prepared.witness().pending.borrow().is_none()
        {
            return Err(PresenceCommandError::Unavailable);
        }
        Ok(released)
    }
}

struct Commands<'a, 'u, 'origin, 'reader> {
    core: &'a Core,
    store: &'a Mutex<Store>,
    access: &'a Access,
    media_policy: &'a Mutex<m::recovery_policy::MediaPolicyEvidence>,
    contracts: st::NativeStockContract,
    upload: Option<UploadPlan<'a, 'u>>,
    presence: Option<ConfiguredPresenceInput<'a, 'origin, 'reader>>,
}
impl<'p> st::StockCommandPort<RequestPrincipal, Witness<'p>, Graph> for Commands<'_, '_, '_, '_> {
    fn execute(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'p>, Graph>,
    ) -> st::StockResult<st::OwnerResult> {
        let w = prepared.witness();
        let graph = prepared.graph();
        supported_profile(prepared.request(), self.upload)?;
        require(!w.committed.get() && w.pending.borrow().is_none())?;
        if let Some(input) = self.presence {
            require(
                input
                    .history
                    .try_borrow()
                    .map_err(|_| unavailable())?
                    .is_none(),
            )?;
            let mut executor = ConfiguredExecutor {
                principal: p,
                prepared,
                contracts: &self.contracts,
                observation: input.observation,
            };
            let accepted = homebox_presence_command::execute_original_presence_command(
                self.core,
                p,
                prepared,
                input.publications,
                input.age,
                &mut executor,
            )
            .map_err(|_| unavailable())?;
            require(
                w.pending
                    .borrow()
                    .as_ref()
                    .is_some_and(|pin| pin.receipt == *accepted.frame().commit()),
            )?;
            let output = accepted.frame().commit().owner_result();
            let history =
                RecordedPresenceHistory::from_accepted(accepted).map_err(|_| unavailable())?;
            let mut observed = input.history.try_borrow_mut().map_err(|_| unavailable())?;
            require(observed.is_none())?;
            *observed = Some(std::sync::Arc::new(history));
            w.committed.set(true);
            return Ok(output);
        }
        let entries = graph
            .plan
            .groups()
            .iter()
            .flat_map(|g| g.native_entries().iter().cloned())
            .collect::<Vec<_>>();
        let batch = graph.plan.batch_target_id().map(|id| s::BatchMutation {
            schema_version: 1,
            batch_id: id.to_owned(),
            reason: w.raw["reason"].as_str().unwrap_or_default().to_owned(),
            commands: entries.clone(),
        });
        let mut store = self.store.lock().map_err(|_| unavailable())?;
        let mut access = self.access.lock().map_err(|_| unavailable())?;
        let mut output = None;
        access
            .with_mutation_authorization::<WriteFailure>(p.principal.principal(), |guard| {
                let authorization = Transaction {
                    native: MutateAuthority::new(
                        guard,
                        p,
                        graph.plan.scope().clone(),
                        entries.clone(),
                        batch.clone(),
                    ),
                    guard,
                    witness: w,
                    prepared,
                    presence_invocation: None,
                    phase: Cell::new(None),
                    failure: RefCell::new(None),
                };
                let result = if let Some(UploadPlan::Staged(upload, capture)) = self.upload {
                    match capture {
                        Some(capture) => store
                            .execute_staged_stock_json_observing_with_authorization(
                                &authorization,
                                p,
                                &self.contracts,
                                prepared.request().raw(),
                                upload.staged(),
                                capture.observation,
                            ),
                        None => store.execute_staged_stock_json_with_authorization(
                            &authorization,
                            p,
                            &self.contracts,
                            prepared.request().raw(),
                            upload.staged(),
                        ),
                    }
                } else if let Some(UploadPlan::Review(plan, budget, capture)) = self.upload {
                    let peers = s::AssetReviewCommitPeers::new(plan, guard, budget)
                        .observing(capture.observation);
                    store.execute_verified_asset_review_stock_json_with_authorization(
                        &authorization,
                        p,
                        &self.contracts,
                        prepared.request().raw(),
                        peers,
                    )
                } else if let Some(vector) = &graph.child_derivations {
                    store.execute_derived_stock_batch_json_with_authorization(
                        &authorization,
                        p,
                        &self.contracts,
                        prepared.request().raw(),
                        vector,
                    )
                } else if let Some(derivation) = &graph.derivation {
                    store.execute_derived_stock_json_with_authorization(
                        &authorization,
                        p,
                        &self.contracts,
                        prepared.request().raw(),
                        derivation,
                    )
                } else {
                    store.execute_stock_json_with_authorization(
                        &authorization,
                        p,
                        &self.contracts,
                        prepared.request().raw(),
                    )
                };
                let commit = result.map_err(|e| {
                    WriteFailure(
                        authorization
                            .failure
                            .borrow_mut()
                            .take()
                            .or_else(|| authorization.native.take_failure())
                            .unwrap_or_else(|| crate::app::storage_error(e)),
                    )
                })?;
                if authorization.phase.get() != Some(s::MutationPhase::Precommit)
                    || !w
                        .pending
                        .borrow()
                        .as_ref()
                        .is_some_and(|pin| pin.receipt == commit)
                {
                    return Err(WriteFailure(d::DomainError::UpstreamUnavailable));
                }
                // This is the actual successful same-Store commit, while its
                // original Access guard and opaque stage/review proof remain
                // held. DTO consistency alone cannot supply provenance.
                // Retention failure withholds output; the SQL commit remains.
                match self.upload {
                    Some(UploadPlan::Staged(upload, capture))
                        if upload.staged().payload().preview_policy
                            == m::types::PreviewPolicy::SafeRendered =>
                    {
                        self.media_policy
                            .try_lock()
                            .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?
                            .retain_upload(upload.staged(), &commit)
                            .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?;
                        if let Some(capture) = capture {
                            let completion = capture
                                .observation
                                .take_qualified()
                                .ok_or(WriteFailure(d::DomainError::UpstreamUnavailable))?;
                            *capture.qualified_commit.borrow_mut() =
                                Some(completion.commit().clone());
                            capture
                                .archive
                                .try_lock()
                                .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?
                                .publish_upload(
                                    completion,
                                    upload.staged(),
                                    guard,
                                    &m::WorkBudget::new(
                                        std::time::Duration::from_secs(10),
                                        m::Cancellation::default(),
                                    )
                                    .map_err(|_| {
                                        WriteFailure(d::DomainError::UpstreamUnavailable)
                                    })?,
                                )
                                .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?;
                        }
                    }
                    Some(UploadPlan::Review(plan, budget, capture)) => {
                        let asset_id = prepared.request().target()["recordId"]
                            .as_str()
                            .ok_or(WriteFailure(d::DomainError::UpstreamUnavailable))?;
                        let successor = commit
                            .groups
                            .iter()
                            .flat_map(|group| &group.native_results)
                            .find(|result| {
                                result.record.record_type == s::RecordType::Asset
                                    && result.record.record_id == asset_id
                            })
                            .ok_or(WriteFailure(d::DomainError::UpstreamUnavailable))?;
                        self.media_policy
                            .try_lock()
                            .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?
                            .retain_review(
                                plan.media_proof(),
                                guard,
                                p.principal.retained(),
                                &successor.record,
                                &commit,
                                budget,
                            )
                            .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?;
                        if let Some(archive) = capture.archive {
                            let completion = capture
                                .observation
                                .take_qualified()
                                .ok_or(WriteFailure(d::DomainError::UpstreamUnavailable))?;
                            // Preserve exact committed DATA before the one-shot
                            // opaque carrier is consumed, including on errors
                            // after SQL/archive publication. No rollback/retry.
                            *capture.qualified_commit.borrow_mut() =
                                Some(completion.commit().clone());
                            archive
                                .try_lock()
                                .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?
                                .publish_review(completion, plan.media_proof(), guard, budget)
                                .map_err(|_| WriteFailure(d::DomainError::UpstreamUnavailable))?;
                        }
                    }
                    _ => {}
                }
                output = Some(commit);
                Ok(())
            })
            .map_err(|e| domain(e.0))?;
        p.release(&access)
            .map_err(|e| domain(mutations::access_domain(e)))?;
        let commit = output.ok_or_else(unavailable)?;
        w.committed.set(true);
        Ok(commit.owner_result())
    }
}
struct QueriesUnavailable;
impl<W, G> st::StockQueryPort<RequestPrincipal, W, G> for QueriesUnavailable {
    fn query(
        &mut self,
        _: &RequestPrincipal,
        _: &st::PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        Err(unavailable())
    }
}
pub(super) fn execute_raw(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    execute_profile(core, p, raw, contracts, None, None)
}
pub(super) fn execute_staged(
    host: &Host,
    core: &Core,
    p: &RequestPrincipal,
    selection: &super::qualified_upload_plan::ResolvedPlace<'_, '_>,
    raw: Value,
    staged: &crate::media::staged_upload::StagedAssetPlan,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let request = st::ValidatedRequest::parse(contracts, raw.clone())?;
    let qualified = super::qualified_upload_plan::qualify(p, selection, &request, staged)?;
    execute_staged_profile(host, core, p, raw, contracts, &qualified)
}
/// A standalone asset has no place selection or client-supplied attachment
/// graph. The live Media seal and original principal qualify this exact root.
pub(super) fn execute_staged_asset(
    host: &Host,
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    staged: &crate::media::staged_upload::StagedAssetPlan,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let request = st::ValidatedRequest::parse(contracts, raw.clone())?;
    require(
        request.id() == st::OperationId::AtlasAssetCreate
            && request.raw() == staged.request().raw()
            && request.children().is_empty(),
    )?;
    let qualified = st::plan_staged_atlas_commands(&request, staged, &NativeContracts)?;
    execute_staged_profile(host, core, p, raw, contracts, &qualified)
}
/// Only the owning synchronous Core route can call this composition. No lock
/// is held over network I/O. The live stage remains borrowed until publication.
fn execute_staged_profile(
    host: &Host,
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
    qualified: &st::StagedAtlasCommandPlan<'_>,
) -> st::StockResult<st::OwnerResult> {
    let archive = host.native_media_archive.as_deref().filter(|_| {
        qualified.staged().payload().preview_policy == m::types::PreviewPolicy::SafeRendered
    });
    let Some(archive) = archive else {
        return execute_profile(
            core,
            p,
            raw,
            contracts,
            Some(UploadPlan::Staged(qualified, None)),
            None,
        );
    };
    let binding = {
        let access = core.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(|_| changed())?;
        access
            .authenticated_session_binding(p.principal.principal())
            .map_err(|_| changed())?
    };
    if !host
        .asset_reviews
        .try_lock()
        .map_err(|_| unavailable())?
        .upload_room(&binding)
    {
        return Err(unavailable());
    }
    let observation = s::AssetUploadCommitObservation::new();
    let qualified_commit = RefCell::new(None);
    let capture = UploadCapture {
        observation: &observation,
        archive,
        qualified_commit: &qualified_commit,
    };
    let output = execute_profile(
        core,
        p,
        raw,
        contracts,
        Some(UploadPlan::Staged(qualified, Some(capture))),
        None,
    );
    let disposition = qualified_commit
        .into_inner()
        .map(|commit| (commit, true))
        .or_else(|| observation.take());
    if let Some((commit, qualified)) = disposition {
        host.asset_reviews
            .try_lock()
            .map_err(|_| unavailable())?
            .record_upload(
                binding,
                d::Scope {
                    workspace_id: p.principal.scope().workspace_id.as_str().into(),
                    home_id: p.principal.scope().home_id.as_str().into(),
                },
                qualified_staged_asset_id(&commit)?,
                commit,
                qualified,
            )
            .map_err(|_| unavailable())?;
    }
    output
}
fn qualified_staged_asset_id(commit: &s::StockAtlasCommit) -> st::StockResult<String> {
    commit
        .groups
        .iter()
        .flat_map(|group| &group.native_results)
        .find(|result| result.record.record_type == s::RecordType::Asset)
        .map(|result| result.record.record_id.clone())
        .ok_or_else(unavailable)
}
pub(super) fn execute_existing(
    core: &Core,
    p: &RequestPrincipal,
    selection: &super::qualified_upload_plan::ResolvedPlace<'_, '_>,
    raw: Value,
    asset: &s::ExistingOriginalAsset,
    measured: &crate::domain::stock::MeasuredAttachmentOriginal,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let request = st::ValidatedRequest::parse(contracts, raw.clone())?;
    let qualified =
        super::qualified_upload_plan::qualify_existing(p, selection, &request, asset, measured)?;
    execute_profile(
        core,
        p,
        raw,
        contracts,
        Some(UploadPlan::Existing(&qualified)),
        None,
    )
}
/// The opaque Store pin and Media proof remain borrowed by this exact original
/// request allocation throughout native Candidate/Precommit and release.
pub(super) fn execute_verified_asset_review(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    plan: &s::VerifiedAssetReviewPlan<'_>,
    budget: &m::WorkBudget,
    capture: ReviewCapture<'_>,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let request = st::ValidatedRequest::parse(contracts, raw.clone())?;
    require(
        request.id() == st::OperationId::AtlasAssetReview
            && request.payload()["treatment"] == "request-preview"
            && request.children().is_empty()
            && request.raw() == plan.plan().original_request(),
    )?;
    execute_profile(
        core,
        p,
        raw,
        contracts,
        Some(UploadPlan::Review(plan, budget, capture)),
        None,
    )
}
fn execute_profile(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
    upload: Option<UploadPlan<'_, '_>>,
    presence: Option<ConfiguredPresenceInput<'_, '_, '_>>,
) -> st::StockResult<st::OwnerResult> {
    if let Some(presence) = presence {
        require(upload.is_none())?;
        return execute_configured_presence(core, p, raw, presence, contracts);
    }
    let authority = Authority {
        principal: p,
        access: &core.access,
        store: &core.store,
        upload,
    };
    let prepared = st::prepare(
        p,
        raw,
        contracts,
        &authority,
        &mut Preparer(&core.store, upload, None),
    )?;
    st::dispatch(
        p,
        prepared,
        contracts,
        &authority,
        &mut QueriesUnavailable,
        &mut Commands {
            core,
            store: &core.store,
            access: &core.access,
            media_policy: &core.media_policy_evidence,
            contracts: contracts.clone(),
            upload,
            presence: None,
        },
    )
}

/// Only trusted configured native capture owners can supply this input. The
/// existing HTTP route has no default selection or admission into this path.
pub(super) fn execute_configured_presence<'principal, 'input, 'origin, 'reader>(
    core: &Core,
    p: &'principal RequestPrincipal,
    raw: Value,
    presence: ConfiguredPresenceInput<'input, 'origin, 'reader>,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let authority = Authority {
        principal: p,
        access: &core.access,
        store: &core.store,
        upload: None,
    };
    let prepared = st::prepare(
        p,
        raw,
        contracts,
        &authority,
        &mut Preparer(&core.store, None, Some(presence)),
    )?;
    st::dispatch(
        p,
        prepared,
        contracts,
        &authority,
        &mut QueriesUnavailable,
        &mut Commands {
            core,
            store: &core.store,
            access: &core.access,
            media_policy: &core.media_policy_evidence,
            contracts: contracts.clone(),
            upload: None,
            presence: Some(presence),
        },
    )
}
pub(super) async fn command(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> HttpResult {
    if request.uri().query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let scope = d::Scope {
        workspace_id,
        home_id,
    };
    let selected = crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let capture_host = host.clone();
    let capture_checked = checked.clone();
    let capture_scope = scope.clone();
    let principal = tokio::task::spawn_blocking(move || {
        let _admitted = capture_checked.admission_permit()?;
        let core = capture_host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = format!("{}{}", capture_host.origin, uri.path());
        let observed = evidence(&capture_host.origin, &capture_checked, &uri, &url, &method)
            .map_err(access_error)?;
        let principal = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .authorize(&observed, &selected, a::Action::Mutate)
            .map_err(access_error)?;
        if !core.homes.iter().any(|h| h.scope == capture_scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        Ok(RequestPrincipal::new(principal))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))??;
    intake::metadata(&request, 1_048_576)?;
    let bytes = super::admission::body(request.into_body(), 1_048_576).await?;
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let raw = intake::json(&bytes)?;
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let contracts = st::NativeStockContract::new().map_err(http_error)?;
        let request = st::ValidatedRequest::parse(&contracts, raw.clone()).map_err(http_error)?;
        if request.context().workspace_id != scope.workspace_id
            || request.context().home_id != scope.home_id
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        if request.id() == st::OperationId::AtlasAssetReview
            && request.payload()["treatment"] == "request-preview"
        {
            return super::asset_reviews::execute(
                &host, &core, &principal, &request, &contracts, &scope,
            );
        }
        super::agents::command_response(&core, &principal, raw)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
