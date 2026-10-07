//! Local Atlas-owned delivery. The HTTP owner translates requests/responses;
//! HomeBox attachment transport requires a separate reconciled source port.
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};

use super::content::{validate_content, validate_original_content};
use super::types::{
    AssetPayload, AssetRecord, Availability, ContentType, Lifecycle, PreviewPolicy, Scope, is_uuid,
};
use super::{AssetVault, MediaError, MediaResult, WorkBudget};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum OwnedDescriptor {
    #[serde(rename = "atlas-asset")]
    AtlasAsset {
        #[serde(rename = "assetId")]
        asset_id: String,
    },
}

impl OwnedDescriptor {
    pub fn asset_id(&self) -> &str {
        match self {
            Self::AtlasAsset { asset_id } => asset_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryMode {
    Preview,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadMethod {
    Get,
    Head,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedMediaMetadata {
    pub scope: Scope,
    pub asset_id: String,
    pub revision: u64,
    pub content_type: ContentType,
    pub byte_size: u64,
    pub preview_policy: PreviewPolicy,
}

/// AT07 supplies a currently authorized record and its durable manifest from
/// its authoritative store. Both values must describe the same committed state.
pub struct StoredAsset {
    pub record: AssetRecord,
    pub manifest: AssetPayload,
}

pub trait MediaStoragePort<P> {
    fn read_owned_asset(
        &self,
        principal: &P,
        scope: &Scope,
        asset_id: &str,
    ) -> MediaResult<StoredAsset>;
}

/// AT11 owns opaque principal/grant creation and freshness, session/revocation
/// epochs, membership, mode and metadata policy. No grant is minted by media.
pub trait MediaAccessPort<P> {
    type Grant;

    fn authorize_owned_media(
        &self,
        principal: &P,
        descriptor: &OwnedDescriptor,
        metadata: &OwnedMediaMetadata,
        mode: DeliveryMode,
    ) -> MediaResult<Self::Grant>;

    fn revalidate_owned_media(
        &self,
        principal: &P,
        grant: &Self::Grant,
        descriptor: &OwnedDescriptor,
        metadata: &OwnedMediaMetadata,
        mode: DeliveryMode,
    ) -> MediaResult<()>;
}

/// Success headers contain no storage key, digest, provider URL or credential.
pub struct MediaResponse {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

pub struct MediaService<'a, S, A> {
    store: &'a S,
    access: &'a A,
    vault: &'a AssetVault,
    active: AtomicUsize,
}

impl<'a, S, A> MediaService<'a, S, A> {
    pub fn new(store: &'a S, access: &'a A, vault: &'a AssetVault) -> Self {
        Self {
            store,
            access,
            vault,
            active: AtomicUsize::new(0),
        }
    }

    fn lookup<P>(
        &self,
        principal: &P,
        scope: &Scope,
        descriptor: &OwnedDescriptor,
    ) -> MediaResult<(AssetRecord, OwnedMediaMetadata)>
    where
        S: MediaStoragePort<P>,
    {
        scope.validate()?;
        if !is_uuid(descriptor.asset_id()) {
            return Err(MediaError::NotFound);
        }
        let stored = self
            .store
            .read_owned_asset(principal, scope, descriptor.asset_id())?;
        let record = stored.record;
        record.validate()?;
        if record.scope() != *scope
            || record.record_id != descriptor.asset_id()
            || record.lifecycle != Lifecycle::Active
            || record.payload.availability != Availability::Available
            || stored.manifest != record.payload
            || !record.payload.purpose.is_original()
        {
            return Err(MediaError::NotFound);
        }
        let metadata = OwnedMediaMetadata {
            scope: scope.clone(),
            asset_id: record.record_id.clone(),
            revision: record.revision,
            content_type: ContentType::parse(&record.payload.content_type)?,
            byte_size: record.payload.byte_size,
            preview_policy: record.payload.preview_policy,
        };
        Ok((record, metadata))
    }

    pub fn deliver<P>(
        &self,
        principal: &P,
        scope: &Scope,
        descriptor: &OwnedDescriptor,
        method: ReadMethod,
        mode: DeliveryMode,
        budget: &WorkBudget,
    ) -> MediaResult<MediaResponse>
    where
        S: MediaStoragePort<P>,
        A: MediaAccessPort<P>,
    {
        self.active
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < 4).then_some(n + 1)
            })
            .map_err(|_| MediaError::Busy)?;
        let _capacity = Capacity(&self.active);
        budget.check()?;
        let (initial, metadata) = self.lookup(principal, scope, descriptor)?;
        let grant = self
            .access
            .authorize_owned_media(principal, descriptor, &metadata, mode)?;
        budget.check()?;
        if mode == DeliveryMode::Preview && metadata.preview_policy != PreviewPolicy::SafeRendered {
            return Err(MediaError::NotFound);
        }
        let original = self.vault.read_retained(&initial, budget)?;
        let bytes = match mode {
            DeliveryMode::Download => {
                validate_original_content(&original, metadata.content_type, budget)?;
                original
            }
            DeliveryMode::Preview => validate_content(&original, metadata.content_type, budget)?
                .ok_or(MediaError::Unsupported)?,
        };
        // All byte work finishes before current authoritative reads and grant
        // revalidation. The synchronous router must emit immediately on return.
        let (current, final_metadata) = self.lookup(principal, scope, descriptor)?;
        if current != initial || final_metadata != metadata {
            return Err(MediaError::Conflict);
        }
        self.access
            .revalidate_owned_media(principal, &grant, descriptor, &final_metadata, mode)?;
        budget.check()?;
        let preview = mode == DeliveryMode::Preview;
        let headers = vec![
            ("cache-control", "private, no-store".to_owned()),
            ("x-content-type-options", "nosniff".to_owned()),
            (
                "content-security-policy",
                "default-src 'none'; sandbox".to_owned(),
            ),
            ("cross-origin-resource-policy", "same-origin".to_owned()),
            ("vary", "Cookie, Origin".to_owned()),
            ("content-type", metadata.content_type.as_str().to_owned()),
            ("content-length", bytes.len().to_string()),
            (
                "content-disposition",
                format!(
                    "{}; filename=\"{}.{}\"",
                    if preview { "inline" } else { "attachment" },
                    if preview { "preview" } else { "original" },
                    metadata.content_type.extension()
                ),
            ),
        ];
        budget.check()?;
        Ok(MediaResponse {
            status: 200,
            headers,
            body: if method == ReadMethod::Head {
                Vec::new()
            } else {
                bytes
            },
        })
    }
}

struct Capacity<'a>(&'a AtomicUsize);

impl Drop for Capacity<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}
