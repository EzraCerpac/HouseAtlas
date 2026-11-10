//! Disposable synthetic original Access/SQLite checks; no socket, provider or model.
use super::*;
use crate::{
    app::{Access, ReadAuthority, ServerRuntime, Store, access_scope},
    http::contracts::NativeContracts,
    lifecycle::{self, Failure},
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    sync::{Arc, Mutex},
};
type Result<T, E = Failure> = std::result::Result<T, E>;
const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn prepare_local(directory: &Path) -> Result<Core, Failure> {
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let directory = fs::canonicalize(directory)?;
    let mut fixture = lifecycle::fixture()?;
    fn rebind(value: &mut Value) -> usize {
        match value {
            Value::Object(fields) => {
                let mut count = 0;
                if fields.get("collectionId") == Some(&json!("synthetic-collection-a")) {
                    fields.insert("collectionId".into(), json!(id(11)));
                    count += 1;
                }
                count + fields.values_mut().map(rebind).sum::<usize>()
            }
            Value::Array(rows) => rows.iter_mut().map(rebind).sum(),
            _ => 0,
        }
    }
    assert!(rebind(&mut fixture) > 0);
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic home".into(),
    };
    let scope = access_scope(&home.scope)?;
    let vault = Arc::new(crate::media::AssetVault::open(&directory.join("media"))?);
    let access_path = directory.join("access.sqlite");
    let mut access =
        a::AccessBoundary::open(&access_path, a::AccessConfig::new(vec![ORIGIN.into()])?)?;
    let password = format!("Disposable-{}", crate::app::new_id()?);
    let user = a::CanonicalId::parse(id(4))?;
    let actor = a::CanonicalId::parse(id(5))?;
    access.provision_user(
        &user,
        &actor,
        "synthetic-viewer",
        &a::hash_password(&password)?,
        None,
    )?;
    access.set_membership(&user, &scope, a::Role::Viewer, true)?;
    for source in fixture["sources"]
        .as_array()
        .ok_or("Missing fixture sources")?
    {
        access.put_source(&serde_json::from_value(source.clone())?, None)?;
    }
    let login_url = format!("{ORIGIN}/api/atlas/auth/login");
    let receipt = access.login(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: &login_url,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: None,
            authorization: None,
            csrf: None,
        },
        &serde_json::to_vec(&json!({"username":"synthetic-viewer","password":password}))?,
        "homebox-stock-read",
    )?;
    let cookie = receipt
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing session cookie")?;
    let mut receipt_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(directory.join("smoke-session.json"))?;
    receipt_file.write_all(&serde_json::to_vec(&json!({"cookie":cookie}))?)?;
    receipt_file.sync_all()?;
    drop(receipt);
    drop(access);
    let access: Access = Arc::new(Mutex::new(a::AccessBoundary::open_existing(
        &access_path,
        a::AccessConfig::new(vec![ORIGIN.into()])?,
    )?));
    let path = directory.join("atlas.sqlite");
    let make_runtime = || crate::media::native::NativeMediaRuntime {
        vault: Arc::clone(&vault),
        server: ServerRuntime,
    };
    let mut store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        make_runtime(),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(fixture)?)?;
    store.close()?;
    let store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        make_runtime(),
        s::StoreOptions::default(),
    )?;
    Ok(Core {
        access,
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: d::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault,
        homes: vec![home.clone()],
        home,
    })
}

struct Fixture {
    _scratch: tempfile::TempDir,
    core: Core,
    cookie: String,
}
impl Fixture {
    fn new() -> Result<Self, Failure> {
        let scratch = tempfile::tempdir()?;
        let directory = scratch.path().join("fixture");
        let core = prepare_local(&directory)?;
        let receipt: Value =
            serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
        let cookie = receipt["cookie"]
            .as_str()
            .ok_or("Missing synthetic cookie")?
            .to_owned();
        Ok(Self {
            _scratch: scratch,
            core,
            cookie,
        })
    }
    fn principal(&self) -> Result<RequestPrincipal, Failure> {
        let scope = access_scope(&self.core.home.scope)?;
        let principal = self
            .core
            .access
            .lock()
            .map_err(|_| "Access unavailable")?
            .authorize(
                &a::RequestEvidence {
                    method: a::Method::Get,
                    url: ORIGIN,
                    origin: Some(ORIGIN),
                    sec_fetch_site: Some("same-origin"),
                    referer: None,
                    cookie: Some(&self.cookie),
                    authorization: None,
                    csrf: None,
                },
                &scope,
                a::Action::Read,
            )?;
        Ok(RequestPrincipal::new(principal))
    }
}
fn selection(entity: u32) -> SelectionRequest {
    SelectionRequest {
        feature: Feature::Inventory,
        selections: vec![Selection {
            role: Role::Subject,
            selector: Selector::Entity {
                source_instance_id: id(10),
                collection_id: id(11),
                entity_id: id(entity),
            },
        }],
    }
}
fn captured<'a>(fixture: &'a Fixture, principal: &'a RequestPrincipal) -> SelectedInputs<'a> {
    SelectedInputs::capture(&fixture.core, principal, selection(501)).expect("synthetic capture")
}

