//! Optional display policy for one exact selected Atlas publication.
//! Display membership never changes geometry, containment or native authority.
use super::{
    atlas_scene::ServerAtlasSceneSelection,
    model_overview::{Identity, ServerModelOverviewSelection},
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

pub(crate) const MAX_BYTES: u64 = 32 * 1024;
fn invalid() -> String {
    "Selected Atlas display policy is unavailable or inconsistent".into()
}
fn need(ok: bool) -> Result<(), String> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn text(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.chars().count() <= maximum && !value.chars().any(char::is_control)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Group {
    level_ids: Vec<String>,
    label: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Membership {
    node_index: u64,
    mesh_index: u64,
    primitive_index: u64,
    level_ids: Vec<String>,
    cutaway: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Policy {
    profile: String,
    publication_id: String,
    semantics_sha256: String,
    groups: Vec<Group>,
    memberships: Vec<Membership>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Manifest {
    profile: String,
    workspace_id: String,
    home_id: String,
    display_config: Policy,
}
fn validate(
    bytes: &[u8],
    scene: &Value,
    semantics: &str,
    workspace: &str,
    home: &str,
) -> Result<Manifest, String> {
    need(bytes.len() as u64 <= MAX_BYTES)?;
    let value = crate::contracts::v2::parse_value(bytes).map_err(|_| invalid())?;
    let manifest: Manifest = serde_json::from_value(value).map_err(|_| invalid())?;
    let policy = &manifest.display_config;
    need(
        manifest.profile == "houseatlas.atlas-display-selection.v1"
            && manifest.workspace_id == workspace
            && manifest.home_id == home
            && policy.profile == "houseatlas.atlas-display.v1"
            && scene["publicationId"] == policy.publication_id
            && policy.semantics_sha256 == semantics
            && digest(semantics)
            && policy.groups.len() <= 64
            && policy.memberships.len() <= 20_000,
    )?;
    let levels = scene["levels"].as_array().ok_or_else(invalid)?;
    let bindings = scene["meshBindings"].as_array().ok_or_else(invalid)?;
    let building = |id: &str| {
        levels
            .iter()
            .find(|level| level["levelId"] == id)
            .and_then(|level| level["buildingId"].as_str())
    };
    let mut claimed = BTreeSet::new();
    for group in &policy.groups {
        need(text(&group.label, 128) && group.level_ids.len() >= 2 && group.level_ids.len() <= 64)?;
        let owner = building(&group.level_ids[0]).ok_or_else(invalid)?;
        for id in &group.level_ids {
            need(text(id, 256) && building(id) == Some(owner) && claimed.insert(id))?;
        }
    }
    let mut selectors = BTreeSet::new();
    for member in &policy.memberships {
        need(
            member.node_index <= 1_000_000
                && member.mesh_index <= 1_000_000
                && member.primitive_index <= 1_000_000
                && selectors.insert((member.node_index, member.mesh_index, member.primitive_index))
                && ["level", "preserve"].contains(&member.cutaway.as_str())
                && !member.level_ids.is_empty()
                && member.level_ids.len() <= 64,
        )?;
        let binding = bindings
            .iter()
            .find(|row| {
                row["nodeIndex"] == member.node_index
                    && row["meshIndex"] == member.mesh_index
                    && row["primitiveIndices"].as_array().is_some_and(|indices| {
                        indices
                            .iter()
                            .any(|index| index.as_u64() == Some(member.primitive_index))
                    })
            })
            .ok_or_else(invalid)?;
        need(matches!(
            binding["role"].as_str(),
            Some("structure" | "slab")
        ))?;
        let owner = binding["buildingId"].as_str().ok_or_else(invalid)?;
        let mut unique = BTreeSet::new();
        for id in &member.level_ids {
            need(text(id, 256) && building(id) == Some(owner) && unique.insert(id))?;
        }
    }
    Ok(manifest)
}

pub struct ServerAtlasDisplayPolicySelection {
    path: PathBuf,
    identities: [Identity; 2],
    sha256: String,
    bytes: u64,
    manifest: Manifest,
    selection_revision: String,
}
impl ServerAtlasDisplayPolicySelection {
    pub fn from_arguments(
        args: &[String],
        scene: Option<&ServerAtlasSceneSelection>,
        overview: Option<&ServerModelOverviewSelection>,
    ) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let (mut path, mut sha) = (None, None);
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let slot = match arg.as_str() {
                "--atlas-display-policy" => Some(&mut path),
                "--atlas-display-policy-sha256" => Some(&mut sha),
                _ => None,
            };
            if let Some(slot) = slot {
                need(args.first().map(String::as_str) == Some("serve") && slot.is_none())?;
                *slot = Some(
                    iter.next()
                        .filter(|value| !value.starts_with("--"))
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
        let manifest = validate(
            &bytes,
            &scene.value,
            &scene.semantics_sha256,
            &overview.manifest.scope.workspace_id,
            &overview.manifest.scope.home_id,
        )?;
        let selected = Self {
            path: path.to_owned(),
            identities,
            sha256: sha.into(),
            bytes: bytes.len() as u64,
            manifest,
            selection_revision: scene.revision.clone(),
        };
        selected.read(scene, overview)?;
        Ok(selected)
    }
    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }
    pub(crate) fn bytes(&self) -> u64 {
        self.bytes
    }
    pub(crate) fn read(
        &self,
        scene: &ServerAtlasSceneSelection,
        overview: &ServerModelOverviewSelection,
    ) -> Result<Vec<u8>, String> {
        let manifest = &self.manifest;
        need(
            self.path.parent() == overview.path.parent()
                && manifest.workspace_id == overview.manifest.scope.workspace_id
                && manifest.home_id == overview.manifest.scope.home_id
                && self.selection_revision == scene.revision
                && manifest.display_config.publication_id == overview.manifest.publication_id
                && manifest.display_config.semantics_sha256 == scene.semantics_sha256,
        )?;
        scene.verify(overview)?;
        let check = || {
            need(
                [
                    Identity::capture(self.path.parent().ok_or_else(invalid)?, true)?,
                    Identity::capture(&self.path, false)?,
                ] == self.identities,
            )
        };
        check()?;
        let bytes = super::server::read_selected_file(&self.path, MAX_BYTES, true)?;
        need(bytes.len() as u64 == self.bytes && hash(&bytes) == self.sha256)?;
        check()?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (Value, Value) {
        let scene = json!({"publicationId":"synthetic-publication",
            "levels":[{"levelId":"lower","buildingId":"one"},{"levelId":"upper","buildingId":"one"},
                {"levelId":"other","buildingId":"two"}],
            "meshBindings":[{"nodeIndex":1,"meshIndex":2,"primitiveIndices":[3],"role":"structure","buildingId":"one"}]});
        let manifest = json!({"profile":"houseatlas.atlas-display-selection.v1","workspaceId":"workspace",
            "homeId":"home","displayConfig":{
                "profile":"houseatlas.atlas-display.v1","publicationId":"synthetic-publication",
                "semanticsSha256":"a".repeat(64),"groups":[{"levelIds":["lower","upper"],"label":"Generated group"}],
                "memberships":[{"nodeIndex":1,"meshIndex":2,"primitiveIndex":3,"levelIds":["lower"],"cutaway":"preserve"}]}});
        (scene, manifest)
    }
    fn accepts(scene: &Value, manifest: &Value) -> bool {
        validate(
            &serde_json::to_vec(manifest).unwrap(),
            scene,
            &"a".repeat(64),
            "workspace",
            "home",
        )
        .is_ok()
    }
    #[test]
    fn display_policy_exact_groups_and_memberships() {
        let (scene, manifest) = fixture();
        assert!(accepts(&scene, &manifest));
        for (pointer, value) in [
            ("/displayConfig/groups/0/levelIds/1", json!("other")),
            ("/displayConfig/groups/0/levelIds/1", json!("lower")),
            ("/displayConfig/memberships/0/primitiveIndex", json!(4)),
            ("/displayConfig/memberships/0/levelIds/0", json!("other")),
            ("/displayConfig/memberships/0/cutaway", json!("guessed")),
            ("/homeId", json!("another-home")),
            ("/displayConfig/semanticsSha256", json!("b".repeat(64))),
            ("/displayConfig/publicationId", json!("replacement")),
        ] {
            let mut changed = manifest.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(!accepts(&scene, &changed), "{pointer}");
        }
    }
    #[test]
    fn display_policy_closed_and_bounded() {
        let (scene, mut manifest) = fixture();
        manifest["extra"] = json!(true);
        assert!(!accepts(&scene, &manifest));
        let (_, mut manifest) = fixture();
        manifest["displayConfig"]["groups"][0]["label"] = json!("x".repeat(129));
        assert!(!accepts(&scene, &manifest));
        assert!(
            validate(
                &vec![b' '; MAX_BYTES as usize + 1],
                &scene,
                &"a".repeat(64),
                "workspace",
                "home"
            )
            .is_err()
        );
        assert!(
            validate(
                br#"{"profile":"one","profile":"two"}"#,
                &scene,
                &"a".repeat(64),
                "workspace",
                "home"
            )
            .is_err()
        );
    }
    #[test]
    fn display_policy_options_are_paired_and_serve_only() {
        let args = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
        let unchanged = args(&["serve", "--other", "value"]);
        assert!(
            ServerAtlasDisplayPolicySelection::from_arguments(&unchanged, None, None)
                .is_ok_and(|(remaining, selected)| remaining == unchanged && selected.is_none())
        );
        for values in [
            vec!["serve", "--atlas-display-policy", "/synthetic/policy.json"],
            vec!["serve", "--atlas-display-policy-sha256", "a"],
            vec!["serve", "--atlas-display-policy", "--other"],
            vec!["other", "--atlas-display-policy", "/synthetic/policy.json"],
        ] {
            assert!(
                ServerAtlasDisplayPolicySelection::from_arguments(&args(&values), None, None)
                    .is_err()
            );
        }
    }
}
