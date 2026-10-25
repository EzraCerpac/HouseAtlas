//! Internal registration-catalog budget. No route, transport or provider work.
use std::{
    io::{self, Write},
    panic::{AssertUnwindSafe, catch_unwind, resume_unwind},
    sync::{Arc, Mutex, MutexGuard, atomic::{AtomicBool, Ordering}},
    time::{Duration, Instant},
};

pub(crate) const MAX_CANDIDATES: usize = 64;
pub(crate) const MAX_RESULTS: usize = 8;
pub(crate) const MAX_REGISTRATION_BYTES: usize = 65_536;
pub(crate) const MAX_RESPONSE_BYTES: usize = 262_144;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Unavailable;
pub(crate) type Result<T> = std::result::Result<T, Unavailable>;

#[derive(Clone)]
pub(crate) struct Budget(Arc<State>);
struct State {
    deadline: Instant,
    stopped: AtomicBool,
}
impl Budget {
    pub(crate) fn start() -> Self {
        Self(Arc::new(State {
            deadline: Instant::now() + Duration::from_secs(5),
            stopped: AtomicBool::new(false),
        }))
    }
    // Callback-safe: no locks, SQL, allocation, diagnostics or panic path.
    pub(crate) fn stopped(&self) -> bool {
        if self.0.stopped.load(Ordering::Acquire) {
            return true;
        }
        if Instant::now() >= self.0.deadline {
            self.cancel();
            return true;
        }
        false
    }
    pub(crate) fn check(&self) -> Result<()> {
        if self.stopped() { Err(Unavailable) } else { Ok(()) }
    }
    pub(crate) fn cancel(&self) {
        self.0.stopped.store(true, Ordering::Release);
    }
}
pub(crate) struct CancelOnDrop(pub(crate) Budget);
impl Drop for CancelOnDrop {
    fn drop(&mut self) { self.0.cancel(); }
}

pub(crate) struct PolicyOutcome<T> {
    pub(crate) result: Result<T>,
    pub(crate) clean: bool,
}

/// Called only by the two private native connection owners under exclusive
/// mutable ownership. Their catalog helper is the sole progress-handler writer;
/// connections start with an empty slot and no callback escapes this function.
/// The mutable borrow plus idle/autocommit entry checks prohibit nesting. There
/// is no SQLite callback getter: this is an owner invariant, not a fake probe.
pub(crate) fn sqlite_policy<T>(
    db: &mut rusqlite::Connection,
    budget: &Budget,
    restore_ms: u64,
    operation: impl FnOnce(&mut rusqlite::Connection) -> Result<T>,
) -> PolicyOutcome<T> {
    if budget.check().is_err() {
        return PolicyOutcome { result: Err(Unavailable), clean: true };
    }
    if !db.is_autocommit() || db.is_busy() {
        // No slot was touched. An unexpectedly non-idle owner cannot be certified.
        return PolicyOutcome { result: Err(Unavailable), clean: false };
    }
    let callback_budget = budget.clone();
    db.progress_handler(1000, Some(move || callback_budget.stopped()));
    let attempted = catch_unwind(AssertUnwindSafe(|| {
        db.busy_timeout(Duration::ZERO).map_err(|_| Unavailable)?;
        budget.check()?;
        operation(db)
    }));
    // All operation-local statements have finished/dropped. Manual transactions
    // deliberately have no Transaction destructor that could roll back early.
    // Cleanup is mandatory and has no expired-budget early return.
    db.progress_handler(0, None::<fn() -> bool>);
    let rolled_back = db.is_autocommit() || db.execute_batch("ROLLBACK").is_ok();
    let idle = db.is_autocommit() && !db.is_busy();
    let restored = db.busy_timeout(Duration::from_millis(restore_ms)).is_ok()
        && db.query_row("PRAGMA busy_timeout", [], |row| row.get::<_, u64>(0))
            .is_ok_and(|actual| actual == restore_ms);
    let clean = rolled_back && idle && restored && attempted.is_ok();
    let result = attempted.unwrap_or(Err(Unavailable));
    PolicyOutcome {
        result: if clean && budget.check().is_ok() { result } else { Err(Unavailable) },
        clean,
    }
}

