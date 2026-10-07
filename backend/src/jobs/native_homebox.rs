//! A native writer algorithm over qualified operation and transport peers.
//!
//! Compilation of this adapter establishes no per-operation qualification or
//! live readiness. The owner must enforce those gates, the exact native catalog
//! form, current authority/graph checks and durable physical queue admission.
//! This module opens no HTTP client, database, listener, file or credential.

use super::{
    ByteAccounting, ByteDisposition, Digest, DispatchReport, FailureCode, HomeBoxWriter,
    InvocationReport, InvokedRemoteActivity, LeasedJob, MetadataCommitEvidence,
    ReferenceClosureEvidence, StorageLiability, WriteOutcome,
};

/// Positive before-I/O failure bound to the original admitted job. Its liability
/// must retain all prior staged/reserved bytes and orphan/reference facts; a
/// denial or preparation error never implies cleanup or a zero reservation.
pub struct BeforeInvocationFailure {
    pub reason: FailureCode,
    pub storage_liability: StorageLiability,
}

#[derive(Clone, PartialEq, Eq)]
struct InvocationBinding {
    job: LeasedJob,
    native_payload_digest: Digest,
    journal_evidence_digest: Digest,
}

/// Single-use local capability bound to the exact persisted native intent.
/// Private fields and no Clone/Deserialize keep it out of request DTOs.
/// This is not provider-side fencing or a substitute for live admission checks.
pub struct InvocationPermit {
    binding: InvocationBinding,
}

impl InvocationPermit {
    pub fn job(&self) -> &LeasedJob {
        &self.binding.job
    }

    pub fn native_payload_digest(&self) -> &Digest {
        &self.binding.native_payload_digest
    }

    pub fn journal_evidence_digest(&self) -> &Digest {
        &self.binding.journal_evidence_digest
    }

    /// The transport positively knows that this invocation never started.
    /// Any already accepted/staged liability remains independently recorded.
    pub fn not_invoked<R>(
        self,
        reason: FailureCode,
        storage_liability: StorageLiability,
    ) -> TransportReceipt<R> {
        TransportReceipt {
            permit: self,
            result: TransportResult::NotInvoked {
                reason,
                storage_liability,
            },
        }
    }

    /// EndedProven must already contain correlated qualified termination proof.
    /// Neither a response nor this constructor establishes that proof.
    pub fn invoked<R>(
        self,
        acknowledgement: TransportAcknowledgement<R>,
        remote_activity: InvokedRemoteActivity,
        storage_liability: StorageLiability,
    ) -> TransportReceipt<R> {
        TransportReceipt {
            permit: self,
            result: TransportResult::Invoked {
                acknowledgement,
                remote_activity,
                storage_liability,
            },
        }
    }
}

/// Exact immutable owner-prepared route/body and its persisted invocation.
/// P is the native catalog owner's typed payload, never a wire-selected URL.
pub struct QualifiedInvocation<P> {
    permit: InvocationPermit,
    payload: P,
    prepared_storage_liability: StorageLiability,
}

impl<P> QualifiedInvocation<P> {
    /// Trusted owner construction ONLY after qualified queue admission and an
    /// atomic matching-lease journal commit, before physical I/O. The owner must
    /// prove the payload digest, concrete method/route, original intent/grants,
    /// observation/impact/approval binding and current graph/authority. These
    /// supplied proof references do not themselves mint authority/readiness.
    pub fn from_journaled_intent(
        job: &LeasedJob,
        payload: P,
        native_payload_digest: Digest,
        journal_evidence_digest: Digest,
        prepared_storage_liability: StorageLiability,
    ) -> Self {
        Self {
            permit: InvocationPermit {
                binding: InvocationBinding {
                    job: job.clone(),
                    native_payload_digest,
                    journal_evidence_digest,
                },
            },
            payload,
            prepared_storage_liability,
        }
    }

    pub fn permit(&self) -> &InvocationPermit {
        &self.permit
    }

    pub fn payload(&self) -> &P {
        &self.payload
    }

    /// Consumes the admitted operation. Transport must use the unchanged owned
    /// route/body and return this exact permit in its correlated receipt.
    pub fn into_parts(self) -> (InvocationPermit, P) {
        (self.permit, self.payload)
    }
}

/// A definite response is acknowledgement evidence, including error responses;
/// route verification still decides effects. Unknown transport results never
/// supply generic no-effect/replay or remote-end permission.
pub enum TransportAcknowledgement<R> {
    DefiniteResponse {
        response: R,
        response_digest: Digest,
    },
    Uncertain {
        reason: FailureCode,
    },
}

enum TransportResult<R> {
    NotInvoked {
        reason: FailureCode,
        storage_liability: StorageLiability,
    },
    Invoked {
        acknowledgement: TransportAcknowledgement<R>,
        remote_activity: InvokedRemoteActivity,
        storage_liability: StorageLiability,
    },
}

/// Constructed by consuming the original permit; no unbound receipt constructor.
pub struct TransportReceipt<R> {
    permit: InvocationPermit,
    result: TransportResult<R>,
}

/// Required qualified owner: no permissive implementation or default facts.
pub trait NativeOperationOwner {
    type Payload;
    type Response;

    /// Load the exact immutable durable stock intent/witness and original key;
    /// verify digest, current lease/physical owner, runtime/source/route gates,
    /// full current target/reference/impact graph, original observations/grants,
    /// finite clocks and approval-bound effects immediately before invocation.
    /// Do not refresh/substitute captured facts or spend approval in preparation.
    /// Bytes require prior qualified exclusive reservation. Persist exact native
    /// dispatch intent atomically before returning; no provider I/O under SQL.
    fn prepare_and_journal(
        &mut self,
        job: &LeasedJob,
    ) -> Result<QualifiedInvocation<Self::Payload>, BeforeInvocationFailure>;

