//! Private external qualifier for the PR185 public backend API. Qualification
//! never converts an input, binds state, authenticates or activates a service.
//! Only self-check converts its own newly generated empty synthetic fixture.
//! Build against the exact product rlib plus its existing direct dependencies:
//! houseatlas_backend, rusqlite, serde_json, sha2 and rustix. No Cargo changes.
//!
//! policy-only --policy PATH --policy-sha256 HEX
//! qualify --source-db PATH --source-sha256 HEX --source-vault PATH
//!   --raw-db PATH --raw-sha256 HEX --raw-vault PATH --policy PATH
//!   --policy-sha256 HEX --output-root ABSENT --expected-media-files N
//! self-check --output-root ABSENT
//!
//! Inputs must remain excluded from writers by their owner. All qualification
//! writes are confined to the new private output root. Failures retain it for
//! review, never retry, delete, repair or claim that no output was produced.
use houseatlas_backend::{
    access::{AccessBoundary, AccessConfig},
    app::{ReadAuthority, ServerRuntime, Store},
    contracts::v2,
    domain::stock::NativeStockContract,
    http::contracts::NativeContracts,
    lifecycle::backup::QueueFreeNativeOwners,
    media::{AssetVault, Cancellation, WorkBudget, native::NativeMediaRuntime},
    storage::{
        self, FullGeodataBundle, geodata::GeodataOwners, geodata_policy::PinnedGeodataSourcePolicy,
    },
};
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    cell::Cell,
    collections::BTreeMap,
    fs::{self, File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    },
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, ()>;
const DB_CAP: u64 = 64 * 1024 * 1024;
const POLICY_CAP: u64 = 4 * 1024 * 1024;
const FILE_CAP: u64 = 10 * 1024 * 1024;
const TREE_CAP: u64 = 256 * 1024 * 1024;
const MAX_FILES: usize = 512;
const MAX_ENTRIES: usize = 4096;
const GEODATA: [&str; 7] = [
    "geodata_records",
    "geodata_audits",
    "geodata_mutation_receipts",
    "geodata_asset_manifests",
    "geodata_receipts",
    "geodata_document_refs",
    "geodata_epochs",
];

struct Run {
    start: Instant,
    stage: Cell<&'static str>,
}
impl Run {
    fn check(&self) -> Result<()> {
        need(self.start.elapsed() < Duration::from_secs(90))
    }
    fn at(&self, stage: &'static str) -> Result<()> {
        self.stage.set(stage);
        self.check()
    }
    fn storage_check(&self) -> storage::Result<()> {
        self.check().map_err(|_| {
            storage::Error::new(
                "storage-unavailable",
                "External qualification deadline elapsed",
            )
        })
    }
}
fn need(value: bool) -> Result<()> {
    if value { Ok(()) } else { Err(()) }
}
fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}
fn sha(bytes: &[u8]) -> String {
    hex(Sha256::digest(bytes))
}
fn digest(value: &str) -> Result<()> {
    need(
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
    )
}
fn absolute(path: &Path) -> Result<()> {
    need(
        path.is_absolute()
            && !path
                .components()
                .any(|p| matches!(p, Component::ParentDir | Component::CurDir)),
    )
}
fn canonical(path: &Path) -> Result<()> {
    absolute(path)?;
    need(fs::canonicalize(path).map_err(|_| ())? == path)
}

