//! Sealed finite local capture of one native attachment. No provider byte
//! version, remote-current assertion, CAS or archive fact is manufactured.
use super::{SourceScope, Timestamp, Uuid};
use serde_json::Value;

pub(super) const PINNED_FILE_CAPTURE_WINDOW: std::time::Duration =
    std::time::Duration::from_secs(60);

pub struct CapturedNativeFileSnapshot {
    scope: SourceScope,
    owner: Uuid,
    attachment: Uuid,
    detail_path: String,
    file_path: String,
    query: Vec<(String, String)>,
    before: Vec<u8>,
    body: Vec<u8>,
    after: Vec<u8>,
    member: Value,
    before_at: Timestamp,
    body_at: Timestamp,
    after_at: Timestamp,
    statuses: [u16; 3],
}
impl CapturedNativeFileSnapshot {
    pub(super) fn from_reader(
        scope: SourceScope,
        owner: Uuid,
        attachment: Uuid,
        before: (Vec<u8>, Timestamp, u16),
        body: (Vec<u8>, Timestamp, u16),
        after: (Vec<u8>, Timestamp, u16),
        member: Value,
    ) -> Self {
        Self {
            detail_path: format!("/api/v1/entities/{}", owner.as_str()),
            file_path: format!(
                "/api/v1/entities/{}/attachments/{}",
                owner.as_str(),
                attachment.as_str()
            ),
            scope,
            owner,
            attachment,
            query: Vec::new(),
            before: before.0,
            body: body.0,
            after: after.0,
            member,
            before_at: before.1,
            body_at: body.1,
            after_at: after.1,
            statuses: [before.2, body.2, after.2],
        }
    }
    pub fn scope(&self) -> &SourceScope {
        &self.scope
    }
    pub fn owner(&self) -> &Uuid {
        &self.owner
    }
    pub fn attachment(&self) -> &Uuid {
        &self.attachment
    }
    pub fn detail_path(&self) -> &str {
        &self.detail_path
    }
    pub fn file_path(&self) -> &str {
        &self.file_path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn detail_before_bytes(&self) -> &[u8] {
        &self.before
    }
    pub fn bytes(&self) -> &[u8] {
        &self.body
    }
    pub fn detail_after_bytes(&self) -> &[u8] {
        &self.after
    }
    pub fn member(&self) -> &Value {
        &self.member
    }
    pub fn before_retrieved_at(&self) -> &Timestamp {
        &self.before_at
    }
    pub fn body_retrieved_at(&self) -> &Timestamp {
        &self.body_at
    }
    pub fn after_retrieved_at(&self) -> &Timestamp {
        &self.after_at
    }
    pub fn statuses(&self) -> &[u16; 3] {
        &self.statuses
    }
    /// Descriptive native metadata only, including absence/empty/unknown MIME.
    pub fn content_type(&self) -> Option<&str> {
        self.member.get("mimeType").and_then(Value::as_str)
    }
}
