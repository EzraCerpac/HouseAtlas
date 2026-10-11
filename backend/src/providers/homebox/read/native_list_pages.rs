//! Bounded process-local continuation of one configured, complete native GET.
//! Cursors select retained data; fresh original authority is required per page.
use super::{
    Clock, NativeReadCredentialConfig, SourceScope, Timestamp, Uuid,
    native_query::{NativeReadCapture, RetainedCapture},
    query::{DecodedReadObservation, HomeBoxReadQuery, ReadSelection, ResourcePage, SourceStatus},
};
use crate::{
    access as a,
    config::providers::homebox::TrustedHomeBoxSource,
    contracts::stock::{HomeboxResourceKind, StockTarget},
    domain::stock as st,
    providers::homebox::wire,
    storage as s,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeSet, VecDeque},
    io::{self, Write},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};

const CAPTURES: usize = 32;
const SESSION_CAPTURES: usize = 4;
pub(super) const TOKENS: usize = 1000;
const BYTES: usize = 64 * 1024 * 1024;
const WINDOW: Duration = Duration::from_secs(300);

/// Current request references, not an issuer of Store baseline authority.
pub struct NativeListReadRequest<'a, 'p> {
    configured: &'a Arc<TrustedHomeBoxSource>,
    captured: &'a st::CapturedAccess<'p>,
    request: &'a st::ValidatedRequest,
    baseline: &'a s::RegisteredCacheRead,
    query: HomeBoxReadQuery,
    owner: Uuid,
}
impl<'a, 'p> NativeListReadRequest<'a, 'p> {
    pub fn select(
        configured: &'a Arc<TrustedHomeBoxSource>,
        captured: &'a st::CapturedAccess<'p>,
        request: &'a st::ValidatedRequest,
        baseline: &'a s::RegisteredCacheRead,
    ) -> st::StockResult<Self> {
        let query = HomeBoxReadQuery::from_request(request)?;
        let ReadSelection::Resources {
            operation,
            page: Some(page),
        } = query.selection()
        else {
            return Err(unavailable());
        };
        if !matches!(
            operation,
            st::OperationId::HomeboxFieldList | st::OperationId::HomeboxMaintenanceList
        ) || !(1..=100).contains(&page.page_size)
            || configured.metadata_dialect() != wire::DIALECT
            || query.scope() != &configured.scope()
            || baseline.registration != *configured.registration()
        {
            return Err(unavailable());
        }
        let owner = Uuid::parse(request.target()["entityId"].as_str().ok_or_else(changed)?)
            .map_err(|_| changed())?;
        check_members(configured, captured, owner.as_str())?;
        Ok(Self {
            configured,
            captured,
            request,
            baseline,
            query,
            owner,
        })
    }
    fn cursor(&self) -> Option<&str> {
        self.request.payload()["cursor"].as_str()
    }
    fn page_size(&self) -> usize {
        // Reuse the validated integral decoder, including valid 1.0 spelling.
        match self.query.selection() {
            ReadSelection::Resources {
                page: Some(page), ..
            } => page.page_size as usize,
            _ => 0,
        }
    }
}

#[derive(PartialEq, Eq)]
struct Binding {
    session: [u8; 32],
    actor: String,
    metadata: a::SourceAuthorityMetadata,
}

