//! Pure decoding adapters for original-owner fresh capture/qualification ports.
//! Parsing establishes neither freshness, completeness, authority nor safe PUT.
use super::*;
use crate::providers::homebox::{read, wire};
use crate::{
    access as a,
    app::{
        homebox_quantity_startup::OriginalQuantityPhysical,
        homebox_queued_upload::OriginalQueuedUploadPhysical,
    },
    domain::stock as st,
    storage::StockActivityPrincipal as _,
};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::{collections::BTreeSet, future::Future};

/// Original source-owner input, never a cache projection or an authority DTO.
/// The owner must retain endpoint/response correlation and original evidence.
pub struct FreshNativeCapture {
    pub scope: read::SourceScope,
    pub target: StockTarget,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub original: Vec<u8>,
    pub observed_at: String,
}
pub struct FreshPreparationCapture<E> {
    pub evidence: E,
    pub snapshots: Vec<FreshNativeCapture>,
}
pub struct FreshReadbackCapture<E> {
    pub evidence: E,
    pub snapshot: FreshNativeCapture,
}

/// Actual held mutation guard and the original captured access handles.
/// This does not construct or replace either authority object.
pub struct FreshQualification<'g, 'tx, 'p> {
    guard: &'g a::TransactionAuthorization<'tx>,
    captured: &'g st::CapturedAccess<'p>,
    quantity_installation: Option<&'g OriginalQuantityPhysical<'g, 'p>>,
    queued_upload_installation: Option<&'g OriginalQueuedUploadPhysical<'g, 'p>>,
}
impl<'g, 'tx, 'p> FreshQualification<'g, 'tx, 'p> {
    pub fn new(
        guard: &'g a::TransactionAuthorization<'tx>,
        captured: &'g st::CapturedAccess<'p>,
    ) -> Result<Self, StockErrorCode> {
        let context = Self {
            guard,
            captured,
            quantity_installation: None,
            queued_upload_installation: None,
        };
        context.revalidate()?;
        Ok(context)
    }
    /// Retain the actual Store-borrowed physical observation with the original
    /// source wrapper. This checks only existing handles through the held
    /// guard; Store identity and queue checks remain with the source owner.
    pub fn with_quantity_installation(
        guard: &'g a::TransactionAuthorization<'tx>,
        captured: &'g st::CapturedAccess<'p>,
        physical: &'g OriginalQuantityPhysical<'g, 'p>,
    ) -> Result<Self, StockErrorCode> {
        let context = Self {
            guard,
            captured,
            quantity_installation: Some(physical),
            queued_upload_installation: None,
        };
        context.revalidate()?;
        Ok(context)
    }
    /// Bind a distinct actual upload physical observation. The selected
    /// original source/partition must be pointer members of this capture.
    pub fn with_queued_upload_installation(
        guard: &'g a::TransactionAuthorization<'tx>,
        captured: &'g st::CapturedAccess<'p>,
        physical: &'g OriginalQueuedUploadPhysical<'g, 'p>,
    ) -> Result<Self, StockErrorCode> {
        let context = Self {
            guard,
            captured,
            quantity_installation: None,
            queued_upload_installation: Some(physical),
        };
        context.revalidate()?;
        Ok(context)
    }
    pub fn guard(&self) -> &a::TransactionAuthorization<'tx> {
        self.guard
    }
    pub fn captured(&self) -> &st::CapturedAccess<'p> {
        self.captured
    }
    pub fn quantity_installation(&self) -> Option<&OriginalQuantityPhysical<'g, 'p>> {
        self.quantity_installation
    }
    pub fn queued_upload_installation(&self) -> Option<&OriginalQueuedUploadPhysical<'g, 'p>> {
        self.queued_upload_installation
    }

    /// Recheck the original handles using this same held authorization. This
    /// does not acquire another lock or issue replacement grants.
    pub(super) fn revalidate(&self) -> Result<(), StockErrorCode> {
        if !std::ptr::eq(self.guard.principal(), self.captured.principal()) {
            return Err(StockErrorCode::CapabilityDenied);
        }
        self.guard.assert_mutation().map_err(access_error)?;
        for grant in self.captured.source_grants() {
            self.guard.revalidate_source(grant).map_err(access_error)?;
        }
        for grant in self.captured.partition_grants() {
            self.guard
                .revalidate_source_partition(grant)
                .map_err(access_error)?;
        }
        if let Some(physical) = self.quantity_installation {
            let observation = physical.observation();
            let original = observation.original();
            let principal = original.original_activity_principal();
            let source = original.original_activity_source();
            let partition = original.original_activity_partition();
            if !std::ptr::eq(principal, self.guard.principal())
                || !std::ptr::eq(principal, self.captured.principal())
                || source.reference() != observation.source_reference()
                || partition.partition() != observation.source_partition()
                || source.reference().partition() != *partition.partition()
                || !self
                    .captured
                    .source_grants()
                    .iter()
                    .any(|grant| grant.reference() == source.reference())
                || !self
                    .captured
                    .partition_grants()
                    .iter()
                    .any(|grant| grant.partition() == partition.partition())
            {
                return Err(StockErrorCode::CapabilityDenied);
            }
            let command = original.command();
            let owner_id = match command.target.resource_kind {
                ResourceKind::Entity => command.target.id(),
                _ => command.target.owner(),
            }
            .map_err(|_| StockErrorCode::PreflightConflict)?;
            let reference = source.reference();
            if reference.workspace_id.as_str() != command.context.workspace_id.to_string()
                || reference.home_id.as_str() != command.context.home_id.to_string()
                || reference.key.source_kind != a::SourceKind::HomeboxEntity
                || reference.key.source_instance_id.as_str()
                    != command.target.source_instance_id.to_string()
                || reference.key.collection_id != command.target.collection_id.to_string()
                || reference.key.external_id != owner_id.to_string()
            {
                return Err(StockErrorCode::PreflightConflict);
            }
            self.guard.revalidate_source(source).map_err(access_error)?;
            self.guard
                .revalidate_source_partition(partition)
                .map_err(access_error)?;
            let metadata = self
                .guard
                .persisted_source_metadata(partition)
                .map_err(access_error)?;
            if &metadata != observation.source_metadata()
                || metadata.registration().partition() != *partition.partition()
            {
                return Err(StockErrorCode::PreflightConflict);
            }
        }
        if let Some(physical) = self.queued_upload_installation {
            if !physical.matches_configured_store()
                || !std::ptr::eq(physical.captured(), self.captured)
                || !std::ptr::eq(physical.captured().principal(), self.guard.principal())
                || !self
                    .captured
                    .source_grants()
                    .iter()
                    .any(|grant| std::ptr::eq(grant, physical.source()))
                || !self
                    .captured
                    .partition_grants()
                    .iter()
                    .any(|grant| std::ptr::eq(grant, physical.partition()))
                || physical.source().reference().partition() != *physical.partition().partition()
                || physical.source_metadata() != physical.configured().metadata()
                || physical.queue_config() != physical.configured().queue()
                || physical.registration() != physical.configured().physical()
            {
                return Err(StockErrorCode::CapabilityDenied);
            }
            self.guard
                .revalidate_source(physical.source())
                .map_err(access_error)?;
            self.guard
                .revalidate_source_partition(physical.partition())
                .map_err(access_error)?;
            if self
                .guard
                .persisted_source_metadata(physical.partition())
                .map_err(access_error)?
                != *physical.source_metadata()
            {
                return Err(StockErrorCode::PreflightConflict);
            }
        }
        self.guard.revalidate().map_err(access_error)?;
        Ok(())
    }
}

