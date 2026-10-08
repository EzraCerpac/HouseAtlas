//! Original native preparation correlation, without queue admission authority.
//! Capture awaits finish before entering the actual Access mutation fence.
//! No persisted data, approval spending, invocation or replay is created here.
use super::{
    Authority, CapturedAccess, GraphAuthorization, PreparedRequest, StockError, StockResult,
};
use crate::{access, providers::homebox::write::stock as native};

/// The original resolved graph retains the genuine native carrier itself.
/// This getter supplies no qualification: the existing GraphAuthorization must
/// prove this unchanged graph/carrier belongs to the original witness/P and
/// captured handles. A graph containing only cloned preflight/plan DTOs cannot
/// implement this linkage by reconstructing native evidence.
pub trait NativeQueueOriginalGraph<'owner, C, S: native::FreshPreparationSourcePort> {
    fn original_native_preparation(&self) -> &native::RetainedFreshPreparation<'owner, C, S>;
}

/// Borrow the unchanged Domain witness, original opaque grants and native
/// source-owned raw evidence together. No clone, serde or DATA constructor can
/// replace these original allocations. This is not a QueueAuthorization peer.
pub struct NativeQueueOriginalPreparation<
    'a,
    'p,
    'owner,
    W,
    G,
    F,
    C,
    S: native::FreshPreparationSourcePort,
> {
    prepared: &'a PreparedRequest<W, G>,
    captured: &'a CapturedAccess<'p>,
    graph: &'a F,
    native: &'a native::RetainedFreshPreparation<'owner, C, S>,
}

impl<
    'a,
    'p,
    'owner,
    W,
    G: NativeQueueOriginalGraph<'owner, C, S>,
    F: GraphAuthorization<W, G>,
    C: native::StockContractPort + Sync,
    S: native::FreshPreparationSourcePort,
> NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>
{
    /// Initial same-original binding inside the existing actual mutation guard.
    /// The caller has already completed native capture/qualification and Domain
    /// preparation. Neither read graphs nor matching authority DTOs qualify a
    /// write: both actual original semantic owners are mandatory below.
    pub fn bind(
        guard: &access::TransactionAuthorization<'_>,
        prepared: &'a PreparedRequest<W, G>,
        captured: &'a CapturedAccess<'p>,
        graph: &'a F,
        native: &'a native::RetainedFreshPreparation<'owner, C, S>,
    ) -> StockResult<Self> {
        let bound = Self {
            prepared,
            captured,
            graph,
            native,
        };
        bound.revalidate(guard, native.authority())?;
        Ok(bound)
    }

    pub fn prepared(&self) -> &PreparedRequest<W, G> {
        self.prepared
    }

    /// Bind an installed quantity source while the host retains its actual
    /// Store borrow and the original mutation guard for this phase.
    pub fn bind_with_quantity_installation<'phase>(
        guard: &'phase access::TransactionAuthorization<'_>,
        prepared: &'a PreparedRequest<W, G>,
        captured: &'a CapturedAccess<'p>,
        graph: &'a F,
        native: &'a native::RetainedFreshPreparation<'owner, C, S>,
        physical: &'phase crate::app::homebox_quantity_startup::OriginalQuantityPhysical<
            'phase,
            'p,
        >,
    ) -> StockResult<Self> {
        let bound = Self {
            prepared,
            captured,
            graph,
            native,
        };
        bound.revalidate_with_quantity_installation(guard, native.authority(), physical)?;
        Ok(bound)
    }
    pub fn captured(&self) -> &CapturedAccess<'p> {
        self.captured
    }
    pub fn native(&self) -> &native::RetainedFreshPreparation<'owner, C, S> {
        self.native
    }

    /// Required at each original phase fence. Uses the same native owner and
    /// opaque raw/E capture, without provider I/O, new grants or fresh capture.
    /// Current authority must be independently supplied by that original owner;
    /// equality is correlation only. Failure establishes no retry permission.
    pub fn revalidate(
        &self,
        guard: &access::TransactionAuthorization<'_>,
        current_original_authority: &native::StockAuthority,
    ) -> StockResult<()> {
        self.check_original(guard)?;
        let qualification = native::FreshQualification::new(guard, self.captured)
            .map_err(|_| StockError::AuthorityChanged)?;
        self.finish_revalidation(guard, &qualification, current_original_authority)
    }

    /// Fresh physical observation is supplied by the already-held Store owner;
    /// the native qualifier performs no Store or Access lock acquisition.
    pub fn revalidate_with_quantity_installation<'phase>(
        &self,
        guard: &'phase access::TransactionAuthorization<'_>,
        current_original_authority: &native::StockAuthority,
        physical: &'phase crate::app::homebox_quantity_startup::OriginalQuantityPhysical<
            'phase,
            'p,
        >,
    ) -> StockResult<()> {
        self.check_original(guard)?;
        let qualification =
            native::FreshQualification::with_quantity_installation(guard, self.captured, physical)
                .map_err(|_| StockError::AuthorityChanged)?;
        self.finish_revalidation(guard, &qualification, current_original_authority)
    }

    fn finish_revalidation(
        &self,
        guard: &access::TransactionAuthorization<'_>,
        qualification: &native::FreshQualification<'_, '_, 'p>,
        current_original_authority: &native::StockAuthority,
    ) -> StockResult<()> {
        self.native
            .revalidate_in_guard(
                qualification,
                self.native.command(),
                current_original_authority,
            )
            .map_err(|_| StockError::OwnerUnavailable)?;
        // Qualification must not substitute the original graph or handles.
        // Recheck both actual authorities after the mandatory native qualifier.
        self.check_original(guard)
    }

    fn check_original(&self, guard: &access::TransactionAuthorization<'_>) -> StockResult<()> {
        let principal = self.captured.principal();
        let request = self.prepared.request();
        let command = self.native.command();
        if !std::ptr::eq(guard.principal(), principal)
            || !std::ptr::eq(
                self.prepared.graph().original_native_preparation(),
                self.native,
            )
        {
            return Err(StockError::AuthorityChanged);
        }
        guard
            .assert_mutation()
            .map_err(|_| StockError::AuthorityChanged)?;
        guard
            .authorize(principal.scope(), access::Capability::Mutate)
            .map_err(|_| StockError::CapabilityDenied)?;
        if !request.is_mutation()
            || request.operation().authority != Authority::Homebox
            || !request.children().is_empty()
            || request.raw() != &command.original_wire
            || request.id().as_str() != command.command_id
            || request.intent_digest() != command.request_digest.as_str()
            || request.request_id() != command.request_id.to_string()
            || request.context().workspace_id != principal.scope().workspace_id.as_str()
            || request.context().home_id != principal.scope().home_id.as_str()
            || command.context.workspace_id.to_string() != request.context().workspace_id
            || command.context.home_id.to_string() != request.context().home_id
            || self.native.authority().actor_id.to_string() != principal.actor_id().as_str()
        {
            return Err(StockError::CorrelationMismatch);
        }
        // This bounded profile requires a preexisting entity or entity-owned
        // target. Collection/generated identities require their own complete
        // original entitlement producer; partition metadata is insufficient.
        if request.whole_collection_required() {
            return Err(StockError::CapabilityHeld);
        }
        let entity = command_entity_owner(command, self.native.plan())?;
        self.covered_entity(&command.target, entity)?;
        for partition in self.captured.partition_grants() {
            if partition.partition().scope() != *principal.scope() {
                return Err(StockError::CorrelationMismatch);
            }
            guard
                .revalidate_source_partition(partition)
                .map_err(|_| StockError::AuthorityChanged)?;
        }
        for source in self.captured.source_grants() {
            if !self
                .captured
                .partition_grants()
                .iter()
                .any(|p| p.partition() == &source.reference().partition())
            {
                return Err(StockError::CorrelationMismatch);
            }
            guard
                .revalidate_source(source)
                .map_err(|_| StockError::AuthorityChanged)?;
        }
        // Every actual native raw capture needs its original partition and
        // concrete entity owner, not only the primary command target. Complete
        // references/impact/guards remain the two genuine semantic owners' job.
        for snapshot in self.native.capture().snapshots() {
            let raw = snapshot.original();
            if raw.scope.workspace_id.as_str() != request.context().workspace_id
                || raw.scope.home_id.as_str() != request.context().home_id
                || raw.scope.source_instance_id.as_str()
                    != raw.target.source_instance_id.to_string()
                || raw.scope.collection_id != raw.target.collection_id.to_string()
                || !raw.target.same_partition(&command.target)
            {
                return Err(StockError::CorrelationMismatch);
            }
            self.covered_entity(&raw.target, entity_owner(&raw.target)?)?;
        }
        self.graph
            .revalidate_prepared(principal, self.captured, self.prepared)
            .map_err(|_| StockError::AuthorityChanged)?;
        guard
            .revalidate()
            .map_err(|_| StockError::AuthorityChanged)?;
        Ok(())
    }

    fn covered_entity(&self, target: &native::StockTarget, entity: uuid::Uuid) -> StockResult<()> {
        let scope = self.captured.principal().scope();
        let covered = self.captured.source_grants().iter().any(|grant| {
            let reference = grant.reference();
            reference.workspace_id == scope.workspace_id
                && reference.home_id == scope.home_id
                && reference.key.source_kind == access::SourceKind::HomeboxEntity
                && reference.key.source_instance_id.as_str()
                    == target.source_instance_id.to_string()
                && reference.key.collection_id == target.collection_id.to_string()
                && reference.key.external_id == entity.to_string()
                && self
                    .captured
                    .partition_grants()
                    .iter()
                    .any(|p| p.partition() == &reference.partition())
        });
        if covered {
            Ok(())
        } else {
            Err(StockError::CapabilityDenied)
        }
    }
}

