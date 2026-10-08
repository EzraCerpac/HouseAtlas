//! Original configured upload selection and synchronous physical observation.
//! The physical carrier borrows the real Store and cannot cross provider I/O.
use super::{Core, Store};
use crate::{
    access,
    config::providers::{
        homebox::TrustedHomeBoxSource,
        queued_upload::{
            OriginalQueuedUploadConfigured, QueuedUploadConfigurationError,
            QueuedUploadInstallationInput,
        },
        registry::ConfiguredSource,
    },
    domain::stock::CapturedAccess,
    providers::homebox::read::NativeReadCredentialConfig,
    storage::{self, StockActivityPrincipal as _},
};
use std::sync::Arc;

fn unavailable() -> storage::Error {
    storage::Error::new(
        "identity-conflict",
        "Queued upload physical source unavailable",
    )
}

impl Core {
    pub fn queued_upload_installation_configuration(
        &self,
        source: Arc<ConfiguredSource>,
        homebox: Arc<TrustedHomeBoxSource>,
        credentials: Arc<NativeReadCredentialConfig>,
        input: QueuedUploadInstallationInput,
    ) -> Result<Arc<OriginalQueuedUploadConfigured>, QueuedUploadConfigurationError> {
        OriginalQueuedUploadConfigured::from_trusted_startup(
            self,
            source,
            homebox,
            credentials,
            input,
        )
    }
}

/// An original private producer separate from the phase that borrows it. Its
/// source and partition must be actual members of the same CapturedAccess.
pub(crate) struct OriginalQueuedUploadPrincipal<'captured, 'p> {
    captured: &'captured CapturedAccess<'p>,
    source: &'captured access::SourceGrant,
    partition: &'captured access::PartitionGrant,
}
impl<'captured, 'p> OriginalQueuedUploadPrincipal<'captured, 'p> {
    pub(crate) fn from_captured(
        configured: &OriginalQueuedUploadConfigured,
        captured: &'captured CapturedAccess<'p>,
        source: &'captured access::SourceGrant,
        partition: &'captured access::PartitionGrant,
    ) -> storage::Result<Self> {
        let descriptor = configured.descriptor();
        let owner_id = descriptor.owner.id().map_err(|_| unavailable())?;
        if !captured
            .source_grants()
            .iter()
            .any(|item| std::ptr::eq(item, source))
            || !captured
                .partition_grants()
                .iter()
                .any(|item| std::ptr::eq(item, partition))
            || source.reference().partition() != *partition.partition()
            || partition.partition() != &configured.source().partition()
            || source.reference().key.source_kind != access::SourceKind::HomeboxEntity
            || source.reference().key.external_id != owner_id.to_string()
            || !configured.source().contains(source.reference())
            || descriptor.authority.actor_id.to_string() != captured.principal().actor_id().as_str()
            || descriptor.context.workspace_id.to_string()
                != captured.principal().scope().workspace_id.as_str()
            || descriptor.context.home_id.to_string()
                != captured.principal().scope().home_id.as_str()
        {
            return Err(unavailable());
        }
        Ok(Self {
            captured,
            source,
            partition,
        })
    }
    pub(crate) fn captured(&self) -> &CapturedAccess<'p> {
        self.captured
    }
}
impl storage::StockActivityPrincipal for OriginalQueuedUploadPrincipal<'_, '_> {
    fn original_activity_principal(&self) -> &access::Principal {
        self.captured.principal()
    }
    fn original_activity_source(&self) -> &access::SourceGrant {
        self.source
    }
    fn original_activity_partition(&self) -> &access::PartitionGrant {
        self.partition
    }
}

