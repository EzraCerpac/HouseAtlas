//! Positive same-issuer host handoff only. No second issuer, reset, rejection,
//! contention, poison or concurrency control is exercised.

use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;

fn request(method: Method, cookie: Option<&str>) -> RequestEvidence<'_> {
    RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf: None,
        authorization: None,
    }
}

#[test]
fn healthy_shared_original_issuer_checkpoint() {
    fn shareable<T: Clone + Send + Sync>() {}
    shareable::<SharedAccess>();
    let id = |n: u32| CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap();
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let registration = SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(8),
        collection_id: "synthetic-shared-network".into(),
        owner: SourceOwner::Network,
        partition_mode: PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec!["device-a".into()],
    };
    let policy = LifecyclePolicy::from_trusted_configuration(vec![
        LifecycleRule::new(
            id(4),
            id(5),
            registration.clone(),
            LifecycleCapability::PublishCache,
            Action::Read,
        )
        .unwrap(),
    ]);
    let config = AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
        .unwrap()
        .with_clock(|| 1_800_000_000_000)
        .with_lifecycle_policy(policy);
    // The exact existing Core/MCP handle shape, before a provider bridge exists.
    let canonical = Arc::new(Mutex::new(AccessBoundary::in_memory(config).unwrap()));
    let password = "Synthetic-test-password-only!";
    let reference = SourceRef {
        workspace_id: id(1),
        home_id: id(2),
        key: SourceKey {
            source_instance_id: id(8),
            collection_id: registration.collection_id.clone(),
            source_kind: SourceKind::NetworkDevice,
            external_id: "device-a".into(),
        },
    };
    let (session, principal, partition, entity, publication, address) = {
        let mut core = canonical.try_lock().unwrap();
        core.provision_user(
            &id(4),
            &id(5),
            "synthetic-viewer",
            &hash_password(password).unwrap(),
            None,
        )
        .unwrap();
        core.set_membership(&id(4), &scope, Role::Viewer, true)
            .unwrap();
        core.put_source(&registration, None).unwrap();
        let body = serde_json::to_vec(&json!({"username":"synthetic-viewer","password":password}))
            .unwrap();
        let session = core
            .login(&request(Method::Post, None), &body, "synthetic-loopback")
            .unwrap();
        let principal = core
            .authorize(
                &request(
                    Method::Get,
                    Some(session.set_cookie().split(';').next().unwrap()),
                ),
                &scope,
                Action::Read,
            )
            .unwrap();
        let partition = core
            .authorize_source_partition(&principal, &registration.partition())
            .unwrap();
        let entity = core.authorize_source(&principal, &reference).unwrap();
        let publication = core
            .capture_lifecycle(&principal, &registration, LifecycleCapability::PublishCache)
            .unwrap();
        let address = std::ptr::from_ref(&*core);
        (session, principal, partition, entity, publication, address)
    };
    // Wrap/clone only AFTER Core issues the actual original authority handles.
    let shared = SharedAccess::from_existing(Arc::clone(&canonical));
    let network = shared.clone();
    assert!(Arc::ptr_eq(shared.as_existing(), &canonical));
    assert!(Arc::ptr_eq(network.as_existing(), &canonical));
    {
        let mut provider = network.try_lock().unwrap();
        assert_eq!(std::ptr::from_ref(&*provider), address);
        assert!(std::ptr::eq(
            provider.revalidate(&principal).unwrap(),
            &principal
        ));
        assert!(std::ptr::eq(
            provider.revalidate_source_partition(&partition).unwrap(),
            &partition
        ));
        assert!(std::ptr::eq(
            provider.revalidate_source(&entity).unwrap(),
            &entity
        ));
        assert!(std::ptr::eq(
            provider
                .revalidate_lifecycle(
                    &principal,
                    &publication,
                    &registration,
                    LifecycleCapability::PublishCache,
                )
                .unwrap(),
            &publication
        ));
        provider
            .with_read_authorization(&principal, |guard| -> AccessResult<()> {
                assert!(std::ptr::eq(guard.principal(), &principal));
                guard.revalidate_source_partition(&partition)?;
                guard.revalidate_source(&entity)?;
                guard.revalidate_lifecycle(
                    &publication,
                    &registration,
                    LifecycleCapability::PublishCache,
                )?;
                Ok(())
            })
            .unwrap();
    }
    // A separate shared host handle still reaches the same genuine session.
    let mut mcp = shared.try_lock().unwrap();
    assert_eq!(std::ptr::from_ref(&*mcp), address);
    assert_eq!(
        mcp.session_info(&request(
            Method::Get,
            Some(session.set_cookie().split(';').next().unwrap())
        ))
        .unwrap()
        .actor_id(),
        principal.actor_id()
    );
    assert!(std::ptr::eq(
        mcp.revalidate(&principal).unwrap(),
        &principal
    ));
    println!(
        "AT11 healthy shared issuer: existing Core Arc, cloned process-local bridge, original principal/source/lifecycle grants, exact held guard and session"
    );
}
