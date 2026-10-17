//! Immutable owner-selected provisional GLB publication; no native records.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

const MAX_MANIFEST: u64 = 128 * 1024;
const MAX_GLB: u64 = 32 * 1024 * 1024;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Scope {
    pub workspace_id: String,
    pub home_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Frame {
    linear_unit: String,
    up_axis: String,
    placement: String,
    physical_registration: (),
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Component {
    id: String,
    kind: String,
    label: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Original {
    file: String,
    pub content_type: String,
    pub sha256: String,
    pub bytes: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Publication {
    profile: String,
    pub scope: Scope,
    pub publication_id: String,
    pub label: String,
    pub qualification: String,
    pub frame: Frame,
    pub components: Vec<Component>,
    pub source_note: Option<String>,
    pub original: Original,
}
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Identity {
    dev: u64,
    ino: u64,
    mode: u32,
    uid: u32,
    links: u64,
    len: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}
impl Identity {
    pub(crate) fn capture(path: &Path, directory: bool) -> Result<Self, String> {
        let m = fs::symlink_metadata(path).map_err(|_| "Overview file unavailable")?;
        if m.file_type().is_symlink()
            || m.uid() != rustix::process::geteuid().as_raw()
            || m.mode() & 0o7777 != if directory { 0o700 } else { 0o600 }
            || if directory {
                !m.is_dir()
            } else {
                !m.is_file() || m.nlink() != 1
            }
            || fs::canonicalize(path).map_err(|_| "Overview path unavailable")? != path
        {
            return Err("Overview owner, mode, type or canonical path invalid".into());
        }
        Ok(Self {
            dev: m.dev(),
            ino: m.ino(),
            mode: m.mode(),
            uid: m.uid(),
            links: m.nlink(),
            len: m.len(),
            modified: (m.mtime(), m.mtime_nsec()),
            changed: (m.ctime(), m.ctime_nsec()),
        })
    }
}
pub struct ServerModelOverviewSelection {
    pub(crate) path: PathBuf,
    identities: [Identity; 3],
    pub(crate) manifest: Publication,
    pub(crate) manifest_sha256: String,
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn label(value: &str) -> bool {
    (1..=128).contains(&value.chars().count()) && !value.chars().any(char::is_control)
}
impl ServerModelOverviewSelection {
    pub fn from_arguments(args: &[String]) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let mut path = None;
        let mut hash = None;
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let slot = match arg.as_str() {
                "--model-overview-manifest" => Some(&mut path),
                "--model-overview-manifest-sha256" => Some(&mut hash),
                _ => None,
            };
            if let Some(slot) = slot {
                if args.first().map(String::as_str) != Some("serve") || slot.is_some() {
                    return Err("Overview requires unique paired serve options".into());
                }
                *slot = Some(
                    iter.next()
                        .filter(|v| !v.starts_with("--"))
                        .ok_or("Missing overview option value")?
                        .clone(),
                );
            } else {
                remaining.push(arg.clone());
            }
        }
        let selected = match (path, hash) {
            (None, None) => None,
            (Some(p), Some(h)) => Some(Self::read_pinned(Path::new(&p), &h)?),
            _ => return Err("Overview requires paired manifest and SHA-256".into()),
        };
        Ok((remaining, selected))
    }
    pub fn read_pinned(path: &Path, hash: &str) -> Result<Self, String> {
        if !path.is_absolute()
            || path.file_name().and_then(|v| v.to_str()) != Some("publication.json")
            || !digest(hash)
        {
            return Err("Invalid overview manifest selection".into());
        }
        let parent = path.parent().ok_or("Missing overview directory")?;
        let identities = [
            Identity::capture(parent, true)?,
            Identity::capture(path, false)?,
            Identity::capture(&parent.join("overview.glb"), false)?,
        ];
        let bytes = super::server::read_selected_file(path, MAX_MANIFEST, true)?;
        if sha(&bytes) != hash {
            return Err("Overview manifest digest changed".into());
        }
        let value =
            crate::contracts::v2::parse_value(&bytes).map_err(|_| "Invalid overview JSON")?;
        if value.get("sourceNote").is_none() {
            return Err("Overview sourceNote must be explicit".into());
        }
        let manifest: Publication =
            serde_json::from_value(value).map_err(|_| "Invalid overview manifest")?;
        let mut ids = BTreeSet::new();
        if manifest.profile != "houseatlas.model-overview-publication.v1"
            || manifest.qualification != "provisional-overview"
            || uuid::Uuid::parse_str(&manifest.publication_id)
                .map(|id| id.to_string() != manifest.publication_id)
                .unwrap_or(true)
            || !label(&manifest.label)
            || manifest.frame.linear_unit != "m"
            || manifest.frame.up_axis != "Y"
            || manifest.frame.placement != "baked-in-asset"
            || manifest.components.is_empty()
            || manifest.components.len() > 256
            || manifest.components.iter().any(|c| {
                !label(&c.label)
                    || c.id.is_empty()
                    || c.id.len() > 128
                    || !c
                        .id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                    || !ids.insert(&c.id)
                    || !["building", "plot", "context"].contains(&c.kind.as_str())
            })
            || manifest.source_note.as_ref().is_some_and(|v| {
                v.chars().count() > 2048 || v.chars().any(char::is_control) || v.contains("://")
            })
            || manifest.original.file != "overview.glb"
            || manifest.original.content_type != "model/gltf-binary"
            || !digest(&manifest.original.sha256)
            || manifest.original.bytes > MAX_GLB
        {
            return Err("Unsupported overview publication".into());
        }
        let selected = Self {
            path: path.to_owned(),
            identities,
            manifest,
            manifest_sha256: hash.into(),
        };
        let original = selected.read_original()?;
        validate_glb(&original)?;
        Ok(selected)
    }
    pub fn validate_config(&self, config: &super::server::ServerConfig) -> Result<(), String> {
        config.validate()?;
        let parent = self.path.parent().ok_or("Missing overview directory")?;
        if parent.starts_with(&config.data_directory)
            || config.data_directory.starts_with(parent)
            || !config.homes.iter().any(|h| {
                h.workspace_id.as_str() == self.manifest.scope.workspace_id
                    && h.home_id.as_str() == self.manifest.scope.home_id
            })
        {
            return Err(
                "Overview must be outside native state and select an exact configured home".into(),
            );
        }
        Ok(())
    }
    pub fn matches(&self, scope: &crate::domain::Scope) -> bool {
        self.manifest.scope.workspace_id == scope.workspace_id
            && self.manifest.scope.home_id == scope.home_id
    }
    pub fn read_original(&self) -> Result<Vec<u8>, String> {
        let parent = self.path.parent().ok_or("Missing overview directory")?;
        let check = || -> Result<(), String> {
            let current = [
                Identity::capture(parent, true)?,
                Identity::capture(&self.path, false)?,
                Identity::capture(&parent.join("overview.glb"), false)?,
            ];
            if current != self.identities {
                return Err("Overview selection changed".into());
            }
            Ok(())
        };
        check()?;
        if sha(&super::server::read_selected_file(
            &self.path,
            MAX_MANIFEST,
            true,
        )?) != self.manifest_sha256
        {
            return Err("Overview manifest changed".into());
        }
        let bytes = super::server::read_selected_file(&parent.join("overview.glb"), MAX_GLB, true)?;
        if bytes.len() as u64 != self.manifest.original.bytes
            || sha(&bytes) != self.manifest.original.sha256
        {
            return Err("Overview original changed".into());
        }
        check()?;
        Ok(bytes)
    }
}
fn validate_glb(bytes: &[u8]) -> Result<(), String> {
    let invalid = || "Unsupported self-contained GLB v2".to_owned();
    let word = |offset: usize| -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            bytes
                .get(offset..offset + 4)
                .ok_or_else(invalid)?
                .try_into()
                .map_err(|_| invalid())?,
        ))
    };
    if bytes.len() < 20
        || bytes.get(..4) != Some(b"glTF")
        || word(4)? != 2
        || word(8)? as usize != bytes.len()
    {
        return Err(invalid());
    }
    let json_len = word(12)? as usize;
    if json_len > 8 * 1024 * 1024 || !json_len.is_multiple_of(4) || word(16)? != 0x4e4f534a {
        return Err(invalid());
    }
    let json_end = 20usize.checked_add(json_len).ok_or_else(invalid)?;
    let json = crate::contracts::v2::parse_value(bytes.get(20..json_end).ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    if !json.is_object()
        || json
            .pointer("/asset/version")
            .and_then(serde_json::Value::as_str)
            != Some("2.0")
        || json["asset"].get("minVersion").is_some_and(|v| v != "2.0")
    {
        return Err(invalid());
    }
    fn safe(v: &serde_json::Value) -> bool {
        match v {
            serde_json::Value::Object(o) => o.iter().all(|(k, v)| {
                ![
                    "uri",
                    "extensions",
                    "extensionsUsed",
                    "extensionsRequired",
                    "animations",
                    "skins",
                ]
                .contains(&k.as_str())
                    && safe(v)
            }),
            serde_json::Value::Array(a) => a.iter().all(safe),
            _ => true,
        }
    }
    if !safe(&json) {
        return Err(invalid());
    }
    let declared = match json.get("buffers") {
        None => None,
        Some(serde_json::Value::Array(buffers)) if buffers.is_empty() => None,
        Some(serde_json::Value::Array(buffers)) if buffers.len() == 1 => {
            let length = buffers[0]
                .get("byteLength")
                .and_then(serde_json::Value::as_u64)
                .filter(|length| *length > 0 && *length <= MAX_GLB)
                .ok_or_else(invalid)?;
            Some(usize::try_from(length).map_err(|_| invalid())?)
        }
        _ => return Err(invalid()),
    };
    let binary = if json_end < bytes.len() {
        let bin_len = word(json_end)? as usize;
        let bin_start = json_end.checked_add(8).ok_or_else(invalid)?;
        if !bin_len.is_multiple_of(4)
            || word(json_end + 4)? != 0x004e4942
            || bin_start.checked_add(bin_len) != Some(bytes.len())
        {
            return Err(invalid());
        }
        Some(bytes.get(bin_start..).ok_or_else(invalid)?)
    } else {
        None
    };
    match (declared, binary) {
        (None, None) => (),
        (Some(length), Some(binary))
            if binary.len() >= length
                && binary.len() - length <= 3
                && binary[length..].iter().all(|byte| *byte == 0) => {}
        _ => return Err(invalid()),
    }
    if let Some(views) = json.get("bufferViews") {
        let length = declared.ok_or_else(invalid)? as u64;
        for view in views.as_array().ok_or_else(invalid)? {
            if view.get("buffer").and_then(serde_json::Value::as_u64) != Some(0) {
                return Err(invalid());
            }
            let offset = match view.get("byteOffset") {
                None => 0,
                Some(value) => value.as_u64().ok_or_else(invalid)?,
            };
            let size = view
                .get("byteLength")
                .and_then(serde_json::Value::as_u64)
                .filter(|size| *size > 0)
                .ok_or_else(invalid)?;
            if offset.checked_add(size).is_none_or(|end| end > length) {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
