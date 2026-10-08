//! Concrete existing-port bindings to the original installed quantity source.
//! Preparation only revalidates retained evidence; readback captures GET outside
//! both shared locks. Graph authorization remains the original domain owner's job.
use super::*;
use crate::{
    access,
    app::{Core, Store, stock_activity_principal::OriginalStockActivityPrincipal},
    config::providers::quantity_installation::OriginalQuantityConfigured,
    domain::stock::CapturedAccess,
    providers::homebox::{read, recovery::NativeWriterContracts},
    storage::StockActivityPrincipal,
};
use std::sync::{Arc, Mutex};

struct QuantityBindingCustody<'bind, 'p> {
    store: Arc<Mutex<Store>>,
    access: Arc<Mutex<access::AccessBoundary>>,
    configured: Arc<OriginalQuantityConfigured>,
    original: &'p OriginalStockActivityPrincipal,
    captured: &'bind CapturedAccess<'p>,
}
impl<'bind, 'p> QuantityBindingCustody<'bind, 'p> {
    fn new(
        core: &Core,
        configured: Arc<OriginalQuantityConfigured>,
        original: &'p OriginalStockActivityPrincipal,
        captured: &'bind CapturedAccess<'p>,
    ) -> Result<Self, StockErrorCode> {
        let custody = Self {
            store: Arc::clone(&core.store),
            access: Arc::clone(&core.access),
            configured,
            original,
            captured,
        };
        custody.check_original()?;
        Ok(custody)
    }
    fn check_original(&self) -> Result<(), StockErrorCode> {
        let command = self.original.command();
        let expected = self.configured.descriptor();
        if !Arc::ptr_eq(&self.access, self.configured.access())
            || !std::ptr::eq(
                self.original.original_activity_principal(),
                self.captured.principal(),
            )
            || command.command_id != "homebox.entity.quantity.set"
            || command.context != expected.scope
            || command.target != expected.target
            || self.original.captured_authority() != &expected.authority
            || !self.captured.source_grants().iter().any(|grant| {
                grant.reference() == self.original.original_activity_source().reference()
            })
            || !self.captured.partition_grants().iter().any(|grant| {
                grant.partition() == self.original.original_activity_partition().partition()
            })
            || !self
                .configured
                .source()
                .contains(self.original.original_activity_source().reference())
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        Ok(())
    }
    fn check_source<T: read::Transport, K: read::Clock + Send + Sync>(
        &self,
        source: &QuantitySource<'p, T, K>,
    ) -> Result<(), StockErrorCode> {
        if !std::ptr::eq(source.original(), self.original)
            || !source
                .configured()
                .is_some_and(|configured| Arc::ptr_eq(configured, &self.configured))
        {
            return Err(StockErrorCode::ProviderUnqualified);
        }
        Ok(())
    }
    fn validate_current(&self) -> Result<(), StockErrorCode> {
        self.check_original()?;
        let mut store = self
            .store
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        if !Arc::ptr_eq(&store.configured_authorization().0, &self.access) {
            return Err(StockErrorCode::PreflightConflict);
        }
        let mut boundary = self
            .access
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        boundary
            .with_mutation_authorization(self.original.original_activity_principal(), |guard| {
                let physical = self
                    .configured
                    .observe_original(&mut store, self.original, guard)
                    .map_err(BindingFailure::from)?;
                FreshQualification::with_quantity_installation(guard, self.captured, &physical)
                    .map_err(BindingFailure)?
                    .revalidate()
                    .map_err(BindingFailure)?;
                Ok::<(), BindingFailure>(())
            })
            .map_err(|failure| failure.0)
    }
}

