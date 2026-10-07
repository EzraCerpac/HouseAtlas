//! Adapters to the monolith's actual Rust storage and access components.
//! No SQL, schema migration, semantic fallback or deserializable authority.
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::{access as a, contracts as dto, storage as s};

use super::recovery::{MAX_ASSETS, RecoveryDatabasePort, RecoveryProfile, ValidatedDatabase};
use super::service::{
    DeliveryMode, MediaAccessPort, MediaStoragePort, OwnedDescriptor, OwnedMediaMetadata,
    StoredAsset,
};
use super::types::{AssetPayload, AssetRecord, PreviewPolicy, Scope};
use super::vault::AvailableAssetVerifier;
use super::{AssetVault, Cancellation, MediaError, MediaResult, WorkBudget};

/// Retains the actual AT11-issued handle. Clones retain the same original;
/// constructing this wrapper from a DTO is impossible.
#[derive(Clone)]
pub struct RetainedPrincipal(Arc<a::Principal>);

impl RetainedPrincipal {
    /// Trusted host composition only. The host supplies an opaque handle issued
    /// by AT11 for its actual request; this never creates access authority.
    pub fn new(principal: a::Principal) -> Self {
        Self(Arc::new(principal))
    }

    pub fn principal(&self) -> &a::Principal {
        &self.0
    }
}

fn access_error(error: a::AccessError) -> MediaError {
    match error {
        a::AccessError::Unauthenticated => MediaError::Unauthenticated,
        a::AccessError::Forbidden => MediaError::Forbidden,
        a::AccessError::NotFound => MediaError::NotFound,
        a::AccessError::InvalidInput => MediaError::InvalidInput,
        a::AccessError::MethodNotAllowed => MediaError::MethodNotAllowed,
        a::AccessError::BodyTooLarge => MediaError::TooLarge,
        a::AccessError::RateLimited => MediaError::Busy,
        a::AccessError::Unavailable => MediaError::Unavailable,
    }
}

pub(super) fn storage_error(error: s::Error) -> MediaError {
    match error.code {
        "unauthenticated" => MediaError::Unauthenticated,
        "forbidden" => MediaError::Forbidden,
        "not-found" => MediaError::NotFound,
        "revision-conflict" | "identity-conflict" => MediaError::Conflict,
        _ => MediaError::Unavailable,
    }
}

fn access_scope(scope: &Scope) -> MediaResult<a::Scope> {
    scope.validate()?;
    Ok(a::Scope {
        workspace_id: a::CanonicalId::parse(&scope.workspace_id).map_err(access_error)?,
        home_id: a::CanonicalId::parse(&scope.home_id).map_err(access_error)?,
    })
}

/// A delivery binding retaining the original AT11 capability. The metadata
/// binding creates no authority beyond that opaque principal's current reads.
pub struct NativeOwnedGrant {
    original: RetainedPrincipal,
    descriptor: OwnedDescriptor,
    metadata: OwnedMediaMetadata,
    mode: DeliveryMode,
}

#[derive(Clone)]
pub struct NativeMediaAccess {
    boundary: Arc<Mutex<a::AccessBoundary>>,
}

impl NativeMediaAccess {
    pub fn new(boundary: Arc<Mutex<a::AccessBoundary>>) -> Self {
        Self { boundary }
    }

    /// AT11 validates the actual method/session/origin/scope for Action::Media.
    pub fn authorize_request(
        &self,
        request: &a::RequestEvidence<'_>,
        scope: &Scope,
    ) -> MediaResult<RetainedPrincipal> {
        let principal = self
            .boundary
            .lock()
            .map_err(|_| MediaError::Unavailable)?
            .authorize(request, &access_scope(scope)?, a::Action::Media)
            .map_err(access_error)?;
        Ok(RetainedPrincipal::new(principal))
    }

    fn current(&self, principal: &RetainedPrincipal, scope: &Scope) -> MediaResult<()> {
        self.boundary
            .lock()
            .map_err(|_| MediaError::Unavailable)?
            .authorize_storage(
                principal.principal(),
                &access_scope(scope)?,
                a::Capability::ReadAssetManifest,
            )
            .map_err(access_error)?;
        Ok(())
    }
}

impl MediaAccessPort<RetainedPrincipal> for NativeMediaAccess {
    type Grant = NativeOwnedGrant;

    fn authorize_owned_media(
        &self,
        principal: &RetainedPrincipal,
        descriptor: &OwnedDescriptor,
        metadata: &OwnedMediaMetadata,
        mode: DeliveryMode,
    ) -> MediaResult<Self::Grant> {
        let permitted = match mode {
            DeliveryMode::Preview => metadata.preview_policy == PreviewPolicy::SafeRendered,
            DeliveryMode::Download => matches!(
                metadata.preview_policy,
                PreviewPolicy::SafeRendered | PreviewPolicy::DownloadOnly
            ),
        };
        if descriptor.asset_id() != metadata.asset_id || !permitted {
            return Err(MediaError::NotFound);
        }
        self.current(principal, &metadata.scope)?;
        Ok(NativeOwnedGrant {
            original: principal.clone(),
            descriptor: descriptor.clone(),
            metadata: metadata.clone(),
            mode,
        })
    }

