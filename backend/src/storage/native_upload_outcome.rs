//! Request-ID lookup for a genuine retained native evidence upload batch.
//!
//! A miss is only unknown. This read never authorizes replay or retry.
use super::{
    AtlasStore, Authorization, Capability, Contract, Error, Record, RecordRef, RecordType, Result,
    Runtime, Scope, VerifiedActor, authorize, read_request, repository as repo, stock_projection,
    stock_repository as stock_repo,
};
use crate::domain::stock::{OperationId, StockContractPort, ValidatedRequest};
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};

const MAX_CANDIDATES: usize = 1_000;
const MAX_CANDIDATE_BYTES: i64 = 16 * 1024 * 1024;
const MAX_SCAN_BYTES: i64 = 32 * 1024 * 1024;

fn unavailable() -> Error {
    Error::new(
        "upstream-unavailable",
        "Retained upload lookup exceeds its read budget",
    )
}

fn incompatible() -> Error {
    stock_repo::incompatible()
}

fn shape<C: Contract, T: Serialize>(contract: &C, name: &str, value: &T) -> Result<()> {
    contract.validate_shape(name, &serde_json::to_value(value)?)
}

fn authorize_targets<C: Contract, B: Authorization>(
    contract: &C,
    authorization: &B,
    principal: &B::Principal,
    scope: &Scope,
    targets: &[RecordRef],
) -> Result<VerifiedActor> {
    for target in targets {
        shape(contract, "recordRef", target)?;
    }
    let history = authorize(
        contract,
        authorization,
        principal,
        read_request(scope, Capability::ReadHistory, targets),
    )?;
    let read = authorize(
        contract,
        authorization,
        principal,
        read_request(scope, Capability::Read, targets),
    )?;
    if history != read {
        return Err(Error::new(
            "unauthenticated",
            "Upload lookup actor changed between read checks",
        ));
    }
    Ok(history)
}

fn push_target<C: Contract>(
    contract: &C,
    targets: &mut Vec<RecordRef>,
    record_type: &Value,
    record_id: &Value,
) -> Result<()> {
    let (Some(record_type), Some(record_id)) = (record_type.as_str(), record_id.as_str()) else {
        return Err(incompatible());
    };
    let target: RecordRef =
        serde_json::from_value(json!({"recordType":record_type,"recordId":record_id}))
            .map_err(|_| incompatible())?;
    shape(contract, "recordRef", &target)?;
    if !targets.contains(&target) {
        targets.push(target);
        if targets.len() > 256 {
            return Err(unavailable());
        }
    }
    Ok(())
}

fn retained_targets<C: Contract>(
    contract: &C,
    root: &ValidatedRequest,
    result: &Value,
    place: &RecordRef,
    identity_id: &str,
    evidence_id: &str,
    asset_id: &str,
) -> Result<Vec<RecordRef>> {
    let mut targets = vec![place.clone()];
    push_target(
        contract,
        &mut targets,
        &json!("identity"),
        &json!(identity_id),
    )?;
    push_target(
        contract,
        &mut targets,
        &json!("evidence"),
        &json!(evidence_id),
    )?;
    push_target(contract, &mut targets, &json!("asset"), &json!(asset_id))?;
    for request in std::iter::once(root).chain(root.children()) {
        let target = request.target();
        if target["recordType"].is_string() {
            push_target(
                contract,
                &mut targets,
                &target["recordType"],
                &target["recordId"],
            )?;
        }
        for guard in request.raw()["preconditions"]["guards"]
            .as_array()
            .into_iter()
            .flatten()
        {
            push_target(
                contract,
                &mut targets,
                &guard["target"]["recordType"],
                &guard["target"]["recordId"],
            )?;
        }
    }
    for row in result["data"]["records"]
        .as_array()
        .ok_or_else(incompatible)?
    {
        push_target(
            contract,
            &mut targets,
            &row["target"]["recordType"],
            &row["target"]["recordId"],
        )?;
    }
    Ok(targets)
}

