use houseatlas_backend::{
    config::Config,
    http::{Host, router},
    lifecycle,
};
use std::{collections::BTreeMap, fs, net::TcpListener, path::Path, sync::Arc};

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
                bytes = html.replace("id=\"root\"", "id=\"root\" data-bootstrap-url=\"/api/atlas/view\" data-home-url-template=\"/api/atlas/homes/{workspaceId}/{homeId}/view\" data-session-url=\"/api/atlas/auth/session\" data-login-url=\"/api/atlas/auth/login\" data-logout-url=\"/api/atlas/auth/logout\"").into_bytes();
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
    run()
}

#[tokio::main]
async fn run() -> Result<(), lifecycle::Failure> {
    use houseatlas_backend::config::server::ServerCommand;
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(command) = ServerCommand::from_arguments(&arguments)
        .map_err(|error| format!("HouseAtlas settings: {error}"))?
    {
        return match command {
            ServerCommand::Initialize {
                config,
                provisioning,
            } => {
                tokio::task::spawn_blocking(move || {
                    lifecycle::persistent::initialize(&config, &provisioning)
                })
                .await??;
                println!(
                    "HouseAtlas persistent state initialized; no listener or login session created"
                );
                Ok(())
            }
            ServerCommand::Serve(config) => run_persistent(config).await,
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
) -> Result<(), lifecycle::Failure> {
    use houseatlas_backend::{
        config::server::read_tls_files,
        lifecycle::persistent::{self, ServerEvent},
    };
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
    let host = Host::new(core, config.origin.clone(), files, Vec::new())?
        .with_mcp_command_profile(config.command_profile());
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let listener = TcpListener::bind(config.listen)?;
    listener.set_nonblocking(true)?;
    println!(
        "HouseAtlas persistent server listening on {} for {}",
        listener.local_addr()?,
        config.origin
    );
    println!(
        "HomeBox, Network and AI providers unconfigured; historical Media admission unavailable"
    );
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
        .serve(router(host).into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await;
    signal.abort();
    result?;
    lease.event(ServerEvent::Shutdown)?;
    Ok(())
}
