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
mod stock_activity;
mod stock_derivation;
mod stock_history_repository;
mod stock_projection;
mod stock_recovery;
mod stock_repository;
mod stock_types;
mod store;
mod types;
mod upload_repository;
mod upload_types;

pub use cache_types::*;
pub use error::{Error, Result};
pub use migrations::{DATABASE_LINEAGE, DATABASE_VERSION, STOCK_ACTIVITY_DATABASE_VERSION};
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
pub use stock_activity::*;
pub use stock_types::*;
pub use store::*;
pub use types::*;
pub use upload_types::{
    ConsumedUpload, ExistingOriginalAsset, MediaPolicyRecoveryFrame, StagedUploadPrincipal,
};

pub(crate) use stock_activity::retained_native_codec_bridge;
