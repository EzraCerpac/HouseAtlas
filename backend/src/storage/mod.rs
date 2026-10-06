//! Transactional persistence for the published Atlas record contract.
//!
//! Contract and authorization adapters are required; this module supplies neither
//! a default authorization decision nor a second domain validation framework.
mod context;
mod error;
mod migrations;
mod ports;
mod repository;
mod store;
mod types;

pub use error::{Error, Result};
pub use migrations::{DATABASE_LINEAGE, DATABASE_VERSION};
pub use ports::{
    AssetProof, Authorization, AuthorizationRequest, Capability, Contract, Prior, Runtime,
};
pub use store::{AtlasStore, StoreOptions};
pub use types::*;
