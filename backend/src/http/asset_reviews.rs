//! Process-local custody of genuine existing-asset renderer receipts.
//! The selector is never an authorization or a serialized substitute for proof.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response, stock_reads,
};
use crate::{
    access as a,
    app::RequestPrincipal,
    domain as d,
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

#[allow(dead_code)] // Fields are consumed by take when the commit adapter mounts it.
struct Entry {
    issued: Instant,
    binding: [u8; 32],
    scope: d::Scope,
    asset_id: String,
    actor_id: String,
    original: Box<RequestPrincipal>,
    rendered: RenderedAssetReview,
}

/// The original allocation and opaque Media carrier move together into the
/// eventual same-Store consumer. No principal or proof can be rebuilt from data.
#[allow(dead_code)] // Connected by the same-Store proof consumer in the next integration step.
pub(super) struct TakenReview {
    pub original: Box<RequestPrincipal>,
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
    #[allow(dead_code)] // Connected by the same-Store proof consumer in the next integration step.
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
