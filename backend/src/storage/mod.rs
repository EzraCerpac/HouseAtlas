//! Transactional persistence for the published Atlas record contract.
//!
//! Contract and authorization adapters are required; this module supplies neither
//! a default authorization decision nor a second domain validation framework.
mod cache_repository;
mod cache_types;
mod command_extension;
mod context;
mod error;
mod migrations;
mod native;
mod numeric;
mod ports;
mod queue;
mod repository;
mod stock_history_repository;
mod stock_projection;
mod stock_recovery;
mod stock_repository;
mod stock_types;
mod store;
mod types;

pub use cache_types::*;
pub use error::{Error, Result};
pub use migrations::{DATABASE_LINEAGE, DATABASE_VERSION};
pub use native::NativeContract;
pub use ports::{
    AssetProof, Authorization, AuthorizationRequest, Capability, Contract, Prior, Runtime,
};
pub use queue::{
    JournalEvidenceView, NativeJournalReceipt, PreparedNativeIntent, QueueAction,
    QueueAuthorization, QueueDiscovery, QueueEvidenceInbox, QueueHandles, QueueJournalHandle,
    QueueJournalPort, QueueOriginalIntent, QueuePhase, QueueRecoveryAttempt, QueueRecoveryEvidence,
    QueueRecoveryOutcome, QueueSession, QueueSessionBinding, QueueStepEvidence, QueueStoreHandle,
    StepKind,
};
pub use stock_types::*;
pub use store::{AtlasStore, RecoveryImage, RecoveryValidationPeers, StoreOptions};
pub use types::*;
