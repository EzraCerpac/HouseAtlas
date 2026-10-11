//! Bounded multipart data intake for the root-owned fresh upload continuation.
//! This parser grants no authority. The host must authorize the actual request
//! before calling it; actual staging and atomic dispatch belong to the handler.
use super::{
    headers, intake,
    upload::diagnostics::{Category, Part, Phase, Trace},
};
use crate::{http::contracts::NativeContracts, media, storage};
use axum::{
    extract::{DefaultBodyLimit, FromRequest, Multipart, Request},
    http::StatusCode,
};
use serde::Deserialize;
use std::{collections::BTreeSet, time::Duration};
use storage::Contract;

pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_METADATA_BYTES: usize = 64 * 1024;
pub const MAX_BODY_BYTES: usize = MAX_FILE_BYTES + MAX_METADATA_BYTES + 64 * 1024;
/// Bound slow original transfer separately from post-intake Media work.
pub const INTAKE_TOTAL: Duration = Duration::from_secs(60);
pub const INTAKE_IDLE: Duration = Duration::from_secs(15);

pub use super::capture_claim::BrowserSelectionClaim;

/// Host input data, never an approval, asset identity, or storage proof.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadMetadata {
    pub schema_version: u8,
    pub request_id: String,
    pub idempotency_key: String,
    pub context: storage::Scope,
    pub record_id: String,
    pub expected_revision: u64,
    pub guards: Vec<storage::Guard>,
    pub statement: String,
    pub source_license: media::types::SourceLicense,
    pub reason: String,
    pub filename: String,
    pub content_type: String,
    /// Browser-reported selection facts; no source, capture or storage proof.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture: Option<BrowserSelectionClaim>,
}

pub struct UploadInput {
    pub metadata: UploadMetadata,
    pub bytes: Vec<u8>,
}

/// Standalone stock asset intake carries no place identity or attachment
/// graph. Server-issued asset identity and measured file facts come from Media.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetMetadata {
    pub schema_version: u8,
    pub request_id: String,
    pub idempotency_key: String,
    pub context: storage::Scope,
    pub reason: String,
    pub filename: String,
    pub content_type: String,
    pub source_license: media::types::SourceLicense,
}

pub struct AssetInput {
    pub metadata: AssetMetadata,
    pub bytes: Vec<u8>,
}

/// Only a sanitized status is exposed; parser details and bytes stay private.
#[derive(Debug)]
pub struct IntakeError(StatusCode, Category);
impl IntakeError {
    pub fn status(&self) -> StatusCode {
        self.0
    }
    pub(super) fn category(&self) -> Category {
        self.1
    }
}
fn invalid() -> IntakeError {
    IntakeError(StatusCode::UNPROCESSABLE_ENTITY, Category::InvalidShape)
}
fn oversized() -> IntakeError {
    IntakeError(StatusCode::PAYLOAD_TOO_LARGE, Category::SizeRejected)
}
fn validate_metadata(bytes: &[u8]) -> Result<UploadMetadata, IntakeError> {
    let raw =
        intake::json(bytes).map_err(|error| IntakeError(error.status, Category::InvalidShape))?;
    let native = NativeContracts;
    native
        .validate_shape("scope", &raw["context"])
        .map_err(|_| invalid())?;
    crate::contracts::decode::<crate::contracts::License>(
        &serde_json::to_vec(&raw["sourceLicense"]).map_err(|_| invalid())?,
    )
    .map_err(|_| invalid())?;
    for (kind, field) in [
        ("location-semantics", "recordId"),
        ("evidence", "requestId"),
        ("evidence", "idempotencyKey"),
    ] {
        native
            .validate_shape(
                "recordRef",
                &serde_json::json!({"recordType":kind,"recordId":raw[field]}),
            )
            .map_err(|_| invalid())?;
    }
    let guards = raw["guards"].as_array().ok_or_else(invalid)?;
    if guards.len() > 100 {
        return Err(invalid());
    }
    let mut targets = BTreeSet::new();
    for guard in guards {
        native
            .validate_shape("guard", guard)
            .map_err(|_| invalid())?;
        let target = serde_json::to_string(&guard["record"]).map_err(|_| invalid())?;
        if !targets.insert(target) {
            return Err(invalid());
        }
    }
    let capture_present = raw.get("capture").is_some();
    let metadata: UploadMetadata = serde_json::from_value(raw).map_err(|_| invalid())?;
    if !matches!(
        (
            metadata.schema_version,
            capture_present,
            metadata.capture.is_some()
        ),
        (1, false, false) | (2, true, true)
    ) || !(1..=storage::MAX_REVISION).contains(&metadata.expected_revision)
        || metadata.reason.trim().is_empty()
        || metadata.reason.chars().count() > 1024
        || metadata.statement.trim().is_empty()
        || metadata.statement.chars().count() > 4096
        || metadata.filename.is_empty()
        || metadata.filename.chars().count() > 255
        || metadata
            .filename
            .chars()
            .any(|c| c == '/' || c == '\\' || c <= '\u{1f}')
    {
        return Err(invalid());
    }
    media::types::ContentType::parse(&metadata.content_type).map_err(|_| invalid())?;
    if let Some(capture) = &metadata.capture
        && !capture.validate(&metadata.filename)
    {
        return Err(invalid());
    }
    Ok(metadata)
}

