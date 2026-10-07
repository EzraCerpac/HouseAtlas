//! Application-bound encrypted credential storage. A lease retains the original
//! authority proof and filesystem lock; labels decoded from ciphertext never
//! create or renew that proof.

use std::{
    marker::PhantomData,
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use sha2::{Digest, Sha256};

use crate::ai::{
    AiError, PortFuture,
    oauth::{
        CredentialBoundary, LifecycleState, RefreshCheckpoint, RegistrationBinding,
        RegistrationKind, RegistrationRecord, RevocationState,
    },
};

use super::{
    authority::CredentialAuthority,
    crypto,
    filesystem::{FileLease, FileStore},
    keys::{KeyProvider, NativeKeys},
    material::{self, MaterialFingerprints},
    record,
};

const UNAVAILABLE: AiError = AiError::DomainUnavailable;
const MAX_SELECTOR: usize = 4096;
const MAX_SAFE_TIME: u64 = 9_007_199_254_740_991;

fn valid_field(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_SELECTOR
}

fn stable_identity(a: &RegistrationBinding, b: &RegistrationBinding) -> bool {
    a.registration_id == b.registration_id
        && a.actor_id == b.actor_id
        && a.workspace_id == b.workspace_id
        && a.home_id == b.home_id
        && a.authority_epoch == b.authority_epoch
}

/// The selector deliberately omits both epochs: aliases across cancellation or
/// authority changes must contend for the same registration lock and file.
pub(crate) fn record_location(
    host_id: &str,
    binding: &RegistrationBinding,
) -> Result<(String, Vec<u8>), AiError> {
    if ![
        host_id,
        &binding.registration_id,
        &binding.actor_id,
        &binding.workspace_id,
        &binding.home_id,
        &binding.authority_epoch,
        &binding.cancellation_epoch,
    ]
    .into_iter()
    .all(valid_field)
    {
        return Err(AiError::InvalidInput);
    }
    let selector = serde_json::to_vec(&(
        "houseatlas-ai-credential-record-v1",
        host_id,
        &binding.registration_id,
        &binding.actor_id,
        &binding.workspace_id,
        &binding.home_id,
    ))
    .map_err(|_| UNAVAILABLE)?;
    let name = format!("{:x}", Sha256::digest(selector));
    let aad = serde_json::to_vec(&(
        "houseatlas-ai-credential-aad-v1",
        &name,
        &binding.authority_epoch,
    ))
    .map_err(|_| UNAVAILABLE)?;
    Ok((name, aad))
}

struct LoadedMeta {
    preimage: [u8; 32],
    binding: RegistrationBinding,
    kind: RegistrationKind,
    app_name: String,
    host_id: String,
    issued_client_id: Option<String>,
    subject: Option<String>,
    material: MaterialFingerprints,
}

impl LoadedMeta {
    fn from_record(record: &RegistrationRecord, preimage: [u8; 32]) -> Result<Self, AiError> {
        Ok(Self {
            preimage,
            binding: record.binding.clone(),
            kind: record.kind.clone(),
            app_name: record.app_name.clone(),
            host_id: record.stable_host_id.clone(),
            issued_client_id: record.issued_client_id.clone(),
            subject: record.identity.as_ref().map(|v| v.subject.clone()),
            material: material::material_fingerprints(record)?,
        })
    }

    fn allows(
        &self,
        record: &RegistrationRecord,
        captured: &RegistrationBinding,
        stopped: bool,
    ) -> bool {
        // A current active lease may adopt only its own originally captured
        // cancellation epoch. Once persisted, metadata prevents a rollback.
        (self.binding == record.binding
            || (!stopped
                && stable_identity(&self.binding, &record.binding)
                && record.binding == *captured))
            && self.kind == record.kind
            && self.app_name == record.app_name
            && self.host_id == record.stable_host_id
            && self
                .issued_client_id
                .as_ref()
                .is_none_or(|id| record.issued_client_id.as_ref() == Some(id))
            && self.subject.as_ref().is_none_or(|subject| {
                record
                    .identity
                    .as_ref()
                    .is_none_or(|identity| identity.subject == *subject)
            })
    }

    fn allows_stopped_material(&self, next: &MaterialFingerprints) -> bool {
        let retained_or_cleared = |before: &Option<[u8; 32]>, after: &Option<[u8; 32]>| {
            after
                .as_ref()
                .is_none_or(|digest| before.as_ref() == Some(digest))
        };
        retained_or_cleared(&self.material.credentials, &next.credentials)
            && retained_or_cleared(&self.material.pending, &next.pending)
            && retained_or_cleared(&self.material.checkpoint, &next.checkpoint)
    }
}

/// Opaque capability for one original authority and one on-disk registration.
pub struct CredentialLease<O: Send + Sync, S: Send + Sync> {
    file: FileLease,
    original: O,
    binding: RegistrationBinding,
    key_id: String,
    aad: Vec<u8>,
    owner: Arc<()>,
    stopped: Option<S>,
    key_fingerprint: [u8; 32],
    loaded: Mutex<Option<LoadedMeta>>,
}

/// Production entrypoint. The native key store must already hold the key, and
/// the supplied private directory must already exist with mode 0700.
pub struct FileCredentialBoundary<C, A: CredentialAuthority<C>> {
    inner: Boundary<C, A, NativeKeys>,
}

impl<C, A: CredentialAuthority<C>> FileCredentialBoundary<C, A> {
    pub fn new_existing(
        path: &Path,
        stable_host_id: &str,
        authority: Arc<A>,
    ) -> Result<Self, AiError> {
        Ok(Self {
            inner: Boundary::with_keys(path, stable_host_id, authority, NativeKeys::new())?,
        })
    }
}

impl<C: Sync, A: CredentialAuthority<C>> FileCredentialBoundary<C, A> {
    /// Explicit first enrollment for an already-authorized registration. The
    /// host supplies the complete initial record and an existing native key.
    pub fn enroll_atomic<'a>(
        &'a self,
        context: &'a C,
        binding: &'a RegistrationBinding,
        initial_record: &'a RegistrationRecord,
    ) -> PortFuture<'a, CredentialLease<A::Original, A::Stopped>> {
        self.inner.enroll_atomic(context, binding, initial_record)
    }
}

