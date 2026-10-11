//! Same-origin stock host with exact caller envelopes and original AT11 authority.
pub mod capabilities;
mod errors;
pub mod mcp;
pub(crate) mod mcp_transport;
pub mod stock_dispatch;

use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, authorized_read_unlocked, failure, intake,
    json_response,
};
use crate::{domain as d, domain::stock as st};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::json;

pub(super) fn is_stock_response(response: &axum::response::Response) -> bool {
    response
        .extensions()
        .get::<errors::StockResponse>()
        .is_some()
}

pub(super) async fn admission(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(&host, &headers, &uri, &method, Some(d::Scope { workspace_id, home_id }), false, |core, p, home| {
            let mut admitted = capabilities::admitted(core, &p.principal);
            if host.network_bindings.iter().any(|binding| binding.runtime().settings().configured_source().partition().scope() == *p.principal.scope()) {
                admitted.extend(crate::providers::network::SAVED_NETWORK_QUERY_SUPPORT.iter().map(|support| support.agent_operation));
            }
            if host.native_homebox_reads.iter().any(|binding| {
                let partition = binding.source().partition();
                partition.workspace_id == home.scope.workspace_id && partition.home_id == home.scope.home_id
            }) {
                admitted.extend(super::providers::homebox_native::OPERATIONS.into_iter().filter_map(|id| {
                    crate::contracts::stock::OperationId::parse(id.as_str())
                }));
            }
            Ok(json_response(json!({"schemaVersion":3,"scope":home.scope,"commandIds":admitted.iter().map(|id|id.as_str()).collect::<Vec<_>>(),"nativeCommandIds":capabilities::native_admitted(&p.principal).iter().map(|id|id.as_str()).collect::<Vec<_>>(),"revision":"native-stock-host:3","maximumReasonCodePoints":1024})))
        })
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(super) async fn invoke(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    // Auth checks precede decoding the bounded envelope. Query is transport only;
    // no session, principal, scope grant or credential is accepted from it.
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read_unlocked(
            &host,
            &headers,
            &uri,
            &method,
            d::Scope {
                workspace_id,
                home_id,
            },
            |p| {
                let query = uri
                    .query()
                    .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if query.len() > 32_768 {
                    return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
                }
                let mut values = url::form_urlencoded::parse(query.as_bytes());
                let (name, value) = values
                    .next()
                    .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if name != "request" || values.next().is_some() || value.len() > 16_384 {
                    return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
                }
                let raw = intake::json(value.as_bytes())?;
                let contracts =
                    st::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
                let request = st::ValidatedRequest::parse(&contracts, raw.clone())
                    .map_err(super::stock_reads::http_error)?;
                let id = request.request_id();
                if request.is_mutation() {
                    return errors::response(st::StockError::CapabilityDenied, id);
                }
                let result = if crate::providers::network::saved_network_query_support(request.id())
                    .is_some()
                {
                    super::stock_network_reads::execute(&host, p, raw, &contracts).map(Into::into)
                } else if super::providers::homebox_native::OPERATIONS.contains(&request.id()) {
                    super::providers::homebox_native::execute_configured(&host, p, raw, &runtime)
                        .map(Into::into)
                } else {
                    let core = host
                        .core
                        .lock()
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                    stock_dispatch::execute_http_with_downloads(
                        &core,
                        p,
                        raw,
                        &host.atlas_download_handles,
                    )
                };
                match result {
                    Ok(result) => super::stock_reads::qualified_response(result),
                    Err(error) => errors::response(error, id),
                }
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(super) fn command_response(
    core: &crate::app::Core,
    principal: &crate::app::RequestPrincipal,
    raw: serde_json::Value,
) -> HttpResult {
    let contracts = st::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
    let request = st::ValidatedRequest::parse(&contracts, raw.clone())
        .map_err(super::stock_reads::http_error)?;
    let id = request.request_id();
    match stock_dispatch::execute(core, principal, raw) {
        Ok(result) => Ok(json_response(result.wire)),
        Err(error) => errors::response(error, id),
    }
}

/// Keep specialized root adapters on the same validated, sanitized wire3 error
/// boundary as the ordinary command dispatcher.
pub(super) fn command_error(error: st::StockError, request_id: &str) -> HttpResult {
    errors::response(error, request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        access as a,
        app::{Core, ReadAuthority, ServerRuntime},
        http::{contracts::NativeContracts, router},
        media::{AssetVault, native::NativeMediaRuntime},
        storage as s,
        transports::mcp as native_mcp,
    };
    use axum::{
        body::{Body, to_bytes},
        extract::ConnectInfo,
        http::Request,
    };
    use rusqlite::{Connection, OpenFlags};
    use serde_json::Value;
    use std::{
        collections::BTreeMap,
        fs,
        net::SocketAddr,
        os::unix::fs::PermissionsExt,
        path::Path,
        sync::{Arc, Mutex},
    };
    use tower::ServiceExt;

    const ORIGIN: &str = "https://admission.synthetic.invalid";
    const PASSWORD: &str = "Synthetic-admission-password-only!";
    fn id(n: u32) -> a::CanonicalId {
        a::CanonicalId::parse(format!("00000000-0000-4000-8000-{n:012}")).unwrap()
    }
    fn request_evidence<'a>(cookie: Option<&'a str>) -> a::RequestEvidence<'a> {
        a::RequestEvidence {
            method: if cookie.is_some() {
                a::Method::Get
            } else {
                a::Method::Post
            },
            url: "https://admission.synthetic.invalid/api/atlas/auth/login",
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie,
            authorization: None,
            csrf: None,
        }
    }
    // Counts only: no credential or session bytes leave the synthetic fixture.
    fn table_counts(path: &Path) -> Vec<(String, i64)> {
        let connection =
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        tables
            .into_iter()
            .map(|name| {
                let count = connection
                    .query_row(
                        &format!("SELECT count(*) FROM \"{}\"", name.replace('"', "\"\"")),
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                (name, count)
            })
            .collect()
    }
    async fn mcp_tools(core: &Core, principal: &a::Principal) -> Value {
        let (adapter, mut session) = mcp::bind_read(core, principal.clone()).await.unwrap();
        let initialized = adapter
            .handle(
                &mut session,
                &serde_json::to_vec(&json!({
                    "jsonrpc":"2.0", "id":1, "method":"initialize", "params":{
                        "protocolVersion":native_mcp::PROTOCOL_VERSION, "capabilities":{},
                        "clientInfo":{"name":"Synthetic native admission", "version":"1"}
                    }
                }))
                .unwrap(),
            )
            .await
            .unwrap();
        let initialized: Value = serde_json::from_slice(&initialized).unwrap();
        assert_eq!(
            initialized["result"]["protocolVersion"],
            native_mcp::PROTOCOL_VERSION
        );
        assert!(
            adapter
                .handle(
                    &mut session,
                    &serde_json::to_vec(&json!({
                        "jsonrpc":"2.0", "method":"notifications/initialized"
                    }))
                    .unwrap()
                )
                .await
                .is_none()
        );
        let listed = adapter
            .handle(
                &mut session,
                &serde_json::to_vec(&json!({
                    "jsonrpc":"2.0", "id":2, "method":"tools/list", "params":{}
                }))
                .unwrap(),
            )
            .await
            .unwrap();
        let listed: Value = serde_json::from_slice(&listed).unwrap();
        session.close();
        listed["result"]["tools"].clone()
    }

    /// One synthetic authenticated GET per existing role; no native mutation,
    /// listener, provider or new runtime grant/configuration is exercised.
    #[tokio::test]
    async fn native_http_admission_keeps_stock_and_mcp_separate() {
        let temporary = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let access_path = root.join("access.sqlite");
        let native_path = root.join("atlas.sqlite");
        let scope = a::Scope {
            workspace_id: id(1),
            home_id: id(2),
        };
        let mut access = a::AccessBoundary::open(
            &access_path,
            a::AccessConfig::new(vec![ORIGIN.into()])
                .unwrap()
                .with_clock(|| 1_800_000_000_000),
        )
        .unwrap();
        let verifier = a::hash_password(PASSWORD).unwrap();
        let mut callers = Vec::new();
        for (user, actor, username, role) in [
            (3, 4, "synthetic-viewer", a::Role::Viewer),
            (5, 6, "synthetic-editor", a::Role::Editor),
        ] {
            // Explicit fixture provisioning precedes the metadata observations.
            access
                .provision_user(&id(user), &id(actor), username, &verifier, None)
                .unwrap();
            access
                .set_membership(&id(user), &scope, role, true)
                .unwrap();
            let login = access
                .login(
                    &request_evidence(None),
                    &serde_json::to_vec(&json!({
                        "username":username, "password":PASSWORD
                    }))
                    .unwrap(),
                    "synthetic-admission",
                )
                .unwrap();
            let cookie = login.set_cookie().split(';').next().unwrap().to_owned();
            let principal = access
                .authorize(&request_evidence(Some(&cookie)), &scope, a::Action::Read)
                .unwrap();
            callers.push((cookie, principal));
        }
        let access = Arc::new(Mutex::new(access));
        let vault = Arc::new(AssetVault::open(&root.join("vault")).unwrap());
        let store = s::AtlasStore::open(
            &native_path,
            NativeContracts,
            ReadAuthority(Arc::clone(&access)),
            NativeMediaRuntime {
                vault: Arc::clone(&vault),
                server: ServerRuntime,
            },
            s::StoreOptions::default(),
        )
        .unwrap();
        let home = d::HomeSummary {
            scope: d::Scope {
                workspace_id: scope.workspace_id.as_str().into(),
                home_id: scope.home_id.as_str().into(),
            },
            label: "Synthetic home".into(),
        };
        let core = Core {
            access,
            store: Arc::new(Mutex::new(store)),
            atlas_list_pages: d::stock::AtlasListPages::default(),
            media_policy_evidence: Mutex::new(
                crate::media::recovery_policy::MediaPolicyEvidence::default(),
            ),
            vault,
            home: home.clone(),
            homes: vec![home.clone()],
        };
        let stock_before: Vec<_> = callers
            .iter()
            .map(|(_, principal)| {
                capabilities::admitted(&core, principal)
                    .iter()
                    .map(|id| id.as_str())
                    .collect::<Vec<_>>()
            })
            .collect();
        let mut mcp_before = Vec::new();
        for (_, principal) in &callers {
            mcp_before.push(mcp_tools(&core, principal).await);
        }
        let access_before = table_counts(&access_path);
        let native_before = table_counts(&native_path);
        let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![]).unwrap();
        let app = router(host.clone());
        let path = format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}/admission",
            scope.workspace_id.as_str(),
            scope.home_id.as_str()
        );
        for (index, (cookie, principal)) in callers.iter().enumerate() {
            let mut request = Request::builder()
                .method("GET")
                .uri(&path)
                .header("host", "admission.synthetic.invalid")
                .header("origin", ORIGIN)
                .header("sec-fetch-site", "same-origin")
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap();
            request.extensions_mut().insert(ConnectInfo(
                "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
            ));
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let admission: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap())
                    .unwrap();
            assert_eq!(admission["scope"], json!(home.scope));
            assert_eq!(admission["schemaVersion"], 3);
            assert_eq!(admission["revision"], "native-stock-host:3");
            assert_eq!(admission["maximumReasonCodePoints"], 1024);
            assert_eq!(admission["commandIds"], json!(stock_before[index]));
            assert!(!stock_before[index].contains(&"atlas.asset.create"));
            assert!(!stock_before[index].contains(&"atlas.scene-association.create"));
            assert_eq!(
                admission["nativeCommandIds"],
                if principal.role() == a::Role::Editor {
                    json!(["atlas.asset.create", "atlas.scene-association.create"])
                } else {
                    json!([])
                }
            );
        }
        drop(app);
        let core = Arc::try_unwrap(host.core)
            .ok()
            .expect("Synthetic HTTP owner retired")
            .into_inner()
            .unwrap();
        for (index, (_, principal)) in callers.iter().enumerate() {
            assert_eq!(
                capabilities::admitted(&core, principal)
                    .iter()
                    .map(|id| id.as_str())
                    .collect::<Vec<_>>(),
                stock_before[index]
            );
            assert_eq!(mcp_tools(&core, principal).await, mcp_before[index]);
        }
        // Metadata introduced no users, memberships, sessions, source grants,
        // configuration or native records; pre-existing rate values may advance.
        assert_eq!(table_counts(&access_path), access_before);
        assert_eq!(table_counts(&native_path), native_before);
    }
}
