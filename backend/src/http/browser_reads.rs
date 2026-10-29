use super::*;

pub(super) async fn current(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read_phased(
            &host,
            &headers,
            &uri,
            &method,
            (None, true),
            |core, principal, home| {
                let view = query_view(core, principal, home)?;
                let selected = source_documents_service_selected(&host, core)?;
                browser_view(view, selected)
            },
            |mut wire, scope| {
                wire["modelOverviewService"] = model_overview::availability(&host, scope);
                Ok(json_response(wire))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn scoped(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read_phased(
            &host,
            &headers,
            &uri,
            &method,
            (
                Some(d::Scope {
                    workspace_id,
                    home_id,
                }),
                true,
            ),
            |core, principal, home| {
                let view = query_view(core, principal, home)?;
                let selected = source_documents_service_selected(&host, core)?;
                browser_view(view, selected)
            },
            |mut wire, scope| {
                wire["modelOverviewService"] = model_overview::availability(&host, scope);
                Ok(json_response(wire))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn rooms(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            None,
            true,
            |core, principal, home| {
                let view = query_view(core, principal, home)?;
                Ok(json_response(browser_entries(view.rooms(false))?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn items(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            None,
            true,
            |core, principal, home| {
                let view = query_view(core, principal, home)?;
                Ok(json_response(browser_entries(view.items(false))?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn homes(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = auth::url(&host, &uri);
        let observed =
            evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
        let choices = {
            let mut access = core
                .access
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            capture_homes(&mut access, &observed, &core.homes).map_err(access_error)?
        };
        let response = json_response(
            serde_json::to_value(
                choices
                    .iter()
                    .map(|choice| &choice.summary)
                    .collect::<Vec<_>>(),
            )
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        );
        let access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        for choice in &choices {
            access.revalidate(&choice.principal).map_err(access_error)?;
        }
        Ok(response)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
