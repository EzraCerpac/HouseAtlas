//! Closed native HomeBox workflows over original owner authority and proofs.
use crate::{
    app::{Core, RequestPrincipal},
    config::providers::{
        homebox::{ConfigError, TrustedHomeBoxSource},
        registry::ConfiguredSource,
    },
    lifecycle::providers::authority::{
        ConfigurationLease, HomeBoxPublicationOutcome, HomeBoxRevalidationOutcome,
        NativeLifecycleAuthority, ProviderLease, TrustedLifecycleAuthority,
    },
    providers::homebox::read,
    storage,
};
use std::sync::{Arc, Mutex};

#[derive(Debug)]
pub enum HostError {
    Configuration(ConfigError),
    InvalidView,
    Authority,
    Publication(read::PublishError),
    Storage(storage::Error),
    /// Sanitized failure/quarantine proposal and actual filtered-read statistics.
    /// This metadata is neither a complete generation nor an automatic write.
    FilteredRead(Box<read::FailedRead>),
}
impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HomeBox operation is unavailable")
    }
}
impl std::error::Error for HostError {}
impl HostError {
    /// The cache was already quarantined, so the refresh stopped before any
    /// provider request. Pressing refresh again cannot change that.
    pub fn quarantined(&self) -> bool {
        matches!(self, Self::Storage(error)
            if error.message == crate::lifecycle::providers::authority::QUARANTINED)
    }
    /// A recheck found the source not quarantined and sent nothing upstream.
    pub fn not_quarantined(&self) -> bool {
        matches!(self, Self::Storage(error)
            if error.message == crate::lifecycle::providers::authority::NOT_QUARANTINED)
    }
    /// The stored cache changed between preparation and commit (for example a
    /// concurrent publication); the commit was refused and nothing changed.
    pub fn changed(&self) -> bool {
        matches!(self, Self::Storage(error) if error.code == "guard-conflict")
    }
}

/// Result of one explicit recheck of a quarantined source.
pub enum RecheckOutcome {
    /// A complete read of exactly the configured source replaced the
    /// quarantined generation; the quarantine was cleared in that commit.
    Cleared { cache: Box<storage::CacheStatus> },
    /// The read failed. Nothing was written: the quarantine and the last good
    /// state stay exactly as stored.
    Kept { code: read::ErrorCode },
}

/// Only metadata exposed by the actual closed owner operations is returned.
/// Their private reader proofs expose no statistics or generation accessor.
pub enum RefreshOutcome {
    Published {
        cache: storage::CacheStatus,
    },
    FailureRecorded {
        cache: storage::CacheStatus,
        code: read::ErrorCode,
    },
}

/// Trusted setup through the owner's closed registration operation.
/// The caller holds no access/store guard. The full configured source must match
/// the trusted endpoint registration before authority capture or durable writing.
/// Registration preserves quarantine; enablement remains owner-managed. Storage
/// and access commits are ordered, not an atomic two-database transaction.
pub fn register<A: TrustedLifecycleAuthority>(
    core: &Core,
    authority: &A,
    principal: &RequestPrincipal,
    configured: Arc<ConfiguredSource>,
    source: &TrustedHomeBoxSource,
) -> Result<storage::SourceRegistration, HostError> {
    if configured.registration() != source.registration() {
        return Err(HostError::Publication(
            read::PublishError::RegistrationMismatch,
        ));
    }
    let lease =
        ConfigurationLease::capture(&core.access, authority, &principal.principal, configured)
            .map_err(|_| HostError::Authority)?;
    let registration = {
        let mut store = core.store.lock().map_err(|_| HostError::Authority)?;
        lease
            .register(authority, &mut *store)
            .map_err(HostError::Storage)?
    };
    if &registration != source.registration() {
        return Err(HostError::Publication(
            read::PublishError::RegistrationMismatch,
        ));
    }
    let access = core.access.lock().map_err(|_| HostError::Authority)?;
    principal
        .release(&access)
        .map_err(|_| HostError::Authority)?;
    Ok(registration)
}

/// Root must retain THIS Core's original principal and captured grant handles in
/// this immutable lease using its app-owned handoff, never a reconstructed
/// principal or a lease from a different access boundary.
/// Credentials use the owner's Send-safe opaque-authority port. The existing
/// Core and Store are borrowed only in synchronous blocks; no host, access or
/// store guard survives provider I/O. Each commit consumes the actual private
/// reader proof on the issuing Store under the same original lease.
pub async fn refresh<A: TrustedLifecycleAuthority, P: read::CredentialProvider, K: read::Clock>(
    core: &Arc<Mutex<Core>>,
    authority: &A,
    lease: &Arc<ProviderLease<A::Grant>>,
    source: &TrustedHomeBoxSource,
    credentials: P,
    clock: K,
) -> Result<RefreshOutcome, HostError> {
    if lease.source().registration() != source.registration() {
        return Err(HostError::Publication(
            read::PublishError::RegistrationMismatch,
        ));
    }
    lease
        .revalidate(authority)
        .map_err(|_| HostError::Authority)?;
    let reader = source
        .reader(credentials, clock)
        .map_err(HostError::Configuration)?;
    publish(core, authority, lease, reader).await
}

/// One explicit Editor-requested refresh with the configured trusted header.
/// Credentials bind to the lease's own principal and partition grant; every
/// provider request is a GET from the existing reader. No retry or schedule.
pub async fn refresh_configured(
    core: &Arc<Mutex<Core>>,
    lease: &Arc<ProviderLease<crate::access::LifecycleGrant>>,
    source: &TrustedHomeBoxSource,
    credentials: &Arc<read::NativeReadCredentialConfig>,
    #[cfg(test)] certificate: Option<&[u8]>,
) -> Result<RefreshOutcome, HostError> {
    let authority = NativeLifecycleAuthority;
    let reader = configured_reader(
        core,
        &authority,
        lease,
        source,
        credentials,
        #[cfg(test)]
        certificate,
    )?;
    publish(core, &authority, lease, reader).await
}

