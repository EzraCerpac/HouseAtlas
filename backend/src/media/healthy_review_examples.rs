//! Fresh standard PNGs and real durable staging continuity; no rejection,
//! revocation, replay, crash, concurrency or provider controls.
use std::{
    cell::Cell,
    fs,
    io::{Cursor, Read},
    time::Duration,
};

use png::{BitDepth, ColorType};
use serde_json::json;

use super::native::RetainedPrincipal;
use super::staged_upload::{NativeUploadStages, UploadAdmission, UploadLimits};
use super::types::{AssetPurpose, ContentType, LicenseStatus, SourceLicense};
use super::{
    AssetVault, content,
    healthy_examples::{budget, scope, u},
};
use crate::{access as a, domain::stock, storage as s};

fn fixture(
    color: ColorType,
    depth: BitDepth,
    pixels: &[u8],
    palette: Option<&[u8]>,
    alpha: Option<&[u8]>,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
        encoder.set_color(color);
        encoder.set_depth(depth);
        if let Some(value) = palette {
            encoder.set_palette(value);
        }
        if let Some(value) = alpha {
            encoder.set_trns(value);
        }
        encoder
            .add_text_chunk("Description".into(), "Fresh synthetic metadata".into())
            .unwrap();
        encoder
            .write_header()
            .unwrap()
            .write_image_data(pixels)
            .unwrap();
    }
    bytes
}

fn rgba(bytes: &[u8]) -> Vec<u8> {
    let mut reader = png::Decoder::new(Cursor::new(bytes)).read_info().unwrap();
    assert_eq!(reader.info().color_type, ColorType::Rgba);
    assert_eq!(reader.info().bit_depth, BitDepth::Eight);
    assert!(!reader.info().interlaced);
    let mut raw = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut raw).unwrap();
    reader.finish().unwrap();
    let mut offset = 8;
    let mut kinds = Vec::new();
    while offset < bytes.len() {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        kinds.push(&bytes[offset + 4..offset + 8]);
        offset += length + 12;
    }
    assert_eq!(kinds, [b"IHDR", b"IDAT", b"IEND"]);
    raw
}

