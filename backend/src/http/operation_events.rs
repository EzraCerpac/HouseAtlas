//! Aggregate retained event transport. Registry selectors never carry authority.
//! Genuine retained payloads supply selectors to the actual original Access
//! producer before sealing; subsequent pages cannot acquire new grants.
use super::{CheckedHeaders, Host, HttpResult, access_error, domain_error, evidence, failure};
use crate::{
    access as a,
    app::{Access, RequestPrincipal},
    domain as d, storage as s,
};
use axum::{
    extract::{Extension, Query, State},
    http::{Method, StatusCode, Uri},
};
use serde::Deserialize;
use std::{
    cell::{Cell, OnceCell},
    collections::VecDeque,
    sync::Arc,
};

const MAX_ENTRIES: usize = 8;
const MAX_GRAPH_BYTES: usize = 16 * 1024 * 1024;
const MAX_CLOSURE_REFS: usize = 4096;
const MAX_SESSION_ENTRIES: usize = 4;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EventQuery {
    workspace_id: Option<a::CanonicalId>,
    home_id: a::CanonicalId,
    #[serde(default = "default_page_size")]
    page_size: usize,
    cursor: Option<String>,
}
fn default_page_size() -> usize {
    25
}
struct RetainedPage {
    principal: Box<RequestPrincipal>,
    continuation: s::StockRetainedContinuation,
    scope: s::Scope,
    session: [u8; 32],
    actor: String,
    page_size: usize,
    access: Access,
    owner: s::StockRetainedReadOwner,
    graph: s::Snapshot,
    closure: crate::contracts::semantics::ReferenceClosure,
}
#[derive(Default)]
pub(super) struct EventRegistry {
    entries: VecDeque<RetainedPage>,
}
impl EventRegistry {
    fn reserve(
        &self,
        cursor: &str,
        scope: &s::Scope,
        session: &[u8; 32],
        actor: &str,
        page_size: usize,
        access: &Access,
    ) -> Result<usize, super::HttpFailure> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.continuation.cursor_id() == cursor)
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        let entry = &self.entries[index];
        if entry.scope != *scope
            || entry.session != *session
            || entry.actor != actor
            || entry.page_size != page_size
            || !Arc::ptr_eq(&entry.access, access)
            || entry.continuation.scope() != scope
            || entry.continuation.page_size() != page_size
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        // The caller holds the registry guard through final disclosure. Failure
        // leaves this exact original principal, owner and cursor in custody.
        Ok(index)
    }
    fn retain(&mut self, entry: RetainedPage) {
        while self
            .entries
            .iter()
            .filter(|old| old.session == entry.session)
            .count()
            >= MAX_SESSION_ENTRIES
        {
            if let Some(index) = self
                .entries
                .iter()
                .position(|old| old.session == entry.session)
            {
                self.entries.remove(index);
            }
        }
        while self.entries.len() >= MAX_ENTRIES {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }
}
struct EventAuthority<'a> {
    principal: &'a RequestPrincipal,
    scope: &'a s::Scope,
    access: &'a Access,
    owner: &'a s::StockRetainedReadOwner,
    graph: &'a s::Snapshot,
    phase: Cell<usize>,
    original_graph: &'a s::Snapshot,
    captured: OnceCell<crate::contracts::semantics::ReferenceClosure>,
    initial: bool,
    intent: Option<&'a serde_json::Value>,
}
impl s::Authorization for EventAuthority<'_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(principal, self.principal)
            || request.scope != self.scope
            || request.capability != s::Capability::ReadHistory
            || request.source.is_some()
            || request.source_partition.is_some()
            || request.mutation.is_some()
        {
            return Err(s::Error::new(
                "forbidden",
                "Original event read authority changed",
            ));
        }
        s::Authorization::authorize(
            &crate::app::ReadAuthority(Arc::clone(self.access)),
            principal,
            request,
        )
    }
}
fn unavailable() -> s::Error {
    s::Error::new("unavailable", "Retained event qualification unavailable")
}
fn closure(
    graph: &s::Snapshot,
    scope: &s::Scope,
    commits: &[s::StockAtlasCommit],
) -> s::Result<crate::contracts::semantics::ReferenceClosure> {
    use d::stock::AtlasDerivation;
    let mut graph = graph.clone();
    for commit in commits {
        for derivation in commit
            .derivation
            .iter()
            .chain(commit.child_derivations.iter().flatten().flatten())
        {
            match derivation {
                AtlasDerivation::BindingReview { original }
                | AtlasDerivation::BindingRestore { original }
                | AtlasDerivation::BindingRemap { original, .. }
                | AtlasDerivation::AssetReview { original, .. } => {
                    graph.records.push(original.clone())
                }
                _ => {}
            }
        }
    }
    let typed = serde_json::from_value(serde_json::to_value(graph)?)?;
    let scope = serde_json::from_value(serde_json::to_value(scope)?)?;
    let entries: Vec<_> = commits
        .iter()
        .flat_map(|commit| &commit.groups)
        .flat_map(|group| &group.native_entries)
        .collect();
    let results: Vec<_> = commits
        .iter()
        .flat_map(|commit| &commit.groups)
        .flat_map(|group| &group.native_results)
        .collect();
    let entries: Vec<crate::contracts::BatchMutationCommandsItem> =
        serde_json::from_value(serde_json::to_value(entries)?)?;
    let results: Vec<crate::contracts::MutationResult> =
        serde_json::from_value(serde_json::to_value(results)?)?;
    let closure = crate::contracts::semantics::reference_closure(
        &scope,
        &typed,
        None,
        &entries,
        Some(&results),
    )
    .map_err(|_| unavailable())?;
    if !closure.missing_record_refs.is_empty() {
        return Err(unavailable());
    }
    Ok(closure)
}
impl s::StockRetainedReadAuthorization for EventAuthority<'_> {
    fn retained_read_owner(&self) -> &s::StockRetainedReadOwner {
        self.owner
    }
    fn authorize_stock_retained_read(
        &self,
        principal: &RequestPrincipal,
        frame: s::StockRetainedReadFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let actor = s::Authorization::authorize(
            self,
            principal,
            s::AuthorizationRequest {
                scope: frame.scope,
                capability: s::Capability::ReadHistory,
                targets: frame.targets,
                source: None,
                source_partition: None,
                mutation: None,
            },
        )?;
        if frame.scope != self.scope {
            return Err(unavailable());
        }
        match self.intent {
            None if frame.intent.is_some() || frame.commit.is_some() => return Err(unavailable()),
            Some(raw)
                if frame.intent.map(d::stock::ValidatedRequest::raw) != Some(raw)
                    || !frame.events.is_empty()
                    || !frame.retained_commits.is_empty() =>
            {
                return Err(unavailable());
            }
            _ => {}
        }
        let expected = match self.phase.get() {
            0 | 2 => s::StockRetainedReadPhase::Intake,
            1 => s::StockRetainedReadPhase::Prepare,
            3 => s::StockRetainedReadPhase::Disclosure,
            4 => s::StockRetainedReadPhase::Release,
            _ => return Err(unavailable()),
        };
        if frame.phase != expected {
            return Err(unavailable());
        }
        if frame.phase != s::StockRetainedReadPhase::Intake {
            let current: Vec<_> = self
                .graph
                .records
                .iter()
                .filter(|record| {
                    frame.targets.iter().any(|target| {
                        target.record_type == record.record_type
                            && target.record_id == record.record_id
                    })
                })
                .collect();
            if current.len() != frame.current_records.len()
                || current
                    .iter()
                    .any(|record| !frame.current_records.iter().any(|other| *record == other))
            {
                return Err(unavailable());
            }
        }
        let mut graph = self.original_graph.clone();
        graph.records.extend(self.graph.records.iter().cloned());
        let commits = frame
            .commit
            .map(std::slice::from_ref)
            .unwrap_or(frame.retained_commits);
        let closure = closure(&graph, frame.scope, commits)?;
        if serde_json::to_vec(&closure)?.len() > MAX_GRAPH_BYTES
            || closure.record_refs.len() > MAX_CLOSURE_REFS
            || closure.source_refs.len() > MAX_CLOSURE_REFS
            || closure.source_partitions.len() > MAX_CLOSURE_REFS
        {
            return Err(unavailable());
        }
        if let Some(captured) = self.captured.get()
            && (closure
                .record_refs
                .iter()
                .any(|item| !captured.record_refs.contains(item))
                || closure
                    .source_refs
                    .iter()
                    .any(|item| !captured.source_refs.contains(item))
                || closure
                    .source_partitions
                    .iter()
                    .any(|item| !captured.source_partitions.contains(item)))
        {
            return Err(unavailable());
        }
        let mut access = self.access.try_lock().map_err(|_| unavailable())?;
        if frame.phase == s::StockRetainedReadPhase::Prepare && self.initial {
            // The concrete request wrapper allows only existing captured grants
            // after sealing. These selectors never become grants themselves.
            for source in &closure.source_refs {
                let source = serde_json::from_value(serde_json::to_value(source)?)?;
                principal
                    .capture_source(&access, &source)
                    .map_err(|_| unavailable())?;
            }
            for partition in &closure.source_partitions {
                let partition = serde_json::from_value(serde_json::to_value(partition)?)?;
                principal
                    .capture_partition(&access, &partition)
                    .map_err(|_| unavailable())?;
            }
        }
        access
            .with_read_authorization(
                principal.principal.principal(),
                |guard| -> a::AccessResult<()> {
                    guard.authorize(principal.principal.scope(), a::Capability::ReadHistory)?;
                    principal.release_guard(guard, self.captured.get().unwrap_or(&closure))
                },
            )
            .map_err(|_| unavailable())?;
        if frame.phase == s::StockRetainedReadPhase::Prepare && self.initial {
            self.captured.set(closure).map_err(|_| unavailable())?;
            principal.seal_source_capture();
        }
        self.phase.set(self.phase.get() + 1);
        Ok(actor)
    }
}