/// Borrows the exact retained preparation and the same original graph capture.
pub struct QuantityPreparationBinding<'bind, 'owner, 'p, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    custody: QuantityBindingCustody<'bind, 'p>,
    retained:
        &'bind RetainedFreshPreparation<'owner, NativeWriterContracts, QuantitySource<'p, T, K>>,
}
impl<'bind, 'owner, 'p, T: read::Transport, K: read::Clock + Send + Sync>
    QuantityPreparationBinding<'bind, 'owner, 'p, T, K>
{
    pub fn new(
        core: &Core,
        configured: Arc<OriginalQuantityConfigured>,
        original: &'p OriginalStockActivityPrincipal,
        captured: &'bind CapturedAccess<'p>,
        retained: &'bind RetainedFreshPreparation<
            'owner,
            NativeWriterContracts,
            QuantitySource<'p, T, K>,
        >,
    ) -> Result<Self, StockErrorCode> {
        let binding = Self {
            custody: QuantityBindingCustody::new(core, configured, original, captured)?,
            retained,
        };
        binding.custody.check_source(retained.source())?;
        binding.prepare_current(original.command(), original.captured_authority())?;
        Ok(binding)
    }
    pub fn retained(
        &self,
    ) -> &RetainedFreshPreparation<'owner, NativeWriterContracts, QuantitySource<'p, T, K>> {
        self.retained
    }
    pub fn captured(&self) -> &CapturedAccess<'p> {
        self.custody.captured
    }
    pub fn original(&self) -> &OriginalStockActivityPrincipal {
        self.custody.original
    }
    fn prepare_current(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<StockPreflight, StockErrorCode> {
        self.custody.check_original()?;
        self.custody.check_source(self.retained.source())?;
        if command != self.custody.original.command()
            || authority != self.custody.original.captured_authority()
            || command != self.retained.command()
            || authority != self.retained.authority()
        {
            return Err(StockErrorCode::PreflightConflict);
        }
        let mut store = self
            .custody
            .store
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        if !Arc::ptr_eq(&store.configured_authorization().0, &self.custody.access) {
            return Err(StockErrorCode::PreflightConflict);
        }
        let mut boundary = self
            .custody
            .access
            .lock()
            .map_err(|_| StockErrorCode::ResourceUnavailable)?;
        let mut preflight = None;
        boundary
            .with_mutation_authorization(
                self.custody.original.original_activity_principal(),
                |guard| {
                    let physical = self
                        .custody
                        .configured
                        .observe_original(&mut store, self.custody.original, guard)
                        .map_err(BindingFailure::from)?;
                    let context = FreshQualification::with_quantity_installation(
                        guard,
                        self.custody.captured,
                        &physical,
                    )
                    .map_err(BindingFailure)?;
                    self.retained
                        .revalidate_in_guard(&context, command, authority)
                        .map_err(BindingFailure)?;
                    preflight = Some(self.retained.preflight().clone());
                    Ok::<(), BindingFailure>(())
                },
            )
            .map_err(|failure| failure.0)?;
        preflight.ok_or(StockErrorCode::ResourceUnavailable)
    }
}
impl<T: read::Transport, K: read::Clock + Send + Sync> StockPreparationPort
    for QuantityPreparationBinding<'_, '_, '_, T, K>
{
    async fn prepare(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> Result<StockPreflight, StockErrorCode> {
        self.prepare_current(command, authority)
    }
}

/// Captures one exact native readback before its synchronous original guard fence.
pub struct QuantityReadbackBinding<'bind, 'p, T, K> {
    custody: QuantityBindingCustody<'bind, 'p>,
    readback: &'bind DecodedStockReadback<NativeWriterContracts, QuantitySource<'p, T, K>>,
}
impl<'bind, 'p, T: read::Transport, K: read::Clock + Send + Sync>
    QuantityReadbackBinding<'bind, 'p, T, K>
{
    pub fn new(
        core: &Core,
        configured: Arc<OriginalQuantityConfigured>,
        original: &'p OriginalStockActivityPrincipal,
        captured: &'bind CapturedAccess<'p>,
        readback: &'bind DecodedStockReadback<NativeWriterContracts, QuantitySource<'p, T, K>>,
    ) -> Result<Self, StockErrorCode> {
        let binding = Self {
            custody: QuantityBindingCustody::new(core, configured, original, captured)?,
            readback,
        };
        binding.custody.check_source(readback.source())?;
        binding.custody.validate_current()?;
        Ok(binding)
    }
    pub fn captured(&self) -> &CapturedAccess<'p> {
        self.custody.captured
    }
    pub fn original(&self) -> &OriginalStockActivityPrincipal {
        self.custody.original
    }
    pub fn native(&self) -> &DecodedStockReadback<NativeWriterContracts, QuantitySource<'p, T, K>> {
        self.readback
    }
    pub(super) async fn capture_current(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<RetainedFreshReadback<'_, NativeWriterContracts, QuantitySource<'p, T, K>>> {
        self.custody.check_original().ok()?;
        self.custody.check_source(self.readback.source()).ok()?;
        if &operation.command != self.custody.original.command()
            || authority != self.custody.original.captured_authority()
            || operation.captured_authority != *authority
        {
            return None;
        }
        // No Store, Access or physical borrow exists over this GET await.
        let pending = self
            .readback
            .capture_pending(operation, plan, authority)
            .await?;
        let mut store = self.custody.store.lock().ok()?;
        if !Arc::ptr_eq(&store.configured_authorization().0, &self.custody.access) {
            return None;
        }
        let mut boundary = self.custody.access.lock().ok()?;
        let mut observation = None;
        boundary
            .with_mutation_authorization(
                self.custody.original.original_activity_principal(),
                |guard| {
                    let physical = self
                        .custody
                        .configured
                        .observe_original(&mut store, self.custody.original, guard)
                        .map_err(BindingFailure::from)?;
                    let context = FreshQualification::with_quantity_installation(
                        guard,
                        self.custody.captured,
                        &physical,
                    )
                    .map_err(BindingFailure)?;
                    observation = pending.finish_in_guard_retained(&context);
                    if observation.is_none() {
                        return Err(BindingFailure(StockErrorCode::ResourceUnavailable));
                    }
                    Ok::<(), BindingFailure>(())
                },
            )
            .ok()?;
        observation
    }
    async fn read_current(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> Option<NativeObservation> {
        self.capture_current(operation, plan, authority)
            .await
            .map(|receipt| receipt.observation().clone())
    }
}
impl<T: read::Transport, K: read::Clock + Send + Sync> StockReadbackPort
    for QuantityReadbackBinding<'_, '_, T, K>
{
    async fn readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> NativeObservation {
        self.read_current(operation, plan, authority)
            .await
            .unwrap_or(NativeObservation::Unavailable)
    }
}

struct BindingFailure(StockErrorCode);
impl From<access::AccessError> for BindingFailure {
    fn from(error: access::AccessError) -> Self {
        Self(super::quantity_observation::quantity_access_error(error))
    }
}
impl From<crate::storage::Error> for BindingFailure {
    fn from(error: crate::storage::Error) -> Self {
        Self(match error.code {
            "unauthenticated" => StockErrorCode::Unauthenticated,
            "forbidden" => StockErrorCode::CapabilityDenied,
            "identity-conflict" | "schema-incompatible" => StockErrorCode::PreflightConflict,
            _ => StockErrorCode::ResourceUnavailable,
        })
    }
}
