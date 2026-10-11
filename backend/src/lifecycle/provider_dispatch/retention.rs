//! Accepted AT07 activity decorated with producer/codec /3 durable retention.
//! Admission, dispatch, reducers, FIFO and permits remain the actual peers'.
use super::{
    archive::{ArchiveReceipt, PrivateStockArchive},
    capture::NativeArchiveAuthorization,
};
use crate::{
    providers::homebox::{recovery as codec, write::stock as n},
    storage as s,
};
use n::StockActivityPort;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(super) struct Retention<P: s::StockActivityPrincipal, G> {
    archive: Arc<PrivateStockArchive>,
    authorization: Arc<G>,
    contracts: Arc<codec::NativeWriterContracts>,
    pub(super) capture: codec::StockActivityNativeCapture,
    state: Mutex<State<P>>,
}
struct State<P: s::StockActivityPrincipal> {
    reserved: Option<s::StockActivityProducer<P>>,
    native: Option<codec::RetainedNativeStockActivity<P>>,
    receipts: Vec<ArchiveReceipt>,
    failure: Option<n::StockPortFault>,
}
impl<P: s::StockActivityPrincipal> State<P> {
    fn producer(&self) -> Option<&s::StockActivityProducer<P>> {
        self.native
            .as_ref()
            .map(|c| c.producer())
            .or(self.reserved.as_ref())
    }
}
impl<P: s::StockActivityPrincipal, G: NativeArchiveAuthorization<P>> Retention<P, G> {
    pub(super) fn new(
        archive: Arc<PrivateStockArchive>,
        authorization: Arc<G>,
        contracts: Arc<codec::NativeWriterContracts>,
    ) -> Arc<Self> {
        Arc::new(Self {
            archive,
            authorization,
            contracts,
            capture: codec::StockActivityNativeCapture::unbound(),
            state: Mutex::new(State {
                reserved: None,
                native: None,
                receipts: vec![],
                failure: None,
            }),
        })
    }
    pub(super) fn ready(&self) -> Result<(), n::StockPortFault> {
        self.state
            .lock()
            .map_err(|_| n::StockPortFault::Unavailable)?
            .failure
            .map_or(Ok(()), Err)
    }
    fn capture<
        C: s::Contract + Send,
        A: s::Authorization + Send,
        R: s::Runtime + Send,
        S: n::StockContractPort + Send + Sync,
    >(
        &self,
        session: &s::StockActivitySession<C, A, R, P, G, S>,
        id: Uuid,
    ) -> Result<(), n::StockPortFault> {
        // Only synchronous genuine retention/encoding/file operations occur
        // under this private data mutex; no network await or SQL guard escapes.
        let mut state = self
            .state
            .lock()
            .map_err(|_| n::StockPortFault::Unavailable)?;
        let result = (|| {
            let next = match state.producer() {
                Some(prior) if prior.record().operation().operation_id == id => {
                    session.retain_producer_successor(prior)?
                }
                Some(_) => return Err(n::StockPortFault::EvidenceConflict),
                None => session.retain_producer(id)?,
            };
            if let Some(prior) = state.producer()
                && prior.record() == next.record()
            {
                // No new commit: the exact immutable cut was already archived.
                return state.failure.map_or(Ok(()), Err);
            }
            if let Some(native) = &mut state.native {
                native
                    .retain_successor(&self.contracts, next)
                    .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            } else if matches!(
                next.record().events().last().map(|e| e.facts()),
                Some(s::StockActivityEventFacts::Admit(_))
            ) {
                state.native = Some(
                    codec::RetainedNativeStockActivity::bind_admitted(
                        &self.contracts,
                        next,
                        &self.capture,
                    )
                    .map_err(|_| n::StockPortFault::EvidenceConflict)?,
                );
                state.reserved = None;
            } else {
                state.reserved = Some(next);
            }
            let producer = state
                .producer()
                .ok_or(n::StockPortFault::EvidenceConflict)?;
            self.authorization.authorize_archive(
                self.archive.destination(),
                producer,
                state.native.as_ref(),
            )?;
            let packet = match state.native.as_ref() {
                Some(native) => codec::NativeActivityArchivePacket::encode(
                    &self.contracts,
                    native,
                    self.archive.max_frame_bytes(),
                ),
                None => codec::NativeActivityArchivePacket::encode_producer(
                    &self.contracts,
                    producer,
                    self.archive.max_frame_bytes(),
                ),
            }
            .map_err(|_| n::StockPortFault::EvidenceConflict)?;
            let op = producer.record().operation();
            let receipt = self
                .archive
                .retain(op.operation_id, op.activity_version, packet.bytes())
                .map_err(|_| n::StockPortFault::Unavailable)?;
            state.receipts.push(receipt);
            state.failure.map_or(Ok(()), Err)
        })();
        if let Err(error) = result {
            state.failure.get_or_insert(error);
        }
        result
    }
    pub(super) fn record(&self) -> Result<s::RetainedStockActivity, n::StockPortFault> {
        let state = self
            .state
            .lock()
            .map_err(|_| n::StockPortFault::Unavailable)?;
        let producer = state
            .producer()
            .ok_or(n::StockPortFault::EvidenceConflict)?;
        self.authorization.authorize_retention(
            producer.original(),
            producer.record().registration(),
            None,
            s::StockActivityPhase::Release,
            producer.record(),
        )?;
        self.authorization.authorize_archive(
            self.archive.destination(),
            producer,
            state.native.as_ref(),
        )?;
        Ok(producer.record().clone())
    }
    pub(super) fn receipts(&self) -> Result<Vec<ArchiveReceipt>, n::StockPortFault> {
        self.record()?;
        Ok(self
            .state
            .lock()
            .map_err(|_| n::StockPortFault::Unavailable)?
            .receipts
            .clone())
    }
    pub(super) fn seal(&self) -> Result<codec::ArchivedNativeStockActivity<P>, n::StockPortFault> {
        self.ready()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| n::StockPortFault::Unavailable)?;
        let native = state
            .native
            .as_ref()
            .ok_or(n::StockPortFault::EvidenceConflict)?;
        self.authorization.authorize_archive(
            self.archive.destination(),
            native.producer(),
            Some(native),
        )?;
        state
            .native
            .take()
            .ok_or(n::StockPortFault::EvidenceConflict)?
            .seal(&self.contracts)
            .map_err(|_| n::StockPortFault::EvidenceConflict)
    }
    pub(super) fn operation_id(&self) -> Option<Uuid> {
        self.state
            .lock()
            .ok()?
            .producer()
            .map(|p| p.record().operation().operation_id)
    }
}