/// Owned configured GET custody. No old principal, grant, credential, witness,
/// reader, Access/Store handle or public DATA constructor is retained.
pub struct NativeListSnapshot {
    issuer: Arc<()>,
    configured: Arc<TrustedHomeBoxSource>,
    capture: RetainedCapture,
    original: Value,
    binding: Binding,
    baseline: s::RegisteredCacheRead,
    page: ResourcePage,
    selected_positions: Vec<usize>,
    references: Vec<StockTarget>,
    parents: Vec<(StockTarget, StockTarget)>,
    owner: Uuid,
    expires: Instant,
}
impl NativeListSnapshot {
    pub fn original_bytes(&self) -> &[u8] {
        self.capture.original_bytes()
    }
    pub fn retrieved_at(&self) -> &Timestamp {
        self.capture.retrieved_at()
    }
    pub fn references(&self) -> &[StockTarget] {
        &self.references
    }
    pub fn parent_relations(&self) -> &[(StockTarget, StockTarget)] {
        &self.parents
    }
    /// Correlation DATA; the Root owner still reads/revalidates the actual Store.
    pub fn baseline(&self) -> &s::RegisteredCacheRead {
        &self.baseline
    }
    pub fn same_capture(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.issuer, &other.issuer)
    }
    pub(super) fn scope(&self) -> &SourceScope {
        &self.page.scope
    }
    pub(super) fn source_json(&self) -> &Value {
        match &self.capture {
            RetainedCapture::Detail(c) => c.source_json(),
            RetainedCapture::Maintenance(c) => c.source_json(),
            RetainedCapture::List(c) => c.source_json(),
        }
    }
    pub(crate) fn revalidate_captured(
        &self,
        access: &mut a::AccessBoundary,
        captured: &st::CapturedAccess<'_>,
    ) -> st::StockResult<()> {
        self.check_window()?;
        if binding(access, &self.configured, captured, self.owner.as_str())? != self.binding {
            return Err(changed());
        }
        self.check_window()
    }
    fn check_window(&self) -> st::StockResult<()> {
        if Instant::now() >= self.expires {
            return Err(unavailable());
        }
        Ok(())
    }
    fn matches(&self, current: &NativeListReadRequest<'_, '_>, now: &Binding) -> bool {
        Arc::ptr_eq(&self.configured, current.configured)
            && self.binding == *now
            && self.baseline == *current.baseline
            && self.owner == current.owner
            && same_intent(&self.original, current.request.raw())
    }
    fn page(
        &self,
        offset: usize,
        size: usize,
        next: Option<String>,
    ) -> st::StockResult<ResourcePage> {
        self.check_window()?;
        if size == 0 || offset > self.selected_positions.len() {
            return Err(changed());
        }
        let end = offset
            .checked_add(size)
            .ok_or_else(unavailable)?
            .min(self.selected_positions.len());
        Ok(ResourcePage {
            scope: self.page.scope.clone(),
            resources: self.selected_positions[offset..end]
                .iter()
                .map(|position| self.page.resources[*position].clone())
                .collect(),
            next_cursor: next,
            source_status: SourceStatus::Unresolved,
        })
    }
}

struct Cursor {
    token: String,
    offset: usize,
}
struct Entry {
    snapshot: Arc<NativeListSnapshot>,
    cursors: Vec<Cursor>,
    bytes: usize,
}
#[derive(Default)]
struct Registry {
    entries: VecDeque<Entry>,
}

