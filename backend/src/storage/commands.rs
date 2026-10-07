//! Command transaction and durable receipt orchestration.
use super::super::command_extension::{CommandExtension, Core};
use super::super::{
    context::{self, ContextInput},
    repository as repo,
    repository::ReceiptKind,
    *,
};
use super::{AtlasStore, authorize, shape};
use rusqlite::{Connection, TransactionBehavior};
use serde_json::{Value, json};
use std::collections::BTreeSet;

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn execute(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &Mutation,
    ) -> Result<MutationResult> {
        self.commands().execute(principal, scope, target, command)
    }
    /// Validate raw JSON before constructing the typed command carrier.
    /// The ingress parser must already have rejected duplicate object keys.
    pub fn execute_json(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &Value,
    ) -> Result<MutationResult> {
        self.commands()
            .execute_json(principal, scope, target, command)
    }
    pub fn execute_batch_json(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        batch: &Value,
    ) -> Result<BatchResult> {
        self.commands().execute_batch_json(principal, scope, batch)
    }
    pub fn execute_batch(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        batch: &BatchMutation,
    ) -> Result<BatchResult> {
        self.commands().execute_batch(principal, scope, batch)
    }

    /// Use one synchronous, borrowed authorizer for every transaction phase.
    /// It may retain the original authority handles across those phases.
    pub fn execute_json_with_authorization<B: Authorization<Principal = A::Principal>>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &Value,
    ) -> Result<MutationResult> {
        self.commands_with_authorization(authorization)
            .execute_json(principal, scope, target, command)
    }
    pub fn execute_batch_json_with_authorization<B: Authorization<Principal = A::Principal>>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        scope: &Scope,
        batch: &Value,
    ) -> Result<BatchResult> {
        self.commands_with_authorization(authorization)
            .execute_batch_json(principal, scope, batch)
    }

    fn commands(&mut self) -> CommandTransaction<'_, C, A, R> {
        CommandTransaction {
            db: &mut self.db,
            contract: &self.contract,
            authorization: &self.authorization,
            runtime: &self.runtime,
        }
    }
    fn commands_with_authorization<'a, B: Authorization<Principal = A::Principal>>(
        &'a mut self,
        authorization: &'a B,
    ) -> CommandTransaction<'a, C, B, R> {
        CommandTransaction {
            db: &mut self.db,
            contract: &self.contract,
            authorization,
            runtime: &self.runtime,
        }
    }
}

