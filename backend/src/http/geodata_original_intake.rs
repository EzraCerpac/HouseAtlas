//! Narrow authorized-only multipart intake; no media/source authority is supplied here.
use super::super::upload_intake::multipart_read_error;
use super::super::{
    headers, intake,
    upload_intake::{
        INTAKE_IDLE, INTAKE_TOTAL, MAX_BODY_BYTES, MAX_FILE_BYTES, MAX_METADATA_BYTES,
    },
};
use crate::{
    http::contracts::NativeContracts,
    media,
    storage::{self, Contract},
};
use axum::{
    extract::{DefaultBodyLimit, FromRequest, Multipart, Request},
    http::StatusCode,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssetMetadata {
    pub schema_version: u8,
    pub request_id: String,
    pub idempotency_key: String,
    pub context: storage::Scope,
    pub reason: String,
    pub filename: String,
    pub content_type: String,
    pub source_license: media::types::SourceLicense,
}
impl AssetMetadata {
    pub fn kind(&self) -> media::types::ContentType {
        // Only validated metadata reaches staging.
        match self.content_type.as_str() {
            "application/json" => media::types::ContentType::Json,
            "image/png" => media::types::ContentType::Png,
            "application/pdf" => media::types::ContentType::Pdf,
            "image/tiff" => media::types::ContentType::GeoTiff,
            "application/geo+json" => media::types::ContentType::GeoJson,
            "application/city+json" => media::types::ContentType::CityJson,
            _ => unreachable!("validated native geodata family"),
        }
    }
}
pub(super) struct AssetInput {
    pub metadata: AssetMetadata,
    pub bytes: Vec<u8>,
}
#[derive(Debug)]
pub(super) struct IntakeError(StatusCode);
impl IntakeError {
    pub fn status(&self) -> StatusCode {
        self.0
    }
}
fn invalid() -> IntakeError {
    IntakeError(StatusCode::UNPROCESSABLE_ENTITY)
}
fn oversized() -> IntakeError {
    IntakeError(StatusCode::PAYLOAD_TOO_LARGE)
}
fn multipart_read_error_local(e: axum::extract::multipart::MultipartError) -> IntakeError {
    let error = multipart_read_error(e);
    IntakeError(error.status())
}
async fn next_field(
    fields: &mut Multipart,
) -> Result<Option<axum::extract::multipart::Field<'_>>, IntakeError> {
    tokio::time::timeout(INTAKE_IDLE, fields.next_field())
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT))?
        .map_err(multipart_read_error_local)
}
fn validate_metadata(bytes: &[u8]) -> Result<AssetMetadata, IntakeError> {
    let raw = intake::json(bytes).map_err(|e| IntakeError(e.status))?;
    NativeContracts
        .validate_shape("scope", &raw["context"])
        .map_err(|_| invalid())?;
    crate::contracts::decode::<crate::contracts::License>(
        &serde_json::to_vec(&raw["sourceLicense"]).map_err(|_| invalid())?,
    )
    .map_err(|_| invalid())?;
    let metadata: AssetMetadata = serde_json::from_value(raw).map_err(|_| invalid())?;
    if metadata.schema_version != 1
        || !media::types::is_uuid(&metadata.request_id)
        || !media::types::is_uuid(&metadata.idempotency_key)
        || metadata.reason.trim().is_empty()
        || metadata.reason.chars().count() > 1024
        || metadata.filename.is_empty()
        || metadata.filename.chars().count() > 255
        || metadata
            .filename
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control())
        || !matches!(
            metadata.content_type.as_str(),
            "application/json"
                | "image/tiff"
                | "application/geo+json"
                | "application/city+json"
                | "image/png"
                | "application/pdf"
        )
    {
        return Err(invalid());
    }
    Ok(metadata)
}
async fn collect(
    field: &mut axum::extract::multipart::Field<'_>,
    maximum: usize,
) -> Result<Vec<u8>, IntakeError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = tokio::time::timeout(INTAKE_IDLE, field.chunk())
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT))?
        .map_err(multipart_read_error_local)?
    {
        if chunk.len() > maximum.saturating_sub(bytes.len()) {
            return Err(oversized());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn parse(mut request: Request) -> Result<AssetInput, IntakeError> {
    DefaultBodyLimit::max(MAX_BODY_BYTES).apply(&mut request);
    let mut fields = Multipart::from_request(request, &())
        .await
        .map_err(|_| IntakeError(StatusCode::UNSUPPORTED_MEDIA_TYPE))?;
    let metadata = {
        let mut field = next_field(&mut fields).await?.ok_or_else(invalid)?;
        if field.name() != Some("metadata") || field.file_name().is_some() {
            return Err(invalid());
        }
        validate_metadata(&collect(&mut field, MAX_METADATA_BYTES).await?)?
    };
    let bytes = {
        let mut field = next_field(&mut fields).await?.ok_or_else(invalid)?;
        if field.name() != Some("file")
            || field.file_name() != Some(metadata.filename.as_str())
            || field.content_type() != Some(metadata.content_type.as_str())
        {
            return Err(invalid());
        }
        let bytes = collect(&mut field, MAX_FILE_BYTES).await?;
        if bytes.is_empty() {
            return Err(invalid());
        }
        bytes
    };
    if next_field(&mut fields).await?.is_some() {
        return Err(invalid());
    }
    Ok(AssetInput { metadata, bytes })
}

pub(super) async fn read(request: Request) -> Result<AssetInput, IntakeError> {
    let length = headers::single(request.headers(), "content-length").map_err(|_| oversized())?;
    if let Some(length) = length
        && (length.is_empty()
            || !length.bytes().all(|byte| byte.is_ascii_digit())
            || length.parse::<usize>().map_err(|_| oversized())? > MAX_BODY_BYTES)
    {
        return Err(oversized());
    }
    headers::single(request.headers(), "content-type")
        .map_err(|_| IntakeError(StatusCode::UNSUPPORTED_MEDIA_TYPE))?
        .ok_or(IntakeError(StatusCode::UNSUPPORTED_MEDIA_TYPE))?;
    tokio::time::timeout(INTAKE_TOTAL, parse(request))
        .await
        .map_err(|_| IntakeError(StatusCode::REQUEST_TIMEOUT))?
}
