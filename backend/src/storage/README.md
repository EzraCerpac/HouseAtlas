# Rust record persistence (AT07)

Based only on published `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. This lane owns
`backend/src/storage/**` and `backend/migrations/**`. Root manifests, locks and
generated contracts remain AT51-owned. No private ancestry or live migration is
included.

## Integration ports

Expose `pub mod storage` from the backend crate. `AtlasStore<C, A, R>` owns one
connection; operations take `&mut self`, preventing safe nested calls. The store
does not export a connection, raw SQL, listener or provider transport. Dropping
an unsuccessful transaction rolls back its write set.

`Contract` in `ports.rs` requires the published pure shape, graph, transition,
guard, final-command and result validators, plus RFC 8785 canonical JSON. These
methods have no permissive defaults. Payload hashing is SHA-256 of that canonical
JSON, including ECMAScript numbers and UTF-16 key order. `Prior` distinguishes
an unspecified retained-result preimage, explicit absence, and a supplied record.
The local carriers in `types.rs` preserve published wire names and schema 1;
they are a narrow storage port pending reconciliation with AT51's generated
types, not a replacement schema generation pipeline. Payloads and source/cache
projection rows remain exact JSON data, validated by the contract peer.

`Authorization` supplies a server-owned principal type and synchronously returns
verified scope/actor claims. There is no default allow adapter. Mutation requests
include borrowed detached `MutationAuthorizationContext` data with the exact
published format, closure, source partitions, original graph, candidate,
preconditions and captured cache epochs. They expose no mutable store facts.
The real access/core adapter must keep its branded grant handles across phases,
check all supplied closure refs/partitions, and revalidate those handles at
precommit. Reacquiring authority at precommit does not establish grant continuity.
Record/history/manifest reads require exact target authorization; snapshot reads
require whole-home graph permission. Every configured source partition and each
visible projection/relation endpoint receive independent `ReadCache` checks.
Partition denial creates response-only revoked metadata without writing an epoch
or hiding denial as permitted empty inventory.

`Runtime` supplies one timestamp per command transaction, fresh context/audit
IDs, and trusted immutable staged-asset verification. Available active assets
require matching staged-byte SHA-256 and byte size; storage opens no media path.

Public operations are `open`, `initialize_synthetic`, `execute`, `execute_batch`,
`execute_json`, `execute_batch_json`, `read_record`, `history`,
`read_asset_manifest`, `read_snapshot`, `database_version`, and consuming `close`.
Use the JSON entrypoints for untrusted parsed commands; the ingress parser must
first reject duplicate keys and enforce request limits. Typed command entrypoints
are for server-constructed or already validated carriers. `history` returns the
published bare audit array in durable sequence order, including legitimate empty
history for seeded records and retained tombstones.

All write commands take `BEGIN IMMEDIATE`, capture the full original graph and
scoped epochs once, and authorize intake before receipt access. New writes use
original preimages for every command, validate the full candidate and every final
command, authorize candidate, then atomically persist records/CAS revisions,
permanent binding reservations, asset manifests, audits, individual receipts and
ordered batch receipts. Precommit rechecks the identical actor before commit.
Exact receipt replay is coded with historical-result self-validation and scoped
correlation, then replay and replay-precommit authorization; its controls remain
unrun in this lane. No receipt expiry/deletion API exists.

## Database and dependencies

The new lineage is `houseatlas-rust-storage/1`, database version 1, distinct from
published JS database version 3 and record schema 1. `0001_rust_core.sql` starts
from an empty database, including published durable receipts/reservations/epochs
in its initial schema. Its own checksum ledger and lineage/contract metadata are
verified on reopen. Unrecognized databases with existing schema objects,
altered history, other lineages and future versions are refused. There is no
JS import/adoption/downgrade path. WAL,
synchronous FULL, foreign keys and a configurable 0–60000 ms busy timeout are set
for the owned connection. Bootstrap defaults off and is restricted to an empty
disposable synthetic store; it creates no audit prehistory.

Proposed pinned direct dependencies for AT51:

```toml
rusqlite = { version = "=0.40.2", features = ["bundled"] }
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.149"
sha2 = "=0.10.9"
```

The compiler harness uses edition 2024 and Rust 1.99.0. Its lockfile is external
to the checkout; the resulting bundled SQLite is 3.53.2 through
`libsqlite3-sys 0.38.2`. The host SQLite CLI version is not application evidence.

## Healthy checkpoint

`checks/healthy.rs` compiles and executes the actual Rust storage source using a
fresh disposable file database. `checks/oracle.mjs` supplies the exact published
pure contract functions over child-process stdin/stdout; it opens no listener
and invokes no tests or providers. The checkpoint compares every Rust mutation
context with the published extractor. Authorization/time/IDs are explicit
synthetic peers, and no available asset is staged. This oracle is a temporary
check adapter, excluded from application modules, not the production Rust peer.

The checkpoint uses `plan-free.snapshot.json`, `create-circuit.mutation.json`
and `import-remap.batch.json`. For the remap, only the newly submitted binding's
`sourceState` is changed to `unresolved`, retaining the published ordinary core's
held-admission posture. Rooms use identity kind `location`, items use kind `item`;
arbitrary HomeBox types, explicit nullable type flags, unknowns and original dates
remain unchanged. It exercises room/item atomic create, item replace/tombstone/
restore, a circuit create, ordered binding retirement/create/journal, scoped
queries, empty seeded history, retained tombstone read, and healthy reopen.

An external Cargo harness named `houseatlas-at07-checkpoint` has these dependencies,
`src/lib.rs` containing the following, and a `healthy` binary pointing to the
checked-in checkpoint source:

```rust
#[path = "/workspace/HouseAtlas/backend/src/storage/mod.rs"]
pub mod storage;
```

```toml
[[bin]]
name = "healthy"
path = "/workspace/HouseAtlas/backend/src/storage/checks/healthy.rs"
```

After inspecting those two check files, run only this scoped new lane:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo fmt --check --manifest-path /tmp/houseatlas-at07-harness/Cargo.toml
cargo check --locked --manifest-path /tmp/houseatlas-at07-harness/Cargo.toml
cargo clippy --locked --manifest-path /tmp/houseatlas-at07-harness/Cargo.toml --all-targets -- -D warnings
node --check backend/src/storage/checks/oracle.mjs
HOUSEATLAS_ROOT=/workspace/HouseAtlas cargo run --locked --manifest-path /tmp/houseatlas-at07-harness/Cargo.toml --bin healthy -- /tmp/houseatlas-at07-checkpoint-1
```

The output directory must be fresh. The successful run records 9 committed
commands, 9 audits, 9 exact-JCS-hash child receipts, 2 exact-hash batch receipts,
4 retained binding reservations, 24 contexts matching the published extractor,
and 9 calls each to transition/guard/final-command validation. Read-only SQL
checks inspect the committed rows, and the evidence JSON contains synthetic
results/history/snapshot, exact callback counts, lineage and SQLite version.

## Remaining integration and qualification

Native Rust Contract and branded Authorization/Runtime peers are required before
application integration. AT51 must reconcile carriers/dependencies and connect
the crate module; this lane does not change its manifests or generated types.
Source registration and cache generation/failure publication methods are outside
this record checkpoint: their tables and fixture query state are retained, but
there is no public raw-write substitute. The owner must integrate any required
trusted publication API separately. Durable Network sidecars and sanitized
wire3/generation/epoch witness schemas are absent from the published inputs.
No storage context, projection or caller source-state claim grants new provider
presence admission.

Replay, rejection, guard reversal, mutation/omission, adversarial, failure
injection, crash, concurrency and negative-consumer controls remain explicitly
deferred and unrun. No legacy broad test aggregate was invoked. Ordinary success
does not qualify real authorization, staged media, filesystem/power-loss recovery,
provider/native routes, targets, deployment, pilots or production operation.
