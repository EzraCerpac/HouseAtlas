//! Actor/scope/query-bound cursors over bounded immutable audit pages.
use super::super::{
    repository as repo, stock_history_repository as history_repo, stock_repository as stock_repo, *,
};
use super::stock::stock_error;
use super::{AtlasStore, authorize, read_request, shape};
use crate::domain::stock::{OwnerResult, StockContractPort, ValidatedRequest};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::collections::BTreeSet;

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn stock_history_json_with_authorization<B, S>(
        &mut self,
        authorization: &B,
        principal: &A::Principal,
        contracts: &S,
        raw: &Value,
    ) -> Result<OwnerResult>
    where
        B: StockAuthorization<Principal = A::Principal>,
        S: StockContractPort,
    {
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        if !request.id().as_str().starts_with("atlas.")
            || !request.id().as_str().ends_with(".history")
            || request.target()["authority"] != "atlas"
        {
            return Err(Error::new(
                "invalid-contract",
                "Atlas history request is required",
            ));
        }
        let scope: Scope = serde_json::from_value(raw["context"].clone())?;
        let target: RecordRef = serde_json::from_value(
            json!({"recordType":request.target()["recordType"],"recordId":request.target()["recordId"]}),
        )?;
        shape(&self.contract, "scope", &scope)?;
        shape(&self.contract, "recordRef", &target)?;
        let page_size = usize::try_from(
            super::super::numeric::safe_integer(&raw["payload"]["pageSize"]).ok_or(Error::new(
                "invalid-contract",
                "History page size is incompatible",
            ))?,
        )
        .map_err(|_| Error::new("invalid-contract", "History page size is incompatible"))?;
        if !(1..=100).contains(&page_size) {
            return Err(Error::new(
                "invalid-contract",
                "History page size is incompatible",
            ));
        }
        let mut query = raw["payload"].clone();
        query
            .as_object_mut()
            .ok_or_else(stock_repo::incompatible)?
            .remove("cursor");
        let query =
            json!({"commandId":request.id().as_str(),"target":request.target(),"payload":query});
        let query_json = self.contract.canonical_json(&query)?;
        let check_history =
            |audits: &[Audit], result: Option<&OwnerResult>| -> Result<VerifiedActor> {
                let native = authorize(
                    &self.contract,
                    authorization,
                    principal,
                    read_request(
                        &scope,
                        Capability::ReadHistory,
                        std::slice::from_ref(&target),
                    ),
                )?;
                let stock = authorization.authorize_stock_history(
                    principal,
                    StockHistoryFrame {
                        request: raw,
                        scope: &scope,
                        target: &target,
                        audits,
                        result,
                    },
                )?;
                if native != stock {
                    return Err(Error::new(
                        "unauthenticated",
                        "Verified history principal changed",
                    ));
                }
                Ok(native)
            };
        let actor = check_history(&[], None)?;
        // No write admission while reading/validating. SQLite's WAL snapshot
        // supplies one immutable watermark; any continuation is inserted later.
        let tx = self.db.transaction()?;
        repo::read_record(&tx, &scope, &target)?;
        let (watermark, after): (i64, i64) = if let Some(cursor) = raw["payload"]["cursor"].as_str()
        {
            tx.query_row("SELECT watermark,after_seq FROM stock_history_cursors WHERE cursor_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4 AND query_json=?5 AND codec_version=1",params![cursor,scope.workspace_id,scope.home_id,actor.actor_id,query_json],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or(Error::new("invalid-contract","History cursor does not match the authorized query"))?
        } else {
            (
                tx.query_row("SELECT COALESCE(MAX(seq),0) FROM audits", [], |r| r.get(0))?,
                0,
            )
        };
        if after < 0 || watermark < after {
            return Err(stock_repo::incompatible());
        }
        history_repo::assert_coverage(&tx, &scope, &target, watermark)?;
        let q = raw["payload"].get("q").and_then(Value::as_str);
        let sequences = history_repo::page_sequences(
            &tx,
            &history_repo::PageQuery {
                scope: &scope,
                target: &target,
                watermark,
                after,
                page_size,
                q,
            },
        )?;
        let mut audits = Vec::with_capacity(sequences.len());
        let mut entries = Vec::with_capacity(sequences.len());
        let mut validated_roots = BTreeSet::new();
        for seq in sequences {
            let (sql_id, body): (String, String) = tx.query_row(
                "SELECT audit_id,body FROM audits WHERE seq=?1 AND workspace_id=?2 AND home_id=?3 AND record_id=?4",
                params![seq,scope.workspace_id,scope.home_id,target.record_id], |row| Ok((row.get(0)?,row.get(1)?)))?;
            let audit: Audit = serde_json::from_str(&body)?;
            shape(&self.contract, "audit", &audit)?;
            if audit.audit_id != sql_id
                || audit.workspace_id != scope.workspace_id
                || audit.home_id != scope.home_id
                || audit.record != target
            {
                return Err(stock_repo::incompatible());
            }
            let (root, command, event): (String, String, String) = tx.query_row(
                "SELECT root_operation_id,command_id,event_json FROM stock_audit_links WHERE audit_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4",
                params![audit.audit_id,scope.workspace_id,scope.home_id,audit.actor_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?
                ;
            if validated_roots.insert((audit.actor_id.clone(), root.clone())) {
                let commit = stock_repo::load(&tx, &self.contract, &scope, &audit.actor_id, &root)?;
                super::super::stock_projection::validate_retained(
                    &tx,
                    &commit,
                    contracts,
                    &self.contract,
                )?;
            }
            let event: Value = serde_json::from_str(&event)?;
            if event["commandId"] != command
                || event["eventId"] != audit.audit_id
                || !q.is_none_or(|q| command.contains(q) || "committed".contains(q))
            {
                return Err(stock_repo::incompatible());
            }
            entries.push((seq, event));
            audits.push(audit);
        }
        let has_more = entries.len() > page_size;
        entries.truncate(page_size);
        let next = if has_more {
            let id = self.runtime.new_id()?;
            shape(
                &self.contract,
                "recordRef",
                &RecordRef {
                    record_type: RecordType::Identity,
                    record_id: id.clone(),
                },
            )?;
            Some((id, entries.last().ok_or_else(stock_repo::incompatible)?.0))
        } else {
            None
        };
        let output = OwnerResult {
            wire: json!({"schemaVersion":3,"commandId":request.id().as_str(),"requestId":request.request_id(),
            "resolvedScope":request.context(),"status":"read","replayed":false,
            "data":{"entries":entries.into_iter().map(|(_,event)|event).collect::<Vec<_>>(),
                "nextCursor":next.as_ref().map(|(id,_)|id),"completeness":"atlas-owned-audit"}}),
            children: Vec::new(),
        };
        contracts
            .validate(request.operation().output_schema, &output.wire)
            .map_err(stock_error)?;
        if check_history(&audits, Some(&output))? != actor {
            return Err(Error::new(
                "unauthenticated",
                "Verified history principal changed",
            ));
        }
        tx.commit()?;
        if let Some((id, last)) = next {
            // Avoid a read-to-write upgrade. Immutable retained rows and the
            // fixed watermark survive the gap; recheck the original authority.
            let tx = self
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            if check_history(&audits, Some(&output))? != actor {
                return Err(Error::new(
                    "unauthenticated",
                    "Verified history principal changed",
                ));
            }
            tx.execute(
                "INSERT INTO stock_history_cursors VALUES(?1,?2,?3,?4,?5,?6,?7,1)",
                params![
                    id,
                    scope.workspace_id,
                    scope.home_id,
                    actor.actor_id,
                    query_json,
                    watermark,
                    last
                ],
            )?;
            if check_history(&audits, Some(&output))? != actor {
                return Err(Error::new(
                    "unauthenticated",
                    "Verified history principal changed",
                ));
            }
            tx.commit()?;
        }
        if check_history(&audits, Some(&output))? != actor {
            return Err(Error::new(
                "unauthenticated",
                "Verified history principal changed",
            ));
        }
        Ok(output)
    }
}
