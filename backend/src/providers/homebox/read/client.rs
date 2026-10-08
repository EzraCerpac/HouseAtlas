use super::decode::{self, WireEntity};
use super::error::invalid;
use super::native_capture::{self, CapturedStockEntity, CapturedStockMaintenance, NativeCapture};
use super::native_presence_capture::{NativePresenceGeneration, NativePresenceResponse};
use super::stock::{self, StockNavigation};
use super::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    time::Duration,
};
use tokio::time::{Instant, timeout_at};

/// Owned chunks prevent later producer buffer reuse from changing accepted bytes.
/// Dropping a pending future/body abandons its result and response ownership.
/// Physical cancellation of resolver work remains driver qualification.
pub trait Body: Send {
    fn next_chunk(&mut self) -> impl Future<Output = Result<Option<Vec<u8>>, ReadError>> + Send;
}
#[derive(Clone, Debug)]
pub struct GetRequest {
    path: String,
    query: Vec<(String, String)>,
    scope: SourceScope,
    deadline: Instant,
}
impl GetRequest {
    pub fn method(&self) -> &'static str {
        "GET"
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn tenant(&self) -> &str {
        &self.scope.collection_id
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub fn reject_redirects(&self) -> bool {
        true
    }
    pub fn deadline(&self) -> Instant {
        self.deadline
    }
}
pub struct GetResponse<B> {
    pub status: u16,
    /// Produced by approved source-bound transport, not inferred from HTTP headers.
    pub scope: SourceScope,
    pub redirected: bool,
    pub body: B,
}
/// A production driver must bind origin/tenant/credentials outside AT08, forbid
/// redirects, and honor cancellation. The fixture driver proves none of that.
pub trait Transport: Send {
    type Body: Body;
    fn get(
        &mut self,
        request: GetRequest,
    ) -> impl Future<Output = Result<GetResponse<Self::Body>, ReadError>> + Send;
}
pub trait Clock {
    fn now(&self) -> Timestamp;
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_page_size: usize,
    pub max_pages: usize,
    pub max_response_bytes: usize,
    pub max_generation_bytes: usize,
    pub request_timeout_ms: u64,
    pub generation_timeout_ms: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_page_size: 100,
            max_pages: 1000,
            max_response_bytes: 10_485_760,
            max_generation_bytes: 104_857_600,
            request_timeout_ms: 10_000,
            generation_timeout_ms: 120_000,
        }
    }
}
impl Limits {
    pub(super) fn validate(self) -> Result<(), ReadError> {
        let d = Self::default();
        for (v, max) in [
            (self.max_page_size as u64, d.max_page_size as u64),
            (self.max_pages as u64, d.max_pages as u64),
            (self.max_response_bytes as u64, d.max_response_bytes as u64),
            (
                self.max_generation_bytes as u64,
                d.max_generation_bytes as u64,
            ),
            (self.request_timeout_ms, d.request_timeout_ms),
            (self.generation_timeout_ms, d.generation_timeout_ms),
        ] {
            if v == 0 || v > max {
                return Err(invalid());
            }
        }
        Ok(())
    }
}