pub(super) async fn events(
    State(host): State<Host>,
    Query(query): Query<EventQuery>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
) -> HttpResult {
    if !(1..=100).contains(&query.page_size)
        || query
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > 128 || cursor.is_empty())
    {
        return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let mut core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let matches: Vec<_> = core
            .homes
            .iter()
            .filter(|home| {
                home.scope.home_id == query.home_id.as_str()
                    && query
                        .workspace_id
                        .as_ref()
                        .is_none_or(|workspace| home.scope.workspace_id == workspace.as_str())
            })
            .collect();
        let scope: d::Scope = match matches.as_slice() {
            [home] => home.scope.clone(),
            [] => return Err(failure(StatusCode::NOT_FOUND)),
            _ => return Err(failure(StatusCode::SERVICE_UNAVAILABLE)),
        };
        let native_scope = crate::app::access_scope(&scope).map_err(access_error)?;
        let storage_scope: s::Scope = serde_json::from_value(
            serde_json::to_value(&scope).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        )
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = format!(
            "{}{}",
            host.origin,
            uri.path_and_query().map_or("/", |path| path.as_str())
        );
        let request =
            evidence(&host.origin, &headers, &uri, &url, &Method::GET).map_err(access_error)?;
        let (current, session) = {
            let mut access = core
                .access
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let principal = access
                .authorize(&request, &native_scope, a::Action::Read)
                .map_err(access_error)?;
            access
                .authorize_storage(&principal, &native_scope, a::Capability::ReadHistory)
                .map_err(access_error)?;
            let session = access
                .authenticated_session_binding(&principal)
                .map_err(access_error)?;
            (RequestPrincipal::new(principal), session)
        };
        let actor = current.principal.actor_id().as_str().to_owned();
        // Reserve by borrowing under the actual registry mutex. The native
        // prepare/disclose APIs borrow the original continuation and cannot
        // advance it; no failure below consumes or reissues the saved cursor.
        let mut registry = host
            .operation_events
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let reserved = query
            .cursor
            .as_ref()
            .map(|cursor| {
                registry.reserve(
                    cursor,
                    &storage_scope,
                    &session,
                    &actor,
                    query.page_size,
                    &core.access,
                )
            })
            .transpose()?;
        let initial_principal = Box::new(current);
        let initial_owner = s::StockRetainedReadOwner::new();
        let retained = reserved.map(|index| &registry.entries[index]);
        let initial = retained.is_none();
        let principal =
            retained.map_or(initial_principal.as_ref(), |entry| entry.principal.as_ref());
        let continuation = retained.map(|entry| &entry.continuation);
        let owner = retained.map_or(&initial_owner, |entry| &entry.owner);
        let graph =
            super::reads::retained_read_snapshot(&mut core, &host, principal, &storage_scope)?;
        if serde_json::to_vec(&graph)
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .len()
            > MAX_GRAPH_BYTES
        {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let original_graph = retained.map_or_else(|| graph.clone(), |entry| entry.graph.clone());
        let captured = OnceCell::new();
        if let Some(closure) = retained.map(|entry| entry.closure.clone()) {
            captured
                .set(closure)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        }
        let access = Arc::clone(&core.access);
        let mut store = core
            .store
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if !Arc::ptr_eq(&store.configured_authorization().0, &access) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let authority = EventAuthority {
            principal,
            scope: &storage_scope,
            access: &access,
            owner,
            graph: &graph,
            phase: Cell::new(0),
            original_graph: &original_graph,
            captured,
            initial,
            intent: None,
        };
        let contracts =
            d::stock::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
        let prepared = store
            .prepare_stock_operation_events_with_authorization(
                &authority,
                principal,
                &contracts,
                principal.principal.retained(),
                &storage_scope,
                query.page_size,
                continuation,
            )
            .map_err(|error| domain_error(crate::app::storage_error(error)))?;
        let mut full_graph = original_graph.clone();
        full_graph.records.extend(graph.records.iter().cloned());
        let snapshot_closure = closure(
            &full_graph,
            &storage_scope,
            prepared.snapshot_closure().retained_commits(),
        )
        .map_err(|error| domain_error(crate::app::storage_error(error)))?;
        if authority.captured.get() != Some(&snapshot_closure) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let result = store
            .disclose_stock_operation_events_with_authorization(
                &authority, principal, &contracts, &prepared,
            )
            .map_err(|error| domain_error(crate::app::storage_error(error)))?;
        if authority.phase.get() != 5 {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let mut response = None;
        let mut access_guard = access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if access_guard
            .authenticated_session_binding(&principal.principal)
            .map_err(access_error)?
            != session
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        access_guard
            .with_read_authorization(
                principal.principal.principal(),
                |guard| -> a::AccessResult<()> {
                    guard.authorize(principal.principal.scope(), a::Capability::ReadHistory)?;
                    let final_closure = authority
                        .captured
                        .get()
                        .ok_or(a::AccessError::Unavailable)?;
                    principal.release_guard(guard, final_closure)?;
                    let value = serde_json::to_value(&result.page)
                        .map_err(|_| a::AccessError::Unavailable)?;
                    response = Some(super::json_response(value));
                    Ok(())
                },
            )
            .map_err(access_error)?;
        drop(access_guard);
        let closure = authority
            .captured
            .get()
            .cloned()
            .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        drop(authority);
        // Commit registry custody only after native disclosure and the final
        // current-session/read fence succeeded. Removal and replacement have
        // no intervening fallible operation and preserve the original Box.
        let response = response.ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let previous = match reserved {
            Some(index) => Some(
                registry
                    .entries
                    .remove(index)
                    .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?,
            ),
            None => None,
        };
        if let Some(continuation) = result.continuation {
            let (principal, owner) = match previous {
                Some(entry) => (entry.principal, entry.owner),
                None => (initial_principal, initial_owner),
            };
            registry.retain(RetainedPage {
                principal,
                continuation,
                scope: storage_scope,
                session,
                actor,
                page_size: query.page_size,
                access,
                owner,
                graph: original_graph,
                closure,
            });
        }
        Ok(response)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

/// Complete submitted intent is a bounded selector, never execution authority.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct IntentQuery {
    workspace_id: Option<a::CanonicalId>,
    home_id: a::CanonicalId,
    intent: String,
}
pub(super) async fn reconcile_intent(
    State(host): State<Host>,
    Query(query): Query<IntentQuery>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
) -> HttpResult {
    if query.intent.is_empty() || query.intent.len() > 16 * 1024 {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let raw = super::intake::json(query.intent.as_bytes())?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let mut core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        // The complete intent carries its original full scope. Resolve it
        // before authorization rather than selecting an ambiguous home ID.
        let storage_scope: s::Scope = serde_json::from_value(raw["context"].clone())
            .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
        if storage_scope.home_id != query.home_id.as_str()
            || query
                .workspace_id
                .as_ref()
                .is_some_and(|workspace| storage_scope.workspace_id != workspace.as_str())
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        let scope = d::Scope {
            workspace_id: storage_scope.workspace_id.clone(),
            home_id: storage_scope.home_id.clone(),
        };
        let native_scope = crate::app::access_scope(&scope).map_err(access_error)?;
        if !core.homes.iter().any(|home| home.scope == scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        if raw["context"]
            != serde_json::to_value(&storage_scope)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        let url = format!(
            "{}{}",
            host.origin,
            uri.path_and_query().map_or("/", |path| path.as_str())
        );
        let request =
            evidence(&host.origin, &headers, &uri, &url, &Method::GET).map_err(access_error)?;
        let (principal, session) = {
            let mut access = core
                .access
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let principal = access
                .authorize(&request, &native_scope, a::Action::Read)
                .map_err(access_error)?;
            access
                .authorize_storage(&principal, &native_scope, a::Capability::ReadHistory)
                .map_err(access_error)?;
            let session = access
                .authenticated_session_binding(&principal)
                .map_err(access_error)?;
            (Box::new(RequestPrincipal::new(principal)), session)
        };
        let graph =
            super::reads::retained_read_snapshot(&mut core, &host, &principal, &storage_scope)?;
        if serde_json::to_vec(&graph)
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .len()
            > MAX_GRAPH_BYTES
        {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let owner = s::StockRetainedReadOwner::new();
        let access = Arc::clone(&core.access);
        let mut store = core
            .store
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if !Arc::ptr_eq(&store.configured_authorization().0, &access) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let authority = EventAuthority {
            principal: &principal,
            scope: &storage_scope,
            access: &access,
            owner: &owner,
            graph: &graph,
            phase: Cell::new(0),
            original_graph: &graph,
            captured: OnceCell::new(),
            initial: true,
            intent: Some(&raw),
        };
        let contracts =
            d::stock::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
        let prepared = store
            .prepare_stock_atlas_replay_source_with_authorization(
                &authority,
                &principal,
                &contracts,
                &raw,
                principal.principal.retained(),
            )
            .map_err(|error| domain_error(crate::app::storage_error(error)))?;
        let result = store
            .disclose_stock_atlas_replay_source_with_authorization(
                &authority, &principal, &contracts, &prepared,
            )
            .map_err(|error| domain_error(crate::app::storage_error(error)))?;
        if authority.phase.get() != 5 {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let mut response = None;
        let mut access_guard = access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if access_guard
            .authenticated_session_binding(&principal.principal)
            .map_err(access_error)?
            != session
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        access_guard
            .with_read_authorization(
                principal.principal.principal(),
                |guard| -> a::AccessResult<()> {
                    guard.authorize(principal.principal.scope(), a::Capability::ReadHistory)?;
                    let final_closure = authority
                        .captured
                        .get()
                        .ok_or(a::AccessError::Unavailable)?;
                    principal.release_guard(guard, final_closure)?;
                    let value =
                        serde_json::to_value(&result).map_err(|_| a::AccessError::Unavailable)?;
                    // This is a reconciliation wrapper containing the saved envelope;
                    // ordinary current-command result validation would relabel its ID.
                    response = Some(super::json_response(value));
                    Ok(())
                },
            )
            .map_err(access_error)?;
        response.ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
