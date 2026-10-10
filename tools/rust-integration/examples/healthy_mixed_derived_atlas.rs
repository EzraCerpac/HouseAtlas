//! Positive native Store batch containing one direct and six derived Atlas
//! children. The fixture uses the existing synthetic Core, a real Access-issued
//! editor principal, and Access's synchronous mutation guard. It does not mount
//! or exercise an HTTP route.

use houseatlas_backend::{
    access as a,
    app::{Core, RequestPrincipal},
    contracts::{AssetPayloadPreviewPolicy, BindingPayloadSourceState, stock as wire},
    domain::stock::{self as st, AtlasDerivation},
    http::contracts::NativeContracts,
    lifecycle::Failure,
    storage as s,
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeSet,
};

use super::{guard, id, principal, target};

fn denied() -> s::Error {
    s::Error::new("forbidden", "Fixture Access authorization was not accepted")
}

fn actor(principal: &RequestPrincipal) -> s::VerifiedActor {
    let principal = principal.principal.principal();
    s::VerifiedActor {
        workspace_id: principal.scope().workspace_id.as_str().into(),
        home_id: principal.scope().home_id.as_str().into(),
        actor_id: principal.actor_id().as_str().into(),
    }
}

/// A fixture-local Store peer. Its authority comes only from the actual
/// transaction guard and source grants issued by Access for this principal.
/// It checks fixture correlation and phase order without standing in for the
/// HTTP root's graph witness.
pub(super) struct FixtureAuthorization<'a, 'g> {
    guard: &'a a::TransactionAuthorization<'g>,
    principal: &'a RequestPrincipal,
    raw: &'a Value,
    source_grants: &'a [a::SourceGrant],
    partition_grants: &'a [a::PartitionGrant],
    original: &'a s::Snapshot,
    plan: &'a st::AtlasCommandPlan,
    candidate: RefCell<Option<s::Snapshot>>,
    receipt: RefCell<Option<s::StockAtlasCommit>>,
    last_phase: Cell<Option<u8>>,
}

impl<'a, 'g> FixtureAuthorization<'a, 'g> {
    pub(super) fn new(
        guard: &'a a::TransactionAuthorization<'g>,
        principal: &'a RequestPrincipal,
        raw: &'a Value,
        source_grants: &'a [a::SourceGrant],
        partition_grants: &'a [a::PartitionGrant],
        original: &'a s::Snapshot,
        plan: &'a st::AtlasCommandPlan,
    ) -> Self {
        Self {
            guard,
            principal,
            raw,
            source_grants,
            partition_grants,
            original,
            plan,
            candidate: RefCell::new(None),
            receipt: RefCell::new(None),
            last_phase: Cell::new(None),
        }
    }

    fn same_principal(&self, principal: &RequestPrincipal) -> s::Result<()> {
        if !std::ptr::eq(principal, self.principal)
            || !std::ptr::eq(principal.principal.principal(), self.guard.principal())
            || !std::ptr::eq(
                self.guard.revalidate().map_err(|_| denied())?,
                self.guard.principal(),
            )
        {
            return Err(denied());
        }
        Ok(())
    }

    fn authorize_sources(&self, closure: &s::MutationClosure) -> s::Result<()> {
        for raw in &closure.source_refs {
            let reference: a::SourceRef =
                serde_json::from_value(raw.clone()).map_err(|_| denied())?;
            let grant = self
                .source_grants
                .iter()
                .find(|grant| grant.reference() == &reference)
                .ok_or_else(denied)?;
            self.guard.revalidate_source(grant).map_err(|_| denied())?;
        }
        for partition in &closure.source_partitions {
            let partition: a::SourcePartition =
                serde_json::from_value(serde_json::to_value(partition)?).map_err(|_| denied())?;
            let grant = self
                .partition_grants
                .iter()
                .find(|grant| grant.partition() == &partition)
                .ok_or_else(denied)?;
            self.guard
                .revalidate_source_partition(grant)
                .map_err(|_| denied())?;
        }
        Ok(())
    }

