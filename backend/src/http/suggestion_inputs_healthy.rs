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
type ProjectionHook = Box<dyn FnOnce(&ai::SuggestionCompletion)>;
std::thread_local! {
    static AFTER_PROJECTION: std::cell::RefCell<Option<ProjectionHook>> = const {
        std::cell::RefCell::new(None)
    };
}
pub(super) fn after_projection(projected: &ai::SuggestionCompletion) {
    let hook = AFTER_PROJECTION.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook(projected);
    }
}
const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn prepare_local(directory: &Path) -> Result<Core, Failure> {
    let mut fixture = lifecycle::fixture()?;
    // Preserve the existing UUID-collection controls. The original-collection
    // regression separately passes the unchanged fixture to prepare_snapshot.
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
    prepare_snapshot(directory, fixture)
}

fn prepare_snapshot(directory: &Path, fixture: Value) -> Result<Core, Failure> {
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let directory = fs::canonicalize(directory)?;
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
        Self::prepare(prepare_local)
    }
    fn prepare(prepare: impl FnOnce(&Path) -> Result<Core, Failure>) -> Result<Self, Failure> {
        let scratch = tempfile::tempdir()?;
        let directory = scratch.path().join("fixture");
        let core = prepare(&directory)?;
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
fn opaque_collection_selector_preserves_original_registration_identity() -> Result<(), Failure> {
    let fixture = lifecycle::fixture()?;
    let registration: crate::providers::homebox::read::SourceRegistration =
        serde_json::from_value(fixture["sources"][0].clone())?;
    let collection_id = registration.scope().collection_id;
    assert_eq!(collection_id, "synthetic-collection-a");
    for kind in ["entity", "location"] {
        let raw = json!({"feature":"inventory","selections":[{"role":"subject","selector":{
            "kind":kind,"sourceInstanceId":id(10),"collectionId":collection_id,"entityId":id(501)}}]});
        let request = SelectionRequest::parse(&serde_json::to_vec(&raw)?)
            .expect("original opaque collection is a valid selector");
        match &request.selections[0].selector {
            Selector::Entity {
                collection_id: actual,
                ..
            }
            | Selector::Location {
                collection_id: actual,
                ..
            } => assert_eq!(actual, &collection_id),
            _ => panic!("wrong selector kind"),
        }
    }
    Ok(())
}

#[test]
fn collection_scalar_boundaries_preserve_text_without_relaxing_uuid_fields() {
    for collection_id in [
        "x".into(),
        " ".into(),
        "opaque:collection/é".into(),
        "界".repeat(4096),
    ] {
        for location in [false, true] {
            let mut request = selection(501);
            request.selections[0].selector = if location {
                Selector::Location {
                    source_instance_id: id(10),
                    collection_id: collection_id.clone(),
                    entity_id: id(501),
                }
            } else {
                Selector::Entity {
                    source_instance_id: id(10),
                    collection_id: collection_id.clone(),
                    entity_id: id(501),
                }
            };
            assert_eq!(request.validate(), Ok(()));
        }
    }
    for collection_id in [String::new(), "x".repeat(4097), "界".repeat(4097)] {
        let mut request = selection(501);
        request.selections[0].selector = Selector::Entity {
            source_instance_id: id(10),
            collection_id,
            entity_id: id(501),
        };
        assert_eq!(request.validate(), Err(InputError::InvalidSelection));
    }
    for (source_instance_id, entity_id) in [
        ("opaque-source".into(), id(501)),
        (id(10), "opaque-entity".into()),
    ] {
        let mut request = selection(501);
        request.selections[0].selector = Selector::Entity {
            source_instance_id,
            collection_id: "synthetic-collection-a".into(),
            entity_id,
        };
        assert_eq!(request.validate(), Err(InputError::InvalidSelection));
    }
}

#[test]
fn original_opaque_collection_capture_recheck_and_inspection_keep_native_binding()
-> Result<(), Failure> {
    let fixture = Fixture::prepare(|directory| prepare_snapshot(directory, lifecycle::fixture()?))?;
    let p = fixture.principal()?;
    let collection = "synthetic-collection-a";
    let raw = json!({"feature":"inventory","selections":[{"role":"subject","selector":{
        "kind":"entity","sourceInstanceId":id(10),"collectionId":collection,"entityId":id(501)}}]});
    let request = SelectionRequest::parse(&serde_json::to_vec(&raw)?)
        .expect("unchanged original collection selector");
    // This exercises the real cached dispatcher and AdmittedSnapshot validators.
    // It deliberately requires the coordinated shared opaque-collection repair;
    // no local schema, ID substitution or alternate authority is supplied.
    let selected = SelectedInputs::capture(&fixture.core, &p, request)
        .expect("original authenticated opaque collection capture");
    assert!(selected.graph.sources.iter().any(|registration| {
        registration["sourceInstanceId"] == id(10) && registration["collectionId"] == collection
    }));
    let admitted = selected.current(&fixture.core, &p).unwrap();
    let input = admitted.input();
    assert_eq!(input.actor_id, p.principal.actor_id().as_str());
    assert_eq!(input.scope.workspace_id, id(1));
    assert_eq!(input.scope.home_id, id(2));
    let source = &input.sources[0];
    assert!(matches!(
        &source.target,
        StockTarget::Homebox { source_instance_id, collection_id, entity_id: Some(entity_id), .. }
            if source_instance_id == &id(10) && collection_id == collection && entity_id == &id(501)
    ));
    assert!(source.version.starts_with("cache-observation:"));
    assert_eq!(source.source_date.as_deref(), Some("2025-12-01T00:00:00Z"));
    assert_eq!(source.retrieved_at, "2026-01-02T12:00:00Z");
    let evidence = source
        .evidence
        .iter()
        .find(|evidence| evidence.excerpt == "Synthetic mobile item")
        .expect("original retained assertion");
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
    assert_eq!(binding.text.as_deref(), Some(evidence.excerpt.as_str()));
    assert_eq!(binding.field.as_deref(), Some("name"));
    assert!(matches!(
        &binding.target,
        InspectionTarget::CachedEntity { source_instance_id, collection_id, entity_id }
            if source_instance_id == &id(10) && collection_id == collection && entity_id == &id(501)
    ));
    selected.recheck(&fixture.core, &p).unwrap();
    // Revocation uses the exact original opaque partition, not a UUID alias.
    fixture.core.access.lock().unwrap().set_source_enabled(
        &a::SourcePartition {
            workspace_id: a::CanonicalId::parse(id(1))?,
            home_id: a::CanonicalId::parse(id(2))?,
            source_instance_id: a::CanonicalId::parse(id(10))?,
            collection_id: collection.into(),
        },
        false,
    )?;
    assert_eq!(
        selected.recheck(&fixture.core, &p),
        Err(InputError::Changed)
    );
    assert!(matches!(
        selected.inspection(
            &fixture.core,
            &p,
            &source.input_ref,
            &source.version,
            Some(&evidence.evidence_ref),
            Some(&ai::EvidenceLocation::Record),
        ),
        Err(InputError::Changed)
    ));
    Ok(())
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

// Supplied terminal DATA only, never a provider/model result or a new corpus.
fn observed_usage() -> crate::ai::Usage {
    crate::ai::Usage { input_tokens: Some(17), output_tokens: None, total_tokens: None }
}
fn supplied_proposal(selected: &SelectedInputs<'_>, result: Value) -> Value {
    let input = selected.admitted.input();
    let claims: Vec<_> = input.sources.iter().enumerate().map(|(index, source)| {
        let evidence = source.evidence.iter()
            .find(|e| e.basis == ai::EvidenceBasis::RecordAssertion)
            .or_else(|| source.evidence.first()).unwrap();
        json!({"claimRef":format!("claim-{index}"),"sourceRef":source.input_ref,
            "evidenceRefs":[evidence.evidence_ref],"text":evidence.excerpt,"uncertainty":"tentative"})
    }).collect();
    let subject = input.sources.iter().find(|source| source.role == ai::InputRole::Subject).unwrap();
    json!({"schemaVersion":1,"contextPin":selected.admitted.context_pin(),
        "subjectRef":subject.input_ref,"claims":claims,
        "missingEvidence":["Original content extraction and physical verification are absent."],
        "result":result})
}
fn supplied_terminal(proposal: &Value) -> crate::ai::InferenceOutcome {
    crate::ai::InferenceOutcome::Completed {
        output: vec![json!({"type":"message","role":"assistant","status":"completed",
            "content":[{"type":"output_text","text":serde_json::to_string(proposal).unwrap()}]})],
        usage: observed_usage(),
    }
}
fn inventory_result() -> Value {
    json!({"kind":"inventory","changes":[{"field":"category","value":"equipment",
        "support":{"claimRefs":["claim-0"],"rationale":"Supplied structural review only.","uncertainty":"tentative"}}],"duplicates":[]})
}
fn original_fixture() -> Result<Fixture, Failure> {
    Fixture::prepare(|directory| prepare_snapshot(directory, lifecycle::fixture()?))
}
fn original_selection() -> SelectionRequest {
    let mut request = selection(501);
    request.selections[0].selector = Selector::Entity {
        source_instance_id: id(10), collection_id: "synthetic-collection-a".into(), entity_id: id(501),
    };
    request
}
fn edit_cached_input(path: &Path, delete: bool) -> Result<(), Failure> {
    let db = rusqlite::Connection::open(path)?;
    if delete {
        assert_eq!(db.execute("DELETE FROM projections WHERE json_extract(body,'$.entity.id')=?1", [id(501)])?, 1);
    } else {
        let (rowid, body): (i64, String) = db.query_row(
            "SELECT rowid,body FROM projections WHERE json_extract(body,'$.entity.id')=?1",
            [id(501)], |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut body: Value = serde_json::from_str(&body)?;
        body["entity"]["description"] = json!("Changed synthetic assertion");
        assert_eq!(db.execute("UPDATE projections SET body=?1 WHERE rowid=?2",
            rusqlite::params![serde_json::to_string(&body)?, rowid])?, 1);
    }
    Ok(())
}

#[test]
fn authenticated_completion_keeps_exact_opaque_evidence_without_original_authority()
-> Result<(), Failure> {
    let fixture = original_fixture()?;
    let p = fixture.principal()?;
    let selected = SelectedInputs::capture(&fixture.core, &p, original_selection()).unwrap();
    let proposal = supplied_proposal(&selected, inventory_result());
    let outcome = supplied_terminal(&proposal);
    let before = format!("{outcome:?}");
    let completion = selected.disclose_completed(&fixture.core, &p, &outcome).unwrap();
    assert_eq!(completion.usage, observed_usage());
    let disclosure = completion.review.unwrap();
    let wire = disclosure.value();
    assert_eq!(wire["contextPin"], selected.admitted.context_pin());
    assert_eq!(wire["view"]["fields"][0]["proposed"], "equipment");
    let source = &selected.admitted.input().sources[0];
    let evidence = source.evidence.iter().find(|e| e.excerpt == "Synthetic mobile item").unwrap();
    let card = wire["view"]["sources"].as_array().unwrap().iter()
        .find(|card| card["key"] == evidence.evidence_ref).unwrap();
    assert_eq!(card["excerpt"], evidence.excerpt);
    assert_eq!(card["recordVersion"], source.version);
    assert_eq!(card["sourceDate"], json!(source.source_date));
    assert_eq!(card["retrievedAt"], source.retrieved_at);
    assert_eq!(wire["inspections"][&evidence.evidence_ref], json!({"inputRef":source.input_ref,
        "version":source.version,"evidenceRef":evidence.evidence_ref,"location":{"kind":"record"}}));
    assert!(wire["view"]["sources"].as_array().unwrap().iter().all(|card| card["original"] == "unavailable"));
    let binding = selected.inspection(&fixture.core, &p, &source.input_ref, &source.version,
        Some(&evidence.evidence_ref), Some(&ai::EvidenceLocation::Record)).unwrap();
    assert_eq!(binding.text.as_deref(), Some(evidence.excerpt.as_str()));
    assert!(matches!(&binding.target, InspectionTarget::CachedEntity { collection_id, .. }
        if collection_id == "synthetic-collection-a"));
    assert_eq!(format!("{outcome:?}"), before);
    Ok(())
}

#[test]
fn authenticated_completion_refuses_changed_deleted_and_revoked_native_inputs()
-> Result<(), Failure> {
    for change in ["changed", "deleted", "source-revoked", "session-revoked"] {
        let fixture = original_fixture()?;
        let p = fixture.principal()?;
        let selected = SelectedInputs::capture(&fixture.core, &p, original_selection()).unwrap();
        let outcome = supplied_terminal(&supplied_proposal(&selected, inventory_result()));
        let before = format!("{outcome:?}");
        match change {
            "changed" | "deleted" => edit_cached_input(
                &fixture._scratch.path().join("fixture/atlas.sqlite"), change == "deleted",
            )?,
            "source-revoked" => fixture.core.access.lock().unwrap().set_source_enabled(
                &a::SourcePartition {
                    workspace_id: a::CanonicalId::parse(id(1))?, home_id: a::CanonicalId::parse(id(2))?,
                    source_instance_id: a::CanonicalId::parse(id(10))?, collection_id: "synthetic-collection-a".into(),
                }, false,
            )?,
            "session-revoked" => fixture.core.access.lock().unwrap()
                .revoke_user_sessions(&a::CanonicalId::parse(id(4))?)?,
            _ => unreachable!(),
        }
        assert!(matches!(selected.disclose_completed(&fixture.core, &p, &outcome), Err(InputError::Changed)));
        assert_eq!(format!("{outcome:?}"), before);
    }
    Ok(())
}

#[test]
fn authenticated_completion_holds_projected_dto_until_second_native_recheck()
-> Result<(), Failure> {
    let fixture = original_fixture()?;
    let p = fixture.principal()?;
    let selected = SelectedInputs::capture(&fixture.core, &p, original_selection()).unwrap();
    let outcome = supplied_terminal(&supplied_proposal(&selected, inventory_result()));
    let path = fixture._scratch.path().join("fixture/atlas.sqlite");
    let called = std::rc::Rc::new(std::cell::Cell::new(false));
    let observed = called.clone();
    AFTER_PROJECTION.with(|slot| {
        assert!(slot.borrow_mut().replace(Box::new(move |projected| {
            assert!(projected.review.is_ok());
            edit_cached_input(&path, true).unwrap();
            observed.set(true);
        })).is_none());
    });
    assert!(matches!(selected.disclose_completed(&fixture.core, &p, &outcome), Err(InputError::Changed)));
    assert!(called.get());
    AFTER_PROJECTION.with(|slot| assert!(slot.borrow().is_none()));
    Ok(())
}

#[test]
fn authenticated_completion_rejects_wrong_pin_and_other_capture_without_rebasing()
-> Result<(), Failure> {
    let fixture = original_fixture()?;
    let p = fixture.principal()?;
    let selected = SelectedInputs::capture(&fixture.core, &p, original_selection()).unwrap();
    let mut wrong = supplied_proposal(&selected, inventory_result());
    wrong["contextPin"] = json!("0".repeat(64));
    let second_p = fixture.principal()?;
    let second = SelectedInputs::capture(&fixture.core, &second_p, original_selection()).unwrap();
    assert_ne!(selected.admitted.context_pin(), second.admitted.context_pin());
    for proposal in [wrong, supplied_proposal(&second, inventory_result())] {
        let outcome = supplied_terminal(&proposal);
        let completion = selected.disclose_completed(&fixture.core, &p, &outcome).unwrap();
        assert_eq!(completion.usage, observed_usage());
        assert_eq!(completion.review.unwrap_err(), ai::CompletionRejection::Validation(ai::SuggestionError::ContextChanged));
    }
    Ok(())
}

#[test]
fn authenticated_completion_preserves_terminal_rejections_usage_and_borrowed_outcome()
-> Result<(), Failure> {
    use crate::ai::{AiError, InferenceOutcome, ProviderDiagnostic};
    let fixture = original_fixture()?;
    let p = fixture.principal()?;
    let selected = SelectedInputs::capture(&fixture.core, &p, original_selection()).unwrap();
    let diagnostic = ProviderDiagnostic { http_status: Some(429), code: Some("synthetic-limit".into()),
        parameter: None, request_id: None };
    for usage in [observed_usage(), crate::ai::Usage::default()] {
        let cases = [
            (InferenceOutcome::Cancelled { usage }, ai::CompletionRejection::Cancelled),
            (InferenceOutcome::Stopped { usage }, ai::CompletionRejection::Stopped),
            (InferenceOutcome::Unresolved { usage, reason: AiError::ProviderUnavailable, diagnostic: diagnostic.clone() }, ai::CompletionRejection::Unresolved),
            (InferenceOutcome::Failed { usage, reason: AiError::UsageLimitReached, diagnostic: diagnostic.clone() }, ai::CompletionRejection::Failed),
            (InferenceOutcome::Completed { usage, output: vec![json!({"type":"message","role":"assistant","status":"completed",
                "content":[{"type":"refusal","refusal":"Synthetic refusal"}]})] }, ai::CompletionRejection::Refused),
            (InferenceOutcome::Completed { usage, output: vec![] }, ai::CompletionRejection::InvalidEnvelope),
            (InferenceOutcome::Completed { usage, output: vec![json!({"type":"message","role":"assistant","status":"completed",
                "content":[{"type":"output_text","text":"Not JSON"}]})] }, ai::CompletionRejection::Validation(ai::SuggestionError::InvalidOutput)),
        ];
        for (outcome, rejection) in cases {
            let before = format!("{outcome:?}");
            let completion = selected.disclose_completed(&fixture.core, &p, &outcome).unwrap();
            assert_eq!(completion.usage, usage);
            assert_eq!(completion.review.unwrap_err(), rejection);
            assert_eq!(format!("{outcome:?}"), before);
        }
    }
    Ok(())
}

#[test]
fn authenticated_document_metadata_and_document_assertions_do_not_become_content()
-> Result<(), Failure> {
    for metadata_only in [false, true] {
        let mut snapshot = lifecycle::fixture()?;
        let record_id = if metadata_only {
            let extra = lifecycle::fixture_with_profile(crate::config::FixtureProfile::GeometryMetadata)?;
            let asset = extra["records"].as_array().unwrap().iter()
                .find(|record| record["recordType"] == "asset").unwrap().clone();
            // Preserve actual missing metadata; no staged bytes or extraction exist.
            let record_id = asset["recordId"].as_str().unwrap().to_owned();
            snapshot["records"].as_array_mut().unwrap().push(asset);
            record_id
        } else {
            let evidence = snapshot["records"].as_array_mut().unwrap().iter_mut()
                .find(|record| record["recordType"] == "evidence").unwrap();
            evidence["payload"]["provenance"]["evidenceBasis"] = json!("document");
            evidence["recordId"].as_str().unwrap().to_owned()
        };
        let fixture = Fixture::prepare(|directory| prepare_snapshot(directory, snapshot))?;
        let p = fixture.principal()?;
        let request = SelectionRequest { feature: Feature::Document, selections: vec![
            Selection { role: Role::Subject, selector: if metadata_only {
                Selector::Asset { record_id }
            } else {
                Selector::Evidence { record_id }
            } },
            Selection { role: Role::Candidate, selector: original_selection().selections.remove(0).selector },
        ] };
        let selected = SelectedInputs::capture(&fixture.core, &p, request).unwrap();
        assert_eq!(selected.admitted.input().sources[0].kind, ai::CandidateKind::Document);
        assert!(selected.admitted.input().sources[0].evidence.iter().all(|e| e.basis != ai::EvidenceBasis::Content));
        let support = json!({"claimRefs":["claim-0","claim-1"],"rationale":"Supplied document proposal.","uncertainty":"tentative"});
        for result in [
            json!({"kind":"document","classification":{"category":"manual","support":support},"links":[]}),
            json!({"kind":"document","classification":null,"links":[{"candidateRef":"input-1","support":support}]}),
        ] {
            let outcome = supplied_terminal(&supplied_proposal(&selected, result));
            let completion = selected.disclose_completed(&fixture.core, &p, &outcome).unwrap();
            assert_eq!(completion.usage, observed_usage());
            let expected = if metadata_only {
                ai::SuggestionError::ContextUnavailable
            } else {
                ai::SuggestionError::MissingSupport
            };
            assert_eq!(completion.review.unwrap_err(), ai::CompletionRejection::Validation(expected));
        }
        let outcome = supplied_terminal(&supplied_proposal(&selected,
            json!({"kind":"document","classification":null,"links":[]})));
        let completion = selected.disclose_completed(&fixture.core, &p, &outcome).unwrap();
        if metadata_only {
            assert_eq!(completion.review.unwrap_err(), ai::CompletionRejection::Validation(ai::SuggestionError::ContextUnavailable));
        } else {
            let review = completion.review.unwrap();
            assert!(review.value()["view"]["fields"].as_array().unwrap().is_empty());
            assert!(review.value()["view"]["candidates"].as_array().unwrap().is_empty());
            assert!(review.value()["view"]["sources"].as_array().unwrap().iter().all(|card| card["original"] == "unavailable"));
        }
    }
    Ok(())
}
