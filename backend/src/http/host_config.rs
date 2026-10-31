use super::*;

impl Host {
    pub fn new(
        core: Core,
        origin: String,
        files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
        homebox_cache_sources: Vec<crate::config::providers::homebox::TrustedHomeBoxSource>,
    ) -> crate::storage::Result<Self> {
        Ok(Self {
            mcp_command_profile: McpCommandProfile::ReadOnly,
            mcp_access: core.access.clone(),
            mcp_scopes: Arc::new(core.homes.iter().map(|home| home.scope.clone()).collect()),
            asset_reviews: Arc::new(Mutex::new(asset_reviews::ReviewRegistry::default())),
            native_media_archive: None,
            quantity_installations: Arc::new(Vec::new()),
            quantity_previews: Arc::new(Mutex::new(quantity::Registry::default())),
            #[cfg(test)]
            quantity_tls_fixture: None,
            model_overview: None,
            offline_packs: Arc::new(Mutex::new(offline_read_pack::Registry::default())),
            atlas_scene: None,
            atlas_room_links: None,
            atlas_display_policy: None,
            full_geodata_identity: None,
            geodata_dataset: None,
            loopback_local: false,
            gateway: None,
            backup_folder: None,
            operation_events: Arc::new(Mutex::new(operation_events::EventRegistry::default())),
            core: Arc::new(Mutex::new(core)),
            origin,
            files,
            homebox_cache_sources: Arc::new(homebox_cache_sources),
            native_homebox_reads: Arc::new(Vec::new()),
            native_homebox_list_pages: Arc::new(
                crate::providers::homebox::read::NativeListPages::new(),
            ),
            pinned_homebox_file_bindings: Arc::new(Vec::new()),
            pinned_homebox_artifacts: Arc::new(Mutex::new(Default::default())),
            pinned_homebox_capture_requests: Arc::new(Mutex::new(Default::default())),
            network_bindings: Arc::new(Vec::new()),
            atlas_download_handles: d::stock::AtlasDownloadHandles::default(),
            response_ids: Arc::new(ResponseIds::new()?),
            pages: Arc::new(Mutex::new(pages::Pages::default())),
            admission: Arc::new(admission::Admission::default()),
            upload_slots: Arc::new(tokio::sync::Semaphore::new(4)),
            mcp: Arc::new(Mutex::new(
                agents::mcp_transport::TransportSessions::default(),
            )),
        })
    }
    /// The folder the nightly backup job shares with Settings (tools/backup).
    pub fn with_backup_folder(mut self, folder: std::path::PathBuf) -> Self {
        self.backup_folder = Some(Arc::new(folder));
        self
    }
    /// Trusted immutable overview selection; all requests retain native access.
    pub fn with_model_overview(
        mut self,
        selection: crate::config::model_overview::ServerModelOverviewSelection,
    ) -> crate::storage::Result<Self> {
        if !self.mcp_scopes.iter().any(|scope| selection.matches(scope)) {
            return Err(crate::storage::Error::new(
                "identity-conflict",
                "Overview scope is not configured",
            ));
        }
        self.atlas_scene = None;
        self.atlas_room_links = None;
        self.atlas_display_policy = None;
        self.model_overview = Some(Arc::new(selection));
        Ok(self)
    }
    /// Immutable semantics for the exact already-selected model; no native imports.
    pub fn with_atlas_scene(
        mut self,
        selection: crate::config::atlas_scene::ServerAtlasSceneSelection,
    ) -> crate::storage::Result<Self> {
        let overview = self
            .model_overview
            .as_ref()
            .ok_or(crate::storage::Error::new(
                "identity-conflict",
                "Atlas scene requires selected overview",
            ))?;
        selection.verify(overview).map_err(|_| {
            crate::storage::Error::new(
                "identity-conflict",
                "Atlas companion does not match selected model",
            )
        })?;
        self.atlas_room_links = None;
        self.atlas_display_policy = None;
        self.atlas_scene = Some(Arc::new(selection));
        Ok(self)
    }
    /// Independent reviewed documentary links; native qualification is separate.
    pub fn with_atlas_room_links(
        mut self,
        selection: crate::config::atlas_room_links::ServerAtlasRoomLinksSelection,
    ) -> crate::storage::Result<Self> {
        let scene = self.atlas_scene.as_ref().ok_or(crate::storage::Error::new(
            "identity-conflict",
            "Room links require selected scene",
        ))?;
        let overview = self
            .model_overview
            .as_ref()
            .ok_or(crate::storage::Error::new(
                "identity-conflict",
                "Room links require selected overview",
            ))?;
        selection.read(scene, overview).map_err(|_| {
            crate::storage::Error::new(
                "identity-conflict",
                "Room links do not match selected scene",
            )
        })?;
        self.atlas_room_links = Some(Arc::new(selection));
        Ok(self)
    }
    /// Optional exact-publication display membership, never geometry or authority.
    pub fn with_atlas_display_policy(
        mut self,
        selection: crate::config::atlas_display_policy::ServerAtlasDisplayPolicySelection,
    ) -> crate::storage::Result<Self> {
        let scene = self.atlas_scene.as_ref().ok_or(crate::storage::Error::new(
            "identity-conflict", "Display policy requires selected scene",
        ))?;
        let overview = self.model_overview.as_ref().ok_or(crate::storage::Error::new(
            "identity-conflict", "Display policy requires selected overview",
        ))?;
        selection.read(scene, overview).map_err(|_| crate::storage::Error::new(
            "identity-conflict", "Display policy does not match selected scene",
        ))?;
        self.atlas_display_policy = Some(Arc::new(selection));
        Ok(self)
    }
    /// Compose Documents with native/Stock routes only on the original full
    /// profile Core.store connection; no second dataset connection is accepted.
    pub fn with_full_geodata(mut self) -> crate::storage::Result<Self> {
        let core = self.core.lock().map_err(|_| {
            crate::storage::Error::new("storage-unavailable", "Native core unavailable")
        })?;
        let store = core.store.lock().map_err(|_| {
            crate::storage::Error::new("storage-unavailable", "Native store unavailable")
        })?;
        if self.geodata_dataset.is_some()
            || !store.full_geodata_belongs_to(&core.access, &core.vault)
        {
            return Err(crate::storage::Error::new(
                "identity-conflict",
                "Original full profile owners required",
            ));
        }
        self.full_geodata_identity = Some(store.full_geodata_identity().ok_or(
            crate::storage::Error::new("schema-incompatible", "Full profile not selected"),
        )?);
        drop(store);
        drop(core);
        Ok(self)
    }
    pub fn with_geodata_dataset(
        mut self,
        store: crate::storage::geodata::GeodataStore,
    ) -> crate::storage::Result<Self> {
        let core = self.core.lock().map_err(|_| {
            crate::storage::Error::new("storage-unavailable", "Native core unavailable")
        })?;
        if !Arc::ptr_eq(store.access(), &core.access) || !Arc::ptr_eq(store.vault(), &core.vault) {
            return Err(crate::storage::Error::new(
                "identity-conflict",
                "Original native authority and vault required",
            ));
        }
        drop(core);
        self.geodata_dataset = Some(Arc::new(Mutex::new(store)));
        Ok(self)
    }

