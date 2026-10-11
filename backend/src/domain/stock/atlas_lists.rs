//! Process-local opaque continuation state, never an authority or grant.
//! The host supplies the same authenticated session used to issue the original
//! principal. Every page still reads through Storage and stock disclosure.
use super::{StockError, StockResult, ValidatedRequest, canonical_digest};
use crate::{access, domain::Snapshot};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Only an actual, currently valid AT11 principal can produce this binding.
/// Borrows the original principal for correlation; it cannot authorize IO.
#[derive(Clone)]
pub struct AtlasListBinding<'p> {
    original: &'p access::Principal,
    actor_id: String,
    workspace_id: String,
    home_id: String,
    session: [u8; 32],
}
impl<'p> AtlasListBinding<'p> {
    pub fn capture(
        access: &access::AccessBoundary,
        principal: &'p access::Principal,
    ) -> StockResult<Self> {
        let session = access
            .authenticated_session_binding(principal)
            .map_err(|_| StockError::AuthorityChanged)?;
        Ok(Self {
            original: principal,
            actor_id: principal.actor_id().as_str().into(),
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
            session,
        })
    }
}

impl PartialEq for AtlasListBinding<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.actor_id == other.actor_id
            && self.workspace_id == other.workspace_id
            && self.home_id == other.home_id
            && self.session == other.session
    }
}
impl Eq for AtlasListBinding<'_> {}

/// Extract only the existing opaque Access principal; never reconstruct it.
/// Root wrappers must delegate to their retained original allocation.
pub trait AtlasListPrincipal {
    fn atlas_list_principal(&self) -> &access::Principal;
}
impl AtlasListPrincipal for access::Principal {
    fn atlas_list_principal(&self) -> &access::Principal {
        self
    }
}
impl AtlasListPrincipal for crate::media::native::RetainedPrincipal {
    fn atlas_list_principal(&self) -> &access::Principal {
        self.principal()
    }
}

struct Cursor {
    token: String,
    context: String,
    session: [u8; 32],
    offset: usize,
    expires: Instant,
}
/// Share one instance across request adapters and authenticated transports.
/// At most 1000 cursors, with at most 100 per authenticated session,
/// five-minute lifetime and no restart persistence. An
/// admitted query reserves its continuation chain atomically; unexpired tokens
/// are never evicted, including during another query's output release.
#[derive(Clone)]
pub struct AtlasListPages {
    cursors: Arc<Mutex<VecDeque<Cursor>>>,
    capacity: usize,
}
impl Default for AtlasListPages {
    fn default() -> Self {
        Self {
            cursors: Arc::default(),
            capacity: 1000,
        }
    }
}
impl AtlasListPages {
    /// A host may choose a smaller bounded cache. Two slots retain the consumed
    /// predecessor and its successor throughout ordinary result recomputation.
    /// The session ceiling is min(100, capacity); a capacity of 100 or fewer
    /// slots can therefore be consumed by one authenticated session.
    pub fn with_capacity(capacity: usize) -> StockResult<Self> {
        if !(2..=1000).contains(&capacity) {
            return Err(StockError::InvalidContract);
        }
        Ok(Self {
            cursors: Arc::default(),
            capacity,
        })
    }

