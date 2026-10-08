//! Configured, consuming intake of a real native generation. Origin is custody,
//! not current Access authority or evidence that publication was accepted.
use super::{
    Clock, HomeBoxReader, HttpTransport, NativePresenceCapture, NativePresenceIdentity,
    NativeReadCredentialConfig, NativeReadCredentials, PreparedGeneration, PublishError,
    RefreshError, SourceRegistration, SourceScope, Timestamp,
};
use crate::{access as a, config::providers::homebox::TrustedHomeBoxSource, storage};
use std::{
    fmt,
    sync::{Arc, Mutex},
    time::SystemTime,
};

#[derive(Debug)]
pub enum NativePresenceOwnerError {
    Access(a::AccessError),
    Configuration,
    Correlation,
    Busy,
    Publication(PublishError),
}
impl From<a::AccessError> for NativePresenceOwnerError {
    fn from(value: a::AccessError) -> Self {
        Self::Access(value)
    }
}
impl fmt::Display for NativePresenceOwnerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Configured native presence intake was not accepted.")
    }
}
impl std::error::Error for NativePresenceOwnerError {}

pub enum NativePresenceCaptureError<'p> {
    Owner(NativePresenceOwnerError),
    Refresh(RefreshError<'p, a::Principal>),
}
impl fmt::Debug for NativePresenceCaptureError<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Owner(e) => f.debug_tuple("Owner").field(e).finish(),
            Self::Refresh(e) => f.debug_tuple("Refresh").field(e).finish(),
        }
    }
}
impl fmt::Display for NativePresenceCaptureError<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Configured native presence capture did not complete.")
    }
}
impl std::error::Error for NativePresenceCaptureError<'_> {}
impl From<NativePresenceOwnerError> for NativePresenceCaptureError<'_> {
    fn from(value: NativePresenceOwnerError) -> Self {
        Self::Owner(value)
    }
}

struct HostClock;
impl Clock for HostClock {
    fn now(&self) -> Timestamp {
        let current: chrono::DateTime<chrono::Utc> = SystemTime::now().into();
        Timestamp::parse(&current.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
            .expect("SystemTime RFC3339 timestamp")
    }
}
type ConfiguredReader<'p> = HomeBoxReader<HttpTransport<NativeReadCredentials<'p>>, HostClock>;

pub struct NativePresenceReader<'p> {
    reader: ConfiguredReader<'p>,
    configured: Arc<TrustedHomeBoxSource>,
    access: Arc<Mutex<a::AccessBoundary>>,
    principal: &'p a::Principal,
    source: a::SourceGrant,
    partition: a::PartitionGrant,
    metadata: a::SourceAuthorityMetadata,
    endpoint: String,
}
impl<'p> NativePresenceReader<'p> {
    pub fn from_configured(
        homebox: &Arc<TrustedHomeBoxSource>,
        credentials: &Arc<NativeReadCredentialConfig>,
        access: Arc<Mutex<a::AccessBoundary>>,
        principal: &'p a::Principal,
        source: a::SourceGrant,
        partition: a::PartitionGrant,
    ) -> Result<Self, NativePresenceOwnerError> {
        if homebox.metadata_dialect() != crate::providers::homebox::wire::DIALECT {
            return Err(NativePresenceOwnerError::Configuration);
        }
        let endpoint = homebox
            .endpoint()
            .map_err(|_| NativePresenceOwnerError::Configuration)?;
        if !credentials.matches_endpoint(&endpoint) || endpoint.origin().scheme() != "https" {
            return Err(NativePresenceOwnerError::Configuration);
        }
        let metadata = source_fence(homebox, &access, principal, &source, &partition)?;
        let bound = credentials
            .bind_original(access.clone(), principal, source.clone(), partition.clone())
            .map_err(|_| NativePresenceOwnerError::Configuration)?;
        let reader = homebox
            .reader(bound, HostClock)
            .map_err(|_| NativePresenceOwnerError::Configuration)?;
        check_reader(homebox, &reader)?;
        Ok(Self {
            reader,
            configured: homebox.clone(),
            access,
            principal,
            source,
            partition,
            metadata,
            endpoint: endpoint.origin().as_str().to_owned(),
        })
    }

