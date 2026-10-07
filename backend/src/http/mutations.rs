//! Actual Atlas command bridge with original authority and storage-owned facts.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, domain_error, evidence, failure, intake,
    json_response,
};
use crate::{
    access as a,
    app::{Access, HomeAuthority, RequestPrincipal, Store},
    contracts as c,
    contracts::semantics as sem,
    domain as d,
    http::contracts::NativeContracts,
    storage as s,
};
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
};
use s::Contract;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{cell::RefCell, collections::BTreeSet, sync::Arc};

fn convert<T: DeserializeOwned>(value: &impl Serialize) -> d::DomainResult<T> {
    serde_json::to_value(value)
        .and_then(serde_json::from_value)
        .map_err(|_| d::DomainError::UpstreamUnavailable)
}
fn same(left: &impl Serialize, right: &impl Serialize) -> d::DomainResult<bool> {
    Ok(NativeContracts
        .canonical_json(
            &serde_json::to_value(left).map_err(|_| d::DomainError::UpstreamUnavailable)?,
        )
        .map_err(crate::app::storage_error)?
        == NativeContracts
            .canonical_json(
                &serde_json::to_value(right).map_err(|_| d::DomainError::UpstreamUnavailable)?,
            )
            .map_err(crate::app::storage_error)?)
}
fn native_closure(
    scope: &s::Scope,
    original: &s::Snapshot,
    candidate: Option<&s::Snapshot>,
    entries: &[s::MutationEntry],
    replay: Option<&s::Replay>,
) -> d::DomainResult<sem::ReferenceClosure> {
    let scope: c::Scope = convert(scope)?;
    let original: c::Snapshot = convert(original)?;
    let candidate: Option<c::Snapshot> = candidate.map(convert).transpose()?;
    let entries: Vec<c::BatchMutationCommandsItem> = convert(&entries)?;
    let replay: Option<Vec<c::MutationResult>> = replay.map(|r| convert(&r.results)).transpose()?;
    sem::reference_closure(
        &scope,
        &original,
        candidate.as_ref(),
        &entries,
        replay.as_deref(),
    )
    .map_err(|_| d::DomainError::UpstreamUnavailable)
}
impl d::ContractPort for NativeContracts {
    fn validate(&self, shape: d::ContractShape, value: &Value) -> d::DomainResult<()> {
        self.validate_shape(
            match shape {
                d::ContractShape::RecordRef => "recordRef",
                d::ContractShape::Mutation => "mutation",
                d::ContractShape::BatchMutation => "batchMutation",
            },
            value,
        )
        .map_err(crate::app::storage_error)
    }
}
fn preconditions(context: &s::MutationAuthorizationContext) -> d::DomainResult<()> {
    let facts = context
        .preconditions
        .as_ref()
        .ok_or(d::DomainError::UpstreamUnavailable)?;
    if facts.commands.len() != context.entries.len() {
        return Err(d::DomainError::UpstreamUnavailable);
    }
    for (row, entry) in facts.commands.iter().zip(&context.entries) {
        if row.target != entry.target
            || row.operation != entry.command.operation
            || row.expected_revision != entry.command.expected_revision
        {
            return Err(d::DomainError::UpstreamUnavailable);
        }
        if row.operation != s::Operation::Create {
            let current = row.current.as_ref().ok_or(d::DomainError::NotFound)?;
            if Some(current.revision) != row.expected_revision {
                return Err(d::DomainError::RevisionConflict {
                    current_revision: Some(current.revision),
                });
            }
            // Let the shared transition rule retain lifecycle/exhaustion ordering.
            if current.revision == s::MAX_REVISION
                || if row.operation == s::Operation::Restore {
                    current.lifecycle != s::Lifecycle::Tombstoned
                } else {
                    current.lifecycle != s::Lifecycle::Active
                }
            {
                return Ok(());
            }
        } else if row.current.is_some() {
            return Ok(());
        }
        let mut guards = BTreeSet::new();
        for guard in &row.guards {
            let key = NativeContracts
                .canonical_json(
                    &serde_json::to_value(&guard.record)
                        .map_err(|_| d::DomainError::UpstreamUnavailable)?,
                )
                .map_err(crate::app::storage_error)?;
            if !guards.insert(key) {
                return Err(d::DomainError::InvalidContract);
            }
            let current = guard.current_revision.ok_or(d::DomainError::NotFound)?;
            if current != guard.expected_revision {
                return Err(d::DomainError::GuardConflict {
                    current_revision: Some(current),
                });
            }
        }
        for required in &row.required_guards {
            let key = NativeContracts
                .canonical_json(
                    &serde_json::to_value(required)
                        .map_err(|_| d::DomainError::UpstreamUnavailable)?,
                )
                .map_err(crate::app::storage_error)?;
            if !guards.contains(&key) {
                return Err(d::DomainError::RevisionRequired {
                    current_revision: row.current.as_ref().map(|c| c.revision),
                });
            }
        }
    }
    Ok(())
}
fn hold_presence(context: &s::MutationAuthorizationContext) -> d::DomainResult<()> {
    if !matches!(
        context.phase,
        s::MutationPhase::Candidate | s::MutationPhase::Precommit
    ) {
        return Ok(());
    }
    let candidate = context
        .candidate
        .as_ref()
        .ok_or(d::DomainError::UpstreamUnavailable)?;
    for entry in &context.entries {
        if entry.target.record_type != s::RecordType::Binding {
            continue;
        }
        let next = candidate
            .records
            .iter()
            .find(|row| row.reference() == entry.target)
            .ok_or(d::DomainError::UpstreamUnavailable)?;
        if next.lifecycle != s::Lifecycle::Active || next.payload["sourceState"] != "present" {
            continue;
        }
        let prior = context
            .original
            .records
            .iter()
            .find(|row| row.reference() == entry.target);
        let evidence = |row: &s::Record| -> d::DomainResult<BTreeSet<String>> {
            row.payload["evidenceIds"]
                .as_array()
                .ok_or(d::DomainError::UpstreamUnavailable)?
                .iter()
                .map(|id| {
                    id.as_str()
                        .map(str::to_owned)
                        .ok_or(d::DomainError::UpstreamUnavailable)
                })
                .collect()
        };
        let asserted = matches!(
            entry.command.operation,
            s::Operation::Create | s::Operation::Restore
        ) || prior.is_none_or(|row| row.payload["sourceState"] != "present")
            || prior.map(evidence).transpose()?.as_ref() != Some(&evidence(next)?);
        if asserted {
            return Err(d::DomainError::UpstreamUnavailable);
        }
    }
    Ok(())
}
struct MutateAuthority<'g, 'p> {
    guard: &'g a::TransactionAuthorization<'g>,
    principal: &'p RequestPrincipal,
    scope: s::Scope,
    entries: Vec<s::MutationEntry>,
    batch: Option<s::BatchMutation>,
    context_id: RefCell<Option<String>>,
    failure: RefCell<Option<d::DomainError>>,
}
impl MutateAuthority<'_, '_> {
    fn verify(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> d::DomainResult<s::VerifiedActor> {
        if !std::ptr::eq(p, self.principal)
            || request.capability != s::Capability::Mutate
            || request.scope != &self.scope
            || request.source.is_some()
            || request.source_partition.is_some()
        {
            return Err(d::DomainError::UpstreamUnavailable);
        }
        let context = request
            .mutation
            .ok_or(d::DomainError::UpstreamUnavailable)?;
        if context.format != s::MUTATION_AUTHORIZATION_CONTEXT_FORMAT
            || context.schema_version != 1
            || context.scope != self.scope
            || request.targets != context.targets
            || !same(&context.entries, &self.entries)?
            || !same(&context.batch, &self.batch)?
        {
            return Err(d::DomainError::UpstreamUnavailable);
        }
        let mut saved = self.context_id.borrow_mut();
        match saved.as_ref() {
            None if context.phase == s::MutationPhase::Intake => {
                *saved = Some(context.context_id.clone())
            }
            Some(id) if id == &context.context_id => {}
            _ => return Err(d::DomainError::UpstreamUnavailable),
        }
        drop(saved);
        let scope = crate::app::access_scope(&convert(&self.scope)?)
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        self.guard
            .authorize(&scope, a::Capability::Mutate)
            .map_err(access_domain)?;
        let closure = native_closure(
            &self.scope,
            &context.original,
            context.candidate.as_ref(),
            &context.entries,
            context.replay.as_ref(),
        )?;
        if !same(&closure, &context.closure)? {
            return Err(d::DomainError::UpstreamUnavailable);
        }
        p.release_guard(self.guard, &closure)
            .map_err(access_domain)?;
        if context.phase == s::MutationPhase::Validate {
            preconditions(context)?;
        }
        hold_presence(context)?;
        Ok(s::VerifiedActor {
            workspace_id: self.scope.workspace_id.clone(),
            home_id: self.scope.home_id.clone(),
            actor_id: p.principal.actor_id().as_str().into(),
        })
    }
}
impl s::Authorization for MutateAuthority<'_, '_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.verify(p, request).map_err(|error| {
            *self.failure.borrow_mut() = Some(error);
            s::Error::new("upstream-unavailable", "Mutation context was not accepted")
        })
    }
}
fn access_domain(error: a::AccessError) -> d::DomainError {
    match error {
        a::AccessError::Unauthenticated => d::DomainError::Unauthenticated,
        a::AccessError::NotFound => d::DomainError::NotFound,
        a::AccessError::Unavailable => d::DomainError::UpstreamUnavailable,
        a::AccessError::InvalidInput => d::DomainError::InvalidContract,
        _ => d::DomainError::Forbidden,
    }
}
struct WriteFailure(d::DomainError);
impl From<a::AccessError> for WriteFailure {
    fn from(error: a::AccessError) -> Self {
        Self(access_domain(error))
    }
}
enum Output {
    Single(Box<s::MutationResult>),
    Batch(s::BatchResult),
}
struct Writes<'a> {
    store: &'a mut Store,
    access: Access,
}
impl Writes<'_> {
    fn execute(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: Option<&d::RecordRef>,
        wire: &Value,
    ) -> d::DomainResult<Output> {
        let scope: s::Scope = convert(scope)?;
        let batch: Option<s::BatchMutation> = if target.is_none() {
            Some(convert(wire)?)
        } else {
            None
        };
        let entries = match &batch {
            Some(batch) => batch.commands.clone(),
            None => vec![s::MutationEntry {
                target: convert(target.ok_or(d::DomainError::UpstreamUnavailable)?)?,
                command: convert(wire)?,
            }],
        };
        let preflight = self
            .store
            .read_snapshot(p, &scope)
            .map_err(crate::app::storage_error)?;
        NativeContracts
            .validate_snapshot(&preflight)
            .map_err(crate::app::storage_error)?;
        let closure = native_closure(&scope, &preflight, None, &entries, None)?;
        let mut access = self
            .access
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        p.capture_sources(&access, &closure)
            .map_err(access_domain)?;
        let mut output = None;
        access
            .with_mutation_authorization::<WriteFailure>(&p.principal, |guard| {
                let authorization = MutateAuthority {
                    guard,
                    principal: p,
                    scope: scope.clone(),
                    entries: entries.clone(),
                    batch: batch.clone(),
                    context_id: RefCell::new(None),
                    failure: RefCell::new(None),
                };
                let result = match &batch {
                    Some(_) => self
                        .store
                        .execute_batch_json_with_authorization(&authorization, p, &scope, wire)
                        .map(Output::Batch),
                    None => self
                        .store
                        .execute_json_with_authorization(
                            &authorization,
                            p,
                            &scope,
                            &entries[0].target,
                            wire,
                        )
                        .map(Box::new)
                        .map(Output::Single),
                };
                output = Some(result.map_err(|error| {
                    WriteFailure(
                        authorization
                            .failure
                            .borrow_mut()
                            .take()
                            .unwrap_or_else(|| crate::app::storage_error(error)),
                    )
                })?);
                Ok(())
            })
            .map_err(|error| error.0)?;
        p.release(&access).map_err(access_domain)?;
        output.ok_or(d::DomainError::UpstreamUnavailable)
    }
}
impl d::CommandPort<RequestPrincipal> for Writes<'_> {
    fn execute(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
        command: &d::CanonicalMutation,
    ) -> d::DomainResult<d::MutationResult> {
        match self.execute(p, scope, Some(target), command.wire())? {
            Output::Single(result) => convert(&result),
            _ => Err(d::DomainError::UpstreamUnavailable),
        }
    }
    fn execute_batch(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        batch: &d::CanonicalBatch,
    ) -> d::DomainResult<d::BatchResult> {
        match self.execute(p, scope, None, batch.wire())? {
            Output::Batch(result) => convert(&result),
            _ => Err(d::DomainError::UpstreamUnavailable),
        }
    }
}
async fn command(
    host: Host,
    scope: d::Scope,
    target: Option<d::RecordRef>,
    request: Request,
) -> HttpResult {
    if request.uri().query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let selected = crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    let capture_host = host.clone();
    let capture_scope = scope.clone();
    let capture_checked = checked.clone();
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
        if !core.homes.iter().any(|home| home.scope == capture_scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        Ok(RequestPrincipal::new(principal))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))??;
    intake::metadata(&request, 1_048_576)?;
    let bytes = super::admission::body(request.into_body(), 1_048_576).await?;
    tokio::task::spawn_blocking(move || {
        // Keep the admitted work slot through the actual transaction even when
        // the HTTP caller cancels its await. No unbounded replacement work.
        let _admitted = checked.admission_permit()?;
        let wire = intake::json(&bytes)?;
        let mut core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let home = core
            .homes
            .iter()
            .find(|home| home.scope == scope)
            .cloned()
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        let access = Arc::clone(&core.access);
        let mut commands = d::Commands {
            store: Writes {
                store: &mut core.store,
                access: Arc::clone(&access),
            },
            access: HomeAuthority { access, home },
            contracts: NativeContracts,
        };
        let value = match target {
            Some(target) => serde_json::to_value(
                commands
                    .execute(&principal, &scope, &target, wire)
                    .map_err(domain_error)?,
            ),
            None => serde_json::to_value(
                commands
                    .execute_batch(&principal, &scope, wire)
                    .map_err(domain_error)?,
            ),
        }
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        Ok(json_response(value))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn single(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<(String, String, String, String)>,
    request: Request,
) -> HttpResult {
    crate::app::access_scope(&d::Scope {
        workspace_id: workspace_id.clone(),
        home_id: home_id.clone(),
    })
    .map_err(|_| failure(StatusCode::NOT_FOUND))?;
    a::CanonicalId::parse(&id).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let selected = json!({"recordType":kind,"recordId":id});
    NativeContracts
        .validate_shape("recordRef", &selected)
        .map_err(|error| domain_error(crate::app::storage_error(error)))?;
    let target =
        serde_json::from_value(selected).map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    command(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        Some(target),
        request,
    )
    .await
}
pub(super) async fn batch(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> HttpResult {
    command(
        host,
        d::Scope {
            workspace_id,
            home_id,
        },
        None,
        request,
    )
    .await
}
