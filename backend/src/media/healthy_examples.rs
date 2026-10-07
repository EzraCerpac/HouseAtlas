//! Named healthy synthetic examples only. Peer access/storage for delivery are
//! explicit stubs; recovery uses actual SQLite through a public JS test adapter.
//! No stopped controls, broad test aggregates, listeners or providers run here.
use std::cell::Cell;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use flate2::{Compression, read::ZlibDecoder, write::ZlibEncoder};

use super::content::render_png;
use super::recovery::{
    RecoveryDatabasePort, ValidatedDatabase, capture_recovery, restore_recovery, verify_recovery,
};
use super::service::{
    DeliveryMode, MediaAccessPort, MediaService, MediaStoragePort, OwnedDescriptor,
    OwnedMediaMetadata, ReadMethod, StoredAsset,
};
use super::types::{
    AssetPayload, AssetPurpose, AssetRecord, AssetRecordType, Availability, ContentType,
    LicenseStatus, Lifecycle, Scope, SourceLicense, sha256,
};
use super::vault::AvailableAssetVerifier;
use super::{AssetVault, Cancellation, MediaError, MediaResult, WorkBudget};

pub(super) fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default()).unwrap()
}

pub(super) fn u(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

pub(super) fn scope() -> Scope {
    Scope {
        workspace_id: u(1),
        home_id: u(2),
    }
}

pub(super) fn record(id: u32, payload: AssetPayload) -> AssetRecord {
    AssetRecord {
        schema_version: 1,
        record_type: AssetRecordType::Asset,
        record_id: u(id),
        workspace_id: u(1),
        home_id: u(2),
        revision: 1,
        lifecycle: Lifecycle::Active,
        created_at: "2026-01-02T12:00:00Z".to_owned(),
        updated_at: "2026-01-02T12:00:00Z".to_owned(),
        last_audit_id: u(10000 + id),
        payload,
    }
}

pub(super) fn license() -> SourceLicense {
    SourceLicense {
        status: LicenseStatus::Unknown,
        reference: None,
    }
}

// Independent positive fixture encoder. Filtered bytes are calculated from
// expected pixel rows; production's renderer is never used to create input.
pub(super) fn png_fixture(rgba: bool, filter: u8) -> (Vec<u8>, Vec<u8>) {
    let bpp = if rgba { 4 } else { 3 };
    let stride = 2 * bpp;
    let pixels: Vec<u8> = (0..2 * stride).map(|i| ((i + 1) * 7) as u8).collect();
    let mut filtered = Vec::new();
    for y in 0..2 {
        filtered.push(filter);
        for x in 0..stride {
            let index = y * stride + x;
            let left = if x >= bpp { pixels[index - bpp] } else { 0 };
            let up = if y > 0 { pixels[index - stride] } else { 0 };
            let upper_left = if y > 0 && x >= bpp {
                pixels[index - stride - bpp]
            } else {
                0
            };
            let predicted = match filter {
                0 => 0,
                1 => left,
                2 => up,
                3 => ((u16::from(left) + u16::from(up)) / 2) as u8,
                4 => {
                    let p = i32::from(left) + i32::from(up) - i32::from(upper_left);
                    [left, up, upper_left]
                        .into_iter()
                        .min_by_key(|b| (p - i32::from(*b)).abs())
                        .unwrap()
                }
                _ => unreachable!(),
            };
            filtered.push(pixels[index].wrapping_sub(predicted));
        }
    }
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&filtered).unwrap();
    let compressed = encoder.finish().unwrap();
    let mut header = Vec::new();
    header.extend_from_slice(&2u32.to_be_bytes());
    header.extend_from_slice(&2u32.to_be_bytes());
    header.extend_from_slice(&[8, if rgba { 6 } else { 2 }, 0, 0, 0]);
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8; 4], bytes: &[u8]| {
        png.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        let mut crc_input = kind.to_vec();
        crc_input.extend_from_slice(bytes);
        png.extend_from_slice(&crc_input);
        png.extend_from_slice(&crc32fast::hash(&crc_input).to_be_bytes());
    };
    chunk(b"IHDR", &header);
    chunk(b"tEXt", b"private-note\0synthetic marker");
    chunk(b"IDAT", &compressed);
    chunk(b"IEND", &[]);
    (png, pixels)
}