#[test]
fn healthy_standard_png_variants_render_known_pixels() {
    for depth in [
        BitDepth::One,
        BitDepth::Two,
        BitDepth::Four,
        BitDepth::Eight,
        BitDepth::Sixteen,
    ] {
        let pixels: &[u8] = match depth {
            BitDepth::One => &[0x40],
            BitDepth::Two => &[0x30],
            BitDepth::Four => &[0x0f],
            BitDepth::Eight => &[0, 255],
            BitDepth::Sixteen => &[0, 0, 255, 255],
        };
        let original = fixture(ColorType::Grayscale, depth, pixels, None, None);
        assert_eq!(
            rgba(&content::render_png(&original, &budget()).unwrap()),
            [0, 0, 0, 255, 255, 255, 255, 255]
        );
    }
    for depth in [
        BitDepth::One,
        BitDepth::Two,
        BitDepth::Four,
        BitDepth::Eight,
    ] {
        let pixels: &[u8] = match depth {
            BitDepth::One => &[0x40],
            BitDepth::Two => &[0x10],
            BitDepth::Four => &[0x01],
            _ => &[0, 1],
        };
        let original = fixture(
            ColorType::Indexed,
            depth,
            pixels,
            Some(&[12, 34, 56, 78, 90, 123]),
            Some(&[0, 128]),
        );
        assert_eq!(
            rgba(&content::render_png(&original, &budget()).unwrap()),
            [12, 34, 56, 0, 78, 90, 123, 128]
        );
    }
    for (color, depth, pixels, expected) in [
        (
            ColorType::GrayscaleAlpha,
            BitDepth::Eight,
            vec![30, 255, 90, 80],
            vec![30, 30, 30, 255, 90, 90, 90, 80],
        ),
        (
            ColorType::GrayscaleAlpha,
            BitDepth::Sixteen,
            vec![30, 40, 255, 255, 90, 10, 80, 20],
            vec![30, 30, 30, 255, 90, 90, 90, 80],
        ),
        (
            ColorType::Rgb,
            BitDepth::Sixteen,
            vec![12, 3, 34, 5, 56, 7, 78, 9, 90, 1, 123, 4],
            vec![12, 34, 56, 255, 78, 90, 123, 255],
        ),
        (
            ColorType::Rgba,
            BitDepth::Sixteen,
            vec![12, 3, 34, 5, 56, 7, 0, 0, 78, 9, 90, 1, 123, 4, 128, 1],
            vec![12, 34, 56, 0, 78, 90, 123, 128],
        ),
    ] {
        let original = fixture(color, depth, &pixels, None, None);
        assert_eq!(
            rgba(&content::render_png(&original, &budget()).unwrap()),
            expected
        );
    }
    // Independently frame a 5x5 Adam7 RGB image: each pass has filter-zero
    // rows and known RGB values at its full-image coordinates.
    let mut raw = Vec::new();
    for (x0, y0, dx, dy) in [
        (0, 0, 8, 8),
        (4, 0, 8, 8),
        (0, 4, 4, 8),
        (2, 0, 4, 4),
        (0, 2, 2, 4),
        (1, 0, 2, 2),
        (0, 1, 1, 2),
    ] {
        for y in (y0..5).step_by(dy) {
            raw.push(0);
            for x in (x0..5).step_by(dx) {
                raw.extend_from_slice(&[(x * 20) as u8, (y * 30) as u8, 100]);
            }
        }
    }
    use std::io::Write;
    let mut compressed =
        flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    compressed.write_all(&raw).unwrap();
    let mut original = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8; 4], data: &[u8]| {
        original.extend_from_slice(&(data.len() as u32).to_be_bytes());
        original.extend_from_slice(kind);
        original.extend_from_slice(data);
        let mut crc = crc32fast::Hasher::new();
        crc.update(kind);
        crc.update(data);
        original.extend_from_slice(&crc.finalize().to_be_bytes());
    };
    chunk(b"IHDR", &[0, 0, 0, 5, 0, 0, 0, 5, 8, 2, 0, 0, 1]);
    chunk(b"IDAT", &compressed.finish().unwrap());
    chunk(b"IEND", &[]);
    let expected: Vec<u8> = (0..5)
        .flat_map(|y| (0..5).flat_map(move |x| [x * 20, y * 30, 100, 255]))
        .collect();
    assert_eq!(
        rgba(&content::render_png(&original, &budget()).unwrap()),
        expected
    );
    println!(
        "healthy PNG: grayscale 1/2/4/8/16, indexed 1/2/4/8 with palette alpha, gray-alpha 8/16, RGB/RGBA16 and independent Adam7 RGB; exact known pixels, stripped static RGBA8 output"
    );
}

struct Server {
    next: Cell<u32>,
    seconds: Cell<i64>,
}
impl s::Runtime for Server {
    fn new_id(&self) -> s::Result<String> {
        self.next.set(self.next.get() + 1);
        Ok(u(self.next.get()))
    }
    fn now(&self) -> s::Result<String> {
        time::OffsetDateTime::from_unix_timestamp(self.seconds.get())
            .unwrap()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| s::Error::new("unavailable", "Synthetic server clock unavailable"))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "No committed record in staging-only example",
        ))
    }
}

fn evidence<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/media/uploads",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

fn authorized_editor() -> (a::AccessBoundary, RetainedPrincipal) {
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    let id = |number| a::CanonicalId::parse(u(number)).unwrap();
    let selected: a::Scope =
        serde_json::from_value(serde_json::to_value(scope()).unwrap()).unwrap();
    access
        .provision_user(
            &id(50),
            &id(51),
            "synthetic-quota",
            &a::hash_password("Synthetic-quota-password-only!").unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&id(50), &selected, a::Role::Editor, true)
        .unwrap();
    let session = access
        .login(
            &evidence(None, None),
            &serde_json::to_vec(
                &json!({"username":"synthetic-quota", "password":"Synthetic-quota-password-only!"}),
            )
            .unwrap(),
            "synthetic",
        )
        .unwrap();
    let principal = RetainedPrincipal::new(
        access
            .authorize(
                &evidence(
                    Some(session.set_cookie().split(';').next().unwrap()),
                    Some(session.info().csrf_token()),
                ),
                &selected,
                a::Action::Mutate,
            )
            .unwrap(),
    );
    (access, principal)
}

