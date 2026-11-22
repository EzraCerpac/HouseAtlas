//! Passive home-scoped read of the owner-configured radio station and the
//! helper's now-playing snapshot. GET only; nothing is started, controlled or written.
use super::*;

pub(super) async fn read(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        authorized_read_unlocked(&host, &headers, &uri, &method, scope.clone(), |_| {
            let station = host
                .radio_station
                .as_deref()
                .filter(|s| s.workspace_id == scope.workspace_id && s.home_id == scope.home_id)
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            let seen = station.observe(crate::config::radio_station::wall_clock());
            Ok(Json(json!({
                "schema": "houseatlas.radio-station.v1",
                "frequencyKhz": station.frequency_khz(),
                "placement": station.placement,
                "readAt": seen.read_at,
                "snapshot": seen.snapshot,
            }))
            .into_response())
        })
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

/// The cover a fresh snapshot names, by its digest. Private, never cached;
/// the page asks again only when the digest changes.
pub(super) async fn cover(
    State(host): State<Host>,
    Path((workspace_id, home_id, sha256)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        let scope = d::Scope {
            workspace_id,
            home_id,
        };
        authorized_read_unlocked(&host, &headers, &uri, &method, scope.clone(), |_| {
            let (media_type, bytes) = host
                .radio_station
                .as_deref()
                .filter(|s| s.workspace_id == scope.workspace_id && s.home_id == scope.home_id)
                .and_then(|station| {
                    station.cover(&sha256, crate::config::radio_station::wall_clock())
                })
                .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
            let mut response = bytes.into_response();
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(media_type));
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static("default-src 'none'; sandbox"),
            );
            Ok(response)
        })
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::radio_station::RadioStationSelection;
    use std::{fs, os::unix::fs::PermissionsExt};
    use tower::ServiceExt;

    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn request(uri: &str, method: &str, cookie: Option<&str>) -> Request {
        let mut builder = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header("host", "127.0.0.1:48743")
            .header("origin", "https://127.0.0.1:48743")
            .header("sec-fetch-site", "same-origin")
            .header("content-type", "application/json");
        if let Some(cookie) = cookie {
            builder = builder.header("cookie", cookie);
        }
        let mut request = builder
            .body(axum::body::Body::from(if cookie.is_some() {
                ""
            } else {
                "{}"
            }))
            .unwrap();
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "127.0.0.1:50123".parse::<std::net::SocketAddr>().unwrap(),
        ));
        request
    }
    fn route(home: u32) -> String {
        format!(
            "/api/atlas/radio/v1/workspaces/{}/homes/{}/station",
            id(2),
            id(home)
        )
    }
    fn write_private(path: &std::path::Path, bytes: &[u8]) {
        let _ = fs::remove_file(path);
        fs::write(path, bytes).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    fn snapshot(state: &str, checked_at: &str) -> Value {
        json!({"schema":"houseatlas.now-playing.v1","state":state,
            "since": if state == "unknown" { Value::Null } else { json!("2026-01-01T12:00:02.000Z") },
            "checkedAt":checked_at,
            "track": if state == "playing" { json!({"title":"Example title","artist":"Example artist"}) } else { Value::Null },
            "lastTrack":{"title":"Example title","artist":"Example artist"}})
    }
    fn now(offset_ms: i64) -> String {
        (crate::config::radio_station::wall_clock() + chrono::Duration::milliseconds(offset_ms))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    struct Fixture {
        _temporary: tempfile::TempDir,
        root: std::path::PathBuf,
        host: Host,
        cookie: String,
    }
    async fn fixture() -> Fixture {
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
        let host = Host::new(
            core,
            config.origin.clone(),
            Arc::new(BTreeMap::new()),
            vec![],
        )
        .unwrap()
        .with_loopback_local()
        .unwrap();
        let response = router(host.clone())
            .oneshot(request("/api/atlas/auth/local", "POST", None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        Fixture {
            _temporary: temporary,
            root,
            host,
            cookie,
        }
    }
    fn station(root: &std::path::Path, home: u32, placement: Value) -> RadioStationSelection {
        let profile = root.join("radio-station.json");
        let bytes = json!({"profile":"houseatlas.radio-station-profile.v1","workspaceId":id(2),"homeId":id(home),
            "stationPath":root.join("station.json"),"snapshotPath":root.join("now-playing.json"),"placement":placement})
        .to_string();
        write_private(&profile, bytes.as_bytes());
        let sha = format!("{:x}", sha2::Sha256::digest(bytes.as_bytes()));
        assert!(RadioStationSelection::read_pinned(&profile, &"0".repeat(64)).is_err());
        RadioStationSelection::read_pinned(&profile, &sha).unwrap()
    }
    async fn get(app: &Router, uri: &str, cookie: Option<&str>) -> (StatusCode, Value, Response) {
        let response = app
            .clone()
            .oneshot(request(uri, "GET", cookie))
            .await
            .unwrap();
        let status = response.status();
        let (parts, body) = response.into_parts();
        let bytes = axum::body::to_bytes(body, 1 << 20).await.unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (
            status,
            value,
            Response::from_parts(parts, axum::body::Body::empty()),
        )
    }
    use sha2::Digest;

    #[tokio::test]
    async fn healthy_radio_station_route_reads_only_the_configured_home() {
        let f = fixture().await;
        let cookie = Some(f.cookie.as_str());
        // Absent configuration: authenticated members see not found.
        let (status, ..) = get(&router(f.host.clone()), &route(3), cookie).await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let placement = json!({"publicationId":id(9),"spaceOccurrenceId":"occ-hall"});
        let host = f
            .host
            .clone()
            .with_radio_station(station(&f.root, 3, placement.clone()))
            .unwrap();
        let app = router(host.clone());
        // Unauthenticated and foreign-home reads are refused before any file read.
        let (status, ..) = get(&app, &route(3), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, ..) = get(&app, &route(3), Some("houseatlas_session=x")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        // Another or unconfigured home is refused, and no station can name one.
        for home in [6, 7] {
            let (status, ..) = get(&app, &route(home), cookie).await;
            assert_eq!(status, StatusCode::NOT_FOUND);
        }
        assert!(
            f.host
                .clone()
                .with_radio_station(station(&f.root, 6, Value::Null))
                .is_err()
        );
        // Browsing is GET only.
        let response = app
            .clone()
            .oneshot(request(&route(3), "POST", cookie))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);

        // Missing snapshot: station facts with no reading.
        let (status, body, response) = get(&app, &route(3), cookie).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            response.headers()["cache-control"],
            "private, no-store",
            "private headers"
        );
        assert_eq!(body["schema"], "houseatlas.radio-station.v1");
        // No station file yet: the frequency is unknown, the rest still reads.
        assert_eq!(body["frequencyKhz"], Value::Null);
        assert_eq!(body["placement"], placement);
        assert_eq!(body["snapshot"], Value::Null);
        assert!(chrono::DateTime::parse_from_rfc3339(body["readAt"].as_str().unwrap()).is_ok());
        assert_eq!(body.as_object().unwrap().len(), 5);

        // The operator's file is the only source; every read re-reads it.
        let station_file = f.root.join("station.json");
        let khz = |app: Router| {
            let cookie = f.cookie.clone();
            async move { get(&app, &route(3), Some(&cookie)).await.1["frequencyKhz"].clone() }
        };
        write_private(&station_file, br#"{"frequencyKhz":1440}"#);
        assert_eq!(khz(app.clone()).await, json!(1440));
        write_private(&station_file, br#"{"frequencyKhz":520}"#);
        assert_eq!(khz(app.clone()).await, json!(520));
        let invalid: [&[u8]; 10] = [
            br#"{"frequencyKhz":519}"#,
            br#"{"frequencyKhz":1711}"#,
            br#"{"frequencyKhz":1440.5}"#,
            br#"{"frequencyKhz":"1440"}"#,
            br#"{"frequencyKhz":null}"#,
            br#"{"frequencyKhz":1440,"unit":"kHz"}"#,
            br#"{"frequencyKhz":1,"frequencyKhz":1440}"#,
            br#"{}"#,
            b"not json",
            // Over the 256-byte bound, though otherwise well formed.
            &[br#"{"frequencyKhz":1440}"#.as_slice(), &[b' '; 256]].concat(),
        ];
        for bytes in invalid {
            write_private(&station_file, bytes);
            let (status, body, _) = get(&app, &route(3), cookie).await;
            assert_eq!(status, StatusCode::OK, "never an error");
            assert_eq!(body["frequencyKhz"], Value::Null, "{:?}", bytes);
        }
        write_private(&station_file, br#"{"frequencyKhz":1440}"#);
        fs::set_permissions(&station_file, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(khz(app.clone()).await, Value::Null, "wrong mode");
        fs::set_permissions(&station_file, fs::Permissions::from_mode(0o600)).unwrap();
        let linked = f.root.join("station-link.json");
        fs::hard_link(&station_file, &linked).unwrap();
        assert_eq!(khz(app.clone()).await, Value::Null, "two links");
        fs::remove_file(&linked).unwrap();
        let target = f.root.join("station-target.json");
        write_private(&target, br#"{"frequencyKhz":1440}"#);
        fs::remove_file(&station_file).unwrap();
        std::os::unix::fs::symlink(&target, &station_file).unwrap();
        assert_eq!(khz(app.clone()).await, Value::Null, "symlink");
        fs::remove_file(&station_file).unwrap();
        write_private(&station_file, br#"{"frequencyKhz":1440}"#);
        assert_eq!(khz(app.clone()).await, json!(1440), "valid again");
        // A missing frequency does not hide the now-playing state.
        fs::remove_file(&station_file).unwrap();
        write_private(
            &f.root.join("now-playing.json"),
            snapshot("playing", &now(-1_000)).to_string().as_bytes(),
        );
        let (_, body, _) = get(&app, &route(3), cookie).await;
        assert_eq!(body["frequencyKhz"], Value::Null);
        assert_eq!(body["snapshot"]["state"], "playing");
        write_private(&station_file, br#"{"frequencyKhz":1440}"#);

        // Fresh playing snapshot passes through unchanged.
        let snapshots = f.root.join("now-playing.json");
        let fresh = snapshot("playing", &now(-1_000));
        write_private(&snapshots, fresh.to_string().as_bytes());
        let (_, body, _) = get(&app, &route(3), cookie).await;
        assert_eq!(body["snapshot"], fresh);

        // Stale: withheld.
        let stale = snapshot("playing", &now(-16_000));
        write_private(&snapshots, stale.to_string().as_bytes());
        let (_, body, _) = get(&app, &route(3), cookie).await;
        assert_eq!(body["snapshot"], Value::Null);

        // Malformed, oversize, wrong mode and symlinked snapshots read as no reading.
        let mut malformed = snapshot("stopped", &now(0));
        malformed["volume"] = json!(3);
        let oversize = vec![b' '; crate::config::radio_station::SNAPSHOT_MAX_BYTES as usize + 1];
        for bytes in [
            b"not json".to_vec(),
            malformed.to_string().into_bytes(),
            oversize,
        ] {
            write_private(&snapshots, &bytes);
            let (status, body, _) = get(&app, &route(3), cookie).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["snapshot"], Value::Null);
        }
        write_private(
            &snapshots,
            snapshot("stopped", &now(0)).to_string().as_bytes(),
        );
        fs::set_permissions(&snapshots, fs::Permissions::from_mode(0o644)).unwrap();
        let (_, body, _) = get(&app, &route(3), cookie).await;
        assert_eq!(body["snapshot"], Value::Null);
        let target = f.root.join("elsewhere.json");
        write_private(&target, snapshot("stopped", &now(0)).to_string().as_bytes());
        fs::remove_file(&snapshots).unwrap();
        std::os::unix::fs::symlink(&target, &snapshots).unwrap();
        let (_, body, _) = get(&app, &route(3), cookie).await;
        assert_eq!(body["snapshot"], Value::Null);
        fs::remove_file(&snapshots).unwrap();

        // A fresh stopped snapshot is returned, and no read wrote anything.
        let stopped = snapshot("stopped", &now(0));
        write_private(&snapshots, stopped.to_string().as_bytes());
        let modified = fs::metadata(&snapshots).unwrap().modified().unwrap();
        let (_, body, _) = get(&app, &route(3), cookie).await;
        assert_eq!(body["snapshot"]["state"], "stopped");
        assert_eq!(
            fs::metadata(&snapshots).unwrap().modified().unwrap(),
            modified
        );
        assert_eq!(
            fs::read(&snapshots).unwrap(),
            stopped.to_string().into_bytes()
        );
    }

    #[tokio::test]
    async fn healthy_radio_cover_serves_only_the_verified_named_file() {
        let f = fixture().await;
        let cookie = Some(f.cookie.as_str());
        let app = router(
            f.host
                .clone()
                .with_radio_station(station(&f.root, 3, Value::Null))
                .unwrap(),
        );
        let png = b"\x89PNG\r\n\x1a\nsynthetic cover".to_vec();
        let sha = format!("{:x}", sha2::Sha256::digest(&png));
        let cover_route = |home: u32, sha: &str| {
            format!(
                "/api/atlas/radio/v1/workspaces/{}/homes/{}/covers/{sha}",
                id(2),
                id(home)
            )
        };
        let named = |sha: &str, media: &str, checked: &str| {
            let mut value = snapshot("stopped", checked);
            value["cover"] = json!({"mediaType":media,"sha256":sha});
            write_private(
                &f.root.join("now-playing.json"),
                value.to_string().as_bytes(),
            );
        };
        let fetch = |uri: String, cookie: Option<&str>| {
            let app = app.clone();
            let request = request(&uri, "GET", cookie);
            async move {
                let response = app.oneshot(request).await.unwrap();
                let status = response.status();
                let kind = response
                    .headers()
                    .get("content-type")
                    .map(|v| v.to_str().unwrap().to_owned());
                let cache = response.headers()["cache-control"]
                    .to_str()
                    .unwrap()
                    .to_owned();
                let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
                    .await
                    .unwrap();
                (status, kind, cache, bytes.to_vec())
            }
        };
        // Not named by any snapshot yet.
        write_private(&f.root.join(format!("cover-{sha}.png")), &png);
        assert_eq!(
            fetch(cover_route(3, &sha), cookie).await.0,
            StatusCode::NOT_FOUND
        );
        named(&sha, "image/png", &now(0));
        let (status, kind, cache, bytes) = fetch(cover_route(3, &sha), cookie).await;
        assert_eq!(
            (status, kind.as_deref()),
            (StatusCode::OK, Some("image/png"))
        );
        assert_eq!((cache.as_str(), bytes), ("private, no-store", png.clone()));
        assert_eq!(
            fetch(cover_route(3, &sha), None).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            fetch(cover_route(6, &sha), cookie).await.0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            fetch(cover_route(3, &"b".repeat(64)), cookie).await.0,
            StatusCode::NOT_FOUND
        );
        // A path-like or non-digest request names nothing.
        assert_ne!(
            fetch(cover_route(3, "..%2Fnow-playing.json"), cookie)
                .await
                .0,
            StatusCode::OK
        );
        // Stale snapshot: nothing is served.
        named(&sha, "image/png", &now(-16_000));
        assert_eq!(
            fetch(cover_route(3, &sha), cookie).await.0,
            StatusCode::NOT_FOUND
        );
        // Declared type disagrees with the file name or magic bytes.
        named(&sha, "image/jpeg", &now(0));
        assert_eq!(
            fetch(cover_route(3, &sha), cookie).await.0,
            StatusCode::NOT_FOUND
        );
        // Bytes that do not match their digest, and bytes over 256 KiB.
        named(&sha, "image/png", &now(0));
        write_private(
            &f.root.join(format!("cover-{sha}.png")),
            b"\x89PNG\r\n\x1a\nchanged",
        );
        assert_eq!(
            fetch(cover_route(3, &sha), cookie).await.0,
            StatusCode::NOT_FOUND
        );
        let mut large = b"\x89PNG\r\n\x1a\n".to_vec();
        large.resize(256 * 1024 + 1, 0);
        let large_sha = format!("{:x}", sha2::Sha256::digest(&large));
        write_private(&f.root.join(format!("cover-{large_sha}.png")), &large);
        named(&large_sha, "image/png", &now(0));
        assert_eq!(
            fetch(cover_route(3, &large_sha), cookie).await.0,
            StatusCode::NOT_FOUND
        );
    }
}
