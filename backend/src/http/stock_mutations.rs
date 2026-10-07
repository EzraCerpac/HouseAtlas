//! Fresh local stock commands through the actual native atomic owner and AT11 fence.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, intake,
    mutations::{self, MutateAuthority, WriteFailure},
    stock_reads::{capture_graph, http_error, snapshot},
};
use crate::{
    access as a,
    app::{Access, Core, RequestPrincipal, ServerRuntime, Store},
    contracts::semantics as sem,
    contracts::{AssetPayloadPreviewPolicy, BindingPayloadSourceState},
    domain::{self as d, stock as st},
    http::contracts::NativeContracts,
    storage as s,
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
enum UploadPlan<'a, 'u> {
    Staged(&'a st::StagedAtlasCommandPlan<'u>),
    Existing(&'a st::ExistingAssetAttachmentPlan<'u>),
}
impl<'a, 'u> UploadPlan<'a, 'u> {
    fn plan(self) -> &'a st::AtlasCommandPlan {
        match self {
            Self::Staged(plan) => plan.plan(),
            Self::Existing(plan) => plan.plan(),
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
struct Preparer<'a, 'u>(&'a Mutex<Store>, Option<UploadPlan<'a, 'u>>);
impl<'p> st::StockPreparerPort<RequestPrincipal, Witness<'p>> for Preparer<'_, '_> {
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
        let derivation = if self.1.is_none() {
            derive(request, &original)?
        } else {
            None
        };
        let child_derivations =
            if self.1.is_none() && request.id() == st::OperationId::AtlasBatchExecute {
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
struct Transaction<'g, 'p, 'w> {
    native: MutateAuthority<'g, 'p>,
    guard: &'g a::TransactionAuthorization<'g>,
    witness: &'w Witness<'p>,
    phase: Cell<Option<s::MutationPhase>>,
    failure: RefCell<Option<d::DomainError>>,
}
impl Transaction<'_, '_, '_> {
    fn check(
        &self,
        p: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
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
        let actor = self
            .native
            .verify(
                p,
                s::AuthorizationRequest {
                    scope: frame.plan.scope(),
                    capability: s::Capability::Mutate,
                    targets: &frame.native.targets,
                    source: None,
                    source_partition: None,
                    mutation: Some(frame.native),
                },
            )
            .map_err(domain)?;
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
                        && receipt.derivation_format.as_deref()
                            == match (&graph.derivation, &graph.child_derivations) {
                                (Some(_), None) => Some(st::ATLAS_DERIVATION_FORMAT),
                                (None, Some(_)) => Some(st::ATLAS_BATCH_DERIVATION_FORMAT),
                                (None, None) => None,
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
impl s::Authorization for Transaction<'_, '_, '_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        r: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.native.authorize(p, r)
    }
}
impl s::StockAuthorization for Transaction<'_, '_, '_> {
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
struct Commands<'a, 'u> {
    store: &'a Mutex<Store>,
    access: &'a Access,
    contracts: st::NativeStockContract,
    upload: Option<UploadPlan<'a, 'u>>,
}
impl<'p> st::StockCommandPort<RequestPrincipal, Witness<'p>, Graph> for Commands<'_, '_> {
    fn execute(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'p>, Graph>,
    ) -> st::StockResult<st::OwnerResult> {
        let w = prepared.witness();
        let graph = prepared.graph();
        supported_profile(prepared.request(), self.upload)?;
        require(!w.committed.get() && w.pending.borrow().is_none())?;
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
                    phase: Cell::new(None),
                    failure: RefCell::new(None),
                };
                let result = if let Some(UploadPlan::Staged(upload)) = self.upload {
                    store.execute_staged_stock_json_with_authorization(
                        &authorization,
                        p,
                        &self.contracts,
                        prepared.request().raw(),
                        upload.staged(),
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
    execute_profile(core, p, raw, contracts, None)
}
pub(super) fn execute_staged(
    core: &Core,
    p: &RequestPrincipal,
    selection: &super::qualified_upload_plan::ResolvedPlace<'_, '_>,
    raw: Value,
    staged: &crate::media::staged_upload::StagedAssetPlan,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let request = st::ValidatedRequest::parse(contracts, raw.clone())?;
    let qualified = super::qualified_upload_plan::qualify(p, selection, &request, staged)?;
    execute_profile(
        core,
        p,
        raw,
        contracts,
        Some(UploadPlan::Staged(&qualified)),
    )
}
/// A standalone asset has no place selection or client-supplied attachment
/// graph. The live Media seal and original principal qualify this exact root.
pub(super) fn execute_staged_asset(
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
    execute_profile(
        core,
        p,
        raw,
        contracts,
        Some(UploadPlan::Staged(&qualified)),
    )
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
    )
}
fn execute_profile(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
    upload: Option<UploadPlan<'_, '_>>,
) -> st::StockResult<st::OwnerResult> {
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
        &mut Preparer(&core.store, upload),
    )?;
    st::dispatch(
        p,
        prepared,
        contracts,
        &authority,
        &mut QueriesUnavailable,
        &mut Commands {
            store: &core.store,
            access: &core.access,
            contracts: contracts.clone(),
            upload,
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
        super::agents::command_response(&core, &principal, raw)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
