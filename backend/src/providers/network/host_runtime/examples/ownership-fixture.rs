//! Shared setup only for the two explicitly named local ownership examples.
use houseatlas_backend::{
    config::providers::{network::NetworkSettings, registry::ProviderRegistry},
    providers::network as n,
    storage as s,
};
use sha2::{Digest, Sha256};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};
pub type Check<T> = Result<T, Box<dyn std::error::Error>>;
pub struct Fixture {
    _directory: tempfile::TempDir,
    pub root: PathBuf,
    pub source: n::SourceRegistration,
    pub settings: NetworkSettings,
    pub sidecar_path: PathBuf,
}
pub fn source() -> Check<n::SourceRegistration> {
    Ok(serde_json::from_str(
        r#"{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002","sourceInstanceId":"00000000-0000-4000-8000-000000000012","collectionId":"inventory","owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]}"#,
    )?)
}
impl Fixture {
    pub fn new(prefix: &'static str) -> Check<Self> {
        let directory = tempfile::Builder::new()
            .prefix(prefix)
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir()?;
        let root = std::fs::canonicalize(directory.path())?;
        let source = source()?;
        let registration: s::SourceRegistration =
            serde_json::from_value(serde_json::to_value(&source)?)?;
        let registry = ProviderRegistry::from_trusted_configuration(vec![registration])?;
        let settings = NetworkSettings::new(
            registry.sources()[0].clone(),
            "https://network-ownership.invalid",
            serde_json::from_slice(include_bytes!(
                "../../../../../../adapters/network/fixtures/link-review.json"
            ))?,
            n::Limits::default(),
            2000,
            2000,
            300_000,
            &root,
        )?;
        let sidecar_path = root.join(format!(
            "network-{:x}.sqlite",
            Sha256::digest(n::partition_key(&source.scope)?.as_bytes())
        ));
        Ok(Self {
            _directory: directory,
            root,
            source,
            settings,
            sidecar_path,
        })
    }
    pub fn finish(self) -> Check<()> {
        let path = self.root.clone();
        drop(self);
        if path.exists() {
            return Err("Fresh fixture root was not removed".into());
        }
        Ok(())
    }
}
/// Read-only evidence, never a custody owner. Full keys/body in the projected
/// row and full permanent ID/reservation/catalog tuples are compared.
pub fn inventory(path: &Path) -> Check<serde_json::Value> {
    let mut result = serde_json::Map::new();
    for (database, queries) in [
        (
            path.to_owned(),
            vec![(
                "projected",
                "SELECT json_array(partition_key,generation_id,sha256,body) FROM core_network_generations ORDER BY partition_key,generation_id",
            )],
        ),
        (
            path.with_extension("raw-archive.sqlite"),
            vec![
                (
                    "ids",
                    "SELECT json_array(partition_key,generation_id) FROM network_archive_generation_ids ORDER BY partition_key,generation_id",
                ),
                (
                    "reservations",
                    "SELECT json_array(partition_key,generation_id,reserved_bytes) FROM network_archive_reservations ORDER BY partition_key,generation_id",
                ),
                (
                    "catalog",
                    "SELECT json_array(partition_key,generation_id,body_sha256,projected_receipt_sha256,segment_sha256,segment_name,segment_bytes,header_json) FROM network_archive_catalog ORDER BY partition_key,generation_id",
                ),
            ],
        ),
    ] {
        let mut db = rusqlite::Connection::open_with_flags(
            database,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let tx = db.transaction()?;
        for (name, query) in queries {
            let rows = tx
                .prepare(query)?
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            result.insert(name.into(), serde_json::to_value(rows)?);
        }
        tx.commit()?;
    }
    Ok(serde_json::Value::Object(result))
}