fn assert_preview_pixels(preview: &[u8], expected: &[u8], rgba: bool) {
    assert_eq!(&preview[..8], b"\x89PNG\r\n\x1a\n");
    let mut offset = 8;
    let mut kinds = Vec::new();
    let mut compressed = Vec::new();
    while offset < preview.len() {
        let size = u32::from_be_bytes(preview[offset..offset + 4].try_into().unwrap()) as usize;
        let kind = &preview[offset + 4..offset + 8];
        let data = &preview[offset + 8..offset + 8 + size];
        kinds.push(kind.to_vec());
        if kind == b"IHDR" {
            assert_eq!(&data[..8], &[0, 0, 0, 2, 0, 0, 0, 2]);
            assert_eq!(data[9], if rgba { 6 } else { 2 });
        }
        if kind == b"IDAT" {
            compressed.extend_from_slice(data);
        }
        offset += size + 12;
    }
    assert_eq!(
        kinds,
        [b"IHDR".to_vec(), b"IDAT".to_vec(), b"IEND".to_vec()]
    );
    let mut raw = Vec::new();
    ZlibDecoder::new(compressed.as_slice())
        .read_to_end(&mut raw)
        .unwrap();
    let stride = if rgba { 8 } else { 6 };
    for y in 0..2 {
        assert_eq!(raw[y * (stride + 1)], 0);
        assert_eq!(
            &raw[y * (stride + 1) + 1..(y + 1) * (stride + 1)],
            &expected[y * stride..(y + 1) * stride]
        );
    }
}

#[test]
fn healthy_rgb_rgba_all_filters_preserve_pixels_and_strip_metadata() {
    for rgba in [false, true] {
        for filter in 0..=4 {
            let (png, pixels) = png_fixture(rgba, filter);
            assert_preview_pixels(&render_png(&png, &budget()).unwrap(), &pixels, rgba);
        }
    }
    println!(
        "healthy static PNG examples: RGB/RGBA, filters 0..4, dimensions/pixels preserved, only IHDR/IDAT/IEND"
    );
}

struct SyntheticPrincipal;
struct SyntheticDeliveryStore {
    record: AssetRecord,
    reads: Cell<usize>,
}

impl MediaStoragePort<SyntheticPrincipal> for SyntheticDeliveryStore {
    fn read_owned_asset(
        &self,
        _: &SyntheticPrincipal,
        _: &Scope,
        _: &str,
    ) -> MediaResult<StoredAsset> {
        self.reads.set(self.reads.get() + 1);
        Ok(StoredAsset {
            record: self.record.clone(),
            manifest: self.record.payload.clone(),
        })
    }
}

struct SyntheticAccess {
    authorized: Cell<usize>,
    revalidated: Cell<usize>,
}
struct SyntheticGrant;

impl MediaAccessPort<SyntheticPrincipal> for SyntheticAccess {
    type Grant = SyntheticGrant;
    fn authorize_owned_media(
        &self,
        _: &SyntheticPrincipal,
        _: &OwnedDescriptor,
        _: &OwnedMediaMetadata,
        _: DeliveryMode,
    ) -> MediaResult<Self::Grant> {
        self.authorized.set(self.authorized.get() + 1);
        Ok(SyntheticGrant)
    }
    fn revalidate_owned_media(
        &self,
        _: &SyntheticPrincipal,
        _: &Self::Grant,
        _: &OwnedDescriptor,
        _: &OwnedMediaMetadata,
        _: DeliveryMode,
    ) -> MediaResult<()> {
        self.revalidated.set(self.revalidated.get() + 1);
        Ok(())
    }
}

