//! Native-only location evidence affordance, with no source admission fallback.
use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, failure, json_response,
    qualified_upload_plan, stock_reads,
};
use crate::domain as d;
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};

pub(super) async fn place(
    State(host): State<Host>,
    Path((workspace_id, home_id, record_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
            false,
            |core, principal, home| {
                Ok(json_response(
                    qualified_upload_plan::native_admission(core, principal, home, &record_id)
                        .map_err(stock_reads::http_error)?,
                ))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
