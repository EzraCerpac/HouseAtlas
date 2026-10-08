//! Original native presence publication. Committed facts are DATA until the
//! same invocation completes its Storage release; Access completion is separate.
use super::super::{cache_repository as repo, *};
use super::{AtlasStore, cache};
use crate::providers::homebox::read::{self, NativePresenceCapture};
use rusqlite::{Connection, TransactionBehavior, params};
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeMap, sync::Arc};

pub struct CachePresenceCommittedData {
    generation: CacheGeneration,
    registration: SourceRegistration,
    successor_cache_epoch: u64,
    source_bytes: i64,
    cache_bytes: i64,
    row_bytes: i64,
    largest_row: i64,
}
impl CachePresenceCommittedData {
    pub fn generation(&self) -> &CacheGeneration {
        &self.generation
    }
    pub fn cache(&self) -> &CacheStatus {
        &self.generation.cache
    }
    pub fn homebox_entities(&self) -> &[Value] {
        &self.generation.homebox_entities
    }
    pub fn network_relations(&self) -> &[Value] {
        &self.generation.network_relations
    }
    pub fn registration(&self) -> &SourceRegistration {
        &self.registration
    }
    pub fn baseline_generation_id(&self) -> Option<&str> {
        self.generation.expected_generation_id.as_deref()
    }
    pub fn baseline_cache_epoch(&self) -> u64 {
        self.generation.expected_cache_epoch
    }
    pub fn successor_cache_epoch(&self) -> u64 {
        self.successor_cache_epoch
    }
    fn retained_data(&self) -> Self {
        Self {
            generation: self.generation.clone(),
            registration: self.registration.clone(),
            successor_cache_epoch: self.successor_cache_epoch,
            source_bytes: self.source_bytes,
            cache_bytes: self.cache_bytes,
            row_bytes: self.row_bytes,
            largest_row: self.largest_row,
        }
    }
}
#[derive(Default)]
pub struct CachePresenceCommittedObservation(RefCell<Option<CachePresenceCommittedData>>);
impl CachePresenceCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<CachePresenceCommittedData> {
        self.0.borrow_mut().take()
    }
}

/// Pending Storage limb only. It retains the original staged native owner
/// borrow and cannot be reconstructed from durable rows or committed DATA.
pub struct CachePresenceStorageReleasedCut<'original, P> {
    instance: Arc<()>,
    capture: NativePresenceCapture<'original, P>,
    committed: CachePresenceCommittedData,
}
impl<P> CachePresenceStorageReleasedCut<'_, P> {
    pub fn native_capture(&self) -> &NativePresenceCapture<'_, P> {
        &self.capture
    }
    pub fn committed(&self) -> &CachePresenceCommittedData {
        &self.committed
    }
}

fn conflict() -> Error {
    Error::new(
        "guard-conflict",
        "Original native presence publication unavailable",
    )
}

