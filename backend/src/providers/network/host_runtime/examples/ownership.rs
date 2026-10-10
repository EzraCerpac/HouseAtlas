//! Only healthy original capture/open/close/identity behavior. No denial arm.
#[path = "ownership-fixture.rs"]
mod fixture;
use fixture::{Check, Fixture, inventory};
use houseatlas_backend::providers::network::{
    self as n, DurableNetworkSidecar, host_runtime::HostNetworkRuntime,
};
use std::{future::Future, pin::Pin};
struct Inventory(n::SourceScope);
impl n::InventoryTransport for Inventory {
    fn get_inventory(
        &self,
        request: n::InventoryGet,
        _: n::Limits,
    ) -> Pin<Box<dyn Future<Output = Result<n::InventoryResponse, n::NetworkError>> + Send + '_>>
    {
        assert_eq!(
            (request.method(), request.path()),
            ("GET", "/api/inventory")
        );
        Box::pin(async {
            Ok(n::InventoryResponse {
                status: 200,
                source: Some(self.0.clone()),
                body: include_bytes!(
                    "../../../../../../adapters/network/fixtures/inventory.wire.json"
                )
                .to_vec(),
                source_snapshot_at: None,
                redirected: false,
                location: None,
                url: None,
            })
        })
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Check<()> {
    let fixture = Fixture::new("houseatlas-owner-healthy-")?;
    let generation = "00000000-0000-4000-8000-000000000999";
    let review = fixture.settings.review().clone();
    let mut sidecar = n::SqliteNetworkSidecar::open(
        &fixture.sidecar_path,
        std::slice::from_ref(&fixture.source),
    )?;
    // Independent actual identities can coexist inside this same private parent.
    let independent = n::SqliteNetworkSidecar::open(
        &fixture.root.join("independent.sqlite"),
        std::slice::from_ref(&fixture.source),
    )?;
    independent.close()?;
    let admission = sidecar.reserve_original_capture(
        &fixture.source,
        &review,
        generation,
        n::Limits::default(),
    )?;
    let proposal =
        match n::NetworkProvider::new(fixture.source.clone(), review, n::Limits::default())?
            .prepare_refresh(
                &n::RetainedState::empty(fixture.source.scope.clone()),
                0,
                generation,
                &Inventory(fixture.source.scope.clone()),
                || "2026-01-02T12:00:00Z".into(),
            )
            .await?
        {
            n::RefreshOutcome::Complete(proposal) => proposal,
            _ => return Err("Expected healthy original local capture".into()),
        };
    let staged = n::stage_complete_generation(&fixture.source, *proposal, &mut sidecar)?
        .attach_original_archive(&mut sidecar, admission)?;
    let body_sha = staged.receipt().original().body_sha256().to_owned();
    let projected_sha = staged.receipt().projected().sha256().to_owned();
    drop(staged);
    let before = inventory(&fixture.sidecar_path)?;
    sidecar.close()?;
    let runtime = HostNetworkRuntime::open(fixture.settings.clone())?;
    runtime.close()?;
    let sidecar = n::SqliteNetworkSidecar::open(
        &fixture.sidecar_path,
        std::slice::from_ref(&fixture.source),
    )?;
    let row = sidecar.load(&fixture.source, generation)?;
    let capture = sidecar.reopen_original_capture(&fixture.source, generation)?;
    assert_eq!(row.sha256, projected_sha);
    assert_eq!(capture.body_sha256(), body_sha);
    assert_eq!(capture.projected_receipt_sha256(), projected_sha);
    assert_eq!(
        capture.body(),
        include_bytes!("../../../../../../adapters/network/fixtures/inventory.wire.json")
    );
    assert_eq!(before, inventory(&fixture.sidecar_path)?);
    sidecar.close()?;
    fixture.finish()?;
    println!(
        "PASS healthy descriptor owners; independent identities coexist; actual original inventory/receipt/capture survives close/reopen through NetworkSettings->HostRuntime; permanent IDs/catalog/projected rows unchanged; private0700 fresh root removed; no HTTP/Store/grants/recovery/reclamation"
    );
    Ok(())
}
