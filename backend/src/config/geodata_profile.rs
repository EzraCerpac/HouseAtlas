//! Explicit serve-only selection of an already converted full native dataset.
//! The private source policy is custody-pinned; it creates no source grant.
use crate::storage::{
    geodata::GeodataSourcePolicy,
    geodata_policy::{PinnedGeodataSourcePolicy, ReviewedSourceManifest},
};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc};

const MAX_POLICY_BYTES: u64 = 4 * 1024 * 1024;

/// Captured private host configuration, never an HTTP input or environment default.
pub struct ServerGeodataSelection {
    bytes: Vec<u8>,
}

impl ServerGeodataSelection {
    /// Remove only the paired explicit serve options before existing CLI parsing.
    pub fn from_arguments(arguments: &[String]) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let mut path = None;
        let mut digest = None;
        let mut arguments_iter = arguments.iter();
        while let Some(argument) = arguments_iter.next() {
            let slot = match argument.as_str() {
                "--full-geodata-source-policy" => Some(&mut path),
                "--full-geodata-source-policy-sha256" => Some(&mut digest),
                _ => None,
            };
            if let Some(slot) = slot {
                if arguments.first().map(String::as_str) != Some("serve") || slot.is_some() {
                    return Err(
                        "Full geodata selection requires unique explicit serve options".into(),
                    );
                }
                *slot = Some(
                    arguments_iter
                        .next()
                        .filter(|value| !value.starts_with("--"))
                        .ok_or("Missing full geodata selection value")?
                        .clone(),
                );
            } else {
                remaining.push(argument.clone());
            }
        }
        let selected = match (path, digest) {
            (None, None) => None,
            (Some(path), Some(digest)) => {
                if digest.len() != 64
                    || !digest
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err(
                        "Full geodata selection requires a lowercase SHA-256 custody digest".into(),
                    );
                }
                let bytes =
                    super::server::read_selected_file(Path::new(&path), MAX_POLICY_BYTES, true)?;
                if format!("{:x}", Sha256::digest(&bytes)) != digest {
                    return Err("Full geodata source policy custody pin changed".into());
                }
                Some(Self { bytes })
            }
            _ => {
                return Err(
                    "Full geodata source policy requires its separate custody digest".into(),
                );
            }
        };
        Ok((remaining, selected))
    }

    /// Bind the captured policy to a home in the actual selected server config.
    /// Policy validation and database qualification remain independent checks.
    pub fn into_policy(
        self,
        config: &super::server::ServerConfig,
    ) -> Result<Arc<dyn GeodataSourcePolicy>, String> {
        config.validate()?;
        let value = crate::contracts::v2::parse_value(&self.bytes)
            .map_err(|_| "Invalid private full geodata source policy")?;
        let manifest: ReviewedSourceManifest = serde_json::from_value(value)
            .map_err(|_| "Invalid private full geodata source policy")?;
        if !config.homes.iter().any(|home| {
            home.workspace_id.as_str() == manifest.scope.workspace_id
                && home.home_id.as_str() == manifest.scope.home_id
        }) {
            return Err("Full geodata policy must select an exact configured home".into());
        }
        let policy = PinnedGeodataSourcePolicy::from_reviewed(manifest)
            .map_err(|_| "Invalid private full geodata source policy")?;
        Ok(Arc::new(policy))
    }
}
