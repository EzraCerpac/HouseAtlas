use super::{CompleteGeneration, SourceScope};
use std::{fmt, future::Future};

/// Captured by the shared authorized service before reads. Not an access grant.
/// The store MUST compare this epoch with current source authority in its transaction.
/// Provisional: this port also needs AT07's pre-read baseline generation/cache
/// epoch and reserved generation ID. See the README reconciliation proposal.
/// Scope/source_epoch alone are insufficient for production publication fencing.
#[derive(Clone, Debug)]
pub struct PublicationFence {
    pub scope: SourceScope,
    pub source_epoch: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublishError {
    ScopeMismatch,
    StoreRejected,
}
impl fmt::Display for PublishError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ScopeMismatch => "Publication scope does not match the staged generation.",
            Self::StoreRejected => "Complete-generation publication was not accepted by storage.",
        })
    }
}
impl std::error::Error for PublishError {}

/// AT07 integration port, not a database implementation. Implementations atomically
/// replace cache/projections under the current source epoch, retain Atlas identities
/// and unresolved missing bindings, and preserve quarantine until admin reenable.
/// Failure must leave the previous generation intact. No filtered-view port exists.
pub trait GenerationPublisher {
    type Receipt;
    fn commit_complete(
        &mut self,
        generation: &CompleteGeneration,
        fence: &PublicationFence,
    ) -> impl Future<Output = Result<Self::Receipt, PublishError>> + Send;
}
impl CompleteGeneration {
    pub async fn publish<P: GenerationPublisher>(
        &self,
        publisher: &mut P,
        fence: &PublicationFence,
    ) -> Result<P::Receipt, PublishError> {
        if self.cache.scope() != fence.scope {
            return Err(PublishError::ScopeMismatch);
        }
        publisher.commit_complete(self, fence).await
    }
}
