//! Read-only owner-operated source validation, not a native import or release.
//! Never reads configuration, databases, sessions, credentials or providers.
use houseatlas_backend::config::{
    atlas_scene::ServerAtlasSceneSelection, model_overview::ServerModelOverviewSelection,
};
use std::{collections::BTreeMap, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut arguments = std::env::args().skip(1);
    let mut values = BTreeMap::new();
    while let Some(key) = arguments.next() {
        if ![
            "--overview-manifest",
            "--overview-manifest-sha256",
            "--atlas-scene-manifest",
            "--atlas-scene-manifest-sha256",
        ]
        .contains(&key.as_str())
        {
            return Err("Expected four explicit publication path/hash options".into());
        }
        let value = arguments.next().ok_or("Missing publication option value")?;
        if values.insert(key, value).is_some() {
            return Err("Duplicate publication option".into());
        }
    }
    let value = |key: &str| {
        values
            .get(key)
            .map(String::as_str)
            .ok_or("All four publication path/hash options are required")
    };
    let overview = ServerModelOverviewSelection::read_pinned(
        Path::new(value("--overview-manifest")?),
        value("--overview-manifest-sha256")?,
    )?;
    let _scene = ServerAtlasSceneSelection::read_pinned(
        Path::new(value("--atlas-scene-manifest")?),
        value("--atlas-scene-manifest-sha256")?,
        &overview,
    )?;
    println!(
        "PASS immutable unified source publication: exact private GLB/companion pins, bounded source identities/references/plans/mesh positions. Source validation only; no native import, reviewed join, current overlay authority, rendering or release."
    );
    Ok(())
}
