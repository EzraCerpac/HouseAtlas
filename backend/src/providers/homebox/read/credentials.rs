//! Explicit trusted header custody, bound to original native read authority.
//! Account/enrollment and route authority are separate mandatory host inputs.
use super::{
    AuthorizationHeader, CredentialProvider, ErrorCode, ReadError, SourceEndpoint, SourceScope,
};
use crate::{
    access as a,
    app::stock_activity_principal::OriginalStockActivityPrincipal,
    providers::homebox::{write::stock, write_transport},
    storage::StockActivityPrincipal as _,
};
use serde_json::json;
use std::{
    future::{Future, ready},
    sync::{Arc, Mutex},
};
use tokio::time::Instant;
use zeroize::Zeroizing;

const MAX_HEADER_BYTES: usize = 8192;

/// Immutable trusted input for one exact endpoint/partition. No Debug, serde,
/// cloning or secret accessor is supplied. Arc reuse retains the same config;
/// each request must bind its own original native principal and grant handles.
/// Header syntax validation authenticates no provider account or enrollment.
pub struct NativeReadCredentialConfig {
    origin: url::Url,
    scope: SourceScope,
    header: Zeroizing<Vec<u8>>,
}
impl NativeReadCredentialConfig {
    /// The trusted host supplies an already selected endpoint and original
    /// authorization bytes. This reads no environment, file, AI credential or
    /// browser input, and establishes no credential-custody provenance.
    pub fn from_trusted_header(
        endpoint: &SourceEndpoint,
        header: Vec<u8>,
    ) -> Result<Self, ReadError> {
        let header = Zeroizing::new(header);
        if header.is_empty() || header.len() > MAX_HEADER_BYTES {
            return Err(ReadError(ErrorCode::Auth));
        }
        AuthorizationHeader::from_bytes(&header)?;
        Ok(Self {
            origin: endpoint.origin().clone(),
            scope: endpoint.scope().clone(),
            header,
        })
    }

    /// Safe configuration correlation; this exposes no header bytes.
    pub fn matches_endpoint(&self, endpoint: &SourceEndpoint) -> bool {
        self.origin == *endpoint.origin() && self.scope == *endpoint.scope()
    }

