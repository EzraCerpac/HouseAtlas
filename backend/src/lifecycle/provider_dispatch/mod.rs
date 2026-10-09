//! Single-process host for the accepted native jobs/AT07 queue protocol.
//! SQL transactions and RefCell borrows end before synchronous transport I/O.
//! durable_stock additionally composes the published async StockActivityPort.
pub use crate::config::provider_dispatch::TrustedDispatcherConfig;
use crate::{
    jobs::{self, native_homebox::*},
    storage::{self, AtlasStore, Authorization, Contract, QueueAuthorization, Runtime},
};
pub mod archive;
pub mod capture;
pub mod durable_stock;
#[cfg(test)]
mod healthy;
pub mod media_policy_archive;
pub mod queued_upload_history_archive;
mod retention;
pub mod stock_http;

/// Own this once in the deployment host. A mutable borrow serializes all local
/// callers; AT07's durable physical slot covers every registered source alias.
/// Construction starts no listener, scheduler, recovery scan or provider I/O.
pub struct ProviderDispatcher<C, A: Authorization, R, T> {
    store: AtlasStore<C, A, R>,
    transport: T,
    config: jobs::QueueConfig,
}

impl<C: Contract, A: Authorization, R: Runtime, T: PreparedTransport>
    ProviderDispatcher<C, A, R, T>
{
    pub fn new(store: AtlasStore<C, A, R>, transport: T, config: TrustedDispatcherConfig) -> Self {
        Self {
            store,
            transport,
            config: config.into_queue(),
        }
    }

    /// Bind the original opaque authority and exact schema-validated input.
    /// No grant, principal or witness is reconstructed from durable queue rows.
    /// Owner construction receives the actual SQL journal handle, not an
    /// alternative activity database. Registration is authorized by AT07.
    pub fn bind<'a, Q, O>(
        &'a mut self,
        binding: storage::QueueSessionBinding<'a, Q::Principal, Q::Witness>,
        authority: &'a Q,
        owner: impl FnOnce(storage::QueueJournalHandle<'a, C, A, R, Q>) -> O,
    ) -> storage::Result<BoundDispatcher<'a, C, A, R, Q, O, T>>
    where
        Q: QueueAuthorization<Principal = A::Principal>,
        O: NativeOperationOwner<Payload = T::Payload, Response = T::Response>,
    {
        let session = self.store.queue_session(
            self.config.clone(),
            binding,
            authority,
            storage::QueueEvidenceInbox::default(),
        )?;
        let handles = session.into_handles();
        let writer = NativeHomeBoxWriter::new(
            owner(handles.journal),
            BorrowedTransport(&mut self.transport),
        );
        let queue =
            jobs::WriteQueue::new(handles.store, writer, self.config.clone()).map_err(|_| {
                storage::Error::new("invalid-contract", "Dispatcher configuration changed")
            })?;
        Ok(BoundDispatcher { queue })
    }

    /// Consuming shutdown returns the exact owned database and transport. The
    /// caller must stop the transport before closing the store. No hold is freed.
    pub fn into_parts(self) -> (AtlasStore<C, A, R>, T) {
        (self.store, self.transport)
    }
}

struct BorrowedTransport<'a, T>(&'a mut T);
impl<T: PreparedTransport> PreparedTransport for BorrowedTransport<'_, T> {
    type Payload = T::Payload;
    type Response = T::Response;
    fn invoke(
        &mut self,
        invocation: QualifiedInvocation<Self::Payload>,
    ) -> TransportReceipt<Self::Response> {
        self.0.invoke(invocation)
    }
}

type NativeQueue<'a, C, A, R, Q, O, T> = jobs::WriteQueue<
    storage::QueueStoreHandle<'a, C, A, R, Q>,
    NativeHomeBoxWriter<O, BorrowedTransport<'a, T>>,
>;

/// A request-local binding, borrowing the original authority for its full use.
/// The session owns no open SQL transaction across a transport invocation.
pub struct BoundDispatcher<
    'a,
    C,
    A: Authorization,
    R,
    Q: QueueAuthorization<Principal = A::Principal>,
    O,
    T,
> {
    queue: NativeQueue<'a, C, A, R, Q, O, T>,
}

impl<
    C: Contract,
    A: Authorization,
    R: Runtime,
    Q: QueueAuthorization<Principal = A::Principal>,
    O: NativeOperationOwner<Payload = T::Payload, Response = T::Response>,
    T: PreparedTransport,
> BoundDispatcher<'_, C, A, R, Q, O, T>
{
    /// Metadata only. Exact derivation and durable deduplication remain AT07's.
    pub fn enqueue(
        &mut self,
        request: &jobs::EnqueueRequest,
        now: jobs::Timestamp,
    ) -> Result<jobs::EnqueueOutcome, jobs::QueueError<storage::Error>> {
        self.queue.enqueue(request, now)
    }

    pub fn snapshot(
        &mut self,
        receipt: &jobs::ReceiptKey,
    ) -> Result<Option<jobs::JobSnapshot>, jobs::QueueError<storage::Error>> {
        self.queue.snapshot(receipt)
    }

    /// Exactly one jobs claim -> native owner/journal -> transport -> atomic
    /// finish. The completion clock is sampled after owned I/O returns.
    /// Unknown effects, remote-end proof and liabilities remain independent.
    /// Calling this requires trusted dispatch authorization; it is never a
    /// startup/recovery action and does not run automatically after enqueue.
    pub fn dispatch_next(
        &mut self,
        now: jobs::Timestamp,
        completed_at: impl FnOnce() -> jobs::Timestamp,
    ) -> Result<jobs::DispatchOutcome, jobs::QueueError<storage::Error>> {
        self.queue.dispatch_next(now, completed_at)
    }
}