/// One explicit Editor-requested recheck of a quarantined source, under a
/// lease from `ProviderLease::capture_revalidation`. The same configured
/// header and GET-only reader as refresh; no retry or schedule.
pub async fn recheck_configured(
    core: &Arc<Mutex<Core>>,
    lease: &Arc<ProviderLease<crate::access::LifecycleGrant>>,
    source: &TrustedHomeBoxSource,
    credentials: &Arc<read::NativeReadCredentialConfig>,
    #[cfg(test)] certificate: Option<&[u8]>,
) -> Result<RecheckOutcome, HostError> {
    let authority = NativeLifecycleAuthority;
    let mut reader = configured_reader(
        core,
        &authority,
        lease,
        source,
        credentials,
        #[cfg(test)]
        certificate,
    )?;
    let prepared = {
        let core = core.lock().map_err(|_| HostError::Authority)?;
        let mut store = core.store.lock().map_err(|_| HostError::Authority)?;
        lease
            .prepare_homebox_publication(&authority, &mut store, &reader)
            .map_err(HostError::Storage)?
    };
    let fetched = prepared
        .fetch_revalidation(&authority, &mut reader)
        .await
        .map_err(HostError::Storage)?;
    let outcome = match fetched {
        HomeBoxRevalidationOutcome::Complete(staged) => {
            let core = core.lock().map_err(|_| HostError::Authority)?;
            let mut store = core.store.lock().map_err(|_| HostError::Authority)?;
            RecheckOutcome::Cleared {
                cache: Box::new(
                    (*staged)
                        .commit(&authority, &mut store)
                        .map_err(HostError::Storage)?,
                ),
            }
        }
        HomeBoxRevalidationOutcome::Failed(code) => RecheckOutcome::Kept { code },
    };
    lease
        .revalidate(&authority)
        .map_err(|_| HostError::Authority)?;
    Ok(outcome)
}

/// Binds the configured header to the lease's own principal and partition
/// grant, after checking the registration and revalidating the lease.
fn configured_reader<'p>(
    core: &Arc<Mutex<Core>>,
    authority: &NativeLifecycleAuthority,
    lease: &'p ProviderLease<crate::access::LifecycleGrant>,
    source: &TrustedHomeBoxSource,
    credentials: &Arc<read::NativeReadCredentialConfig>,
    #[cfg(test)] certificate: Option<&[u8]>,
) -> Result<
    read::HomeBoxReader<read::HttpTransport<read::NativeReadCredentials<'p>>, RefreshClock>,
    HostError,
> {
    if lease.source().registration() != source.registration() {
        return Err(HostError::Publication(
            read::PublishError::RegistrationMismatch,
        ));
    }
    lease
        .revalidate(authority)
        .map_err(|_| HostError::Authority)?;
    let access = Arc::clone(&core.lock().map_err(|_| HostError::Authority)?.access);
    let bound = credentials
        .bind_publication(access, lease.principal(), lease.partition_grant().clone())
        .map_err(|_| HostError::Authority)?;
    #[cfg(test)]
    if let Some(certificate) = certificate {
        return source
            .reader_with_loopback_certificate(bound, RefreshClock, certificate)
            .map_err(HostError::Configuration);
    }
    source
        .reader(bound, RefreshClock)
        .map_err(HostError::Configuration)
}

struct RefreshClock;
impl read::Clock for RefreshClock {
    fn now(&self) -> read::Timestamp {
        let current: chrono::DateTime<chrono::Utc> = std::time::SystemTime::now().into();
        read::Timestamp::parse(&current.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
            .expect("SystemTime RFC3339 timestamp")
    }
}

async fn publish<A: TrustedLifecycleAuthority, T: read::Transport, K: read::Clock>(
    core: &Arc<Mutex<Core>>,
    authority: &A,
    lease: &Arc<ProviderLease<A::Grant>>,
    mut reader: read::HomeBoxReader<T, K>,
) -> Result<RefreshOutcome, HostError> {
    let prepared = {
        let core = core.lock().map_err(|_| HostError::Authority)?;
        let mut store = core.store.lock().map_err(|_| HostError::Authority)?;
        lease
            .prepare_homebox_publication(authority, &mut store, &reader)
            .map_err(HostError::Storage)?
    };
    // The owner repeats full registration and quarantine checks before GETs,
    // revalidates the original lease after I/O, and retains the failure CAS proof.
    let fetched = prepared
        .fetch(authority, &mut reader)
        .await
        .map_err(HostError::Storage)?;
    let outcome = {
        let core = core.lock().map_err(|_| HostError::Authority)?;
        let mut store = core.store.lock().map_err(|_| HostError::Authority)?;
        match fetched {
            HomeBoxPublicationOutcome::Complete(staged) => RefreshOutcome::Published {
                cache: (*staged)
                    .commit(authority, &mut store)
                    .map_err(HostError::Storage)?,
            },
            HomeBoxPublicationOutcome::Failed(failed) => {
                let code = failed.error_code();
                let cache = (*failed)
                    .commit_failure(authority, &mut store)
                    .map_err(HostError::Storage)?;
                RefreshOutcome::FailureRecorded { cache, code }
            }
        }
    };
    lease
        .revalidate(authority)
        .map_err(|_| HostError::Authority)?;
    Ok(outcome)
}
