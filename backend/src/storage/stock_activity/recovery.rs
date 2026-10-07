//! Exact native activity validation with separately qualified offline owners.
use super::*;
use crate::storage::{self, Result};
use std::collections::{BTreeMap, BTreeSet};

/// Complete trusted physical configuration, including registered empty owners.
/// Metadata only; the image cannot select a registry or issue discovery power.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StockActivityPhysicalRegistration {
    pub physical_binding: PhysicalBinding,
    pub owner_id: Uuid,
    pub dispatcher_epoch: u64,
}
impl From<&StockActivityRegistration> for StockActivityPhysicalRegistration {
    fn from(value: &StockActivityRegistration) -> Self {
        Self {
            physical_binding: value.physical_binding.clone(),
            owner_id: value.owner_id,
            dispatcher_epoch: value.dispatcher_epoch,
        }
    }
}
/// Independent offline administrative issuer, held outside Core/session reset.
/// Callbacks run under a read transaction and must not reenter storage, perform
/// provider I/O or refresh original user/dispatcher/source authority.
pub trait StockActivityRecoveryDiscovery {
    fn revalidate_registry(&self, registry: &[StockActivityPhysicalRegistration]) -> Result<()>;
    fn revalidate_registration(
        &self,
        registry: &[StockActivityPhysicalRegistration],
        registration: &StockActivityPhysicalRegistration,
    ) -> Result<()>;
}
/// Original native/codec/media owner must match independent producer retention
/// and qualify every event-local admission/request/plan/raw evidence/liability
/// prefix. No digest-only or mirrored-image evidence, expired-session authority
/// or default success. This method grants no dispatch or output disclosure.
pub trait StockActivityRecoveryEvidence {
    fn validate_record(&self, record: &RetainedStockActivity) -> Result<()>;
    fn validate_event(&self, event: StockActivityRecoveryEvent<'_>) -> Result<()>;
    /// Qualify an independently retained cross-lane occupancy cut at this exact
    /// initially Queued reservation or later Queued event, including its
    /// original native producer, physical identity and Jobs owner/attempt.
    /// Return the original leased attempt whose physical/logical/liability hold
    /// was actually observed.
    /// A lease DTO, final Jobs state, clocks or mirrored image are not proof of
    /// occupancy then. Missing external correlation/evidence must fail closed.
    /// Storage checks that this exact immutable attempt and its registry/job
    /// closure survive in the already validated image. This is cross-lane match
    /// data only, never native producer/attempt evidence. No grants are revived.
    fn queued_reservation_jobs(
        &self,
        registration: &StockActivityRegistration,
        queued_cut: &RetainedStockActivityEvent,
    ) -> Result<crate::jobs::LeasedJob>;
}
/// Outcome-local cut. Later response/readback/end or liability facts are not
/// supplied here and cannot qualify this earlier event. Identity/authority
/// fields remain matching data for independently retained owner provenance.
pub struct StockActivityRecoveryEvent<'a> {
    pub registration: &'a StockActivityRegistration,
    pub original: &'a StoredOperation,
    pub event: &'a RetainedStockActivityEvent,
    pub previous: Option<&'a RetainedStockActivityEvent>,
    pub prefix: &'a [RetainedStockActivityEvent],
    pub permit: Option<&'a InvocationPermit>,
    pub body_accepted: bool,
    pub physical_hold: bool,
}
pub struct StockActivityRecoveryPeers<'a, W, D, E> {
    pub contracts: &'a W,
    pub registry: &'a [StockActivityPhysicalRegistration],
    pub discovery: &'a D,
    pub evidence: &'a E,
}

fn incompatible() -> storage::Error {
    storage::Error::new(
        "schema-incompatible",
        "Retained stock activity is incompatible",
    )
}
fn require(value: bool) -> Result<()> {
    if value { Ok(()) } else { Err(incompatible()) }
}

pub(crate) fn validate<
    W: StockContractPort,
    D: StockActivityRecoveryDiscovery,
    E: StockActivityRecoveryEvidence,
