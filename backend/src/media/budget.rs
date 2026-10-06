use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use super::{MediaError, MediaResult};

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
        if timeout.is_zero() || timeout > Duration::from_secs(10) {
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