    pub fn with_loopback_local(mut self) -> crate::storage::Result<Self> {
        if self.origin != "https://127.0.0.1:48743" {
            return Err(crate::storage::Error::new(
                "invalid-local-mode",
                "Local mode requires the selected loopback origin",
            ));
        }
        {
            let mut access = self.mcp_access.lock().map_err(|_| {
                crate::storage::Error::new("owner-unavailable", "Access unavailable")
            })?;
            access.validate_loopback_local_user().map_err(|e| {
                crate::storage::Error::new(e.code(), "Explicit local identity unavailable")
            })?;
        }
        self.loopback_local = true;
        Ok(self)
    }
    /// Select only the native Access policy and the actual private Unix listener.
    pub fn with_trusted_gateway(
        mut self,
        socket: Arc<crate::app::trusted_gateway::GatewaySocket>,
    ) -> crate::storage::Result<Self> {
        let mut access = self
            .mcp_access
            .lock()
            .map_err(|_| crate::storage::Error::new("owner-unavailable", "Access unavailable"))?;
        let policy = access.trusted_proxy_policy().ok_or_else(|| {
            crate::storage::Error::new("invalid-proxy-mode", "Native proxy selection absent")
        })?;
        if !Arc::ptr_eq(policy, socket.policy())
            || access.trusted_proxy_origin() != Some(self.origin.as_str())
            || self.loopback_local
        {
            return Err(crate::storage::Error::new(
                "invalid-proxy-mode",
                "Selected gateway custody changed",
            ));
        }
        access.validate_loopback_local_user().map_err(|e| {
            crate::storage::Error::new(e.code(), "Selected native identity unavailable")
        })?;
        drop(access);
        self.gateway = Some(socket);
        Ok(self)
    }
    /// Explicit original startup selections; no provider or artifact I/O here.
    pub fn with_quantity_installations(
        mut self,
        selected: Vec<
            Arc<crate::config::providers::quantity_installation::OriginalQuantityConfigured>,
        >,
    ) -> crate::storage::Result<Self> {
        let core = self.core.lock().map_err(|_| {
            crate::storage::Error::new("owner-unavailable", "Quantity host unavailable")
        })?;
        let mut targets = std::collections::BTreeSet::new();
        for configuration in &selected {
            let descriptor = configuration.descriptor();
            if !targets.insert(serde_json::to_string(&(
                descriptor.scope.clone(),
                descriptor.target.clone(),
            ))?) {
                return Err(crate::storage::Error::new(
                    "identity-conflict",
                    "Duplicate quantity target",
                ));
            }
        }
        if selected.len() > 64 || selected.iter().any(|s| !s.belongs_to_core(&core)) {
            return Err(crate::storage::Error::new(
                "identity-conflict",
                "Original quantity configuration required",
            ));
        }
        drop(core);
        self.quantity_installations = Arc::new(selected);
        Ok(self)
    }

