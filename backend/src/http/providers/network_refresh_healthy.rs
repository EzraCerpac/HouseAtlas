//! Generated HTTP peer, actual native owners and disposable SQLite; no sockets.
use super::*;
use crate::providers::network::collector::CollectorGetPeer;
use std::{future::Future, pin::Pin};

pub(super) struct InventoryPeer {
    config: n::NetworkHttpConfig,
    observations: Arc<FakePeer>,
    wire: Mutex<Value>,
    calls: Mutex<Vec<String>>,
    mode: AtomicUsize,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
impl InventoryPeer {
    pub(super) fn new(
        config: n::NetworkHttpConfig,
        observations: Arc<FakePeer>,
        wire: Value,
    ) -> Self {
        Self {
            config,
            observations,
            wire: Mutex::new(wire),
            calls: Mutex::default(),
            mode: AtomicUsize::new(0),
            entered: Default::default(),
            release: Default::default(),
        }
    }
    fn revision(&self, revision: u64) {
        self.wire.lock().unwrap()["revision"] = json!(revision);
    }
}
impl n::TestInventoryPeer for InventoryPeer {
    fn get<'a>(
        &'a self,
        path: &'a str,
    ) -> Pin<Box<dyn Future<Output = n::Result<n::InventoryResponse>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(path.into());
            let body = match path {
                "/api/inventory" => {
                    self.entered.notify_one();
                    match self.mode.load(Ordering::SeqCst) {
                        1 => return Err(n::NetworkError::new(n::ErrorCode::Transport)),
                        2 => self.release.notified().await,
                        3 => {
                            return Ok(n::InventoryResponse {
                                status: 403,
                                source: Some(self.config.source().scope.clone()),
                                body: vec![],
                                source_snapshot_at: None,
                                redirected: false,
                                location: None,
                                url: None,
                            });
                        }
                        _ => (),
                    }
                    serde_json::to_vec(&*self.wire.lock().unwrap()).unwrap()
                }
                "/api/health" => {
                    self.observations
                        .get(n::collector::CollectorRoute::Health)
                        .await?
                }
                "/api/measurements" => {
                    self.observations
                        .get(n::collector::CollectorRoute::Measurements)
                        .await?
                }
                _ => panic!("Unexpected upstream request {path}"),
            };
            Ok(n::InventoryResponse {
                status: 200,
                source: Some(self.config.source().scope.clone()),
                body,
                source_snapshot_at: None,
                redirected: false,
                location: None,
                url: None,
            })
        })
    }
}
fn path() -> String {
    format!(
        "/api/atlas/providers/network/workspaces/{}/homes/{}/sources/{}/refresh?collection=inventory",
        id(1),
        id(2),
        id(12)
    )
}
async fn refresh(f: &Fixture) -> Result<(StatusCode, Value)> {
    request_path(
        f,
        true,
        Value::Null,
        Some(&f.csrf),
        &path(),
        Some(&f.cookie),
    )
    .await
}
fn editor(f: &Fixture, role: a::Role) -> Result<()> {
    f.host
        .core
        .lock()
        .unwrap()
        .access
        .lock()
        .unwrap()
        .set_membership(
            &a::CanonicalId::parse(&id(4))?,
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            role,
            true,
        )?;
    Ok(())
}
fn cache(f: &Fixture) -> Result<Value> {
    let principal = crate::app::RequestPrincipal::new(read_principal(f)?);
    let core = f.host.core.lock().unwrap();
    let snapshot = core.store.lock().unwrap().read_snapshot(
        &principal,
        &s::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
    )?;
    Ok(serde_json::to_value(snapshot)?)
}
fn read_principal(f: &Fixture) -> Result<a::Principal> {
    Ok(f.host
        .core
        .lock()
        .unwrap()
        .access
        .lock()
        .unwrap()
        .authorize(
            &a::RequestEvidence {
                method: a::Method::Get,
                url: &format!("{ORIGIN}{}", path()),
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&f.cookie),
                authorization: None,
                csrf: None,
            },
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            a::Action::Read,
        )?)
}
fn read_cached_for_test(f: &Fixture) -> Result<CachedRead<'_>> {
    Ok(read_cached_principal(
        &f.host,
        read_principal(f)?,
        &d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        &id(12),
        "inventory",
    )
    .map_err(|e| format!("Read refused: {}", e.status))?)
}

