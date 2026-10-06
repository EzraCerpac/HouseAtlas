# HomeBox write jobs

The stock.2 Rust component supplies metadata admission, typed queue inspection,
single physical dispatch, explicit safe retry classification, logical effect
reconciliation and separate correlated termination recording. Production source
uses only `std`; there is no transport, listener, scheduler or credential store.
The source composes the adopted agent wire3 semantics without replacing the
frozen Atlas record/audit schema or inventing provider CAS.

`model.rs` defines jobs-local values and `orchestrator.rs` owns mutable ports.
`stock.rs` provides physical registration/alias normalization, typed logical
scopes, remote activity, storage accounting, explicit profiles and the pure
`decide_admission` classifier. `ports.rs` states the shared SQLite/access/provider
integration requirements. These internal values require adapters to the exact
closed wire3 DTOs; they are not automatically serialized HTTP contracts.

## Identity and waiting metadata

Trusted installation supplies `QueueRegistration`: deployment ID, actual physical
provider database ID, configuration digest, dispatcher owner and all source aliases.
A queued request cannot choose an alternate physical database. Aliases resolve
complete registered partitions to canonical physical collection identities.
Collection scopes overlap contained resources; resource scopes overlap matching
kind/ID pairs. Alias comparison uses the canonical collection, so two transports
for the same physical collection do not escape logical overlap checks.

All provider-mutating jobs and transports join one durable invocation slot per
actual physical database. Classification follows qualified operation semantics,
including GET operations with physical effects such as printing. Reads, inference,
preparation and Atlas-local CAS need no physical invocation slot.

`EnqueueRequest` contains bounded intent metadata, the exact accepted canonical
request digest, full partition, derived write scope and pending byte liability.
It contains no uploaded body or staged bytes. Waiting output always has
`bodyAccepted=false`. Domain contract validation derives the digest with the
stock.2 root-only exclusions and preserves ordered child intent; queue storage
permanently binds actor/home/idempotency key to it and immutable metadata. Lookup
and retained receipt disclosure require current authorization.

`QueueStore` must recompute admission and reserve qualified liabilities in the
same SQLite transaction that admits the exclusive dispatcher. Waiting capacity
and FIFO metadata ordering are explicit. `max_admission_wait_ms` finalizes only
never-dispatched metadata attempts, retaining their keys/results. Expiry cannot
finalize actual invocations or release their activity, logical fences or bytes.
No upload bytes may be accepted or staged until exclusive admission plus the
qualified reservation. The injected writer resolves the approved immutable
intent, persists its exact dispatch form before physical I/O and rechecks current
actor/home/source/resource authority, observation, impact and approvals.

## Independent activity, effects and storage

An invoked report carries only `Active`, `EndUnproven` or `EndedProven` remote
activity. `NotDispatched` belongs to a positively never-invoked result. Only
qualified correlated termination evidence permits `EndedProven`; a successful
response, matching readback, timeout, local cancellation, expiry or human effect
resolution does not establish remote end.

Atomic finish matches the original physical identity, owner and durable fence.
It persists logical outcome, remote activity and byte/orphan liability separately.
Confirmed observed effects may still retain the physical invocation hold.
Conversely, a proven ended invocation can release its physical slot while unknown
or partial logical effects retain narrower overlap fences. A disjoint operation
can then proceed only if other admission requirements also pass.

Logical reconciliation records current-state observation or audited human
resolution and preserves remote activity and storage liability. The separate
`prove_remote_end` method releases only the exact correlated physical invocation
hold; it cannot reconcile effects, drop logical fences, purge bytes or resend work.
The synchronous completion clock is sampled and validated after reconciliation
returns. Retry timing and persistence use that completion time. A matching
acknowledgement survives backwards persisted timestamps using
`max(now, prior.updated_at)`; exact fence validation remains independent.

A retry requires positive route-qualified knowledge of non-application, explicit
`AfterBackoff` permission, proven remote end and remaining attempt budget. It
never follows ambiguity merely because an error looks retryable. Reconciliation
stores its evidence independently of dispatch-visible retry scheduling. Neither
human effect resolution nor database takeover authorizes ambiguous redispatch.