/// One shared, non-persistent registry for authenticated configured transports.
/// A token is never a grant or a reconstructed native/provider cursor.
pub struct NativeListPages {
    registry: Mutex<Registry>,
}
impl Default for NativeListPages {
    fn default() -> Self {
        Self::new()
    }
}
impl NativeListPages {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(Registry::default()),
        }
    }

    pub async fn capture_configured<'a, 'p, C: st::StockContractPort>(
        &self,
        contracts: &C,
        access: &Arc<Mutex<a::AccessBoundary>>,
        credentials: &Arc<NativeReadCredentialConfig>,
        selected: NativeListReadRequest<'a, 'p>,
    ) -> st::StockResult<NativeReadCapture<'a, 'p>> {
        let started = Instant::now();
        let expires = started.checked_add(WINDOW).ok_or_else(unavailable)?;
        if selected.cursor().is_some() {
            return Err(changed());
        }
        // Bound owned context before clones, credential binding or native IO.
        let context_bytes = context_size(&selected)?;
        let before = {
            let mut owner = access.lock().map_err(|_| unavailable())?;
            binding(
                &mut owner,
                selected.configured,
                selected.captured,
                selected.owner.as_str(),
            )?
        };
        let endpoint = selected.configured.endpoint().map_err(|_| unavailable())?;
        if !credentials.matches_endpoint(&endpoint) {
            return Err(changed());
        }
        let credential_owner = credentials
            .bind_original(
                Arc::clone(access),
                selected.captured.principal(),
                selected.captured.source_grants()[0].clone(),
                selected.captured.partition_grants()[0].clone(),
            )
            .map_err(|_| unavailable())?;
        let mut reader = selected
            .configured
            .reader(credential_owner, HostClock)
            .map_err(|_| unavailable())?;
        // Actual configured HTTP only; no lock or caller transport crosses IO.
        let capture = if selected.request.id() == st::OperationId::HomeboxFieldList {
            let c = reader
                .capture_stock_entity(&selected.owner)
                .await
                .map_err(|_| unavailable())?;
            if c.scope() != selected.query.scope()
                || c.entity_id() != &selected.owner
                || c.status() != 200
                || c.method() != "GET"
                || !c.query().is_empty()
                || c.path() != format!("/api/v1/entities/{}", selected.owner.as_str())
            {
                return Err(changed());
            }
            RetainedCapture::Detail(Box::new(c))
        } else {
            let c = reader
                .capture_stock_maintenance(&selected.owner)
                .await
                .map_err(|_| unavailable())?;
            if c.scope() != selected.query.scope()
                || c.entity_id() != &selected.owner
                || c.status() != 200
                || c.method() != "GET"
                || c.query() != [("status".into(), "both".into())]
                || c.path() != format!("/api/v1/entities/{}/maintenance", selected.owner.as_str())
            {
                return Err(changed());
            }
            RetainedCapture::Maintenance(Box::new(c))
        };
        {
            let mut owner = access.lock().map_err(|_| unavailable())?;
            if binding(
                &mut owner,
                selected.configured,
                selected.captured,
                selected.owner.as_str(),
            )? != before
            {
                return Err(changed());
            }
        }
        // Validate unknown/native containers as well as all projected members.
        wire::parse_observation(capture.original_bytes(), wire::DecodeLimits::default())
            .map_err(|_| unavailable())?;
        let (page, references, parents) = DecodedReadObservation::complete_native_list(
            contracts,
            selected.request,
            &capture,
            expires,
        )?;
        let mut count = Count::new();
        count.add(context_bytes)?;
        // Raw, parsed source, typed decoder-owned strings/containers: a
        // conservative fourfold raw allowance avoids omitting retained copies.
        count.add(
            capture
                .original_bytes()
                .len()
                .checked_mul(4)
                .ok_or_else(unavailable)?,
        )?;
        count.value(&page.resources)?;
        count.value(&references)?;
        count.value(&parents)?;
        count.value(&metadata_data(&before.metadata))?;
        count.value(&before.actor)?;
        count.add(before.session.len())?;
        // Full decode, member validation, graph and retained-byte accounting
        // precede the adopted local selector. It cannot hide an invalid member.
        let ReadSelection::Resources {
            page: Some(query), ..
        } = selected.query.selection()
        else {
            return Err(changed());
        };
        let selected_positions = selected_positions(query.q.as_deref(), &page, expires)?;
        count.add(
            selected_positions
                .len()
                .checked_mul(size_of::<usize>())
                .ok_or_else(unavailable)?,
        )?;
        let snapshot = Arc::new(NativeListSnapshot {
            issuer: Arc::new(()),
            configured: Arc::clone(selected.configured),
            capture,
            original: selected.request.raw().clone(),
            binding: before,
            baseline: selected.baseline.clone(),
            page,
            selected_positions,
            references,
            parents,
            owner: selected.owner.clone(),
            expires,
        });
        snapshot.check_window()?;
        let next = self.admit(Arc::clone(&snapshot), selected.page_size(), count.bytes)?;
        self.capture_page(contracts, access, selected, snapshot, 0, next)
    }

    pub fn continue_original<'a, 'p, C: st::StockContractPort>(
        &self,
        contracts: &C,
        access: &Arc<Mutex<a::AccessBoundary>>,
        selected: NativeListReadRequest<'a, 'p>,
    ) -> st::StockResult<NativeReadCapture<'a, 'p>> {
        let token = selected.cursor().ok_or_else(changed)?;
        let current = {
            let mut owner = access.lock().map_err(|_| unavailable())?;
            binding(
                &mut owner,
                selected.configured,
                selected.captured,
                selected.owner.as_str(),
            )?
        };
        let (snapshot, offset, next) = {
            let mut registry = self.registry.lock().map_err(|_| unavailable())?;
            prune(&mut registry);
            let (entry, cursor) = registry
                .entries
                .iter()
                .find_map(|entry| {
                    entry
                        .cursors
                        .iter()
                        .find(|c| c.token == token)
                        .map(|c| (entry, c))
                })
                .ok_or_else(unavailable)?;
            if !entry.snapshot.matches(&selected, &current) {
                return Err(changed());
            }
            let end = cursor
                .offset
                .checked_add(selected.page_size())
                .ok_or_else(unavailable)?;
            let next = entry
                .cursors
                .iter()
                .find(|c| c.offset == end)
                .map(|c| c.token.clone());
            (Arc::clone(&entry.snapshot), cursor.offset, next)
        };
        // No retained registry mutex while Access/Domain/Store owners run.
        let terminal = next.is_none();
        let captured = self.capture_page(
            contracts,
            access,
            selected,
            Arc::clone(&snapshot),
            offset,
            next,
        )?;
        if terminal {
            // The returned capture owns this same snapshot. Retire only its
            // process-local cursor chain after successful final-page checks.
            let mut registry = self.registry.lock().map_err(|_| unavailable())?;
            registry
                .entries
                .retain(|entry| !Arc::ptr_eq(&entry.snapshot, &snapshot));
        }
        Ok(captured)
    }

    fn capture_page<'a, 'p, C: st::StockContractPort>(
        &self,
        contracts: &C,
        access: &Arc<Mutex<a::AccessBoundary>>,
        selected: NativeListReadRequest<'a, 'p>,
        snapshot: Arc<NativeListSnapshot>,
        offset: usize,
        next: Option<String>,
    ) -> st::StockResult<NativeReadCapture<'a, 'p>> {
        let page = snapshot.page(offset, selected.page_size(), next)?;
        let observation = DecodedReadObservation::from_native_list_page(
            contracts,
            selected.request,
            &snapshot,
            page,
        )?;
        NativeReadCapture::from_list(access, selected.captured, snapshot, observation)
    }

    fn admit(
        &self,
        snapshot: Arc<NativeListSnapshot>,
        size: usize,
        bytes: usize,
    ) -> st::StockResult<Option<String>> {
        snapshot.check_window()?;
        let slots = snapshot.selected_positions.len().saturating_sub(1) / size;
        if slots == 0 {
            return Ok(None);
        }
        if slots > TOKENS {
            return Err(unavailable());
        }
        let mut registry = self.registry.lock().map_err(|_| unavailable())?;
        prune(&mut registry);
        let session_captures = registry
            .entries
            .iter()
            .filter(|entry| entry.snapshot.binding.session == snapshot.binding.session)
            .count();
        let used_tokens: usize = registry.entries.iter().map(|e| e.cursors.len()).sum();
        let used_bytes: usize = registry.entries.iter().map(|e| e.bytes).sum();
        let bytes = bytes
            .checked_add(
                slots
                    .checked_mul(43 + size_of::<Cursor>())
                    .ok_or_else(unavailable)?,
            )
            .ok_or_else(unavailable)?;
        if registry.entries.len() >= CAPTURES
            || session_captures >= SESSION_CAPTURES
            || slots > TOKENS.saturating_sub(used_tokens)
            || bytes > BYTES.saturating_sub(used_bytes)
        {
            return Err(unavailable());
        }
        let mut tokens: BTreeSet<String> = registry
            .entries
            .iter()
            .flat_map(|e| e.cursors.iter().map(|c| c.token.clone()))
            .collect();
        let mut cursors = Vec::with_capacity(slots);
        for index in 1..=slots {
            let mut random = [0_u8; 32];
            getrandom::fill(&mut random).map_err(|_| unavailable())?;
            let token = URL_SAFE_NO_PAD.encode(random);
            if !tokens.insert(token.clone()) {
                return Err(unavailable());
            }
            cursors.push(Cursor {
                token,
                offset: index.checked_mul(size).ok_or_else(unavailable)?,
            });
        }
        snapshot.check_window()?;
        let first = cursors.first().map(|c| c.token.clone());
        registry.entries.push_back(Entry {
            snapshot,
            cursors,
            bytes,
        });
        Ok(first)
    }
}

