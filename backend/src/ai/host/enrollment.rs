//! Trusted local enrollment state over the original AT11 principal.
//! No browser enrollment, provider approval, key provisioning or inference grant.
use super::{native::RegistrationAuthority, status::StatusJournal};
use crate::{
    access,
    ai::{
        AiError,
        oauth::{
            LifecycleState, RefreshCheckpoint, RegistrationBinding, RegistrationKind,
            RegistrationRecord, RevocationState,
        },
    },
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::json;
use std::sync::{Arc, Mutex};

/// Exact configuration from an already approved enrollment owner. Constructing
/// this value supplies no authority. Installation also needs a current genuine
/// editor/CSRF mutation principal and an explicit trusted application call.
pub struct TrustedRegistration {
    binding: RegistrationBinding,
    kind: RegistrationKind,
    app_name: String,
    stable_host_id: String,
}
impl TrustedRegistration {
    pub fn from_existing_approval(
        binding: RegistrationBinding,
        kind: RegistrationKind,
        app_name: String,
        stable_host_id: String,
    ) -> Result<Self, AiError> {
        for value in [
            &binding.registration_id,
            &binding.actor_id,
            &binding.workspace_id,
            &binding.home_id,
            &binding.authority_epoch,
            &binding.cancellation_epoch,
            &app_name,
            &stable_host_id,
        ] {
            if value.trim().is_empty() || value.len() > 4096 {
                return Err(AiError::InvalidInput);
            }
        }
        Ok(Self {
            binding,
            kind,
            app_name,
            stable_host_id,
        })
    }
    pub fn binding(&self) -> &RegistrationBinding {
        &self.binding
    }
    fn configuration(&self) -> String {
        let kind = match &self.kind {
            RegistrationKind::LocalPublicClient => json!(["localPublicClient"]),
            RegistrationKind::IssuedWebsite {
                registered_callback,
                callback_host,
                authentication,
            } => json!([
                "issuedWebsite",
                registered_callback,
                callback_host,
                match authentication {
                    crate::ai::oauth::ClientAuthentication::Public => "public",
                    crate::ai::oauth::ClientAuthentication::IssuedSecretBasic =>
                        "issuedSecretBasic",
                }
            ]),
        };
        json!([kind, self.app_name, self.stable_host_id]).to_string()
    }
    pub(crate) fn empty_record(&self) -> RegistrationRecord {
        RegistrationRecord {
            binding: self.binding.clone(),
            kind: self.kind.clone(),
            app_name: self.app_name.clone(),
            stable_host_id: self.stable_host_id.clone(),
            issued_client_id: None,
            identity: None,
            credentials: None,
            pending_authorization: None,
            refresh_checkpoint: RefreshCheckpoint::None,
            state: LifecycleState::Disconnected,
            revocation: RevocationState::NotRequested,
        }
    }
}

/// Dedicated securely opened private SQLite connection supplied by the app.
/// Empty state never enrolls a caller. Use this same instance for HTTP capture,
/// native authority and the credential adapter; no registry-label fallback.
pub struct EnrollmentOwner {
    access: Arc<Mutex<access::AccessBoundary>>,
    db: Mutex<Connection>,
    journal: StatusJournal,
    identity: Arc<()>,
}
impl EnrollmentOwner {
    /// Read-only verification against the existing installed configuration.
    /// This neither installs approval nor reconstructs authority from labels.
    pub fn verify_existing_configuration(
        &self,
        original: &access::Principal,
        registration: &TrustedRegistration,
    ) -> Result<(), AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access.revalidate(original).map_err(access_error)?;
        matches_scope(original, registration.binding())?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row = read_row(&db, original)?;
        if row.binding != *registration.binding()
            || row.configuration != registration.configuration()
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(())
    }
}
/// Nonserializable original proof. Cloning the native principal preserves its
/// opaque session/membership/action provenance; no safe DTO is used as a grant.
pub struct OriginalEnrollment {
    principal: access::Principal,
    binding: RegistrationBinding,
    approval: String,
    configuration: String,
    generation: i64,
    owner: Arc<()>,
}
/// Created only after local stop and committed cancellation rotation. It can
/// authorize terminal bookkeeping, never fresh inference or a record rebase.
pub struct StoppedEnrollment {
    binding: RegistrationBinding,
    approval: String,
    generation: i64,
    owner: Arc<()>,
}
struct Row {
    binding: RegistrationBinding,
    approval: String,
    generation: i64,
    configuration: String,
}
impl EnrollmentOwner {
    /// Check the owners supplied to trusted startup without reading either DB.
    pub(crate) fn owns(
        &self,
        access: &Arc<Mutex<access::AccessBoundary>>,
        journal: &StatusJournal,
    ) -> bool {
        Arc::ptr_eq(&self.access, access) && self.journal.same_owner(journal)
    }
    pub fn new(
        connection: Connection,
        access: Arc<Mutex<access::AccessBoundary>>,
        journal: StatusJournal,
    ) -> Result<Self, AiError> {
        connection
            .execute_batch(
                "PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS ai_host_enrollment (
              actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
              registration_id TEXT NOT NULL, authority_epoch TEXT NOT NULL,
              cancellation_epoch TEXT NOT NULL, approval TEXT NOT NULL,
              cancellation_generation INTEGER NOT NULL CHECK(cancellation_generation>=0),
              configuration TEXT NOT NULL,
              PRIMARY KEY(actor_id,workspace_id,home_id));",
            )
            .map_err(db_error)?;
        Ok(Self {
            access,
            db: Mutex::new(connection),
            journal,
            identity: Arc::new(()),
        })
    }
    /// The original application/storage owners supply this existing read-only
    /// database, Access allocation and same read-only journal. Validation uses
    /// SELECTs only and never creates a table, installs approval or adopts rows
    /// as an OriginalEnrollment proof. Root retains secure file/path fencing.
    /// Empty approved state remains empty: capture/verification still fail closed.
    pub fn open_existing_read_only(
        connection: Connection,
        access: Arc<Mutex<access::AccessBoundary>>,
        journal: StatusJournal,
    ) -> Result<Self, AiError> {
        super::status::validate_existing_read_only_schema(
            &connection,
            &[
                (
                    "index",
                    "sqlite_autoindex_ai_host_enrollment_1",
                    "ai_host_enrollment",
                    None,
                ),
                (
                    "table",
                    "ai_host_enrollment",
                    "ai_host_enrollment",
                    Some(
                        "CREATE TABLE ai_host_enrollment (
                       actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
                       registration_id TEXT NOT NULL, authority_epoch TEXT NOT NULL,
                       cancellation_epoch TEXT NOT NULL, approval TEXT NOT NULL,
                       cancellation_generation INTEGER NOT NULL CHECK(cancellation_generation>=0),
                       configuration TEXT NOT NULL,
                       PRIMARY KEY(actor_id,workspace_id,home_id))",
                    ),
                ),
            ],
        )?;
        journal.require_read_only()?;
        {
            let mut statement = connection
                .prepare(
                    "SELECT actor_id,workspace_id,home_id,registration_id,authority_epoch,
                 cancellation_epoch,approval,cancellation_generation,configuration
                 FROM main.ai_host_enrollment",
                )
                .map_err(db_error)?;
            let mut rows = statement.query([]).map_err(db_error)?;
            while let Some(row) = rows.next().map_err(db_error)? {
                for index in 0..7 {
                    let value: String = row.get(index).map_err(db_error)?;
                    if value.trim().is_empty() || value.len() > 4096 {
                        return Err(AiError::DomainUnavailable);
                    }
                    if index < 3 {
                        access::CanonicalId::parse(&value)
                            .map_err(|_| AiError::DomainUnavailable)?;
                    }
                }
                let generation: i64 = row.get(7).map_err(db_error)?;
                let configuration: String = row.get(8).map_err(db_error)?;
                // The original configuration matcher remains authoritative on
                // each read. Constructor validation establishes only JSON format.
                let value: serde_json::Value =
                    serde_json::from_str(&configuration).map_err(|_| AiError::DomainUnavailable)?;
                let known_configuration = match value.as_array().map(Vec::as_slice) {
                    Some(
                        [
                            kind,
                            serde_json::Value::String(app),
                            serde_json::Value::String(host),
                        ],
                    ) if !app.trim().is_empty()
                        && app.len() <= 4096
                        && !host.trim().is_empty()
                        && host.len() <= 4096 =>
                    {
                        match kind.as_array().map(Vec::as_slice) {
                            Some([serde_json::Value::String(kind)]) => kind == "localPublicClient",
                            Some(
                                [
                                    serde_json::Value::String(kind),
                                    serde_json::Value::String(_),
                                    serde_json::Value::String(_),
                                    serde_json::Value::String(authentication),
                                ],
                            ) => {
                                kind == "issuedWebsite"
                                    && matches!(
                                        authentication.as_str(),
                                        "public" | "issuedSecretBasic"
                                    )
                            }
                            _ => false,
                        }
                    }
                    _ => false,
                };
                if generation < 0
                    || !known_configuration
                    || serde_json::to_string(&value).map_err(|_| AiError::DomainUnavailable)?
                        != configuration
                {
                    return Err(AiError::DomainUnavailable);
                }
            }
        }
        Ok(Self {
            access,
            db: Mutex::new(connection),
            journal,
            identity: Arc::new(()),
        })
    }
    /// Trusted startup/administrative entry point only, absent from app HTTP.
    /// Accept existing approved identifiers; never issue an account, source
    /// lifecycle grant or inference admission. Existing rows are preserved.
    /// Registration and encrypted file commits are NOT a cross-store transaction.
    pub fn install_existing_approval(
        &self,
        original: &access::Principal,
        registration: &TrustedRegistration,
    ) -> Result<(), AiError> {
        matches_scope(original, registration.binding())?;
        self.access_fence(original, || {
            let mut db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(db_error)?;
            let b = registration.binding();
            tx.execute(
                "INSERT INTO ai_host_enrollment VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8)",
                params![
                    b.actor_id,
                    b.workspace_id,
                    b.home_id,
                    b.registration_id,
                    b.authority_epoch,
                    b.cancellation_epoch,
                    random_id()?,
                    registration.configuration()
                ],
            )
            .map_err(db_error)?;
            tx.commit().map_err(db_error)
        })
    }
    pub fn capture(&self, original: &access::Principal) -> Result<RegistrationBinding, AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access.revalidate(original).map_err(access_error)?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        Ok(read_row(&db, original)?.binding)
    }
    pub fn retain(
        &self,
        principal: &access::Principal,
        binding: &RegistrationBinding,
    ) -> Result<OriginalEnrollment, AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access.revalidate(principal).map_err(access_error)?;
        matches_scope(principal, binding)?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row = read_row(&db, principal)?;
        if row.binding != *binding {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(OriginalEnrollment {
            principal: principal.clone(),
            binding: binding.clone(),
            approval: row.approval,
            configuration: row.configuration,
            generation: row.generation,
            owner: Arc::clone(&self.identity),
        })
    }
    pub fn revalidate_original(
        &self,
        original: &OriginalEnrollment,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access
            .revalidate(&original.principal)
            .map_err(access_error)?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        self.check_original(&db, original, binding)
    }
    fn check_original(
        &self,
        db: &Connection,
        original: &OriginalEnrollment,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        if !Arc::ptr_eq(&self.identity, &original.owner) || binding != &original.binding {
            return Err(AiError::ConnectionUnavailable);
        }
        let row = read_row(db, &original.principal)?;
        if row.binding != original.binding
            || row.approval != original.approval
            || row.configuration != original.configuration
            || row.generation != original.generation
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(())
    }
    /// Local stop does not load a key or encrypted file. The original mutation
    /// principal and enrollment writer fence cover rotation, not provider I/O.
    pub fn stop_original(
        &self,
        original: &OriginalEnrollment,
        binding: &RegistrationBinding,
    ) -> Result<StoppedEnrollment, AiError> {
        self.access_fence(&original.principal, || {
            let mut db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(db_error)?;
            self.check_original(&tx, original, binding)?;
            self.journal.stop_registration(binding)?;
            let generation = original
                .generation
                .checked_add(1)
                .ok_or(AiError::DomainUnavailable)?;
            let mut next = binding.clone();
            next.cancellation_epoch = random_id()?;
            let changed = tx
                .execute(
                    "UPDATE ai_host_enrollment SET cancellation_epoch=?4,
                cancellation_generation=?5 WHERE actor_id=?1 AND workspace_id=?2 AND home_id=?3",
                    params![
                        binding.actor_id,
                        binding.workspace_id,
                        binding.home_id,
                        next.cancellation_epoch,
                        generation
                    ],
                )
                .map_err(db_error)?;
            if changed != 1 {
                return Err(AiError::DomainUnavailable);
            }
            tx.commit().map_err(db_error)?;
            Ok(StoppedEnrollment {
                binding: next,
                approval: original.approval.clone(),
                generation,
                owner: Arc::clone(&self.identity),
            })
        })
    }
    fn check_stopped(
        &self,
        db: &Connection,
        original: &OriginalEnrollment,
        binding: &RegistrationBinding,
        stopped: &StoppedEnrollment,
    ) -> Result<(), AiError> {
        if !Arc::ptr_eq(&self.identity, &original.owner)
            || !Arc::ptr_eq(&self.identity, &stopped.owner)
            || binding != &original.binding
            || stopped.approval != original.approval
            || Some(stopped.generation) != original.generation.checked_add(1)
            || !same_registration(binding, &stopped.binding)
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let row = read_row(db, &original.principal)?;
        if row.binding != stopped.binding
            || row.approval != stopped.approval
            || row.configuration != original.configuration
            || row.generation != stopped.generation
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(())
    }
    pub fn revalidate_stopped(
        &self,
        original: &OriginalEnrollment,
        binding: &RegistrationBinding,
        stopped: &StoppedEnrollment,
    ) -> Result<(), AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access
            .revalidate(&original.principal)
            .map_err(access_error)?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        self.check_stopped(&db, original, binding, stopped)
    }
    /// Bounded synchronous file commit only. Holds AT11 BEGIN IMMEDIATE and the
    /// enrollment BEGIN IMMEDIATE writer fences until callback completion.
    /// A successful rename followed by any commit/barrier error stays uncertain;
    /// the caller must not infer rollback or retry automatically.
    pub fn with_persistence_fence<T>(
        &self,
        original: &OriginalEnrollment,
        binding: &RegistrationBinding,
        stopped: Option<&StoppedEnrollment>,
        commit: impl FnOnce() -> Result<T, AiError>,
    ) -> Result<T, AiError> {
        self.access_fence(&original.principal, || {
            let mut db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(db_error)?;
            match stopped {
                Some(stopped) => self.check_stopped(&tx, original, binding, stopped)?,
                None => self.check_original(&tx, original, binding)?,
            }
            let result = commit()?;
            tx.commit().map_err(db_error)?;
            Ok(result)
        })
    }
    pub fn initial_record(
        &self,
        principal: &access::Principal,
        registration: &TrustedRegistration,
    ) -> Result<RegistrationRecord, AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access.assert_mutation(principal).map_err(access_error)?;
        matches_scope(principal, registration.binding())?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        let row = read_row(&db, principal)?;
        if row.binding != registration.binding || row.configuration != registration.configuration()
        {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(registration.empty_record())
    }
    fn access_fence<T>(
        &self,
        principal: &access::Principal,
        operation: impl FnOnce() -> Result<T, AiError>,
    ) -> Result<T, AiError> {
        let mut access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        let mut output = None;
        access
            .with_mutation_authorization(principal, |guard| {
                guard.assert_mutation().map_err(FenceError::from)?;
                output = Some(operation().map_err(FenceError)?);
                guard.assert_mutation().map_err(FenceError::from)?;
                Ok::<(), FenceError>(())
            })
            .map_err(|error| error.0)?;
        output.ok_or(AiError::DomainUnavailable)
    }
}
impl RegistrationAuthority for EnrollmentOwner {
    fn revalidate(
        &self,
        original: &access::Principal,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        let access = self.access.lock().map_err(|_| AiError::DomainUnavailable)?;
        access.revalidate(original).map_err(access_error)?;
        matches_scope(original, binding)?;
        let db = self.db.lock().map_err(|_| AiError::DomainUnavailable)?;
        if read_row(&db, original)?.binding != *binding {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(())
    }
    fn revalidate_action_receipt(
        &self,
        original: &access::Principal,
        binding: &RegistrationBinding,
    ) -> Result<(), AiError> {
        let current = self.capture(original)?;
        if !same_registration(binding, &current) {
            return Err(AiError::ConnectionUnavailable);
        }
        Ok(())
    }
}
fn read_row(db: &Connection, principal: &access::Principal) -> Result<Row, AiError> {
    db.query_row(
        "SELECT registration_id,authority_epoch,cancellation_epoch,approval,
        cancellation_generation,configuration FROM ai_host_enrollment
        WHERE actor_id=?1 AND workspace_id=?2 AND home_id=?3",
        params![
            principal.actor_id().as_str(),
            principal.scope().workspace_id.as_str(),
            principal.scope().home_id.as_str()
        ],
        |r| {
            Ok(Row {
                binding: RegistrationBinding {
                    registration_id: r.get(0)?,
                    actor_id: principal.actor_id().as_str().into(),
                    workspace_id: principal.scope().workspace_id.as_str().into(),
                    home_id: principal.scope().home_id.as_str().into(),
                    authority_epoch: r.get(1)?,
                    cancellation_epoch: r.get(2)?,
                },
                approval: r.get(3)?,
                generation: r.get(4)?,
                configuration: r.get(5)?,
            })
        },
    )
    .optional()
    .map_err(db_error)?
    .ok_or(AiError::ConnectionUnavailable)
}
fn matches_scope(
    principal: &access::Principal,
    binding: &RegistrationBinding,
) -> Result<(), AiError> {
    if principal.actor_id().as_str() != binding.actor_id
        || principal.scope().workspace_id.as_str() != binding.workspace_id
        || principal.scope().home_id.as_str() != binding.home_id
    {
        return Err(AiError::ConnectionUnavailable);
    }
    Ok(())
}
fn same_registration(a: &RegistrationBinding, b: &RegistrationBinding) -> bool {
    a.registration_id == b.registration_id
        && a.actor_id == b.actor_id
        && a.workspace_id == b.workspace_id
        && a.home_id == b.home_id
        && a.authority_epoch == b.authority_epoch
}
fn random_id() -> Result<String, AiError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| AiError::DomainUnavailable)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn db_error(_: rusqlite::Error) -> AiError {
    AiError::DomainUnavailable
}
fn access_error(error: access::AccessError) -> AiError {
    match error {
        access::AccessError::Unavailable => AiError::DomainUnavailable,
        _ => AiError::ConnectionUnavailable,
    }
}
struct FenceError(AiError);
impl From<access::AccessError> for FenceError {
    fn from(error: access::AccessError) -> Self {
        Self(access_error(error))
    }
}
