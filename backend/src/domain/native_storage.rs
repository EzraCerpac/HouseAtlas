//! Concrete bridge to the assembled backend's native AT07 SQLite store.
//!
//! This changes no store authorization, transaction or receipt behavior. AT52
//! supplies the store's real contract/authority/runtime peers and the same pure
//! contract policy for frozen output validation; an unavailable command peer
//! stays unavailable. A command-capable host must retain the original principal
//! and grants under its transaction authority fence across every storage phase,
//! and reject new presence triggers until atomic witness composition exists.
//! The stock wire3 owner still needs its durable envelope/admission composition.
//! This bridge does not turn a frozen receipt into a durable stock intent receipt,
//! issue a provider invocation or enable new presence admission.

use super::{
    Audit, BatchResult, CanonicalBatch, CanonicalMutation, CommandPort, ContractPort,
    ContractShape, DomainError, DomainResult, MutationResult, ReadPort, Record, RecordRef, Scope,
    Snapshot,
};
use crate::storage::{self, AtlasStore, Authorization, Contract, Runtime};
use serde::{Serialize, de::DeserializeOwned};

/// A borrowed native store, keeping its original private connection and peers.
/// The exact server principal is forwarded unchanged; serde conversions below
/// apply only to frozen public carriers, never to authority or grant handles.
pub struct NativeStorage<'store, C: Contract, A: Authorization, R: Runtime> {
    store: &'store mut AtlasStore<C, A, R>,
    contracts: &'store C,
}

impl<'store, C: Contract, A: Authorization, R: Runtime> NativeStorage<'store, C, A, R> {
    /// Supply the host's same configured schema/profile for output validation.
    /// The store retains its private contract and authority; neither is rebound
    /// here, and this bridge cannot inspect their instance identity.
    /// No permissive validator or synthetic principal is supplied by this bridge.
    pub fn from_store(store: &'store mut AtlasStore<C, A, R>, contracts: &'store C) -> Self {
        Self { store, contracts }
    }
}

/// Frozen command binding to a borrowed native transaction authorizer.
///
/// AT52 constructs this inside its existing access mutation-authorization
/// callback. The supplied B must retain the original principal/grants and check
/// the native mutation context, phase and complete graph closure. This adapter
/// issues no authority and calls no access/read adapter that could reenter the
/// held fence. AT07 keeps its same private connection, contract, runtime and
/// transaction engine; it invokes B throughout the existing phase checks.
///
/// This is only a frozen CommandPort. It cannot execute a stock plan with its
/// required atomic original root/child envelopes, receipts or approval linkage.
pub struct NativeScopedCommands<
    'store,
    'authorization,
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: Authorization<Principal = A::Principal>,
> {
    store: &'store mut AtlasStore<C, A, R>,
    authorization: &'authorization B,
}

impl<'store, 'authorization, C, A, R, B> NativeScopedCommands<'store, 'authorization, C, A, R, B>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: Authorization<Principal = A::Principal>,
{
    pub fn from_store(
        store: &'store mut AtlasStore<C, A, R>,
        authorization: &'authorization B,
    ) -> Self {
        Self {
            store,
            authorization,
        }
    }
}

impl<C, A, R, B> CommandPort<A::Principal> for NativeScopedCommands<'_, '_, C, A, R, B>
where
    C: Contract,
    A: Authorization,
    R: Runtime,
    B: Authorization<Principal = A::Principal>,
{
    fn execute(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &CanonicalMutation,
    ) -> DomainResult<MutationResult> {
        let native_scope = carrier(scope)?;
        let native_target = carrier(target)?;
        let result = self
            .store
            .execute_json_with_authorization(
                self.authorization,
                principal,
                &native_scope,
                &native_target,
                command.wire(),
            )
            .map_err(native_error)?;
        carrier(&result)
    }

    fn execute_batch(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        batch: &CanonicalBatch,
    ) -> DomainResult<BatchResult> {
        let native_scope = carrier(scope)?;
        let result = self
            .store
            .execute_batch_json_with_authorization(
                self.authorization,
                principal,
                &native_scope,
                batch.wire(),
            )
            .map_err(native_error)?;
        carrier(&result)
    }
}

