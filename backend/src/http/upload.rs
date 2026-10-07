//! One authorized multipart intake, genuine stage and native atomic stock batch.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response,
    qualified_upload_plan, stock_mutations, stock_reads, upload_batch, upload_intake,
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
    storage::Runtime,
};
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
};
use serde_json::json;
use std::time::Duration;

pub(super) fn policy() -> serde_json::Value {
    json!({
        "contentTypes":["image/png","application/pdf","text/plain"],
        "maximumBytes":upload_intake::MAX_FILE_BYTES,
        "licenses":[{"label":"Unknown","value":{"status":"unknown","reference":null}}]
    })
}
fn media_error(error: m::MediaError) -> super::HttpFailure {
    failure(StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}
fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}

pub(super) async fn command(
    State(host): State<Host>,
    Path((workspace_id, home_id, record_id)): Path<(String, String, String)>,
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
    // Authenticate the real POST/Origin/cookie/CSRF before reading file bytes.
    // No borrowed Core, Store or Access lock survives the async body intake.
    let principal = tokio::task::spawn_blocking(move || {
        let _admitted = capture_checked.admission_permit()?;
        let core = capture_host.core.lock().map_err(|_| unavailable())?;
        let url = format!("{}{}", capture_host.origin, uri.path());
        let observed = evidence(&capture_host.origin, &capture_checked, &uri, &url, &method)
            .map_err(access_error)?;
        let principal = core
            .access
            .lock()
            .map_err(|_| unavailable())?
            .authorize(&observed, &selected, a::Action::Mutate)
            .map_err(access_error)?;
        if !core.homes.iter().any(|home| home.scope == capture_scope) {
            return Err(failure(StatusCode::NOT_FOUND));
        }
        Ok(RequestPrincipal::new(principal))
    })
    .await
    .map_err(|_| unavailable())??;
    let input = upload_intake::read(request)
        .await
        .map_err(|error| failure(error.status()))?;
    let inputs = upload_batch::FreshUploadInputs::capture_server_intake()
        .map_err(stock_reads::http_error)?;
    tokio::task::spawn_blocking(move || {
        let _admitted = checked.admission_permit()?;
        let mut core = host.core.lock().map_err(|_| unavailable())?;
        let home = core.homes.iter().find(|home| home.scope == scope).cloned()
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        if input.metadata.context.workspace_id != scope.workspace_id
            || input.metadata.context.home_id != scope.home_id
            || input.metadata.record_id != record_id
            || input.metadata.source_license.status != types::LicenseStatus::Unknown
            || input.metadata.source_license.reference.is_some()
        {
            return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
        }
        let selection = qualified_upload_plan::resolve(&mut core, &principal, &home, &input.metadata)
            .map_err(stock_reads::http_error)?;
        let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
            .map_err(media_error)?;
        let runtime = ServerRuntime;
        let asset_request_id = runtime.new_id().map_err(|_| unavailable())?;
        let asset_key = runtime.new_id().map_err(|_| unavailable())?;
        let schemas = st::NativeStockContract::new().map_err(stock_reads::http_error)?;
        let stages = NativeUploadStages::open(&core.vault, &runtime).map_err(media_error)?;
        let mut staged = None;
        {
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            principal.release(&access).map_err(access_error)?;
            access.with_mutation_authorization::<super::HttpFailure>(
                principal.principal.principal(),
                |guard| {
                    let receipt = stages.stage_original(
                        guard,
                        principal.principal.retained(),
                        UploadAdmission {
                            request_id: asset_request_id.clone(),
                            purpose: types::AssetPurpose::EvidenceOriginal,
                            content_type: types::ContentType::parse(&input.metadata.content_type).map_err(media_error)?,
                            filename: input.metadata.filename.clone(),
                            source_license: input.metadata.source_license.clone(),
                            evidence_ids: vec![],
                        },
                        &mut input.bytes.as_slice(),
                        &budget,
                    ).map_err(media_error)?;
                    let asset = st::ValidatedRequest::parse(&schemas, json!({
                        "schemaVersion":3,"commandId":"atlas.asset.create","requestId":asset_request_id,
                        "context":input.metadata.context,
                        "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
                        "payload":{"staged":receipt.staged,"purpose":"evidence-original",
                            "sourceLicense":input.metadata.source_license,"evidenceIds":[]},
                        "idempotencyKey":asset_key,"reason":input.metadata.reason,
                        "preconditions":{"target":null,"guards":selection.stock_guards()},"approvalReceiptId":null
                    })).map_err(stock_reads::http_error)?;
                    staged = Some(stages.bind_asset_plan(guard, principal.principal.retained(),
                        &receipt.staged.upload_token, &asset, &budget).map_err(media_error)?);
                    Ok(())
                },
            )?;
            principal.release(&access).map_err(access_error)?;
        }
        let staged = staged.ok_or_else(unavailable)?;
        let plan = upload_batch::plan_fresh_upload_batch(
            &principal, &selection, &input.metadata, &staged, &inputs,
        ).map_err(stock_reads::http_error)?;
        let raw = plan.plan().original_request().clone();
        let result = stock_mutations::execute_staged(&core, &principal, &selection, raw, &staged, &schemas)
            .map_err(stock_reads::http_error)?;
        let access = core.access.lock().map_err(|_| unavailable())?;
        principal.release(&access).map_err(access_error)?;
        Ok(json_response(result.wire))
    }).await.map_err(|_| unavailable())?
}