/// The adopted stock.2 public-member selector, not upstream entity search.
/// Only the configured producer calls it after validating the complete list.
fn selected_positions(
    q: Option<&str>,
    complete: &ResourcePage,
    expires: Instant,
) -> st::StockResult<Vec<usize>> {
    // Preserve the original optional string in intent; lowercase is temporary
    // comparison work only. In particular, None and Some("") remain distinct.
    let needle = q.filter(|q| !q.is_empty()).map(str::to_lowercase);
    let mut selected = Vec::new();
    for (position, resource) in complete.resources.iter().enumerate() {
        if Instant::now() >= expires {
            return Err(unavailable());
        }
        let matches = match &needle {
            None => true,
            Some(needle) => matches_public_member(resource, needle)?,
        };
        if matches {
            selected.push(position);
        }
    }
    Ok(selected)
}

/// Independent public strings only; this receives already validated members.
fn matches_public_member(
    resource: &super::query::ResourceView,
    needle: &str,
) -> st::StockResult<bool> {
    let matches = |text: &str| text.to_lowercase().contains(needle);
    let name = resource.data["name"]
        .as_str()
        .ok_or(st::StockError::InvalidContract)?;
    if matches(name) {
        return Ok(true);
    }
    match &resource.target {
        StockTarget::Homebox {
            resource_kind: HomeboxResourceKind::Field,
            ..
        } => {
            let value = &resource.data["value"];
            match value["kind"].as_str() {
                Some("text") => Ok(matches(
                    value["value"]
                        .as_str()
                        .ok_or(st::StockError::InvalidContract)?,
                )),
                Some("number") => Ok(matches(
                    &value["value"]
                        .as_i64()
                        .ok_or(st::StockError::InvalidContract)?
                        .to_string(),
                )),
                Some("boolean") => Ok(matches(
                    if value["value"]
                        .as_bool()
                        .ok_or(st::StockError::InvalidContract)?
                    {
                        "true"
                    } else {
                        "false"
                    },
                )),
                // The original native projection exposes no time value. Do
                // not search the kind/reason or fabricate a value placeholder.
                Some("time") => Ok(false),
                _ => Err(st::StockError::InvalidContract),
            }
        }
        StockTarget::Homebox {
            resource_kind: HomeboxResourceKind::Maintenance,
            ..
        } => match resource.data.get("description") {
            Some(Value::String(description)) => Ok(matches(description)),
            None => Ok(false),
            _ => Err(st::StockError::InvalidContract),
        },
        _ => Err(st::StockError::InvalidContract),
    }
}

