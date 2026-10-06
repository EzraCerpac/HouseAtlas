//! One explicitly named healthy synthetic example group. These peers are
//! in-memory stand-ins, not production authorization, transport or storage.

use super::*;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::future::Future;
use std::pin::pin;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};
use uuid::Uuid;

const METADATA: &str =
    include_str!("../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json");
const HISTORY: &str =
    include_str!("../../../../../packages/contracts/history/fixtures/recorded.audit-array.json");

type ReceiptKey = (Uuid, Uuid, Uuid, Uuid);

struct SyntheticState {
    entity: Value,
    activity: HashMap<ReceiptKey, ActivityRecord>,
    calls: Vec<StockRequest>,
    readbacks: usize,
}

struct SyntheticPeers {
    target: EntityRef,
    actor: AuthorizedActor,
    state: Mutex<SyntheticState>,
}

impl SyntheticPeers {
    fn key(attempt: &WriteAttempt) -> ReceiptKey {
        (
            attempt.command.target.workspace_id,
            attempt.command.target.home_id,
            attempt.actor_id,
            attempt.command.operation_id,
        )
    }
}

impl AuthorizationPort for SyntheticPeers {
    async fn authorize(
        &self,
        request: AuthorizationRequest<'_>,
    ) -> Result<AuthorizedActor, AuthorizationDenied> {
        assert_eq!(request.target(), &self.target);
        Ok(self.actor)
    }
}

impl ActivityPort for SyntheticPeers {
    async fn reserve(&self, attempt: &WriteAttempt) -> Result<Reservation, ActivityFault> {
        let mut state = self.state.lock().unwrap();
        let key = Self::key(attempt);
        if let Some(record) = state.activity.get(&key) {
            if record.attempt != *attempt {
                return Err(ActivityFault::ContentConflict);
            }
            return Ok(Reservation::Existing(Box::new(record.clone())));
        }
        let record = ActivityRecord {
            attempt: attempt.clone(),
            activity_version: 1,
            outcome: None,
        };
        state.activity.insert(key, record.clone());
        Ok(Reservation::Reserved(Box::new(record)))
    }

    async fn record_dispatch(
        &self,
        attempt: &WriteAttempt,
        dispatch: DispatchState,
    ) -> Result<ActivityRecord, ActivityFault> {
        let mut state = self.state.lock().unwrap();
        let record = state.activity.get_mut(&Self::key(attempt)).unwrap();
        assert_eq!(record.attempt, *attempt);
        if let Some(outcome) = &mut record.outcome {
            if outcome.dispatch.permits_refinement_to(dispatch) {
                outcome.dispatch = dispatch;
            } else if !dispatch.permits_refinement_to(outcome.dispatch) {
                return Err(ActivityFault::ContentConflict);
            }
        } else {
            record.outcome = Some(WriteOutcome {
                dispatch,
                observation: Observation {
                    state: ObservationState::NotRequested,
                    retrieved_at: None,
                    source_updated_at: None,
                },
            });
        }
        record.activity_version = record.activity_version.checked_add(1).unwrap();
        Ok(record.clone())
    }

    async fn save_outcome(
        &self,
        attempt: &WriteAttempt,
        expected_activity_version: u64,
        outcome: &WriteOutcome,
    ) -> Result<ActivityRecord, ActivityFault> {
        let mut state = self.state.lock().unwrap();
        let record = state.activity.get_mut(&Self::key(attempt)).unwrap();
        assert_eq!(record.attempt, *attempt);
        if record.activity_version != expected_activity_version {
            return Err(ActivityFault::VersionConflict);
        }
        record.activity_version = record.activity_version.checked_add(1).unwrap();
        record.outcome = Some(outcome.clone());
        Ok(record.clone())
    }

    async fn load(
        &self,
        actor: AuthorizedActor,
        target: &EntityRef,
        operation_id: Uuid,
    ) -> Result<Option<ActivityRecord>, ActivityFault> {
        assert_eq!(target, &self.target);
        assert_eq!(actor, self.actor);
        Ok(self
            .state
            .lock()
            .unwrap()
            .activity
            .get(&(
                target.workspace_id,
                target.home_id,
                actor.actor_id,
                operation_id,
            ))
            .cloned())
    }
}

impl DispatchPort for SyntheticPeers {
    async fn dispatch(&self, mapped: &MappedWrite, authority: AuthorizedActor) -> DispatchEvidence {
        assert_eq!(
            mapped.catalog.qualification,
            CatalogQualification::SyntheticOnly
        );
        assert_eq!(authority, self.actor);
        let request = &mapped.request;
        let mut state = self.state.lock().unwrap();
        // The reservation exists before any synthetic provider effect.
        assert!(state.activity.values().any(|record| {
            record.attempt.mapped.request == *request && record.outcome.is_none()
        }));
        assert_eq!(request.scope, self.target.partition());
        assert_eq!(request.method, WriteMethod::Patch);
        let payload: Value = serde_json::from_slice(&request.body).unwrap();
        let fields = payload.as_object().unwrap();
        assert_eq!(fields.len(), 1);
        for (field, value) in fields {
            assert_eq!(
                request.path.as_str(),
                format!(
                    "/api/v1/synthetic-write-fixture/entities/{}/{}",
                    self.target.key.external_id, field
                )
            );
            state.entity[field] = value.clone();
        }
        state.calls.push(request.clone());
        DispatchEvidence::Acknowledged {
            scope: self.target.partition(),
        }
    }
}

