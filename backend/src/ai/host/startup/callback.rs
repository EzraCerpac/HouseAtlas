//! Explicit local credential-host actions. No listener or process starts in new().
//! This supported SIWC helper has a bounded lifetime; it is not an always-awake
//! inference companion and its callback never supplies a spending grant.
use super::{authority::StartupAuthority, provider::now_ms};
use crate::{
    access,
    ai::{
        AiError, PortFuture,
        host::{HostAuthority, native::NativeHostContext, status::StatusJournal},
        oauth::{AuthorizationLaunch, CallbackRequest, CallbackSelection, RegistrationBinding},
    },
};
use std::{
    collections::BTreeMap,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    num::NonZeroU16,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const USAGE: &str = "https://chatgpt.com/#settings/Usage";

/// A trusted installed native browser opener selected by the application owner.
/// No shell, environment token, implicit executable lookup or support action.
pub struct NativeBrowser {
    executable: PathBuf,
}
impl NativeBrowser {
    pub fn new_existing(executable: &Path) -> Result<Self, AiError> {
        use std::os::unix::fs::MetadataExt;
        let metadata =
            std::fs::symlink_metadata(executable).map_err(|_| AiError::ConnectionUnavailable)?;
        if !executable.is_absolute()
            || std::fs::canonicalize(executable).map_err(|_| AiError::ConnectionUnavailable)?
                != executable
            || !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.mode() & 0o022 != 0
            || metadata.mode() & 0o111 == 0
            || (metadata.uid() != 0 && metadata.uid() != rustix::process::geteuid().as_raw())
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(Self {
            executable: executable.to_owned(),
        })
    }
    fn open<'a>(&'a self, url: &'a str) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let executable = self.executable.clone();
            let url = url.to_owned();
            tokio::task::spawn_blocking(move || {
                // The exact URL stays in this local credential host. No command
                // output, URL, callback query or OS error text is disclosed.
                let mut child = Command::new(executable)
                    .arg(url)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| AiError::ConnectionUnavailable)?;
                let deadline = std::time::Instant::now() + Duration::from_secs(10);
                loop {
                    if let Some(status) = child
                        .try_wait()
                        .map_err(|_| AiError::ConnectionUnavailable)?
                    {
                        return if status.success() {
                            Ok(())
                        } else {
                            Err(AiError::ConnectionUnavailable)
                        };
                    }
                    if std::time::Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(AiError::ConnectionUnavailable);
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
            })
            .await
            .map_err(|_| AiError::ConnectionUnavailable)?
        })
    }
}
struct Reserved {
    listener: TcpListener,
    binding: RegistrationBinding,
    created_ms: u64,
}
pub(super) struct CapturedCallback {
    pub(super) original: access::Principal,
    pub(super) binding: RegistrationBinding,
    pub(super) action_id: String,
    pub(super) request: Result<CallbackRequest, AiError>,
}
pub struct LocalCredentialHost {
    authority: StartupAuthority,
    journal: StatusJournal,
    browser: NativeBrowser,
    reserved: Mutex<BTreeMap<String, Reserved>>,
    sender: tokio::sync::mpsc::Sender<CapturedCallback>,
    receiver: tokio::sync::Mutex<tokio::sync::mpsc::Receiver<CapturedCallback>>,
    slots: Arc<tokio::sync::Semaphore>,
}
fn key(binding: &RegistrationBinding) -> Result<String, AiError> {
    serde_json::to_string(&(
        &binding.registration_id,
        &binding.actor_id,
        &binding.workspace_id,
        &binding.home_id,
        &binding.authority_epoch,
        &binding.cancellation_epoch,
    ))
    .map_err(|_| AiError::DomainUnavailable)
}
impl LocalCredentialHost {
    pub(super) fn new(
        authority: StartupAuthority,
        journal: StatusJournal,
        browser: NativeBrowser,
    ) -> Self {
        let (sender, receiver) = tokio::sync::mpsc::channel(16);
        Self {
            authority,
            journal,
            browser,
            reserved: Mutex::default(),
            sender,
            receiver: tokio::sync::Mutex::new(receiver),
            slots: Arc::new(tokio::sync::Semaphore::new(16)),
        }
    }
    pub(super) fn reserve(
        &self,
        context: &NativeHostContext,
    ) -> Result<CallbackSelection, AiError> {
        let binding = self.authority.binding(context)?;
        let key = key(&binding)?;
        let mut reserved = self
            .reserved
            .lock()
            .map_err(|_| AiError::ConnectionUnavailable)?;
        let now = now_ms()?;
        reserved.retain(|_, row| now.saturating_sub(row.created_ms) < 600_000);
        if let Some(row) = reserved.get(&key) {
            let port = NonZeroU16::new(
                row.listener
                    .local_addr()
                    .map_err(|_| AiError::ConnectionUnavailable)?
                    .port(),
            )
            .ok_or(AiError::ConnectionUnavailable)?;
            return Ok(CallbackSelection::AvailableLoopbackPort(port));
        }
        if reserved.len() >= 16 {
            return Err(AiError::LimitReached);
        }
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| AiError::ConnectionUnavailable)?;
        listener
            .set_nonblocking(true)
            .map_err(|_| AiError::ConnectionUnavailable)?;
        let port = NonZeroU16::new(
            listener
                .local_addr()
                .map_err(|_| AiError::ConnectionUnavailable)?
                .port(),
        )
        .ok_or(AiError::ConnectionUnavailable)?;
        self.authority.revalidate(context, &binding)?;
        reserved.insert(
            key,
            Reserved {
                listener,
                binding,
                created_ms: now,
            },
        );
        Ok(CallbackSelection::AvailableLoopbackPort(port))
    }
    pub(super) fn launch<'a>(
        &'a self,
        context: &'a NativeHostContext,
        launch: AuthorizationLaunch,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let binding = self.authority.binding(context)?;
            let url = url::Url::parse(launch.trusted_authorization_url())
                .map_err(|_| AiError::InvalidInput)?;
            if url.scheme() != "https"
                || url.host_str() != Some("auth.openai.com")
                || url.path() != "/api/accounts/authorize"
                || url.port().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.fragment().is_some()
            {
                return Err(AiError::InvalidInput);
            }
            let one = |name: &str| -> Result<String, AiError> {
                let values: Vec<_> = url
                    .query_pairs()
                    .filter(|(key, _)| key == name)
                    .map(|(_, value)| value.into_owned())
                    .collect();
                if values.len() != 1 {
                    return Err(AiError::InvalidInput);
                }
                Ok(values[0].clone())
            };
            let nonce = one("nonce")?;
            let action_id = self
                .journal
                .nonce_action(&binding, &crate::ai::host::lifecycle::state_digest(&nonce))?;
            let reserved = self
                .reserved
                .lock()
                .map_err(|_| AiError::ConnectionUnavailable)?
                .remove(&key(&binding)?)
                .ok_or(AiError::ConnectionUnavailable)?;
            let port = reserved
                .listener
                .local_addr()
                .map_err(|_| AiError::ConnectionUnavailable)?
                .port();
            if reserved.binding != binding
                || one("redirect_uri")? != format!("http://127.0.0.1:{port}/auth/callback")
            {
                return Err(AiError::ConnectionUnavailable);
            }
            let permit = Arc::clone(&self.slots)
                .try_acquire_owned()
                .map_err(|_| AiError::LimitReached)?;
            self.authority.revalidate(context, &binding)?;
            let listener = tokio::net::TcpListener::from_std(reserved.listener)
                .map_err(|_| AiError::ConnectionUnavailable)?;
            let sender = self.sender.clone();
            let original = context.original().clone();
            tokio::spawn(async move {
                // Deadline bounds the complete callback lifetime and queue wait.
                let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
                let request = tokio::time::timeout_at(deadline, receive(listener, port))
                    .await
                    .unwrap_or(Err(AiError::ConnectionUnavailable));
                let _ = tokio::time::timeout_at(
                    deadline,
                    sender.send(CapturedCallback {
                        original,
                        binding,
                        action_id,
                        request,
                    }),
                )
                .await;
                drop(permit);
            });
            self.browser
                .open(launch.trusted_authorization_url())
                .await?;
            self.authority.revalidate(context, context.registration())
        })
    }
    pub(super) fn manage_usage<'a>(&'a self, context: &'a NativeHostContext) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let binding = self.authority.binding(context)?;
            self.browser.open(USAGE).await?;
            self.authority.revalidate(context, &binding)
        })
    }
    pub(super) async fn next(&self) -> Result<CapturedCallback, AiError> {
        self.receiver
            .lock()
            .await
            .recv()
            .await
            .ok_or(AiError::ConnectionUnavailable)
    }
}
async fn receive(listener: tokio::net::TcpListener, port: u16) -> Result<CallbackRequest, AiError> {
    let (mut stream, peer) = listener
        .accept()
        .await
        .map_err(|_| AiError::ConnectionUnavailable)?;
    if !peer.ip().is_loopback() {
        return Err(AiError::ConnectionUnavailable);
    }
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        let size = stream
            .read(&mut chunk)
            .await
            .map_err(|_| AiError::InvalidInput)?;
        if size == 0 || bytes.len().saturating_add(size) > 16 * 1024 {
            return Err(AiError::InvalidInput);
        }
        bytes.extend_from_slice(&chunk[..size]);
        if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let request = decode_callback(&bytes, port)?;
    // Acknowledge receipt only. OAuth verification/persistence happens later
    // under the original native context, and no result/query enters this page.
    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 44\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nCallback received. Return to the application.").await.map_err(|_| AiError::ConnectionUnavailable)?;
    Ok(request)
}
fn decode_callback(bytes: &[u8], port: u16) -> Result<CallbackRequest, AiError> {
    let text = std::str::from_utf8(bytes).map_err(|_| AiError::InvalidInput)?;
    let (head, body) = text.split_once("\r\n\r\n").ok_or(AiError::InvalidInput)?;
    if !body.is_empty() {
        return Err(AiError::InvalidInput);
    }
    let mut lines = head.split("\r\n");
    let parts: Vec<_> = lines
        .next()
        .ok_or(AiError::InvalidInput)?
        .split(' ')
        .collect();
    if parts.len() != 3 || parts[0] != "GET" || parts[2] != "HTTP/1.1" {
        return Err(AiError::InvalidInput);
    }
    let (path, query) = parts[1].split_once('?').ok_or(AiError::InvalidInput)?;
    if path != "/auth/callback" || query.len() > 8192 || query.contains('#') {
        return Err(AiError::InvalidInput);
    }
    let expected = format!("127.0.0.1:{port}");
    let mut host = None;
    for line in lines {
        if line.starts_with([' ', '\t']) {
            return Err(AiError::InvalidInput);
        }
        let (name, value) = line.split_once(':').ok_or(AiError::InvalidInput)?;
        if !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
        {
            return Err(AiError::InvalidInput);
        }
        if name.eq_ignore_ascii_case("host") && host.replace(value.trim()).is_some() {
            return Err(AiError::InvalidInput);
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            || (name.eq_ignore_ascii_case("content-length") && value.trim() != "0")
        {
            return Err(AiError::InvalidInput);
        }
    }
    if host != Some(expected.as_str()) {
        return Err(AiError::InvalidInput);
    }
    // Preserve all decoded pairs, including duplicate state/code/client IDs;
    // accepted OAuthLifecycle owns their validation and permission semantics.
    let parameters: Vec<_> = url::form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if parameters.len() > 32 {
        return Err(AiError::LimitReached);
    }
    Ok(CallbackRequest {
        method: "GET".into(),
        host: expected,
        redirect_uri: format!("http://127.0.0.1:{port}/auth/callback"),
        parameters,
    })
}
