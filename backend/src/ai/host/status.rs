//! A dedicated host SQLite journal, separate from stock activity and credentials.
use super::{HostAuthority, valid_id};
use crate::ai::{
    AiError, CancelReceipt, CancelStatus, Cancellation, PortFuture, ProviderDiagnostic, RunOutcome,
    Usage, UsagePort,
    oauth::RegistrationBinding,
    runtime::{ConnectionActionResult, ConnectionActionStatus, RequestStatus, RequestStatusPort},
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
    pub fn new(mut connection: Connection) -> Result<Self, AiError> {
        connection.execute_batch("PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS ai_host_status (
              scope TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
              state TEXT NOT NULL, payload TEXT, cancelled INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(scope,id,kind));
            CREATE TABLE IF NOT EXISTS ai_host_observation (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              scope TEXT NOT NULL, id TEXT NOT NULL, category TEXT NOT NULL, payload TEXT NOT NULL);")
            .map_err(db_error)?;
        migrate_action_scopes(&mut connection)?;
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
        let scope = scope_key(binding)?;
        let key = (scope.clone(), id.to_owned());
        // Serialize publication with both individual cancellation and
        // registration stop. A cancellation latch is authoritative even if
        // durable cancellation bookkeeping subsequently fails.
        let active = self.active.lock().map_err(|_| AiError::DomainUnavailable)?;
        let latched = active.get(&key).is_some_and(Cancellation::is_requested);
        let mut db = self.db()?;
        let transaction = db.transaction().map_err(db_error)?;
        let cancelled: bool = transaction
            .query_row(
                "SELECT cancelled FROM ai_host_status
                 WHERE scope=?1 AND id=?2 AND kind='request' AND state='unconfirmed'",
                params![scope, id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        let mut effective = outcome.cloned();
        if (latched || cancelled) && matches!(&effective, Some(RunOutcome::ReviewRequired { .. })) {
            let original = serde_json::to_string(effective.as_ref().unwrap())
                .map_err(|_| AiError::DomainUnavailable)?;
            let RunOutcome::ReviewRequired { usage, .. } = effective.take().unwrap() else {
                unreachable!()
            };
            transaction
                .execute(
                    "INSERT INTO ai_host_observation(scope,id,category,payload)
                     VALUES(?1,?2,'cancelled-review-required',?3)",
                    params![scope, id, original],
                )
                .map_err(db_error)?;
            effective = Some(RunOutcome::Stopped { usage });
        }
        let unconfirmed = effective
            .as_ref()
            .is_none_or(|o| matches!(o, RunOutcome::Stopped { .. }));
        let state = if unconfirmed {
            "unconfirmed"
        } else {
            "finished"
        };
        let payload = effective
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| AiError::DomainUnavailable)?;
        let changed = transaction
            .execute(
                "UPDATE ai_host_status SET state=?3,payload=?4
            WHERE scope=?1 AND id=?2 AND kind='request' AND state='unconfirmed'",
                params![scope, id, state, payload],
            )
            .map_err(db_error)?;
        if changed != 1 {
            // A stop may have been durably recorded before this finisher
            // acquired SQLite, or the request may already have been retired.
            // Surface the retained receipt without overwriting it.
            transaction.rollback().map_err(db_error)?;
            drop(db);
            return self.read(binding, id, false);
        }
        transaction.commit().map_err(db_error)?;
        drop(db);
        drop(active);
        if unconfirmed {
            if let Some(outcome @ RunOutcome::Stopped { .. }) = effective {
                return Ok(RequestStatus::Finished {
                    request_id: id.into(),
                    outcome,
                });
            }
            return self.read(binding, id, false);
        }
        self.read(binding, id, false)
    }
    pub fn read(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        include_active: bool,
    ) -> Result<RequestStatus, AiError> {
        self.read_exact(binding, id, include_active, false)?
            .ok_or(AiError::DomainUnavailable)
    }

    /// Read only the exact current request scope, preserving the distinction
    /// between an absent ID and an unavailable/corrupt journal for callers that
    /// may then attempt receipt-only cancellation-epoch fallback.
    pub(crate) fn read_current_receipt(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        include_active: bool,
    ) -> Result<Option<RequestStatus>, AiError> {
        self.read_exact(binding, id, include_active, true)
    }
    fn read_exact(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        include_active: bool,
        local_terminal_receipt: bool,
    ) -> Result<Option<RequestStatus>, AiError> {
        let scope = scope_key(binding)?;
        let row: Option<(String, Option<String>, bool)> = self
            .db()?
            .query_row(
                "SELECT state,payload,cancelled FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='request'",
                params![scope,id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
            .optional()
            .map_err(db_error)?;
        let Some((state, payload, cancelled)) = row else {
            return Ok(None);
        };
        // Persisted outcomes are authoritative even while the completed
        // caller still retains its guard during response release. In particular
        // ReviewRequired and DomainHeld must not be hidden by Running.
        if state == "finished" {
            let outcome: RunOutcome =
                serde_json::from_str(&payload.ok_or(AiError::DomainUnavailable)?)
                    .map_err(|_| AiError::DomainUnavailable)?;
            let outcome = if cancelled {
                match outcome {
                    RunOutcome::ReviewRequired { usage, .. } => RunOutcome::Stopped { usage },
                    other => other,
                }
            } else {
                outcome
            };
            return Ok(Some(RequestStatus::Finished {
                request_id: id.into(),
                outcome,
            }));
        }
        // A stored Stopped is known local processing completion even when
        // provider completion remains durably unconfirmed. Mounted receipt
        // reads can recover it after a lost response without waiting for an
        // epoch rotation. The journal's ordinary read preserves its original
        // unconfirmed status and does not claim remote termination.
        if local_terminal_receipt
            && state == "unconfirmed"
            && let Some(raw) = payload.as_deref()
        {
            let outcome: RunOutcome =
                serde_json::from_str(raw).map_err(|_| AiError::DomainUnavailable)?;
            if matches!(outcome, RunOutcome::Stopped { .. }) {
                return Ok(Some(RequestStatus::Finished {
                    request_id: id.into(),
                    outcome,
                }));
            }
        }
        if include_active
            && self
                .active
                .lock()
                .map_err(|_| AiError::DomainUnavailable)?
                .contains_key(&(scope, id.to_owned()))
        {
            return Ok(Some(RequestStatus::Running {
                request_id: id.into(),
            }));
        }
        Ok(Some(RequestStatus::Unconfirmed {
            request_id: id.into(),
        }))
    }
    pub(crate) fn stop(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        retire: impl FnOnce(&str) -> Result<(), AiError>,
    ) -> Result<CancelReceipt, AiError> {
        let scope = scope_key(binding)?;
        // Match begin's active->database order. Release the database before
        // retiring handles, whose registry uses registry->database order.
        let active = self.active.lock().map_err(|_| AiError::DomainUnavailable)?;
        let (state,payload):(String,Option<String>)=self.db()?.query_row(
            "SELECT state,payload FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='request'",
            params![scope,id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        let waiting = if state == "finished" {
            payload
                .as_deref()
                .map(serde_json::from_str::<RunOutcome>)
                .transpose()
                .map_err(|_| AiError::DomainUnavailable)?
        } else {
            None
        };
        let status = if let Some(RunOutcome::ReviewRequired {
            continuation_id,
            usage,
            ..
        }) = waiting
        {
            retire(&continuation_id)?;
            let terminal = serde_json::to_string(&RunOutcome::Cancelled { usage })
                .map_err(|_| AiError::DomainUnavailable)?;
            let changed = self
                .db()?
                .execute(
                    "UPDATE ai_host_status SET cancelled=1,state='finished',payload=?3
                WHERE scope=?1 AND id=?2 AND kind='request' AND state='finished' AND payload=?4",
                    params![scope, id, terminal, payload],
                )
                .map_err(db_error)?;
            if changed != 1 {
                return Err(AiError::DomainUnavailable);
            }
            // The finished payload proves that the runner has yielded its
            // checkpoint. A lingering guard cannot keep it claimable.
            if let Some(cancel) = active.get(&(scope, id.to_owned())) {
                cancel.request();
            }
            CancelStatus::Confirmed
        } else if state == "finished" {
            CancelStatus::AlreadyFinished
        } else {
            self.db()?.execute("UPDATE ai_host_status SET cancelled=1 WHERE scope=?1 AND id=?2 AND kind='request'",
                params![scope,id]).map_err(db_error)?;
            if let Some(cancel) = active.get(&(scope, id.to_owned())) {
                cancel.request();
            }
            CancelStatus::Requested
        };
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
        // Latch actual local runs before durable bookkeeping. Key, credential
        // file or journal availability never gates this in-process stop signal.
        // Keep the active-map lock through the journal transaction so finish
        // cannot publish a review after this stop has won the race.
        let active = self.active.lock().map_err(|_| AiError::DomainUnavailable)?;
        for ((key, _), cancel) in active.iter() {
            if key == &scope {
                cancel.request();
            }
        }
        let mut db = self.db()?;
        let transaction = db.transaction().map_err(db_error)?;
        transaction
            .execute(
                "UPDATE ai_host_status SET cancelled=1 WHERE scope=?1 AND kind='request'",
                params![scope],
            )
            .map_err(db_error)?;
        // A finisher that acquired the lock immediately before stop may have
        // committed a human-review checkpoint. Registration cancellation
        // retires that UI state while preserving usage and leaving the original
        // prepared input/checkpoint owner untouched.
        let pending_reviews = {
            let mut statement = transaction
                .prepare(
                    "SELECT id,payload FROM ai_host_status
                     WHERE scope=?1 AND kind='request' AND state='finished' AND cancelled=1",
                )
                .map_err(db_error)?;
            let mut rows = statement.query(params![scope]).map_err(db_error)?;
            let mut reviews = Vec::new();
            while let Some(row) = rows.next().map_err(db_error)? {
                let id: String = row.get(0).map_err(db_error)?;
                let raw: Option<String> = row.get(1).map_err(db_error)?;
                if let Some(raw) = raw {
                    let outcome: RunOutcome =
                        serde_json::from_str(&raw).map_err(|_| AiError::DomainUnavailable)?;
                    if let RunOutcome::ReviewRequired { usage, .. } = outcome {
                        reviews.push((
                            id,
                            raw,
                            serde_json::to_string(&RunOutcome::Stopped { usage })
                                .map_err(|_| AiError::DomainUnavailable)?,
                        ));
                    }
                }
            }
            reviews
        };
        for (id, original, stopped) in pending_reviews {
            transaction
                .execute(
                    "INSERT INTO ai_host_observation(scope,id,category,payload)
                     VALUES(?1,?2,'cancelled-review-required',?3)",
                    params![scope, id, original],
                )
                .map_err(db_error)?;
            let changed = transaction
                .execute(
                    "UPDATE ai_host_status SET state='unconfirmed',payload=?3
                     WHERE scope=?1 AND id=?2 AND kind='request' AND state='finished' AND cancelled=1",
                    params![scope, id, stopped],
                )
                .map_err(db_error)?;
            if changed != 1 {
                return Err(AiError::DomainUnavailable);
            }
        }
        transaction.commit().map_err(db_error)?;
        drop(active);
        Ok(())
    }

    /// Look up a request receipt after an intentional cancellation-epoch
    /// rotation. The current exact scope always takes precedence; fallback is
    /// allowed only for one cancelled row whose original trusted actor,
    /// workspace, home, registration and authority epoch match. This method
    /// never rebases the row or supplies continuation authority.
    pub(crate) fn read_cancelled_receipt(
        &self,
        binding: &RegistrationBinding,
        id: &str,
    ) -> Result<Option<RequestStatus>, AiError> {
        let Some((state, payload)) = self.cancelled_receipt_row(binding, id)? else {
            return Ok(None);
        };
        if state == "finished" {
            let outcome: RunOutcome =
                serde_json::from_str(&payload.ok_or(AiError::DomainUnavailable)?)
                    .map_err(|_| AiError::DomainUnavailable)?;
            let outcome = match outcome {
                RunOutcome::ReviewRequired { usage, .. } => RunOutcome::Stopped { usage },
                other => other,
            };
            return Ok(Some(RequestStatus::Finished {
                request_id: id.into(),
                outcome,
            }));
        }
        if let Some(raw) = payload.as_deref() {
            let outcome: RunOutcome =
                serde_json::from_str(raw).map_err(|_| AiError::DomainUnavailable)?;
            if matches!(outcome, RunOutcome::Stopped { .. }) {
                return Ok(Some(RequestStatus::Finished {
                    request_id: id.into(),
                    outcome,
                }));
            }
        }
        Ok(Some(RequestStatus::Unconfirmed {
            request_id: id.into(),
        }))
    }

    /// Idempotent cancellation receipt lookup after cancellation-epoch
    /// rotation. It does not change old request state or retire/replay anything.
    pub(crate) fn stop_cancelled_receipt(
        &self,
        binding: &RegistrationBinding,
        id: &str,
    ) -> Result<Option<CancelReceipt>, AiError> {
        let Some((state, payload)) = self.cancelled_receipt_row(binding, id)? else {
            return Ok(None);
        };
        let stopped = payload
            .as_deref()
            .map(serde_json::from_str::<RunOutcome>)
            .transpose()
            .map_err(|_| AiError::DomainUnavailable)?
            .is_some_and(|outcome| matches!(outcome, RunOutcome::Stopped { .. }));
        Ok(Some(CancelReceipt {
            request_id: id.into(),
            status: if state == "finished" || stopped {
                CancelStatus::AlreadyFinished
            } else {
                CancelStatus::Requested
            },
        }))
    }

    fn cancelled_receipt_row(
        &self,
        binding: &RegistrationBinding,
        id: &str,
    ) -> Result<Option<(String, Option<String>)>, AiError> {
        if !valid_id(id) {
            return Err(AiError::InvalidInput);
        }
        let exact = scope_key(binding)?;
        let same_authority = serde_json::from_str::<Vec<String>>(&action_scope_key(binding)?)
            .map_err(|_| AiError::DomainUnavailable)?;
        let db = self.db()?;
        let current: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM ai_host_status
                 WHERE scope=?1 AND id=?2 AND kind='request')",
                params![exact, id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        if current {
            return Ok(None);
        }
        let mut statement = db
            .prepare(
                "SELECT scope,state,payload FROM ai_host_status
                 WHERE id=?1 AND kind='request' AND cancelled=1",
            )
            .map_err(db_error)?;
        let mut rows = statement.query(params![id]).map_err(db_error)?;
        let mut found = None;
        while let Some(row) = rows.next().map_err(db_error)? {
            let raw_scope: String = row.get(0).map_err(db_error)?;
            let fields: Vec<String> =
                serde_json::from_str(&raw_scope).map_err(|_| AiError::DomainUnavailable)?;
            if fields.len() != 6 || fields[..5] != same_authority[..] {
                continue;
            }
            if found.is_some() {
                return Err(AiError::DomainUnavailable);
            }
            found = Some((row.get(1).map_err(db_error)?, row.get(2).map_err(db_error)?));
        }
        Ok(found)
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
                params![action_scope_key(binding)?, id, command.to_string()],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub(crate) fn action_finish(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        result: ConnectionActionResult,
    ) -> Result<ConnectionActionResult, AiError> {
        if result.action_id != id {
            return Err(AiError::InvalidInput);
        }
        let mut db = self.db()?;
        let transaction = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(db_error)?;
        let scope = action_scope_key(binding)?;
        let (state, payload): (String, String) = transaction
            .query_row(
                "SELECT state,payload FROM ai_host_status
                 WHERE scope=?1 AND id=?2 AND kind='action'",
                params![scope, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(db_error)?;
        if state == "observed" {
            let observed: ConnectionActionResult =
                serde_json::from_str(&payload).map_err(|_| AiError::DomainUnavailable)?;
            if observed.action_id != id {
                return Err(AiError::DomainUnavailable);
            }
            // A launch finishing after its callback cannot reopen the workflow
            // or replace its terminal snapshot. Return the canonical receipt to
            // the caller as well as preserving it in durable status.
            if matches!(result.status, ConnectionActionStatus::Pending)
                && !matches!(observed.status, ConnectionActionStatus::Pending)
            {
                transaction.commit().map_err(db_error)?;
                return Ok(observed);
            }
        } else if state != "unconfirmed" {
            return Err(AiError::DomainUnavailable);
        }
        let changed = transaction
            .execute(
                "UPDATE ai_host_status SET state='observed',payload=?3
            WHERE scope=?1 AND id=?2 AND kind='action'",
                params![scope, id, json!(&result).to_string()],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(AiError::DomainUnavailable);
        }
        transaction.commit().map_err(db_error)?;
        Ok(result)
    }
    /// Known synchronous failure before OAuth begin/launch. Keep the original
    /// command and typed cause as private evidence, atomically with the terminal
    /// workflow receipt. This does not confirm provider/credential outcomes.
    pub(crate) fn action_prelaunch_failure(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        result: Value,
        reason: AiError,
    ) -> Result<(), AiError> {
        let mut db = self.db()?;
        let transaction = db.transaction().map_err(db_error)?;
        let scope = action_scope_key(binding)?;
        let command: String = transaction
            .query_row(
                "SELECT payload FROM ai_host_status WHERE scope=?1 AND id=?2
                 AND kind='action' AND state='unconfirmed'",
                params![scope, id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        let command: Value =
            serde_json::from_str(&command).map_err(|_| AiError::DomainUnavailable)?;
        transaction
            .execute(
                "INSERT INTO ai_host_observation(scope,id,category,payload) VALUES(?1,?2,?3,?4)",
                params![
                    scope_key(binding)?,
                    id,
                    "action-prelaunch-failure",
                    json!({"command": command, "reason": reason}).to_string()
                ],
            )
            .map_err(db_error)?;
        let changed = transaction
            .execute(
                "UPDATE ai_host_status SET state='observed',payload=?3
             WHERE scope=?1 AND id=?2 AND kind='action' AND state='unconfirmed'",
                params![scope, id, result.to_string()],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(AiError::DomainUnavailable);
        }
        transaction.commit().map_err(db_error)
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
    pub(crate) fn correlate_nonce(
        &self,
        binding: &RegistrationBinding,
        id: &str,
        digest: &str,
    ) -> Result<(), AiError> {
        self.append(
            binding,
            id,
            "authorization-nonce-digest",
            json!({"digest":digest}),
        )
    }
    pub(crate) fn nonce_action(
        &self,
        binding: &RegistrationBinding,
        digest: &str,
    ) -> Result<String, AiError> {
        let db = self.db()?;
        let mut statement = db
            .prepare(
                "SELECT DISTINCT id FROM ai_host_observation
            WHERE scope=?1 AND category='authorization-nonce-digest' AND payload=?2",
            )
            .map_err(db_error)?;
        let mut rows = statement
            .query(params![
                scope_key(binding)?,
                json!({"digest":digest}).to_string()
            ])
            .map_err(db_error)?;
        let id: String = rows
            .next()
            .map_err(db_error)?
            .ok_or(AiError::DomainUnavailable)?
            .get(0)
            .map_err(db_error)?;
        if rows.next().map_err(db_error)?.is_some() {
            return Err(AiError::DomainUnavailable);
        }
        if !valid_id(&id) {
            return Err(AiError::DomainUnavailable);
        }
        db.query_row(
            "SELECT 1 FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='action'",
            params![action_scope_key(binding)?, id],
            |_| Ok(()),
        )
        .map_err(db_error)?;
        Ok(id)
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
        let row: Option<(String, String)> = self
            .db()?
            .query_row(
                "SELECT state,payload FROM ai_host_status WHERE scope=?1 AND id=?2 AND kind='action'",
                params![action_scope_key(binding)?, id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        let Some((state, payload)) = row else {
            return Ok(None);
        };
        if state == "observed" {
            Ok(Some(
                serde_json::from_str(&payload).map_err(|_| AiError::DomainUnavailable)?,
            ))
        } else {
            Ok(None)
        }
    }
}
/// Upgrade only the dedicated host action correlation keys. Payload, state,
/// cancellation flags and all request/observation rows remain unchanged. The
/// single transaction rolls back on any ambiguous/colliding legacy identity;
/// it never chooses one receipt, merges actions or replays their side effects.
fn migrate_action_scopes(connection: &mut Connection) -> Result<(), AiError> {
    let transaction = connection.transaction().map_err(db_error)?;
    let migrations = {
        let mut statement = transaction
            .prepare("SELECT scope,id FROM ai_host_status WHERE kind='action'")
            .map_err(db_error)?;
        let mut rows = statement.query([]).map_err(db_error)?;
        let mut migrations = Vec::new();
        while let Some(row) = rows.next().map_err(db_error)? {
            let previous: String = row.get(0).map_err(db_error)?;
            let id: String = row.get(1).map_err(db_error)?;
            let fields: Vec<String> =
                serde_json::from_str(&previous).map_err(|_| AiError::DomainUnavailable)?;
            match fields.len() {
                5 => {}
                6 => {
                    let current = serde_json::to_string(&fields[..5])
                        .map_err(|_| AiError::DomainUnavailable)?;
                    migrations.push((previous, current, id));
                }
                _ => return Err(AiError::DomainUnavailable),
            }
        }
        migrations
    };
    for (previous, current, id) in migrations {
        let changed = transaction
            .execute(
                "UPDATE ai_host_status SET scope=?1 WHERE scope=?2 AND id=?3 AND kind='action'",
                params![current, previous, id],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(AiError::DomainUnavailable);
        }
        // Keep the original six-field correlation as upgrade provenance in the
        // same transaction; migration does not erase its cancellation epoch.
        transaction
            .execute(
                "INSERT INTO ai_host_observation(scope,id,category,payload)
             VALUES(?1,?2,'action-scope-upgraded',?3)",
                params![previous, id, json!({"receiptScope":current}).to_string()],
            )
            .map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)
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

fn action_scope_key(b: &RegistrationBinding) -> Result<String, AiError> {
    serde_json::to_string(&[
        &b.actor_id,
        &b.workspace_id,
        &b.home_id,
        &b.registration_id,
        &b.authority_epoch,
    ])
    .map_err(|_| AiError::InvalidInput)
}
