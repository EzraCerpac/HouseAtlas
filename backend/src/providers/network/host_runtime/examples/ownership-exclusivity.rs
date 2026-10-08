//! Separately approved isolated regression. Explicit exact case only; no suite,
//! historical controls, path attacks, restore, provider or credential work.
#[path = "ownership-fixture.rs"]
mod fixture;
use fixture::{Check, Fixture, inventory};
use houseatlas_backend::providers::network::{self as n, host_runtime::HostNetworkRuntime};
use std::{
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn denied<T>(result: Result<T, n::NetworkError>) -> Check<()> {
    match result {
        Err(error) if error.code == n::ErrorCode::Upstream => Ok(()),
        _ => Err("Expected original constructor availability denial".into()),
    }
}
fn probe(root: &Path, nonce: &str) -> Check<()> {
    // This internal child helper is bound to the parent's freshly generated
    // marker under the real temp directory, never an arbitrary archive path.
    let temp = std::fs::canonicalize(std::env::temp_dir())?;
    let canonical = std::fs::canonicalize(root)?;
    if canonical.parent() != Some(temp.as_path())
        || !canonical
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("houseatlas-owner-exclusivity-"))
        || nonce.len() != 64
        || !nonce.bytes().all(|b| b.is_ascii_hexdigit())
        || std::fs::read_to_string(canonical.join("owner-probe"))? != nonce
    {
        return Err("Child helper requires original fresh parent fixture marker".into());
    }
    let source = fixture::source()?;
    use sha2::{Digest, Sha256};
    let path = canonical.join(format!(
        "network-{:x}.sqlite",
        Sha256::digest(n::partition_key(&source.scope)?.as_bytes())
    ));
    denied(n::SqliteNetworkSidecar::open(
        &path,
        std::slice::from_ref(&source),
    ))
}
fn child_probe(fixture: &Fixture) -> Check<()> {
    let mut entropy = [0u8; 32];
    getrandom::fill(&mut entropy).map_err(|_| "Synthetic marker entropy unavailable")?;
    let nonce: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
    let mut marker = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(fixture.root.join("owner-probe"))?;
    marker.write_all(nonce.as_bytes())?;
    marker.sync_all()?;
    drop(marker);
    let mut child = Command::new(std::env::current_exe()?)
        .arg("--probe-owned")
        .arg(&fixture.root)
        .arg(nonce)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.try_wait()? {
            if status.success() {
                return Ok(());
            }
            return Err("Exact child owner probe failed".into());
        }
        if Instant::now() >= deadline {
            child.kill()?;
            child.wait()?;
            return Err("Exact child exceeded bound".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn main() -> Check<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [flag, root, nonce] if flag == "--probe-owned" => probe(Path::new(root), nonce),
        [flag, case] if flag == "--exact" => {
            if !matches!(
                case.as_str(),
                "sidecar-duplicate"
                    | "archive-duplicate"
                    | "runtime-duplicate"
                    | "process-sidecar-duplicate"
            ) {
                return Err("Case not in the reviewed explicit allowlist".into());
            }
            let fixture = Fixture::new("houseatlas-owner-exclusivity-")?;
            match case.as_str() {
                "sidecar-duplicate" => {
                    let first = n::SqliteNetworkSidecar::open(
                        &fixture.sidecar_path,
                        std::slice::from_ref(&fixture.source),
                    )?;
                    let before = inventory(&fixture.sidecar_path)?;
                    denied(n::SqliteNetworkSidecar::open(
                        &fixture.sidecar_path,
                        std::slice::from_ref(&fixture.source),
                    ))?;
                    // Direct public archive construction cannot bypass the
                    // original sidecar's raw catalog/segment ownership.
                    denied(n::NetworkImmutableArchive::open(
                        &fixture.sidecar_path.with_extension("raw-archive.sqlite"),
                    ))?;
                    assert_eq!(before, inventory(&fixture.sidecar_path)?);
                    first.close()?;
                }
                "archive-duplicate" => {
                    let path = fixture.root.join("direct.sqlite");
                    let first = n::NetworkImmutableArchive::open(&path)?;
                    denied(n::NetworkImmutableArchive::open(&path))?;
                    first.close()?;
                    n::NetworkImmutableArchive::open(&path)?.close()?;
                }
                "runtime-duplicate" => {
                    let first = HostNetworkRuntime::open(fixture.settings.clone())?;
                    let before = inventory(&fixture.sidecar_path)?;
                    denied(HostNetworkRuntime::open(fixture.settings.clone()))?;
                    assert_eq!(before, inventory(&fixture.sidecar_path)?);
                    first.close()?;
                    HostNetworkRuntime::open(fixture.settings.clone())?.close()?;
                }
                "process-sidecar-duplicate" => {
                    let first = n::SqliteNetworkSidecar::open(
                        &fixture.sidecar_path,
                        std::slice::from_ref(&fixture.source),
                    )?;
                    let before = inventory(&fixture.sidecar_path)?;
                    child_probe(&fixture)?;
                    assert_eq!(before, inventory(&fixture.sidecar_path)?);
                    first.close()?;
                }
                _ => unreachable!(),
            }
            fixture.finish()?;
            println!(
                "PASS exact {case}: original descriptor owner denies duplicate constructor; private synthetic state unchanged/removed; no HTTP/recovery/reclamation/held controls"
            );
            Ok(())
        }
        _ => Err("Expected --exact <reviewed-case>".into()),
    }
}
