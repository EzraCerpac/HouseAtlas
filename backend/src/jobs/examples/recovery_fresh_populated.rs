//! Fresh synthetic queue admission/claim/journal and full-image validation.
//! No transport, dispatch, reopen, replay, reconciliation or held controls.
//! Exact schema/storage/media/host source compiles in the external harness;
//! the independent authority/provenance/no-media/native owners here are FIXTURES.
#[path = "recovery_fresh_support.rs"]
mod support;

use houseatlas_at36_stock_harness::{
    domain::{native_semantics::NativeSemantics, queue_recovery::*, stock::*},
    jobs::{SourcePartition, *},
    storage::*,
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
};
use support::*;

fn original_wire() -> Value {
    json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set",
        "requestId":id(115),"context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(3),
            "collectionId":id(4),"resourceKind":"entity","resourceId":id(5)},
        "payload":{"quantity":0},"idempotencyKey":id(215),
        "reason":"Synthetic zero quantity","approvalReceiptId":null,
        "preconditions":{"providerObservation":{"kind":"provider-observation",
            "handle":id(16)},"atlasGuards":[]}})
}

fn main() -> CheckResult<()> {
    let output = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("NEW output directory required")?,
    );
    fs::create_dir(&output)?;
    let stock = NativeStockContract::new()?;
    let original = ValidatedRequest::parse(&stock, original_wire())?;
    let request = EnqueueRequest {
        receipt: ReceiptKey {
            workspace_id: id(1),
            home_id: id(2),
            actor_id: id(50),
            mutation_id: id(215),
        },
        partition: SourcePartition {
            workspace_id: id(1),
            home_id: id(2),
            source_instance_id: id(3),
            collection_id: id(4),
        },
        intent: IntentMetadata {
            contract_id: FIXTURE_PROFILE.into(),
            operation_id: original.id().as_str().into(),
            target_external_id: Some(id(5)),
            request_digest: digest(original.intent_digest())?,
        },
        write_scope: WriteScope {
            source_instance_id: id(3),
            collection_id: id(4),
            selection: ScopeSelection::Resources(vec![ResourceRef {
                kind: ResourceKind::Entity,
                id: id(5),
            }]),
        },
        pending_byte_liability: PendingByteLiability {
            required: false,
            reserved_bytes: None,
        },
    };
    let primary = config("fixture-physical", request.partition.clone());
    let empty = config(
        "fixture-empty",
        SourcePartition {
            source_instance_id: id(7),
            collection_id: id(8),
            ..request.partition.clone()
        },
    );
    let registry = vec![primary.clone(), empty.clone()];
    let scope = primary
        .registration
        .resolve(&request.partition, &request.write_scope)
        .map_err(|e| format!("{e:?}"))?;
    let actor = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let owner = FixtureOwner {
        original,
        request,
        primary: primary.clone(),
        admitted: RefCell::new(None),
        journal: RefCell::new(None),
        original_checks: Cell::new(0),
        attempt_checks: Cell::new(0),
        native_checks: Cell::new(0),
    };
    let grant = FixtureRecoveryGrant::issue(&registry);
    let recovery_authority = FixtureRecoveryAuthority {
        issued: &grant,
        checks: Cell::new(0),
    };
    let discovery = NativeQueueDiscovery::new(
        &registry,
        QueueRecoveryBindings {
            stock_contract_id: FIXTURE_PROFILE,
            contracts: &stock,
            authority: &recovery_authority,
            grant: &grant,
            original_owner: &owner,
            media: &owner,
        },
    )?;
    let evidence = NativeQueueRecoveryEvidence::new(&discovery, &owner);
    // Real PR34 constructor accepts these concrete storage trait implementations.
    let _host_peers = houseatlas_at36_stock_harness::config::recovery::RecoveryPeers::new(
        &registry, &discovery, &evidence,
    )?;
    let peers = RecoveryValidationPeers {
        stock: &stock,
        queues: discovery.registry().configs(),
        discovery: &discovery,
        evidence: &evidence,
    };
    let native = NativeContract::new(NativeSemantics::native());
    let mut store = AtlasStore::open(
        output.join("source.sqlite"),
        native,
        FixtureStoreAuthority,
        FixtureRuntime::new(),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )?;
    let snapshot: Snapshot = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    store.initialize_synthetic(&snapshot)?;
    let live = FixtureLiveAuthority {
        owner: &owner,
        registry: &registry,
    };
    let witness = FixtureLiveWitness {
        original_digest: owner.original.intent_digest().to_owned(),
    };
    // Register the second empty queue explicitly; the validator must retain it.
    {
        let _session = store.queue_session(
            empty,
            QueueSessionBinding {
                receipt: &owner.request.receipt,
                original: &owner.original,
                principal: &actor,
                witness: &witness,
            },
            &live,
            QueueEvidenceInbox::default(),
        )?;
    }
    {
        let mut session = store.queue_session(
            primary.clone(),
            QueueSessionBinding {
                receipt: &owner.request.receipt,
                original: &owner.original,
                principal: &actor,
                witness: &witness,
            },
            &live,
            QueueEvidenceInbox::default(),
        )?;
        assert!(matches!(
            session.enqueue(&owner.request, &scope, &primary, 1_000)?,
            EnqueueOutcome::Enqueued(_)
        ));
        let ClaimOutcome::Claimed(job) = session.claim_next(1_001, &primary)? else {
            return Err("Expected fresh claim".into());
        };
        *owner.admitted.borrow_mut() = Some(job);
    }
    let claimed =
        store.backup_recovery_to_with_peers(&output.join("claimed.sqlite"), &peers, &mut || {
            Ok(())
        })?;
    let validated_claim = store.validate_recovery_image_with_peers(
        &output.join("claimed.sqlite"),
        &peers,
        &mut || Ok(()),
    )?;
    assert_eq!(claimed, validated_claim);
    let job = owner
        .admitted
        .borrow()
        .as_ref()
        .ok_or("Retained fresh job required")?
        .clone();
    {
        let mut session = store.queue_session(
            primary,
            QueueSessionBinding {
                receipt: &owner.request.receipt,
                original: &owner.original,
                principal: &actor,
                witness: &witness,
            },
            &live,
            QueueEvidenceInbox::default(),
        )?;
        let receipt = session.commit_native(&job, &fixture_prepared())?;
        *owner.journal.borrow_mut() = Some(receipt);
    }
    let journaled = store.backup_recovery_to_with_peers(
        &output.join("journaled.sqlite"),
        &peers,
        &mut || Ok(()),
    )?;
    let validated_journal = store.validate_recovery_image_with_peers(
        &output.join("journaled.sqlite"),
        &peers,
        &mut || Ok(()),
    )?;
    assert_eq!(journaled, validated_journal);
    assert!(
        owner.original_checks.get() > 0
            && owner.attempt_checks.get() > 0
            && owner.native_checks.get() > 0
    );
    assert!(recovery_authority.checks.get() > 0);
    fs::write(
        output.join("result.json"),
        serde_json::to_vec_pretty(&json!({
            "fixtureOnly":true,"registryEntries":registry.len(),"emptyRegistrations":1,
            "originalChecks":owner.original_checks.get(),"attemptChecks":owner.attempt_checks.get(),
            "nativePreparedChecks":owner.native_checks.get(),"recoveryAuthorityChecks":recovery_authority.checks.get(),
            "claimedImageIdentityPreserved":true,"journaledImageIdentityPreserved":true,
            "dispatches":0,"providerCalls":0,"reopens":0,"replays":0,"heldControls":0,
            "qualifiedProductionRecoveryOwners":false
        }))?,
    )?;
    println!(
        "fresh populated claimed and journaled images validated; two trusted registrations; no dispatch"
    );
    Ok(())
}
