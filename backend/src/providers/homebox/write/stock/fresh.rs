//! Pure decoding adapters for original-owner fresh capture/qualification ports.
//! Parsing establishes neither freshness, completeness, authority nor safe PUT.
use super::*;
use crate::providers::homebox::{read, wire};
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

/// Original-owner evidence remains opaque and non-serializable to this adapter.
/// Qualification MUST check the original providerObservation, finite freshness
/// clocks, source revision/build/route, complete references/approved impact,
/// schema completeness and hidden-field preservation against these exact bytes.
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
}
/// The source owner checks exact operation/GET correlation, current original
/// authority, freshness, complete snapshot/impact and output scope. It must
/// retain original evidence; matching values is neither causality nor CAS.
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
impl<'owner, C: StockContractPort + Sync, S: FreshPreparationSourcePort>
    RetainedFreshPreparation<'owner, C, S>
{
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
}
impl<C: StockContractPort + Sync, S: FreshPreparationSourcePort> DecodedStockPreparation<C, S> {
    pub async fn prepare_retained<'owner>(
        &'owner self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<RetainedFreshPreparation<'owner, C, S>, StockErrorCode> {
        validate_command(&self.contracts, command)?;
        let input = self.source.capture_preparation(command, authority).await?;
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
        let capture = DecodedFreshPreparation {
            evidence: input.evidence,
            snapshots,
            capture_digest,
        };
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

    fn qualify_decoded(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
        capture: &DecodedFreshPreparation<S::Evidence>,
    ) -> Result<(StockPreflight, StockPreflight, NativePlan), StockErrorCode> {
        validate_command(&self.contracts, command)?;
        let mut preflight = self
            .source
            .qualify_preparation(command, authority, capture)?;
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
impl<C, S> DecodedStockReadback<C, S> {
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
    async fn present(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<NativeObservation> {
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
        let input = self
            .source
            .capture_readback(operation, plan, authority)
            .await?;
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
        let observation = self
            .source
            .qualify_readback(operation, plan, authority, &capture)?;
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
