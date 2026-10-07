//! A dedicated host SQLite journal, separate from stock activity and credentials.
use super::{HostAuthority, valid_id};
use crate::ai::{
    AiError, CancelReceipt, CancelStatus, Cancellation, PortFuture, ProviderDiagnostic, RunOutcome,
    Usage, UsagePort,
    oauth::RegistrationBinding,
    runtime::{RequestStatus, RequestStatusPort},
    stock::DomainDispatch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

type Key = (String, String);
#[derive(Clone)]
pub struct StatusJournal {
    db: Arc<Mutex<Connection>>,
    active: Arc<Mutex<BTreeMap<Key, Cancellation>>>,
}
impl StatusJournal {
    /// Supply a dedicated, securely opened private SQLite database. The host
    /// does not choose a path, migrate the Atlas schema or store credentials.
    /// Its caller owns canonical-path/no-follow/permission and retention policy.
    pub fn new(connection: Connection) -> Result<Self, AiError> {
        connection.execute_batch("PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS ai_host_status (
              scope TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
              state TEXT NOT NULL, payload TEXT, cancelled INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(scope,id,kind));
            CREATE TABLE IF NOT EXISTS ai_host_observation (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              scope TEXT NOT NULL, id TEXT NOT NULL, category TEXT NOT NULL, payload TEXT NOT NULL);")
            .map_err(db_error)?;
        Ok(Self {
            db: Arc::new(Mutex::new(connection)),
            active: Arc::default(),
        })
    }
    fn db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AiError> {
        self.db.lock().map_err(|_| AiError::DomainUnavailable)
    }
    pub(crate) fn begin(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        continuation: Option<&str>,
    ) -> Result<ActiveRun, AiError> {
        if !valid_id(id) {
            return Err(AiError::InvalidInput);
        }
        let scope = scope_key(binding)?;
        let key = (scope.clone(), id.to_owned());
        let mut active = self.active.lock().map_err(|_| AiError::DomainUnavailable)?;
        if active.contains_key(&key) {
            return Err(AiError::InvalidInput);
        }
        let mut db = self.db()?;
        let tx = db.transaction().map_err(db_error)?;
        if let Some(continuation) = continuation {
            let raw: Option<String> = tx
                .query_row(
                    "SELECT payload FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='request'
                 AND state='finished' AND cancelled=0",
                    params![scope, id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_error)?;
            let outcome: RunOutcome = serde_json::from_str(&raw.ok_or(AiError::InvalidInput)?)
                .map_err(|_| AiError::DomainUnavailable)?;
            if !matches!(outcome, RunOutcome::ReviewRequired { continuation_id, .. }
                if continuation_id == continuation)
            {
                return Err(AiError::InvalidInput);
            }
            tx.execute(
                "UPDATE ai_host_status SET state='unconfirmed',payload=NULL
                WHERE scope=?1 AND id=?2 AND kind='request'",
                params![scope, id],
            )
            .map_err(db_error)?;
        } else {
            // A fresh ID has exactly one local admission, including after restart.
            tx.execute("INSERT INTO ai_host_status(scope,id,kind,state) VALUES(?1,?2,'request','unconfirmed')",
                params![scope,id]).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        let cancel = Cancellation::default();
        active.insert(key.clone(), cancel.clone());
        Ok(ActiveRun {
            journal: self.clone(),
            key,
            cancel,
        })
    }
    pub(crate) fn finish(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        outcome: Option<&RunOutcome>,
    ) -> Result<RequestStatus, AiError> {
        let unconfirmed = outcome.is_none_or(|o| matches!(o, RunOutcome::Stopped { .. }));
        let state = if unconfirmed {
            "unconfirmed"
        } else {
            "finished"
        };
        let payload = outcome
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| AiError::DomainUnavailable)?;
        let changed = self
            .db()?
            .execute(
                "UPDATE ai_host_status SET state=?3,payload=?4
            WHERE scope=?1 AND id=?2 AND kind='request' AND state='unconfirmed'",
                params![scope_key(binding)?, id, state, payload],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(AiError::DomainUnavailable);
        }
        self.read(binding, id, false)
    }
    pub fn read(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        include_active: bool,
    ) -> Result<RequestStatus, AiError> {
        let scope = scope_key(binding)?;
        let (state, payload): (String, Option<String>) = self.db()?.query_row(
            "SELECT state,payload FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='request'",
            params![scope,id], |r| Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        if include_active
            && self
                .active
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .contains_key(&(scope, id.to_owned()))
        {
            return Ok(RequestStatus::Running {
                request_id: id.into(),
            });
        }
        if state == "finished" {
            Ok(RequestStatus::Finished {
                request_id: id.into(),
                outcome: serde_json::from_str(&payload.ok_or(AiError::DomainUnavailable)?)
                    .map_err(|_| AiError::DomainUnavailable)?,
            })
        } else {
            Ok(RequestStatus::Unconfirmed {
                request_id: id.into(),
            })
        }
    }
    pub(crate) fn stop(
        &self,
        binding: &RegistrationBinding,
        id: &str,
    ) -> Result<CancelReceipt, AiError> {
        let scope = scope_key(binding)?;
        let mut db = self.db()?;
        let tx = db.transaction().map_err(db_error)?;
        let (state, payload): (String, Option<String>) = tx.query_row(
            "SELECT state,payload FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='request'",
            params![scope,id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?;
        let waiting_review = payload
            .as_deref()
            .and_then(|s| serde_json::from_str::<RunOutcome>(s).ok())
            .is_some_and(|o| matches!(o, RunOutcome::ReviewRequired { .. }));
        let status = if state == "finished" && !waiting_review {
            CancelStatus::AlreadyFinished
        } else {
            tx.execute(
                "UPDATE ai_host_status SET cancelled=1 WHERE scope=?1 AND id=?2 AND kind='request'",
                params![scope, id],
            )
            .map_err(db_error)?;
            CancelStatus::Requested
        };
        tx.commit().map_err(db_error)?;
        drop(db);
        if status == CancelStatus::Requested
            && let Some(cancel) = self
                .active
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .get(&(scope, id.to_owned()))
        {
            cancel.request();
        }
        Ok(CancelReceipt {
            request_id: id.into(),
            status,
        })
    }
    pub(crate) fn review_allowed(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        continuation: &str,
    ) -> Result<(), AiError> {
        let raw: Option<String> = self
            .db()?
            .query_row(
                "SELECT payload FROM ai_host_status
            WHERE scope=?1 AND id=?2 AND kind='request' AND state='finished' AND cancelled=0",
                params![scope_key(binding)?, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        let outcome: RunOutcome = serde_json::from_str(&raw.ok_or(AiError::InvalidInput)?)
            .map_err(|_| AiError::DomainUnavailable)?;
        if !matches!(outcome,RunOutcome::ReviewRequired { continuation_id,.. } if continuation_id == continuation)
        {
            return Err(AiError::InvalidInput);
        }
        Ok(())
    }
    pub(crate) fn stop_registration(&self, binding: &RegistrationBinding) -> Result<(), AiError> {
        let scope = scope_key(binding)?;
        self.db()?
            .execute(
                "UPDATE ai_host_status SET cancelled=1 WHERE scope=?1 AND kind='request'",
                params![scope],
            )
            .map_err(db_error)?;
        for ((key, _), cancel) in self
            .active
            .lock()
            .map_err(|_| AiError::DomainUnavailable)?
            .iter()
        {
            if key == &scope {
                cancel.request();
            }
        }
        Ok(())
    }
    pub(crate) fn append(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        category: &str,
        value: Value,
    ) -> Result<(), AiError> {
        let payload = serde_json::to_string(&value).map_err(|_| AiError::DomainUnavailable)?;
        if payload.len() > 16 * 1024 * 1024 {
            return Err(AiError::LimitReached);
        }
        self.db()?
            .execute(
                "INSERT INTO ai_host_observation(scope,id,category,payload) VALUES(?1,?2,?3,?4)",
                params![scope_key(binding)?, id, category, payload],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub(crate) fn action_begin(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        command: Value,
    ) -> Result<(), AiError> {
        if !valid_id(id) {
            return Err(AiError::InvalidInput);
        }
        self.db()?
            .execute(
                "INSERT INTO ai_host_status(scope,id,kind,state,payload)
            VALUES(?1,?2,'action','unconfirmed',?3)",
                params![scope_key(binding)?, id, command.to_string()],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub(crate) fn action_finish(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        result: Value,
    ) -> Result<(), AiError> {
        self.db()?
            .execute(
                "UPDATE ai_host_status SET state='observed',payload=?3
            WHERE scope=?1 AND id=?2 AND kind='action'",
                params![scope_key(binding)?, id, result.to_string()],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub(crate) fn correlate_launch(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        digest: &str,
    ) -> Result<(), AiError> {
        self.append(
            binding,
            id,
            "authorization-state-digest",
            json!({"digest":digest}),
        )
    }
    pub(crate) fn check_launch(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        digest: &str,
    ) -> Result<(), AiError> {
        let payload: String = self.db()?.query_row("SELECT payload FROM ai_host_observation
            WHERE scope=?1 AND id=?2 AND category='authorization-state-digest' ORDER BY sequence DESC LIMIT 1",
            params![scope_key(binding)?,id], |r| r.get(0)).map_err(db_error)?;
        let value: Value =
            serde_json::from_str(&payload).map_err(|_| AiError::DomainUnavailable)?;
        if value.get("digest").and_then(Value::as_str) != Some(digest) {
            return Err(AiError::InvalidInput);
        }
        Ok(())
    }
    pub(crate) fn action_read(
        &self,
        binding: &RegistrationBinding,
        id: &str,
    ) -> Result<Option<Value>, AiError> {
        let (state, payload): (String,String) = self.db()?.query_row(
            "SELECT state,payload FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='action'",
            params![scope_key(binding)?,id], |r| Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        if state == "observed" {
            Ok(Some(
                serde_json::from_str(&payload).map_err(|_| AiError::DomainUnavailable)?,
            ))
        } else {
            Ok(None)
        }
    }
}
fn db_error(_: rusqlite::Error) -> AiError {
    AiError::DomainUnavailable
}
fn scope_key(b: &RegistrationBinding) -> Result<String, AiError> {
    serde_json::to_string(&[
        &b.actor_id,
        &b.workspace_id,
        &b.home_id,
        &b.registration_id,
        &b.authority_epoch,
        &b.cancellation_epoch,
    ])
    .map_err(|_| AiError::InvalidInput)
}

pub(crate) struct ActiveRun {
    journal: StatusJournal,
    key: Key,
    pub cancel: Cancellation,
}
impl Drop for ActiveRun {
    fn drop(&mut self) {
        if let Ok(mut map) = self.journal.active.lock() {
            map.remove(&self.key);
        }
        // Persisted default remains unconfirmed if a caller drops the future.
    }
}

/// The donor's two infallible usage callbacks cannot return storage failure.
/// Latch failure and request cancellation before it can prepare another call.
pub(crate) struct RequestMeter<'a> {
    pub journal: &'a StatusJournal,
    pub binding: &'a RegistrationBinding,
    pub cancel: &'a Cancellation,
    pub failed: AtomicBool,
}
impl RequestMeter<'_> {
    fn retain(&self, id: &str, kind: &str, value: Value) -> Result<(), AiError> {
        let result = self.journal.append(self.binding, id, kind, value);
        if result.is_err() {
            self.failed.store(true, Ordering::Release);
            self.cancel.request();
        }
        result
    }
    pub fn healthy(&self) -> bool {
        !self.failed.load(Ordering::Acquire)
    }
}
impl<C> UsagePort<C> for RequestMeter<'_> {
    fn observed(&self, _: &C, id: &str, usage: Usage) {
        let _ = self.retain(id, "usage", json!(usage));
    }
    fn provider_failed(&self, _: &C, id: &str, d: &ProviderDiagnostic) {
        let _ = self.retain(
            id,
            "provider-diagnostic",
            json!({"httpStatus":d.http_status,
            "code":d.code,"parameter":d.parameter,"requestId":d.request_id}),
        );
    }
    fn domain_observed(&self, _: &C, id: &str, d: &DomainDispatch) -> Result<(), AiError> {
        self.retain(
            id,
            "domain",
            json!({"state":d.state,"operationId":d.operation_id,"value":d.value}),
        )
    }
}

pub struct ScopedStatus<A> {
    pub journal: StatusJournal,
    pub authority: A,
}
impl<C: Sync, A: HostAuthority<C>> RequestStatusPort<C> for ScopedStatus<A> {
    fn status<'a>(
        &'a self,
        context: &'a C,
        id: &'a str,
        cancel: &'a Cancellation,
    ) -> PortFuture<'a, RequestStatus> {
        Box::pin(async move {
            cancel.checkpoint()?;
            let binding = self.authority.binding(context)?;
            self.authority.revalidate(context, &binding)?;
            let status = self.journal.read(&binding, id, true)?;
            self.authority.revalidate(context, &binding)?;
            Ok(status)
        })
    }
}