fn validate_asset_metadata(bytes: &[u8]) -> Result<AssetMetadata, IntakeError> {
    let raw =
        intake::json(bytes).map_err(|error| IntakeError(error.status, Category::InvalidShape))?;
    NativeContracts
        .validate_shape("scope", &raw["context"])
        .map_err(|_| invalid())?;
    crate::contracts::decode::<crate::contracts::License>(
        &serde_json::to_vec(&raw["sourceLicense"]).map_err(|_| invalid())?,
    )
    .map_err(|_| invalid())?;
    let metadata: AssetMetadata = serde_json::from_value(raw).map_err(|_| invalid())?;
    if metadata.schema_version != 1
        || metadata.reason.trim().is_empty()
        || metadata.reason.chars().count() > 1024
        || metadata.filename.is_empty()
        || metadata.filename.chars().count() > 255
        || metadata
            .filename
            .chars()
            .any(|c| c == '/' || c == '\\' || c <= '\u{1f}')
        || metadata.content_type != "text/plain"
        || metadata.source_license.status != media::types::LicenseStatus::Unknown
        || metadata.source_license.reference.is_some()
    {
        return Err(invalid());
    }
    Ok(metadata)
}
async fn collect(
    field: &mut axum::extract::multipart::Field<'_>,
    maximum: usize,
    progress: Option<(&Trace, Part)>,
) -> Result<Vec<u8>, IntakeError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = tokio::time::timeout(INTAKE_IDLE, field.chunk())
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT, Category::IdleTimeout))?
        .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
    {
        if let Some((trace, part)) = progress {
            trace.received(part, chunk.len());
        }
        if chunk.len() > maximum.saturating_sub(bytes.len()) {
            return Err(oversized());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn parse(mut request: Request, trace: &Trace) -> Result<UploadInput, IntakeError> {
    DefaultBodyLimit::max(MAX_BODY_BYTES).apply(&mut request);
    let mut fields = Multipart::from_request(request, &()).await.map_err(|_| {
        IntakeError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Category::ContentTypeRejected,
        )
    })?;
    trace.phase(Phase::Metadata);
    let metadata = {
        let mut field = tokio::time::timeout(INTAKE_IDLE, fields.next_field())
            .await
            .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT, Category::IdleTimeout))?
            .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
            .ok_or_else(invalid)?;
        if field.name() != Some("metadata") || field.file_name().is_some() {
            return Err(invalid());
        }
        validate_metadata(
            &collect(
                &mut field,
                MAX_METADATA_BYTES,
                Some((trace, Part::Metadata)),
            )
            .await?,
        )?
    };
    trace.phase(Phase::File);
    let bytes = {
        let mut field = tokio::time::timeout(INTAKE_IDLE, fields.next_field())
            .await
            .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT, Category::IdleTimeout))?
            .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
            .ok_or_else(invalid)?;
        if field.name() != Some("file")
            || field.file_name() != Some(metadata.filename.as_str())
            || field.content_type() != Some(metadata.content_type.as_str())
        {
            return Err(invalid());
        }
        let bytes = collect(&mut field, MAX_FILE_BYTES, Some((trace, Part::File))).await?;
        if bytes.is_empty() {
            return Err(invalid());
        }
        bytes
    };
    trace.phase(Phase::Trailer);
    if tokio::time::timeout(INTAKE_IDLE, fields.next_field())
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT, Category::IdleTimeout))?
        .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
        .is_some()
    {
        return Err(invalid());
    }
    Ok(UploadInput { metadata, bytes })
}

