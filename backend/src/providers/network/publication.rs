//! Host orchestration against the reviewed AT07 consuming publication seam.
//! Read authority, SQLite cache epoch/fence and durable sidecar proof are separate.
use super::*;
use super::{
    model::{Result, guard},
    projection::uuid,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Mirror of AT07 CachePublicationState at 3b14f0362aa2161d51b99d71e7d52d50f27f07de.
/// Host adapters convert peer types; this DTO itself confers no authority.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkCacheBaseline {
    #[serde(deserialize_with = "super::model::nullable")]
    pub cache: Option<CacheMetadata>,
    pub cache_epoch: u64,
    pub homebox_entities: Vec<serde_json::Value>,
    pub network_relations: Vec<NetworkRelation>,
}
/// Implement for AT07's original non-cloneable CachePublicationFence. The integer
/// here is CacheEpoch.value(), never the access registry's authority epoch.
pub trait NetworkPublicationFence {
    fn partition(&self) -> SourceScope;
    fn baseline_generation_id(&self) -> Option<&str>;
    fn baseline_cache_epoch(&self) -> u64;
    fn reserved_generation_id(&self) -> &str;
}
pub struct PreparedNetworkCache<F> {
    pub baseline: NetworkCacheBaseline,
    pub fence: F,
}

/// Constructed only after complete projection and a successful durable stage.
/// Consuming this and the original fence is the publication-only host boundary.
pub struct StagedNetworkPublication<R> {
    proposal: CompleteGenerationProposal,
    receipt: R,
}
impl<R> StagedNetworkPublication<R> {
    pub fn proposal(&self) -> &CompleteGenerationProposal {
        &self.proposal
    }
    pub fn receipt(&self) -> &R {
        &self.receipt
    }
    pub fn into_parts(self) -> (CompleteGenerationProposal, R) {
        (self.proposal, self.receipt)
    }
}
/// Synchronous stage for the phased native host adapter. The provider's opaque
/// complete proposal is consumed only after actual durable row staging succeeds.
/// Host authority is required independently before staging and at publication.
pub fn stage_complete_generation<S: DurableNetworkSidecar>(
    source: &SourceRegistration,
    proposal: CompleteGenerationProposal,
    sidecar: &mut S,
) -> Result<StagedNetworkPublication<S::Receipt>> {
    let row = stage_row(source, &proposal)?;
    let receipt = sidecar.stage(source, &row)?;
    Ok(StagedNetworkPublication { proposal, receipt })
}
pub trait NetworkCachePublisher<L> {
    type Fence: NetworkPublicationFence;
    type Receipt;
    type Error;
    /// Delegate to AT07 prepare_cache_publication and keep the returned fence.
    /// No transaction may remain open during provider work.
    fn prepare_cache_publication(
        &mut self,
        source: &SourceRegistration,
        lease: &L,
    ) -> std::result::Result<PreparedNetworkCache<Self::Fence>, Self::Error>;
    /// Delegate to publish_prepared_generation(original fence, cache, [], rows).
    /// The wrapper must revalidate the SAME original access handle inside its
    /// authorization/commit boundary; do not acquire new authority or rebase CAS.
    fn publish_prepared_generation<R>(
        &mut self,
        fence: Self::Fence,
        staged: StagedNetworkPublication<R>,
        lease: &L,
    ) -> std::result::Result<Self::Receipt, Self::Error>;
}
pub trait DurableNetworkSidecar {
    type Receipt;
    /// Must return only after an immutable, digest-validated row is durably
    /// committed, with exact replay checks and quotas against existing rows.
    fn stage(&mut self, source: &SourceRegistration, row: &SidecarRow) -> Result<Self::Receipt>;
    fn load(&self, source: &SourceRegistration, generation_id: &str) -> Result<SidecarRow>;
}
/// Retains a failed fetch and its ORIGINAL CAS fence and authority lease.
/// No metadata write is performed until an actual host transaction compares
/// the original partition/generation/cacheEpoch and consumes the original fence.
/// Do not map this to AT07's existing unfenced record_cache_failure method.
pub struct PendingNetworkFailure<F, L> {
    failure: RefreshFailure,
    precondition: PublicationPrecondition,
    fence: F,
    lease: Arc<L>,
}
impl<F, L> PendingNetworkFailure<F, L> {
    pub fn failure(&self) -> &RefreshFailure {
        &self.failure
    }
    pub fn precondition(&self) -> &PublicationPrecondition {
        &self.precondition
    }
    /// Host-only consuming handoff to a fenced failure transaction. The state
    /// is internal retention, never a public DTO or complete generation proof.
    pub fn into_parts(self) -> (F, PublicationPrecondition, RefreshFailure, Arc<L>) {
        (self.fence, self.precondition, self.failure, self.lease)
    }
}
pub enum NetworkPublicationOutcome<R, F, L> {
    Published(R),
    SourceFailure(Box<PendingNetworkFailure<F, L>>),
}
pub enum NetworkPublicationError<E> {
    Network(NetworkError),
    Storage(E),
}
impl<E> From<NetworkError> for NetworkPublicationError<E> {
    fn from(error: NetworkError) -> Self {
        Self::Network(error)
    }
}
/// One authorized refresh: prefetch fence -> bounded GET -> complete generation
/// -> durable sidecar -> consuming AT07 publication. This opens no listener.
pub async fn refresh_network<A, P, S, C>(
    provider: &mut NetworkProvider,
    config: NetworkHttpConfig,
    authority: Arc<A>,
    publisher: &mut P,
    sidecar: &mut S,
    cancellation: CancellationToken,
    clock: C,
) -> std::result::Result<
    NetworkPublicationOutcome<P::Receipt, P::Fence, A::Lease>,
    NetworkPublicationError<P::Error>,
