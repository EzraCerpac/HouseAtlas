//! Private, explicitly selected startup data. A digest is a custody pin, not
//! evidence that an external registration, runtime or spending gate was approved.
use crate::ai::{AiError, oauth::RegistrationBinding};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileConfiguration {
    schema_version: u32,
    application_origin: String,
    stable_host_id: String,
    app_name: String,
    credential_directory: PathBuf,
    registrations: Vec<RegistrationConfiguration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistrationConfiguration {
    registration_id: String,
    actor_id: String,
    workspace_id: String,
    home_id: String,
    authority_epoch: String,
    cancellation_epoch: String,
    /// An explicit candidate. Discovery of this same credential session must
    /// still establish membership before the host can select it.
    model_slug: Option<String>,
    /// Optional application-owned display metadata. It is never an account or
    /// workspace identity, a provider observation, or an admission decision.
    account_label: Option<String>,
}

/// Neither Deserialize nor Clone: request JSON cannot instantiate the captured
/// configuration. Its caller must obtain the expected digest from the existing
/// trusted approval/custody owner, separately from the selected file.
pub struct StartupConfiguration {
    file: FileConfiguration,
    source_digest: String,
}

impl StartupConfiguration {
    pub fn read_pinned(path: &Path, expected_sha256: &str) -> Result<Self, AiError> {
        if expected_sha256.len() != 64
            || !expected_sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(AiError::InvalidInput);
        }
        let bytes = crate::config::server::read_selected_file(path, 64 * 1024, true)
            .map_err(|_| AiError::ConnectionUnavailable)?;
        let source_digest = format!("{:x}", Sha256::digest(&bytes));
        if source_digest != expected_sha256 {
            return Err(AiError::ConnectionUnavailable);
        }
        let file: FileConfiguration =
            serde_json::from_slice(&bytes).map_err(|_| AiError::InvalidInput)?;
        let url = url::Url::parse(&file.application_origin).map_err(|_| AiError::InvalidInput)?;
        if file.schema_version != 1
            || url.scheme() != "https"
            || url.origin().ascii_serialization() != file.application_origin
            || !file.credential_directory.is_absolute()
            || file.credential_directory.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
            || !valid_field(&file.app_name, 256)
            || !valid_field(&file.stable_host_id, 256)
            || file.registrations.is_empty()
            || file.registrations.len() > 64
        {
            return Err(AiError::InvalidInput);
        }
        let mut scopes = BTreeSet::new();
        for row in &file.registrations {
            for value in [
                &row.registration_id,
                &row.actor_id,
                &row.workspace_id,
                &row.home_id,
                &row.authority_epoch,
                &row.cancellation_epoch,
            ] {
                if !valid_field(value, 128) {
                    return Err(AiError::InvalidInput);
                }
            }
            crate::access::CanonicalId::parse(&row.actor_id).map_err(|_| AiError::InvalidInput)?;
            crate::access::CanonicalId::parse(&row.workspace_id)
                .map_err(|_| AiError::InvalidInput)?;
            crate::access::CanonicalId::parse(&row.home_id).map_err(|_| AiError::InvalidInput)?;
            if row
                .model_slug
                .as_ref()
                .is_some_and(|model| !valid_field(model, 256))
                || row
                    .account_label
                    .as_ref()
                    .is_some_and(|label| !valid_field(label, 256))
                || !scopes.insert((&row.actor_id, &row.workspace_id, &row.home_id))
            {
                return Err(AiError::InvalidInput);
            }
        }
        Ok(Self {
            file,
            source_digest,
        })
    }
    pub fn source_digest(&self) -> &str {
        &self.source_digest
    }
    pub fn application_origin(&self) -> &str {
        &self.file.application_origin
    }
    pub(super) fn credential_directory(&self) -> &Path {
        &self.file.credential_directory
    }
    pub(super) fn stable_host_id(&self) -> &str {
        &self.file.stable_host_id
    }
    pub(super) fn app_name(&self) -> &str {
        &self.file.app_name
    }
    pub(super) fn trusted_registration(
        &self,
        binding: &RegistrationBinding,
    ) -> Result<crate::ai::host::enrollment::TrustedRegistration, AiError> {
        self.registration(binding)?;
        crate::ai::host::enrollment::TrustedRegistration::from_existing_approval(
            binding.clone(),
            crate::ai::oauth::RegistrationKind::LocalPublicClient,
            self.app_name().to_owned(),
            self.stable_host_id().to_owned(),
        )
    }
    pub(super) fn registration(
        &self,
        binding: &RegistrationBinding,
    ) -> Result<&RegistrationConfiguration, AiError> {
        self.file
            .registrations
            .iter()
            .find(|row| row.same_identity(binding))
            .ok_or(AiError::ConnectionUnavailable)
    }
    pub(super) fn original_registration(
        &self,
        original: &crate::access::Principal,
    ) -> Result<RegistrationBinding, AiError> {
        self.file
            .registrations
            .iter()
            .find(|row| {
                row.actor_id == original.actor_id().as_str()
                    && row.workspace_id == original.scope().workspace_id.as_str()
                    && row.home_id == original.scope().home_id.as_str()
            })
            .map(RegistrationConfiguration::binding)
            .ok_or(AiError::ConnectionUnavailable)
    }
}
impl RegistrationConfiguration {
    fn same_identity(&self, b: &RegistrationBinding) -> bool {
        self.registration_id == b.registration_id
            && self.actor_id == b.actor_id
            && self.workspace_id == b.workspace_id
            && self.home_id == b.home_id
            && self.authority_epoch == b.authority_epoch
    }
    fn binding(&self) -> RegistrationBinding {
        RegistrationBinding {
            registration_id: self.registration_id.clone(),
            actor_id: self.actor_id.clone(),
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            authority_epoch: self.authority_epoch.clone(),
            cancellation_epoch: self.cancellation_epoch.clone(),
        }
    }
    pub(super) fn model(&self) -> Option<&str> {
        self.model_slug.as_deref()
    }
    pub(super) fn account_label(&self) -> Option<&str> {
        self.account_label.as_deref()
    }
}
fn valid_field(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
}