#[tokio::test]
async fn refresh_auth_absence_and_named_editor() -> Result<()> {
    let f = fixture_options(false, true, false).await?;
    assert_eq!(refresh(&f).await?.0, StatusCode::FORBIDDEN); // Viewer
    assert_eq!(
        request_path(&f, true, Value::Null, Some(&f.csrf), &path(), None)
            .await?
            .0,
        StatusCode::UNAUTHORIZED
    );
    editor(&f, a::Role::Editor)?;
    for csrf in [None, Some("synthetic-invalid")] {
        assert_eq!(
            request_path(&f, true, Value::Null, csrf, &path(), Some(&f.cookie))
                .await?
                .0,
            StatusCode::FORBIDDEN
        );
    }
    // A generated second Editor is not in either profile hint or lifecycle policy.
    let access = f.host.core.lock().unwrap().access.clone();
    let other = {
        let mut a = access.lock().unwrap();
        let user = a::CanonicalId::parse(&id(6))?;
        a.provision_user(
            &user,
            &a::CanonicalId::parse(&id(7))?,
            "other-editor",
            &a::hash_password("Synthetic-only-password")?,
            None,
        )?;
        a.set_membership(
            &user,
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            a::Role::Editor,
            true,
        )?;
        a.login(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &format!("{ORIGIN}/api/atlas/auth/login"),
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: None,
                authorization: None,
                csrf: None,
            },
            &serde_json::to_vec(
                &json!({"username":"other-editor","password":"Synthetic-only-password"}),
            )?,
            "synthetic-other",
        )?
    };
    let cookie = other.set_cookie().split(';').next().unwrap();
    assert_eq!(
        request_path(
            &f,
            true,
            Value::Null,
            Some(other.info().csrf_token()),
            &path(),
            Some(cookie)
        )
        .await?
        .1,
        json!({"status":"refused","reason":"not-approved"})
    );
    assert!(
        f.inventory
            .as_ref()
            .unwrap()
            .calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(cache(&f)?["sources"].as_array().unwrap().is_empty());
    // A read-only mount does not expose publication, even to an Editor.
    let absent = fixture().await?;
    editor(&absent, a::Role::Editor)?;
    assert_eq!(
        refresh(&absent).await?.1,
        json!({"status":"not-configured"})
    );
    assert_eq!(
        request(&absent, false, Value::Null, None).await?.1["mayRefresh"],
        false
    );
    Ok(())
}

#[tokio::test]
async fn first_refresh_registers_publishes_and_unchanged_renews_capture() -> Result<()> {
    let f = fixture_options(false, true, false).await?;
    editor(&f, a::Role::Editor)?;
    assert!(cache(&f)?["sources"].as_array().unwrap().is_empty());
    let (status, first) = refresh(&f).await?;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["status"], "refreshed", "{first}");
    assert_eq!(first["inventoryRevision"], 42);
    assert_eq!(cache(&f)?["sources"].as_array().unwrap().len(), 1);
    let before = cache(&f)?["caches"][0]["generationId"].clone();
    let (_, second) = refresh(&f).await?;
    assert_eq!(second["status"], "unchanged", "{second}");
    assert_eq!(second["inventoryRevision"], 42);
    assert_ne!(cache(&f)?["caches"][0]["generationId"], before);
    assert_eq!(
        *f.inventory.as_ref().unwrap().calls.lock().unwrap(),
        ["/api/inventory", "/api/health", "/api/measurements"].repeat(2)
    );
    Ok(())
}

