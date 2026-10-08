//! Positive, disposable HomeBox mediated history over actual profile-6 activity.
//! Reservations stop at prepared: no provider admission, dispatch, or
//! readback is synthesized by this fixture.
use houseatlas_backend::{
    access as a, contracts,
    domain::{native_semantics::NativeSemantics, stock as domain_stock},
    media::native::NativeReadAuthority,
    providers::homebox::{recovery::NativeWriterContracts, write::stock as native},
    storage as s,
};
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    task::{Context, Poll, Waker},
};
use uuid::Uuid;

type Check<T> = Result<T, Box<dyn std::error::Error>>;
type Store = s::AtlasStore<s::NativeContract<NativeSemantics>, NativeReadAuthority, Clock>;
const NOW: &str = "2026-10-07T12:00:00Z";
fn id(n: u128) -> Uuid {
    Uuid::from_u128(0x00000000_0000_4000_8000_000000000000 | n)
}
fn digest(value: &Value) -> native::Digest {
    native::Digest::parse(
        contracts::semantics::canonical_digest(value).expect("finite fixture JSON"),
    )
    .expect("canonical SHA-256")
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = pin!(future);
    match future
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("offline activity reservation must finish synchronously"),
    }
}
#[derive(Clone)]
struct Clock(Arc<AtomicU64>);
impl s::Runtime for Clock {
    fn now(&self) -> s::Result<String> {
        Ok(NOW.into())
    }
    fn new_id(&self) -> s::Result<String> {
        Ok(id(self.0.fetch_add(1, Ordering::SeqCst) as u128).to_string())
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "No asset in history fixture",
        ))
    }
}
struct Original {
    principal: a::Principal,
    source: a::SourceGrant,
    partition: a::PartitionGrant,
}
struct ReadOriginal {
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
struct ReservationPeer {
    access: Arc<Mutex<a::AccessBoundary>>,
    original: Arc<Original>,
    command: native::StockCommand,
    authority: native::StockAuthority,
    registration: s::StockActivityRegistration,
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
            Some(g) => {
                g.revalidate()
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                g.authorize(original.principal.scope(), a::Capability::Mutate)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                g.revalidate_source(&original.source)
                    .map_err(|_| native::StockPortFault::EvidenceConflict)?;
                g.revalidate_source_partition(&original.partition)
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
        // This positive history example never admits or invokes an operation.
        Err(native::StockPortFault::Unavailable)
    }
}
fn request<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/stock",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}
fn read_request(cookie: &str) -> a::RequestEvidence<'_> {
    a::RequestEvidence {
        method: a::Method::Get,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/stock/history",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie: Some(cookie),
        authorization: None,
        csrf: None,
    }
}
fn write_command(
    serial: u128,
    resource: Uuid,
    location: bool,
    schemas: &NativeWriterContracts,
) -> Check<native::StockCommand> {
    let command_id = if location {
        "homebox.location.update"
    } else {
        "homebox.entity.quantity.set"
    };
    let payload = if location {
        json!({"name":"Synthetic room"})
    } else {
        json!({"quantity":0})
    };
    let mut raw = json!({"schemaVersion":3,"commandId":command_id,"requestId":id(100+serial),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),
            "resourceKind":"entity","resourceId":resource},
        "payload":payload,"idempotencyKey":id(200+serial),"reason":"Synthetic history reservation",
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":id(300+serial)},"atlasGuards":[]},
        "approvalReceiptId":null});
    if location {
        raw["nativeSyncBehavior"] = json!({"mode":"preserve-observed","observed":false});
    }
    let command = native::StockContractPort::validate_request(schemas, &raw)
        .map_err(|e| format!("actual native contract: {e:?}"))?;
    assert_eq!(command.original_wire, raw);
    Ok(command)
}
fn reserve(
    store: &Arc<Mutex<Store>>,
    access: &Arc<Mutex<a::AccessBoundary>>,
    original: &Arc<Original>,
    binding: &native::PhysicalBinding,
    serial: u128,
    location: bool,
) -> Check<native::StoredOperation> {
    let schemas = Arc::new(NativeWriterContracts::new()?);
    let command = write_command(serial, id(500), location, &schemas)?;
    let authority = native::StockAuthority {
        actor_id: id(30),
        source_epoch: 1,
        authority_digest: digest(&json!({"actor":id(30),"sourceEpoch":1})),
        physical_binding: binding.clone(),
        qualification: native::NativeQualification::SyntheticFixture,
    };
    let registration = s::StockActivityRegistration {
        physical_binding: binding.clone(),
        owner_id: id(41),
        dispatcher_epoch: 1,
        source_epoch: 1,
        qualification: native::NativeQualification::SyntheticFixture,
    };
    let peer = Arc::new(ReservationPeer {
        access: access.clone(),
        original: original.clone(),
        command: command.clone(),
        authority: authority.clone(),
        registration: registration.clone(),
    });
    let activity = s::StockActivitySession::new(
        store.clone(),
        access.clone(),
        original.clone(),
        peer.clone(),
        schemas,
        registration,
        command.clone(),
        authority.clone(),
    )
    .map_err(|e| format!("session: {e:?}"))?;
    let reservation = ready(native::StockActivityPort::reserve(
        &activity, &command, &authority,
    ))
    .map_err(|e| format!("reservation: {e:?}"))?;
    let operation = match reservation {
        native::StockReservation::Reserved(operation)
        | native::StockReservation::Queued(operation) => *operation,
        native::StockReservation::Existing(_) => {
            return Err("Fresh fixture unexpectedly reused a reservation".into());
        }
    };
    assert_eq!(operation.activity_version, 1);
    assert_eq!(operation.outcome.observed_at, NOW);
    assert_eq!(
        operation.outcome.remote_activity,
        native::RemoteActivity::not_dispatched()
    );
    Ok(operation)
}