    /// Deliver the original configured header only inside the caller's held
    /// mutation guard, after its concrete Store admission has succeeded. This
    /// helper neither issues that admission nor opens another access lock.
    pub(crate) fn deliver_quantity_header_in_guard(
        &self,
        selected: &SourceEndpoint,
        endpoint: &write_transport::SourceEndpoint,
        original: &OriginalStockActivityPrincipal,
        guard: &a::TransactionAuthorization<'_>,
        plan: &stock::NativePlan,
        deadline: Instant,
    ) -> Result<write_transport::AuthorizationHeader, write_transport::TransportFault> {
        use stock::{
            GeneratedIdentity, NativeBody, NativeMethod, NativeQualification, ReadbackSelector,
            ResourceKind, ResponseKind,
        };
        use write_transport::TransportFault as Fault;

        if Instant::now() >= deadline {
            return Err(Fault::Deadline);
        }
        let command = original.command();
        let authority = original.captured_authority();
        let source = original.original_activity_source();
        let partition = original.original_activity_partition();
        let reference = source.reference();
        let binding = endpoint.binding();
        if !self.matches_endpoint(selected)
            || selected.origin() != endpoint.origin()
            || !std::ptr::eq(guard.principal(), original.original_activity_principal())
            || command.command_id != "homebox.entity.quantity.set"
            || command.target.resource_kind != ResourceKind::Entity
            || command.context != binding.context
            || command.target.source_instance_id != binding.source_instance_id
            || command.target.collection_id != binding.collection_id
            || selected.scope().workspace_id.as_str() != binding.context.workspace_id.to_string()
            || selected.scope().home_id.as_str() != binding.context.home_id.to_string()
            || selected.scope().source_instance_id.as_str()
                != binding.source_instance_id.to_string()
            || selected.scope().collection_id != binding.collection_id.to_string()
            || authority.actor_id.to_string() != guard.principal().actor_id().as_str()
            || authority.physical_binding != binding.physical_binding
            || authority.source_epoch != binding.source_epoch
            || authority.qualification != binding.qualification
            || !matches!(
                authority.qualification,
                NativeQualification::Qualified { .. }
            )
            || partition.partition() != &reference.partition()
            || partition.partition().workspace_id.as_str() != selected.scope().workspace_id.as_str()
            || partition.partition().home_id.as_str() != selected.scope().home_id.as_str()
            || partition.partition().source_instance_id.as_str()
                != selected.scope().source_instance_id.as_str()
            || partition.partition().collection_id != selected.scope().collection_id
            || reference.key.source_kind != a::SourceKind::HomeboxEntity
            || reference.key.external_id
                != command.target.id().map_err(|_| Fault::Binding)?.to_string()
        {
            return Err(Fault::Binding);
        }
        guard.assert_mutation().map_err(|_| Fault::Binding)?;
        guard
            .revalidate_source(source)
            .map_err(|_| Fault::Binding)?;
        guard
            .revalidate_source_partition(partition)
            .map_err(|_| Fault::Binding)?;
        let metadata = guard
            .persisted_source_metadata(partition)
            .map_err(|_| Fault::Binding)?;
        if metadata.source_registration_version() != authority.source_epoch
            || metadata.registration().partition() != *partition.partition()
        {
            return Err(Fault::Binding);
        }
        let quantity = command
            .payload
            .get("quantity")
            .and_then(|v| v.as_u64())
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or(Fault::Binding)?;
        if command
            .payload
            .as_object()
            .is_none_or(|payload| payload.len() != 1)
        {
            return Err(Fault::Binding);
        }
        let target_id = command.target.id().map_err(|_| Fault::Binding)?;
        let path = format!("/api/v1/entities/{target_id}");
        let body = json!({"quantity": quantity});
        if plan.request.method != NativeMethod::Patch
            || plan.request.path != path
            || !plan.request.query.is_empty()
            || plan.request.body != NativeBody::Json(body.clone())
            || plan.response != ResponseKind::Entity
            || plan.success_status != 200
            || plan.max_response_bytes.is_some()
            || plan.readback.path != path
            || !plan.readback.query.is_empty()
            || plan.readback.target != command.target
            || plan.readback.selector != ReadbackSelector::Whole
            || plan.readback.expected != body
            || plan.readback.absence
            || plan.generated != GeneratedIdentity::None
            || plan.requires_complete_impact
        {
            return Err(Fault::Binding);
        }
        guard.revalidate().map_err(|_| Fault::Binding)?;
        if Instant::now() >= deadline {
            return Err(Fault::Deadline);
        }
        let header = write_transport::AuthorizationHeader::from_bytes(&self.header)?;
        if Instant::now() >= deadline {
            return Err(Fault::Deadline);
        }
        Ok(header)
    }

    /// Retain exactly the host's original opaque read handles. No principal or
    /// grant is issued. The native read producer must separately check its
    /// request owner and fixed route against these same original handles.
    pub fn bind_original<'p>(
        self: &Arc<Self>,
        access: Arc<Mutex<a::AccessBoundary>>,
        principal: &'p a::Principal,
        source: a::SourceGrant,
        partition: a::PartitionGrant,
    ) -> Result<NativeReadCredentials<'p>, ReadError> {
        let credentials = NativeReadCredentials {
            config: Arc::clone(self),
            access,
            principal,
            source,
            partition,
        };
        credentials.check_binding()?;
        {
            let mut access = credentials
                .access
                .try_lock()
                .map_err(|_| ReadError(ErrorCode::Transport))?;
            access
                .with_source_read_authorization(
                    credentials.principal,
                    &credentials.partition,
                    std::slice::from_ref(&credentials.source),
                    |guard| -> a::AccessResult<()> {
                        if !std::ptr::eq(guard.principal(), credentials.principal) {
                            return Err(a::AccessError::Forbidden);
                        }
                        Ok(())
                    },
                )
                .map_err(|error| CredentialFenceError::from(error).0)?;
        }
        Ok(credentials)
    }
}

