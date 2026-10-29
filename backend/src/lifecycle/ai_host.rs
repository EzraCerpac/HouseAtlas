//! Explicit writable full-host custody; separate from SELECT-only account reads.
use crate::{
    ai::{
        AiError,
        host::{
            continuation::ExactReviewReady,
            enrollment::EnrollmentOwner,
            lifecycle::ConnectionFacts,
            native::NativeHostContext,
            startup::{
                StartupInputs, StartupOwners, authority::StartupAuthority,
                configuration::StartupConfiguration,
            },
            status::StatusJournal,
            trusted_startup::StartupCustody,
        },
        runtime::HumanReviewPort,
        stock::{AcceptedStockCommand, SharedStockPort, StockCatalog},
    },
    app::{Access, ai_native_startup::NativeAiApplication},
    http::Host,
    lifecycle::persistent::ServerLease,
};
use rusqlite::{Connection, OpenFlags};
use std::{
    fs::{self, File},
    os::unix::fs::{FileExt, MetadataExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

/// Trusted caller selection, not request JSON, discovery, a grant or enrollment.
/// Identity must come from the original storage owner, independently of opening.
pub struct ExistingFullHostDatabase {
    path: PathBuf,
    device: u64,
    inode: u64,
}
impl ExistingFullHostDatabase {
    pub fn select(path: PathBuf, device: u64, inode: u64) -> Result<Self, AiError> {
        if !path.is_absolute()
            || inode == 0
            || path.components().any(|part| {
                matches!(
                    part,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
        {
            return Err(AiError::InvalidInput);
        }
        Ok(Self {
            path,
            device,
            inode,
        })
    }
}

pub struct FullHostStoreSelection {
    enrollment: ExistingFullHostDatabase,
    journal: ExistingFullHostDatabase,
}
impl FullHostStoreSelection {
    pub fn select(
        enrollment: ExistingFullHostDatabase,
        journal: ExistingFullHostDatabase,
    ) -> Result<Self, AiError> {
        if enrollment.path == journal.path
            || (enrollment.device, enrollment.inode) == (journal.device, journal.inode)
        {
            return Err(AiError::InvalidInput);
        }
        Ok(Self {
            enrollment,
            journal,
        })
    }
}

/// Retains the actual server lease, original Access/enrollment/journal owners,
/// and private file/directory handles. Loss retires this allocation permanently.
/// It never supplies credential-key custody or inference admission.
pub struct NativeFullHostCustody {
    lease: Arc<ServerLease>,
    access: Access,
    enrollment: Arc<EnrollmentOwner>,
    journal: StatusJournal,
    enrollment_file: DatabaseCustody,
    journal_file: DatabaseCustody,
    failed: Mutex<bool>,
}
impl StartupCustody for NativeFullHostCustody {
    fn revalidate(&self) -> Result<(), AiError> {
        let mut failed = self
            .failed
            .lock()
            .map_err(|_| AiError::ConnectionUnavailable)?;
        if *failed {
            return Err(AiError::ConnectionUnavailable);
        }
        let result = self.enrollment.with_store_fence(|| {
            self.lease.ai_root(&self.access).map_err(unavailable)?;
            if !self.enrollment.owns(&self.access, &self.journal) {
                return Err(AiError::ConnectionUnavailable);
            }
            self.enrollment_file.check()?;
            self.journal_file.check()
        });
        if result.is_err() {
            *failed = true;
        }
        result
    }
}

/// Prepared owner allocations only. No route, callback worker or listener is
/// started until the caller separately adopts the existing application API.
pub struct SelectedFullHostState {
    owners: StartupOwners,
    custody: Arc<NativeFullHostCustody>,
}
impl SelectedFullHostState {
    pub fn assemble<O, R, D>(
        self,
        inputs: StartupInputs<R, O>,
        stock: impl FnOnce(&Host, StartupAuthority) -> Result<StockCatalog<D>, AiError>,
    ) -> Result<NativeAiApplication<O, R, D>, AiError>
    where
        O: ConnectionFacts<NativeHostContext> + 'static,
        D: SharedStockPort<NativeHostContext> + Send + Sync + 'static,
        D::Prepared: Send + Sync + 'static,
        R: ExactReviewReady<NativeHostContext, AcceptedStockCommand<D::Prepared>>
            + HumanReviewPort<NativeHostContext>
            + Send
            + Sync
            + 'static,
    {
        self.custody.revalidate()?;
        NativeAiApplication::assemble(self.owners, inputs, stock, self.custody)
    }
}

/// Explicit full-host preparation over already installed, current stores.
/// No CREATE flag, DDL, migration, journal-mode change or state adoption.
/// The lease must be the original persistent reopen owner of this Host's Access.
pub fn prepare(
    host: Host,
    configuration: Arc<StartupConfiguration>,
    selection: FullHostStoreSelection,
    lease: Arc<ServerLease>,
) -> Result<SelectedFullHostState, AiError> {
    if host.origin != configuration.application_origin() {
        return Err(AiError::ConnectionUnavailable);
    }
    let access = Arc::clone(
        &host
            .core
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?
            .access,
    );
    let root = lease.ai_root(&access).map_err(unavailable)?;
    let (journal_db, journal_file) = DatabaseCustody::open(selection.journal, root)?;
    let (enrollment_db, enrollment_file) = DatabaseCustody::open(selection.enrollment, root)?;
    let journal = StatusJournal::open_existing_writable(journal_db)?;
    let enrollment = Arc::new(EnrollmentOwner::open_existing_writable(
        enrollment_db,
        Arc::clone(&access),
        journal.clone(),
    )?);
    let custody = Arc::new(NativeFullHostCustody {
        lease,
        access,
        enrollment: Arc::clone(&enrollment),
        journal: journal.clone(),
        enrollment_file,
        journal_file,
        failed: Mutex::new(false),
    });
    custody.revalidate()?;
    Ok(SelectedFullHostState {
        owners: StartupOwners {
            host,
            configuration,
            enrollment,
            journal,
        },
        custody,
    })
}

struct DatabaseCustody {
    selected: ExistingFullHostDatabase,
    file: File,
    directory_path: PathBuf,
    directory: File,
}
impl DatabaseCustody {
    fn open(
        selected: ExistingFullHostDatabase,
        data_root: &Path,
    ) -> Result<(Connection, Self), AiError> {
        let directory_path = selected
            .path
            .parent()
            .filter(|parent| parent.starts_with(data_root))
            .ok_or(AiError::ConnectionUnavailable)?
            .to_path_buf();
        if fs::canonicalize(data_root).map_err(unavailable)? != data_root
            || fs::canonicalize(&directory_path).map_err(unavailable)? != directory_path
            || fs::canonicalize(&selected.path).map_err(unavailable)? != selected.path
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let directory = File::from(
            rustix::fs::open(
                &directory_path,
                rustix::fs::OFlags::RDONLY
                    | rustix::fs::OFlags::DIRECTORY
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::empty(),
            )
            .map_err(unavailable)?,
        );
        let file = File::from(
            rustix::fs::open(
                &selected.path,
                rustix::fs::OFlags::RDWR
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::NONBLOCK
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::empty(),
            )
            .map_err(unavailable)?,
        );
        let custody = Self {
            selected,
            file,
            directory_path,
            directory,
        };
        custody.check()?;
        let db = Connection::open_with_flags(
            &custody.selected.path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(unavailable)?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(unavailable)?;
        let mode: String = db
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .map_err(unavailable)?;
        if mode != "delete" || db.is_readonly("main").map_err(unavailable)? {
            return Err(AiError::ConnectionUnavailable);
        }
        custody.check()?;
        Ok((db, custody))
    }

    fn check(&self) -> Result<(), AiError> {
        let directory = self.directory.metadata().map_err(unavailable)?;
        let named_directory = fs::symlink_metadata(&self.directory_path).map_err(unavailable)?;
        let actual = self.file.metadata().map_err(unavailable)?;
        let named = fs::symlink_metadata(&self.selected.path).map_err(unavailable)?;
        let uid = rustix::process::geteuid().as_raw();
        if !directory.is_dir()
            || directory.uid() != uid
            || directory.mode() & 0o777 != 0o700
            || named_directory.file_type().is_symlink()
            || directory.dev() != named_directory.dev()
            || directory.ino() != named_directory.ino()
            || fs::canonicalize(&self.directory_path).map_err(unavailable)? != self.directory_path
            || !actual.is_file()
            || actual.uid() != uid
            || actual.nlink() != 1
            || actual.mode() & 0o777 != 0o600
            || actual.len() < 100
            || actual.dev() != self.selected.device
            || actual.ino() != self.selected.inode
            || named.file_type().is_symlink()
            || named.dev() != actual.dev()
            || named.ino() != actual.ino()
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let mut header = [0_u8; 20];
        self.file
            .read_exact_at(&mut header, 0)
            .map_err(unavailable)?;
        if &header[..16] != b"SQLite format 3\0" || header[18..20] != [1, 1] {
            return Err(AiError::ConnectionUnavailable);
        }
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut sidecar = self.selected.path.as_os_str().to_os_string();
            sidecar.push(suffix);
            match fs::symlink_metadata(PathBuf::from(sidecar)) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(AiError::ConnectionUnavailable),
            }
        }
        Ok(())
    }
}

fn unavailable<E>(_: E) -> AiError {
    AiError::ConnectionUnavailable
}

#[cfg(test)]
mod existing_store_tests {
    use super::*;
    use crate::ai::{oauth::RegistrationBinding, runtime::RequestStatus};
    use std::os::unix::fs::PermissionsExt;

    fn selected(path: &Path) -> ExistingFullHostDatabase {
        let metadata = fs::metadata(path).unwrap();
        ExistingFullHostDatabase::select(path.to_path_buf(), metadata.dev(), metadata.ino()).unwrap()
    }
    fn root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        root
    }

    #[test]
    fn strict_writable_journal_keeps_uncertain_work_and_original_bytes() {
        let temporary = root();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let path = root.join("synthetic-journal.sqlite");
        let journal = StatusJournal::new(Connection::open(&path).unwrap()).unwrap();
        let binding = RegistrationBinding {
            registration_id: "synthetic-registration".into(),
            actor_id: "synthetic-actor".into(),
            workspace_id: "synthetic-workspace".into(),
            home_id: "synthetic-home".into(),
            authority_epoch: "synthetic-authority".into(),
            cancellation_epoch: "synthetic-cancel".into(),
        };
        drop(journal.begin(&binding, "synthetic-pending", None).unwrap());
        drop(journal);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let before = fs::read(&path).unwrap();
        let (connection, custody) = DatabaseCustody::open(selected(&path), &root).unwrap();
        assert!(!connection.is_readonly("main").unwrap());
        let reopened = StatusJournal::open_existing_writable(connection).unwrap();
        reopened.with_connection_fence(|| custody.check()).unwrap();
        assert!(matches!(
            reopened.read(&binding, "synthetic-pending", true).unwrap(),
            RequestStatus::Unconfirmed { .. }
        ));
        assert_eq!(fs::read(&path).unwrap(), before);
        // The same file's SELECT-only connection cannot be promoted.
        let read_only =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert!(StatusJournal::open_existing_writable(read_only).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn strict_writable_enrollment_retains_access_and_journal_allocations() {
        let temporary = root();
        let root = fs::canonicalize(temporary.path()).unwrap();
        // Empty synthetic Access only; no account, session or grant is created.
        let access = Arc::new(std::sync::Mutex::new(
            crate::access::AccessBoundary::open(
                &root.join("synthetic-access.sqlite"),
                crate::access::AccessConfig::new(vec!["https://synthetic.example.invalid".into()])
                    .unwrap(),
            )
            .unwrap(),
        ));
        let path = root.join("synthetic-enrollment.sqlite");
        let journal = StatusJournal::new(Connection::open_in_memory().unwrap()).unwrap();
        drop(
            EnrollmentOwner::new(
                Connection::open(&path).unwrap(),
                Arc::clone(&access),
                journal.clone(),
            )
            .unwrap(),
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let before = fs::read(&path).unwrap();
        let (connection, custody) = DatabaseCustody::open(selected(&path), &root).unwrap();
        let enrollment = EnrollmentOwner::open_existing_writable(
            connection,
            Arc::clone(&access),
            journal.clone(),
        )
        .unwrap();
        assert!(enrollment.owns(&access, &journal));
        enrollment.with_store_fence(|| custody.check()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}