fn access_error(error: a::AccessError) -> StockErrorCode {
    match error {
        a::AccessError::Unauthenticated => StockErrorCode::Unauthenticated,
        a::AccessError::Forbidden => StockErrorCode::CapabilityDenied,
        a::AccessError::NotFound => StockErrorCode::ResourceUnavailable,
        a::AccessError::InvalidInput => StockErrorCode::InvalidArgument,
        a::AccessError::MethodNotAllowed => StockErrorCode::CapabilityDenied,
        a::AccessError::BodyTooLarge => StockErrorCode::InvalidArgument,
        a::AccessError::RateLimited | a::AccessError::Unavailable => {
            StockErrorCode::ResourceUnavailable
        }
    }
}

/// Original-owner evidence remains opaque and non-serializable to this adapter.
/// Qualification MUST check the original providerObservation, finite freshness
/// clocks, source revision/build/route, complete references/approved impact,
/// schema completeness and hidden-field preservation against these exact bytes.
/// Its opaque Evidence MUST bind the exact original principal and original
/// captured grants to the supplied guarded context; a new same-value capture
/// cannot replace the witness. The adapter cannot infer that binding.
/// It must retain that evidence privately and supply its genuine proof digest.
/// The adapter binds that digest and the exact qualified preparation to the
/// capture_digest. This is no grant or credential-release API.
pub trait FreshPreparationSourcePort: Sync {
    type Evidence: Send + Sync;
    fn capture_preparation(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> impl Future<Output = Result<FreshPreparationCapture<Self::Evidence>, StockErrorCode>> + Send;
    fn qualify_preparation(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<Self::Evidence>,
    ) -> Result<StockPreflight, StockErrorCode>;
    /// Recheck the original evidence and grants through the actual held guard.
    /// This is required for fenced admission; no synthetic fallback exists.
    fn qualify_preparation_in_guard(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<Self::Evidence>,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Result<StockPreflight, StockErrorCode>;
}
/// The source owner checks exact operation/GET correlation, current original
/// authority, freshness, complete snapshot/impact and output scope. It must
/// retain original evidence bound to the exact original principal and captured
/// grants in the guarded context; matching values is neither causality nor CAS.
pub trait FreshReadbackSourcePort: Sync {
    type Evidence: Send + Sync;
    fn capture_readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> impl Future<Output = Option<FreshReadbackCapture<Self::Evidence>>> + Send;
    fn qualify_readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
        capture: &DecodedFreshReadback<Self::Evidence>,
    ) -> Option<NativeObservation>;
    /// Qualify current original evidence and output scope under the actual
    /// held mutation guard and its retained original access handles.
    fn qualify_readback_in_guard(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
        capture: &DecodedFreshReadback<Self::Evidence>,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Option<NativeObservation>;
}

/// Parsed native value and exact original capture, with no completeness flags.
pub struct DecodedFreshSnapshot {
    capture: FreshNativeCapture,
    source: Value,
    snapshot_value: Value,
    digest: Digest,
}
impl DecodedFreshSnapshot {
    pub fn original(&self) -> &FreshNativeCapture {
        &self.capture
    }
    pub fn source(&self) -> &Value {
        &self.source
    }
    pub fn snapshot_value(&self) -> &Value {
        &self.snapshot_value
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
}
pub struct DecodedFreshPreparation<E> {
    evidence: E,
    snapshots: Vec<DecodedFreshSnapshot>,
    capture_digest: Digest,
}
impl<E> DecodedFreshPreparation<E> {
    pub fn evidence(&self) -> &E {
        &self.evidence
    }
    pub fn snapshots(&self) -> &[DecodedFreshSnapshot] {
        &self.snapshots
    }
    pub fn capture_digest(&self) -> &Digest {
        &self.capture_digest
    }
}
pub struct DecodedFreshReadback<E> {
    evidence: E,
    snapshot: DecodedFreshSnapshot,
}
impl<E> DecodedFreshReadback<E> {
    pub fn evidence(&self) -> &E {
        &self.evidence
    }
    pub fn snapshot(&self) -> &DecodedFreshSnapshot {
        &self.snapshot
    }
}

pub struct DecodedStockPreparation<C, S> {
    contracts: C,
    source: S,
    limits: wire::DecodeLimits,
}
impl<C, S> DecodedStockPreparation<C, S> {
    pub fn new(contracts: C, source: S, limits: wire::DecodeLimits) -> Self {
        Self {
            contracts,
            source,
            limits,
        }
    }
}
/// Retains the original decoded capture and its owner for a later admission
/// fence. These getters expose data only; a consuming fence must call
/// `revalidate` with current original authority before using it.
pub struct RetainedFreshPreparation<'owner, C, S: FreshPreparationSourcePort> {
    owner: &'owner DecodedStockPreparation<C, S>,
    command: StockCommand,
    authority: StockAuthority,
    capture: DecodedFreshPreparation<S::Evidence>,
    owner_preflight: StockPreflight,
    preflight: StockPreflight,
    plan: NativePlan,
}
/// The single original capture waits for an actual held mutation guard before
/// source qualification. Neither raw bytes nor opaque evidence are cloned.
pub struct PendingFreshPreparation<'owner, C, S: FreshPreparationSourcePort> {
    owner: &'owner DecodedStockPreparation<C, S>,
    command: StockCommand,
    authority: StockAuthority,
    input: FreshPreparationCapture<S::Evidence>,
}
impl<'owner, C: StockContractPort + Sync, S: FreshPreparationSourcePort>
    PendingFreshPreparation<'owner, C, S>
{
    pub fn finish_in_guard(
        self,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Result<RetainedFreshPreparation<'owner, C, S>, StockErrorCode> {
        context.revalidate()?;
        let capture = self
            .owner
            .decode_preparation(&self.command, &self.authority, self.input)?;
        let (owner_preflight, preflight, plan) = self.owner.qualify_decoded_in_guard(
            &self.command,
            &self.authority,
            &capture,
            context,
        )?;
        Ok(RetainedFreshPreparation {
            owner: self.owner,
            command: self.command,
            authority: self.authority,
            capture,
            owner_preflight,
            preflight,
            plan,
        })
    }
}
impl<'owner, C: StockContractPort + Sync, S: FreshPreparationSourcePort>
    RetainedFreshPreparation<'owner, C, S>
{
    /// Immutable original source identity; this getter issues no qualification.
    pub fn source(&self) -> &S {
        &self.owner.source
    }
    pub fn command(&self) -> &StockCommand {
        &self.command
    }
    pub fn authority(&self) -> &StockAuthority {
        &self.authority
    }
    pub fn capture(&self) -> &DecodedFreshPreparation<S::Evidence> {
        &self.capture
    }
    pub fn owner_preflight(&self) -> &StockPreflight {
        &self.owner_preflight
    }
    pub fn preflight(&self) -> &StockPreflight {
        &self.preflight
    }
    pub fn plan(&self) -> &NativePlan {
        &self.plan
    }

    /// Equality only correlates the submitted values with this retained
    /// capture. The original source owner must check current original P,
    /// grants, freshness, build/route, full graph and hidden fields again.
    pub fn revalidate(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<(), StockErrorCode> {
        if command != &self.command || authority != &self.authority {
            return Err(StockErrorCode::PreflightConflict);
        }
        let (owner_preflight, preflight, plan) =
            self.owner
                .qualify_decoded(command, authority, &self.capture)?;
        if owner_preflight != self.owner_preflight
            || preflight != self.preflight
            || plan != self.plan
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }

    /// A consuming admission fence must invoke this with current original
    /// authority while the actual mutation guard is held.
    pub fn revalidate_in_guard(
        &self,
        context: &FreshQualification<'_, '_, '_>,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<(), StockErrorCode> {
        if command != &self.command || authority != &self.authority {
            return Err(StockErrorCode::PreflightConflict);
        }
        context.revalidate()?;
        let (owner_preflight, preflight, plan) =
            self.owner
                .qualify_decoded_in_guard(command, authority, &self.capture, context)?;
        if owner_preflight != self.owner_preflight
            || preflight != self.preflight
            || plan != self.plan
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }
}
impl<C: StockContractPort + Sync, S: FreshPreparationSourcePort> DecodedStockPreparation<C, S> {
    pub async fn capture_pending<'owner>(
        &'owner self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<PendingFreshPreparation<'owner, C, S>, StockErrorCode> {
        validate_command(&self.contracts, command)?;
        let input = self.source.capture_preparation(command, authority).await?;
        Ok(PendingFreshPreparation {
            owner: self,
            command: command.clone(),
            authority: authority.clone(),
            input,
        })
    }

    pub async fn prepare_retained<'owner>(
        &'owner self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<RetainedFreshPreparation<'owner, C, S>, StockErrorCode> {
        validate_command(&self.contracts, command)?;
        let input = self.source.capture_preparation(command, authority).await?;
        let capture = self.decode_preparation(command, authority, input)?;
        let (owner_preflight, preflight, plan) =
            self.qualify_decoded(command, authority, &capture)?;
        Ok(RetainedFreshPreparation {
            owner: self,
            command: command.clone(),
            authority: authority.clone(),
            capture,
            owner_preflight,
            preflight,
            plan,
        })
    }

    fn decode_preparation(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        input: FreshPreparationCapture<S::Evidence>,
    ) -> Result<DecodedFreshPreparation<S::Evidence>, StockErrorCode> {
        bounded(
            self.limits,
            input.snapshots.iter().map(|s| s.original.len()),
        )?;
        let mut targets = BTreeSet::new();
        let mut snapshots = Vec::new();
        for raw in input.snapshots {
            scope_matches(&raw, command)?;
            let key =
                serde_json::to_string(&raw.target).map_err(|_| StockErrorCode::InvalidArgument)?;
            if !targets.insert(key) {
                return Err(StockErrorCode::PreflightConflict);
            }
            snapshots.push(decode(&self.contracts, raw, self.limits)?);
        }
        let captures: Vec<_> = snapshots
            .iter()
            .map(|s| {
                json!({
                    "scope":s.capture.scope,"target":s.capture.target,"path":s.capture.path,
                    "query":s.capture.query,"observedAt":s.capture.observed_at,
                    "originalSha256":format!("{:x}",Sha256::digest(&s.capture.original)),
                    "nativeDigest":s.digest
                })
            })
            .collect();
        let capture_digest = self
            .contracts
            .digest_native(&json!({
                "originalRequest":command.original_wire,"actorId":authority.actor_id,
                "sourceEpoch":authority.source_epoch,"authorityDigest":authority.authority_digest,
                "deploymentId":authority.physical_binding.deployment_id,
                "physicalDatabaseId":authority.physical_binding.physical_database_id,
                "configurationDigest":authority.physical_binding.configuration_digest,
                "qualification":qualification(&authority.qualification),"captures":captures
            }))
            .map_err(|_| StockErrorCode::PreflightConflict)?;
        Ok(DecodedFreshPreparation {
            evidence: input.evidence,
            snapshots,
            capture_digest,
        })
    }

    fn qualify_decoded(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<S::Evidence>,
    ) -> Result<(StockPreflight, StockPreflight, NativePlan), StockErrorCode> {
        validate_command(&self.contracts, command)?;
        let preflight = self
            .source
            .qualify_preparation(command, authority, capture)?;
        self.check_qualification(command, authority, capture, preflight)
    }

    fn qualify_decoded_in_guard(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<S::Evidence>,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Result<(StockPreflight, StockPreflight, NativePlan), StockErrorCode> {
        validate_command(&self.contracts, command)?;
        let preflight = self
            .source
            .qualify_preparation_in_guard(command, authority, capture, context)?;
        self.check_qualification(command, authority, capture, preflight)
    }

    fn check_qualification(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<S::Evidence>,
        mut preflight: StockPreflight,
    ) -> Result<(StockPreflight, StockPreflight, NativePlan), StockErrorCode> {
        if preflight.provider_observation != command.provider_observation
            || preflight.request_digest != command.request_digest
            || preflight.source_epoch != authority.source_epoch
            || preflight.preparation.snapshots.len() != capture.snapshots.len()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let mut seen = BTreeSet::new();
        for snapshot in &preflight.preparation.snapshots {
            let key = serde_json::to_string(&snapshot.target)
                .map_err(|_| StockErrorCode::InvalidArgument)?;
            let native = capture
                .snapshots
                .iter()
                .find(|s| s.capture.target == snapshot.target)
                .ok_or(StockErrorCode::PreflightConflict)?;
            if !seen.insert(key)
                || !snapshot.complete
                || snapshot.value != native.snapshot_value
                || snapshot.digest != native.digest
            {
                return Err(StockErrorCode::PreflightConflict);
            }
        }
        // Reuse the actual writer's preservation/schema constraints. The
        // attested flags/clear forms/staged metadata are unchanged owner inputs.
        let plan = map_stock(command, &preflight.preparation)
            .map_err(|_| StockErrorCode::UnsupportedCapability)?;
        if plan.request.method == NativeMethod::Put {
            for snapshot in &capture.snapshots {
                full_put_known_shape(snapshot)?;
            }
        }
        let owner_preflight = preflight.clone();
        let snapshots:Vec<_>=preflight.preparation.snapshots.iter().map(|s|json!({
            "target":s.target,"digest":s.digest,"complete":s.complete,"hiddenFieldsPreserved":s.hidden_fields_preserved
        })).collect();
        let clears:Vec<_>=preflight.preparation.native_clear_values.iter().map(|c|json!({
            "commandId":c.command_id,"field":c.field,"nativeValue":c.native_value,"nativeReadbackValue":c.native_readback_value
        })).collect();
        // Commit to both exact byte/command/authority capture and the untouched
        // owner proof. This hash binds evidence; it never qualifies that proof.
        preflight.preflight_digest = self
            .contracts
            .digest_native(&json!({
                "kind":"homebox-decoded-fresh-preflight-v1","captureDigest":capture.capture_digest,
                "ownerPreflightDigest":preflight.preflight_digest,"snapshots":snapshots,
                "stagedUpload":preflight.preparation.staged_upload,"nativeClearValues":clears
            }))
            .map_err(|_| StockErrorCode::PreflightConflict)?;
        Ok((owner_preflight, preflight, plan))
    }
}
impl<C: StockContractPort + Sync, S: FreshPreparationSourcePort> StockPreparationPort
    for DecodedStockPreparation<C, S>
{
    async fn prepare(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<StockPreflight, StockErrorCode> {
        Ok(self.prepare_retained(command, authority).await?.preflight)
    }
}

pub struct DecodedStockReadback<C, S> {
    contracts: C,
    source: S,
    limits: wire::DecodeLimits,
}
/// Single decoded original GET and opaque source evidence awaiting a held
/// mutation guard. Construction is restricted to the exact source adapter.
pub struct PendingFreshReadback<'owner, C, S: FreshReadbackSourcePort> {
    owner: &'owner DecodedStockReadback<C, S>,
    operation: StoredOperation,
    plan: ReadbackPlan,
    authority: StockAuthority,
    capture: DecodedFreshReadback<S::Evidence>,
}
/// Qualified readback with the same original decoded GET and opaque evidence
/// still retained. Observation getters are data, not an admission permit.
pub struct RetainedFreshReadback<'owner, C, S: FreshReadbackSourcePort> {
    owner: &'owner DecodedStockReadback<C, S>,
    operation: StoredOperation,
    plan: ReadbackPlan,
    authority: StockAuthority,
    capture: DecodedFreshReadback<S::Evidence>,
    observation: NativeObservation,
}
impl<'owner, C, S: FreshReadbackSourcePort> RetainedFreshReadback<'owner, C, S> {
    pub fn operation(&self) -> &StoredOperation {
        &self.operation
    }
    pub fn plan(&self) -> &ReadbackPlan {
        &self.plan
    }
    pub fn authority(&self) -> &StockAuthority {
        &self.authority
    }
    pub fn observation(&self) -> &NativeObservation {
        &self.observation
    }
    pub fn capture(&self) -> &DecodedFreshReadback<S::Evidence> {
        &self.capture
    }
    pub fn source(&self) -> &S {
        &self.owner.source
    }
}
impl<'owner, C: StockContractPort + Sync, S: FreshReadbackSourcePort>
    PendingFreshReadback<'owner, C, S>
{
    pub fn finish_in_guard(
        self,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Option<NativeObservation> {
        Some(self.finish_in_guard_retained(context)?.observation)
    }

    pub fn finish_in_guard_retained(
        self,
        context: &FreshQualification<'_, '_, '_>,
    ) -> Option<RetainedFreshReadback<'owner, C, S>> {
        context.revalidate().ok()?;
        let observation = self.owner.source.qualify_readback_in_guard(
            &self.operation,
            &self.plan,
            &self.authority,
            &self.capture,
            context,
        )?;
        let observation =
            check_readback_observation(&self.operation, &self.plan, &self.capture, observation)?;
        Some(RetainedFreshReadback {
            owner: self.owner,
            operation: self.operation,
            plan: self.plan,
            authority: self.authority,
            capture: self.capture,
            observation,
        })
    }
}
impl<C, S> DecodedStockReadback<C, S> {
    /// Immutable source custody for exact original-owner checks before capture.
    pub fn source(&self) -> &S {
        &self.source
    }

    pub fn new(contracts: C, source: S, limits: wire::DecodeLimits) -> Self {
        Self {
            contracts,
            source,
            limits,
        }
    }
}
impl<C: StockContractPort + Sync, S: FreshReadbackSourcePort> StockReadbackPort
    for DecodedStockReadback<C, S>
{
    async fn readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> NativeObservation {
        self.present(operation, plan, authority)
            .await
            .unwrap_or(NativeObservation::Unavailable)
    }
}
impl<C: StockContractPort + Sync, S: FreshReadbackSourcePort> DecodedStockReadback<C, S> {
    pub async fn capture_pending<'owner>(
        &'owner self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<PendingFreshReadback<'owner, C, S>> {
        self.validate_readback_request(operation, plan, authority)?;
        let input = self
            .source
            .capture_readback(operation, plan, authority)
            .await?;
        let capture = self.decode_readback_input(operation, plan, input)?;
        Some(PendingFreshReadback {
            owner: self,
            operation: operation.clone(),
            plan: plan.clone(),
            authority: authority.clone(),
            capture,
        })
    }

    async fn present(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<NativeObservation> {
        let pending = self.capture_pending(operation, plan, authority).await?;
        let observation = self.source.qualify_readback(
            &pending.operation,
            &pending.plan,
            &pending.authority,
            &pending.capture,
        )?;
        check_readback_observation(
            &pending.operation,
            &pending.plan,
            &pending.capture,
            observation,
        )
    }

    fn validate_readback_request(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<()> {
        validate_command(&self.contracts, &operation.command).ok()?;
        if operation.actor_id != authority.actor_id
            || authority.physical_binding != operation.captured_authority.physical_binding
        {
            return None;
        }
        let original_plan = operation.plan.as_ref()?;
        let target = super::evidence::effective_target(operation, original_plan)?;
        let mut resolved = original_plan.readback.clone();
        resolved.target = target.clone();
        resolved.path = resolved
            .path
            .replace("{generatedId}", &target.id().ok()?.to_string());
        if &resolved != plan
            || plan.absence
            || matches!(
                plan.selector,
                ReadbackSelector::CompleteImpact | ReadbackSelector::Printer
            )
        {
            return None;
        }
        Some(())
    }

    fn decode_readback_input(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        input: FreshReadbackCapture<S::Evidence>,
    ) -> Option<DecodedFreshReadback<S::Evidence>> {
        bounded(self.limits, [input.snapshot.original.len()]).ok()?;
        scope_matches(&input.snapshot, &operation.command).ok()?;
        if input.snapshot.target != plan.target
            || input.snapshot.path != plan.path
            || input.snapshot.query != plan.query
        {
            return None;
        }
        let snapshot = decode(&self.contracts, input.snapshot, self.limits).ok()?;
        let capture = DecodedFreshReadback {
            evidence: input.evidence,
            snapshot,
        };
        Some(capture)
    }
}

fn check_readback_observation<E>(
    operation: &StoredOperation,
    plan: &ReadbackPlan,
    capture: &DecodedFreshReadback<E>,
    observation: NativeObservation,
) -> Option<NativeObservation> {
    let NativeObservation::Present {
        context,
        target,
        value,
        observed_at,
        complete,
        ..
    } = &observation
    else {
        return None;
    };
    if context != &operation.command.context
        || target != &plan.target
        || value != capture.snapshot.source()
        || observed_at != &capture.snapshot.original().observed_at
        || !complete
    {
        return None;
    }
    Some(observation)
}

fn validate_command<C: StockContractPort>(
    contracts: &C,
    command: &StockCommand,
) -> Result<(), StockErrorCode> {
    if contracts
        .validate_request(&command.original_wire)
        .map_err(|_| StockErrorCode::InvalidArgument)?
        != *command
    {
        return Err(StockErrorCode::PreflightConflict);
    }
    Ok(())
}
fn bounded(
    limits: wire::DecodeLimits,
    sizes: impl IntoIterator<Item = usize>,
) -> Result<(), StockErrorCode> {
    let cap = wire::DecodeLimits::default();
    if limits.max_response_bytes == 0
        || limits.max_response_bytes > cap.max_response_bytes
        || limits.max_entries == 0
        || limits.max_entries > cap.max_entries
        || limits.max_text_chars == 0
        || limits.max_text_chars > cap.max_text_chars
    {
        return Err(StockErrorCode::InvalidArgument);
    }
    let mut count = 0usize;
    let mut bytes = 0usize;
    for size in sizes {
        count += 1;
        bytes = bytes
            .checked_add(size)
            .ok_or(StockErrorCode::ResourceUnavailable)?;
    }
    if count > 100 || bytes > limits.max_response_bytes {
        return Err(StockErrorCode::ResourceUnavailable);
    }
    Ok(())
}
fn scope_matches(
    capture: &FreshNativeCapture,
    command: &StockCommand,
) -> Result<(), StockErrorCode> {
    let scope = &capture.scope;
    if scope.workspace_id.as_str() != command.context.workspace_id.to_string()
        || scope.home_id.as_str() != command.context.home_id.to_string()
        || scope.source_instance_id.as_str() != capture.target.source_instance_id.to_string()
        || scope.collection_id != capture.target.collection_id.to_string()
        || !capture.target.same_partition(&command.target)
        || capture.target.id().is_err()
        || capture.target.id().is_ok_and(|id| id.is_nil())
        || (capture.target.resource_kind == ResourceKind::Entity
            && capture.target.entity_id.is_some())
    {
        return Err(StockErrorCode::PreflightConflict);
    }
    Ok(())
}
fn decode<C: StockContractPort>(
    contracts: &C,
    capture: FreshNativeCapture,
    limits: wire::DecodeLimits,
) -> Result<DecodedFreshSnapshot, StockErrorCode> {
    read::Timestamp::parse(&capture.observed_at).map_err(|_| StockErrorCode::InvalidArgument)?;
    contracts
        .validate_observed_at(&capture.observed_at)
        .map_err(|_| StockErrorCode::InvalidArgument)?;
    // Shared bounded parser also checks aggregate entries/text, including unknown
    // source properties. Typed decoders validate existing native resource facts.
    let source = wire::parse_observation(&capture.original, limits)
        .map_err(|_| StockErrorCode::InvalidArgument)?;
    let target = &capture.target;
    let (expected_path, expected_query, snapshot_value) = match target.resource_kind {
        ResourceKind::Entity | ResourceKind::Field | ResourceKind::Attachment => {
            let owner = if target.resource_kind == ResourceKind::Entity {
                target.id()
            } else {
                target.owner()
            }
            .map_err(|_| StockErrorCode::InvalidArgument)?;
            if owner.is_nil() {
                return Err(StockErrorCode::InvalidArgument);
            }
            let id = read::Uuid::parse(&owner.to_string())
                .map_err(|_| StockErrorCode::InvalidArgument)?;
            let decoded = wire::decode_detail(&capture.original, &id, limits)
                .map_err(|_| StockErrorCode::InvalidArgument)?;
            if decoded.source != source {
                return Err(StockErrorCode::PreflightConflict);
            }
            if target.resource_kind != ResourceKind::Entity {
                let field = if target.resource_kind == ResourceKind::Field {
                    "fields"
                } else {
                    "attachments"
                };
                let rows = source[field]
                    .as_array()
                    .ok_or(StockErrorCode::ResourceUnavailable)?;
                if rows
                    .iter()
                    .filter(|row| row["id"].as_str() == Some(&target.id().unwrap().to_string()))
                    .count()
                    != 1
                {
                    return Err(StockErrorCode::PreflightConflict);
                }
            }
            (format!("/api/v1/entities/{owner}"), vec![], source.clone())
        }
        ResourceKind::Maintenance => {
            let owner = target
                .owner()
                .map_err(|_| StockErrorCode::InvalidArgument)?;
            if owner.is_nil() {
                return Err(StockErrorCode::InvalidArgument);
            }
            let id = read::Uuid::parse(&owner.to_string())
                .map_err(|_| StockErrorCode::InvalidArgument)?;
            let decoded = wire::decode_maintenance(&capture.original, &id, limits)
                .map_err(|_| StockErrorCode::InvalidArgument)?;
            if decoded.source != source {
                return Err(StockErrorCode::PreflightConflict);
            }
            let rows = source
                .as_array()
                .ok_or(StockErrorCode::ResourceUnavailable)?;
            let found: Vec<_> = rows
                .iter()
                .filter(|row| row["id"].as_str() == Some(&target.id().unwrap().to_string()))
                .collect();
            if found.len() != 1 {
                return Err(StockErrorCode::PreflightConflict);
            }
            (
                format!("/api/v1/entities/{owner}/maintenance"),
                vec![("status".into(), "both".into())],
                found[0].clone(),
            )
        }
        _ => return Err(StockErrorCode::UnsupportedCapability),
    };
    if capture.path != expected_path || capture.query != expected_query {
        return Err(StockErrorCode::PreflightConflict);
    }
    let digest = contracts
        .digest_native(&snapshot_value)
        .map_err(|_| StockErrorCode::PreflightConflict)?;
    Ok(DecodedFreshSnapshot {
        capture,
        source,
        snapshot_value,
        digest,
    })
}
fn qualification(q: &NativeQualification) -> Value {
    match q {
        NativeQualification::SyntheticFixture => json!({"kind":"synthetic-fixture"}),
        NativeQualification::Qualified {
            catalog_digest,
            registered_build_digest,
            route_qualification_digest,
        } => {
            json!({"kind":"qualified","catalogDigest":catalog_digest,"registeredBuildDigest":registered_build_digest,"routeQualificationDigest":route_qualification_digest})
        }
    }
}
fn full_put_known_shape(snapshot: &DecodedFreshSnapshot) -> Result<(), StockErrorCode> {
    // The fixed mapper cannot preserve arbitrary new writable properties. Keep
    // every original byte but refuse a replacement PUT containing extensions.
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../../../contracts/stock-wire3/native/homebox.swagger.json"
    ))
    .map_err(|_| StockErrorCode::ResourceUnavailable)?;
    let definition = match snapshot.capture.target.resource_kind {
        ResourceKind::Entity => "repo.EntityOut",
        ResourceKind::Maintenance => "repo.MaintenanceEntryWithDetails",
        _ => return Err(StockErrorCode::UnsupportedCapability),
    };
    known_properties(
        &schema,
        &schema["definitions"][definition],
        &snapshot.snapshot_value,
    )
}
fn known_properties(schema: &Value, shape: &Value, value: &Value) -> Result<(), StockErrorCode> {
    if value.is_null() {
        return Ok(());
    }
    if let Some(reference) = shape["$ref"].as_str() {
        let shape = schema
            .pointer(
                reference
                    .strip_prefix('#')
                    .ok_or(StockErrorCode::ResourceUnavailable)?,
            )
            .ok_or(StockErrorCode::ResourceUnavailable)?;
        return known_properties(schema, shape, value);
    }
    if let Some(parts) = shape["allOf"].as_array() {
        for part in parts {
            known_properties(schema, part, value)?;
        }
        return Ok(());
    }
    if let Some(object) = value.as_object() {
        let properties = shape["properties"]
            .as_object()
            .ok_or(StockErrorCode::UnsupportedCapability)?;
        for (key, child) in object {
            let child_shape = properties
                .get(key)
                .ok_or(StockErrorCode::UnsupportedCapability)?;
            known_properties(schema, child_shape, child)?;
        }
    } else if let Some(rows) = value.as_array() {
        let items = shape
            .get("items")
            .ok_or(StockErrorCode::UnsupportedCapability)?;
        for row in rows {
            known_properties(schema, items, row)?;
        }
    }
    Ok(())
}
