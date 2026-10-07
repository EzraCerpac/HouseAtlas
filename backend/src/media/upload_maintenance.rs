//! Durable admission accounting and exact metadata retirement. Retained
//! originals stay immutable and charged; SQLite alone attests consumption.
use std::time::Duration;

use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::*;
use crate::media::types::is_digest;
use crate::media::vault::RetainedUsage;

const LIFETIME_FORMAT: &str = "houseatlas-pending-upload-lifetime/1";
const RESERVATION_LIFETIME_FILE: &str = "reservation-lifetime.json";

#[derive(Clone, Debug)]
pub struct UploadLimits {
    pub max_pending: usize,
    pub max_retained_originals: usize,
    pub max_retained_bytes: u64,
    pub pending_lifetime: Duration,
}

impl Default for UploadLimits {
    fn default() -> Self {
        Self {
            max_pending: 10_000,
            max_retained_originals: 10_000,
            max_retained_bytes: 1024 * 1024 * 1024,
            pending_lifetime: Duration::from_secs(3600),
        }
    }
}

impl UploadLimits {
    pub(super) fn validate(&self) -> MediaResult<()> {
        if self.max_pending == 0
            || self.max_pending > 10_000
            || self.max_retained_originals == 0
            || self.max_retained_originals > 10_000
            || self.max_retained_bytes == 0
            || self.pending_lifetime.as_secs() == 0
            || self.pending_lifetime.as_secs() > 24 * 3600
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UploadUsage {
    pub pending_stages: usize,
    pub retained: RetainedUsage,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StageCleanup {
    pub removed_stages: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Lifetime {
    format: String,
    created_at: i64,
    expires_at: i64,
}

impl<R: s::Runtime> NativeUploadStages<'_, R> {
    /// Measure and retain an authorized original before issuing a new asset ID
    /// or token. The host can now ask the actual storage resolver for an existing
    /// asset and bind its exact revision through the domain owner's reuse plan.
    pub fn prepare_original_for_resolution(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        admission: &UploadAdmission,
        body: &mut impl Read,
        budget: &WorkBudget,
    ) -> MediaResult<PreparedOriginal> {
        let scope = authorize(guard, original, budget)?;
        self.validate_admission(admission)?;
        self.expire_pending(budget)?;
        if self.usage(budget)?.pending_stages >= self.limits.max_pending {
            return Err(MediaError::TooLarge);
        }
        let reservation = self.directory.temporary(".upload-")?;
        self.write_reservation_lifetime(&reservation.directory)?;
        let prepared = self.vault.prepare_upload_original_measured(
            &scope,
            admission.purpose,
            admission.content_type,
            body,
            budget,
            &self.limits,
        )?;
        authorize(guard, original, budget)?;
        let key = reservation
            .directory
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(MediaError::Unavailable)?;
        self.remove_metadata(key, &reservation.directory, budget)?;
        authorize(guard, original, budget)?;
        Ok(prepared)
    }

    fn now(&self) -> MediaResult<i64> {
        let text = self.runtime.now().map_err(storage_error)?;
        OffsetDateTime::parse(&text, &Rfc3339)
            .map(|t| t.unix_timestamp())
            .map_err(|_| MediaError::Unavailable)
    }

    pub(super) fn write_reservation_lifetime(&self, directory: &PrivateDir) -> MediaResult<()> {
        self.write_lifetime(directory, RESERVATION_LIFETIME_FILE)
    }

    /// Processing uses its own durable reservation. The published pending
    /// window begins only after measured bytes and stage metadata are complete.
    pub(super) fn complete_lifetime(
        &self,
        directory: &PrivateDir,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        self.write_lifetime(directory, "lifetime.json")?;
        directory.remove_file(RESERVATION_LIFETIME_FILE, budget)
    }

    fn write_lifetime(&self, directory: &PrivateDir, member: &str) -> MediaResult<()> {
        let created_at = self.now()?;
        let expires_at = created_at
            .checked_add(
                i64::try_from(self.limits.pending_lifetime.as_secs())
                    .map_err(|_| MediaError::InvalidInput)?,
            )
            .ok_or(MediaError::InvalidInput)?;
        directory.write_new(
            member,
            &checked_bytes(
                &Lifetime {
                    format: LIFETIME_FORMAT.into(),
                    created_at,
                    expires_at,
                },
                1024,
            )?,
            Mode::from_raw_mode(0o400),
        )
    }

    fn lifetime(
        &self,
        directory: &PrivateDir,
        member: &str,
        budget: &WorkBudget,
    ) -> MediaResult<Option<Lifetime>> {
        if !directory.members()?.iter().any(|name| name == member) {
            // Earlier receipt format has no expiry policy; never invent one.
            return Ok(None);
        }
        let lease: Lifetime = serde_json::from_slice(&directory.read(member, 1024, budget)?)
            .map_err(|_| MediaError::Unavailable)?;
        if lease.format != LIFETIME_FORMAT
            || lease.expires_at <= lease.created_at
            || lease
                .expires_at
                .checked_sub(lease.created_at)
                .is_none_or(|age| age > 24 * 3600)
        {
            return Err(MediaError::Unavailable);
        }
        Ok(Some(lease))
    }

    pub(super) fn require_live(
        &self,
        directory: &PrivateDir,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        let lease = self
            .lifetime(directory, "lifetime.json", budget)?
            .ok_or(MediaError::Unavailable)?;
        if self.now()? >= lease.expires_at {
            return Err(MediaError::Unavailable);
        }
        budget.check()
    }

    /// Every top-level reservation/receipt counts, including old and interrupted
    /// private directories. This never reconstructs an original Principal.
    pub fn usage(&self, budget: &WorkBudget) -> MediaResult<UploadUsage> {
        budget.check()?;
        Ok(UploadUsage {
            pending_stages: self.directory.members()?.len(),
            retained: self.vault.retained_usage(budget)?,
        })
    }

    fn remove_metadata(
        &self,
        key: &str,
        directory: &PrivateDir,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        let members = directory.members()?;
        if members.iter().any(|name| {
            !matches!(
                name.as_str(),
                "stage.json" | "lifetime.json" | RESERVATION_LIFETIME_FILE | "plan"
            ) && !name.starts_with(".plan-")
        }) {
            return Err(MediaError::Unavailable);
        }
        for name in members
            .iter()
            .filter(|name| name.as_str() == "plan" || name.starts_with(".plan-"))
        {
            let plan = directory.child(name, false)?;
            let files = plan.members()?;
            if files.iter().any(|name| name != "binding.json") {
                return Err(MediaError::Unavailable);
            }
            if !files.is_empty() {
                plan.remove_file("binding.json", budget)?;
            }
            directory.remove_empty_child(name, budget)?;
        }
        if members.iter().any(|name| name == "stage.json") {
            directory.remove_file("stage.json", budget)?;
        }
        if members.iter().any(|name| name == "lifetime.json") {
            directory.remove_file("lifetime.json", budget)?;
        }
        if members.iter().any(|name| name == RESERVATION_LIFETIME_FILE) {
            directory.remove_file(RESERVATION_LIFETIME_FILE, budget)?;
        }
        self.directory.remove_empty_child(key, budget)?;
        self.vault.sync_retained_hierarchy()
    }

    /// Trusted exclusive host housekeeping. Expiry retires only pending metadata;
    /// blobs remain retained/charged, never guessed unreferenced from a DB miss.
    pub fn expire_pending(&self, budget: &WorkBudget) -> MediaResult<StageCleanup> {
        let now = self.now()?;
        let mut originals = self
            .originals
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let mut result = StageCleanup::default();
        for key in self.directory.members()? {
            budget.check()?;
            if !is_digest(&key) && !key.starts_with(".upload-") {
                return Err(MediaError::Unavailable);
            }
            let directory = self.directory.child(&key, false)?;
            let members = directory.members()?;
            if members.is_empty() {
                // A previous exact retirement can stop after removing its
                // last member. No byte or authority data remains to expire.
                self.directory.remove_empty_child(&key, budget)?;
                originals.remove(&key);
                result.removed_stages += 1;
                continue;
            }
            // A returned bound plan is not cancelled by deleting its files.
            // Retire bound plans only with checked committed consumption.
            if members
                .iter()
                .any(|name| name == "plan" || name.starts_with(".plan-"))
            {
                continue;
            }
            // A scratch reservation can coexist with completed metadata if
            // publication was interrupted. Never restart its processing lease.
            let lifetime_file = if key.starts_with(".upload-")
                && members.iter().any(|name| name == RESERVATION_LIFETIME_FILE)
            {
                RESERVATION_LIFETIME_FILE
            } else {
                "lifetime.json"
            };
            if self
                .lifetime(&directory, lifetime_file, budget)?
                .is_some_and(|lease| now >= lease.expires_at)
            {
                self.remove_metadata(&key, &directory, budget)?;
                originals.remove(&key);
                result.removed_stages += 1;
            }
        }
        self.directory.sync()?;
        self.vault.sync_retained_hierarchy()?;
        budget.check()?;
        Ok(result)
    }

    /// A sealed storage-loader result proves a real committed consumption. A
    /// token, caller boolean or client-supplied commit cannot substitute for it.
    pub fn cleanup_consumed(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        consumed: &s::ConsumedUpload,
        budget: &WorkBudget,
    ) -> MediaResult<StageCleanup> {
        let scope = authorize(guard, original, budget)?;
        if consumed.scope().workspace_id != scope.workspace_id
            || consumed.scope().home_id != scope.home_id
            || consumed.actor_id() != original.principal().actor_id().as_str()
        {
            return Err(MediaError::Forbidden);
        }
        let key = sha256(consumed.staged().upload_token.as_bytes());
        let mut originals = self
            .originals
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        if !self.directory.members()?.contains(&key) {
            originals.remove(&key);
            self.directory.sync()?;
            self.vault.sync_retained_hierarchy()?;
            authorize(guard, original, budget)?;
            return Ok(StageCleanup::default());
        }
        let directory = self.directory.child(&key, false)?;
        if directory.members()?.iter().any(|name| name == "stage.json") {
            let record: StageRecord =
                serde_json::from_slice(&directory.read("stage.json", MAX_STAGE, budget)?)
                    .map_err(|_| MediaError::Unavailable)?;
            let request =
                stock::ValidatedRequest::parse(&self.schemas, consumed.asset_request().clone())
                    .map_err(stock_error)?;
            let binding = PlanRecord {
                format: PLAN_FORMAT,
                stage: &record,
                original_request: consumed.asset_request(),
                request_digest: request.intent_digest(),
            };
            if record.scope != scope
                || record.actor_id != consumed.actor_id()
                || record.request_id != consumed.request_id()
                || record.asset_id != consumed.asset_id()
                || record.staged != *consumed.staged()
                || stock::canonical_digest(&json(&binding)?).map_err(stock_error)?
                    != consumed.binding_digest()
                || stock::canonical_digest(&json(&record.payload)?).map_err(stock_error)?
                    != stock::canonical_digest(consumed.asset_payload()).map_err(stock_error)?
            {
                return Err(MediaError::Conflict);
            }
        }
        authorize(guard, original, budget)?;
        self.remove_metadata(&key, &directory, budget)?;
        originals.remove(&key);
        authorize(guard, original, budget)?;
        Ok(StageCleanup { removed_stages: 1 })
    }
}
