//! One authorized multipart intake, genuine stage and native atomic stock batch.
use super::{
    CheckedHeaders, Host, HttpResult, access_error, evidence, failure, json_response,
    qualified_upload_plan, stock_mutations, stock_reads, upload_batch, upload_intake,
    upload_outcomes,
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

#[path = "upload_diagnostics.rs"]
pub(super) mod diagnostics;
use diagnostics::{Category, Phase};

pub(super) fn policy() -> serde_json::Value {
    json!({
        "contentTypes":["image/png","image/jpeg","application/pdf","text/plain"],
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

#[derive(Clone, Copy)]
enum PlaceNamespace {
    SourceBacked,
    Native,
}

pub(super) async fn command(
    State(host): State<Host>,
    Path(path): Path<(String, String, String)>,
    request: Request,
) -> HttpResult {
    intake_command(host, path, request, PlaceNamespace::SourceBacked).await
}

pub(super) async fn native_command(
    State(host): State<Host>,
    Path(path): Path<(String, String, String)>,
    request: Request,
) -> HttpResult {
    intake_command(host, path, request, PlaceNamespace::Native).await
}

async fn intake_command(
    host: Host,
    (workspace_id, home_id, record_id): (String, String, String),
    request: Request,
    namespace: PlaceNamespace,
) -> HttpResult {
    if request.uri().query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    let scope = d::Scope {
        workspace_id,
        home_id,
    };
    let selected = crate::app::access_scope(&scope).map_err(|_| failure(StatusCode::NOT_FOUND))?;
    let correlation = if matches!(namespace, PlaceNamespace::Native) {
        upload_outcomes::request_id(request.headers())?
    } else {
        None
    };
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
    let mut observer =
        diagnostics::Observer::authenticated(correlation.as_deref(), &scope, &record_id);
    let diagnostic = observer.trace();
    // Only a genuine authorized POST may receive an intake rejection carrier.
    // Keep the large-body slot through blocking work even if the caller leaves.
    let upload_permit = match host.upload_slots.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            diagnostic.failure(Category::Busy, StatusCode::SERVICE_UNAVAILABLE);
            observer.response_ready(StatusCode::SERVICE_UNAVAILABLE);
            return upload_outcomes::reject(
                correlation.as_deref(),
                &scope,
                &record_id,
                StatusCode::SERVICE_UNAVAILABLE,
                "upload-busy",
            );
        }
    };
    let input = match upload_intake::read(request, &diagnostic).await {
        Ok(input) => input,
        Err(error) => {
            diagnostic.failure(error.category(), error.status());
            observer.response_ready(error.status());
            let code = if error.status() == StatusCode::REQUEST_TIMEOUT {
                "upload-timeout"
            } else {
                "invalid-upload"
            };
            return upload_outcomes::reject(
                correlation.as_deref(),
                &scope,
                &record_id,
                error.status(),
                code,
            );
        }
    };
    diagnostic.phase(Phase::IntakeComplete);
    if correlation
        .as_ref()
        .is_some_and(|id| id != &input.metadata.request_id)
    {
        diagnostic.failure(
            Category::CorrelationMismatch,
            StatusCode::UNPROCESSABLE_ENTITY,
        );
        observer.response_ready(StatusCode::UNPROCESSABLE_ENTITY);
        return upload_outcomes::reject(
            correlation.as_deref(),
            &scope,
            &record_id,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid-upload",
        );
    }
    if input.metadata.context.workspace_id != scope.workspace_id
        || input.metadata.context.home_id != scope.home_id
        || input.metadata.record_id != record_id
        || input.metadata.source_license.status != types::LicenseStatus::Unknown
        || input.metadata.source_license.reference.is_some()
    {
        diagnostic.failure(Category::ContextMismatch, StatusCode::UNPROCESSABLE_ENTITY);
        observer.response_ready(StatusCode::UNPROCESSABLE_ENTITY);
        return upload_outcomes::reject(
            correlation.as_deref(),
            &scope,
            &record_id,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid-upload",
        );
    }
    let inputs = upload_batch::FreshUploadInputs::capture_server_intake()
        .map_err(stock_reads::http_error)
        .inspect_err(|error| {
            diagnostic.failure(Category::PreparationFailure, error.status);
            observer.response_ready(error.status);
        })?;
    diagnostic.phase(Phase::Queued);
    let worker_diagnostic = diagnostic.clone();
    let mut worker = worker_diagnostic.worker();
    let result = tokio::task::spawn_blocking(move || {
        let result = (|| -> HttpResult {
        let _upload_permit = upload_permit;
        let _admitted = checked.admission_permit()?;
        worker_diagnostic.phase(Phase::WaitingCore);
        let mut core = host.core.lock().map_err(|_| unavailable())?;
        let home = core.homes.iter().find(|home| home.scope == scope).cloned()
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
        worker_diagnostic.phase(Phase::Qualifying);
        let selection = match namespace {
            PlaceNamespace::SourceBacked => qualified_upload_plan::resolve(&mut core, &principal, &home, &input.metadata),
            PlaceNamespace::Native => qualified_upload_plan::resolve_native(&mut core, &principal, &home, &input.metadata),
        }.map_err(stock_reads::http_error)?;
        let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
            .map_err(media_error)?;
        let runtime = ServerRuntime;
        let asset_request_id = runtime.new_id().map_err(|_| unavailable())?;
        let asset_key = runtime.new_id().map_err(|_| unavailable())?;
        let schemas = st::NativeStockContract::new().map_err(stock_reads::http_error)?;
        let stages = NativeUploadStages::open(&core.vault, &runtime).map_err(media_error)?;
        let admission = UploadAdmission {
            request_id: asset_request_id.clone(),
            purpose: types::AssetPurpose::EvidenceOriginal,
            content_type: types::ContentType::parse(&input.metadata.content_type).map_err(media_error)?,
            filename: input.metadata.filename.clone(),
            source_license: input.metadata.source_license.clone(),
            evidence_ids: vec![],
        };
        // Measure real bytes under the original mutation fence, then resolve
        // through Storage outside that fence; its authorizer acquires Access.
        worker_diagnostic.phase(Phase::Measuring);
        let mut measured = None;
        {
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            principal.release(&access).map_err(access_error)?;
            access.with_mutation_authorization::<super::HttpFailure>(principal.principal.principal(), |guard| {
                measured = Some(st::measure_attachment_original(
                    st::AttachmentIntakeIdentity {
                        request_id: &input.metadata.request_id,
                        idempotency_key: &input.metadata.idempotency_key,
                    },
                    &stages, guard, principal.principal.retained(), &admission,
                    &mut input.bytes.as_slice(), &budget).map_err(media_error)?);
                Ok(())
            })?;
            principal.release(&access).map_err(access_error)?;
        }
        let measured = measured.ok_or_else(unavailable)?;
        let store_scope = crate::storage::Scope {
            workspace_id: scope.workspace_id.clone(), home_id: scope.home_id.clone(),
        };
        worker_diagnostic.phase(Phase::ResolvingOriginal);
        let existing = core.store.lock().map_err(|_| unavailable())?
            .resolve_original_asset_with_authorization(
                &crate::app::ReadAuthority(core.access.clone()), &principal, &store_scope, measured.prepared())
            .map_err(|error| stock_reads::http_error(st::StockError::Domain(crate::app::storage_error(error))))?;
        if let Some(asset) = existing {
            let plan = upload_batch::plan_existing_upload_batch(
                &principal, &selection, &input.metadata, &asset, &measured, &inputs)
                .map_err(stock_reads::http_error)?;
            worker_diagnostic.phase(Phase::Dispatching);
            let result = stock_mutations::execute_existing(
                &core, &principal, &selection, plan.plan().original_request().clone(),
                &asset, &measured, &schemas).map_err(stock_reads::http_error)?;
            worker_diagnostic.phase(Phase::Releasing);
            let access = core.access.lock().map_err(|_| unavailable())?;
            principal.release(&access).map_err(access_error)?;
            return Ok(json_response(result.wire));
        }
        worker_diagnostic.phase(Phase::Staging);
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
                        admission,
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
        worker_diagnostic.phase(Phase::Dispatching);
        let (result, release) = stock_mutations::execute_staged(&host, &core, &principal, &selection, raw, &staged, &schemas)
            .map_err(stock_reads::http_error)?;
        // The owner has already committed and qualified this canonical result.
        // Metadata retirement cannot turn that commit into an unconfirmed write.
        // It still requires the real SQLite consumption carrier and original
        // mutation authority; failure leaves retirement for later maintenance.
        let _retirement = (|| -> Result<(), super::HttpFailure> {
            let consumed = core.store.lock().map_err(|_| unavailable())?
                .committed_upload_with_authorization(
                    &crate::app::ReadAuthority(core.access.clone()), &principal, &schemas,
                    &store_scope, &staged.staged().upload_token)
                .map_err(|error| stock_reads::http_error(st::StockError::Domain(crate::app::storage_error(error))))?
                .ok_or_else(unavailable)?;
            let mut access = core.access.lock().map_err(|_| unavailable())?;
            principal.release(&access).map_err(access_error)?;
            access.with_mutation_authorization::<super::HttpFailure>(principal.principal.principal(), |guard| {
                stages.cleanup_consumed(guard, principal.principal.retained(), &consumed, &budget)
                    .map_err(media_error)?;
                Ok(())
            })?;
            principal.release(&access).map_err(access_error)?;
            Ok(())
        })();
        worker_diagnostic.phase(Phase::Releasing);
        // No diagnostic I/O runs here: reporting maintenance cannot panic or
        // block the committed receipt. SQLite retains the consumption proof.
        // Output release remains mandatory even if maintenance failed. Never
        // use a cleanup error to waive the original principal/source checks.
        let access = core.access.lock().map_err(|_| unavailable())?;
        principal.release(&access).map_err(access_error)?;
        drop(access);
        if let Some(release) = release {
            release.mark_released();
        }
        Ok(json_response(result.wire))
        })();
        let status = match &result { Ok(response) => response.status(), Err(error) => error.status };
        if result.is_err() { worker_diagnostic.failure(Category::ContinuationFailure, status); }
        worker.returned(status);
        result
    }).await.map_err(|_| unavailable()).inspect_err(|error| {
        diagnostic.failure(Category::JoinFailure, error.status);
        observer.response_ready(error.status);
    })?;
    observer.response_ready(match &result {
        Ok(response) => response.status(),
        Err(error) => error.status,
    });
    result
}