#[derive(Clone, PartialEq, Eq)]
struct Stamp {
    dev: u64,
    ino: u64,
    mode: u32,
    uid: u32,
    links: u64,
    bytes: u64,
    mtime: i64,
    mtime_ns: i64,
    ctime: i64,
    ctime_ns: i64,
}
impl Stamp {
    fn of(m: &Metadata) -> Self {
        Self {
            dev: m.dev(),
            ino: m.ino(),
            mode: m.mode(),
            uid: m.uid(),
            links: m.nlink(),
            bytes: m.len(),
            mtime: m.mtime(),
            mtime_ns: m.mtime_nsec(),
            ctime: m.ctime(),
            ctime_ns: m.ctime_nsec(),
        }
    }
}
fn private_meta(path: &Path, directory: bool, file_mode: u32) -> Result<Metadata> {
    canonical(path)?;
    let m = fs::symlink_metadata(path).map_err(|_| ())?;
    need(
        !m.file_type().is_symlink()
            && m.uid() == rustix::process::geteuid().as_raw()
            && m.mode() & 0o7777 == if directory { 0o700 } else { file_mode }
            && if directory {
                m.is_dir()
            } else {
                m.is_file() && m.nlink() == 1
            },
    )?;
    Ok(m)
}
fn private_dir(path: &Path) -> Result<Stamp> {
    Ok(Stamp::of(&private_meta(path, true, 0)?))
}
fn no_sidecars(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut p = path.as_os_str().to_os_string();
        p.push(suffix);
        match fs::symlink_metadata(PathBuf::from(p)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(()),
        }
    }
    Ok(())
}
fn hash_file(file: &File, cap: u64, run: &Run) -> Result<(String, u64)> {
    let mut file = file;
    file.seek(SeekFrom::Start(0)).map_err(|_| ())?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut block = [0u8; 65536];
    loop {
        run.check()?;
        let n = file.read(&mut block).map_err(|_| ())?;
        if n == 0 {
            break;
        }
        total = total.checked_add(n as u64).ok_or(())?;
        need(total <= cap)?;
        hash.update(&block[..n]);
    }
    Ok((hex(hash.finalize()), total))
}
struct Pin {
    path: PathBuf,
    file: File,
    stamp: Stamp,
    sha: String,
    cap: u64,
}
impl Pin {
    fn open(path: &Path, cap: u64, run: &Run) -> Result<Self> {
        Self::open_mode(path, cap, 0o600, run)
    }
    fn open_mode(path: &Path, cap: u64, mode: u32, run: &Run) -> Result<Self> {
        need(matches!(mode, 0o400 | 0o600))?;
        let before = private_meta(path, false, mode)?;
        need(before.len() <= cap)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(
                (rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::NONBLOCK
                    | rustix::fs::OFlags::CLOEXEC)
                    .bits() as i32,
            )
            .open(path)
            .map_err(|_| ())?;
        need(Stamp::of(&file.metadata().map_err(|_| ())?) == Stamp::of(&before))?;
        let (sha, bytes) = hash_file(&file, cap, run)?;
        need(bytes == before.len())?;
        let pin = Self {
            path: path.into(),
            file,
            stamp: Stamp::of(&before),
            sha,
            cap,
        };
        pin.check(run)?;
        Ok(pin)
    }
    fn check(&self, run: &Run) -> Result<()> {
        need(
            Stamp::of(&private_meta(&self.path, false, self.stamp.mode & 0o7777)?) == self.stamp
                && Stamp::of(&self.file.metadata().map_err(|_| ())?) == self.stamp,
        )?;
        let (sha, bytes) = hash_file(&self.file, self.cap, run)?;
        need(sha == self.sha && bytes == self.stamp.bytes)?;
        need(Stamp::of(&private_meta(&self.path, false, self.stamp.mode & 0o7777)?) == self.stamp)
    }
    fn bytes(&self, run: &Run) -> Result<Vec<u8>> {
        self.check(run)?;
        let mut file = &self.file;
        file.seek(SeekFrom::Start(0)).map_err(|_| ())?;
        let mut bytes = Vec::new();
        file.take(self.cap + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ())?;
        need(bytes.len() as u64 == self.stamp.bytes && sha(&bytes) == self.sha)?;
        self.check(run)?;
        Ok(bytes)
    }
    fn db(&self, run: &Run) -> Result<()> {
        self.check(run)?;
        no_sidecars(&self.path)?;
        let mut file = &self.file;
        file.seek(SeekFrom::Start(0)).map_err(|_| ())?;
        let mut header = [0u8; 100];
        file.read_exact(&mut header).map_err(|_| ())?;
        need(
            &header[..16] == b"SQLite format 3\0"
                && matches!((header[18], header[19]), (1, 1) | (2, 2)),
        )
    }
}

