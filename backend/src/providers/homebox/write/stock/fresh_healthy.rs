//! Exact positive source fixtures. The opaque qualification owner below is
//! explicitly synthetic; no provider invocation, credential or ledger is used.
use crate::providers::homebox::{read, recovery::NativeWriterContracts, wire, write::stock::*};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;

fn id(n: u64) -> Uuid {
    Uuid::parse_str(&format!("00000000-0000-4000-8000-{n:012}")).unwrap()
}
fn scope() -> read::SourceScope {
    read::SourceScope {
        workspace_id: read::Uuid::parse(&id(1).to_string()).unwrap(),
        home_id: read::Uuid::parse(&id(2).to_string()).unwrap(),
        source_instance_id: read::Uuid::parse(&id(3).to_string()).unwrap(),
        collection_id: id(4).to_string(),
    }
}
fn target(kind: ResourceKind, resource: Option<u64>, owner: Option<u64>) -> StockTarget {
    StockTarget {
        source_instance_id: id(3),
        collection_id: id(4),
        resource_kind: kind,
        resource_id: resource.map(id),
        entity_id: owner.map(id),
    }
}
fn at() -> String {
    "2026-10-08T03:04:05.1200+02:00".into()
}
fn command(op: &str, t: StockTarget, payload: Value) -> StockCommand {
    let mut native_target = serde_json::to_value(t).unwrap();
    for key in ["resourceId", "entityId"] {
        if native_target[key].is_null() {
            native_target.as_object_mut().unwrap().remove(key);
        }
    }
    native_target["authority"] = json!("homebox");
    let mut raw = json!({"schemaVersion":3,"commandId":op,"requestId":id(100),"idempotencyKey":id(101),
        "context":{"workspaceId":id(1),"homeId":id(2)},"target":native_target,"payload":payload,"reason":"Synthetic fresh snapshot",
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":id(102)},"atlasGuards":[]},"approvalReceiptId":null});
    if matches!(op, "homebox.entity.update" | "homebox.field.create") {
        raw["nativeSyncBehavior"] = json!({"mode":"preserve-observed","observed":false});
    }
    NativeWriterContracts::new()
        .unwrap()
        .validate_request(&raw)
        .unwrap()
}
fn authority() -> StockAuthority {
    let c = NativeWriterContracts::new().unwrap();
    let digest = c.digest_native(&json!({"syntheticOwner":id(103)})).unwrap();
    StockAuthority {
        actor_id: id(103),
        source_epoch: 7,
        authority_digest: digest.clone(),
        physical_binding: PhysicalBinding {
            deployment_id: id(104),
            physical_database_id: id(105),
            configuration_digest: digest,
        },
        qualification: NativeQualification::SyntheticFixture,
    }
}
fn entity() -> Value {
    let mut raw: Value =
        serde_json::from_str(include_str!("../../wire/fixtures/item.detail.json")).unwrap();
    raw["fields"] = json!([{"id":id(61),"name":"Original field","type":"number","textValue":"","numberValue":9007199254740991_i64,"booleanValue":false}]);
    raw["purchaseFrom"] = json!("Original seller");
    raw["soldNotes"] = json!("Original sale notes");
    raw["warrantyDetails"] = json!("Original warranty");
    raw["purchaseDate"] = json!("2026-01-02");
    raw["soldDate"] = json!("");
    raw["warrantyExpires"] = json!("2027-01-02");
    raw["purchasePrice"] = serde_json::from_str("1.2300e+2").unwrap();
    raw
}
// A fixture-local owner receipt. It is deliberately not a production authority,
// timestamp policy, hidden-column certificate or approved impact graph.
struct Proof {
    command: StockCommand,
    authority: StockAuthority,
    original: Vec<u8>,
    retained_token: Box<u64>,
}
#[derive(Default)]
struct PreparationAudit {
    captures: AtomicUsize,
    qualifications: AtomicUsize,
    token_address: AtomicUsize,
    original_address: AtomicUsize,
}
struct Source {
    command: StockCommand,
    authority: StockAuthority,
    native: Value,
    capture_target: StockTarget,
    audit: Arc<PreparationAudit>,
}
impl Source {
    fn capture(&self, t: StockTarget) -> FreshNativeCapture {
        let (path, query) = if t.resource_kind == ResourceKind::Maintenance {
            (
                format!("/api/v1/entities/{}/maintenance", t.owner().unwrap()),
                vec![("status".into(), "both".into())],
            )
        } else {
            let owner = if t.resource_kind == ResourceKind::Entity {
                t.id().unwrap()
            } else {
                t.owner().unwrap()
            };
            (format!("/api/v1/entities/{owner}"), vec![])
        };
        FreshNativeCapture {
            scope: scope(),
            target: t,
            path,
            query,
            original: serde_json::to_vec(&self.native).unwrap(),
            observed_at: at(),
        }
    }
    fn proof(&self) -> Proof {
        Proof {
            command: self.command.clone(),
            authority: self.authority.clone(),
            original: serde_json::to_vec(&self.native).unwrap(),
            retained_token: Box::new(103),
        }
    }
    fn check(&self, p: &Proof, c: &StockCommand, a: &StockAuthority, s: &DecodedFreshSnapshot) {
        assert_eq!(&p.command, c);
        assert_eq!(&p.authority, a);
        assert_eq!(p.original, s.original().original);
        assert_eq!(s.source(), &self.native);
        assert_eq!(s.original().observed_at, at());
        assert_eq!(c.provider_observation, id(102));
        assert_eq!(a.source_epoch, 7);
        assert_eq!(s.original().scope, scope());
    }
}
impl FreshPreparationSourcePort for Source {
    type Evidence = Proof;
    async fn capture_preparation(
        &self,
        c: &StockCommand,
        a: &StockAuthority,
    ) -> Result<FreshPreparationCapture<Proof>, StockErrorCode> {
        assert_eq!(c, &self.command);
        assert_eq!(a, &self.authority);
        self.audit.captures.fetch_add(1, Ordering::SeqCst);
        Ok(FreshPreparationCapture {
            evidence: self.proof(),
            snapshots: vec![self.capture(self.capture_target.clone())],
        })
    }
    fn qualify_preparation(
        &self,
        c: &StockCommand,
        a: &StockAuthority,
        d: &DecodedFreshPreparation<Proof>,
    ) -> Result<StockPreflight, StockErrorCode> {
        assert_eq!(d.snapshots().len(), 1);
        // Fixture instrumentation observes retained allocations. It supplies no
        // production provenance, authority, freshness or qualification fact.
        let token = d.evidence().retained_token.as_ref() as *const u64 as usize;
        let original = d.snapshots()[0].original().original.as_ptr() as usize;
        if self.audit.qualifications.fetch_add(1, Ordering::SeqCst) == 0 {
            self.audit.token_address.store(token, Ordering::SeqCst);
            self.audit
                .original_address
                .store(original, Ordering::SeqCst);
        }
        assert_eq!(self.audit.token_address.load(Ordering::SeqCst), token);
        assert_eq!(self.audit.original_address.load(Ordering::SeqCst), original);
        self.check(d.evidence(), c, a, &d.snapshots()[0]);
        let contracts = NativeWriterContracts::new().unwrap();
        // Explicit fixture-owned completeness and hidden-field assertions.
        // The adapter neither infers nor supplies either assertion.
        let snapshots = d
            .snapshots()
            .iter()
            .map(|s| NativeSnapshot {
                target: s.original().target.clone(),
                value: s.snapshot_value().clone(),
                digest: s.digest().clone(),
                complete: true,
                hidden_fields_preserved: true,
            })
            .collect();
        let proof=contracts.digest_native(&json!({"captureDigest":d.capture_digest(),"syntheticOwnerEvidence":{
            "providerObservation":c.provider_observation,"sourceEpoch":a.source_epoch,"sourceRevision":self.native.get("updatedAt"),
            "freshAt":at(),"originalTargets":[self.capture_target],"hiddenColumns":"fixture-known","completeGraph":"fixture-only"
        }})).unwrap();
        Ok(StockPreflight {
            preparation: Preparation {
                snapshots,
                ..Preparation::default()
            },
            provider_observation: c.provider_observation,
            request_digest: c.request_digest.clone(),
            source_epoch: a.source_epoch,
            preflight_digest: proof,
        })
    }
}
impl FreshReadbackSourcePort for Source {
    type Evidence = Proof;
    async fn capture_readback(
        &self,
        o: &StoredOperation,
        p: &ReadbackPlan,
        a: &StockAuthority,
    ) -> Option<FreshReadbackCapture<Proof>> {
        assert_eq!(&o.command, &self.command);
        assert_eq!(a, &self.authority);
        assert_eq!(p.target, self.capture_target);
        Some(FreshReadbackCapture {
            evidence: self.proof(),
            snapshot: self.capture(self.capture_target.clone()),
        })
    }
    fn qualify_readback(
        &self,
        o: &StoredOperation,
        p: &ReadbackPlan,
        a: &StockAuthority,
        d: &DecodedFreshReadback<Proof>,
    ) -> Option<NativeObservation> {
        self.check(d.evidence(), &o.command, a, d.snapshot());
        assert_eq!(d.snapshot().original().path, p.path);
        assert_eq!(d.snapshot().original().query, p.query);
        Some(NativeObservation::Present {
            context: o.command.context.clone(),
            target: p.target.clone(),
            value: d.snapshot().source().clone(),
            observed_at: d.snapshot().original().observed_at.clone(),
            complete: true,
            impact: None,
        })
    }
}
fn operation(
    c: &StockCommand,
    a: &StockAuthority,
    plan: NativePlan,
    actual: Option<StockTarget>,
) -> StoredOperation {
    // A supplied synthetic historical operation; this fixture never dispatches.
    StoredOperation {
        actor_id: a.actor_id,
        captured_authority: a.clone(),
        operation_id: id(110),
        activity_version: 1,
        command: c.clone(),
        plan: Some(plan),
        actual_target: actual,
        generated_members: vec![],
        outcome: StockOutcome {
            schema_version: 3,
            command_id: c.command_id.clone(),
            request_id: c.request_id,
            operation_id: id(110),
            resolved_scope: c.context.clone(),
            request_digest: c.request_digest.clone(),
            causality_proven: false,
            atomic_provider_cas: false,
            native_editor_race_possible: true,
            known_effects: vec![],
            observed_at: at(),
            response_digest: None,
            readback_digest: None,
            generated_identity_resolved: false,
            unknown_scope_fence_retained: true,
            remote_activity: RemoteActivity::end_unproven(),
            storage_liability: StorageLiability {
                accounting_complete: false,
                metadata_commit_evidence: MetadataEvidence::Unknown,
                byte_disposition: ByteDisposition::Unknown,
                reference_closure_evidence: ReferenceClosure::Unassessed,
                orphan_candidate_id: None,
                unresolved_attempts: 0,
                known_bytes: 0,
                reserved_bytes: None,
            },
            state: OutcomeState::UnknownHeld,
            verification: Verification::Unresolved,
            response_success: false,
            readback_agrees: false,
            resolution_evidence_digest: None,
            resolution_actor_id: None,
        },
    }
}
fn source(c: &StockCommand, a: &StockAuthority, native: Value, t: StockTarget) -> Source {
    Source {
        command: c.clone(),
        authority: a.clone(),
        native,
        capture_target: t,
        audit: Arc::new(PreparationAudit::default()),
    }
}

#[tokio::test]
async fn healthy_fresh_complete_entity_preparation() {
    let t = target(ResourceKind::Entity, Some(2), None);
    let raw = entity();
    let a = authority();
    let c = command(
        "homebox.entity.update",
        t.clone(),
        json!({"name":"Only requested change"}),
    );
    let p = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        source(&c, &a, raw.clone(), t.clone()),
        wire::DecodeLimits::default(),
    );
    let preflight = p.prepare(&c, &a).await.unwrap();
    assert_eq!(preflight.preparation.snapshots[0].value, raw);
    assert_eq!(preflight.provider_observation, c.provider_observation);
    let plan = map_stock(&c, &preflight.preparation).unwrap();
    assert_eq!(plan.request.method, NativeMethod::Put);
    let NativeBody::Json(body) = plan.request.body else {
        panic!("native JSON");
    };
    assert_eq!(body["name"], "Only requested change");
    for key in [
        "description",
        "quantity",
        "archived",
        "insured",
        "lifetimeWarranty",
        "manufacturer",
        "modelNumber",
        "serialNumber",
        "notes",
        "purchaseDate",
        "soldDate",
        "warrantyExpires",
        "purchaseFrom",
        "purchasePrice",
        "soldNotes",
        "warrantyDetails",
        "fields",
        "syncChildEntityLocations",
    ] {
        assert_eq!(body[key], raw[key], "preserved {key}");
    }
    assert_eq!(body["purchasePrice"].to_string(), "1.2300e+2");
    assert_eq!(body["parentId"], raw["parent"]["id"]);
    assert_eq!(body["entityTypeId"], raw["entityType"]["id"]);
}

#[tokio::test]
async fn healthy_fresh_exact_entity_and_generated_member_readback() {
    let t = target(ResourceKind::Entity, Some(2), None);
    let a = authority();
    let raw = entity();
    let c = command(
        "homebox.entity.update",
        t.clone(),
        json!({"name":"Only requested change"}),
    );
    let p = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        source(&c, &a, raw.clone(), t.clone()),
        wire::DecodeLimits::default(),
    );
    let preflight = p.prepare(&c, &a).await.unwrap();
    let plan = map_stock(&c, &preflight.preparation).unwrap();
    let o = operation(&c, &a, plan.clone(), None);
    let mut after = raw;
    after["name"] = json!("Only requested change");
    after["sourceExtension"] = json!({"unprojected":"retained original readback fact"});
    let reader = DecodedStockReadback::new(
        NativeWriterContracts::new().unwrap(),
        source(&c, &a, after.clone(), t),
        wire::DecodeLimits::default(),
    );
    let observation = reader.readback(&o, &plan.readback, &a).await;
    let NativeObservation::Present {
        value,
        observed_at,
        complete,
        ..
    } = observation
    else {
        panic!("qualified fixture present");
    };
    assert_eq!(value, after);
    assert_eq!(observed_at, at());
    assert!(complete);
    assert_eq!(o.plan, Some(plan));
    assert!(!o.outcome.causality_proven);
    assert!(!o.outcome.atomic_provider_cas);
    assert!(o.outcome.native_editor_race_possible);

    let mut before = entity();
    before["fields"] = json!([]);
    let field = target(ResourceKind::Field, None, Some(2));
    let c = command(
        "homebox.field.create",
        field,
        json!({"name":"Observed member","value":{"kind":"text","value":"Native text"}}),
    );
    let prep = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        source(
            &c,
            &a,
            before.clone(),
            target(ResourceKind::Entity, Some(2), None),
        ),
        wire::DecodeLimits::default(),
    );
    let prepared = prep.prepare(&c, &a).await.unwrap();
    let plan = map_stock(&c, &prepared.preparation).unwrap();
    let actual = target(ResourceKind::Field, Some(62), Some(2));
    let o = operation(&c, &a, plan.clone(), Some(actual.clone()));
    before["fields"] = json!([{"id":id(62),"name":"Observed member","type":"text","textValue":"Native text","numberValue":0,"booleanValue":false}]);
    let mut resolved = plan.readback.clone();
    resolved.target = actual.clone();
    resolved.path = resolved.path.replace("{generatedId}", &id(62).to_string());
    let reader = DecodedStockReadback::new(
        NativeWriterContracts::new().unwrap(),
        source(&c, &a, before.clone(), actual.clone()),
        wire::DecodeLimits::default(),
    );
    let NativeObservation::Present { target, value, .. } = reader.readback(&o, &resolved, &a).await
    else {
        panic!("qualified generated member");
    };
    assert_eq!(target, actual);
    assert_eq!(value, before);
    assert_eq!(o.plan, Some(plan));
    assert_eq!(c.target.resource_id, None);
}