    fn phase(&self, phase: s::MutationPhase) -> s::Result<()> {
        let rank = match phase {
            s::MutationPhase::Intake => 0,
            s::MutationPhase::Validate => 1,
            s::MutationPhase::Candidate => 2,
            s::MutationPhase::Precommit => 3,
            s::MutationPhase::Replay | s::MutationPhase::ReplayPrecommit => return Err(denied()),
        };
        if self.last_phase.get().map_or(0, |previous| previous + 1) != rank {
            return Err(denied());
        }
        self.last_phase.set(Some(rank));
        Ok(())
    }
}

impl s::Authorization for FixtureAuthorization<'_, '_> {
    type Principal = RequestPrincipal;

    fn authorize(
        &self,
        principal: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.same_principal(principal)?;
        let scope: a::Scope =
            serde_json::from_value(serde_json::to_value(request.scope)?).map_err(|_| denied())?;
        if scope.workspace_id.as_str() != principal.principal.scope().workspace_id.as_str()
            || scope.home_id.as_str() != principal.principal.scope().home_id.as_str()
        {
            return Err(denied());
        }
        let capability = match request.capability {
            s::Capability::Read => a::Capability::Read,
            s::Capability::ReadHistory => a::Capability::ReadHistory,
            s::Capability::ReadAssetManifest => a::Capability::ReadAssetManifest,
            s::Capability::Mutate => a::Capability::Mutate,
            s::Capability::ReadCache
            | s::Capability::ConfigureSource
            | s::Capability::PublishCache => return Err(denied()),
        };
        self.guard
            .authorize(&scope, capability)
            .map_err(|_| denied())?;
        if let Some(mutation) = request.mutation {
            self.authorize_sources(&mutation.closure)?;
        }
        Ok(actor(principal))
    }
}

impl s::StockAuthorization for FixtureAuthorization<'_, '_> {
    fn authorize_stock_mutation(
        &self,
        principal: &RequestPrincipal,
        frame: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        self.same_principal(principal)?;
        if frame.plan.original_request() != self.raw
            || frame.plan.original_request() != self.plan.original_request()
            || frame.plan.request_digest() != self.plan.request_digest()
            || frame.plan.batch_target_id() != self.plan.batch_target_id()
            || frame.native.original != *self.original
            || frame.native.replay.is_some()
            || self.raw["context"]["workspaceId"].as_str()
                != Some(frame.native.scope.workspace_id.as_str())
            || self.raw["context"]["homeId"].as_str() != Some(frame.native.scope.home_id.as_str())
        {
            return Err(denied());
        }
        if frame.plan.groups().len() != self.plan.groups().len()
            || frame
                .plan
                .groups()
                .iter()
                .zip(self.plan.groups())
                .any(|(actual, expected)| {
                    actual.child_index() != expected.child_index()
                        || actual.original_request() != expected.original_request()
                        || actual.request_digest() != expected.request_digest()
                        || actual.native_entries() != expected.native_entries()
                })
        {
            return Err(denied());
        }
        self.phase(frame.native.phase)?;
        self.authorize_sources(frame.closure)?;

        if frame.native.phase == s::MutationPhase::Candidate {
            let candidate = frame.native.candidate.as_ref().ok_or_else(denied)?;
            if self
                .candidate
                .borrow()
                .as_ref()
                .is_some_and(|previous| previous != candidate)
            {
                return Err(denied());
            }
            *self.candidate.borrow_mut() = Some(candidate.clone());
            *self.receipt.borrow_mut() = Some(frame.commit.ok_or_else(denied)?.clone());
        }
        if frame.native.phase == s::MutationPhase::Precommit {
            let candidate = frame.native.candidate.as_ref().ok_or_else(denied)?;
            if self.candidate.borrow().as_ref() != Some(candidate)
                || self.receipt.borrow().as_ref() != frame.commit
            {
                return Err(denied());
            }
        }

        // Each submitted root/child guard must occur in the actual native
        // closure, including the remap's original binding preimage.
        for guard in frame.plan.root_guards() {
            if !frame.closure.record_refs.contains(&guard.record) {
                return Err(denied());
            }
        }
        for group in frame.plan.groups() {
            for entry in group.native_entries() {
                for guard in &entry.command.guards {
                    if !frame.closure.record_refs.contains(&guard.record) {
                        return Err(denied());
                    }
                }
            }
        }
        if let Some(commit) = frame.commit {
            if commit.original_request != *self.raw
                || commit.actor_id != principal.principal.actor_id().as_str()
                || commit.replayed
            {
                return Err(denied());
            }
            let candidate = frame.native.candidate.as_ref().ok_or_else(denied)?;
            for result in commit.groups.iter().flat_map(|group| &group.native_results) {
                if !candidate
                    .records
                    .iter()
                    .any(|record| record == &result.record)
                {
                    return Err(denied());
                }
            }
        } else if frame.native.phase == s::MutationPhase::Precommit {
            return Err(denied());
        }
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(&frame.native.scope)?)
            .map_err(|_| denied())?;
        self.guard
            .authorize(&scope, a::Capability::Mutate)
            .map_err(|_| denied())?;
        Ok(actor(principal))
    }

    fn authorize_stock_history(
        &self,
        _principal: &RequestPrincipal,
        _frame: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        Err(denied())
    }
}