#[derive(Clone, PartialEq, Eq)]
struct Entry {
    directory: bool,
    stamp: Stamp,
    sha: String,
}
struct Tree {
    root: PathBuf,
    entries: BTreeMap<PathBuf, Entry>,
    files: usize,
    bytes: u64,
    sha: String,
}
impl Tree {
    fn scan(root: &Path, run: &Run) -> Result<Self> {
        let mut tree = Self {
            root: root.into(),
            entries: BTreeMap::new(),
            files: 0,
            bytes: 0,
            sha: String::new(),
        };
        tree.walk(Path::new(""), 0, run)?;
        let mut hash = Sha256::new();
        for (path, entry) in &tree.entries {
            if entry.directory {
                continue;
            }
            frame(&mut hash, path.as_os_str().as_bytes());
            hash.update(entry.stamp.bytes.to_be_bytes());
            frame(&mut hash, entry.sha.as_bytes());
        }
        tree.sha = hex(hash.finalize());
        Ok(tree)
    }
    fn walk(&mut self, relative: &Path, depth: usize, run: &Run) -> Result<()> {
        run.check()?;
        need(depth <= 12 && self.entries.len() < MAX_ENTRIES)?;
        let path = self.root.join(relative);
        let stamp = private_dir(&path)?;
        self.entries.insert(
            relative.into(),
            Entry {
                directory: true,
                stamp: stamp.clone(),
                sha: String::new(),
            },
        );
        for e in fs::read_dir(&path).map_err(|_| ())? {
            let e = e.map_err(|_| ())?;
            let child = relative.join(e.file_name());
            need(child.as_os_str().as_bytes().len() <= 4096 && self.entries.len() < MAX_ENTRIES)?;
            let metadata = fs::symlink_metadata(e.path()).map_err(|_| ())?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                self.walk(&child, depth + 1, run)?;
            } else {
                let pin = Pin::open_mode(&e.path(), FILE_CAP, 0o400, run)?;
                self.files += 1;
                self.bytes = self.bytes.checked_add(pin.stamp.bytes).ok_or(())?;
                need(self.files <= MAX_FILES && self.bytes <= TREE_CAP)?;
                self.entries.insert(
                    child,
                    Entry {
                        directory: false,
                        stamp: pin.stamp,
                        sha: pin.sha,
                    },
                );
            }
        }
        need(private_dir(&path)? == stamp)
    }
    fn check(&self, run: &Run) -> Result<()> {
        let current = Self::scan(&self.root, run)?;
        need(current.entries == self.entries && current.sha == self.sha)
    }
    fn same_files(&self, other: &Self) -> Result<()> {
        need(self.files == other.files && self.bytes == other.bytes && self.sha == other.sha)
    }
}
fn frame(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}
fn make_dir(path: &Path) -> Result<()> {
    fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|_| ())?;
    private_dir(path)?;
    Ok(())
}
fn copy_file(pin: &Pin, destination: &Path, run: &Run) -> Result<()> {
    pin.check(run)?;
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(pin.stamp.mode & 0o7777)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC).bits() as i32)
        .open(destination)
        .map_err(|_| ())?;
    let mut source = &pin.file;
    source.seek(SeekFrom::Start(0)).map_err(|_| ())?;
    let mut total = 0u64;
    let mut hash = Sha256::new();
    let mut block = [0u8; 65536];
    loop {
        run.check()?;
        let n = source.read(&mut block).map_err(|_| ())?;
        if n == 0 {
            break;
        }
        total = total.checked_add(n as u64).ok_or(())?;
        need(total <= pin.stamp.bytes)?;
        target.write_all(&block[..n]).map_err(|_| ())?;
        hash.update(&block[..n]);
    }
    need(total == pin.stamp.bytes && hex(hash.finalize()) == pin.sha)?;
    target.sync_all().map_err(|_| ())?;
    pin.check(run)?;
    let copied = Pin::open_mode(destination, pin.cap, pin.stamp.mode & 0o7777, run)?;
    need(copied.sha == pin.sha)
}
fn copy_tree(tree: &Tree, destination: &Path, run: &Run) -> Result<()> {
    tree.check(run)?;
    make_dir(destination)?;
    for (relative, entry) in &tree.entries {
        if relative.as_os_str().is_empty() {
            continue;
        }
        if entry.directory {
            make_dir(&destination.join(relative))?;
        }
    }
    for (relative, entry) in &tree.entries {
        if entry.directory {
            continue;
        }
        let pin = Pin::open_mode(&tree.root.join(relative), FILE_CAP, 0o400, run)?;
        need(pin.stamp == entry.stamp && pin.sha == entry.sha)?;
        copy_file(&pin, &destination.join(relative), run)?;
    }
    tree.same_files(&Tree::scan(destination, run)?)?;
    tree.check(run)
}

