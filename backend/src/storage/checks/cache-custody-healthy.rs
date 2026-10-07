//! Named healthy Store boundary example with actual Native proposal/receipt and
//! SQLite sidecar. The fresh synthetic reference/admission adapter below is NOT
//! the production catalog, rotation, recovery or Access producer implementation.
//! No failure injection, denial, deletion, replay, crash or concurrency controls.
use houseatlas_at07_checkpoint::{
    http::contracts::NativeContracts, providers::network as n, storage as s,
};
use n::DurableNetworkSidecar;
use serde_json::{Value, json};
use std::{cell::Cell, collections::BTreeSet, future::Future, path::Path, pin::Pin, rc::Rc};

type Check<T> = Result<T, Box<dyn std::error::Error>>;
const AT: &str = "2026-10-07T12:00:00Z";
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
#[derive(Clone)]
struct Authority;
impl s::Authorization for Authority {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        p: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(request.scope.workspace_id, p.workspace_id);
        assert_eq!(request.scope.home_id, p.home_id);
        assert!(request.mutation.is_none());
        Ok(p.clone())
    }
}
struct BorrowedPrincipal(s::VerifiedActor);
struct BorrowedAuthority(Cell<usize>);
impl s::Authorization for BorrowedAuthority {
    type Principal = BorrowedPrincipal;
    fn authorize(
        &self,
        p: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.0.set(self.0.get() + 1);
        Authority.authorize(&p.0, request)
    }
}
struct Clock(Cell<u64>);
impl s::Runtime for Clock {
    fn now(&self) -> s::Result<String> {
        Ok(AT.into())
    }
    fn new_id(&self) -> s::Result<String> {
        let n = self.0.get();
        self.0.set(n + 1);
        Ok(id(n))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "checkpoint-error",
            "No asset in this example",
        ))
    }
}
struct Transport(n::SourceScope, Vec<u8>, Cell<usize>);
impl n::InventoryTransport for Transport {
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
        self.2.set(self.2.get() + 1);
        let response = n::InventoryResponse {
            status: 200,
            source: Some(self.0.clone()),
            body: self.1.clone(),
            source_snapshot_at: None,
            redirected: false,
            location: None,
            url: None,
        };
        Box::pin(async move { Ok(response) })
    }
}
struct NativeStage {
    original: Box<n::StagedNetworkPublication<n::DurableNetworkReceipt>>,
    registration: s::SourceRegistration,
    cache: s::CacheStatus,
    rows: Vec<Value>,
}
impl s::OriginalStagedCachePublication for NativeStage {
    fn registration(&self) -> &s::SourceRegistration {
        &self.registration
    }
    fn cache(&self) -> &s::CacheStatus {
        &self.cache
    }
    fn homebox_entities(&self) -> &[Value] {
        &[]
    }
    fn network_relations(&self) -> &[Value] {
        &self.rows
    }
    fn native_sha256(&self) -> &str {
        self.original.receipt().sha256()
    }
}
struct Admission {
    issuer: Rc<()>,
    generation_id: String,
    bound: u64,
}
// Entirely fresh private synthetic root. All native stages originate in this
// one owner; tracked IDs enumerate every row it creates. No external catalogs.
struct SyntheticReferences {
    sidecar: n::SqliteNetworkSidecar,
    source: n::SourceRegistration,
    registration: s::SourceRegistration,
    issuer: Rc<()>,
    ids: Vec<String>,
    published: BTreeSet<String>,
    checks: usize,
}
struct ReferencesGuard<'a>(&'a mut SyntheticReferences);
impl s::OriginalCacheReferences for SyntheticReferences {
    type Staged = NativeStage;
    type Guard<'a> = ReferencesGuard<'a>;
    fn lock(&mut self) -> s::Result<Self::Guard<'_>> {
        Ok(ReferencesGuard(self))
    }
}
fn native_error(_: n::NetworkError) -> s::Error {
    s::Error::new("checkpoint-error", "Native fixture unavailable")
}
impl s::OriginalCacheReferenceGuard for ReferencesGuard<'_> {
    type Staged = NativeStage;
    type Admission = Admission;
    fn enumerate(&mut self, output: &mut s::CacheProtectionSink<'_>) -> s::Result<()> {
        for generation_id in &self.0.ids {
            let row = self
                .0
                .sidecar
                .load(&self.0.source, generation_id)
                .map_err(native_error)?;
            output.protect(
                &self.0.registration,
                generation_id,
                Some(&row.sha256),
                s::CacheProtectionReason::Staged,
            )?;
            if self.0.published.contains(generation_id) {
                for reason in [
                    s::CacheProtectionReason::Disclosure,
                    s::CacheProtectionReason::Recovery,
                    s::CacheProtectionReason::Archive,
                ] {
                    output.protect(
                        &self.0.registration,
                        generation_id,
                        Some(&row.sha256),
                        reason,
                    )?;
                }
            }
        }
        Ok(())
    }
    fn verify_staged(&mut self, staged: &NativeStage) -> s::Result<()> {
        assert_eq!(staged.registration, self.0.registration);
        let receipt = staged.original.receipt();
        assert!(self.0.ids.iter().any(|id| id == receipt.generation_id()));
        let stored = self
            .0
            .sidecar
            .load(&self.0.source, receipt.generation_id())
            .map_err(native_error)?;
        let original =
            n::stage_row(&self.0.source, staged.original.proposal()).map_err(native_error)?;
        assert_eq!(
            (
                stored.partition_key.as_str(),
                stored.generation_id.as_str(),
                stored.sha256.as_str()
            ),
            (
                receipt.partition_key(),
                receipt.generation_id(),
                receipt.sha256()
            )
        );
        assert_eq!(stored, original);
        assert_eq!(
            serde_json::to_value(&staged.cache)?,
            serde_json::to_value(&staged.original.proposal().state().cache)?
        );
        assert_eq!(
            staged.rows,
            staged
                .original
                .proposal()
                .state()
                .generation
                .as_ref()
                .unwrap()
                .network_relations
                .iter()
                .map(serde_json::to_value)
                .collect::<Result<Vec<_>, _>>()?
        );
        self.0.checks += 1;
        Ok(())
    }
    fn verify_unpublished(&mut self, staged: &NativeStage) -> s::Result<()> {
        assert!(
            !self
                .0
                .published
                .contains(staged.original.receipt().generation_id())
        );
        Ok(())
    }
    fn admit_candidate(
        &mut self,
        registration: &s::SourceRegistration,
        generation_id: &str,
        bound: u64,
        limits: s::CacheCapacityLimits,
        protected: &[s::ProtectedCacheGeneration],
    ) -> s::Result<Admission> {
        assert_eq!(registration, &self.0.registration);
        assert_eq!(
            (
                limits.active_segment_bytes,
                limits.protected_capacity_bytes,
                limits.row_bytes,
                limits.protected_entries
            ),
            (
                16 * 1024 * 1024,
                256 * 1024 * 1024,
                10 * 1024 * 1024,
                10_000
            )
        );
        assert!(
            protected
                .iter()
                .any(|pin| pin.registration() == registration
                    && pin.generation_id() == generation_id)
        );
        // Healthy fixture only: one sub-MiB row at a time, fewer than four rows.
        // Actual rotation/accounting must be supplied by Native's real catalog.
        assert!(bound <= 1024 * 1024 && self.0.ids.len() < 4);
        Ok(Admission {
            issuer: Rc::clone(&self.0.issuer),
            generation_id: generation_id.into(),
            bound,
        })
    }
}
impl SyntheticReferences {
    fn stage(
        &mut self,
        proposal: n::CompleteGenerationProposal,
        admission: Admission,
    ) -> Check<NativeStage> {
        assert!(Rc::ptr_eq(&admission.issuer, &self.issuer));
        assert_eq!(
            proposal.state().cache.generation_id.as_deref(),
            Some(admission.generation_id.as_str())
        );
        assert!(n::stage_row(&self.source, &proposal)?.body.len() as u64 <= admission.bound);
        let cache = serde_json::from_value(serde_json::to_value(&proposal.state().cache)?)?;
        let rows = proposal
            .state()
            .generation
            .as_ref()
            .unwrap()
            .network_relations
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()?;
        let original = n::stage_complete_generation(&self.source, proposal, &mut self.sidecar)?;
        self.ids.push(admission.generation_id);
        Ok(NativeStage {
            original: Box::new(original),
            registration: self.registration.clone(),
            cache,
            rows,
        })
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Check<()> {
    let root = std::env::args()
        .nth(1)
        .ok_or("fresh synthetic root required")?;
    let root = Path::new(&root);
    std::fs::create_dir(root)?;
    let published = Path::new(env!("HOUSEATLAS_ROOT"));
    let source: n::SourceRegistration = serde_json::from_value(
        json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]}),
    )?;
    let registration: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&source)?)?;
    let principal = s::VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let mut store = s::AtlasStore::open(
        root.join("core.sqlite"),
        NativeContracts,
        Authority,
        Clock(Cell::new(30_000)),
        Default::default(),
    )?;
    store.register_source(&principal, &registration)?;
    let mut references = SyntheticReferences {
        sidecar: n::SqliteNetworkSidecar::open(
            &root.join("native.sqlite"),
            std::slice::from_ref(&source),
        )?,
        source: source.clone(),
        registration: registration.clone(),
        issuer: Rc::new(()),
        ids: vec![],
        published: BTreeSet::new(),
        checks: 0,
    };
    let review = serde_json::from_slice(&std::fs::read(
        published.join("adapters/network/fixtures/link-review.json"),
    )?)?;
    let mut provider = n::NetworkProvider::new(source.clone(), review, n::Limits::default())?;
    let transport = Transport(
        source.scope.clone(),
        std::fs::read(published.join("adapters/network/fixtures/inventory.wire.json"))?,
        Cell::new(0),
    );
    let mut prior = n::RetainedState::empty(source.scope.clone());
    let borrowed = BorrowedAuthority(Cell::new(0));
    let mut digests = vec![];
    for mode in 0..3 {
        let prepared = store.prepare_cache_publication(
            &principal,
            &registration.scope(),
            &registration.partition(),
        )?;
        let (_, fence) = prepared.into_parts();
        let admission = {
            let mut pins = store.guard_cache_residency(&mut references)?;
            let admission = pins.admit_before_transport(&fence, 1024 * 1024)?;
            let (original, result) = pins.release();
            result?;
            let _original_owner = original.0;
            admission
        };
        assert_eq!(transport.2.get(), mode);
        let outcome = provider
            .prepare_refresh(
                &prior,
                fence.baseline_cache_epoch().value(),
                fence.reserved_generation_id(),
                &transport,
                || AT.into(),
            )
            .await?;
        let n::RefreshOutcome::Complete(proposal) = outcome else {
            return Err("healthy proposal required".into());
        };
        prior = proposal.state().clone();
        let staged = references.stage(*proposal, admission)?;
        let receipt_address = staged.original.receipt() as *const _;
        digests.push(staged.original.receipt().sha256().to_owned());
        if mode == 2 {
            let guard = store
                .guard_unpublished_candidate(fence, staged, &mut references)
                .map_err(|error| error.error().clone())?;
            assert_eq!(guard.native_sha256(), digests.last().unwrap());
            assert_eq!(
                guard.staged().original.receipt() as *const _,
                receipt_address
            );
            assert!(
                guard
                    .protected()
                    .iter()
                    .any(|pin| pin.reason() == s::CacheProtectionReason::History)
            );
            let (_, staged, original, result) = guard.release();
            result?;
            let _original_owner = original.0;
            assert_eq!(staged.original.receipt() as *const _, receipt_address);
            drop(staged);
        } else {
            let published = if mode == 0 {
                store.publish_staged_generation(&principal, fence, staged, &mut references)
            } else {
                store.publish_staged_generation_with_authorization(
                    &borrowed,
                    &BorrowedPrincipal(principal.clone()),
                    fence,
                    staged,
                    &mut references,
                )
            }
            .map_err(|error| error.error().clone())?;
            let (cache, staged) = published.into_parts();
            assert_eq!(cache, staged.cache);
            references.published.insert(cache.generation_id.unwrap());
            drop(staged);
        }
    }
    let pins = store.guard_cache_residency(&mut references)?;
    for reason in [
        s::CacheProtectionReason::Current,
        s::CacheProtectionReason::History,
        s::CacheProtectionReason::InFlightOrAmbiguous,
        s::CacheProtectionReason::Staged,
        s::CacheProtectionReason::Disclosure,
        s::CacheProtectionReason::Recovery,
        s::CacheProtectionReason::Archive,
    ] {
        assert!(pins.protected().iter().any(|pin| pin.reason() == reason));
    }
    let protected_count = pins.protected().len();
    let (original, result) = pins.release();
    result?;
    let _original_owner = original.0;
    assert_eq!(borrowed.0.get(), 2);
    let checks = references.checks;
    references.sidecar.close()?;
    store.close()?;
    println!(
        "{}",
        serde_json::to_string(
            &json!({"healthy":true,"native_get_calls":transport.2.get(),"native_receipt_checks":checks,"published":2,"unpublished_retained":1,"protected_entries":protected_count,"native_sha256":digests,"production_catalog_and_admission":"peer-owned, not supplied by fixture"})
        )?
    );
    Ok(())
}