fn public_peer(mode: &str, path: &Path, input: Option<&Path>) -> MediaResult<Vec<u8>> {
    let helper = Path::new(file!())
        .parent()
        .ok_or(MediaError::Unavailable)?
        .join("checks/public-fixture.mjs");
    let mut command = Command::new("node");
    command.arg(helper).arg(mode).arg(path);
    if let Some(input) = input {
        command.arg(input);
    }
    let output = command.output().map_err(|_| MediaError::Unavailable)?;
    if !output.status.success() {
        eprintln!(
            "healthy public compatibility peer failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return Err(MediaError::Unavailable);
    }
    Ok(output.stdout)
}

/// Explicit test adapter: backup and frozen DB validation use the PUBLIC JS
/// core. This is actual SQLite compatibility evidence, not Rust AT07 proof.
struct PublicFixtureDatabase {
    path: PathBuf,
}

impl RecoveryDatabasePort for PublicFixtureDatabase {
    fn backup_to(&self, destination: &Path, budget: &WorkBudget) -> MediaResult<()> {
        budget.check()?;
        public_peer("backup", &self.path, Some(destination))?;
        budget.check()
    }
    fn validate_recovery_database(
        &self,
        path: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<ValidatedDatabase> {
        budget.check()?;
        let value: serde_json::Value =
            serde_json::from_slice(&public_peer("validate", path, None)?)
                .map_err(|_| MediaError::Unavailable)?;
        let assets =
            serde_json::from_value(value["assets"].clone()).map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        Ok(ValidatedDatabase {
            contract_version: value["contractVersion"]
                .as_str()
                .ok_or(MediaError::Unavailable)?
                .to_owned(),
            database_schema: value["databaseSchema"]
                .as_u64()
                .ok_or(MediaError::Unavailable)? as u32,
            database_lineage: None,
            assets,
        })
    }
}

#[test]
fn healthy_owned_delivery_public_sqlite_capture_restore_and_receipt_bytes() {
    let temp = tempfile::Builder::new()
        .prefix("houseatlas-at12-healthy-")
        .tempdir()
        .unwrap();
    // macOS temporary roots can use /var or /tmp aliases; production directory
    // pins deliberately require canonical configured paths on both platforms.
    let temp_root = fs::canonicalize(temp.path()).unwrap();
    let configured_parent = temp_root.join("configured-parent");
    fs::create_dir(&configured_parent).unwrap();
    fs::set_permissions(&configured_parent, fs::Permissions::from_mode(0o755)).unwrap();
    let vault_root = configured_parent.join("media");
    let vault = AssetVault::open(&vault_root).unwrap();
    let (png, pixels) = png_fixture(false, 0);
    let prepared = vault
        .prepare_original(
            &scope(),
            AssetPurpose::EvidenceOriginal,
            ContentType::Png,
            &mut png.as_slice(),
            &budget(),
        )
        .unwrap();
    let asset = record(
        610,
        prepared.with_provenance(license(), vec![u(100)]).unwrap(),
    );
    let proof = vault.verify_available_asset(&asset, &budget()).unwrap();
    assert_eq!(proof.sha256, sha256(&png));
    assert_eq!(proof.byte_size, png.len() as u64);
    // Healthy retry reuses one immutable original without replacing its identity.
    let retry = vault
        .prepare_original(
            &scope(),
            AssetPurpose::EvidenceOriginal,
            ContentType::Png,
            &mut png.as_slice(),
            &budget(),
        )
        .unwrap();
    assert_eq!(retry.identity, proof);
    assert_eq!(vault.read_retained(&asset, &budget()).unwrap(), png);
    // Reopening existing private directories repeats creation barriers, while
    // the trusted configured parent's legitimate 0755 mode is preserved.
    let reopened_vault = AssetVault::open(&vault_root).unwrap();
    assert_eq!(
        reopened_vault.read_retained(&asset, &budget()).unwrap(),
        png
    );
    assert_eq!(
        fs::metadata(&configured_parent)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o755
    );

    let store = SyntheticDeliveryStore {
        record: asset.clone(),
        reads: Cell::new(0),
    };
    let access = SyntheticAccess {
        authorized: Cell::new(0),
        revalidated: Cell::new(0),
    };
    let service = MediaService::new(&store, &access, &vault);
    let descriptor = OwnedDescriptor::AtlasAsset { asset_id: u(610) };
    let preview = service
        .deliver(
            &SyntheticPrincipal,
            &scope(),
            &descriptor,
            ReadMethod::Get,
            DeliveryMode::Preview,
            &budget(),
        )
        .unwrap();
    assert_eq!(preview.status, 200);
    assert_preview_pixels(&preview.body, &pixels, false);
    let download = service
        .deliver(
            &SyntheticPrincipal,
            &scope(),
            &descriptor,
            ReadMethod::Get,
            DeliveryMode::Download,
            &budget(),
        )
        .unwrap();
    assert_eq!(download.body, png);
    let head = service
        .deliver(
            &SyntheticPrincipal,
            &scope(),
            &descriptor,
            ReadMethod::Head,
            DeliveryMode::Download,
            &budget(),
        )
        .unwrap();
    assert!(head.body.is_empty());
    assert_eq!(
        head.headers
            .iter()
            .find(|(name, _)| *name == "content-length")
            .unwrap()
            .1,
        png.len().to_string()
    );
    for response in [&preview, &download, &head] {
        for (name, expected) in [
            ("cache-control", "private, no-store"),
            ("x-content-type-options", "nosniff"),
            ("content-security-policy", "default-src 'none'; sandbox"),
            ("cross-origin-resource-policy", "same-origin"),
            ("vary", "Cookie, Origin"),
        ] {
            assert_eq!(
                response
                    .headers
                    .iter()
                    .find(|(key, _)| *key == name)
                    .unwrap()
                    .1,
                expected
            );
        }
    }
    assert_eq!(store.reads.get(), 6);
    assert_eq!(access.authorized.get(), 3);
    assert_eq!(access.revalidated.get(), 3);

    let text = b"Healthy synthetic retained text original\n";
    let text_prepared = vault
        .prepare_original(
            &scope(),
            AssetPurpose::EvidenceOriginal,
            ContentType::Text,
            &mut text.as_slice(),
            &budget(),
        )
        .unwrap();
    let text_asset = record(
        611,
        text_prepared
            .with_provenance(license(), vec![u(100)])
            .unwrap(),
    );
    assert_eq!(vault.read_retained(&text_asset, &budget()).unwrap(), text);
    let pdf = b"%PDF-1.7\nhealthy synthetic framing example\n%%EOF\n";
    let pdf_prepared = vault
        .prepare_original(
            &scope(),
            AssetPurpose::EvidenceOriginal,
            ContentType::Pdf,
            &mut pdf.as_slice(),
            &budget(),
        )
        .unwrap();
    let pdf_asset = record(
        612,
        pdf_prepared
            .with_provenance(license(), vec![u(100)])
            .unwrap(),
    );
    assert_eq!(vault.read_retained(&pdf_asset, &budget()).unwrap(), pdf);
    for (record, expected) in [(&text_asset, text.as_slice()), (&pdf_asset, pdf.as_slice())] {
        let store = SyntheticDeliveryStore {
            record: record.clone(),
            reads: Cell::new(0),
        };
        let access = SyntheticAccess {
            authorized: Cell::new(0),
            revalidated: Cell::new(0),
        };
        let service = MediaService::new(&store, &access, &vault);
        let descriptor = OwnedDescriptor::AtlasAsset {
            asset_id: record.record_id.clone(),
        };
        let download = service
            .deliver(
                &SyntheticPrincipal,
                &scope(),
                &descriptor,
                ReadMethod::Get,
                DeliveryMode::Download,
                &budget(),
            )
            .unwrap();
        assert_eq!(download.status, 200);
        assert_eq!(download.body, expected);
        assert!(
            download
                .headers
                .iter()
                .find(|(name, _)| *name == "content-disposition")
                .unwrap()
                .1
                .starts_with("attachment;")
        );
    }

    let input = temp_root.join("healthy-records.json");
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&input)
        .unwrap();
    file.write_all(&serde_json::to_vec(&serde_json::json!({"records": [asset, text_asset, pdf_asset], "vaultRoot": vault_root})).unwrap()).unwrap();
    file.sync_all().unwrap();
    let database = temp_root.join("atlas.sqlite");
    public_peer("bootstrap", &database, Some(&input)).unwrap();
    let port = PublicFixtureDatabase {
        path: database.clone(),
    };
    let bundle = temp_root.join("bundle");
    let manifest = capture_recovery(&port, &vault, &bundle, &budget()).unwrap();
    assert_eq!(manifest.assets.len(), 4);
    assert_eq!(manifest.assets[0].asset_id, u(600));
    assert_eq!(manifest.assets[0].availability, Availability::Missing);
    assert_eq!(manifest.assets[0].blob, None);
    assert_eq!(manifest.assets[1].blob.as_deref(), Some("1.blob"));
    assert_eq!(manifest.assets[2].lifecycle, Lifecycle::Tombstoned);
    assert_eq!(manifest.assets[2].blob.as_deref(), Some("2.blob"));
    let verified = verify_recovery(&port, &bundle, &budget()).unwrap();
    assert_eq!(verified.manifest, manifest);
    let wire: serde_json::Value =
        serde_json::from_slice(&fs::read(bundle.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(wire["assets"][0]["blob"], serde_json::Value::Null);
    assert_eq!(
        wire["assets"][0]["sourceLicense"]["reference"],
        serde_json::Value::Null
    );
    let restored =
        restore_recovery(&port, &bundle, &temp_root.join("restored"), &budget()).unwrap();
    assert_eq!(restored.manifest, manifest);
    let restored_vault = AssetVault::open(&restored.vault_root).unwrap();
    assert_eq!(
        restored_vault
            .read_retained(&verified.assets[1], &budget())
            .unwrap(),
        png
    );
    assert_eq!(
        restored_vault
            .read_retained(&verified.assets[2], &budget())
            .unwrap(),
        text
    );
    assert_eq!(
        restored_vault
            .read_retained(&verified.assets[3], &budget())
            .unwrap(),
        pdf
    );
    assert_eq!(
        fs::read(&restored.database_path).unwrap(),
        fs::read(bundle.join("atlas.sqlite")).unwrap()
    );
    public_peer("restored-history", &database, Some(&restored.database_path)).unwrap();
    println!(
        "healthy owned delivery: PNG preview/original GET/HEAD, actual verifier, retry, private headers; delivery peers STUBBED"
    );
    println!(
        "healthy recovery: public frozen synthetic geometry fixture, explicit missing asset, active PNG/PDF, retained tombstone/text, actual SQLite backup, migrations/integrity/graph/manifests, capture/verify/restore, history and receipt bytes preserved; public JS compatibility peer, Rust AT07 integration PENDING"
    );
}

/// Fresh legal wide originals exercise successful original operations only.
/// Optional preview rejection and cancellation/negative controls stay deferred.
#[test]
fn healthy_wide_original_identity_availability_restore_and_download() {
    use super::content::validate_original_content;
    use std::io::Cursor;

    let temp = tempfile::Builder::new()
        .prefix("houseatlas-at12-wide-healthy-")
        .tempdir()
        .unwrap();
    let parent = fs::canonicalize(temp.path()).unwrap();
    let source = AssetVault::open(&parent.join("source")).unwrap();
    let restored = AssetVault::open(&parent.join("restored")).unwrap();
    for (index, depth) in [png::BitDepth::Eight, png::BitDepth::Sixteen]
        .into_iter()
        .enumerate()
    {
        let width = 20_000;
        let pixels =
            vec![123; width as usize * 4 * if depth == png::BitDepth::Eight { 1 } else { 2 }];
        let mut original = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut original, width, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(depth);
            let mut writer = encoder.write_header().unwrap();
            let mut full_pixels = pixels.clone();
            full_pixels.extend_from_slice(&pixels);
            writer.write_image_data(&full_pixels).unwrap();
        }
        // Positive acceptance by the same public codec's prior whole-frame
        // capability is independent of production's new streaming validator.
        let mut previous = png::Decoder::new(Cursor::new(&original))
            .read_info()
            .unwrap();
        let mut decoded = vec![0; previous.output_buffer_size().unwrap()];
        previous.next_frame(&mut decoded).unwrap();
        previous.finish().unwrap();
        assert_eq!(&decoded[..pixels.len()], pixels);
        assert_eq!(&decoded[pixels.len()..], pixels);
        validate_original_content(&original, ContentType::Png, &budget()).unwrap();
        let prepared = source
            .prepare_original(
                &scope(),
                AssetPurpose::EvidenceOriginal,
                ContentType::Png,
                &mut original.as_slice(),
                &budget(),
            )
            .unwrap();
        source
            .verify_prepared_original(&scope(), &prepared, &budget())
            .unwrap();
        let asset = record(
            850 + index as u32,
            prepared.with_provenance(license(), vec![u(100)]).unwrap(),
        );
        let unchanged = asset.clone();
        assert_eq!(asset.payload.availability, Availability::Available);
        let identity = source.verify_available_asset(&asset, &budget()).unwrap();
        assert_eq!(identity.sha256, sha256(&original));
        assert_eq!(identity.byte_size, original.len() as u64);
        restored
            .restore_retained(&asset, &original, &budget())
            .unwrap();
        assert_eq!(
            restored.verify_available_asset(&asset, &budget()).unwrap(),
            identity
        );
        assert_eq!(restored.read_retained(&asset, &budget()).unwrap(), original);
        // Delivery uses explicit synthetic access/storage ports. Actual vault,
        // validator, final rereads, grant revalidation and response are real.
        let store = SyntheticDeliveryStore {
            record: asset.clone(),
            reads: Cell::new(0),
        };
        let access = SyntheticAccess {
            authorized: Cell::new(0),
            revalidated: Cell::new(0),
        };
        let service = MediaService::new(&store, &access, &restored);
        let descriptor = OwnedDescriptor::AtlasAsset {
            asset_id: asset.record_id.clone(),
        };
        for method in [ReadMethod::Get, ReadMethod::Head] {
            let response = service
                .deliver(
                    &SyntheticPrincipal,
                    &scope(),
                    &descriptor,
                    method,
                    DeliveryMode::Download,
                    &budget(),
                )
                .unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(
                response
                    .headers
                    .iter()
                    .find(|(key, _)| *key == "content-length")
                    .unwrap()
                    .1,
                original.len().to_string()
            );
            if method == ReadMethod::Get {
                assert_eq!(response.body, original);
            } else {
                assert!(response.body.is_empty());
            }
        }
        assert_eq!(store.reads.get(), 4);
        assert_eq!(access.authorized.get(), 2);
        assert_eq!(access.revalidated.get(), 2);
        assert_eq!(store.record, unchanged);
        assert_eq!(asset, unchanged);
    }
    // Independent packed Adam7 framing covers wide padding, zero-height
    // passes, and a 1x1 image whose zero-width passes affect Reader's budget.
    for (width, height) in [(20_003u32, 3u32), (1, 1)] {
        let mut raw = Vec::new();
        for (x, y, dx, dy) in [
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ] {
            let samples = width.saturating_sub(x).div_ceil(dx);
            if samples == 0 {
                continue;
            }
            for _ in 0..height.saturating_sub(y).div_ceil(dy) {
                raw.push(0);
                raw.extend(std::iter::repeat_n(255, samples.div_ceil(8) as usize));
            }
        }
        let mut compressed = ZlibEncoder::new(Vec::new(), Compression::default());
        compressed.write_all(&raw).unwrap();
        let mut header = width.to_be_bytes().to_vec();
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[1, 0, 0, 0, 1]);
        let mut original = b"\x89PNG\r\n\x1a\n".to_vec();
        for (kind, bytes) in [
            (b"IHDR", header),
            (b"IDAT", compressed.finish().unwrap()),
            (b"IEND", Vec::new()),
        ] {
            original.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            let mut crc = crc32fast::Hasher::new();
            crc.update(kind);
            crc.update(&bytes);
            original.extend_from_slice(kind);
            original.extend_from_slice(&bytes);
            original.extend_from_slice(&crc.finalize().to_be_bytes());
        }
        let mut previous = png::Decoder::new(Cursor::new(&original));
        previous.set_transformations(png::Transformations::EXPAND);
        let mut previous = previous.read_info().unwrap();
        let mut decoded = vec![0; previous.output_buffer_size().unwrap()];
        previous.next_frame(&mut decoded).unwrap();
        previous.finish().unwrap();
        assert_eq!(decoded, vec![255; width as usize * height as usize]);
        validate_original_content(&original, ContentType::Png, &budget()).unwrap();
    }
    for rgba in [false, true] {
        for filter in 0..=4 {
            validate_original_content(&png_fixture(rgba, filter).0, ContentType::Png, &budget())
                .unwrap();
        }
    }
    println!(
        "healthy wide PNG originals: 20000x2 RGBA8/16 accepted by prior public codec; prepared/verified/restored identity, availability, GET bytes and HEAD original length unchanged; explicit delivery peer stubs; packed Adam7 20003x3 and 1x1; original filters 0..4"
    );
}