    /// Select admission only for subsequently initialized sessions. This data
    /// grants no authority or approval and cannot broaden an existing session.
    /// The default binary retains ReadOnly.
    pub fn with_mcp_command_profile(mut self, profile: McpCommandProfile) -> Self {
        self.mcp_command_profile = profile;
        self
    }

    /// Explicit cached-only source selection. No client, credential or grant.
    pub fn with_cached_homebox_sources(
        mut self,
        sources: Vec<crate::config::providers::homebox::TrustedHomeBoxSource>,
    ) -> crate::storage::Result<Self> {
        let mut partitions = std::collections::BTreeSet::new();
        if !self.homebox_cache_sources.is_empty() || sources.len() > 8 {
            return Err(crate::storage::Error::new(
                "invalid-contract",
                "Cached HomeBox selection unavailable",
            ));
        }
        for source in &sources {
            let partition = source.partition();
            if !self.mcp_scopes.iter().any(|scope| {
                scope.workspace_id == partition.workspace_id && scope.home_id == partition.home_id
            }) || !partitions.insert(serde_json::to_string(&partition)?)
            {
                return Err(crate::storage::Error::new(
                    "invalid-contract",
                    "Cached HomeBox selection unavailable",
                ));
            }
        }
        self.homebox_cache_sources = Arc::new(sources);
        Ok(self)
    }

    /// Trusted optional native GET and credential custody configuration. No
    /// provider request or source grant is issued at startup; each request must
    /// qualify the exact current Store registration and original Access handles.
    pub fn with_native_homebox_reads(
        mut self,
        mut bindings: Vec<providers::homebox_native::NativeHomeBoxReadBinding>,
    ) -> crate::storage::Result<Self> {
        let mut partitions = std::collections::BTreeSet::new();
        for binding in &bindings {
            let partition = binding.source().partition();
            if !self.mcp_scopes.iter().any(|scope| {
                scope.workspace_id == partition.workspace_id && scope.home_id == partition.home_id
            }) || !partitions.insert(serde_json::to_string(&partition)?)
            {
                return Err(crate::storage::Error::new(
                    "invalid-contract",
                    "Native HomeBox read scope is unavailable",
                ));
            }
        }
        for binding in &mut bindings {
            binding.bind_pages(Arc::clone(&self.native_homebox_list_pages));
        }
        self.native_homebox_reads = Arc::new(bindings);
        Ok(self)
    }
    /// Explicit optional local file source selection; default is empty.
    pub fn with_pinned_homebox_files(
        mut self,
        bindings: Vec<homebox_pinned_files::PinnedHomeBoxFileBinding>,
    ) -> crate::storage::Result<Self> {
        let mut partitions = std::collections::BTreeSet::new();
        if bindings.len() > 64 {
            return Err(crate::storage::Error::new(
                "invalid-contract",
                "Pinned HomeBox source unavailable",
            ));
        }
        for binding in &bindings {
            let partition = binding.source().partition();
            if !self.mcp_scopes.iter().any(|scope| {
                scope.workspace_id == partition.workspace_id && scope.home_id == partition.home_id
            }) || !partitions.insert(serde_json::to_string(&partition)?)
            {
                return Err(crate::storage::Error::new(
                    "invalid-contract",
                    "Pinned HomeBox source unavailable",
                ));
            }
        }
        self.pinned_homebox_file_bindings = Arc::new(bindings);
        Ok(self)
    }

