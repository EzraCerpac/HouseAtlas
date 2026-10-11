//! Explicit serve-only selection of already installed native AI account state.
use crate::ai::{AiError, host::startup::configuration::StartupConfiguration};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectionFile {
    schema_version: u32,
    configuration: PathBuf,
    configuration_sha256: String,
    enrollment: DatabaseSelection,
    journal: DatabaseSelection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DatabaseSelection {
    pub(crate) path: PathBuf,
    pub(crate) device: u64,
    pub(crate) inode: u64,
}

/// Captured from a private selected file and its separately supplied custody
/// digest. It is neither request-deserializable nor a grant/enrollment source.
pub struct ServerAccountSelection {
    file: SelectionFile,
}

impl ServerAccountSelection {
    /// Remove only these two exact serve options before the existing command
    /// parser. No environment fallback, disposable selection or implicit pin.
    pub fn from_arguments(arguments: &[String]) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let mut path = None;
        let mut digest = None;
        let mut arguments_iter = arguments.iter();
        while let Some(argument) = arguments_iter.next() {
            let slot = match argument.as_str() {
                "--ai-account-selection" => Some(&mut path),
                "--ai-account-selection-sha256" => Some(&mut digest),
                _ => None,
            };
            if let Some(slot) = slot {
                if arguments.first().map(String::as_str) != Some("serve") || slot.is_some() {
                    return Err(
                        "AI account selection requires unique explicit serve options".into(),
                    );
                }
                *slot = Some(
                    arguments_iter
                        .next()
                        .filter(|value| !value.starts_with("--"))
                        .ok_or("Missing AI account selection value")?
                        .clone(),
                );
            } else {
                remaining.push(argument.clone());
            }
        }
        let selected = match (path, digest) {
            (None, None) => None,
            (Some(path), Some(digest)) => Some(Self::read_pinned(&PathBuf::from(path), &digest)?),
            _ => return Err("AI account selection requires its separate custody digest".into()),
        };
        Ok((remaining, selected))
    }

    fn read_pinned(path: &std::path::Path, digest: &str) -> Result<Self, String> {
        validate_digest(digest)?;
        let bytes = super::server::read_selected_file(path, 64 * 1024, true)?;
        if format!("{:x}", Sha256::digest(&bytes)) != digest {
            return Err("AI account selection custody pin changed".into());
        }
        let file: SelectionFile =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid AI account selection")?;
        if file.schema_version != 1
            || file.enrollment.path == file.journal.path
            || (file.enrollment.device, file.enrollment.inode)
                == (file.journal.device, file.journal.inode)
            || file.enrollment.inode == 0
            || file.journal.inode == 0
        {
            return Err("AI account selection requires distinct existing native databases".into());
        }
        for path in [
            &file.configuration,
            &file.enrollment.path,
            &file.journal.path,
        ] {
            super::server::absolute_path(path)?;
        }
        validate_digest(&file.configuration_sha256)?;
        Ok(Self { file })
    }

    pub(crate) fn into_parts(
        self,
    ) -> Result<(StartupConfiguration, DatabaseSelection, DatabaseSelection), AiError> {
        let configuration = StartupConfiguration::read_pinned(
            &self.file.configuration,
            &self.file.configuration_sha256,
        )?;
        Ok((configuration, self.file.enrollment, self.file.journal))
    }
}

fn validate_digest(digest: &str) -> Result<(), String> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("AI account selection requires a lowercase SHA-256 custody digest".into());
    }
    Ok(())
}
