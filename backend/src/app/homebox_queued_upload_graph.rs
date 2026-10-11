//! Closed original nonphoto upload graph under its actual installed phase.
//! Preparation supplies no queue, invocation, output or historical authority.
use crate::{
    access,
    app::homebox_queued_upload::OriginalQueuedUploadPhysical,
    config::providers::queued_upload::OriginalQueuedUploadConfigured,
    domain::stock as domain,
    media::{
        WorkBudget,
        native_queued_upload::{
            NativeQueuedUploadOriginal, NativeQueuedUploadStage, NativeQueuedUploadStages,
        },
    },
    providers::homebox::write::stock as native,
    storage,
};
use serde_json::Value;
use std::sync::Arc;

type UploadContracts = crate::providers::homebox::recovery::NativeWriterContracts;
type UploadNative<'owner, 'captured, 'p> = native::RetainedFreshPreparation<
    'owner,
    UploadContracts,
    native::QueuedUploadSource<'captured, 'p>,
>;
type PreparedUpload<'native, 'owner, 'captured, 'p> = domain::PreparedRequest<
    QueuedUploadWitness<'native, 'owner, 'captured, 'p>,
    QueuedUploadGraph<'native, 'owner, 'captured, 'p>,
>;

/// Original allocations survive phases; no original phase guard survives.
pub struct OriginalQueuedUploadPreparation<'native, 'owner, 'captured, 'p> {
    prepared: &'native PreparedUpload<'native, 'owner, 'captured, 'p>,
    native: &'native UploadNative<'owner, 'captured, 'p>,
    captured: &'native domain::CapturedAccess<'p>,
    configured: Arc<OriginalQueuedUploadConfigured>,
}
impl<'native, 'owner, 'captured, 'p>
    OriginalQueuedUploadPreparation<'native, 'owner, 'captured, 'p>
{
    pub fn bind<'phase, 'tx>(
        prepared: &'native PreparedUpload<'native, 'owner, 'captured, 'p>,
        authority: &QueuedUploadGraphAuthority<'phase, 'tx, 'native, 'owner, 'captured, 'p>,
    ) -> domain::StockResult<Self>
    where
        'native: 'phase,
    {
        domain::GraphAuthorization::revalidate_prepared(
            authority,
            authority.captured.principal(),
            authority.captured,
            prepared,
        )
        .map_err(|_| changed())?;
        Ok(Self {
            prepared,
            native: authority.native,
            captured: authority.captured,
            configured: Arc::clone(&authority.configured),
        })
    }
    pub fn prepared(&self) -> &PreparedUpload<'native, 'owner, 'captured, 'p> {
        self.prepared
    }
    pub fn native(&self) -> &'native UploadNative<'owner, 'captured, 'p> {
        self.native
    }
    pub fn captured(&self) -> &domain::CapturedAccess<'p> {
        self.captured
    }
    pub fn configured(&self) -> &Arc<OriginalQueuedUploadConfigured> {
        &self.configured
    }

    /// The host supplies this phase's actual Store-borrowed physical carrier.
    /// The temporary authority and Domain bound cannot leave this phase.
    pub fn revalidate_original_phase<'phase>(
        &self,
        guard: &'phase access::TransactionAuthorization<'_>,
        physical: &'phase OriginalQueuedUploadPhysical<'phase, 'p>,
    ) -> domain::StockResult<()>
    where
        'native: 'phase,
    {
        if !Arc::ptr_eq(&self.configured, physical.configured()) {
            return Err(changed());
        }
        let authority = QueuedUploadGraphAuthority::new(guard, self.native, physical)?;
        let bound = domain::NativeQueueOriginalPreparation::bind_with_queued_upload_installation(
            guard,
            self.prepared,
            self.captured,
            &authority,
            self.native,
            physical,
        )?;
        bound.revalidate_with_queued_upload_installation(guard, self.native.authority(), physical)
    }

    /// Consume the actual original stage once, selecting its original token
    /// from the same sealed native E inside Media's concrete source binder.
    /// This returns detached Media custody, without queue admission authority.
    pub fn bind_stage_in_phase<'phase>(
        &self,
        stages: &NativeQueuedUploadStages,
        stage: NativeQueuedUploadStage<'_>,
        guard: &'phase access::TransactionAuthorization<'_>,
        physical: &'phase OriginalQueuedUploadPhysical<'phase, 'p>,
        budget: &WorkBudget,
    ) -> crate::media::MediaResult<NativeQueuedUploadOriginal>
    where
        'native: 'phase,
    {
        if !Arc::ptr_eq(&self.configured, physical.configured()) {
            return Err(crate::media::MediaError::Unavailable);
        }
        let authority = QueuedUploadGraphAuthority::new(guard, self.native, physical)
            .map_err(|_| crate::media::MediaError::Unavailable)?;
        let bound = domain::NativeQueueOriginalPreparation::bind_with_queued_upload_installation(
            guard,
            self.prepared,
            self.captured,
            &authority,
            self.native,
            physical,
        )
        .map_err(|_| crate::media::MediaError::Unavailable)?;
        stages.bind_original_with_queued_upload_installation(guard, stage, &bound, physical, budget)
    }
}