/// Private injection point for bounded synthetic fixtures. Production always
/// constructs the wrapper above with native OS key lookup.
pub(crate) struct Boundary<C, A: CredentialAuthority<C>, K: KeyProvider> {
    files: Arc<FileStore>,
    host_id: String,
    authority: Arc<A>,
    keys: K,
    owner: Arc<()>,
    context: PhantomData<fn() -> C>,
}

impl<C, A: CredentialAuthority<C>, K: KeyProvider> Boundary<C, A, K> {
    pub(crate) fn with_keys(
        path: &Path,
        stable_host_id: &str,
        authority: Arc<A>,
        keys: K,
    ) -> Result<Self, AiError> {
        if !valid_field(stable_host_id) {
            return Err(AiError::InvalidInput);
        }
        Ok(Self {
            files: FileStore::open(path)?,
            host_id: stable_host_id.to_owned(),
            authority,
            keys,
            owner: Arc::new(()),
            context: PhantomData,
        })
    }

    fn check_lease_identity(
        &self,
        lease: &CredentialLease<A::Original, A::Stopped>,
    ) -> Result<(), AiError> {
        if !Arc::ptr_eq(&self.owner, &lease.owner) {
            return Err(UNAVAILABLE);
        }
        let (id, aad) = record_location(&self.host_id, &lease.binding)?;
        if id != lease.key_id || aad != lease.aad {
            return Err(UNAVAILABLE);
        }
        Ok(())
    }

