//! Bounded opaque pagination over the complete authorized read snapshot.
use super::{HttpFailure, failure};
use crate::{app::RequestPrincipal, http::contracts::NativeContracts, storage::Contract};
use axum::http::{StatusCode, Uri};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

struct Cursor {
    context: [u8; 32],
    offset: usize,
    expires: Instant,
}
#[derive(Default)]
pub(super) struct Pages {
    cursors: BTreeMap<String, Cursor>,
    order: u64,
    insertion_order: BTreeMap<u64, String>,
}
fn digest(value: &Value) -> Result<[u8; 32], HttpFailure> {
    let canonical = NativeContracts
        .canonical_json(value)
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    Ok(Sha256::digest(canonical.as_bytes()).into())
}
impl Pages {
    pub fn page(
        &mut self,
        uri: &Uri,
        principal: &RequestPrincipal,
        cookie: Option<&str>,
        collection: &str,
        items: Vec<Value>,
        statuses: Vec<Value>,
    ) -> Result<Value, HttpFailure> {
        let invalid = || failure(StatusCode::UNPROCESSABLE_ENTITY);
        let query = uri.query().unwrap_or("");
        if query.len() > 1024 {
            return Err(invalid());
        }
        let mut params = BTreeMap::new();
        for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if !matches!(name.as_ref(), "limit" | "cursor")
                || params
                    .insert(name.into_owned(), value.into_owned())
                    .is_some()
            {
                return Err(invalid());
            }
        }
        let limit_text = params.get("limit").map_or("50", String::as_str);
        if limit_text.is_empty()
            || limit_text.starts_with('0')
            || !limit_text.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(invalid());
        }
        let limit = limit_text.parse::<usize>().map_err(|_| invalid())?;
        if !(1..=100).contains(&limit) {
            return Err(invalid());
        }
        let snapshot_digest = digest(&json!({"items":items,"sourceStatuses":statuses}))?;
        let session: [u8; 32] = Sha256::digest(cookie.unwrap_or("").as_bytes()).into();
        let scope = principal.principal.scope();
        let context = digest(&json!({
            "workspaceId":scope.workspace_id.as_str(), "homeId":scope.home_id.as_str(),
            "actorId":principal.principal.actor_id().as_str(), "session":session,
            "collection":collection, "limit":limit, "digest":snapshot_digest,
        }))?;
        let now = Instant::now();
        self.cursors.retain(|_, value| value.expires > now);
        self.insertion_order
            .retain(|_, token| self.cursors.contains_key(token));
        let offset = match params.get("cursor") {
            None => 0,
            Some(token) => {
                if token.len() > 64 {
                    return Err(invalid());
                }
                let cursor = self.cursors.get(token).ok_or_else(invalid)?;
                if cursor.context != context {
                    return Err(invalid());
                }
                cursor.offset
            }
        };
        let end = offset
            .checked_add(limit)
            .ok_or_else(invalid)?
            .min(items.len());
        if offset > items.len() {
            return Err(invalid());
        }
        let next = if end < items.len() {
            while self.cursors.len() >= 1000 {
                let Some((_, token)) = self.insertion_order.pop_first() else {
                    return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
                };
                self.cursors.remove(&token);
            }
            let token =
                crate::app::new_id().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let order = self
                .order
                .checked_add(1)
                .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            self.order = order;
            self.cursors.insert(
                token.clone(),
                Cursor {
                    context,
                    offset: end,
                    expires: now + Duration::from_millis(300_000),
                },
            );
            self.insertion_order.insert(order, token.clone());
            Some(token)
        } else {
            None
        };
        Ok(json!({"contractVersion":crate::storage::CONTRACT_VERSION,
            "items":items[offset..end],"nextCursor":next,"sourceStatuses":statuses}))
    }
}