impl ReadbackPort for SyntheticPeers {
    async fn readback(&self, mapped: &MappedWrite, authority: AuthorizedActor) -> ReadbackEvidence {
        assert_eq!(authority, self.actor);
        assert_eq!(
            mapped.catalog.qualification,
            CatalogQualification::SyntheticOnly
        );
        let request = &mapped.readback;
        assert_eq!(request.target, self.target);
        assert_eq!(
            request.path.as_str(),
            format!("/api/v1/entities/{}", self.target.key.external_id)
        );
        let mut state = self.state.lock().unwrap();
        state.readbacks += 1;
        ReadbackEvidence::Observed {
            target: self.target.clone(),
            value: state.entity[request.field.as_str()].clone(),
            retrieved_at: "2026-01-02T12:00:00Z".into(),
            source_updated_at: state.entity["updatedAt"].as_str().map(str::to_owned),
        }
    }
}

// All synthetic peers complete immediately; no executor, socket or timer.
fn ready<F: Future>(future: F) -> F::Output {
    let mut context = Context::from_waker(Waker::noop());
    match pin!(future).as_mut().poll(&mut context) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("healthy fixture peers must complete immediately"),
    }
}

#[test]
fn healthy_synthetic_entity_field_writes() {
    let metadata: Value = serde_json::from_str(METADATA).unwrap();
    let registration = &metadata["sourceRegistration"];
    let entity = metadata["entities"][0].clone();
    let target: EntityRef = serde_json::from_value(json!({
        "workspaceId": registration["workspaceId"],
        "homeId": registration["homeId"],
        "key": {
            "sourceInstanceId": registration["sourceInstanceId"],
            "collectionId": registration["collectionId"],
            "sourceKind": "homebox-entity",
            "externalId": entity["id"]
        }
    }))
    .unwrap();
    let mapper = CatalogMapper::new(
        CatalogIdentity {
            contract_version: "at37-single-field-synthetic/1".into(),
            provider_version: "synthetic-only".into(),
            qualification: CatalogQualification::SyntheticOnly,
        },
        [
            (EntityField::Name, "name"),
            (EntityField::Archived, "archived"),
        ]
        .into_iter()
        .map(|(field, wire_field)| SingleFieldOperation {
            field,
            method: WriteMethod::Patch,
            write_route: EntityRoute::new(format!(
                "/api/v1/synthetic-write-fixture/entities/{{entityId}}/{wire_field}"
            ))
            .unwrap(),
            body_field: FieldName::new(wire_field).unwrap(),
            readback_route: EntityRoute::new("/api/v1/entities/{entityId}").unwrap(),
            readback_field: FieldName::new(wire_field).unwrap(),
        })
        .collect(),
    )
    .unwrap();
    let peers = SyntheticPeers {
        target: target.clone(),
        actor: AuthorizedActor {
            actor_id: Uuid::parse_str("00000000-0000-4000-8000-000000000050").unwrap(),
            source_epoch: 7,
        },
        state: Mutex::new(SyntheticState {
            entity: entity.clone(),
            activity: HashMap::new(),
            calls: Vec::new(),
            readbacks: 0,
        }),
    };
    let writer = HomeBoxWriter {
        mapper: &mapper,
        authorization: &peers,
        dispatch: &peers,
        readback: &peers,
        activity: &peers,
    };
    for (operation_id, change) in [
        (
            "00000000-0000-4000-8000-000000002037",
            EntityChange::Name("Synthetic renamed cupboard".into()),
        ),
        (
            "00000000-0000-4000-8000-000000002038",
            EntityChange::Archived(true),
        ),
    ] {
        let result = ready(writer.execute(WriteCommand {
            operation_id: Uuid::parse_str(operation_id).unwrap(),
            target: target.clone(),
            change,
        }))
        .unwrap();
        assert!(!result.reused);
        assert_eq!(result.activity.activity_version, 3);
        let outcome = result.activity.outcome.as_ref().unwrap();
        assert_eq!(outcome.status(), OutcomeStatus::AcknowledgedAndObserved);
        assert_eq!(
            outcome.observation.source_updated_at.as_deref(),
            entity["updatedAt"].as_str()
        );
        assert_eq!(
            outcome.observation.retrieved_at.as_deref(),
            Some("2026-01-02T12:00:00Z")
        );
        let serialized = serde_json::to_vec(&result.activity).unwrap();
        let persisted: ActivityRecord = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(persisted, result.activity);
    }
    // Explicit healthy reconciliation is a further authorized GET observation.
    let reconciled = ready(writer.reconcile(
        &target,
        Uuid::parse_str("00000000-0000-4000-8000-000000002038").unwrap(),
    ))
    .unwrap();
    assert_eq!(reconciled.activity_version, 4);
    assert_eq!(
        reconciled.outcome.unwrap().status(),
        OutcomeStatus::AcknowledgedAndObserved
    );
    let state = peers.state.lock().unwrap();
    assert_eq!(state.calls.len(), 2);
    assert_eq!(state.readbacks, 3);
    assert_eq!(state.activity.len(), 2);
    assert_eq!(state.entity["entityType"], entity["entityType"]);
    assert_eq!(state.entity["parent"], Value::Null);
    assert_eq!(state.entity["attachments"], entity["attachments"]);
    assert_eq!(state.entity["name"], "Synthetic renamed cupboard");
    assert_eq!(state.entity["archived"], true);

    // Existing Atlas audit fixture remains a separate recorded circuit create.
    // This is fixture reuse, not a claim of live history/storage integration.
    let history: Value = serde_json::from_str(HISTORY).unwrap();
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(history[0]["schemaVersion"], 1);
    assert_eq!(history[0]["record"]["recordType"], "circuit");
    assert_eq!(history[0]["operation"], "create");
    println!(
        "AT37 healthy synthetic: 2 field mappings, 2 reserved dispatches, 3 scoped readbacks including explicit reconciliation, 2 activity rows; published arbitrary type, null parent, attachments and source dates preserved; Atlas audit fixture separate; peers in memory; no live provider"
    );
}