#[tokio::test]
async fn healthy_fresh_complete_maintenance_preparation_and_readback() {
    let t = target(ResourceKind::Maintenance, Some(71), Some(2));
    let a = authority();
    let raw = json!([{"id":id(71),"itemID":id(2),"itemName":"Original entity","name":"Original maintenance","description":"Calendar",
        "scheduledDate":"2026-02-01","completedDate":"","cost":"12.50"}]);
    let c = command(
        "homebox.maintenance.update",
        t.clone(),
        json!({"name":"Only requested maintenance change"}),
    );
    let prep = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        source(&c, &a, raw.clone(), t.clone()),
        wire::DecodeLimits::default(),
    );
    let preflight = prep.prepare(&c, &a).await.unwrap();
    assert_eq!(preflight.preparation.snapshots[0].value, raw[0]);
    let plan = map_stock(&c, &preflight.preparation).unwrap();
    let NativeBody::Json(body) = &plan.request.body else {
        panic!("native JSON");
    };
    assert_eq!(body["cost"], "12.50");
    assert_eq!(body["scheduledDate"], "2026-02-01");
    assert_eq!(body["completedDate"], "");
    let o = operation(&c, &a, plan.clone(), None);
    let mut after = raw;
    after[0]["name"] = json!("Only requested maintenance change");
    let reader = DecodedStockReadback::new(
        NativeWriterContracts::new().unwrap(),
        source(&c, &a, after.clone(), t),
        wire::DecodeLimits::default(),
    );
    let NativeObservation::Present { value, .. } = reader.readback(&o, &plan.readback, &a).await
    else {
        panic!("qualified maintenance capture");
    };
    assert_eq!(value, after);
    assert_eq!(o.plan, Some(plan));
}