#[tokio::test]
async fn mismatch_refresh_attaches_existing_observations_without_restart() -> Result<()> {
    let f = fixture_options(false, true, false).await?;
    editor(&f, a::Role::Editor)?;
    let first = refresh(&f).await?.1;
    assert_eq!(first["status"], "refreshed", "{first}");
    f.peer.revision.store(43, Ordering::SeqCst);
    f.holder
        .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    let held = f.holder.snapshot()?;
    let (_, mismatch) = request(&f, false, Value::Null, None).await?;
    assert_eq!(mismatch["measurementReason"], "inventory-revision-mismatch");
    assert_eq!(mismatch["servedInventoryRevision"], 42);
    assert_eq!(mismatch["inventoryRevision"], 43);
    assert_eq!(mismatch["mayRefresh"], true);
    f.inventory.as_ref().unwrap().revision(43);
    let refreshed = refresh(&f).await?.1;
    assert_eq!(refreshed["inventoryRevision"], 43, "{refreshed}");
    assert!(Arc::ptr_eq(&held, &f.holder.snapshot()?)); // no poll/restart needed
    let (_, attached) = request(&f, false, Value::Null, None).await?;
    assert_eq!(attached["servedInventoryRevision"], 43);
    assert_eq!(attached["measurementReason"], Value::Null);
    let read = read_cached_for_test(&f)?;
    let mut facts = json!({"status":"available"});
    read.enrich_collector("device-a", &mut facts)
        .map_err(|e| format!("Enrichment refused: {}", e.status))?;
    assert_eq!(facts["latencyMs"], 2);
    assert_eq!(facts["loss"], 0);
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_refresh_returns_running_without_second_get() -> Result<()> {
    let f = Arc::new(fixture_options(false, true, false).await?);
    editor(&f, a::Role::Editor)?;
    let peer = f.inventory.as_ref().unwrap();
    peer.mode.store(2, Ordering::SeqCst);
    let first = {
        let f = f.clone();
        tokio::spawn(async move { refresh(&f).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), peer.entered.notified()).await?;
    assert_eq!(refresh(&f).await?.1, json!({"status":"running"}));
    peer.release.notify_one();
    assert_eq!(first.await??.1["status"], "refreshed");
    assert_eq!(
        peer.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|p| *p == "/api/inventory")
            .count(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn failure_after_archive_reservation_keeps_previous_generation_readable() -> Result<()> {
    let f = fixture_options(false, true, false).await?;
    editor(&f, a::Role::Editor)?;
    let first = refresh(&f).await?.1;
    assert_eq!(first["status"], "refreshed", "{first}");
    let before = cache(&f)?;
    let peer = f.inventory.as_ref().unwrap();
    // read_once is entered only after actual archive admission/reservation.
    peer.mode.store(1, Ordering::SeqCst);
    let (_, failed) = refresh(&f).await?;
    assert_eq!(failed["status"], "failed", "{failed}");
    assert_eq!(failed["reason"], "transport");
    assert_eq!(failed["quarantined"], false);
    let after = cache(&f)?;
    assert_eq!(
        after["caches"][0]["generationId"],
        before["caches"][0]["generationId"]
    );
    assert_eq!(after["networkRelations"], before["networkRelations"]);
    assert_eq!(read_cached_for_test(&f)?.facet.source_revision, Some(42));
    peer.mode.store(0, Ordering::SeqCst);
    let recovered = refresh(&f).await?.1;
    assert_eq!(recovered["status"], "unchanged", "{recovered}");
    // Auth quarantine is honest and refuses the next attempt before transport.
    peer.mode.store(3, Ordering::SeqCst);
    assert_eq!(refresh(&f).await?.1["quarantined"], true);
    let calls = peer.calls.lock().unwrap().len();
    assert_eq!(refresh(&f).await?.1["reason"], "access-revoked");
    assert_eq!(peer.calls.lock().unwrap().len(), calls);
    Ok(())
}