    fn revalidate_owned_media(
        &self,
        principal: &RetainedPrincipal,
        grant: &Self::Grant,
        descriptor: &OwnedDescriptor,
        metadata: &OwnedMediaMetadata,
        mode: DeliveryMode,
    ) -> MediaResult<()> {
        if !Arc::ptr_eq(&principal.0, &grant.original.0)
            || *descriptor != grant.descriptor
            || *metadata != grant.metadata
            || mode != grant.mode
        {
            return Err(MediaError::Forbidden);
        }
        // Revalidate the retained opaque original through the actual AT11 DB.
        self.current(&grant.original, &metadata.scope)
    }
}

/// Read-only storage authorization through the same actual AT11 boundary.
/// Mutation/publication authority remains with its dedicated host owner.
#[derive(Clone)]
pub struct NativeReadAuthority(pub Arc<Mutex<a::AccessBoundary>>);

impl s::Authorization for NativeReadAuthority {
    type Principal = RetainedPrincipal;

    fn authorize(
        &self,
        principal: &RetainedPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let scope = Scope {
            workspace_id: request.scope.workspace_id.clone(),
            home_id: request.scope.home_id.clone(),
        };
        let scope = access_scope(&scope)
            .map_err(|_| s::Error::new("invalid-contract", "Invalid media scope"))?;
        let capability = match request.capability {
            s::Capability::Read => a::Capability::Read,
            s::Capability::ReadHistory => a::Capability::ReadHistory,
            s::Capability::ReadAssetManifest => a::Capability::ReadAssetManifest,
            _ => return Err(s::Error::new("forbidden", "Media read capability required")),
        };
        let boundary = self
            .0
            // Storage holds its store mutex during this callback. A mutation
            // fence holds access before entering storage, so never wait for
            // access here while retaining the opposite lock. Contention or
            // poisoning returns a sanitized unavailable result.
            .try_lock()
            .map_err(|_| s::Error::new("storage-unavailable", "Access unavailable"))?;
        let original = boundary
            .authorize_storage(principal.principal(), &scope, capability)
            .map_err(|e| s::Error::new(e.code(), "Media authority unavailable"))?;
        Ok(s::VerifiedActor {
            workspace_id: original.scope().workspace_id.as_str().to_owned(),
            home_id: original.scope().home_id.as_str().to_owned(),
            actor_id: original.actor_id().as_str().to_owned(),
        })
    }
}

// Exact integral classification/schema bounds come from the shared native DTO.
// Conversion changes only this in-memory projection, never persisted payloads,
// original receipt inputs, JCS hashes or the copied database image.
fn safe_integer(value: &dto::JsonInteger) -> MediaResult<u64> {
    if let Some(integer) = value.as_number().as_u64() {
        return (integer <= s::MAX_REVISION)
            .then_some(integer)
            .ok_or(MediaError::Unavailable);
    }
    let number = value.as_number().as_f64().ok_or(MediaError::Unavailable)?;
    if number.is_finite()
        && number >= 0.0
        && number <= s::MAX_REVISION as f64
        && number.fract() == 0.0
    {
        Ok(number as u64)
    } else {
        Err(MediaError::Unavailable)
    }
}

pub(super) fn project_asset(record: &s::Record) -> MediaResult<AssetRecord> {
    let bytes = serde_json::to_vec(record).map_err(|_| MediaError::Unavailable)?;
    let typed = dto::decode::<dto::AssetRecord>(&bytes).map_err(|_| MediaError::Unavailable)?;
    let mut projection = serde_json::to_value(&typed).map_err(|_| MediaError::Unavailable)?;
    projection["revision"] = safe_integer(&typed.revision)?.into();
    projection["payload"]["byteSize"] = safe_integer(&typed.payload.byte_size)?.into();
    let record: AssetRecord =
        serde_json::from_value(projection).map_err(|_| MediaError::Unavailable)?;
    record.validate()?;
    Ok(record)
}

fn project_manifest(manifest: serde_json::Value) -> MediaResult<AssetPayload> {
    let bytes = serde_json::to_vec(&manifest).map_err(|_| MediaError::Unavailable)?;
    let typed = dto::decode::<dto::AssetPayload>(&bytes).map_err(|_| MediaError::Unavailable)?;
    let mut projection = manifest;
    projection["byteSize"] = safe_integer(&typed.byte_size)?.into();
    serde_json::from_value(projection).map_err(|_| MediaError::Unavailable)
}

/// Borrows the host's single store. Its mutex protects the actual Rust peer;
/// no second connection or private SQL is opened by media.
pub struct NativeMediaStorage<'a, C, A, R> {
    pub(super) store: &'a Mutex<s::AtlasStore<C, A, R>>,
}

impl<'a, C, A, R> NativeMediaStorage<'a, C, A, R> {
    pub fn new(store: &'a Mutex<s::AtlasStore<C, A, R>>) -> Self {
        Self { store }
    }
}

