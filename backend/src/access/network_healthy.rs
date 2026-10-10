//! Positive access-owned Network disclosure checkpoint. The disposable record
//! reader is a synthetic peer, not the Network generation validator or AT07 Store.

use rusqlite::{Connection, params};
use serde_json::json;

use super::*;

#[test]
fn healthy_network_disclosure_checkpoint() {
    let id = |n: u32| CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap();
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let origin = "https://atlas.synthetic.invalid";
    let password = "Synthetic-test-password-only!";
    let config = AccessConfig::new(vec![origin.into()])
        .unwrap()
        .with_clock(|| 1_800_000_000_000);
    let mut access = AccessBoundary::in_memory(config).unwrap();
    access
        .provision_user(
            &id(4),
            &id(5),
            "synthetic-viewer",
            &hash_password(password).unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&id(4), &scope, Role::Viewer, true)
        .unwrap();
    let registration = SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(8),
        collection_id: "synthetic-network".into(),
        owner: SourceOwner::Network,
        partition_mode: PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![
            "device-a".into(),
            "interface-a".into(),
            "segment-a".into(),
            "row-a".into(),
        ],
    };
    access.put_source(&registration, None).unwrap();
    let mut request = RequestEvidence {
        method: Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(origin),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie: None,
        csrf: None,
        authorization: None,
    };
    let login =
        serde_json::to_vec(&json!({"username": "synthetic-viewer", "password": password})).unwrap();
    let session = access
        .login(&request, &login, "synthetic-loopback")
        .unwrap();
    request.method = Method::Get;
    request.cookie = Some(session.set_cookie().split(';').next().unwrap());
    let principal = access.authorize(&request, &scope, Action::Read).unwrap();
    let partition_grant = access
        .authorize_source_partition(&principal, &registration.partition())
        .unwrap();
    let member = |kind, external_id: &str| SourceRef {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
        key: SourceKey {
            source_instance_id: registration.source_instance_id.clone(),
            collection_id: registration.collection_id.clone(),
            source_kind: kind,
            external_id: external_id.into(),
        },
    };
    let device = member(SourceKind::NetworkDevice, "device-a");
    let interface = member(SourceKind::NetworkInterface, "interface-a");
    let segment = member(SourceKind::NetworkSegment, "segment-a");
    let device_grant = access.authorize_source(&principal, &device).unwrap();
    let interface_grant = access.authorize_source(&principal, &interface).unwrap();
    let segment_grant = access.authorize_source(&principal, &segment).unwrap();

    // Keep raw endpoints even if a consumer later projects/reorders a relation.
    let link = NetworkLinkRef::new(
        registration.partition(),
        "row-a",
        segment.clone(),
        device.clone(),
    )
    .unwrap();
    let link_grant = access
        .authorize_network_link(&principal, &link, &segment_grant, &device_grant)
        .unwrap();
    // The observation has its own namespace and retains BOTH declared members.
    let observation = NetworkObservationRef::new(
        registration.partition(),
        "row-a",
        "collector-a",
        Some(device.clone()),
        Some(interface.clone()),
    )
    .unwrap();
    let observation_grant = access
        .authorize_network_observation(
            &principal,
            &observation,
            Some(&device_grant),
            Some(&interface_grant),
        )
        .unwrap();
    // Capture the trusted typed member set before any consumer seals capture.
    // Moving these handles preserves their original private provenance.
    let member_grants = [device_grant, interface_grant, segment_grant];
    assert_eq!(link_grant.reference(), &link);
    assert_eq!(observation_grant.reference(), &observation);
    assert_eq!(observation_grant.reference().collector_id(), "collector-a");
    assert_eq!(link_grant.reference().from(), &segment);
    assert_eq!(link_grant.reference().to(), &device);
    assert_eq!(observation_grant.reference().device(), Some(&device));
    assert_eq!(observation_grant.reference().interface(), Some(&interface));
    assert!(std::ptr::eq(
        access.revalidate_network_link(&link_grant).unwrap(),
        &link_grant
    ));
    assert!(std::ptr::eq(
        access
            .revalidate_network_observation(&observation_grant)
            .unwrap(),
        &observation_grant
    ));

    let records = Connection::open_in_memory().unwrap();
    records.execute_batch("CREATE TABLE synthetic_disclosure(link_id TEXT NOT NULL, observation_id TEXT NOT NULL)").unwrap();
    records
        .execute(
            "INSERT INTO synthetic_disclosure VALUES(?1,?2)",
            params![link.external_id(), observation.external_id()],
        )
        .unwrap();
    let mut released = None;
    access
        .with_source_read_authorization(
            &principal,
            &partition_grant,
            &member_grants,
            |guard| -> AccessResult<()> {
                assert!(std::ptr::eq(guard.principal(), &principal));
                assert!(std::ptr::eq(
                    guard.revalidate_source_partition(&partition_grant)?,
                    &partition_grant
                ));
                for member in &member_grants {
                    assert!(std::ptr::eq(guard.revalidate_source(member)?, member));
                }
                assert!(std::ptr::eq(
                    guard.revalidate_network_link(&link_grant)?,
                    &link_grant
                ));
                assert!(std::ptr::eq(
                    guard.revalidate_network_observation(&observation_grant)?,
                    &observation_grant
                ));
                let snapshot: (String, String) = records.query_row(
                    "SELECT link_id, observation_id FROM synthetic_disclosure",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                guard.revalidate_network_link(&link_grant)?;
                guard.revalidate_network_observation(&observation_grant)?;
                released = Some(snapshot);
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(released.unwrap(), ("row-a".into(), "row-a".into()));
    // Partition metadata remains readable without entity handles. This checks
    // only Access authority, not an empty Network generation or Store baseline.
    access
        .with_source_read_authorization(
            &principal,
            &partition_grant,
            &[],
            |guard| -> AccessResult<()> { guard.revalidate_source_read(&partition_grant, &[]) },
        )
        .unwrap();
    println!(
        "AT11 healthy Network disclosure: genuine viewer, original partition/member binding, original endpoints/both observation members, distinct row namespaces, fenced synthetic SQLite read and partition-only authority"
    );
}
