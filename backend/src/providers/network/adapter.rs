use super::{json::canonical_json, model::*, projection::*};
use std::{future::Future, pin::Pin, time::Duration};

pub const ADAPTER_VERSION: &str = "0.1.0";
pub const NETWORK_READ_ROUTES: [&str; 1] = ["/api/inventory"];

/// A capability with no caller-selected route, method, query, headers or body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InventoryGet;
impl InventoryGet {
    pub const fn method(self) -> &'static str {
        "GET"
    }
    pub const fn path(self) -> &'static str {
        NETWORK_READ_ROUTES[0]
    }
}
#[derive(Clone, Debug)]
pub struct InventoryResponse {
    pub status: u16,
    /// Server-configuration attestation, never a claim from upstream JSON.
    pub source: Option<SourceScope>,
    pub body: Vec<u8>,
    pub source_snapshot_at: Option<String>,
    pub redirected: bool,
    pub location: Option<String>,
    pub url: Option<String>,
}
/// The reviewed host transport must bound streaming before buffering, pin its
/// HTTPS origin/path, disable redirect following, and cancel on future drop.
/// http.rs supplies a concrete implementation using trusted host config ports.
pub trait InventoryTransport {
    fn get_inventory(
        &self,
        request: InventoryGet,
        limits: Limits,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<InventoryResponse, NetworkError>> + Send + '_>,
    >;
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicationPrecondition {
    pub expected_generation_id: Option<String>,
    pub expected_cache_epoch: u64,
}
/// Constructed only after a complete source-scope projection is validated.
/// The host revalidates access, stages the sidecar durably, then atomically
/// publishes relations/cache with this CAS witness. Preparation publishes none.
#[derive(Clone, Debug)]
pub struct CompleteGenerationProposal {
    state: RetainedState,
    precondition: PublicationPrecondition,
}
impl CompleteGenerationProposal {
    pub fn state(&self) -> &RetainedState {
        &self.state
    }
    pub fn precondition(&self) -> &PublicationPrecondition {
        &self.precondition
    }
    pub fn into_parts(self) -> (RetainedState, PublicationPrecondition) {
        (self.state, self.precondition)
    }
}
#[derive(Clone, Debug)]
pub struct RefreshFailure {
    pub error: NetworkError,
    /// Internal state: keep the validated previous generation for revision
    /// comparison/recovery. Expose it only through provider.read/public_read or
    /// build_facet, which withhold revoked records without destroying retention.
    pub state: RetainedState,
}
#[derive(Clone, Debug)]
pub enum RefreshOutcome {
    Complete(Box<CompleteGenerationProposal>),
    Failed(Box<RefreshFailure>),
}
#[derive(Clone, Debug)]
pub struct NetworkProvider {
    registration: SourceRegistration,
    review: LinkReview,
    limits: Limits,
}
impl NetworkProvider {
    pub fn new(
        registration: SourceRegistration,
        review: LinkReview,
        limits: Limits,
    ) -> Result<Self> {
        validate_registration(&registration)?;
        validate_limits(limits)?;
        Ok(Self {
            registration,
            review,
            limits,
        })
    }
    pub fn registration(&self) -> &SourceRegistration {
        &self.registration
    }
    pub(crate) fn limits(&self) -> Limits {
        self.limits
    }
    pub(crate) fn link_review(&self) -> &LinkReview {
        &self.review
    }
    pub fn read(&self, authoritative_state: &RetainedState) -> Result<RetainedState> {
        validate_state(&self.registration, authoritative_state, Some(&self.review))?;
        Ok(authoritative_state.public_read())
    }
    /// Exclusive borrowing prevents overlapping preparation on this instance.
    /// Coalescing at the authorized source-partition coordinator is host-owned.
    /// The clock and ID are injected; the component creates no listener or task.
    pub async fn prepare_refresh<T, C>(
        &mut self,
        prior: &RetainedState,
        expected_cache_epoch: u64,
        generation_id: &str,
        transport: &T,
        mut clock: C,
    ) -> Result<RefreshOutcome>
    where
        T: InventoryTransport + ?Sized,
        C: FnMut() -> String,
    {
        validate_state(&self.registration, prior, Some(&self.review))?;
        guard(uuid(generation_id))?;
        let attempted_at = clock();
        stamp(&attempted_at)?;
        let prepared = self
            .fetch(prior, generation_id, transport, &attempted_at, &mut clock)
            .await;
        Ok(match prepared {
            Ok(state) => RefreshOutcome::Complete(Box::new(CompleteGenerationProposal {
                state,
                precondition: PublicationPrecondition {
                    expected_generation_id: prior.cache.generation_id.clone(),
                    expected_cache_epoch,
                },
            })),
            Err(error) => {
                let mut state = prior.clone();
                state.cache.status = if error.code == ErrorCode::Auth
                    || prior.cache.status == CacheStatus::AccessRevoked
                {
                    CacheStatus::AccessRevoked
                } else {
                    CacheStatus::Error
                };
                state.cache.last_attempt_at = Some(attempted_at.clone());
                state.cache.error = Some(CacheError {
                    code: error.code,
                    at: attempted_at,
                    message: error.message().into(),
                });
                RefreshOutcome::Failed(Box::new(RefreshFailure { error, state }))
            }
        })
    }
    async fn fetch<T, C>(
        &self,
        prior: &RetainedState,
        generation_id: &str,
        transport: &T,
        attempted_at: &str,
        clock: &mut C,
    ) -> Result<RetainedState>
    where
        T: InventoryTransport + ?Sized,
        C: FnMut() -> String,
    {
        let response = tokio::time::timeout(
            Duration::from_millis(self.limits.request_timeout_ms),
            transport.get_inventory(InventoryGet, self.limits),
        )
        .await
        .map_err(|_| NetworkError::new(ErrorCode::Timeout))??;
        if matches!(response.status, 401 | 403) {
            return Err(NetworkError::new(ErrorCode::Auth));
        }
        if response.status != 200
            || response.redirected
            || response.location.is_some()
            || response.url.is_some()
        {
            return Err(NetworkError::new(ErrorCode::Upstream));
        }
        let source = response
            .source
            .as_ref()
            .ok_or_else(|| NetworkError::new(ErrorCode::WrongScope))?;
        same_scope(&self.registration, source)?;
        let fetched_at = clock();
        guard(stamp(&fetched_at)? >= stamp(attempted_at)?)?;
        let generation = project_capture(
            &self.registration,
            NetworkCapture {
                source,
                document: &response.body,
                retrieved_at: &fetched_at,
                source_snapshot_at: response.source_snapshot_at.as_deref(),
            },
            &self.review,
            self.limits,
        )?;
        if let Some(previous) = &prior.generation {
            guard(generation.source_revision >= previous.source_revision)?;
            if generation.source_revision == previous.source_revision {
                guard(
                    canonical_json(&inventory_values(&generation))?
                        == canonical_json(&inventory_values(previous))?,
                )?;
            }
        }
        let state = RetainedState {
            cache: CacheMetadata {
                schema_version: 1,
                scope: self.registration.scope.clone(),
                status: CacheStatus::Fresh,
                last_successful_fetch_at: Some(fetched_at),
                last_attempt_at: Some(attempted_at.into()),
                generation_id: Some(generation_id.into()),
                consistency: "non-transactional-offset-pages".into(),
                error: None,
            },
            generation: Some(generation),
        };
        validate_state(&self.registration, &state, Some(&self.review))?;
        Ok(state)
    }
}
