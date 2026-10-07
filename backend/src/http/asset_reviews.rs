//! Process-local custody of genuine existing-asset renderer receipts.
//! The selector is never an authorization or a serialized substitute for proof.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response, stock_reads,
};
use crate::{
    access as a,
    app::{Core, RequestPrincipal},
    domain::{self as d, stock as st},
    http::contracts::NativeContracts,
    media::{self as m, review::RenderedAssetReview},
    storage as s,
};
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
};
use serde_json::{json, to_value};
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

const MAX_RECEIPTS: usize = 64;
const MAX_PER_SESSION: usize = 4;
const RECEIPT_TTL: Duration = Duration::from_secs(300);

fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn media_error(error: m::MediaError) -> super::HttpFailure {
    failure(StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}

// This conversion runs only after a native stock request has been validated.
// It conveys the sanitized error category, never a new grant, current revision,
// or a claim that an uncertain durable commit was rolled back.
fn stock_error(error: super::HttpFailure) -> st::StockError {
    use d::DomainError as D;
    match error.status {
        StatusCode::UNAUTHORIZED => st::StockError::Domain(D::Unauthenticated),
        StatusCode::FORBIDDEN => st::StockError::CapabilityDenied,
        StatusCode::NOT_FOUND => st::StockError::Domain(D::NotFound),
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
            st::StockError::InvalidContract
        }
        StatusCode::PRECONDITION_REQUIRED => st::StockError::Domain(D::RevisionRequired {
            current_revision: error.current_revision,
        }),
        StatusCode::PRECONDITION_FAILED => st::StockError::Domain(D::RevisionConflict {
            current_revision: error.current_revision,
        }),
        StatusCode::CONFLICT => st::StockError::Domain(D::IdentityConflict),
        _ => st::StockError::OwnerUnavailable,
    }
}

/// The command route has already issued a fresh Mutate principal from the
/// actual POST/CSRF request and parsed the native stock envelope. This path
/// consumes only the original Box and same-Store pin found by the selector.
pub(super) fn execute(
    host: &Host,
    core: &Core,
    current: &RequestPrincipal,
    request: &st::ValidatedRequest,
    contracts: &st::NativeStockContract,
    scope: &d::Scope,
) -> HttpResult {
    match execute_validated(host, core, current, request, contracts, scope) {
        Ok(response) => Ok(response),
        Err(error) => super::agents::command_error(stock_error(error), request.request_id()),
    }
}

fn execute_validated(
    host: &Host,
    core: &Core,
    current: &RequestPrincipal,
    request: &st::ValidatedRequest,
    contracts: &st::NativeStockContract,
    scope: &d::Scope,
) -> HttpResult {
    if request.id() != st::OperationId::AtlasAssetReview
        || request.payload()["treatment"] != "request-preview"
        || !request.children().is_empty()
        || request.context().workspace_id != scope.workspace_id
        || request.context().home_id != scope.home_id
    {
        return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
    }
    let asset_id = request.target()["recordId"]
        .as_str()
        .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    let receipt_id = request.payload()["rendererReceiptId"]
        .as_str()
        .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    let taken = {
        let access = core.access.lock().map_err(|_| unavailable())?;
        host.asset_reviews
            .lock()
            .map_err(|_| unavailable())?
            .take(&access, current, scope, asset_id, receipt_id)?
    };
    let TakenReview {
        original,
        pinned,
        rendered,
    } = taken;
    let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
        .map_err(media_error)?;
    let bound = {
        let mut access = core.access.lock().map_err(|_| unavailable())?;
        original.release(&access).map_err(access_error)?;
        let mut proof = None;
        access.with_mutation_authorization::<super::HttpFailure>(
            original.principal.principal(),
            |guard| {
                proof = Some(
                    rendered
                        .bind_request(guard, original.principal.retained(), request, &budget)
                        .map_err(media_error)?,
                );
                Ok(())
            },
        )?;
        proof.ok_or_else(unavailable)?
    };
    let plan = {
        let store = core.store.lock().map_err(|_| unavailable())?;
        store
            .prepare_verified_asset_review(&original, contracts, request.raw(), &pinned, &bound)
            .map_err(|_| unavailable())?
    };
    let result = match super::stock_mutations::execute_verified_asset_review(
        core,
        &original,
        request.raw().clone(),
        &plan,
        &budget,
        contracts,
    ) {
        Ok(result) => result,
        Err(error) => return super::agents::command_error(error, request.request_id()),
    };
    {
        let access = core.access.lock().map_err(|_| unavailable())?;
        original.release(&access).map_err(access_error)?;
        current.release(&access).map_err(access_error)?;
        let native_scope = crate::app::access_scope(scope).map_err(access_error)?;
        access
            .authorize_storage(&original.principal, &native_scope, a::Capability::Mutate)
            .map_err(access_error)?;
        access
            .authorize_storage(&current.principal, &native_scope, a::Capability::Mutate)
            .map_err(access_error)?;
    }
    Ok(json_response(result.wire))
}

