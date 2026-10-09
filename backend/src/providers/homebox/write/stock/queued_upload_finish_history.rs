//! Released Finish DATA from the actual one-shot effects and accepted ledger.
//! No current grants, raw upload body, durable origin, CAS or remote end proof.
use super::queued_upload_dispatch::{
    CapturedQueuedUploadEffects, PendingReadbackIdentity, QueuedUploadEffectsIdentity,
};
use super::*;
use crate::{
    media,
    providers::homebox::{read, recovery::NativeWriterContracts, write_transport},
    storage,
};
use serde::Serialize;
use serde_json::Value;
use std::{io::Write, mem::size_of, sync::Arc};

type Native<'owner, 'captured, 'p> =
    RetainedFreshPreparation<'owner, NativeWriterContracts, QueuedUploadSource<'captured, 'p>>;
const MAX_STRUCTURED: usize = 16 * 1024 * 1024;
const MAX_TOTAL: usize = 128 * 1024 * 1024;
const MAX_RAW: usize = 10 * 1024 * 1024;
const MAX_STEP: usize = 1024 * 1024;

pub struct QueuedUploadHistoricalReadback {
    scope: read::SourceScope,
    entity_id: read::Uuid,
    method: &'static str,
    path: String,
    query: Vec<(String, String)>,
    status: u16,
    redirected: bool,
    retrieved_at: String,
    original: Vec<u8>,
    digest: Digest,
}
impl QueuedUploadHistoricalReadback {
    pub fn scope(&self) -> &read::SourceScope {
        &self.scope
    }
    pub fn entity_id(&self) -> &read::Uuid {
        &self.entity_id
    }
    pub fn method(&self) -> &str {
        self.method
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn status(&self) -> u16 {
        self.status
    }
    pub fn redirected(&self) -> bool {
        self.redirected
    }
    pub fn retrieved_at(&self) -> &str {
        &self.retrieved_at
    }
    pub fn original_bytes(&self) -> &[u8] {
        &self.original
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
    fn matches(&self, raw: &read::CapturedStockEntityObservation) -> bool {
        self.scope == *raw.scope()
            && self.entity_id == *raw.entity_id()
            && self.method == raw.method()
            && self.path == raw.path()
            && self.query == raw.query()
            && self.status == raw.status()
            && self.redirected == raw.redirected()
            && self.retrieved_at == raw.retrieved_at().as_str()
            && self.original == raw.original_bytes()
    }
}
pub struct QueuedUploadHistoricalQualifiedReadback {
    value: Value,
    digest: Digest,
    observed_at: String,
}
impl QueuedUploadHistoricalQualifiedReadback {
    pub fn value(&self) -> &Value {
        &self.value
    }
    pub fn digest(&self) -> &Digest {
        &self.digest
    }
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
}
/// Private pure markers and immutable copied facts only. No Clone or serde.
pub struct NativeQueuedUploadHistoricalEffects {
    original_issuer: Arc<()>,
    effects_identity: Arc<QueuedUploadEffectsIdentity>,
    finish_identity: Arc<storage::QueuedUploadFinishHistoryIdentity>,
    pending_identity: Option<Arc<PendingReadbackIdentity>>,
    accepted_qualified: Option<Arc<PendingReadbackIdentity>>,
    transport: write_transport::DispatchReport,
    report: crate::jobs::FinishReport,
    steps: Vec<storage::QueueStepEvidence>,
    readback: Option<QueuedUploadHistoricalReadback>,
    qualified: Option<QueuedUploadHistoricalQualifiedReadback>,
}
impl NativeQueuedUploadHistoricalEffects {
    pub fn capture_released_finish<'owner, 'captured, 'p>(
        original: &NativeQueuedUploadHistoricalPreparation,
        native: &Native<'owner, 'captured, 'p>,
        recorded: &storage::RecordedOriginalUploadEnqueue,
        execution: &Arc<storage::OriginalQueuedUploadExecution>,
        effects: &CapturedQueuedUploadEffects<'_, 'owner, 'captured, 'p>,
        storage: &storage::ReleasedQueuedUploadFinishHistory,
        budget: &media::WorkBudget,
    ) -> Result<Self, StockErrorCode> {
        check(budget)?;
        // Real released cuts and pure original/native markers precede DATA selection.
        if !storage.matches_live(recorded, execution, effects)
            || !original.matches_live(native)
            || !effects.matches_execution(execution)
            || !effects.matches_native(native)
            || !Arc::ptr_eq(storage.effects_identity(), effects.historical_identity())
            || !effects.matches_qualified_readback_identity(storage.qualified_readback_identity())
            || !execution
                .upload_cut()
                .matches_source_preparation(native.capture().evidence().source_preparation())
            || !execution
                .native_preparation()
                .matches_original(execution.upload_cut())
        {
            return Err(unavailable());
        }
        let original_facts = native.source().historical_live_facts(native)?;
        let facts = effects.historical_facts().map_err(|_| unavailable())?;
        if facts.finish != storage.report()
            || facts.steps != storage.steps()
            || storage.job() != execution.attempt().job()
            || storage.journal_receipt().native_payload_digest
                != execution.journal().receipt().native_payload_digest
            || storage.journal_receipt().journal_evidence_digest
                != execution.journal().receipt().journal_evidence_digest
            || facts.native_command != native.command()
            || facts.native_plan != native.plan()
            || facts.native_authority != native.authority()
        {
            return Err(unavailable());
        }
        let mut tally = Tally {
            structured: 0,
            total: 0,
            budget,
        };
        tally.structured(size_of::<Self>() + 5 * 64)?;
        // Derivation work uses native intent without copying the original history.
        tally.value(&facts.native_command.payload, 2)?;
        tally.value(&facts.native_command.original_wire, 2)?;
        tally.string(&facts.native_command.command_id)?;
        tally.string(facts.native_command.request_digest.as_str())?;
        tally.plan(facts.native_plan)?;
        tally.authority(facts.native_authority)?;
        tally.structured(size_of::<InvocationPermit>())?;
        tally.string(facts.permit.plan_digest.as_str())?;
        tally.string(facts.permit.physical_binding.configuration_digest.as_str())?;
        tally.qualification(&facts.permit.qualification)?;
        tally.transport(facts.report)?;
        // Actual frozen output plus temporary liability/report reduction.
        tally.finish(facts.finish)?;
        tally.finish(facts.finish)?;
        if facts.steps.len() > 64 {
            return Err(unavailable());
        }
        tally.structured(size_of::<Vec<storage::QueueStepEvidence>>())?;
        for step in facts.steps {
            if step.codec.len() > 128 || step.payload.len() > MAX_STEP {
                return Err(unavailable());
            }
            tally.structured(size_of::<storage::QueueStepEvidence>())?;
            tally.string(&step.codec)?;
            tally.buffer(step.payload.len())?;
            for digest in [
                &step.response_digest,
                &step.readback_digest,
                &step.termination_digest,
            ]
            .into_iter()
            .flatten()
            {
                tally.string(digest.as_hex())?;
            }
        }
        // Existing derive_finish generates one <=1MiB step payload. Charge the
        // serialization buffer, serde Value/UUID generated-member vectors and
        // container slack before that existing derivation allocates anything.
        tally.buffer(2 * MAX_STEP)?;
        tally.structured(size_of::<storage::QueueStepEvidence>() + 4096)?;
        if let Some(pending) = facts.pending {
            let raw = pending.historical_observation();
            if raw.original_bytes().len() > MAX_RAW {
                return Err(unavailable());
            }
            tally.structured(size_of::<QueuedUploadHistoricalReadback>())?;
            tally.serialized(raw.scope(), 4)?;
            tally.string(raw.entity_id().as_str())?;
            tally.string(raw.method())?;
            tally.string(raw.path())?;
            tally.string(raw.retrieved_at().as_str())?;
            tally.structured(size_of::<Vec<(String, String)>>())?;
            for (key, value) in raw.query() {
                tally.string(key)?;
                tally.string(value)?;
            }
            tally.string(pending.raw_digest().map_err(|_| unavailable())?.as_str())?;
            tally.buffer(raw.original_bytes().len())?;
        }
        if let Some(qualified) = facts.qualified {
            tally.structured(size_of::<QueuedUploadHistoricalQualifiedReadback>())?;
            tally.value(qualified.value(), 2)?;
            tally.string(qualified.digest().as_str())?;
            tally.string(qualified.observed_at())?;
        }
        check(budget)?;
        effects
            .validate_historical_frozen()
            .map_err(|_| unavailable())?;
        check(budget)?;
        // Output clones begin only after complete accounting and exact frozen
        // re-derivation. Accepted None is never promoted from a later receipt.
        let readback = facts
            .pending
            .map(|pending| {
                let raw = pending.historical_observation();
                Ok(QueuedUploadHistoricalReadback {
                    scope: raw.scope().clone(),
                    entity_id: raw.entity_id().clone(),
                    method: raw.method(),
                    path: raw.path().to_owned(),
                    query: raw.query().to_vec(),
                    status: raw.status(),
                    redirected: raw.redirected(),
                    retrieved_at: raw.retrieved_at().as_str().to_owned(),
                    original: raw.original_bytes().to_vec(),
                    digest: pending.raw_digest().map_err(|_| unavailable())?,
                })
            })
            .transpose()?;
        let qualified = facts
            .qualified
            .map(|qualified| QueuedUploadHistoricalQualifiedReadback {
                value: qualified.value().clone(),
                digest: qualified.digest().clone(),
                observed_at: qualified.observed_at().to_owned(),
            });
        let result = Self {
            original_issuer: original_facts.issuer.clone(),
            effects_identity: effects.historical_identity().clone(),
            finish_identity: storage.finish_identity().clone(),
            pending_identity: facts.pending.map(|p| p.historical_identity().clone()),
            accepted_qualified: storage.qualified_readback_identity().cloned(),
            transport: write_transport::DispatchReport {
                dispatch: facts.report.dispatch.clone(),
                evidence: facts.report.evidence.clone(),
            },
            report: facts.finish.clone(),
            steps: facts.steps.to_vec(),
            readback,
            qualified,
        };
        check(budget)?;
        if !result.matches_live(native, execution, effects, storage) {
            return Err(unavailable());
        }
        Ok(result)
    }
    pub fn transport_report(&self) -> &write_transport::DispatchReport {
        &self.transport
    }
    pub fn report(&self) -> &crate::jobs::FinishReport {
        &self.report
    }
    pub fn steps(&self) -> &[storage::QueueStepEvidence] {
        &self.steps
    }
    pub fn readback(&self) -> Option<&QueuedUploadHistoricalReadback> {
        self.readback.as_ref()
    }
    pub fn qualified_readback(&self) -> Option<&QueuedUploadHistoricalQualifiedReadback> {
        self.qualified.as_ref()
    }
    pub fn matches_storage(&self, storage: &storage::ReleasedQueuedUploadFinishHistory) -> bool {
        Arc::ptr_eq(&self.finish_identity, storage.finish_identity())
            && Arc::ptr_eq(&self.effects_identity, storage.effects_identity())
            && same_optional(
                self.accepted_qualified.as_ref(),
                storage.qualified_readback_identity(),
            )
            && self.report == *storage.report()
            && self.steps == storage.steps()
    }
    /// Pure process-local marker/frozen-fact correlation, without locks or time.
    pub fn matches_live<'owner, 'captured, 'p>(
        &self,
        native: &Native<'owner, 'captured, 'p>,
        execution: &Arc<storage::OriginalQueuedUploadExecution>,
        effects: &CapturedQueuedUploadEffects<'_, 'owner, 'captured, 'p>,
        storage: &storage::ReleasedQueuedUploadFinishHistory,
    ) -> bool {
        if !self.matches_storage(storage)
            || !effects.matches_execution(execution)
            || !effects.matches_native(native)
            || !Arc::ptr_eq(&self.effects_identity, effects.historical_identity())
            || !effects.matches_qualified_readback_identity(self.accepted_qualified.as_ref())
        {
            return false;
        }
        let Ok(original) = native.source().historical_live_facts(native) else {
            return false;
        };
        let Ok(facts) = effects.historical_facts() else {
            return false;
        };
        if !Arc::ptr_eq(&self.original_issuer, original.issuer)
            || self.transport.dispatch != facts.report.dispatch
            || self.transport.evidence != facts.report.evidence
            || self.report != *facts.finish
            || self.steps != facts.steps
        {
            return false;
        }
        let raw_matches = match (&self.readback, facts.pending) {
            (None, None) => self.pending_identity.is_none(),
            (Some(stored), Some(actual)) => {
                same_optional(
                    self.pending_identity.as_ref(),
                    Some(actual.historical_identity()),
                ) && stored.matches(actual.historical_observation())
                    && actual
                        .raw_digest()
                        .is_ok_and(|digest| digest == stored.digest)
            }
            _ => false,
        };
        let qualified_matches = match (&self.qualified, facts.qualified) {
            (None, None) => true,
            (Some(stored), Some(actual)) => {
                stored.value == *actual.value()
                    && stored.digest == *actual.digest()
                    && stored.observed_at == actual.observed_at()
            }
            _ => false,
        };
        raw_matches && qualified_matches
    }
}
fn same_optional(
    a: Option<&Arc<PendingReadbackIdentity>>,
    b: Option<&Arc<PendingReadbackIdentity>>,
) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => Arc::ptr_eq(a, b),
        _ => false,
    }
}
fn unavailable() -> StockErrorCode {
    StockErrorCode::ResourceUnavailable
}
fn check(budget: &media::WorkBudget) -> Result<(), StockErrorCode> {
    budget.check().map_err(|_| unavailable())
}
struct Tally<'a> {
    structured: usize,
    total: usize,
    budget: &'a media::WorkBudget,
}
impl Tally<'_> {
    fn structured(&mut self, bytes: usize) -> Result<(), StockErrorCode> {
        check(self.budget)?;
        self.structured = self
            .structured
            .checked_add(bytes)
            .filter(|n| *n <= MAX_STRUCTURED)
            .ok_or_else(unavailable)?;
        self.buffer(bytes)
    }
    fn buffer(&mut self, bytes: usize) -> Result<(), StockErrorCode> {
        check(self.budget)?;
        self.total = self
            .total
            .checked_add(bytes)
            .filter(|n| *n <= MAX_TOTAL)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn string(&mut self, string: &str) -> Result<(), StockErrorCode> {
        self.structured(size_of::<String>() + string.len())
    }
    fn value(&mut self, value: &Value, multiplier: usize) -> Result<(), StockErrorCode> {
        self.structured(
            (size_of::<Value>() + 128)
                .checked_mul(multiplier)
                .ok_or_else(unavailable)?,
        )?;
        match value {
            Value::String(s) => self.structured(
                (size_of::<String>() + s.len())
                    .checked_mul(multiplier)
                    .ok_or_else(unavailable)?,
            )?,
            Value::Number(_) => self.serialized(value, multiplier)?,
            Value::Array(values) => {
                self.structured(size_of::<Vec<Value>>() * multiplier)?;
                for v in values {
                    self.value(v, multiplier)?;
                }
            }
            Value::Object(values) => {
                for (key, v) in values {
                    self.structured(
                        (size_of::<String>() + key.len() + 128)
                            .checked_mul(multiplier)
                            .ok_or_else(unavailable)?,
                    )?;
                    self.value(v, multiplier)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn serialized<T: Serialize + ?Sized>(
        &mut self,
        value: &T,
        multiplier: usize,
    ) -> Result<(), StockErrorCode> {
        let mut counter = Counter {
            bytes: 0,
            budget: self.budget,
        };
        serde_json::to_writer(&mut counter, value).map_err(|_| unavailable())?;
        self.structured(
            counter
                .bytes
                .checked_mul(multiplier)
                .ok_or_else(unavailable)?,
        )
    }
    fn qualification(&mut self, q: &NativeQualification) -> Result<(), StockErrorCode> {
        if let NativeQualification::Qualified {
            catalog_digest,
            registered_build_digest,
            route_qualification_digest,
        } = q
        {
            for digest in [
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            ] {
                self.string(digest.as_str())?;
            }
        }
        Ok(())
    }
    fn authority(&mut self, authority: &StockAuthority) -> Result<(), StockErrorCode> {
        self.structured(size_of::<StockAuthority>())?;
        self.string(authority.authority_digest.as_str())?;
        self.string(authority.physical_binding.configuration_digest.as_str())?;
        self.qualification(&authority.qualification)
    }
    fn plan(&mut self, plan: &NativePlan) -> Result<(), StockErrorCode> {
        self.structured(size_of::<NativePlan>() * 3)?;
        self.value(&plan.readback.expected, 3)?;
        if let NativeBody::Json(value) = &plan.request.body {
            self.value(value, 3)?;
        }
        self.serialized(plan, 8)
    }
    fn transport(
        &mut self,
        report: &write_transport::DispatchReport,
    ) -> Result<(), StockErrorCode> {
        self.structured(size_of::<write_transport::DispatchReport>())?;
        self.string(report.evidence.plan_digest.as_str())?;
        for digest in [
            &report.evidence.request_body_digest,
            &report.evidence.response_body_digest,
        ]
        .into_iter()
        .flatten()
        {
            self.string(digest.as_str())?;
        }
        if let NativeDispatch::Invoked(receipt) = &report.dispatch {
            self.structured(size_of::<DispatchReceipt>())?;
            self.string(receipt.plan_digest.as_str())?;
            if let Some(response) = &receipt.response {
                self.structured(size_of::<NativeResponse>())?;
                self.string(response.body_digest.as_str())?;
                // Node/slot allowance also covers generated UUID row vectors,
                // added-members Vecs, target/field copies and comparison sets.
                self.value(&response.value, 4)?;
            }
        }
        Ok(())
    }
    fn finish(&mut self, report: &crate::jobs::FinishReport) -> Result<(), StockErrorCode> {
        self.structured(size_of::<crate::jobs::FinishReport>())?;
        if let Some(id) = &report.storage_liability.orphan_candidate_id {
            self.string(id)?;
        }
        if let crate::jobs::FinishDisposition::Succeeded(applied) = &report.disposition {
            if let Some(id) = &applied.external_id {
                self.string(id)?;
            }
            if let Some(at) = &applied.source_updated_at {
                self.string(at)?;
            }
            self.string(applied.observation.response_digest.as_hex())?;
            self.string(applied.observation.readback_digest.as_hex())?;
        }
        if let crate::jobs::RemoteActivity::Invoked(
            crate::jobs::InvokedRemoteActivity::EndedProven {
                termination_evidence_digest,
            },
        ) = &report.remote_activity
        {
            self.string(termination_evidence_digest.as_hex())?;
        }
        Ok(())
    }
}
struct Counter<'a> {
    bytes: usize,
    budget: &'a media::WorkBudget,
}
impl Write for Counter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        check(self.budget).map_err(|_| std::io::Error::other("historical effects work bound"))?;
        self.bytes = self
            .bytes
            .checked_add(bytes.len())
            .filter(|n| *n <= MAX_STRUCTURED)
            .ok_or_else(|| std::io::Error::other("historical effects work bound"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
