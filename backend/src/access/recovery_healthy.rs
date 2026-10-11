//! Disposable explicit-approval checkpoint; no reset/denial/race controls.

use crate::{
    domain::queue_recovery::RecoveryDiscoveryAuthority,
    jobs::{
        AdmissionProfile, Digest, PhysicalQueueIdentity, QueueConfig, QueueRegistration,
        RetryPolicy, SourceAlias, SourcePartition,
    },
};

use super::{OfflineRecoveryApproval, OfflineRecoveryAuthority, RecoveryDiscoveryGrant};

fn queue(index: u32) -> QueueConfig {
    QueueConfig {
        lease_duration_ms: 30_000,
        retry: RetryPolicy {
            max_attempts: 3,
            initial_delay_ms: 1000,
            max_delay_ms: 10_000,
        },
        registration: QueueRegistration {
            identity: PhysicalQueueIdentity {
                deployment_id: "synthetic-offline-recovery".into(),
                physical_database_id: format!("synthetic-physical-database-{index}"),
                configuration_digest: Digest::from_hex(format!("{index:064x}")).unwrap(),
            },
            dispatcher_owner_id: format!("synthetic-dispatcher-{index}"),
            aliases: vec![SourceAlias {
                partition: SourcePartition {
                    workspace_id: "10000000-0000-4000-8000-000000000001".into(),
                    home_id: "10000000-0000-4000-8000-000000000002".into(),
                    source_instance_id: format!("10000000-0000-4000-8000-{index:012}"),
                    collection_id: "synthetic-collection-😀".into(),
                },
                canonical_collection_id: format!("synthetic-physical-collection-{index}"),
            }],
        },
        admission_profile: AdmissionProfile::stock_engineering_fixture(),
    }
}

#[test]
fn healthy_explicit_offline_recovery_approval() {
    fn require_send_sync<T: Send + Sync>() {}
    require_send_sync::<OfflineRecoveryAuthority>();
    require_send_sync::<RecoveryDiscoveryGrant>();

    // Explicit synthetic approval only. These two disposable configurations
    // contain no queue rows/accounts/provider state or persisted access change.
    let registry = vec![queue(8), queue(9)];
    let approval =
        OfflineRecoveryApproval::discovery_validation("synthetic-offline-recovery", &registry)
            .unwrap();
    let authority = OfflineRecoveryAuthority::from_trusted_administrative_approval(approval);
    let grant = authority.capture_discovery(&registry).unwrap();
    let same_registry = registry.clone();
    for config in &same_registry {
        authority
            .revalidate_discovery(&grant, &same_registry, &config.registration)
            .unwrap();
        // Exercise the EXACT existing domain trait with the original opaque
        // grant. No AccessBoundary/session/DB is used or refreshed by this peer.
        RecoveryDiscoveryAuthority::revalidate(
            &authority,
            &grant,
            &same_registry,
            &config.registration,
        )
        .unwrap();
    }
}