/// One mutable reader per registered partition. Exclusive borrowing serializes
/// reads; the shared service still serializes durable publication and fencing.
pub struct HomeBoxReader<T, C> {
    registration: SourceRegistration,
    scope: SourceScope,
    allowed: BTreeSet<Uuid>,
    transport: T,
    clock: C,
    limits: Limits,
    navigation: Option<NativeNavigation>,
    stock_navigation: Option<StockNavigation>,
    stock_dialect: bool,
}
impl<T: Transport, C: Clock> HomeBoxReader<T, C> {
    pub fn new(
        registration: SourceRegistration,
        transport: T,
        clock: C,
        limits: Limits,
        mut navigation: Option<NativeNavigation>,
    ) -> Result<Self, ReadError> {
        registration.validate()?;
        limits.validate()?;
        let scope = registration.scope();
        if let Some(n) = &mut navigation {
            n.validate(&scope)?;
        }
        let allowed = registration.allowed_external_ids.iter().cloned().collect();
        Ok(Self {
            registration,
            scope,
            allowed,
            transport,
            clock,
            limits,
            navigation,
            stock_navigation: None,
            stock_dialect: false,
        })
    }
    /// Trusted server selection of stock v0.26.2 decoding. Reference version
    /// selection does not establish the installed provider version or authority.
    pub fn new_stock(
        registration: SourceRegistration,
        transport: T,
        clock: C,
        limits: Limits,
        mut navigation: Option<StockNavigation>,
    ) -> Result<Self, ReadError> {
        let mut reader = Self::new(registration, transport, clock, limits, None)?;
        if let Some(n) = &mut navigation {
            n.validate(&reader.scope)?;
        }
        reader.stock_navigation = navigation;
        reader.stock_dialect = true;
        Ok(reader)
    }
    pub fn metadata_dialect(&self) -> &'static str {
        if self.stock_dialect {
            crate::providers::homebox::wire::DIALECT
        } else {
            METADATA_DIALECT
        }
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub(crate) fn registration(&self) -> &SourceRegistration {
        &self.registration
    }
    fn authorized(&self, id: &Uuid) -> bool {
        self.registration.partition_mode == PartitionMode::ExclusiveHome
            || self.allowed.contains(id)
    }
    fn check_parent(&self, row: &WireEntity) -> Result<(), ReadError> {
        if row.parent.as_ref().is_some_and(|p| !self.authorized(&p.id)) {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        Ok(())
    }

    /// Capture one original stock detail through the configured bounded GET
    /// transport. No caller-selected endpoint or writable snapshot is admitted.
    pub async fn capture_stock_entity(
        &mut self,
        id: &Uuid,
    ) -> Result<CapturedStockEntity, ReadError> {
        self.check_capture_owner(id)?;
        let path = format!("/api/v1/entities/{}", id.as_str());
        let query = Vec::new();
        let deadline = Instant::now() + Duration::from_millis(self.limits.generation_timeout_ms);
        let mut stats = ReadStats::default();
        let (bytes, retrieved_at, response_deadline, status) = self
            .request(path.clone(), query.clone(), deadline, &mut stats, None)
            .await?;
        // The pinned detail GET is a 200 JSON response, never partial content.
        if status != 200 {
            return Err(ReadError(ErrorCode::Upstream));
        }
        check_time(response_deadline)?;
        let decoded = crate::providers::homebox::wire::decode_detail(
            &bytes,
            id,
            native_capture::decode_limits(self.limits),
        )
        .map_err(native_capture::read_error)?;
        if decoded
            .value
            .entity
            .parent
            .as_ref()
            .is_some_and(|p| !self.authorized(&p.id))
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        check_time(response_deadline)?;
        Ok(NativeCapture::new(
            self.scope.clone(),
            id.clone(),
            path,
            query,
            status,
            retrieved_at,
            decoded,
        ))
    }

    /// Capture one fixed native attachment between two owner-detail GETs.
    /// The shared generation deadline and byte statistics cover all three.
    pub async fn capture_native_file_snapshot(
        &mut self,
        owner: &Uuid,
        attachment: &Uuid,
    ) -> Result<super::native_file_capture::CapturedNativeFileSnapshot, ReadError> {
        self.check_capture_owner(owner)?;
        if owner.as_str() == "00000000-0000-0000-0000-000000000000"
            || attachment.as_str() == "00000000-0000-0000-0000-000000000000"
        {
            return Err(invalid());
        }
        let detail_path = format!("/api/v1/entities/{}", owner.as_str());
        let file_path = format!("{detail_path}/attachments/{}", attachment.as_str());
        let deadline = Instant::now()
            + Duration::from_millis(self.limits.generation_timeout_ms)
                .min(super::native_file_capture::PINNED_FILE_CAPTURE_WINDOW);
        let mut stats = ReadStats::default();
        let (before, before_at, before_deadline, before_status) = self
            .request(detail_path.clone(), Vec::new(), deadline, &mut stats, None)
            .await?;
        if before_status != 200 {
            return Err(ReadError(ErrorCode::Upstream));
        }
        let before_decoded = crate::providers::homebox::wire::decode_detail(
            &before,
            owner,
            native_capture::decode_limits(self.limits),
        )
        .map_err(native_capture::read_error)?;
        self.check_file_parent(&before_decoded.value)?;
        let member = selected_stored_member(&before_decoded, owner, attachment)?;
        check_time(before_deadline)?;
        let (body, body_at, body_deadline, body_status) = self
            .request(file_path, Vec::new(), deadline, &mut stats, None)
            .await?;
        if body_status != 200 {
            return Err(ReadError(ErrorCode::Upstream));
        }
        if body.len() > crate::media::MAX_BYTES {
            return Err(ReadError(ErrorCode::SizeLimit));
        }
        check_time(body_deadline)?;
        let (after, after_at, after_deadline, after_status) = self
            .request(detail_path, Vec::new(), deadline, &mut stats, None)
            .await?;
        if after_status != 200 {
            return Err(ReadError(ErrorCode::Upstream));
        }
        let after_decoded = crate::providers::homebox::wire::decode_detail(
            &after,
            owner,
            native_capture::decode_limits(self.limits),
        )
        .map_err(native_capture::read_error)?;
        self.check_file_parent(&after_decoded.value)?;
        if selected_stored_member(&after_decoded, owner, attachment)? != member {
            return Err(ReadError(ErrorCode::Upstream));
        }
        check_time(after_deadline)?;
        check_time(deadline)?;
        Ok(
            super::native_file_capture::CapturedNativeFileSnapshot::from_reader(
                self.scope.clone(),
                owner.clone(),
                attachment.clone(),
                (before, before_at, before_status),
                (body, body_at, body_status),
                (after, after_at, after_status),
                member,
            ),
        )
    }
    fn check_file_parent(
        &self,
        detail: &crate::providers::homebox::wire::Detail,
    ) -> Result<(), ReadError> {
        if detail
            .entity
            .parent
            .as_ref()
            .is_some_and(|parent| !self.authorized(&parent.id))
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        Ok(())
    }

    /// Capture the original owner log using the fixed native status=both query.
    /// Its decoded entries do not assert completeness or installed API behavior.
    pub async fn capture_stock_maintenance(
        &mut self,
        id: &Uuid,
    ) -> Result<CapturedStockMaintenance, ReadError> {
        self.check_capture_owner(id)?;
        let path = format!("/api/v1/entities/{}/maintenance", id.as_str());
        let query = vec![("status".into(), "both".into())];
        let deadline = Instant::now() + Duration::from_millis(self.limits.generation_timeout_ms);
        let mut stats = ReadStats::default();
        let (bytes, retrieved_at, response_deadline, status) = self
            .request(path.clone(), query.clone(), deadline, &mut stats, None)
            .await?;
        if status != 200 {
            return Err(ReadError(ErrorCode::Upstream));
        }
        check_time(response_deadline)?;
        let decoded = crate::providers::homebox::wire::decode_maintenance(
            &bytes,
            id,
            native_capture::decode_limits(self.limits),
        )
        .map_err(native_capture::read_error)?;
        check_time(response_deadline)?;
        Ok(NativeCapture::new(
            self.scope.clone(),
            id.clone(),
            path,
            query,
            status,
            retrieved_at,
            decoded,
        ))
    }

    fn check_capture_owner(&self, id: &Uuid) -> Result<(), ReadError> {
        if !self.stock_dialect {
            return Err(invalid());
        }
        if !self.authorized(id) {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        Ok(())
    }

    /// No parent-filter argument exists on this full-generation operation.
    /// ID is minted by the server coordinator, never by the upstream provider.
    pub async fn fetch_generation(
        &mut self,
        previous: Option<&PreviousGeneration>,
        generation_id: Uuid,
    ) -> Result<CompleteGeneration, FailedRead> {
        let attempt = self.clock.now();
        let deadline = Instant::now() + Duration::from_millis(self.limits.generation_timeout_ms);
        let mut stats = ReadStats::default();
        let mut native_responses = Vec::new();
        let empty = PreviousGeneration::new(CacheStatus::empty(&self.scope), Vec::new(), false);
        let previous = previous.unwrap_or(&empty);
        if let Err(e) = self.validate_previous(previous, deadline) {
            // Invalid prior state is not a cache update proposal, especially across scopes.
            return Err(self.failure(e, &attempt, None, false, stats));
        }
        let result = self
            .read(
                &[],
                deadline,
                &mut stats,
                self.stock_dialect.then_some(&mut native_responses),
            )
            .await
            .and_then(|entities| {
                let success = self.clock.now();
                if success.instant() < attempt.instant()
                    || previous
                        .cache
                        .last_successful_fetch_at
                        .as_ref()
                        .is_some_and(|p| success.instant() < p.instant())
                    || entities
                        .iter()
                        .any(|p| p.retrieved_at.instant() > success.instant())
                {
                    return Err(invalid());
                }
                self.validate_entities(&entities, deadline)?;
                let present: BTreeSet<_> = entities.iter().map(|p| &p.entity.id).collect();
                let missing = previous
                    .entities
                    .iter()
                    .filter(|p| !present.contains(&p.entity.id))
                    .map(|p| p.entity.id.clone())
                    .collect();
                let mut cache = CacheStatus::empty(&self.scope);
                cache.status = CacheState::Fresh;
                cache.last_attempt_at = Some(attempt.clone());
                cache.last_successful_fetch_at = Some(success);
                cache.generation_id = Some(generation_id.clone());
                check_time(deadline)?;
                Ok(CompleteGeneration {
                    cache,
                    homebox_entities: entities,
                    missing_external_ids: missing,
                    quarantine: previous.quarantine || previous.cache.quarantined(),
                    stats,
                    native_presence: self.stock_dialect.then(|| {
                        NativePresenceGeneration::new(
                            self.registration.clone(),
                            self.scope.clone(),
                            generation_id,
                            native_responses,
                        )
                    }),
                })
            });
        result.map_err(|e| self.failure(e, &attempt, Some(previous), false, stats))
    }

    pub async fn fetch_view(&mut self, parent_ids: &[Uuid]) -> Result<FilteredView, FailedRead> {
        let attempt = self.clock.now();
        let deadline = Instant::now() + Duration::from_millis(self.limits.generation_timeout_ms);
        let mut stats = ReadStats::default();
        let parents: Vec<_> = parent_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let validation = if parents.is_empty() || parents.len() > self.limits.max_page_size {
            Err(ReadError(ErrorCode::Pagination))
        } else if parents.iter().any(|id| !self.authorized(id)) {
            Err(ReadError(ErrorCode::WrongScope))
        } else {
            Ok(())
        };
        if let Err(e) = validation {
            return Err(self.failure(e, &attempt, None, true, stats));
        }
        let result = self
            .read(&parents, deadline, &mut stats, None)
            .await
            .and_then(|entities| {
                self.validate_entities(&entities, deadline)?;
                check_time(deadline)?;
                Ok(FilteredView {
                    homebox_entities: entities,
                    stats,
                })
            });
        result.map_err(|e| self.failure(e, &attempt, None, true, stats))
    }

    fn failure(
        &self,
        e: ReadError,
        attempt: &Timestamp,
        previous: Option<&PreviousGeneration>,
        filtered: bool,
        stats: ReadStats,
    ) -> FailedRead {
        let error = CacheError {
            code: e.0,
            at: self.clock.now(),
            message: e.0.message(),
        };
        let quarantined =
            e.0.quarantines() || previous.is_some_and(|p| p.quarantine || p.cache.quarantined());
        let cache = previous.map(|previous| {
            let mut cache = previous.cache.clone();
            cache.last_attempt_at = Some(attempt.clone());
            cache.status = if quarantined {
                CacheState::AccessRevoked
            } else {
                CacheState::Error
            };
            cache.error = Some(error.clone());
            Box::new(cache)
        });
        FailedRead {
            cache,
            error,
            quarantine: if filtered {
                e.0.quarantines().then_some(true)
            } else {
                Some(quarantined)
            },
            quarantine_transition: if e.0.quarantines() {
                QuarantineTransition::Quarantine
            } else {
                QuarantineTransition::Preserve
            },
            stats,
        }
    }

    async fn request(
        &mut self,
        path: String,
        query: Vec<(String, String)>,
        generation_deadline: Instant,
        stats: &mut ReadStats,
        capture: Option<&mut Vec<NativePresenceResponse>>,
    ) -> Result<(Vec<u8>, Timestamp, Instant, u16), ReadError> {
        check_time(generation_deadline)?;
        let deadline = (Instant::now() + Duration::from_millis(self.limits.request_timeout_ms))
            .min(generation_deadline);
        let capture_path = path.clone();
        let capture_query = query.clone();
        let response_limit = if super::http_transport::attachment_path(&path) {
            self.limits.max_response_bytes.min(crate::media::MAX_BYTES)
        } else {
            self.limits.max_response_bytes
        };
        let request = GetRequest {
            path,
            query,
            scope: self.scope.clone(),
            deadline,
        };
        stats.requests += 1;
        let operation = async {
            let mut response = self.transport.get(request).await?;
            check_time(deadline)?;
            if response.redirected || (300..400).contains(&response.status) {
                return Err(ReadError(ErrorCode::Upstream));
            }
            if matches!(response.status, 401 | 403) {
                return Err(ReadError(ErrorCode::Auth));
            }
            if !(200..300).contains(&response.status) {
                return Err(ReadError(ErrorCode::Upstream));
            }
            if response.scope != self.scope {
                return Err(ReadError(ErrorCode::WrongScope));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.body.next_chunk().await? {
                check_time(deadline)?;
                let response_size = bytes
                    .len()
                    .checked_add(chunk.len())
                    .ok_or(ReadError(ErrorCode::SizeLimit))?;
                stats.bytes = stats
                    .bytes
                    .checked_add(chunk.len())
                    .ok_or(ReadError(ErrorCode::SizeLimit))?;
                if response_size > response_limit || stats.bytes > self.limits.max_generation_bytes
                {
                    return Err(ReadError(ErrorCode::SizeLimit));
                }
                bytes.extend_from_slice(&chunk);
            }
            check_time(deadline)?;
            let retrieved_at = self.clock.now();
            check_time(deadline)?;
            Ok((bytes, retrieved_at, deadline, response.status))
        };
        let response = timeout_at(deadline, operation)
            .await
            .map_err(|_| ReadError(ErrorCode::Timeout))??;
        if let Some(capture) = capture {
            let (bytes, retrieved_at, _, status) = &response;
            capture.push(NativePresenceResponse::new(
                capture_path,
                capture_query,
                self.scope.clone(),
                *status,
                retrieved_at.clone(),
                bytes.clone(),
            ));
        }
        Ok(response)
    }

    async fn read(
        &mut self,
        parents: &[Uuid],
        deadline: Instant,
        stats: &mut ReadStats,
        mut native_responses: Option<&mut Vec<NativePresenceResponse>>,
    ) -> Result<Vec<Projection>, ReadError> {
        let mut rows: BTreeMap<Uuid, (WireEntity, serde_json::Value)> = BTreeMap::new();
        for is_location in [true, false] {
            let mut total = None;
            let mut page = 1u64;
            let mut fetched = 0u64;
            loop {
                check_time(deadline)?;
                stats.pages += 1;
                if stats.pages > self.limits.max_pages {
                    return Err(ReadError(ErrorCode::Pagination));
                }
                let mut query = vec![
                    ("isLocation".into(), is_location.to_string()),
                    ("includeArchived".into(), "true".into()),
                    ("page".into(), page.to_string()),
                    ("pageSize".into(), self.limits.max_page_size.to_string()),
                ];
                query.extend(
                    parents
                        .iter()
                        .map(|id| ("parentIds".into(), id.as_str().to_owned())),
                );
                let (bytes, _, response_deadline, _) = self
                    .request(
                        "/api/v1/entities".into(),
                        query,
                        deadline,
                        stats,
                        native_responses.as_deref_mut(),
                    )
                    .await?;
                check_time(response_deadline)?;
                let value = if self.stock_dialect {
                    stock::page(&bytes, page, is_location, parents, self.limits)?
                } else {
                    decode::parse(&bytes)?
                };
                check_time(response_deadline)?;
                check_time(deadline)?;
                let data = decode::page(value)?;
                if data.page != page
                    || data.page_size != self.limits.max_page_size as u64
                    || total.is_some_and(|t| data.total != t)
                    || data.total > (self.limits.max_pages * self.limits.max_page_size) as u64
                {
                    return Err(ReadError(ErrorCode::Pagination));
                }
                total = Some(data.total);
                let expected = data.page_size.min(data.total.saturating_sub(fetched));
                if data.items.len() as u64 != expected {
                    return Err(ReadError(ErrorCode::Pagination));
                }
                for raw in data.items {
                    check_time(deadline)?;
                    let (row, normalized) = decode::wire(raw)?;
                    if row
                        .entity_type
                        .as_ref()
                        .is_some_and(|t| t.is_location != is_location)
                        || (!parents.is_empty()
                            && !row.parent.as_ref().is_some_and(|p| parents.contains(&p.id)))
                    {
                        return Err(ReadError(ErrorCode::Pagination));
                    }
                    if let Some((_, existing)) = rows.get(&row.id) {
                        if existing != &normalized {
                            return Err(ReadError(ErrorCode::Pagination));
                        }
                    } else {
                        rows.insert(row.id.clone(), (row, normalized));
                    }
                }
                fetched += expected;
                if fetched == data.total {
                    break;
                }
                page += 1;
            }
        }
        let mut projections = Vec::new();
        for (id, (listed, _)) in rows {
            check_time(deadline)?;
            if !self.authorized(&id) {
                continue;
            }
            self.check_parent(&listed)?;
            let (bytes, _, response_deadline, _) = self
                .request(
                    format!("/api/v1/entities/{}", id.as_str()),
                    Vec::new(),
                    deadline,
                    stats,
                    native_responses.as_deref_mut(),
                )
                .await?;
            check_time(response_deadline)?;
            let value = if self.stock_dialect {
                stock::detail(&bytes, &id, self.limits)?
            } else {
                decode::parse(&bytes)?
            };
            check_time(response_deadline)?;
            check_time(deadline)?;
            let (detail, raw) = decode::wire(value)?;
            if detail.id != id {
                return Err(ReadError(ErrorCode::WrongScope));
            }
            self.check_parent(&detail)?;
            if detail != listed {
                return Err(ReadError(ErrorCode::Pagination));
            }
            let (bytes, retrieved_at, response_deadline, _) = self
                .request(
                    format!("/api/v1/entities/{}/maintenance", id.as_str()),
                    if self.stock_dialect {
                        vec![("status".into(), "both".into())]
                    } else {
                        Vec::new()
                    },
                    deadline,
                    stats,
                    native_responses.as_deref_mut(),
                )
                .await?;
            check_time(response_deadline)?;
            let maintenance = if self.stock_dialect {
                stock::maintenance(&bytes, &id, self.limits)?
            } else {
                decode::parse(&bytes)?
            };
            check_time(response_deadline)?;
            check_time(deadline)?;
            let navigation = if self.stock_dialect {
                self.stock_navigation
                    .as_ref()
                    .and_then(|n| n.for_entity(&detail))
            } else {
                self.navigation.as_ref()
            };
            projections.push(decode::projection(
                raw,
                detail,
                maintenance,
                &self.scope,
                retrieved_at,
                navigation,
            )?);
            check_time(deadline)?;
        }
        Ok(projections)
    }

    fn validate_previous(
        &self,
        p: &PreviousGeneration,
        deadline: Instant,
    ) -> Result<(), ReadError> {
        if p.cache.scope() != self.scope {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        let c = &p.cache;
        if c.schema_version != 1
            || c.consistency != CONSISTENCY
            || c.last_successful_fetch_at.is_some() != c.generation_id.is_some()
            || (c.status == CacheState::Fresh
                && (c.last_successful_fetch_at.is_none() || c.error.is_some()))
            || (c.status == CacheState::Empty && c.last_successful_fetch_at.is_some())
            || (c.status == CacheState::Error && c.error.is_none())
            || c.error
                .as_ref()
                .is_some_and(|e| e.message != e.code.message())
            || p.entities.iter().any(|e| {
                c.last_successful_fetch_at
                    .as_ref()
                    .is_none_or(|s| e.retrieved_at.instant() > s.instant())
            })
        {
            return Err(invalid());
        }
        self.validate_entities(&p.entities, deadline)
    }
    fn validate_entities(
        &self,
        entities: &[Projection],
        deadline: Instant,
    ) -> Result<(), ReadError> {
        let mut records = BTreeMap::new();
        for (i, p) in entities.iter().enumerate() {
            check_time(deadline)?;
            decode::validate_projection(p, &self.scope)?;
            if !self.authorized(&p.entity.id)
                || p.entity
                    .parent
                    .as_ref()
                    .is_some_and(|p| !self.authorized(&p.id))
            {
                return Err(ReadError(ErrorCode::WrongScope));
            }
            if records.insert(&p.entity.id, i).is_some() {
                return Err(invalid());
            }
        }
        // Each in-generation parent edge is walked at most once; missing parents
        // are preserved as source facts rather than inferred placement/deletion.
        let mut states = vec![0u8; entities.len()];
        for start in 0..entities.len() {
            let mut next = Some(start);
            let mut trail = Vec::new();
            while let Some(i) = next {
                check_time(deadline)?;
                if states[i] == 2 {
                    break;
                }
                if states[i] == 1 {
                    return Err(invalid());
                }
                states[i] = 1;
                trail.push(i);
                next = entities[i]
                    .entity
                    .parent
                    .as_ref()
                    .and_then(|p| records.get(&p.id).copied());
            }
            for i in trail {
                states[i] = 2;
            }
        }
        Ok(())
    }
}
fn check_time(deadline: Instant) -> Result<(), ReadError> {
    if Instant::now() >= deadline {
        Err(ReadError(ErrorCode::Timeout))
    } else {
        Ok(())
    }
}

fn selected_stored_member(
    detail: &crate::providers::homebox::wire::Decoded<crate::providers::homebox::wire::Detail>,
    owner: &Uuid,
    attachment: &Uuid,
) -> Result<serde_json::Value, ReadError> {
    if detail.source["id"].as_str() != Some(owner.as_str()) {
        return Err(invalid());
    }
    let rows = detail.source["attachments"]
        .as_array()
        .ok_or_else(invalid)?;
    let mut selected = rows
        .iter()
        .filter(|row| row["id"].as_str() == Some(attachment.as_str()));
    let member = selected.next().ok_or_else(invalid)?;
    if selected.next().is_some() || member["mimeType"].as_str() == Some("link/url")
        || !detail.value.attachments.iter().any(|entry| matches!(entry, Attachment::StoredFile { attachment_id, .. } if attachment_id == attachment)) {
        return Err(invalid());
    }
    Ok(member.clone())
}
