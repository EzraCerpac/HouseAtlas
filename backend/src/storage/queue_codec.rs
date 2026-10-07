use super::*;
use serde_json::{Value, json};

fn bad() -> Error {
    Error::new("schema-incompatible", "Stored queue value is incompatible")
}
fn str_field<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key).and_then(Value::as_str).ok_or_else(bad)
}
fn string(v: &Value, key: &str) -> Result<String> {
    Ok(str_field(v, key)?.to_owned())
}
fn uint(v: &Value, key: &str) -> Result<u64> {
    parse_u64(str_field(v, key)?)
}
fn bool_field(v: &Value, key: &str) -> Result<bool> {
    v.get(key).and_then(Value::as_bool).ok_or_else(bad)
}
fn optional_string(v: &Value, key: &str) -> Result<Option<String>> {
    match v.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        _ => Err(bad()),
    }
}
fn optional_uint(v: &Value, key: &str) -> Result<Option<u64>> {
    match optional_string(v, key)? {
        Some(s) => Ok(Some(parse_u64(&s)?)),
        None => Ok(None),
    }
}
fn digest(s: String) -> Result<Digest> {
    Digest::from_hex(s).map_err(|_| bad())
}
pub(super) fn parse_u64(s: &str) -> Result<u64> {
    let n = s.parse::<u64>().map_err(|_| bad())?;
    if n.to_string() != s {
        return Err(bad());
    }
    Ok(n)
}
pub(super) fn resource_kind(s: &str) -> Result<ResourceKind> {
    Ok(match s {
        "Entity" => ResourceKind::Entity,
        "Location" => ResourceKind::Location,
        "Tag" => ResourceKind::Tag,
        "Template" => ResourceKind::Template,
        "EntityType" => ResourceKind::EntityType,
        "Field" => ResourceKind::Field,
        "File" => ResourceKind::File,
        "Maintenance" => ResourceKind::Maintenance,
        _ => return Err(bad()),
    })
}
fn selection_value(s: &ScopeSelection) -> Value {
    match s {
        ScopeSelection::Collection => json!({"kind":"collection"}),
        ScopeSelection::Resources(items) => {
            json!({"kind":"resources","items":items.iter().map(|r|json!({"kind":format!("{:?}",r.kind),"id":r.id})).collect::<Vec<_>>()})
        }
    }
}
fn selection(v: &Value) -> Result<ScopeSelection> {
    match str_field(v, "kind")? {
        "collection" => Ok(ScopeSelection::Collection),
        "resources" => {
            let a = v.get("items").and_then(Value::as_array).ok_or_else(bad)?;
            let mut out = Vec::new();
            for r in a {
                out.push(ResourceRef {
                    kind: resource_kind(str_field(r, "kind")?)?,
                    id: string(r, "id")?,
                });
            }
            Ok(ScopeSelection::Resources(out))
        }
        _ => Err(bad()),
    }
}
pub(super) fn scope_value(s: &CanonicalScope) -> Value {
    json!({"collection":s.collection_id,"selection":selection_value(&s.selection)})
}
pub(super) fn scope(v: &Value) -> Result<CanonicalScope> {
    Ok(CanonicalScope {
        collection_id: string(v, "collection")?,
        selection: selection(v.get("selection").ok_or_else(bad)?)?,
    })
}
pub(super) fn request_value(r: &EnqueueRequest) -> Value {
    json!({"receipt":{"workspace":r.receipt.workspace_id,"home":r.receipt.home_id,"actor":r.receipt.actor_id,"mutation":r.receipt.mutation_id},"partition":{"workspace":r.partition.workspace_id,"home":r.partition.home_id,"source":r.partition.source_instance_id,"collection":r.partition.collection_id},"intent":{"contract":r.intent.contract_id,"operation":r.intent.operation_id,"target":r.intent.target_external_id,"digest":r.intent.request_digest.as_hex()},"writeScope":{"source":r.write_scope.source_instance_id,"collection":r.write_scope.collection_id,"selection":selection_value(&r.write_scope.selection)},"pending":{"required":r.pending_byte_liability.required,"reserved":r.pending_byte_liability.reserved_bytes.map(|n|n.to_string())}})
}
pub(super) fn request(v: &Value) -> Result<EnqueueRequest> {
    let x = v.get("receipt").ok_or_else(bad)?;
    let p = v.get("partition").ok_or_else(bad)?;
    let i = v.get("intent").ok_or_else(bad)?;
    let w = v.get("writeScope").ok_or_else(bad)?;
    let b = v.get("pending").ok_or_else(bad)?;
    let out = EnqueueRequest {
        receipt: ReceiptKey {
            workspace_id: string(x, "workspace")?,
            home_id: string(x, "home")?,
            actor_id: string(x, "actor")?,
            mutation_id: string(x, "mutation")?,
        },
        partition: SourcePartition {
            workspace_id: string(p, "workspace")?,
            home_id: string(p, "home")?,
            source_instance_id: string(p, "source")?,
            collection_id: string(p, "collection")?,
        },
        intent: IntentMetadata {
            contract_id: string(i, "contract")?,
            operation_id: string(i, "operation")?,
            target_external_id: optional_string(i, "target")?,
            request_digest: digest(string(i, "digest")?)?,
        },
        write_scope: WriteScope {
            source_instance_id: string(w, "source")?,
            collection_id: string(w, "collection")?,
            selection: selection(w.get("selection").ok_or_else(bad)?)?,
        },
        pending_byte_liability: PendingByteLiability {
            required: bool_field(b, "required")?,
            reserved_bytes: optional_uint(b, "reserved")?,
        },
    };
    out.validate().map_err(|_| bad())?;
    Ok(out)
}
pub(super) fn liability_value(v: &StorageLiability) -> Value {
    let (complete, known, reserved) = match v.accounting {
        ByteAccounting::Complete {
            known_bytes,
            reserved_bytes,
        } => (true, known_bytes, Some(reserved_bytes)),
        ByteAccounting::Incomplete { known_bytes } => (false, known_bytes, None),
    };
    json!({"complete":complete,"known":known.to_string(),"reserved":reserved.map(|n|n.to_string()),"metadata":format!("{:?}",v.metadata_commit_evidence),"bytes":format!("{:?}",v.byte_disposition),"closure":format!("{:?}",v.reference_closure_evidence),"orphan":v.orphan_candidate_id,"unresolved":v.unresolved_attempts})
}
pub(super) fn liability(v: &Value) -> Result<StorageLiability> {
    let complete = bool_field(v, "complete")?;
    let known = uint(v, "known")?;
    let reserved = optional_uint(v, "reserved")?;
    let accounting = match (complete, reserved) {
        (true, Some(reserved_bytes)) => ByteAccounting::Complete {
            known_bytes: known,
            reserved_bytes,
        },
        (false, None) => ByteAccounting::Incomplete { known_bytes: known },
        _ => return Err(bad()),
    };
    let metadata_commit_evidence = match str_field(v, "metadata")? {
        "NotDispatched" => MetadataCommitEvidence::NotDispatched,
        "ObservedNotCommitted" => MetadataCommitEvidence::ObservedNotCommitted,
        "ObservedCommitted" => MetadataCommitEvidence::ObservedCommitted,
        "Unknown" => MetadataCommitEvidence::Unknown,
        _ => return Err(bad()),
    };
    let byte_disposition = match str_field(v, "bytes")? {
        "None" => ByteDisposition::None,
        "RetainedUnbound" => ByteDisposition::RetainedUnbound,
        "RetainedBound" => ByteDisposition::RetainedBound,
        "Unknown" => ByteDisposition::Unknown,
        _ => return Err(bad()),
    };
    let reference_closure_evidence = match str_field(v, "closure")? {
        "Unassessed" => ReferenceClosureEvidence::Unassessed,
        "Incomplete" => ReferenceClosureEvidence::Incomplete,
        "OperatorEvidenced" => ReferenceClosureEvidence::OperatorEvidenced,
        _ => return Err(bad()),
    };
    let unresolved_attempts = v
        .get("unresolved")
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(bad)?;
    Ok(StorageLiability {
        accounting,
        metadata_commit_evidence,
        byte_disposition,
        reference_closure_evidence,
        orphan_candidate_id: optional_string(v, "orphan")?,
        unresolved_attempts,
    })
}
pub(super) fn applied_value(a: &AppliedWrite) -> Value {
    json!({"external":a.external_id,"date":a.source_updated_at,"response":a.observation.response_digest.as_hex(),"readback":a.observation.readback_digest.as_hex(),"observed":a.observation.observed_at.to_string()})
}
pub(super) fn applied(v: &Value) -> Result<AppliedWrite> {
    Ok(AppliedWrite {
        external_id: optional_string(v, "external")?,
        source_updated_at: optional_string(v, "date")?,
        observation: ObservedWriteEvidence {
            response_digest: digest(string(v, "response")?)?,
            readback_digest: digest(string(v, "readback")?)?,
            observed_at: uint(v, "observed")?,
        },
    })
}
pub(super) fn status(s: &str) -> Result<JobStatus> {
    Ok(match s {
        "prepared" => JobStatus::Prepared,
        "queued" => JobStatus::Queued,
        "running" => JobStatus::Running,
        "retry" => JobStatus::RetryScheduled,
        "succeeded" => JobStatus::Succeeded,
        "failed" => JobStatus::Failed,
        "held" => JobStatus::NeedsReconciliation,
        "partial" => JobStatus::Partial,
        "resolved-observed" => JobStatus::ResolvedObserved,
        "resolved-human" => JobStatus::ResolvedByHuman,
        _ => return Err(bad()),
    })
}
pub(super) fn failure(s: &str) -> Result<FailureCode> {
    Ok(match s {
        "Unavailable" => FailureCode::Unavailable,
        "RateLimited" => FailureCode::RateLimited,
        "Rejected" => FailureCode::Rejected,
        "AccessDenied" => FailureCode::AccessDenied,
        "InvalidPreparedPayload" => FailureCode::InvalidPreparedPayload,
        "OutcomeUnknown" => FailureCode::OutcomeUnknown,
        "LeaseExpired" => FailureCode::LeaseExpired,
        "AdmissionWaitExpired" => FailureCode::AdmissionWaitExpired,
        _ => return Err(bad()),
    })
}
pub(super) fn activity(state: &str, hash: Option<String>) -> Result<RemoteActivity> {
    Ok(match state {
        "not-dispatched" if hash.is_none() => RemoteActivity::NotDispatched,
        "active" if hash.is_none() => RemoteActivity::Invoked(InvokedRemoteActivity::Active),
        "end-unproven" if hash.is_none() => {
            RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven)
        }
        "ended-proven" => RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest: digest(hash.ok_or_else(bad)?)?,
        }),
        _ => return Err(bad()),
    })
}
pub(super) fn activity_parts(activity: &RemoteActivity) -> (&'static str, Option<&str>) {
    match activity {
        RemoteActivity::NotDispatched => ("not-dispatched", None),
        RemoteActivity::Invoked(InvokedRemoteActivity::Active) => ("active", None),
        RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven) => ("end-unproven", None),
        RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest,
        }) => ("ended-proven", Some(termination_evidence_digest.as_hex())),
    }
}
pub(super) fn leased_value(job: &LeasedJob) -> Value {
    json!({"lease":{"job":job.lease.job_id.0,"fence":job.lease.fence.to_string(),"expires":job.lease.expires_at.to_string(),"owner":job.lease.owner_id,"deployment":job.lease.physical_identity.deployment_id,"physical":job.lease.physical_identity.physical_database_id,"configuration":job.lease.physical_identity.configuration_digest.as_hex()},"request":request_value(&job.request),"attempt":job.attempt,"scope":scope_value(&job.canonical_scope),"pending":{"required":job.pending_byte_liability.required,"reserved":job.pending_byte_liability.reserved_bytes.map(|n|n.to_string())}})
}
pub(super) fn config_value(c: &QueueConfig) -> Value {
    let r = &c.registration;
    let p = &c.admission_profile;
    let qualification = match &p.qualification {
        ProfileQualification::OfflineEngineeringFixture => json!({"kind":"offline"}),
        ProfileQualification::QualifiedDeployment { evidence_digest } => {
            json!({"kind":"qualified","digest":evidence_digest.as_hex()})
        }
    };
    json!({"lease":c.lease_duration_ms.to_string(),"retry":{"maxAttempts":c.retry.max_attempts,"initial":c.retry.initial_delay_ms.to_string(),"max":c.retry.max_delay_ms.to_string()},"identity":{"deployment":r.identity.deployment_id,"physical":r.identity.physical_database_id,"digest":r.identity.configuration_digest.as_hex()},"owner":r.dispatcher_owner_id,"aliases":r.aliases.iter().map(|a|json!({"workspace":a.partition.workspace_id,"home":a.partition.home_id,"source":a.partition.source_instance_id,"collection":a.partition.collection_id,"canonical":a.canonical_collection_id})).collect::<Vec<_>>(),"profile":{"version":p.profile_version,"qualification":qualification,"waiting":p.max_waiting_intents,"waitMs":p.max_admission_wait_ms.to_string(),"attempts":p.max_unresolved_storage_attempts,"bytes":p.max_unresolved_storage_bytes.to_string()}})
}
pub(super) fn leased(v: &Value) -> Result<LeasedJob> {
    let l = v.get("lease").ok_or_else(bad)?;
    let identity = PhysicalQueueIdentity {
        deployment_id: string(l, "deployment")?,
        physical_database_id: string(l, "physical")?,
        configuration_digest: digest(string(l, "configuration")?)?,
    };
    let request = request(v.get("request").ok_or_else(bad)?)?;
    let scope = scope(v.get("scope").ok_or_else(bad)?)?;
    let pending = v.get("pending").ok_or_else(bad)?;
    let pending_byte_liability = PendingByteLiability {
        required: bool_field(pending, "required")?,
        reserved_bytes: optional_uint(pending, "reserved")?,
    };
    let attempt = v
        .get("attempt")
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(bad)?;
    let job = LeasedJob {
        lease: Lease {
            job_id: JobId(string(l, "job")?),
            fence: uint(l, "fence")?,
            expires_at: uint(l, "expires")?,
            owner_id: string(l, "owner")?,
            physical_identity: identity,
        },
        request,
        attempt,
        canonical_scope: scope,
        pending_byte_liability,
    };
    if job.pending_byte_liability != job.request.pending_byte_liability {
        return Err(bad());
    }
    Ok(job)
}