#[test]
fn healthy_durable_pending_accounting_expiry_and_shared_bytes() {
    let temporary = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let server = Server {
        next: Cell::new(230_000),
        seconds: Cell::new(1_800_000_000),
    };
    let limits = UploadLimits {
        pending_lifetime: Duration::from_secs(60),
        ..UploadLimits::default()
    };
    let (mut access, principal) = authorized_editor();
    let bytes = b"Fresh shared synthetic quota bytes.\n";
    let mut asset_ids = Vec::new();
    for number in 0..2 {
        // Actual owner + vault reopen between fresh requests: map starts empty,
        // but durable accounting must include the prior receipt and blob.
        let vault = AssetVault::open(&root.join("media")).unwrap();
        let stages = NativeUploadStages::open_with_limits(&vault, &server, limits.clone()).unwrap();
        assert_eq!(stages.usage(&budget()).unwrap().pending_stages, number);
        access
            .with_mutation_authorization(
                principal.principal(),
                |guard| -> Result<(), Box<dyn std::error::Error>> {
                    let receipt = stages.stage_original(
                        guard,
                        &principal,
                        UploadAdmission {
                            request_id: u(240_000 + number as u32),
                            purpose: AssetPurpose::EvidenceOriginal,
                            content_type: ContentType::Text,
                            filename: "fresh-shared.txt".into(),
                            source_license: SourceLicense {
                                status: LicenseStatus::Unknown,
                                reference: None,
                            },
                            evidence_ids: vec![],
                        },
                        &mut bytes.as_slice(),
                        &budget(),
                    )?;
                    asset_ids.push(receipt.asset_id);
                    Ok(())
                },
            )
            .unwrap();
        let usage = stages.usage(&budget()).unwrap();
        assert_eq!(usage.pending_stages, number + 1);
        assert_eq!(usage.retained.originals, 1);
        assert_eq!(usage.retained.bytes, bytes.len() as u64);
    }
    assert_ne!(asset_ids[0], asset_ids[1]);
    server.seconds.set(server.seconds.get() + 61);
    let vault = AssetVault::open(&root.join("media")).unwrap();
    let stages = NativeUploadStages::open_with_limits(&vault, &server, limits).unwrap();
    assert_eq!(stages.expire_pending(&budget()).unwrap().removed_stages, 2);
    let usage = stages.usage(&budget()).unwrap();
    assert_eq!(usage.pending_stages, 0);
    assert_eq!(usage.retained.originals, 1);
    assert_eq!(usage.retained.bytes, bytes.len() as u64);
    println!(
        "healthy durable accounting: two fresh actual AT11 staging admissions across owner/vault reopen, one shared retained blob, two charged receipts, successful unbound expiry, retained bytes remain charged; no SQL duplicate-asset acceptance claimed"
    );
}

/// Advancing the synthetic server clock during a successful read models
/// ordinary processing longer than the configured pending window. No sleeps,
/// failed admission, expired bind, cancellation or fault control executes.
struct ProcessingBody<'a> {
    bytes: &'a [u8],
    clock: &'a Cell<i64>,
}

impl Read for ProcessingBody<'_> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        let length = self.bytes.read(output)?;
        if length != 0 {
            self.clock.set(self.clock.get() + 2);
        }
        Ok(length)
    }
}

