//! Authorized ordinary sanitized metadata persistence, with static synthetic
//! authority/runtime. No provider failure, clock change or held control runs.
use houseatlas_at07_checkpoint::{http::contracts::NativeContracts, storage as s};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{cell::Cell, fs, path::Path, rc::Rc};

type Check<T> = Result<T, Box<dyn std::error::Error>>;
type Store = s::AtlasStore<NativeContracts, Authority, Clock>;
const COMMIT_TIME: &str = "2026-10-07T12:05:00Z";
const FETCH_TIME: &str = "2026-10-07T10:00:00Z";
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
#[derive(Clone)]
struct Authority;
impl s::Authorization for Authority {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        principal: &s::VerifiedActor,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        assert!(request.mutation.is_none());
        Ok(principal.clone())
    }
}
struct BorrowedPrincipal(s::VerifiedActor);
struct BorrowedAuthority(Rc<Cell<usize>>);
impl s::Authorization for BorrowedAuthority {
    type Principal = BorrowedPrincipal;
    fn authorize(
        &self,
        principal: &BorrowedPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(request.capability, s::Capability::PublishCache);
        self.0.set(self.0.get() + 1);
        Authority.authorize(&principal.0, request)
    }
}
#[derive(Clone)]
struct Clock {
    next: Rc<Cell<u64>>,
    now_calls: Rc<Cell<usize>>,
}
impl s::Runtime for Clock {
    fn now(&self) -> s::Result<String> {
        self.now_calls.set(self.now_calls.get() + 1);
        Ok(COMMIT_TIME.into())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.next.get();
        self.next.set(next + 1);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "checkpoint-error",
            "No asset in this fixture",
        ))
    }
}
#[derive(Clone, Copy)]
enum Mode {
    Captured,
    CapturedBorrowed,
    Compatibility,
    CompatibilityBorrowed,
}
fn exact(row: &s::CacheStatus, expected: &str) {
    assert_eq!(row.last_attempt_at.as_deref(), Some(expected));
    assert_eq!(row.error.as_ref().unwrap().at, expected);
    assert_eq!(row.error.as_ref().unwrap().code, s::FailureCode::Upstream);
    assert_eq!(row.status, s::CacheState::Error);
    assert_eq!(row.last_successful_fetch_at.as_deref(), Some(FETCH_TIME));
}
fn run_case(out: &Path, mode: Mode, expected: &str) -> Check<Value> {
    fs::create_dir(out)?;
    let path = out.join("cache.sqlite");
    let clock = Clock {
        next: Rc::new(Cell::new(20_000)),
        now_calls: Rc::new(Cell::new(0)),
    };
    let principal = s::VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let registration = s::SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(12),
        collection_id: "inventory".into(),
        owner: s::SourceOwner::Network,
        partition_mode: s::PartitionMode::ExclusiveHome,
        allowed_external_ids: vec![],
    };
    let partition = registration.partition();
    let scope = registration.scope();
    let mut store = Store::open(
        &path,
        NativeContracts,
        Authority,
        clock.clone(),
        Default::default(),
    )?;
    store.register_source(&principal, &registration)?;
    let prepared = store.prepare_cache_publication(&principal, &scope, &partition)?;
    let fresh = s::CacheStatus {
        schema_version: 1,
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(12),
        collection_id: "inventory".into(),
        status: s::CacheState::Fresh,
        last_successful_fetch_at: Some(FETCH_TIME.into()),
        last_attempt_at: Some(FETCH_TIME.into()),
        generation_id: Some(prepared.fence().reserved_generation_id().into()),
        consistency: "non-transactional-offset-pages".into(),
        error: None,
    };
    store.publish_prepared_generation(&principal, prepared.into_parts().1, &fresh, &[], &[])?;
    let prepared = store.prepare_cache_publication(&principal, &scope, &partition)?;
    let failure = s::CacheFailure {
        code: s::FailureCode::Upstream,
        status: None,
    };
    let borrowed_calls = Rc::new(Cell::new(0));
    let borrowed = BorrowedAuthority(borrowed_calls.clone());
    let borrowed_principal = BorrowedPrincipal(principal.clone());
    let before = clock.now_calls.get();
    let fence = prepared.into_parts().1;
    let row = match mode {
        Mode::Captured => {
            store.record_prepared_cache_failure_at(&principal, fence, &failure, expected)?
        }
        Mode::CapturedBorrowed => store.record_prepared_cache_failure_at_with_authorization(
            &borrowed,
            &borrowed_principal,
            fence,
            &failure,
            expected,
        )?,
        Mode::Compatibility => store.record_prepared_cache_failure(&principal, fence, &failure)?,
        Mode::CompatibilityBorrowed => store.record_prepared_cache_failure_with_authorization(
            &borrowed,
            &borrowed_principal,
            fence,
            &failure,
        )?,
    };
    let captured = matches!(mode, Mode::Captured | Mode::CapturedBorrowed);
    assert_eq!(clock.now_calls.get() - before, usize::from(!captured));
    assert_eq!(
        borrowed_calls.get(),
        if matches!(mode, Mode::CapturedBorrowed | Mode::CompatibilityBorrowed) {
            2
        } else {
            0
        }
    );
    exact(&row, expected);
    assert_eq!(row.generation_id, fresh.generation_id);
    let state = store.read_cache_for_publication(&principal, &scope, &partition)?;
    assert_eq!(state.cache_epoch, 2);
    assert_eq!(state.cache.as_ref(), Some(&row));
    assert!(state.homebox_entities.is_empty() && state.network_relations.is_empty());
    let image_path = out.join("recovery.sqlite");
    let image = store.backup_recovery_to(&image_path, &mut || Ok(()))?;
    let bytes = fs::read(&image_path)?;
    Store::validate_existing_recovery_image(&image_path, &NativeContracts, &mut || Ok(()))?;
    assert_eq!(fs::read(&image_path)?, bytes);
    store.close()?;
    let mut reopened = Store::open(
        &path,
        NativeContracts,
        Authority,
        clock.clone(),
        Default::default(),
    )?;
    assert_eq!(
        reopened.read_cache_for_publication(&principal, &scope, &partition)?,
        state
    );
    reopened.close()?;
    let restored_path = out.join("restored.sqlite");
    fs::copy(&image_path, &restored_path)?;
    let mut restored = Store::open_existing_recovery_image(
        &restored_path,
        NativeContracts,
        Authority,
        clock,
        Default::default(),
        &image,
        &mut || Ok(()),
    )?;
    assert_eq!(
        restored.read_cache_for_publication(&principal, &scope, &partition)?,
        state
    );
    restored.close()?;
    assert_eq!(fs::read(&image_path)?, bytes);
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let body: String = db.query_row("SELECT body FROM caches", [], |r| r.get(0))?;
    let persisted: s::CacheStatus = serde_json::from_str(&body)?;
    exact(&persisted, expected);
    Ok(
        json!({"expectedAttempt":expected,"runtimeTime":COMMIT_TIME,"capturedApi":captured,"row":row,"rawSqlRead":true,"ordinaryReopen":true,"strictImmutableImageAndSeparateCopyReopen":true}),
    )
}
fn main() -> Check<()> {
    let out = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh output directory required")?,
    );
    fs::create_dir(&out)?;
    let mut results = vec![];
    for (name, mode, at) in [
        (
            "configured-captured",
            Mode::Captured,
            "2026-10-07T12:00:00.123456+01:00",
        ),
        (
            "borrowed-captured",
            Mode::CapturedBorrowed,
            "2026-10-07T11:00:01.654321Z",
        ),
        ("configured-compatibility", Mode::Compatibility, COMMIT_TIME),
        (
            "borrowed-compatibility",
            Mode::CompatibilityBorrowed,
            COMMIT_TIME,
        ),
    ] {
        results.push(run_case(&out.join(name), mode, at)?);
    }
    let evidence = json!({"fixture":"ordinary sanitized Upstream cache metadata; actual native contracts/Store","cases":results,"authority":"synthetic configured and borrowed authorities; original fences, no production grant claim","heldControls":"unrun; no provider error injection/timeout/clock change/rejection/fault/concurrency/negative campaign"});
    fs::write(
        out.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    println!("{evidence}");
    Ok(())
}
