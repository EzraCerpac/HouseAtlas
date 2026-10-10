//! Strict existing-state account composition for the persistent native Host.
use crate::{
    ai::{
        AiError,
        host::{enrollment::EnrollmentOwner, startup::StartupOwners, status::StatusJournal},
    },
    app::ai_native_startup::NativeAccountAiApplication,
    config::ai_account::{DatabaseSelection, ServerAccountSelection},
    http::Host,
};
use rusqlite::{Connection, OpenFlags};
use std::{
    fs::{self, File},
    os::unix::fs::{FileExt, MetadataExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

/// Retained physical custody, checked around every native account response.
/// It selects existing rollback-journal databases only; no SQLite shared-memory
/// creation, WAL adoption, schema initialization or migration is permitted.
pub(crate) struct NativeAccountCustody {
    enrollment: DatabaseCustody,
    journal: DatabaseCustody,
}
impl NativeAccountCustody {
    pub(crate) fn revalidate(&self) -> Result<(), AiError> {
        self.enrollment.check()?;
        self.journal.check()
    }
}

/// Real existing owners, reopened before listener creation. The final Host may
/// attach its actual Unix gateway socket before mounting; assembly checks the
/// same original Access allocation and same native journal owner again.
pub struct SelectedAccountState {
    configuration: Arc<crate::ai::host::startup::configuration::StartupConfiguration>,
    enrollment: Arc<EnrollmentOwner>,
    journal: StatusJournal,
    custody: Arc<NativeAccountCustody>,
}
impl SelectedAccountState {
    pub fn mount(self, host: Host) -> Result<NativeAccountAiApplication, AiError> {
        self.custody.revalidate()?;
        NativeAccountAiApplication::assemble_with_custody(
            StartupOwners {
                host,
                configuration: self.configuration,
                enrollment: self.enrollment,
                journal: self.journal,
            },
            Some(self.custody),
        )
    }
}

/// The caller retains the original persistent ServerLease for this data root.
/// These explicitly selected DBs must already exist inside that same root.
pub fn prepare(
    host: &Host,
    selection: ServerAccountSelection,
    data_root: &Path,
) -> Result<SelectedAccountState, AiError> {
    let (configuration, enrollment, journal) = selection.into_parts()?;
    if host.origin != configuration.application_origin() {
        return Err(AiError::ConnectionUnavailable);
    }
    let (journal_db, journal_custody) = DatabaseCustody::open(journal, data_root)?;
    let (enrollment_db, enrollment_custody) = DatabaseCustody::open(enrollment, data_root)?;
    let custody = Arc::new(NativeAccountCustody {
        enrollment: enrollment_custody,
        journal: journal_custody,
    });
    let access = Arc::clone(
        &host
            .core
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?
            .access,
    );
    // Genuine owner SELECT-only reopen seams; no constructor fallback.
    let journal = StatusJournal::open_existing_read_only(journal_db)?;
    let enrollment = Arc::new(EnrollmentOwner::open_existing_read_only(
        enrollment_db,
        access,
        journal.clone(),
    )?);
    custody.revalidate()?;
    Ok(SelectedAccountState {
        configuration: Arc::new(configuration),
        enrollment,
        journal,
        custody,
    })
}

struct DatabaseCustody {
    selected: DatabaseSelection,
    file: File,
    directory_path: PathBuf,
    directory: File,
}
impl DatabaseCustody {
    fn open(selected: DatabaseSelection, data_root: &Path) -> Result<(Connection, Self), AiError> {
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
                rustix::fs::OFlags::RDONLY
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
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(unavailable)?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(unavailable)?;
        let mode: String = db
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .map_err(unavailable)?;
        if mode != "delete" || !db.is_readonly("main").map_err(unavailable)? {
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
