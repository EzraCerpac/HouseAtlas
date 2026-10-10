//! Minimum healthy fixture setup through the actual module APIs.
pub mod ai_account;
pub mod persistent;
pub mod provider_dispatch;
pub mod receipt_compatibility;
pub mod providers {
    pub mod authority;
    pub mod homebox_refresh;
    pub mod network;
}
pub mod recovery {
    pub mod host;
    pub mod queued_upload_catalog_media_policy;
    pub mod queued_upload_catalog_reopen;
    pub mod reopen;
    pub mod upload_history_intake;
    pub mod upload_history_validation;
}
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
/// Trusted settings for the same public disposable fixture used by prepare.
/// The metadata origin is never contacted; cached reads create no provider.
pub fn cached_homebox_sources()
-> Result<Vec<crate::config::providers::homebox::TrustedHomeBoxSource>, Failure> {
    cached_homebox_sources_with_profile(crate::config::FixtureProfile::Standard)
}
pub fn cached_homebox_sources_with_profile(
    profile: crate::config::FixtureProfile,
) -> Result<Vec<crate::config::providers::homebox::TrustedHomeBoxSource>, Failure> {
    let fixture = fixture_with_profile(profile)?;
    let registration = serde_json::from_value(
        fixture["sources"]
            .as_array()
            .ok_or("Missing fixture registrations")?
            .first()
            .ok_or("Missing fixture HomeBox registration")?
            .clone(),
    )?;
    Ok(vec![
        crate::config::providers::homebox::TrustedHomeBoxSource::new(
            "https://homebox.example.invalid",
            registration,
            crate::providers::homebox::read::Limits::default(),
            None,
        )?,
    ])
}
pub fn fixture() -> Result<Value, Failure> {
    fixture_with_profile(crate::config::FixtureProfile::Standard)
}
pub fn fixture_with_profile(profile: crate::config::FixtureProfile) -> Result<Value, Failure> {
    let geometry_metadata = profile == crate::config::FixtureProfile::GeometryMetadata;
    let snapshot = if geometry_metadata {
        include_str!("../../../packages/contracts/fixtures/optional-geometry.snapshot.json")
    } else {
        include_str!("../../../packages/contracts/fixtures/plan-free.snapshot.json")
    };
    let mut v: Value = serde_json::from_str(snapshot)?;
    v["sources"]
        .as_array_mut()
        .ok_or("Missing sources")?
        .retain(|s| {
            s["sourceInstanceId"] == "00000000-0000-4000-8000-000000000010"
                || (geometry_metadata
                    && s["sourceInstanceId"] == "00000000-0000-4000-8000-000000000013")
        });
    // Keep the standard six records and the public missing/blocked original
    // plus its unchanged metadata only. No original file or shapes are added.
    let ids: &[&str] = if geometry_metadata {
        &["100", "200", "201", "300", "301", "400", "600", "601"]
    } else {
        &["100", "200", "201", "300", "301", "400"]
    };
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
    if profile == crate::config::FixtureProfile::OpaqueCachedHomebox {
        // A fixed public healthy fixture, not caller-selected provider settings.
        // Change every exact source key before native bootstrap, including the
        // unverified native-link descriptors; dates and other facts stay intact.
        fn rebind(value: &mut Value) -> usize {
            match value {
                Value::Object(fields) => {
                    let matched = fields.get("sourceInstanceId")
                        == Some(&json!("00000000-0000-4000-8000-000000000010"))
                        && fields.get("collectionId") == Some(&json!("synthetic-collection-a"));
                    if matched {
                        fields.insert("collectionId".into(), json!("Synthetic / cache? α + %"));
                    }
                    usize::from(matched) + fields.values_mut().map(rebind).sum::<usize>()
                }
                Value::Array(values) => values.iter_mut().map(rebind).sum(),
                _ => 0,
            }
        }
        if rebind(&mut v) != 8 {
            return Err("Unexpected public fixture source topology".into());
        }
    }
    Ok(v)
}
pub fn prepare(directory: &Path, origin: &str) -> Result<Core, Failure> {
    prepare_with_profile(directory, origin, crate::config::FixtureProfile::Standard)
}
pub fn prepare_with_profile(
    directory: &Path,
    origin: &str,
    profile: crate::config::FixtureProfile,
) -> Result<Core, Failure> {
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let canonical_directory = fs::canonicalize(directory)?;
    let directory = canonical_directory.as_path();
    let fixture = fixture_with_profile(profile)?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: "00000000-0000-4000-8000-000000000001".into(),
            home_id: "00000000-0000-4000-8000-000000000002".into(),
        },
        label: "Synthetic home".into(),
    };
    let scope = crate::app::access_scope(&home.scope)?;
    // Supply the actual trusted directory identity to the media owner. Hosted
    // temporary roots can have a system-level alias; the owner's strict
    // canonical-path, inode and private-mode checks remain unchanged.
    let vault_root = directory.join("media");
    let vault = Arc::new(
        crate::media::AssetVault::open(&vault_root)
            .map_err(|error| format!("Disposable media vault initialization failed: {error}"))?,
    );
    let media_scope = crate::media::types::Scope {
        workspace_id: home.scope.workspace_id.clone(),
        home_id: home.scope.home_id.clone(),
    };
    // Public independently encoded 2x2 PNG and ordinary synthetic UTF-8 text.
    // Prepare real immutable originals only; availability is committed later by
    // the healthy HTTP write through the actual storage/runtime proof callback.
    use base64::Engine as _;
    let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAG3RFWHRmaXh0dXJlAHN5bnRoZXRpYyBvd25lZCBQTke6HUyAAAAAEklEQVR4nGP4z8DwHwyBNBgAAEnICff5q7YNAAAAAElFTkSuQmCC")?;
    let text = b"Synthetic owned original.\n".to_vec();
    let mut prepared_media = Vec::new();
    for (asset_id, content_type, bytes) in [
        (
            "00000000-0000-4000-8000-000000000950",
            crate::media::types::ContentType::Png,
            png,
        ),
        (
            "00000000-0000-4000-8000-000000000951",
            crate::media::types::ContentType::Text,
            text,
        ),
    ] {
        let budget = crate::media::WorkBudget::new(
            std::time::Duration::from_secs(10),
            crate::media::Cancellation::default(),
        )?;
        let prepared = vault
            .prepare_original(
                &media_scope,
                crate::media::types::AssetPurpose::EvidenceOriginal,
                content_type,
                &mut bytes.as_slice(),
                &budget,
            )
            .map_err(|error| format!("Disposable original preparation failed: {error}"))?;
        let payload = prepared.with_provenance(
            crate::media::types::SourceLicense {
                status: crate::media::types::LicenseStatus::Unknown,
                reference: None,
            },
            vec!["00000000-0000-4000-8000-000000000100".into()],
        )?;
        prepared_media.push(json!({"assetId":asset_id,"payload":payload,"originalBase64":base64::engine::general_purpose::STANDARD.encode(bytes)}));
    }
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
            "editorLogin":{"username":"synthetic-editor","password":editor_password},
            "preparedMedia":prepared_media}),
    )?)?;
    receipt_file.sync_all()?;
    drop(receipt);
    drop(access);
    // Reopen both real databases before any HTTP read. No fixture facade caches
    // the snapshot, principal or session for the running application.
    let access: Access = Arc::new(Mutex::new(a::AccessBoundary::open_existing(
        &access_path,
        a::AccessConfig::new(vec![origin.into()])?,
    )?));
    let path = directory.join("atlas.sqlite");
    let mut store = Store::open(
        &path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        crate::media::native::NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
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
        crate::media::native::NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        s::StoreOptions::default(),
    )?;
    Ok(Core {
        access,
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: crate::domain::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault,
        homes: vec![home.clone()],
        home,
    })
}
