//! Same-connection full-profile selection; no implicit migration.
use super::*;
use crate::{
    access as a, media as m,
    storage::{
        geodata::{GeodataOwners, GeodataRepository, HeldGeodataAuthority},
        geodata_full,
    },
};
#[derive(Clone)]
pub struct FullGeodataIdentity(Arc<()>);
impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    #[allow(clippy::too_many_arguments)]
    pub fn open_existing_geodata_full<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        path: &Path,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
        owners: GeodataOwners,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<Self> {
        Self::open_existing_geodata_full_selected(
            path,
            contract,
            authorization,
            runtime,
            options,
            owners,
            peers,
            check,
            false,
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn open_existing_geodata_full_selected<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        path: &Path,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
        owners: GeodataOwners,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
        read_only: bool,
    ) -> Result<Self> {
        options.require_available_profile()?;
        if options.stock_activity_profile
            || options.allow_synthetic_bootstrap
            || options.busy_timeout_ms > 60_000
        {
            return Err(Error::new(
                "invalid-contract",
                "Explicit full profile requires native v5 core selection",
            ));
        }
        {
            let probe = Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )?;
            let tx = probe.unchecked_transaction()?;
            super::recovery::validate_geodata_full_core(&tx, &contract, peers, check)?;
            let budget = m::WorkBudget::new(
                std::time::Duration::from_secs(10),
                m::Cancellation::default(),
            )
            .map_err(|_| {
                Error::new("storage-unavailable", "Full profile validation unavailable")
            })?;
            owners.recovery(&tx).validate_document_closure(&budget)?;
            geodata_full::validate_legacy_bytes(&tx, owners.vault(), check)?;
            tx.commit()?;
        }
        let db = Connection::open_with_flags(
            path,
            (if read_only {
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
            } else {
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
            }) | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        db.pragma_update(None, "query_only", true)?;
        {
            let tx = db.unchecked_transaction()?;
            super::recovery::validate_geodata_full_core(&tx, &contract, peers, check)?;
            let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
                .map_err(|_| {
                    Error::new(
                        "storage-unavailable",
                        "Full profile validation deadline unavailable",
                    )
                })?;
            owners.recovery(&tx).validate_document_closure(&budget)?;
            geodata_full::validate_legacy_bytes(&tx, owners.vault(), check)?;
            tx.commit()?;
        }
        if !read_only {
            db.pragma_update(None, "query_only", false)?;
            db.busy_timeout(Duration::from_millis(options.busy_timeout_ms))?;
            db.execute_batch("PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;")?;
            db.pragma_update(None, "journal_mode", "WAL")?;
        }
        Ok(Self {
            db,
            instance: Arc::new(()),
            full_geodata: Some(owners),
            cache_pins: cache_custody::CachePinRegistry::default(),
            contract,
            authorization,
            runtime,
            options,
        })
    }
    pub fn full_geodata_identity(&self) -> Option<FullGeodataIdentity> {
        self.full_geodata
            .as_ref()
            .map(|_| FullGeodataIdentity(self.instance.clone()))
    }
    pub fn matches_full_geodata_identity(&self, id: &FullGeodataIdentity) -> bool {
        self.full_geodata.is_some() && Arc::ptr_eq(&self.instance, &id.0)
    }
    pub fn is_full_geodata_profile(&self) -> bool {
        self.full_geodata.is_some()
    }
    pub fn full_geodata_belongs_to(
        &self,
        access: &crate::app::Access,
        vault: &Arc<m::AssetVault>,
    ) -> bool {
        self.full_geodata
            .as_ref()
            .is_some_and(|o| o.belongs_to(access, vault))
    }
    pub(crate) fn geodata_facet<'a>(
        &'a self,
        guard: &'a a::TransactionAuthorization<'a>,
    ) -> Result<GeodataRepository<&'a Connection, HeldGeodataAuthority<'a>>> {
        Ok(self
            .full_geodata
            .as_ref()
            .ok_or(Error::new(
                "schema-incompatible",
                "Full Document profile not selected",
            ))?
            .guarded(&self.db, guard))
    }
    pub fn validate_full_geodata<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        &self,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        let owners = self.full_geodata.as_ref().ok_or(Error::new(
            "schema-incompatible",
            "Full Document profile not selected",
        ))?;
        let tx = self.db.unchecked_transaction()?;
        let image = super::recovery::validate_geodata_full_core(&tx, &self.contract, peers, check)?;
        let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
            .map_err(|_| {
                Error::new(
                    "storage-unavailable",
                    "Full profile validation deadline unavailable",
                )
            })?;
        owners.recovery(&tx).validate_document_closure(&budget)?;
        geodata_full::validate_legacy_bytes(&tx, owners.vault(), check)?;
        tx.commit()?;
        Ok(image)
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FullGeodataBundle {
    pub format: String,
    pub lineage: String,
    pub contract_version: String,
    pub outer_schema: u32,
    pub catalog_sha256: String,
    pub database_sha256: String,
    pub database_bytes: u64,
    pub assets: Vec<m::types::AssetRecord>,
    pub retained_assets: Vec<String>,
    pub conversion_receipt_sha256: String,
    pub conversion_receipt: geodata_full::ConversionReceipt,
}
fn bundle_error() -> Error {
    Error::new(
        "schema-incompatible",
        "Full native recovery bundle is incompatible",
    )
}
fn bytes_sha(bytes: &[u8]) -> String {
    m::types::sha256(bytes)
}
fn asset_pin(record: &m::types::AssetRecord) -> Result<String> {
    Ok(bytes_sha(
        &serde_jcs::to_vec(record).map_err(|_| bundle_error())?,
    ))
}
fn read_manifest(path: &Path) -> Result<FullGeodataBundle> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(path.join("manifest.json"))
        .map_err(|_| bundle_error())?;
    let meta = file.metadata().map_err(|_| bundle_error())?;
    if !meta.is_file()
        || meta.len() > 4 * 1024 * 1024
        || meta.nlink() != 1
        || meta.mode() & 0o077 != 0
    {
        return Err(bundle_error());
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| bundle_error())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(bundle_error());
    }
    let value = crate::contracts::v2::parse_value(&bytes).map_err(|_| bundle_error())?;
    if serde_jcs::to_vec(&value).map_err(|_| bundle_error())? != bytes {
        return Err(bundle_error());
    }
    let manifest: FullGeodataBundle = serde_json::from_value(value)?;
    if manifest.format != "houseatlas-native-full-geodata-recovery/1"
        || manifest.lineage != geodata_full::LINEAGE
        || manifest.contract_version != "2.0.0"
        || manifest.outer_schema != 1
        || manifest.catalog_sha256 != bytes_sha(geodata_full::SQL.as_bytes())
    {
        return Err(bundle_error());
    }
    Ok(manifest)
}
fn full_bundle_check<
    C: Contract,
    S: crate::domain::stock::StockContractPort,
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
>(
    directory: &Path,
    contract: &C,
    peers: &RecoveryValidationPeers<'_, S, D, E>,
    owners: &GeodataOwners,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<FullGeodataBundle> {
    let manifest = read_manifest(directory)?;
    let path = directory.join("atlas.sqlite");
    let pin = super::recovery::ClosedSource::open(&path, check)?;
    pin.require_delete()?;
    if pin.sha256() != manifest.database_sha256 || pin.bytes() != manifest.database_bytes {
        return Err(bundle_error());
    }
    let db = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    let tx = db.unchecked_transaction()?;
    super::recovery::validate_geodata_full_core(&tx, contract, peers, check)?;
    let vault = Arc::new(
        m::AssetVault::open_existing(&directory.join("media")).map_err(|_| bundle_error())?,
    );
    let configured = owners.for_vault(vault);
    let budget = m::WorkBudget::new_offline_backup().map_err(|_| bundle_error())?;
    let (ancestry_sha, ancestry) = geodata_full::conversion_receipt(&tx)?;
    if ancestry_sha != manifest.conversion_receipt_sha256
        || serde_jcs::to_vec(&ancestry)? != serde_jcs::to_vec(&manifest.conversion_receipt)?
    {
        return Err(bundle_error());
    }
    let view = configured.recovery(&tx);
    view.validate_document_closure(&budget)?;
    geodata_full::validate_legacy_bytes(&tx, configured.vault(), check)?;
    if serde_json::to_value(view.recovery_media()?)? != serde_json::to_value(&manifest.assets)? {
        return Err(bundle_error());
    }
    let mut retained = Vec::new();
    for record in &manifest.assets {
        if geodata_full::retained_bytes(record, configured.vault(), &budget)?.is_some() {
            retained.push(asset_pin(record)?);
        }
    }
    if retained != manifest.retained_assets {
        return Err(bundle_error());
    }
    tx.commit()?;
    pin.check(check)?;
    Ok(manifest)
}
impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn capture_full_geodata_recovery<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        &self,
        directory: &Path,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<FullGeodataBundle> {
        use std::{
            fs,
            io::Write,
            os::unix::fs::{DirBuilderExt, OpenOptionsExt},
        };
        let owners = self.full_geodata.as_ref().ok_or_else(bundle_error)?;
        let tx = self.db.unchecked_transaction()?;
        super::recovery::validate_geodata_full_core(&tx, &self.contract, peers, check)?;
        let budget = m::WorkBudget::new_offline_backup().map_err(|_| bundle_error())?;
        let view = owners.recovery(&tx);
        view.validate_document_closure(&budget)?;
        geodata_full::validate_legacy_bytes(&tx, owners.vault(), check)?;
        let assets = view.recovery_media()?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(directory)
            .map_err(|_| bundle_error())?;
        let path = directory.join("atlas.sqlite");
        drop(
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(|_| bundle_error())?,
        );
        let mut copy = Connection::open(&path)?;
        {
            let backup = rusqlite::backup::Backup::new(&tx, &mut copy)?;
            loop {
                check()?;
                match backup.step(128)? {
                    rusqlite::backup::StepResult::Done => break,
                    rusqlite::backup::StepResult::More => {}
                    _ => return Err(bundle_error()),
                }
            }
        }
        copy.pragma_update(None, "journal_mode", "DELETE")?;
        copy.close().map_err(|(_, e)| Error::from(e))?;
        let vault = m::AssetVault::open(&directory.join("media")).map_err(|_| bundle_error())?;
        let mut retained_assets = Vec::new();
        for record in &assets {
            check()?;
            if let Some(bytes) = geodata_full::retained_bytes(record, owners.vault(), &budget)? {
                retained_assets.push(asset_pin(record)?);
                vault
                    .restore_retained(record, &bytes, &budget)
                    .map_err(|_| bundle_error())?;
            }
        }
        tx.commit()?;
        let pin = super::recovery::ClosedSource::open(&path, check)?;
        pin.require_delete()?;
        let (conversion_receipt_sha256, conversion_receipt) =
            geodata_full::conversion_receipt(&self.db)?;
        let manifest = FullGeodataBundle {
            format: "houseatlas-native-full-geodata-recovery/1".into(),
            lineage: geodata_full::LINEAGE.into(),
            contract_version: "2.0.0".into(),
            outer_schema: 1,
            catalog_sha256: bytes_sha(geodata_full::SQL.as_bytes()),
            database_sha256: pin.sha256(),
            database_bytes: pin.bytes(),
            assets,
            retained_assets,
            conversion_receipt_sha256,
            conversion_receipt,
        };
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join("manifest.json"))
            .map_err(|_| bundle_error())?;
        file.write_all(&serde_jcs::to_vec(&manifest).map_err(|_| bundle_error())?)
            .map_err(|_| bundle_error())?;
        file.sync_all().map_err(|_| bundle_error())?;
        fs::File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| bundle_error())?;
        full_bundle_check(directory, &self.contract, peers, owners, check)
    }
    pub fn verify_full_geodata_recovery<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        directory: &Path,
        contract: &C,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        owners: &GeodataOwners,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<FullGeodataBundle> {
        full_bundle_check(directory, contract, peers, owners, check)
    }
    pub fn restore_full_geodata_recovery<
        S: crate::domain::stock::StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        bundle: &Path,
        destination: &Path,
        contract: &C,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        owners: &GeodataOwners,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<FullGeodataBundle> {
        use std::{
            fs,
            os::unix::fs::{DirBuilderExt, OpenOptionsExt},
        };
        let manifest = full_bundle_check(bundle, contract, peers, owners, check)?;
        let pin = super::recovery::ClosedSource::open(&bundle.join("atlas.sqlite"), check)?;
        pin.require_delete()?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(destination)
            .map_err(|_| bundle_error())?;
        let path = destination.join("atlas.sqlite");
        drop(
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(|_| bundle_error())?,
        );
        use std::io::{Read, Write};
        let mut source_file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
            .open(bundle.join("atlas.sqlite"))
            .map_err(|_| bundle_error())?;
        let mut target_file = fs::OpenOptions::new()
            .write(true)
            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
            .open(&path)
            .map_err(|_| bundle_error())?;
        let mut block = [0u8; 65536];
        let mut copied = 0u64;
        loop {
            check()?;
            let n = source_file.read(&mut block).map_err(|_| bundle_error())?;
            if n == 0 {
                break;
            }
            copied = copied.checked_add(n as u64).ok_or_else(bundle_error)?;
            if copied > manifest.database_bytes {
                return Err(bundle_error());
            }
            target_file
                .write_all(&block[..n])
                .map_err(|_| bundle_error())?;
        }
        if copied != manifest.database_bytes {
            return Err(bundle_error());
        }
        target_file.sync_all().map_err(|_| bundle_error())?;
        let original =
            m::AssetVault::open_existing(&bundle.join("media")).map_err(|_| bundle_error())?;
        let target = m::AssetVault::open(&destination.join("media")).map_err(|_| bundle_error())?;
        let budget = m::WorkBudget::new_offline_backup().map_err(|_| bundle_error())?;
        for record in &manifest.assets {
            check()?;
            if manifest.retained_assets.contains(&asset_pin(record)?) {
                let bytes = original
                    .read_retained(record, &budget)
                    .map_err(|_| bundle_error())?;
                target
                    .restore_retained(record, &bytes, &budget)
                    .map_err(|_| bundle_error())?;
            }
        }
        pin.check(check)?;
        let checked = super::recovery::ClosedSource::open(&path, check)?;
        checked.require_delete()?;
        if checked.sha256() != manifest.database_sha256 {
            return Err(bundle_error());
        }
        let mut manifest_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
            .open(destination.join("manifest.json"))
            .map_err(|_| bundle_error())?;
        manifest_file
            .write_all(&serde_jcs::to_vec(&manifest).map_err(|_| bundle_error())?)
            .map_err(|_| bundle_error())?;
        manifest_file.sync_all().map_err(|_| bundle_error())?;
        fs::File::open(destination)
            .and_then(|f| f.sync_all())
            .map_err(|_| bundle_error())?;
        full_bundle_check(destination, contract, peers, owners, check)
    }
}