#[test]
fn bounded_selectors_refuse_authority_duplicates_and_missing_subject() {
    assert_eq!(
        SelectionRequest::parse(&vec![b' '; MAX_REQUEST_BYTES + 1]).unwrap_err(),
        InputError::LimitExceeded
    );
    for field in [
        "actorId",
        "authorityEpoch",
        "version",
        "excerpt",
        "scope",
        "authority",
    ] {
        let mut raw = json!({"feature":"inventory","selections":[{"role":"subject","selector":{
            "kind":"entity","sourceInstanceId":id(10),"collectionId":id(11),"entityId":id(501)}}]});
        raw[field] = json!("untrusted");
        assert!(SelectionRequest::parse(&serde_json::to_vec(&raw).unwrap()).is_err());
    }
    let mut request = selection(501);
    request.selections[0].role = Role::Source;
    assert_eq!(request.validate(), Err(InputError::InvalidSelection));
    request.selections[0].role = Role::Subject;
    let mut duplicate = request.selections[0].clone();
    duplicate.role = Role::Candidate;
    request.selections.push(duplicate);
    assert_eq!(request.validate(), Err(InputError::InvalidSelection));
    request.selections = vec![request.selections[0].clone(); MAX_SELECTORS + 1];
    assert_eq!(request.validate(), Err(InputError::LimitExceeded));
}
#[test]
fn cached_input_and_exact_inspection_keep_observation_semantics_without_refresh()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    let selected = captured(&fixture, &p);
    let input = selected.current(&fixture.core, &p).unwrap().input();
    let source = &input.sources[0];
    assert!(source.version.starts_with("cache-observation:"));
    assert_eq!(source.source_date.as_deref(), Some("2025-12-01T00:00:00Z"));
    assert_eq!(source.retrieved_at, "2026-01-02T12:00:00Z");
    assert_eq!(input.actor_id, p.principal.actor_id().as_str());
    assert_eq!(source.kind, ai::CandidateKind::InventoryItem);
    let metadata = &source.evidence[0];
    assert!(metadata.excerpt.contains("stale"));
    assert!(metadata.excerpt.contains("not-complete-upstream-audit"));
    assert!(metadata.excerpt.contains("\"upstreamRevision\":null"));
    let evidence = source
        .evidence
        .iter()
        .find(|e| e.excerpt == "Synthetic mobile item")
        .unwrap();
    let binding = selected
        .inspection(
            &fixture.core,
            &p,
            &source.input_ref,
            &source.version,
            Some(&evidence.evidence_ref),
            Some(&ai::EvidenceLocation::Record),
        )
        .unwrap();
    assert_eq!(binding.field.as_deref(), Some("name"));
    assert_eq!(binding.text.as_deref(), Some("Synthetic mobile item"));
    assert!(
        matches!(&binding.target,InspectionTarget::CachedEntity {entity_id,..} if entity_id == &id(501))
    );
    assert!(matches!(
        selected.inspection(
            &fixture.core,
            &p,
            &source.input_ref,
            "wrong-version",
            Some(&evidence.evidence_ref),
            Some(&ai::EvidenceLocation::Record)
        ),
        Err(InputError::InvalidSelection)
    ));
    assert!(
        selected
            .inspection(
                &fixture.core,
                &p,
                &source.input_ref,
                &source.version,
                Some(&evidence.evidence_ref),
                Some(&ai::EvidenceLocation::Page {
                    page: 1,
                    page_count: 1
                })
            )
            .is_err()
    );
    assert!(
        selected
            .inspection(
                &fixture.core,
                &p,
                &source.input_ref,
                &source.version,
                Some("unadmitted"),
                Some(&ai::EvidenceLocation::Record)
            )
            .is_err()
    );
    // No transport is constructed anywhere: Core has no provider client. Fresh
    // recheck reads only original SQLite and returns identical graph/observations.
    selected.recheck(&fixture.core, &p).unwrap();
    Ok(())
}
#[test]
fn selected_missing_record_and_cross_home_source_refuse() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    assert!(SelectedInputs::capture(&fixture.core, &p, selection(9999)).is_err());
    let p = fixture.principal()?;
    let mut request = selection(501);
    request.selections[0].selector = Selector::Entity {
        source_instance_id: id(999),
        collection_id: id(11),
        entity_id: id(501),
    };
    assert!(SelectedInputs::capture(&fixture.core, &p, request).is_err());
    Ok(())
}
#[test]
fn replacement_principal_and_revoked_original_retire_capture() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    let selected = captured(&fixture, &p);
    let replacement = fixture.principal()?;
    assert_eq!(
        selected.recheck(&fixture.core, &replacement),
        Err(InputError::Changed)
    );
    fixture
        .core
        .access
        .lock()
        .unwrap()
        .revoke_user_sessions(&a::CanonicalId::parse(id(4))?)?;
    assert_eq!(
        selected.recheck(&fixture.core, &p),
        Err(InputError::Changed)
    );
    Ok(())
}
#[test]
fn source_revocation_retires_exact_map_and_snapshot() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    let selected = captured(&fixture, &p);
    fixture.core.access.lock().unwrap().set_source_enabled(
        &a::SourcePartition {
            workspace_id: a::CanonicalId::parse(id(1))?,
            home_id: a::CanonicalId::parse(id(2))?,
            source_instance_id: a::CanonicalId::parse(id(10))?,
            collection_id: id(11),
        },
        false,
    )?;
    assert_eq!(
        selected.recheck(&fixture.core, &p),
        Err(InputError::Changed)
    );
    Ok(())
}
#[test]
fn document_metadata_and_retained_assertion_never_create_byte_or_page_authority()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    let graph_request = st::ValidatedRequest::parse(&st::NativeStockContract::new().unwrap(),
        json!({"schemaVersion":3,"commandId":"atlas.evidence.list","requestId":id(9100),"context":scope(&p),"target":{"authority":"atlas","recordType":"evidence"},"payload":{"pageSize":1,"cursor":null,"includeArchived":false}})).unwrap();
    let graph =
        super::super::stock_reads::snapshot(&fixture.core.store, &p, &graph_request).unwrap();
    let record = graph
        .records
        .iter()
        .find(|r| r.record_type == s::RecordType::Evidence)
        .ok_or("Missing synthetic evidence")?;
    let request = SelectionRequest {
        feature: Feature::Document,
        selections: vec![Selection {
            role: Role::Subject,
            selector: Selector::Evidence {
                record_id: record.record_id.clone(),
            },
        }],
    };
    let selected = SelectedInputs::capture(&fixture.core, &p, request).unwrap();
    let input = selected.current(&fixture.core, &p).unwrap().input();
    assert_eq!(
        input.sources[0].evidence[0].excerpt,
        record.payload["statement"].as_str().unwrap()
    );
    assert!(matches!(
        input.sources[0].evidence[0].basis,
        ai::EvidenceBasis::RecordAssertion
    ));
    assert!(
        selected
            .bindings
            .iter()
            .all(|binding| binding.location.is_none()
                || matches!(binding.location, Some(ai::EvidenceLocation::Record)))
    );
    assert!(
        selected
            .bindings
            .iter()
            .all(|binding| matches!(binding.target, InspectionTarget::AtlasRecord { .. }))
    );
    Ok(())
}

