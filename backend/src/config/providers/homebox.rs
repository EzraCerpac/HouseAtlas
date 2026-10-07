//! Trusted host configuration for the reviewed, read-only HomeBox component.
//! No browser input, credential bytes, source enablement or qualification receipt.
use crate::{http::contracts::NativeContracts, providers::homebox::read, storage};
use storage::Contract;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigError {
    InvalidSource,
    InvalidEndpoint,
    InvalidLimits,
    InvalidNavigation,
}
impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HomeBox host configuration is unavailable")
    }
}
impl std::error::Error for ConfigError {}

/// Construct only from the host's reviewed settings. This value carries no
/// provider authority and cannot be decoded from an HTTP request.
#[derive(Clone)]
pub struct TrustedHomeBoxSource {
    origin: String,
    registration: storage::SourceRegistration,
    reader_registration: read::SourceRegistration,
    limits: read::Limits,
    navigation: Option<read::NativeNavigation>,
    stock_navigation: Option<read::StockNavigation>,
    stock_dialect: bool,
}
impl TrustedHomeBoxSource {
    pub fn new(
        origin: &str,
        registration: storage::SourceRegistration,
        limits: read::Limits,
        navigation: Option<read::NativeNavigation>,
    ) -> Result<Self, ConfigError> {
        if registration.owner != storage::SourceOwner::Homebox {
            return Err(ConfigError::InvalidSource);
        }
        let value = serde_json::to_value(&registration).map_err(|_| ConfigError::InvalidSource)?;
        NativeContracts
            .validate_shape("sourceRegistration", &value)
            .map_err(|_| ConfigError::InvalidSource)?;
        let reader_registration: read::SourceRegistration =
            serde_json::from_value(value).map_err(|_| ConfigError::InvalidSource)?;
        // The reader normalizes UUID spelling. Configuration must retain the
        // exact durable registration, rather than silently alter its identity.
        if reader_registration.workspace_id.as_str() != registration.workspace_id
            || reader_registration.home_id.as_str() != registration.home_id
            || reader_registration.source_instance_id.as_str() != registration.source_instance_id
            || reader_registration
                .allowed_external_ids
                .iter()
                .zip(&registration.allowed_external_ids)
                .any(|(reader, durable)| reader.as_str() != durable)
        {
            return Err(ConfigError::InvalidSource);
        }
        let endpoint = read::SourceEndpoint::https(origin, reader_registration.scope())
            .map_err(|_| ConfigError::InvalidEndpoint)?;
        let maximum = read::Limits::default();
        if [
            (limits.max_page_size as u64, maximum.max_page_size as u64),
            (limits.max_pages as u64, maximum.max_pages as u64),
            (
                limits.max_response_bytes as u64,
                maximum.max_response_bytes as u64,
            ),
            (
                limits.max_generation_bytes as u64,
                maximum.max_generation_bytes as u64,
            ),
            (limits.request_timeout_ms, maximum.request_timeout_ms),
            (limits.generation_timeout_ms, maximum.generation_timeout_ms),
        ]
        .into_iter()
        .any(|(value, maximum)| value == 0 || value > maximum)
        {
            return Err(ConfigError::InvalidLimits);
        }
        if let Some(navigation) = &navigation {
            let native = read::SourceEndpoint::https(&navigation.origin, navigation.scope.clone())
                .map_err(|_| ConfigError::InvalidNavigation)?;
            if native.scope() != endpoint.scope()
                || native.origin().origin() != endpoint.origin().origin()
            {
                return Err(ConfigError::InvalidNavigation);
            }
        }
        Ok(Self {
            origin: endpoint.origin().origin().ascii_serialization(),
            registration,
            reader_registration,
            limits,
            navigation,
            stock_navigation: None,
            stock_dialect: false,
        })
    }

    /// Trusted server selection of the pinned stock wire contract. This creates
    /// no source grant, credential, installed-build qualification or native link.
    pub fn new_stock(
        origin: &str,
        registration: storage::SourceRegistration,
        limits: read::Limits,
        navigation: Option<read::StockNavigation>,
    ) -> Result<Self, ConfigError> {
        let mut configured = Self::new(origin, registration, limits, None)?;
        if let Some(navigation) = &navigation {
            for native in [&navigation.locations, &navigation.items]
                .into_iter()
                .flatten()
            {
                let endpoint = read::SourceEndpoint::https(&native.origin, native.scope.clone())
                    .map_err(|_| ConfigError::InvalidNavigation)?;
                if endpoint.scope() != &configured.scope()
                    || endpoint.origin().origin().ascii_serialization() != configured.origin
                {
                    return Err(ConfigError::InvalidNavigation);
                }
            }
        }
        configured.stock_navigation = navigation;
        configured.stock_dialect = true;
        Ok(configured)
    }

    pub fn metadata_dialect(&self) -> &'static str {
        if self.stock_dialect {
            crate::providers::homebox::wire::DIALECT
        } else {
            read::METADATA_DIALECT
        }
    }

    pub fn registration(&self) -> &storage::SourceRegistration {
        &self.registration
    }
    pub fn scope(&self) -> read::SourceScope {
        self.reader_registration.scope()
    }
    pub fn partition(&self) -> storage::SourcePartition {
        self.registration.partition()
    }
    pub fn endpoint(&self) -> Result<read::SourceEndpoint, ConfigError> {
        read::SourceEndpoint::https(&self.origin, self.scope())
            .map_err(|_| ConfigError::InvalidEndpoint)
    }

    pub(crate) fn max_filtered_parents(&self) -> usize {
        self.limits.max_page_size
    }

    /// The host supplies an owner-approved credential provider. Its Send-safe
    /// authority bridge must retain original opaque grants; editor membership
    /// and this configuration alone cannot authorize credential release.
    pub fn reader<P: read::CredentialProvider, K: read::Clock>(
        &self,
        credentials: P,
        clock: K,
    ) -> Result<read::HomeBoxReader<read::HttpTransport<P>, K>, ConfigError> {
        let transport = read::HttpTransport::new(self.endpoint()?, credentials, self.limits)
            .map_err(|_| ConfigError::InvalidEndpoint)?;
        if self.stock_dialect {
            read::HomeBoxReader::new_stock(
                self.reader_registration.clone(),
                transport,
                clock,
                self.limits,
                self.stock_navigation.clone(),
            )
        } else {
            read::HomeBoxReader::new(
                self.reader_registration.clone(),
                transport,
                clock,
                self.limits,
                self.navigation.clone(),
            )
        }
        .map_err(|_| ConfigError::InvalidNavigation)
    }
}
