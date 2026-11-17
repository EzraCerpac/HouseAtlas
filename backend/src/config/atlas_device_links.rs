//! Private one-time owner review, selected and fenced like Atlas room links.
//! A reviewed identity pair grants neither source access nor physical placement.
use super::model_overview::Identity;
use crate::providers::network::SourceScope;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 1024 * 1024;
fn invalid() -> String {
    "Selected Atlas device links are unavailable or inconsistent".into()
}
fn need(ok: bool) -> Result<(), String> {
    if ok { Ok(()) } else { Err(invalid()) }
}
pub(crate) fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn text(s: &str) -> bool {
    !s.trim().is_empty() && s.chars().count() <= 4096
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|v| v.to_string() == s)
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DeviceSource {
    #[serde(flatten)]
    pub scope: SourceScope,
    pub source_kind: String,
    pub external_id: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DeviceLink {
    pub scene_original_sha256: String,
    pub documentary_device_id: String,
    pub source: DeviceSource,
    pub review_status: String,
    pub reviewer: Option<String>,
    pub reviewed_at: Option<String>,
    pub evidence_reference: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Manifest {
    pub profile: String,
    pub links: Vec<DeviceLink>,
}
impl Manifest {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, String> {
        need(bytes.len() as u64 <= MAX_BYTES)?;
        let value = crate::contracts::v2::parse_value(bytes).map_err(|_| invalid())?;
        need(value["links"].as_array().is_some_and(|links| {
            links
                .iter()
                .all(|link| link.get("reviewer").is_some() && link.get("reviewedAt").is_some())
        }))?;
        let m: Self = serde_json::from_value(value).map_err(|_| invalid())?;
        need(m.profile == "houseatlas.atlas-device-links.v1" && m.links.len() <= 512)?;
        for link in &m.links {
            let s = &link.source;
            need(
                digest(&link.scene_original_sha256)
                    && text(&link.documentary_device_id)
                    && uuid(&s.scope.workspace_id)
                    && uuid(&s.scope.home_id)
                    && uuid(&s.scope.source_instance_id)
                    && text(&s.scope.collection_id)
                    && s.source_kind == "network-device"
                    && text(&s.external_id)
                    && text(&link.evidence_reference)
                    && ["unreviewed", "accepted", "rejected", "retired"]
                        .contains(&link.review_status.as_str()),
            )?;
            if link.review_status == "unreviewed" {
                need(link.reviewer.is_none() && link.reviewed_at.is_none())?;
            } else {
                need(
                    link.reviewer.as_deref().is_some_and(text)
                        && link
                            .reviewed_at
                            .as_deref()
                            .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok()),
                )?;
            }
        }
        Ok(m)
    }
}
pub struct ServerAtlasDeviceLinksSelection {
    path: PathBuf,
    identities: [Identity; 2],
    sha256: String,
}
impl ServerAtlasDeviceLinksSelection {
    pub fn from_arguments(args: &[String]) -> Result<(Vec<String>, Option<Self>), String> {
        let (mut path, mut sha) = (None, None);
        let mut rest = Vec::new();
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let slot = match arg.as_str() {
                "--atlas-device-links-manifest" => Some(&mut path),
                "--atlas-device-links-manifest-sha256" => Some(&mut sha),
                _ => None,
            };
            if let Some(slot) = slot {
                need(args.first().map(String::as_str) == Some("serve") && slot.is_none())?;
                *slot = Some(
                    iter.next()
                        .filter(|v| !v.starts_with("--"))
                        .ok_or_else(invalid)?
                        .clone(),
                );
            } else {
                rest.push(arg.clone());
            }
        }
        let selected = match (path, sha) {
            (None, None) => None,
            (Some(path), Some(sha)) => Some(Self::read_pinned(Path::new(&path), &sha)?),
            _ => return Err(invalid()),
        };
        Ok((rest, selected))
    }
    pub fn read_pinned(path: &Path, sha: &str) -> Result<Self, String> {
        need(path.is_absolute() && digest(sha))?;
        let selected = Self {
            path: path.into(),
            identities: Self::identities(path)?,
            sha256: sha.into(),
        };
        selected.read()?;
        Ok(selected)
    }
    fn identities(path: &Path) -> Result<[Identity; 2], String> {
        Ok([
            Identity::capture(path.parent().ok_or_else(invalid)?, true)?,
            Identity::capture(path, false)?,
        ])
    }
    pub(crate) fn read(&self) -> Result<Manifest, String> {
        need(Self::identities(&self.path)? == self.identities)?;
        let bytes = super::server::read_selected_file(&self.path, MAX_BYTES, true)?;
        need(format!("{:x}", Sha256::digest(&bytes)) == self.sha256)?;
        let manifest = Manifest::parse(&bytes)?;
        need(Self::identities(&self.path)? == self.identities)?;
        Ok(manifest)
    }
}
