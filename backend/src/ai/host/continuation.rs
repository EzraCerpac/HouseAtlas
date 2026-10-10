//! Process-bound opaque prepared handles. No serialized replacement approval.
use super::{HostAuthority, status::StatusJournal};
use crate::ai::{
    AiError, Cancellation, PortFuture, ReviewContinuationPort, oauth::RegistrationBinding,
    runner::AiCheckpoint,
};
use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, Instant},
};

/// The existing trusted human review owner verifies every pending immutable
/// prepared handle and original authorization/impact/receipt. The host cannot
/// approve anything and never accepts a receipt in browser or model JSON.
pub trait ExactReviewReady<C, P>: Send + Sync {
    fn ready(&self, context: &C, checkpoint: &AiCheckpoint<P>) -> Result<(), AiError>;
}
/// Retire retained handles without claiming, approving or dispatching them.
pub trait ContinuationRetirement<C>: Send + Sync {
    fn retire(&self, context: &C, request_id: &str, continuation_id: &str) -> Result<(), AiError>;
}
struct Retained<P> {
    binding: RegistrationBinding,
    expires: Instant,
    checkpoint: AiCheckpoint<P>,
}
pub struct HostContinuations<A, G, P> {
    authority: A,
    review: G,
    journal: StatusJournal,
    ttl: Duration,
    entries: Mutex<BTreeMap<String, Retained<P>>>,
}
impl<A, G, P> HostContinuations<A, G, P> {
    pub fn new(
        authority: A,
        review: G,
        journal: StatusJournal,
        ttl: Duration,
    ) -> Result<Self, AiError> {
        if ttl.is_zero() || ttl > Duration::from_secs(600) {
            return Err(AiError::InvalidInput);
        }
        Ok(Self {
            authority,
            review,
            journal,
            ttl,
            entries: Mutex::default(),
        })
    }
}
impl<C: Sync, P: Send + Sync, A: HostAuthority<C>, G: ExactReviewReady<C, P>>
    ReviewContinuationPort<C, P> for HostContinuations<A, G, P>
{
    fn retain<'a>(
        &'a self,
        context: &'a C,
        checkpoint: AiCheckpoint<P>,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, String> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            if checkpoint.pending.is_empty() {
                return Err(AiError::InvalidInput);
            }
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?;
            // Expired opaque handles are dropped; never reconstituted or sent.
            let now = Instant::now();
            entries.retain(|_, e| e.expires > now);
            if entries.len() >= 256 {
                return Err(AiError::LimitReached);
            }
            let mut entropy = [0u8; 32];
            getrandom::fill(&mut entropy).map_err(|_| AiError::DomainUnavailable)?;
            let id: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
            if entries.contains_key(&id) {
                return Err(AiError::DomainUnavailable);
            }
            self.journal.append(
                &binding,
                &checkpoint.request_id,
                "continuation-retained",
                serde_json::json!({"continuationId":id,"lifetimeSeconds":self.ttl.as_secs(),
                    "processBound":true}),
            )?;
            entries.insert(
                id.clone(),
                Retained {
                    binding,
                    expires: now + self.ttl,
                    checkpoint,
                },
            );
            Ok(id)
        })
    }
    fn claim<'a>(
        &'a self,
        context: &'a C,
        continuation_id: &'a str,
        request_id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, AiCheckpoint<P>> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?;
            let entry = entries
                .get(continuation_id)
                .ok_or(AiError::DomainUnavailable)?;
            if entry.binding != binding
                || entry.expires <= Instant::now()
                || entry.checkpoint.request_id != request_id
            {
                return Err(AiError::ConnectionUnavailable);
            }
            self.review.ready(context, &entry.checkpoint)?;
            self.authority.revalidate(context, &binding)?;
            self.journal.append(
                &binding,
                request_id,
                "continuation-claimed",
                serde_json::json!({"continuationId":continuation_id}),
            )?;
            Ok(entries
                .remove(continuation_id)
                .ok_or(AiError::DomainUnavailable)?
                .checkpoint)
        })
    }
}

impl<C, P: Send + Sync, A: HostAuthority<C>, G: Send + Sync> ContinuationRetirement<C>
    for HostContinuations<A, G, P>
{
    fn retire(&self, context: &C, request_id: &str, continuation_id: &str) -> Result<(), AiError> {
        let binding = self.authority.binding(context)?;
        self.authority.revalidate(context, &binding)?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?;
        if let Some(entry) = entries.get(continuation_id) {
            if entry.binding != binding || entry.checkpoint.request_id != request_id {
                return Err(AiError::ConnectionUnavailable);
            }
            self.journal.append(
                &binding,
                request_id,
                "continuation-retired",
                serde_json::json!({"continuationId":continuation_id}),
            )?;
            entries.remove(continuation_id);
        }
        Ok(())
    }
}
