//! Explicit disposable loopback settings; no deployment settings are inferred.
pub mod providers {
    pub mod homebox;
    pub mod network;
    pub mod network_host;
    pub mod quantity_installation;
    pub mod registry;
}
pub mod provider_dispatch;
pub mod recovery;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FixtureProfile {
    Standard,
    OpaqueCachedHomebox,
    GeometryMetadata,
    NativeMediaArchive,
}
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
};
pub struct Config {
    pub directory: PathBuf,
    pub frontend: PathBuf,
    pub cert: PathBuf,
    pub key: PathBuf,
    pub listen: SocketAddr,
    pub fixture_profile: FixtureProfile,
}
impl Config {
    pub fn from_args() -> Result<Self, String> {
        let mut args = std::env::args().skip(1);
        let mut values = std::collections::BTreeMap::new();
        while let Some(name) = args.next() {
            if ![
                "--disposable-dir",
                "--frontend-dist",
                "--tls-cert",
                "--tls-key",
                "--port",
                "--fixture-profile",
            ]
            .contains(&name.as_str())
            {
                return Err("Unsupported option".into());
            }
            if values
                .insert(name, args.next().ok_or("Missing option value")?)
                .is_some()
            {
                return Err("Repeated option".into());
            }
        }
        let path = |key: &str| -> Result<PathBuf, String> {
            Ok(PathBuf::from(
                values.get(key).ok_or(format!("Required option {key}"))?,
            ))
        };
        let directory = path("--disposable-dir")?;
        if !directory.is_absolute()
            || directory.exists()
            || !directory.starts_with("/tmp")
            || directory
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("Disposable directory must be a new absolute /tmp path".into());
        }
        let port = values
            .get("--port")
            .map_or(Ok(0), |s| s.parse::<u16>())
            .map_err(|_| "Invalid port")?;
        let fixture_profile = match values.get("--fixture-profile").map(String::as_str) {
            None | Some("standard") => FixtureProfile::Standard,
            Some("opaque-cached-homebox") => FixtureProfile::OpaqueCachedHomebox,
            Some("geometry-metadata") => FixtureProfile::GeometryMetadata,
            Some("native-media-archive") => FixtureProfile::NativeMediaArchive,
            _ => return Err("Unsupported disposable fixture profile".into()),
        };
        Ok(Self {
            directory,
            frontend: path("--frontend-dist")?,
            cert: path("--tls-cert")?,
            key: path("--tls-key")?,
            listen: SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            fixture_profile,
        })
    }
}
