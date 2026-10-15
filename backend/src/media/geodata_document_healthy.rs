//! Only generated in-memory examples; no files, providers, native admission or listener.
use super::*;
use crate::media::{
    content::validate_original_content,
    healthy_examples::{budget, license, png_fixture, record, scope, u},
    types::{AssetOwner, AssetPayload},
};
use std::cell::Cell;
fn original_bytes() -> Vec<u8> {
    br#"{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[123,456]},"properties":{"synthetic":true}}]}"#.to_vec()
}
fn asset(id: u32, bytes: &[u8], kind: ContentType, preview: bool) -> AssetRecord {
    record(
        id,
        AssetPayload {
            owner: AssetOwner::Atlas,
            purpose: if preview {
                AssetPurpose::DerivedPreview
            } else {
                AssetPurpose::EvidenceOriginal
            },
            storage_key: scope().storage_key(&sha256(bytes)).unwrap(),
            sha256: sha256(bytes),
            byte_size: bytes.len() as u64,
            content_type: kind.as_str().into(),
            source_license: license(),
            availability: Availability::Available,
            preview_policy: if preview {
                PreviewPolicy::SafeRendered
            } else {
                PreviewPolicy::DownloadOnly
            },
            evidence_ids: vec![],
        },
    )
}
fn pin(r: &AssetRecord) -> AssetPin {
    AssetPin {
        asset_id: r.record_id.clone(),
        revision: r.revision,
        sha256: r.payload.sha256.clone(),
        bytes: r.payload.byte_size,
    }
}
fn fixture() -> (
    GeodataDocument,
    Vec<(AssetRecord, Vec<u8>)>,
    (AssetRecord, Vec<u8>),
) {
    let raw = original_bytes();
    let source = asset(20, &raw, ContentType::GeoJson, false);
    let png = png_fixture(true, 0).0;
    let preview = asset(21, &png, ContentType::GeodataPreviewPng, true);
    let doc = GeodataDocument {
        schema: "houseatlas.geodata-document.v1".into(),
        document_id: u(30),
        scope: scope(),
        revision: 1,
        lifecycle: Lifecycle::Active,
        title: "Generated point source".into(),
        original: pin(&source),
        provenance: SourceProvenance {
            agency: "Synthetic source agency".into(),
            url: Some("https://example.invalid/generated-point.geojson".into()),
            license: license(),
            retrieved_at: "2026-01-02T12:00:00Z".into(),
            published: None,
            observed: Some(SourceDate {
                value: "2024".into(),
                precision: DatePrecision::Year,
            }),
            frame: SourceFrame {
                crs: None,
                axes: vec![],
                linear_unit: None,
                extent: None,
            },
            custody_receipt_sha256: sha256(b"generated source custody"),
        },
        preview: Some(PreviewLineage {
            asset: pin(&preview),
            inputs: vec![pin(&source)],
            renderer: "synthetic-fixture".into(),
            renderer_version: "1".into(),
            renderer_config_sha256: sha256(b"generated config"),
            qualification_receipt_sha256: sha256(b"generated qualification"),
            source_crop_extent: None,
            description: "Generated PNG; fictional point preview".into(),
        }),
    };
    (doc, vec![(source, raw)], (preview, png))
}
struct SyntheticQualification {
    expected: GeodataDocument,
    calls: Cell<usize>,
}
impl PreviewQualificationPort for SyntheticQualification {
    fn verify_retained_derivation(&self, d: &GeodataDocument) -> MediaResult<()> {
        assert_eq!(d, &self.expected);
        self.calls.set(self.calls.get() + 1);
        Ok(())
    }
}
struct Store {
    document: GeodataDocument,
    assets: Vec<(AssetRecord, Vec<u8>)>,
}
impl GeodataDocumentStoragePort<()> for Store {
    fn read_document(&self, _: &(), s: &Scope, id: &str) -> MediaResult<GeodataDocument> {
        assert_eq!(s, &self.document.scope);
        assert_eq!(id, self.document.document_id);
        Ok(self.document.clone())
    }
    fn read_asset(&self, _: &(), s: &Scope, id: &str) -> MediaResult<AssetRecord> {
        assert_eq!(s, &self.document.scope);
        self.assets
            .iter()
            .find(|(r, _)| r.record_id == id)
            .map(|(r, _)| r.clone())
            .ok_or(MediaError::NotFound)
    }
    fn read_retained(&self, r: &AssetRecord, b: &WorkBudget) -> MediaResult<Vec<u8>> {
        b.check()?;
        self.assets
            .iter()
            .find(|(a, _)| a == r)
            .map(|(_, b)| b.clone())
            .ok_or(MediaError::NotFound)
    }
}
struct Access {
    authorized: Cell<usize>,
    revalidated: Cell<usize>,
}
impl GeodataDocumentAccessPort<()> for Access {
    type Grant = (String, u64, DocumentReadMode);
    fn authorize(
        &self,
        _: &(),
        d: &GeodataDocument,
        m: DocumentReadMode,
    ) -> MediaResult<Self::Grant> {
        self.authorized.set(self.authorized.get() + 1);
        Ok((d.document_id.clone(), d.revision, m))
    }
    fn revalidate(
        &self,
        _: &(),
        g: &Self::Grant,
        d: &GeodataDocument,
        m: DocumentReadMode,
    ) -> MediaResult<()> {
        assert_eq!(g, &(d.document_id.clone(), d.revision, m));
        self.revalidated.set(self.revalidated.get() + 1);
        Ok(())
    }
}
#[test]
fn healthy_geodata_original_framing_and_provider_families() {
    let mut tif = b"II\x2a\0\x08\0\0\0\x02\0".to_vec();
    for tag in [256u16, 257] {
        tif.extend(tag.to_le_bytes());
        tif.extend(3u16.to_le_bytes());
        tif.extend(1u32.to_le_bytes());
        tif.extend([1, 0, 0, 0]);
    }
    tif.extend([0, 0, 0, 0]);
    let geo = original_bytes();
    let city = br#"{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[[1,2,3]]}"#;
    for (b, k) in [
        (&tif[..], ContentType::GeoTiff),
        (&geo[..], ContentType::GeoJson),
        (&city[..], ContentType::CityJson),
    ] {
        assert_eq!(ContentType::parse_owned(k.as_str()).unwrap(), k);
        assert!(k.supports_purpose(AssetPurpose::EvidenceOriginal));
        validate_original_content(b, k, &budget()).unwrap();
        assert!(
            content::validate_content(b, k, &budget())
                .unwrap()
                .is_none()
        );
    }
    for mime in ["image/png", "image/jpeg", "application/pdf", "text/plain"] {
        assert_eq!(ContentType::parse(mime).unwrap().as_str(), mime);
    }
    // Native format admission does not extend provider intake.
    assert_eq!(
        ContentType::parse("image/tiff"),
        Err(MediaError::Unsupported)
    );
}
#[test]
fn healthy_document_original_and_qualified_png_read() {
    let (doc, inputs, preview) = fixture();
    let q = SyntheticQualification {
        expected: doc.clone(),
        calls: Cell::new(0),
    };
    assert_eq!(
        qualify(&q, doc.clone(), &inputs, Some(&preview), &budget())
            .unwrap()
            .document(),
        &doc
    );
    let source = inputs[0].1.clone();
    let mut assets = inputs;
    assets.push(preview);
    let store = Store {
        document: doc.clone(),
        assets,
    };
    let access = Access {
        authorized: Cell::new(0),
        revalidated: Cell::new(0),
    };
    let original = read(
        &store,
        &access,
        &q,
        DocumentReadRequest {
            principal: &(),
            scope: &doc.scope,
            document_id: &doc.document_id,
            mode: DocumentReadMode::Original,
        },
        &budget(),
    )
    .unwrap();
    assert!(original.download);
    assert_eq!(original.content_type, "application/geo+json");
    assert_eq!(original.bytes, source);
    let image = read(
        &store,
        &access,
        &q,
        DocumentReadRequest {
            principal: &(),
            scope: &doc.scope,
            document_id: &doc.document_id,
            mode: DocumentReadMode::Preview,
        },
        &budget(),
    )
    .unwrap();
    assert!(!image.download);
    assert_eq!(image.content_type, "image/png");
    assert!(image.bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(!image.bytes.windows(14).any(|w| w == b"private-note\0s"));
    assert_eq!(access.authorized.get(), 2);
    assert_eq!(access.revalidated.get(), 2);
    assert_eq!(q.calls.get(), 3);
    let reopened: GeodataDocument =
        serde_json::from_slice(&serde_json::to_vec(&doc).unwrap()).unwrap();
    assert_eq!(reopened, doc);
    assert!(reopened.provenance.frame.crs.is_none());
    assert!(reopened.provenance.published.is_none());
    assert_eq!(reopened.provenance.observed.unwrap().value, "2024");
}
#[test]
fn healthy_original_download_independent_of_optional_preview() {
    let (doc, inputs, _) = fixture();
    // The document still lists its optional derivative, but only the retained
    // original exists in this store. Original download need not read that PNG.
    assert!(doc.preview.is_some());
    let q = SyntheticQualification {
        expected: doc.clone(),
        calls: Cell::new(0),
    };
    let source = inputs[0].1.clone();
    let store = Store {
        document: doc.clone(),
        assets: inputs,
    };
    let access = Access {
        authorized: Cell::new(0),
        revalidated: Cell::new(0),
    };
    let r = read(
        &store,
        &access,
        &q,
        DocumentReadRequest {
            principal: &(),
            scope: &doc.scope,
            document_id: &doc.document_id,
            mode: DocumentReadMode::Original,
        },
        &budget(),
    )
    .unwrap();
    assert_eq!(r.bytes, source);
    assert_eq!(q.calls.get(), 0);
}
