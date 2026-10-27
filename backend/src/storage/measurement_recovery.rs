//! Strict combined-image qualification and fresh capture/restore. No automatic
//! conversion, Access/session restore, source grant or default runtime selection.
pub struct MeasurementOpenInput<'a, 'peers, C, A, R, S, D, E> {
    pub path: &'a Path,
    pub selection: profile::MeasurementProfileSelection,
    pub contract: C,
    pub authorization: A,
    pub runtime: R,
    pub options: StoreOptions,
    pub documents: GeodataOwners,
    pub owners: MeasurementOwners,
    pub peers: &'a RecoveryValidationPeers<'peers, S, D, E>,
    pub evidence: &'a dyn MeasurementRecoveryEvidence,
    pub check: &'a mut dyn FnMut() -> Result<()>,
}

pub struct MeasurementRestoreInput<'a, 'peers, C, A, F, S, D, E> {
    pub bundle: &'a Path,
    pub destination: &'a Path,
    pub trusted_manifest_sha256: &'a str,
    pub selection: profile::MeasurementProfileSelection,
    pub contract: C,
    pub authorization: A,
    pub options: StoreOptions,
    pub documents: GeodataOwners,
    pub owners_factory: F,
    pub peers: &'a RecoveryValidationPeers<'peers, S, D, E>,
    pub evidence: &'a dyn MeasurementRecoveryEvidence,
    pub check: &'a mut dyn FnMut() -> Result<()>,
}

use super::super::{
    Authorization, Contract, Error, Result, Runtime, Scope, geodata::GeodataOwners, geodata_full,
};
use super::{
    AtlasStore, RecoveryValidationPeers, StoreOptions,
    measurement_assertions::{self as service, MeasurementBinding},
    measurement_assertions_repository as repo, measurement_profile as profile,
};
use crate::{
    app::measurement_assertions::{MeasurementNativeFacts, MeasurementOwners},
    contracts::measurement_assertions as wire,
    measurement_assertions::online_contract as online,
    media as m,
};
use rusqlite::{
    Connection, OpenFlags,
    backup::{Backup, StepResult},
    params,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::Path,
    sync::Arc,
};
fn invalid() -> Error {
    Error::new(
        "schema-incompatible",
        "Measurement recovery image is incompatible",
    )
}
fn contract_error(_: crate::contracts::ContractError) -> Error {
    invalid()
}
fn need(ok: bool) -> Result<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}
const MAX_SQL: u64 = 256 * 1024 * 1024;
const MAX_MEDIA: u64 = 256 * 1024 * 1024;

