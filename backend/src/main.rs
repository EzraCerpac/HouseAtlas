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
#[tokio::main]
async fn main() -> Result<(), lifecycle::Failure> {
    let config = Config::from_args().map_err(|e| format!("HouseAtlas settings: {e}"))?;
    let files = Arc::new(frontend(&config.frontend)?);
    let tls =
        axum_server::tls_rustls::RustlsConfig::from_pem_file(&config.cert, &config.key).await?;
    let listener = TcpListener::bind(config.listen)?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let origin = format!("https://{address}");
    let directory = config.directory.clone();
    let setup_origin = origin.clone();
    let core = tokio::task::spawn_blocking(move || lifecycle::prepare(&directory, &setup_origin))
        .await??;
    let database_version = core.store.database_version();
    let host = Host::new(core, origin.clone(), files)?;
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
    axum_server::from_tcp_rustls(listener, tls)?
        .handle(handle)
        .serve(router(host).into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await?;
    Ok(())
}