    fn check_owner(&self, lease: &CredentialLease<A::Original, A::Stopped>) -> Result<(), AiError> {
        self.check_lease_identity(lease)?;
        lease.file.check()
    }

    fn check_loaded_preimage(
        &self,
        lease: &CredentialLease<A::Original, A::Stopped>,
    ) -> Result<(), AiError> {
        let loaded = lease.loaded.lock().map_err(|_| UNAVAILABLE)?;
        if let Some(meta) = loaded.as_ref() {
            let current = lease.file.read()?.ok_or(UNAVAILABLE)?;
            if <[u8; 32]>::from(Sha256::digest(&current)) != meta.preimage {
                return Err(UNAVAILABLE);
            }
        }
        Ok(())
    }

    async fn current_key(
        &self,
        lease: &CredentialLease<A::Original, A::Stopped>,
    ) -> Result<super::keys::SecretKey, AiError> {
        self.check_owner(lease)?;
        let key = self.keys.load(&lease.key_id).await?;
        if <[u8; 32]>::from(Sha256::digest(key.expose())) != lease.key_fingerprint {
            return Err(UNAVAILABLE);
        }
        self.check_owner(lease)?;
        Ok(key)
    }

    fn check_record_scope(
        &self,
        lease: &CredentialLease<A::Original, A::Stopped>,
        record: &RegistrationRecord,
    ) -> Result<(), AiError> {
        let (id, aad) = record_location(&self.host_id, &record.binding)?;
        if id != lease.key_id || aad != lease.aad {
            return Err(UNAVAILABLE);
        }
        if !stable_identity(&lease.binding, &record.binding)
            || record.stable_host_id != self.host_id
        {
            return Err(UNAVAILABLE);
        }
        if let Some(attempt) = &record.pending_authorization {
            record_location(&self.host_id, &attempt.binding)?;
            if !stable_identity(&record.binding, &attempt.binding) {
                return Err(UNAVAILABLE);
            }
        }
        let checkpoint_binding = match &record.refresh_checkpoint {
            RefreshCheckpoint::None => None,
            RefreshCheckpoint::InvocationUnconfirmed(binding)
            | RefreshCheckpoint::Received { binding, .. }
            | RefreshCheckpoint::ExchangeReceived { binding, .. } => Some(binding),
        };
        if let Some(binding) = checkpoint_binding {
            record_location(&self.host_id, binding)?;
            if !stable_identity(&record.binding, binding) {
                return Err(UNAVAILABLE);
            }
        }
        Ok(())
    }
}

impl<C: Sync, A: CredentialAuthority<C>, K: KeyProvider> Boundary<C, A, K> {
    pub(crate) fn enroll_atomic<'a>(
        &'a self,
        context: &'a C,
        binding: &'a RegistrationBinding,
        initial_record: &'a RegistrationRecord,
    ) -> PortFuture<'a, CredentialLease<A::Original, A::Stopped>> {
        Box::pin(async move {
            if initial_record.binding != *binding
                || initial_record.stable_host_id != self.host_id
                || !valid_field(&initial_record.app_name)
                || initial_record.state != LifecycleState::Disconnected
                || initial_record.revocation != RevocationState::NotRequested
                || initial_record.issued_client_id.is_some()
                || initial_record.identity.is_some()
                || initial_record.credentials.is_some()
                || initial_record.pending_authorization.is_some()
                || !matches!(initial_record.refresh_checkpoint, RefreshCheckpoint::None)
            {
                return Err(AiError::InvalidInput);
            }
            let lease = self.acquire(context, binding).await?;
            self.check_record_scope(&lease, initial_record)?;
            if lease.stopped.is_some()
                || lease.loaded.try_lock().map_err(|_| UNAVAILABLE)?.is_some()
                || lease.file.read()?.is_some()
            {
                return Err(UNAVAILABLE);
            }
            self.authority
                .revalidate(context, &lease.original, &lease.binding)?;
            self.authority
                .revalidate_retained(&lease.original, &lease.binding)?;
            let key = self.current_key(&lease).await?;
            let mut loaded = lease.loaded.try_lock().map_err(|_| UNAVAILABLE)?;
            if loaded.is_some() || lease.file.read()?.is_some() {
                return Err(UNAVAILABLE);
            }
            let plaintext = record::encode(initial_record)?;
            let ciphertext = crypto::seal(&key, &lease.aad, plaintext.expose_for_encryption())?;
            let meta = LoadedMeta::from_record(
                initial_record,
                <[u8; 32]>::from(Sha256::digest(&ciphertext)),
            )?;
            self.authority
                .with_persistence_fence(&lease.original, &lease.binding, None, || {
                    lease.file.replace_atomic(None, &ciphertext)
                })?;
            *loaded = Some(meta);
            drop(loaded);
            Ok(lease)
        })
    }
}