async fn parse_asset(mut request: Request) -> Result<AssetInput, IntakeError> {
    DefaultBodyLimit::max(MAX_BODY_BYTES).apply(&mut request);
    let mut fields = Multipart::from_request(request, &()).await.map_err(|_| {
        IntakeError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Category::ContentTypeRejected,
        )
    })?;
    let metadata = {
        let mut field = fields
            .next_field()
            .await
            .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
            .ok_or_else(invalid)?;
        if field.name() != Some("metadata") || field.file_name().is_some() {
            return Err(invalid());
        }
        validate_asset_metadata(&collect(&mut field, MAX_METADATA_BYTES, None).await?)?
    };
    let bytes = {
        let mut field = fields
            .next_field()
            .await
            .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
            .ok_or_else(invalid)?;
        if field.name() != Some("file")
            || field.file_name() != Some(metadata.filename.as_str())
            || field.content_type() != Some(metadata.content_type.as_str())
        {
            return Err(invalid());
        }
        let bytes = collect(&mut field, MAX_FILE_BYTES, None).await?;
        if bytes.is_empty() {
            return Err(invalid());
        }
        bytes
    };
    if fields
        .next_field()
        .await
        .map_err(|error| IntakeError(error.status(), Category::MultipartRead))?
        .is_some()
    {
        return Err(invalid());
    }
    Ok(AssetInput { metadata, bytes })
}

/// Consume only an already authorized request. No borrowed access/core/store
/// guard may span this async intake. Media must measure and validate the bytes.
pub(super) async fn read(request: Request, trace: &Trace) -> Result<UploadInput, IntakeError> {
    trace.phase(Phase::IntakeHeaders);
    let length = headers::single(request.headers(), "content-length").map_err(|_| oversized())?;
    if let Some(length) = length
        && (length.is_empty()
            || !length.bytes().all(|byte| byte.is_ascii_digit())
            || length.parse::<usize>().map_err(|_| oversized())? > MAX_BODY_BYTES)
    {
        return Err(oversized());
    }
    headers::single(request.headers(), "content-type")
        .map_err(|_| {
            IntakeError(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Category::ContentTypeRejected,
            )
        })?
        .ok_or(IntakeError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Category::ContentTypeRejected,
        ))?;
    tokio::time::timeout(INTAKE_TOTAL, parse(request, trace))
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT, Category::TotalTimeout))?
}

pub async fn read_asset(request: Request) -> Result<AssetInput, IntakeError> {
    let length = headers::single(request.headers(), "content-length").map_err(|_| oversized())?;
    if let Some(length) = length
        && (length.is_empty()
            || !length.bytes().all(|byte| byte.is_ascii_digit())
            || length.parse::<usize>().map_err(|_| oversized())? > MAX_BODY_BYTES)
    {
        return Err(oversized());
    }
    headers::single(request.headers(), "content-type")
        .map_err(|_| {
            IntakeError(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Category::ContentTypeRejected,
            )
        })?
        .ok_or(IntakeError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Category::ContentTypeRejected,
        ))?;
    tokio::time::timeout(Duration::from_secs(10), parse_asset(request))
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT, Category::TotalTimeout))?
}
