//! Healthy synthetic checkpoints only. No denial, failure, concurrency, replay
//! controls, provider, listener, or legacy aggregate is exercised here.

use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};

use rusqlite::{Connection, params};
use serde_json::{Value, json};

use super::*;

const ORIGIN: &str = "https://atlas.synthetic.invalid";
const PASSWORD: &str = "Synthetic-test-password-only!";
const NOW: i64 = 1_800_000_000_000;

// Exact identities and scope from packages/access/test/fixtures.mjs.
fn id(n: u32) -> CanonicalId {
    CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
}

fn scope() -> Scope {
    Scope {
        workspace_id: id(1),
        home_id: id(2),
    }
}

fn request<'a>(
    method: Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> RequestEvidence<'a> {
    RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf,
        authorization: None,
    }
}

fn setup() -> (AccessBoundary, Arc<AtomicI64>) {
    let clock = Arc::new(AtomicI64::new(NOW));
    let current = Arc::clone(&clock);
    let config = AccessConfig::new(vec![ORIGIN.to_owned()])
        .unwrap()
        .with_clock(move || current.load(Ordering::Relaxed));
    (provisioned_boundary(config), clock)
}

fn provisioned_boundary(config: AccessConfig) -> AccessBoundary {
    let mut boundary = AccessBoundary::in_memory(config).unwrap();
    let verifier = hash_password(PASSWORD).unwrap();
    boundary
        .provision_user(&id(4), &id(5), "synthetic-viewer", &verifier, None)
        .unwrap();
    boundary
        .provision_user(&id(6), &id(7), "synthetic-editor", &verifier, None)
        .unwrap();
    boundary
        .set_membership(&id(4), &scope(), Role::Viewer, true)
        .unwrap();
    boundary
        .set_membership(&id(6), &scope(), Role::Editor, true)
        .unwrap();
    boundary
}

fn login(boundary: &mut AccessBoundary, username: &str) -> SessionReceipt {
    let body = serde_json::to_vec(&json!({"username": username, "password": PASSWORD})).unwrap();
    boundary
        .login(
            &request(Method::Post, None, None),
            &body,
            "synthetic-loopback",
        )
        .unwrap()
}

fn cookie(receipt: &SessionReceipt) -> &str {
    receipt.set_cookie().split(';').next().unwrap()
}

