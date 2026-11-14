//! Explicit cached-provider startup selection. Startup performs no enrollment,
//! grant or refresh; schema 2 may select an owner-only HomeBox credential file,
//! the Editors approved to request one explicit refresh and, separately, whether
//! those Editors may recheck a quarantined source.
use super::{Failure, ServerLease};
use crate::{
    access as a,
    app::{Core, Store},
    config::{
        providers::{
            homebox::TrustedHomeBoxSource, network::NetworkSettings, network_host::NetworkBinding,
            registry::ProviderRegistry,
        },
        server::{ServerConfig, absolute_path, read_selected_file},
    },
    http::{Host, PinnedHomeBoxFileBinding, providers::homebox_refresh::HomeBoxRefreshBinding},
    providers::{homebox::read as h, network as n},
    storage as s,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_SOURCES: usize = 8;
const MAX_CREDENTIAL_BYTES: u64 = 8192;
const MAX_REFRESH_EDITORS: usize = 8;
fn unavailable() -> Failure {
    "Selected cached-provider profile unavailable".into()
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
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
                    if path.is_some() {
                        return Err("Repeated provider profile".into());
                    }
                    path = Some(PathBuf::from(
                        args.next().ok_or("Missing provider profile")?,
                    ));
                }
                "--provider-reads-sha256" => {
                    if hash.is_some() {
                        return Err("Repeated provider profile digest".into());
                    }
                    hash = Some(
                        args.next()
                            .ok_or("Missing provider profile digest")?
                            .clone(),
                    );
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
    /// Owner approvals for Access construction. The same pinned bytes are
    /// captured again by `ProviderReadMounts::prepare` after reopen.
    pub fn lifecycle_policy(&self, config: &ServerConfig) -> Result<a::LifecyclePolicy, Failure> {
        let packet = self.capture(config)?;
        let mut rules = Vec::new();
        for value in &packet.homebox_cached {
            let registration: a::SourceRegistration =
                serde_json::from_value(serde_json::to_value(&value.registration)?)
                    .map_err(|_| unavailable())?;
            let recheck = value
                .revalidate_source
                .then_some(a::LifecycleCapability::RevalidateSource);
            for editor in value.refresh_editors.iter().flatten() {
                for capability in [
                    a::LifecycleCapability::ConfigureSource,
                    a::LifecycleCapability::PublishCache,
                ]
                .into_iter()
                .chain(recheck)
                {
                    rules.push(
                        a::LifecycleRule::new(
                            editor.user_id.clone(),
                            editor.actor_id.clone(),
                            registration.clone(),
                            capability,
                            a::Action::Mutate,
                        )
                        .map_err(|_| unavailable())?,
                    );
                }
            }
        }
        Ok(a::LifecyclePolicy::from_trusted_configuration(rules))
    }
    fn capture(&self, config: &ServerConfig) -> Result<Packet, Failure> {
        let bytes = read_selected_file(&self.path, MAX_BYTES, true).map_err(|_| unavailable())?;
        if format!("{:x}", Sha256::digest(&bytes)) != self.sha256 {
            return Err(unavailable());
        }
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
    /// Schema 2 only: absolute owner-only file holding the exact HomeBox
    /// Authorization header value. Its bytes are never logged or returned.
    #[serde(default)]
    credential_file: Option<PathBuf>,
    /// Schema 2 only: Editors approved to request one explicit refresh.
    #[serde(default)]
    refresh_editors: Option<Vec<RefreshEditor>>,
    /// Schema 2 only, absent by default: the same Editors may recheck this
    /// source once HomeBox access was revoked (RevalidateSource).
    #[serde(default)]
    revalidate_source: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RefreshEditor {
    user_id: a::CanonicalId,
    actor_id: a::CanonicalId,
}
impl HomeBox {
    fn credential(
        &self,
        endpoint: &h::SourceEndpoint,
    ) -> Result<Option<Arc<h::NativeReadCredentialConfig>>, Failure> {
        let Some(path) = &self.credential_file else {
            return Ok(None);
        };
        let mut bytes = zeroize::Zeroizing::new(
            read_selected_file(path, MAX_CREDENTIAL_BYTES, true).map_err(|_| unavailable())?,
        );
        // Tolerate one trailing line ending from an ordinary editor.
        if bytes.ends_with(b"\n") {
            bytes.pop();
            if bytes.ends_with(b"\r") {
                bytes.pop();
            }
        }
        let config = h::NativeReadCredentialConfig::from_trusted_header(endpoint, bytes.to_vec())
            .map_err(|_| unavailable())?;
        Ok(Some(Arc::new(config)))
    }
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
            max_page_size: self.max_page_size,
            max_pages: self.max_pages,
            max_response_bytes: self.max_response_bytes,
            max_generation_bytes: self.max_generation_bytes,
            request_timeout_ms: self.request_timeout_ms,
            generation_timeout_ms: self.generation_timeout_ms,
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
        let extended = self.homebox_cached.iter().any(|v| {
            v.credential_file.is_some() || v.refresh_editors.is_some() || v.revalidate_source
        });
        if !matches!(self.schema_version, 1 | 2)
            || (self.schema_version == 1 && extended)
            || self.homebox_cached.iter().any(|v| {
                v.credential_file
                    .as_deref()
                    .is_some_and(|path| absolute_path(path).is_err())
                    || v.refresh_editors.as_ref().is_some_and(|editors| {
                        editors.is_empty()
                            || editors.len() > MAX_REFRESH_EDITORS
                            || v.credential_file.is_none()
                    })
                    || (v.revalidate_source && v.refresh_editors.is_none())
            })
            || !digest(&self.server_configuration_digest)
            || self.server_configuration_digest != config.state_digest()?
            || self.homebox_cached.len() + self.network_cached.len() > MAX_SOURCES
        {
            return Err(unavailable());
        }
        let registrations = self
            .homebox_cached
            .iter()
            .map(|v| &v.registration)
            .chain(self.network_cached.iter().map(|v| &v.registration));
        let mut partitions = BTreeSet::new();
        for r in registrations {
            if !config.homes.iter().any(|home| {
                home.workspace_id.as_str() == r.workspace_id && home.home_id.as_str() == r.home_id
            }) || !partitions.insert(serde_json::to_string(&r.partition())?)
            {
                return Err(unavailable());
            }
        }
        if self
            .homebox_cached
            .iter()
            .any(|v| v.registration.owner != s::SourceOwner::Homebox)
            || self
                .network_cached
                .iter()
                .any(|v| v.registration.owner != s::SourceOwner::Network)
        {
            return Err(unavailable());
        }
        // Reuse complete shared registration checks, including ordered allowlists.
        ProviderRegistry::from_trusted_configuration(
            self.homebox_cached
                .iter()
                .map(|v| v.registration.clone())
                .chain(self.network_cached.iter().map(|v| v.registration.clone()))
                .collect(),
        )
        .map_err(|_| unavailable())?;
        Ok(())
    }
}

/// Prepared on the same blocking worker as persistent reopen. No principal is
/// issued here. Each actual read still requires original current native grants.
pub struct ProviderReadMounts {
    original: Option<(crate::app::Access, Arc<Mutex<Store>>)>,
    homebox: Vec<TrustedHomeBoxSource>,
    files: Vec<PinnedHomeBoxFileBinding>,
    refresh: Vec<HomeBoxRefreshBinding>,
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
            return Ok(Self {
                original: None,
                homebox: vec![],
                files: vec![],
                refresh: vec![],
                network: vec![],
            });
        };
        lease.check()?;
        let packet = selection.capture(config)?;
        // Require the actual reopened Core's configured summaries, not just JSON.
        for r in packet
            .homebox_cached
            .iter()
            .map(|v| &v.registration)
            .chain(packet.network_cached.iter().map(|v| &v.registration))
        {
            if !core.homes.iter().any(|home| {
                home.scope.workspace_id == r.workspace_id && home.scope.home_id == r.home_id
            }) {
                return Err(unavailable());
            }
        }
        let registry = ProviderRegistry::from_trusted_configuration(
            packet
                .homebox_cached
                .iter()
                .map(|v| v.registration.clone())
                .chain(packet.network_cached.iter().map(|v| v.registration.clone()))
                .collect(),
        )
        .map_err(|_| unavailable())?;
        let (mut homebox, mut files, mut refresh) = (Vec::new(), Vec::new(), Vec::new());
        for value in packet.homebox_cached {
            let source = TrustedHomeBoxSource::new_stock(
                &value.origin,
                value.registration.clone(),
                value.limits.native(),
                None,
            )?;
            if let Some(credentials) = value.credential(&source.endpoint()?)? {
                let shared = Arc::new(source.clone());
                files.push(PinnedHomeBoxFileBinding::new(
                    Arc::clone(&shared),
                    Arc::clone(&credentials),
                )?);
                if let Some(editors) = &value.refresh_editors {
                    let configured = registry
                        .sources()
                        .iter()
                        .find(|source| source.registration() == &value.registration)
                        .cloned()
                        .ok_or_else(unavailable)?;
                    let approved = editors.iter().map(|e| e.actor_id.clone()).collect();
                    refresh.push(HomeBoxRefreshBinding::new(
                        shared,
                        configured,
                        credentials,
                        approved,
                        value.revalidate_source,
                    )?);
                }
            }
            homebox.push(source);
        }
        let mut network = Vec::new();
        for value in packet.network_cached {
            let configured = registry
                .sources()
                .iter()
                .find(|source| source.registration() == &value.registration)
                .cloned()
                .ok_or_else(unavailable)?;
            if value.private_directory != config.data_directory.join("provider-cache") {
                return Err(unavailable());
            }
            let settings = NetworkSettings::new(
                configured,
                &value.origin,
                value.review,
                value.limits,
                value.connect_timeout_ms,
                value.idle_timeout_ms,
                value.stale_after_ms,
                &value.private_directory,
            )?
            .for_existing_cached_storage();
            network.push(NetworkBinding::from_trusted_configuration(
                core,
                settings,
                value.entities,
            )?);
        }
        Ok(Self {
            original: Some((core.access.clone(), core.store.clone())),
            homebox,
            files,
            refresh,
            network,
        })
    }
    pub fn apply(self, host: Host) -> Result<Host, Failure> {
        let Some((access, store)) = self.original else {
            return Ok(host);
        };
        {
            let core = host.core.try_lock().map_err(|_| unavailable())?;
            if !Arc::ptr_eq(&access, &core.access) || !Arc::ptr_eq(&store, &core.store) {
                return Err(unavailable());
            }
        }
        Ok(host
            .with_cached_homebox_sources(self.homebox)?
            .with_pinned_homebox_files(self.files)?
            .with_homebox_refresh(self.refresh)?
            .with_network_bindings(self.network)?)
    }
}

#[cfg(test)]
mod tests;
