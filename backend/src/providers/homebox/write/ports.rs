use super::{EntityRef, MappedWrite, PartitionScope, WriteCommand};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use uuid::Uuid;

/// Returned by the verified access peer, never taken from a command body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuthorizedActor {
    pub actor_id: Uuid,
    /// Opaque source epoch issued by the access peer. Drivers must check it
    /// against their current source binding before performing I/O.
    pub source_epoch: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuthorizationDenied;

#[derive(Clone, Copy, Debug)]
pub enum AuthorizationRequest<'a> {
    Execute {
        command: &'a WriteCommand,
        catalog: &'a super::CatalogIdentity,
    },
    Reconcile {
        target: &'a EntityRef,
        operation_id: Uuid,
    },
}

impl AuthorizationRequest<'_> {
    pub fn target(&self) -> &EntityRef {
        match self {
            Self::Execute { command, .. } => &command.target,
            Self::Reconcile { target, .. } => target,
        }
    }
}

/// Must revalidate current write capability, exact target/source partition,
/// reviewed allowlist, epoch and quarantine for every execute/reconcile call.
/// HTTP authentication, CSRF and source credentials remain with AT11/AT51.
pub trait AuthorizationPort {
    fn authorize(
        &self,
        request: AuthorizationRequest<'_>,
    ) -> impl Future<Output = Result<AuthorizedActor, AuthorizationDenied>> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchEvidence {
    Acknowledged {
        scope: PartitionScope,
    },
    /// Only use when the exact catalog/driver proves no write occurred. A
    /// generic HTTP error status is not sufficient evidence.
    ConfirmedNoWrite {
        scope: PartitionScope,
    },
    /// Only use when the driver can prove it never sent the provider request.
    NotDispatched,
    /// Includes timeouts, lost replies and any unclassified provider response.
    Unknown,
}

/// One bounded invocation. The driver must never automatically retry writes,
/// refuse redirects, bind the registered source/tenant, and keep all raw
/// responses/credentials out of these typed results. A real driver must refuse
/// SyntheticOnly catalogs and enforce the current authorization epoch. Future
/// cancellation must not cause driver retries. No client is supplied here.
pub trait DispatchPort {
    fn dispatch(
        &self,
        mapped: &MappedWrite,
        authority: AuthorizedActor,
    ) -> impl Future<Output = DispatchEvidence> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadbackEvidence {
    Observed {
        target: EntityRef,
        value: Value,
        retrieved_at: String,
        source_updated_at: Option<String>,
    },
    /// Missing is an observation, not confirmation of deletion or no write.
    Missing {
        target: EntityRef,
    },
    Unavailable,
}

/// A source-bound bounded GET and validated field decoder. Preserve original
/// source dates and retrieval dates. The receipt comes from the trusted driver,
/// not presumed provider headers. Reads are nontransactional observations.
/// Enforce the current authorization epoch, refuse synthetic catalogs in a
/// real driver, and cancel pending bounded I/O when the future is dropped.
pub trait ReadbackPort {
    fn readback(
        &self,
        mapped: &MappedWrite,
        authority: AuthorizedActor,
    ) -> impl Future<Output = ReadbackEvidence> + Send;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DispatchState {
    Acknowledged,
    ConfirmedNoWrite,
    NotDispatched,
    Unknown,
}

impl DispatchState {
    /// Unknown evidence may be refined by recorded dispatch evidence. A known
    /// classification cannot be replaced by a conflicting classification.
    pub fn permits_refinement_to(self, later: Self) -> bool {
        self == Self::Unknown || self == later
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObservationState {
    Matches,
    Differs,
    Missing,
    Unavailable,
    WrongScope,
    NotRequested,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub state: ObservationState,
    pub retrieved_at: Option<String>,
    pub source_updated_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteOutcome {
    pub dispatch: DispatchState,
    pub observation: Observation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeStatus {
    /// Paired evidence, without a temporal ordering or causation guarantee.
    AcknowledgedAndObserved,
    AcknowledgedUnverified,
    UnknownOutcome,
    ConfirmedNoWrite,
    NotDispatched,
}

impl WriteOutcome {
    pub fn status(&self) -> OutcomeStatus {
        match (self.dispatch, self.observation.state) {
            (DispatchState::Acknowledged, ObservationState::Matches) => {
                OutcomeStatus::AcknowledgedAndObserved
            }
            (DispatchState::Acknowledged, _) => OutcomeStatus::AcknowledgedUnverified,
            (DispatchState::Unknown, _) => OutcomeStatus::UnknownOutcome,
            (DispatchState::ConfirmedNoWrite, _) => OutcomeStatus::ConfirmedNoWrite,
            (DispatchState::NotDispatched, _) => OutcomeStatus::NotDispatched,
        }
    }
}

/// Separate provider activity, not an Atlas record mutation, revision, receipt,
/// or schema-1 audit entry. Bodies contain only the catalog-mapped field value;
/// no transport response/error/headers are stored by this component.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteAttempt {
    pub actor_id: Uuid,
    pub command: WriteCommand,
    pub mapped: MappedWrite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityRecord {
    pub attempt: WriteAttempt,
    /// Private activity version, not an Atlas revision or provider CAS token.
    pub activity_version: u64,
    /// None means dispatch was durably reserved and may have been sent. It is
    /// never permission to send it again, including after process cancellation.
    pub outcome: Option<WriteOutcome>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reservation {
    Reserved(Box<ActivityRecord>),
    Existing(Box<ActivityRecord>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityFault {
    Unavailable,
    ContentConflict,
    VersionConflict,
}

/// AT07 must provide durable atomic reserve before external dispatch. The key
/// is (workspace, home, actor, operation_id); the complete attempt binds source,
/// target, intent, catalog and request bytes. Retain it without expiry that
/// could enable re-dispatch. Existing records must be returned on retries, and
/// different content under one key must conflict. This is local duplicate
/// suppression, not provider idempotency or an all-writer lock/CAS guarantee.
///
/// A reservation starts at activity_version 1. record_dispatch atomically merges
/// dispatch evidence against the exact attempt, independent of an earlier
/// observation version: Unknown may become known, known evidence never regresses
/// or changes to a conflicting classification, and existing observations remain.
/// It increments the current activity version once. This retains acknowledgement
/// even when a reconciliation has observed an unresolved reservation meanwhile.
///
/// save_outcome atomically requires
/// the expected activity version and exact attempt, then increments the private
/// activity version once. VersionConflict must leave the activity unchanged.
/// This prevents an earlier reconciliation from overwriting newer evidence;
/// it must also preserve an existing dispatch classification (or initialize
/// Unknown for a previously unresolved reservation).
/// it supplies no upstream CAS guarantee. load filters the full target/source
/// and actor after authorization.
/// The storage peer owns sequence/timestamps, durable integrity and any
/// append-only activity journal. The component never writes Atlas audit history.
pub trait ActivityPort {
    fn reserve(
        &self,
        attempt: &WriteAttempt,
    ) -> impl Future<Output = Result<Reservation, ActivityFault>> + Send;

    fn record_dispatch(
        &self,
        attempt: &WriteAttempt,
        dispatch: DispatchState,
    ) -> impl Future<Output = Result<ActivityRecord, ActivityFault>> + Send;

    fn save_outcome(
        &self,
        attempt: &WriteAttempt,
        expected_activity_version: u64,
        outcome: &WriteOutcome,
    ) -> impl Future<Output = Result<ActivityRecord, ActivityFault>> + Send;

    fn load(
        &self,
        actor: AuthorizedActor,
        target: &EntityRef,
        operation_id: Uuid,
    ) -> impl Future<Output = Result<Option<ActivityRecord>, ActivityFault>> + Send;
}
