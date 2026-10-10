use houseatlas_backend::{
    config::Config,
    http::{Host, router},
    lifecycle,
};
use std::{collections::BTreeMap, fs, future::IntoFuture, net::TcpListener, path::Path, sync::Arc};

fn frontend(directory: &Path) -> Result<BTreeMap<String, (String, Vec<u8>)>, lifecycle::Failure> {
    fn walk(
        root: &Path,
        dir: &Path,
        files: &mut BTreeMap<String, (String, Vec<u8>)>,
    ) -> Result<(), lifecycle::Failure> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.is_symlink() {
                return Err("Frontend output cannot contain symlinks".into());
            }
            if metadata.is_dir() {
                walk(root, &path, files)?;
                continue;
            }
            if !metadata.is_file() || metadata.len() > 4_000_000 {
                return Err("Unsupported frontend asset".into());
            }
            let kind = match path.extension().and_then(|s| s.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "text/javascript; charset=utf-8",
                Some("css") => "text/css; charset=utf-8",
                Some("woff2") => "font/woff2",
                Some("webmanifest") => "application/manifest+json",
                Some("png") => "image/png",
                _ => return Err("Unsupported frontend asset type".into()),
            };
            let key = format!(
                "/{}",
                path.strip_prefix(root)?
                    .to_str()
                    .ok_or("Invalid frontend path")?
            );
            let mut bytes = fs::read(&path)?;
            if key == "/index.html" {
                let html = String::from_utf8(bytes)?;
                if html.matches("id=\"root\"").count() != 1 {
                    return Err("Expected one React root".into());
                }
                bytes = html.replace("id=\"root\"", "id=\"root\" data-bootstrap-url=\"/api/atlas/view\" data-home-url-template=\"/api/atlas/homes/{workspaceId}/{homeId}/view\" data-session-url=\"/api/atlas/auth/session\" data-login-url=\"/api/atlas/auth/login\" data-logout-url=\"/api/atlas/auth/logout\" data-auth-mode-url=\"/api/atlas/auth/mode\" data-local-sign-in-url=\"/api/atlas/auth/local\" data-proxy-sign-in-url=\"/api/atlas/auth/proxy\"").into_bytes();
            }
            files.insert(key, (kind.into(), bytes));
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    walk(directory, directory, &mut files)?;
    if !files.contains_key("/index.html") {
        return Err("Missing compiled React application".into());
    }
    Ok(files)
}
fn main() -> Result<(), lifecycle::Failure> {
    // This binary creates only explicitly selected private application state.
    // Establish the file-creation policy before starting runtime worker threads.
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    // The lease outlives the complete runtime, including blocking work whose
    // HTTP coordinator has already returned an error. Declaration order also
    // retains it through runtime destruction while unwinding.
    let mut persistent_lease = None;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(run(&mut persistent_lease));
    // Full destruction waits for blocking tasks; a timeout/background shutdown
    // here would release the data-directory lock before their work ended.
    drop(runtime);
    drop(persistent_lease);
    result
}