pub(super) struct NativePresencePublicationCapture<'a, P> {
    capture: &'a NativePresenceCapture<'a, P>,
    generation: CacheGeneration,
    observation: &'a CachePresenceCommittedObservation,
    actor: RefCell<Option<VerifiedActor>>,
    staged: RefCell<Option<CachePresenceCommittedData>>,
    committed: RefCell<Option<CachePresenceCommittedData>>,
}
impl<'a, P> NativePresencePublicationCapture<'a, P> {
    fn new(
        capture: &'a NativePresenceCapture<'a, P>,
        observation: &'a CachePresenceCommittedObservation,
    ) -> Result<Self> {
        let native = capture.native();
        let normalized = capture.generation();
        let fence = capture.fence();
        let registration = native.registration();
        let durable = fence.registration();
        if observation.0.borrow().is_some()
            || normalized.quarantine()
            || native.generation_id().as_str() != fence.reserved_generation_id()
            || normalized.cache().generation_id.as_ref() != Some(native.generation_id())
            || native.scope() != &normalized.cache().scope()
            || &registration.scope() != native.scope()
            || registration.workspace_id.as_str() != durable.workspace_id
            || registration.home_id.as_str() != durable.home_id
            || registration.source_instance_id.as_str() != durable.source_instance_id
            || registration.collection_id != durable.collection_id
            || registration.owner != "homebox"
            || durable.owner != SourceOwner::Homebox
            || !matches!(
                (registration.partition_mode, durable.partition_mode),
                (
                    read::PartitionMode::ExclusiveHome,
                    PartitionMode::ExclusiveHome
                ) | (
                    read::PartitionMode::ReviewedEntityAllowlist,
                    PartitionMode::ReviewedEntityAllowlist
                )
            )
            || registration
                .allowed_external_ids
                .iter()
                .map(|id| id.as_str())
                .collect::<std::collections::BTreeSet<_>>()
                != durable
                    .allowed_external_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<std::collections::BTreeSet<_>>()
            || native.responses().len() != normalized.stats().requests
            || native.responses().iter().try_fold(0usize, |sum, response| {
                sum.checked_add(response.body().len())
            }) != Some(normalized.stats().bytes)
            || native
                .responses()
                .iter()
                .any(|response| response.scope() != native.scope())
        {
            return Err(conflict());
        }
        let cache: CacheStatus = serde_json::from_value(serde_json::to_value(normalized.cache())?)?;
        let rows = normalized
            .entities()
            .iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let generation = CacheGeneration {
            cache,
            homebox_entities: rows,
            network_relations: Vec::new(),
            complete: true,
            expected_generation_id: fence.baseline_generation_id().map(str::to_owned),
            expected_cache_epoch: fence.baseline_cache_epoch().value(),
        };
        keyed_rows(&generation.homebox_entities)?;
        Ok(Self {
            capture,
            generation,
            observation,
            actor: RefCell::new(None),
            staged: RefCell::new(None),
            committed: RefCell::new(None),
        })
    }
    pub(super) fn validate_inputs(
        &self,
        principal: &P,
        fence: Option<&CachePublicationFence>,
        generation: &CacheGeneration,
    ) -> Result<()> {
        if !std::ptr::eq(principal, self.capture.principal())
            || !fence.is_some_and(|f| std::ptr::eq(f, self.capture.fence()))
            || generation != &self.generation
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn record_actor(&self, actor: &VerifiedActor) {
        self.actor.replace(Some(actor.clone()));
    }
    pub(super) fn validate_actor(&self, actor: &VerifiedActor) -> Result<()> {
        if self.actor.borrow().as_ref() != Some(actor) {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn stage_committed(
        &self,
        db: &Connection,
        registration: &SourceRegistration,
    ) -> Result<()> {
        let p = self.capture.fence().partition();
        let epoch = repo::epoch(db, p)?;
        if registration != self.capture.fence().registration()
            || self.generation.expected_cache_epoch.checked_add(1) != Some(epoch)
        {
            return Err(conflict());
        }
        let (count, row_bytes, largest_row) = row_sizes(db, p)?;
        if count != i64::try_from(self.generation.homebox_entities.len()).map_err(|_| conflict())? {
            return Err(conflict());
        }
        let data = CachePresenceCommittedData {
            generation: self.generation.clone(),
            registration: registration.clone(),
            successor_cache_epoch: epoch,
            source_bytes: body_size(db, "sources", p)?,
            cache_bytes: body_size(db, "caches", p)?,
            row_bytes,
            largest_row,
        };
        self.staged.replace(Some(data));
        Ok(())
    }
    /// Infallible transfer immediately after the actual SQL commit.
    pub(super) fn record_committed(&self) {
        if let Some(data) = self.staged.borrow_mut().take() {
            let retained = data.retained_data();
            self.observation.0.replace(Some(data));
            self.committed.replace(Some(retained));
        }
    }
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn publish_native_presence_with_authorization<'original, B: Authorization>(
        &mut self,
        authorization: &B,
        capture: NativePresenceCapture<'original, B::Principal>,
        observation: &CachePresenceCommittedObservation,
    ) -> Result<CachePresenceStorageReleasedCut<'original, B::Principal>> {
        let sink = NativePresencePublicationCapture::new(&capture, observation)?;
        self.cache_transaction_with_authorization(authorization)
            .publish_prepared_generation_ref_with_capture(
                capture.principal(),
                capture.fence(),
                &sink.generation.cache,
                &sink.generation.homebox_entities,
                &[],
                Some(&sink),
            )?;
        let data = sink
            .committed
            .borrow()
            .as_ref()
            .ok_or_else(conflict)?
            .retained_data();
        let actor = sink.actor.borrow().as_ref().ok_or_else(conflict)?.clone();
        let scope = capture.fence().partition().scope();
        let input = serde_json::to_value(data.cache())?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let check = || -> Result<()> {
            let current = cache::trusted_authorize(
                &self.contract,
                authorization,
                capture.principal(),
                &scope,
                Capability::PublishCache,
                &input,
            )?;
            if current != actor {
                return Err(conflict());
            }
            Ok(())
        };
        check()?;
        validate_successor(&tx, &data)?;
        check()?;
        tx.commit()?;
        drop(sink);
        Ok(CachePresenceStorageReleasedCut {
            instance: Arc::clone(&self.instance),
            capture,
            committed: data,
        })
    }
    pub fn matches_presence_publication<P>(
        &self,
        cut: &CachePresenceStorageReleasedCut<'_, P>,
    ) -> bool {
        Arc::ptr_eq(&self.instance, &cut.instance)
    }
}

fn keyed_rows(rows: &[Value]) -> Result<BTreeMap<String, &Value>> {
    let mut map = BTreeMap::new();
    for row in rows {
        let id = row["source"]["externalId"].as_str().ok_or_else(conflict)?;
        if map.insert(id.to_owned(), row).is_some() {
            return Err(conflict());
        }
    }
    Ok(map)
}
fn row_sizes(db: &Connection, p: &SourcePartition) -> Result<(i64, i64, i64)> {
    Ok(db.query_row("SELECT count(*),coalesce(sum(length(CAST(body AS BLOB))),0),coalesce(max(length(CAST(body AS BLOB))),0) FROM projections WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?)
}
fn body_size(db: &Connection, table: &str, p: &SourcePartition) -> Result<i64> {
    // The table selector is private and called only with these fixed literals.
    let sql = match table {
        "sources" => {
            "SELECT length(CAST(body AS BLOB)) FROM sources WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4"
        }
        "caches" => {
            "SELECT length(CAST(body AS BLOB)) FROM caches WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4"
        }
        _ => return Err(conflict()),
    };
    Ok(db.query_row(
        sql,
        params![
            p.workspace_id,
            p.home_id,
            p.source_instance_id,
            p.collection_id
        ],
        |row| row.get(0),
    )?)
}
fn bounded_body(db: &Connection, table: &str, p: &SourcePartition, limit: i64) -> Result<Value> {
    let sql = match table {
        "sources" => {
            "SELECT CASE WHEN length(CAST(body AS BLOB))<=?5 THEN body ELSE NULL END FROM sources WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4"
        }
        "caches" => {
            "SELECT CASE WHEN length(CAST(body AS BLOB))<=?5 THEN body ELSE NULL END FROM caches WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4"
        }
        _ => return Err(conflict()),
    };
    let body: Option<String> = db.query_row(
        sql,
        params![
            p.workspace_id,
            p.home_id,
            p.source_instance_id,
            p.collection_id,
            limit
        ],
        |row| row.get(0),
    )?;
    Ok(serde_json::from_str(&body.ok_or_else(conflict)?)?)
}
fn validate_successor(db: &Connection, data: &CachePresenceCommittedData) -> Result<()> {
    let p = data.cache().partition();
    let registration: SourceRegistration =
        serde_json::from_value(bounded_body(db, "sources", &p, data.source_bytes)?)?;
    let cache: CacheStatus =
        serde_json::from_value(bounded_body(db, "caches", &p, data.cache_bytes)?)?;
    if registration != data.registration
        || cache != *data.cache()
        || repo::epoch(db, &p)? != data.successor_cache_epoch
        || !repo::generation_reserved(db, &p, cache.generation_id.as_deref().ok_or_else(conflict)?)?
        || row_sizes(db, &p)?
            != (
                i64::try_from(data.homebox_entities().len()).map_err(|_| conflict())?,
                data.row_bytes,
                data.largest_row,
            )
    {
        return Err(conflict());
    }
    let network_count:i64=db.query_row("SELECT count(*) FROM network_relations WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id],|r|r.get(0))?;
    if network_count != 0 {
        return Err(conflict());
    }
    let mut statement=db.prepare("SELECT CASE WHEN length(CAST(body AS BLOB))<=?5 THEN body ELSE NULL END FROM projections WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4")?;
    let rows = statement
        .query_map(
            params![
                p.workspace_id,
                p.home_id,
                p.source_instance_id,
                p.collection_id,
                data.largest_row
            ],
            |r| r.get::<_, Option<String>>(0),
        )?
        .map(|row| Ok(serde_json::from_str::<Value>(&row?.ok_or_else(conflict)?)?))
        .collect::<Result<Vec<_>>>()?;
    if keyed_rows(&rows)? != keyed_rows(data.homebox_entities())? {
        return Err(conflict());
    }
    Ok(())
}