/// Consume only the affected ORIGINAL guard in a contained hook-free unwind.
/// Other owner guards remain outside this unwind. No poison recovery/reopen.
pub(crate) fn quarantine<T>(
    mutex: &Mutex<T>,
    guard: &mut Option<MutexGuard<'_, T>>,
) -> Result<()> {
    let affected = guard.take().ok_or(Unavailable)?;
    if !cfg!(panic = "unwind") { return Err(Unavailable); }
    let _contained = catch_unwind(AssertUnwindSafe(move || {
        let _affected = affected;
        resume_unwind(Box::new(Unavailable));
    }));
    if mutex.is_poisoned() { Ok(()) } else { Err(Unavailable) }
}

/// Private capped encoding; no byte is handed off until the whole DTO fits.
pub(crate) fn encode<T: serde::Serialize>(value: &T, budget: &Budget) -> Result<Vec<u8>> {
    struct Capped<'a> { bytes: Vec<u8>, budget: &'a Budget }
    impl Write for Capped<'_> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if self.budget.check().is_err()
                || bytes.len() > MAX_RESPONSE_BYTES.saturating_sub(self.bytes.len())
            {
                return Err(io::Error::other("Catalog unavailable"));
            }
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> { Ok(()) }
    }
    budget.check()?;
    let mut out = Capped { bytes: Vec::new(), budget };
    serde_json::to_writer(&mut out, value).map_err(|_| Unavailable)?;
    budget.check()?;
    Ok(out.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_before_work_and_expired_deadline_are_sticky() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        let budget = Budget::start();
        drop(CancelOnDrop(budget.clone()));
        let entered = AtomicBool::new(false);
        let result = sqlite_policy(&mut db, &budget, 5_000, |_| {
            entered.store(true, Ordering::Relaxed);
            Ok(())
        });
        assert!(result.clean);
        assert_eq!(result.result, Err(Unavailable));
        assert!(!entered.load(Ordering::Relaxed));
        let expired = Budget(Arc::new(State { deadline: Instant::now(), stopped: AtomicBool::new(false) }));
        assert_eq!(expired.check(), Err(Unavailable));
        assert!(expired.0.stopped.load(Ordering::Acquire));
    }

    #[test]
    fn cancellation_still_removes_callback_rolls_back_and_restores_owner_timeout() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.busy_timeout(Duration::from_millis(731)).unwrap();
        let budget = Budget::start();
        let result: PolicyOutcome<()> = sqlite_policy(&mut db, &budget, 731, |db| {
            db.execute_batch("BEGIN IMMEDIATE").unwrap();
            budget.cancel();
            Err(Unavailable)
        });
        assert!(result.clean);
        assert_eq!(result.result, Err(Unavailable));
        assert!(db.is_autocommit());
        assert!(!db.is_busy());
        assert_eq!(db.query_row("PRAGMA busy_timeout", [], |r| r.get::<_, u64>(0)).unwrap(), 731);
        // More than one callback interval: a still-installed cancelled callback
        // would interrupt this independent, bounded synthetic query.
        let sum: u64 = db.query_row(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) SELECT sum(x) FROM n",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(sum, 500_500);
    }

    #[test]
    fn capped_encoding_returns_no_partial_catalog() {
        let budget = Budget::start();
        assert!(encode(&"x".repeat(MAX_RESPONSE_BYTES), &budget).is_err());
        assert!(encode(&serde_json::json!({"partitions":[]}), &budget).is_ok());
    }

    #[test]
    #[cfg(panic = "unwind")]
    fn quarantine_poisons_only_the_original_affected_owner() {
        let affected = Mutex::new(7);
        let unaffected = Mutex::new(9);
        let healthy = unaffected.try_lock().unwrap();
        let mut guard = Some(affected.try_lock().unwrap());
        assert_eq!(quarantine(&affected, &mut guard), Ok(()));
        assert!(affected.is_poisoned());
        assert!(affected.try_lock().is_err());
        assert!(!unaffected.is_poisoned());
        assert_eq!(*healthy, 9);
    }
}
