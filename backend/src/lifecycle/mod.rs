//! Minimum healthy fixture setup through the actual module APIs.
use crate::{
    access as a,
    app::{Access, Core, ReadAuthority, ServerRuntime, Store},
    domain as d,
    http::contracts::NativeContracts,
    storage as s,
};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    sync::{Arc, Mutex},
};

pub type Failure = Box<dyn std::error::Error + Send + Sync>;
pub fn fixture() -> Result<Value, Failure> {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    v["sources"]
        .as_array_mut()
        .ok_or("Missing sources")?
        .retain(|s| s["sourceInstanceId"] == "00000000-0000-4000-8000-000000000010");
    let ids = ["100", "200", "201", "300", "301", "400"];
    v["records"]
        .as_array_mut()
        .ok_or("Missing records")?
        .retain(|r| {
            r["recordId"].as_str().is_some_and(|id| {
                ids.iter()
                    .any(|suffix| id == format!("00000000-0000-4000-8000-000000000{suffix}"))
            })
        });
    for r in v["records"].as_array_mut().ok_or("Missing records")? {
        if r["recordType"] == "location-semantics" {
            r["payload"]["semanticKind"] = json!("room");
        }
    }
    v["homeboxEntities"]
        .as_array_mut()
        .ok_or("Missing projections")?
        .truncate(2);
    v["networkRelations"] = json!([]);
    Ok(v)
}
pub fn prepare(directory: &Path, origin: &str) -> Result<Core, Failure> {
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let fixture = fixture()?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: "00000000-0000-4000-8000-000000000001".into(),
            home_id: "00000000-0000-4000-8000-000000000002".into(),
        },
        label: "Synthetic home".into(),
    };
    let scope = crate::app::access_scope(&home.scope)?;
    let access_path = directory.join("access.sqlite");
    let mut access =
        a::AccessBoundary::open(&access_path, a::AccessConfig::new(vec![origin.into()])?)?;
    let user = a::CanonicalId::parse("00000000-0000-4000-8000-000000000004")?;
    let actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000005")?;
    // Disposable synthetic provisioning only. Passwords remain in the private
    // scratch receipt for the inspected healthy browser/HTTP flow; no real
    // account, persistent grant or provider credential is supplied.
    let password = format!("Disposable-{}", crate::app::new_id()?);
    access.provision_user(
        &user,
        &actor,
        "synthetic-viewer",
        &a::hash_password(&password)?,
        None,
    )?;
    access.set_membership(&user, &scope, a::Role::Viewer, true)?;
    let editor_user = a::CanonicalId::parse("00000000-0000-4000-8000-000000000006")?;
    let editor_actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000007")?;
    let editor_password = format!("Disposable-{}", crate::app::new_id()?);
    access.provision_user(
        &editor_user,
        &editor_actor,
        "synthetic-editor",
        &a::hash_password(&editor_password)?,
        None,
    )?;
    access.set_membership(&editor_user, &scope, a::Role::Editor, true)?;
    for source in fixture["sources"].as_array().ok_or("Missing sources")? {
        access.put_source(&serde_json::from_value(source.clone())?, None)?;
    }
    let url = format!("{origin}/api/atlas/auth/login");
    let receipt = access.login(
        &a::RequestEvidence {
            method: a::Method::Post,
            url: &url,
            origin: Some(origin),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: None,
            authorization: None,
            csrf: None,
        },
        &serde_json::to_vec(&json!({"username":"synthetic-viewer", "password":password}))?,
        "disposable-loopback",
    )?;
    let cookie = receipt
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing cookie")?
        .to_owned();
    let mut receipt_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(directory.join("smoke-session.json"))?;
    receipt_file.write_all(&serde_json::to_vec(
        &json!({"origin":origin,"cookie":cookie,
            "login":{"username":"synthetic-viewer","password":password},
            "editorLogin":{"username":"synthetic-editor","password":editor_password}}),
    )?)?;
    receipt_file.sync_all()?;
    drop(receipt);
    drop(access);
    // Reopen both real databases before any HTTP read. No fixture facade caches
    // the snapshot, principal or session for the running application.
    let access: Access = Arc::new(Mutex::new(a::AccessBoundary::open(
        &access_path,
        a::AccessConfig::new(vec![origin.into()])?,
    )?));
    let path = directory.join("atlas.sqlite");
    let mut store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        ServerRuntime,
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(fixture)?)?;
    store.close()?;
    let store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        ServerRuntime,
        s::StoreOptions::default(),
    )?;
    Ok(Core {
        access,
        store,
        homes: vec![home.clone()],
        home,
    })
}
