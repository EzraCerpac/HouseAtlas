//! Read-only inspection of retained intents and genuine stock-linked audits.
use super::super::{repository as repo, stock_projection, stock_repository as stock_repo, *};
use super::{AtlasStore, authorize, read_request, shape, stock::stock_error};
use crate::{
    domain::stock::{self, StockContractPort, ValidatedRequest},
    media::native::RetainedPrincipal,
};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use std::sync::Arc;

fn unavailable() -> Error {
    Error::new(
        "upstream-unavailable",
        "Retained inspection exceeds its read budget",
    )
}
fn changed() -> Error {
    Error::new(
        "revision-conflict",
        "Prepared retained read changed; prepare a new read",
    )
}
fn same_original<P: StagedUploadPrincipal>(
    principal: &P,
    original: &RetainedPrincipal,
) -> Result<()> {
    if !std::ptr::eq(principal.original_upload_principal(), original.principal()) {
        return Err(Error::new(
            "forbidden",
            "Original retained-read principal is required",
        ));
    }
    Ok(())
}
fn bound<C: Contract, A: Authorization, R: Runtime, B: StockRetainedReadAuthorization>(
    store: &AtlasStore<C, A, R>,
    principal: &A::Principal,
    binding: &StockReadBinding,
    b: &B,
) -> Result<()>
where
    A::Principal: StagedUploadPrincipal,
{
    same_original(principal, &binding.principal)?;
    if !Arc::ptr_eq(&b.retained_read_owner().0, &binding.owner.0)
        || !Arc::ptr_eq(&store.instance, &binding.instance)
        || principal as *const A::Principal as usize != binding.wrapper_address
    {
        return Err(Error::new(
            "forbidden",
            "Original Store and complete principal wrapper are required",
        ));
    }
    Ok(())
}
fn check<C: Contract, B: StockRetainedReadAuthorization>(
    contract: &C,
    b: &B,
    p: &B::Principal,
    frame: StockRetainedReadFrame<'_>,
) -> Result<VerifiedActor> {
    let actor = authorize(
        contract,
        b,
        p,
        read_request(frame.scope, Capability::ReadHistory, frame.targets),
    )?;
    if b.authorize_stock_retained_read(p, frame)? != actor {
        return Err(Error::new("unauthenticated", "Retained-read actor changed"));
    }
    Ok(actor)
}
fn targets_from_intent<C: Contract>(
    contract: &C,
    request: &ValidatedRequest,
) -> Result<Vec<RecordRef>> {
    let mut values = vec![request];
    values.extend(request.children());
    let mut targets = Vec::new();
    for r in values {
        for value in std::iter::once(r.target()).chain(
            r.raw()["preconditions"]["guards"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|g| &g["target"]),
        ) {
            if value["recordType"].is_string() && value["recordId"].is_string() {
                let target: RecordRef = serde_json::from_value(
                    json!({"recordType":value["recordType"],"recordId":value["recordId"]}),
                )?;
                shape(contract, "recordRef", &target)?;
                if !targets.contains(&target) {
                    targets.push(target);
                    if targets.len() > 256 {
                        return Err(unavailable());
                    }
                }
            }
        }
    }
    Ok(targets)
}
fn extend_retained_targets<C: Contract, S: StockContractPort>(
    contract: &C,
    stock: &S,
    commit: &StockAtlasCommit,
    targets: &mut Vec<RecordRef>,
) -> Result<()> {
    // validate_retained has already matched every group's original request to
    // this root/ordered child plan. Parsing the root visits all those children.
    let request = ValidatedRequest::parse(stock, commit.original_request.clone())
        .map_err(|_| stock_repo::incompatible())?;
    for target in targets_from_intent(contract, &request)?.into_iter().chain(
        commit
            .groups
            .iter()
            .flat_map(|group| group.native_results.iter())
            .map(|result| result.audit.record.clone()),
    ) {
        if !targets.contains(&target) {
            targets.push(target);
        }
        if targets.len() > 256 {
            return Err(unavailable());
        }
    }
    Ok(())
}
fn current_records<C: Contract>(
    db: &rusqlite::Connection,
    contract: &C,
    scope: &Scope,
    targets: &[RecordRef],
) -> Result<Vec<Record>> {
    if targets.len() > 256 {
        return Err(unavailable());
    }
    let mut bytes = 0_i64;
    let mut records = Vec::new();
    for target in targets {
        let size:Option<i64>=db.query_row("SELECT length(CAST(body AS BLOB)) FROM records WHERE workspace_id=?1 AND home_id=?2 AND record_type=?3 AND record_id=?4",
            params![scope.workspace_id,scope.home_id,target.record_type.as_str(),target.record_id],|row|row.get(0)).optional()?;
        if let Some(size) = size {
            bytes = bytes.checked_add(size).ok_or_else(unavailable)?;
            if size < 0 || bytes > 16 * 1024 * 1024 {
                return Err(unavailable());
            }
            let record = repo::read_record(db, scope, target)?;
            shape(contract, "record", &record)?;
            if record.scope() != *scope || record.reference() != *target {
                return Err(stock_repo::incompatible());
            }
            records.push(record);
        }
    }
    Ok(records)
}
fn lookup<C: Contract, S: StockContractPort>(
    db: &rusqlite::Connection,
    contract: &C,
    stock: &S,
    scope: &Scope,
    actor: &str,
    request: &ValidatedRequest,
) -> Result<(Option<StockAtlasCommit>, Option<usize>)> {
    let (commit, group, _) = lookup_with_plan(db, contract, stock, scope, actor, request)?;
    Ok((commit, group))
}
type SavedAtlasPlan = (ValidatedRequest, stock::AtlasCommandPlan);
type RetainedLookup = (
    Option<StockAtlasCommit>,
    Option<usize>,
    Option<SavedAtlasPlan>,
);
fn lookup_with_plan<C: Contract, S: StockContractPort>(
    db: &rusqlite::Connection,
    contract: &C,
    stock: &S,
    scope: &Scope,
    actor: &str,
    request: &ValidatedRequest,
) -> Result<RetainedLookup> {
    let key = request.raw()["idempotencyKey"]
        .as_str()
        .ok_or_else(stock_repo::incompatible)?;
    let Some((root, ordinal)) = stock_repo::key(db, scope, actor, key)? else {
        return Ok((None, None, None));
    };
    stock_repo::assert_retained_read_budget(db, scope, actor, &root)?;
    let commit = stock_repo::load(db, contract, scope, actor, &root)?;
    let saved_plan = stock_projection::validate_retained_with_plan(db, &commit, stock, contract)?;
    let ordinal = ordinal
        .map(usize::try_from)
        .transpose()
        .map_err(|_| stock_repo::incompatible())?;
    let (raw, digest) = match ordinal {
        Some(index) => {
            let g = commit
                .groups
                .get(index)
                .ok_or_else(stock_repo::incompatible)?;
            (&g.original_request, &g.request_digest)
        }
        None => (&commit.original_request, &commit.request_digest),
    };
    // Only an actual root transport may renew its two excluded root IDs.
    // A saved batch child envelope remains wholly bound inside the root intent.
    let intent_matches = match ordinal {
        Some(_) => {
            stock::canonical_bytes(request.raw()).map_err(stock_error)?
                == stock::canonical_bytes(raw).map_err(stock_error)?
        }
        None => stock::retained_atlas_intent_matches(request.raw(), raw).map_err(stock_error)?,
    };
    if raw["idempotencyKey"] != key || digest != request.intent_digest() || !intent_matches {
        return Err(stock_repo::conflict());
    }
    Ok((Some(commit), ordinal, Some(saved_plan)))
}
const MAX_RETAINED_PAGE_ROOTS: usize = 101;
const MAX_RETAINED_SNAPSHOT_SQL_BYTES: usize = 32 * 1024 * 1024;
const MAX_RETAINED_SNAPSHOT_FACT_BYTES: usize = 48 * 1024 * 1024;

