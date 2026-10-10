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
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const MAX_RECEIPTS: usize = 64;
const MAX_PER_SESSION: usize = 4;
// Withheld committed custody has its own finite backlog. It never consumes a
// live receipt permit; a full backlog blocks writes before owners are taken.
const MAX_DISPOSITIONS: usize = 64;
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
    // Keep the registry guard from the pre-write capacity reservation in take
    // through disposition recording. Postcommit custody neither reacquires the
    // mutex nor performs a fallible allocation or quota check. Access-held
    // registry consumers use try_lock, preserving the existing lock order.
    let mut registry = host.asset_reviews.try_lock().map_err(|_| unavailable())?;
    let taken = {
        let access = core.access.lock().map_err(|_| unavailable())?;
        registry.take(&access, current, scope, asset_id, receipt_id)?
    };
    let TakenReview {
        issued,
        binding,
        scope: retained_scope,
        asset_id: retained_asset_id,
        actor_id,
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
    let observation = s::AssetReviewCommitObservation::new();
    let qualified_commit = std::cell::RefCell::new(None);
    let mut http_released = false;
    let released = (|| -> HttpResult {
        let result = match super::stock_mutations::execute_verified_asset_review(
            core,
            &original,
            request.raw().clone(),
            &plan,
            &budget,
            super::stock_mutations::ReviewCapture {
                observation: &observation,
                archive: host.native_media_archive.as_deref(),
                qualified_commit: &qualified_commit,
            },
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
        http_released = true;
        Ok(json_response(result.wire))
    })();
    let disposition = qualified_commit
        .into_inner()
        .map(|commit| (commit, true))
        .or_else(|| observation.take());
    if let Some((commit, store_qualified)) = disposition {
        registry.record(Disposition {
            issued,
            binding,
            scope: retained_scope,
            asset_id: retained_asset_id,
            actor_id,
            commit,
            store_qualified,
            http_released,
            upload_release: None,
        });
        registry.prune();
    }
    released
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
    issued: Instant,
    binding: [u8; 32],
    scope: d::Scope,
    asset_id: String,
    actor_id: String,
    pub original: Box<RequestPrincipal>,
    pub pinned: s::AssetReviewOriginal,
    pub rendered: RenderedAssetReview,
}

// Private durable data. This is not an authorization token or a response
// receipt; withheld outcomes require separately designed fresh reconciliation.
#[allow(dead_code)]
struct Disposition {
    issued: Instant,
    binding: [u8; 32],
    scope: d::Scope,
    asset_id: String,
    actor_id: String,
    commit: s::StockAtlasCommit,
    store_qualified: bool,
    http_released: bool,
    upload_release: Option<UploadRelease>,
}

/// One process-local allocation shared by a precommit reservation and its
/// final HTTP release. It is never a grant or a serialized receipt.
#[derive(Clone)]
pub(super) struct UploadRelease(Arc<AtomicBool>);
impl UploadRelease {
    pub(super) fn mark_released(&self) {
        self.0.store(true, Ordering::Release);
    }
    fn is_released(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// A private reservation borrowing the still-held registry mutex. No other
/// consumer can change capacity between this reservation and its disposition.
pub(super) struct UploadDispositionReservation<'a> {
    registry: &'a mut ReviewRegistry,
    binding: [u8; 32],
    scope: d::Scope,
    asset_id: String,
    actor_id: String,
    issued: Instant,
    release: UploadRelease,
}
impl UploadDispositionReservation<'_> {
    pub(super) fn release(&self) -> UploadRelease {
        self.release.clone()
    }
    /// All owned fields and deque capacity were prepared before SQL commit.
    /// Preserve unexpected committed DATA too, withholding its qualification.
    pub(super) fn record(self, commit: s::StockAtlasCommit, store_qualified: bool) {
        let matches_original = commit.actor_id == self.actor_id
            && commit
                .groups
                .iter()
                .flat_map(|group| &group.native_results)
                .any(|result| {
                    result.record.record_type == s::RecordType::Asset
                        && result.record.record_id == self.asset_id
                });
        self.registry.dispositions.push_back(Disposition {
            issued: self.issued,
            binding: self.binding,
            scope: self.scope,
            asset_id: self.asset_id,
            actor_id: self.actor_id,
            commit,
            store_qualified: store_qualified && matches_original,
            http_released: false,
            upload_release: Some(self.release),
        });
    }
}

#[derive(Default)]
pub(crate) struct ReviewRegistry {
    entries: VecDeque<Entry>,
    dispositions: VecDeque<Disposition>,
}
impl ReviewRegistry {
    /// Reserve exclusive disposition custody and its allocation before the
    /// synchronous mutation. Access-held consumers use try_lock so this guard
    /// cannot create an Access -> registry -> Store lock cycle.
    pub(super) fn reserve_upload(
        &mut self,
        binding: [u8; 32],
        scope: d::Scope,
        asset_id: String,
        actor_id: String,
    ) -> Result<UploadDispositionReservation<'_>, super::HttpFailure> {
        self.prune();
        self.reserve_disposition()?;
        Ok(UploadDispositionReservation {
            registry: self,
            binding,
            scope,
            asset_id,
            actor_id,
            issued: Instant::now(),
            release: UploadRelease(Arc::new(AtomicBool::new(false))),
        })
    }
    fn prune(&mut self) {
        let now = Instant::now();
        self.entries
            .retain(|entry| now.duration_since(entry.issued) < RECEIPT_TTL);
        self.prune_dispositions(now);
    }
    fn prune_dispositions(&mut self, now: Instant) {
        self.dispositions.retain(|entry| {
            now.duration_since(entry.issued) < RECEIPT_TTL
                && !(entry.store_qualified
                    && (entry.http_released
                        || entry
                            .upload_release
                            .as_ref()
                            .is_some_and(UploadRelease::is_released)))
        });
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
    fn reserve_disposition(&mut self) -> Result<(), super::HttpFailure> {
        // take has already validated an entry index under this registry guard.
        // Reclaim only dispositions here so that index still names that Box.
        self.prune_dispositions(Instant::now());
        if self.dispositions.len() >= MAX_DISPOSITIONS {
            return Err(unavailable());
        }
        self.dispositions.try_reserve(1).map_err(|_| unavailable())
    }
    fn insert(&mut self, entry: Entry) -> Result<(), super::HttpFailure> {
        if !self.room(&entry.binding) {
            return Err(failure(StatusCode::TOO_MANY_REQUESTS));
        }
        self.entries.push_back(entry);
        Ok(())
    }
    // The caller holds this registry continuously from take, which reserved
    // the slot and allocation before moving the original receipt owner.
    fn record(&mut self, disposition: Disposition) {
        self.dispositions.push_back(disposition);
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
        // Capacity failure leaves the authenticated live owner untouched.
        // The consumer must keep this registry guard until recording completes.
        self.reserve_disposition()?;
        let entry = self.entries.remove(index).ok_or_else(unavailable)?;
        Ok(TakenReview {
            issued: entry.issued,
            binding: entry.binding,
            scope: entry.scope,
            asset_id: entry.asset_id,
            actor_id: entry.actor_id,
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
        let access_owner = Arc::clone(&core.access);
        let store_owner = Arc::clone(&core.store);
        let vault_owner = Arc::clone(&core.vault);
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
        let prepared_render = {
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            original.release(&access).map_err(access_error)?;
            let mut proof = None;
            access.with_mutation_authorization::<super::HttpFailure>(
                original.principal.principal(),
                |guard| {
                    proof = Some(
                        vault_owner
                            .prepare_asset_review_render(
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
        // No Core, Access, Store or registry guard spans retained I/O/rendering.
        drop(core);
        let unqualified = prepared_render.render(&budget).map_err(media_error)?;
        budget.check().map_err(media_error)?;
        // Rejoin the same owners and final HTTP serialization before checking
        // the complete current graph or retaining any renderer receipt.
        let core = host.core.lock().map_err(|_| unavailable())?;
        if !Arc::ptr_eq(&access_owner, &core.access)
            || !Arc::ptr_eq(&store_owner, &core.store)
            || !Arc::ptr_eq(&vault_owner, &core.vault)
            || !core.homes.iter().any(|home| home.scope == scope)
        {
            return Err(unavailable());
        }
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
        let mut access = core.access.lock().map_err(|_| unavailable())?;
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
        let mut rendered = None;
        access.with_mutation_authorization::<super::HttpFailure>(
            original.principal.principal(),
            |guard| {
                rendered = Some(
                    unqualified
                        .qualify(guard, original.principal.retained(), &budget)
                        .map_err(media_error)?,
                );
                Ok(())
            },
        )?;
        original.release(&access).map_err(access_error)?;
        budget.check().map_err(media_error)?;
        let rendered = rendered.ok_or_else(unavailable)?;
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
            .try_lock()
            .map_err(|_| unavailable())?
            .insert(entry)?;
        Ok(json_response(json!({"receipt":facts})))
    })
    .await
    .map_err(|_| unavailable())?
}
