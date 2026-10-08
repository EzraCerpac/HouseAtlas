//! Same-request standalone owned-original asset create over the stock owner.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response,
    stock_mutations, stock_reads, upload_intake,
};
use crate::{
    access as a,
    app::{RequestPrincipal, ServerRuntime},
    domain::{self as d, stock as st},
    media::{
        self as m,
        staged_upload::{NativeUploadStages, UploadAdmission},
        types,
    },
};
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
};
use serde_json::json;
use std::time::Duration;

fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn media_error(error: m::MediaError) -> super::HttpFailure {
    failure(StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}

pub(super) async fn command(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
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
    let capture_host = host.clone();
    let capture_checked = checked.clone();
    let capture_scope = scope.clone();
    // Authenticate the actual POST and CSRF before consuming multipart bytes.
    let principal = tokio::task::spawn_blocking(move || {
        let _admitted = capture_checked.admission_permit()?;
        let core = capture_host.core.lock().map_err(|_| unavailable())?;
        let url = format!("{}{}", capture_host.origin, uri.path());
        let observed = evidence(&capture_host.origin, &capture_checked, &uri, &url, &method)
            .map_err(access_error)?;
        let original = core
            .access
            .lock()
            .map_err(|_| unavailable())?
            .authorize(&observed, &selected, a::Action::Mutate)
            .map_err(access_error)?;
        if !core.homes.iter().any(|home| home.scope == capture_scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        Ok(RequestPrincipal::new(original))
    })
    .await
    .map_err(|_| unavailable())??;
    let input = upload_intake::read_asset(request)
        .await
        .map_err(|error| failure(error.status()))?;
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let core = host.core.lock().map_err(|_| unavailable())?;
        if input.metadata.context.workspace_id != scope.workspace_id
            || input.metadata.context.home_id != scope.home_id
            || !core.homes.iter().any(|home| home.scope == scope)
        {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        let runtime = ServerRuntime;
        let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
            .map_err(media_error)?;
        let contracts = st::NativeStockContract::new().map_err(stock_reads::http_error)?;
        let stages = NativeUploadStages::open(&core.vault, &runtime).map_err(media_error)?;
        let metadata = &input.metadata;
        let admission = UploadAdmission {
            request_id: metadata.request_id.clone(),
            purpose: types::AssetPurpose::EvidenceOriginal,
            content_type: types::ContentType::Text,
            filename: metadata.filename.clone(),
            source_license: metadata.source_license.clone(),
            evidence_ids: vec![],
        };
        let mut staged = None;
        {
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            principal.release(&access).map_err(access_error)?;
            access.with_mutation_authorization::<super::HttpFailure>(
                principal.principal.principal(), |guard| {
                    let receipt = stages.stage_original(
                        guard, principal.principal.retained(), admission,
                        &mut input.bytes.as_slice(), &budget,
                    ).map_err(media_error)?;
                    let asset = st::ValidatedRequest::parse(&contracts, json!({
                        "schemaVersion":3,"commandId":"atlas.asset.create",
                        "requestId":metadata.request_id,"context":metadata.context,
                        "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
                        "payload":{"staged":receipt.staged,"purpose":"evidence-original",
                            "sourceLicense":metadata.source_license,"evidenceIds":[]},
                        "idempotencyKey":metadata.idempotency_key,"reason":metadata.reason,
                        "preconditions":{"target":null,"guards":[]},"approvalReceiptId":null
                    })).map_err(stock_reads::http_error)?;
                    staged = Some(stages.bind_asset_plan(
                        guard, principal.principal.retained(),
                        &receipt.staged.upload_token, &asset, &budget,
                    ).map_err(media_error)?);
                    Ok(())
                },
            )?;
            principal.release(&access).map_err(access_error)?;
        }
        let staged = staged.ok_or_else(unavailable)?;
        if staged.payload().content_type != "text/plain"
            || staged.payload().preview_policy != types::PreviewPolicy::DownloadOnly
        {
            return Err(unavailable());
        }
        let result = stock_mutations::execute_staged_asset(
            &host, &core, &principal, staged.request().raw().clone(), &staged, &contracts,
        ).map_err(stock_reads::http_error)?;
        // A successful stock commit is final. Retirement is best-effort, using
        // the real consumed-token carrier and the same original principal.
        let store_scope = crate::storage::Scope {
            workspace_id: scope.workspace_id, home_id: scope.home_id,
        };
        let _retirement = (|| -> Result<(), super::HttpFailure> {
            let consumed = core.store.lock().map_err(|_| unavailable())?
                .committed_upload_with_authorization(
                    &crate::app::ReadAuthority(core.access.clone()), &principal, &contracts,
                    &store_scope, &staged.staged().upload_token,
                )
                .map_err(|error| stock_reads::http_error(st::StockError::Domain(crate::app::storage_error(error))))?
                .ok_or_else(unavailable)?;
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            principal.release(&access).map_err(access_error)?;
            access.with_mutation_authorization::<super::HttpFailure>(
                principal.principal.principal(), |guard| {
                    stages.cleanup_consumed(
                        guard, principal.principal.retained(), &consumed, &budget,
                    ).map_err(media_error)?;
                    Ok(())
                },
            )?;
            principal.release(&access).map_err(access_error)?;
            Ok(())
        })();
        let access = core.access.lock().map_err(|_| unavailable())?;
        principal.release(&access).map_err(access_error)?;
        Ok(json_response(result.wire))
    }).await.map_err(|_| unavailable())?
}
