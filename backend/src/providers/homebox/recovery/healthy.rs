//! Scoped healthy compositions: /1 uses typed frames; /2 also uses actual
//! SQLite claim/journal/capture/validation. No dispatch, recovered execution,
//! provider/account, sockets, replay or stopped controls.
use super::{codec::*, *};
use crate::{
    domain::{
        queue_recovery::*,
        stock::{NativeStockContract, ValidatedRequest},
    },
    jobs as j,
    providers::homebox::write::stock as w,
    storage::{self, QueueRecoveryEvidence},
};
use serde_json::{Value, json};
use uuid::Uuid;
use w::StockContractPort;
fn id(n: u128) -> Uuid {
    Uuid::from_u128(0x00000000_0000_4000_8000_000000000000 | n)
}
fn hash(n: u8) -> w::Digest {
    w::Digest::parse(format!("{n:02x}").repeat(32)).unwrap()
}
const AT: &str = "2026-10-07T09:00:00Z";
struct SyntheticOwners {
    config: j::QueueConfig,
    job: j::LeasedJob,
    wire: Value,
    liabilities: Vec<(String, j::StorageLiability)>,
}
struct OriginalProof;
impl RecoveryDiscoveryAuthority for SyntheticOwners {
    type Grant = ();
    fn revalidate(
        &self,
        _: &(),
        registry: &[j::QueueConfig],
        registration: &j::QueueRegistration,
    ) -> storage::Result<()> {
        assert_eq!(registry, std::slice::from_ref(&self.config));
        assert_eq!(registration, &self.config.registration);
        Ok(())
    }
}
impl OriginalEnqueueOwner for SyntheticOwners {
    type Proof = OriginalProof;
    fn retained_enqueue(
        &self,
        registration: &j::QueueRegistration,
        receipt: &j::ReceiptKey,
        original: &ValidatedRequest,
    ) -> storage::Result<OriginalEnqueue<OriginalProof>> {
        assert_eq!(registration, &self.config.registration);
        assert_eq!(receipt, &self.job.request.receipt);
        assert_eq!(original.raw(), &self.wire);
        Ok(OriginalEnqueue {
            physical_identity: registration.identity.clone(),
            original: ValidatedRequest::parse(
                &NativeStockContract::new().unwrap(),
                self.wire.clone(),
            )
            .unwrap(),
            expected: self.job.request.clone(),
            proof: OriginalProof,
        })
    }
    fn retained_attempt(
        &self,
        registration: &j::QueueRegistration,
        _: &OriginalProof,
        job: &j::JobId,
        fence: u64,
        attempt: u32,
    ) -> storage::Result<j::LeasedJob> {
        assert_eq!(registration, &self.config.registration);
        assert_eq!(job, &self.job.lease.job_id);
        assert_eq!(fence, self.job.lease.fence);
        assert_eq!(attempt, self.job.attempt);
        Ok(self.job.clone())
    }
}
impl QueuedMediaRecovery<OriginalProof> for SyntheticOwners {
    fn validate_original(&self, frame: &RetainedEnqueue<'_, OriginalProof>) -> storage::Result<()> {
        assert_eq!(frame.original.raw(), &self.wire);
        assert_eq!(frame.request, &self.job.request);
        assert!(!frame.request.pending_byte_liability.required);
        Ok(())
    }
    fn validate_attempt(&self, frame: &RetainedAttempt<'_, OriginalProof>) -> storage::Result<()> {
        assert_eq!(frame.job, &self.job);
        assert_eq!(frame.liabilities, self.liabilities);
        assert_eq!(
            frame.prepared.unwrap().prepared_media_evidence,
            b"synthetic-owner-positive-zero-media/1"
        );
        Ok(())
    }
    fn validate_outcome(
        &self,
        frame: &RetainedOutcome<'_, '_, OriginalProof>,
    ) -> storage::Result<()> {
        assert_eq!(frame.outcome.liabilities, self.liabilities);
        assert_eq!(
            frame.outcome.report.storage_liability,
            self.liabilities.last().unwrap().1
        );
        Ok(())
    }
}
#[test]
fn healthy_retained_writer_composition() {
    composition(false);
}

#[test]
fn healthy_retained_writer_v2_storage_prepared() {
    composition(true);
}

