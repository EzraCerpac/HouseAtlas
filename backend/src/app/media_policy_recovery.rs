//! Separate native Jobs validation and independent actual Media provenance.
//! This composite creates no recovery permit and performs no restore or cleanup.
use super::Core;
use crate::{jobs::QueueConfig, media::recovery_policy::MediaPolicyEvidence, storage as s};
use std::sync::Mutex;

pub struct MediaPolicyQueueEvidence<'a, E> {
    jobs: &'a E,
    media: &'a Mutex<MediaPolicyEvidence>,
}

impl Core {
    /// Borrow this host's genuine captured provenance and the caller's required
    /// original Jobs peer. Empty or restarted Media evidence remains unavailable.
    pub fn media_policy_queue_evidence<'a, E: s::QueueRecoveryEvidence>(
        &'a self,
        jobs: &'a E,
    ) -> MediaPolicyQueueEvidence<'a, E> {
        MediaPolicyQueueEvidence {
            jobs,
            media: &self.media_policy_evidence,
        }
    }
}

impl<E: s::QueueRecoveryEvidence> s::QueueRecoveryEvidence for MediaPolicyQueueEvidence<'_, E> {
    fn validate_attempt(
        &self,
        config: &QueueConfig,
        frame: s::QueueRecoveryAttempt<'_>,
    ) -> s::Result<()> {
        self.jobs.validate_attempt(config, frame)
    }

    fn validate_media_policy(&self, frame: s::MediaPolicyRecoveryFrame<'_>) -> s::Result<()> {
        self.media
            .try_lock()
            .map_err(|_| s::Error::new("owner-unavailable", "Media evidence owner unavailable"))?
            .validate_frame(frame)
    }
}
