//! Independently owner-reviewed documentary room links for one selected publication.
//! These bytes confer no native identity, source freshness, permission or grant.
use super::{
    atlas_scene::ServerAtlasSceneSelection,
    model_overview::{Identity, ServerModelOverviewSelection},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};
const MAX_BYTES: u64 = 1024 * 1024;
fn invalid() -> String {
    "Selected Atlas room links are unavailable or inconsistent".into()
}
fn need(ok: bool) -> Result<(), String> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|u| u.to_string() == s)
}
fn opaque(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Link {
    room_id: String,
    native_place_id: String,
    package_place_key: String,
    package_place_uuid: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Manifest {
    profile: String,
    workspace_id: String,
    home_id: String,
    publication_id: String,
    semantics_sha256: String,
    links: Vec<Link>,
}
pub struct ServerAtlasRoomLinksSelection {
    path: PathBuf,
    identities: [Identity; 2],
    sha256: String,
    manifest: Manifest,
    selection_revision: String,
}
impl ServerAtlasRoomLinksSelection {
    pub fn from_arguments(
        args: &[String],
        scene: Option<&ServerAtlasSceneSelection>,
        overview: Option<&ServerModelOverviewSelection>,
    ) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let mut path = None;
        let mut sha = None;
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let slot = match arg.as_str() {
                "--atlas-room-links-manifest" => Some(&mut path),
                "--atlas-room-links-manifest-sha256" => Some(&mut sha),
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
                remaining.push(arg.clone());
            }
        }
        let selected = match (path, sha) {
            (None, None) => None,
            (Some(path), Some(sha)) => Some(Self::read_pinned(
                Path::new(&path),
                &sha,
                scene.ok_or_else(invalid)?,
                overview.ok_or_else(invalid)?,
            )?),
            _ => return Err(invalid()),
        };
        Ok((remaining, selected))
    }
    pub fn read_pinned(
        path: &Path,
        sha: &str,
        scene: &ServerAtlasSceneSelection,
        overview: &ServerModelOverviewSelection,
    ) -> Result<Self, String> {
        need(path.is_absolute() && path.parent() == overview.path.parent() && digest(sha))?;
        scene.verify(overview)?;
        let identities = [
            Identity::capture(path.parent().ok_or_else(invalid)?, true)?,
            Identity::capture(path, false)?,
        ];
        let bytes = super::server::read_selected_file(path, MAX_BYTES, true)?;
        need(hash(&bytes) == sha)?;
        let value = crate::contracts::v2::parse_value(&bytes).map_err(|_| invalid())?;
        let manifest: Manifest = serde_json::from_value(value).map_err(|_| invalid())?;
        need(
            manifest.profile == "houseatlas.unified-atlas-room-links.v1"
                && uuid(&manifest.workspace_id)
                && uuid(&manifest.home_id)
                && uuid(&manifest.publication_id)
                && digest(&manifest.semantics_sha256)
                && manifest.links.len() <= 2048,
        )?;
        let mut rooms = BTreeSet::new();
        let mut triples = BTreeSet::new();
        for link in &manifest.links {
            need(
                opaque(&link.room_id)
                    && opaque(&link.package_place_key)
                    && uuid(&link.native_place_id)
                    && uuid(&link.package_place_uuid)
                    && rooms.insert(&link.room_id)
                    && triples.insert((
                        &link.native_place_id,
                        &link.package_place_key,
                        &link.package_place_uuid,
                    )),
            )?;
        }
        let selected = Self {
            path: path.to_owned(),
            identities,
            sha256: sha.into(),
            manifest,
            selection_revision: scene.revision.clone(),
        };
        selected.read(scene, overview)?;
        Ok(selected)
    }
    fn matches(
        &self,
        scene: &ServerAtlasSceneSelection,
        overview: &ServerModelOverviewSelection,
    ) -> Result<(), String> {
        let m = &self.manifest;
        need(
            self.path.parent() == overview.path.parent()
                && scene.revision == self.selection_revision
                && m.workspace_id == overview.manifest.scope.workspace_id
                && m.home_id == overview.manifest.scope.home_id
                && m.publication_id == overview.manifest.publication_id
                && m.semantics_sha256 == scene.semantics_sha256,
        )?;
        let rooms = scene.value["rooms"].as_array().ok_or_else(invalid)?;
        for link in &m.links {
            need(rooms.iter().any(|r| {
                r["roomId"] == link.room_id && r["nativePlaceId"] == link.native_place_id
            }))?;
        }
        Ok(())
    }
    pub(crate) fn read(
        &self,
        scene: &ServerAtlasSceneSelection,
        overview: &ServerModelOverviewSelection,
    ) -> Result<Vec<u8>, String> {
        self.matches(scene, overview)?;
        scene.verify(overview)?;
        overview.read_original()?;
        let check = || -> Result<(), String> {
            need(
                [
                    Identity::capture(self.path.parent().ok_or_else(invalid)?, true)?,
                    Identity::capture(&self.path, false)?,
                ] == self.identities,
            )
        };
        check()?;
        let bytes = super::server::read_selected_file(&self.path, MAX_BYTES, true)?;
        need(hash(&bytes) == self.sha256)?;
        check()?;
        Ok(bytes)
    }
}