    /// Required final check AFTER preparation/journaling and immediately before
    /// transport consumes the permit. Re-resolve current complete authority,
    /// observation/reference/impact and dispatch ownership against the original
    /// immutable facts without rebasing the native payload. No SQL transaction
    /// may remain open across the following transport invocation.
    fn authorize_dispatch(
        &mut self,
        job: &LeasedJob,
        invocation: &QualifiedInvocation<Self::Payload>,
    ) -> Result<(), BeforeInvocationFailure>;

    /// Verify the exact route response/generated identities and authorized
    /// correlated readback/impact against the original prepared graph. Persist
    /// full per-step evidence through the matching queue-finish transaction.
    /// Applied requires response plus readback agreement; no causal proof or
    /// cache refresh is implied. NotApplied/AfterBackoff requires positive exact
    /// route no-effect evidence. This method cannot change activity or liability.
    fn verify_effects(
        &mut self,
        job: &LeasedJob,
        permit: &InvocationPermit,
        acknowledgement: &TransportAcknowledgement<Self::Response>,
    ) -> WriteOutcome;
}

/// Consumes one exact admitted native request. No retries, redirects to another
/// provider database, method fallback or body rewriting are permitted. Recheck
/// current dispatch ownership/authority before I/O; positively denied work is
/// NotInvoked. Return only after all owned local I/O stops, without detached
/// writes. Remote termination still requires its separate qualified evidence.
pub trait PreparedTransport {
    type Payload;
    type Response;

    fn invoke(
        &mut self,
        invocation: QualifiedInvocation<Self::Payload>,
    ) -> TransportReceipt<Self::Response>;
}

/// One synchronous mutable writer composed from mandatory injected peers.
pub struct NativeHomeBoxWriter<O, T> {
    owner: O,
    transport: T,
}

impl<O, T> NativeHomeBoxWriter<O, T> {
    pub fn new(owner: O, transport: T) -> Self {
        Self { owner, transport }
    }

    pub fn into_parts(self) -> (O, T) {
        (self.owner, self.transport)
    }
}

impl<O, T> HomeBoxWriter for NativeHomeBoxWriter<O, T>
where
    O: NativeOperationOwner,
    T: PreparedTransport<Payload = O::Payload, Response = O::Response>,
{
    fn write(&mut self, job: &LeasedJob) -> DispatchReport {
        let invocation = match self.owner.prepare_and_journal(job) {
            Ok(invocation) => invocation,
            Err(failure) => {
                return DispatchReport::NotInvoked {
                    reason: failure.reason,
                    storage_liability: failure.storage_liability,
                };
            }
        };
        if invocation.permit.job() != job {
            return DispatchReport::NotInvoked {
                reason: FailureCode::InvalidPreparedPayload,
                // Unrelated preparation cannot replace the original reservation
                // with complete/zero accounting or establish byte cleanup.
                storage_liability: uncorrelated_liability(invocation.prepared_storage_liability),
            };
        }
        let expected = invocation.permit.binding.clone();
        let prepared_liability = invocation.prepared_storage_liability.clone();
        if let Err(failure) = self.owner.authorize_dispatch(job, &invocation) {
            return DispatchReport::NotInvoked {
                reason: failure.reason,
                storage_liability: failure.storage_liability,
            };
        }
        let receipt = self.transport.invoke(invocation);
        if receipt.permit.binding != expected {
            // An unrelated receipt cannot prove noninvocation, remote end, byte
            // release or effects for the operation that was actually submitted.
            return DispatchReport::Invoked(InvocationReport {
                outcome: WriteOutcome::Uncertain {
                    reason: FailureCode::OutcomeUnknown,
                },
                remote_activity: InvokedRemoteActivity::EndUnproven,
                storage_liability: uncorrelated_liability(prepared_liability),
            });
        }
        match receipt.result {
            TransportResult::NotInvoked {
                reason,
                storage_liability,
            } => DispatchReport::NotInvoked {
                reason,
                storage_liability,
            },
            TransportResult::Invoked {
                acknowledgement,
                remote_activity,
                storage_liability,
            } => {
                let verified = self
                    .owner
                    .verify_effects(job, &receipt.permit, &acknowledgement);
                let outcome = match (&acknowledgement, verified) {
                    (
                        TransportAcknowledgement::DefiniteResponse {
                            response_digest, ..
                        },
                        WriteOutcome::Applied(applied),
                    ) if *response_digest == applied.observation.response_digest => {
                        WriteOutcome::Applied(applied)
                    }
                    (_, WriteOutcome::Applied(_)) => WriteOutcome::Uncertain {
                        reason: FailureCode::OutcomeUnknown,
                    },
                    (_, outcome) => outcome,
                };
                DispatchReport::Invoked(InvocationReport {
                    outcome,
                    remote_activity,
                    storage_liability,
                })
            }
        }
    }
}

fn uncorrelated_liability(mut liability: StorageLiability) -> StorageLiability {
    let known_bytes = match liability.accounting {
        ByteAccounting::Complete { known_bytes, .. }
        | ByteAccounting::Incomplete { known_bytes } => known_bytes,
    };
    liability.accounting = ByteAccounting::Incomplete { known_bytes };
    liability.metadata_commit_evidence = MetadataCommitEvidence::Unknown;
    liability.byte_disposition = ByteDisposition::Unknown;
    liability.reference_closure_evidence = ReferenceClosureEvidence::Unassessed;
    liability
}