async fn run(
    persistent_lease: &mut Option<Arc<lifecycle::persistent::ServerLease>>,
) -> Result<(), lifecycle::Failure> {
    use houseatlas_backend::config::server::ServerCommand;
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let (arguments, ai_account) =
        houseatlas_backend::config::ai_account::ServerAccountSelection::from_arguments(&arguments)
            .map_err(|error| format!("HouseAtlas AI account settings: {error}"))?;
    if let Some(command) = ServerCommand::from_arguments(&arguments)
        .map_err(|error| format!("HouseAtlas settings: {error}"))?
    {
        return match command {
            ServerCommand::Backup(selection) => {
                if ai_account.is_some() {
                    return Err("Offline backup accepts no AI account selection".into());
                }
                let report =
                    tokio::task::spawn_blocking(move || lifecycle::backup::capture(&selection))
                        .await??;
                println!("{}", serde_json::to_string(&report)?);
                Ok(())
            }
            ServerCommand::Initialize {
                config,
                provisioning,
            } => {
                tokio::task::spawn_blocking(move || match provisioning {
                    Some(path) => lifecycle::persistent::initialize(&config, &path),
                    None => lifecycle::persistent::initialize_without_password(&config),
                })
                .await??;
                println!(
                    "HouseAtlas persistent state initialized; no listener or login session created"
                );
                Ok(())
            }
            ServerCommand::Serve(config) => {
                run_persistent(config, ai_account, persistent_lease).await
            }
            ServerCommand::Rebind { previous, config } => {
                tokio::task::spawn_blocking(move || {
                    lifecycle::persistent::rebind_origin(&previous, &config)
                })
                .await??;
                println!(
                    "HouseAtlas state rebound to the selected origin; old sessions revoked; no listener started"
                );
                Ok(())
            }
            ServerCommand::UpgradeStateReceipt(selection) => {
                if ai_account.is_some() {
                    return Err(
                        "Offline receipt compatibility accepts no AI account selection".into(),
                    );
                }
                let report = tokio::task::spawn_blocking(move || {
                    lifecycle::receipt_compatibility::upgrade(&selection)
                })
                .await??;
                println!("{}", serde_json::to_string(&report)?);
                Ok(())
            }
            ServerCommand::RollbackStateReceipt(selection) => {
                if ai_account.is_some() {
                    return Err(
                        "Offline receipt compatibility accepts no AI account selection".into(),
                    );
                }
                let report = tokio::task::spawn_blocking(move || {
                    lifecycle::receipt_compatibility::rollback(&selection)
                })
                .await??;
                println!("{}", serde_json::to_string(&report)?);
                Ok(())
            }
        };
    }
    let config = Config::from_args().map_err(|e| format!("HouseAtlas settings: {e}"))?;
    run_disposable(config).await
}

async fn run_disposable(config: Config) -> Result<(), lifecycle::Failure> {
    let files = Arc::new(frontend(&config.frontend)?);
    let profile = config.fixture_profile;
    let homebox_cache_sources = lifecycle::cached_homebox_sources_with_profile(profile)?;
    let tls =
        axum_server::tls_rustls::RustlsConfig::from_pem_file(&config.cert, &config.key).await?;
    let listener = TcpListener::bind(config.listen)?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let origin = format!("https://{address}");
    let directory = config.directory.clone();
    let setup_origin = origin.clone();
    let core = tokio::task::spawn_blocking(move || {
        lifecycle::prepare_with_profile(&directory, &setup_origin, profile)
    })
    .await??;
    let database_version = core
        .store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .database_version();
    let host = Host::new(core, origin.clone(), files, homebox_cache_sources)?;
    let host = if profile == houseatlas_backend::config::FixtureProfile::NativeMediaArchive {
        use houseatlas_backend::{
            config::provider_dispatch::archive::TrustedStockArchiveConfig,
            lifecycle::provider_dispatch::archive::PrivateStockArchive,
            media::{
                Cancellation, WorkBudget,
                recovery_policy_archive::{
                    MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES, MediaPolicyArchiveOrigin,
                },
                types::Scope,
            },
        };
        // Explicit fresh synthetic native custody input for this disposable
        // fixture only. It selects the just-created physical DB and dedicated
        // empty directory, never adopts candidate historical archive bytes.
        let path = config.directory.join("media-policy-archive");
        fs::create_dir(&path)?;
        let archive = PrivateStockArchive::open(TrustedStockArchiveConfig::new(
            path.canonicalize()?,
            MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES,
        )?)?;
        let scopes = host
            .core
            .lock()
            .map_err(|_| "Core unavailable")?
            .homes
            .iter()
            .map(|home| Scope {
                workspace_id: home.scope.workspace_id.clone(),
                home_id: home.scope.home_id.clone(),
            })
            .collect();
        let selected = config.directory.to_str().ok_or("Invalid fixture path")?;
        let archive_origin = MediaPolicyArchiveOrigin::new(
            "disposable-native-media",
            selected,
            "media-policy-archive",
            "fresh",
        )?;
        let budget = WorkBudget::new(std::time::Duration::from_secs(10), Cancellation::default())?;
        host.with_native_media_archive(archive, archive_origin, scopes, None, &budget)?
    } else {
        host
    };
    println!(
        "SQLite {} / record database schema {}",
        rusqlite::version(),
        database_version
    );
    println!("HouseAtlas disposable read slice listening at {origin}");
    let handle = axum_server::Handle::new();
    let shutdown = handle.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            shutdown.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
        }
    });
    let mut server = axum_server::from_tcp_rustls(listener, tls)?;
    // Bound HTTP/2 metadata while permitting the complete SourceRef query range
    // with ordinary browser headers. HTTP/1 keeps its existing larger buffer.
    server
        .http_builder()
        .http2()
        .max_header_list_size(256 * 1024);
    server
        .handle(handle)
        .serve(router(host).into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await?;
    Ok(())
}

