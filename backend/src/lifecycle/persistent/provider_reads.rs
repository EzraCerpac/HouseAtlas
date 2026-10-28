//! Explicit cached-provider startup selection. No enrollment, grants or refresh.
use super::{Failure, ServerLease};
use crate::{
    access as a,
    app::{Core, Store},
    config::{
        providers::{
            homebox::TrustedHomeBoxSource,
            network::NetworkSettings,
            network_host::NetworkBinding,
            registry::ProviderRegistry,
        },
        server::{ServerConfig, absolute_path, read_selected_file},
    },
    http::Host,
    providers::{homebox::read as h, network as n},
    storage as s,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, path::PathBuf, sync::{Arc, Mutex}};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_SOURCES: usize = 8;
fn unavailable() -> Failure { "Selected cached-provider profile unavailable".into() }
fn digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Explicit CLI selection; parsing does no I/O. No default profile is searched.
pub struct ProviderReadSelection {
    path: PathBuf,
    sha256: String,
}
impl ProviderReadSelection {
    pub fn from_arguments(args: &[String]) -> Result<(Vec<String>, Option<Self>), String> {
        let mut remaining = Vec::new();
        let (mut path, mut hash) = (None, None);
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--provider-reads-profile" => {
                    if path.is_some() { return Err("Repeated provider profile".into()); }
                    path = Some(PathBuf::from(args.next().ok_or("Missing provider profile")?));
                }
                "--provider-reads-sha256" => {
                    if hash.is_some() { return Err("Repeated provider profile digest".into()); }
                    hash = Some(args.next().ok_or("Missing provider profile digest")?.clone());
                }
                _ => remaining.push(arg.clone()),
            }
        }
        match (path, hash) {
            (None, None) => Ok((remaining, None)),
            (Some(path), Some(sha256)) if digest(&sha256) => {
                absolute_path(&path)?;
                Ok((remaining, Some(Self { path, sha256 })))
            }
            _ => Err("Provider profile requires an exact path and SHA256".into()),
        }
    }
    fn capture(self, config: &ServerConfig) -> Result<Packet, Failure> {
        let bytes = read_selected_file(&self.path, MAX_BYTES, true).map_err(|_| unavailable())?;
        if format!("{:x}", Sha256::digest(&bytes)) != self.sha256 { return Err(unavailable()); }
        let packet: Packet = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
        packet.validate(config)?;
        Ok(packet)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Packet {
    schema_version: u8,
    server_configuration_digest: String,
    homebox_cached: Vec<HomeBox>,
    network_cached: Vec<Network>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HomeBox {
    registration: s::SourceRegistration,
    origin: String,
    limits: HomeBoxLimits,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HomeBoxLimits {
    max_page_size: usize,
    max_pages: usize,
    max_response_bytes: usize,
    max_generation_bytes: usize,
    request_timeout_ms: u64,
    generation_timeout_ms: u64,
}
impl HomeBoxLimits {
    fn native(&self) -> h::Limits {
        h::Limits {
            max_page_size: self.max_page_size, max_pages: self.max_pages,
            max_response_bytes: self.max_response_bytes, max_generation_bytes: self.max_generation_bytes,
            request_timeout_ms: self.request_timeout_ms, generation_timeout_ms: self.generation_timeout_ms,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Network {
    registration: s::SourceRegistration,
    origin: String,
    review: n::LinkReview,
    limits: n::Limits,
    connect_timeout_ms: u64,
    idle_timeout_ms: u64,
    stale_after_ms: i64,
    private_directory: PathBuf,
    entities: Vec<a::SourceRef>,
}
impl Packet {
    fn validate(&self, config: &ServerConfig) -> Result<(), Failure> {
        if self.schema_version != 1 || !digest(&self.server_configuration_digest)
            || self.server_configuration_digest != config.state_digest()?
            || self.homebox_cached.len() + self.network_cached.len() > MAX_SOURCES {
            return Err(unavailable());
        }
        let registrations = self.homebox_cached.iter().map(|v| &v.registration)
            .chain(self.network_cached.iter().map(|v| &v.registration));
        let mut partitions = BTreeSet::new();
        for r in registrations {
            if !config.homes.iter().any(|home| home.workspace_id.as_str() == r.workspace_id
                && home.home_id.as_str() == r.home_id)
                || !partitions.insert(serde_json::to_string(&r.partition())?) {
                return Err(unavailable());
            }
        }
        if self.homebox_cached.iter().any(|v| v.registration.owner != s::SourceOwner::Homebox)
            || self.network_cached.iter().any(|v| v.registration.owner != s::SourceOwner::Network) {
            return Err(unavailable());
        }
        // Reuse complete shared registration checks, including ordered allowlists.
        ProviderRegistry::from_trusted_configuration(
            self.homebox_cached.iter().map(|v| v.registration.clone())
                .chain(self.network_cached.iter().map(|v| v.registration.clone())).collect(),
        ).map_err(|_| unavailable())?;
        Ok(())
    }
}

/// Prepared on the same blocking worker as persistent reopen. No principal is
/// issued here. Each actual read still requires original current native grants.
pub struct ProviderReadMounts {
    original: Option<(crate::app::Access, Arc<Mutex<Store>>)>,
    homebox: Vec<TrustedHomeBoxSource>,
    network: Vec<NetworkBinding>,
}
impl ProviderReadMounts {
    pub fn prepare(
        config: &ServerConfig,
        core: &Core,
        selection: Option<ProviderReadSelection>,
        lease: &ServerLease,
    ) -> Result<Self, Failure> {
        let Some(selection) = selection else {
            return Ok(Self { original: None, homebox: vec![], network: vec![] });
        };
        lease.check()?;
        let packet = selection.capture(config)?;
        // Require the actual reopened Core's configured summaries, not just JSON.
        for r in packet.homebox_cached.iter().map(|v| &v.registration)
            .chain(packet.network_cached.iter().map(|v| &v.registration)) {
            if !core.homes.iter().any(|home| home.scope.workspace_id == r.workspace_id
                && home.scope.home_id == r.home_id) { return Err(unavailable()); }
        }
        let registry = ProviderRegistry::from_trusted_configuration(
            packet.homebox_cached.iter().map(|v| v.registration.clone())
                .chain(packet.network_cached.iter().map(|v| v.registration.clone())).collect(),
        ).map_err(|_| unavailable())?;
        let mut homebox = Vec::new();
        for value in packet.homebox_cached {
            homebox.push(TrustedHomeBoxSource::new_stock(
                &value.origin, value.registration, value.limits.native(), None,
            )?);
        }
        let mut network = Vec::new();
        for value in packet.network_cached {
            let configured = registry.sources().iter().find(|source| source.registration() == &value.registration)
                .cloned().ok_or_else(unavailable)?;
            if value.private_directory != config.data_directory.join("provider-cache") {
                return Err(unavailable());
            }
            let settings = NetworkSettings::new(configured, &value.origin, value.review, value.limits,
                value.connect_timeout_ms, value.idle_timeout_ms, value.stale_after_ms, &value.private_directory)?;
            settings.require_existing_cached_storage()?;
            network.push(NetworkBinding::from_trusted_configuration(core, settings, value.entities)?);
        }
        Ok(Self { original: Some((core.access.clone(), core.store.clone())), homebox, network })
    }
    pub fn apply(self, host: Host) -> Result<Host, Failure> {
        let Some((access, store)) = self.original else { return Ok(host); };
        {
            let core = host.core.try_lock().map_err(|_| unavailable())?;
            if !Arc::ptr_eq(&access, &core.access) || !Arc::ptr_eq(&store, &core.store) {
                return Err(unavailable());
            }
        }
        Ok(host.with_cached_homebox_sources(self.homebox)?.with_network_bindings(self.network)?)
    }
}

#[cfg(test)]
mod tests;
