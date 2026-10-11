//! Trusted gateway configuration DATA. This policy issues no request proof.
use super::{AccessError, AccessResult};
use serde::{Deserialize, Serialize};

/// Nonsecret allowlist selected by the trusted composition owner. The separate
/// gateway process performs native WhoIs; Access consumes its checked proof.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedProxyPolicy {
    pub user_login: String,
    pub node_tag: String,
    pub peer_uid: u32,
}

impl TrustedProxyPolicy {
    pub fn validate(&self) -> AccessResult<()> {
        let tag_label = self
            .node_tag
            .strip_prefix("tag:")
            .ok_or(AccessError::InvalidInput)?;
        if self.user_login.is_empty()
            || self.user_login.len() > 256
            || self.user_login.trim() != self.user_login
            || self.user_login.chars().any(char::is_control)
            || tag_label.is_empty()
            || tag_label.len() > 63
            || tag_label
                .as_bytes()
                .first()
                .is_none_or(|byte| !byte.is_ascii_lowercase())
            || tag_label.ends_with('-')
            || !tag_label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || self.peer_uid == 0
        {
            return Err(AccessError::InvalidInput);
        }
        Ok(())
    }
}