/// Credential delivery over the actual shared Access owner. The exact borrowed
/// principal remains unchanged; cloned grants preserve their opaque provenance
/// and captured versions. A source-read fence checks them at every delivery.
pub struct NativeReadCredentials<'p> {
    config: Arc<NativeReadCredentialConfig>,
    access: Arc<Mutex<a::AccessBoundary>>,
    principal: &'p a::Principal,
    source: a::SourceGrant,
    partition: a::PartitionGrant,
}
impl<'p> NativeReadCredentials<'p> {
    /// Direct per-request construction delegates to the immutable config owner.
    pub fn from_trusted_header(
        endpoint: &SourceEndpoint,
        access: Arc<Mutex<a::AccessBoundary>>,
        principal: &'p a::Principal,
        source: a::SourceGrant,
        partition: a::PartitionGrant,
        header: Vec<u8>,
    ) -> Result<Self, ReadError> {
        Arc::new(NativeReadCredentialConfig::from_trusted_header(
            endpoint, header,
        )?)
        .bind_original(access, principal, source, partition)
    }

    fn check_binding(&self) -> Result<(), ReadError> {
        let scope = &self.config.scope;
        let source = self.source.reference();
        let partition = self.partition.partition();
        if self.principal.scope().workspace_id.as_str() != scope.workspace_id.as_str()
            || self.principal.scope().home_id.as_str() != scope.home_id.as_str()
            || source.partition() != *partition
            || source.key.source_kind != a::SourceKind::HomeboxEntity
            || partition.workspace_id.as_str() != scope.workspace_id.as_str()
            || partition.home_id.as_str() != scope.home_id.as_str()
            || partition.source_instance_id.as_str() != scope.source_instance_id.as_str()
            || partition.collection_id != scope.collection_id
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        Ok(())
    }

    fn deliver_header(
        &self,
        endpoint: &SourceEndpoint,
        deadline: Instant,
    ) -> Result<Option<AuthorizationHeader>, ReadError> {
        if Instant::now() >= deadline {
            return Err(ReadError(ErrorCode::Timeout));
        }
        if !self.config.matches_endpoint(endpoint) {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        self.check_binding()?;
        let mut header = None;
        {
            let mut access = self
                .access
                .try_lock()
                .map_err(|_| ReadError(ErrorCode::Transport))?;
            access
                .with_source_read_authorization(
                    self.principal,
                    &self.partition,
                    std::slice::from_ref(&self.source),
                    |guard| -> Result<(), CredentialFenceError> {
                        if !std::ptr::eq(guard.principal(), self.principal) {
                            return Err(CredentialFenceError(ReadError(ErrorCode::Auth)));
                        }
                        if Instant::now() >= deadline {
                            return Err(CredentialFenceError(ReadError(ErrorCode::Timeout)));
                        }
                        header = Some(
                            AuthorizationHeader::from_bytes(&self.config.header)
                                .map_err(CredentialFenceError)?,
                        );
                        Ok(())
                    },
                )
                .map_err(|error| error.0)?;
        }
        if Instant::now() >= deadline {
            return Err(ReadError(ErrorCode::Timeout));
        }
        // The transport receives only the transient sensitive header; Access
        // locks/transactions have ended before any provider socket await.
        Ok(header)
    }
}
impl CredentialProvider for NativeReadCredentials<'_> {
    fn read_authorization(
        &mut self,
        endpoint: &SourceEndpoint,
        deadline: Instant,
    ) -> impl Future<Output = Result<Option<AuthorizationHeader>, ReadError>> + Send {
        // No borrowed request wrapper or lock is captured in this Send future.
        ready(self.deliver_header(endpoint, deadline))
    }
}

struct CredentialFenceError(ReadError);
impl From<a::AccessError> for CredentialFenceError {
    fn from(error: a::AccessError) -> Self {
        Self(ReadError(match error {
            a::AccessError::Unavailable => ErrorCode::Transport,
            _ => ErrorCode::Auth,
        }))
    }
}

// Source contracts only. No authority or credential is instantiated here.
const _: fn() = || {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<NativeReadCredentialConfig>();
    send_sync::<NativeReadCredentials<'static>>();
};