impl<C: Sync, A: CredentialAuthority<C>, K: KeyProvider> CredentialBoundary<C>
    for Boundary<C, A, K>
{
    type Lease = CredentialLease<A::Original, A::Stopped>;

    fn acquire<'a>(
        &'a self,
        context: &'a C,
        binding: &'a RegistrationBinding,
    ) -> PortFuture<'a, Self::Lease> {
        Box::pin(async move {
            let (key_id, aad) = record_location(&self.host_id, binding)?;
            let original = self.authority.retain(context, binding)?;
            self.authority.revalidate(context, &original, binding)?;
            let key = self.keys.load(&key_id).await?;
            let key_fingerprint = <[u8; 32]>::from(Sha256::digest(key.expose()));
            let file = self.files.acquire(&key_id)?;
            self.authority.revalidate(context, &original, binding)?;
            self.authority.revalidate_retained(&original, binding)?;
            file.check()?;
            Ok(CredentialLease {
                file,
                original,
                binding: binding.clone(),
                key_id,
                aad,
                owner: Arc::clone(&self.owner),
                stopped: None,
                key_fingerprint,
                loaded: Mutex::new(None),
            })
        })
    }

    fn load<'a>(&'a self, lease: &'a Self::Lease) -> PortFuture<'a, RegistrationRecord> {
        Box::pin(async move {
            if lease.stopped.is_some() {
                return Err(UNAVAILABLE);
            }
            let key = self.current_key(lease).await?;
            self.authority
                .revalidate_retained(&lease.original, &lease.binding)?;
            let ciphertext = lease.file.read()?.ok_or(UNAVAILABLE)?;
            let preimage = <[u8; 32]>::from(Sha256::digest(&ciphertext));
            // Authentication precedes all record parsing and identity checks.
            let plaintext = crypto::open(&key, &lease.aad, ciphertext)?;
            let record = record::decode(&plaintext)?;
            self.check_record_scope(lease, &record)?;
            self.authority
                .revalidate_retained(&lease.original, &lease.binding)?;
            self.check_owner(lease)?;
            *lease.loaded.try_lock().map_err(|_| UNAVAILABLE)? =
                Some(LoadedMeta::from_record(&record, preimage)?);
            Ok(record)
        })
    }

    fn persist_atomic<'a>(
        &'a self,
        lease: &'a mut Self::Lease,
        record: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let key = self.current_key(lease).await?;
            self.check_record_scope(lease, record)?;
            let mut loaded = lease.loaded.try_lock().map_err(|_| UNAVAILABLE)?;
            let prior = loaded.as_ref().ok_or(UNAVAILABLE)?;
            if !prior.allows(record, &lease.binding, lease.stopped.is_some()) {
                return Err(UNAVAILABLE);
            }
            if let Some(stopped) = lease.stopped.as_ref() {
                self.authority
                    .revalidate_stopped(&lease.original, &lease.binding, stopped)?;
                if !matches!(
                    record.state,
                    LifecycleState::Disconnected
                        | LifecycleState::ReauthorizationRequired
                        | LifecycleState::ConfigurationRepairRequired
                ) {
                    return Err(UNAVAILABLE);
                }
                let material = material::material_fingerprints(record)?;
                if !prior.allows_stopped_material(&material) {
                    return Err(UNAVAILABLE);
                }
            } else {
                self.authority
                    .revalidate_retained(&lease.original, &lease.binding)?;
            }
            let plaintext = record::encode(record)?;
            let ciphertext = crypto::seal(&key, &lease.aad, plaintext.expose_for_encryption())?;
            let next_meta =
                LoadedMeta::from_record(record, <[u8; 32]>::from(Sha256::digest(&ciphertext)))?;
            self.authority.with_persistence_fence(
                &lease.original,
                &lease.binding,
                lease.stopped.as_ref(),
                || lease.file.replace_atomic(Some(prior.preimage), &ciphertext),
            )?;
            *loaded = Some(next_meta);
            Ok(())
        })
    }

    fn revalidate<'a>(
        &'a self,
        context: &'a C,
        lease: &'a Self::Lease,
        binding: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            if lease.stopped.is_some() || *binding != lease.binding {
                return Err(UNAVAILABLE);
            }
            self.current_key(lease).await?;
            self.authority
                .revalidate(context, &lease.original, &lease.binding)?;
            self.authority
                .revalidate_retained(&lease.original, &lease.binding)?;
            self.check_loaded_preimage(lease)?;
            self.check_owner(lease)
        })
    }

    fn stop_use<'a>(&'a self, lease: &'a mut Self::Lease) -> PortFuture<'a, ()> {
        Box::pin(async move {
            if lease.stopped.is_some() {
                return Err(UNAVAILABLE);
            }
            // Local stop must remain possible when ciphertext or the OS key is
            // unavailable. The original owner, not the file, owns cancellation.
            self.check_lease_identity(lease)?;
            self.authority
                .revalidate_retained(&lease.original, &lease.binding)?;
            let stopped = self.authority.stop_use(&lease.original, &lease.binding)?;
            lease.stopped = Some(stopped);
            self.authority.revalidate_stopped(
                &lease.original,
                &lease.binding,
                lease.stopped.as_ref().ok_or(UNAVAILABLE)?,
            )?;
            Ok(())
        })
    }

    fn now_ms(&self) -> Result<u64, AiError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| UNAVAILABLE)?
            .as_millis();
        if now == 0 || now > u128::from(MAX_SAFE_TIME) {
            return Err(UNAVAILABLE);
        }
        Ok(now as u64)
    }
}

