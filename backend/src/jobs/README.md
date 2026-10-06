# HomeBox write jobs

This internal Rust migration component supplies typed enqueue, status lookup,
single-call dispatch, explicit retry classification and qualified reconciliation.
It has no production dependencies beyond `std`, starts no scheduler/listener,
and makes no provider call by itself. It does not change the published version-one
HTTP contract, which uses read projections and native HomeBox navigation.

`mod.rs` exports the jobs-local values in `model.rs`, injected ports in `ports.rs`
and the `WriteQueue` orchestration in `orchestrator.rs`. Scope adapters may map
the shared domain/access types to `SourcePartition` and `ReceiptKey`; no scope is
inferred from names, labels or an unqualified external ID. Collection spelling
is preserved. `JobSnapshot` omits prepared payload bytes and lease capabilities.
An acknowledgement preserves an explicitly unknown external ID/source date and
never publishes or freshens a HomeBox read generation.

The application authorizes each enqueue, receipt lookup and replay. The writer
must recheck current actor, source grant and quarantine state immediately before
dispatch. The actual access owner supplies those checks. The current component
has no authentication, credential storage, arbitrary URL/method configuration or
generic remote transport. `PreparedWrite` is owned opaque input from a reviewed
preparer; its Debug output reports payload length, not payload content.

## Durable storage seam

`QueueStore` is the production SQLite integration seam. Its documentation spells
out the transaction invariants. The key `(workspace, home, actor, mutation)` is
bound permanently to the entire exact prepared request, including partition,
contract ID, operation ID, target and every payload byte. A matching retry returns
the existing current job; different content must conflict. This exact prepared
byte comparison is internal queue idempotency and does not replace the published
Atlas command receipt's RFC 8785/SHA-256 canonicalization or record/audit result.
Storage must keep the binding after terminal completion; expiry cannot authorize
a duplicate physical write.

There is one persistent physical writer slot for all homes, workspaces,
instances and collections. Due jobs are selected by durable enqueue sequence.
An atomic claim reserves that slot, increments the job attempt and advances a
checked global fencing counter that survives process restart. An atomic finish
matches the active job and fence, persists the outcome and releases the slot
only after a definite outcome. The synchronous mutable ownership of `WriteQueue`
covers claim, writer call and finish; distinct instances rely on the shared
adapter's atomic global slot. The trait alone does not implement this exclusion.

Only `NotApplied { replay: AfterBackoff }`, backed by positive evidence that the
write did not apply, can schedule a retry. Backoff is bounded, deterministic and
subject to an explicit attempt budget. Overflow produces a terminal failure.
An uncertain result retains the slot and enters `NeedsReconciliation`. Lease
expiry also retains the slot instead of replacing the writer: a database fence
does not stop an already dispatched HomeBox operation. A returning original
writer may finish its same active held fence, but an obsolete fence is refused.

`HomeBoxReconciler` is a separate injected read-back capability. Releasing a hold
requires verified previous-writer quiescence plus a complete currently authorized
source read-back, with a private evidence reference retained in the resolution
transaction. An opaque reference is not evidence by itself. An unresolved result
preserves the hold; reconciliation never calls the writer. No qualified live
reconciler is implemented or claimed by this lane.

## Healthy synthetic evidence

`examples/sqlite_healthy.rs` implements a synthetic SQLite `QueueStore` consumer
with immediate mutation transactions, permanent receipt uniqueness, full request
comparison, one global slot and fence-checked completion. It is a readable
integration example, not the shared AT07 production storage adapter or a second
service framework. The two partition scopes and target ID are taken from
`packages/contracts/fixtures/plan-free.snapshot.json`. Its explicit prepared
dialect `at36-synthetic-prepared/1` is an opaque fake acknowledgement operation,
not a real HomeBox write schema.

The only executable example enqueues two healthy commands in separate homes,
replays the first exact receipt, succeeds once, closes and reopens its disposable
database, replays the persisted receipt, succeeds once for the second home and
observes an idle queue. It checks two writer calls, one durable global slot and
fencing progression across the clean restart. The temporary directory is created
exclusively and removed after success. No fault, rejection, uncertain-result,
crash, concurrency, denial, adversarial or negative-consumer control is executed.
Those branches are source-compiled, not behaviorally qualified here.

The scoped external compiler harness is
`/tmp/houseatlas-at36-jobs-harness/Cargo.toml`; its library path is this `mod.rs`
and its `healthy-queue` binary path is the checked-in example. Only that harness
depends on `rusqlite = { version = "=0.40.2", features = ["bundled"] }`, with its
Cargo.lock retained outside the checkout. Its observed SQLite version is 3.53.2
through locked `libsqlite3-sys` 0.38.2. No root manifest or lock is edited here.

After inspecting the sources, activate the retained runtime and run:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo fmt --check --manifest-path /tmp/houseatlas-at36-jobs-harness/Cargo.toml
cargo check --locked --manifest-path /tmp/houseatlas-at36-jobs-harness/Cargo.toml
cargo clippy --locked --manifest-path /tmp/houseatlas-at36-jobs-harness/Cargo.toml --all-targets -- -D warnings
cargo build --locked --manifest-path /tmp/houseatlas-at36-jobs-harness/Cargo.toml
cargo run --locked --manifest-path /tmp/houseatlas-at36-jobs-harness/Cargo.toml --bin healthy-queue
```

## Remaining integration inputs

AT07 must supply the shared production `QueueStore` adapter and atomic integration
with the authorized command/audit transaction. AT11 must supply current access
and source-quarantine checks. AT51 owns the real backend crate and dependency
lock. No shared root scaffolding is required to compile this scoped source.

Full wire3 has not been provided. Exact reviewed operation IDs, command payload
and result schemas, expected upstream preconditions, immutable idempotency
content and replay semantics, prepared payload validation and bounded source
driver/read-back interfaces must be reconciled before enabling provider writes.
No real provider dialect, source actor-history evidence, upstream CAS or native
route has been invented. This code and healthy example are not evidence of
live-provider, security, recovery-fault, pilot or deployment qualification.