fn composition(version_two: bool) {
    let contracts = NativeWriterContracts::new().unwrap();
    let wire = json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set","requestId":id(11),
        "context":{"workspaceId":id(1),"homeId":id(2)},"target":{"authority":"homebox","sourceInstanceId":id(3),"collectionId":id(4),"resourceKind":"entity","resourceId":id(5)},
        "payload":{"quantity":0},"idempotencyKey":id(12),"reason":"Fresh healthy retained native evidence",
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":id(13)},"atlasGuards":[]},"approvalReceiptId":null});
    let command = contracts.validate_request(&wire).unwrap();
    let native_before = json!({
        "id":id(5),"assetId":"","name":"Synthetic retained entity","description":"",
        "manufacturer":"","modelNumber":"","serialNumber":"","notes":"","purchaseFrom":"",
        "soldTo":"","soldNotes":"","warrantyDetails":"","purchaseDate":"2026-01-01",
        "soldDate":"2026-01-02","warrantyExpires":"2027-01-01","quantity":1,
        "purchasePrice":0,"soldPrice":0,"archived":false,"insured":false,"lifetimeWarranty":false,
        "syncChildEntityLocations":false,"parent":null,"tags":[],"fields":[],"attachments":[]
    });
    let preparation = w::Preparation {
        snapshots: vec![w::NativeSnapshot {
            target: command.target.clone(),
            value: native_before.clone(),
            digest: contracts.digest_native(&native_before).unwrap(),
            complete: true,
            hidden_fields_preserved: true,
        }],
        ..w::Preparation::default()
    };
    let plan = w::map_stock(&command, &preparation).unwrap();
    let plan_digest = contracts
        .digest_native(&serde_json::to_value(&plan).unwrap())
        .unwrap();
    let physical = w::PhysicalBinding {
        deployment_id: id(7),
        physical_database_id: id(8),
        configuration_digest: hash(1),
    };
    let authority = w::StockAuthority {
        actor_id: id(6),
        source_epoch: 1,
        authority_digest: hash(2),
        physical_binding: physical.clone(),
        qualification: w::NativeQualification::SyntheticFixture,
    };
    let pending = j::PendingByteLiability {
        required: false,
        reserved_bytes: Some(0),
    };
    let partition = j::SourcePartition {
        workspace_id: id(1).to_string(),
        home_id: id(2).to_string(),
        source_instance_id: id(3).to_string(),
        collection_id: id(4).to_string(),
    };
    let scope = j::WriteScope {
        source_instance_id: id(3).to_string(),
        collection_id: id(4).to_string(),
        selection: j::ScopeSelection::Resources(vec![j::ResourceRef {
            kind: j::ResourceKind::Entity,
            id: id(5).to_string(),
        }]),
    };
    let request = j::EnqueueRequest {
        receipt: j::ReceiptKey {
            workspace_id: id(1).to_string(),
            home_id: id(2).to_string(),
            actor_id: id(6).to_string(),
            mutation_id: id(12).to_string(),
        },
        partition: partition.clone(),
        intent: j::IntentMetadata {
            contract_id: w::CONTRACT_VERSION.into(),
            operation_id: command.command_id.clone(),
            target_external_id: Some(id(5).to_string()),
            request_digest: digest(&command.request_digest).unwrap(),
        },
        write_scope: scope,
        pending_byte_liability: pending,
    };
    let config = j::QueueConfig {
        registration: j::QueueRegistration {
            identity: j::PhysicalQueueIdentity {
                deployment_id: id(7).to_string(),
                physical_database_id: id(8).to_string(),
                configuration_digest: digest(&physical.configuration_digest).unwrap(),
            },
            dispatcher_owner_id: id(9).to_string(),
            aliases: vec![j::SourceAlias {
                partition,
                canonical_collection_id: id(4).to_string(),
            }],
        },
        admission_profile: j::AdmissionProfile::stock_engineering_fixture(),
        lease_duration_ms: 10_000,
        retry: j::RetryPolicy {
            max_attempts: 1,
            initial_delay_ms: 1_000,
            max_delay_ms: 1_000,
        },
    };
    let job = j::LeasedJob {
        lease: j::Lease {
            job_id: j::JobId(id(10).to_string()),
            fence: 1,
            expires_at: 1_800_000_010_000,
            owner_id: id(9).to_string(),
            physical_identity: config.registration.identity.clone(),
        },
        request,
        attempt: 1,
        canonical_scope: j::CanonicalScope {
            collection_id: id(4).to_string(),
            selection: j::ScopeSelection::Resources(vec![j::ResourceRef {
                kind: j::ResourceKind::Entity,
                id: id(5).to_string(),
            }]),
        },
        pending_byte_liability: pending,
    };
    let mut storage = version_two
        .then(|| super::healthy_v2_support::ClaimedStorage::fresh(&config, &job.request, &wire));
    let job = storage
        .as_ref()
        .map(|storage| storage.job.clone())
        .unwrap_or(job);
    let native_liability = w::StorageLiability {
        accounting_complete: true,
        metadata_commit_evidence: w::MetadataEvidence::NotDispatched,
        byte_disposition: w::ByteDisposition::None,
        reference_closure_evidence: w::ReferenceClosure::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 0,
        known_bytes: 0,
        reserved_bytes: Some(0),
    };
    let admitted = w::StoredOperation {
        actor_id: id(6),
        captured_authority: authority,
        operation_id: id(10),
        activity_version: 2,
        command: command.clone(),
        plan: Some(plan.clone()),
        actual_target: None,
        generated_members: vec![],
        outcome: w::StockOutcome {
            schema_version: 3,
            command_id: command.command_id.clone(),
            request_id: command.request_id,
            operation_id: id(10),
            resolved_scope: command.context.clone(),
            request_digest: command.request_digest.clone(),
            causality_proven: false,
            atomic_provider_cas: false,
            native_editor_race_possible: true,
            known_effects: vec![],
            observed_at: AT.into(),
            response_digest: None,
            readback_digest: None,
            generated_identity_resolved: false,
            unknown_scope_fence_retained: true,
            remote_activity: w::RemoteActivity::end_unproven(),
            storage_liability: native_liability.clone(),
            state: w::OutcomeState::Dispatching,
            verification: w::Verification::Unresolved,
            response_success: false,
            readback_agrees: false,
            resolution_evidence_digest: None,
            resolution_actor_id: None,
        },
    };
    let permit = w::InvocationPermit {
        operation_id: id(10),
        actor_id: id(6),
        physical_binding: physical,
        owner_id: id(9),
        dispatcher_epoch: 1,
        source_epoch: 1,
        plan_digest: plan_digest.clone(),
        qualification: w::NativeQualification::SyntheticFixture,
    };
    let preflight = w::StockPreflight {
        preparation,
        provider_observation: command.provider_observation,
        request_digest: command.request_digest.clone(),
        source_epoch: 1,
        preflight_digest: hash(3),
    };
    let mut record = if version_two {
        let retained_binding = RetainedWriterJobBinding::retain(&job, &admitted, &permit).unwrap();
        assert_eq!(retained_binding.writer_operation_id(), id(10));
        assert_eq!(retained_binding.job(), &job);
        assert_ne!(job.lease.job_id.0, id(10).to_string());
        RetainedWriterAttempt::from_prepared_v2(
            &contracts,
            config.clone(),
            retained_binding,
            admitted,
            preflight,
            permit,
            b"synthetic-owner-positive-zero-media/1".to_vec(),
        )
    } else {
        RetainedWriterAttempt::from_prepared(
            &contracts,
            config.clone(),
            job.clone(),
            admitted,
            preflight,
            permit,
            b"synthetic-owner-positive-zero-media/1".to_vec(),
        )
    }
    .unwrap();
    if let Some(storage) = &mut storage {
        storage.journal(record.prepared());
        let mut archive = RetainedWriterArchive::new(vec![record]).unwrap();
        {
            let owners = SyntheticOwners {
                config: config.clone(),
                job: job.clone(),
                wire: wire.clone(),
                liabilities: vec![(
                    "journal".into(),
                    archive.attempts[0].prepared().storage_liability.clone(),
                )],
            };
            let schemas = NativeStockContract::new().unwrap();
            let discovery = NativeQueueDiscovery::new(
                std::slice::from_ref(&config),
                QueueRecoveryBindings {
                    stock_contract_id: w::CONTRACT_VERSION,
                    contracts: &schemas,
                    authority: &owners,
                    grant: &(),
                    original_owner: &owners,
                    media: &owners,
                },
            )
            .unwrap();
            let native = HomeboxRetainedEvidence::new_v2(&contracts, &archive);
            let evidence = NativeQueueRecoveryEvidence::new(&discovery, &native);
            let peers = storage::RecoveryValidationPeers {
                stock: &schemas,
                queues: discovery.registry().configs(),
                discovery: &discovery,
                evidence: &evidence,
            };
            storage.validate_prepared_image(&peers);
            let packet: PreparedPacket =
                decode(&archive.attempts[0].prepared().native_payload).unwrap();
            assert_eq!(packet.format, NATIVE_CODEC_V2);
            assert_eq!(
                packet.writer_job_binding.as_ref().unwrap()["job"]["jobId"],
                job.lease.job_id.0
            );
            assert_eq!(
                packet.writer_job_binding.as_ref().unwrap()["writerOperationId"],
                id(10).to_string()
            );
        }
        // Continue the independently retained in-process producer record after
        // its prepared cut was validated. No record is decoded from the image.
        record = archive.attempts.pop().unwrap();
    }
    let mut readback = native_before;
    readback["quantity"] = json!(0);
    let observed_digest = contracts.digest_native(&readback).unwrap();
    let receipt = w::DispatchReceipt {
        operation_id: id(10),
        plan_digest,
        context: command.context.clone(),
        source_instance_id: id(3),
        collection_id: id(4),
        response: Some(w::NativeResponse {
            status: 200,
            value: readback.clone(),
            body_digest: observed_digest.clone(),
        }),
        remote_activity: w::RemoteActivity::end_unproven(),
    };
    record
        .record_response_readback(
            &contracts,
            receipt.clone(),
            w::NativeObservation::Present {
                context: command.context.clone(),
                target: command.target.clone(),
                value: readback,
                observed_at: AT.into(),
                complete: true,
                impact: None,
            },
        )
        .unwrap();
    let at = crate::contracts::semantics::timestamp_millis(AT).unwrap() as u64;
    let storage_liability = liability(&native_liability).unwrap();
    let report = j::FinishReport {
        disposition: j::FinishDisposition::Succeeded(j::AppliedWrite {
            external_id: Some(id(5).to_string()),
            source_updated_at: None,
            observation: j::ObservedWriteEvidence {
                response_digest: digest(&observed_digest).unwrap(),
                readback_digest: digest(&observed_digest).unwrap(),
                observed_at: at,
            },
        }),
        remote_activity: j::RemoteActivity::Invoked(j::InvokedRemoteActivity::EndUnproven),
        storage_liability: storage_liability.clone(),
    };
    let liabilities = vec![
        ("journal".to_owned(), storage_liability.clone()),
        ("finish".to_owned(), storage_liability),
    ];
    record
        .record_finish(&contracts, at, report.clone(), liabilities.clone())
        .unwrap();
    let outcome_step_count = record.steps().len();
    let mut ended = receipt;
    ended.remote_activity = w::RemoteActivity::EndedProven {
        termination_evidence_digest: hash(4),
    };
    record.record_remote_end(&contracts, ended).unwrap();
    assert_eq!(record.steps().len(), 2);
    let prepared = record.prepared().clone();
    let steps = record.steps().to_vec();
    let archive = RetainedWriterArchive::new(vec![record]).unwrap();
    let native = if version_two {
        HomeboxRetainedEvidence::new_v2(&contracts, &archive)
    } else {
        HomeboxRetainedEvidence::new(&contracts, &archive)
    };
    let owners = SyntheticOwners {
        config: config.clone(),
        job: job.clone(),
        wire: wire.clone(),
        liabilities: liabilities.clone(),
    };
    let schemas = NativeStockContract::new().unwrap();
    let original = ValidatedRequest::parse(&schemas, wire).unwrap();
    let discovery = NativeQueueDiscovery::new(
        std::slice::from_ref(&config),
        QueueRecoveryBindings {
            stock_contract_id: w::CONTRACT_VERSION,
            contracts: &schemas,
            authority: &owners,
            grant: &(),
            original_owner: &owners,
            media: &owners,
        },
    )
    .unwrap();
    let evidence = NativeQueueRecoveryEvidence::new(&discovery, &native);
    let journal = storage::JournalEvidenceView {
        native_codec: if version_two {
            NATIVE_CODEC_V2
        } else {
            NATIVE_CODEC
        }
        .into(),
        native_payload_digest: j::Digest::from_hex(raw_digest(&prepared.native_payload)).unwrap(),
        prepared_media_digest: j::Digest::from_hex(raw_digest(&prepared.prepared_media_evidence))
            .unwrap(),
        prepared_liability: prepared.storage_liability.clone(),
        journal_evidence_digest: digest(&hash(5)).unwrap(),
    };
    let outcomes = [storage::QueueRecoveryOutcome {
        at,
        kind: "finish",
        report: &report,
        reconciliation: None,
        steps: &steps[..outcome_step_count],
        liabilities: &liabilities,
    }];
    evidence
        .validate_attempt(
            &config,
            storage::QueueRecoveryAttempt {
                original: &original,
                job: &job,
                prepared: Some(&prepared),
                journal: Some(&journal),
                steps: &steps,
                liabilities: &liabilities,
                outcomes: &outcomes,
            },
        )
        .unwrap();
    assert_eq!(
        outcomes[0].report.remote_activity,
        j::RemoteActivity::Invoked(j::InvokedRemoteActivity::EndUnproven)
    );
    assert_eq!(steps[1].kind, storage::StepKind::RemoteEnd);
    if version_two {
        assert_eq!(prepared.codec, NATIVE_CODEC_V2);
        assert_eq!(steps[0].codec, READBACK_CODEC_V2);
        assert_eq!(steps[1].codec, REMOTE_END_CODEC_V2);
        eprintln!(
            "/2: actual q+SHA256 claim/journal/prepared image validation; existing writer UUID preserved; no dispatch"
        );
    }
    eprintln!(
        "fresh native schema/reducer/retention composition: exact prepared packet, readback finish at prefix1, later end at prefix2; no execution"
    );
}