    /// Test-only selected certificate for local setup; it establishes no authority.
    #[cfg(test)]
    pub(crate) fn from_configured_with_loopback_certificate(
        homebox: &Arc<TrustedHomeBoxSource>,
        credentials: &Arc<NativeReadCredentialConfig>,
        access: Arc<Mutex<a::AccessBoundary>>,
        principal: &'p a::Principal,
        source: a::SourceGrant,
        partition: a::PartitionGrant,
        certificate_der: &[u8],
    ) -> Result<Self, NativePresenceOwnerError> {
        if homebox.metadata_dialect() != crate::providers::homebox::wire::DIALECT {
            return Err(NativePresenceOwnerError::Configuration);
        }
        let endpoint = homebox
            .endpoint()
            .map_err(|_| NativePresenceOwnerError::Configuration)?;
        if !credentials.matches_endpoint(&endpoint) || endpoint.origin().scheme() != "https" {
            return Err(NativePresenceOwnerError::Configuration);
        }
        let metadata = source_fence(homebox, &access, principal, &source, &partition)?;
        let bound = credentials
            .bind_original(access.clone(), principal, source.clone(), partition.clone())
            .map_err(|_| NativePresenceOwnerError::Configuration)?;
        let reader = homebox
            .reader_with_loopback_certificate(bound, HostClock, certificate_der)
            .map_err(|_| NativePresenceOwnerError::Configuration)?;
        check_reader(homebox, &reader)?;
        Ok(Self {
            reader,
            configured: homebox.clone(),
            access,
            principal,
            source,
            partition,
            metadata,
            endpoint: endpoint.origin().as_str().to_owned(),
        })
    }

    pub fn prepare<
        C: storage::Contract,
        A: storage::Authorization,
        R: storage::Runtime,
        B: storage::Authorization<Principal = a::Principal>,
    >(
        self,
        store: &mut storage::AtlasStore<C, A, R>,
        authorization: &B,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<PreparedConfiguredNativePresence<'p>, NativePresenceOwnerError> {
        self.check_guard(guard)?;
        check_reader(&self.configured, &self.reader)?;
        let prepared = self
            .reader
            .prepare_publication_with_authorization(store, authorization, self.principal)
            .map_err(NativePresenceOwnerError::Publication)?;
        let fence = FenceFacts::capture(prepared.fence());
        fence.check_configured(&self.configured)?;
        if prepared.previous().cache().scope() != self.configured.scope()
            || prepared
                .previous()
                .cache()
                .generation_id
                .as_ref()
                .map(|id| id.as_str())
                != fence.baseline.as_deref()
        {
            return Err(NativePresenceOwnerError::Correlation);
        }
        self.check_guard(guard)?;
        Ok(PreparedConfiguredNativePresence {
            owner: self,
            prepared,
            fence,
        })
    }
    fn check_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<(), NativePresenceOwnerError> {
        if !std::ptr::eq(guard.principal(), self.principal) {
            return Err(NativePresenceOwnerError::Correlation);
        }
        guard.revalidate_source_read(&self.partition, std::slice::from_ref(&self.source))?;
        let current = guard.persisted_source_metadata(&self.partition)?;
        check_metadata(&self.configured, &current)?;
        if current != self.metadata {
            return Err(NativePresenceOwnerError::Correlation);
        }
        guard.revalidate()?;
        Ok(())
    }
}

pub struct PreparedConfiguredNativePresence<'p> {
    owner: NativePresenceReader<'p>,
    prepared: PreparedGeneration<'p, a::Principal>,
    fence: FenceFacts,
}
impl<'p> PreparedConfiguredNativePresence<'p> {
    pub async fn capture(
        mut self,
    ) -> Result<ConfiguredNativePresenceCapture<'p>, NativePresenceCaptureError<'p>> {
        let before = source_fence(
            &self.owner.configured,
            &self.owner.access,
            self.owner.principal,
            &self.owner.source,
            &self.owner.partition,
        )?;
        if before != self.owner.metadata {
            return Err(NativePresenceOwnerError::Correlation.into());
        }
        check_reader(&self.owner.configured, &self.owner.reader)?;
        let fetched = self.prepared.fetch(&mut self.owner.reader).await;
        // A failed read retains the original FailedPublication and Store fence even
        // if the post-I/O Access fence also fails.
        let after = source_fence(
            &self.owner.configured,
            &self.owner.access,
            self.owner.principal,
            &self.owner.source,
            &self.owner.partition,
        );
        let staged = fetched.map_err(NativePresenceCaptureError::Refresh)?;
        if after? != self.owner.metadata {
            return Err(NativePresenceOwnerError::Correlation.into());
        }
        let capture = staged
            .into_native_presence_capture()
            .map_err(NativePresenceOwnerError::Publication)?;
        self.fence
            .check_capture(&capture, &self.owner.configured, self.owner.principal)?;
        let allocation = Arc::new(());
        let origin = ConfiguredNativePresenceOrigin {
            native_identity: capture.retain_native_identity(),
            allocation: allocation.clone(),
            principal: self.owner.principal,
            source: self.owner.source,
            partition: self.owner.partition,
            configured: self.owner.configured,
            endpoint: self.owner.endpoint,
            metadata: self.owner.metadata,
            fence: self.fence,
        };
        Ok(ConfiguredNativePresenceCapture {
            capture,
            origin,
            allocation,
        })
    }
}