#[test]
fn healthy_configured_lifecycle_checkpoint() {
    let registration = SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(8),
        collection_id: "synthetic-configured-provider".into(),
        owner: SourceOwner::Homebox,
        partition_mode: PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(9).as_str().into()],
    };
    let policy = LifecyclePolicy::from_trusted_configuration(vec![
        LifecycleRule::new(
            id(6),
            id(7),
            registration.clone(),
            LifecycleCapability::ConfigureSource,
            Action::Mutate,
        )
        .unwrap(),
        LifecycleRule::new(
            id(4),
            id(5),
            registration.clone(),
            LifecycleCapability::PublishCache,
            Action::Read,
        )
        .unwrap(),
    ]);
    let config = AccessConfig::new(vec![ORIGIN.into()])
        .unwrap()
        .with_clock(|| NOW)
        .with_lifecycle_policy(policy);
    let mut boundary = provisioned_boundary(config);
    let editor_session = login(&mut boundary, "synthetic-editor");
    let editor = boundary
        .authorize(
            &request(
                Method::Post,
                Some(cookie(&editor_session)),
                Some(editor_session.info().csrf_token()),
            ),
            &scope(),
            Action::Mutate,
        )
        .unwrap();
    // Configure authority precedes creation: no existing/readable row is needed.
    let configuration = boundary
        .capture_lifecycle(&editor, &registration, LifecycleCapability::ConfigureSource)
        .unwrap();
    boundary
        .install_source_authorized(&editor, &configuration, &registration)
        .unwrap();
    // Ordinary healthy replacement uses the same approval and preserves state.
    boundary
        .install_source_authorized(&editor, &configuration, &registration)
        .unwrap();

    let viewer_session = login(&mut boundary, "synthetic-viewer");
    let viewer = boundary
        .authorize(
            &request(Method::Get, Some(cookie(&viewer_session)), None),
            &scope(),
            Action::Read,
        )
        .unwrap();
    let publication = boundary
        .capture_lifecycle(&viewer, &registration, LifecycleCapability::PublishCache)
        .unwrap();
    // A provider lease clones the original genuine principal, not its safe DTO.
    let retained_principal = viewer.clone();
    let partition = boundary
        .authorize_source_partition(&retained_principal, &registration.partition())
        .unwrap();
    let reference = SourceRef {
        workspace_id: id(1),
        home_id: id(2),
        key: SourceKey {
            source_instance_id: id(8),
            collection_id: registration.collection_id.clone(),
            source_kind: SourceKind::HomeboxEntity,
            external_id: id(9).as_str().into(),
        },
    };
    let entity = boundary
        .authorize_source(&retained_principal, &reference)
        .unwrap();
    assert!(std::ptr::eq(
        boundary
            .revalidate_lifecycle(
                &retained_principal,
                &publication,
                &registration,
                LifecycleCapability::PublishCache,
            )
            .unwrap(),
        &publication
    ));

    // This disposable metadata peer is not AT07 storage or provider generation
    // completion/fence semantics. No provider I/O occurs in this checkpoint.
    let mut cache = Connection::open_in_memory().unwrap();
    cache
        .execute_batch(
            "CREATE TABLE synthetic_publication(actor TEXT NOT NULL, collection TEXT NOT NULL)",
        )
        .unwrap();
    boundary
        .with_lifecycle_authorization(
            &retained_principal,
            &publication,
            &registration,
            LifecycleCapability::PublishCache,
            |guard| -> AccessResult<()> {
                assert!(std::ptr::eq(guard.principal(), &retained_principal));
                assert!(std::ptr::eq(
                    guard.revalidate_lifecycle(
                        &publication,
                        &registration,
                        LifecycleCapability::PublishCache,
                    )?,
                    &publication
                ));
                assert!(std::ptr::eq(
                    guard.revalidate_source_partition(&partition)?,
                    &partition
                ));
                assert!(std::ptr::eq(guard.revalidate_source(&entity)?, &entity));
                let tx = cache.transaction()?;
                tx.execute(
                    "INSERT INTO synthetic_publication VALUES(?1,?2)",
                    params![
                        guard.principal().actor_id().as_str(),
                        registration.collection_id
                    ],
                )?;
                guard.revalidate_lifecycle(
                    &publication,
                    &registration,
                    LifecycleCapability::PublishCache,
                )?;
                guard.revalidate_source_partition(&partition)?;
                guard.revalidate_source(&entity)?;
                tx.commit()?;
                Ok(())
            },
        )
        .unwrap();
    let published: (String, String) = cache
        .query_row(
            "SELECT actor,collection FROM synthetic_publication",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        published,
        (id(5).as_str().into(), registration.collection_id)
    );
}