fn prune(registry: &mut Registry) {
    let now = Instant::now();
    registry.entries.retain(|e| e.snapshot.expires > now);
}

fn check_members(
    configured: &TrustedHomeBoxSource,
    captured: &st::CapturedAccess<'_>,
    owner: &str,
) -> st::StockResult<()> {
    if captured.source_grants().len() != 1 || captured.partition_grants().len() != 1 {
        return Err(changed());
    }
    let scope = configured.scope();
    let partition = captured.partition_grants()[0].partition();
    let source = captured.source_grants()[0].reference();
    let principal = captured.principal();
    if partition.workspace_id.as_str() != scope.workspace_id.as_str()
        || partition.home_id.as_str() != scope.home_id.as_str()
        || partition.source_instance_id.as_str() != scope.source_instance_id.as_str()
        || partition.collection_id != scope.collection_id
        || principal.scope().workspace_id != partition.workspace_id
        || principal.scope().home_id != partition.home_id
        || source.partition() != *partition
        || source.key.source_kind != a::SourceKind::HomeboxEntity
        || source.key.external_id != owner
    {
        return Err(changed());
    }
    Ok(())
}

fn binding(
    access: &mut a::AccessBoundary,
    configured: &TrustedHomeBoxSource,
    captured: &st::CapturedAccess<'_>,
    owner: &str,
) -> st::StockResult<Binding> {
    check_members(configured, captured, owner)?;
    let p = captured.principal();
    let session = access
        .authenticated_session_binding(p)
        .map_err(|_| changed())?;
    let mut metadata = None;
    access
        .with_source_read_authorization(
            p,
            &captured.partition_grants()[0],
            captured.source_grants(),
            |guard| -> a::AccessResult<()> {
                if !std::ptr::eq(guard.principal(), p) {
                    return Err(a::AccessError::Unavailable);
                }
                metadata = Some(guard.persisted_source_metadata(&captured.partition_grants()[0])?);
                Ok(())
            },
        )
        .map_err(|_| changed())?;
    if access
        .authenticated_session_binding(p)
        .map_err(|_| changed())?
        != session
    {
        return Err(changed());
    }
    let metadata = metadata.ok_or_else(changed)?;
    let actual = metadata.registration();
    let expected = configured.registration();
    if actual.workspace_id.as_str() != expected.workspace_id
        || actual.home_id.as_str() != expected.home_id
        || actual.source_instance_id.as_str() != expected.source_instance_id
        || actual.collection_id != expected.collection_id
        || actual.owner != a::SourceOwner::Homebox
        || actual.allowed_external_ids != expected.allowed_external_ids
        || !matches!(
            (actual.partition_mode, expected.partition_mode),
            (
                a::PartitionMode::ExclusiveHome,
                s::PartitionMode::ExclusiveHome
            ) | (
                a::PartitionMode::ReviewedEntityAllowlist,
                s::PartitionMode::ReviewedEntityAllowlist
            )
        )
    {
        return Err(changed());
    }
    Ok(Binding {
        session,
        actor: p.actor_id().as_str().into(),
        metadata,
    })
}

