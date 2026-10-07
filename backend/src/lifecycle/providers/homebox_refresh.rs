//! Explicit host refresh over the original principal and consuming owner proofs.
//! The root supplies provider authority; a configured endpoint is not a grant.
use crate::{
    app::RequestPrincipal,
    config::providers::homebox::{ConfigError, TrustedHomeBoxSource},
    providers::homebox::read,
    storage,
};
use std::future::Future;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderPhase {
    Configure,
    Prepare,
    Fetch,
    Publish,
    Release,
}
#[derive(Debug)]
pub enum HostError {
    Configuration(ConfigError),
    Authority,
    Publication(read::PublishError),
    Read(read::ErrorCode),
}
impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HomeBox operation is unavailable")
    }
}
impl std::error::Error for HostError {}

/// Successful fetches carry the actual owner's opaque StagedPublication.
/// Failed fetches must carry its original-principal/original-fence object.
/// No raw row, cloned fence, replacement principal or unfenced status fallback.
pub enum FetchFailure<F> {
    Publication(read::PublishError),
    Read(F),
}

/// Required root/owner seam, with no permissive implementation or defaults.
///
/// All storage operations must use the host's SAME open Store and its native
/// contract/runtime, with a borrowed per-call authorizer under the owner's
/// scoped access fence. Never reopen SQLite or install a global elevation.
/// `revalidate` checks the original RequestPrincipal and captured original
/// partition/entity grants against the exact trusted registration at each phase.
/// `fetch` must use the reader owner's consuming retained-failure successor;
/// the baseline PreparedGeneration::fetch drops its fence on failure and cannot
/// implement this contract. `commit_failure` calls the actual native consuming
/// failure CAS with that retained fence and original principal.
///
/// This port is intentionally unimplemented in the leaf. Ordinary ReadAuthority
/// denies ConfigureSource/PublishCache. Root and the access/storage/read owners
/// must provide the reviewed seam before mounting provider operations.
pub trait ProviderAuthorityPort {
    type FailedPublication<'p>;

    fn revalidate(
        &mut self,
        principal: &RequestPrincipal,
        source: &TrustedHomeBoxSource,
        phase: ProviderPhase,
    ) -> Result<(), HostError>;

    fn register(
        &mut self,
        principal: &RequestPrincipal,
        source: &TrustedHomeBoxSource,
    ) -> Result<storage::SourceRegistration, HostError>;

    fn prepare<'p, T: read::Transport, K: read::Clock>(
        &mut self,
        principal: &'p RequestPrincipal,
        source: &TrustedHomeBoxSource,
        reader: &read::HomeBoxReader<T, K>,
    ) -> Result<read::PreparedGeneration<'p, RequestPrincipal>, HostError>;

    fn fetch<'p, T: read::Transport, K: read::Clock>(
        &mut self,
        prepared: read::PreparedGeneration<'p, RequestPrincipal>,
        reader: &mut read::HomeBoxReader<T, K>,
    ) -> impl Future<
        Output = Result<
            read::StagedPublication<'p, RequestPrincipal>,
            FetchFailure<Self::FailedPublication<'p>>,
        >,
    >;

    fn commit(
        &mut self,
        source: &TrustedHomeBoxSource,
        staged: read::StagedPublication<'_, RequestPrincipal>,
    ) -> Result<storage::CacheStatus, HostError>;

    fn failure_metadata<'f, 'p>(
        &self,
        failed: &'f Self::FailedPublication<'p>,
    ) -> &'f read::FailedRead;

    fn commit_failure(
        &mut self,
        source: &TrustedHomeBoxSource,
        failed: Self::FailedPublication<'_>,
    ) -> Result<storage::CacheStatus, HostError>;

    /// Capture and revalidate original entity grants for the complete returned
    /// view before release. This grants no publication or configuration power.
    fn authorize_view(
        &mut self,
        principal: &RequestPrincipal,
        source: &TrustedHomeBoxSource,
        view: &read::FilteredView,
    ) -> Result<(), HostError>;
}

pub enum RefreshOutcome {
    Published {
        cache: storage::CacheStatus,
        stats: read::ReadStats,
    },
    FailureRecorded {
        cache: storage::CacheStatus,
        code: read::ErrorCode,
        stats: read::ReadStats,
    },
}

/// Explicit trusted setup only. Access-registry provisioning/enablement remains
/// owner-managed; this does not claim an atomic commit across the two databases.
pub fn register<A: ProviderAuthorityPort>(
    authority: &mut A,
    principal: &RequestPrincipal,
    source: &TrustedHomeBoxSource,
) -> Result<storage::SourceRegistration, HostError> {
    authority.revalidate(principal, source, ProviderPhase::Configure)?;
    let registration = authority.register(principal, source)?;
    if &registration != source.registration() {
        return Err(HostError::Publication(
            read::PublishError::RegistrationMismatch,
        ));
    }
    authority.revalidate(principal, source, ProviderPhase::Release)?;
    Ok(registration)
}

/// Run in a local execution context that retains this original principal.
/// No Send/Sync bound is added to the borrowed publication proof. Credentials
/// must use the owner's Send-safe opaque-authority bridge, not a borrowed
/// RequestPrincipal or a reconstruction from public actor/scope fields.
pub async fn refresh<A: ProviderAuthorityPort, P: read::CredentialProvider, K: read::Clock>(
    authority: &mut A,
    principal: &RequestPrincipal,
    source: &TrustedHomeBoxSource,
    credentials: P,
    clock: K,
) -> Result<RefreshOutcome, HostError> {
    authority.revalidate(principal, source, ProviderPhase::Prepare)?;
    let mut reader = source
        .reader(credentials, clock)
        .map_err(HostError::Configuration)?;
    let prepared = authority.prepare(principal, source, &reader)?;
    // The actual owner prepare compares the entire durable registration,
    // including partition mode and complete allowlist, before provider GETs.
    authority.revalidate(principal, source, ProviderPhase::Fetch)?;
    let outcome = match authority.fetch(prepared, &mut reader).await {
        Ok(staged) => {
            let stats = staged.generation().stats();
            authority.revalidate(principal, source, ProviderPhase::Publish)?;
            let cache = authority.commit(source, staged)?;
            RefreshOutcome::Published { cache, stats }
        }
        Err(FetchFailure::Publication(error)) => return Err(HostError::Publication(error)),
        Err(FetchFailure::Read(failed)) => {
            let metadata = authority.failure_metadata(&failed);
            let code = metadata.error.code;
            let stats = metadata.stats;
            authority.revalidate(principal, source, ProviderPhase::Publish)?;
            let cache = authority.commit_failure(source, failed)?;
            RefreshOutcome::FailureRecorded { cache, code, stats }
        }
    };
    authority.revalidate(principal, source, ProviderPhase::Release)?;
    Ok(outcome)
}