/// A live WAL database is not a detached recovery image. Retain the original
/// no-follow descriptor and canonical main-file identity across BOTH SQL opens;
/// SQLite qualifies the complete logical image, including its WAL, in each
/// transaction. This does not hash an incomplete main-file-only image, demand
/// absent sidecars, checkpoint WAL, or convert a live database to DELETE mode.
struct LiveWalPin {
    path: std::path::PathBuf,
    file: File,
    dev: u64,
    ino: u64,
    sidecars: std::cell::RefCell<Vec<(std::path::PathBuf, File)>>,
}
impl LiveWalPin {
    fn open(path: &Path) -> Result<Self> {
        need(path.is_absolute() && fs::canonicalize(path).map_err(|_| invalid())? == path)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
            .open(path)
            .map_err(|_| invalid())?;
        let meta = file.metadata().map_err(|_| invalid())?;
        need(
            meta.is_file()
                && meta.nlink() == 1
                && meta.uid() == rustix::process::geteuid().as_raw()
                && meta.mode() & 0o7777 == 0o600
                && meta.len() <= MAX_SQL,
        )?;
        let mut header = [0u8; 100];
        use std::os::unix::fs::FileExt;
        file.read_exact_at(&mut header, 0).map_err(|_| invalid())?;
        need(&header[..16] == b"SQLite format 3\0" && header[18] == 2 && header[19] == 2)?;
        let p = Self {
            path: path.into(),
            file,
            dev: meta.dev(),
            ino: meta.ino(),
            sidecars: Default::default(),
        };
        p.check()?;
        Ok(p)
    }
    fn check(&self) -> Result<()> {
        let a = self.file.metadata().map_err(|_| invalid())?;
        let b = fs::symlink_metadata(&self.path).map_err(|_| invalid())?;
        need(
            a.is_file()
                && b.is_file()
                && !b.file_type().is_symlink()
                && a.dev() == self.dev
                && b.dev() == self.dev
                && a.ino() == self.ino
                && b.ino() == self.ino
                && a.nlink() == 1
                && b.nlink() == 1
                && a.uid() == rustix::process::geteuid().as_raw()
                && b.uid() == a.uid()
                && a.mode() & 0o7777 == 0o600
                && b.mode() & 0o7777 == 0o600
                && a.len() <= MAX_SQL,
        )?;
        // SQLite owns sidecar contents; reject substituted, aliased or foreign
        // files without requiring sidecars to exist before a legitimate open.
        for suffix in ["-wal", "-shm"] {
            let mut name = self.path.as_os_str().to_os_string();
            name.push(suffix);
            match fs::symlink_metadata(Path::new(&name)) {
                Ok(m) => {
                    need(
                        m.is_file()
                            && !m.file_type().is_symlink()
                            && m.nlink() == 1
                            && m.uid() == a.uid()
                            && m.mode() & 0o077 == 0
                            && m.len() <= MAX_SQL,
                    )?;
                    let path = std::path::PathBuf::from(&name);
                    let mut retained = self.sidecars.borrow_mut();
                    if let Some((_, file)) = retained.iter().find(|(p, _)| *p == path) {
                        let original = file.metadata().map_err(|_| invalid())?;
                        need(
                            original.dev() == m.dev()
                                && original.ino() == m.ino()
                                && original.nlink() == 1,
                        )?;
                    } else {
                        let file = OpenOptions::new()
                            .read(true)
                            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
                            .open(&path)
                            .map_err(|_| invalid())?;
                        let opened = file.metadata().map_err(|_| invalid())?;
                        need(opened.dev() == m.dev() && opened.ino() == m.ino())?;
                        retained.push((path, file));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    need(
                        !self
                            .sidecars
                            .borrow()
                            .iter()
                            .any(|(p, _)| p.as_os_str() == name.as_os_str()),
                    )?;
                }
                Err(_) => return Err(invalid()),
            }
        }
        Ok(())
    }
}

/// Original recovery evidence owner, NOT a callback mintable from JSON. It must
/// qualify exact historical native/source/artifact references, actual preserved
/// ancestry and unavailable facts honestly. It cannot reconstruct old seed
/// payloads, grants or historical command guards from a digest. Missing required
/// original evidence must refuse this complete-image qualification. No default.
pub trait MeasurementRecoveryEvidence {
    fn verify_retained(
        &self,
        facts: &MeasurementNativeFacts,
        complete_receipts: &[Value],
    ) -> Result<crate::app::measurement_assertions::MeasurementInventoryReport>;
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasurementBundle {
    pub format: String,
    pub lineage: String,
    pub catalog_version: u32,
    pub measurement_contract: String,
    pub native_contract: String,
    pub document_contract: String,
    pub catalog_sha256: String,
    pub database_sha256: String,
    pub database_bytes: u64,
    pub assets: Vec<m::types::AssetRecord>,
    pub retained_assets: Vec<String>,
    pub conversion_receipt_sha256: String,
    pub conversion_receipt: geodata_full::ConversionReceipt,
}
#[derive(Clone, Debug)]
pub struct MeasurementBundleReport {
    pub manifest: MeasurementBundle,
    pub manifest_sha256: String,
    pub inventory: Vec<crate::app::measurement_assertions::MeasurementInventoryReport>,
}
fn asset_pin(a: &m::types::AssetRecord) -> Result<String> {
    wire::digest(&serde_json::to_value(a)?).map_err(contract_error)
}

pub(super) fn validate<C, S, D, E>(
    db: &Connection,
    contract: &C,
    peers: &RecoveryValidationPeers<'_, S, D, E>,
    documents: &GeodataOwners,
    evidence: &dyn MeasurementRecoveryEvidence,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<Vec<crate::app::measurement_assertions::MeasurementInventoryReport>>
where
    C: Contract,
    S: crate::domain::stock::StockContractPort,
    D: super::super::QueueDiscovery,
    E: super::super::QueueRecoveryEvidence,
{
    super::recovery::validate_measurement_core(db, contract, peers, check)?;
    let budget = m::WorkBudget::new_offline_backup().map_err(|_| invalid())?;
    documents.recovery(db).validate_document_closure(&budget)?;
    geodata_full::validate_legacy_bytes(db, documents.vault(), check)?;
    let mut sequence = 0i64;
    let mut statement=db.prepare("SELECT seq,workspace_id,home_id,assertion_id,audit_id,actor_id,mutation_id,body FROM measurement_audits ORDER BY seq")?;
    let mut audits = statement.query([])?;
    while let Some(row) = audits.next()? {
        check()?;
        sequence = sequence.checked_add(1).ok_or_else(invalid)?;
        let scope = Scope {
            workspace_id: row.get(1)?,
            home_id: row.get(2)?,
        };
        let body: String = row.get(7)?;
        let audit = wire::parse(body.as_bytes()).map_err(contract_error)?;
        wire::validate_value("audit", &audit).map_err(contract_error)?;
        need(
            row.get::<_, i64>(0)? == sequence
                && wire::canonical(&audit).map_err(contract_error)? == body
                && audit["scope"]["workspaceId"] == scope.workspace_id
                && audit["scope"]["homeId"] == scope.home_id
                && audit["assertionId"] == row.get::<_, String>(3)?
                && audit["auditId"] == row.get::<_, String>(4)?
                && audit["actorId"] == row.get::<_, String>(5)?
                && audit["mutationId"] == row.get::<_, String>(6)?,
        )?;
        let retained = repo::lookup(
            db,
            &scope,
            &row.get::<_, String>(5)?,
            &row.get::<_, String>(6)?,
        )?
        .ok_or_else(invalid)?;
        need(retained.body["audit"] == audit)?;
    }
    let collisions:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM measurement_heads h JOIN records r ON h.workspace_id=r.workspace_id AND h.assertion_id=r.record_id UNION ALL SELECT 1 FROM measurement_heads h JOIN geodata_records g ON h.workspace_id=g.workspace_id AND h.assertion_id=g.record_id)",[],|r|r.get(0))?;
    need(!collisions)?;
    let scopes=db.prepare("SELECT workspace_id,home_id FROM measurement_mutation_receipts UNION SELECT workspace_id,home_id FROM measurement_heads ORDER BY 1,2 LIMIT 4097")?
        .query_map([],|r|Ok(Scope{workspace_id:r.get(0)?,home_id:r.get(1)?}))?.collect::<rusqlite::Result<Vec<_>>>()?;
    need(scopes.len() <= 4096)?;
    let mut inventory = Vec::new();
    for scope in scopes {
        check()?;
        let rows = repo::complete_home(db, &scope)?;
        let all = service::assertions(&rows)?;
        let f = service::facts(db, &scope)?;
        let receipts = rows.iter().map(|r| r.body.clone()).collect::<Vec<_>>();
        inventory.push(evidence.verify_retained(&f, &receipts)?);
        let heads=db.prepare("SELECT assertion_id FROM measurement_heads WHERE workspace_id=?1 AND home_id=?2 ORDER BY assertion_id")?
            .query_map(params![scope.workspace_id,scope.home_id],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let distinct = all
            .iter()
            .map(|a| a.version.assertion_id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        need(heads.len() == distinct.len())?;
        for id in heads {
            check()?;
            let head = repo::head(db, &scope, &id)?.ok_or_else(invalid)?;
            let point = online::ReadPoint {
                marker: "measurement-complete-image-validation".into(),
            };
            let history = service::history(&scope, &id, &head, &rows, &point)?;
            online::validate_full_history(&history, &all).map_err(|_| invalid())?;
            let stream = rows
                .iter()
                .filter(|r| r.body["committed"]["assertion"]["version"]["assertionId"] == id)
                .collect::<Vec<_>>();
            for (index, row) in stream.iter().enumerate() {
                let before = if index == 0 {
                    Value::Null
                } else {
                    Value::String(
                        wire::full_assertion_digest(
                            &stream[index - 1].body["committed"]["assertion"],
                        )
                        .map_err(contract_error)?,
                    )
                };
                need(row.body["audit"]["beforeDigest"] == before)?;
            }
        }
    }
    Ok(inventory)
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// READ_WRITE without CREATE, with same-handle query-only validation before
    /// WAL/write enablement. This accepts NO predecessor/implicit upgrade.
    pub fn open_existing_measurements<S, D, E>(
        input: MeasurementOpenInput<'_, '_, C, A, R, S, D, E>,
    ) -> Result<(Self, MeasurementBinding)>
    where
        S: crate::domain::stock::StockContractPort,
        D: super::super::QueueDiscovery,
        E: super::super::QueueRecoveryEvidence,
    {
        let MeasurementOpenInput {
            path,
            selection,
            contract,
            authorization,
            runtime,
            options,
            documents,
            owners,
            peers,
            evidence,
            check,
        } = input;
        let live = LiveWalPin::open(path)?;
        let result = Self::open_measurement_handle(
            false,
            MeasurementOpenInput {
                path,
                selection,
                contract,
                authorization,
                runtime,
                options,
                documents,
                owners,
                peers,
                evidence,
                check,
            },
        )?;
        live.check()?;
        Ok(result)
    }
    fn open_measurement_handle<S, D, E>(
        fresh_restored_delete: bool,
        input: MeasurementOpenInput<'_, '_, C, A, R, S, D, E>,
    ) -> Result<(Self, MeasurementBinding)>
    where
        S: crate::domain::stock::StockContractPort,
        D: super::super::QueueDiscovery,
        E: super::super::QueueRecoveryEvidence,
    {
        let MeasurementOpenInput {
            path,
            selection,
            contract,
            authorization,
            runtime,
            options,
            documents,
            owners,
            peers,
            evidence,
            check,
        } = input;
        need(
            selection == profile::MeasurementProfileSelection::MeasurementsV1
                && !options.allow_synthetic_bootstrap
                && !options.stock_activity_profile,
        )?;
        options.require_available_profile()?;
        need(documents.belongs_to(owners.access(), &owners.vault_for_composition()))?;
        let detached = if fresh_restored_delete {
            let p = super::recovery::ClosedSource::open(path, check)?;
            p.require_delete()?;
            need(p.bytes() <= MAX_SQL)?;
            Some(p)
        } else {
            None
        };
        let live = if fresh_restored_delete {
            None
        } else {
            Some(LiveWalPin::open(path)?)
        };
        let probe = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        need(
            probe.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))?
                == if fresh_restored_delete {
                    "delete"
                } else {
                    "wal"
                },
        )?;
        {
            let tx = probe.unchecked_transaction()?;
            validate(&tx, &contract, peers, &documents, evidence, check)?;
            tx.commit()?;
        }
        probe.close().map_err(|(_, e)| Error::from(e))?;
        if let Some(p) = &detached {
            p.check(check)?;
        }
        if let Some(p) = &live {
            p.check()?;
        }
        let db = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        db.pragma_update(None, "query_only", true)?;
        {
            let tx = db.unchecked_transaction()?;
            validate(&tx, &contract, peers, &documents, evidence, check)?;
            tx.commit()?;
        }
        if let Some(p) = &detached {
            p.check(check)?;
        }
        if let Some(p) = &live {
            p.check()?;
        }
        if options.busy_timeout_ms > 60_000 {
            return Err(invalid());
        }
        db.busy_timeout(std::time::Duration::from_millis(options.busy_timeout_ms))?;
        db.pragma_update(None, "query_only", false)?;
        db.execute_batch("PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;")?;
        // Only the explicit fresh restore path promotes its newly verified
        // destination to normal WAL service. Normal reopen never changes mode.
        if fresh_restored_delete {
            db.pragma_update(None, "journal_mode", "WAL")?;
        }
        need(db.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))? == "wal")?;
        if let Some(p) = &live {
            p.check()?;
        }
        let instance = Arc::new(());
        let binding = MeasurementBinding {
            identity: profile::MeasurementProfileIdentity {
                instance: instance.clone(),
            },
            owners,
        };
        Ok((
            Self {
                db,
                instance,
                full_geodata: Some(documents),
                cache_pins: super::cache_custody::CachePinRegistry::default(),
                contract,
                authorization,
                runtime,
                options,
            },
            binding,
        ))
    }
    /// Caller holds the original exclusive Store owner and quiesces all writers.
    /// Capture selects no service or restore authority and restores no sessions.
    pub fn capture_measurements<S, D, E>(
        &self,
        directory: &Path,
        binding: &MeasurementBinding,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        evidence: &dyn MeasurementRecoveryEvidence,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<MeasurementBundleReport>
    where
        S: crate::domain::stock::StockContractPort,
        D: super::super::QueueDiscovery,
        E: super::super::QueueRecoveryEvidence,
        A: Authorization<Principal = crate::app::RequestPrincipal>,
    {
        need(self.measurement_binding_matches(binding))?;
        let owners = self.full_geodata.as_ref().ok_or_else(invalid)?;
        let tx = self.db.unchecked_transaction()?;
        validate(&tx, &self.contract, peers, owners, evidence, check)?;
        let budget = m::WorkBudget::new_offline_backup().map_err(|_| invalid())?;
        let assets = owners.recovery(&tx).recovery_media()?;
        need(assets.len() <= 4096)?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(directory)
            .map_err(|_| invalid())?;
        let path = directory.join("atlas.sqlite");
        drop(
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
                .open(&path)
                .map_err(|_| invalid())?,
        );
        let mut copy = Connection::open(&path)?;
        {
            let backup = Backup::new(&tx, &mut copy)?;
            loop {
                check()?;
                match backup.step(128)? {
                    StepResult::Done => break,
                    StepResult::More => {}
                    _ => return Err(invalid()),
                }
            }
        }
        copy.pragma_update(None, "journal_mode", "DELETE")?;
        copy.close().map_err(|(_, e)| Error::from(e))?;
        let vault = m::AssetVault::open(&directory.join("media")).map_err(|_| invalid())?;
        let mut retained_assets = Vec::new();
        let mut media_bytes = 0u64;
        for asset in &assets {
            check()?;
            if let Some(bytes) = geodata_full::retained_bytes(asset, owners.vault(), &budget)? {
                media_bytes = media_bytes
                    .checked_add(bytes.len() as u64)
                    .ok_or_else(invalid)?;
                need(media_bytes <= MAX_MEDIA)?;
                vault
                    .restore_retained(asset, &bytes, &budget)
                    .map_err(|_| invalid())?;
                retained_assets.push(asset_pin(asset)?);
            }
        }
        let (conversion_receipt_sha256, conversion_receipt) =
            geodata_full::conversion_receipt(&tx)?;
        tx.commit()?;
        let pin = super::recovery::ClosedSource::open(&path, check)?;
        pin.require_delete()?;
        need(pin.bytes() <= MAX_SQL)?;
        let manifest = MeasurementBundle {
            format: profile::MEASUREMENT_RECOVERY_FORMAT.into(),
            lineage: profile::MEASUREMENT_LINEAGE.into(),
            catalog_version: 1,
            measurement_contract: "1.0.0".into(),
            native_contract: "1.0.0".into(),
            document_contract: "2.0.0".into(),
            catalog_sha256: profile::measurement_catalog_pin()?,
            database_sha256: pin.sha256(),
            database_bytes: pin.bytes(),
            assets,
            retained_assets,
            conversion_receipt_sha256,
            conversion_receipt,
        };
        let bytes = wire::canonical(&serde_json::to_value(&manifest)?)
            .map_err(contract_error)?
            .into_bytes();
        write_new(&directory.join("manifest.json"), &bytes)?;
        File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())?;
        let expected = m::types::sha256(&bytes);
        verify_bundle(
            directory,
            &expected,
            &self.contract,
            peers,
            owners,
            evidence,
            check,
        )
    }
    pub fn verify_measurements_bundle<S, D, E>(
        directory: &Path,
        trusted_manifest_sha256: &str,
        contract: &C,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        owners: &GeodataOwners,
        evidence: &dyn MeasurementRecoveryEvidence,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<MeasurementBundleReport>
    where
        S: crate::domain::stock::StockContractPort,
        D: super::super::QueueDiscovery,
        E: super::super::QueueRecoveryEvidence,
    {
        verify_bundle(
            directory,
            trusted_manifest_sha256,
            contract,
            peers,
            owners,
            evidence,
            check,
        )
    }
    /// Fresh destination only. It copies verified original SQL/media, validates
    /// the complete target, then strictly reopens with NEW supplied native peers.
    pub fn restore_measurements<S, D, E, F>(
        input: MeasurementRestoreInput<'_, '_, C, A, F, S, D, E>,
    ) -> Result<(Self, MeasurementBinding, MeasurementBundleReport)>
    where
        S: crate::domain::stock::StockContractPort,
        D: super::super::QueueDiscovery,
        E: super::super::QueueRecoveryEvidence,
        F: FnOnce(Arc<m::AssetVault>) -> Result<(R, MeasurementOwners)>,
    {
        let MeasurementRestoreInput {
            bundle,
            destination,
            trusted_manifest_sha256,
            selection,
            contract,
            authorization,
            options,
            documents,
            owners_factory,
            peers,
            evidence,
            check,
        } = input;
        let report = verify_bundle(
            bundle,
            trusted_manifest_sha256,
            &contract,
            peers,
            &documents,
            evidence,
            check,
        )?;
        let pin = super::recovery::ClosedSource::open(&bundle.join("atlas.sqlite"), check)?;
        pin.require_delete()?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(destination)
            .map_err(|_| invalid())?;
        copy_new(
            &bundle.join("atlas.sqlite"),
            &destination.join("atlas.sqlite"),
            report.manifest.database_bytes,
            check,
        )?;
        pin.check(check)?;
        let source = m::AssetVault::open_existing(&bundle.join("media")).map_err(|_| invalid())?;
        let target =
            Arc::new(m::AssetVault::open(&destination.join("media")).map_err(|_| invalid())?);
        let budget = m::WorkBudget::new_offline_backup().map_err(|_| invalid())?;
        for a in &report.manifest.assets {
            check()?;
            if report.manifest.retained_assets.contains(&asset_pin(a)?) {
                let bytes = source.read_retained(a, &budget).map_err(|_| invalid())?;
                target
                    .restore_retained(a, &bytes, &budget)
                    .map_err(|_| invalid())?;
            }
        }
        let manifest_bytes = read_manifest_bytes(bundle)?;
        need(m::types::sha256(&manifest_bytes) == trusted_manifest_sha256)?;
        write_new(&destination.join("manifest.json"), &manifest_bytes)?;
        File::open(destination)
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())?;
        let documents = documents.for_vault(target.clone());
        let checked = verify_bundle(
            destination,
            trusted_manifest_sha256,
            &contract,
            peers,
            &documents,
            evidence,
            check,
        )?;
        // This is an independently supplied native-owner factory over the new
        // verified vault, never a SQL/transaction callback or deserialized grant.
        // It must bind fresh original Access/policy peers supplied by the caller.
        let (runtime, owners) = owners_factory(target.clone())?;
        need(documents.belongs_to(owners.access(), &target))?;
        let (store, binding) = Self::open_measurement_handle(
            true,
            MeasurementOpenInput {
                path: &destination.join("atlas.sqlite"),
                selection,
                contract,
                authorization,
                runtime,
                options,
                documents,
                owners,
                peers,
                evidence,
                check,
            },
        )?;
        Ok((store, binding, checked))
    }
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(path)
        .map_err(|_| invalid())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| invalid())
}
fn copy_new(
    source: &Path,
    target: &Path,
    expected: u64,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    need(expected <= MAX_SQL)?;
    let mut input = OpenOptions::new()
        .read(true)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(source)
        .map_err(|_| invalid())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(target)
        .map_err(|_| invalid())?;
    let mut bytes = 0u64;
    let mut block = [0u8; 65536];
    loop {
        check()?;
        let n = input.read(&mut block).map_err(|_| invalid())?;
        if n == 0 {
            break;
        }
        bytes = bytes.checked_add(n as u64).ok_or_else(invalid)?;
        need(bytes <= expected)?;
        output.write_all(&block[..n]).map_err(|_| invalid())?;
    }
    need(bytes == expected)?;
    output.sync_all().map_err(|_| invalid())
}
fn read_manifest_bytes(directory: &Path) -> Result<Vec<u8>> {
    let meta = fs::symlink_metadata(directory).map_err(|_| invalid())?;
    need(meta.is_dir() && meta.mode() & 0o077 == 0)?;
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(directory.join("manifest.json"))
        .map_err(|_| invalid())?;
    let meta = file.metadata().map_err(|_| invalid())?;
    need(
        meta.is_file()
            && meta.nlink() == 1
            && meta.mode() & 0o077 == 0
            && meta.len() <= 4 * 1024 * 1024,
    )?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| invalid())?;
    need(bytes.len() as u64 == meta.len())?;
    Ok(bytes)
}
fn verify_bundle<C, S, D, E>(
    directory: &Path,
    trusted_manifest_sha256: &str,
    contract: &C,
    peers: &RecoveryValidationPeers<'_, S, D, E>,
    owners: &GeodataOwners,
    evidence: &dyn MeasurementRecoveryEvidence,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<MeasurementBundleReport>
where
    C: Contract,
    S: crate::domain::stock::StockContractPort,
    D: super::super::QueueDiscovery,
    E: super::super::QueueRecoveryEvidence,
{
    check()?;
    let bytes = read_manifest_bytes(directory)?;
    need(m::types::sha256(&bytes) == trusted_manifest_sha256)?;
    let value = wire::parse(&bytes).map_err(contract_error)?;
    need(wire::canonical(&value).map_err(contract_error)?.as_bytes() == bytes)?;
    let manifest: MeasurementBundle = serde_json::from_value(value)?;
    need(
        manifest.format == profile::MEASUREMENT_RECOVERY_FORMAT
            && manifest.lineage == profile::MEASUREMENT_LINEAGE
            && manifest.catalog_version == 1
            && manifest.measurement_contract == "1.0.0"
            && manifest.native_contract == "1.0.0"
            && manifest.document_contract == "2.0.0"
            && manifest.catalog_sha256 == profile::measurement_catalog_pin()?
            && manifest.database_bytes <= MAX_SQL
            && manifest.assets.len() <= 4096,
    )?;
    let pin = super::recovery::ClosedSource::open(&directory.join("atlas.sqlite"), check)?;
    pin.require_delete()?;
    need(pin.sha256() == manifest.database_sha256 && pin.bytes() == manifest.database_bytes)?;
    let vault =
        Arc::new(m::AssetVault::open_existing(&directory.join("media")).map_err(|_| invalid())?);
    let bound = owners.for_vault(vault.clone());
    let db = Connection::open_with_flags(
        directory.join("atlas.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    let tx = db.unchecked_transaction()?;
    let inventory = validate(&tx, contract, peers, &bound, evidence, check)?;
    let (sha, ancestry) = geodata_full::conversion_receipt(&tx)?;
    need(
        sha == manifest.conversion_receipt_sha256
            && wire::canonical(&serde_json::to_value(ancestry)?).map_err(contract_error)?
                == wire::canonical(&serde_json::to_value(&manifest.conversion_receipt)?)
                    .map_err(contract_error)?,
    )?;
    let actual = bound.recovery(&tx).recovery_media()?;
    need(actual.len() == manifest.assets.len())?;
    let budget = m::WorkBudget::new_offline_backup().map_err(|_| invalid())?;
    let mut retained = Vec::new();
    let mut total = 0u64;
    for (a, b) in actual.iter().zip(&manifest.assets) {
        check()?;
        need(asset_pin(a)? == asset_pin(b)?)?;
        if let Some(bytes) = geodata_full::retained_bytes(a, &vault, &budget)? {
            total = total.checked_add(bytes.len() as u64).ok_or_else(invalid)?;
            need(total <= MAX_MEDIA)?;
            retained.push(asset_pin(a)?);
        }
    }
    need(retained == manifest.retained_assets)?;
    tx.commit()?;
    db.close().map_err(|(_, e)| Error::from(e))?;
    pin.check(check)?;
    need(read_manifest_bytes(directory)? == bytes)?;
    Ok(MeasurementBundleReport {
        manifest,
        manifest_sha256: trusted_manifest_sha256.into(),
        inventory,
    })
}
