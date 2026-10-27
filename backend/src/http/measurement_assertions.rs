//! Five bounded measurement operations and read-only occurrence context over
//! the selected original Core Store.
//! No closure, list/import/backfill, source fetch, alternate dataset or retry.
use super::*;
use crate::{
    app::RequestPrincipal,
    contracts::{self as c, measurement_assertions as wire},
    measurement_assertions::online_contract as online,
    storage as s,
};
const MAX_REQUEST: usize = 1_048_576;
fn error(e: s::Error) -> HttpFailure {
    let (status, code) = match e.code {
        "unauthenticated" => (StatusCode::UNAUTHORIZED, c::ApiErrorCode::Unauthenticated),
        "forbidden" => (StatusCode::FORBIDDEN, c::ApiErrorCode::Forbidden),
        "not-found" => (StatusCode::NOT_FOUND, c::ApiErrorCode::NotFound),
        "revision-required" => (
            StatusCode::PRECONDITION_REQUIRED,
            c::ApiErrorCode::RevisionRequired,
        ),
        "revision-conflict" => (
            StatusCode::PRECONDITION_FAILED,
            c::ApiErrorCode::RevisionConflict,
        ),
        "guard-conflict" => (
            StatusCode::PRECONDITION_FAILED,
            c::ApiErrorCode::GuardConflict,
        ),
        "idempotency-conflict" => (StatusCode::CONFLICT, c::ApiErrorCode::IdempotencyConflict),
        "identity-conflict" => (StatusCode::CONFLICT, c::ApiErrorCode::IdentityConflict),
        "invalid-transition" => (StatusCode::CONFLICT, c::ApiErrorCode::InvalidTransition),
        "invalid-contract" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            c::ApiErrorCode::InvalidContract,
        ),
        "export-too-large" => (
            StatusCode::PAYLOAD_TOO_LARGE,
            c::ApiErrorCode::UpstreamIncomplete,
        ),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            c::ApiErrorCode::UpstreamUnavailable,
        ),
    };
    HttpFailure {
        status,
        code,
        current_revision: None,
    }
}
enum Action {
    Write(Value),
    Read(s::MeasurementRead),
    Context(Value),
}
fn context_error(scope: &s::Scope, e: s::Error) -> Result<Value, HttpFailure> {
    let code = match e.code {
        "measurement-context-stale-selection" => "stale-selection",
        "measurement-context-incomplete-coverage" | "export-too-large" => "incomplete-coverage",
        "measurement-context-authority-unavailable"
        | "upstream-unavailable"
        | "schema-incompatible" => "authority-unavailable",
        _ => return Err(error(e)),
    };
    Ok(json!({"profile":"houseatlas.measurement-context-error.v1","scope":scope,"code":code}))
}
fn scope(workspace_id: String, home_id: String) -> Result<s::Scope, HttpFailure> {
    a::CanonicalId::parse(&workspace_id).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    a::CanonicalId::parse(&home_id).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    Ok(s::Scope {
        workspace_id,
        home_id,
    })
}
fn uuid(id: &str) -> Result<(), HttpFailure> {
    a::CanonicalId::parse(id)
        .map(|_| ())
        .map_err(|_| failure(StatusCode::NOT_FOUND))
}
fn no_query(uri: &Uri) -> Result<(), HttpFailure> {
    if uri.query().is_some() {
        Err(failure(StatusCode::FORBIDDEN))
    } else {
        Ok(())
    }
}
fn capture(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &s::Scope,
    write: bool,
) -> Result<RequestPrincipal, HttpFailure> {
    no_query(uri)?;
    if host.measurements.is_none() {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !core
        .homes
        .iter()
        .any(|h| h.scope.workspace_id == scope.workspace_id && h.scope.home_id == scope.home_id)
    {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let access = core.access.clone();
    drop(core);
    let url = format!("{}{}", host.origin, uri.path());
    let observed = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let selected = crate::app::access_scope(&d::Scope {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
    })
    .map_err(access_error)?;
    let mut access = access
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let principal = if !write && *method == Method::POST {
        access.authorize_post_read(&observed, &selected)
    } else {
        access.authorize(
            &observed,
            &selected,
            if write {
                a::Action::Mutate
            } else {
                a::Action::Read
            },
        )
    }
    .map_err(access_error)?;
    Ok(RequestPrincipal::new(principal))
}
fn execute(
    host: &Host,
    p: &RequestPrincipal,
    scope: &s::Scope,
    action: Action,
) -> Result<Value, HttpFailure> {
    let binding = host
        .measurements
        .as_ref()
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !core
        .homes
        .iter()
        .any(|h| h.scope.workspace_id == scope.workspace_id && h.scope.home_id == scope.home_id)
        || !binding.belongs_to(&core.access, &core.vault)
    {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    let store = core.store.clone();
    let access = core.access.clone();
    drop(core);
    // Preserve Store-then-Access. Preflight only captures the original reference
    // closure; the actual transaction independently checks its same-cut facts.
    let mut store = store
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !store.measurement_binding_matches(binding)
        || !Arc::ptr_eq(&store.configured_authorization().0, &access)
    {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    let preparation = match &action {
        Action::Write(_) => store.prepare_measurement(p, scope, binding),
        Action::Context(v) => store.prepare_measurement_disclosure(
            p,
            scope,
            binding,
            Some(&v["selector"]),
            None,
            None,
        ),
        Action::Read(
            s::MeasurementRead::Current { assertion_id }
            | s::MeasurementRead::FullHistory { assertion_id },
        ) => {
            store.prepare_measurement_disclosure(p, scope, binding, None, Some(assertion_id), None)
        }
        Action::Read(s::MeasurementRead::MutationOutcome { mutation_id }) => {
            store.prepare_measurement_disclosure(p, scope, binding, None, None, Some(mutation_id))
        }
    };
    let prepared = match preparation {
        Ok(p) => p,
        Err(e) => {
            if matches!(&action, Action::Context(_)) {
                return context_error(scope, e);
            }
            return Err(error(e));
        }
    };
    let mut access = access
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    p.capture_sources(&access, prepared.source_closure())
        .map_err(access_error)?;
    p.seal_source_capture();
    // Separate staging uses the SAME original opaque native principal Arc.
    // A denied historical capture is dropped, never retried or reauthorized.
    let historical = if let Some(closure) = prepared.historical_source_closure() {
        let retained = RequestPrincipal::from_retained(p.principal.retained().clone());
        if !std::ptr::eq(retained.principal.principal(), p.principal.principal()) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        if retained.capture_sources(&access, closure).is_ok() {
            retained.seal_source_capture();
            Some(retained)
        } else {
            None
        }
    } else {
        None
    };
    // This third staging wrapper concerns writing prerequisites ONLY. It
    // shares the SAME original Read principal, but neither extends nor replaces
    // either disclosure wrapper. Capture failure is advisory, not a read failure.
    let mutation_sources = if let Some(closure) = prepared.advisory_mutation_source_closure() {
        let retained = RequestPrincipal::from_retained(p.principal.retained().clone());
        if !std::ptr::eq(retained.principal.principal(), p.principal.principal()) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        if retained.capture_sources(&access, closure).is_ok() {
            retained.seal_source_capture();
            Some(retained)
        } else {
            None
        }
    } else {
        None
    };
    let writing = matches!(&action, Action::Write(_));
    let mut output = None;
    let run = |guard: &a::TransactionAuthorization<'_>| -> Result<(), HttpFailure> {
        output = Some(
            match action {
                Action::Write(input) => {
                    store.write_measurement(p, guard, binding, &prepared, &input)
                }
                Action::Read(kind) => {
                    store.read_measurement(p, guard, binding, &prepared, historical.as_ref(), kind)
                }
                Action::Context(input) => {
                    match store.measurement_occurrence_context(s::MeasurementContextInput {
                        p,
                        guard,
                        binding,
                        prepared: &prepared,
                        historical: historical.as_ref(),
                        mutation_sources: mutation_sources.as_ref(),
                        input: &input,
                    }) {
                        Ok(v) => Ok(v),
                        Err(e) => Ok(context_error(scope, e)?),
                    }
                }
            }
            .map_err(error)?,
        );
        Ok(())
    };
    if writing {
        access.with_mutation_authorization(p.principal.principal(), run)?;
    } else {
        access.with_read_authorization(p.principal.principal(), run)?;
    }
    p.release(&access).map_err(access_error)?;
    if let Some(h) = &historical {
        h.release(&access).map_err(access_error)?;
    }
    // The mutation-source wrapper was revalidated for its exact closure under
    // the held original Read guard. It supplies only cut-bound advisory facts;
    // it is not promoted into a response-disclosure or mutation grant here.
    output.ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))
}
async fn write(
    host: Host,
    scope: s::Scope,
    correction: Option<String>,
    request: Request,
) -> HttpResult {
    let headers = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    no_query(&uri)?;
    if let Some(id) = &correction {
        uuid(id)?;
    }
    let capture_host = host.clone();
    let capture_scope = scope.clone();
    let capture_headers = headers.clone();
    let principal = tokio::task::spawn_blocking(move || {
        let _permit = capture_headers.admission_permit()?;
        capture(
            &capture_host,
            &capture_headers,
            &uri,
            &method,
            &capture_scope,
            true,
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))??;
    intake::metadata(&request, MAX_REQUEST as u64)?;
    let bytes = admission::body(request.into_body(), MAX_REQUEST).await?;
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        let value = intake::json(&bytes)?;
        let proposal =
            wire::proposal(&value).map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
        if proposal.scope.workspace_id != scope.workspace_id
            || proposal.scope.home_id != scope.home_id
        {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        match (&correction, &proposal.operation) {
            (None, online::OnlineOperation::Create) => {}
            (Some(id), online::OnlineOperation::Correct { assertion_id, .. })
                if id == assertion_id => {}
            _ => return Err(failure(StatusCode::UNPROCESSABLE_ENTITY)),
        }
        Ok(json_response(execute(
            &host,
            &principal,
            &scope,
            Action::Write(value),
        )?))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn create(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    request: Request,
) -> HttpResult {
    write(host, scope(workspace_id, home_id)?, None, request).await
}
async fn correct(
    State(host): State<Host>,
    Path((workspace_id, home_id, id)): Path<(String, String, String)>,
    request: Request,
) -> HttpResult {
    write(host, scope(workspace_id, home_id)?, Some(id), request).await
}
async fn read(
    host: Host,
    scope: s::Scope,
    id: String,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    kind: u8,
) -> HttpResult {
    no_query(&uri)?;
    uuid(&id)?;
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        let principal = capture(&host, &headers, &uri, &method, &scope, false)?;
        let action = match kind {
            0 => s::MeasurementRead::Current { assertion_id: id },
            1 => s::MeasurementRead::FullHistory { assertion_id: id },
            _ => s::MeasurementRead::MutationOutcome { mutation_id: id },
        };
        Ok(json_response(execute(
            &host,
            &principal,
            &scope,
            Action::Read(action),
        )?))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn current(
    State(host): State<Host>,
    Path((w, h, id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    read(host, scope(w, h)?, id, headers, uri, method, 0).await
}
async fn history(
    State(host): State<Host>,
    Path((w, h, id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    read(host, scope(w, h)?, id, headers, uri, method, 1).await
}
async fn outcome(
    State(host): State<Host>,
    Path((w, h, id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    read(host, scope(w, h)?, id, headers, uri, method, 2).await
}
#[derive(Clone)]
struct ContextFailure;
pub(super) fn is_context_failure(response: &Response) -> bool {
    response.extensions().get::<ContextFailure>().is_some()
}
async fn context_unsupported() -> Response {
    let mut response = failure(StatusCode::METHOD_NOT_ALLOWED).into_response();
    response
        .headers_mut()
        .insert(header::ALLOW, header::HeaderValue::from_static("POST"));
    response
}
async fn occurrence_context(
    State(host): State<Host>,
    Path((w, h)): Path<(String, String)>,
    request: Request,
) -> HttpResult {
    let scope = scope(w, h)?;
    let headers = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    no_query(&uri)?;
    let h = host.clone();
    let s = scope.clone();
    let checked = headers.clone();
    let p = tokio::task::spawn_blocking(move || {
        let _permit = checked.admission_permit()?;
        capture(&h, &checked, &uri, &method, &s, false)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))??;
    intake::metadata(&request, MAX_REQUEST as u64)?;
    let bytes = admission::body(request.into_body(), MAX_REQUEST).await?;
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        let input = intake::json(&bytes)?;
        wire::validate_value("contextRequest", &input)
            .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
        if input["scope"]
            != serde_json::to_value(&scope).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        let result = execute(&host, &p, &scope, Action::Context(input))?;
        if result["profile"] == "houseatlas.measurement-context-error.v1" {
            wire::validate_value("contextError", &result)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let status = if result["code"] == "stale-selection" {
                StatusCode::CONFLICT
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            };
            let mut response = (status, Json(result)).into_response();
            response.extensions_mut().insert(ContextFailure);
            Ok(response)
        } else {
            Ok(json_response(result))
        }
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) fn routes() -> Router<Host> {
    Router::new()
        .route("/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/occurrence-context",post(occurrence_context).fallback(context_unsupported))
        .route("/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/occurrence-area",post(create).fallback(auth::session_head))
        .route("/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/occurrence-area/{assertion_id}/corrections",post(correct).fallback(auth::session_head))
        .route("/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/occurrence-area/{assertion_id}",get(current).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/occurrence-area/{assertion_id}/history",get(history).head(auth::session_head).fallback(auth::session_head))
        .route("/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/mutation-outcomes/{mutation_id}",get(outcome).head(auth::session_head).fallback(auth::session_head))
}

#[cfg(test)]
mod tests {
    use super::*;
    // FROZEN/UNREGISTERED/UNEXECUTED. These are parser/error-policy checks;
    // they provide NO authenticated HTTP transaction or native storage proof.
    #[test]
    fn canonical_scope_and_identifier_are_bounded() {
        let w = "00000000-0000-4000-8000-000000009001";
        let h = "00000000-0000-4000-8000-000000009002";
        let selected =
            scope(w.into(), h.into()).unwrap_or_else(|_| panic!("synthetic scope refused"));
        assert_eq!(selected.workspace_id, w);
        assert_eq!(selected.home_id, h);
        assert!(uuid(w).is_ok());
    }
    #[test]
    fn unsupported_query_and_noncanonical_identifier_are_refused() {
        assert!(no_query(&"/api/atlas/measurements/v1?actor=other".parse().unwrap()).is_err());
        assert!(uuid("generated-label").is_err());
        let missing = error(s::Error::new(
            "storage-unavailable",
            "Synthetic unavailable outcome",
        ));
        assert_eq!(missing.status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(missing.current_revision.is_none());
    }
}