#[tokio::test]
async fn healthy_retained_original_preparation_revalidates_same_owner() {
    let t = target(ResourceKind::Entity, Some(2), None);
    let raw = entity();
    let a = authority();
    let c = command(
        "homebox.entity.update",
        t.clone(),
        json!({"name":"Only requested change"}),
    );
    let s = source(&c, &a, raw.clone(), t.clone());
    let audit = Arc::clone(&s.audit);
    let p = DecodedStockPreparation::new(
        NativeWriterContracts::new().unwrap(),
        s,
        wire::DecodeLimits::default(),
    );
    let retained = p.prepare_retained(&c, &a).await.unwrap();
    assert_eq!(retained.command(), &c);
    assert_eq!(retained.authority(), &a);
    let capture = retained.capture();
    let snapshot = &capture.snapshots()[0];
    assert_eq!(
        snapshot.original().original,
        serde_json::to_vec(&raw).unwrap()
    );
    assert_eq!(snapshot.original().scope, scope());
    assert_eq!(snapshot.original().target, t);
    assert_eq!(
        snapshot.original().path,
        format!("/api/v1/entities/{}", id(2))
    );
    assert!(snapshot.original().query.is_empty());
    assert_eq!(snapshot.original().observed_at, at());
    assert_eq!(snapshot.source(), &raw);
    assert_eq!(
        retained.owner_preflight().preparation.snapshots[0].value,
        raw
    );
    assert_eq!(
        retained.preflight().preparation,
        retained.owner_preflight().preparation
    );
    assert_eq!(
        retained.preflight().provider_observation,
        c.provider_observation
    );
    assert_eq!(
        retained.plan(),
        &map_stock(&c, &retained.preflight().preparation).unwrap()
    );
    let NativeBody::Json(body) = &retained.plan().request.body else {
        panic!("native JSON")
    };
    assert_eq!(body["name"], "Only requested change");
    assert_eq!(body["purchasePrice"].to_string(), "1.2300e+2");
    assert_eq!(body["purchaseFrom"], raw["purchaseFrom"]);
    let evidence_address = capture.evidence().retained_token.as_ref() as *const u64 as usize;
    let original_address = snapshot.original().original.as_ptr() as usize;
    let owner_preflight = retained.owner_preflight().clone();
    let wrapped_preflight = retained.preflight().clone();
    let plan = retained.plan().clone();
    // Three successful phase calls model the consumer's separate entry,
    // precommit and release fences; no queue, SQL or write is exercised here.
    for _ in 0..3 {
        retained.revalidate(&c, &a).unwrap();
        assert_eq!(retained.owner_preflight(), &owner_preflight);
        assert_eq!(retained.preflight(), &wrapped_preflight);
        assert_eq!(retained.plan(), &plan);
        assert_eq!(
            retained.capture().evidence().retained_token.as_ref() as *const u64 as usize,
            evidence_address
        );
        assert_eq!(
            retained.capture().snapshots()[0]
                .original()
                .original
                .as_ptr() as usize,
            original_address
        );
    }
    assert_eq!(audit.captures.load(Ordering::SeqCst), 1);
    assert_eq!(audit.qualifications.load(Ordering::SeqCst), 4);
}