struct Entry {
    issued: Instant,
    binding: [u8; 32],
    scope: d::Scope,
    asset_id: String,
    actor_id: String,
    original: Box<RequestPrincipal>,
    pinned: s::AssetReviewOriginal,
    rendered: RenderedAssetReview,
}

/// The original allocation and opaque Media carrier move together into the
/// eventual same-Store consumer. No principal or proof can be rebuilt from data.
pub(super) struct TakenReview {
    pub original: Box<RequestPrincipal>,
    pub pinned: s::AssetReviewOriginal,
    pub rendered: RenderedAssetReview,
}

#[derive(Default)]
pub(crate) struct ReviewRegistry {
    entries: VecDeque<Entry>,
}
impl ReviewRegistry {
    fn prune(&mut self) {
        let now = Instant::now();
        self.entries
            .retain(|entry| now.duration_since(entry.issued) < RECEIPT_TTL);
    }
    fn room(&mut self, binding: &[u8; 32]) -> bool {
        self.prune();
        self.entries.len() < MAX_RECEIPTS
            && self
                .entries
                .iter()
                .filter(|entry| &entry.binding == binding)
                .count()
                < MAX_PER_SESSION
    }
    fn insert(&mut self, entry: Entry) -> Result<(), super::HttpFailure> {
        if !self.room(&entry.binding) {
            return Err(failure(StatusCode::TOO_MANY_REQUESTS));
        }
        self.entries.push_back(entry);
        Ok(())
    }

