//! Positive native HomeBox root composition with real Access, Store and Domain.
//! The in-memory GET peer returns fixed original native bytes; it makes no socket.
use super::homebox_native::execute_with_reader;
use crate::{
    access as a,
    app::{Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store},
    config::providers::homebox::TrustedHomeBoxSource,
    domain as d,
    http::{Host, contracts::NativeContracts},
    lifecycle, media,
    providers::homebox::read as r,
    storage as s,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

struct Body(Option<Vec<u8>>);
impl r::Body for Body {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, r::ReadError> {
        Ok(self.0.take())
    }
}
struct FixedGet {
    detail: Vec<u8>,
    maintenance: Vec<u8>,
    access: Arc<Mutex<a::AccessBoundary>>,
    store: Arc<Mutex<Store>>,
    core: Arc<Mutex<Core>>,
    observed: Arc<Mutex<Vec<String>>>,
}
impl r::Transport for FixedGet {
    type Body = Body;
    async fn get(
        &mut self,
        request: r::GetRequest,
    ) -> Result<r::GetResponse<Self::Body>, r::ReadError> {
        assert!(
            self.access.try_lock().is_ok(),
            "Access lock crossed original GET"
        );
        assert!(
            self.store.try_lock().is_ok(),
            "Store lock crossed original GET"
        );
        assert!(
            self.core.try_lock().is_ok(),
            "Core lock crossed original GET"
        );
        assert_eq!(request.method(), "GET");
        assert!(request.reject_redirects());
        assert_eq!(request.tenant(), id(11));
        let detail_path = format!("/api/v1/entities/{}", id(2));
        let maintenance_path = format!("{detail_path}/maintenance");
        let bytes = if request.path() == detail_path {
            assert!(request.query().is_empty());
            self.detail.clone()
        } else {
            assert_eq!(request.path(), maintenance_path);
            assert_eq!(request.query(), &[("status".into(), "both".into())]);
            self.maintenance.clone()
        };
        self.observed
            .lock()
            .unwrap()
            .push(request.path().to_owned());
        Ok(r::GetResponse {
            status: 200,
            scope: request.scope().clone(),
            redirected: false,
            body: Body(Some(bytes)),
        })
    }
}
struct FixedClock;
impl r::Clock for FixedClock {
    fn now(&self) -> r::Timestamp {
        r::Timestamp::parse("2026-10-08T12:00:00.1200+02:00").unwrap()
    }
}
fn evidence<'a>(method: a::Method, cookie: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/stock",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}

#[test]
fn healthy_native_homebox_root_reads_preserve_original_authority() -> Result<(), lifecycle::Failure>
{
    let scratch = tempfile::Builder::new()
        .prefix("homebox-native-root-")
        .tempdir_in("/tmp")?;
    let directory = std::fs::canonicalize(scratch.path())?;
    let mut fixture = lifecycle::fixture()?;
    fn rebind(value: &mut Value) {
        match value {
            Value::Object(fields) => {
                if fields.get("collectionId") == Some(&json!("synthetic-collection-a")) {
                    fields.insert("collectionId".into(), json!(id(11)));
                }
                for field in fields.values_mut() {
                    rebind(field);
                }
            }
            Value::Array(rows) => {
                for row in rows {
                    rebind(row);
                }
            }
            _ => {}
        }
    }
    rebind(&mut fixture);
    let registration: s::SourceRegistration =
        serde_json::from_value(fixture["sources"][0].clone())?;
    assert_eq!(registration.source_instance_id, id(10));
    assert_eq!(registration.collection_id, id(11));
    let source = TrustedHomeBoxSource::new_stock(
        "https://homebox.synthetic.invalid",
        registration.clone(),
        r::Limits::default(),
        None,
    )?;
    let reader_registration: r::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration)?)?;
    let scope = a::Scope {
        workspace_id: a::CanonicalId::parse(id(1))?,
        home_id: a::CanonicalId::parse(id(2))?,
    };
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec![ORIGIN.into()])?.with_clock(|| 1_800_000_000_000),
    )?;
    let password = "Synthetic-native-root-password-only!";
    let user = a::CanonicalId::parse(id(4))?;
    boundary.provision_user(
        &user,
        &a::CanonicalId::parse(id(5))?,
        "native-root",
        &a::hash_password(password)?,
        None,
    )?;
    boundary.set_membership(&user, &scope, a::Role::Viewer, true)?;
    let access_registration: a::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration)?)?;
    boundary.put_source(&access_registration, None)?;
    let session = boundary.login(
        &evidence(a::Method::Post, None),
        &serde_json::to_vec(&json!({"username":"native-root","password":password}))?,
        "native-root",
    )?;
    let cookie = session
        .set_cookie()
        .split(';')
        .next()
        .ok_or("missing original session cookie")?
        .to_owned();
    let access = Arc::new(Mutex::new(boundary));
    let vault = Arc::new(media::AssetVault::open(&directory.join("media"))?);
    let database = directory.join("atlas.sqlite");
    let runtime = || media::native::NativeMediaRuntime {
        vault: Arc::clone(&vault),
        server: ServerRuntime,
    };
    let mut store = Store::open(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        runtime(),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(fixture)?)?;
    store.close()?;
    let store = Arc::new(Mutex::new(Store::open(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        runtime(),
        s::StoreOptions::default(),
    )?));
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic home".into(),
    };
    let core = Core {
        access: Arc::clone(&access),
        store: Arc::clone(&store),
        atlas_list_pages: d::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault,
        home: home.clone(),
        homes: vec![home],
    };
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
    let mut detail: Value = serde_json::from_str(include_str!(
        "../../providers/homebox/wire/fixtures/item.detail.json"
    ))?;
    detail["fields"] = json!([{"id":id(61),"name":"Captured native number","type":"number","textValue":"","numberValue":9007199254740991_i64,"booleanValue":false}]);
    detail["tags"] = json!([{"id":id(501),"name":"Captured tag"}]);
    let detail_bytes = serde_json::to_vec(&detail)?;
    let mut maintenance: Value = serde_json::from_slice(include_bytes!(
        "../../providers/homebox/wire/fixtures/maintenance.json"
    ))?;
    maintenance
        .as_array_mut()
        .ok_or("missing native maintenance rows")?
        .truncate(2);
    let maintenance_bytes = serde_json::to_vec(&maintenance)?;
    let observed = Arc::new(Mutex::new(Vec::new()));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    for (index, operation) in [
        d::stock::OperationId::HomeboxEntityTagsGet,
        d::stock::OperationId::HomeboxFieldList,
        d::stock::OperationId::HomeboxFieldGet,
        d::stock::OperationId::HomeboxMaintenanceList,
        d::stock::OperationId::HomeboxMaintenanceGet,
    ]
    .into_iter()
    .enumerate()
    {
        let principal = access.lock().unwrap().authorize(
            &evidence(a::Method::Get, Some(&cookie)),
            &scope,
            a::Action::Read,
        )?;
        let p = RequestPrincipal::new(principal);
        let mut reader = r::HomeBoxReader::new_stock(
            reader_registration.clone(),
            FixedGet {
                detail: detail_bytes.clone(),
                maintenance: maintenance_bytes.clone(),
                access: Arc::clone(&access),
                store: Arc::clone(&store),
                core: Arc::clone(&host.core),
                observed: Arc::clone(&observed),
            },
            FixedClock,
            r::Limits::default(),
            None,
        )?;
        let list = matches!(
            operation,
            d::stock::OperationId::HomeboxFieldList | d::stock::OperationId::HomeboxMaintenanceList
        );
        let mut target = json!({"authority":"homebox","sourceInstanceId":id(10),"collectionId":id(11),"resourceKind":operation.operation().resource_kind});
        if operation == d::stock::OperationId::HomeboxEntityTagsGet {
            target["resourceId"] = json!(id(2));
        } else {
            target["entityId"] = json!(id(2));
            if !list {
                target["resourceId"] =
                    json!(id(if operation == d::stock::OperationId::HomeboxFieldGet {
                        61
                    } else {
                        302
                    }));
            }
        }
        let payload = if list {
            json!({"cursor":null,"pageSize":100,"includeArchived":true})
        } else {
            json!({})
        };
        let raw = json!({"schemaVersion":3,"commandId":operation.as_str(),"requestId":id(900+index as u32),"context":{"workspaceId":id(1),"homeId":id(2)},"target":target,"payload":payload});
        let result = execute_with_reader(&host, &p, raw, &source, &mut reader, runtime.handle())?;
        assert!(result.children.is_empty());
        assert_eq!(result.wire["commandId"], operation.as_str());
        assert_eq!(result.wire["data"]["sourceStatus"], "unresolved");
        let resources = result.wire["data"]["resources"]
            .as_array()
            .ok_or("missing native resources")?;
        assert!(!resources.is_empty());
        assert!(
            resources
                .iter()
                .all(|row| row["observation"]["kind"] == "observation-only")
        );
        match operation {
            d::stock::OperationId::HomeboxEntityTagsGet => {
                assert_eq!(resources[0]["target"]["resourceId"], id(2));
                assert_eq!(resources[0]["data"]["tagIds"], json!([id(501)]));
            }
            d::stock::OperationId::HomeboxFieldList | d::stock::OperationId::HomeboxFieldGet => {
                assert!(
                    resources
                        .iter()
                        .any(|row| row["target"]["resourceId"] == id(61)
                            && row["data"]["name"] == "Captured native number")
                );
            }
            d::stock::OperationId::HomeboxMaintenanceList
            | d::stock::OperationId::HomeboxMaintenanceGet => {
                assert!(
                    resources
                        .iter()
                        .any(|row| row["target"]["resourceId"] == id(302)
                            && row["data"]["name"] == "Completed check")
                );
            }
            _ => unreachable!(),
        }
    }
    assert_eq!(observed.lock().unwrap().len(), 5);
    Ok(())
}
