//! In-app host binding for the exact accepted AT42 component.
//! Construction installs no listener, account, approval, credential or live task.
pub mod bridge;
pub mod continuation;
pub mod http;
pub mod lifecycle;
pub mod models;
pub mod native;
pub mod service;
pub mod status;
pub mod transport;

use crate::ai::{AiError, oauth::RegistrationBinding};

/// Implemented by the application's original-authority adapter. Binding is a
/// storage/correlation key only; it is never a replacement access principal.
pub trait HostAuthority<C>: Send + Sync {
    fn binding(&self, context: &C) -> Result<RegistrationBinding, AiError>;
    fn revalidate(&self, context: &C, binding: &RegistrationBinding) -> Result<(), AiError>;
    /// Receipt disclosure only: revalidate the original app principal, home,
    /// registration and authority epoch after intentional cancellation rotation.
    /// This never permits inference, credentials or prepared-command dispatch.
    /// Existing adapters stay conservative until their enrollment owner binds it.
    fn revalidate_action_receipt(
        &self,
        context: &C,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        self.revalidate(context, binding)
    }
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
