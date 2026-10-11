use super::*;
use crate::{
    domain::stock::{Authority, Route, StockContractPort, ValidatedRequest, canonical_bytes},
    jobs::*,
    storage,
};

/// Immutable complete host configuration, including registrations with no jobs.
/// Physical identities/configuration digests are never discovered from the DB.
pub struct TrustedQueueRegistry {
    configs: Vec<QueueConfig>,
}

impl TrustedQueueRegistry {
    pub fn new(configs: &[QueueConfig]) -> storage::Result<Self> {
        for (index, config) in configs.iter().enumerate() {
            config.validate().map_err(|_| incompatible())?;
            for previous in &configs[..index] {
                if previous.registration.identity.physical_database_id
                    == config.registration.identity.physical_database_id
                    || previous.registration.identity.deployment_id
                        == config.registration.identity.deployment_id
                        && previous.registration.aliases.iter().any(|left| {
                            config
                                .registration
                                .aliases
                                .iter()
                                .any(|right| left.partition == right.partition)
                        })
                {
                    return Err(incompatible());
                }
            }
        }
        Ok(Self {
            configs: configs.to_vec(),
        })
    }

    pub fn configs(&self) -> &[QueueConfig] {
        &self.configs
    }

    fn registration(&self, registration: &QueueRegistration) -> storage::Result<&QueueConfig> {
        self.configs
            .iter()
            .find(|config| &config.registration == registration)
            .ok_or_else(incompatible)
    }

    fn config(&self, config: &QueueConfig) -> storage::Result<()> {
        if self.registration(&config.registration)? != config {
            return Err(incompatible());
        }
        Ok(())
    }
}

/// Actual AT07 QueueDiscovery implementation. Required peers are borrowed and
/// have no success defaults. stock_contract_id is the trusted enqueue profile
/// ID used by the live owner; it is not inferred from a stored row or schema ID.
pub struct NativeQueueDiscovery<'a, C, A: RecoveryDiscoveryAuthority, O, M> {
    registry: TrustedQueueRegistry,
    stock_contract_id: &'a str,
    contracts: &'a C,
    authority: &'a A,
    grant: &'a A::Grant,
    original_owner: &'a O,
    media: &'a M,
}

pub struct QueueRecoveryBindings<'a, C, A: RecoveryDiscoveryAuthority, O, M> {
    pub stock_contract_id: &'a str,
    pub contracts: &'a C,
    pub authority: &'a A,
    pub grant: &'a A::Grant,
    pub original_owner: &'a O,
    pub media: &'a M,
}

impl<'a, C, A, O, M> NativeQueueDiscovery<'a, C, A, O, M>
where
    C: StockContractPort,
    A: RecoveryDiscoveryAuthority,
    O: OriginalEnqueueOwner,
    M: QueuedMediaRecovery<O::Proof>,
{
    pub fn new(
        configs: &[QueueConfig],
        bindings: QueueRecoveryBindings<'a, C, A, O, M>,
    ) -> storage::Result<Self> {
        if bindings.stock_contract_id.is_empty()
            || bindings.stock_contract_id.chars().count() > 4096
        {
            return Err(incompatible());
        }
        Ok(Self {
            registry: TrustedQueueRegistry::new(configs)?,
            stock_contract_id: bindings.stock_contract_id,
            contracts: bindings.contracts,
            authority: bindings.authority,
            grant: bindings.grant,
            original_owner: bindings.original_owner,
            media: bindings.media,
        })
    }

    pub fn registry(&self) -> &TrustedQueueRegistry {
        &self.registry
    }

    pub(super) fn authorize(&self, registration: &QueueRegistration) -> storage::Result<()> {
        self.registry.registration(registration)?;
        self.authority
            .revalidate(self.grant, self.registry.configs(), registration)
    }

    pub(super) fn correlate_original(
        &self,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> storage::Result<OriginalEnqueue<O::Proof>> {
        self.registry.config(config)?;
        self.authorize(&config.registration)?;
        request.validate().map_err(|_| incompatible())?;
        // Revalidate through the exact configured stock schema peer. A request
        // parsed through an unrelated permissive peer does not bypass this.
        let checked = ValidatedRequest::parse(self.contracts, original.raw().clone())
            .map_err(|_| incompatible())?;
        if checked.operation().authority != Authority::Homebox
            || !checked.is_mutation()
            || !matches!(
                checked.route(),
                Route::HomeboxNative(_) | Route::HomeboxFeature { .. }
            )
            || checked.intent_digest() != original.intent_digest()
            || checked.id() != original.id()
            || checked.route() != original.route()
            || request.intent.contract_id != self.stock_contract_id
            || request.intent.operation_id != checked.id().as_str()
            || request.intent.request_digest.as_hex() != checked.intent_digest()
            || request.receipt.workspace_id != checked.context().workspace_id
            || request.receipt.home_id != checked.context().home_id
            || Some(request.receipt.mutation_id.as_str())
                != checked.raw()["idempotencyKey"].as_str()
            || Some(request.partition.source_instance_id.as_str())
                != checked.target()["sourceInstanceId"].as_str()
            || Some(request.partition.collection_id.as_str())
                != checked.target()["collectionId"].as_str()
            || config
                .registration
                .resolve(&request.partition, &request.write_scope)
                .map_err(|_| incompatible())?
                != *scope
            || checked.whole_collection_required()
                && request.write_scope.selection != ScopeSelection::Collection
        {
            return Err(incompatible());
        }
        let origin = self.original_owner.retained_enqueue(
            &config.registration,
            &request.receipt,
            &checked,
        )?;
        if origin.physical_identity != config.registration.identity
            || canonical_bytes(origin.original.raw()).map_err(|_| incompatible())?
                != canonical_bytes(checked.raw()).map_err(|_| incompatible())?
            || origin.original.intent_digest() != checked.intent_digest()
            || origin.expected != *request
        {
            return Err(incompatible());
        }
        self.media.validate_original(&RetainedEnqueue {
            config,
            original,
            request,
            scope,
            original_proof: &origin.proof,
        })?;
        self.authorize(&config.registration)?;
        Ok(origin)
    }

    pub(super) fn media(&self) -> &M {
        self.media
    }

    pub(super) fn correlate_attempt(
        &self,
        config: &QueueConfig,
        origin: &OriginalEnqueue<O::Proof>,
        job: &LeasedJob,
    ) -> storage::Result<()> {
        if self.original_owner.retained_attempt(
            &config.registration,
            &origin.proof,
            &job.lease.job_id,
            job.lease.fence,
            job.attempt,
        )? != *job
        {
            return Err(incompatible());
        }
        Ok(())
    }
}

impl<C, A, O, M> storage::QueueDiscovery for NativeQueueDiscovery<'_, C, A, O, M>
where
    C: StockContractPort,
    A: RecoveryDiscoveryAuthority,
    O: OriginalEnqueueOwner,
    M: QueuedMediaRecovery<O::Proof>,
{
    fn authorize_discovery(&self, registration: &QueueRegistration) -> storage::Result<()> {
        self.authorize(registration)
    }

    fn validate_retained_enqueue(
        &self,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> storage::Result<()> {
        self.correlate_original(original, request, scope, config)?;
        Ok(())
    }
}
