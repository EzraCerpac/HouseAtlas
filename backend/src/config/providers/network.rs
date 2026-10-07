//! Trusted passive Network settings. No request, environment or source response
//! supplies an origin, registration, review, credentials or filesystem path.
use crate::{config::providers::registry::ConfiguredSource, providers::network as n};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// The shared host currently compiles reqwest 0.13.5 with Rustls platform
/// verification. The owner's 0.12.24 WebPKI profile remains a reconciliation
/// item; constructing these settings does not qualify either real target.
pub const COMPILED_TLS_PROFILE: &str = "reqwest-0.13.5-rustls-platform-verification";

#[derive(Clone)]
pub struct NetworkSettings {
    configured_source: Arc<ConfiguredSource>,
    transport: n::NetworkHttpConfig,
    review: n::LinkReview,
    limits: n::Limits,
    stale_after_ms: i64,
    sidecar_path: PathBuf,
}
impl NetworkSettings {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        configured_source: Arc<ConfiguredSource>,
        origin: &str,
        review: n::LinkReview,
        limits: n::Limits,
        connect_timeout_ms: u64,
        idle_timeout_ms: u64,
        stale_after_ms: i64,
        private_directory: &Path,
    ) -> Result<Self, n::NetworkError> {
        if limits.max_records > 10_000 || stale_after_ms <= 0 {
            return Err(n::NetworkError::new(n::ErrorCode::InvalidSchema));
        }
        // The sidecar is separate from Atlas. The partition-derived basename
        // avoids mixing different immutable registries or accepting the Atlas
        // database as a second publication connection.
        let metadata = std::fs::symlink_metadata(private_directory)
            .map_err(|_| n::NetworkError::new(n::ErrorCode::Upstream))?;
        if !private_directory.is_absolute()
            || !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || std::fs::canonicalize(private_directory)
                .map_or(true, |canonical| canonical != private_directory)
        {
            return Err(n::NetworkError::new(n::ErrorCode::InvalidSchema));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(n::NetworkError::new(n::ErrorCode::InvalidSchema));
            }
        }
        let source: n::SourceRegistration = serde_json::from_value(
            serde_json::to_value(configured_source.registration())
                .map_err(|_| n::NetworkError::new(n::ErrorCode::InvalidSchema))?,
        )
        .map_err(|_| n::NetworkError::new(n::ErrorCode::InvalidSchema))?;
        let transport = n::NetworkHttpConfig::new(
            source,
            n::ReviewedNetworkOrigin::https(origin)?,
            limits,
            connect_timeout_ms,
            idle_timeout_ms,
        )?;
        n::NetworkProvider::new(transport.source().clone(), review.clone(), limits)?;
        let partition = n::partition_key(&transport.source().scope)?;
        let sidecar_name = format!("network-{:x}.sqlite", Sha256::digest(partition.as_bytes()));
        Ok(Self {
            configured_source,
            transport,
            review,
            limits,
            stale_after_ms,
            sidecar_path: private_directory.join(sidecar_name),
        })
    }
    /// Adds a reviewed trust root while retaining certificate/hostname checks.
    pub fn with_reviewed_ca_pem(mut self, pem: &[u8]) -> Result<Self, n::NetworkError> {
        self.transport = self.transport.with_reviewed_ca_pem(pem)?;
        Ok(self)
    }
    pub fn configured_source(&self) -> &Arc<ConfiguredSource> {
        &self.configured_source
    }
    pub fn source(&self) -> &n::SourceRegistration {
        self.transport.source()
    }
    pub fn transport(&self) -> n::NetworkHttpConfig {
        self.transport.clone()
    }
    pub fn review(&self) -> &n::LinkReview {
        &self.review
    }
    pub fn stale_after_ms(&self) -> i64 {
        self.stale_after_ms
    }
    pub fn provider(&self) -> Result<n::NetworkProvider, n::NetworkError> {
        n::NetworkProvider::new(self.source().clone(), self.review.clone(), self.limits)
    }
    pub(crate) fn open_sidecar(&self) -> Result<n::SqliteNetworkSidecar, n::NetworkError> {
        n::SqliteNetworkSidecar::open(&self.sidecar_path, std::slice::from_ref(self.source()))
    }
}
