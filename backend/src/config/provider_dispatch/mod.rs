//! Trusted settings for the existing synchronous native jobs protocol.
//! These are host values, never request DTOs or live qualification receipts.
use crate::jobs::{InvalidConfig, QueueConfig};
pub mod stock_http;

/// One registration covers every configured alias of the deployment's single
/// physical provider-write queue. Jobs owns policy and validates all limits.
/// The host must route every provider writer through this registration.
pub struct TrustedDispatcherConfig(QueueConfig);

impl TrustedDispatcherConfig {
    pub fn new(config: QueueConfig) -> Result<Self, InvalidConfig> {
        config.validate()?;
        Ok(Self(config))
    }

    pub fn queue(&self) -> &QueueConfig {
        &self.0
    }

    pub fn into_queue(self) -> QueueConfig {
        self.0
    }
}
