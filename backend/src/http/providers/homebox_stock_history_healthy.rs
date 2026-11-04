//! Real profile-6 prepared activity read through shared StockService and MCP.
//! Source-only synthetic bootstrap; no provider observation, admission or IO.
use crate::{
    access as a,
    app::{Access, Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store, access_scope},
    contracts::{self, stock as wire},
    domain as d,
    http::{
        agents::{mcp as host_mcp, stock_dispatch},
        contracts::NativeContracts,
    },
    lifecycle::Failure,
    providers::homebox::{recovery::NativeWriterContracts, write::stock as native},
    storage as s,
    transports::mcp,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    os::unix::fs::PermissionsExt,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use uuid::Uuid;

const ORIGIN: &str = "https://atlas.synthetic.invalid";
const ENTITY_HISTORY: &str = "homebox.entity.mediated-history";
const LOCATION_HISTORY: &str = "homebox.location.mediated-history";

fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn evidence<'a>(
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/stock/history",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

struct Original {
    principal: a::Principal,
    source: a::SourceGrant,
    partition: a::PartitionGrant,
}
impl s::StockActivityPrincipal for Original {
    fn original_activity_principal(&self) -> &a::Principal {
        &self.principal
    }
    fn original_activity_source(&self) -> &a::SourceGrant {
        &self.source
    }
    fn original_activity_partition(&self) -> &a::PartitionGrant {
        &self.partition
    }
}

// The existing reservation-only pattern retains genuine Access grants and
// checks the exact original allocation, command, registration and transaction.
// It supplies no approval or provider-admission evidence.
struct ReservationPeer {
    access: Access,
    original: Arc<Original>,
    command: native::StockCommand,
    authority: native::StockAuthority,
    registration: s::StockActivityRegistration,
    admission_calls: Arc<AtomicUsize>,
}
impl s::StockActivityAuthorization<Original> for ReservationPeer {
    fn authorize(
        &self,
        original: &Original,
        registration: &s::StockActivityRegistration,
        guard: Option<&a::TransactionAuthorization<'_>>,
        phase: s::StockActivityPhase,
        action: s::StockActivityAction<'_>,
    ) -> Result<(), native::StockPortFault> {
        if !std::ptr::eq(original, Arc::as_ptr(&self.original))
            || registration != &self.registration
        {
            return Err(native::StockPortFault::EvidenceConflict);
        }
        match action {
            s::StockActivityAction::Reserve(command, authority)
                if command == &self.command && authority == &self.authority => {}
            s::StockActivityAction::Disclose(operation)
                if operation.command == self.command
                    && operation.captured_authority == self.authority => {}
            _ => return Err(native::StockPortFault::EvidenceConflict),
        }
        match guard {
            Some(guard) => {
                guard
                    .revalidate()
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                guard
                    .authorize(original.principal.scope(), a::Capability::Mutate)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                guard
                    .revalidate_source(&original.source)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                guard
                    .revalidate_source_partition(&original.partition)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
            }
            None => {
                let access = self
                    .access
                    .try_lock()
                    .map_err(|_| native::StockPortFault::Unavailable)?;
                access
                    .authorize_storage(
                        &original.principal,
                        original.principal.scope(),
                        a::Capability::Mutate,
                    )
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                access
                    .revalidate_source(&original.source)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                access
                    .revalidate_source_partition(&original.partition)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
            }
        }
        assert!(matches!(
            phase,
            s::StockActivityPhase::Entry
                | s::StockActivityPhase::Precommit
                | s::StockActivityPhase::Release
        ));
        Ok(())
    }

    fn admission(
        &self,
        _: &Original,
        _: &s::StockActivityRegistration,
        _: &a::TransactionAuthorization<'_>,
        _: &native::StoredOperation,
        _: &native::NativePlan,
        _: &native::StockPreflight,
    ) -> Result<s::StockActivityAdmissionEvidence, native::StockPortFault> {
        self.admission_calls.fetch_add(1, Ordering::SeqCst);
        Err(native::StockPortFault::Unavailable)
    }
}

struct ReservationSetup {
    original: Arc<Original>,
    binding: native::PhysicalBinding,
    admission_calls: Arc<AtomicUsize>,
}

fn digest(value: &Value) -> native::Digest {
    native::Digest::parse(
        contracts::semantics::canonical_digest(value).expect("finite fixture JSON"),
    )
    .expect("canonical fixture SHA-256")
}

fn prepare(directory: &Path) -> Result<(Core, ReservationSetup, a::Principal), Failure> {
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic prepared history".into(),
    };
    let scope = access_scope(&home.scope)?;
    let source_value = json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(10),
        "collectionId":id(11),"owner":"homebox","partitionMode":"exclusive-home","allowedExternalIds":[]});
    let registration: a::SourceRegistration = serde_json::from_value(source_value.clone())?;
    let source_ref: a::SourceRef = serde_json::from_value(
        json!({"workspaceId":id(1),"homeId":id(2),
        "key":{"sourceInstanceId":id(10),"collectionId":id(11),"sourceKind":"homebox-entity","externalId":id(500)}}),
    )?;
    let mut access = a::AccessBoundary::in_memory(a::AccessConfig::new(vec![ORIGIN.into()])?)?;
    access.put_source(&registration, Some(true))?;
    let mut principals = Vec::new();
    for (user, actor, name, role) in [
        (50, 30, "synthetic-history-editor", a::Role::Editor),
        (51, 31, "synthetic-history-viewer", a::Role::Viewer),
    ] {
        let password = format!("Disposable-{}", crate::app::new_id()?);
        let user = a::CanonicalId::parse(id(user))?;
        access.provision_user(
            &user,
            &a::CanonicalId::parse(id(actor))?,
            name,
            &a::hash_password(&password)?,
            None,
        )?;
        access.set_membership(&user, &scope, role, true)?;
        let receipt = access.login(
            &evidence(a::Method::Post, None, None),
            &serde_json::to_vec(&json!({"username":name,"password":password}))?,
            "synthetic-history",
        )?;
        let cookie = receipt
            .set_cookie()
            .split(';')
            .next()
            .ok_or("Missing fixture cookie")?;
        let (method, action, csrf) = if role == a::Role::Editor {
            (
                a::Method::Post,
                a::Action::Mutate,
                Some(receipt.info().csrf_token()),
            )
        } else {
            (a::Method::Get, a::Action::History, None)
        };
        principals.push(access.authorize(&evidence(method, Some(cookie), csrf), &scope, action)?);
    }
    let viewer = principals.pop().ok_or("Missing actual Viewer")?;
    let principal = principals.pop().ok_or("Missing actual Editor")?;
    assert_eq!(viewer.role(), a::Role::Viewer);
    let original = Arc::new(Original {
        source: access.authorize_source(&principal, &source_ref)?,
        partition: access.authorize_source_partition(&principal, &registration.partition())?,
        principal,
    });
    let access: Access = Arc::new(Mutex::new(access));
    let vault = Arc::new(crate::media::AssetVault::open(&directory.join("media"))?);
    let mut store = Store::open(
        directory.join("atlas.sqlite"),
        NativeContracts,
        ReadAuthority(access.clone()),
        crate::media::native::NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        s::StoreOptions {
            stock_activity_profile: true,
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    // A source/cache epoch only. No provider observations, native records or
    // completed activity are synthesized. Profile 5 is never opened/upgraded.
    let mut snapshot = s::Snapshot::default();
    snapshot.sources.push(source_value);
    store.initialize_synthetic(&snapshot)?;
    assert_eq!(store.database_version(), s::STOCK_ACTIVITY_DATABASE_VERSION);
    let core = Core {
        access,
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: d::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault,
        homes: vec![home.clone()],
        home,
    };
    let setup = ReservationSetup {
        original,
        binding: native::PhysicalBinding {
            deployment_id: Uuid::parse_str(&id(7101))?,
            physical_database_id: Uuid::parse_str(&id(7102))?,
            configuration_digest: digest(&json!({"source":id(10),"collection":id(11)})),
        },
        admission_calls: Arc::new(AtomicUsize::new(0)),
    };
    Ok((core, setup, viewer))
}

async fn reserve(
    core: &Core,
    setup: &ReservationSetup,
    serial: u32,
    location: bool,
) -> Result<native::StoredOperation, Failure> {
    let schemas = Arc::new(NativeWriterContracts::new()?);
    let command_id = if location {
        "homebox.location.update"
    } else {
        "homebox.entity.quantity.set"
    };
    let mut raw = json!({"schemaVersion":3,"commandId":command_id,"requestId":id(10000+serial),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),"resourceKind":"entity","resourceId":id(500)},
        "payload":if location { json!({"name":"Synthetic prepared room"}) } else { json!({"quantity":0}) },
        "idempotencyKey":id(20000+serial),"reason":"Synthetic prepared history only",
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":id(30000+serial)},"atlasGuards":[]},
        "approvalReceiptId":null});
    if location {
        raw["nativeSyncBehavior"] = json!({"mode":"preserve-observed","observed":false});
    }
    let command = native::StockContractPort::validate_request(&*schemas, &raw)
        .map_err(|e| format!("Actual native intent: {e:?}"))?;
    assert_eq!(command.original_wire, raw);
    let authority = native::StockAuthority {
        actor_id: Uuid::parse_str(&id(30))?,
        source_epoch: 1,
        authority_digest: digest(&json!({"actor":id(30),"sourceEpoch":1})),
        physical_binding: setup.binding.clone(),
        qualification: native::NativeQualification::SyntheticFixture,
    };
    let registration = s::StockActivityRegistration {
        physical_binding: setup.binding.clone(),
        owner_id: Uuid::parse_str(&id(7103))?,
        dispatcher_epoch: 1,
        source_epoch: 1,
        qualification: native::NativeQualification::SyntheticFixture,
    };
    let peer = Arc::new(ReservationPeer {
        access: core.access.clone(),
        original: setup.original.clone(),
        command: command.clone(),
        authority: authority.clone(),
        registration: registration.clone(),
        admission_calls: setup.admission_calls.clone(),
    });
    let activity = s::StockActivitySession::new(
        core.store.clone(),
        core.access.clone(),
        setup.original.clone(),
        peer,
        schemas,
        registration,
        command.clone(),
        authority.clone(),
    )
    .map_err(|e| format!("Actual reservation session: {e:?}"))?;
    let reservation = native::StockActivityPort::reserve(&activity, &command, &authority)
        .await
        .map_err(|e| format!("Actual reservation: {e:?}"))?;
    let operation = match reservation {
        native::StockReservation::Reserved(operation) => *operation,
        _ => return Err("Expected one fresh, unqueued prepared reservation".into()),
    };
    assert_eq!(operation.command, command);
    assert_eq!(operation.actor_id, authority.actor_id);
    assert_eq!(operation.activity_version, 1);
    assert_eq!(operation.outcome.state, native::OutcomeState::Prepared);
    assert_eq!(
        operation.outcome.remote_activity,
        native::RemoteActivity::not_dispatched()
    );
    assert_eq!(setup.admission_calls.load(Ordering::SeqCst), 0);
    Ok(operation)
}

