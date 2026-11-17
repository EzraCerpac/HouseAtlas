//! Trusted passive Network settings. No request, environment or source response
//! supplies an origin, registration, review, credentials or filesystem path.
use crate::{config::providers::registry::ConfiguredSource, providers::network as n};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// One compiled client profile: reqwest 0.13.5 with Rustls platform
/// verification. Reviewed extra roots retain certificate/hostname checks;
/// constructing settings supplies no live target qualification.
pub const COMPILED_TLS_PROFILE: &str = "reqwest-0.13.5-rustls-platform-verification";

#[derive(Clone)]
pub struct NetworkSettings {
    configured_source: Arc<ConfiguredSource>,
    transport: n::NetworkHttpConfig,
    review: n::LinkReview,
    limits: n::Limits,
    stale_after_ms: i64,
    sidecar_path: PathBuf,
    existing_cached_storage: bool,
    collector_measurements: bool,
    collector_interval_seconds: u64,
    collector_action_ports: Vec<u16>,
}
impl NetworkSettings {
    #[cfg(test)]
    pub(crate) fn with_test_peer(mut self, peer: Arc<dyn n::TestInventoryPeer>) -> Self {
        self.transport.test_peer = Some(peer);
        self
    }
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
            n::ReviewedNetworkOrigin::passive(origin)?,
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
            existing_cached_storage: false,
            collector_measurements: false,
            collector_interval_seconds: 60,
            collector_action_ports: vec![22, 80, 443],
        })
    }
    pub fn with_collector_measurements(mut self, enabled: bool) -> Result<Self, &'static str> {
        if enabled {
            self.transport.reviewed_origin().require_collector_http()?;
        }
        self.collector_measurements = enabled;
        Ok(self)
    }
    pub fn collector_measurements(&self) -> bool {
        self.collector_measurements
    }
    pub fn with_collector_interval_seconds(
        mut self,
        seconds: u64,
    ) -> Result<Self, n::NetworkError> {
        if !(10..=3600).contains(&seconds) || !self.collector_measurements {
            return Err(n::NetworkError::new(n::ErrorCode::InvalidSchema));
        }
        self.collector_interval_seconds = seconds;
        Ok(self)
    }
    pub fn with_collector_action_ports(mut self, ports: Vec<u16>) -> Result<Self, n::NetworkError> {
        let unique: std::collections::BTreeSet<_> = ports.iter().collect();
        if !self.collector_measurements
            || ports.len() > 16
            || unique.len() != ports.len()
            || ports.contains(&0)
        {
            return Err(n::NetworkError::new(n::ErrorCode::InvalidSchema));
        }
        self.collector_action_ports = ports;
        Ok(self)
    }
    pub(crate) fn collector_action_ports(&self) -> &[u16] {
        &self.collector_action_ports
    }
    pub fn collector_interval_seconds(&self) -> u64 {
        self.collector_interval_seconds
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
    /// Select the original opener's existing-only, read-only policy. This is
    /// retained through construction, rather than a metadata-only preflight.
    pub fn for_existing_cached_storage(mut self) -> Self {
        self.existing_cached_storage = true;
        self
    }
    pub(crate) fn open_sidecar(&self) -> Result<n::SqliteNetworkSidecar, n::NetworkError> {
        if self.existing_cached_storage {
            n::SqliteNetworkSidecar::open_existing(
                &self.sidecar_path,
                std::slice::from_ref(self.source()),
            )
        } else {
            n::SqliteNetworkSidecar::open(&self.sidecar_path, std::slice::from_ref(self.source()))
        }
    }
}