pub struct ConfiguredNativePresenceCapture<'p> {
    capture: NativePresenceCapture<'p, a::Principal>,
    origin: ConfiguredNativePresenceOrigin<'p>,
    allocation: Arc<()>,
}
impl<'p> ConfiguredNativePresenceCapture<'p> {
    pub fn capture(&self) -> &NativePresenceCapture<'p, a::Principal> {
        &self.capture
    }
    pub fn origin(&self) -> &ConfiguredNativePresenceOrigin<'p> {
        &self.origin
    }
    pub fn into_parts(
        self,
    ) -> (
        NativePresenceCapture<'p, a::Principal>,
        ConfiguredNativePresenceOrigin<'p>,
    ) {
        debug_assert!(Arc::ptr_eq(&self.allocation, &self.origin.allocation));
        (self.capture, self.origin)
    }
}

pub struct ConfiguredNativePresenceOrigin<'p> {
    native_identity: NativePresenceIdentity,
    allocation: Arc<()>,
    principal: &'p a::Principal,
    source: a::SourceGrant,
    partition: a::PartitionGrant,
    configured: Arc<TrustedHomeBoxSource>,
    endpoint: String,
    metadata: a::SourceAuthorityMetadata,
    fence: FenceFacts,
}
impl ConfiguredNativePresenceOrigin<'_> {
    pub fn matches_capture(&self, capture: &NativePresenceCapture<'_, a::Principal>) -> bool {
        self.native_identity.matches_capture(capture)
            && self
                .fence
                .check_capture(capture, &self.configured, self.principal)
                .is_ok()
            && check_metadata(&self.configured, &self.metadata).is_ok()
    }
    pub fn original_principal(&self) -> &a::Principal {
        self.principal
    }
    pub fn original_source(&self) -> &a::SourceGrant {
        &self.source
    }
    pub fn original_partition(&self) -> &a::PartitionGrant {
        &self.partition
    }
    pub fn configured(&self) -> &Arc<TrustedHomeBoxSource> {
        &self.configured
    }
    pub fn endpoint_origin(&self) -> &str {
        &self.endpoint
    }
    pub fn scope(&self) -> SourceScope {
        self.configured.scope()
    }
    pub fn registration(&self) -> &storage::SourceRegistration {
        self.configured.registration()
    }
    pub fn source_metadata(&self) -> &a::SourceAuthorityMetadata {
        &self.metadata
    }
    pub fn partition(&self) -> &storage::SourcePartition {
        &self.fence.partition
    }
    pub fn baseline_generation_id(&self) -> Option<&str> {
        self.fence.baseline.as_deref()
    }
    pub fn baseline_cache_epoch(&self) -> storage::CacheEpoch {
        self.fence.epoch
    }
    pub fn reserved_generation_id(&self) -> &str {
        &self.fence.reserved
    }
}

