//! Private queue state operations.
use super::*;

pub(super) fn validate_job_state(row: &StoredJob) -> Result<()> {
    let invoked = matches!(row.remote, RemoteActivity::Invoked(_));
    let common = row.updated >= row.created && row.body_accepted == (row.attempts > 0);
    let valid = match row.status {
        JobStatus::Queued => {
            row.attempts == 0
                && !row.logical
                && !invoked
                && row.next == Some(row.created)
                && row.applied.is_none()
                && row.failure.is_none()
        }
        JobStatus::Running => {
            row.attempts > 0
                && row.logical
                && row.remote.blocks_invocation()
                && row.next.is_none()
                && row.applied.is_none()
        }
        JobStatus::RetryScheduled => {
            row.attempts > 0
                && !row.logical
                && row.next.is_some()
                && row.applied.is_none()
                && row.failure.is_some()
                && matches!(
                    row.remote,
                    RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
                )
        }
        JobStatus::Succeeded => {
            row.attempts > 0
                && !row.logical
                && invoked
                && row.next.is_none()
                && row.applied.is_some()
                && row.failure.is_none()
        }
        JobStatus::Failed => {
            !row.logical && row.next.is_none() && row.applied.is_none() && row.failure.is_some()
        }
        JobStatus::NeedsReconciliation | JobStatus::Partial => {
            row.attempts > 0
                && row.logical
                && invoked
                && row.next.is_none()
                && row.applied.is_none()
                && row.failure.is_some()
        }
        JobStatus::ResolvedObserved | JobStatus::ResolvedByHuman => {
            row.attempts > 0
                && !row.logical
                && invoked
                && row.next.is_none()
                && row.reconciliation.is_some()
                && (row.applied.is_some() != row.failure.is_some())
        }
        JobStatus::Prepared => false,
    };
    if !common || !valid {
        return Err(bad());
    }
    Ok(())
}
