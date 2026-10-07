use std::sync::{Arc, Mutex};

use super::super::{
    PortError,
    protocol::{self, RequestId},
};
use super::{AuthenticatedIdentity, ConfirmedRotation};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationDisposition {
    Cancelled,
    Ignored,
    Closed,
}

/// Separate from the root's serialized session lock. The authenticated HTTP
/// notification path can use this handle while a native owner finishes work.
/// It cannot dispatch tools, issue authority, or replace the original principal.
#[derive(Clone)]
pub struct SessionControl {
    pub(super) identity: AuthenticatedIdentity,
    pub(super) shared: Arc<Mutex<ControlState>>,
    max_message_bytes: usize,
}

#[derive(Default)]
pub(super) struct ControlState {
    pub closed: bool,
    pub active: Option<ActiveRequest>,
}

pub(super) struct ActiveRequest {
    pub id: RequestId,
    pub cancellable: bool,
    pub cancelled: bool,
}

impl SessionControl {
    pub(super) fn new(identity: AuthenticatedIdentity, max_message_bytes: usize) -> Self {
        Self {
            identity,
            shared: Arc::new(Mutex::new(ControlState::default())),
            max_message_bytes,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.shared.lock().map_or(true, |state| state.closed)
    }

    /// Transport teardown closes only this MCP session. An HTTP disconnect is
    /// not an MCP cancellation; root calls this only on logical session teardown.
    pub fn close(&self) {
        if let Ok(mut state) = self.shared.lock() {
            state.closed = true;
        }
    }

    /// A confirmed rotation ends every session using that exact old credential
    /// and Access instance, across its scopes. No principal is rebound in place.
    pub fn on_rotation(&self, event: &ConfirmedRotation) -> bool {
        if !self.identity.matches_rotation(event) {
            return false;
        }
        self.close();
        true
    }

    /// Call after root HTTP admission, scope/cookie registry selection and real
    /// POST authentication. No response bytes are produced for any notification.
    /// Malformed, unknown, completed and uncancellable IDs are ignored.
    pub fn notification(
        &self,
        current: &AuthenticatedIdentity,
        bytes: &[u8],
    ) -> Result<NotificationDisposition, PortError> {
        self.identity.release_with(current)?;
        if bytes.len() > self.max_message_bytes {
            self.close();
            return Ok(NotificationDisposition::Closed);
        }
        let Ok(message) = protocol::decode(bytes) else {
            return Ok(NotificationDisposition::Ignored);
        };
        if message.id.is_some() || message.method != "notifications/cancelled" {
            return Ok(NotificationDisposition::Ignored);
        }
        if message
            .params
            .get("reason")
            .is_some_and(|reason| !reason.is_string())
        {
            return Ok(NotificationDisposition::Ignored);
        }
        // Use the owner's exact ID decoder, including distinct text/integer IDs.
        let Some(id) = message.params.get("requestId") else {
            return Ok(NotificationDisposition::Ignored);
        };
        let synthetic = serde_json::json!({"jsonrpc":"2.0", "id": id, "method":"ping"});
        let Ok(target) =
            protocol::decode(&serde_json::to_vec(&synthetic).map_err(|_| PortError::Unavailable)?)
        else {
            return Ok(NotificationDisposition::Ignored);
        };
        let mut state = self.shared.lock().map_err(|_| PortError::Unavailable)?;
        if state.closed {
            return Ok(NotificationDisposition::Closed);
        }
        if let Some(active) = state.active.as_mut()
            && Some(&active.id) == target.id.as_ref()
            && active.cancellable
        {
            active.cancelled = true;
            Ok(NotificationDisposition::Cancelled)
        } else {
            Ok(NotificationDisposition::Ignored)
        }
    }

    pub(super) fn begin(&self, id: RequestId, cancellable: bool) -> Result<ActiveGuard, PortError> {
        let mut state = self.shared.lock().map_err(|_| PortError::Unavailable)?;
        if state.closed || state.active.is_some() {
            return Err(PortError::Unavailable);
        }
        state.active = Some(ActiveRequest {
            id,
            cancellable,
            cancelled: false,
        });
        Ok(ActiveGuard {
            control: self.clone(),
            finished: false,
        })
    }

    pub(super) fn allow_read_cancellation(&self) -> Result<(), PortError> {
        let mut state = self.shared.lock().map_err(|_| PortError::Unavailable)?;
        if let Some(active) = state.active.as_mut() {
            active.cancellable = true;
        }
        Ok(())
    }

    pub(super) fn read_should_stop(&self) -> Result<bool, PortError> {
        let state = self.shared.lock().map_err(|_| PortError::Unavailable)?;
        Ok(state.closed || state.active.as_ref().is_some_and(|active| active.cancelled))
    }
}

/// Clear the active request on completion or future drop. Never clear the
/// accepted adapter's used-ID registry, and never synthesize an owner result.
pub(super) struct ActiveGuard {
    control: SessionControl,
    finished: bool,
}

impl ActiveGuard {
    pub fn finish(mut self) -> Result<(bool, bool), PortError> {
        let mut state = self
            .control
            .shared
            .lock()
            .map_err(|_| PortError::Unavailable)?;
        let cancelled = state.active.take().is_some_and(|active| active.cancelled);
        self.finished = true;
        Ok((state.closed, cancelled))
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if !self.finished
            && let Ok(mut state) = self.control.shared.lock()
        {
            state.active = None;
            // An externally dropped handling future cannot resume the same
            // partially processed protocol session. This is not owner rollback.
            state.closed = true;
        }
    }
}