async fn run_persistent(
    config: houseatlas_backend::config::server::ServerConfig,
    ai_account: Option<houseatlas_backend::config::ai_account::ServerAccountSelection>,
    persistent_lease: &mut Option<Arc<lifecycle::persistent::ServerLease>>,
) -> Result<(), lifecycle::Failure> {
    use houseatlas_backend::{
        config::server::read_tls_files,
        lifecycle::persistent::{self, ServerEvent},
    };
    if matches!(
        config.authentication,
        houseatlas_backend::config::server::ServerAuthentication::TrustedProxy { .. }
    ) {
        return run_gateway(config, ai_account, persistent_lease).await;
    }
    let config = Arc::new(config);
    if std::fs::canonicalize(&config.frontend_directory)? != config.frontend_directory {
        return Err("Persistent frontend directory must be canonical".into());
    }
    let files = Arc::new(frontend(&config.frontend_directory)?);
    let (certificate, key) = read_tls_files(&config)?;
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem(certificate, key).await?;
    let selected = Arc::clone(&config);
    let (core, lease) =
        tokio::task::spawn_blocking(move || persistent::reopen(&selected)).await??;
    let lease = Arc::new(lease);
    *persistent_lease = Some(Arc::clone(&lease));
    let mut host = Host::new(core, config.origin.clone(), files, Vec::new())?
        .with_mcp_command_profile(config.command_profile());
    if !config.authentication.is_password() {
        host = host.with_loopback_local()?;
    }
    let account_selected = ai_account.is_some();
    let ai_account =
        prepare_persistent_account(&host, ai_account, config.data_directory.clone()).await?;
    let application = mount_persistent_account(host, ai_account).await?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let listener = TcpListener::bind(config.listen)?;
    listener.set_nonblocking(true)?;
    println!(
        "HouseAtlas persistent server listening on {} for {}",
        listener.local_addr()?,
        config.origin
    );
    report_persistent_sources(account_selected);
    lease.event(ServerEvent::Listening)?;
    let handle = axum_server::Handle::new();
    let shutdown = handle.clone();
    let signal = tokio::spawn(async move {
        tokio::select! { result = tokio::signal::ctrl_c() => { result?; }, _ = terminate.recv() => {} }
        shutdown.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
        Ok::<_, std::io::Error>(())
    });
    let mut server = axum_server::from_tcp_rustls(listener, tls)?;
    server
        .http_builder()
        .http2()
        .max_header_list_size(256 * 1024);
    let result = server
        .handle(handle)
        .serve(application.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await;
    signal.abort();
    result?;
    lease.event(ServerEvent::Shutdown)?;
    Ok(())
}

/// The trusted gateway uses only its private Unix channel. External HTTPS is
/// terminated by the separately registered native Tailscale gateway owner.
async fn run_gateway(
    config: houseatlas_backend::config::server::ServerConfig,
    ai_account: Option<houseatlas_backend::config::ai_account::ServerAccountSelection>,
    persistent_lease: &mut Option<Arc<lifecycle::persistent::ServerLease>>,
) -> Result<(), lifecycle::Failure> {
    use houseatlas_backend::{
        app::trusted_gateway::{GatewayConnection, GatewaySocket},
        config::server::ServerAuthentication,
        lifecycle::persistent::{self, ServerEvent},
    };
    let config = Arc::new(config);
    if fs::canonicalize(&config.frontend_directory)? != config.frontend_directory {
        return Err("Persistent frontend directory must be canonical".into());
    }
    let files = Arc::new(frontend(&config.frontend_directory)?);
    let selected = Arc::clone(&config);
    let (core, lease) =
        tokio::task::spawn_blocking(move || persistent::reopen(&selected)).await??;
    let lease = Arc::new(lease);
    *persistent_lease = Some(Arc::clone(&lease));
    let policy = core
        .access
        .lock()
        .map_err(|_| "Access unavailable")?
        .trusted_proxy_policy()
        .cloned()
        .ok_or("Native gateway policy absent")?;
    let ServerAuthentication::TrustedProxy { socket: path, .. } = &config.authentication else {
        return Err("Gateway mode absent".into());
    };
    let host = Host::new(core, config.origin.clone(), files, Vec::new())?
        .with_mcp_command_profile(config.command_profile());
    let account_selected = ai_account.is_some();
    let ai_account =
        prepare_persistent_account(&host, ai_account, config.data_directory.clone()).await?;
    // Gateway capture requires the actual bound socket authority. Existing AI
    // files/owners were verified above; final composition precedes serving.
    let (listener, socket) = GatewaySocket::bind(path, policy).await?;
    let result = async {
        let host = host.with_trusted_gateway(Arc::clone(&socket))?;
        let application = mount_persistent_account(host, ai_account).await?;
        lease.event(ServerEvent::Listening)?;
        println!(
            "HouseAtlas private Unix gateway listening for {}",
            config.origin
        );
        report_persistent_sources(account_selected);
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        let (drain_started, drain_signal) = tokio::sync::oneshot::channel();
        let server = axum::serve(
            listener,
            application.into_make_service_with_connect_info::<GatewayConnection>(),
        )
        .with_graceful_shutdown(async move {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            let _ =
                drain_started.send(tokio::time::Instant::now() + std::time::Duration::from_secs(5));
        })
        .into_future();
        tokio::pin!(server);
        tokio::select! {
            result = &mut server => result?,
            deadline = drain_signal => {
                let deadline = deadline.map_err(|_| "Gateway shutdown signal unavailable")?;
                // The deadline starts at the signal, not after a request finishes.
                // Axum's connection tasks may outlive this coordinator. Expiry
                // closes the listener but cannot attest that their work ended.
                tokio::time::timeout_at(deadline, &mut server)
                    .await
                    .map_err(|_| "Gateway five-second HTTP drain deadline elapsed")??;
            }
        }
        Ok::<(), lifecycle::Failure>(())
    }
    .await;
    // The actual listener is dropped when the serving future finishes, including
    // Host/mount/log/signal failures. Remove only this gateway's checked inode.
    socket.remove_after_shutdown()?;
    result?;
    lease.event(ServerEvent::Shutdown)?;
    Ok(())
}

async fn prepare_persistent_account(
    host: &Host,
    selection: Option<houseatlas_backend::config::ai_account::ServerAccountSelection>,
    data_root: std::path::PathBuf,
) -> Result<Option<lifecycle::ai_account::SelectedAccountState>, lifecycle::Failure> {
    match selection {
        Some(selection) => {
            let host = host.clone();
            let selected = tokio::task::spawn_blocking(move || {
                lifecycle::ai_account::prepare(&host, selection, &data_root)
            })
            .await?
            .map_err(|_| "Selected existing AI account state unavailable")?;
            Ok(Some(selected))
        }
        None => Ok(None),
    }
}

async fn mount_persistent_account(
    host: Host,
    selected: Option<lifecycle::ai_account::SelectedAccountState>,
) -> Result<axum::Router, lifecycle::Failure> {
    match selected {
        Some(selected) => {
            let application = tokio::task::spawn_blocking(move || selected.mount(host))
                .await?
                .map_err(|_| "Selected existing AI account state unavailable")?;
            Ok(application.router().clone())
        }
        None => Ok(router(host)),
    }
}

fn report_persistent_sources(account_selected: bool) {
    if account_selected {
        println!(
            "HomeBox and Network unconfigured; existing AI account observation selected; historical Media admission unavailable"
        );
    } else {
        println!(
            "HomeBox, Network and AI providers unconfigured; historical Media admission unavailable"
        );
    }
}
