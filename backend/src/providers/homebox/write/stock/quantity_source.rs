//! Concrete quantity PATCH preparation/readback GET owner. No dispatch occurs here.
use super::quantity_observation::{
    IssuedQuantityObservation, QuantityFenceError, quantity_access_error, quantity_reader_check,
    quantity_revision,
};
use super::*;
use crate::{
    access as a, app::stock_activity_principal::OriginalStockActivityPrincipal,
    providers::homebox::read, storage::StockActivityPrincipal,
};
use sha2::{Digest as _, Sha256};
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

pub struct QuantitySource<'p, T, K> {
    owner: &'p OriginalStockActivityPrincipal,
    registry: &'p QuantityObservationRegistry<'p, T, K>,
    reader: Arc<tokio::sync::Mutex<read::HomeBoxReader<T, K>>>,
    access: Arc<Mutex<a::AccessBoundary>>,
}
/// Sealed correlation evidence; no constructor, Clone, serde or data authority.
pub struct QuantityCaptureEvidence<'p, T, K> {
    owner: &'p OriginalStockActivityPrincipal,
    registry: &'p QuantityObservationRegistry<'p, T, K>,
    observation: Arc<IssuedQuantityObservation<'p, T, K>>,
    metadata: a::SourceAuthorityMetadata,
    captured_at: Instant,
    raw_digest: Digest,
    revision: String,
    readback: bool,
    operation: Option<StoredOperation>,
    readback_plan: Option<ReadbackPlan>,
}
impl<'p, T: read::Transport, K: read::Clock + Send + Sync> QuantitySource<'p, T, K> {
    /// The retained original allocation, never an authority reconstructed from DATA.
    pub fn original(&self) -> &OriginalStockActivityPrincipal {
        self.owner
    }
    /// Configured ownership exists only on the original sealed installation.
    /// An unbound or fixture profile yields None; no descriptor/hash is adopted.
    pub fn configured(
        &self,
    ) -> Option<&Arc<crate::config::providers::quantity_installation::OriginalQuantityConfigured>>
    {
        self.registry
            .preview
            .profile
            .installation
            .as_ref()
            .map(|owner| owner.configured())
    }

    /// Revalidate original raw/evidence custody and finite capture age. The
    /// activity transaction must separately qualify its actual physical owner.
    pub(super) fn revalidate_activity_capture(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        capture: &DecodedFreshPreparation<QuantityCaptureEvidence<'p, T, K>>,
    ) -> Result<(), StockErrorCode> {
        let installation = self
            .registry
            .preview
            .profile
            .installation
            .as_ref()
            .ok_or(StockErrorCode::ProviderUnqualified)?;
        installation.check_capture_window()?;
        if capture.snapshots().len() != 1
            || !capture
                .evidence()
                .observation
                .installation
                .as_ref()
                .is_some_and(|owner| Arc::ptr_eq(owner, installation))
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        let snapshot = &capture.snapshots()[0];
        self.qualify_capture(
            capture.evidence(),
            snapshot.original(),
            snapshot.source(),
            false,
            guard,
        )
    }