fn readonly(path: &Path) -> Result<Connection> {
    canonical(path)?;
    no_sidecars(path)?;
    let mut uri = String::from("file:");
    for b in path.as_os_str().as_bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.~".contains(b) {
            uri.push(*b as char);
        } else {
            uri.push_str(&format!("%{b:02X}"));
        }
    }
    uri.push_str("?mode=ro&immutable=1");
    Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|_| ())
}
fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
fn names(db: &Connection, internal: bool) -> Result<Vec<String>> {
    let pattern = if internal { "GLOB" } else { "NOT GLOB" };
    let mut statement = db.prepare(&format!("SELECT name FROM sqlite_schema WHERE type='table' AND name {pattern} 'sqlite_*' ORDER BY name")).map_err(|_| ())?;
    let rows = statement.query_map([], |r| r.get(0)).map_err(|_| ())?;
    let result = rows
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|_| ())?;
    need(result.len() <= 128 && result.iter().all(|n| n.len() <= 256))?;
    Ok(result)
}
struct RowsPin {
    tables: Vec<String>,
    internal: Vec<String>,
    sha: String,
    rows: u64,
}
fn rows_pin(db: &Connection, tables: &[String], internal: &[String], run: &Run) -> Result<RowsPin> {
    let mut hash = Sha256::new();
    let mut total = 0u64;
    for name in tables.iter().chain(internal) {
        run.check()?;
        frame(&mut hash, name.as_bytes());
        let mut statement = db
            .prepare(&format!(
                "SELECT rowid,* FROM {} ORDER BY rowid",
                quoted(name)
            ))
            .map_err(|_| ())?;
        let count = statement.column_count();
        need(count <= 512)?;
        let mut rows = statement.query([]).map_err(|_| ())?;
        while let Some(row) = rows.next().map_err(|_| ())? {
            run.check()?;
            total += 1;
            need(total <= 1_000_000)?;
            hash.update([0xff]);
            for i in 0..count {
                match row.get_ref(i).map_err(|_| ())? {
                    ValueRef::Null => hash.update([0]),
                    ValueRef::Integer(n) => {
                        hash.update([1]);
                        hash.update(n.to_be_bytes());
                    }
                    ValueRef::Real(n) => {
                        hash.update([2]);
                        hash.update(n.to_bits().to_be_bytes());
                    }
                    ValueRef::Text(b) => {
                        need(b.len() <= DB_CAP as usize)?;
                        hash.update([3]);
                        frame(&mut hash, b);
                    }
                    ValueRef::Blob(b) => {
                        need(b.len() <= DB_CAP as usize)?;
                        hash.update([4]);
                        frame(&mut hash, b);
                    }
                }
            }
        }
    }
    Ok(RowsPin {
        tables: tables.into(),
        internal: internal.into(),
        sha: hex(hash.finalize()),
        rows: total,
    })
}
fn preserved(
    source: &Connection,
    target: &Connection,
    baseline: &RowsPin,
    run: &Run,
) -> Result<()> {
    need(names(target, true)? == baseline.internal)?;
    let actual = rows_pin(target, &baseline.tables, &baseline.internal, run)?;
    need(actual.sha == baseline.sha && actual.rows == baseline.rows)?;
    let mut statement = source
        .prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")
        .map_err(|_| ())?;
    let mut rows = statement.query([]).map_err(|_| ())?;
    while let Some(row) = rows.next().map_err(|_| ())? {
        run.check()?;
        let original: (String, String, String, Option<String>) = (
            row.get(0).map_err(|_| ())?,
            row.get(1).map_err(|_| ())?,
            row.get(2).map_err(|_| ())?,
            row.get(3).map_err(|_| ())?,
        );
        let candidate = target
            .query_row(
                "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type=?1 AND name=?2",
                [&original.0, &original.1],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .map_err(|_| ())?;
        need(original == candidate)?;
    }
    for table in GEODATA {
        let count: i64 = target
            .query_row(
                &format!("SELECT count(*) FROM {}", quoted(table)),
                [],
                |r| r.get(0),
            )
            .map_err(|_| ())?;
        need(count == 0)?;
    }
    Ok(())
}
struct Policy {
    pin: Pin,
    native: Arc<PinnedGeodataSourcePolicy>,
    summary: Value,
}
fn policy(path: &Path, expected: &str, run: &Run) -> Result<Policy> {
    digest(expected)?;
    private_dir(path.parent().ok_or(())?)?;
    let pin = Pin::open(path, POLICY_CAP, run)?;
    need(pin.sha == expected)?;
    let bytes = pin.bytes(run)?;
    let native = Arc::new(PinnedGeodataSourcePolicy::decode_reviewed(&bytes).map_err(|_| ())?);
    let value = v2::parse_value(&bytes).map_err(|_| ())?;
    let approvals = value["documents"].as_array().ok_or(())?.len();
    let mut scope = Sha256::new();
    frame(&mut scope, b"pr185-scope/1");
    frame(
        &mut scope,
        value["scope"]["workspaceId"].as_str().ok_or(())?.as_bytes(),
    );
    frame(
        &mut scope,
        value["scope"]["homeId"].as_str().ok_or(())?.as_bytes(),
    );
    let summary = json!({"policyByteSha256":pin.sha,"policyBytes":pin.stamp.bytes,"approvalCount":approvals,
        "sourceManifestSha256":native.source_manifest_sha256(),"scopeSha256":hex(scope.finalize())});
    Ok(Policy {
        pin,
        native,
        summary,
    })
}
fn owners(
    vault: Arc<AssetVault>,
    policy: Arc<PinnedGeodataSourcePolicy>,
) -> Result<(ReadAuthority, GeodataOwners)> {
    let access = Arc::new(Mutex::new(
        AccessBoundary::in_memory(
            AccessConfig::new(vec!["https://offline.invalid".into()]).map_err(|_| ())?,
        )
        .map_err(|_| ())?,
    ));
    Ok((
        ReadAuthority(access.clone()),
        GeodataOwners::new(access, vault, policy),
    ))
}
fn open_store(
    path: &Path,
    vault: Arc<AssetVault>,
    policy: Arc<PinnedGeodataSourcePolicy>,
    peers: &storage::RecoveryValidationPeers<
        '_,
        NativeStockContract,
        QueueFreeNativeOwners,
        QueueFreeNativeOwners,
    >,
    run: &Run,
) -> Result<Store> {
    let (authority, owners) = owners(vault.clone(), policy)?;
    Store::open_existing_geodata_full(
        path,
        NativeContracts,
        authority,
        NativeMediaRuntime {
            vault,
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
        owners,
        peers,
        &mut || run.storage_check(),
    )
    .map_err(|_| ())
}
fn media_pins(
    manifest: &FullGeodataBundle,
    vaults: &[&AssetVault],
    expected: usize,
    run: &Run,
) -> Result<String> {
    // One retained original can have several historical AssetRecord pins.
    // The exact physical file count is checked across every vault separately.
    need(
        manifest.assets.len() >= expected
            && manifest.assets.len() <= MAX_ENTRIES
            && manifest.retained_assets.len() == manifest.assets.len()
            && (expected != 0 || manifest.assets.is_empty()),
    )?;
    let mut hash = Sha256::new();
    for vault in vaults {
        let budget =
            WorkBudget::new(Duration::from_secs(10), Cancellation::default()).map_err(|_| ())?;
        for asset in &manifest.assets {
            run.check()?;
            let bytes = vault.read_retained(asset, &budget).map_err(|_| ())?;
            need(
                bytes.len() as u64 == asset.payload.byte_size
                    && sha(&bytes) == asset.payload.sha256,
            )?;
        }
    }
    for asset in &manifest.assets {
        frame(&mut hash, &serde_json::to_vec(asset).map_err(|_| ())?);
    }
    Ok(hex(hash.finalize()))
}
fn ancestry(manifest: &FullGeodataBundle, source: &Pin, baseline: &RowsPin) -> Result<()> {
    let receipt = &manifest.conversion_receipt;
    need(
        manifest.format == "houseatlas-native-full-geodata-recovery/1"
            && manifest.lineage == storage::geodata_full::LINEAGE
            && manifest.contract_version == "2.0.0"
            && manifest.outer_schema == 1
            && receipt.format == "houseatlas-native-full-conversion/1"
            && receipt.source_lineage == storage::DATABASE_LINEAGE
            && receipt.source_schema == 5
            && receipt.source_contract == "1.0.0"
            && receipt.source_database_sha256 == source.sha
            && receipt.source_database_bytes == source.stamp.bytes
            && receipt.retained_rows_sha256 == baseline.sha
            && receipt.target_lineage == storage::geodata_full::LINEAGE,
    )
}

fn arguments() -> Result<(String, BTreeMap<String, String>)> {
    let args = std::env::args_os()
        .skip(1)
        .map(|a| a.into_string().map_err(|_| ()))
        .collect::<Result<Vec<_>>>()?;
    let mode = args.first().ok_or(())?.clone();
    need(matches!(
        mode.as_str(),
        "policy-only" | "qualify" | "self-check"
    ))?;
    let mut options = BTreeMap::new();
    let mut iter = args[1..].iter();
    while let Some(flag) = iter.next() {
        let allowed = (mode != "self-check"
            && matches!(flag.as_str(), "--policy" | "--policy-sha256"))
            || (mode == "self-check" && flag == "--output-root")
            || (mode == "qualify"
                && matches!(
                    flag.as_str(),
                    "--source-db"
                        | "--source-sha256"
                        | "--source-vault"
                        | "--raw-db"
                        | "--raw-sha256"
                        | "--raw-vault"
                        | "--output-root"
                        | "--expected-media-files"
                ));
        need(allowed)?;
        let value = iter.next().filter(|v| !v.starts_with("--")).ok_or(())?;
        need(options.insert(flag.clone(), value.clone()).is_none())?;
    }
    need(
        options.len()
            == match mode.as_str() {
                "policy-only" => 2,
                "self-check" => 1,
                _ => 10,
            },
    )?;
    Ok((mode, options))
}
fn execute(run: &Run) -> Result<Value> {
    let (mode, options) = arguments()?;
    if mode == "self-check" {
        return self_check(run, Path::new(options.get("--output-root").ok_or(())?));
    }
    let arg = |key| options.get(key).map(String::as_str).ok_or(());
    run.at("policy-native-decode")?;
    let policy = policy(Path::new(arg("--policy")?), arg("--policy-sha256")?, run)?;
    if mode == "policy-only" {
        policy.pin.check(run)?;
        return Ok(
            json!({"format":"pr185-external-policy-qualification/1","status":"passed","policy":policy.summary}),
        );
    }
    qualify(run, &options, policy, false)
}

fn qualify(
    run: &Run,
    options: &BTreeMap<String, String>,
    policy: Policy,
    empty_fixture: bool,
) -> Result<Value> {
    let arg = |key| options.get(key).map(String::as_str).ok_or(());
    run.at("input-pins")?;
    let source_path = Path::new(arg("--source-db")?);
    let raw_path = Path::new(arg("--raw-db")?);
    let source_parent = source_path.parent().ok_or(())?;
    let raw_parent = raw_path.parent().ok_or(())?;
    let source_dir = private_dir(source_parent)?;
    let raw_dir = private_dir(raw_parent)?;
    let source = Pin::open(source_path, DB_CAP, run)?;
    let raw = Pin::open(raw_path, DB_CAP, run)?;
    digest(arg("--source-sha256")?)?;
    digest(arg("--raw-sha256")?)?;
    need(
        source.sha == arg("--source-sha256")?
            && raw.sha == arg("--raw-sha256")?
            && (source.stamp.dev, source.stamp.ino) != (raw.stamp.dev, raw.stamp.ino),
    )?;
    source.db(run)?;
    raw.db(run)?;
    let source_tree = Tree::scan(Path::new(arg("--source-vault")?), run)?;
    let raw_tree = Tree::scan(Path::new(arg("--raw-vault")?), run)?;
    let expected = arg("--expected-media-files")?
        .parse::<usize>()
        .map_err(|_| ())?;
    need(
        (expected > 0 || empty_fixture) && expected <= MAX_FILES && source_tree.files == expected,
    )?;
    source_tree.same_files(&raw_tree)?;
    let source_db = readonly(source_path)?;
    let raw_db = readonly(raw_path)?;
    let tables = names(&source_db, false)?;
    need(tables.len() == 29)?;
    let baseline = rows_pin(&source_db, &tables, &names(&source_db, true)?, run)?;
    run.at("raw-copy-preservation")?;
    preserved(&source_db, &raw_db, &baseline, run)?;
    let (receipt_sha, receipt_body): (String, String) = raw_db
        .query_row(
            "SELECT sha256,body FROM atlas_full_conversion WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| ())?;
    need(sha(receipt_body.as_bytes()) == receipt_sha)?;
    let receipt = v2::parse_value(receipt_body.as_bytes()).map_err(|_| ())?;
    need(
        receipt["sourceDatabaseSha256"] == source.sha
            && receipt["sourceDatabaseBytes"] == source.stamp.bytes
            && receipt["retainedRowsSha256"] == baseline.sha
            && receipt["targetLineage"] == storage::geodata_full::LINEAGE,
    )?;
    drop(raw_db);
    source.db(run)?;
    raw.db(run)?;
    run.at("new-private-root")?;
    let root = Path::new(arg("--output-root")?);
    absolute(root)?;
    let parent = root.parent().ok_or(())?;
    private_dir(parent)?;
    for input in [
        source_parent,
        raw_parent,
        source_tree.root.as_path(),
        raw_tree.root.as_path(),
        policy.pin.path.parent().ok_or(())?,
    ] {
        need(!root.starts_with(input) && !input.starts_with(root))?;
    }
    match fs::symlink_metadata(root) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err(()),
    }
    make_dir(root)?;
    let work = root.join("work");
    make_dir(&work)?;
    copy_file(&raw, &work.join("atlas.sqlite"), run)?;
    copy_tree(&raw_tree, &work.join("media"), run)?;
    let work_vault = Arc::new(AssetVault::open_existing(&work.join("media")).map_err(|_| ())?);
    let source_vault = AssetVault::open_existing(&source_tree.root).map_err(|_| ())?;
    let raw_vault = AssetVault::open_existing(&raw_tree.root).map_err(|_| ())?;
    let queues = QueueFreeNativeOwners::for_queue_free_profile().map_err(|_| ())?;
    let stock = NativeStockContract::new().map_err(|_| ())?;
    let peers = storage::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &queues,
        evidence: &queues,
    };
    run.at("full-working-open-validation")?;
    let store = open_store(
        &work.join("atlas.sqlite"),
        work_vault.clone(),
        policy.native.clone(),
        &peers,
        run,
    )?;
    store
        .validate_full_geodata(&peers, &mut || run.storage_check())
        .map_err(|_| ())?;
    run.at("new-full-profile-capture")?;
    let bundle = root.join("bundle");
    let manifest = store
        .capture_full_geodata_recovery(&bundle, &peers, &mut || run.storage_check())
        .map_err(|_| ())?;
    ancestry(&manifest, &source, &baseline)?;
    need(
        manifest.conversion_receipt_sha256 == receipt_sha
            && serde_json::to_value(&manifest.conversion_receipt).map_err(|_| ())? == receipt,
    )?;
    store.close().map_err(|_| ())?;
    let work_db = readonly(&work.join("atlas.sqlite"))?;
    preserved(&source_db, &work_db, &baseline, run)?;
    drop(work_db);
    let bundle_db = readonly(&bundle.join("atlas.sqlite"))?;
    preserved(&source_db, &bundle_db, &baseline, run)?;
    drop(bundle_db);
    run.at("new-full-profile-verification")?;
    let (_, verify_owners) = owners(work_vault.clone(), policy.native.clone())?;
    let verified = Store::verify_full_geodata_recovery(
        &bundle,
        &NativeContracts,
        &peers,
        &verify_owners,
        &mut || run.storage_check(),
    )
    .map_err(|_| ())?;
    need(
        serde_json::to_value(&verified).map_err(|_| ())?
            == serde_json::to_value(&manifest).map_err(|_| ())?,
    )?;
    run.at("new-full-profile-restoration")?;
    let restored = root.join("restored");
    let restored_manifest = Store::restore_full_geodata_recovery(
        &bundle,
        &restored,
        &NativeContracts,
        &peers,
        &verify_owners,
        &mut || run.storage_check(),
    )
    .map_err(|_| ())?;
    need(
        serde_json::to_value(&restored_manifest).map_err(|_| ())?
            == serde_json::to_value(&manifest).map_err(|_| ())?,
    )?;
    let restored_db = readonly(&restored.join("atlas.sqlite"))?;
    preserved(&source_db, &restored_db, &baseline, run)?;
    drop(restored_db);
    let bundle_pin = Pin::open(&bundle.join("atlas.sqlite"), DB_CAP, run)?;
    let restored_pin = Pin::open(&restored.join("atlas.sqlite"), DB_CAP, run)?;
    need(
        bundle_pin.sha == manifest.database_sha256
            && restored_pin.sha == bundle_pin.sha
            && restored_pin.stamp.bytes == bundle_pin.stamp.bytes,
    )?;
    run.at("retained-media-all-revisions")?;
    let bundle_vault = AssetVault::open_existing(&bundle.join("media")).map_err(|_| ())?;
    let restored_vault = AssetVault::open_existing(&restored.join("media")).map_err(|_| ())?;
    let media_sha = media_pins(
        &manifest,
        &[
            &source_vault,
            &raw_vault,
            &work_vault,
            &bundle_vault,
            &restored_vault,
        ],
        expected,
        run,
    )?;
    for vault in [
        &work.join("media"),
        &bundle.join("media"),
        &restored.join("media"),
    ] {
        source_tree.same_files(&Tree::scan(vault, run)?)?;
    }
    run.at("restored-copy-reopen")?;
    let reopened = root.join("reopened");
    make_dir(&reopened)?;
    copy_file(&restored_pin, &reopened.join("atlas.sqlite"), run)?;
    copy_tree(
        &Tree::scan(&restored.join("media"), run)?,
        &reopened.join("media"),
        run,
    )?;
    let reopened_vault =
        Arc::new(AssetVault::open_existing(&reopened.join("media")).map_err(|_| ())?);
    let reopened_store = open_store(
        &reopened.join("atlas.sqlite"),
        reopened_vault.clone(),
        policy.native.clone(),
        &peers,
        run,
    )?;
    reopened_store
        .validate_full_geodata(&peers, &mut || run.storage_check())
        .map_err(|_| ())?;
    reopened_store.close().map_err(|_| ())?;
    let reopened_db = readonly(&reopened.join("atlas.sqlite"))?;
    preserved(&source_db, &reopened_db, &baseline, run)?;
    drop(reopened_db);
    media_pins(&manifest, &[&reopened_vault], expected, run)?;
    source_tree.same_files(&Tree::scan(&reopened.join("media"), run)?)?;
    run.at("unchanged-input-recheck")?;
    drop(source_db);
    source.db(run)?;
    raw.db(run)?;
    policy.pin.check(run)?;
    source_tree.check(run)?;
    raw_tree.check(run)?;
    need(private_dir(source_parent)? == source_dir && private_dir(raw_parent)? == raw_dir)?;
    bundle_pin.check(run)?;
    restored_pin.check(run)?;
    run.at("complete")?;
    Ok(
        json!({"format":"pr185-external-full-qualification/1","status":"passed","stages":["policy-native-decode","input-pins","raw-copy-preservation","full-working-open-validation","new-full-profile-capture","new-full-profile-verification","new-full-profile-restoration","retained-media-all-revisions","restored-copy-reopen","unchanged-input-recheck"],
        "policy":policy.summary,"sourceDatabaseSha256":source.sha,"sourceDatabaseBytes":source.stamp.bytes,"rawDatabaseSha256":raw.sha,"rawDatabaseBytes":raw.stamp.bytes,
        "sourceTableCount":baseline.tables.len(),"internalTableCount":baseline.internal.len(),"typedRowCount":baseline.rows,"retainedRowsSha256":baseline.sha,
        "emptyGeodataTableCount":GEODATA.len(),"mediaFileCount":expected,"mediaBytes":source_tree.bytes,"mediaInventorySha256":source_tree.sha,
        "assetPinCount":manifest.assets.len(),"assetPinsSha256":media_sha,"bundleDatabaseSha256":bundle_pin.sha,"restoredDatabaseSha256":restored_pin.sha,"conversionReceiptSha256":receipt_sha}),
    )
}
/// This deliberately empty generated fixture proves API wiring only. It cannot
/// establish qualification of household data, populated Stock or retained media.
fn self_check(run: &Run, root: &Path) -> Result<Value> {
    run.at("generated-empty-fixture")?;
    absolute(root)?;
    private_dir(root.parent().ok_or(())?)?;
    make_dir(root)?;
    let source_root = root.join("fixture-source");
    make_dir(&source_root)?;
    let policy_root = root.join("fixture-policy");
    make_dir(&policy_root)?;
    let source_path = source_root.join("atlas.sqlite");
    let source_media = source_root.join("media");
    let vault = Arc::new(AssetVault::open(&source_media).map_err(|_| ())?);
    let access = Arc::new(Mutex::new(
        AccessBoundary::in_memory(
            AccessConfig::new(vec!["https://offline.invalid".into()]).map_err(|_| ())?,
        )
        .map_err(|_| ())?,
    ));
    let source = Store::open(
        &source_path,
        NativeContracts,
        ReadAuthority(access.clone()),
        NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
    )
    .map_err(|_| ())?;
    source.close().map_err(|_| ())?;
    // These bytes were created above by this operation; no input is normalized.
    let generated = Connection::open_with_flags(
        &source_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|_| ())?;
    generated
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(|_| ())?;
    generated.close().map_err(|(_, _)| ())?;
    let generated_policy = json!({"profile":"houseatlas.reviewed-document-source-policy.v1",
        "scope":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},
        "sourceManifestSha256":sha(b"generated empty external qualifier fixture only"),
        "documents":[{"documentId":"00000000-0000-4000-8000-000000000003",
            "original":{"assetId":"00000000-0000-4000-8000-000000000004","revision":1,"sha256":sha(b"{}\n"),"bytes":3},
            "contentType":"application/json","provenance":{"agency":"Generated empty qualifier fixture","url":"https://source.invalid/generated.json",
                "license":{"status":"permitted","reference":"Generated fixture permission"},"retrievedAt":"2026-10-15T00:00:00Z",
                "published":null,"observed":null,"frame":{"crs":null,"axes":[],"linearUnit":null,"extent":null}}}]});
    let policy_bytes = serde_json::to_vec(&generated_policy).map_err(|_| ())?;
    let policy_path = policy_root.join("generated-policy.json");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(&policy_path)
        .map_err(|_| ())?;
    file.write_all(&policy_bytes).map_err(|_| ())?;
    file.sync_all().map_err(|_| ())?;
    drop(file);
    let policy_sha = sha(&policy_bytes);
    let selected_policy = policy(&policy_path, &policy_sha, run)?;
    let source_pin = Pin::open(&source_path, DB_CAP, run)?;
    source_pin.db(run)?;
    let queues = QueueFreeNativeOwners::for_queue_free_profile().map_err(|_| ())?;
    let stock = NativeStockContract::new().map_err(|_| ())?;
    let peers = storage::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &queues,
        evidence: &queues,
    };
    let fixture_owners = GeodataOwners::new(access, vault, selected_policy.native.clone());
    let raw = root.join("fixture-raw");
    run.at("generated-empty-copy")?;
    storage::geodata_full::copy_v5_to_full(
        &source_path,
        &raw,
        &source_pin.sha,
        &NativeContracts,
        &peers,
        &fixture_owners,
        &mut || run.storage_check(),
    )
    .map_err(|_| ())?;
    let raw_path = raw.join("atlas.sqlite");
    let raw_pin = Pin::open(&raw_path, DB_CAP, run)?;
    let mut options = BTreeMap::new();
    for (flag, path) in [
        ("--source-db", source_path),
        ("--source-vault", source_media),
        ("--raw-db", raw_path),
        ("--raw-vault", raw.join("media")),
        ("--policy", policy_path),
        ("--output-root", root.join("qualified")),
    ] {
        options.insert(flag.into(), path.to_str().ok_or(())?.into());
    }
    options.insert("--source-sha256".into(), source_pin.sha);
    options.insert("--raw-sha256".into(), raw_pin.sha);
    options.insert("--policy-sha256".into(), policy_sha);
    options.insert("--expected-media-files".into(), "0".into());
    let qualification = qualify(run, &options, selected_policy, true)?;
    Ok(
        json!({"format":"pr185-external-empty-self-check/1","status":"passed",
        "fixture":"generated-empty-native-only","qualification":qualification}),
    )
}

fn main() {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    std::panic::set_hook(Box::new(|_| {
        eprintln!("External qualifier internal failure")
    }));
    let run = Run {
        start: Instant::now(),
        stage: Cell::new("arguments"),
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| execute(&run)));
    match result {
        Ok(Ok(value)) => println!("{}", value),
        _ => {
            println!(
                "{}",
                json!({"format":"pr185-external-qualification-failure/1","status":"failed","stage":run.stage.get(),"automaticCleanup":false,"automaticRetry":false})
            );
            std::process::exit(1);
        }
    }
}
