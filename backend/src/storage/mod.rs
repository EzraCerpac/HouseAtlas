//! Transactional persistence for the published Atlas record contract.
//!
//! Contract and authorization adapters are required; this module supplies neither
//! a default authorization decision nor a second domain validation framework.
mod cache_repository;
mod cache_types;
mod command_extension;
mod context;
mod error;
mod homebox_stock_history_types;
mod migrations;
mod native;
mod numeric;
mod ports;
mod presence_profile;
#[expect(
    dead_code,
    reason = "Historical custody has no configured independent owner; no profile-7 admission or recovery mount"
)]
mod presence_validation;
mod presence_witness_repository;
pub use presence_profile::{
    PresenceProfileDefinition, PresenceProfileSelection, presence_profile_definition,
};
mod queue;
mod queue_original_profile;
pub use queue_original_profile::{
    QueueOriginalPreparationProfileDefinition, QueueOriginalPreparationProfileSelection,
    queue_original_preparation_profile_definition,
};
mod repository;
mod stock_activity;
mod stock_asset_review_types;
mod stock_derivation;
mod stock_history_repository;
mod stock_projection;
mod stock_recovery;
mod stock_repository;
mod stock_retained_read_types;
pub use stock_retained_read_types::*;
mod stock_types;
mod store;
mod types;
mod upload_repository;
mod upload_types;

pub use cache_types::*;
pub use error::{Error, Result};
pub use homebox_stock_history_types::*;
pub use migrations::{DATABASE_LINEAGE, DATABASE_VERSION, STOCK_ACTIVITY_DATABASE_VERSION};
pub use native::NativeContract;
pub use ports::{
    AssetProof, Authorization, AuthorizationRequest, Capability, Contract, Prior, Runtime,
};
pub use queue::{
    JournalEvidenceView, NativeJournalReceipt, PreparedNativeIntent, QueueAction,
    QueueAuthorization, QueueDiscovery, QueueEvidenceInbox, QueueHandles, QueueJournalHandle,
    QueueJournalPort, QueueOriginalIntent, QueueOriginalPreparationCommittedData,
    QueueOriginalPreparationData, QueueOriginalPreparationObservation, QueuePhase,
    QueueRecoveryAttempt, QueueRecoveryEvidence, QueueRecoveryOutcome, QueueSession,
    QueueSessionBinding, QueueStepEvidence, QueueStoreHandle, StepKind,
};
pub use stock_activity::*;
pub use stock_asset_review_types::*;
pub use stock_types::*;
pub use store::*;
pub use types::*;
pub use upload_types::{
    AssetUploadCommitObservation, AssetUploadQualifiedCompletion, ConsumedUpload,
    ExistingOriginalAsset, MediaPolicyRecoveryFrame, StagedUploadPrincipal,
};

pub(crate) use stock_activity::retained_native_codec_bridge;
