//! Positive persisted metadata only; no presence admission or lifecycle controls.

use serde_json::json;

use super::*;

#[test]
fn healthy_persisted_source_metadata_checkpoint() {
    let id = |n: u32| CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap();
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let registration = SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(8),
        collection_id: "synthetic / α + %".into(),
        owner: SourceOwner::Homebox,
        partition_mode: PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(9).as_str().into()],
    };
    let config = || {
        AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000)
    };
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("access.sqlite");
    let mut access = AccessBoundary::open(&path, config()).unwrap();
    access
        .provision_user(
            &id(6),
            &id(7),
            "synthetic-editor",
            &hash_password("Synthetic-test-password-only!").unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&id(6), &scope, Role::Editor, true)
        .unwrap();
    // Trusted fixture configuration before any original grants are captured.
    // Version two distinguishes the source row from membership version one.
    access.put_source(&registration, None).unwrap();
    access.put_source(&registration, None).unwrap();
    let mut request = RequestEvidence {
        method: Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie: None,
        authorization: None,
        csrf: None,
    };
    let session = access
        .login(
            &request,
            &serde_json::to_vec(&json!({
                "username": "synthetic-editor",
                "password": "Synthetic-test-password-only!"
            }))
            .unwrap(),
            "synthetic-metadata",
        )
        .unwrap();
    request.cookie = Some(session.set_cookie().split(';').next().unwrap());
    request.csrf = Some(session.info().csrf_token());
    let original = access.authorize(&request, &scope, Action::Mutate).unwrap();
    let partition = access
        .authorize_source_partition(&original, &registration.partition())
        .unwrap();
    let persisted_epoch: String = access
        .store
        .db
        .query_row("SELECT epoch FROM access_meta WHERE id=1", [], |row| {
            row.get(0)
        })
        .unwrap();
    let changes = access.store.db.total_changes();
    let mut exported = None;
    access
        .with_mutation_authorization(&original, |guard| -> AccessResult<()> {
            assert!(std::ptr::eq(guard.principal(), &original));
            assert!(std::ptr::eq(
                guard.revalidate_source_partition(&partition)?,
                &partition
            ));
            let metadata = guard.persisted_source_metadata(&partition)?;
            assert_eq!(metadata.access_epoch(), persisted_epoch);
            assert_eq!(metadata.source_registration_version(), 2);
            assert_eq!(metadata.registration(), &registration);
            // Golden canonical registration digest, including the exact Unicode
            // collection spelling and ordered allowlist; no JSON number fields.
            assert_eq!(
                metadata.source_registration_sha256(),
                "1db52edad314de19a8f4e2038e43ef5808780f6f935c505cee085fcfc00308ee"
            );
            assert_eq!(guard.persisted_source_metadata(&partition)?, metadata);
            assert!(std::ptr::eq(guard.revalidate()?, &original));
            exported = Some(metadata);
            Ok(())
        })
        .unwrap();
    assert_eq!(access.store.db.total_changes(), changes);
    let metadata = exported.unwrap();
    drop(access);

    // A separate genuine request after strict reopen checks persistence only;
    // it is not renewal of either original retained handle from the first fence.
    let mut reopened = AccessBoundary::open_existing(&path, config()).unwrap();
    let principal = reopened
        .authorize(&request, &scope, Action::Mutate)
        .unwrap();
    let partition = reopened
        .authorize_source_partition(&principal, &registration.partition())
        .unwrap();
    let changes = reopened.store.db.total_changes();
    reopened
        .with_mutation_authorization(&principal, |guard| -> AccessResult<()> {
            assert!(std::ptr::eq(guard.principal(), &principal));
            assert_eq!(guard.persisted_source_metadata(&partition)?, metadata);
            Ok(())
        })
        .unwrap();
    assert_eq!(reopened.store.db.total_changes(), changes);
    println!(
        "AT11 healthy metadata: persisted epoch, source row version two, canonical full registration, original held principal/grant, read-only export, strict reopen"
    );
}
