//! Native upload correlation is data. Only authenticated owner reads/rejections
//! disclose outcomes; an absent retained commit never establishes safe retry.
use super::{CheckedHeaders, Host, HttpResult, authorized_read, failure, headers, json_response};
use crate::{access, app, domain, domain::stock, storage};
use axum::{
    extract::{Extension, Path, State},
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Clone)]
struct IntakeOutcome;

pub(super) fn is_outcome_response(response: &Response) -> bool {
    response.extensions().get::<IntakeOutcome>().is_some()
}

pub(super) fn request_id(headers: &HeaderMap) -> Result<Option<String>, super::HttpFailure> {
    let value =
        headers::single(headers, "x-atlas-upload-request-id").map_err(super::access_error)?;
    if let Some(value) = &value {
        access::CanonicalId::parse(value).map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    }
    Ok(value)
}

/// Call only after actual POST authorization and before continuation dispatch.
/// HTTP status remains an error; the private marker preserves this closed DTO
/// through the shared adapter without bypassing its private response headers.
pub(super) fn reject(
    request_id: Option<&str>,
    scope: &domain::Scope,
    record_id: &str,
    status: StatusCode,
    code: &'static str,
) -> HttpResult {
    let Some(request_id) = request_id else {
        return Err(failure(status));
    };
    let value = json!({"schemaVersion":1,"kind":"native-evidence-outcome",
        "requestId":request_id,"scope":scope,"recordId":record_id,
        "outcome":"not-committed","phase":"intake",
        "error":{"code":code,"httpStatus":status.as_u16()}});
    let mut response = (status, axum::Json(value)).into_response();
    response.extensions_mut().insert(IntakeOutcome);
    Ok(response)
}

pub(super) async fn inspect(
    State(host): State<Host>,
    Path((workspace_id, home_id, record_id, request_id)): Path<(String, String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
    }
    for id in [&record_id, &request_id] {
        access::CanonicalId::parse(id).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    }
    let scope = domain::Scope {
        workspace_id,
        home_id,
    };
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(scope.clone()),
            false,
            |core, principal, _home| {
                let contracts =
                    stock::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
                let stored_scope = storage::Scope {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                };
                let result = core
                    .store
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                    .inspect_native_upload_with_authorization(
                        &app::ReadAuthority(core.access.clone()),
                        principal,
                        &contracts,
                        &stored_scope,
                        &record_id,
                        &request_id,
                    )
                    .map_err(|error| super::domain_error(app::storage_error(error)))?;
                Ok(json_response(match result {
                    Some(result) => {
                        json!({"schemaVersion":1,"kind":"native-evidence-reconciliation",
                        "requestId":request_id,"scope":scope,"recordId":record_id,
                        "outcome":"committed","result":result})
                    }
                    None => json!({"schemaVersion":1,"kind":"native-evidence-reconciliation",
                        "requestId":request_id,"scope":scope,"recordId":record_id,
                        "outcome":"unknown","retrySafety":"not-established"}),
                }))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
