use super::*;

pub(super) fn evidence<'a>(
    origin: &str,
    headers: &'a CheckedHeaders,
    uri: &Uri,
    url: &'a str,
    method: &Method,
) -> Result<a::RequestEvidence<'a>, a::AccessError> {
    headers.check_authority(origin, uri)?;
    Ok(a::RequestEvidence {
        method: match *method {
            Method::GET => a::Method::Get,
            Method::HEAD => a::Method::Head,
            Method::POST => a::Method::Post,
            _ => a::Method::Other,
        },
        url,
        origin: headers.origin.as_deref(),
        sec_fetch_site: headers.sec_fetch_site.as_deref(),
        referer: headers.referer.as_deref(),
        cookie: headers.cookie.as_deref(),
        authorization: headers.authorization.as_deref(),
        csrf: headers.csrf.as_deref(),
    })
}
/// Issue exactly the existing native Read and home-choice principals.
/// The caller holds the canonical Core only for capture and native queries.
fn capture_read(
    host: &Host,
    core: &Core,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: Option<d::Scope>,
    include_home_choices: bool,
) -> Result<(RequestPrincipal, d::HomeSummary), HttpFailure> {
    let url = auth::url(host, uri);
    let request = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let mut choices = {
        let mut access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if include_home_choices || scope.is_none() {
            capture_homes(&mut access, &request, &core.homes).map_err(access_error)?
        } else {
            let scope = scope
                .as_ref()
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            let principal = access
                .authorize(
                    &request,
                    &crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?,
                    a::Action::Read,
                )
                .map_err(access_error)?;
            let summary = core
                .homes
                .iter()
                .find(|home| home.scope == *scope)
                .cloned()
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            vec![crate::app::CapturedHome { summary, principal }]
        }
    };
    let selected = match scope {
        Some(scope) => choices
            .iter()
            .position(|choice| choice.summary.scope == scope),
        None => choices
            .iter()
            .position(|choice| choice.summary.scope == core.home.scope)
            .or_else(|| (!choices.is_empty()).then_some(0)),
    }
    .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let selected = choices.remove(selected);
    let mut principal = RequestPrincipal::new(selected.principal);
    principal.home_choices = choices;
    Ok((principal, selected.summary))
}
pub(super) fn authorized_read<T>(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: Option<d::Scope>,
    include_home_choices: bool,
    operation: impl FnOnce(&mut Core, &RequestPrincipal, &d::HomeSummary) -> Result<T, HttpFailure>,
) -> Result<T, HttpFailure> {
    // Preserve the existing syntax rejection before any session/data lookup.
    if let Some(scope) = &scope {
        crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    }
    let mut core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let (principal, home) = capture_read(
        host,
        &core,
        headers,
        uri,
        method,
        scope,
        include_home_choices,
    )?;
    let result = operation(&mut core, &principal, &home)?;
    let access = core
        .access
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    principal.release(&access).map_err(access_error)?;
    Ok(result)
}
/// Preserve every captured native grant through a separately unlocked finish.
/// Only model publication I/O belongs in finish; native query work stays locked.
pub(super) fn authorized_read_phased<P, T>(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    selection: (Option<d::Scope>, bool),
    prepare: impl FnOnce(&mut Core, &RequestPrincipal, &d::HomeSummary) -> Result<P, HttpFailure>,
    finish: impl FnOnce(P, &d::Scope) -> Result<T, HttpFailure>,
) -> Result<T, HttpFailure> {
    if let Some(scope) = &selection.0 {
        crate::app::access_scope(scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    }
    let mut core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let current_selection = selection.0.is_none().then(|| core.home.scope.clone());
    let (principal, home) =
        capture_read(host, &core, headers, uri, method, selection.0, selection.1)?;
    let canonical = Arc::clone(&core.access);
    let prepared = prepare(&mut core, &principal, &home)?;
    drop(core);
    let result = finish(prepared, &home.scope)?;
    let core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !Arc::ptr_eq(&canonical, &core.access)
        || current_selection
            .as_ref()
            .is_some_and(|scope| *scope != core.home.scope)
        || !core.homes.iter().any(|current| current.scope == home.scope)
        || principal.home_choices.iter().any(|choice| {
            !core
                .homes
                .iter()
                .any(|current| current.scope == choice.summary.scope)
        })
    {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    let access = canonical
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    principal.release(&access).map_err(access_error)?;
    Ok(result)
}
/// Scoped stock reads may call native owners which acquire their owning Core.
/// Retain the actual issuance and canonical allocation across the unlocked phase.
pub(super) fn authorized_read_unlocked<T>(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: d::Scope,
    operation: impl FnOnce(&RequestPrincipal) -> Result<T, HttpFailure>,
) -> Result<T, HttpFailure> {
    let access_scope =
        crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !core.homes.iter().any(|home| home.scope == scope) {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    let canonical = core.access.clone();
    let url = auth::url(host, uri);
    let request = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let principal = canonical
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        .authorize(&request, &access_scope, a::Action::Read)
        .map_err(access_error)?;
    let principal = RequestPrincipal::new(principal);
    drop(core);
    let result = operation(&principal)?;
    let core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !Arc::ptr_eq(&canonical, &core.access) || !core.homes.iter().any(|home| home.scope == scope)
    {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    let access = canonical
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    principal.release(&access).map_err(access_error)?;
    Ok(result)
}
