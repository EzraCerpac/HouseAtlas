//! Producer-only capture at actual async native ports. No image constructor.
use super::{NativeWriterContracts, incompatible, unavailable};
use crate::{providers::homebox::write::stock as n, storage as s};
use std::sync::{Arc, Mutex};

pub const ACTIVITY_NATIVE_CODEC_V3: &str = "houseatlas-homebox-stock-activity-native/3";
pub const ACTIVITY_DISPATCH_CODEC_V3: &str = "houseatlas-homebox-stock-activity-dispatch/3";
pub const ACTIVITY_OBSERVATION_CODEC_V3: &str = "houseatlas-homebox-stock-activity-observation/3";

#[derive(Clone)]
pub(super) enum RawNativeCut {
    Dispatch {
        permit: n::InvocationPermit,
        plan: Box<n::NativePlan>,
        authority: n::StockAuthority,
        result: n::NativeDispatch,
    },
    Observation {
        plan: n::ReadbackPlan,
        authority: n::StockAuthority,
        result: n::NativeObservation,
    },
}
/// Read-only original native result and its exact prior journal cut. Values are
/// captured by the wrappers below, never accepted from image JSON or ID pairs.
#[derive(Clone)]
pub struct RetainedStockNativeEvent {
    pub(super) sequence: u64,
    pub(super) before: n::StoredOperation,
    pub(super) raw: RawNativeCut,
}
impl RetainedStockNativeEvent {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn before(&self) -> &n::StoredOperation {
        &self.before
    }
    pub fn codec(&self) -> &'static str {
        match &self.raw {
            RawNativeCut::Dispatch { .. } => ACTIVITY_DISPATCH_CODEC_V3,
            RawNativeCut::Observation { .. } => ACTIVITY_OBSERVATION_CODEC_V3,
        }
    }
    pub fn dispatch(&self) -> Option<&n::NativeDispatch> {
        match &self.raw {
            RawNativeCut::Dispatch { result, .. } => Some(result),
            _ => None,
        }
    }
    pub fn receipt(&self) -> Option<&n::DispatchReceipt> {
        match self.dispatch()? {
            n::NativeDispatch::Invoked(receipt) => Some(receipt),
            _ => None,
        }
    }
    pub fn permit(&self) -> Option<&n::InvocationPermit> {
        match &self.raw {
            RawNativeCut::Dispatch { permit, .. } => Some(permit),
            _ => None,
        }
    }
    pub fn dispatch_plan(&self) -> Option<&n::NativePlan> {
        match &self.raw {
            RawNativeCut::Dispatch { plan, .. } => Some(plan),
            _ => None,
        }
    }
    pub fn readback_plan(&self) -> Option<&n::ReadbackPlan> {
        match &self.raw {
            RawNativeCut::Observation { plan, .. } => Some(plan),
            _ => None,
        }
    }
    pub fn authority(&self) -> &n::StockAuthority {
        match &self.raw {
            RawNativeCut::Dispatch { authority, .. }
            | RawNativeCut::Observation { authority, .. } => authority,
        }
    }
    pub fn observation(&self) -> Option<&n::NativeObservation> {
        match &self.raw {
            RawNativeCut::Observation { result, .. } => Some(result),
            _ => None,
        }
    }
}
struct CaptureState {
    record: Option<s::RetainedStockActivity>,
    pending: Option<(n::StoredOperation, RawNativeCut)>,
    in_flight: bool,
    closed: bool,
}
/// Shared with the original dispatcher only. This handle grants no native or
/// recovery authority; underlying ports retain their original owner policies.
#[derive(Clone)]
pub struct StockActivityNativeCapture(Arc<Mutex<CaptureState>>);
impl StockActivityNativeCapture {
    /// Allocate stable port wrappers before admission. Until a genuine sealed
    /// producer is bound, no inner I/O can begin through these wrappers.
    pub fn unbound() -> Self {
        Self(Arc::new(Mutex::new(CaptureState {
            record: None,
            pending: None,
            in_flight: false,
            closed: false,
        })))
    }
    pub fn dispatch_port<D>(&self, inner: D) -> CapturingStockDispatch<D> {
        CapturingStockDispatch {
            inner,
            capture: self.clone(),
        }
    }
    pub fn readback_port<B>(&self, inner: B) -> CapturingStockReadback<B> {
        CapturingStockReadback {
            inner,
            capture: self.clone(),
        }
    }
    fn begin(
        &self,
        accept: impl FnOnce(&s::RetainedStockActivity) -> bool,
    ) -> Option<n::StoredOperation> {
        let mut state = self.0.try_lock().ok()?;
        if state.closed
            || state.in_flight
            || state.pending.is_some()
            || !state.record.as_ref().is_some_and(accept)
        {
            return None;
        }
        let before = state.record.as_ref()?.operation().clone();
        state.in_flight = true;
        Some(before)
    }
    fn complete(&self, before: n::StoredOperation, raw: RawNativeCut) {
        // A failed/cancelled capture cannot produce a qualified successor. Its
        // original physical hold is unchanged; no inferred cleanup/end proof.
        if let Ok(mut state) = self.0.try_lock() {
            state.pending = Some((before, raw));
            state.in_flight = false;
        }
    }
}
pub struct CapturingStockDispatch<D> {
    inner: D,
    capture: StockActivityNativeCapture,
}
impl<D: n::StockDispatchPort + Sync> n::StockDispatchPort for CapturingStockDispatch<D> {
    async fn dispatch(
        &self,
        permit: &n::InvocationPermit,
        plan: &n::NativePlan,
        authority: &n::StockAuthority,
    ) -> n::NativeDispatch {
        let Some(before) = self.capture.begin(|r| {
            matches!(
                r.events().last().map(|e| e.facts()),
                Some(s::StockActivityEventFacts::Admit(_))
            ) && r.permit() == Some(permit)
                && r.operation().plan.as_ref() == Some(plan)
                && &r.operation().captured_authority == authority
        }) else {
            // The accepted port has no unavailable variant. Signal unresolved
            // activity with an uncorrelated, response-less receipt; never claim
            // no invocation for a busy/ambiguous original operation. This is
            // NOT captured or qualified as native proof. The native reducer
            // preserves its unproven physical hold, or the original owner may
            // refuse the unqualified fact commit entirely.
            return n::NativeDispatch::Invoked(n::DispatchReceipt {
                operation_id: permit.operation_id,
                plan_digest: permit.plan_digest.clone(),
                context: n::Context {
                    workspace_id: uuid::Uuid::nil(),
                    home_id: uuid::Uuid::nil(),
                },
                source_instance_id: plan.readback.target.source_instance_id,
                collection_id: plan.readback.target.collection_id,
                response: None,
                remote_activity: n::RemoteActivity::end_unproven(),
            });
        };
        let result = self.inner.dispatch(permit, plan, authority).await;
        self.capture.complete(
            before,
            RawNativeCut::Dispatch {
                permit: permit.clone(),
                plan: Box::new(plan.clone()),
                authority: authority.clone(),
                result: result.clone(),
            },
        );
        result
    }
}
pub struct CapturingStockReadback<B> {
    inner: B,
    capture: StockActivityNativeCapture,
}
impl<B: n::StockReadbackPort + Sync> n::StockReadbackPort for CapturingStockReadback<B> {
    async fn readback(
        &self,
        operation: &n::StoredOperation,
        plan: &n::ReadbackPlan,
        authority: &n::StockAuthority,
    ) -> n::NativeObservation {
        let Some(before) = self.capture.begin(|r| {
            r.operation() == operation
                && r.permit().is_some()
                && super::activity_validation::readback_authority_matches(operation, authority)
                && n::retained_bridge::readback_plan(operation).as_ref() == Some(plan)
        }) else {
            return n::NativeObservation::Unavailable;
        };
        let result = self.inner.readback(operation, plan, authority).await;
        self.capture.complete(
            before,
            RawNativeCut::Observation {
                plan: plan.clone(),
                authority: authority.clone(),
                result: result.clone(),
            },
        );
        result
    }
}