fn history_request(command_id: &str, request_id: Uuid, cursor: Option<&str>) -> Value {
    json!({"schemaVersion":3,"commandId":command_id,"requestId":request_id,
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),
            "resourceKind":"entity","resourceId":id(500)},
        "payload":{"cursor":cursor,"pageSize":1,"includeArchived":true}})
}

struct HistoryAuthority {
    access: Arc<Mutex<a::AccessBoundary>>,
    original: Arc<ReadOriginal>,
    source_ref: a::SourceRef,
    partition: a::SourcePartition,
    raw: Value,
    raw_address: usize,
}
impl HistoryAuthority {
    fn current(
        &self,
        original: &Arc<ReadOriginal>,
        scope: &s::Scope,
    ) -> s::Result<s::VerifiedActor> {
        if !Arc::ptr_eq(original, &self.original)
            || scope.workspace_id != id(1).to_string()
            || scope.home_id != id(2).to_string()
        {
            return Err(s::Error::new("forbidden", "Original history scope differs"));
        }
        let access = self
            .access
            .try_lock()
            .map_err(|_| s::Error::new("storage-unavailable", "Access unavailable"))?;
        let actor = access
            .authorize_storage(
                &original.principal,
                original.principal.scope(),
                a::Capability::ReadHistory,
            )
            .map_err(|e| s::Error::new(e.code(), "History authority unavailable"))?;
        access
            .revalidate_source(&original.source)
            .map_err(|e| s::Error::new(e.code(), "Source authority unavailable"))?;
        access
            .revalidate_source_partition(&original.partition)
            .map_err(|e| s::Error::new(e.code(), "Partition authority unavailable"))?;
        Ok(s::VerifiedActor {
            workspace_id: actor.scope().workspace_id.as_str().into(),
            home_id: actor.scope().home_id.as_str().into(),
            actor_id: actor.actor_id().as_str().into(),
        })
    }
}
impl s::Authorization for HistoryAuthority {
    type Principal = Arc<ReadOriginal>;
    fn authorize(
        &self,
        principal: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let expected_source = serde_json::to_value(&self.source_ref)
            .map_err(|_| s::Error::new("invalid-contract", "Source encoding"))?;
        let partition_matches = |partition: &s::SourcePartition| {
            partition.workspace_id == self.partition.workspace_id.as_str()
                && partition.home_id == self.partition.home_id.as_str()
                && partition.source_instance_id == self.partition.source_instance_id.as_str()
                && partition.collection_id == self.partition.collection_id.as_str()
        };
        if !request.targets.is_empty() || request.mutation.is_some() {
            return Err(s::Error::new("forbidden", "History read shape differs"));
        }
        let capability = match (request.capability, request.source, request.source_partition) {
            (s::Capability::ReadHistory, None, None) => a::Capability::ReadHistory,
            (s::Capability::ReadCache, Some(source), None) if source == &expected_source => {
                a::Capability::ReadCacheEntity(&self.source_ref)
            }
            (s::Capability::ReadCache, None, Some(partition)) if partition_matches(partition) => {
                a::Capability::ReadCachePartition(&self.partition)
            }
            _ => return Err(s::Error::new("forbidden", "History read shape differs")),
        };
        let actor = self.current(principal, request.scope)?;
        let access = self
            .access
            .try_lock()
            .map_err(|_| s::Error::new("storage-unavailable", "Access unavailable"))?;
        let checked = access
            .authorize_storage(
                &principal.principal,
                principal.principal.scope(),
                capability,
            )
            .map_err(|e| s::Error::new(e.code(), "Cache read authority unavailable"))?;
        if checked.actor_id().as_str() != actor.actor_id {
            return Err(s::Error::new("forbidden", "History actor differs"));
        }
        Ok(actor)
    }
}
impl s::HomeBoxStockHistoryAuthorization for HistoryAuthority {
    fn authorize_homebox_stock_history(
        &self,
        principal: &Self::Principal,
        frame: s::HomeBoxStockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let actor = self.current(principal, frame.scope)?;
        if frame.request as *const Value as usize != self.raw_address || frame.request != &self.raw
        {
            return Err(s::Error::new(
                "forbidden",
                "Original history request differs",
            ));
        }
        let expected = json!({"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),
            "resourceKind":"entity","resourceId":id(500)});
        if frame.request["target"] != expected
            || serde_json::to_value(frame.target)
                .map_err(|_| s::Error::new("invalid-contract", "Target encoding"))?
                != expected
            || frame.partition.workspace_id != id(1).to_string()
            || frame.partition.home_id != id(2).to_string()
            || frame.partition.source_instance_id != id(10).to_string()
            || frame.partition.collection_id != id(11).to_string()
            || frame.request["context"] != json!({"workspaceId":id(1),"homeId":id(2)})
        {
            return Err(s::Error::new("forbidden", "Exact history route differs"));
        }
        if let Some(registration) = frame.registration
            && (registration.partition() != *frame.partition
                || registration.owner != s::SourceOwner::Homebox)
        {
            return Err(s::Error::new("forbidden", "History registration differs"));
        }
        for entry in frame.entries {
            if entry["target"] != expected || entry["actorId"] != json!(id(30)) {
                return Err(s::Error::new("forbidden", "History entry differs"));
            }
        }
        if let Some(result) = frame.result
            && (result.wire["commandId"] != frame.request["commandId"]
                || result.wire["requestId"] != frame.request["requestId"]
                || result.wire["data"]["completeness"] != "atlas-mediated-only"
                || result.wire["data"]["coverage"] != "atlas-mediated-only")
        {
            return Err(s::Error::new("forbidden", "History result differs"));
        }
        Ok(actor)
    }
}
fn history_authority(
    access: &Arc<Mutex<a::AccessBoundary>>,
    original: &Arc<ReadOriginal>,
    source_ref: &a::SourceRef,
    partition: &a::SourcePartition,
    raw: &Value,
) -> HistoryAuthority {
    HistoryAuthority {
        access: access.clone(),
        original: original.clone(),
        source_ref: source_ref.clone(),
        partition: partition.clone(),
        raw: raw.clone(),
        raw_address: raw as *const Value as usize,
    }
}

