use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use super::{MediaError, MediaResult};

const MAX_WORK_TIMEOUT: Duration = Duration::from_secs(10);
const OFFLINE_BACKUP_TIMEOUT: Duration = Duration::from_secs(45);

/// Cooperative cancellation for local reads and CPU work. No transport runtime.
#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
}

pub struct WorkBudget {
    deadline: Instant,
    cancellation: Cancellation,
}

impl WorkBudget {
    pub fn new(timeout: Duration, cancellation: Cancellation) -> MediaResult<Self> {
        if timeout.is_zero() || timeout > MAX_WORK_TIMEOUT {
            return Err(MediaError::InvalidInput);
        }
        Self::with_timeout(timeout, cancellation)
    }

    /// A longer finite budget for the explicit offline backup command only.
    /// The fixed bound avoids changing the deadline policy for ordinary media work.
    pub(crate) fn new_offline_backup() -> MediaResult<Self> {
        Self::with_timeout(OFFLINE_BACKUP_TIMEOUT, Cancellation::default())
    }

    fn with_timeout(timeout: Duration, cancellation: Cancellation) -> MediaResult<Self> {
        if timeout.is_zero() {
            return Err(MediaError::InvalidInput);
        }
        Ok(Self {
            deadline: Instant::now() + timeout,
            cancellation,
        })
    }

    pub fn check(&self) -> MediaResult<()> {
        if self.cancellation.0.load(Ordering::Acquire) || Instant::now() >= self.deadline {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_backup_has_finite_budget_without_widening_general_work() {
        assert!(
            WorkBudget::new(MAX_WORK_TIMEOUT, Cancellation::default()).is_ok(),
            "the ordinary maximum remains accepted"
        );
        assert!(
            WorkBudget::new(
                MAX_WORK_TIMEOUT + Duration::from_secs(1),
                Cancellation::default()
            )
            .is_err()
        );

        let before = Instant::now();
        let offline_backup = WorkBudget::new_offline_backup().unwrap();
        let after = Instant::now();
        assert!(offline_backup.check().is_ok());
        assert!(
            offline_backup.deadline >= before + OFFLINE_BACKUP_TIMEOUT
                && offline_backup.deadline <= after + OFFLINE_BACKUP_TIMEOUT,
            "the dedicated deadline is exactly 45 seconds after construction"
        );
    }
}