struct Reader<'a> {
    core: &'a Core,
    original: a::Principal,
    adapter: host_mcp::Adapter<'a>,
    session: mcp::Session<mcp::NativeContext>,
    validation: wire::StockValidation,
    next_id: u32,
}
impl<'a> Reader<'a> {
    async fn bind(core: &'a Core, original: a::Principal, next_id: u32) -> Result<Self, Failure> {
        assert!(super::homebox_stock::history_enabled(core));
        let (adapter, session) = host_mcp::bind_read(core, original.clone())
            .await
            .map_err(|_| "Actual Viewer MCP binding unavailable")?;
        let mut reader = Self {
            core,
            original,
            adapter,
            session,
            validation: wire::StockValidation::new()?,
            next_id,
        };
        let reply = reader
            .rpc(
                json!({"jsonrpc":"2.0","id":"initialize","method":"initialize",
            "params":{"protocolVersion":mcp::PROTOCOL_VERSION,"capabilities":{},
                "clientInfo":{"name":"Synthetic prepared history","version":"0.1.0"}}}),
            )
            .await?;
        assert_eq!(reply["result"]["protocolVersion"], mcp::PROTOCOL_VERSION);
        let notification =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))?;
        assert!(
            reader
                .adapter
                .handle(&mut reader.session, &notification)
                .await
                .is_none()
        );
        assert_eq!(reader.session.state(), mcp::SessionState::Ready);
        Ok(reader)
    }

    async fn rpc(&mut self, message: Value) -> Result<Value, Failure> {
        let bytes = self
            .adapter
            .handle(&mut self.session, &serde_json::to_vec(&message)?)
            .await
            .ok_or("Missing actual MCP frame")?;
        let reply: Value = serde_json::from_slice(&bytes)?;
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], message["id"]);
        assert!(reply.get("error").is_none());
        Ok(reply)
    }

    async fn page(&mut self, command: &str, cursor: Option<&str>) -> Result<Value, Failure> {
        let raw = json!({"schemaVersion":3,"commandId":command,"requestId":id(self.next_id),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),"resourceKind":"entity","resourceId":id(500)},
            "payload":{"cursor":cursor,"pageSize":1,"includeArchived":true}});
        self.next_id += 1;
        let parsed = wire::StockRequest::parse(&self.validation, raw.clone())?;
        let native = stock_dispatch::execute(
            self.core,
            &RequestPrincipal::new(self.original.clone()),
            raw.clone(),
        )?;
        assert!(native.children.is_empty());
        wire::StockResponse::parse(&self.validation, &parsed, native.wire.clone(), &[])?;
        let family = wire::operation(parsed.id())?.tool_family.as_str();
        let reply = self
            .rpc(
                json!({"jsonrpc":"2.0","id":raw["requestId"],"method":"tools/call",
            "params":{"name":family,"arguments":raw}}),
            )
            .await?;
        let result = &reply["result"];
        assert_eq!(result["isError"], false);
        let structured = result
            .get("structuredContent")
            .ok_or("Missing actual structured history")?;
        let content = result["content"].as_array().ok_or("Missing text history")?;
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(
            serde_json::from_str::<Value>(
                content[0]["text"].as_str().ok_or("Missing history text")?
            )?,
            *structured
        );
        assert_eq!(structured, &native.wire);
        assert_eq!(structured["schemaVersion"], 3);
        assert_eq!(structured["requestId"], parsed.raw()["requestId"]);
        assert_eq!(structured["commandId"], parsed.raw()["commandId"]);
        assert_eq!(structured["resolvedScope"], parsed.raw()["context"]);
        assert_eq!(structured["status"], "read");
        assert_eq!(structured["replayed"], false);
        wire::StockResponse::parse(&self.validation, &parsed, structured.clone(), &[])?;
        assert_eq!(structured["data"]["coverage"], "atlas-mediated-only");
        assert_eq!(structured["data"]["completeness"], "atlas-mediated-only");
        Ok(structured.clone())
    }

    fn close(mut self) {
        self.session.close();
    }
}

