use super::*;
use crate::{jobs, providers::homebox::write::stock as writer};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

pub const WRITER_COMMIT: &str = "5281eb1857a90c2279fb2998b3c7d0e2e41ec9b6";
pub const NATIVE_CODEC: &str = "houseatlas-homebox-stock-native/1";
pub const READBACK_CODEC: &str = "houseatlas-homebox-stock-readback/1";
pub const REMOTE_END_CODEC: &str = "houseatlas-homebox-stock-remote-end/1";
pub const NEVER_INVOKED_CODEC: &str = "houseatlas-homebox-stock-never-invoked/1";

pub const NATIVE_CODEC_V2: &str = "houseatlas-homebox-stock-native/2";
pub const READBACK_CODEC_V2: &str = "houseatlas-homebox-stock-readback/2";
pub const REMOTE_END_CODEC_V2: &str = "houseatlas-homebox-stock-remote-end/2";
pub const NEVER_INVOKED_CODEC_V2: &str = "houseatlas-homebox-stock-never-invoked/2";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum CodecVersion {
    V1,
    V2,
}
impl CodecVersion {
    pub fn native(self) -> &'static str {
        match self {
            Self::V1 => NATIVE_CODEC,
            Self::V2 => NATIVE_CODEC_V2,
        }
    }
    pub fn readback(self) -> &'static str {
        match self {
            Self::V1 => READBACK_CODEC,
            Self::V2 => READBACK_CODEC_V2,
        }
    }
    pub fn remote_end(self) -> &'static str {
        match self {
            Self::V1 => REMOTE_END_CODEC,
            Self::V2 => REMOTE_END_CODEC_V2,
        }
    }
    pub fn never_invoked(self) -> &'static str {
        match self {
            Self::V1 => NEVER_INVOKED_CODEC,
            Self::V2 => NEVER_INVOKED_CODEC_V2,
        }
    }
}
// Matches the accepted storage queue's metadata bound. This is a codec limit,
// not a provider response bound or a shared wire-schema change.
const MAX_PACKET_BYTES: usize = 1_048_576;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PreparedPacket {
    pub format: String,
    pub writer_commit: String,
    pub native_source_commit: String,
    pub binding: Value,
    pub command: writer::StockCommand,
    pub plan: writer::NativePlan,
    pub preparation: Value,
    pub preflight_digest: writer::Digest,
    pub authority: Value,
    pub permit: Value,
    pub baseline: writer::StockOutcome,
    pub activity_version: u64,
    // Absent for /1: its exact historical encoding remains unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writer_job_binding: Option<Value>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StepPacket {
    pub format: String,
    pub prepared_sha256: String,
    pub sequence: String,
    pub evidence: Value,
}
pub(super) fn encode<T: Serialize>(value: &T) -> storage::Result<Vec<u8>> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > MAX_PACKET_BYTES {
        return Err(incompatible());
    }
    Ok(bytes)
}
pub(super) fn decode<T: for<'de> Deserialize<'de> + Serialize>(bytes: &[u8]) -> storage::Result<T> {
    if bytes.is_empty() || bytes.len() > MAX_PACKET_BYTES {
        return Err(incompatible());
    }
    let value: T = serde_json::from_slice(bytes)?;
    // Exact producer spelling; also prevents duplicate fields/ignored fields
    // and numeric or whitespace rewriting from substituting prepared bytes.
    if encode(&value)? != bytes {
        return Err(incompatible());
    }
    Ok(value)
}
pub(super) fn raw_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn digest(value: &writer::Digest) -> storage::Result<jobs::Digest> {
    jobs::Digest::from_hex(value.as_str().to_owned()).map_err(|_| incompatible())
}
pub(super) fn binding(job: &jobs::LeasedJob) -> Value {
    let selection = match &job.canonical_scope.selection {
        jobs::ScopeSelection::Collection => json!({"collection":true}),
        jobs::ScopeSelection::Resources(rows) => {
            json!({"resources":rows.iter().map(|r| json!({"kind":format!("{:?}",r.kind),"id":r.id})).collect::<Vec<_>>() })
        }
    };
    json!({"jobId":job.lease.job_id.0,"fence":job.lease.fence.to_string(),
        "expiresAt":job.lease.expires_at.to_string(),"owner":job.lease.owner_id,"attempt":job.attempt.to_string(),
        "deployment":job.lease.physical_identity.deployment_id,"database":job.lease.physical_identity.physical_database_id,
        "configurationDigest":job.lease.physical_identity.configuration_digest.as_hex(),
        "workspace":job.request.receipt.workspace_id,"home":job.request.receipt.home_id,
        "actor":job.request.receipt.actor_id,"mutation":job.request.receipt.mutation_id,
        "source":job.request.partition.source_instance_id,"collection":job.request.partition.collection_id,
        "contract":job.request.intent.contract_id,"command":job.request.intent.operation_id,
        "requestDigest":job.request.intent.request_digest.as_hex(),"target":job.request.intent.target_external_id,
        "scope": {"collection":job.canonical_scope.collection_id,"selection":selection},
        "pendingBytes":{"required":job.pending_byte_liability.required,"reserved":job.pending_byte_liability.reserved_bytes.map(|v| v.to_string())}})
}
pub(super) fn qualification(value: &writer::NativeQualification) -> Value {
    match value {
        writer::NativeQualification::SyntheticFixture => json!({"kind":"synthetic-fixture"}),
        writer::NativeQualification::Qualified {
            catalog_digest,
            registered_build_digest,
            route_qualification_digest,
        } => {
            json!({"kind":"qualified","catalog":catalog_digest,"build":registered_build_digest,"route":route_qualification_digest})
        }
    }
}
pub(super) fn authority(value: &writer::StockAuthority) -> Value {
    json!({"actor":value.actor_id,"sourceEpoch":value.source_epoch.to_string(),"authority":value.authority_digest,
        "deployment":value.physical_binding.deployment_id,"database":value.physical_binding.physical_database_id,
        "configurationDigest":value.physical_binding.configuration_digest,"qualification":qualification(&value.qualification)})
}
pub(super) fn permit(value: &writer::InvocationPermit) -> Value {
    json!({"operation":value.operation_id,"actor":value.actor_id,"owner":value.owner_id,
        "dispatcherEpoch":value.dispatcher_epoch.to_string(),"sourceEpoch":value.source_epoch.to_string(),"planDigest":value.plan_digest,
        "deployment":value.physical_binding.deployment_id,"database":value.physical_binding.physical_database_id,
        "configurationDigest":value.physical_binding.configuration_digest,"qualification":qualification(&value.qualification)})
}
pub(super) fn preparation(value: &writer::Preparation) -> Value {
    json!({"snapshots":value.snapshots.iter().map(|s| json!({"target":s.target,"value":s.value,"digest":s.digest,
        "complete":s.complete,"hiddenFieldsPreserved":s.hidden_fields_preserved})).collect::<Vec<_>>(),
        "stagedUpload":value.staged_upload,"nativeClearValues":value.native_clear_values.iter().map(|c| json!({
            "commandId":c.command_id,"field":c.field,"nativeValue":c.native_value,"nativeReadbackValue":c.native_readback_value})).collect::<Vec<_>>()})
}
pub(super) fn receipt(value: &writer::DispatchReceipt) -> Value {
    json!({"operation":value.operation_id,"planDigest":value.plan_digest,"context":value.context,
        "source":value.source_instance_id,"collection":value.collection_id,"remoteActivity":value.remote_activity,
        "response":value.response.as_ref().map(|r| json!({"status":r.status,"value":r.value,"bodyDigest":r.body_digest}))})
}
fn impact(value: &Option<writer::ImpactObservation>) -> Value {
    value.as_ref().map(|v| json!({"effects":v.effects,"complete":v.complete,"evidenceDigest":v.evidence_digest})).unwrap_or(Value::Null)
}
pub(super) fn observation(value: &writer::NativeObservation) -> Value {
    match value {
        writer::NativeObservation::Present {
            context,
            target,
            value,
            observed_at,
            complete,
            impact: i,
        } => {
            json!({"kind":"present","context":context,"target":target,"value":value,"observedAt":observed_at,"complete":complete,"impact":impact(i)})
        }
        writer::NativeObservation::Absent {
            context,
            target,
            evidence_digest,
            observed_at,
            impact: i,
        } => {
            json!({"kind":"absent","context":context,"target":target,"evidenceDigest":evidence_digest,"observedAt":observed_at,"impact":impact(i)})
        }
        writer::NativeObservation::Effects {
            context,
            source_instance_id,
            collection_id,
            effects,
            complete,
            evidence_digest,
            observed_at,
        } => {
            json!({"kind":"effects","context":context,"source":source_instance_id,"collection":collection_id,"effects":effects,"complete":complete,"evidenceDigest":evidence_digest,"observedAt":observed_at})
        }
        writer::NativeObservation::Unavailable => json!({"kind":"unavailable"}),
    }
}
pub(super) fn remote(value: &writer::RemoteActivity) -> storage::Result<jobs::RemoteActivity> {
    if !value.well_formed() {
        return Err(incompatible());
    }
    Ok(match value {
        writer::RemoteActivity::NotDispatched { .. } => jobs::RemoteActivity::NotDispatched,
        writer::RemoteActivity::Active { .. } => {
            jobs::RemoteActivity::Invoked(jobs::InvokedRemoteActivity::Active)
        }
        writer::RemoteActivity::EndUnproven { .. } => {
            jobs::RemoteActivity::Invoked(jobs::InvokedRemoteActivity::EndUnproven)
        }
        writer::RemoteActivity::EndedProven {
            termination_evidence_digest,
        } => jobs::RemoteActivity::Invoked(jobs::InvokedRemoteActivity::EndedProven {
            termination_evidence_digest: digest(termination_evidence_digest)?,
        }),
    })
}
pub(super) fn liability(v: &writer::StorageLiability) -> storage::Result<jobs::StorageLiability> {
    if !v.well_formed() {
        return Err(incompatible());
    }
    Ok(jobs::StorageLiability {
        accounting: match v.reserved_bytes {
            Some(reserved_bytes) => jobs::ByteAccounting::Complete {
                known_bytes: v.known_bytes,
                reserved_bytes,
            },
            None => jobs::ByteAccounting::Incomplete {
                known_bytes: v.known_bytes,
            },
        },
        metadata_commit_evidence: match v.metadata_commit_evidence {
            writer::MetadataEvidence::NotDispatched => jobs::MetadataCommitEvidence::NotDispatched,
            writer::MetadataEvidence::ObservedNotCommitted => {
                jobs::MetadataCommitEvidence::ObservedNotCommitted
            }
            writer::MetadataEvidence::ObservedCommitted => {
                jobs::MetadataCommitEvidence::ObservedCommitted
            }
            writer::MetadataEvidence::Unknown => jobs::MetadataCommitEvidence::Unknown,
        },
        byte_disposition: match v.byte_disposition {
            writer::ByteDisposition::None => jobs::ByteDisposition::None,
            writer::ByteDisposition::RetainedUnbound => jobs::ByteDisposition::RetainedUnbound,
            writer::ByteDisposition::RetainedBound => jobs::ByteDisposition::RetainedBound,
            writer::ByteDisposition::Unknown => jobs::ByteDisposition::Unknown,
        },
        reference_closure_evidence: match v.reference_closure_evidence {
            writer::ReferenceClosure::Unassessed => jobs::ReferenceClosureEvidence::Unassessed,
            writer::ReferenceClosure::Incomplete => jobs::ReferenceClosureEvidence::Incomplete,
            writer::ReferenceClosure::OperatorEvidenced => {
                jobs::ReferenceClosureEvidence::OperatorEvidenced
            }
        },
        orphan_candidate_id: v.orphan_candidate_id.map(|id| id.to_string()),
        unresolved_attempts: u32::try_from(v.unresolved_attempts).map_err(|_| incompatible())?,
    })
}