>
where
    A: NetworkReadAuthority,
    P: NetworkCachePublisher<A::Lease>,
    S: DurableNetworkSidecar,
    C: FnMut() -> String,
{
    let decode_limits = provider.limits();
    let transport_limits = config.limits();
    guard(
        provider.registration() == config.source()
            && decode_limits.max_records <= transport_limits.max_records
            && decode_limits.max_response_bytes <= transport_limits.max_response_bytes
            && decode_limits.request_timeout_ms <= transport_limits.request_timeout_ms,
    )?;
    check_cancelled(&cancellation)?;
    let source = config.source().clone();
    let origin = config.reviewed_origin().clone();
    let lease = Arc::new(authority.authorize_inventory(&source, &origin)?);
    authority.revalidate_inventory(&lease, &source, &origin)?;
    let PreparedNetworkCache { baseline, fence } = publisher
        .prepare_cache_publication(&source, lease.as_ref())
        .map_err(NetworkPublicationError::Storage)?;
    guard(
        fence.partition() == source.scope
            && baseline.cache_epoch <= 9_007_199_254_740_991
            && baseline.cache_epoch == fence.baseline_cache_epoch()
            && baseline.homebox_entities.is_empty()
            && baseline
                .cache
                .as_ref()
                .and_then(|v| v.generation_id.as_deref())
                == fence.baseline_generation_id()
            && uuid(fence.reserved_generation_id()),
    )?;
    let prior = match &baseline.cache {
        Some(cache) if cache.generation_id.is_some() => {
            let row = sidecar.load(
                &source,
                cache
                    .generation_id
                    .as_deref()
                    .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?,
            )?;
            reopen_sidecar(
                &source,
                cache,
                &baseline.network_relations,
                &row,
                Some(provider.link_review()),
            )?
        }
        Some(cache) => {
            guard(baseline.network_relations.is_empty())?;
            RetainedState {
                cache: cache.clone(),
                generation: None,
            }
        }
        None => {
            guard(baseline.network_relations.is_empty())?;
            RetainedState::empty(source.scope.clone())
        }
    };
    validate_state(&source, &prior, Some(provider.link_review()))?;
    let generation_id = fence.reserved_generation_id().to_owned();
    let transport = HttpInventoryTransport::new(
        config,
        authority.clone(),
        lease.clone(),
        cancellation.clone(),
    )?;
    let outcome = provider
        .prepare_refresh(
            &prior,
            baseline.cache_epoch,
            &generation_id,
            &transport,
            clock,
        )
        .await?;
    check_cancelled(&cancellation)?;
    authority.revalidate_inventory(&lease, &source, &origin)?;
    match outcome {
        RefreshOutcome::Complete(proposal) => {
            guard(
                proposal.precondition().expected_cache_epoch == fence.baseline_cache_epoch()
                    && proposal.precondition().expected_generation_id.as_deref()
                        == fence.baseline_generation_id()
                    && proposal.state().cache.generation_id.as_deref()
                        == Some(fence.reserved_generation_id()),
            )?;
            let generation = proposal
                .state()
                .generation
                .as_ref()
                .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
            authority.authorize_generation(&lease, &source, generation)?;
            let staged = stage_complete_generation(&source, *proposal, sidecar)?;
            check_cancelled(&cancellation)?;
            authority.revalidate_inventory(&lease, &source, &origin)?;
            let receipt = publisher
                .publish_prepared_generation(fence, staged, lease.as_ref())
                .map_err(NetworkPublicationError::Storage)?;
            Ok(NetworkPublicationOutcome::Published(receipt))
        }
        RefreshOutcome::Failed(failure) => {
            // Keep the original fence/lease and sanitized proposal for the
            // native consuming failure transaction. The controller itself
            // performs no failure write and never drops/rebases this fence.
            let precondition = PublicationPrecondition {
                expected_generation_id: fence.baseline_generation_id().map(str::to_owned),
                expected_cache_epoch: fence.baseline_cache_epoch(),
            };
            Ok(NetworkPublicationOutcome::SourceFailure(Box::new(
                PendingNetworkFailure {
                    failure: *failure,
                    precondition,
                    fence,
                    lease,
                },
            )))
        }
    }
}
fn check_cancelled(token: &CancellationToken) -> Result<()> {
    if token.is_cancelled() {
        Err(NetworkError::new(ErrorCode::Timeout))
    } else {
        Ok(())
    }
}
