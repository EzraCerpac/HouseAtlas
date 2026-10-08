//! Sealed source bytes from one successful native full-generation read.
//!
//! This is provenance input only. A capture does not qualify historical
//! authority, source completeness outside the reader checks, publication, or
//! admission. Its public view is borrowed from the exact staged generation and
//! store-issued publication fence.
use super::{CompleteGeneration, SourceRegistration, SourceScope, Timestamp, Uuid};
use crate::storage::CachePublicationFence;
use std::fmt;

/// One response from the reader's fixed, bounded native GET sequence.
pub struct NativePresenceResponse {
    pub(super) path: String,
    pub(super) query: Vec<(String, String)>,
    pub(super) scope: SourceScope,
    pub(super) status: u16,
    pub(super) retrieved_at: Timestamp,
    pub(super) body: Vec<u8>,
}

impl fmt::Debug for NativePresenceResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativePresenceResponse")
            .field("method", &"GET")
            .field("body", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl NativePresenceResponse {
    pub(super) fn new(
        path: String,
        query: Vec<(String, String)>,
        scope: SourceScope,
        status: u16,
        retrieved_at: Timestamp,
        body: Vec<u8>,
    ) -> Self {
        Self {
            path,
            query,
            scope,
            status,
            retrieved_at,
            body,
        }
    }
    pub fn method(&self) -> &'static str {
        "GET"
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub fn status(&self) -> u16 {
        self.status
    }
    pub fn retrieved_at(&self) -> &Timestamp {
        &self.retrieved_at
    }
    pub fn body(&self) -> &[u8] {
        &self.body
    }
}

/// Complete native source observation. Construction is private to the reader;
/// registration and response order come from the same registered read.
pub struct NativePresenceGeneration {
    pub(super) registration: SourceRegistration,
    pub(super) scope: SourceScope,
    pub(super) generation_id: Uuid,
    pub(super) responses: Vec<NativePresenceResponse>,
}

impl fmt::Debug for NativePresenceGeneration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativePresenceGeneration")
            .field("response_count", &self.responses.len())
            .field(
                "body_bytes",
                &self.responses.iter().map(|r| r.body.len()).sum::<usize>(),
            )
            .field("source", &"[REDACTED]")
            .finish()
    }
}

impl NativePresenceGeneration {
    pub(super) fn new(
        registration: SourceRegistration,
        scope: SourceScope,
        generation_id: Uuid,
        responses: Vec<NativePresenceResponse>,
    ) -> Self {
        Self {
            registration,
            scope,
            generation_id,
            responses,
        }
    }
    pub fn registration(&self) -> &SourceRegistration {
        &self.registration
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub fn generation_id(&self) -> &Uuid {
        &self.generation_id
    }
    /// Ordered list-page, detail, and maintenance bodies from this complete read.
    pub fn responses(&self) -> &[NativePresenceResponse] {
        &self.responses
    }
}

/// Borrowed proof input tied to the original principal allocation, the exact
/// native and normalized generation, and the Store-issued publication fence.
/// This view cannot outlive or independently consume its staged publication.
pub struct NativePresenceCapture<'a, P> {
    pub(super) principal: &'a P,
    pub(super) fence: &'a CachePublicationFence,
    pub(super) generation: &'a CompleteGeneration,
    pub(super) native: &'a NativePresenceGeneration,
}

impl<P> NativePresenceCapture<'_, P> {
    pub fn principal(&self) -> &P {
        self.principal
    }
    pub fn fence(&self) -> &CachePublicationFence {
        self.fence
    }
    pub fn generation(&self) -> &CompleteGeneration {
        self.generation
    }
    pub fn native(&self) -> &NativePresenceGeneration {
        self.native
    }
}
