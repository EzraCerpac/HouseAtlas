//! Bounded native operation cuts at an immutable, actor/query-bound watermark.
use super::super::{cache_repository, stock_activity::history_repository, *};
use super::stock::stock_error;
use super::{AtlasStore, authorize, read_request, shape};
use crate::{
    domain::stock::{
        OwnerResult, StockContractPort, StockHistoryPort, StockResult, ValidatedRequest,
    },
    providers::homebox::write::stock as native,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Read the original native journal, never upstream history or cache-derived
    /// completion. Schema 5 has no such journal and remains unavailable. Each
    /// entry is ONE saved operation cut, not a synthesized transition event.
    /// includeArchived remains part of the immutable cursor query; native
    /// activity cuts carry no resource lifecycle with which to filter them.
    pub fn homebox_stock_history_json_with_authorization<B, S, N>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        native_contracts: &N,
        raw: &Value,
    ) -> Result<OwnerResult>
    where
        B: HomeBoxStockHistoryAuthorization,
        S: StockContractPort,
        N: native::StockContractPort,
    {
        let request = ValidatedRequest::parse(contracts, raw.clone()).map_err(stock_error)?;
        let location_route = match request.id().as_str() {
            "homebox.entity.mediated-history" => false,
            "homebox.location.mediated-history" => true,
            _ => {
                return Err(Error::new(
                    "invalid-contract",
                    "HomeBox mediated history is required",
                ));
            }
        };
        let scope: Scope = serde_json::from_value(raw["context"].clone())?;
        let native_scope: native::Context = serde_json::from_value(raw["context"].clone())?;
        let target: native::WireTarget = serde_json::from_value(request.target().clone())?;
        if target.resource_kind != native::ResourceKind::Entity || target.entity_id.is_some() {
            return Err(Error::new(
                "invalid-contract",
                "Exact HomeBox history target is required",
            ));
        }
        shape(&self.contract, "scope", &scope)?;
        let partition = SourcePartition {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            source_instance_id: target.source_instance_id.to_string(),
            collection_id: target.collection_id.to_string(),
        };
        let source = json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":{"sourceInstanceId":partition.source_instance_id,"collectionId":partition.collection_id,
                "sourceKind":"homebox-entity","externalId":target.resource_id}});
        let native_target = native::StockTarget {
            source_instance_id: target.source_instance_id,
            collection_id: target.collection_id,
            resource_kind: target.resource_kind,
            resource_id: Some(target.resource_id),
            entity_id: None,
        };
        let page_size = super::super::numeric::safe_integer(&raw["payload"]["pageSize"])
            .and_then(|n| usize::try_from(n).ok())
            .filter(|n| (1..=100).contains(n))
            .ok_or(Error::new(
                "invalid-contract",
                "History page size is incompatible",
            ))?;
        let mut query = raw["payload"].clone();
        query
            .as_object_mut()
            .ok_or_else(incompatible)?
            .remove("cursor");
        // A distinct owner/format keeps the shared immutable cursor table's
        // Atlas audit sequence namespace separate from native activity sequence.
        let query_json = self.contract.canonical_json(&json!({
            "format":history_repository::HOMEBOX_HISTORY_CURSOR_FORMAT,"commandId":request.id().as_str(),
            "target":request.target(),"payload":query}))?;
        let check = |phase,
                     registration: Option<&SourceRegistration>,
                     entries: &[Value],
                     result: Option<&OwnerResult>| {
            let history = authorize(
                &self.contract,
                authorization,
                principal,
                read_request(&scope, Capability::ReadHistory, &[]),
            )?;
            let mut partition_request = read_request(&scope, Capability::ReadCache, &[]);
            partition_request.source_partition = Some(&partition);
            let actor = authorize(&self.contract, authorization, principal, partition_request)?;
            let mut source_request = read_request(&scope, Capability::ReadCache, &[]);
            source_request.source = Some(&source);
            let source_actor = authorize(&self.contract, authorization, principal, source_request)?;
            let history_actor = authorization.authorize_homebox_stock_history(
                principal,
                HomeBoxStockHistoryFrame {
                    phase,
                    request: raw,
                    scope: &scope,
                    target: &target,
                    partition: &partition,
                    registration,
                    entries,
                    result,
                },
            )?;
            if actor != history || actor != source_actor || actor != history_actor {
                return Err(Error::new(
                    "unauthenticated",
                    "Verified history principal changed",
                ));
            }
            Ok(actor)
        };
        let actor = check(HomeBoxStockHistoryPhase::Entry, None, &[], None)?;
        if !self.options.stock_activity_profile {
            return Err(Error::new(
                "upstream-unavailable",
                "Native HomeBox history is unavailable",
            ));
        }
        // No writer admission while selecting/validating the immutable page.
        let tx = self.db.transaction()?;
        let registration = cache_repository::source(&tx, &partition)?;
        shape(&self.contract, "sourceRegistration", &registration)?;
        if registration.partition() != partition || registration.owner != SourceOwner::Homebox {
            return Err(incompatible());
        }
        if registration.partition_mode == PartitionMode::ReviewedEntityAllowlist
            && !registration
                .allowed_external_ids
                .contains(&target.resource_id.to_string())
        {
            return Err(Error::new(
                "not-found",
                "Registered HomeBox target is unavailable",
            ));
        }
        let (watermark, after) = match raw["payload"]["cursor"].as_str() {
            Some(cursor) => {
                let (watermark, after): (i64, i64) = tx.query_row(
                    "SELECT watermark,after_seq FROM stock_history_cursors WHERE cursor_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4 AND query_json=?5 AND codec_version=1",
                    params![cursor,scope.workspace_id,scope.home_id,actor.actor_id,query_json],
                    |row| Ok((row.get(0)?,row.get(1)?))).optional()?
                    .ok_or(Error::new("invalid-contract", "History cursor does not match the authorized query"))?;
                (Some(watermark), after)
            }
            None => (None, 0),
        };
        let page = history_repository::page(
            &tx,
            native_contracts,
            &native_scope,
            &native_target,
            location_route,
            raw["payload"].get("q").and_then(Value::as_str),
            watermark,
            after,
            page_size,
        )
        .map_err(history_fault)?;
        let entries: Vec<Value> = page
            .items
            .iter()
            .map(|event| {
                let operation = event.operation();
                json!({"eventId":operation.operation_id,"commandId":operation.command.command_id,
                "at":operation.outcome.observed_at,"actorId":operation.actor_id,
                "requestDigest":operation.command.request_digest,"state":operation.outcome.state,
                "target":request.target()})
            })
            .collect();
        let next_after = if page.has_more {
            Some(
                i64::try_from(
                    page.items
                        .get(page_size - 1)
                        .ok_or_else(incompatible)?
                        .sequence(),
                )
                .map_err(|_| incompatible())?,
            )
        } else {
            None
        };
        let make_output = |cursor: Option<&str>| -> Result<OwnerResult> {
            let output = OwnerResult {
                wire: json!({"schemaVersion":3,"commandId":request.id().as_str(),"requestId":request.request_id(),
                "resolvedScope":request.context(),"status":"read","replayed":false,
                "data":{"entries":entries.iter().take(page_size).collect::<Vec<_>>(),
                    "nextCursor":cursor,"completeness":"atlas-mediated-only",
                    "coverage":"atlas-mediated-only"}}),
                children: Vec::new(),
            };
            contracts
                .validate(request.operation().output_schema, &output.wire)
                .map_err(stock_error)?;
            Ok(output)
        };
        let recheck = |phase, output: &OwnerResult| -> Result<()> {
            if check(phase, Some(&registration), &entries, Some(output))? != actor {
                return Err(Error::new(
                    "unauthenticated",
                    "Verified history principal changed",
                ));
            }
            Ok(())
        };
        let output = if let Some(last) = next_after {
            // Selection remains read-only. Resolve the winning immutable DATA
            // cursor under writer admission before authorizing the final output.
            tx.commit()?;
            let tx = self
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            if cache_repository::source(&tx, &partition)? != registration {
                return Err(incompatible());
            }
            let key = history_repository::NativeHistoryCursorKey {
                scope: &scope,
                actor: &actor.actor_id,
                canonical_query: &query_json,
                watermark: page.watermark,
                after: last,
            };
            let existing = history_repository::identical_cursor(&tx, &key)?;
            let (id, insert) = match existing {
                Some(id) => (id, false),
                None => (self.runtime.new_id()?, true),
            };
            shape(
                &self.contract,
                "recordRef",
                &RecordRef {
                    record_type: RecordType::Identity,
                    record_id: id.clone(),
                },
            )?;
            let output = make_output(Some(&id))?;
            recheck(HomeBoxStockHistoryPhase::Page, &output)?;
            recheck(HomeBoxStockHistoryPhase::CursorPrecommit, &output)?;
            if insert {
                history_repository::admit_cursor(&tx, &scope, &actor.actor_id)?;
                tx.execute(
                    "INSERT INTO stock_history_cursors VALUES(?1,?2,?3,?4,?5,?6,?7,1)",
                    params![
                        id,
                        scope.workspace_id,
                        scope.home_id,
                        actor.actor_id,
                        query_json,
                        page.watermark,
                        last
                    ],
                )?;
            }
            recheck(HomeBoxStockHistoryPhase::CursorPrecommit, &output)?;
            tx.commit()?;
            output
        } else {
            let output = make_output(None)?;
            recheck(HomeBoxStockHistoryPhase::Page, &output)?;
            tx.commit()?;
            output
        };
        recheck(HomeBoxStockHistoryPhase::Release, &output)?;
        Ok(output)
    }
}

fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Retained HomeBox history is incompatible",
    )
}
fn history_fault(fault: native::StockPortFault) -> Error {
    match fault {
        native::StockPortFault::Unavailable => Error::new(
            "upstream-unavailable",
            "Native HomeBox history is unavailable",
        ),
        _ => incompatible(),
    }
}

/// Borrow the actual Store, original disclosure peer and native schema owner.
/// Opens no connection and issues no producer, permit or original authority.
pub struct NativeHomeBoxStockHistory<'a, C, A, R, B, N> {
    store: &'a mut AtlasStore<C, A, R>,
    authorization: &'a B,
    native_contracts: &'a N,
}
impl<'a, C, A, R, B, N> NativeHomeBoxStockHistory<'a, C, A, R, B, N> {
    pub fn from_store(
        store: &'a mut AtlasStore<C, A, R>,
        authorization: &'a B,
        native_contracts: &'a N,
    ) -> Self {
        Self {
            store,
            authorization,
            native_contracts,
        }
    }
}
impl<C, A, R, B, N> StockHistoryPort<B::Principal> for NativeHomeBoxStockHistory<'_, C, A, R, B, N>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: HomeBoxStockHistoryAuthorization,
    N: native::StockContractPort,
{
    fn stock_history<S: StockContractPort>(
        &mut self,
        principal: &B::Principal,
        contracts: &S,
        request: &ValidatedRequest,
    ) -> StockResult<OwnerResult> {
        self.store
            .homebox_stock_history_json_with_authorization(
                self.authorization,
                principal,
                contracts,
                self.native_contracts,
                request.raw(),
            )
            .map_err(|error| {
                crate::domain::stock::StockError::Domain(
                    crate::domain::native_storage::native_error(error),
                )
            })
    }
}
