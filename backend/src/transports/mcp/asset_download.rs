//! Canonical `atlas.asset.download` codecs and an injected download owner.
//!
//! Schema and correlation checks here do not issue or redeem a download token,
//! authorize media, deliver bytes, or release a result. The real domain dispatch
//! retains all captured-authority, disclosure and final revalidation checks.

use crate::{contracts::stock as wire, domain::stock as domain};
use serde_json::{Number, Value};

/// An immutable request accepted by the exact published download contract.
/// There is no unchecked constructor or mutable access to its wire value.
#[derive(Clone)]
pub struct AssetDownloadRequest {
    request: wire::StockRequest,
}

impl AssetDownloadRequest {
    pub fn parse(validation: &wire::StockValidation, raw: Value) -> domain::StockResult<Self> {
        let request = wire::StockRequest::parse(validation, raw).map_err(contract_error)?;
        if request.id() != wire::OperationId::AtlasAssetDownload {
            return Err(domain::StockError::UnsupportedCapability);
        }
        Ok(Self { request })
    }

    pub fn request(&self) -> &wire::StockRequest {
        &self.request
    }

    pub fn raw(&self) -> &Value {
        self.request.raw()
    }

    pub fn request_id(&self) -> &str {
        self.request.request_id()
    }

    pub fn context(&self) -> &wire::StockContext {
        self.request.context()
    }

    pub fn target(&self) -> &wire::StockTarget {
        self.request.target()
    }
}

/// Borrowed metadata from the exact result, without numeric or DTO conversion.
/// The token is owner-issued metadata; this view supplies no redemption grant.
#[derive(Clone, Copy)]
pub struct AssetDownloadMetadata<'a> {
    pub download_token: &'a str,
    pub sha256: Option<&'a str>,
    pub byte_size: &'a Number,
    pub content_type: &'a str,
    pub disposition: &'a str,
}

/// A schema-checked, correlated completed read. Construction does not discharge
/// the shared response's output obligations or make the result releasable.
#[derive(Clone)]
pub struct AssetDownloadResult {
    response: wire::StockResponse,
}

impl AssetDownloadResult {
    pub fn parse(
        validation: &wire::StockValidation,
        request: &AssetDownloadRequest,
        raw: Value,
    ) -> domain::StockResult<Self> {
        let response = wire::StockResponse::parse(validation, request.request(), raw, &[])
            .map_err(contract_error)?;
        Self::from_response(response)
    }

    fn from_response(response: wire::StockResponse) -> domain::StockResult<Self> {
        if response.command_id() != Some(wire::OperationId::AtlasAssetDownload)
            || response.kind() != &wire::ResponseKind::Read
        {
            return Err(domain::StockError::CorrelationMismatch);
        }
        let result = Self { response };
        result.metadata()?;
        Ok(result)
    }

    pub fn response(&self) -> &wire::StockResponse {
        &self.response
    }

    pub fn raw(&self) -> &Value {
        self.response.raw()
    }

    pub fn metadata(&self) -> domain::StockResult<AssetDownloadMetadata<'_>> {
        let data = self
            .raw()
            .get("data")
            .ok_or(domain::StockError::InvalidContract)?;
        let sha256 = match data.get("sha256") {
            Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.as_str()),
            _ => return Err(domain::StockError::InvalidContract),
        };
        Ok(AssetDownloadMetadata {
            download_token: string(data, "downloadToken")?,
            sha256,
            byte_size: data
                .get("byteSize")
                .and_then(Value::as_number)
                .ok_or(domain::StockError::InvalidContract)?,
            content_type: string(data, "contentType")?,
            disposition: string(data, "disposition")?,
        })
    }
}

/// Implemented by the actual download owner, retaining the original principal
/// and the real prepared witness/graph throughout issuance and result creation.
///
/// The owner supplies the actual token, exact metadata and disclosure facts.
/// It must preserve its media/handle lifecycle and captured authority; the
/// transport neither manufactures those facts nor issues redemption grants.
/// Return the complete unreleased owner carrier. Domain dispatch must still
/// authorize the result and its exact target, then revalidate before release.
pub trait AssetDownloadPort<P, W, G> {
    fn download(
        &mut self,
        principal: &P,
        prepared: &domain::PreparedRequest<W, G>,
        request: &AssetDownloadRequest,
    ) -> domain::StockResult<domain::OwnerResult>;
}

/// Explicit missing download owner. Does not issue a handle or manufacture media.
pub struct UnavailableAssetDownloads;

impl<P, W, G> AssetDownloadPort<P, W, G> for UnavailableAssetDownloads {
    fn download(
        &mut self,
        _: &P,
        _: &domain::PreparedRequest<W, G>,
        _: &AssetDownloadRequest,
    ) -> domain::StockResult<domain::OwnerResult> {
        Err(domain::StockError::OwnerUnavailable)
    }
}

/// A single-operation query codec. Hosts inject a real owner and route other
/// reads through their existing query composition; no media implementation or
/// token issuer is provided here.
pub struct AssetDownloadCodec<D> {
    validation: wire::StockValidation,
    downloads: D,
}

impl<D> AssetDownloadCodec<D> {
    pub fn new(downloads: D) -> domain::StockResult<Self> {
        Ok(Self {
            validation: wire::StockValidation::new().map_err(contract_error)?,
            downloads,
        })
    }

    pub fn into_inner(self) -> D {
        self.downloads
    }
}

impl<P, W, G, D> domain::StockQueryPort<P, W, G> for AssetDownloadCodec<D>
where
    D: AssetDownloadPort<P, W, G>,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &domain::PreparedRequest<W, G>,
    ) -> domain::StockResult<domain::OwnerResult> {
        if prepared.request().id() != domain::OperationId::AtlasAssetDownload {
            return Err(domain::StockError::UnsupportedCapability);
        }
        let request =
            AssetDownloadRequest::parse(&self.validation, prepared.request().raw().clone())?;
        let result = self.downloads.download(principal, prepared, &request)?;
        // The canonical operation is not a batch. Keep the owner's complete
        // carrier intact, including rejecting unrelated ordered child results.
        if !result.children.is_empty() {
            return Err(domain::StockError::CorrelationMismatch);
        }
        let response = wire::StockResponse::parse(
            &self.validation,
            request.request(),
            result.wire.clone(),
            &[],
        )
        .map_err(contract_error)?;
        // Preserve the canonical correlated stockError carrier as well as a
        // completed read. Its authority and release checks still belong to
        // domain dispatch; the success-only metadata view never releases it.
        if response.kind() != &wire::ResponseKind::Error {
            AssetDownloadResult::from_response(response)?;
        }
        // This is deliberately the original unreleased owner value. Its schema
        // acceptance does not replace domain::validate_result or revalidation.
        Ok(result)
    }
}

fn string<'a>(value: &'a Value, field: &str) -> domain::StockResult<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or(domain::StockError::InvalidContract)
}

fn contract_error(error: wire::StockError) -> domain::StockError {
    match error {
        wire::StockError::Setup(_) => domain::StockError::OwnerUnavailable,
        wire::StockError::InvalidContract(_) | wire::StockError::UnknownSchema(_) => {
            domain::StockError::InvalidContract
        }
        wire::StockError::Correlation(_) => domain::StockError::CorrelationMismatch,
    }
}