#[test]
fn healthy_session_principal_checkpoint() {
    let (mut boundary, clock) = setup();
    let session = login(&mut boundary, "synthetic-viewer");
    assert_eq!(session.info().actor_id(), &id(5));
    assert_eq!(session.info().expires_at_ms(), NOW + 604_800_000);
    assert!(
        session
            .set_cookie()
            .contains("Path=/; Secure; HttpOnly; SameSite=Strict")
    );
    let principal = boundary
        .authorize(
            &request(Method::Get, Some(cookie(&session)), None),
            &scope(),
            Action::Read,
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(principal.view()).unwrap(),
        json!({
            "actorId": id(5), "workspaceId": id(1), "homeId": id(2), "role": "viewer"
        })
    );
    assert!(std::ptr::eq(
        boundary.revalidate(&principal).unwrap(),
        &principal
    ));
    boundary
        .authorize_storage(&principal, &scope(), Capability::ReadHistory)
        .unwrap();
    boundary
        .authorize_storage(&principal, &scope(), Capability::ReadAssetManifest)
        .unwrap();

    // Reuse the published valid empty history array. This is an access seam
    // checkpoint; durable history traversal belongs to the storage lane.
    let history: Vec<Value> = serde_json::from_str(include_str!(
        "../../../packages/contracts/history/fixtures/empty.audit-array.json"
    ))
    .unwrap();
    assert!(history.is_empty());

    clock.store(NOW + 1000, Ordering::Relaxed);
    let info = boundary
        .session_info(&request(Method::Get, Some(cookie(&session)), None))
        .unwrap();
    assert_eq!(info.actor_id(), &id(5));
    assert_eq!(info.expires_at_ms(), session.info().expires_at_ms());
    let rotated = boundary
        .rotate_session(&request(
            Method::Post,
            Some(cookie(&session)),
            Some(info.csrf_token()),
        ))
        .unwrap();
    assert_eq!(
        rotated.info().expires_at_ms(),
        session.info().expires_at_ms()
    );
    let current = boundary
        .authorize(
            &request(Method::Get, Some(cookie(&rotated)), None),
            &scope(),
            Action::History,
        )
        .unwrap();
    boundary.revalidate(&current).unwrap();
    let signed_out = boundary
        .logout(&request(
            Method::Post,
            Some(cookie(&rotated)),
            Some(rotated.info().csrf_token()),
        ))
        .unwrap();
    assert_eq!(
        signed_out,
        format!("{SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0")
    );
}

