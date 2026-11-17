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
    admitted: tokio::sync::Notify,
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
            admitted: Default::default(),
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
                        2 => {
                            self.mode.store(0, Ordering::SeqCst);
                            self.release.notified().await;
                        }
                        // The preflight succeeds; fail the final inventory GET
                        // after Native archive admission, not the preflight.
                        4 => self.mode.store(1, Ordering::SeqCst),
                        6 => self.mode.store(7, Ordering::SeqCst),
                        8 => self.mode.store(9, Ordering::SeqCst),
                        12 => self.mode.store(13, Ordering::SeqCst),
                        7 | 9 | 13 => {
                            let mode = self.mode.swap(0, Ordering::SeqCst);
                            let auth_failure = mode == 9;
                            self.admitted.notify_one();
                            self.release.notified().await;
                            if mode == 13 {
                                return Err(n::NetworkError::new(n::ErrorCode::Transport));
                            }
                            if auth_failure {
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
                        }
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
                    let mut wire = self.wire.lock().unwrap();
                    let body = serde_json::to_vec(&*wire).unwrap();
                    if self
                        .mode
                        .compare_exchange(5, 0, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                    {
                        let revision = wire["revision"].as_u64().unwrap() + 1;
                        wire["revision"] = json!(revision);
                    }
                    body
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

/// Clean native Store/Host close/reopen, with retained synthetic Access. This
/// proves Store pin lifetime, not a process restart or installed recovery.
async fn reopen_with_review(f: Fixture, revision: u64) -> Result<Fixture> {
    let Fixture {
        _root,
        host,
        cookie,
        csrf,
        peer,
        inventory,
        ..
    } = f;
    let binding = &host.network_bindings[0];
    let source = binding.runtime().settings().configured_source().clone();
    let entities = binding.entities().to_vec();
    let mut review = binding.runtime().settings().review().clone();
    review.revision = revision;
    let core = host.core.clone();
    drop(host);
    let Core {
        access,
        store,
        vault,
        home,
        homes,
        ..
    } = Arc::try_unwrap(core)
        .map_err(|_| "Retained Core owner")?
        .into_inner()
        .map_err(|_| "Core mutex")?;
    Arc::try_unwrap(store)
        .map_err(|_| "Retained Store owner")?
        .into_inner()
        .map_err(|_| "Store mutex")?
        .close()?;
    let root = fs::canonicalize(_root.path())?;
    let store = Store::open_existing(
        root.join("atlas.sqlite"),
        NativeContracts,
        ReadAuthority(access.clone()),
        NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        s::StoreOptions::default(),
    )?;
    let core = Core {
        access,
        store: Arc::new(Mutex::new(store)),
        vault,
        home,
        homes,
        atlas_list_pages: Default::default(),
        media_policy_evidence: Mutex::default(),
    };
    let settings = NetworkSettings::new(
        source,
        "http://127.0.0.1:42001",
        review,
        n::Limits::default(),
        2000,
        2000,
        60000,
        &root,
    )?
    .with_collector_measurements(true)?
    .with_test_peer(inventory.as_ref().ok_or("Missing inventory peer")?.clone());
    let mut binding = NetworkBinding::from_trusted_configuration(&core, settings, entities)?;
    binding.refresh_editors = vec![a::CanonicalId::parse(&id(5))?];
    let holder = Arc::new(Holder::default());
    holder
        .poll(peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    binding.observations = Some(holder.clone());
    binding.collector_peer = Some(peer.clone());
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_network_bindings(vec![binding])?;
    Ok(Fixture {
        _root,
        host,
        cookie,
        csrf,
        peer,
        holder,
        inventory,
    })
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
        [
            "/api/inventory",
            "/api/inventory",
            "/api/health",
            "/api/measurements"
        ]
        .repeat(2)
    );
    Ok(())
}

#[tokio::test]
async fn review_required_then_reviewed_profile_refresh_attaches_observations() -> Result<()> {
    let f = fixture_options(false, true, false).await?;
    editor(&f, a::Role::Editor)?;
    let first = refresh(&f).await?.1;
    assert_eq!(first["status"], "refreshed", "{first}");
    f.peer.revision.store(43, Ordering::SeqCst);
    f.holder
        .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    let (_, mismatch) = request(&f, false, Value::Null, None).await?;
    assert_eq!(mismatch["measurementReason"], "inventory-revision-mismatch");
    assert_eq!(mismatch["servedInventoryRevision"], 42);
    assert_eq!(mismatch["inventoryRevision"], 43);
    assert_eq!(mismatch["mayRefresh"], true);
    assert_eq!(mismatch["needsReview"], true);
    assert_eq!(mismatch["reviewedInventoryRevision"], 42);
    f.inventory.as_ref().unwrap().revision(43);
    f.inventory.as_ref().unwrap().calls.lock().unwrap().clear();
    let before = cache(&f)?;
    let refused = refresh(&f).await?.1;
    assert_eq!(
        refused,
        json!({"status":"needs-review","reviewedInventoryRevision":42,"collectorInventoryRevision":43})
    );
    assert_eq!(cache(&f)?, before); // refusal is not a schema-failure cache write
    assert_eq!(
        *f.inventory.as_ref().unwrap().calls.lock().unwrap(),
        ["/api/inventory"]
    );
    // Preflight refusal created no durable reservation/permanent ID. Updating
    // the reviewed profile and reopening this SAME Store can adopt revision 43.
    let f = reopen_with_review(f, 43).await?;
    let held = f.holder.snapshot()?;
    let (_, reviewed) = request(&f, false, Value::Null, None).await?;
    assert_eq!(reviewed["needsReview"], false);
    assert_eq!(reviewed["reviewedInventoryRevision"], 43);
    assert_eq!(reviewed["servedInventoryRevision"], 42);
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
    assert_eq!(facts["latencyMs"].as_f64(), Some(2.0));
    assert_eq!(facts["loss"].as_f64(), Some(0.0));
    drop(read);
    // A change BETWEEN preflight and final GET must still be refused. This
    // later window has already reserved archive custody and needs disposition.
    f.inventory
        .as_ref()
        .unwrap()
        .mode
        .store(5, Ordering::SeqCst);
    let before = cache(&f)?;
    assert_eq!(
        refresh(&f).await?.1,
        json!({"status":"needs-review","reviewedInventoryRevision":43,"collectorInventoryRevision":44})
    );
    assert_eq!(cache(&f)?, before);
    // Returning to the still-reviewed revision succeeds on the SAME Store.
    f.inventory.as_ref().unwrap().revision(43);
    assert_eq!(refresh(&f).await?.1["status"], "unchanged");
    f.inventory.as_ref().unwrap().revision(44);
    let f = reopen_with_review(f, 44).await?;
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    Ok(())
}

#[tokio::test]
async fn preflight_failure_recovers_on_same_store() -> Result<()> {
    let f = fixture_options(false, true, false).await?;
    editor(&f, a::Role::Editor)?;
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    let peer = f.inventory.as_ref().unwrap();
    peer.mode.store(1, Ordering::SeqCst);
    assert_eq!(refresh(&f).await?.1["reason"], "transport");
    peer.mode.store(0, Ordering::SeqCst);
    // Pin-only disposition permits the next explicit call on this SAME Store.
    let recovered = refresh(&f).await?.1;
    assert_eq!(recovered["status"], "unchanged", "{recovered}");
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
        2
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
    peer.mode.store(4, Ordering::SeqCst);
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
    // Burned archive identifiers remain harmless after clean reopen, too.
    let f = reopen_with_review(f, 42).await?;
    assert_eq!(refresh(&f).await?.1["status"], "unchanged");
    assert_eq!(read_cached_for_test(&f)?.facet.source_revision, Some(42));
    drop(f);
    // Independent auth-quarantine fixture keeps these assertions isolated
    // from the ordinary transport-recovery case.
    let f = fixture_options(false, true, false).await?;
    editor(&f, a::Role::Editor)?;
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    let peer = f.inventory.as_ref().unwrap();
    // Auth quarantine is honest and refuses the next attempt before transport.
    peer.mode.store(3, Ordering::SeqCst);
    assert_eq!(refresh(&f).await?.1["quarantined"], true);
    let calls = peer.calls.lock().unwrap().len();
    assert_eq!(refresh(&f).await?.1["reason"], "access-revoked");
    assert_eq!(peer.calls.lock().unwrap().len(), calls);
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_reservation_contention_retains_custody_and_auth_failure_metadata() -> Result<()> {
    // All contention is controlled after the final GET's actual admission.
    for (core_busy, auth_failure) in [(true, false), (false, false), (false, true), (true, true)] {
        let f = Arc::new(fixture_options(false, true, false).await?);
        editor(&f, a::Role::Editor)?;
        assert_eq!(refresh(&f).await?.1["status"], "refreshed");
        let before = cache(&f)?;
        let peer = f.inventory.as_ref().unwrap();
        peer.mode
            .store(if auth_failure { 8 } else { 6 }, Ordering::SeqCst);
        let first = {
            let f = f.clone();
            tokio::spawn(async move { refresh(&f).await })
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), peer.admitted.notified()).await?;
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let holder = {
            let f = f.clone();
            std::thread::spawn(move || {
                let wait = || {
                    ready_tx.send(()).unwrap();
                    release_rx
                        .recv_timeout(std::time::Duration::from_secs(20))
                        .unwrap();
                };
                if core_busy {
                    let _guard = f.host.core.lock().unwrap();
                    wait();
                } else {
                    f.host.network_bindings[0]
                        .runtime()
                        .with_test_sidecar_lock(wait);
                }
            })
        };
        ready_rx.recv_timeout(std::time::Duration::from_secs(5))?;
        peer.release.notify_one();
        let failed = tokio::time::timeout(std::time::Duration::from_secs(10), first)
            .await???
            .1;
        assert_eq!(failed["status"], "failed", "{failed}");
        assert_eq!(failed["quarantined"], auth_failure, "{failed}");
        release_tx.send(())?;
        holder.join().map_err(|_| "Contention holder panicked")?;
        let after = cache(&f)?;
        assert_eq!(
            after["caches"][0]["generationId"],
            before["caches"][0]["generationId"]
        );
        let calls = peer.calls.lock().unwrap().len();
        let recovered = refresh(&f).await?.1;
        if auth_failure {
            assert_eq!(recovered["reason"], "access-revoked", "{recovered}");
            assert_eq!(peer.calls.lock().unwrap().len(), calls);
            let recorded = cache(&f)?;
            if !core_busy {
                assert_eq!(recorded, after);
            }
            // Core-held auth failures record once when the owner is available;
            // subsequent disposition/quarantine checks never record again.
            assert_eq!(refresh(&f).await?.1["reason"], "access-revoked");
            assert_eq!(cache(&f)?, recorded);
        } else {
            assert_eq!(read_cached_for_test(&f)?.facet.source_revision, Some(42));
            assert_eq!(recovered["status"], "unchanged", "{recovered}");
        }
        let custody = f.host.network_bindings[0].runtime().test_archive_custody();
        assert_eq!(custody.active_reservation_count, 0);
        assert_eq!(custody.permanent_id_count, if auth_failure { 2 } else { 3 });
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn interrupted_pre_stage_future_recovers_on_same_store() -> Result<()> {
    let f = Arc::new(fixture_options(false, true, false).await?);
    editor(&f, a::Role::Editor)?;
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    let before = cache(&f)?;
    let binding = &f.host.network_bindings[0];
    let principal = f
        .host
        .core
        .lock()
        .unwrap()
        .access
        .lock()
        .unwrap()
        .authorize(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &format!("{ORIGIN}{}", path()),
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&f.cookie),
                authorization: None,
                csrf: Some(&f.csrf),
            },
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            a::Action::Mutate,
        )?;
    let configured = binding.runtime().settings().configured_source();
    let partition = binding
        .access()
        .partition_grant(&principal, &configured.partition())?;
    let entities = binding
        .entities()
        .iter()
        .map(|r| binding.access().source_grant(&principal, r))
        .collect::<a::AccessResult<Vec<_>>>()?;
    let lease =
        binding
            .access()
            .retain_original(principal, configured.clone(), partition, entities)?;
    let authority = n::host_runtime::NetworkAuthority::new(
        lease.clone(),
        &binding.runtime().settings().transport(),
        None,
    )?;
    let peer = f.inventory.as_ref().unwrap();
    peer.mode.store(6, Ordering::SeqCst);
    let first = {
        let f = f.clone();
        let runtime = binding.runtime().clone();
        tokio::spawn(async move {
            runtime
                .refresh_reviewed(
                    &f.host.core,
                    authority,
                    lease,
                    tokio_util::sync::CancellationToken::new(),
                    || crate::app::now().unwrap(),
                )
                .await
        })
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), peer.admitted.notified()).await?;
    first.abort();
    assert!(matches!(first.await, Err(error) if error.is_cancelled()));
    assert_eq!(cache(&f)?, before);
    assert_eq!(refresh(&f).await?.1["status"], "unchanged");
    assert_eq!(
        binding
            .runtime()
            .test_archive_custody()
            .active_reservation_count,
        0
    );
    Ok(())
}

#[tokio::test]
async fn two_partitions_refresh_independently_with_retained_disclosure() -> Result<()> {
    let f = fixture_setup(
        false,
        true,
        false,
        FixtureSetup {
            second_partition: true,
            ..Default::default()
        },
    )
    .await?;
    editor(&f, a::Role::Editor)?;
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    let retained = read_cached_for_test(&f)?;
    let before = serde_json::to_value(&retained.facet)?;
    let archive = f.host.network_bindings[0].runtime().test_archive_custody();
    let source_a_cache = cache(&f)?["caches"][0].clone();
    let path_b = path().replace(&id(12), &id(13));
    for expected in ["refreshed", "unchanged"] {
        let answer = request_path(
            &f,
            true,
            Value::Null,
            Some(&f.csrf),
            &path_b,
            Some(&f.cookie),
        )
        .await?
        .1;
        assert_eq!(answer["status"], expected, "{answer}");
        retained
            .revalidate()
            .map_err(|e| format!("A disclosure refused: {}", e.status))?;
        let mut current = serde_json::to_value(&read_cached_for_test(&f)?.facet)?;
        // Only elapsed age changes while B refreshes; A's captured generation,
        // cache facts and every retained inventory member must remain identical.
        assert!(current["ageMs"].as_u64().unwrap() >= before["ageMs"].as_u64().unwrap());
        current["ageMs"] = before["ageMs"].clone();
        assert_eq!(current, before);
        assert_eq!(
            f.host.network_bindings[0].runtime().test_archive_custody(),
            archive
        );
        let caches = cache(&f)?;
        assert_eq!(
            caches["caches"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["sourceInstanceId"] == id(12)),
            Some(&source_a_cache)
        );
        let read_b = read_cached_principal(
            &f.host,
            read_principal(&f)?,
            &d::Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
            &id(13),
            "inventory",
        )
        .map_err(|e| format!("B read refused: {}", e.status))?;
        assert_eq!(read_b.facet.source_revision, Some(42));
        read_b
            .revalidate()
            .map_err(|e| format!("B disclosure refused: {}", e.status))?;
    }
    Ok(())
}

fn login_editor(f: &Fixture, second: bool) -> Result<(String, String)> {
    let access = f.host.core.lock().unwrap().access.clone();
    let mut access = access.lock().unwrap();
    let user = a::CanonicalId::parse(&id(if second { 8 } else { 4 }))?;
    if second {
        access.provision_user(
            &user,
            &a::CanonicalId::parse(&id(9))?,
            "synthetic-second",
            &a::hash_password("Generated-only-fixture-password")?,
            None,
        )?;
        access.set_membership(
            &user,
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            a::Role::Editor,
            true,
        )?;
    }
    let login = access.login(&a::RequestEvidence { method:a::Method::Post,
        url:&format!("{ORIGIN}/api/atlas/auth/login"), origin:Some(ORIGIN), sec_fetch_site:Some("same-origin"),
        referer:None, cookie:None, authorization:None, csrf:None },
        &serde_json::to_vec(&json!({"username":if second {"synthetic-second"} else {"synthetic-viewer"},"password":"Generated-only-fixture-password"}))?, "synthetic-test")?;
    Ok((
        login.set_cookie().split(';').next().unwrap().into(),
        login.info().csrf_token().into(),
    ))
}
async fn revalidate(f: &Fixture, cookie: &str, csrf: &str) -> Result<Value> {
    Ok(request_path(
        f,
        true,
        Value::Null,
        Some(csrf),
        &format!("{}&revalidate=true", path()),
        Some(cookie),
    )
    .await?
    .1)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deferred_auth_expiry_and_revocation_keep_reads_closed_until_authorized_recovery()
-> Result<()> {
    for (expire, auth_failure) in [(false, true), (true, true), (true, false)] {
        let clock = Arc::new(std::sync::atomic::AtomicI64::new(1_800_000_000_000));
        let f = Arc::new(
            fixture_setup(
                false,
                true,
                false,
                FixtureSetup {
                    revalidation: true,
                    second_editor: true,
                    second_partition: true,
                    clock: Some(clock.clone()),
                },
            )
            .await?,
        );
        editor(&f, a::Role::Editor)?;
        assert_eq!(refresh(&f).await?.1["status"], "refreshed");
        let old = read_cached_for_test(&f)?.original.clone();
        let before = cache(&f)?;
        let access = f.host.core.lock().unwrap().access.clone();
        let peer = f.inventory.as_ref().unwrap();
        peer.mode
            .store(if auth_failure { 8 } else { 12 }, Ordering::SeqCst);
        let first = {
            let f = f.clone();
            tokio::spawn(async move { refresh(&f).await })
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), peer.admitted.notified()).await?;
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let holder = {
            let f = f.clone();
            std::thread::spawn(move || {
                let _guard = f.host.core.lock().unwrap();
                ready_tx.send(()).unwrap();
                release_rx
                    .recv_timeout(std::time::Duration::from_secs(20))
                    .unwrap();
            })
        };
        ready_rx.recv_timeout(std::time::Duration::from_secs(5))?;
        peer.release.notify_one();
        let failed = tokio::time::timeout(std::time::Duration::from_secs(10), first)
            .await???
            .1;
        assert_eq!(failed["quarantined"], auth_failure, "{failed}");
        release_tx.send(())?;
        holder.join().map_err(|_| "Core holder panicked")?;
        // The original session is still valid: this refusal proves the Store
        // hold, rather than expired authority, blocks retained disclosure.
        assert_eq!(old.revalidate().is_err(), auth_failure);
        let held = cache(&f)?;
        assert_eq!(
            held["caches"][0]["status"],
            if auth_failure {
                "access-revoked"
            } else {
                "fresh"
            }
        );
        assert_eq!(
            held["networkRelations"].as_array().unwrap().is_empty(),
            auth_failure
        );
        assert_eq!(
            held["caches"][0]["lastAttemptAt"],
            before["caches"][0]["lastAttemptAt"]
        );
        if expire {
            clock.fetch_add(32_000_000_000, Ordering::SeqCst);
        } else {
            access
                .lock()
                .unwrap()
                .revoke_user_sessions(&a::CanonicalId::parse(&id(4))?)?;
        }
        let (other_cookie, other_csrf) = login_editor(&f, true)?;
        let calls = peer.calls.lock().unwrap().len();
        let refused = request_path(
            &f,
            true,
            Value::Null,
            Some(&other_csrf),
            &path(),
            Some(&other_cookie),
        )
        .await?
        .1;
        if !auth_failure {
            assert_eq!(refused["status"], "unchanged", "{refused}");
            assert_eq!(
                f.host.network_bindings[0]
                    .runtime()
                    .test_archive_custody()
                    .active_reservation_count,
                0
            );
            continue;
        }
        assert_eq!(refused["reason"], "access-revoked", "{refused}");
        assert_eq!(
            f.host.network_bindings[0]
                .runtime()
                .test_archive_custody()
                .active_reservation_count,
            0
        );
        // Independent recovery authority is not implied by Configure/Publish.
        assert_eq!(
            revalidate(&f, &other_cookie, &other_csrf).await?["reason"],
            "not-approved"
        );
        assert_eq!(peer.calls.lock().unwrap().len(), calls);
        let (cookie, csrf) = login_editor(&f, false)?;
        // No old failure write was rebound to either fresh session.
        let principal = access.lock().unwrap().authorize(
            &a::RequestEvidence {
                method: a::Method::Get,
                url: &format!("{ORIGIN}{}", path()),
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: None,
            },
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            a::Action::Read,
        )?;
        let core = f.host.core.lock().unwrap();
        let mut store = core.store.lock().unwrap();
        let scope = s::Scope {
            workspace_id: id(1),
            home_id: id(2),
        };
        let request_principal = crate::app::RequestPrincipal::new(principal);
        let current = store.read_snapshot_with_authorization(
            &ReadAuthority(access.clone()),
            &request_principal,
            &scope,
        )?;
        assert_eq!(
            current.caches[0]["lastAttemptAt"],
            before["caches"][0]["lastAttemptAt"]
        );
        assert_eq!(current.caches[0]["error"], Value::Null);
        let (pack, _) =
            store.read_pack_cut(&ReadAuthority(access.clone()), &request_principal, &scope)?;
        assert_eq!(pack.caches[0]["status"], "access-revoked");
        assert!(pack.network_relations.is_empty());
        drop(store);
        drop(core);
        // An unrelated partition remains publishable while A is held.
        let path_b = path().replace(&id(12), &id(13));
        assert_eq!(
            request_path(
                &f,
                true,
                Value::Null,
                Some(&other_csrf),
                &path_b,
                Some(&other_cookie)
            )
            .await?
            .1["status"],
            "refreshed"
        );
        // Mismatch and ordinary failed recovery preserve the original hold.
        peer.revision(43);
        assert_eq!(
            revalidate(&f, &cookie, &csrf).await?["status"],
            "needs-review"
        );
        peer.revision(42);
        peer.mode.store(1, Ordering::SeqCst);
        assert_eq!(revalidate(&f, &cookie, &csrf).await?["quarantined"], true);
        peer.mode.store(0, Ordering::SeqCst);
        let recovered = revalidate(&f, &cookie, &csrf).await?;
        assert_eq!(recovered["status"], "unchanged", "{recovered}");
        let principal = read_principal_cookie(&f, &cookie)?;
        let fresh = read_cached_principal(
            &f.host,
            principal,
            &d::Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
            &id(12),
            "inventory",
        )
        .map_err(|e| format!("Recovered read refused: {}", e.status))?;
        assert_eq!(fresh.facet.source_revision, Some(42));
        assert_eq!(
            f.host.network_bindings[0]
                .runtime()
                .test_archive_custody()
                .active_reservation_count,
            0
        );
    }
    Ok(())
}
fn read_principal_cookie(f: &Fixture, cookie: &str) -> Result<a::Principal> {
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
                cookie: Some(cookie),
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_deferred_failure_retires_without_replaying_metadata() -> Result<()> {
    let f = Arc::new(
        fixture_setup(
            false,
            true,
            false,
            FixtureSetup {
                revalidation: true,
                ..Default::default()
            },
        )
        .await?,
    );
    editor(&f, a::Role::Editor)?;
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    let before = cache(&f)?;
    let peer = f.inventory.as_ref().unwrap();
    peer.mode.store(8, Ordering::SeqCst);
    let first = {
        let f = f.clone();
        tokio::spawn(async move { refresh(&f).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), peer.admitted.notified()).await?;
    let core = f.host.core.lock().unwrap();
    peer.release.notify_one();
    let failed = tokio::time::timeout(std::time::Duration::from_secs(10), first)
        .await???
        .1;
    assert_eq!(failed["quarantined"], true);
    drop(core);
    // A separately committed transaction supersedes the original metadata CAS.
    let db = rusqlite::Connection::open(f._root.path().join("atlas.sqlite"))?;
    assert_eq!(db.execute("UPDATE cache_epochs SET epoch=epoch+1", [])?, 1);
    drop(db);
    assert_eq!(refresh(&f).await?.1["reason"], "access-revoked");
    assert_eq!(
        f.host.network_bindings[0]
            .runtime()
            .test_archive_custody()
            .active_reservation_count,
        0
    );
    let after = cache(&f)?;
    assert_eq!(after["caches"][0]["error"], Value::Null);
    assert_eq!(
        after["caches"][0]["lastAttemptAt"],
        before["caches"][0]["lastAttemptAt"]
    );
    assert_eq!(
        revalidate(&f, &f.cookie, &f.csrf).await?["status"],
        "unchanged"
    );
    assert_eq!(read_cached_for_test(&f)?.facet.source_revision, Some(42));
    Ok(())
}

#[tokio::test]
async fn durable_quarantine_recovery_preserves_reviewed_inventory_baseline() -> Result<()> {
    let f = fixture_setup(
        false,
        true,
        false,
        FixtureSetup {
            revalidation: true,
            ..Default::default()
        },
    )
    .await?;
    editor(&f, a::Role::Editor)?;
    let unregistered = cache(&f)?;
    assert_eq!(
        revalidate(&f, &f.cookie, &f.csrf).await?["reason"],
        "not-approved"
    );
    assert_eq!(cache(&f)?, unregistered); // recovery never enrolls a source
    assert_eq!(refresh(&f).await?.1["status"], "refreshed");
    let peer = f.inventory.as_ref().unwrap();
    let original = peer.wire.lock().unwrap().clone();
    peer.mode.store(3, Ordering::SeqCst);
    assert_eq!(refresh(&f).await?.1["quarantined"], true);
    peer.mode.store(0, Ordering::SeqCst);
    peer.wire.lock().unwrap()["inventory"]["devices"][0]["name"] = json!("Invented changed device");
    let refused = revalidate(&f, &f.cookie, &f.csrf).await?;
    assert_eq!(refused["status"], "failed", "{refused}");
    assert_eq!(refused["reason"], "invalid-schema"); // same revision, changed inventory
    assert_eq!(refused["quarantined"], true);
    *peer.wire.lock().unwrap() = original;
    let recovered = revalidate(&f, &f.cookie, &f.csrf).await?;
    assert_eq!(recovered["status"], "unchanged", "{recovered}");
    assert_eq!(read_cached_for_test(&f)?.facet.source_revision, Some(42));
    Ok(())
}