fn expected(operation: &native::StoredOperation) -> Value {
    json!({"eventId":operation.operation_id,"commandId":operation.command.command_id,
        "at":operation.outcome.observed_at,"actorId":id(30),"requestDigest":operation.command.request_digest,
        "state":"prepared","target":{"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),
            "resourceKind":"entity","resourceId":id(500)}})
}

fn check_page(page: &Value, operation: &native::StoredOperation) {
    assert_eq!(page["data"]["entries"], json!([expected(operation)]));
}

fn next_cursor(page: &Value) -> Result<String, Failure> {
    let cursor = page["data"]["nextCursor"]
        .as_str()
        .ok_or("Missing owner-issued continuation")?;
    assert!(!cursor.is_empty());
    Ok(cursor.to_owned())
}

async fn chain(
    reader: &mut Reader<'_>,
    command: &str,
    operations: &[native::StoredOperation],
) -> Result<Vec<Value>, Failure> {
    let mut cursor = None;
    let mut seen_cursors = BTreeSet::new();
    let mut seen_ids = BTreeSet::new();
    let mut pages = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let page = reader.page(command, cursor.as_deref()).await?;
        check_page(&page, operation);
        assert!(
            seen_ids.insert(
                page["data"]["entries"][0]["eventId"]
                    .as_str()
                    .ok_or("Missing actual event")?
                    .to_owned()
            )
        );
        if index + 1 == operations.len() {
            assert!(page["data"]["nextCursor"].is_null());
        } else {
            let next = next_cursor(&page)?;
            assert!(seen_cursors.insert(next.clone()));
            cursor = Some(next);
        }
        pages.push(page["data"].clone());
    }
    assert_eq!(seen_ids.len(), operations.len());
    Ok(pages)
}