impl<C: Contract, A: Authorization, R: Runtime> ReadPort<A::Principal>
    for NativeStorage<'_, C, A, R>
{
    fn snapshot(&mut self, principal: &A::Principal, scope: &Scope) -> DomainResult<Snapshot> {
        let native_scope = carrier(scope)?;
        let snapshot = self
            .store
            .read_snapshot(principal, &native_scope)
            .map_err(native_error)?;
        self.validate_output("snapshot", &snapshot)?;
        self.contracts
            .validate_snapshot(&snapshot)
            .map_err(output_error)?;
        carrier(&snapshot)
    }

    fn record(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Record> {
        let native_scope = carrier(scope)?;
        let native_target = carrier(target)?;
        let record = self
            .store
            .read_record(principal, &native_scope, &native_target)
            .map_err(native_error)?;
        self.validate_output("record", &record)?;
        carrier(&record)
    }

    fn history(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Vec<Audit>> {
        let native_scope = carrier(scope)?;
        let native_target = carrier(target)?;
        let audits = self
            .store
            .history(principal, &native_scope, &native_target)
            .map_err(native_error)?;
        for audit in &audits {
            self.validate_output("audit", audit)?;
        }
        // Retain the real audit sequence, including an empty seeded history.
        carrier(&audits)
    }
}

/// Frozen input validation through the host's native pure contract policy.
/// HTTP duplicate-key, size and lexical numeric admission remains at AT51/52's
/// boundary before these immutable parsed Values reach the domain component.
pub struct NativeCanonicalContracts<'contracts, C: Contract> {
    contracts: &'contracts C,
}

impl<'contracts, C: Contract> NativeCanonicalContracts<'contracts, C> {
    pub fn from_contracts(contracts: &'contracts C) -> Self {
        Self { contracts }
    }
}

impl<C: Contract> ContractPort for NativeCanonicalContracts<'_, C> {
    fn validate(&self, shape: ContractShape, value: &serde_json::Value) -> DomainResult<()> {
        let name = match shape {
            ContractShape::RecordRef => "recordRef",
            ContractShape::Mutation => "mutation",
            ContractShape::BatchMutation => "batchMutation",
        };
        self.contracts
            .validate_shape(name, value)
            .map_err(native_error)
    }
}

impl<C: Contract, A: Authorization, R: Runtime> NativeStorage<'_, C, A, R> {
    fn validate_output(&self, shape: &str, value: &impl Serialize) -> DomainResult<()> {
        let value = serde_json::to_value(value).map_err(|_| DomainError::UpstreamIncomplete)?;
        self.contracts
            .validate_shape(shape, &value)
            .map_err(output_error)
    }
}

impl<C: Contract, A: Authorization, R: Runtime> CommandPort<A::Principal>
    for NativeStorage<'_, C, A, R>
{
    fn execute(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        target: &RecordRef,
        command: &CanonicalMutation,
    ) -> DomainResult<MutationResult> {
        let native_scope = carrier(scope)?;
        let native_target = carrier(target)?;
        let result = self
            .store
            .execute_json(principal, &native_scope, &native_target, command.wire())
            .map_err(native_error)?;
        carrier(&result)
    }

    fn execute_batch(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        batch: &CanonicalBatch,
    ) -> DomainResult<BatchResult> {
        let native_scope = carrier(scope)?;
        let result = self
            .store
            .execute_batch_json(principal, &native_scope, batch.wire())
            .map_err(native_error)?;
        carrier(&result)
    }
}

fn carrier<T: DeserializeOwned>(value: &impl Serialize) -> DomainResult<T> {
    serde_json::from_value(serde_json::to_value(value).map_err(|_| DomainError::InvalidContract)?)
        .map_err(|_| DomainError::UpstreamIncomplete)
}

// Persisted output incompatibility is not a bad caller contract, missing caller
// target or caller permission denial. Preserve actual validator unavailability.
fn output_error(error: storage::Error) -> DomainError {
    match native_error(error) {
        DomainError::UpstreamUnavailable => DomainError::UpstreamUnavailable,
        _ => DomainError::UpstreamIncomplete,
    }
}

/// Native errors currently carry no authorized revision field. Keep that field
/// unknown; a detached read must not invent the revision of a failed transaction.
pub fn native_error(error: storage::Error) -> DomainError {
    match error.code {
        "unauthenticated" => DomainError::Unauthenticated,
        "invalid-contract" => DomainError::InvalidContract,
        "revision-required" => DomainError::RevisionRequired {
            current_revision: None,
        },
        "revision-conflict" => DomainError::RevisionConflict {
            current_revision: None,
        },
        "guard-conflict" => DomainError::GuardConflict {
            current_revision: None,
        },
        "identity-conflict" => DomainError::IdentityConflict,
        "idempotency-conflict" => DomainError::IdempotencyConflict,
        "invalid-transition" => DomainError::InvalidTransition,
        "not-found" => DomainError::NotFound,
        "forbidden" => DomainError::Forbidden,
        "schema-incompatible" | "upstream-incomplete" => DomainError::UpstreamIncomplete,
        _ => DomainError::UpstreamUnavailable,
    }
}