/// One actual Store-borrowed physical observation and same original Access
/// phase. An observation is DATA; the source still needs current qualification.
pub struct OriginalQueuedUploadPhysical<'phase, 'p> {
    configured: &'phase Arc<OriginalQueuedUploadConfigured>,
    phase: UploadPhysicalPhase<'phase, 'p>,
}
enum UploadPhysicalPhase<'phase, 'p> {
    Store {
        observation: Box<
            storage::QuantityInstallationObservation<
                'phase,
                OriginalQueuedUploadPrincipal<'phase, 'p>,
            >,
        >,
        _store: &'phase mut Store,
    },
    Transaction(
        &'phase storage::QuantityInstallationTransaction<
            'phase,
            'phase,
            OriginalQueuedUploadPrincipal<'phase, 'p>,
        >,
    ),
}
impl<'phase, 'p> OriginalQueuedUploadPhysical<'phase, 'p> {
    fn observation(
        &self,
    ) -> &storage::QuantityInstallationObservation<'phase, OriginalQueuedUploadPrincipal<'phase, 'p>>
    {
        match &self.phase {
            UploadPhysicalPhase::Store { observation, .. } => observation,
            UploadPhysicalPhase::Transaction(transaction) => transaction.observation(),
        }
    }
    pub(crate) fn from_activity_transaction(
        configured: &'phase Arc<OriginalQueuedUploadConfigured>,
        transaction: &'phase storage::QuantityInstallationTransaction<
            'phase,
            'phase,
            OriginalQueuedUploadPrincipal<'phase, 'p>,
        >,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<Self> {
        let observation = transaction.observation();
        let original = observation.original();
        if !configured.store_identity().matches_observation(observation)
            || !std::ptr::eq(guard.principal(), original.original_activity_principal())
            || observation.source_metadata() != configured.metadata()
            || observation.queue_config() != configured.queue()
            || observation.registration() != configured.physical()
            || observation.source_reference() != original.original_activity_source().reference()
            || observation.source_partition() != original.original_activity_partition().partition()
        {
            return Err(unavailable());
        }
        guard.assert_mutation().map_err(|_| unavailable())?;
        guard
            .revalidate_source(original.original_activity_source())
            .map_err(|_| unavailable())?;
        guard
            .revalidate_source_partition(original.original_activity_partition())
            .map_err(|_| unavailable())?;
        Ok(Self {
            configured,
            phase: UploadPhysicalPhase::Transaction(transaction),
        })
    }
    pub fn configured(&self) -> &Arc<OriginalQueuedUploadConfigured> {
        self.configured
    }
    pub fn captured(&self) -> &CapturedAccess<'p> {
        self.observation().original().captured()
    }
    pub fn source(&self) -> &access::SourceGrant {
        self.observation().original().original_activity_source()
    }
    pub fn partition(&self) -> &access::PartitionGrant {
        self.observation().original().original_activity_partition()
    }
    pub fn source_metadata(&self) -> &access::SourceAuthorityMetadata {
        self.observation().source_metadata()
    }
    pub fn queue_config(&self) -> &crate::jobs::QueueConfig {
        self.observation().queue_config()
    }
    pub fn registration(&self) -> &storage::StockActivityPhysicalRegistration {
        self.observation().registration()
    }
    pub fn matches_configured_store(&self) -> bool {
        self.configured
            .store_identity()
            .matches_observation(self.observation())
    }
}

impl OriginalQueuedUploadConfigured {
    /// Execute a same-Store, same-Access physical phase using a private producer
    /// borrowed from the existing captured grants. Callback success is not a
    /// publication, admission, or authority receipt.
    pub fn with_original_physical<'captured, 'p, T>(
        self: &Arc<Self>,
        store: &mut Store,
        captured: &'captured CapturedAccess<'p>,
        source: &'captured access::SourceGrant,
        partition: &'captured access::PartitionGrant,
        guard: &access::TransactionAuthorization<'_>,
        operation: impl FnOnce(&OriginalQueuedUploadPhysical<'_, 'p>) -> storage::Result<T>,
    ) -> storage::Result<T> {
        let original =
            OriginalQueuedUploadPrincipal::from_captured(self, captured, source, partition)?;
        let physical = self.observe_original(store, &original, guard)?;
        operation(&physical)
    }

    /// The caller holds actual Store then Access. No lock is acquired here.
    pub(crate) fn observe_original<'phase, 'p>(
        self: &'phase Arc<Self>,
        store: &'phase mut Store,
        original: &'phase OriginalQueuedUploadPrincipal<'phase, 'p>,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<OriginalQueuedUploadPhysical<'phase, 'p>> {
        if !Arc::ptr_eq(&store.configured_authorization().0, self.access())
            || !std::ptr::eq(guard.principal(), original.original_activity_principal())
            || !original
                .captured()
                .source_grants()
                .iter()
                .any(|item| std::ptr::eq(item, original.original_activity_source()))
            || !original
                .captured()
                .partition_grants()
                .iter()
                .any(|item| std::ptr::eq(item, original.original_activity_partition()))
        {
            return Err(unavailable());
        }
        guard.assert_mutation().map_err(|_| unavailable())?;
        guard
            .revalidate_source(original.original_activity_source())
            .map_err(|_| unavailable())?;
        guard
            .revalidate_source_partition(original.original_activity_partition())
            .map_err(|_| unavailable())?;
        let observation = store.observe_quantity_installation_with_authorization(
            original,
            guard,
            self.queue(),
            self.physical(),
        )?;
        if !self.store_identity().matches_observation(&observation)
            || observation.source_metadata() != self.metadata()
            || observation.source_reference() != original.original_activity_source().reference()
            || observation.source_partition() != original.original_activity_partition().partition()
            || observation.queue_config() != self.queue()
            || observation.registration() != self.physical()
        {
            return Err(unavailable());
        }
        Ok(OriginalQueuedUploadPhysical {
            configured: self,
            phase: UploadPhysicalPhase::Store {
                observation: Box::new(observation),
                _store: store,
            },
        })
    }
}
