//! Explicit independent archive evidence for offline queue validation.
//! Authenticate and read the complete native archive before entering Storage;
//! callbacks here perform no I/O and create no recovery authority or permit.
use crate::{
    jobs::QueueConfig,
    media::recovery_policy_archive::{
        AuthenticatedMediaPolicyArchive, MediaPolicyArchiveReadAuthorization,
    },
    storage::{self as s, QueueRecoveryEvidence},
};

/// Jobs and Media retain separate original owner bindings. Construction only
/// borrows already-authenticated archive evidence; it selects no origin policy.
/// The caller can supply this to `RecoveryPeers::new` with its required discovery
/// peer. A missing member or unavailable independent policy fails closed.
pub struct ArchivedMediaQueueEvidence<'a, 'origin, A, E> {
    jobs: &'a E,
    media: &'a AuthenticatedMediaPolicyArchive<'origin, A>,
}

impl<'a, 'origin, A: MediaPolicyArchiveReadAuthorization, E: QueueRecoveryEvidence>
    ArchivedMediaQueueEvidence<'a, 'origin, A, E>
{
    pub fn new(jobs: &'a E, media: &'a AuthenticatedMediaPolicyArchive<'origin, A>) -> Self {
        Self { jobs, media }
    }
}

impl<A: MediaPolicyArchiveReadAuthorization, E: QueueRecoveryEvidence> QueueRecoveryEvidence
    for ArchivedMediaQueueEvidence<'_, '_, A, E>
{
    fn validate_attempt(
        &self,
        config: &QueueConfig,
        frame: s::QueueRecoveryAttempt<'_>,
    ) -> s::Result<()> {
        self.jobs.validate_attempt(config, frame)
    }

    fn validate_media_policy(&self, frame: s::MediaPolicyRecoveryFrame<'_>) -> s::Result<()> {
        self.media.validate_frame(frame)
    }
}