    pub fn from_installed(
        owner: &'p OriginalStockActivityPrincipal,
        registry: &'p QuantityObservationRegistry<'p, T, K>,
        reader: &QuantityInstalledReader<'p, T, K>,
    ) -> Result<Self, StockErrorCode> {
        if !std::ptr::eq(reader.preview, registry.preview)
            || !registry
                .preview
                .profile
                .installation
                .as_ref()
                .is_some_and(|installation| Arc::ptr_eq(installation, &reader.installation))
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        Self::new(
            owner,
            registry,
            Arc::clone(&reader.reader),
            Arc::clone(reader.installation.configured().access()),
        )
    }
    pub fn new(
        owner: &'p OriginalStockActivityPrincipal,
        registry: &'p QuantityObservationRegistry<'p, T, K>,
        reader: Arc<tokio::sync::Mutex<read::HomeBoxReader<T, K>>>,
        access: Arc<Mutex<a::AccessBoundary>>,
    ) -> Result<Self, StockErrorCode> {
        let preview = registry.preview;
        if !std::ptr::eq(owner.original_activity_principal(), preview.principal)
            || owner.original_activity_source().reference() != preview.source.reference()
            || owner.original_activity_partition().partition() != preview.partition.partition()
        {
            return Err(StockErrorCode::CapabilityDenied);
        }
        preview
            .profile
            .check_data(owner.command(), owner.captured_authority())?;
        let observation = registry.lookup(owner.command().provider_observation)?;
        if !Arc::ptr_eq(&observation.access, &access) || !Arc::ptr_eq(&observation.reader, &reader)
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        if let Some(installation) = &preview.profile.installation
            && (!observation
                .installation
                .as_ref()
                .is_some_and(|issued| Arc::ptr_eq(issued, installation))
                || !Arc::ptr_eq(installation.configured().access(), &access))
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        {
            let configured = reader
                .try_lock()
                .map_err(|_| StockErrorCode::ResourceUnavailable)?;
            quantity_reader_check(&configured, &observation.metadata)?;
        }
        Ok(Self {
            owner,
            registry,
            reader,
            access,
        })
    }
    fn check_original(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<(), StockErrorCode> {
        if command != self.owner.command() || authority != self.owner.captured_authority() {
            return Err(StockErrorCode::PreflightConflict);
        }
        self.registry.preview.profile.check_data(command, authority)
    }
    fn check_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<a::SourceAuthorityMetadata, StockErrorCode> {
        let metadata = self.registry.preview.check_guard(guard)?;
        guard
            .revalidate_source(self.owner.original_activity_source())
            .map_err(quantity_access_error)?;
        guard
            .revalidate_source_partition(self.owner.original_activity_partition())
            .map_err(quantity_access_error)?;
        Ok(metadata)
    }
    fn fence(&self) -> Result<a::SourceAuthorityMetadata, StockErrorCode> {
        let mut boundary = self
            .access
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let mut result = None;
        boundary
            .with_mutation_authorization(self.owner.original_activity_principal(), |guard| {
                result = Some(self.check_guard(guard).map_err(QuantityFenceError)?);
                Ok::<(), QuantityFenceError>(())
            })
            .map_err(|e| e.0)?;
        result.ok_or(StockErrorCode::ResourceUnavailable)
    }
    async fn capture(
        &self,
        readback: bool,
    ) -> Result<(QuantityCaptureEvidence<'p, T, K>, FreshNativeCapture), StockErrorCode> {
        let command = self.owner.command();
        self.check_original(command, self.owner.captured_authority())?;
        let observation = self.registry.lookup(command.provider_observation)?;
        let metadata = self.fence()?;
        if metadata != observation.metadata {
            return Err(StockErrorCode::PreflightConflict);
        }
        let id = read::Uuid::parse(
            &command
                .target
                .id()
                .map_err(|_| StockErrorCode::InvalidArgument)?
                .to_string(),
        )
        .map_err(|_| StockErrorCode::InvalidArgument)?;
        let capture = {
            let mut configured = self.reader.lock().await;
            quantity_reader_check(&configured, &metadata)?;
            configured
                .capture_stock_entity(&id)
                .await
                .map_err(|_| StockErrorCode::ResourceUnavailable)?
        };
        let captured_at = Instant::now();
        if self.fence()? != metadata {
            return Err(StockErrorCode::PreflightConflict);
        }
        let revision = quantity_revision(capture.source_json())?.to_owned();
        let raw = capture.into_fresh(&command.context, command.target.clone())?;
        if !readback
            && (raw.original != observation.capture.original || revision != observation.revision)
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let evidence = QuantityCaptureEvidence {
            owner: self.owner,
            registry: self.registry,
            observation,
            metadata,
            captured_at,
            raw_digest: raw_digest(&raw.original)?,
            revision,
            readback,
            operation: None,
            readback_plan: None,
        };
        Ok((evidence, raw))
    }
    fn qualify_capture(
        &self,
        evidence: &QuantityCaptureEvidence<'p, T, K>,
        raw: &FreshNativeCapture,
        source: &serde_json::Value,
        readback: bool,
        guard: &a::TransactionAuthorization<'_>,
    ) -> Result<(), StockErrorCode> {
        self.check_original(self.owner.command(), self.owner.captured_authority())?;
        let current = self
            .registry
            .lookup(self.owner.command().provider_observation)?;
        if !std::ptr::eq(evidence.owner, self.owner)
            || !std::ptr::eq(evidence.registry, self.registry)
            || !Arc::ptr_eq(&evidence.observation, &current)
            || evidence.readback != readback
            || evidence.captured_at.elapsed() > self.registry.preview.profile.expected.freshness
            || self.check_guard(guard)? != evidence.metadata
            || raw_digest(&raw.original)? != evidence.raw_digest
            || quantity_revision(source)? != evidence.revision
            || raw.target != self.owner.command().target
            || raw.path
                != format!(
                    "/api/v1/entities/{}",
                    raw.target
                        .id()
                        .map_err(|_| StockErrorCode::InvalidArgument)?
                )
            || !raw.query.is_empty()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        if !readback
            && (raw.original != current.capture.original || evidence.revision != current.revision)
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        // Bytes/revision/grants are correlated above. Genuine installed route
        // and policy authority is still mandatory; DATA never opens production.
        Ok(())
    }
}
impl<'p, T: read::Transport, K: read::Clock + Send + Sync> FreshPreparationSourcePort
    for QuantitySource<'p, T, K>
{
    type Evidence = QuantityCaptureEvidence<'p, T, K>;
    async fn capture_preparation(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<FreshPreparationCapture<Self::Evidence>, StockErrorCode> {
        self.check_original(command, authority)?;
        let (evidence, raw) = self.capture(false).await?;
        Ok(FreshPreparationCapture {
            evidence,
            snapshots: vec![raw],
        })
    }
    fn qualify_preparation(
        &self,
        _: &StockCommand,
        _: &StockAuthority,
        _: &DecodedFreshPreparation<Self::Evidence>,
    ) -> Result<StockPreflight, StockErrorCode> {
        Err(StockErrorCode::UnsupportedCapability)
    }
    fn qualify_preparation_in_guard(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<Self::Evidence>,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Result<StockPreflight, StockErrorCode> {
        self.check_original(command, authority)?;
        if !std::ptr::eq(
            context.captured().principal(),
            self.owner.original_activity_principal(),
        ) || !context
            .captured()
            .source_grants()
            .iter()
            .any(|g| g.reference() == self.owner.original_activity_source().reference())
            || !context
                .captured()
                .partition_grants()
                .iter()
                .any(|g| g.partition() == self.owner.original_activity_partition().partition())
            || capture.snapshots().len() != 1
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        for grant in context.captured().source_grants() {
            context
                .guard()
                .revalidate_source(grant)
                .map_err(quantity_access_error)?;
        }
        for grant in context.captured().partition_grants() {
            context
                .guard()
                .revalidate_source_partition(grant)
                .map_err(quantity_access_error)?;
        }
        let snapshot = &capture.snapshots()[0];
        self.qualify_capture(
            capture.evidence(),
            snapshot.original(),
            snapshot.source(),
            false,
            context.guard(),
        )?;
        let preparation = Preparation {
            snapshots: vec![NativeSnapshot {
                target: command.target.clone(),
                value: snapshot.snapshot_value().clone(),
                digest: snapshot.digest().clone(),
                complete: true,
                hidden_fields_preserved: false,
            }],
            ..Preparation::default()
        };
        let plan =
            map_stock(command, &preparation).map_err(|_| StockErrorCode::UnsupportedCapability)?;
        if plan.request.method != NativeMethod::Patch
            || !plan.request.query.is_empty()
            || plan.request.path != snapshot.original().path
            || plan.requires_complete_impact
        {
            return Err(StockErrorCode::UnsupportedCapability);
        }
        let admission = self
            .registry
            .preview
            .profile
            .require_installed_authority(self.owner, context)?;
        let proof_digest = match admission {
            Some(receipt) => receipt.bind_capture(capture.capture_digest())?,
            None => capture.capture_digest().clone(),
        };
        Ok(StockPreflight {
            preparation,
            provider_observation: command.provider_observation,
            request_digest: command.request_digest.clone(),
            source_epoch: authority.source_epoch,
            preflight_digest: proof_digest,
        })
    }
}
impl<'p, T: read::Transport, K: read::Clock + Send + Sync> FreshReadbackSourcePort
    for QuantitySource<'p, T, K>
{
    type Evidence = QuantityCaptureEvidence<'p, T, K>;
    async fn capture_readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<FreshReadbackCapture<Self::Evidence>> {
        self.check_original(&operation.command, authority).ok()?;
        if operation.actor_id != authority.actor_id
            || operation.captured_authority != *authority
            || plan.target != operation.command.target
            || plan.absence
            || plan.selector != ReadbackSelector::Whole
            || !plan.query.is_empty()
            || plan.path != format!("/api/v1/entities/{}", plan.target.id().ok()?)
        {
            return None;
        }
        let original_plan = operation.plan.as_ref()?;
        if original_plan.request.method != NativeMethod::Patch
            || original_plan.readback != *plan
            || operation
                .actual_target
                .as_ref()
                .is_some_and(|target| target != &plan.target)
        {
            return None;
        }
        let (mut evidence, snapshot) = self.capture(true).await.ok()?;
        evidence.operation = Some(operation.clone());
        evidence.readback_plan = Some(plan.clone());
        Some(FreshReadbackCapture { evidence, snapshot })
    }
    fn qualify_readback(
        &self,
        _: &StoredOperation,
        _: &ReadbackPlan,
        _: &StockAuthority,
        _: &DecodedFreshReadback<Self::Evidence>,
    ) -> Option<NativeObservation> {
        None
    }
    fn qualify_readback_in_guard(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
        capture: &DecodedFreshReadback<Self::Evidence>,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Option<NativeObservation> {
        self.check_original(&operation.command, authority).ok()?;
        if capture.evidence().operation.as_ref() != Some(operation)
            || capture.evidence().readback_plan.as_ref() != Some(plan)
        {
            return None;
        }
        if !std::ptr::eq(
            context.captured().principal(),
            self.owner.original_activity_principal(),
        ) || !context
            .captured()
            .source_grants()
            .iter()
            .any(|g| g.reference() == self.owner.original_activity_source().reference())
            || !context
                .captured()
                .partition_grants()
                .iter()
                .any(|g| g.partition() == self.owner.original_activity_partition().partition())
        {
            return None;
        }
        for grant in context.captured().source_grants() {
            context.guard().revalidate_source(grant).ok()?;
        }
        for grant in context.captured().partition_grants() {
            context.guard().revalidate_source_partition(grant).ok()?;
        }
        self.qualify_capture(
            capture.evidence(),
            capture.snapshot().original(),
            capture.snapshot().source(),
            true,
            context.guard(),
        )
        .ok()?;
        if plan.target != operation.command.target
            || plan.path != capture.snapshot().original().path
            || plan.query != capture.snapshot().original().query
        {
            return None;
        }
        let preparation = Preparation {
            snapshots: vec![NativeSnapshot {
                target: operation.command.target.clone(),
                value: capture.snapshot().snapshot_value().clone(),
                digest: capture.snapshot().digest().clone(),
                complete: true,
                hidden_fields_preserved: false,
            }],
            ..Preparation::default()
        };
        let mapped = map_stock(&operation.command, &preparation).ok()?;
        if operation.plan.as_ref() != Some(&mapped)
            || mapped.readback != *plan
            || mapped.request.method != NativeMethod::Patch
        {
            return None;
        }
        let admission = self
            .registry
            .preview
            .profile
            .require_installed_authority(self.owner, context)
            .ok()?;
        if let Some(receipt) = admission {
            receipt.bind_capture(&capture.evidence().raw_digest).ok()?;
        }
        Some(NativeObservation::Present {
            context: operation.command.context.clone(),
            target: plan.target.clone(),
            value: capture.snapshot().source().clone(),
            observed_at: capture.snapshot().original().observed_at.clone(),
            complete: true,
            impact: None,
        })
    }
}
fn raw_digest(bytes: &[u8]) -> Result<Digest, StockErrorCode> {
    Digest::parse(format!("{:x}", Sha256::digest(bytes)))
        .map_err(|_| StockErrorCode::PreflightConflict)
}
