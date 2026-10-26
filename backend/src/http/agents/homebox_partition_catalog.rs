//! Explicit metadata view of the existing selected-home admission route.
use crate::{
    app::{RequestPrincipal, homebox_partition_catalog},
    catalog_budget as b,
    domain as d,
};
use crate::http::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, private_headers,
};
use axum::{
    http::{HeaderValue, Method, StatusCode, Uri, header},
    response::IntoResponse,
};

pub(super) const QUERY: &str = "view=homebox-cached-partitions-v1";

pub(super) async fn admission(
    host: Host,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    scope: d::Scope,
) -> HttpResult {
    let budget = b::Budget::start();
    let _cancel = b::CancelOnDrop(budget.clone());
    let unavailable = || failure(StatusCode::SERVICE_UNAVAILABLE);
    if method != Method::GET || uri.query() != Some(QUERY) {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let native_scope = crate::app::access_scope(&scope)
        .map_err(|_| failure(StatusCode::NOT_FOUND))?;
    budget.check().map_err(|_| unavailable())?;
    let worker_budget = budget.clone();
    let bytes = tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let url = super::super::auth::url(&host, &uri);
        // This constructs evidence only. No authentication SQL precedes policy.
        let request = evidence(&host.origin, &headers, &uri, &url, &method)
            .map_err(access_error)?;
        homebox_partition_catalog::read_with_issuance(
            host.core.clone(),
            &worker_budget,
            |access, budget| {
                budget.check().map_err(|_| crate::access::AccessError::Unavailable)?;
                let original = access.authorize_catalog_read(&request, &native_scope, budget)?;
                budget.check().map_err(|_| crate::access::AccessError::Unavailable)?;
                Ok(RequestPrincipal::new(original))
            },
        ).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .map_err(access_error)
    }).await.map_err(|_| unavailable())??;
    budget.check().map_err(|_| unavailable())?;
    let mut response = bytes.into_response();
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    private_headers(&mut response);
    // No JSON reconstruction and no partial/expired successful handoff.
    budget.check().map_err(|_| unavailable())?;
    Ok(response)
}

#[cfg(test)]
mod tests;