    pub(super) fn page(
        &self,
        binding: &AtlasListBinding<'_>,
        request: &ValidatedRequest,
        snapshot: &Snapshot,
        records: Vec<Value>,
    ) -> StockResult<Value> {
        if request.context().workspace_id != binding.workspace_id
            || request.context().home_id != binding.home_id
        {
            return Err(StockError::AuthorityChanged);
        }
        let limit = crate::domain::integer::safe_integer(&request.payload()["pageSize"])
            .filter(|size| (1..=100).contains(size))
            .ok_or(StockError::InvalidContract)? as usize;
        let mut query = request.payload().clone();
        query
            .as_object_mut()
            .ok_or(StockError::InvalidContract)?
            .remove("cursor");
        // Bind the complete authorized snapshot, including source/cache epochs
        // and original retained metadata, not merely the selected public rows.
        let context = canonical_digest(&json!({
            "actorId":binding.actor_id,"session":binding.session,
            "scope":request.context(),"commandId":request.id().as_str(),
            "query":query,"snapshot":snapshot,
        }))?;
        let now = Instant::now();
        let mut cursors = self
            .cursors
            .lock()
            .map_err(|_| StockError::OwnerUnavailable)?;
        cursors.retain(|cursor| cursor.expires > now);
        let offset = match &request.payload()["cursor"] {
            Value::Null => 0,
            Value::String(token) => {
                cursors
                    .iter()
                    .find(|cursor| &cursor.token == token && cursor.context == context)
                    .ok_or(StockError::InvalidContract)?
                    .offset
            }
            _ => return Err(StockError::InvalidContract),
        };
        if offset > records.len() {
            return Err(StockError::InvalidContract);
        }
        let end = offset.saturating_add(limit).min(records.len());
        let next = if end < records.len() {
            // Reuse this session/query/snapshot's exact offset. The token is a
            // correlation, never evidence that a result was authorized.
            if let Some(saved) = cursors
                .iter()
                .find(|cursor| cursor.context == context && cursor.offset == end)
            {
                Some(saved.token.clone())
            } else {
                // Reserve every continuation before returning the first token.
                // A later page cannot need eviction or extra capacity while its
                // predecessor is in use. Other queries may exhaust capacity,
                // but they cannot invalidate any unexpired published token.
                let slots = records.len().saturating_sub(1) / limit;
                if slots > self.capacity {
                    return Err(StockError::OwnerUnavailable);
                }
                let offsets: BTreeSet<_> = cursors
                    .iter()
                    .filter(|c| c.context == context)
                    .map(|c| c.offset)
                    .collect();
                let missing: Vec<_> = (1..=slots)
                    .map(|n| n * limit)
                    .filter(|offset| !offsets.contains(offset))
                    .collect();
                let session_used = cursors
                    .iter()
                    .filter(|cursor| cursor.session == binding.session)
                    .count();
                let session_capacity = self.capacity.min(100);
                if missing.len() > self.capacity.saturating_sub(cursors.len())
                    || missing.len() > session_capacity.saturating_sub(session_used)
                {
                    return Err(StockError::OwnerUnavailable);
                }
                let mut tokens: BTreeSet<_> = cursors.iter().map(|c| c.token.clone()).collect();
                let mut reserved = Vec::with_capacity(missing.len());
                for offset in missing {
                    let mut random = [0_u8; 32];
                    getrandom::fill(&mut random).map_err(|_| StockError::OwnerUnavailable)?;
                    let token = URL_SAFE_NO_PAD.encode(random);
                    if !tokens.insert(token.clone()) {
                        return Err(StockError::OwnerUnavailable);
                    }
                    reserved.push(Cursor {
                        token,
                        context: context.clone(),
                        session: binding.session,
                        offset,
                        expires: now + Duration::from_secs(300),
                    });
                }
                // RNG/collision/capacity errors leave the cache untouched.
                cursors.extend(reserved);
                Some(
                    cursors
                        .iter()
                        .find(|c| c.context == context && c.offset == end)
                        .ok_or(StockError::OwnerUnavailable)?
                        .token
                        .clone(),
                )
            }
        } else {
            None
        };
        Ok(json!({"records":records[offset..end],"nextCursor":next,"sourceStatus":"current"}))
    }
}

/// A request-local view of the shared cache, bound to the exact opaque principal
/// allocation forwarded to the query owner. It issues no replacement authority.
pub struct BoundAtlasListPages<'p, P> {
    pub(super) pages: AtlasListPages,
    pub(super) binding: AtlasListBinding<'p>,
    pub(super) principal: &'p P,
}

pub struct UnavailableAtlasListPages;

pub trait AtlasListPagePort<P> {
    fn page(
        &self,
        principal: &P,
        request: &ValidatedRequest,
        snapshot: &Snapshot,
        records: Vec<Value>,
    ) -> StockResult<Value>;
}
impl<P> AtlasListPagePort<P> for UnavailableAtlasListPages {
    fn page(&self, _: &P, _: &ValidatedRequest, _: &Snapshot, _: Vec<Value>) -> StockResult<Value> {
        Err(StockError::OwnerUnavailable)
    }
}
impl<P: AtlasListPrincipal> AtlasListPagePort<P> for BoundAtlasListPages<'_, P> {
    fn page(
        &self,
        principal: &P,
        request: &ValidatedRequest,
        snapshot: &Snapshot,
        records: Vec<Value>,
    ) -> StockResult<Value> {
        if !std::ptr::eq(principal, self.principal)
            || !std::ptr::eq(self.binding.original, principal.atlas_list_principal())
        {
            return Err(StockError::AuthorityChanged);
        }
        self.pages.page(&self.binding, request, snapshot, records)
    }
}