fn current_record<'a>(records: &'a [Record], target: &RecordRef) -> Result<&'a Record> {
    let mut found = records
        .iter()
        .filter(|record| record.reference() == *target);
    let record = found.next().ok_or_else(incompatible)?;
    if found.next().is_some() {
        return Err(incompatible());
    }
    Ok(record)
}

fn public_result_record<'a>(
    records: &'a [Value],
    record_type: &str,
    record_id: &str,
) -> Result<&'a Value> {
    let mut found = records.iter().filter(|row| {
        row["target"]["authority"] == "atlas"
            && row["target"]["recordType"] == record_type
            && row["target"]["recordId"] == record_id
    });
    let row = found.next().ok_or_else(incompatible)?;
    if found.next().is_some() {
        return Err(incompatible());
    }
    Ok(row)
}

fn scan_request_roots(
    db: &Connection,
    scope: &Scope,
    actor: &str,
    request_id: &str,
) -> Result<Option<String>> {
    let mut statement = db.prepare(
        "SELECT operation_id,
                length(CAST(original_json AS BLOB)),
                length(CAST(commit_json AS BLOB))
         FROM stock_operations
         WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND codec_version=1
         ORDER BY rowid LIMIT 1001",
    )?;
    let rows = statement
        .query_map(params![scope.workspace_id, scope.home_id, actor], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() > MAX_CANDIDATES {
        return Err(unavailable());
    }
    let mut total_bytes = 0_i64;
    for (_, original_bytes, commit_bytes) in &rows {
        let row_bytes = original_bytes
            .checked_add(*commit_bytes)
            .ok_or_else(unavailable)?;
        if *original_bytes < 0 || *commit_bytes < 0 || row_bytes > MAX_CANDIDATE_BYTES {
            return Err(unavailable());
        }
        total_bytes = total_bytes.checked_add(row_bytes).ok_or_else(unavailable)?;
        if total_bytes > MAX_SCAN_BYTES {
            return Err(unavailable());
        }
    }

    let mut matched = None;
    for (operation_id, _, _) in rows {
        let original_json: String = db.query_row(
            "SELECT original_json FROM stock_operations
             WHERE operation_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4
               AND codec_version=1",
            params![operation_id, scope.workspace_id, scope.home_id, actor],
            |row| row.get(0),
        )?;
        let original: Value = serde_json::from_str(&original_json).map_err(|_| incompatible())?;
        if original["requestId"] == request_id && matched.replace(operation_id).is_some() {
            return Err(incompatible());
        }
    }
    Ok(matched)
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Disclose a genuine committed native evidence batch by its exact root
    /// request ID. `None` means unknown, never permission to retry.
    pub fn inspect_native_upload_with_authorization<B: Authorization, S: StockContractPort>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        scope: &Scope,
        record_id: &str,
        request_id: &str,
    ) -> Result<Option<Value>> {
        if !crate::media::types::is_uuid(&scope.workspace_id)
            || !crate::media::types::is_uuid(&scope.home_id)
            || !crate::media::types::is_uuid(record_id)
            || !crate::media::types::is_uuid(request_id)
        {
            return Err(Error::new(
                "invalid-contract",
                "Canonical upload IDs required",
            ));
        }
        shape(&self.contract, "scope", scope)?;
        let place = RecordRef {
            record_type: RecordType::LocationSemantics,
            record_id: record_id.into(),
        };
        shape(&self.contract, "recordRef", &place)?;

        // Establish the actual current actor/scope authority before selecting
        // any retained root. The supplied principal is the host's live peer.
        let actor = authorize_targets(
            &self.contract,
            authorization,
            principal,
            scope,
            std::slice::from_ref(&place),
        )?;
        let tx = self.db.transaction()?;
        let Some(operation_id) = scan_request_roots(&tx, scope, &actor.actor_id, request_id)?
        else {
            if authorize_targets(
                &self.contract,
                authorization,
                principal,
                scope,
                std::slice::from_ref(&place),
            )? != actor
            {
                return Err(Error::new("unauthenticated", "Upload lookup actor changed"));
            }
            tx.commit()?;
            if authorize_targets(
                &self.contract,
                authorization,
                principal,
                scope,
                std::slice::from_ref(&place),
            )? != actor
            {
                return Err(Error::new("unauthenticated", "Upload lookup actor changed"));
            }
            return Ok(None);
        };

        stock_repo::assert_retained_read_budget(&tx, scope, &actor.actor_id, &operation_id)?;
        let commit = stock_repo::load(&tx, &self.contract, scope, &actor.actor_id, &operation_id)?;
        stock_projection::validate_retained(&tx, &commit, contracts, &self.contract)?;
        let root = ValidatedRequest::parse(contracts, commit.original_request.clone())
            .map_err(|_| incompatible())?;
        if root.id() != OperationId::AtlasBatchExecute
            || root.request_id() != request_id
            || root.context().workspace_id != scope.workspace_id
            || root.context().home_id != scope.home_id
            || root.raw()["target"]["authority"] != "atlas"
            || root.raw()["target"]["kind"] != "batch"
        {
            return Err(incompatible());
        }

        let place_row = repo::read_record(&tx, scope, &place)?;
        shape(&self.contract, "record", &place_row)?;
        if place_row.scope() != *scope
            || place_row.reference() != place
            || place_row.lifecycle != super::Lifecycle::Active
        {
            return Err(incompatible());
        }
        let identity_id = place_row.payload["atlasId"]
            .as_str()
            .ok_or_else(incompatible)?;
        if !crate::media::types::is_uuid(identity_id) {
            return Err(incompatible());
        }
        let identity = RecordRef {
            record_type: RecordType::Identity,
            record_id: identity_id.into(),
        };
        if authorize_targets(
            &self.contract,
            authorization,
            principal,
            scope,
            &[place.clone(), identity.clone()],
        )? != actor
        {
            return Err(Error::new("unauthenticated", "Upload lookup actor changed"));
        }
        let identity_row = repo::read_record(&tx, scope, &identity)?;
        shape(&self.contract, "record", &identity_row)?;
        if identity_row.scope() != *scope
            || identity_row.reference() != identity
            || identity_row.lifecycle != super::Lifecycle::Active
            || identity_row.payload["kind"] != "location"
        {
            return Err(incompatible());
        }

        let children = root.children();
        let mut evidence = None;
        let mut identity_update = None;
        let mut asset_create = None;
        for child in children {
            match child.id() {
                OperationId::AtlasEvidenceCreate if evidence.is_none() => evidence = Some(child),
                OperationId::AtlasIdentityReplace if identity_update.is_none() => {
                    identity_update = Some(child)
                }
                OperationId::AtlasAssetCreate if asset_create.is_none() => {
                    asset_create = Some(child)
                }
                _ => return Err(incompatible()),
            }
        }
        let evidence = evidence.ok_or_else(incompatible)?;
        let identity_update = identity_update.ok_or_else(incompatible)?;
        if children.len() != 2 + usize::from(asset_create.is_some())
            || identity_update.target()["recordId"] != identity_id
        {
            return Err(incompatible());
        }
        let evidence_id = evidence.target()["recordId"]
            .as_str()
            .ok_or_else(incompatible)?;
        let references = evidence.raw()["payload"]["references"]
            .as_array()
            .ok_or_else(incompatible)?;
        if references.len() != 1 || references[0]["kind"] != "atlas-asset" {
            return Err(incompatible());
        }
        let asset_id = references[0]["assetId"].as_str().ok_or_else(incompatible)?;
        if !crate::media::types::is_uuid(asset_id)
            || !identity_update.raw()["payload"]["evidenceIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(evidence_id)))
        {
            return Err(incompatible());
        }
        if let Some(asset_child) = asset_create
            && asset_child.target()["recordId"] != asset_id
        {
            return Err(incompatible());
        }
        let root_guards = root.raw()["preconditions"]["guards"]
            .as_array()
            .ok_or_else(incompatible)?;
        if !root_guards.iter().any(|guard| {
            guard["target"]["authority"] == "atlas"
                && guard["target"]["recordType"] == "location-semantics"
                && guard["target"]["recordId"] == record_id
        }) {
            return Err(incompatible());
        }

        let result = commit.owner_result().wire;
        contracts
            .validate(root.operation().output_schema, &result)
            .map_err(|_| incompatible())?;
        if result["commandId"] != "atlas.batch.execute"
            || result["requestId"] != request_id
            || result["resolvedScope"]["workspaceId"] != scope.workspace_id
            || result["resolvedScope"]["homeId"] != scope.home_id
        {
            return Err(incompatible());
        }
        let result_records = result["data"]["records"]
            .as_array()
            .ok_or_else(incompatible)?;
        let evidence_result = public_result_record(result_records, "evidence", evidence_id)?;
        let identity_result = public_result_record(result_records, "identity", identity_id)?;
        let expected_identity_revision = identity_update.raw()["preconditions"]["target"]["value"]
            .as_u64()
            .ok_or_else(incompatible)?;
        if evidence_result["lifecycle"] != "active"
            || evidence_result["revision"] != 1
            || evidence_result["payload"] != evidence.raw()["payload"]
            || identity_result["payload"] != identity_update.raw()["payload"]
            || identity_result["lifecycle"] != "active"
            || identity_result["revision"].as_u64() != expected_identity_revision.checked_add(1)
        {
            return Err(incompatible());
        }
        if asset_create.is_some() {
            let asset_result = public_result_record(result_records, "asset", asset_id)?;
            if asset_result["payload"]["owner"] != "atlas"
                || asset_result["payload"]["purpose"] != "evidence-original"
            {
                return Err(incompatible());
            }
        }

        let targets = retained_targets(
            &self.contract,
            &root,
            &result,
            &place,
            identity_id,
            evidence_id,
            asset_id,
        )?;
        if authorize_targets(&self.contract, authorization, principal, scope, &targets)? != actor {
            return Err(Error::new("unauthenticated", "Upload lookup actor changed"));
        }
        let mut records = Vec::with_capacity(targets.len());
        for target in &targets {
            let record = repo::read_record(&tx, scope, target)?;
            shape(&self.contract, "record", &record)?;
            if record.scope() != *scope || record.reference() != *target {
                return Err(incompatible());
            }
            records.push(record);
        }
        let current_place = current_record(&records, &place)?;
        let current_identity = current_record(&records, &identity)?;
        let asset = RecordRef {
            record_type: RecordType::Asset,
            record_id: asset_id.into(),
        };
        let current_asset = current_record(&records, &asset)?;
        if current_place.lifecycle != super::Lifecycle::Active
            || current_place.payload["atlasId"] != identity_id
            || current_identity.lifecycle != super::Lifecycle::Active
            || current_identity.payload["kind"] != "location"
            || !current_identity.payload["evidenceIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(evidence_id)))
            || current_asset.payload["owner"] != "atlas"
            || current_asset.payload["purpose"] != "evidence-original"
        {
            return Err(incompatible());
        }
        if authorize_targets(&self.contract, authorization, principal, scope, &targets)? != actor {
            return Err(Error::new("unauthenticated", "Upload lookup actor changed"));
        }
        tx.commit()?;
        if authorize_targets(&self.contract, authorization, principal, scope, &targets)? != actor {
            return Err(Error::new("unauthenticated", "Upload lookup actor changed"));
        }
        Ok(Some(result))
    }
}