// Only the frozen generated file-upload target lacks a resourceId. Its exact
// retained native multipart plan must name the existing entity owner; no
// generated resource ID, owner fallback or remapping supplies entitlement.
fn command_entity_owner(
    command: &native::StockCommand,
    plan: &native::NativePlan,
) -> StockResult<uuid::Uuid> {
    if command.command_id != "homebox.file.upload" {
        return entity_owner(&command.target);
    }
    let target = &command.target;
    let entity = target
        .entity_id
        .filter(|id| !id.is_nil())
        .ok_or(StockError::CapabilityHeld)?;
    let raw_target = serde_json::json!({
        "authority":"homebox", "sourceInstanceId":target.source_instance_id,
        "collectionId":target.collection_id, "resourceKind":"attachment", "entityId":entity
    });
    if target.resource_kind != native::ResourceKind::Attachment
        || target.resource_id.is_some()
        || target.source_instance_id.is_nil()
        || target.collection_id.is_nil()
        || command.original_wire["target"] != raw_target
        || plan.request.method != native::NativeMethod::Post
        || plan.request.path != format!("/api/v1/entities/{entity}/attachments")
        || !plan.request.query.is_empty()
        || plan.readback.target != *target
        || plan.readback.path != format!("/api/v1/entities/{entity}")
        || !plan.readback.query.is_empty()
        || plan.readback.absence
        || !matches!(&plan.readback.selector,
            native::ReadbackSelector::Member { field } if field == "attachments")
        || !matches!(&plan.generated,
            native::GeneratedIdentity::EntityMember { field, .. } if field == "attachments")
    {
        return Err(StockError::CorrelationMismatch);
    }
    match &plan.request.body {
        native::NativeBody::Multipart {
            file_field, stage, ..
        } if file_field == "file"
            && command.payload["staged"]
                == serde_json::to_value(stage).map_err(|_| StockError::OwnerUnavailable)? =>
        {
            Ok(entity)
        }
        _ => Err(StockError::CorrelationMismatch),
    }
}

fn entity_owner(target: &native::StockTarget) -> StockResult<uuid::Uuid> {
    if target.resource_kind == native::ResourceKind::Collection
        || target.resource_id.is_none_or(|id| id.is_nil())
        || target.source_instance_id.is_nil()
        || target.collection_id.is_nil()
    {
        return Err(StockError::CapabilityHeld);
    }
    let entity = if target.resource_kind == native::ResourceKind::Entity {
        if target.entity_id.is_some() {
            return Err(StockError::CorrelationMismatch);
        }
        target.resource_id
    } else {
        target.entity_id
    };
    entity
        .filter(|id| !id.is_nil())
        .ok_or(StockError::CapabilityHeld)
}