`StorageLiability` preserves metadata commit evidence, byte disposition,
reference closure evidence, orphan identity and unresolved attempt count.
Incomplete accounting has `reservedBytes=None`. No inferred zero, age, missing
row, filename or hash gives cleanup authority. Pending upload reservation and
aggregate unresolved liabilities are separate admission inputs.

Claim and finish reports cannot replace prior attempts' retained liability.
The synthetic SQLite adapter now keeps append-only liability evidence by the
original fence, including every orphan reference. It computes checked sums of
per-attempt known/reserved bytes and unresolved counts; within an attempt it
retains conservative maxima and never upgrades incomplete accounting. This
can overreserve and provides no cleanup authority. Reconciliation and remote
end proof leave this ledger unchanged. This correction is compiler-only;
retry/replay and failure controls remain held.

`native_homebox.rs` provides `NativeHomeBoxWriter<Owner,Transport>` over mandatory
typed peers. The owner loads the original durable intent and journals the exact
qualified native dispatch before returning a single-use invocation. A separate
required final `authorize_dispatch` runs immediately before the transport consumes
that invocation. Exact original job/lease/payload/journal binding is checked;
response acknowledgement, verified effects, remote termination and liability
stay independent. This is executable adapter logic over injected transport,
not a concrete route/body qualification, production journal implementation or
live provider capability. Unknown acknowledgement cannot become Applied and
an Applied result requires the matching definite response digest.

## Profiles and qualification

`AdmissionProfile::stock_engineering_fixture()` explicitly selects the offline
profile: one active invocation, four metadata waiters, 10 seconds admission wait,
four unresolved storage attempts and 64 MiB reserved liabilities. These numbers
are unmeasured, not user-selected and not production-qualified. There is no
`Default` production profile. A deployment profile requires an injected trusted
qualification and concrete limits; code approval does not supply qualification.

Shared AT07 storage must implement the atomic queue, intent/audit composition,
permanent receipts and coherent recovery. AT11 supplies current access/registration
facts. Provider peers supply route-qualified preparation, immutable dispatch intent,
bounded media intake, exact response/readback correlation and termination evidence.
The SQLite adapter below remains synthetic. No peer is treated as live-qualified
by this component, and no provider-side/all-writer fence or causal proof is claimed.

## Compiler-only example and evidence

`examples/sqlite_healthy.rs` and `examples/sqlite_store.rs` compose a synthetic
SQLite consumer with metadata-only waiting, trusted aliases, one persistent slot,
fenced finish, independent activity/effect/liability persistence and a clean reopen.
They are explicitly compiler-only under the current instruction. Do not execute
this example. Historical queue-example execution belongs solely to the earlier
pre-stock checkpoint; its original source hashes, patch and report are preserved
outside the checkout. It does not qualify this delta or release stopped controls.

The separate external harness is
`/tmp/houseatlas-at36-jobs-stock-harness/Cargo.toml`. Production remains std-only;
the example alone uses pinned `rusqlite = "=0.40.2"` with bundled SQLite through
locked `libsqlite3-sys` 0.38.2. No new application SQLite version is claimed from
compiler-only work. Root manifests and locks are owned by the coordinator.

Inspected compiler checks are:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo fmt --check --manifest-path /tmp/houseatlas-at36-jobs-stock-harness/Cargo.toml
cargo check --locked --manifest-path /tmp/houseatlas-at36-jobs-stock-harness/Cargo.toml --all-targets
cargo clippy --locked --manifest-path /tmp/houseatlas-at36-jobs-stock-harness/Cargo.toml --all-targets -- -D warnings
cargo build --locked --manifest-path /tmp/houseatlas-at36-jobs-stock-harness/Cargo.toml
```

No example, replay, rejection, expiry, fault, crash, concurrency, adversarial or
negative-consumer control is executed for this delta. Compiler success does not
establish operational recovery, full security, actual provider, pilot or deployment
qualification. Exact wire3 source forms are now available; remaining blockers are
qualified production adapters and their reviewed composition, rather than a
missing contract archive.