    /// Call only after freshly authorizing this POST as Mutate against the same
    /// Access owner. Failed validation leaves the receipt untouched; expiry
    /// and successful take remove it. The ID only locates the candidate.
    pub(super) fn take(
        &mut self,
        access: &a::AccessBoundary,
        current: &RequestPrincipal,
        scope: &d::Scope,
        asset_id: &str,
        receipt_id: &str,
    ) -> Result<TakenReview, super::HttpFailure> {
        self.prune();
        let native_scope = crate::app::access_scope(scope).map_err(access_error)?;
        current.release(access).map_err(access_error)?;
        access
            .assert_mutation(current.principal.principal())
            .map_err(access_error)?;
        access
            .authorize_storage(&current.principal, &native_scope, a::Capability::Mutate)
            .map_err(access_error)?;
        let binding = access
            .authenticated_session_binding(current.principal.principal())
            .map_err(access_error)?;
        let index = self
            .entries
            .iter()
            .position(|entry| entry.rendered.receipt_id() == receipt_id)
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        let entry = &self.entries[index];
        if entry.binding != binding
            || &entry.scope != scope
            || entry.asset_id != asset_id
            || entry.actor_id != current.principal.actor_id().as_str()
        {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        entry.original.release(access).map_err(access_error)?;
        access
            .assert_mutation(entry.original.principal.principal())
            .map_err(access_error)?;
        access
            .authorize_storage(
                &entry.original.principal,
                &native_scope,
                a::Capability::Mutate,
            )
            .map_err(access_error)?;
        if access
            .authenticated_session_binding(entry.original.principal.principal())
            .map_err(access_error)?
            != binding
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        let entry = self.entries.remove(index).ok_or_else(unavailable)?;
        Ok(TakenReview {
            original: entry.original,
            pinned: entry.pinned,
            rendered: entry.rendered,
        })
    }
}

pub(super) async fn issue(
    State(host): State<Host>,
    Path((workspace_id, home_id, asset_id)): Path<(String, String, String)>,
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
        .ok_or_else(unavailable)?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let core = host.core.lock().map_err(|_| unavailable())?;
        let url = format!("{}{}", host.origin, uri.path());
        let observed =
            evidence(&host.origin, &checked, &uri, &url, &method).map_err(access_error)?;
        let original = core
            .access
            .lock()
            .map_err(|_| unavailable())?
            .authorize(&observed, &selected, a::Action::Mutate)
            .map_err(access_error)?;
        if !core.homes.iter().any(|home| home.scope == scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        let original = Box::new(RequestPrincipal::new(original));
        let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
            .map_err(media_error)?;
        let binding = {
            let access = core.access.lock().map_err(|_| unavailable())?;
            original.release(&access).map_err(access_error)?;
            access
                .authorize_storage(&original.principal, &selected, a::Capability::Mutate)
                .map_err(access_error)?;
            access
                .authenticated_session_binding(original.principal.principal())
                .map_err(access_error)?
        };
        {
            let mut registry = host.asset_reviews.lock().map_err(|_| unavailable())?;
            if !registry.room(&binding) {
                return Err(failure(StatusCode::TOO_MANY_REQUESTS));
            }
        }
        let storage_scope = s::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        };
        let snapshot = {
            let mut store = core.store.lock().map_err(|_| unavailable())?;
            store
                .read_snapshot(&*original, &storage_scope)
                .map_err(|_| unavailable())?
        };
        s::Contract::validate_snapshot(&NativeContracts, &snapshot).map_err(|_| unavailable())?;
        let current = snapshot
            .records
            .iter()
            .find(|row| {
                row.record_type == s::RecordType::Asset
                    && row.record_id == asset_id
                    && row.workspace_id == scope.workspace_id
                    && row.home_id == scope.home_id
            })
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        let pinned = {
            let target = s::RecordRef {
                record_type: s::RecordType::Asset,
                record_id: asset_id.clone(),
            };
            let mut store = core.store.lock().map_err(|_| unavailable())?;
            store
                .capture_asset_review_original(
                    &*original,
                    original.principal.retained(),
                    &storage_scope,
                    &target,
                )
                .map_err(|_| unavailable())?
        };
        if pinned.record() != current {
            return Err(failure(StatusCode::CONFLICT));
        }
        stock_reads::capture_graph(&core.access, &original, &snapshot)
            .map_err(stock_reads::http_error)?;
        budget.check().map_err(media_error)?;
        let rendered = {
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            original.release(&access).map_err(access_error)?;
            let mut proof = None;
            access.with_mutation_authorization::<super::HttpFailure>(
                original.principal.principal(),
                |guard| {
                    proof = Some(
                        core.vault
                            .qualify_asset_review(
                                guard,
                                original.principal.retained(),
                                current,
                                &budget,
                            )
                            .map_err(media_error)?,
                    );
                    Ok(())
                },
            )?;
            original.release(&access).map_err(access_error)?;
            proof.ok_or_else(unavailable)?
        };
        budget.check().map_err(media_error)?;
        let latest = {
            let mut store = core.store.lock().map_err(|_| unavailable())?;
            store
                .read_snapshot(&*original, &storage_scope)
                .map_err(|_| unavailable())?
        };
        s::Contract::validate_snapshot(&NativeContracts, &latest).map_err(|_| unavailable())?;
        if latest != snapshot {
            return Err(failure(StatusCode::CONFLICT));
        }
        stock_reads::capture_graph(&core.access, &original, &latest)
            .map_err(stock_reads::http_error)?;
        let access = core.access.lock().map_err(|_| unavailable())?;
        original.release(&access).map_err(access_error)?;
        access
            .assert_mutation(original.principal.principal())
            .map_err(access_error)?;
        access
            .authorize_storage(&original.principal, &selected, a::Capability::Mutate)
            .map_err(access_error)?;
        if access
            .authenticated_session_binding(original.principal.principal())
            .map_err(access_error)?
            != binding
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        budget.check().map_err(media_error)?;
        let facts = to_value(rendered.facts()).map_err(|_| unavailable())?;
        let actor_id = original.principal.actor_id().as_str().to_owned();
        let entry = Entry {
            issued: Instant::now(),
            binding,
            scope,
            asset_id,
            actor_id,
            original,
            pinned,
            rendered,
        };
        host.asset_reviews
            .lock()
            .map_err(|_| unavailable())?
            .insert(entry)?;
        Ok(json_response(json!({"receipt":facts})))
    })
    .await
    .map_err(|_| unavailable())?
}
