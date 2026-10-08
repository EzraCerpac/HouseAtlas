//! Native gateway channel custody. The remote identity is authenticated by the
//! dedicated gateway's WhoIs owner; headers alone cannot mint this proof.
use crate::access::{AccessError, AccessResult, RequestEvidence, TrustedProxyPolicy};
use axum::{extract::connect_info::Connected, serve::IncomingStream};
use serde::Deserialize;
use std::{
    fs,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::net::UnixListener;

/// Issued only from the actual Unix stream's OS peer credentials.
#[derive(Clone)]
pub struct GatewayConnection {
    uid: Option<u32>,
}
impl Connected<IncomingStream<'_, UnixListener>> for GatewayConnection {
    fn connect_info(stream: IncomingStream<'_, UnixListener>) -> Self {
        Self {
            uid: stream.io().peer_cred().ok().map(|peer| peer.uid()),
        }
    }
}

/// The selected private listener inode, retained for every gateway request.
pub struct GatewaySocket {
    path: PathBuf,
    device: u64,
    inode: u64,
    parent_device: u64,
    parent_inode: u64,
    policy: Arc<TrustedProxyPolicy>,
}
impl GatewaySocket {
    pub async fn bind(
        path: &Path,
        policy: Arc<TrustedProxyPolicy>,
    ) -> Result<(UnixListener, Arc<Self>), Box<dyn std::error::Error + Send + Sync>> {
        let parent = path.parent().ok_or("Gateway socket parent absent")?;
        let uid = rustix::process::geteuid().as_raw();
        let directory = fs::symlink_metadata(parent)?;
        if fs::canonicalize(parent)? != parent
            || !directory.is_dir()
            || directory.uid() != uid
            || directory.mode() & 0o777 != 0o700
            || uid != policy.peer_uid
        {
            return Err(
                "Gateway socket requires the selected private service-user directory".into(),
            );
        }
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if !metadata.file_type().is_socket()
                    || metadata.uid() != uid
                    || metadata.mode() & 0o777 != 0o600
                {
                    return Err("Existing gateway socket custody changed".into());
                }
                match tokio::net::UnixStream::connect(path).await {
                    Ok(_) => return Err("Gateway socket already has an active listener".into()),
                    Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                        let current = fs::symlink_metadata(path)?;
                        if current.dev() != metadata.dev()
                            || current.ino() != metadata.ino()
                            || !current.file_type().is_socket()
                            || current.uid() != uid
                            || current.mode() & 0o777 != 0o600
                        {
                            return Err("Gateway socket changed during stale-listener check".into());
                        }
                        fs::remove_file(path)?;
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let listener = UnixListener::bind(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        let metadata = fs::symlink_metadata(path)?;
        let socket = Arc::new(Self {
            path: path.to_owned(),
            device: metadata.dev(),
            inode: metadata.ino(),
            parent_device: directory.dev(),
            parent_inode: directory.ino(),
            policy,
        });
        socket.check()?;
        Ok((listener, socket))
    }
    pub fn policy(&self) -> &Arc<TrustedProxyPolicy> {
        &self.policy
    }
    fn check(&self) -> AccessResult<()> {
        let metadata = fs::symlink_metadata(&self.path).map_err(|_| AccessError::Forbidden)?;
        let parent = self.path.parent().ok_or(AccessError::Forbidden)?;
        let directory = fs::symlink_metadata(parent).map_err(|_| AccessError::Forbidden)?;
        if !metadata.file_type().is_socket()
            || metadata.uid() != self.policy.peer_uid
            || metadata.mode() & 0o777 != 0o600
            || metadata.dev() != self.device
            || metadata.ino() != self.inode
            || directory.dev() != self.parent_device
            || directory.ino() != self.parent_inode
            || !directory.is_dir()
            || directory.uid() != self.policy.peer_uid
            || directory.mode() & 0o777 != 0o700
            || fs::canonicalize(parent).map_err(|_| AccessError::Forbidden)? != parent
        {
            return Err(AccessError::Forbidden);
        }
        Ok(())
    }
    pub(crate) fn admit(
        &self,
        peer: &GatewayConnection,
        header: &str,
    ) -> AccessResult<GatewayAdmission> {
        self.check()?;
        if peer.uid != Some(self.policy.peer_uid) || header.len() > 1024 {
            return Err(AccessError::Forbidden);
        }
        let identity: WireIdentity =
            serde_json::from_str(header).map_err(|_| AccessError::Forbidden)?;
        if identity.schema_version != 1
            || match identity.kind.as_str() {
                "user" => identity.value != self.policy.user_login,
                "tag" => identity.value != self.policy.node_tag,
                _ => true,
            }
        {
            return Err(AccessError::Forbidden);
        }
        Ok(GatewayAdmission { _private: () })
    }
    /// Mint directly for this handler's actual evidence, after a fresh channel
    /// custody check. Middleware admission copies cannot bind request proofs.
    pub(crate) fn checked_identity<'request, 'evidence>(
        &self,
        peer: &GatewayConnection,
        header: &str,
        request: &'request RequestEvidence<'evidence>,
    ) -> AccessResult<CheckedGatewayIdentity<'request, 'evidence>> {
        self.admit(peer, header)?;
        Ok(CheckedGatewayIdentity {
            request,
            policy: Arc::clone(&self.policy),
            uid: self.policy.peer_uid,
        })
    }
    pub fn remove_after_shutdown(&self) -> AccessResult<()> {
        self.check()?;
        fs::remove_file(&self.path).map_err(|_| AccessError::Forbidden)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireIdentity {
    schema_version: u32,
    kind: String,
    value: String,
}

/// Process-local HTTP rate admission only. It cannot bind session proof.
#[derive(Clone)]
pub(crate) struct GatewayAdmission {
    _private: (),
}
/// Consumed only by native session issuance, bound to the exact evidence object.
pub(crate) struct CheckedGatewayIdentity<'request, 'evidence> {
    request: &'request RequestEvidence<'evidence>,
    policy: Arc<TrustedProxyPolicy>,
    uid: u32,
}
impl<'request, 'evidence> CheckedGatewayIdentity<'request, 'evidence> {
    pub(crate) fn request(&self) -> &'request RequestEvidence<'evidence> {
        self.request
    }
    pub(crate) fn policy(&self) -> &Arc<TrustedProxyPolicy> {
        &self.policy
    }
    pub(crate) fn actual_peer_uid(&self) -> u32 {
        self.uid
    }
}