#[test]
fn changed_cached_bytes_and_partial_retention_retire_inputs() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    let selected = captured(&fixture, &p);
    // Deliberate adversarial edit of this test's disposable database only.
    let db = rusqlite::Connection::open(fixture._scratch.path().join("fixture/atlas.sqlite"))?;
    let (rowid, body): (i64, String) = db.query_row(
        "SELECT rowid,body FROM projections WHERE json_extract(body,'$.entity.id')=?1",
        [id(501)],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let mut body: Value = serde_json::from_str(&body)?;
    body["entity"]["description"] = json!("Changed synthetic retained description");
    db.execute(
        "UPDATE projections SET body=?1 WHERE rowid=?2",
        rusqlite::params![serde_json::to_string(&body)?, rowid],
    )?;
    assert_eq!(
        selected.recheck(&fixture.core, &p),
        Err(InputError::Changed)
    );
    db.execute("DELETE FROM projections WHERE rowid=?1", [rowid])?;
    let p = fixture.principal()?;
    assert!(SelectedInputs::capture(&fixture.core, &p, selection(501)).is_err());
    Ok(())
}
#[test]
fn actual_other_home_actor_cannot_replace_original_principal() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let p = fixture.principal()?;
    let selected = captured(&fixture, &p);
    let other_scope = a::Scope {
        workspace_id: a::CanonicalId::parse(id(1))?,
        home_id: a::CanonicalId::parse(id(42))?,
    };
    let other_user = a::CanonicalId::parse(id(43))?;
    let other_actor = a::CanonicalId::parse(id(44))?;
    let password = format!("Disposable-{}", crate::app::new_id()?);
    let mut access = fixture.core.access.lock().unwrap();
    access.provision_user(
        &other_user,
        &other_actor,
        "other-synthetic-user",
        &a::hash_password(&password)?,
        None,
    )?;
    access.set_membership(&other_user, &other_scope, a::Role::Viewer, true)?;
    let receipt = access.login(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: ORIGIN,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: None,
            authorization: None,
            csrf: None,
        },
        &serde_json::to_vec(&json!({"username":"other-synthetic-user","password":password}))?,
        "other-synthetic-login",
    )?;
    let cookie = receipt
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing cookie")?
        .to_owned();
    let other = access.authorize(
        &a::RequestEvidence {
            method: a::Method::Get,
            url: ORIGIN,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(&cookie),
            authorization: None,
            csrf: None,
        },
        &other_scope,
        a::Action::Read,
    )?;
    drop(access);
    let other = RequestPrincipal::new(other);
    assert_ne!(other.principal.actor_id(), p.principal.actor_id());
    assert_ne!(other.principal.scope(), p.principal.scope());
    assert_eq!(
        selected.recheck(&fixture.core, &other),
        Err(InputError::Changed)
    );
    assert!(matches!(
        SelectedInputs::capture(&fixture.core, &other, selection(501)),
        Err(InputError::Changed)
    ));
    Ok(())
}