struct FenceFacts {
    partition: storage::SourcePartition,
    registration: storage::SourceRegistration,
    baseline: Option<String>,
    epoch: storage::CacheEpoch,
    reserved: String,
}
impl FenceFacts {
    fn capture(fence: &storage::CachePublicationFence) -> Self {
        Self {
            partition: fence.partition().clone(),
            registration: fence.registration().clone(),
            baseline: fence.baseline_generation_id().map(str::to_owned),
            epoch: fence.baseline_cache_epoch(),
            reserved: fence.reserved_generation_id().to_owned(),
        }
    }
    fn check_configured(
        &self,
        configured: &TrustedHomeBoxSource,
    ) -> Result<(), NativePresenceOwnerError> {
        let id = super::Uuid::parse(&self.reserved)
            .map_err(|_| NativePresenceOwnerError::Correlation)?;
        if self.partition != configured.partition()
            || &self.registration != configured.registration()
            || id.as_str() != self.reserved
            || id.as_str() == "00000000-0000-0000-0000-000000000000"
        {
            return Err(NativePresenceOwnerError::Correlation);
        }
        Ok(())
    }
    fn check_capture(
        &self,
        capture: &NativePresenceCapture<'_, a::Principal>,
        configured: &TrustedHomeBoxSource,
        principal: &a::Principal,
    ) -> Result<(), NativePresenceOwnerError> {
        self.check_configured(configured)?;
        let fence = capture.fence();
        let expected = expected_registration(configured)?;
        let native = capture.native();
        let stats = capture.generation().stats();
        let bytes = native.responses().iter().try_fold(0usize, |sum, response| {
            sum.checked_add(response.body().len())
        });
        if !std::ptr::eq(capture.principal(), principal)
            || fence.partition() != &self.partition
            || fence.registration() != &self.registration
            || fence.baseline_generation_id() != self.baseline.as_deref()
            || fence.baseline_cache_epoch() != self.epoch
            || fence.reserved_generation_id() != self.reserved
            || !same_registration(native.registration(), &expected)
            || native.scope() != &configured.scope()
            || native.generation_id().as_str() != self.reserved
            || capture
                .generation()
                .cache()
                .generation_id
                .as_ref()
                .map(|id| id.as_str())
                != Some(self.reserved.as_str())
            || capture.generation().cache().scope() != configured.scope()
            || native.responses().len() != stats.requests
            || bytes != Some(stats.bytes)
            || native
                .responses()
                .iter()
                .any(|r| r.status() != 200 || r.scope() != native.scope())
        {
            return Err(NativePresenceOwnerError::Correlation);
        }
        Ok(())
    }
}
fn expected_registration(
    configured: &TrustedHomeBoxSource,
) -> Result<SourceRegistration, NativePresenceOwnerError> {
    serde_json::from_value(
        serde_json::to_value(configured.registration())
            .map_err(|_| NativePresenceOwnerError::Configuration)?,
    )
    .map_err(|_| NativePresenceOwnerError::Configuration)
}
fn same_registration(a: &SourceRegistration, b: &SourceRegistration) -> bool {
    a.workspace_id == b.workspace_id
        && a.home_id == b.home_id
        && a.source_instance_id == b.source_instance_id
        && a.collection_id == b.collection_id
        && a.owner == b.owner
        && a.partition_mode == b.partition_mode
        && a.allowed_external_ids == b.allowed_external_ids
}
fn check_reader(
    configured: &TrustedHomeBoxSource,
    reader: &ConfiguredReader<'_>,
) -> Result<(), NativePresenceOwnerError> {
    if reader.scope() != &configured.scope()
        || reader.metadata_dialect() != crate::providers::homebox::wire::DIALECT
        || !same_registration(reader.registration(), &expected_registration(configured)?)
    {
        return Err(NativePresenceOwnerError::Configuration);
    }
    Ok(())
}
fn check_metadata(
    configured: &TrustedHomeBoxSource,
    metadata: &a::SourceAuthorityMetadata,
) -> Result<(), NativePresenceOwnerError> {
    if metadata.registration().owner != a::SourceOwner::Homebox
        || serde_json::to_value(configured.registration())
            .map_err(|_| NativePresenceOwnerError::Configuration)?
            != serde_json::to_value(metadata.registration())
                .map_err(|_| NativePresenceOwnerError::Configuration)?
    {
        return Err(NativePresenceOwnerError::Correlation);
    }
    Ok(())
}
fn source_fence(
    configured: &TrustedHomeBoxSource,
    access: &Arc<Mutex<a::AccessBoundary>>,
    principal: &a::Principal,
    source: &a::SourceGrant,
    partition: &a::PartitionGrant,
) -> Result<a::SourceAuthorityMetadata, NativePresenceOwnerError> {
    let reference = source.reference();
    let scope = configured.scope();
    let id = super::Uuid::parse(&reference.key.external_id)
        .map_err(|_| NativePresenceOwnerError::Correlation)?;
    if reference.key.source_kind != a::SourceKind::HomeboxEntity
        || id.as_str() != reference.key.external_id
        || reference.partition() != *partition.partition()
        || reference.workspace_id.as_str() != scope.workspace_id.as_str()
        || reference.home_id.as_str() != scope.home_id.as_str()
        || reference.key.source_instance_id.as_str() != scope.source_instance_id.as_str()
        || reference.key.collection_id != scope.collection_id
    {
        return Err(NativePresenceOwnerError::Correlation);
    }
    let mut access = access
        .try_lock()
        .map_err(|_| NativePresenceOwnerError::Busy)?;
    let mut metadata = None;
    access.with_source_read_authorization(
        principal,
        partition,
        std::slice::from_ref(source),
        |guard| {
            if !std::ptr::eq(guard.principal(), principal) {
                return Err(NativePresenceOwnerError::Correlation);
            }
            let current = guard.persisted_source_metadata(partition)?;
            check_metadata(configured, &current)?;
            metadata = Some(current);
            Ok::<(), NativePresenceOwnerError>(())
        },
    )?;
    metadata.ok_or(NativePresenceOwnerError::Correlation)
}