/// Compare whole immutable intent without allocating a normalized replacement.
fn same_intent(original: &Value, current: &Value) -> bool {
    let (Some(a), Some(b)) = (original.as_object(), current.as_object()) else {
        return false;
    };
    if a.len() != b.len() {
        return false;
    }
    a.iter().all(|(key, value)| {
        if key == "requestId" {
            return b.contains_key(key);
        }
        if key != "payload" {
            return b.get(key) == Some(value);
        }
        let (Some(a), Some(b)) = (value.as_object(), b.get(key).and_then(Value::as_object)) else {
            return false;
        };
        a.len() == b.len()
            && a.iter().all(|(key, value)| {
                if key == "cursor" {
                    b.contains_key(key)
                } else {
                    b.get(key) == Some(value)
                }
            })
    })
}

fn metadata_data(
    metadata: &a::SourceAuthorityMetadata,
) -> (&str, u64, &str, &a::SourceRegistration) {
    (
        metadata.access_epoch(),
        metadata.source_registration_version(),
        metadata.source_registration_sha256(),
        metadata.registration(),
    )
}

fn context_size(selected: &NativeListReadRequest<'_, '_>) -> st::StockResult<usize> {
    let mut count = Count::new();
    count.value(selected.request.raw())?;
    count.value(&selected.baseline.registration)?;
    count.value(&selected.baseline.state)?;
    // Config is retained by Arc only; count the relevant bounded selection.
    count.value(selected.configured.registration())?;
    let endpoint = selected.configured.endpoint().map_err(|_| unavailable())?;
    count.add(endpoint.origin().as_str().len())?;
    Ok(count.bytes)
}

struct Count {
    bytes: usize,
}
impl Count {
    fn new() -> Self {
        Self { bytes: 0 }
    }
    fn add(&mut self, bytes: usize) -> st::StockResult<()> {
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .filter(|n| *n <= BYTES)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn value(&mut self, value: &impl Serialize) -> st::StockResult<()> {
        serde_json::to_writer(self, value).map_err(|_| unavailable())
    }
}
impl Write for Count {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.add(bytes.len())
            .map_err(|_| io::Error::other("Retained list byte limit"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
struct HostClock;
impl Clock for HostClock {
    fn now(&self) -> Timestamp {
        let current: chrono::DateTime<chrono::Utc> = SystemTime::now().into();
        Timestamp::parse(&current.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
            .expect("SystemTime RFC3339 timestamp")
    }
}
fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}