    /// Trusted optional Media-only custody. Startup supplies the actual native
    /// deployment/physical-DB/archive mapping and retention scopes. Existing
    /// generations require complete independently admitted references; candidate
    /// archive scans and recovered SQL cannot supply those configuration inputs.
    /// No directory is opened, grant issued or recovery performed here.
    pub fn with_native_media_archive(
        mut self,
        archive: Arc<crate::lifecycle::provider_dispatch::archive::PrivateStockArchive>,
        origin: crate::media::recovery_policy_archive::MediaPolicyArchiveOrigin,
        scopes: Vec<crate::media::types::Scope>,
        independent_members: Option<
            Vec<crate::media::native_policy_archive::NativeMediaArchiveExpectedMember>,
        >,
        budget: &crate::media::WorkBudget,
    ) -> crate::media::MediaResult<Self> {
        use crate::media::{
            MediaError,
            native_policy_archive::{
                NativeMediaArchiveBinding, NativeMediaArchiveGeneration, NativeMediaArchiveOwner,
            },
        };
        let identity = {
            let core = self.core.try_lock().map_err(|_| MediaError::Unavailable)?;
            if scopes.iter().any(|scope| {
                !core.homes.iter().any(|home| {
                    home.scope.workspace_id == scope.workspace_id
                        && home.scope.home_id == scope.home_id
                })
            }) {
                return Err(MediaError::Forbidden);
            }
            let store = core.store.try_lock().map_err(|_| MediaError::Unavailable)?;
            store.asset_review_store_identity()
        };
        let binding = NativeMediaArchiveBinding::new(identity, archive, origin, scopes)?;
        let owner = match independent_members {
            Some(members) => {
                let generation = NativeMediaArchiveGeneration::from_trusted_configuration(
                    &binding, members, budget,
                )?;
                NativeMediaArchiveOwner::configured(binding, generation)?
            }
            None => NativeMediaArchiveOwner::fresh(binding),
        };
        self.native_media_archive = Some(Arc::new(Mutex::new(owner)));
        Ok(self)
    }

    /// Detached immutable custody reference emitted by genuine publication.
    /// This grants no recovery, replay or output disclosure authority.
    pub fn native_media_archive_generation(
        &self,
    ) -> crate::media::MediaResult<
        Option<crate::media::native_policy_archive::NativeMediaArchiveGeneration>,
    > {
        self.native_media_archive
            .as_ref()
            .map(|owner| {
                owner
                    .try_lock()
                    .map(|owner| owner.generation())
                    .map_err(|_| crate::media::MediaError::Unavailable)
            })
            .transpose()
    }

    /// Trusted optional native mounts. Opening a binding issues no grants and
    /// performs no provider request; existing configured authority is required.
    pub fn with_network_bindings(
        mut self,
        bindings: Vec<crate::config::providers::network_host::NetworkBinding>,
    ) -> crate::storage::Result<Self> {
        if bindings
            .iter()
            .any(|binding| !Arc::ptr_eq(binding.access().shared().as_existing(), &self.mcp_access))
        {
            return Err(crate::storage::Error::new(
                "invalid-contract",
                "Network canonical issuer does not match",
            ));
        }
        let mut partitions = std::collections::BTreeSet::new();
        for binding in &bindings {
            let partition = binding.runtime().settings().configured_source().partition();
            let key = serde_json::to_string(&partition)?;
            if !partitions.insert(key) {
                return Err(crate::storage::Error::new(
                    "invalid-contract",
                    "Network partition is configured more than once",
                ));
            }
        }
        self.network_bindings = Arc::new(bindings);
        Ok(self)
    }
}
