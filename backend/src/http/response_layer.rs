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
pub(super) async fn static_file(State(host): State<Host>, uri: Uri) -> HttpResult {
    if uri.path() == "/favicon.ico" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let key = if uri.path() == "/" {
        "/index.html"
    } else {
        uri.path()
    };
    let (kind, bytes) = host
        .files
        .get(key)
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
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
