//! Original native-producer data joining two deliberately different identities.
//! Never construct this from queue/image packets or derive a UUID from a JobId.
use super::{codec::*, *};
use crate::{jobs, providers::homebox::write::stock as w};
use serde_json::{Value, json};
use uuid::Uuid;

pub const JOB_BINDING_FORMAT_V2: &str = "houseatlas-homebox-stock-job-binding/2";

/// Independently retain the exact actual claimed job and existing admitted
/// writer/permit together. Private fields and no Deserialize prevent adopting
/// image fields as this record. This is producer-owned DATA, not authority;
/// authentication/retention belongs to the original native owner.
pub struct RetainedWriterJobBinding {
    job: jobs::LeasedJob,
    admitted: w::StoredOperation,
    permit: w::InvocationPermit,
}
impl RetainedWriterJobBinding {
    /// The native producer must already possess the real claim and actual
    /// writer admission. No ID is generated, parsed from JobId or synthesized.
    pub fn retain(
        job: &jobs::LeasedJob,
        admitted: &w::StoredOperation,
        permit: &w::InvocationPermit,
    ) -> storage::Result<Self> {
        if job.lease.job_id.0.is_empty()
            || job.lease.job_id.0.chars().count() > 4096
            || admitted.operation_id.is_nil()
            || admitted.operation_id != admitted.outcome.operation_id
            || admitted.operation_id != permit.operation_id
            || admitted.actor_id != permit.actor_id
            || admitted.captured_authority.actor_id != permit.actor_id
            || admitted.captured_authority.physical_binding != permit.physical_binding
            || job.lease.fence != permit.dispatcher_epoch
            || job.lease.owner_id != permit.owner_id.to_string()
        {
            return Err(incompatible());
        }
        Ok(Self {
            job: job.clone(),
            admitted: admitted.clone(),
            permit: permit.clone(),
        })
    }
    pub fn job(&self) -> &jobs::LeasedJob {
        &self.job
    }
    pub fn writer_operation_id(&self) -> Uuid {
        self.admitted.operation_id
    }
    pub(super) fn matches(
        &self,
        job: &jobs::LeasedJob,
        admitted: &w::StoredOperation,
        permit: &w::InvocationPermit,
    ) -> bool {
        self.job == *job && self.admitted == *admitted && self.permit == *permit
    }
    pub(super) fn packet(&self) -> storage::Result<Value> {
        Ok(
            json!({"format":JOB_BINDING_FORMAT_V2, "job":binding(&self.job),
            "writerOperationId":self.admitted.operation_id,
            "originalEnvelopeSha256":raw_digest(&encode(&self.admitted.command.original_wire)?),
            "requestDigest":self.admitted.command.request_digest,
            "actor":self.admitted.actor_id, "authority":authority(&self.admitted.captured_authority),
            "permit":permit(&self.permit)}),
        )
    }
}
