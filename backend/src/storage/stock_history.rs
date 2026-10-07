//! Actor/scope/query-bound history cursors over immutable audit sequence rows.
use super::super::{stock_repository as stock_repo, *};
use super::stock::stock_error;
use super::{AtlasStore, authorize, read_request, shape};
use crate::domain::stock::{OwnerResult, StockContractPort, ValidatedRequest};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};

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
        let mut query = raw["payload"].clone();
        query
            .as_object_mut()
            .ok_or_else(stock_repo::incompatible)?
            .remove("cursor");
        let query =
            json!({"commandId":request.id().as_str(),"target":request.target(),"payload":query});
        let query_json = self.contract.canonical_json(&query)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actor = authorize(
            &self.contract,
            authorization,
            principal,
            read_request(
                &scope,
                Capability::ReadHistory,
                std::slice::from_ref(&target),
            ),
        )?;
        let intake = authorization.authorize_stock_history(
            principal,
            StockHistoryFrame {
                request: raw,
                scope: &scope,
                target: &target,
                audits: &[],
                result: None,
            },
        )?;
        if intake != actor {
            return Err(Error::new(
                "unauthenticated",
                "Verified history principal changed",
            ));
        }
        let (watermark, after): (i64, i64) = if let Some(cursor) = raw["payload"]["cursor"].as_str()
        {
            tx.query_row("SELECT watermark,after_seq FROM stock_history_cursors WHERE cursor_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4 AND query_json=?5 AND codec_version=1",params![cursor,scope.workspace_id,scope.home_id,actor.actor_id,query_json],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or(Error::new("invalid-contract","History cursor does not match the authorized query"))?
        } else {
            (
                tx.query_row("SELECT COALESCE(MAX(seq),0) FROM audits", [], |r| r.get(0))?,
                0,
            )
        };
        let rows=tx.prepare("SELECT seq,body FROM audits WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND seq<=?4 ORDER BY seq")?.query_map(params![scope.workspace_id,scope.home_id,target.record_id,watermark],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut audits = Vec::with_capacity(rows.len());
        let mut entries = Vec::new();
        let q = raw["payload"].get("q").and_then(Value::as_str);
        for (seq, body) in rows {
            let audit: Audit = serde_json::from_str(&body)?;
            shape(&self.contract, "audit", &audit)?;
            if audit.workspace_id != scope.workspace_id
                || audit.home_id != scope.home_id
                || audit.record != target
            {
                return Err(stock_repo::incompatible());
            }
            // Verify linkage before search/paging; never silently hide native
            // prehistory while claiming complete stock-owned audit history.
            let (root, event): (String, String) = tx
                .query_row(
                    "SELECT root_operation_id,event_json FROM stock_audit_links WHERE audit_id=?1",
                    [&audit.audit_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .ok_or(Error::new(
                    "upstream-unavailable",
                    "Original stock audit linkage is unavailable",
                ))?;
            let commit = stock_repo::load(&tx, &self.contract, &scope, &audit.actor_id, &root)?;
            let original = ValidatedRequest::parse(contracts, commit.original_request.clone())
                .map_err(stock_error)?;
            if original.intent_digest() != commit.request_digest {
                return Err(stock_repo::incompatible());
            }
            let event: Value = serde_json::from_str(&event)?;
            let matches = q.is_none_or(|q| {
                event["commandId"].as_str().is_some_and(|v| v.contains(q))
                    || event["state"].as_str().is_some_and(|v| v.contains(q))
            });
            if seq > after && matches {
                entries.push((seq, event));
            }
            audits.push(audit);
        }
        let page_size = raw["payload"]["pageSize"]
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
            .ok_or(Error::new(
                "invalid-contract",
                "History page size is incompatible",
            ))?;
        if page_size == 0 {
            return Err(Error::new(
                "invalid-contract",
                "History page size is incompatible",
            ));
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
            let last = entries.last().ok_or_else(stock_repo::incompatible)?.0;
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
            Some(id)
        } else {
            None
        };
        let output = OwnerResult {
            wire: json!({"schemaVersion":3,"commandId":request.id().as_str(),"requestId":request.request_id(),
            "resolvedScope":request.context(),"status":"read","replayed":false,
            "data":{"entries":entries.into_iter().map(|(_,event)|event).collect::<Vec<_>>(),"nextCursor":next,"completeness":"atlas-owned-audit"}}),
            children: Vec::new(),
        };
        contracts
            .validate(request.operation().output_schema, &output.wire)
            .map_err(stock_error)?;
        let verified = authorize(
            &self.contract,
            authorization,
            principal,
            read_request(
                &scope,
                Capability::ReadHistory,
                std::slice::from_ref(&target),
            ),
        )?;
        let released = authorization.authorize_stock_history(
            principal,
            StockHistoryFrame {
                request: raw,
                scope: &scope,
                target: &target,
                audits: &audits,
                result: Some(&output),
            },
        )?;
        if verified != actor || released != actor {
            return Err(Error::new(
                "unauthenticated",
                "Verified history principal changed",
            ));
        }
        tx.commit()?;
        Ok(output)
    }
}
