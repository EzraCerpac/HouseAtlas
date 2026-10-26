//! Backup retention in Settings. The nightly iCloud job (tools/backup) shares
//! `<data directory>/backup/` with the server: the server writes the owner's
//! `retention.json`, the job writes its `status.json` and applies the choice on
//! its next verified run. Reading needs a member of a configured home;
//! changing needs Editor in every configured home, because one backup holds
//! all of them.
use super::*;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::Path as FsPath,
};

const NIGHTS: std::ops::RangeInclusive<u16> = 7..=365;
const MONTHS: std::ops::RangeInclusive<u16> = 0..=120;
const STATUS_LIMIT: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "keep", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum Retention {
    /// Nothing is ever deleted; the default.
    Forever {},
    /// The newest backup of each of the last `nights` nights and the first of
    /// each of the last `months` months.
    Recent { nights: u16, months: u16 },
}
impl Retention {
    fn valid(self) -> bool {
        match self {
            Self::Forever {} => true,
            Self::Recent { nights, months } => NIGHTS.contains(&nights) && MONTHS.contains(&months),
        }
    }
}

/// The job's last summary. Fields it adds later are dropped, a file that does
/// not parse reads as no summary.
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    #[serde(default)]
    last_success: Option<Success>,
    #[serde(default)]
    last_failure: Option<Failure>,
    #[serde(default)]
    retention: Option<Retention>,
    #[serde(default)]
    removed: Option<Removed>,
    #[serde(default)]
    stored: Option<Stored>,
    #[serde(default)]
    problem: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Success {
    finished: String,
    recovery_point: String,
    archive_bytes: u64,
    model_bytes_stored: u64,
    offline_seconds: f64,
}
#[derive(Deserialize, Serialize)]
struct Failure {
    at: String,
    step: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Removed {
    archives: u64,
    model_files: u64,
    bytes: u64,
}
#[derive(Deserialize, Serialize)]
struct Stored {
    archives: u64,
    bytes: u64,
}

fn folder(host: &Host) -> Result<Arc<std::path::PathBuf>, HttpFailure> {
    let folder = host
        .backup_folder
        .clone()
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    // The job creates this folder when it first reports. A configured path
    // alone must not advertise backups on a server where no job has run.
    match fs::symlink_metadata(folder.as_ref()) {
        Ok(metadata) if metadata.is_dir() => Ok(folder),
        Ok(_) => Err(failure(StatusCode::NOT_FOUND)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(failure(StatusCode::NOT_FOUND))
        }
        Err(_) => Err(failure(StatusCode::SERVICE_UNAVAILABLE)),
    }
}

/// Anything missing or malformed reads as Forever, exactly as the job reads it.
fn read_retention(folder: &FsPath) -> Retention {
    let Ok(bytes) = fs::read(folder.join("retention.json")) else {
        return Retention::Forever {};
    };
    serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|mut value| {
            value.as_object_mut()?.remove("schemaVersion");
            serde_json::from_value::<Retention>(value).ok()
        })
        .filter(|retention| retention.valid())
        .unwrap_or(Retention::Forever {})
}

fn read_status(folder: &FsPath) -> Option<Status> {
    let file = fs::File::open(folder.join("status.json")).ok()?;
    let mut bytes = Vec::new();
    file.take(STATUS_LIMIT + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > STATUS_LIMIT {
        return None;
    }
    let mut status: Status = serde_json::from_slice(&bytes).ok()?;
    if let Some(problem) = &mut status.problem
        && let Some((cut, _)) = problem.char_indices().nth(400)
    {
        problem.truncate(cut);
    }
    Some(status)
}

/// Written whole under a private temporary name and renamed into place, so
/// the job never reads half a choice.
fn write_retention(folder: &FsPath, retention: Retention) -> std::io::Result<()> {
    if !fs::symlink_metadata(folder)?.is_dir() {
        return Err(std::io::Error::other("backup folder is not a directory"));
    }
    let mut value = serde_json::to_value(retention).map_err(std::io::Error::other)?;
    if let Some(object) = value.as_object_mut() {
        object.insert("schemaVersion".into(), json!(1));
    }
    let partial = folder.join(".retention.json.partial");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&partial)?;
    file.write_all(&serde_json::to_vec_pretty(&value).map_err(std::io::Error::other)?)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&partial, folder.join("retention.json"))
}

