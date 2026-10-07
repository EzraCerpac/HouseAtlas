//! Process-local opaque continuation state, never an authority or grant.
//! The host supplies the same authenticated session used to issue the original
//! principal. Every page still reads through Storage and stock disclosure.
use super::{StockError, StockResult, ValidatedRequest, canonical_digest};
use crate::{access, domain::Snapshot};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Only an actual, currently valid AT11 principal can produce this binding.
/// Retains no cookie, token, grant or authority handle; it cannot authorize IO.
#[derive(Clone)]
pub struct AtlasListBinding {
    actor_id: String,
    workspace_id: String,
    home_id: String,
    session: [u8; 32],
}
impl AtlasListBinding {
    pub fn capture(
        access: &access::AccessBoundary,
        principal: &access::Principal,
        authenticated_cookie: &str,
    ) -> StockResult<Self> {
        access
            .revalidate(principal)
            .map_err(|_| StockError::AuthorityChanged)?;
        if authenticated_cookie.is_empty() {
            return Err(StockError::InvalidContract);
        }
        Ok(Self {
            actor_id: principal.actor_id().as_str().into(),
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
            session: Sha256::digest(authenticated_cookie.as_bytes()).into(),
        })
    }
}

struct Cursor {
    token: String,
    context: String,
    offset: usize,
    expires: Instant,
    origin: String,
}
/// Share one instance across request adapters and authenticated transports.
/// As with frozen read pages: at most 1000 cursors, five-minute lifetime, oldest
/// eviction, no persistence across restart, no source data inside the token.
#[derive(Clone, Default)]
pub struct AtlasListPages(Arc<Mutex<VecDeque<Cursor>>>);
impl AtlasListPages {
    pub(super) fn page(
        &self,
        binding: &AtlasListBinding,
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
        let mut cursors = self.0.lock().map_err(|_| StockError::OwnerUnavailable)?;
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
            // Result authorization recomputes the exact projection. Reuse only
            // this same request/query/snapshot's continuation, without treating
            // the cached token as evidence that any result was authorized.
            let origin = canonical_digest(&json!({"requestId":request.request_id(),
                "cursor":request.payload()["cursor"]}))?;
            if let Some(saved) = cursors.iter().find(|cursor| {
                cursor.context == context && cursor.origin == origin && cursor.offset == end
            }) {
                Some(saved.token.clone())
            } else {
                let mut random = [0_u8; 32];
                getrandom::fill(&mut random).map_err(|_| StockError::OwnerUnavailable)?;
                let token = URL_SAFE_NO_PAD.encode(random);
                if cursors.iter().any(|cursor| cursor.token == token) {
                    return Err(StockError::OwnerUnavailable);
                }
                while cursors.len() >= 1000 {
                    cursors.pop_front();
                }
                cursors.push_back(Cursor {
                    token: token.clone(),
                    context,
                    offset: end,
                    expires: now + Duration::from_secs(300),
                    origin,
                });
                Some(token)
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
    pub(super) binding: AtlasListBinding,
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
impl<P> AtlasListPagePort<P> for BoundAtlasListPages<'_, P> {
    fn page(
        &self,
        principal: &P,
        request: &ValidatedRequest,
        snapshot: &Snapshot,
        records: Vec<Value>,
    ) -> StockResult<Value> {
        if !std::ptr::eq(principal, self.principal) {
            return Err(StockError::AuthorityChanged);
        }
        self.pages.page(&self.binding, request, snapshot, records)
    }
}
