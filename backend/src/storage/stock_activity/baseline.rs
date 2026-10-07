use super::*;

pub(super) fn fresh(
    command: &StockCommand,
    authority: &StockAuthority,
    id: Uuid,
    now: &str,
    waiting: bool,
) -> StoredOperation {
    StoredOperation {
        actor_id: authority.actor_id,
        captured_authority: authority.clone(),
        operation_id: id,
        activity_version: 1,
        command: command.clone(),
        plan: None,
        actual_target: None,
        generated_members: vec![],
        outcome: StockOutcome {
            schema_version: 3,
            command_id: command.command_id.clone(),
            request_id: command.request_id,
            operation_id: id,
            resolved_scope: command.context.clone(),
            request_digest: command.request_digest.clone(),
            causality_proven: false,
            atomic_provider_cas: false,
            native_editor_race_possible: true,
            known_effects: vec![],
            observed_at: now.into(),
            response_digest: None,
            readback_digest: None,
            generated_identity_resolved: false,
            unknown_scope_fence_retained: false,
            remote_activity: RemoteActivity::not_dispatched(),
            storage_liability: StorageLiability {
                accounting_complete: true,
                metadata_commit_evidence: MetadataEvidence::NotDispatched,
                byte_disposition: ByteDisposition::None,
                reference_closure_evidence: ReferenceClosure::Unassessed,
                orphan_candidate_id: None,
                unresolved_attempts: 0,
                known_bytes: 0,
                reserved_bytes: Some(0),
            },
            state: if waiting {
                OutcomeState::Queued
            } else {
                OutcomeState::Prepared
            },
            verification: Verification::Unresolved,
            response_success: false,
            readback_agrees: false,
            resolution_evidence_digest: None,
            resolution_actor_id: None,
        },
    }
}
