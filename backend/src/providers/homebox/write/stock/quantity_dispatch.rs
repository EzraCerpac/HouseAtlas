//! Original quantity dispatch custody. The retained invocation is consumed on
//! the first authorization attempt, before any deadline or equality check.
//! Only the original storage session can release the configured credential.
use crate::{
    app::{
        self, homebox_quantity_graph::OriginalQuantityPreparation,
        stock_activity_principal::OriginalStockActivityPrincipal,
    },
    http::contracts::NativeContracts,
    media::native::NativeMediaRuntime,
    providers::homebox::{read, recovery::NativeWriterContracts, write_transport},
    storage::{self, StockActivitySession},
};
use std::{
    future::{Future, ready},
    sync::Mutex,
};
use tokio::time::Instant;

use super::{InvocationPermit, NativePlan, StagedUpload, StockAuthority, StockPortFault};

type OriginalSession<G> = StockActivitySession<
    NativeContracts,
    app::ReadAuthority,
    NativeMediaRuntime<app::ServerRuntime>,
    OriginalStockActivityPrincipal,
    G,
    NativeWriterContracts,
>;

type OriginalPreparation<'native, 'p, 'owner, T, K> =
    OriginalQuantityPreparation<'native, 'p, 'owner, T, K>;

/// Borrows the unchanged graph preparation and session. Possession of this
/// adapter does not issue admission or make public operation data into proof.
pub struct QuantityDispatchResources<'bundle, 'native, 'p, 'owner, T, K, G>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
    G: storage::StockActivityAuthorization<OriginalStockActivityPrincipal>,
{
    session: &'bundle OriginalSession<G>,
    preparation: &'bundle OriginalPreparation<'native, 'p, 'owner, T, K>,
    invocation: Mutex<
        Option<
            storage::OriginalQuantityInvocation<
                'bundle,
                OriginalPreparation<'native, 'p, 'owner, T, K>,
            >,
        >,
    >,
}

impl<'bundle, 'native, 'p, 'owner, T, K, G>
    QuantityDispatchResources<'bundle, 'native, 'p, 'owner, T, K, G>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
    G: storage::StockActivityAuthorization<OriginalStockActivityPrincipal>,
{
    pub fn new(
        session: &'bundle OriginalSession<G>,
        preparation: &'bundle OriginalPreparation<'native, 'p, 'owner, T, K>,
        invocation: storage::OriginalQuantityInvocation<
            'bundle,
            OriginalPreparation<'native, 'p, 'owner, T, K>,
        >,
    ) -> Result<Self, StockPortFault> {
        let original = preparation.original();
        let operation = invocation.operation();
        let permit = invocation.permit();
        let configured = preparation.configured();
        let descriptor = configured.descriptor();
        let physical = configured.physical();
        let plan_value = serde_json::to_value(preparation.native().plan())
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        let plan_digest = crate::contracts::semantics::canonical_digest(&plan_value)
            .map_err(|_| StockPortFault::EvidenceConflict)?;
        if !std::ptr::eq(invocation.original_preparation(), preparation)
            || !std::ptr::eq(invocation.original(), original)
            || operation.command != *original.command()
            || operation.captured_authority != *original.captured_authority()
            || operation.actor_id != original.captured_authority().actor_id
            || operation.command.context != descriptor.scope
            || operation.command.target != descriptor.target
            || operation.captured_authority != descriptor.authority
            || operation.operation_id != permit.operation_id
            || operation.actor_id != permit.actor_id
            || operation.plan.as_ref() != Some(preparation.native().plan())
            || permit.plan_digest.as_str() != plan_digest
            || permit.physical_binding != original.captured_authority().physical_binding
            || permit.physical_binding != physical.physical_binding
            || permit.owner_id != physical.owner_id
            || permit.dispatcher_epoch != physical.dispatcher_epoch
            || permit.source_epoch != original.captured_authority().source_epoch
            || permit.qualification != original.captured_authority().qualification
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        Ok(Self {
            session,
            preparation,
            invocation: Mutex::new(Some(invocation)),
        })
    }

    /// Bind transport to the original configured origin and physical registry.
    /// The storage session still rechecks all live fences when asked for the
    /// header, immediately before the actual HTTP attempt.
    pub fn into_http(
        self,
        limits: write_transport::Limits,
    ) -> Result<write_transport::HttpDispatcher<Self>, write_transport::TransportFault> {
        let endpoint = self.source_endpoint()?;
        write_transport::HttpDispatcher::new(endpoint, self, limits)
    }

    /// Test-only TLS trust for an explicitly configured HTTPS loopback source.
    /// All source and physical binding data follow the production path.
    #[cfg(test)]
    pub(crate) fn into_http_with_loopback_certificate(
        self,
        limits: write_transport::Limits,
        certificate_der: &[u8],
    ) -> Result<write_transport::HttpDispatcher<Self>, write_transport::TransportFault> {
        let endpoint = self.source_endpoint()?;
        write_transport::HttpDispatcher::new_with_loopback_certificate(
            endpoint,
            self,
            limits,
            certificate_der,
        )
    }

    fn source_endpoint(
        &self,
    ) -> Result<write_transport::SourceEndpoint, write_transport::TransportFault> {
        let configured = self.preparation.configured();
        let descriptor = configured.descriptor();
        let physical = configured.physical();
        let origin = configured
            .homebox()
            .endpoint()
            .map_err(|_| write_transport::TransportFault::Configuration)?;
        let binding = write_transport::DispatchBinding {
            context: descriptor.scope.clone(),
            source_instance_id: descriptor.target.source_instance_id,
            collection_id: descriptor.target.collection_id,
            physical_binding: physical.physical_binding.clone(),
            owner_id: physical.owner_id,
            dispatcher_epoch: physical.dispatcher_epoch,
            source_epoch: descriptor.authority.source_epoch,
            qualification: descriptor.authority.qualification.clone(),
        };
        write_transport::SourceEndpoint::https(origin.origin().as_str(), binding)
    }
}