/// Run after the existing specialized positive mutations have created active
/// bindings 930/931 and geometry 933, before the caller closes/reopens SQLite.
pub fn healthy(core: &Core, cookie: &str, csrf: &str) -> Result<s::StockAtlasCommit, Failure> {
    let path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let principal = principal(core, cookie, csrf, true, &path)?;
    let scope = s::Scope {
        workspace_id: core.home.scope.workspace_id.clone(),
        home_id: core.home.scope.home_id.clone(),
    };
    let contracts = st::NativeStockContract::new()?;
    let validator = wire::StockValidation::new()?;
    let original = core
        .store
        .lock()
        .map_err(|_| "Store unavailable")?
        .read_snapshot(&principal, &scope)?;
    let binding_930 = original
        .records
        .iter()
        .find(|record| record.record_id == id(930))
        .ok_or("Missing active binding 930")?
        .clone();
    let binding_931 = original
        .records
        .iter()
        .find(|record| record.record_id == id(931))
        .ok_or("Missing active binding 931")?
        .clone();
    let binding_300 = original
        .records
        .iter()
        .find(|record| record.record_id == id(300))
        .ok_or("Missing tombstoned binding 300")?
        .clone();
    let geometry_933 = original
        .records
        .iter()
        .find(|record| record.record_id == id(933))
        .ok_or("Missing geometry 933")?
        .clone();
    let asset_600 = original
        .records
        .iter()
        .find(|record| record.record_id == id(600))
        .ok_or("Missing asset 600")?
        .clone();
    assert_eq!(binding_930.revision, 2);
    assert_eq!(binding_931.revision, 1);
    assert_eq!(binding_300.revision, 4);
    assert_eq!(binding_300.lifecycle, s::Lifecycle::Tombstoned);
    assert_eq!(geometry_933.revision, 1);
    assert_eq!(asset_600.revision, 3);

    let mut geometry_payload = geometry_933.payload.clone();
    geometry_payload
        .as_object_mut()
        .ok_or("Geometry payload object required")?
        .remove("importedAt");
    let expected_imported_at = s::Runtime::now(&houseatlas_backend::app::ServerRuntime)?;

    let batch = json!({
        "schemaVersion":3,
        "commandId":"atlas.batch.execute",
        "requestId":id(10_000),
        "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
        "target":{"authority":"atlas","kind":"batch","batchId":id(10_010)},
        "idempotencyKey":id(10_011),
        "reason":"Positive mixed direct and derived Atlas batch",
        "approvalReceiptId":null,
        "preconditions":{"target":null,"guards":[guard("binding",300,4),guard("evidence",100,1)]},
        "payload":{"commands":[
            {
                "schemaVersion":3,"commandId":"atlas.circuit.create","requestId":id(10_001),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("circuit",941),
                "payload":{"label":"Mixed derived batch circuit","panel":null,"evidenceIds":[id(100)]},
                "idempotencyKey":id(10_021),"reason":"Create one direct batch child",
                "approvalReceiptId":null,
                "preconditions":{"target":null,"guards":[guard("evidence",100,1)]}
            },
            {
                "schemaVersion":3,"commandId":"atlas.binding.remap","requestId":id(10_002),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("binding",931),
                "payload":{"oldBindingId":id(931),"newBindingId":id(942),"journalId":id(943),
                    "source":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
                        "sourceKind":"homebox-entity","externalId":id(506)},
                    "reason":"import-id-remap","evidenceIds":[id(100)]},
                "idempotencyKey":id(10_022),"reason":"Remap one derived binding",
                "approvalReceiptId":null,
                "preconditions":{"target":{"kind":"atlas","value":1},"guards":[
                    guard("identity",201,1),guard("evidence",100,1),guard("binding",931,1)]}
            },
            {
                "schemaVersion":3,"commandId":"atlas.geometry.create","requestId":id(10_003),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("geometry",940),"payload":geometry_payload,
                "idempotencyKey":id(10_023),"reason":"Create derived geometry with server time",
                "approvalReceiptId":null,
                "preconditions":{"target":null,"guards":[
                    guard("asset",600,3),guard("identity",200,1),guard("evidence",100,1)]}
            },
            {
                "schemaVersion":3,"commandId":"atlas.binding.review","requestId":id(10_004),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("binding",930),
                "payload":{"reviewStatus":"proposed","evidenceIds":[id(100)]},
                "idempotencyKey":id(10_024),"reason":"Review the original binding in the same batch",
                "approvalReceiptId":null,
                "preconditions":{"target":{"kind":"atlas","value":2},"guards":[
                    guard("identity",200,1),guard("evidence",100,1)]}
            },
            {
                "schemaVersion":3,"commandId":"atlas.binding.restore","requestId":id(10_005),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("binding",300),"payload":{},
                "idempotencyKey":id(10_025),"reason":"Restore the original tombstoned binding",
                "approvalReceiptId":null,
                "preconditions":{"target":{"kind":"atlas","value":4},"guards":[
                    guard("identity",200,1),guard("evidence",100,1)]}
            },
            {
                "schemaVersion":3,"commandId":"atlas.asset.review","requestId":id(10_006),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("asset",600),
                "payload":{"treatment":"download-only","rendererReceiptId":null,"evidenceIds":[id(100)]},
                "idempotencyKey":id(10_026),"reason":"Allow download while keeping preview blocked",
                "approvalReceiptId":null,
                "preconditions":{"target":{"kind":"atlas","value":3},"guards":[
                    guard("evidence",100,1)]}
            },
            {
                "schemaVersion":3,"commandId":"atlas.binding.create","requestId":id(10_007),
                "context":{"workspaceId":scope.workspace_id,"homeId":scope.home_id},
                "target":target("binding",944),
                "payload":{"atlasId":id(201),"source":{"sourceInstanceId":id(10),
                    "collectionId":"synthetic-collection-a","sourceKind":"homebox-entity","externalId":id(507)},
                    "reviewStatus":"proposed","evidenceIds":[id(100)]},
                "idempotencyKey":id(10_027),"reason":"Create a derived unresolved binding",
                "approvalReceiptId":null,
                "preconditions":{"target":null,"guards":[
                    guard("identity",201,1),guard("evidence",100,1)]}
            }
        ]}
    });
    let typed_request = wire::StockRequest::parse(&validator, batch.clone())?;
    let request = st::ValidatedRequest::parse(&contracts, batch.clone())?;
    assert_eq!(request.children().len(), 7);

    // Reproduce the ordered child-aligned owner inputs: None is the ordinary
    // direct circuit mapping; Some values come from this same pre-write snapshot.
    let derivations = vec![
        None,
        Some(AtlasDerivation::BindingRemap {
            original: binding_931,
            source_state: BindingPayloadSourceState::Unresolved,
        }),
        Some(AtlasDerivation::GeometryCreate {
            imported_at: expected_imported_at.clone(),
        }),
        Some(AtlasDerivation::BindingReview {
            original: binding_930,
        }),
        Some(AtlasDerivation::BindingRestore {
            original: binding_300,
        }),
        Some(AtlasDerivation::AssetReview {
            original: asset_600,
            preview_policy: AssetPayloadPreviewPolicy::DownloadOnly,
            renderer_receipt_id: None,
        }),
        Some(AtlasDerivation::BindingCreate {
            source_state: BindingPayloadSourceState::Unresolved,
        }),
    ];
    let plan = st::plan_derived_atlas_batch_commands(&request, &derivations, &NativeContracts)?;
    assert_eq!(plan.groups().len(), request.children().len());
    assert_eq!(
        plan.groups()
            .iter()
            .map(|group| group.child_index())
            .collect::<Vec<_>>(),
        vec![
            Some(0),
            Some(1),
            Some(2),
            Some(3),
            Some(4),
            Some(5),
            Some(6)
        ]
    );
    assert_eq!(
        plan.groups()
            .iter()
            .map(|group| group.native_entries().len())
            .collect::<Vec<_>>(),
        vec![1, 3, 1, 1, 1, 1, 1]
    );

    // Obtain the exact source and partition grants needed by this immutable
    // fixture closure from Access under the same principal, before the guard.
    let source_values = [
        json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":original.records.iter().find(|r|r.record_id==id(930)).ok_or("Missing binding source")?.payload["source"]}),
        json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":original.records.iter().find(|r|r.record_id==id(931)).ok_or("Missing remap source")?.payload["source"]}),
        json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":original.records.iter().find(|r|r.record_id==id(300)).ok_or("Missing restore source")?.payload["source"]}),
        json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
                "sourceKind":"homebox-entity","externalId":id(506)}}),
        json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,
            "key":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
                "sourceKind":"homebox-entity","externalId":id(507)}}),
    ];
    let mut references = Vec::<a::SourceRef>::new();
    for value in source_values {
        let reference: a::SourceRef = serde_json::from_value(value)?;
        if !references.contains(&reference) {
            references.push(reference);
        }
    }
    // Reverse dependencies include earlier remap journals and their retired
    // bindings. Capture real grants for every original binding, not just the
    // current batch targets; the native owner still determines its full closure.
    for record in &original.records {
        if record.record_type == s::RecordType::Binding && !record.payload["source"].is_null() {
            let reference: a::SourceRef = serde_json::from_value(json!({
                "workspaceId":scope.workspace_id,"homeId":scope.home_id,
                "key":record.payload["source"]
            }))?;
            if !references.contains(&reference) {
                references.push(reference);
            }
        }
    }
    for mapping in geometry_payload["mappings"]
        .as_array()
        .ok_or("Geometry mappings required")?
    {
        if let Some(value) = mapping.get("homeboxEntity") {
            let reference: a::SourceRef = serde_json::from_value(value.clone())?;
            if !references.contains(&reference) {
                references.push(reference);
            }
        }
    }
    let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
    let mut source_grants = Vec::new();
    let mut partition_grants = Vec::new();
    for reference in &references {
        source_grants.push(access.authorize_source(principal.principal.principal(), reference)?);
        let partition = reference.partition();
        if !partition_grants
            .iter()
            .any(|grant: &a::PartitionGrant| grant.partition() == &partition)
        {
            partition_grants.push(
                access.authorize_source_partition(principal.principal.principal(), &partition)?,
            );
        }
    }
    let committed = RefCell::new(None);
    access.with_mutation_authorization::<FixtureFailure>(
        principal.principal.principal(),
        |guard| {
            let authorization = FixtureAuthorization::new(
                guard,
                &principal,
                &batch,
                &source_grants,
                &partition_grants,
                &original,
                &plan,
            );
            let mut store = core
                .store
                .lock()
                .map_err(|_| FixtureFailure("Store unavailable".into()))?;
            let commit = store
                .execute_derived_stock_batch_json_with_authorization(
                    &authorization,
                    &principal,
                    &contracts,
                    &batch,
                    &derivations,
                )
                .map_err(|error| FixtureFailure(error.to_string()))?;
            if authorization.last_phase.get() != Some(3) {
                return Err(FixtureFailure(
                    "Missing native precommit authorization".into(),
                ));
            }
            *committed.borrow_mut() = Some(commit);
            Ok(())
        },
    )?;
    drop(access);
    let commit = committed
        .into_inner()
        .ok_or("Native Store did not return a batch commit")?;

    wire::StockResponse::parse(
        &validator,
        &typed_request,
        commit.wire.clone(),
        &commit.children,
    )?;
    assert_eq!(commit.original_request, batch);
    assert_eq!(commit.wire["commandId"], "atlas.batch.execute");
    assert_eq!(commit.wire["operationId"], commit.operation_id);
    assert!(!commit.replayed);
    assert_eq!(
        commit.derivation_format.as_deref(),
        Some("atlas-derived-batch/1")
    );
    assert_eq!(commit.child_derivations.as_ref().map(Vec::len), Some(7));
    assert!(commit.child_derivations.as_ref().unwrap()[0].is_none());
    assert!(matches!(
        commit.child_derivations.as_ref().unwrap()[1].as_ref(),
        Some(AtlasDerivation::BindingRemap { .. })
    ));
    assert!(
        matches!(commit.child_derivations.as_ref().unwrap()[2].as_ref(), Some(AtlasDerivation::GeometryCreate { imported_at }) if imported_at == &expected_imported_at)
    );
    assert!(matches!(
        commit.child_derivations.as_ref().unwrap()[3].as_ref(),
        Some(AtlasDerivation::BindingReview { .. })
    ));
    assert!(matches!(
        commit.child_derivations.as_ref().unwrap()[4].as_ref(),
        Some(AtlasDerivation::BindingRestore { .. })
    ));
    assert!(matches!(
        commit.child_derivations.as_ref().unwrap()[5].as_ref(),
        Some(AtlasDerivation::AssetReview {
            preview_policy: AssetPayloadPreviewPolicy::DownloadOnly,
            renderer_receipt_id: None,
            ..
        })
    ));
    assert!(matches!(
        commit.child_derivations.as_ref().unwrap()[6].as_ref(),
        Some(AtlasDerivation::BindingCreate {
            source_state: BindingPayloadSourceState::Unresolved,
        })
    ));

    let expected_operations = [
        "atlas.circuit.create",
        "atlas.binding.remap",
        "atlas.geometry.create",
        "atlas.binding.review",
        "atlas.binding.restore",
        "atlas.asset.review",
        "atlas.binding.create",
    ];
    assert_eq!(commit.groups.len(), expected_operations.len());
    let mut operation_ids = BTreeSet::new();
    operation_ids.insert(commit.operation_id.as_str());
    let mut audit_ids = BTreeSet::new();
    for (index, (group, operation)) in commit.groups.iter().zip(expected_operations).enumerate() {
        assert_eq!(group.child_index, Some(index));
        assert_eq!(commit.children[index]["commandId"], operation);
        assert_eq!(commit.children[index]["operationId"], group.operation_id);
        assert!(operation_ids.insert(group.operation_id.as_str()));
        let group_audits = group
            .native_results
            .iter()
            .map(|result| {
                assert!(audit_ids.insert(result.audit.audit_id.as_str()));
                result.audit.audit_id.clone()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            commit.children[index]["data"]["auditIds"],
            json!(group_audits)
        );
        assert_eq!(
            commit.children[index]["requestId"],
            batch["payload"]["commands"][index]["requestId"]
        );
    }
    assert_eq!(audit_ids.len(), 9);
    assert_eq!(commit.children.len(), 7);
    assert_eq!(
        commit.children[1]["data"]["records"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        commit.children[1]["data"]["records"][0]["target"],
        target("binding", 931)
    );
    assert_eq!(
        commit.children[1]["data"]["records"][1]["target"],
        target("binding", 942)
    );
    assert_eq!(
        commit.children[1]["data"]["records"][2]["target"],
        target("reconciliation", 943)
    );
    assert_eq!(
        commit.children[2]["data"]["records"][0]["payload"]["importedAt"],
        expected_imported_at
    );
    assert_eq!(
        commit.children[3]["data"]["records"][0]["payload"]["reviewStatus"],
        "proposed"
    );
    assert_eq!(
        commit.children[4]["data"]["records"][0]["target"],
        target("binding", 300)
    );
    assert_eq!(
        commit.children[4]["data"]["records"][0]["lifecycle"],
        "active"
    );
    assert_eq!(commit.children[4]["data"]["records"][0]["revision"], 5);
    assert_eq!(
        commit.children[5]["data"]["records"][0]["payload"]["previewPolicy"],
        "download-only"
    );
    assert_eq!(
        commit.children[5]["data"]["records"][0]["payload"]["availability"],
        "missing"
    );
    assert_eq!(
        commit.children[6]["data"]["records"][0]["payload"]["sourceState"],
        "unresolved"
    );
    assert_eq!(commit.children[6]["data"]["records"][0]["revision"], 1);

    let flattened_records = commit
        .children
        .iter()
        .flat_map(|child| child["data"]["records"].as_array().unwrap().iter().cloned())
        .collect::<Vec<_>>();
    let flattened_audits = commit
        .children
        .iter()
        .flat_map(|child| {
            child["data"]["auditIds"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
        })
        .collect::<Vec<_>>();
    assert_eq!(commit.wire["data"]["records"], json!(flattened_records));
    assert_eq!(commit.wire["data"]["auditIds"], json!(flattened_audits));
    assert_eq!(flattened_records.len(), 9);
    assert_eq!(flattened_audits.len(), 9);
    assert_eq!(flattened_records[0]["target"], target("circuit", 941));
    assert_eq!(flattened_records[1]["target"], target("binding", 931));
    assert_eq!(flattened_records[2]["target"], target("binding", 942));
    assert_eq!(
        flattened_records[3]["target"],
        target("reconciliation", 943)
    );
    assert_eq!(flattened_records[4]["target"], target("geometry", 940));
    assert_eq!(flattened_records[5]["target"], target("binding", 930));
    assert_eq!(flattened_records[5]["revision"], 3);
    assert_eq!(flattened_records[4]["revision"], 1);
    assert_eq!(flattened_records[1]["lifecycle"], "active");
    assert_eq!(flattened_records[1]["payload"]["reviewStatus"], "retired");
    assert_eq!(flattened_records[2]["payload"]["sourceState"], "unresolved");
    assert_eq!(flattened_records[6]["target"], target("binding", 300));
    assert_eq!(flattened_records[6]["revision"], 5);
    assert_eq!(flattened_records[7]["target"], target("asset", 600));
    assert_eq!(flattened_records[7]["revision"], 4);
    assert_eq!(flattened_records[8]["target"], target("binding", 944));

    // Keep a compact, caller-readable account of the output while the caller
    // closes/reopens the ordinary Store and checks durable history.
    Ok(commit)
}

#[derive(Debug)]
struct FixtureFailure(String);

impl std::fmt::Display for FixtureFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for FixtureFailure {}

impl From<a::AccessError> for FixtureFailure {
    fn from(_: a::AccessError) -> Self {
        Self("Fixture Access authorization failed".into())
    }
}

impl From<s::Error> for FixtureFailure {
    fn from(error: s::Error) -> Self {
        Self(error.to_string())
    }
}
