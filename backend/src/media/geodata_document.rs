//! Unselected native document/preview contract. No router, listener, migration,
//! provider intake or household admission is installed by this module.
//! The eventual adapter must persist qualified records atomically with audit
//! and use this source-aware access path for previews (not a bare PNG grant).
use super::{
    MAX_BYTES, MediaError, MediaResult, WorkBudget, content, geodata_original,
    types::{
        AssetPurpose, AssetRecord, Availability, ContentType, Lifecycle, PreviewPolicy, Scope,
        SourceLicense, is_digest, is_uuid, sha256,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const PREVIEW_MIME: &str = "application/vnd.houseatlas.geodata-preview+png";
// Composite GIS previews need a reviewed multi-source/license extension.
const MAX_INPUTS: usize = 1;
const MAX_TOTAL_BYTES: u64 = 3 * MAX_BYTES as u64;
fn need(v: bool) -> MediaResult<()> {
    if v {
        Ok(())
    } else {
        Err(MediaError::InvalidInput)
    }
}
fn text(s: &str) -> bool {
    !s.is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control)
}
fn timestamp(s: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(s).is_ok()
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DatePrecision {
    Year,
    Day,
    Instant,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceDate {
    pub value: String,
    pub precision: DatePrecision,
}
impl SourceDate {
    fn valid(&self) -> bool {
        match self.precision {
            DatePrecision::Year => {
                self.value.len() == 4 && self.value.bytes().all(|b| b.is_ascii_digit())
            }
            DatePrecision::Day => {
                chrono::NaiveDate::parse_from_str(&self.value, "%Y-%m-%d").is_ok()
            }
            DatePrecision::Instant => timestamp(&self.value),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceFrame {
    pub crs: Option<String>,
    pub axes: Vec<String>,
    pub linear_unit: Option<String>,
    pub extent: Option<Vec<f64>>,
}
impl SourceFrame {
    fn validate(&self) -> MediaResult<()> {
        need(
            self.crs.as_ref().is_none_or(|s| text(s))
                && self.linear_unit.as_ref().is_none_or(|s| text(s))
                && self.axes.len() <= 3
                && self.axes.iter().all(|s| text(s)),
        )?;
        if let Some(e) = &self.extent {
            need(
                matches!(e.len(), 4 | 6)
                    && e.iter().all(|n| n.is_finite())
                    && (0..e.len() / 2).all(|i| e[i] <= e[i + e.len() / 2]),
            )?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceProvenance {
    pub agency: String,
    pub url: Option<String>,
    pub license: SourceLicense,
    pub retrieved_at: String,
    pub published: Option<SourceDate>,
    pub observed: Option<SourceDate>,
    pub frame: SourceFrame,
    pub custody_receipt_sha256: String,
}
impl SourceProvenance {
    fn validate(&self) -> MediaResult<()> {
        need(
            text(&self.agency)
                && timestamp(&self.retrieved_at)
                && is_digest(&self.custody_receipt_sha256)
                && self.published.as_ref().is_none_or(SourceDate::valid)
                && self.observed.as_ref().is_none_or(SourceDate::valid),
        )?;
        if let Some(s) = &self.url {
            let u = url::Url::parse(s).map_err(|_| MediaError::InvalidInput)?;
            need(
                text(s)
                    && u.scheme() == "https"
                    && u.username().is_empty()
                    && u.password().is_none()
                    && u.fragment().is_none()
                    && u.host_str().is_some(),
            )?;
        }
        need(self.license.reference.as_ref().is_none_or(|s| text(s)))?;
        self.frame.validate()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetPin {
    pub asset_id: String,
    pub revision: u64,
    pub sha256: String,
    pub bytes: u64,
}
impl AssetPin {
    fn validate(&self) -> MediaResult<()> {
        need(
            is_uuid(&self.asset_id)
                && self.revision > 0
                && is_digest(&self.sha256)
                && (1..=MAX_BYTES as u64).contains(&self.bytes),
        )
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewLineage {
    pub asset: AssetPin,
    pub inputs: Vec<AssetPin>,
    pub renderer: String,
    pub renderer_version: String,
    pub renderer_config_sha256: String,
    pub qualification_receipt_sha256: String,
    pub source_crop_extent: Option<Vec<f64>>,
    pub description: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeodataDocument {
    pub schema: String,
    pub document_id: String,
    pub scope: Scope,
    pub revision: u64,
    pub lifecycle: Lifecycle,
    pub title: String,
    pub original: AssetPin,
    pub provenance: SourceProvenance,
    pub preview: Option<PreviewLineage>,
}
impl GeodataDocument {
    pub fn validate(&self) -> MediaResult<()> {
        self.scope.validate()?;
        self.original.validate()?;
        self.provenance.validate()?;
        need(
            self.schema == "houseatlas.geodata-document.v1"
                && is_uuid(&self.document_id)
                && self.revision > 0
                && text(&self.title),
        )?;
        if let Some(p) = &self.preview {
            p.asset.validate()?;
            need(
                !p.inputs.is_empty()
                    && p.inputs.len() <= MAX_INPUTS
                    && p.inputs.contains(&self.original)
                    && p.asset.asset_id != self.original.asset_id
                    && text(&p.renderer)
                    && text(&p.renderer_version)
                    && is_digest(&p.renderer_config_sha256)
                    && is_digest(&p.qualification_receipt_sha256)
                    && text(&p.description),
            )?;
            let mut ids = BTreeSet::new();
            let mut total = p.asset.bytes;
            for input in &p.inputs {
                input.validate()?;
                need(input.asset_id != p.asset.asset_id && ids.insert(&input.asset_id))?;
                total = total.checked_add(input.bytes).ok_or(MediaError::TooLarge)?;
            }
            need(total <= MAX_TOTAL_BYTES)?;
            if let Some(e) = &p.source_crop_extent {
                need(
                    matches!(e.len(), 4 | 6)
                        && e.iter().all(|n| n.is_finite())
                        && (0..e.len() / 2).all(|i| e[i] <= e[i + e.len() / 2]),
                )?;
            }
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentReadMode {
    Original,
    Preview,
}
/// The caller cannot construct this proof directly. It qualifies exact retained
/// bytes and their binding; it is not a persistence or principal authorization.
pub struct QualifiedDocument {
    document: GeodataDocument,
}
/// The native adapter verifies a separately approved retained renderer receipt
/// against the original, PNG and config pins. Client receipt strings alone are
/// not proof of source-to-pixel derivation. No implementation is selected here.
pub trait PreviewQualificationPort {
    fn verify_retained_derivation(&self, document: &GeodataDocument) -> MediaResult<()>;
}
impl QualifiedDocument {
    pub fn document(&self) -> &GeodataDocument {
        &self.document
    }
}
fn record_matches(
    record: &AssetRecord,
    scope: &Scope,
    pin: &AssetPin,
    preview: bool,
) -> MediaResult<ContentType> {
    record.validate()?;
    need(
        record.scope() == *scope
            && record.record_id == pin.asset_id
            && record.revision == pin.revision
            && record.payload.sha256 == pin.sha256
            && record.payload.byte_size == pin.bytes
            && record.lifecycle == Lifecycle::Active
            && record.payload.availability == Availability::Available,
    )?;
    let kind = ContentType::parse_owned(&record.payload.content_type)?;
    if preview {
        need(
            kind == ContentType::GeodataPreviewPng
                && record.payload.purpose == AssetPurpose::DerivedPreview
                && record.payload.preview_policy == PreviewPolicy::SafeRendered,
        )?;
    } else {
        need(
            matches!(
                kind,
                ContentType::GeoTiff | ContentType::GeoJson | ContentType::CityJson
            ) && record.payload.purpose == AssetPurpose::EvidenceOriginal
                && record.payload.preview_policy == PreviewPolicy::DownloadOnly,
        )?;
    }
    Ok(kind)
}
fn check_blob(bytes: &[u8], pin: &AssetPin) -> MediaResult<()> {
    need(bytes.len() as u64 == pin.bytes && bytes.len() <= MAX_BYTES && sha256(bytes) == pin.sha256)
}
/// Admission helpers accept only source-neutral retained bytes. The future native
/// write adapter must authorize and atomically journal document+asset bindings.
pub fn qualify<Q: PreviewQualificationPort>(
    qualification: &Q,
    document: GeodataDocument,
    inputs: &[(AssetRecord, Vec<u8>)],
    preview: Option<&(AssetRecord, Vec<u8>)>,
    budget: &WorkBudget,
) -> MediaResult<QualifiedDocument> {
    document.validate()?;
    need(document.lifecycle == Lifecycle::Active)?;
    budget.check()?;
    let pins = document
        .preview
        .as_ref()
        .map_or_else(|| vec![&document.original], |p| p.inputs.iter().collect());
    need(inputs.len() == pins.len())?;
    for pin in pins {
        let matches: Vec<_> = inputs
            .iter()
            .filter(|(r, _)| r.record_id == pin.asset_id)
            .collect();
        need(matches.len() == 1)?;
        let (r, b) = matches[0];
        let kind = record_matches(r, &document.scope, pin, false)?;
        check_blob(b, pin)?;
        geodata_original::validate(b, kind, budget)?;
        if *pin == document.original {
            need(r.payload.source_license == document.provenance.license)?;
        }
    }
    match (&document.preview, preview) {
        (Some(p), Some((r, b))) => {
            record_matches(r, &document.scope, &p.asset, true)?;
            need(r.payload.source_license == document.provenance.license)?;
            check_blob(b, &p.asset)?;
            content::validate_content(b, ContentType::GeodataPreviewPng, budget)?
                .ok_or(MediaError::Unsupported)?;
            qualification.verify_retained_derivation(&document)?;
        }
        (None, None) => {}
        _ => return Err(MediaError::InvalidInput),
    }
    budget.check()?;
    Ok(QualifiedDocument { document })
}
/// The adapter must read authoritative scoped records, never client manifests.
pub trait GeodataDocumentStoragePort<P> {
    fn read_document(&self, principal: &P, scope: &Scope, id: &str)
    -> MediaResult<GeodataDocument>;
    fn read_asset(&self, principal: &P, scope: &Scope, id: &str) -> MediaResult<AssetRecord>;
    fn read_retained(&self, record: &AssetRecord, budget: &WorkBudget) -> MediaResult<Vec<u8>>;
}
pub trait GeodataDocumentAccessPort<P> {
    type Grant;
    fn authorize(
        &self,
        principal: &P,
        document: &GeodataDocument,
        mode: DocumentReadMode,
    ) -> MediaResult<Self::Grant>;
    fn revalidate(
        &self,
        principal: &P,
        grant: &Self::Grant,
        document: &GeodataDocument,
        mode: DocumentReadMode,
    ) -> MediaResult<()>;
}
pub struct DocumentResponse {
    pub content_type: &'static str,
    pub download: bool,
    pub bytes: Vec<u8>,
}
pub struct DocumentReadRequest<'a, P> {
    pub principal: &'a P,
    pub scope: &'a Scope,
    pub document_id: &'a str,
    pub mode: DocumentReadMode,
}
/// Source-aware original/PNG read. Lookup, scope, original inputs and source grant
/// are checked again after byte work. An unavailable source never falls back to
/// an unrelated/current preview. The transport adapter supplies private/no-store,
/// attachment vs inline, nosniff and sandbox headers; no source URL is emitted.
pub fn read<
    P,
    S: GeodataDocumentStoragePort<P>,
    A: GeodataDocumentAccessPort<P>,
    Q: PreviewQualificationPort,
>(
    store: &S,
    access: &A,
    qualification_port: &Q,
    request: DocumentReadRequest<'_, P>,
    budget: &WorkBudget,
) -> MediaResult<DocumentResponse> {
    let DocumentReadRequest {
        principal,
        scope,
        document_id: id,
        mode,
    } = request;
    scope.validate()?;
    need(is_uuid(id))?;
    budget.check()?;
    let d = store.read_document(principal, scope, id)?;
    d.validate()?;
    need(d.scope == *scope && d.document_id == id && d.lifecycle == Lifecycle::Active)?;
    let grant = access.authorize(principal, &d, mode)?;
    let pins = match mode {
        DocumentReadMode::Original => vec![d.original.clone()],
        DocumentReadMode::Preview => d
            .preview
            .as_ref()
            .ok_or(MediaError::NotFound)?
            .inputs
            .clone(),
    };
    let mut inputs = Vec::new();
    for pin in &pins {
        let r = store.read_asset(principal, scope, &pin.asset_id)?;
        record_matches(&r, scope, pin, false)?;
        let b = store.read_retained(&r, budget)?;
        inputs.push((r, b));
    }
    let preview = match (mode, &d.preview) {
        (DocumentReadMode::Preview, Some(p)) => {
            let r = store.read_asset(principal, scope, &p.asset.asset_id)?;
            record_matches(&r, scope, &p.asset, true)?;
            let b = store.read_retained(&r, budget)?;
            Some((r, b))
        }
        _ => None,
    };
    let mut qualification = d.clone();
    if mode == DocumentReadMode::Original {
        qualification.preview = None;
    }
    qualify(
        qualification_port,
        qualification,
        &inputs,
        preview.as_ref(),
        budget,
    )?;
    let response = match mode {
        DocumentReadMode::Original => {
            let (r, b) = inputs
                .iter()
                .find(|(r, _)| r.record_id == d.original.asset_id)
                .ok_or(MediaError::NotFound)?;
            DocumentResponse {
                content_type: ContentType::parse_owned(&r.payload.content_type)?.as_str(),
                download: true,
                bytes: b.clone(),
            }
        }
        DocumentReadMode::Preview => {
            let (_, b) = preview.as_ref().ok_or(MediaError::NotFound)?;
            DocumentResponse {
                content_type: "image/png",
                download: false,
                bytes: content::validate_content(b, ContentType::GeodataPreviewPng, budget)?
                    .ok_or(MediaError::Unsupported)?,
            }
        }
    };
    if mode == DocumentReadMode::Preview {
        qualification_port.verify_retained_derivation(&d)?;
    }
    need(store.read_document(principal, scope, id)? == d)?;
    for (r, _) in inputs.iter().chain(preview.iter()) {
        need(store.read_asset(principal, scope, &r.record_id)? == *r)?;
    }
    access.revalidate(principal, &grant, &d, mode)?;
    budget.check()?;
    Ok(response)
}

#[cfg(test)]
#[path = "geodata_document_healthy.rs"]
mod tests;