impl<'bundle, 'native, 'p, 'owner, T, K, G> write_transport::DispatchResources
    for QuantityDispatchResources<'bundle, 'native, 'p, 'owner, T, K, G>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
    G: storage::StockActivityAuthorization<OriginalStockActivityPrincipal>,
{
    fn authorization(
        &self,
        endpoint: &write_transport::SourceEndpoint,
        permit: &InvocationPermit,
        plan: &NativePlan,
        authority: &StockAuthority,
        deadline: Instant,
    ) -> impl Future<
        Output = Result<
            Option<write_transport::AuthorizationHeader>,
            write_transport::TransportFault,
        >,
    > + Send {
        // Take before returning a future: cancellation, a dropped future, a
        // failed check, and a second call can never restore this invocation.
        let invocation = self
            .invocation
            .lock()
            .map_err(|_| write_transport::TransportFault::Resources)
            .and_then(|mut retained| {
                retained
                    .take()
                    .ok_or(write_transport::TransportFault::Binding)
            });
        ready((|| {
            let invocation = invocation?;
            if Instant::now() >= deadline {
                return Err(write_transport::TransportFault::Deadline);
            }
            self.session
                .consume_quantity_authorization(
                    invocation,
                    self.preparation,
                    endpoint,
                    permit,
                    plan,
                    authority,
                    deadline,
                )
                .map(Some)
                .map_err(port_fault)
        })())
    }

    fn staged_bytes(
        &self,
        _permit: &InvocationPermit,
        _stage: &StagedUpload,
        _max_bytes: usize,
        _deadline: Instant,
    ) -> impl Future<Output = Result<Vec<u8>, write_transport::TransportFault>> + Send {
        ready(Err(write_transport::TransportFault::Stage))
    }
}

fn port_fault(fault: StockPortFault) -> write_transport::TransportFault {
    match fault {
        StockPortFault::Unavailable => write_transport::TransportFault::Resources,
        StockPortFault::ContentConflict
        | StockPortFault::VersionConflict
        | StockPortFault::EvidenceConflict => write_transport::TransportFault::Binding,
    }
}