#[test]
fn healthy_transaction_local_authority_checkpoint() {
    let (mut boundary, clock) = setup();
    let registration: SourceRegistration = serde_json::from_value(json!({
        "workspaceId": id(1), "homeId": id(2), "sourceInstanceId": id(8),
        "collectionId": "synthetic-shared", "owner": "homebox",
        "partitionMode": "reviewed-entity-allowlist", "allowedExternalIds": [id(9)]
    }))
    .unwrap();
    boundary.put_source(&registration, None).unwrap();
    let reference: SourceRef = serde_json::from_value(json!({
        "workspaceId": id(1), "homeId": id(2), "key": {
            "sourceInstanceId": id(8), "collectionId": "synthetic-shared",
            "sourceKind": "homebox-entity", "externalId": id(9)
        }
    }))
    .unwrap();
    let empty_registration = SourceRegistration {
        collection_id: "synthetic-empty-😀".into(),
        allowed_external_ids: vec![],
        ..registration.clone()
    };
    boundary.put_source(&empty_registration, None).unwrap();
    let session = login(&mut boundary, "synthetic-editor");
    let principal = boundary
        .authorize(
            &request(
                Method::Post,
                Some(cookie(&session)),
                Some(session.info().csrf_token()),
            ),
            &scope(),
            Action::Mutate,
        )
        .unwrap();
    assert_eq!(principal.actor_id(), &id(7));
    assert_eq!(principal.role(), Role::Editor);
    let partition = boundary
        .authorize_source_partition(&principal, &registration.partition())
        .unwrap();
    let entity = boundary.authorize_source(&principal, &reference).unwrap();
    assert!(std::ptr::eq(
        boundary.revalidate_source_partition(&partition).unwrap(),
        &partition
    ));
    assert!(std::ptr::eq(
        boundary.revalidate_source(&entity).unwrap(),
        &entity
    ));
    let empty_partition = boundary
        .authorize_source_partition(&principal, &empty_registration.partition())
        .unwrap();

    // A real disposable SQLite record transaction, with a deliberately small
    // synthetic storage peer. AT07's graph/receipt/audit implementation is not
    // substituted or claimed by this checkpoint.
    let mut records = Connection::open_in_memory().unwrap();
    records
        .execute_batch(
            "CREATE TABLE synthetic_checkpoint(actor_id TEXT NOT NULL, home_id TEXT NOT NULL)",
        )
        .unwrap();
    boundary
        .with_mutation_authorization(&principal, |authority| -> AccessResult<()> {
            let tx = records.transaction()?;
            // Storage must check at receipt/replay entry as well as final COMMIT.
            authority.authorize(&scope(), Capability::Mutate)?;
            assert!(std::ptr::eq(authority.revalidate_source(&entity)?, &entity));
            assert!(std::ptr::eq(
                authority.revalidate_source_partition(&partition)?,
                &partition
            ));
            assert!(std::ptr::eq(
                authority.revalidate_source_partition(&empty_partition)?,
                &empty_partition
            ));
            authority.authorize(
                &scope(),
                Capability::ReadCachePartition(&registration.partition()),
            )?;
            authority.authorize(&scope(), Capability::ReadCacheEntity(&reference))?;
            authority.authorize(
                &scope(),
                Capability::ReadCachePartition(&empty_registration.partition()),
            )?;
            tx.execute(
                "INSERT INTO synthetic_checkpoint VALUES(?1,?2)",
                params![
                    authority.principal().actor_id().as_str(),
                    authority.principal().scope().home_id.as_str()
                ],
            )?;
            clock.store(NOW + 1000, Ordering::Relaxed);
            // Retained grants are checked again through the held guard, using
            // their captured versions and returning those exact original handles.
            assert!(std::ptr::eq(authority.revalidate_source(&entity)?, &entity));
            assert!(std::ptr::eq(
                authority.revalidate_source_partition(&partition)?,
                &partition
            ));
            assert!(std::ptr::eq(
                authority.revalidate_source_partition(&empty_partition)?,
                &empty_partition
            ));
            authority.authorize(&scope(), Capability::Mutate)?;
            tx.commit()?;
            Ok(())
        })
        .unwrap();
    let saved: (String, String) = records
        .query_row(
            "SELECT actor_id,home_id FROM synthetic_checkpoint",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(saved, (id(7).as_str().into(), id(2).as_str().into()));
    println!(
        "AT11 healthy authority checkpoint: SQLite {}, schema {}, session/principal/retained-source/retained-empty-partition/current-precommit checks",
        rusqlite::version(),
        ACCESS_SCHEMA_VERSION
    );
}

#[test]
fn healthy_persistent_session_checkpoint() {
    let path = std::env::temp_dir().join(format!(
        "houseatlas-at11-{}.sqlite",
        super::credentials::nonce().unwrap()
    ));
    let config = || {
        AccessConfig::new(vec![ORIGIN.to_owned()])
            .unwrap()
            .with_clock(|| NOW)
    };
    let mut boundary = AccessBoundary::open(&path, config()).unwrap();
    let verifier = hash_password(PASSWORD).unwrap();
    boundary
        .provision_user(&id(6), &id(7), "synthetic-editor", &verifier, None)
        .unwrap();
    boundary
        .set_membership(&id(6), &scope(), Role::Editor, true)
        .unwrap();
    let session = login(&mut boundary, "synthetic-editor");
    drop(boundary);
    let mut reopened = AccessBoundary::open(&path, config()).unwrap();
    let principal = reopened
        .authorize(
            &request(Method::Get, Some(cookie(&session)), None),
            &scope(),
            Action::Read,
        )
        .unwrap();
    assert_eq!(principal.actor_id(), &id(7));
    reopened.revalidate(&principal).unwrap();
    drop(reopened);

    // Strict reopen checks the already provisioned compiled schema. The file,
    // opaque epoch and existing session stay unchanged until normal use begins.
    let before = std::fs::read(&path).unwrap();
    let mut strict = AccessBoundary::open_existing(&path, config()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let principal = strict
        .authorize(
            &request(Method::Get, Some(cookie(&session)), None),
            &scope(),
            Action::Read,
        )
        .unwrap();
    assert_eq!(principal.actor_id(), &id(7));
    strict.revalidate(&principal).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    drop(strict);
    std::fs::remove_file(path).unwrap();
}