pub(super) fn report_value(report: &FinishReport) -> Value {
    let disposition = match &report.disposition {
        FinishDisposition::Succeeded(a) => json!({"kind":"succeeded","applied":applied_value(a)}),
        FinishDisposition::Failed(r) => json!({"kind":"failed","reason":format!("{r:?}")}),
        FinishDisposition::RetryAt { at, reason } => {
            json!({"kind":"retry","at":at.to_string(),"reason":format!("{reason:?}")})
        }
        FinishDisposition::Hold(r) => json!({"kind":"held","reason":format!("{r:?}")}),
        FinishDisposition::Partial(r) => json!({"kind":"partial","reason":format!("{r:?}")}),
    };
    let (state, termination) = activity_parts(&report.remote_activity);
    json!({"disposition":disposition,"activity":{"state":state,"termination":termination},
        "liability":liability_value(&report.storage_liability)})
}
pub(super) fn report(v: &Value) -> Result<FinishReport> {
    let d = &v["disposition"];
    let disposition = match str_field(d, "kind")? {
        "succeeded" => FinishDisposition::Succeeded(applied(&d["applied"])?),
        "failed" => FinishDisposition::Failed(failure(str_field(d, "reason")?)?),
        "retry" => FinishDisposition::RetryAt {
            at: uint(d, "at")?,
            reason: failure(str_field(d, "reason")?)?,
        },
        "held" => FinishDisposition::Hold(failure(str_field(d, "reason")?)?),
        "partial" => FinishDisposition::Partial(failure(str_field(d, "reason")?)?),
        _ => return Err(bad()),
    };
    let a = &v["activity"];
    Ok(FinishReport {
        disposition,
        remote_activity: activity(str_field(a, "state")?, optional_string(a, "termination")?)?,
        storage_liability: liability(&v["liability"])?,
    })
}
