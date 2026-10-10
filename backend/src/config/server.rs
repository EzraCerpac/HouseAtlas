//! Explicit persistent startup settings. No fixture, provider or account is inferred.
use crate::{access, domain, http::McpCommandProfile};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::File,
    io::Read,
    net::SocketAddr,
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerConfig {
    pub schema_version: u32,
    pub deployment_id: access::CanonicalId,
    pub data_directory: PathBuf,
    pub log_directory: PathBuf,
    pub frontend_directory: PathBuf,
    pub tls_certificate: PathBuf,
    pub tls_private_key: PathBuf,
    pub listen: SocketAddr,
    pub origin: String,
    pub homes: Vec<ServerHome>,
    pub mcp_commands: ServerCommands,
    #[serde(default, skip_serializing_if = "ServerAuthentication::is_password")]
    pub authentication: ServerAuthentication,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ServerAuthentication {
    #[default]
    Password,
    LoopbackLocal {
        identity: access::LoopbackLocalIdentity,
    },
    TrustedProxy {
        identity: access::LoopbackLocalIdentity,
        policy: access::TrustedProxyPolicy,
        socket: PathBuf,
    },
}
impl ServerAuthentication {
    pub fn is_password(&self) -> bool {
        matches!(self, Self::Password)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerHome {
    pub workspace_id: access::CanonicalId,
    pub home_id: access::CanonicalId,
    pub label: String,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServerCommands {
    ReadOnly,
    ExistingEditorCommands,
}

pub enum ServerCommand {
    Initialize {
        config: ServerConfig,
        provisioning: Option<PathBuf>,
    },
    Serve(ServerConfig),
    Rebind {
        previous: ServerConfig,
        config: Box<ServerConfig>,
    },
    UpgradeStateReceipt(crate::lifecycle::receipt_compatibility::Selection),
    RollbackStateReceipt(crate::lifecycle::receipt_compatibility::Selection),
}

impl ServerCommand {
    /// Separate subcommands leave the existing disposable CLI untouched.
    pub fn from_arguments(arguments: &[String]) -> Result<Option<Self>, String> {
        let Some(mode) = arguments.first().map(String::as_str) else {
            return Ok(None);
        };
        if matches!(mode, "upgrade-state-receipt" | "rollback-state-receipt") {
            let selection = crate::lifecycle::receipt_compatibility::Selection::from_arguments(
                &arguments[1..],
                mode == "rollback-state-receipt",
            )?;
            return Ok(Some(if mode == "upgrade-state-receipt" {
                Self::UpgradeStateReceipt(selection)
            } else {
                Self::RollbackStateReceipt(selection)
            }));
        }
        if !matches!(mode, "initialize" | "serve" | "rebind-origin") {
            return Ok(None);
        }
        let mut options = std::collections::BTreeMap::new();
        let mut remaining = arguments[1..].iter();
        while let Some(name) = remaining.next() {
            if !matches!(
                name.as_str(),
                "--server-config" | "--provisioning-file" | "--previous-server-config"
            ) || options
                .insert(
                    name.as_str(),
                    remaining.next().ok_or("Missing option value")?,
                )
                .is_some()
            {
                return Err("Unsupported or repeated persistent startup option".into());
            }
        }
        let config = ServerConfig::read(Path::new(
            options
                .get("--server-config")
                .ok_or("Required --server-config")?,
        ))?;
        if mode == "rebind-origin" {
            if options.contains_key("--provisioning-file") {
                return Err("Rebind never provisions accounts".into());
            }
            let previous = ServerConfig::read(Path::new(
                options
                    .get("--previous-server-config")
                    .ok_or("Required --previous-server-config")?,
            ))?;
            return Ok(Some(Self::Rebind {
                previous,
                config: Box::new(config),
            }));
        }
        if options.contains_key("--previous-server-config") {
            return Err("Previous configuration is only accepted by rebind-origin".into());
        }
        if mode == "serve" {
            if options.contains_key("--provisioning-file") {
                return Err("Serve never provisions accounts".into());
            }
            Ok(Some(Self::Serve(config)))
        } else {
            let provisioning = options
                .get("--provisioning-file")
                .map(|path| PathBuf::from(path.as_str()));
            match (&config.authentication, &provisioning) {
                (ServerAuthentication::Password, Some(path)) => absolute_path(path)?,
                (ServerAuthentication::Password, None) => {
                    return Err("Required --provisioning-file".into());
                }
                (
                    ServerAuthentication::LoopbackLocal { .. }
                    | ServerAuthentication::TrustedProxy { .. },
                    None,
                ) => {}
                (
                    ServerAuthentication::LoopbackLocal { .. }
                    | ServerAuthentication::TrustedProxy { .. },
                    Some(_),
                ) => {
                    return Err(
                        "Loopback-local initialization accepts no password provisioning file"
                            .into(),
                    );
                }
            }
            Ok(Some(Self::Initialize {
                config,
                provisioning,
            }))
        }
    }
}

impl ServerConfig {
    pub fn read(path: &Path) -> Result<Self, String> {
        let bytes = read_selected_file(path, 64 * 1024, true)?;
        let config: Self = serde_json::from_slice(&bytes)
            .map_err(|_| "Invalid persistent server configuration")?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || self.listen.port() == 0
            || self.homes.is_empty()
            || self.homes.len() > 64
        {
            return Err("Unsupported persistent server configuration".into());
        }
        for path in [
            &self.data_directory,
            &self.log_directory,
            &self.frontend_directory,
            &self.tls_certificate,
            &self.tls_private_key,
        ] {
            absolute_path(path)?;
        }
        if self.data_directory == Path::new("/")
            || self.log_directory != self.data_directory.join("logs")
        {
            return Err("Logs must be the dedicated data-directory/logs child".into());
        }
        access::AccessConfig::new(vec![self.origin.clone()]).map_err(|_| "Invalid HTTPS origin")?;
        let origin = url::Url::parse(&self.origin).map_err(|_| "Invalid HTTPS origin")?;
        if !matches!(
            self.authentication,
            ServerAuthentication::TrustedProxy { .. }
        ) && origin.port_or_known_default() != Some(self.listen.port())
        {
            return Err("Origin port must match the explicit listening port".into());
        }
        let mut homes = BTreeSet::new();
        for home in &self.homes {
            if home.label.trim().is_empty()
                || home.label.len() > 256
                || home.label.chars().any(char::is_control)
                || !homes.insert((home.workspace_id.as_str(), home.home_id.as_str()))
            {
                return Err("Invalid configured home".into());
            }
        }
        if let ServerAuthentication::LoopbackLocal { identity } = &self.authentication {
            if self.listen.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
                || self.listen.port() != 48743
                || self.origin != "https://127.0.0.1:48743"
                || self.homes.len() != 1
                || self.homes[0].workspace_id != identity.scope.workspace_id
                || self.homes[0].home_id != identity.scope.home_id
            {
                return Err(
                    "Loopback-local requires exactly one selected home at HTTPS127.0.0.1:48743"
                        .into(),
                );
            }
            self.access_config()?;
        }
        if let ServerAuthentication::TrustedProxy {
            identity, socket, ..
        } = &self.authentication
        {
            if self.listen
                != "127.0.0.1:48743"
                    .parse::<SocketAddr>()
                    .map_err(|_| "Invalid listener")?
                || socket != &self.data_directory.join("gateway.sock")
                || self.homes.len() != 1
                || self.homes[0].workspace_id != identity.scope.workspace_id
                || self.homes[0].home_id != identity.scope.home_id
            {
                return Err(
                    "Trusted proxy requires the selected private Unix socket and one exact home"
                        .into(),
                );
            }
            absolute_path(socket)?;
            self.access_config()?;
        }
        Ok(())
    }

    pub fn access_config(&self) -> Result<access::AccessConfig, String> {
        let config = access::AccessConfig::new(vec![self.origin.clone()])
            .map_err(|_| "Invalid access configuration")?;
        match &self.authentication {
            ServerAuthentication::Password => Ok(config),
            ServerAuthentication::LoopbackLocal { identity } => config
                .with_loopback_local(identity.clone())
                .map_err(|_| "Invalid explicit local identity".into()),
            ServerAuthentication::TrustedProxy {
                identity, policy, ..
            } => config
                .with_trusted_proxy(identity.clone(), std::sync::Arc::new(policy.clone()))
                .map_err(|_| "Invalid explicit trusted proxy identity".into()),
        }
    }

    pub fn home_summaries(&self) -> Vec<domain::HomeSummary> {
        self.homes
            .iter()
            .map(|home| domain::HomeSummary {
                scope: domain::Scope {
                    workspace_id: home.workspace_id.as_str().into(),
                    home_id: home.home_id.as_str().into(),
                },
                label: home.label.clone(),
            })
            .collect()
    }

    /// Startup metadata correlation only; this digest is not an authentication grant.
    /// Format 2 also pins the listener and command catalog. Earlier receipts
    /// cannot satisfy strict reopen or the original-config check during rebind;
    /// this method provides no receipt migration or automatic adoption.
    pub fn state_digest(&self) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        let mut value = serde_json::json!({"format":"houseatlas-server-state/2", "deploymentId":self.deployment_id,
            "dataDirectory":self.data_directory, "listen":self.listen, "origin":self.origin,
            "homes":self.homes, "mcpCommands":self.mcp_commands});
        if !self.authentication.is_password() {
            value["authentication"] = serde_json::to_value(&self.authentication)
                .map_err(|_| "Cannot encode local identity")?;
        }
        let bytes = serde_jcs::to_vec(&value).map_err(|_| "Cannot encode server state identity")?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    /// Exact original issuer calculation, used only by explicit offline receipt
    /// compatibility. Serving and origin rebind continue to require format 2.
    pub(crate) fn legacy_state_digest(&self) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        let mut value = serde_json::json!({"format":"houseatlas-server-state/1", "deploymentId":self.deployment_id,
            "dataDirectory":self.data_directory, "origin":self.origin, "homes":self.homes});
        if !self.authentication.is_password() {
            value["authentication"] = serde_json::to_value(&self.authentication)
                .map_err(|_| "Cannot encode local identity")?;
        }
        let bytes = serde_jcs::to_vec(&value).map_err(|_| "Cannot encode server state identity")?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    pub fn command_profile(&self) -> McpCommandProfile {
        match self.mcp_commands {
            ServerCommands::ReadOnly => McpCommandProfile::ReadOnly,
            ServerCommands::ExistingEditorCommands => McpCommandProfile::ExistingEditorCommands,
        }
    }
}

/// TLS material is selected explicitly and captured from the checked inode.
/// This creates neither keys nor certificates and does not certify their trust.
pub fn read_tls_files(config: &ServerConfig) -> Result<(Vec<u8>, Vec<u8>), String> {
    Ok((
        read_selected_file(&config.tls_certificate, 1024 * 1024, false)?,
        read_selected_file(&config.tls_private_key, 1024 * 1024, true)?,
    ))
}

pub(crate) fn absolute_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("Startup paths must be absolute without traversal".into());
    }
    Ok(())
}

/// Read the selected opened inode, never a symlink target or an unbounded stream.
/// Secrets are not included in errors. Callers must independently approve custody.
pub(crate) fn read_selected_file(
    path: &Path,
    maximum: u64,
    private: bool,
) -> Result<Vec<u8>, String> {
    absolute_path(path)?;
    if std::fs::canonicalize(path).map_err(|_| "Selected startup file unavailable")? != path {
        return Err("Startup files must use their canonical path".into());
    }
    let mut file = File::from(
        rustix::fs::open(
            path,
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|_| "Selected startup file unavailable")?,
    );
    let before = file
        .metadata()
        .map_err(|_| "Startup file metadata unavailable")?;
    let expected_mode = if private {
        0o600
    } else {
        before.mode() & 0o777
    };
    if !before.is_file()
        || before.nlink() != 1
        || before.uid() != rustix::process::geteuid().as_raw()
        || before.len() > maximum
        || before.mode() & 0o777 != expected_mode
        || before.mode() & 0o022 != 0
    {
        return Err("Invalid startup file owner, mode, type or size".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Startup file read unavailable")?;
    let after = file
        .metadata()
        .map_err(|_| "Startup file metadata unavailable")?;
    let named = std::fs::symlink_metadata(path).map_err(|_| "Startup file changed")?;
    if bytes.len() as u64 != before.len()
        || before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || named.file_type().is_symlink()
        || named.dev() != before.dev()
        || named.ino() != before.ino()
    {
        return Err("Startup file changed during capture".into());
    }
    Ok(bytes)
}
