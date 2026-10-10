//! Exact synthetic native Media cases; no provider, listener, authority mint,
//! recovery, replay, expiry, revocation, crash or aggregate discovery.
use houseatlas_backend::media::{
    AssetVault, Cancellation, MAX_BYTES, MediaError, WorkBudget, content,
    types::{
        AssetPurpose, ContentType, LicenseStatus, PreviewPolicy, Scope, SourceLicense, sha256,
    },
};
use std::{fs, os::unix::fs::PermissionsExt, time::Duration};

const JPEG: &[u8] =
    include_bytes!("../../frontend/capture-evidence-tests/fixtures/synthetic-photo.jpg");
const PROGRESSIVE: &[u8] = include_bytes!(
    "../../frontend/capture-evidence-tests/fixtures/synthetic-photo-progressive.jpg"
);
const PNG: &[u8] =
    include_bytes!("../../frontend/capture-evidence-tests/fixtures/synthetic-image.png");
const PDF: &[u8] =
    include_bytes!("../../frontend/capture-evidence-tests/fixtures/synthetic-document.pdf");
const TEXT: &[u8] =
    include_bytes!("../../frontend/capture-evidence-tests/fixtures/synthetic-note.txt");
fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default()).unwrap()
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.is_empty() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = root.path().canonicalize().unwrap();
        let vault = AssetVault::open(&path).unwrap();
        let scope = Scope {
            workspace_id: "00000000-0000-4000-8000-000000000001".into(),
            home_id: "00000000-0000-4000-8000-000000000002".into(),
        };
        for (label, kind, bytes) in [
            ("jpeg", ContentType::Jpeg, JPEG),
            ("progressive-jpeg", ContentType::Jpeg, PROGRESSIVE),
            ("png", ContentType::Png, PNG),
            ("pdf", ContentType::Pdf, PDF),
            ("text", ContentType::Text, TEXT),
        ] {
            content::validate_original_content(bytes, kind, &budget()).unwrap();
            let original = vault
                .prepare_original(
                    &scope,
                    AssetPurpose::EvidenceOriginal,
                    kind,
                    &mut &bytes[..],
                    &budget(),
                )
                .unwrap();
            assert_eq!(original.identity.sha256, sha256(bytes));
            assert_eq!(original.identity.byte_size, bytes.len() as u64);
            let payload = original
                .with_provenance(
                    SourceLicense {
                        status: LicenseStatus::Unknown,
                        reference: None,
                    },
                    vec![],
                )
                .unwrap();
            if kind != ContentType::Png {
                assert_eq!(payload.preview_policy, PreviewPolicy::DownloadOnly);
            }
            println!(
                "PASS healthy {label}: exact measured original; {:?}",
                payload.preview_policy
            );
        }
        return;
    }
    assert_eq!(
        args.len(),
        2,
        "Only one exact reviewed regression case per invocation"
    );
    assert_eq!(args[0], "--case");
    match args[1].as_str() {
        "reject-unsupported-heic" => {
            assert_eq!(
                ContentType::parse("image/heic"),
                Err(MediaError::Unsupported)
            );
            // A JPEG label cannot make a synthetic HEIF container acceptable.
            assert_eq!(
                content::validate_original_content(
                    b"\x00\x00\x00\x18ftypheic",
                    ContentType::Jpeg,
                    &budget()
                ),
                Err(MediaError::Unsupported)
            );
        }
        "reject-malformed-jpeg" => assert_eq!(
            content::validate_original_content(b"\xff\xd8\xff\xd9", ContentType::Jpeg, &budget()),
            Err(MediaError::Unsupported)
        ),
        "reject-malformed-png" => assert_eq!(
            content::validate_original_content(&PNG[..PNG.len() - 3], ContentType::Png, &budget()),
            Err(MediaError::Unsupported)
        ),
        "reject-malformed-pdf" => assert_eq!(
            content::validate_original_content(b"%PDF-1.7\ntruncated", ContentType::Pdf, &budget()),
            Err(MediaError::Unsupported)
        ),
        "reject-malformed-text" => assert_eq!(
            content::validate_original_content(&[0xff], ContentType::Text, &budget()),
            Err(MediaError::Unsupported)
        ),
        "reject-oversized-file" => assert_eq!(
            content::validate_original_content(
                &vec![b'a'; MAX_BYTES + 1],
                ContentType::Text,
                &budget()
            ),
            Err(MediaError::TooLarge)
        ),
        "reject-pre-cancelled-budget" => {
            let cancellation = Cancellation::default();
            cancellation.cancel();
            let budget = WorkBudget::new(Duration::from_secs(10), cancellation).unwrap();
            assert_eq!(
                content::validate_original_content(JPEG, ContentType::Jpeg, &budget),
                Err(MediaError::Unavailable)
            );
        }
        _ => panic!("Unlisted case"),
    }
    println!("PASS exact bounded synthetic regression {}", args[1]);
}