fn main() -> Check<()> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-healthy-homebox-history-")
        .tempdir_in("/tmp")?;
    let database = scratch.path().join("stock-history.sqlite");
    let scope: a::Scope = serde_json::from_value(json!({"workspaceId":id(1),"homeId":id(2)}))?;
    let registration: a::SourceRegistration = serde_json::from_value(json!({
        "workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(10),"collectionId":id(11).to_string(),
        "owner":"homebox","partitionMode":"exclusive-home","allowedExternalIds":[]}))?;
    let source_ref: a::SourceRef =
        serde_json::from_value(json!({"workspaceId":id(1),"homeId":id(2),
        "key":{"sourceInstanceId":id(10),"collectionId":id(11).to_string(),
            "sourceKind":"homebox-entity","externalId":id(500).to_string()}}))?;
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])?
            .with_clock(|| 1_800_000_000_000),
    )?;
    boundary.put_source(&registration, Some(true))?;
    let canonical = |n| a::CanonicalId::parse(id(n).to_string());
    let password = "Synthetic-history-password-only!";
    boundary.provision_user(
        &canonical(50)?,
        &canonical(30)?,
        "synthetic-history",
        &a::hash_password(password)?,
        None,
    )?;
    boundary.set_membership(&canonical(50)?, &scope, a::Role::Editor, true)?;
    let viewer_password = "Synthetic-viewer-history-password-only!";
    boundary.provision_user(
        &canonical(51)?,
        &canonical(31)?,
        "synthetic-history-viewer",
        &a::hash_password(viewer_password)?,
        None,
    )?;
    boundary.set_membership(&canonical(51)?, &scope, a::Role::Viewer, true)?;
    let session = boundary.login(
        &request(None, None),
        &serde_json::to_vec(&json!({"username":"synthetic-history","password":password}))?,
        "synthetic-loopback",
    )?;
    let cookie = session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("cookie")?
        .to_owned();
    let principal = boundary.authorize(
        &request(Some(&cookie), Some(session.info().csrf_token())),
        &scope,
        a::Action::Mutate,
    )?;
    let source = boundary.authorize_source(&principal, &source_ref)?;
    let partition = boundary.authorize_source_partition(&principal, &registration.partition())?;
    let original = Arc::new(Original {
        principal,
        source,
        partition,
    });
    let viewer_session = boundary.login(
        &request(None, None),
        &serde_json::to_vec(
            &json!({"username":"synthetic-history-viewer","password":viewer_password}),
        )?,
        "synthetic-loopback",
    )?;
    let viewer_cookie = viewer_session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("viewer cookie")?
        .to_owned();
    let read_principal =
        boundary.authorize(&read_request(&viewer_cookie), &scope, a::Action::History)?;
    let read_source = boundary.authorize_source(&read_principal, &source_ref)?;
    let read_partition =
        boundary.authorize_source_partition(&read_principal, &registration.partition())?;
    let history_original = Arc::new(ReadOriginal {
        principal: read_principal,
        source: read_source,
        partition: read_partition,
    });
    let access = Arc::new(Mutex::new(boundary));
    let binding = native::PhysicalBinding {
        deployment_id: id(31),
        physical_database_id: id(32),
        configuration_digest: digest(&json!({"source":id(10),"collection":id(11)})),
    };
    let store = Arc::new(Mutex::new(Store::open(
        &database,
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(access.clone()),
        Clock(Arc::new(AtomicU64::new(1000))),
        s::StoreOptions {
            stock_activity_profile: true,
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?));
    let mut initial = s::Snapshot::default();
    initial
        .sources
        .push(serde_json::to_value(&s::SourceRegistration {
            workspace_id: id(1).to_string(),
            home_id: id(2).to_string(),
            source_instance_id: id(10).to_string(),
            collection_id: id(11).to_string(),
            owner: s::SourceOwner::Homebox,
            partition_mode: s::PartitionMode::ExclusiveHome,
            allowed_external_ids: vec![],
        })?);
    store
        .lock()
        .map_err(|_| "Store poisoned")?
        .initialize_synthetic(&initial)?;
    let first = reserve(&store, &access, &original, &binding, 1, false)?;
    let second = reserve(&store, &access, &original, &binding, 2, false)?;
    assert_eq!(first.outcome.state, native::OutcomeState::Prepared);
    assert_eq!(second.outcome.state, native::OutcomeState::Prepared);
    let contracts = domain_stock::NativeStockContract::new()?;
    let schemas = NativeWriterContracts::new()?;
    let first_request = history_request("homebox.entity.mediated-history", id(800), None);
    let history = history_authority(
        &access,
        &history_original,
        &source_ref,
        &registration.partition(),
        &first_request,
    );
    let first_page = store
        .lock()
        .map_err(|_| "Store poisoned")?
        .homebox_stock_history_json_with_authorization(
            &history,
            &history_original,
            &contracts,
            &schemas,
            &first_request,
        )?;
    assert_eq!(
        first_page.wire["data"]["entries"]
            .as_array()
            .ok_or("entries")?
            .len(),
        1
    );
    assert_eq!(
        first_page.wire["data"]["entries"][0]["eventId"],
        json!(first.operation_id)
    );
    assert_eq!(first_page.wire["data"]["entries"][0]["state"], "prepared");
    let cursor = first_page.wire["data"]["nextCursor"]
        .as_str()
        .ok_or("first-page cursor")?
        .to_owned();
    // Add a later actual reservation after the first page. The cursor must
    // retain its original watermark and return only the second earlier row.
    let third = reserve(&store, &access, &original, &binding, 3, false)?;
    let continuation = history_request("homebox.entity.mediated-history", id(801), Some(&cursor));
    let continuation_history = history_authority(
        &access,
        &history_original,
        &source_ref,
        &registration.partition(),
        &continuation,
    );
    let second_page = store
        .lock()
        .map_err(|_| "Store poisoned")?
        .homebox_stock_history_json_with_authorization(
            &continuation_history,
            &history_original,
            &contracts,
            &schemas,
            &continuation,
        )?;
    assert_eq!(
        second_page.wire["data"]["entries"]
            .as_array()
            .ok_or("continuation entries")?
            .len(),
        1
    );
    assert_eq!(
        second_page.wire["data"]["entries"][0]["eventId"],
        json!(second.operation_id)
    );
    assert!(second_page.wire["data"]["nextCursor"].is_null());
    assert_ne!(
        second_page.wire["data"]["entries"][0]["eventId"],
        json!(third.operation_id)
    );
    let location = reserve(&store, &access, &original, &binding, 4, true)?;
    let location_request = history_request("homebox.location.mediated-history", id(802), None);
    let location_validated = domain_stock::ValidatedRequest::parse(&contracts, location_request)?;
    let location_history = history_authority(
        &access,
        &history_original,
        &source_ref,
        &registration.partition(),
        location_validated.raw(),
    );
    let location_page = {
        let mut guard = store.lock().map_err(|_| "Store poisoned")?;
        let mut adapter =
            s::NativeHomeBoxStockHistory::from_store(&mut *guard, &location_history, &schemas);
        domain_stock::StockHistoryPort::stock_history(
            &mut adapter,
            &history_original,
            &contracts,
            &location_validated,
        )?
    };
    assert_eq!(
        location_page.wire["data"]["entries"][0]["eventId"],
        json!(location.operation_id)
    );
    assert_eq!(
        location_page.wire["data"]["entries"][0]["target"],
        first_request["target"]
    );
    let owned = Arc::try_unwrap(store)
        .map_err(|_| "Store retained by a session")?
        .into_inner()
        .map_err(|_| "Store poisoned")?;
    owned.close()?;
    let mut reopened = Store::open(
        &database,
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(access.clone()),
        Clock(Arc::new(AtomicU64::new(2000))),
        s::StoreOptions {
            stock_activity_profile: true,
            ..Default::default()
        },
    )?;
    let reopened_page = reopened.homebox_stock_history_json_with_authorization(
        &history,
        &history_original,
        &contracts,
        &schemas,
        &first_request,
    )?;
    assert_eq!(
        reopened_page.wire["data"]["entries"][0]["eventId"],
        json!(first.operation_id)
    );
    assert_eq!(
        reopened_page.wire["data"]["entries"][0]["requestDigest"],
        json!(first.command.request_digest)
    );
    reopened.close()?;
    println!(
        "healthy HomeBox stock history: 4 actual reservations; entity page, continuation, location page, and reopened page read"
    );
    Ok(())
}