>(
    db: &Connection,
    peers: &StockActivityRecoveryPeers<'_, W, D, E>,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    check()?;
    peers.discovery.revalidate_registry(peers.registry)?;
    let mut physical_ids = BTreeSet::new();
    for registration in peers.registry {
        check()?;
        require(physical_ids.insert(registration.physical_binding.physical_database_id))?;
        peers
            .discovery
            .revalidate_registration(peers.registry, registration)?;
        let row:(String,String,String,String)=db.query_row("SELECT deployment_id,configuration_digest,owner_id,dispatcher_epoch FROM stock_activity_physical WHERE physical_database_id=?1",[registration.physical_binding.physical_database_id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
        require(
            row == (
                registration.physical_binding.deployment_id.to_string(),
                registration
                    .physical_binding
                    .configuration_digest
                    .as_str()
                    .into(),
                registration.owner_id.to_string(),
                registration.dispatcher_epoch.to_string(),
            ),
        )?;
    }
    let physical_count: i64 =
        db.query_row("SELECT count(*) FROM stock_activity_physical", [], |r| {
            r.get(0)
        })?;
    require(usize::try_from(physical_count).ok() == Some(peers.registry.len()))?;
    let cross_conflict:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM stock_activity_physical s JOIN queue_physical q USING(physical_database_id) WHERE s.deployment_id<>q.deployment_id OR s.configuration_digest<>q.configuration_digest OR s.owner_id<>q.owner_id)",[],|r|r.get(0))?;
    require(!cross_conflict)?;
    let rows=db.prepare("SELECT operation_id,physical_database_id FROM stock_activity_operations ORDER BY rowid")?
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut sequences = BTreeSet::new();
    let mut approvals = 0usize;
    let mut held = BTreeMap::new();
    let mut records = Vec::new();
    for (id, physical) in rows {
        check()?;
        let id_uuid = Uuid::parse_str(&id).map_err(|_| incompatible())?;
        require(id_uuid.to_string() == id)?;
        let registered = peers
            .registry
            .iter()
            .find(|v| v.physical_binding.physical_database_id.to_string() == physical)
            .ok_or_else(incompatible)?;
        peers
            .discovery
            .revalidate_registration(peers.registry, registered)?;
        let row = repository::load(db, id_uuid).map_err(|_| incompatible())?;
        let registration = StockActivityRegistration {
            physical_binding: registered.physical_binding.clone(),
            owner_id: registered.owner_id,
            dispatcher_epoch: registered.dispatcher_epoch,
            source_epoch: row.operation.captured_authority.source_epoch,
            qualification: row.operation.captured_authority.qualification.clone(),
        };
        let record =
            repository::retained(db, id_uuid, &registration).map_err(|_| incompatible())?;
        retention::validate_record(&record, peers.contracts).map_err(|_| incompatible())?;
        for (index, event) in record.events().iter().enumerate() {
            check()?;
            require(sequences.insert(event.sequence()))?;
            if let StockActivityEventFacts::Admit(admission) = event.facts() {
                approvals = approvals
                    .checked_add(usize::from(admission.evidence.approval.is_some()))
                    .ok_or_else(incompatible)?;
            }
            let prefix = &record.events()[..=index];
            let permit = prefix.iter().find_map(|v| match v.facts() {
                StockActivityEventFacts::Admit(admission) => Some(&admission.permit),
                _ => None,
            });
            let physical_hold = matches!(
                event.operation().outcome.remote_activity,
                RemoteActivity::Active { .. } | RemoteActivity::EndUnproven { .. }
            );
            peers.evidence.validate_event(StockActivityRecoveryEvent {
                registration: record.registration(),
                original: record.original(),
                event,
                previous: index.checked_sub(1).map(|i| &record.events()[i]),
                prefix,
                permit,
                body_accepted: permit.is_some(),
                physical_hold,
            })?;
            check()?;
        }
        if record.physical_hold() {
            require(
                held.insert(registered.physical_binding.physical_database_id, id_uuid)
                    .is_none(),
            )?;
        }
        check()?;
        peers.evidence.validate_record(&record)?;
        check()?;
        peers
            .discovery
            .revalidate_registration(peers.registry, registered)?;
        records.push(record);
    }
    let expected: Vec<u64> =
        (1..=u64::try_from(sequences.len()).map_err(|_| incompatible())?).collect();
    require(sequences.into_iter().collect::<Vec<_>>() == expected)?;
    let events: i64 = db.query_row("SELECT count(*) FROM stock_activity_events", [], |r| {
        r.get(0)
    })?;
    require(usize::try_from(events).ok() == Some(expected.len()))?;
    let consumed: i64 = db.query_row("SELECT count(*) FROM stock_activity_approvals", [], |r| {
        r.get(0)
    })?;
    require(usize::try_from(consumed).ok() == Some(approvals))?;
    let pointers=db.prepare("SELECT physical_database_id,active_operation_id FROM stock_activity_physical WHERE active_operation_id IS NOT NULL ORDER BY rowid")?
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut owners = BTreeMap::new();
    let mut pointed_operations = BTreeSet::new();
    for (physical, id) in pointers {
        let physical_uuid = Uuid::parse_str(&physical).map_err(|_| incompatible())?;
        let id_uuid = Uuid::parse_str(&id).map_err(|_| incompatible())?;
        require(physical_uuid.to_string() == physical && id_uuid.to_string() == id)?;
        require(pointed_operations.insert(id_uuid))?;
        require(owners.insert(physical_uuid, id_uuid).is_none())?;
    }
    require(held == owners)?;
    let mut jobs_occupancy =
        |record: &RetainedStockActivity, queued_cut: &RetainedStockActivityEvent| -> Result<()> {
            let attempt = peers
                .evidence
                .queued_reservation_jobs(record.registration(), queued_cut)?;
            crate::storage::queue::validate_reservation_occupancy(
                db,
                &attempt,
                &record.registration().physical_binding,
                record.registration().owner_id,
            )
        };
    require(super::replay::validate(&records, &mut jobs_occupancy, check)? == owners)?;
    // Match both live admission directions, including holds retained after a
    // physical pointer is released. Jobs performs its own strict row decoding.
    for physical in &physical_ids {
        check()?;
        let physical = physical.to_string();
        let native_held:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM stock_activity_physical WHERE physical_database_id=?1 AND active_operation_id IS NOT NULL) OR EXISTS(SELECT 1 FROM stock_activity_operations WHERE physical_database_id=?1 AND (logical_hold=1 OR liability_hold=1))",[&physical],|r|r.get(0))?;
        let jobs_active:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM queue_physical WHERE physical_database_id=?1 AND active_job_id IS NOT NULL)",[&physical],|r|r.get(0))?;
        let jobs_held = crate::storage::queue::unresolved_physical_hold(db, &physical)?;
        require(!(native_held && (jobs_active || jobs_held)))?;
    }
    peers.discovery.revalidate_registry(peers.registry)?;
    check()
}