/// Only the genuine native upload preparation supplies this graph.
pub struct QueuedUploadGraph<'native, 'owner, 'captured, 'p> {
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native UploadNative<'owner, 'captured, 'p>,
    configured: Arc<OriginalQueuedUploadConfigured>,
}
impl<'owner, 'captured, 'p>
    domain::NativeQueueOriginalGraph<
        'owner,
        UploadContracts,
        native::QueuedUploadSource<'captured, 'p>,
    > for QueuedUploadGraph<'_, 'owner, 'captured, 'p>
{
    fn original_native_preparation(&self) -> &UploadNative<'owner, 'captured, 'p> {
        self.native
    }
}

/// No serialized actor, graph or grant DATA can construct this witness.
pub struct QueuedUploadWitness<'native, 'owner, 'captured, 'p> {
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native UploadNative<'owner, 'captured, 'p>,
    configured: Arc<OriginalQueuedUploadConfigured>,
}

/// Synchronous current phase only: no lock acquisition, network I/O or await.
pub struct QueuedUploadGraphAuthority<'phase, 'tx, 'native, 'owner, 'captured, 'p> {
    qualification: native::FreshQualification<'phase, 'tx, 'p>,
    native: &'native UploadNative<'owner, 'captured, 'p>,
    captured: &'native domain::CapturedAccess<'p>,
    configured: Arc<OriginalQueuedUploadConfigured>,
}
impl<'phase, 'tx, 'native: 'phase, 'owner, 'captured, 'p>
    QueuedUploadGraphAuthority<'phase, 'tx, 'native, 'owner, 'captured, 'p>
{
    pub fn new(
        guard: &'phase access::TransactionAuthorization<'tx>,
        native: &'native UploadNative<'owner, 'captured, 'p>,
        physical: &'phase OriginalQueuedUploadPhysical<'phase, 'p>,
    ) -> domain::StockResult<Self> {
        let captured = native.source().captured();
        let qualification =
            native::FreshQualification::with_queued_upload_installation(guard, captured, physical)
                .map_err(|_| changed())?;
        let authority = Self {
            qualification,
            native,
            captured,
            configured: Arc::clone(physical.configured()),
        };
        authority.revalidate_original()?;
        Ok(authority)
    }

    pub fn prepare(
        &self,
        contracts: &impl domain::StockContractPort,
    ) -> domain::StockResult<PreparedUpload<'native, 'owner, 'captured, 'p>> {
        self.revalidate_original()?;
        bound_original_wire(&self.native.command().original_wire)?;
        let mut resolver = QueuedUploadResolver {
            captured: self.captured,
            native: self.native,
            configured: Arc::clone(&self.configured),
        };
        domain::prepare(
            self.captured.principal(),
            self.native.command().original_wire.clone(),
            contracts,
            self,
            &mut resolver,
        )
    }

    fn revalidate_original(&self) -> domain::StockResult<()> {
        let source = self.native.source();
        let principal = self.captured.principal();
        let physical = self
            .qualification
            .queued_upload_installation()
            .ok_or(changed())?;
        let command = self.native.command();
        let target = &command.target;
        let expected = self.configured.descriptor();
        let original_source = source.original_source();
        let partition = source.original_partition();
        if !std::ptr::eq(source.captured(), self.captured)
            || !std::ptr::eq(principal, source.original().principal())
            || !std::ptr::eq(principal, self.qualification.guard().principal())
            || !std::ptr::eq(physical.captured(), self.captured)
            || !std::ptr::eq(physical.source(), original_source)
            || !std::ptr::eq(physical.partition(), partition)
            || !Arc::ptr_eq(source.configured(), &self.configured)
            || !Arc::ptr_eq(physical.configured(), &self.configured)
            || !physical.matches_configured_store()
            || physical.queue_config() != self.configured.queue()
            || physical.registration() != self.configured.physical()
            || physical.source_metadata() != self.configured.metadata()
            || self.captured.source_grants().len() != 1
            || self.captured.partition_grants().len() != 1
            || !std::ptr::eq(&self.captured.source_grants()[0], original_source)
            || !std::ptr::eq(&self.captured.partition_grants()[0], partition)
            || original_source.reference().partition() != *partition.partition()
            || command.command_id != "homebox.file.upload"
            || command.context != expected.context
            || self.native.authority() != &expected.authority
            || target.resource_kind != native::ResourceKind::Attachment
            || target.resource_id.is_some()
            || target.owner_target().ok().as_ref() != Some(&expected.owner)
            || command.approval_receipt_id.is_some()
            || command.native_sync_behavior.is_some()
            || command.payload["primary"] != Value::Bool(false)
            || !command.payload["type"].as_str().is_some_and(|kind| {
                matches!(kind, "manual" | "warranty" | "attachment" | "receipt")
                    && expected.allowed_types.iter().any(|allowed| allowed == kind)
            })
            || command.payload.as_object().is_none_or(|payload| {
                payload.len() != 3
                    || !payload.contains_key("staged")
                    || !payload.contains_key("type")
                    || !payload.contains_key("primary")
            })
            || command.original_wire["preconditions"]["atlasGuards"]
                .as_array()
                .is_none_or(|guards| !guards.is_empty())
        {
            return Err(changed());
        }
        self.native
            .revalidate_in_guard(&self.qualification, command, self.native.authority())
            .map_err(|_| domain::StockError::OwnerUnavailable)?;
        let preflight = self.native.preflight();
        let plan = self.native.plan();
        let proof = self.native.capture().evidence().source_preparation();
        let stage = proof.staged_upload();
        let owner = target.owner().map_err(|_| changed())?;
        let owner_target = target.owner_target().map_err(|_| changed())?;
        let expected_fields = vec![
            ("name".into(), stage.filename.clone()),
            (
                "type".into(),
                command.payload["type"].as_str().ok_or(changed())?.into(),
            ),
            ("primary".into(), "false".into()),
        ];
        if stage.byte_size == 0
            || stage.byte_size > expected.maximum_bytes
            || preflight.preparation.snapshots.len() != 1
            || preflight.preparation.snapshots[0].target != owner_target
            || !preflight.preparation.snapshots[0].complete
            || preflight.preparation.staged_upload.as_ref() != Some(stage)
            || !preflight.preparation.native_clear_values.is_empty()
            || self.native.capture().snapshots().len() != 1
            || self.native.capture().snapshots()[0].original().target != owner_target
            || plan
                != &native::map_stock(command, &preflight.preparation)
                    .map_err(|_| domain::StockError::UnsupportedCapability)?
            || plan.request.method != native::NativeMethod::Post
            || plan.request.path != format!("/api/v1/entities/{owner}/attachments")
            || !plan.request.query.is_empty()
            || plan.request.body
                != (native::NativeBody::Multipart {
                    file_field: "file".into(),
                    stage: stage.clone(),
                    fields: expected_fields,
                })
            || plan.success_status != 201
            || plan.response != native::ResponseKind::Entity
            || !matches!(&plan.generated,
                native::GeneratedIdentity::EntityMember { field, .. } if field == "attachments")
            || plan.readback.path != format!("/api/v1/entities/{owner}")
            || plan.readback.target != *target
            || !plan.readback.query.is_empty()
            || plan.readback.absence
            || !matches!(&plan.readback.selector,
                native::ReadbackSelector::Member { field } if field == "attachments")
            || plan.requires_complete_impact
        {
            return Err(domain::StockError::UnsupportedCapability);
        }
        Ok(())
    }

    fn request(
        &self,
        principal: &access::Principal,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<()> {
        self.revalidate_original()?;
        if !std::ptr::eq(principal, self.captured.principal())
            || request.id() != domain::OperationId::HomeboxFileUpload
            || request.raw() != &self.native.command().original_wire
            || request.intent_digest() != self.native.command().request_digest.as_str()
            || !request.children().is_empty()
            || request.whole_collection_required()
        {
            return Err(changed());
        }
        Ok(())
    }
    fn witness(
        &self,
        witness: &QueuedUploadWitness<'_, 'owner, 'captured, 'p>,
    ) -> domain::StockResult<()> {
        if !std::ptr::eq(witness.captured, self.captured)
            || !std::ptr::eq(witness.native, self.native)
            || !Arc::ptr_eq(&witness.configured, &self.configured)
        {
            return Err(changed());
        }
        Ok(())
    }
    fn graph(
        &self,
        graph: &QueuedUploadGraph<'_, 'owner, 'captured, 'p>,
    ) -> domain::StockResult<()> {
        if !std::ptr::eq(graph.captured, self.captured)
            || !std::ptr::eq(graph.native, self.native)
            || !Arc::ptr_eq(&graph.configured, &self.configured)
        {
            return Err(changed());
        }
        Ok(())
    }
}

impl<'phase, 'tx, 'native: 'phase, 'owner, 'captured, 'p>
    domain::StockAuthorityPort<access::Principal>
    for QueuedUploadGraphAuthority<'phase, 'tx, 'native, 'owner, 'captured, 'p>
{
    type Witness = QueuedUploadWitness<'native, 'owner, 'captured, 'p>;
    type Graph = QueuedUploadGraph<'native, 'owner, 'captured, 'p>;
    fn capture(
        &self,
        principal: &access::Principal,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<Self::Witness> {
        self.request(principal, request)?;
        Ok(QueuedUploadWitness {
            captured: self.captured,
            native: self.native,
            configured: Arc::clone(&self.configured),
        })
    }
    fn authorize_graph(
        &self,
        principal: &access::Principal,
        witness: &Self::Witness,
        request: &domain::ValidatedRequest,
        graph: &Self::Graph,
    ) -> domain::StockResult<()> {
        self.request(principal, request)?;
        self.witness(witness)?;
        self.graph(graph)
    }
    fn revalidate(
        &self,
        principal: &access::Principal,
        witness: &Self::Witness,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<()> {
        self.request(principal, request)?;
        self.witness(witness)
    }
    fn authorize_result(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<Self::Witness, Self::Graph>,
        _: &domain::ValidatedRequest,
        _: &Value,
    ) -> domain::StockResult<()> {
        Err(domain::StockError::OwnerUnavailable)
    }
    fn disclose(
        &self,
        _: &access::Principal,
        _: &domain::PreparedRequest<Self::Witness, Self::Graph>,
        _: &domain::ValidatedRequest,
        _: &Value,
        _: &Value,
        _: domain::DisclosurePurpose,
    ) -> domain::StockResult<()> {
        Err(domain::StockError::OwnerUnavailable)
    }
}

struct QueuedUploadResolver<'native, 'owner, 'captured, 'p> {
    captured: &'native domain::CapturedAccess<'p>,
    native: &'native UploadNative<'owner, 'captured, 'p>,
    configured: Arc<OriginalQueuedUploadConfigured>,
}
impl<'native, 'owner, 'captured, 'p>
    domain::StockPreparerPort<
        access::Principal,
        QueuedUploadWitness<'native, 'owner, 'captured, 'p>,
    > for QueuedUploadResolver<'native, 'owner, 'captured, 'p>
{
    type Graph = QueuedUploadGraph<'native, 'owner, 'captured, 'p>;
    fn resolve(
        &mut self,
        principal: &access::Principal,
        witness: &QueuedUploadWitness<'native, 'owner, 'captured, 'p>,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<Self::Graph> {
        if !std::ptr::eq(principal, self.captured.principal())
            || !std::ptr::eq(witness.captured, self.captured)
            || !std::ptr::eq(witness.native, self.native)
            || !Arc::ptr_eq(&witness.configured, &self.configured)
            || request.raw() != &self.native.command().original_wire
        {
            return Err(changed());
        }
        Ok(QueuedUploadGraph {
            captured: self.captured,
            native: self.native,
            configured: Arc::clone(&self.configured),
        })
    }
}

impl<'phase, 'tx, 'native: 'phase, 'owner, 'captured, 'p>
    domain::GraphAuthorization<
        QueuedUploadWitness<'native, 'owner, 'captured, 'p>,
        QueuedUploadGraph<'native, 'owner, 'captured, 'p>,
    > for QueuedUploadGraphAuthority<'phase, 'tx, 'native, 'owner, 'captured, 'p>
{
    fn revalidate_prepared(
        &self,
        principal: &access::Principal,
        captured: &domain::CapturedAccess<'_>,
        prepared: &PreparedUpload<'native, 'owner, 'captured, 'p>,
    ) -> storage::Result<()> {
        if !std::ptr::eq(captured, self.captured) {
            return Err(unavailable());
        }
        self.request(principal, prepared.request())
            .map_err(|_| unavailable())?;
        self.witness(prepared.witness())
            .map_err(|_| unavailable())?;
        self.graph(prepared.graph()).map_err(|_| unavailable())
    }
    fn authorize_native(
        &self,
        _: &access::Principal,
        _: &PreparedUpload<'native, 'owner, 'captured, 'p>,
        _: &storage::AuthorizationRequest<'_>,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
    fn authorize_stock_mutation(
        &self,
        _: &access::Principal,
        _: &PreparedUpload<'native, 'owner, 'captured, 'p>,
        _: &storage::StockMutationFrame<'_>,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
    fn authorize_stock_history(
        &self,
        _: &access::Principal,
        _: &PreparedUpload<'native, 'owner, 'captured, 'p>,
        _: &storage::StockHistoryFrame<'_>,
    ) -> storage::Result<()> {
        Err(unavailable())
    }
}
fn changed() -> domain::StockError {
    domain::StockError::AuthorityChanged
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "upstream-unavailable",
        "Upload preparation owner action unavailable",
    )
}

// Bound the complete retained request before the Domain preparation clones it.
// The writer counts serialized bytes without allocating another request body.
fn bound_original_wire(wire: &Value) -> domain::StockResult<()> {
    struct WireBudget(usize);
    impl std::io::Write for WireBudget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self.0.checked_add(bytes.len()).ok_or_else(|| {
                std::io::Error::other("Upload preparation request exceeds byte bound")
            })?;
            if self.0 > 1024 * 1024 {
                return Err(std::io::Error::other(
                    "Upload preparation request exceeds byte bound",
                ));
            }
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(WireBudget(0), wire)
        .map_err(|_| domain::StockError::UnsupportedCapability)
}