fn settings(folder: &FsPath) -> Response {
    json_response(json!({
        "schemaVersion": 1,
        "retention": read_retention(folder),
        "status": read_status(folder),
    }))
}

pub(super) async fn read(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    auth::no_query(&uri)?;
    let folder = folder(&host)?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = auth::url(&host, &uri);
        let observed =
            evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
        let mut access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let choices = capture_homes(&mut access, &observed, &core.homes).map_err(access_error)?;
        if choices.is_empty() {
            return Err(failure(StatusCode::FORBIDDEN));
        }
        let response = settings(&folder);
        for choice in &choices {
            access.revalidate(&choice.principal).map_err(access_error)?;
        }
        Ok(response)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(super) async fn write(State(host): State<Host>, request: Request) -> HttpResult {
    auth::no_query(request.uri())?;
    let folder = folder(&host)?;
    let headers = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let json_body = headers::single(request.headers(), "content-type")
        .ok()
        .flatten()
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/json"))
        });
    if !json_body {
        return Err(failure(StatusCode::UNSUPPORTED_MEDIA_TYPE));
    }
    let uri = request.uri().clone();
    let method = request.method().clone();
    let body = super::admission::body(request.into_body(), 256).await?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = auth::url(&host, &uri);
        let observed =
            evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?;
        let scopes = core
            .homes
            .iter()
            .map(|home| crate::app::access_scope(&home.scope))
            .collect::<a::AccessResult<Vec<_>>>()
            .map_err(access_error)?;
        let mut access = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let principals = access
            .authorize_homes(&observed, &scopes, a::Action::Mutate)
            .map_err(access_error)?
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .filter(|principals| !principals.is_empty())
            .ok_or_else(|| failure(StatusCode::FORBIDDEN))?;
        let retention = serde_json::from_slice::<Retention>(&body)
            .ok()
            .filter(|retention| retention.valid())
            .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
        for principal in &principals {
            access.assert_mutation(principal).map_err(access_error)?;
        }
        write_retention(&folder, retention)
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        Ok(settings(&folder))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::DirBuilderExt;

    fn folder() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn requests_parse_strictly_and_stay_in_bounds() {
        let parse = |body: &str| {
            serde_json::from_slice::<Retention>(body.as_bytes())
                .ok()
                .filter(|r| r.valid())
        };
        assert_eq!(parse(r#"{"keep":"forever"}"#), Some(Retention::Forever {}));
        assert_eq!(
            parse(r#"{"keep":"recent","nights":30,"months":12}"#),
            Some(Retention::Recent {
                nights: 30,
                months: 12
            })
        );
        for bad in [
            r#"{"keep":"recent","nights":6,"months":12}"#,
            r#"{"keep":"recent","nights":30,"months":121}"#,
            r#"{"keep":"recent","nights":30}"#,
            r#"{"keep":"recent","nights":30,"months":12,"extra":1}"#,
            r#"{"keep":"forever","nights":30}"#,
            r#"{"keep":"never"}"#,
            r#"{"keep":"recent","nights":-1,"months":0}"#,
            "[]",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_choice_round_trips_through_the_shared_file() {
        let root = folder();
        let shared = root.path().join("backup");
        assert_eq!(read_retention(&shared), Retention::Forever {});
        assert!(write_retention(&shared, Retention::Forever {}).is_err());
        assert!(!shared.exists());
        fs::DirBuilder::new().mode(0o700).create(&shared).unwrap();
        let recent = Retention::Recent {
            nights: 30,
            months: 12,
        };
        write_retention(&shared, recent).unwrap();
        assert_eq!(read_retention(&shared), recent);
        let stored: Value =
            serde_json::from_slice(&fs::read(shared.join("retention.json")).unwrap()).unwrap();
        assert_eq!(
            stored,
            json!({"schemaVersion":1,"keep":"recent","nights":30,"months":12})
        );
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &FsPath| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            (mode(&shared), mode(&shared.join("retention.json"))),
            (0o700, 0o600)
        );
        assert!(!shared.join(".retention.json.partial").exists());
        fs::write(
            shared.join("retention.json"),
            r#"{"keep":"recent","nights":1,"months":0}"#,
        )
        .unwrap();
        assert_eq!(read_retention(&shared), Retention::Forever {});
    }

    #[test]
    fn the_job_summary_is_read_tolerantly() {
        let root = folder();
        assert!(read_status(root.path()).is_none());
        fs::write(
            root.path().join("status.json"),
            json!({
                "schemaVersion": 1, "laterField": true,
                "lastSuccess": {"finished": "2026-10-27T04:01:10+00:00", "recoveryPoint": "2026-10-27T04:00:00+00:00",
                    "archiveBytes": 1234, "modelBytesStored": 0, "offlineSeconds": 7.2},
                "lastFailure": null, "retention": {"keep": "forever"},
                "removed": {"archives": 0, "modelFiles": 0, "bytes": 0},
                "stored": {"archives": 3, "bytes": 99}, "problem": "x".repeat(1000),
            })
            .to_string(),
        )
        .unwrap();
        let status = serde_json::to_value(read_status(root.path()).unwrap()).unwrap();
        assert_eq!(status["lastSuccess"]["archiveBytes"], json!(1234));
        assert_eq!(status["retention"], json!({"keep": "forever"}));
        assert_eq!(status["problem"].as_str().unwrap().len(), 400);
        assert!(status.get("laterField").is_none());
        fs::write(root.path().join("status.json"), "not json").unwrap();
        assert!(read_status(root.path()).is_none());
    }

    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn request(method: &str, body: &str, session: Option<(&str, Option<&str>)>) -> Request {
        let mut builder = axum::http::Request::builder()
            .method(method)
            .uri(if session.is_some() {
                "/api/atlas/backup/v1/settings"
            } else {
                "/api/atlas/auth/local"
            })
            .header("host", "127.0.0.1:48743")
            .header("origin", "https://127.0.0.1:48743")
            .header("sec-fetch-site", "same-origin")
            .header("content-type", "application/json");
        if let Some((cookie, csrf)) = session {
            builder = builder.header("cookie", cookie);
            if let Some(csrf) = csrf {
                builder = builder.header("x-atlas-csrf", csrf);
            }
        }
        let mut request = builder
            .body(axum::body::Body::from(body.to_owned()))
            .unwrap();
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "127.0.0.1:50123".parse::<std::net::SocketAddr>().unwrap(),
        ));
        request
    }

    #[tokio::test]
    async fn members_read_and_editors_change_the_choice() {
        use std::os::unix::fs::PermissionsExt;
        use tower::ServiceExt;
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
        let shared = root.join("data/backup");
        let host = Host::new(
            core,
            config.origin.clone(),
            Arc::new(BTreeMap::new()),
            vec![],
        )
        .unwrap()
        .with_loopback_local()
        .unwrap();
        let app = router(host.clone().with_backup_folder(shared.clone()));
        let body = |response: Response| async move {
            serde_json::from_slice::<Value>(
                &axum::body::to_bytes(response.into_body(), 65536)
                    .await
                    .unwrap(),
            )
            .unwrap()
        };

        let response = app
            .clone()
            .oneshot(request("POST", "{}", None))
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
        let csrf = body(response).await["csrfToken"]
            .as_str()
            .unwrap()
            .to_owned();
        let signed_in = Some((cookie.as_str(), None));
        let editing = Some((cookie.as_str(), Some(csrf.as_str())));
        let recent = r#"{"keep":"recent","nights":30,"months":12}"#;

        for (method, payload) in [("GET", ""), ("POST", recent)] {
            let response = app
                .clone()
                .oneshot(request(method, payload, editing))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            assert!(!shared.exists());
        }
        fs::DirBuilder::new().mode(0o700).create(&shared).unwrap();

        let response = app
            .clone()
            .oneshot(request("GET", "", signed_in))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body(response).await,
            json!({"schemaVersion":1,"retention":{"keep":"forever"},"status":null})
        );
        let unsigned = app
            .clone()
            .oneshot(request("GET", "", Some(("houseatlas_session=x", None))))
            .await
            .unwrap();
        assert_eq!(unsigned.status(), StatusCode::UNAUTHORIZED);

        let response = app
            .clone()
            .oneshot(request("POST", recent, signed_in))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!shared.join("retention.json").exists());
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                r#"{"keep":"recent","nights":1,"months":0}"#,
                editing,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let response = app
            .clone()
            .oneshot(request("POST", recent, editing))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body(response).await["retention"],
            json!({"keep":"recent","nights":30,"months":12})
        );
        assert_eq!(
            read_retention(&shared),
            Retention::Recent {
                nights: 30,
                months: 12
            }
        );

        let response = router(host)
            .oneshot(request("GET", "", signed_in))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
