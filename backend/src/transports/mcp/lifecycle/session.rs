use crate::contracts::stock as wire;

use super::super::{
    AdapterConfig, McpAdapter, NativeCatalog, NativeContext, NativeOperation, NativeOutput,
    NativePrincipal, NativePrincipalPort, NativeSchemas, PortError, PortFuture, PrincipalPort,
    ServicePort, Session, SessionState, protocol,
};
use super::{AuthenticatedIdentity, SessionControl};

/// Root maps Reply to its existing marked JSON response and Accepted to empty
/// 202. Closed ends/removes the logical session; Cancelled releases the request
/// without a JSON-RPC result. Neither terminal variant is a tool error DTO.
#[derive(Debug, PartialEq, Eq)]
pub enum Delivery {
    Reply(Vec<u8>),
    Accepted,
    Cancelled,
    Closed,
}

/// Reuses the accepted adapter, decoder, native catalog and service boundary.
/// The host remains the only owner of HTTP registry IDs, locks and idle clocks.
pub struct NativeSession<S> {
    adapter: McpAdapter<NativePrincipalPort, NativeCatalog, ObservedService<S>>,
    session: Session<NativeContext>,
    control: SessionControl,
    max_message_bytes: usize,
}

impl<S> NativeSession<S>
where
    S: ServicePort<NativePrincipal, NativeOperation, Output = NativeOutput>,
{
    /// Admission comes from the actual host owner composition. This constructor
    /// never infers allowed operations from role, annotations or MCP capabilities.
    pub async fn new(
        identity: AuthenticatedIdentity,
        schemas: &NativeSchemas,
        admitted: impl IntoIterator<Item = wire::OperationId>,
        service: S,
        config: AdapterConfig,
    ) -> Result<Self, PortError> {
        identity.release_with(&identity)?;
        let context = NativeContext::from_principal(identity.original().clone());
        let principal_port = NativePrincipalPort::new(identity.access.clone());
        let principal = principal_port.resolve(&context).await?;
        let catalog = NativeCatalog::with_admitted_operations(schemas, &principal, admitted)?;
        let control = SessionControl::new(identity, config.max_message_bytes);
        let max_message_bytes = config.max_message_bytes;
        let adapter = McpAdapter::new(
            principal_port,
            catalog,
            ObservedService {
                service,
                control: control.clone(),
            },
            config,
        )
        .map_err(|_| PortError::Unavailable)?;
        let session = adapter.open(context);
        Ok(Self {
            adapter,
            session,
            control,
            max_message_bytes,
        })
    }

    pub fn control(&self) -> SessionControl {
        self.control.clone()
    }

    pub fn state(&self) -> SessionState {
        if self.control.is_closed() {
            SessionState::Closed
        } else {
            self.session.state()
        }
    }

    pub fn close(&mut self) {
        self.control.close();
        self.session.close();
    }

    /// Root passes this POST's genuinely authenticated identity after its own
    /// transport checks. Current request authority never replaces the retained
    /// context. Await one request at a time; use control() for cancellation intake.
    pub async fn handle(
        &mut self,
        current: &AuthenticatedIdentity,
        bytes: &[u8],
    ) -> Result<Delivery, PortError> {
        if self.control.is_closed() {
            self.session.close();
            return Ok(Delivery::Closed);
        }
        self.control.identity.release_with(current)?;
        if bytes.len() > self.max_message_bytes {
            self.close();
            return Ok(Delivery::Closed);
        }
        // Classification uses exactly the accepted bounded decoder. Original
        // bytes still reach the owner; no response or argument is reconstructed.
        let message = protocol::decode(bytes).ok();
        if let Some(message) = &message
            && message.id.is_none()
            && message.method == "notifications/cancelled"
        {
            self.control.notification(current, bytes)?;
            return Ok(Delivery::Accepted);
        }
        let active = message
            .as_ref()
            .and_then(|message| message.id.as_ref())
            .map(|id| {
                // initialize, ping and unknown methods cannot be cancelled. Calls
                // become cancellable only after the native catalog prepares a read.
                self.control.begin(
                    id.clone(),
                    message
                        .as_ref()
                        .is_some_and(|message| message.method == "tools/list"),
                )
            })
            .transpose()?;
        let reply = self.adapter.handle(&mut self.session, bytes).await;
        let owner_closed = self.session.state() == SessionState::Closed;
        let (closed, cancelled) = match active {
            Some(active) => active.finish()?,
            None => (self.control.is_closed(), false),
        };
        if owner_closed {
            self.control.close();
        }
        if closed {
            self.session.close();
            return Ok(Delivery::Closed);
        }
        // Initialization, ping and notification release checks are additional
        // to the accepted adapter's current-principal tool release checks.
        self.control.identity.release_with(current)?;
        if cancelled {
            return Ok(Delivery::Cancelled);
        }
        Ok(match reply {
            Some(bytes) => Delivery::Reply(bytes),
            None if owner_closed => Delivery::Closed,
            None => Delivery::Accepted,
        })
    }
}

impl<S> Drop for NativeSession<S> {
    fn drop(&mut self) {
        self.control.close();
        self.session.close();
    }
}

struct ObservedService<S> {
    service: S,
    control: SessionControl,
}

impl<S> ServicePort<NativePrincipal, NativeOperation> for ObservedService<S>
where
    S: ServicePort<NativePrincipal, NativeOperation, Output = NativeOutput>,
{
    type Output = NativeOutput;

    fn execute<'a>(
        &'a self,
        principal: &'a NativePrincipal,
        operation: NativeOperation,
    ) -> PortFuture<'a, Self::Output> {
        Box::pin(async move {
            if read_only(&operation.request) {
                self.control.allow_read_cancellation()?;
                if self.control.read_should_stop()? {
                    // The terminal cancellation/closure disposition suppresses
                    // this internal category; no new public DTO is fabricated.
                    return Err(PortError::Unavailable);
                }
            }
            // Native root execution is synchronous and atomic. Never drop or
            // abort its work/transaction to implement cancellation. A cancelled
            // read drains owner completion/revalidation and suppresses its reply.
            // Mutations remain uncancellable and retain their actual receipt.
            self.service.execute(principal, operation).await
        })
    }
}

fn read_only(request: &wire::StockRequest) -> bool {
    wire::operation(request.id()).is_ok_and(|operation| operation.effect == wire::Effect::Read)
        && request.children().iter().all(read_only)
}