type Content = BTreeMap<String, Vec<Vec<String>>>;
fn content(path: &Path) -> Result<Content, Failure> {
    let database =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut content = BTreeMap::new();
    // Immutable cursor DATA may legitimately be persisted by history reads.
    // Compare these fixed activity/record/source tables separately from cursor
    // metadata; this does not claim whole-database immutability.
    for table in [
        "records",
        "audits",
        "receipts",
        "batch_receipts",
        "sources",
        "caches",
        "projections",
        "cache_generations",
        "cache_epochs",
        "stock_activity_physical",
        "stock_activity_operations",
        "stock_activity_events",
    ] {
        let mut statement = database.prepare(&format!("SELECT * FROM {table}"))?;
        let columns = statement.column_count();
        let mut rows = statement
            .query_map([], |row| {
                (0..columns)
                    .map(|index| Ok(format!("{:?}", row.get_ref(index)?)))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.sort();
        content.insert(table.to_owned(), rows);
    }
    Ok(content)
}

fn reopen(core: Core, path: &Path) -> Result<Core, Failure> {
    let Core {
        access,
        store,
        atlas_list_pages,
        media_policy_evidence,
        vault,
        home,
        homes,
    } = core;
    Arc::try_unwrap(store)
        .map_err(|_| "Store retained by an adapter or reservation")?
        .into_inner()
        .map_err(|_| "Store poisoned")?
        .close()?;
    let store = Store::open_existing(
        path,
        NativeContracts,
        ReadAuthority(access.clone()),
        crate::media::native::NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        s::StoreOptions {
            stock_activity_profile: true,
            ..Default::default()
        },
    )?;
    assert_eq!(store.database_version(), s::STOCK_ACTIVITY_DATABASE_VERSION);
    Ok(Core {
        access,
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages,
        media_policy_evidence,
        vault,
        home,
        homes,
    })
}

#[test]
fn healthy_native_prepared_homebox_history_cuts_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-mcp288-prepared-history-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let path = directory.join("atlas.sqlite");
    let (core, setup, viewer) = prepare(&directory)?;
    let mut entity = vec![
        reserve(&core, &setup, 1, false).await?,
        reserve(&core, &setup, 2, false).await?,
    ];
    let mut location = vec![
        reserve(&core, &setup, 3, true).await?,
        reserve(&core, &setup, 4, true).await?,
    ];
    let four = content(&path)?;
    let mut reader = Reader::bind(&core, viewer.clone(), 40000).await?;
    let first_entity = reader.page(ENTITY_HISTORY, None).await?;
    check_page(&first_entity, &entity[0]);
    let entity_cut = next_cursor(&first_entity)?;
    let first_location = reader.page(LOCATION_HISTORY, None).await?;
    check_page(&first_location, &location[0]);
    let location_cut = next_cursor(&first_location)?;
    assert_eq!(content(&path)?, four);

    entity.push(reserve(&core, &setup, 5, false).await?);
    location.push(reserve(&core, &setup, 6, true).await?);
    let six = content(&path)?;
    let second_entity = reader.page(ENTITY_HISTORY, Some(&entity_cut)).await?;
    check_page(&second_entity, &entity[1]);
    assert!(second_entity["data"]["nextCursor"].is_null());
    let second_location = reader.page(LOCATION_HISTORY, Some(&location_cut)).await?;
    check_page(&second_location, &location[1]);
    assert!(second_location["data"]["nextCursor"].is_null());
    let entity_pages = chain(&mut reader, ENTITY_HISTORY, &entity).await?;
    let location_pages = chain(&mut reader, LOCATION_HISTORY, &location).await?;
    assert_eq!(content(&path)?, six);
    reader.close();

    let core = reopen(core, &path)?;
    assert_eq!(content(&path)?, six);
    let mut reader = Reader::bind(&core, viewer, 50000).await?;
    let reopened_entity = reader.page(ENTITY_HISTORY, Some(&entity_cut)).await?;
    let reopened_location = reader.page(LOCATION_HISTORY, Some(&location_cut)).await?;
    assert_eq!(reopened_entity["data"], second_entity["data"]);
    assert_eq!(reopened_location["data"], second_location["data"]);
    assert_eq!(
        chain(&mut reader, ENTITY_HISTORY, &entity).await?,
        entity_pages
    );
    assert_eq!(
        chain(&mut reader, LOCATION_HISTORY, &location).await?,
        location_pages
    );
    assert_eq!(content(&path)?, six);
    assert_eq!(setup.admission_calls.load(Ordering::SeqCst), 0);
    reader.close();
    let Core { store, .. } = core;
    Arc::try_unwrap(store)
        .map_err(|_| "Store retained after history reads")?
        .into_inner()
        .map_err(|_| "Store poisoned")?
        .close()?;
    drop(setup);
    scratch.close()?;
    Ok(())
}
