use super::*;

pub(super) async fn response_adapter(
    State(host): State<Host>,
    mut request: Request,
    next: Next,
) -> Response {
    let mcp_path = agents::mcp_transport::matches_path(request.uri().path());
    let request_id = host.response_ids.next();
    let admitted = host.admission.admit();
    let checked = admitted.as_ref().map_err(Clone::clone).and_then(|permit| {
        let mut headers =
            CheckedHeaders::read(request.headers(), request.version()).map_err(access_error)?;
        if let Some(socket) = &host.gateway {
            let peer = request
                .extensions()
                .get::<axum::extract::ConnectInfo<crate::app::trusted_gateway::GatewayConnection>>()
                .ok_or_else(|| failure(StatusCode::FORBIDDEN))?;
            let identity = headers::single(request.headers(), "x-houseatlas-gateway-identity")
                .map_err(access_error)?
                .ok_or_else(|| failure(StatusCode::FORBIDDEN))?;
            headers.gateway = Some(socket.admit(&peer.0, &identity).map_err(access_error)?);
        }
        headers
            .check_authority(&host.origin, request.uri())
            .map_err(access_error)?;
        Ok(headers.with_admission(permit.clone()))
    });
    // Keep admission through response construction even when route extraction
    // drops request extensions; blocking closures retain their separate clones.
    let _admitted = admitted;
    let mut response = if request.uri().path().contains('%') {
        failure(StatusCode::FORBIDDEN).into_response()
    } else {
        match checked {
            Ok(headers) => {
                request.extensions_mut().insert(headers);
                next.run(request).await
            }
            Err(error) => error.into_response(),
        }
    };
    if (response.status().is_client_error() || response.status().is_server_error())
        && !agents::is_stock_response(&response)
        && !agents::mcp_transport::is_mcp_response(&response)
        && !upload_outcomes::is_outcome_response(&response)
    {
        let error = response
            .extensions()
            .get::<HttpFailure>()
            .cloned()
            .unwrap_or_else(|| HttpFailure::for_status(response.status()));
        let allow = response.headers().get(header::ALLOW).cloned();
        response = if mcp_path {
            agents::mcp_transport::http_failure(error)
        } else {
            error.response(request_id)
        };
        if let Some(allow) = allow {
            response.headers_mut().insert(header::ALLOW, allow);
        }
    }
    private_headers(&mut response);
    if response.status() == StatusCode::OK
        && response.extensions().get::<ImmutableAsset>().is_some()
    {
        // Content-hashed build output never changes under its name, so a
        // returning page reuses it without a request.
        let headers = response.headers_mut();
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
        headers.remove(header::PRAGMA);
        // The bytes do not depend on the cookie or origin of the request.
        headers.remove(header::VARY);
    }
    response
}
/// Marks a static response whose path is content-hashed build output.
#[derive(Clone, Copy)]
struct ImmutableAsset;
/// Every emitted `/assets/` file is named `<name>-<hash>.<ext>` by the
/// frontend build (vite.config.ts), and release retention keeps older ones
/// under their own names, so a name never changes its bytes.
fn immutable_asset_path(path: &str) -> bool {
    path.strip_prefix("/assets/")
        .is_some_and(|name| !name.is_empty() && !name.contains('/'))
}
/// A built folder with its own entry page, such as `/example/`, is reached by
/// redirecting to exactly `<folder>/index.html`: its page and offline worker
/// own that address, so the folder URL never serves a second copy.
fn directory_index(files: &BTreeMap<String, (String, Vec<u8>)>, path: &str) -> Option<String> {
    let entry = format!("{}/index.html", path.trim_end_matches('/'));
    files.contains_key(&entry).then_some(entry)
}
pub(super) async fn static_file(State(host): State<Host>, uri: Uri) -> HttpResult {
    if uri.path() == "/favicon.ico" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let key = if uri.path() == "/" {
        "/index.html"
    } else {
        uri.path()
    };
    let Some((kind, bytes)) = host.files.get(key) else {
        return match directory_index(&host.files, key) {
            Some(entry) => Ok(axum::response::Redirect::temporary(&match uri.query() {
                Some(query) => format!("{entry}?{query}"),
                None => entry,
            })
            .into_response()),
            None => Err(failure(StatusCode::NOT_FOUND)),
        };
    };
    let mut response = bytes.clone().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        kind.parse()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
    );
    if immutable_asset_path(key) {
        response.extensions_mut().insert(ImmutableAsset);
    }
    Ok(response)
}
#[cfg(test)]
mod static_cache_tests {
    use super::immutable_asset_path;

