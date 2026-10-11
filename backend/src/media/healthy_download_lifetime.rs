//! Positive native deadline-to-presentation projection only. No handle issuer,
//! resolver, authority, download, expiry/fault/clock/replay control is exercised.
use houseatlas_backend::media::download_lifetime::{DownloadAvailability, project_issuer_lifetime};
use serde_json::json;
use std::time::{Duration, Instant};

fn main() {
    // Fresh synthetic native owner deadline, never a URL/fixture UUID/timestamp.
    let issuer_deadline = Instant::now()
        .checked_add(Duration::from_secs(300))
        .unwrap();
    let lifetime = project_issuer_lifetime(issuer_deadline).unwrap();
    assert!(lifetime.remaining_ms() > 0 && lifetime.remaining_ms() <= 300_000);
    assert_eq!(
        serde_json::to_value(lifetime).unwrap(),
        json!({"remainingMs":lifetime.remaining_ms()})
    );
    assert_eq!(
        serde_json::to_value(DownloadAvailability::Available { lifetime }).unwrap(),
        json!({"state":"available","lifetime":{"remainingMs":lifetime.remaining_ms()}})
    );
    // Explicit unbound data serialization is no source qualification or expiry
    // test. It preserves the absence of any genuine issuer/resolver binding.
    assert_eq!(
        serde_json::to_value(DownloadAvailability::Unbound).unwrap(),
        json!({"state":"unbound"})
    );
    println!(
        "healthy download lifetime: native synthetic future Instant, positive floored remaining milliseconds and exact availability/unbound DTO serialization only; no owner/authority/download or held clock/expiry controls"
    );
}
