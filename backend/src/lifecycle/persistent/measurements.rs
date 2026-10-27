//! Explicit strict composition of an ALREADY compatible measurement image.
//! No conversion, receipt issuer, provisioning, startup principal or default.
use super::{Failure, ServerLease, private_directory, private_metadata};
use crate::{
    access as a,
    app::measurement_assertions::{
        MeasurementOwners, configured_occurrence::ConfiguredOccurrences,
    },
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::{
        atlas_scene::ServerAtlasSceneSelection,
        measurement_profile::{STATE_RECEIPT, SelectedMeasurements},
        model_overview::ServerModelOverviewSelection,
        server::{ServerConfig, read_selected_file},
    },
    http::{Host, contracts::NativeContracts},
    media, storage as s,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::MetadataExt,
    path::PathBuf,
    sync::{Arc, Mutex},
};

/// Retains the exact original publication allocations also installed on Host.
pub struct PreparedMeasurements {
    selected: SelectedMeasurements,
    scene: Arc<ServerAtlasSceneSelection>,
    overview: Arc<ServerModelOverviewSelection>,
    authority: Arc<ConfiguredOccurrences>,
}
pub struct MeasurementMount {
    binding: s::MeasurementBinding,
    scene: Arc<ServerAtlasSceneSelection>,
    overview: Arc<ServerModelOverviewSelection>,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistentBinding {
    format: String,
    configuration_digest: String,
    native_schema: u32,
    access_schema: i64,
    access_device: u64,
    access_inode: u64,
    atlas_device: u64,
    atlas_inode: u64,
    lineage: String,
    catalog_version: u32,
    catalog_sha256: String,
    measurement_contract: String,
    document_contract: String,
    input_set_sha256: String,
}
impl PreparedMeasurements {
    /// Captures bounded pinned INPUTS; creates no session or native admission.
    pub fn capture(
        selected: SelectedMeasurements,
        scene: Arc<ServerAtlasSceneSelection>,
        overview: Arc<ServerModelOverviewSelection>,
    ) -> Result<Self, Failure> {
        scene.verify(&overview)?;
        let authority = ConfiguredOccurrences::capture(&selected, scene.clone(), overview.clone())?;
        Ok(Self {
            selected,
            scene,
            overview,
            authority,
        })
    }
    /// Both TLS and Unix startup must use THIS same opener and then into_host.
    /// A separate reviewed Document source policy remains independently required.
    pub fn reopen(
        self,
        config: &ServerConfig,
        policy: Arc<dyn s::geodata::GeodataSourcePolicy>,
    ) -> Result<(Core, ServerLease, MeasurementMount), Failure> {
        self.selected.validate_config(config)?;
        self.overview.validate_config(config)?;
        let lease = ServerLease::acquire(config, false)?;
        super::super::receipt_compatibility::require_no_pending(config)?;
        match fs::symlink_metadata(config.data_directory.join("server-state.rebind.pending")) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => return Err("Incomplete state rebind requires reviewed recovery".into()),
            Err(e) => return Err(e.into()),
        }
        let access_path = config.data_directory.join("access.sqlite");
        let atlas_path = config.data_directory.join("atlas.sqlite");
        let before_access = private_metadata(&access_path)?;
        let before_atlas = private_metadata(&atlas_path)?;
        let expected = binding(config, &self.selected)?;
        let bytes =
            read_selected_file(&config.data_directory.join(STATE_RECEIPT), 16 * 1024, true)?;
        if media::types::sha256(&bytes) != self.selected.state_receipt_sha256() {
            return Err("Measurement persistent binding custody pin changed".into());
        }
        let value = crate::contracts::v2::parse_value(&bytes)?;
        let recorded: PersistentBinding = serde_json::from_value(value)?;
        if recorded != expected {
            return Err(
                "Measurement state/configuration/input binding changed; no automatic adoption"
                    .into(),
            );
        }
        for database in [&access_path, &atlas_path] {
            for suffix in ["-wal", "-shm", "-journal"] {
                let sidecar = PathBuf::from(format!(
                    "{}{suffix}",
                    database.to_str().ok_or("Invalid database path")?
                ));
                match fs::symlink_metadata(&sidecar) {
                    Ok(_) => {
                        private_metadata(&sidecar)?;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
        }
        for directory in ["media", "media/blobs", "media/staging"] {
            private_directory(&config.data_directory.join(directory))?;
        }
        // Existing only: never create even an empty vault to disguise absence.
        let vault = Arc::new(media::AssetVault::open_existing(
            &config.data_directory.join("media"),
        )?);
        let mut access = a::AccessBoundary::open_existing(&access_path, config.access_config()?)?;
        if !config.authentication.is_password() {
            access.validate_loopback_local_user()?;
        }
        let access = Arc::new(Mutex::new(access));
        let documents = s::geodata::GeodataOwners::new(access.clone(), vault.clone(), policy);
        let owners = MeasurementOwners::new(access.clone(), vault.clone(), self.authority.clone());
        let queues = super::super::backup::QueueFreeNativeOwners::for_queue_free_profile()?;
        let stock = crate::domain::stock::NativeStockContract::new()?;
        let peers = s::RecoveryValidationPeers {
            stock: &stock,
            queues: &[],
            discovery: &queues,
            evidence: &queues,
        };
        // The actual combined validator qualifies native/Document/media rows,
        // complete immutable receipts and required ancestry before any session.
        // Optional historical unknown producers stay opaque recorded context.
        let (store, binding) = Store::open_existing_measurements(s::MeasurementOpenInput {
            path: &atlas_path,
            selection: s::MeasurementProfileSelection::MeasurementsV1,
            contract: NativeContracts,
            authorization: ReadAuthority(access.clone()),
            runtime: media::native::NativeMediaRuntime {
                vault: vault.clone(),
                server: ServerRuntime,
            },
            options: s::StoreOptions::default(),
            documents,
            owners,
            peers: &peers,
            evidence: self.authority.as_ref(),
            check: &mut || Ok(()),
        })?;
        lease.check()?;
        for (path, before) in [(&access_path, &before_access), (&atlas_path, &before_atlas)] {
            let after = private_metadata(path)?;
            if (before.dev(), before.ino()) != (after.dev(), after.ino()) {
                return Err("Persistent database identity changed".into());
            }
        }
        if crate::media::types::sha256(&read_selected_file(
            &config.data_directory.join(STATE_RECEIPT),
            16 * 1024,
            true,
        )?) != self.selected.state_receipt_sha256()
        {
            return Err("Persistent measurement binding changed during open".into());
        }
        let homes = config.home_summaries();
        let core = Core {
            access,
            store: Arc::new(Mutex::new(store)),
            vault,
            home: homes[0].clone(),
            homes,
            atlas_list_pages: Default::default(),
            media_policy_evidence: Mutex::default(),
        };
        Ok((
            core,
            lease,
            MeasurementMount {
                binding,
                scene: self.scene,
                overview: self.overview,
            },
        ))
    }
}
fn binding(
    config: &ServerConfig,
    selected: &SelectedMeasurements,
) -> Result<PersistentBinding, Failure> {
    let access = private_metadata(&config.data_directory.join("access.sqlite"))?;
    let atlas = private_metadata(&config.data_directory.join("atlas.sqlite"))?;
    Ok(PersistentBinding {
        format: "houseatlas-persistent-measurements-server/1".into(),
        configuration_digest: config.state_digest()?,
        native_schema: s::DATABASE_VERSION,
        access_schema: a::ACCESS_SCHEMA_VERSION,
        access_device: access.dev(),
        access_inode: access.ino(),
        atlas_device: atlas.dev(),
        atlas_inode: atlas.ino(),
        lineage: "houseatlas-rust-storage/geodata-measurements/1".into(),
        catalog_version: 1,
        catalog_sha256: s::measurement_catalog_pin()?,
        measurement_contract: crate::contracts::measurement_assertions::VERSION.into(),
        document_contract: s::geodata_full::CONTRACT.into(),
        input_set_sha256: selected.input_set_sha256().into(),
    })
}
impl MeasurementMount {
    pub fn into_host(
        self,
        core: Core,
        origin: String,
        files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
    ) -> Result<Host, Failure> {
        let mut host = Host::new(core, origin, files, vec![])?
            .with_measurements(self.binding)?
            .with_measurement_publication_owners(self.overview, self.scene)?;
        // Informational availability hint ONLY AFTER real same-instance Host
        // composition succeeds. It grants no target, source or write authority.
        let files = Arc::make_mut(&mut host.files);
        let (_, bytes) = files
            .get_mut("/index.html")
            .ok_or("Missing frontend React root")?;
        let html = std::str::from_utf8(bytes)?;
        if html.matches("id=\"root\"").count() != 1 || html.contains("data-measurements-profile") {
            return Err("Ambiguous measurement availability hint".into());
        }
        *bytes = html
            .replace(
                "id=\"root\"",
                "id=\"root\" data-measurements-profile=\"measurements-v1\"",
            )
            .into_bytes();
        Ok(host)
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! FROZEN fixture source. Access to the EXISTING genuine generator is a
    //! separately proposed cfg(test) facade; no permissive authority substitute.
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        extract::ConnectInfo,
        http::{Request, StatusCode},
    };
    use serde_json::{Value, json};
    use std::{os::unix::fs::PermissionsExt, path::Path};
    use tower::ServiceExt;
    pub struct GeneratedImage {
        pub temp: tempfile::TempDir,
        pub config: ServerConfig,
        pub selected: SelectedMeasurements,
        pub scene: Arc<ServerAtlasSceneSelection>,
        pub overview: Arc<ServerModelOverviewSelection>,
        pub selector: Value,
        pub extra_selectors: Vec<Value>,
        pub policy: Arc<dyn s::geodata::GeodataSourcePolicy>,
        pub cookie: String,
        pub csrf: String,
    }
    pub enum GeneratedCase {
        Single,
        TwoParts,
        TwoPublications { withhold_old: bool },
    }
    pub struct GeneratedInput {
        pub export: Vec<u8>,
        pub retained: bool,
        pub overview_path: PathBuf,
        pub overview_sha256: String,
        pub scene_path: PathBuf,
        pub scene_sha256: String,
    }
    pub fn generated_document_policy(
        scope: &s::Scope,
    ) -> Result<Arc<dyn s::geodata::GeodataSourcePolicy>, Failure> {
        // Exact generated policy input used by the existing genuine fixture.
        // It is independently decoded by the real Document policy owner, never
        // substituted with a callback returning success for arbitrary sources.
        let id = |n: u64| format!("00000000-0000-4000-8000-{n:012x}");
        Ok(Arc::new(
            s::geodata_policy::PinnedGeodataSourcePolicy::decode_reviewed(&serde_json::to_vec(
                &json!({"profile":"houseatlas.reviewed-document-source-policy.v1","scope":scope,
            "sourceManifestSha256":"ab".repeat(32),"documents":[{"documentId":id(1400),"original":{"assetId":id(1401),"revision":1,"sha256":"cd".repeat(32),"bytes":2},"contentType":"application/json",
            "provenance":{"agency":"Generated unused source policy","url":"https://source.invalid/generated","license":{"status":"permitted","reference":"CC0-1.0"},"retrievedAt":"2026-10-24T00:00:00Z","published":null,"observed":null,"frame":{"crs":null,"axes":[],"linearUnit":null,"extent":null}}}]}),
            )?)?,
        ))
    }
    fn private(path: &Path, bytes: &[u8]) -> Result<(), Failure> {
        fs::write(path, bytes)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(())
    }
    impl GeneratedImage {
        /// Called ONLY by the proposed existing-generator facade AFTER dropping
        /// its real Access/Store/lease owners. Copies generated Access bytes;
        /// this never runs in production or takes a household recovery image.
        pub fn from_closed_generated_parts(
            temp: tempfile::TempDir,
            scene: Arc<ServerAtlasSceneSelection>,
            overview: Arc<ServerModelOverviewSelection>,
            inputs: Vec<GeneratedInput>,
            selector: Value,
            cookie: String,
            csrf: String,
            policy: Arc<dyn s::geodata::GeodataSourcePolicy>,
        ) -> Result<Self, Failure> {
            let root = fs::canonicalize(temp.path())?;
            let data = root.join("measurement-image");
            // The generated measurement image already exists with genuine
            // native review receipts, actual COPY ancestry and media closure.
            for suffix in ["-wal", "-shm", "-journal"] {
                if fs::symlink_metadata(root.join(format!("data/access.sqlite{suffix}"))).is_ok() {
                    return Err(
                        "Generated Access must be completely closed before fixture copy".into(),
                    );
                }
            }
            fs::copy(root.join("data/access.sqlite"), data.join("access.sqlite"))?;
            fs::set_permissions(
                data.join("access.sqlite"),
                fs::Permissions::from_mode(0o600),
            )?;
            fs::create_dir(data.join("logs"))?;
            fs::set_permissions(data.join("logs"), fs::Permissions::from_mode(0o700))?;
            private(&data.join("server.lock"), b"")?;
            private(&data.join("logs/server.events.jsonl"), b"")?;
            let mut config: ServerConfig = serde_json::from_value(
                json!({"schemaVersion":1,"deploymentId":"00000000-0000-4000-8000-000000000001","dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),
                "frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused-cert.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743",
                "homes":[{"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003","label":"Generated measurement home"}],"mcpCommands":"read-only",
                "authentication":{"mode":"loopback-local","identity":{"userId":"00000000-0000-4000-8000-000000000004","actorId":"00000000-0000-4000-8000-000000000005","username":"synthetic-local","scope":{"workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003"}}}}),
            )?;
            config.data_directory = data.clone();
            config.log_directory = data.join("logs");
            let mut descriptors = Vec::new();
            let mut extra_selectors = Vec::new();
            for (index, input) in inputs.into_iter().enumerate() {
                let path = root.join(format!("configured-export-{index}.json"));
                private(&path, &input.export)?;
                let export = json!({"path":path,"sha256":media::types::sha256(&input.export)});
                if input.retained {
                    descriptors.push(json!({"owner":"retained-publication","export":export,
                    "overview":{"path":input.overview_path,"sha256":input.overview_sha256},"scene":{"path":input.scene_path,"sha256":input.scene_sha256}}));
                } else {
                    let doc: Value = serde_json::from_slice(&input.export)?;
                    let mut s = json!({});
                    let mut t = doc["target"].clone();
                    t["selectionRevision"] = json!(scene.revision);
                    for key in [
                        "buildingId",
                        "roomId",
                        "levelId",
                        "occurrenceId",
                        "publicationId",
                        "selectionRevision",
                        "semanticsSha256",
                        "overviewManifestSha256",
                    ] {
                        s[key] = t[key].clone();
                    }
                    if s != selector {
                        extra_selectors.push(s);
                    }
                    descriptors.push(json!({"owner":"current","export":export}));
                }
            }
            let selection = root.join("measurements-selection.json");
            let write_selection = |receipt: &str| -> Result<SelectedMeasurements, Failure> {
                let bytes = serde_json::to_vec(
                    &json!({"format":"houseatlas.measurements-runtime-selection.v1","profile":"measurements-v1","stateReceiptSha256":receipt,"exports":descriptors}),
                )?;
                private(&selection, &bytes)?;
                match crate::config::measurement_profile::ServerMeasurementSelection::read_pinned(&selection,&media::types::sha256(&bytes))?{
                    crate::config::measurement_profile::ServerMeasurementSelection::MeasurementsV1(v)=>Ok(v),_=>Err("Generated selection disabled".into())}
            };
            // Test-only receipt construction from actual file identities. No
            // production binding/provisioning/convert API is exposed.
            let preliminary = write_selection(&"00".repeat(32))?;
            let receipt = serde_json::to_vec(&binding(&config, &preliminary)?)?;
            private(&data.join(STATE_RECEIPT), &receipt)?;
            let selected = write_selection(&media::types::sha256(&receipt))?;
            Ok(Self {
                temp,
                config,
                selected,
                scene,
                overview,
                selector,
                extra_selectors,
                policy,
                cookie,
                csrf,
            })
        }
        fn prepared(&self) -> Result<PreparedMeasurements, Failure> {
            PreparedMeasurements::capture(
                self.selected.clone(),
                self.scene.clone(),
                self.overview.clone(),
            )
        }
        fn opened(&self) -> Result<(axum::Router, Arc<Mutex<Core>>, ServerLease), Failure> {
            let (core, lease, mount) =
                self.prepared()?.reopen(&self.config, self.policy.clone())?;
            let files = Arc::new(BTreeMap::from([(
                "/index.html".into(),
                ("text/html".into(), b"<div id=\"root\"></div>".to_vec()),
            )]));
            let host = mount
                .into_host(core, self.config.origin.clone(), files)?
                .with_loopback_local()?;
            let core = host.core.clone();
            Ok((crate::http::router(host), core, lease))
        }
        fn prefix(&self) -> String {
            format!(
                "/api/atlas/measurements/v1/workspaces/{}/homes/{}",
                self.config.homes[0].workspace_id.as_str(),
                self.config.homes[0].home_id.as_str()
            )
        }
        async fn exchange(
            &self,
            app: &axum::Router,
            method: &str,
            suffix: &str,
            body: Value,
        ) -> Result<(StatusCode, Value), Failure> {
            let path = if suffix.starts_with("/api/") {
                suffix.to_owned()
            } else {
                format!("{}{suffix}", self.prefix())
            };
            let mut request = Request::builder()
                .method(method)
                .uri(path)
                .header("host", "127.0.0.1:48743")
                .header("origin", &self.config.origin)
                .header("sec-fetch-site", "same-origin")
                .header("accept", "application/json")
                .header("cookie", &self.cookie);
            if method == "POST" {
                request = request
                    .header("content-type", "application/json")
                    .header("x-atlas-csrf", &self.csrf);
            }
            let mut request = request.body(if method == "POST" {
                Body::from(serde_json::to_vec(&body)?)
            } else {
                Body::empty()
            })?;
            request.extensions_mut().insert(ConnectInfo(
                "127.0.0.1:50123".parse::<std::net::SocketAddr>()?,
            ));
            let response = app.clone().oneshot(request).await?;
            let status = response.status();
            let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024).await?;
            Ok((status, serde_json::from_slice(&bytes)?))
        }
        async fn admitted(&self, app: &axum::Router, selector: &Value) -> Result<Value, Failure> {
            let scope = json!({"workspaceId":self.config.homes[0].workspace_id.as_str(),"homeId":self.config.homes[0].home_id.as_str()});
            let(status,value)=self.exchange(app,"POST","/occurrence-context",json!({"profile":"houseatlas.measurement-occurrence-context-request.v1","scope":scope,"selector":selector})).await?;
            assert_eq!(status, StatusCode::OK, "{value}");
            Ok(value)
        }
        fn personal(context: &Value, mutation: u64, token: &str) -> Value {
            json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":context["scope"],"mutationId":format!("00000000-0000-4000-8000-{mutation:012x}"),"operation":{"kind":"create"},"target":context["target"],"property":"occurrence-area",
                "area":{"decimalToken":token,"unit":"m2","quantityKind":"area","method":"user-reported-measured","attestation":{"kind":"personally-measured"},"evidence":[],"inputs":[],"operation":null,"contradicts":[]},"reason":"Record user-reported measurement"})
        }
        async fn context(&self, host: Host) -> Result<Value, Failure> {
            let path = format!(
                "/api/atlas/measurements/v1/workspaces/{}/homes/{}/occurrence-context",
                self.config.homes[0].workspace_id.as_str(),
                self.config.homes[0].home_id.as_str()
            );
            let mut request=Request::builder().method("POST").uri(&path).header("host","127.0.0.1:48743").header("origin",&self.config.origin).header("sec-fetch-site","same-origin")
                .header("content-type","application/json").header("accept","application/json").header("cookie",&self.cookie).header("x-atlas-csrf",&self.csrf)
                .body(Body::from(serde_json::to_vec(&json!({"profile":"houseatlas.measurement-occurrence-context-request.v1","scope":{"workspaceId":self.config.homes[0].workspace_id.as_str(),"homeId":self.config.homes[0].home_id.as_str()},"selector":self.selector}))?))?;
            request.extensions_mut().insert(ConnectInfo(
                "127.0.0.1:50123".parse::<std::net::SocketAddr>()?,
            ));
            let response = crate::http::router(host).oneshot(request).await?;
            assert_eq!(response.status(), StatusCode::OK);
            Ok(serde_json::from_slice(
                &to_bytes(response.into_body(), 8 * 1024 * 1024).await?,
            )?)
        }
    }
    // HELD genuine composition/access case, not a documentary/fake owner test.
    #[tokio::test]
    async fn configured_image_opens_before_session_and_context_uses_original_owners()
    -> Result<(), Failure> {
        let f = Store::generated_measurement_startup_fixture().await?;
        let (core, lease, mount) = f.prepared()?.reopen(&f.config, f.policy.clone())?;
        let files = Arc::new(BTreeMap::from([(
            "/index.html".into(),
            ("text/html".into(), b"<div id=\"root\"></div>".to_vec()),
        )]));
        let host = mount
            .into_host(core, f.config.origin.clone(), files)?
            .with_loopback_local()?;
        assert!(
            std::str::from_utf8(&host.files["/index.html"].1)?
                .contains("data-measurements-profile=\"measurements-v1\"")
        );
        let context = f.context(host).await?;
        assert_eq!(
            context["coverage"]["status"],
            "complete-for-exact-publication-occurrence"
        );
        assert_eq!(context["writeEligibility"]["status"], "eligible");
        assert!(
            context["methods"]
                .as_array()
                .ok_or("methods")?
                .iter()
                .any(|m| m["method"] == "user-reported-measured" && m["status"] == "available")
        );
        drop(lease);
        let (core, lease, mount) = f.prepared()?.reopen(&f.config, f.policy.clone())?;
        drop(mount);
        drop(core);
        drop(lease);
        drop(f.temp);
        Ok(())
    }
    #[tokio::test]
    async fn configured_context_distinguishes_stale_selection_from_unavailable_owner()
    -> Result<(), Failure> {
        let f = Store::generated_measurement_startup_fixture().await?;
        let (app, core, lease) = f.opened()?;
        let scope = json!({
            "workspaceId": f.config.homes[0].workspace_id.as_str(),
            "homeId": f.config.homes[0].home_id.as_str(),
        });
        f.admitted(&app, &f.selector).await?;
        let mut stale_selector = f.selector.clone();
        stale_selector["selectionRevision"] = json!("ef".repeat(32));
        assert_ne!(stale_selector, f.selector);
        let (status, result) = f
            .exchange(
                &app,
                "POST",
                "/occurrence-context",
                json!({"profile":"houseatlas.measurement-occurrence-context-request.v1",
                    "scope":scope,"selector":stale_selector}),
            )
            .await?;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(
            result,
            json!({"profile":"houseatlas.measurement-context-error.v1",
                "scope":scope,"code":"stale-selection"}),
        );

        // Only generated producer files are withheld. The unchanged current
        // selector still has to qualify its original owner; no stale fallback.
        let publication = f.temp.path().join("publication");
        let withheld = f.temp.path().join("withheld-current-publication");
        fs::rename(&publication, &withheld)?;
        let response = f
            .exchange(
                &app,
                "POST",
                "/occurrence-context",
                json!({"profile":"houseatlas.measurement-occurrence-context-request.v1",
                    "scope":scope,"selector":f.selector}),
            )
            .await;
        fs::rename(&withheld, &publication)?;
        let (status, result) = response?;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            result,
            json!({"profile":"houseatlas.measurement-context-error.v1",
                "scope":scope,"code":"authority-unavailable"}),
        );
        f.admitted(&app, &f.selector).await?;
        drop(app);
        drop(core);
        drop(lease);
        Ok(())
    }
    // Generated native cases require their documented exact-selector qualification.
    #[tokio::test]
    async fn configured_personal_create_correct_history_outcome_and_client_wire()
    -> Result<(), Failure> {
        let f = Store::generated_measurement_startup_fixture().await?;
        let (app, core, lease) = f.opened()?;
        let (status, scene_wire) = f
            .exchange(
                &app,
                "GET",
                &format!(
                    "/api/atlas/models/v1/workspaces/{}/homes/{}/atlas",
                    f.config.homes[0].workspace_id.as_str(),
                    f.config.homes[0].home_id.as_str()
                ),
                Value::Null,
            )
            .await?;
        assert_eq!(status, StatusCode::OK, "{scene_wire}");
        let before = f.admitted(&app, &f.selector).await?;
        assert_eq!(before["claims"], json!([]));
        assert_eq!(before["writeEligibility"]["status"], "eligible");
        let proposal = GeneratedImage::personal(&before, 5000, "0012.5000");
        let (status, created) = f
            .exchange(&app, "POST", "/occurrence-area", proposal.clone())
            .await?;
        assert_eq!(status, StatusCode::OK, "{created}");
        let first = &created["receipt"];
        assert_eq!(
            first["committed"]["acquisition"]["actorId"],
            before["actorId"]
        );
        assert_eq!(
            first["committed"]["acquisition"]["recordedAt"],
            first["audit"]["at"]
        );
        assert_eq!(
            first["committed"]["assertion"]["value"]["decimalToken"],
            "0012.5000"
        );
        assert_eq!(first["committed"]["assertion"]["evidence"], json!([]));
        assert_eq!(
            first["committed"]["pending"]["assertion"],
            first["committed"]["assertion"]["version"]
        );
        let after_create = f.admitted(&app, &f.selector).await?;
        assert_eq!(after_create["claims"][0]["head"], *first);
        let version = &first["committed"]["assertion"]["version"];
        let id = version["assertionId"].as_str().ok_or("assertionId")?;
        let mut correction = proposal;
        correction["mutationId"] = json!("00000000-0000-4000-8000-000000001389");
        correction["operation"] = json!({"kind":"correct","assertionId":id,"expectedRevision":version["revision"],"expectedPayloadSha256":version["payloadSha256"]});
        correction["area"]["decimalToken"] = json!("13.2500");
        correction["reason"] = json!("Correct user-reported measurement");
        let (status, corrected) = f
            .exchange(
                &app,
                "POST",
                &format!("/occurrence-area/{id}/corrections"),
                correction,
            )
            .await?;
        assert_eq!(status, StatusCode::OK, "{corrected}");
        let after_correct = f.admitted(&app, &f.selector).await?;
        let (status, current) = f
            .exchange(&app, "GET", &format!("/occurrence-area/{id}"), Value::Null)
            .await?;
        assert_eq!(status, StatusCode::OK);
        let (status, history) = f
            .exchange(
                &app,
                "GET",
                &format!("/occurrence-area/{id}/history"),
                Value::Null,
            )
            .await?;
        assert_eq!(status, StatusCode::OK);
        let (status, outcome_create) = f
            .exchange(
                &app,
                "GET",
                "/mutation-outcomes/00000000-0000-4000-8000-000000001388",
                Value::Null,
            )
            .await?;
        assert_eq!(status, StatusCode::OK);
        let (status, outcome_correct) = f
            .exchange(
                &app,
                "GET",
                "/mutation-outcomes/00000000-0000-4000-8000-000000001389",
                Value::Null,
            )
            .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(history["versions"], json!([first, corrected["receipt"]]));
        assert_eq!(outcome_create["result"]["receipt"], *first);
        assert_eq!(outcome_correct["result"]["receipt"], corrected["receipt"]);
        assert_eq!(current["head"], corrected["receipt"]);
        assert_eq!(
            corrected["receipt"]["committed"]["pending"]["assertion"],
            corrected["receipt"]["committed"]["assertion"]["version"]
        );
        // Source-owned future harness consumes ONLY this genuine generated wire
        // output. No cookie, CSRF, session secret or household input is emitted.
        println!(
            "HOUSEATLAS_GENERATED_MEASUREMENT_CLIENT_FIXTURE {}",
            serde_json::to_string(
                &json!({"format":"houseatlas.generated-measurement-client-wire.v1","contextBefore":before,
            "created":created,"contextAfterCreate":after_create,"corrected":corrected,"contextAfterCorrect":after_correct,"current":current,"history":history,"outcomeCreate":outcome_create,"outcomeCorrect":outcome_correct,"sceneWire":scene_wire})
            )?
        );
        drop(app);
        drop(core);
        drop(lease);
        Ok(())
    }
    async fn two_part_comparison(second_token: &str) -> Result<(), Failure> {
        let f = Store::generated_measurement_startup_fixture_case(GeneratedCase::TwoParts).await?;
        let (app, core, lease) = f.opened()?;
        let a = f.admitted(&app, &f.selector).await?;
        let b_selector = f.extra_selectors.first().ok_or("second admitted part")?;
        let (status, first) = f
            .exchange(
                &app,
                "POST",
                "/occurrence-area",
                GeneratedImage::personal(&a, 5100, "12.5000"),
            )
            .await?;
        assert_eq!(status, StatusCode::OK, "{first}");
        let b = f.admitted(&app, b_selector).await?;
        let (status, second) = f
            .exchange(
                &app,
                "POST",
                "/occurrence-area",
                GeneratedImage::personal(&b, 5101, second_token),
            )
            .await?;
        assert_eq!(status, StatusCode::OK, "{second}");
        for selector in [&f.selector, b_selector] {
            let context = f.admitted(&app, selector).await?;
            assert_eq!(context["claims"].as_array().ok_or("claims")?.len(), 1);
            assert_eq!(
                context["historical"]["streams"][0]["association"],
                json!({"status":"review-required","reason":"occurrence-part-ambiguous"})
            );
            assert_eq!(
                context["claims"][0]["currentValueReview"]["status"],
                "unavailable"
            );
            assert_eq!(
                context["claims"][0]["currentValueReview"]["reason"],
                "historical-association-unreviewed"
            );
            assert_eq!(
                context["claims"][0]["currentConflicts"]["status"],
                "unavailable"
            );
        }
        for receipt in [&first["receipt"], &second["receipt"]] {
            let id = receipt["committed"]["assertion"]["version"]["assertionId"]
                .as_str()
                .ok_or("assertion")?;
            let (status, current) = f
                .exchange(&app, "GET", &format!("/occurrence-area/{id}"), Value::Null)
                .await?;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(current["head"], *receipt);
            assert_eq!(
                current["currentValueReview"]["reason"],
                "historical-association-unreviewed"
            );
        }
        drop(app);
        drop(core);
        drop(lease);
        Ok(())
    }
    #[tokio::test]
    async fn configured_same_native_room_equal_part_values_do_not_establish_correspondence()
    -> Result<(), Failure> {
        two_part_comparison("12.5000").await
    }
    #[tokio::test]
    async fn configured_same_native_room_unequal_part_values_require_pairwise_review()
    -> Result<(), Failure> {
        two_part_comparison("18.7500").await
    }
    async fn two_publication_owners(withhold_old: bool) -> Result<(), Failure> {
        let f = Store::generated_measurement_startup_fixture_case(GeneratedCase::TwoPublications {
            withhold_old,
        })
        .await?;
        let (app, core, lease) = f.opened()?;
        let context = f.admitted(&app, &f.selector).await?;
        let historical = &context["historical"]["streams"][0];
        assert_eq!(
            historical["history"]["versions"][0]["committed"]["assertion"]["value"]["decimalToken"],
            "12.5000"
        );
        assert_eq!(
            historical["producerContext"]["state"],
            "recorded-context-unverified"
        );
        if withhold_old {
            assert_eq!(
                historical["association"],
                json!({"status":"unavailable","reason":"historical-mapping-owner-unavailable"})
            );
            assert_eq!(context["writeEligibility"]["status"], "ineligible");
            assert_eq!(
                context["writeEligibility"]["reason"],
                "required-mutation-owner-unavailable"
            );
            assert!(
                context["methods"]
                    .as_array()
                    .ok_or("methods")?
                    .iter()
                    .any(
                        |m| m["method"] == "user-reported-measured" && m["status"] == "unavailable"
                    )
            );
            assert_eq!(
                context["claims"][0]["currentValueReview"]["status"],
                "unavailable"
            );
        } else {
            assert_eq!(
                historical["association"],
                json!({"status":"review-required","reason":"native-room-candidate-only"})
            );
            assert_eq!(context["writeEligibility"]["status"], "eligible");
            assert_eq!(
                context["claims"][0]["currentValueReview"]["reason"],
                "historical-association-unreviewed"
            );
            let original_versions = crate::contracts::measurement_assertions::canonical(
                &historical["history"]["versions"],
            )?;
            let original_digests = crate::contracts::measurement_assertions::canonical(
                &historical["history"]["receiptDigests"],
            )?;
            let original_pending = crate::contracts::measurement_assertions::canonical(
                &historical["history"]["versions"][0]["committed"]["pending"],
            )?;
            let proposal = GeneratedImage::personal(&context, 5200, "0014.7500");
            let mutation = proposal["mutationId"]
                .as_str()
                .ok_or("fresh mutation")?
                .to_owned();
            let (status, created) = f
                .exchange(&app, "POST", "/occurrence-area", proposal)
                .await?;
            assert_eq!(status, StatusCode::OK, "{created}");
            let receipt = &created["receipt"];
            let committed = &receipt["committed"];
            let version = &committed["assertion"]["version"];
            let id = version["assertionId"].as_str().ok_or("new assertion")?;
            assert_eq!(
                committed["assertion"]["value"],
                json!({"decimalToken":"0014.7500","unit":"m2","quantityKind":"area"})
            );
            assert_eq!(
                committed["acquisition"]["kind"],
                "user-reported-measurement"
            );
            assert_eq!(committed["acquisition"]["actorId"], context["actorId"]);
            assert_eq!(receipt["audit"]["actorId"], context["actorId"]);
            assert_eq!(
                committed["acquisition"]["recordedAt"],
                receipt["audit"]["at"]
            );
            assert_eq!(committed["pending"]["assertion"], *version);
            assert_eq!(
                committed["pending"]["model"],
                committed["assertion"]["enteredAgainst"]
            );
            assert_eq!(
                committed["proposal"]["target"]["publicationId"],
                context["target"]["publicationId"]
            );
            let (status, current) = f
                .exchange(&app, "GET", &format!("/occurrence-area/{id}"), Value::Null)
                .await?;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(current["head"], *receipt);
            assert_eq!(
                current["receiptDigest"]["receiptSha256"],
                created["receiptSha256"]
            );
            let (status, history) = f
                .exchange(
                    &app,
                    "GET",
                    &format!("/occurrence-area/{id}/history"),
                    Value::Null,
                )
                .await?;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(history["versions"], json!([receipt]));
            let (status, outcome) = f
                .exchange(
                    &app,
                    "GET",
                    &format!("/mutation-outcomes/{mutation}"),
                    Value::Null,
                )
                .await?;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(outcome["status"], "committed");
            assert_eq!(outcome["result"]["receipt"], *receipt);
            assert_eq!(outcome["result"]["receiptSha256"], created["receiptSha256"]);
            let after = f.admitted(&app, &f.selector).await?;
            let old = after["historical"]["streams"]
                .as_array()
                .ok_or("historical streams")?
                .iter()
                .find(|s| s["history"]["assertionId"] == historical["history"]["assertionId"])
                .ok_or("old stream retained")?;
            assert_eq!(
                crate::contracts::measurement_assertions::canonical(&old["history"]["versions"])?,
                original_versions
            );
            assert_eq!(
                crate::contracts::measurement_assertions::canonical(
                    &old["history"]["receiptDigests"]
                )?,
                original_digests
            );
            assert_eq!(
                crate::contracts::measurement_assertions::canonical(
                    &old["history"]["versions"][0]["committed"]["pending"]
                )?,
                original_pending
            );
            assert_eq!(
                old["association"],
                json!({"status":"review-required","reason":"native-room-candidate-only"})
            );
            assert_eq!(
                after["historical"]["coverage"]["status"],
                "association-review-required"
            );
        }
        drop(app);
        drop(core);
        drop(lease);
        Ok(())
    }
    #[tokio::test]
    async fn explicitly_retained_publication_owner_allows_writes_without_pairwise_correspondence()
    -> Result<(), Failure> {
        two_publication_owners(false).await
    }
    #[tokio::test]
    async fn unavailable_configured_old_owner_keeps_saved_values_and_refuses_write_eligibility()
    -> Result<(), Failure> {
        two_publication_owners(true).await
    }
}