    #[test]
    fn only_hashed_build_assets_are_immutable() {
        assert!(immutable_asset_path("/assets/index-B3x_9kQz.js"));
        assert!(immutable_asset_path("/assets/pdf.worker.min-Da1-xY2b.js"));
        for path in [
            "/",
            "/index.html",
            "/saved/index.html",
            "/saved/service-worker.js",
            "/offline-entry-worker.js",
            "/manifest.webmanifest",
            "/icons/houseatlas-192.png",
            "/assets/",
            "/assets/nested/file.js",
            "/api/assets/x.js",
        ] {
            assert!(!immutable_asset_path(path), "{path}");
        }
    }
}
#[cfg(test)]
mod directory_index_tests {
    use super::super::{Host, router};
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header},
    };
    use serde_json::json;
    use std::{collections::BTreeMap, fs, os::unix::fs::PermissionsExt, sync::Arc};
    use tower::ServiceExt;

    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }

    /// Generated built-frontend files and a disposable loopback-local Host;
    /// every request is made without a session.
    #[tokio::test]
    async fn built_folder_urls_redirect_to_their_exact_entry() {
        let temporary = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let config: crate::config::server::ServerConfig = serde_json::from_value(json!({
            "schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),
            "logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
            "tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),
            "listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743",
            "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
            "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
                "userId":id(4),"actorId":id(5),"username":"synthetic-local",
                "scope":{"workspaceId":id(2),"homeId":id(3)}}}
        }))
        .unwrap();
        crate::lifecycle::persistent::initialize_without_password(&config).unwrap();
        let (core, _lease) = crate::lifecycle::persistent::reopen(&config).unwrap();
        let html = "text/html; charset=utf-8".to_owned();
        let js = "text/javascript; charset=utf-8".to_owned();
        let files = BTreeMap::from([
            (
                "/index.html".to_owned(),
                (html.clone(), b"<p>app</p>".to_vec()),
            ),
            (
                "/saved/index.html".to_owned(),
                (html.clone(), b"<p>saved</p>".to_vec()),
            ),
            (
                "/example/index.html".to_owned(),
                (html.clone(), b"<p>example</p>".to_vec()),
            ),
            (
                "/example/service-worker.js".to_owned(),
                (js.clone(), b"// worker".to_vec()),
            ),
            (
                "/example/assets/index-Ab1.js".to_owned(),
                (js.clone(), b"// page".to_vec()),
            ),
            ("/assets/app-Cd2.js".to_owned(), (js, b"// app".to_vec())),
        ]);
        let app = router(
            Host::new(core, config.origin.clone(), Arc::new(files), vec![])
                .unwrap()
                .with_loopback_local()
                .unwrap(),
        );
        let get = |method: &'static str, uri: &'static str| {
            let app = app.clone();
            async move {
                let mut request = Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("host", "127.0.0.1:48743")
                    .body(Body::empty())
                    .unwrap();
                request.extensions_mut().insert(axum::extract::ConnectInfo(
                    "127.0.0.1:50123".parse::<std::net::SocketAddr>().unwrap(),
                ));
                app.oneshot(request).await.unwrap()
            }
        };

        for (method, uri, location) in [
            ("GET", "/example/", "/example/index.html"),
            ("GET", "/example", "/example/index.html"),
            ("HEAD", "/example/", "/example/index.html"),
            (
                "GET",
                "/example/?view=plan",
                "/example/index.html?view=plan",
            ),
            ("GET", "/saved/", "/saved/index.html"),
        ] {
            let response = get(method, uri).await;
            assert_eq!(
                response.status(),
                StatusCode::TEMPORARY_REDIRECT,
                "{method} {uri}"
            );
            assert_eq!(response.headers()[header::LOCATION], location, "{uri}");
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "private, no-store",
                "{uri}"
            );
            assert!(
                to_bytes(response.into_body(), 1024)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }

        // The entry, its worker and its files keep their exact addresses.
        for (uri, body) in [
            ("/example/index.html", "<p>example</p>"),
            ("/example/service-worker.js", "// worker"),
            ("/example/assets/index-Ab1.js", "// page"),
            ("/", "<p>app</p>"),
        ] {
            let response = get("GET", uri).await;
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            assert_eq!(
                to_bytes(response.into_body(), 1024).await.unwrap(),
                body.as_bytes()
            );
        }

        // Folders without their own entry, unknown folders and paths that
        // would form another authority stay unavailable.
        for uri in [
            "/assets/",
            "/example/assets/",
            "/missing/",
            "/example/index.html/",
            "//example/",
        ] {
            let response = get("GET", uri).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{uri}");
            assert!(response.headers().get(header::LOCATION).is_none(), "{uri}");
        }
    }
}
