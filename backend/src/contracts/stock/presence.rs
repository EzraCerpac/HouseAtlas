//! Typed source-presence schema boundaries. These values describe witness and
//! qualification JSON; validating them grants no authority or admission.

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use super::{StockError, schema};
use crate::contracts::{ConstInt, JsonInteger, Scope, SourceKey, SourceRef, required_field};

/// Shape of the separately versioned, append-only witness representation.
/// Creation and durable ownership belong to the storage transaction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceWitness {
    pub schema_version: ConstInt<1>,
    pub semantic_amendment_version: PresenceAmendmentVersion,
    pub workspace_id: String,
    pub home_id: String,
    pub binding_record_id: String,
    pub binding_revision: JsonInteger,
    pub audit_id: String,
    pub mutation_id: String,
    pub actor_id: String,
    pub operation: PresenceOperation,
    pub trigger: PresenceTrigger,
    pub source: SourceKey,
    pub observed_at: String,
    pub admitted_at: String,
    pub cache: PresenceCache,
    pub authority: PresenceAuthority,
    pub observation: PresenceObservation,
}

impl PresenceWitness {
    /// Preserve the witness's scope as the frozen core DTO.
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
        }
    }

    /// Combine the witness's declared scope and source without admitting it.
    pub fn source_ref(&self) -> SourceRef {
        SourceRef {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            key: self.source.clone(),
        }
    }
}

/// Exact facts allowed by the qualification schema. It deliberately carries
/// no actor, admission stamp, committed revision, audit or mutation linkage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceQualification {
    pub binding_record_id: String,
    pub source: SourceKey,
    pub observed_at: String,
    pub cache: PresenceCache,
    pub authority: PresenceAuthority,
    pub observation: PresenceObservation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceAmendmentVersion {
    #[serde(rename = "1.1.0")]
    V1_1_0,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresenceOperation {
    Create,
    Replace,
    Restore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceTrigger {
    #[serde(rename = "create-present")]
    CreatePresent,
    #[serde(rename = "nonpresent-to-present")]
    NonpresentToPresent,
    #[serde(rename = "restore-active-present")]
    RestoreActivePresent,
    #[serde(rename = "present-evidence-ids-replaced")]
    PresentEvidenceIdsReplaced,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceCache {
    pub generation_id: String,
    pub cache_epoch: JsonInteger,
    pub status: PresenceCacheStatus,
    pub last_successful_fetch_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceCacheStatus {
    #[serde(rename = "fresh")]
    Fresh,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceAuthority {
    pub authority_context_version: PresenceAuthorityContextVersion,
    pub context_id: String,
    pub access_package_version: String,
    pub access_epoch: String,
    pub source_registration_version: JsonInteger,
    pub source_registration_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceAuthorityContextVersion {
    #[serde(rename = "atlas-mutation-authorization-context/1")]
    V1,
}

/// Preserve both observation arms and their required nullable source dates.
/// The schema also correlates the arm with the permitted source kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum PresenceObservation {
    #[serde(rename = "homebox-entity")]
    HomeboxEntity {
        #[serde(rename = "memberSha256")]
        member_sha256: String,
        #[serde(rename = "memberRetrievedAt")]
        member_retrieved_at: String,
        #[serde(rename = "sourceUpdatedAt", deserialize_with = "required_field")]
        source_updated_at: Option<String>,
    },
    #[serde(rename = "network-inventory")]
    NetworkInventory {
        #[serde(rename = "memberSha256")]
        member_sha256: String,
        #[serde(rename = "verifiedGenerationSha256")]
        verified_generation_sha256: String,
        #[serde(rename = "generationRetrievedAt")]
        generation_retrieved_at: String,
        #[serde(rename = "sourceSnapshotAt", deserialize_with = "required_field")]
        source_snapshot_at: Option<String>,
    },
}

/// Validate the embedded witness schema before decoding its narrow DTO.
pub fn decode_presence_witness(bytes: &[u8]) -> Result<PresenceWitness, StockError> {
    decode(bytes, true)
}

/// Validate the embedded qualification schema before decoding its narrow DTO.
pub fn decode_presence_qualification(bytes: &[u8]) -> Result<PresenceQualification, StockError> {
    decode(bytes, false)
}

/// Check witness shape, including formats, bounds and conditional correlations.
pub fn validate_presence_witness(value: &PresenceWitness) -> Result<(), StockError> {
    typed_value(value, true).map(|_| ())
}

/// Check qualification shape without treating its facts as server authority.
pub fn validate_presence_qualification(value: &PresenceQualification) -> Result<(), StockError> {
    typed_value(value, false).map(|_| ())
}

/// Validate then serialize a witness while preserving its wire representation.
pub fn encode_presence_witness(value: &PresenceWitness) -> Result<Vec<u8>, StockError> {
    encode(value, true)
}

/// Validate then serialize qualification facts without minting witness linkage.
pub fn encode_presence_qualification(value: &PresenceQualification) -> Result<Vec<u8>, StockError> {
    encode(value, false)
}

fn decode<T: DeserializeOwned>(bytes: &[u8], witness: bool) -> Result<T, StockError> {
    let value = crate::contracts::json_value::parse(bytes)
        .map_err(|error| StockError::invalid(error.to_string()))?;
    validate_value(&value, witness)?;
    serde_json::from_value(value).map_err(|error| StockError::invalid(error.to_string()))
}

fn typed_value<T: Serialize>(value: &T, witness: bool) -> Result<Value, StockError> {
    let value =
        serde_json::to_value(value).map_err(|error| StockError::invalid(error.to_string()))?;
    validate_value(&value, witness)?;
    Ok(value)
}

fn validate_value(value: &Value, witness: bool) -> Result<(), StockError> {
    crate::contracts::ensure_numbers_supported(value).map_err(StockError::invalid)?;
    schema::validate_presence(witness, value)
}

fn encode<T: Serialize>(value: &T, witness: bool) -> Result<Vec<u8>, StockError> {
    let value = typed_value(value, witness)?;
    serde_json::to_vec(&value).map_err(|error| StockError::invalid(error.to_string()))
}
