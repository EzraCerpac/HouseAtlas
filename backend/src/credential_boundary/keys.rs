//! Read a registration-scoped data key from the native credential store.
//! Lookup never provisions, unlocks, changes, or deletes an item.

use crate::ai::{AiError, PortFuture};
use zeroize::Zeroizing;

const UNAVAILABLE: AiError = AiError::DomainUnavailable;
#[cfg(target_os = "linux")]
const LOOKUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Owns key material and clears it when dropped. Deliberately neither Clone nor Debug.
pub(crate) struct SecretKey(Zeroizing<Vec<u8>>);

impl SecretKey {
    #[cfg(any(target_os = "linux", test))]
    pub(crate) fn new(bytes: Vec<u8>) -> Result<Self, AiError> {
        let bytes = Zeroizing::new(bytes);
        if bytes.len() != 32 {
            return Err(UNAVAILABLE);
        }
        Ok(Self(bytes))
    }

    pub(crate) fn expose(&self) -> &[u8] {
        &self.0
    }
}

pub(crate) trait KeyProvider: Send + Sync {
    fn load<'a>(&'a self, id: &'a str) -> PortFuture<'a, SecretKey>;
}

/// Uses an exact, lowercase SHA-256 key ID internally derived for each registration.
pub(crate) struct NativeKeys;

impl NativeKeys {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl KeyProvider for NativeKeys {
    fn load<'a>(&'a self, id: &'a str) -> PortFuture<'a, SecretKey> {
        Box::pin(async move {
            if !valid_id(id) {
                return Err(UNAVAILABLE);
            }
            #[cfg(target_os = "linux")]
            {
                return tokio::time::timeout(LOOKUP_TIMEOUT, linux_load(id))
                    .await
                    .map_err(|_| UNAVAILABLE)?;
            }
            #[cfg(not(target_os = "linux"))]
            {
                Err(UNAVAILABLE)
            }
        })
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

#[cfg(target_os = "linux")]
async fn linux_load(id: &str) -> Result<SecretKey, AiError> {
    use secret_service::{EncryptionType, SecretService};
    use std::collections::HashMap;

    let service = SecretService::connect(EncryptionType::Dh)
        .await
        .map_err(|_| UNAVAILABLE)?;
    let default = service
        .get_default_collection()
        .await
        .map_err(|_| UNAVAILABLE)?;
    let session = service
        .get_collection_by_alias("session")
        .await
        .map_err(|_| UNAVAILABLE)?;
    if default.collection_path == session.collection_path {
        return Err(UNAVAILABLE);
    }
    default.ensure_unlocked().await.map_err(|_| UNAVAILABLE)?;
    let attributes = HashMap::from([
        ("application", "HouseAtlas"),
        ("purpose", "ai-credential-data-key-v1"),
        ("registration", id),
    ]);
    let mut matches = service
        .search_items(attributes.clone())
        .await
        .map_err(|_| UNAVAILABLE)?;
    if !matches.locked.is_empty() || matches.unlocked.len() != 1 {
        return Err(UNAVAILABLE);
    }
    let item = matches.unlocked.pop().ok_or(UNAVAILABLE)?;
    let default_matches = default
        .search_items(attributes)
        .await
        .map_err(|_| UNAVAILABLE)?;
    if default_matches.len() != 1 || default_matches[0].item_path != item.item_path {
        return Err(UNAVAILABLE);
    }
    item.ensure_unlocked().await.map_err(|_| UNAVAILABLE)?;
    let attributes = item.get_attributes().await.map_err(|_| UNAVAILABLE)?;
    if attributes.get("application").map(String::as_str) != Some("HouseAtlas")
        || attributes.get("purpose").map(String::as_str) != Some("ai-credential-data-key-v1")
        || attributes.get("registration").map(String::as_str) != Some(id)
    {
        return Err(UNAVAILABLE);
    }
    SecretKey::new(item.get_secret().await.map_err(|_| UNAVAILABLE)?)
}