/// Original sealed producer plus native evidence captured before fact reduction.
/// The dispatcher must durably retain this complete owner cut before further I/O.
/// No serialization/Clone/from-image or conversion from a Jobs lease exists.
pub struct RetainedNativeStockActivity<P: s::StockActivityPrincipal> {
    pub(super) producer: s::StockActivityProducer<P>,
    capture: StockActivityNativeCapture,
    pub(super) native: Vec<RetainedStockNativeEvent>,
}
impl<P: s::StockActivityPrincipal> RetainedNativeStockActivity<P> {
    pub fn from_admitted(
        contracts: &NativeWriterContracts,
        producer: s::StockActivityProducer<P>,
    ) -> s::Result<(Self, StockActivityNativeCapture)> {
        let capture = StockActivityNativeCapture::unbound();
        let retained = Self::bind_admitted(contracts, producer, &capture)?;
        Ok((retained, capture))
    }
    /// Bind the stable handles used by the actual writer after admission and
    /// original producer retention. An image record cannot initialize them.
    pub fn bind_admitted(
        contracts: &NativeWriterContracts,
        producer: s::StockActivityProducer<P>,
        capture: &StockActivityNativeCapture,
    ) -> s::Result<Self> {
        super::activity_validation::validate_prefix(
            contracts,
            producer.record(),
            producer.record().events(),
            &[],
        )?;
        if !matches!(
            producer.record().events().last().map(|e| e.facts()),
            Some(s::StockActivityEventFacts::Admit(_))
        ) {
            return Err(unavailable());
        }
        let mut state = capture.0.try_lock().map_err(|_| unavailable())?;
        if state.closed || state.record.is_some() || state.in_flight || state.pending.is_some() {
            return Err(unavailable());
        }
        state.record = Some(producer.record().clone());
        Ok(Self {
            producer,
            capture: capture.clone(),
            native: vec![],
        })
    }
    pub(super) fn archive_ready(&self) -> s::Result<()> {
        let state = self.capture.0.try_lock().map_err(|_| unavailable())?;
        if state.closed
            || state.in_flight
            || state.pending.is_some()
            || state.record.as_ref() != Some(self.producer.record())
        {
            return Err(unavailable());
        }
        Ok(())
    }
    pub fn producer(&self) -> &s::StockActivityProducer<P> {
        &self.producer
    }
    pub fn native_events(&self) -> &[RetainedStockNativeEvent] {
        &self.native
    }
    /// Supply the actual same-session retain_producer_successor after exactly
    /// one committed native fact. Raw evidence comes only from our bound ports.
    pub fn retain_successor(
        &mut self,
        contracts: &NativeWriterContracts,
        next: s::StockActivityProducer<P>,
    ) -> s::Result<()> {
        let prior = self.producer.record();
        let cut = next.record();
        if !std::ptr::eq(self.producer.original(), next.original())
            || cut.registration() != prior.registration()
            || cut.events().len()
                != prior
                    .events()
                    .len()
                    .checked_add(1)
                    .ok_or_else(incompatible)?
            || cut.events().get(..prior.events().len()) != Some(prior.events())
        {
            return Err(incompatible());
        }
        let mut state = self.capture.0.try_lock().map_err(|_| unavailable())?;
        if state.closed || state.in_flight || state.record.as_ref() != Some(prior) {
            return Err(unavailable());
        }
        let (before, raw) = state.pending.as_ref().ok_or_else(unavailable)?;
        let event = cut.events().last().ok_or_else(incompatible)?;
        let retained = RetainedStockNativeEvent {
            sequence: event.sequence(),
            before: before.clone(),
            raw: raw.clone(),
        };
        super::activity_validation::validate_native(
            contracts,
            cut.registration(),
            prior.operation(),
            event,
            cut.permit(),
            &retained,
        )?;
        state.pending = None;
        state.record = Some(cut.clone());
        self.native.push(retained);
        self.producer = next;
        Ok(())
    }
    /// Freeze producer provenance outside Core. Closes the capture, never the
    /// original physical hold. No store/session/driver handle enters the archive.
    pub fn seal(
        self,
        contracts: &NativeWriterContracts,
    ) -> s::Result<ArchivedNativeStockActivity<P>> {
        let mut state = self.capture.0.try_lock().map_err(|_| unavailable())?;
        if state.closed
            || state.in_flight
            || state.pending.is_some()
            || state.record.as_ref() != Some(self.producer.record())
        {
            return Err(unavailable());
        }
        super::activity_validation::validate_prefix(
            contracts,
            self.producer.record(),
            self.producer.record().events(),
            &self.native,
        )?;
        state.closed = true;
        Ok(ArchivedNativeStockActivity {
            producer: self.producer,
            native: self.native,
        })
    }
}
pub struct ArchivedNativeStockActivity<P: s::StockActivityPrincipal> {
    pub(super) producer: s::StockActivityProducer<P>,
    pub(super) native: Vec<RetainedStockNativeEvent>,
}
impl<P: s::StockActivityPrincipal> ArchivedNativeStockActivity<P> {
    pub fn producer(&self) -> &s::StockActivityProducer<P> {
        &self.producer
    }
    pub fn native_events(&self) -> &[RetainedStockNativeEvent] {
        &self.native
    }
    pub fn codec(&self) -> &'static str {
        ACTIVITY_NATIVE_CODEC_V3
    }
}
