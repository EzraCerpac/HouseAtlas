//! Native lifecycle supplement for the existing JSON-only HTTP mount.
//! HTTP admission, framing, registry limits and response marking remain root-owned.
mod control;
mod identity;
pub mod mount_adapter;
mod session;

pub use control::{NotificationDisposition, SessionControl};
pub use identity::{AuthenticatedIdentity, ConfirmedRotation, rotate_confirmed};
pub use session::{Delivery, NativeSession};