pub(super) struct RetainingActivity<C, A, R, P: s::StockActivityPrincipal, G, S> {
    pub(super) session: s::StockActivitySession<C, A, R, P, G, S>,
    pub(super) retention: Arc<Retention<P, G>>,
}
impl<
    C: s::Contract + Send,
    A: s::Authorization + Send,
    R: s::Runtime + Send,
    P: s::StockActivityPrincipal,
    G: NativeArchiveAuthorization<P>,
    S: n::StockContractPort + Send + Sync,
> RetainingActivity<C, A, R, P, G, S>
{
    fn finished<T>(
        &self,
        id: Uuid,
        result: Result<T, n::StockPortFault>,
    ) -> Result<T, n::StockPortFault> {
        // Evidence can commit then refuse disclosure. Attempt the same original
        // successor even on error; retain the error rather than manufacture success.
        let retained = self.retention.capture(&self.session, id);
        match result {
            Ok(value) => {
                retained?;
                Ok(value)
            }
            Err(error) => Err(error),
        }
    }
}
impl<
    C: s::Contract + Send,
    A: s::Authorization + Send,
    R: s::Runtime + Send,
    P: s::StockActivityPrincipal,
    G: NativeArchiveAuthorization<P>,
    S: n::StockContractPort + Send + Sync,
> StockActivityPort for RetainingActivity<C, A, R, P, G, S>
{
    async fn reserve(
        &self,
        command: &n::StockCommand,
        authority: &n::StockAuthority,
    ) -> Result<n::StockReservation, n::StockPortFault> {
        self.retention.ready()?;
        let result = self.session.reserve(command, authority).await?;
        match &result {
            n::StockReservation::Reserved(op) | n::StockReservation::Queued(op) => {
                self.retention.capture(&self.session, op.operation_id)?
            }
            n::StockReservation::Existing(_) => {}
        }
        Ok(result)
    }
    async fn admit(
        &self,
        reserved: &n::StoredOperation,
        plan: &n::NativePlan,
        digest: &n::Digest,
        preflight: &n::StockPreflight,
        authority: &n::StockAuthority,
    ) -> Result<n::Admission, n::StockPortFault> {
        self.retention.ready()?;
        // This API cannot brand a restored/Existing row as a genuine producer.
        if self.retention.operation_id().is_none() {
            self.retention
                .capture(&self.session, reserved.operation_id)?;
        }
        let result = self
            .session
            .admit(reserved, plan, digest, preflight, authority)
            .await;
        // bind_admitted and actual file+directory sync finish before returning
        // the original permit to StockWriter, hence before any provider I/O.
        self.finished(reserved.operation_id, result)
    }
    async fn reject(
        &self,
        reserved: &n::StoredOperation,
        reason: n::StockErrorCode,
    ) -> Result<n::StoredOperation, n::StockPortFault> {
        let result = self.session.reject(reserved, reason).await;
        self.finished(reserved.operation_id, result)
    }
    async fn record_never_invoked(
        &self,
        permit: &n::InvocationPermit,
    ) -> Result<n::StoredOperation, n::StockPortFault> {
        self.retention.ready()?;
        let result = self.session.record_never_invoked(permit).await;
        self.finished(permit.operation_id, result)
    }
    async fn record_dispatch(
        &self,
        permit: &n::InvocationPermit,
        facts: &n::DispatchFacts,
    ) -> Result<n::StoredOperation, n::StockPortFault> {
        let result = self.session.record_dispatch(permit, facts).await;
        self.finished(permit.operation_id, result)
    }
    async fn save_observation(
        &self,
        operation: &n::StoredOperation,
        facts: &n::ObservationFacts,
    ) -> Result<n::StoredOperation, n::StockPortFault> {
        let result = self.session.save_observation(operation, facts).await;
        self.finished(operation.operation_id, result)
    }
    async fn load(
        &self,
        command: &n::StockCommand,
        actor_id: Uuid,
        id: Uuid,
    ) -> Result<n::StoredOperation, n::StockPortFault> {
        self.session.load(command, actor_id, id).await
    }
}