#[test]
fn healthy_completed_upload_gets_fresh_pending_window_and_binds() {
    let temporary = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let server = Server {
        next: Cell::new(260_000),
        seconds: Cell::new(1_800_000_000),
    };
    let vault = AssetVault::open(&root.join("media")).unwrap();
    let stages = NativeUploadStages::open_with_limits(
        &vault,
        &server,
        UploadLimits {
            pending_lifetime: Duration::from_secs(1),
            ..UploadLimits::default()
        },
    )
    .unwrap();
    let (mut access, principal) = authorized_editor();
    let original = b"Fresh successful processing before the pending window.\n";
    let license = SourceLicense {
        status: LicenseStatus::Unknown,
        reference: None,
    };
    let mut bound = None;
    access
        .with_mutation_authorization(
            principal.principal(),
            |guard| -> Result<(), Box<dyn std::error::Error>> {
                let receipt = stages.stage_original(
                    guard,
                    &principal,
                    UploadAdmission {
                        request_id: u(270_000),
                        purpose: AssetPurpose::EvidenceOriginal,
                        content_type: ContentType::Text,
                        filename: "fresh-processing.txt".into(),
                        source_license: license.clone(),
                        evidence_ids: vec![],
                    },
                    &mut ProcessingBody {
                        bytes: original,
                        clock: &server.seconds,
                    },
                    &budget(),
                )?;
                assert_eq!(server.seconds.get(), 1_800_000_002);
                let directory = root
                    .join("media/uploads")
                    .join(super::types::sha256(receipt.staged.upload_token.as_bytes()));
                let mut members: Vec<_> = fs::read_dir(&directory)?
                    .map(|entry| entry.unwrap().file_name().to_str().unwrap().to_owned())
                    .collect();
                members.sort();
                assert_eq!(members, ["lifetime.json", "stage.json"]);
                let lifetime: serde_json::Value =
                    serde_json::from_slice(&fs::read(directory.join("lifetime.json"))?)?;
                assert_eq!(lifetime["createdAt"], 1_800_000_002i64);
                assert_eq!(lifetime["expiresAt"], 1_800_000_003i64);
                let raw = json!({
                    "schemaVersion":3,"commandId":"atlas.asset.create",
                    "requestId":receipt.request_id,"context":scope(),
                    "target":{"authority":"atlas","recordType":"asset","recordId":receipt.asset_id},
                    "payload":{"staged":receipt.staged,"purpose":"evidence-original",
                        "sourceLicense":license,"evidenceIds":[]},
                    "idempotencyKey":u(270_001),"reason":"Fresh successful completed-stage window",
                    "preconditions":{"target":null,"guards":[]},"approvalReceiptId":null
                });
                let contracts = stock::NativeStockContract::new()?;
                let request = stock::ValidatedRequest::parse(&contracts, raw)?;
                let plan = stages.bind_asset_plan(
                    guard,
                    &principal,
                    &receipt.staged.upload_token,
                    &request,
                    &budget(),
                )?;
                assert_eq!(plan.asset_id(), receipt.asset_id);
                assert!(std::ptr::eq(
                    plan.original_principal().principal(),
                    principal.principal()
                ));
                bound = Some(plan);
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(bound.unwrap().staged().byte_size, original.len() as u64);
    assert_eq!(stages.usage(&budget()).unwrap().pending_stages, 1);
    println!(
        "healthy completed stage: two synthetic processing seconds precede a fresh one-second pending lifetime; exact published member layout and genuine unchanged stock binding succeed with original AT11 guard; no expired/failed bind or storage mutation control"
    );
}

#[test]
fn healthy_incremental_png_many_rows_and_bounded_wide_rows() {
    for (width, height, depth) in [
        (2048, 2048, BitDepth::Eight),
        (16383, 2, BitDepth::Eight),
        (8191, 2, BitDepth::Sixteen),
    ] {
        let mut original = Vec::new();
        let expected = [17u8, 34, 51, 255];
        let pixels: Vec<u8> = if depth == BitDepth::Eight {
            expected.repeat((width * height) as usize)
        } else {
            [17u8, 0, 34, 0, 51, 0, 255, 255].repeat((width * height) as usize)
        };
        let mut encoder = png::Encoder::new(&mut original, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(depth);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&pixels)
            .unwrap();
        let rendered = content::render_png(&original, &budget()).unwrap();
        let decoded = rgba(&rendered);
        assert_eq!(decoded.len(), (width * height * 4) as usize);
        assert!(
            decoded
                .as_chunks::<4>()
                .0
                .iter()
                .all(|pixel| *pixel == expected)
        );
    }
    println!(
        "healthy incremental PNG: 2048 ordinary rows with repeated known pixels, plus accepted RGBA8/16 row-bound examples; real pinned decoder and stripped RGBA8 output; cancellation/deadline/over-limit controls remain unrun"
    );
}