pub(super) fn recovery_checkpoint(budget: &WorkBudget) -> s::Result<()> {
    budget
        .check()
        .map_err(|_| s::Error::new("storage-unavailable", "Recovery operation budget exhausted"))
}

pub(super) fn native_recovery_profile() -> RecoveryProfile {
    RecoveryProfile::NativeRustV1 {
        contract_version: s::CONTRACT_VERSION,
        database_schema: s::DATABASE_VERSION,
        database_lineage: s::DATABASE_LINEAGE,
    }
}

pub(super) fn check_recovery_image(
    image: &s::RecoveryImage,
    profile: RecoveryProfile,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    if !profile.matches_metadata(
        &image.contract_version,
        image.database_schema,
        Some(&image.database_lineage),
    ) {
        return Err(MediaError::Unavailable);
    }
    if image.assets.len() > MAX_ASSETS {
        return Err(MediaError::TooLarge);
    }
    Ok(())
}

pub(super) fn project_recovery_image(
    image: s::RecoveryImage,
    profile: RecoveryProfile,
    budget: &WorkBudget,
) -> MediaResult<ValidatedDatabase> {
    check_recovery_image(&image, profile, budget)?;
    let mut assets = Vec::with_capacity(image.assets.len());
    for record in &image.assets {
        budget.check()?;
        assets.push(project_asset(record)?);
    }
    budget.check()?;
    Ok(ValidatedDatabase {
        contract_version: image.contract_version,
        database_schema: image.database_schema,
        database_lineage: Some(image.database_lineage),
        assets,
    })
}

/// Offline trusted administration over the host-owned connection. Storage
/// alone validates SQL, migrations, the unredacted graph and durable history.
/// Paths must be operation-owned private staging/image paths, as supplied by
/// recovery.rs; this port is not an HTTP upload or domain command boundary.
impl<C, A, R> RecoveryDatabasePort for NativeMediaStorage<'_, C, A, R>
where
    C: s::Contract,
    A: s::Authorization,
    R: s::Runtime,
{
    fn recovery_profile(&self) -> RecoveryProfile {
        native_recovery_profile()
    }

    fn backup_to(&self, destination: &Path, budget: &WorkBudget) -> MediaResult<()> {
        budget.check()?;
        let mut store = self.store.try_lock().map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        let image = store
            .backup_recovery_to(destination, &mut || recovery_checkpoint(budget))
            .map_err(storage_error)?;
        drop(store);
        project_recovery_image(image, self.recovery_profile(), budget)?;
        Ok(())
    }

    fn validate_recovery_database(
        &self,
        database: &Path,
        budget: &WorkBudget,
    ) -> MediaResult<ValidatedDatabase> {
        budget.check()?;
        let store = self.store.try_lock().map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        let image = store
            .validate_recovery_image(database, &mut || recovery_checkpoint(budget))
            .map_err(storage_error)?;
        drop(store);
        project_recovery_image(image, self.recovery_profile(), budget)
    }
}

impl<C, A, R> MediaStoragePort<A::Principal> for NativeMediaStorage<'_, C, A, R>
where
    C: s::Contract,
    A: s::Authorization,
    R: s::Runtime,
{
    fn read_owned_asset(
        &self,
        principal: &A::Principal,
        scope: &Scope,
        asset_id: &str,
    ) -> MediaResult<StoredAsset> {
        scope.validate()?;
        let scope = s::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        };
        let target = s::RecordRef {
            record_type: s::RecordType::Asset,
            record_id: asset_id.to_owned(),
        };
        let mut store = self.store.lock().map_err(|_| MediaError::Unavailable)?;
        let record = store
            .read_record(principal, &scope, &target)
            .map_err(storage_error)?;
        let manifest = store
            .read_asset_manifest(principal, &scope, &target)
            .map_err(storage_error)?;
        Ok(StoredAsset {
            record: project_asset(&record)?,
            manifest: project_manifest(manifest)?,
        })
    }
}

/// Preserves the host's ID/time provider and replaces its asset proof with
/// actual retained-byte verification and completed durability barriers.
pub struct NativeMediaRuntime<R> {
    pub vault: Arc<AssetVault>,
    pub server: R,
}

impl<R: s::Runtime> s::Runtime for NativeMediaRuntime<R> {
    fn now(&self) -> s::Result<String> {
        self.server.now()
    }

    fn new_id(&self) -> s::Result<String> {
        self.server.new_id()
    }

    fn verify_available_asset(&self, record: &s::Record) -> s::Result<s::AssetProof> {
        let unavailable = |_| s::Error::new("asset-unavailable", "Owned original unavailable");
        let record = project_asset(record).map_err(unavailable)?;
        let budget = WorkBudget::new(Duration::from_secs(10), Cancellation::default())
            .map_err(unavailable)?;
        let identity = self
            .vault
            .verify_available_asset(&record, &budget)
            .map_err(unavailable)?;
        Ok(s::AssetProof {
            sha256: identity.sha256,
            byte_size: identity.byte_size,
        })
    }
}