/// A borrowed view of the store's private connection and required peers.
/// Default and per-call authorization share exactly this transaction engine.
pub(super) struct CommandTransaction<'a, C, A, R> {
    pub(super) db: &'a mut Connection,
    pub(super) contract: &'a C,
    pub(super) authorization: &'a A,
    pub(super) runtime: &'a R,
}
impl<C: Contract, A: Authorization, R: Runtime> CommandTransaction<'_, C, A, R> {
    fn execute(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &Mutation,
    ) -> Result<MutationResult> {
        shape(self.contract, "recordRef", target)?;
        shape(self.contract, "mutation", command)?;
        self.execute_entries(
            principal,
            scope,
            &[MutationEntry {
                target: target.clone(),
                command: command.clone(),
            }],
            None,
            &mut Core,
        )?
        .pop()
        .ok_or(Error::new(
            "schema-incompatible",
            "Mutation result is missing",
        ))
    }
    /// Validate the complete raw command before constructing its typed carrier.
    /// The HTTP parser must already have rejected duplicate object keys.
    fn execute_json(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &Value,
    ) -> Result<MutationResult> {
        self.contract.validate_shape("mutation", command)?;
        self.execute(
            principal,
            scope,
            target,
            &serde_json::from_value(command.clone())?,
        )
    }
    fn execute_batch_json(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        batch: &Value,
    ) -> Result<BatchResult> {
        self.contract.validate_shape("batchMutation", batch)?;
        self.execute_batch(principal, scope, &serde_json::from_value(batch.clone())?)
    }
    fn execute_batch(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        batch: &BatchMutation,
    ) -> Result<BatchResult> {
        shape(self.contract, "batchMutation", batch)?;
        let results =
            self.execute_entries(principal, scope, &batch.commands, Some(batch), &mut Core)?;
        // execute_entries validates this exact envelope before committing.
        Ok(batch_result(batch, results))
    }

    pub(super) fn execute_entries(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        entries: &[MutationEntry],
        batch: Option<&BatchMutation>,
        extension: &mut dyn CommandExtension,
    ) -> Result<Vec<MutationResult>> {
        shape(self.contract, "scope", scope)?;
        if entries.is_empty() || entries.len() > 100 {
            return Err(Error::new(
                "invalid-contract",
                "Batch size must be between one and one hundred",
            ));
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let original = repo::snapshot(&tx)?;
        let partitions = repo::cache_partitions(&tx, scope)?;
        let context_id = self.runtime.new_id()?;
        shape(
            self.contract,
            "recordRef",
            &RecordRef {
                record_type: RecordType::Identity,
                record_id: context_id.clone(),
            },
        )?;
        let targets: Vec<_> = entries.iter().map(|e| e.target.clone()).collect();
        let context = |phase, candidate: Option<&Snapshot>, replay: Option<&Replay>| {
            context::build(
                self.contract,
                ContextInput {
                    context_id: &context_id,
                    phase,
                    scope,
                    entries,
                    batch,
                    original: &original,
                    cache_partitions: &partitions,
                    candidate,
                    replay,
                },
            )
        };
        // Auth always precedes receipt lookup and CAS/precondition disclosure.
        let intake = context(MutationPhase::Intake, None, None)?;
        let actor = authorize(
            self.contract,
            self.authorization,
            principal,
            AuthorizationRequest {
                scope,
                capability: Capability::Mutate,
                targets: &targets,
                source: None,
                source_partition: None,
                mutation: Some(&intake),
            },
        )?;
        extension.authorize(&intake, &original, None, None, &actor)?;
        let revalidate = |phase: MutationPhase,
                          candidate: Option<&Snapshot>,
                          replay: Option<&Replay>,
                          extension: &mut dyn CommandExtension|
         -> Result<()> {
            let facts = context(phase, candidate, replay)?;
            let verified = authorize(
                self.contract,
                self.authorization,
                principal,
                AuthorizationRequest {
                    scope,
                    capability: Capability::Mutate,
                    targets: &targets,
                    source: None,
                    source_partition: None,
                    mutation: Some(&facts),
                },
            )?;
            if verified != actor {
                return Err(Error::new(
                    "unauthenticated",
                    "Verified principal changed during transaction",
                ));
            }
            extension.authorize(&facts, &original, candidate, replay, &actor)?;
            Ok(())
        };
        let ids: BTreeSet<_> = entries.iter().map(|e| &e.command.mutation_id).collect();
        let target_keys: BTreeSet<_> = entries
            .iter()
            .map(|e| (e.target.record_type.as_str(), &e.target.record_id))
            .collect();
        if ids.len() != entries.len() || target_keys.len() != entries.len() {
            return Err(Error::new(
                "invalid-contract",
                "Batch targets and mutation IDs must be unique",
            ));
        }
        let batch_hash = batch
            .map(|batch| {
                let mut value = serde_json::to_value(batch)?;
                value
                    .as_object_mut()
                    .ok_or(Error::new("invalid-contract", "Batch envelope is required"))?
                    .insert("scope".into(), serde_json::to_value(scope)?);
                repo::digest(self.contract, &value)
            })
            .transpose()?;
        let replay_results = |mut results: Vec<MutationResult>,
                              extension: &mut dyn CommandExtension|
         -> Result<Vec<MutationResult>> {
            if results.len() != entries.len() {
                return Err(Error::new(
                    "schema-incompatible",
                    "Ordered mutation receipt is incompatible",
                ));
            }
            for (result, entry) in results.iter_mut().zip(entries) {
                result.replayed = true;
                self.contract.validate_result(result, Prior::Unspecified)?;
                let audit = &result.audit;
                if !result.record.matches(scope, &entry.target)
                    || audit.workspace_id != scope.workspace_id
                    || audit.home_id != scope.home_id
                    || audit.actor_id != actor.actor_id
                    || audit.mutation_id != entry.command.mutation_id
                    || audit.operation != entry.command.operation
                    || audit.previous_revision != entry.command.expected_revision
                    || audit.reason != entry.command.reason
                {
                    return Err(Error::new(
                        "schema-incompatible",
                        "Scoped mutation receipt is incompatible",
                    ));
                }
                if let Some(value) = &entry.command.value
                    && self.contract.canonical_json(&value.payload)?
                        != self.contract.canonical_json(&result.record.payload)?
                {
                    return Err(Error::new(
                        "schema-incompatible",
                        "Scoped mutation receipt is incompatible",
                    ));
                }
            }
            if let Some(batch) = batch {
                shape(
                    self.contract,
                    "batchResult",
                    &batch_result(batch, results.clone()),
                )?;
            }
            let replay = Replay {
                results: results.clone(),
            };
            revalidate(MutationPhase::Replay, None, Some(&replay), extension)?;
            revalidate(
                MutationPhase::ReplayPrecommit,
                None,
                Some(&replay),
                extension,
            )?;
            Ok(results)
        };
        if !extension.stock() {
            super::super::stock_repository::assert_core_keys_free(
                &tx,
                scope,
                &actor.actor_id,
                entries,
                batch,
            )?;
        }
        if let Some(retained) = extension.admit(&tx, &actor)? {
            let result = replay_results(retained, extension)?;
            tx.commit()?;
            return Ok(result);
        }
        if let Some(batch) = batch
            && let Some(receipt) = repo::receipt(
                &tx,
                ReceiptKind::Batch,
                scope,
                &actor.actor_id,
                &batch.batch_id,
            )?
        {
            if extension.stock() {
                return Err(super::super::stock_repository::conflict());
            }
            if Some(&receipt.hash) != batch_hash.as_ref() {
                return Err(Error::new(
                    "idempotency-conflict",
                    "Batch ID already binds another ordered envelope",
                ));
            }
            let result = replay_results(serde_json::from_str(&receipt.body)?, extension)?;
            tx.commit()?;
            return Ok(result);
        }
        let hashes = entries.iter().map(|e| repo::digest(self.contract,&json!({
            "target":ScopedTarget::new(scope,&e.target),"command":e.command,"batchId":batch.map(|b| &b.batch_id),"batchHash":batch_hash }))).collect::<Result<Vec<_>>>()?;
        let receipts = entries
            .iter()
            .map(|e| {
                repo::receipt(
                    &tx,
                    ReceiptKind::Command,
                    scope,
                    &actor.actor_id,
                    &e.command.mutation_id,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        if receipts.iter().any(Option::is_some) {
            if extension.stock() {
                return Err(super::super::stock_repository::conflict());
            }
            if batch.is_some()
                || receipts
                    .iter()
                    .zip(&hashes)
                    .any(|(r, h)| r.as_ref().is_none_or(|r| r.hash != *h))
            {
                return Err(Error::new(
                    "idempotency-conflict",
                    "Mutation receipt belongs to another payload or batch",
                ));
            }
            let results = receipts
                .iter()
                .map(|r| {
                    serde_json::from_str(
                        &r.as_ref()
                            .ok_or(Error::new("schema-incompatible", "Receipt is missing"))?
                            .body,
                    )
                    .map_err(Error::from)
                })
                .collect::<Result<Vec<MutationResult>>>()?;
            let result = replay_results(results, extension)?;
            tx.commit()?;
            return Ok(result);
        }
        revalidate(MutationPhase::Validate, None, None, extension)?;
        extension.validate_original(&original)?;
        let mut candidate = original.clone();
        let mut results = Vec::with_capacity(entries.len());
        let created: Vec<_> = entries
            .iter()
            .filter(|e| e.command.operation == Operation::Create)
            .map(|e| ScopedTarget::new(scope, &e.target))
            .collect();
        let now = self.runtime.now()?;
        for entry in entries {
            let current = original
                .records
                .iter()
                .find(|r| r.matches(scope, &entry.target));
            let target = ScopedTarget::new(scope, &entry.target);
            let next_revision =
                self.contract
                    .assert_transition(current, &entry.command, &target)?;
            self.contract
                .assert_guards(&original, current, &entry.command, &target, &created)?;
            if next_revision == 0
                || next_revision > MAX_REVISION
                || next_revision != current.map_or(1, |r| r.revision + 1)
            {
                return Err(Error::new(
                    "invalid-transition",
                    "Contract returned an incompatible revision",
                ));
            }
            let audit_id = self.runtime.new_id()?;
            let payload = entry
                .command
                .value
                .as_ref()
                .map(|v| &v.payload)
                .or(current.map(|r| &r.payload))
                .ok_or(Error::new(
                    "invalid-contract",
                    "Mutation payload is required",
                ))?
                .clone();
            let record = Record {
                schema_version: 1,
                workspace_id: scope.workspace_id.clone(),
                home_id: scope.home_id.clone(),
                record_type: entry.target.record_type,
                record_id: entry.target.record_id.clone(),
                revision: next_revision,
                lifecycle: if entry.command.operation == Operation::Tombstone {
                    Lifecycle::Tombstoned
                } else {
                    Lifecycle::Active
                },
                created_at: current.map_or_else(|| now.clone(), |r| r.created_at.clone()),
                updated_at: now.clone(),
                last_audit_id: audit_id.clone(),
                payload,
            };
            let audit = Audit {
                schema_version: 1,
                audit_id,
                workspace_id: scope.workspace_id.clone(),
                home_id: scope.home_id.clone(),
                record: entry.target.clone(),
                operation: entry.command.operation,
                previous_revision: current.map(|r| r.revision),
                result_revision: next_revision,
                actor_id: actor.actor_id.clone(),
                at: now.clone(),
                reason: entry.command.reason.clone(),
                mutation_id: entry.command.mutation_id.clone(),
                before_digest: current
                    .map(|r| repo::digest(self.contract, r))
                    .transpose()?,
                after_digest: repo::digest(self.contract, &record)?,
            };
            let result = MutationResult {
                schema_version: 1,
                record,
                audit,
                replayed: false,
            };
            self.contract
                .validate_result(&result, current.map_or(Prior::Missing, Prior::Record))?;
            if let Some(index) = candidate
                .records
                .iter()
                .position(|r| r.matches(scope, &entry.target))
            {
                candidate.records[index] = result.record.clone();
            } else {
                candidate.records.push(result.record.clone());
            }
            results.push(result);
        }
        self.contract.validate_snapshot(&candidate)?;
        for entry in entries {
            self.contract.assert_final_mutation(
                &candidate,
                original
                    .records
                    .iter()
                    .find(|r| r.matches(scope, &entry.target)),
                &entry.command,
                &ScopedTarget::new(scope, &entry.target),
            )?;
        }
        if let Some(batch) = batch {
            // Full output bounds and correlations participate in the same
            // transaction as every record, audit, and receipt write.
            shape(
                self.contract,
                "batchResult",
                &batch_result(batch, results.clone()),
            )?;
        }
        extension.stage(&original, &results, &actor)?;
        revalidate(MutationPhase::Candidate, Some(&candidate), None, extension)?;
        for ((result, entry), hash) in results.iter().zip(entries).zip(&hashes) {
            repo::write_record(
                &tx,
                self.contract,
                self.runtime,
                &result.record,
                original
                    .records
                    .iter()
                    .find(|r| r.matches(scope, &entry.target)),
            )?;
            repo::write_audit(&tx, self.contract, &result.audit)?;
            repo::write_receipt(
                &tx,
                ReceiptKind::Command,
                scope,
                &actor.actor_id,
                &entry.command.mutation_id,
                hash,
                &repo::json(self.contract, result)?,
            )?;
        }
        if let Some(batch) = batch {
            repo::write_receipt(
                &tx,
                ReceiptKind::Batch,
                scope,
                &actor.actor_id,
                &batch.batch_id,
                batch_hash
                    .as_deref()
                    .ok_or(Error::new("schema-incompatible", "Batch digest is missing"))?,
                &repo::json(self.contract, &results)?,
            )?;
        }
        extension.persist(&tx, &hashes)?;
        revalidate(MutationPhase::Precommit, Some(&candidate), None, extension)?;
        tx.commit()?;
        Ok(results)
    }
}

fn batch_result(batch: &BatchMutation, results: Vec<MutationResult>) -> BatchResult {
    BatchResult {
        schema_version: 1,
        batch_id: batch.batch_id.clone(),
        replayed: results.iter().all(|result| result.replayed),
        results,
    }
}