// Count the bounded JSON representation of decoded detached facts
// without allocating another complete encoded copy. This is not an allocator
// heap-size claim; SQL predecode, event/root/target counts are separate caps.
struct FactBudget {
    remaining: usize,
}
impl std::io::Write for FactBudget {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.remaining = self
            .remaining
            .checked_sub(bytes.len())
            .ok_or_else(|| std::io::Error::other("Retained fact budget exceeded"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn fact_budget(snapshot: &StockOperationEventSnapshot, records: &[Record]) -> Result<()> {
    let mut budget = FactBudget {
        remaining: MAX_RETAINED_SNAPSHOT_FACT_BYTES,
    };
    serde_json::to_writer(
        &mut budget,
        &(
            snapshot.watermark,
            snapshot.after,
            snapshot.scan_end,
            snapshot.more_unscanned,
            &snapshot.retained_commits,
            &snapshot.targets,
            &snapshot.rows,
            &snapshot.audits,
            records,
        ),
    )
    .map_err(|_| unavailable())?;
    Ok(())
}

fn snapshot_rows<C: Contract, S: StockContractPort>(
    db: &rusqlite::Connection,
    contract: &C,
    stock: &S,
    scope: &Scope,
    watermark: i64,
    after: i64,
    page_size: usize,
) -> Result<(StockOperationEventSnapshot, Vec<Record>)> {
    let window = stock_repo::retained_event_window(db, scope, watermark, after, page_size)?;
    let mut validated = std::collections::BTreeMap::new();
    let mut budget = 0_usize;
    let mut rows = Vec::new();
    let mut audits = Vec::new();
    let mut targets = Vec::new();
    for link in window.links {
        let identity = (link.actor_id.clone(), link.root_operation_id.clone());
        if !validated.contains_key(&identity) {
            if validated.len() >= MAX_RETAINED_PAGE_ROOTS {
                return Err(unavailable());
            }
            budget = budget
                .checked_add(stock_repo::assert_retained_read_budget(
                    db,
                    scope,
                    &link.actor_id,
                    &link.root_operation_id,
                )?)
                .ok_or_else(unavailable)?;
            if budget > MAX_RETAINED_SNAPSHOT_SQL_BYTES {
                return Err(unavailable());
            }
            let commit =
                stock_repo::load(db, contract, scope, &link.actor_id, &link.root_operation_id)?;
            stock_projection::validate_retained(db, &commit, stock, contract)?;
            extend_retained_targets(contract, stock, &commit, &mut targets)?;
            validated.insert(identity.clone(), commit);
        }
        let commit = validated
            .get(&identity)
            .ok_or_else(stock_repo::incompatible)?;
        let group = commit
            .groups
            .get(usize::try_from(link.group_ordinal).map_err(|_| stock_repo::incompatible())?)
            .ok_or_else(stock_repo::incompatible)?;
        let audit = &group
            .native_results
            .get(usize::try_from(link.entry_ordinal).map_err(|_| stock_repo::incompatible())?)
            .ok_or_else(stock_repo::incompatible)?
            .audit;
        if audit.audit_id != link.audit_id
            || audit.actor_id != link.actor_id
            || audit.workspace_id != scope.workspace_id
            || audit.home_id != scope.home_id
        {
            return Err(stock_repo::incompatible());
        }
        shape(contract, "audit", audit)?;
        if !targets.contains(&audit.record) {
            targets.push(audit.record.clone());
        }
        rows.push((
            link.sequence,
            StockOperationEvent {
                event_id: audit.audit_id.clone(),
                root_operation_id: commit.operation_id.clone(),
                operation_id: group.operation_id.clone(),
                command_id: group.original_request["commandId"]
                    .as_str()
                    .ok_or_else(stock_repo::incompatible)?
                    .into(),
                actor_id: audit.actor_id.clone(),
                at: audit.at.clone(),
                target: StockOperationEventTarget {
                    authority: "atlas",
                    record_type: audit.record.record_type,
                    record_id: audit.record.record_id.clone(),
                },
                request_digest: group.request_digest.clone(),
                state: "committed",
            },
        ));
        audits.push(audit.clone());
    }
    let records = current_records(db, contract, scope, &targets)?;
    let snapshot = StockOperationEventSnapshot {
        watermark,
        after,
        scan_end: window.scan_end,
        more_unscanned: window.more_unscanned,
        rows,
        audits,
        targets,
        retained_commits: validated.into_values().collect(),
    };
    fact_budget(&snapshot, &records)?;
    Ok((snapshot, records))
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    fn read_binding(
        &self,
        principal: &A::Principal,
        original: &RetainedPrincipal,
        actor: VerifiedActor,
        owner: &StockRetainedReadOwner,
    ) -> StockReadBinding {
        StockReadBinding {
            instance: self.instance.clone(),
            owner: owner.clone(),
            principal: original.clone(),
            wrapper_address: principal as *const A::Principal as usize,
            actor,
        }
    }
    pub fn prepare_stock_retained_intent_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        raw: &Value,
        original: &RetainedPrincipal,
    ) -> Result<StockRetainedPreparation>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        self.prepare_retained_source_with_authorization(b, principal, stock, raw, original)
            .map(|(preparation, _)| preparation)
    }

    // Shared first read transaction. Both public preparation APIs keep the
    // same original binding and Intake/Prepare callbacks; saved plan validation
    // and current facts are read before that transaction commits.
    pub(super) fn prepare_retained_source_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        raw: &Value,
        original: &RetainedPrincipal,
    ) -> Result<(StockRetainedPreparation, Option<SavedAtlasPlan>)>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        same_original(principal, original)?;
        if serde_json::to_vec(raw)?.len() > 4 * 1024 * 1024 {
            return Err(unavailable());
        }
        let request = ValidatedRequest::parse(stock, raw.clone()).map_err(stock_error)?;
        if request.operation().authority != stock::Authority::Atlas
            || request.operation().effect != stock::Effect::Write
        {
            return Err(Error::new(
                "invalid-contract",
                "Validated Atlas write intent is required for inspection",
            ));
        }
        let scope: Scope = serde_json::from_value(raw["context"].clone())?;
        let mut targets = targets_from_intent(&self.contract, &request)?;
        let actor = check(
            &self.contract,
            b,
            principal,
            StockRetainedReadFrame {
                phase: StockRetainedReadPhase::Intake,
                scope: &scope,
                intent: Some(&request),
                targets: &targets,
                current_records: &[],
                commit: None,
                audits: &[],
                events: &[],
                retained_commits: &[],
                output: None,
            },
        )?;
        let tx = self.db.transaction()?;
        let (commit, group, saved_plan) = lookup_with_plan(
            &tx,
            &self.contract,
            stock,
            &scope,
            &actor.actor_id,
            &request,
        )?;
        let mut audits = Vec::new();
        if let Some(commit) = &commit {
            extend_retained_targets(&self.contract, stock, commit, &mut targets)?;
            for g in &commit.groups {
                for result in &g.native_results {
                    if !targets.contains(&result.audit.record) {
                        targets.push(result.audit.record.clone());
                    }
                    audits.push(result.audit.clone());
                }
            }
        }
        let records = current_records(&tx, &self.contract, &scope, &targets)?;
        if check(
            &self.contract,
            b,
            principal,
            StockRetainedReadFrame {
                phase: StockRetainedReadPhase::Prepare,
                scope: &scope,
                intent: Some(&request),
                targets: &targets,
                current_records: &records,
                commit: commit.as_ref(),
                audits: &audits,
                events: &[],
                retained_commits: &[],
                output: None,
            },
        )? != actor
        {
            return Err(changed());
        }
        tx.commit()?;
        Ok((
            StockRetainedPreparation {
                binding: self.read_binding(principal, original, actor, b.retained_read_owner()),
                scope,
                request,
                group,
                commit,
                targets,
                current_records: records,
            },
            saved_plan,
        ))
    }
    pub fn disclose_stock_retained_intent_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        preparation: &StockRetainedPreparation,
    ) -> Result<StockRetainedInspection>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        self.disclose_retained_with_authorization(
            b,
            principal,
            stock,
            preparation,
            |inspection, _, _, _| Ok(inspection),
        )
    }
    /// Fresh read-only exact-intent resolution. Returns the original validated
    /// receipt, without executing a command, altering correlation/replay flags,
    /// or claiming the original Media release/HTTP delivery was established.
    pub fn disclose_stock_retained_committed_result_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        preparation: &StockRetainedPreparation,
    ) -> Result<StockRetainedReconciliation>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        self.disclose_retained_with_authorization(
            b,
            principal,
            stock,
            preparation,
            |inspection, commit, group, request| {
                let committed_result = commit
                    .map(|commit| -> Result<StockRetainedCommittedResult> {
                        let result = match group {
                            Some(index) => stock::OwnerResult {
                                wire: commit
                                    .children
                                    .get(index)
                                    .ok_or_else(stock_repo::incompatible)?
                                    .clone(),
                                children: Vec::new(),
                            },
                            None => commit.owner_result(),
                        };
                        let original_request_id = result.wire["requestId"]
                            .as_str()
                            .ok_or_else(stock_repo::incompatible)?
                            .to_owned();
                        Ok(StockRetainedCommittedResult {
                            original_request_id,
                            wire: result.wire,
                            children: result.children,
                            original_media_release: "not-established",
                            original_http_delivery: "not-established",
                        })
                    })
                    .transpose()?;
                Ok(StockRetainedReconciliation {
                    format: "atlas-retained-reconciliation/1",
                    lookup_request_id: request.request_id().into(),
                    inspection,
                    committed_result,
                })
            },
        )
    }
    fn disclose_retained_with_authorization<B, S, O>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        preparation: &StockRetainedPreparation,
        make_output: impl FnOnce(
            StockRetainedInspection,
            Option<&StockAtlasCommit>,
            Option<usize>,
            &ValidatedRequest,
        ) -> Result<O>,
    ) -> Result<O>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
        O: serde::Serialize,
    {
        bound(self, principal, &preparation.binding, b)?;
        let actor = check(
            &self.contract,
            b,
            principal,
            StockRetainedReadFrame {
                phase: StockRetainedReadPhase::Intake,
                scope: &preparation.scope,
                intent: Some(&preparation.request),
                targets: &preparation.targets,
                current_records: &[],
                commit: None,
                audits: &[],
                events: &[],
                retained_commits: &[],
                output: None,
            },
        )?;
        if actor != preparation.binding.actor {
            return Err(changed());
        }
        let tx = self.db.transaction()?;
        let (commit, group) = lookup(
            &tx,
            &self.contract,
            stock,
            &preparation.scope,
            &actor.actor_id,
            &preparation.request,
        )?;
        if commit != preparation.commit || group != preparation.group {
            return Err(changed());
        }
        let records = current_records(
            &tx,
            &self.contract,
            &preparation.scope,
            &preparation.targets,
        )?;
        let audits = commit
            .as_ref()
            .map(|c| {
                c.groups
                    .iter()
                    .flat_map(|g| g.native_results.iter().map(|r| r.audit.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let operation_id = commit.as_ref().map(|c| match group {
            Some(index) => c.groups[index].operation_id.clone(),
            None => c.operation_id.clone(),
        });
        let output = StockRetainedInspection {
            format: "atlas-retained-intent-inspection/1",
            resolved_scope: preparation.scope.clone(),
            coverage: "retained-atlas-stock-only",
            outcome: if commit.is_some() {
                "retained-commit"
            } else {
                "not-retained-at-snapshot"
            },
            retry_safety: "not-established",
            root_operation_id: commit.as_ref().map(|c| c.operation_id.clone()),
            operation_id,
            command_id: preparation.request.id().as_str().into(),
            request_digest: preparation.request.intent_digest().into(),
        };
        let output = make_output(output, commit.as_ref(), group, &preparation.request)?;
        let wire = serde_json::to_value(&output)?;
        for phase in [
            StockRetainedReadPhase::Disclosure,
            StockRetainedReadPhase::Release,
        ] {
            if check(
                &self.contract,
                b,
                principal,
                StockRetainedReadFrame {
                    phase,
                    scope: &preparation.scope,
                    intent: Some(&preparation.request),
                    targets: &preparation.targets,
                    current_records: &records,
                    commit: commit.as_ref(),
                    audits: &audits,
                    events: &[],
                    retained_commits: &[],
                    output: Some(&wire),
                },
            )? != actor
            {
                return Err(changed());
            }
        }
        tx.commit()?;
        Ok(output)
    }
    /// Compatibility for genuine same-principal callers. Continuation custody
    /// is checked against that supplied P; all page qualification still runs
    /// through the grouped API. Hosts needing fresh page grants use that API.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_stock_operation_events_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        original: &RetainedPrincipal,
        scope: &Scope,
        page_size: usize,
        continuation: Option<&StockRetainedContinuation>,
    ) -> Result<StockOperationEventPreparation>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        self.prepare_stock_operation_events_page_with_authorization(
            b,
            principal,
            stock,
            StockOperationEventPageInput {
                original,
                scope,
                page_size,
                continuation: continuation.map(|continuation| {
                    StockOperationEventContinuationInput {
                        continuation,
                        prior_principal: principal,
                    }
                }),
            },
        )
    }
    /// Qualify one complete selected page under its actual current principal.
    /// Prior continuation custody is checked without authorizing that old P.
    pub fn prepare_stock_operation_events_page_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        input: StockOperationEventPageInput<'_, A::Principal>,
    ) -> Result<StockOperationEventPreparation>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        let StockOperationEventPageInput {
            original,
            scope,
            page_size,
            continuation,
        } = input;
        if !(1..=100).contains(&page_size) {
            return Err(Error::new(
                "invalid-contract",
                "Operation-event page size is incompatible",
            ));
        }
        if let Some(previous) = &continuation {
            let c = previous.continuation;
            bound(self, previous.prior_principal, &c.binding, b)?;
            if &c.scope != scope || c.page_size != page_size {
                return Err(Error::new("invalid-contract", "Continuation query differs"));
            }
        }
        same_original(principal, original)?;
        let actor = check(
            &self.contract,
            b,
            principal,
            StockRetainedReadFrame {
                phase: StockRetainedReadPhase::Intake,
                scope,
                intent: None,
                targets: &[],
                current_records: &[],
                commit: None,
                audits: &[],
                events: &[],
                retained_commits: &[],
                output: None,
            },
        )?;
        let continuation = continuation.as_ref().map(|previous| previous.continuation);
        if continuation.is_some_and(|c| c.binding.actor != actor) {
            return Err(changed());
        }
        let tx = self.db.transaction()?;
        let max: i64 = tx.query_row("SELECT COALESCE(MAX(seq),0) FROM audits", [], |row| {
            row.get(0)
        })?;
        let (watermark, after) = continuation
            .map(|c| (c.watermark, c.after))
            .unwrap_or((max, 0));
        if watermark > max {
            return Err(stock_repo::incompatible());
        }
        let (snapshot, records) = snapshot_rows(
            &tx,
            &self.contract,
            stock,
            scope,
            watermark,
            after,
            page_size,
        )?;
        let events = snapshot
            .rows
            .iter()
            .map(|(_, e)| e.clone())
            .collect::<Vec<_>>();
        if check(
            &self.contract,
            b,
            principal,
            StockRetainedReadFrame {
                phase: StockRetainedReadPhase::Prepare,
                scope,
                intent: None,
                targets: &snapshot.targets,
                current_records: &records,
                commit: None,
                audits: &snapshot.audits,
                events: &events,
                retained_commits: &snapshot.retained_commits,
                output: None,
            },
        )? != actor
        {
            return Err(changed());
        }
        tx.commit()?;
        Ok(StockOperationEventPreparation {
            binding: self.read_binding(principal, original, actor, b.retained_read_owner()),
            scope: scope.clone(),
            page_size,
            watermark,
            after,
            snapshot: Arc::new(snapshot),
            current_records: records,
        })
    }
    pub fn disclose_stock_operation_events_with_authorization<B, S>(
        &mut self,
        b: &B,
        principal: &A::Principal,
        stock: &S,
        preparation: &StockOperationEventPreparation,
    ) -> Result<StockOperationEvents>
    where
        B: StockRetainedReadAuthorization<Principal = A::Principal>,
        S: StockContractPort,
        A::Principal: StagedUploadPrincipal,
    {
        bound(self, principal, &preparation.binding, b)?;
        let actor = check(
            &self.contract,
            b,
            principal,
            StockRetainedReadFrame {
                phase: StockRetainedReadPhase::Intake,
                scope: &preparation.scope,
                intent: None,
                targets: &preparation.snapshot.targets,
                current_records: &[],
                commit: None,
                audits: &[],
                events: &[],
                retained_commits: &[],
                output: None,
            },
        )?;
        if actor != preparation.binding.actor {
            return Err(changed());
        }
        let tx = self.db.transaction()?;
        let (actual_snapshot, records) = snapshot_rows(
            &tx,
            &self.contract,
            stock,
            &preparation.scope,
            preparation.watermark,
            preparation.after,
            preparation.page_size,
        )?;
        if actual_snapshot != *preparation.snapshot || records != preparation.current_records {
            return Err(changed());
        }
        let snapshot = &preparation.snapshot;
        let rows = &snapshot.rows;
        let audits = &snapshot.audits;
        let targets = &snapshot.targets;
        let next_after = if rows.len() > preparation.page_size {
            Some(rows[preparation.page_size - 1].0)
        } else if snapshot.more_unscanned {
            Some(snapshot.scan_end)
        } else {
            None
        };
        let next = if let Some(after) = next_after {
            let id = self.runtime.new_id()?;
            shape(
                &self.contract,
                "recordRef",
                &RecordRef {
                    record_type: RecordType::Identity,
                    record_id: id.clone(),
                },
            )?;
            Some((id, after))
        } else {
            None
        };
        let output = StockOperationEventPage {
            format: "atlas-operation-events/1",
            resolved_scope: preparation.scope.clone(),
            coverage: "retained-atlas-stock-only",
            completeness: "partial",
            order: "audit-sequence-ascending",
            entries: rows
                .iter()
                .take(preparation.page_size)
                .map(|(_, e)| e.clone())
                .collect(),
            next_cursor: next.as_ref().map(|(id, _)| id.clone()),
        };
        let events = rows.iter().map(|(_, e)| e.clone()).collect::<Vec<_>>();
        let wire = serde_json::to_value(&output)?;
        for phase in [
            StockRetainedReadPhase::Disclosure,
            StockRetainedReadPhase::Release,
        ] {
            if check(
                &self.contract,
                b,
                principal,
                StockRetainedReadFrame {
                    phase,
                    scope: &preparation.scope,
                    intent: None,
                    targets,
                    current_records: &records,
                    commit: None,
                    audits,
                    events: &events,
                    retained_commits: &snapshot.retained_commits,
                    output: Some(&wire),
                },
            )? != actor
            {
                return Err(changed());
            }
        }
        tx.commit()?;
        let continuation = next.map(|(id, after)| StockRetainedContinuation {
            binding: self.read_binding(
                principal,
                &preparation.binding.principal,
                actor,
                b.retained_read_owner(),
            ),
            id,
            scope: preparation.scope.clone(),
            page_size: preparation.page_size,
            watermark: preparation.watermark,
            after,
        });
        Ok(StockOperationEvents {
            page: output,
            continuation,
        })
    }
}