impl<C: Sync, A: CredentialAuthority<C>> CredentialBoundary<C> for FileCredentialBoundary<C, A> {
    type Lease = CredentialLease<A::Original, A::Stopped>;
    fn acquire<'a>(&'a self, c: &'a C, b: &'a RegistrationBinding) -> PortFuture<'a, Self::Lease> {
        self.inner.acquire(c, b)
    }
    fn load<'a>(&'a self, l: &'a Self::Lease) -> PortFuture<'a, RegistrationRecord> {
        self.inner.load(l)
    }
    fn persist_atomic<'a>(
        &'a self,
        l: &'a mut Self::Lease,
        r: &'a RegistrationRecord,
    ) -> PortFuture<'a, ()> {
        self.inner.persist_atomic(l, r)
    }
    fn revalidate<'a>(
        &'a self,
        c: &'a C,
        l: &'a Self::Lease,
        b: &'a RegistrationBinding,
    ) -> PortFuture<'a, ()> {
        self.inner.revalidate(c, l, b)
    }
    fn stop_use<'a>(&'a self, l: &'a mut Self::Lease) -> PortFuture<'a, ()> {
        self.inner.stop_use(l)
    }
    fn now_ms(&self) -> Result<u64, AiError> {
        self.inner.now_ms()
    }
}
