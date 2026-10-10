//! All consumers retain the same native access, enrollment and configuration owners.
use super::configuration::StartupConfiguration;
use crate::ai::{
    AiError,
    host::{
        HostAuthority,
        enrollment::EnrollmentOwner,
        native::{NativeHostAuthority, NativeHostContext},
    },
    oauth::RegistrationBinding,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct StartupAuthority {
    pub(super) access: crate::app::Access,
    pub(super) enrollment: Arc<EnrollmentOwner>,
    pub(super) configuration: Arc<StartupConfiguration>,
}
impl StartupAuthority {
    fn native(&self) -> NativeHostAuthority<crate::http::ai::ReceiptEnrollment<EnrollmentOwner>> {
        NativeHostAuthority {
            access: Arc::clone(&self.access),
            registrations: crate::http::ai::ReceiptEnrollment(Arc::clone(&self.enrollment)),
        }
    }
    fn configuration(
        &self,
        context: &NativeHostContext,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        self.enrollment.verify_existing_configuration(
            context.original(),
            &self.configuration.trusted_registration(binding)?,
        )
    }
}
impl HostAuthority<NativeHostContext> for StartupAuthority {
    fn binding(&self, context: &NativeHostContext) -> Result<RegistrationBinding, AiError> {
        let binding = self.native().binding(context)?;
        self.configuration(context, &binding)?;
        Ok(binding)
    }
    fn revalidate(
        &self,
        context: &NativeHostContext,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        self.configuration(context, binding)?;
        self.native().revalidate(context, binding)
    }
    fn revalidate_action_receipt(
        &self,
        context: &NativeHostContext,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        // The original cancelled context deliberately retains its old epoch.
        // Verify the configured same identity using the owner's current binding,
        // then use only the native receipt proof for the original capture.
        let current = self.enrollment.capture(context.original())?;
        self.enrollment.verify_existing_configuration(
            context.original(),
            &self.configuration.trusted_registration(&current)?,
        )?;
        self.native().revalidate_action_receipt(context, binding)
    }
}
