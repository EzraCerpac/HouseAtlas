# Rust transactional persistence (AT07)

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
`timestamp_millis` supplies published source-event ordering at millisecond
precision; `None` means schema-accepted text has no orderable timestamp. Native
parsing compatibility belongs to the contract owner. Storage preserves the
original timestamp strings and adds no date-parser dependency.
Integer carriers accept integral decimal and exponent spellings such as `1.0`
and `1e0` within the published nonnegative safe-integer range. Required nullable
revisions remain required. The same conversion compares asset `byteSize` with
trusted byte proofs, including typed commands whose JSON payload contains
`16.0`. These conversions do not rewrite payloads or change JCS/digest semantics;
revision minima and schema-version constants remain mandatory Contract checks.
Accepted signed-zero spellings retain zero meaning for nonnegative epochs.
Native composition reuses AT51's `JsonInteger` checked lexical envelope and
exact integral classification before the bounded conversion. This also covers
storage-only epoch envelopes. The selected native build requires paired
serde_json `arbitrary_precision` and jsonschema `arbitrary-precision` features.
The shared native ingress parser additionally requires serde_json `raw_value`.
`float_roundtrip` is retained for correctly rounded floating parsing when used;
an already rounded ingress `Value` cannot recover its original precision.
Neither feature supplies RFC 8785 serialization; that remains the Contract
peer's job. No historically lossy parse/digest is reinterpreted by this patch.
The local carriers in `types.rs` preserve published wire names and schema 1;
they are a narrow storage port pending reconciliation with AT51's generated
types, not a replacement schema generation pipeline. Payloads and source/cache
projection rows remain exact JSON data, validated by the contract peer.

`NativeContract<C>` composes `crate::contracts` at published AT51 checkpoint
`6b3029cbbcf1462ecdeecc62a56c24f66e034057` with a required semantic peer `C`.
It dispatches the storage input shapes, including the stock mapper's `guard`,
and `snapshot`, `record`, `audit` and `mutationResult` output shapes to native DTOs via
`contracts::decode<T>`, and validates snapshot/result shapes before delegation.
Shared numeric processing errors retain AT51's static explanation under the
existing `invalid-contract` storage error code; no input tokens are exposed.
It implements no graph, transition, guard, final-command, result-correlation,
JCS or timestamp fallback. AT51 owns these pure semantic methods; AT52 composes
the peer through the unchanged storage `Contract` trait. Root manifests and
generated types remain owned by their maintainers. This composition follows PR7's separately
reviewed numeric correction `816ba441ba1076eae426f69ac8b7c5177745ab53`;
its changes remain within the storage namespace.

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
`execute_json_with_authorization` and `execute_batch_json_with_authorization`
accept a synchronous borrowed peer `B: Authorization<Principal = A::Principal>`.
They use the same private connection and command engine as the default methods.
The supplied peer handles intake, validate, candidate and precommit, or intake,
replay and replay-precommit; no phase falls back to the stored authorizer.
The caller's peer retains its original authority handles across phases; it is
neither cloned nor stored after return. These methods open no second connection
and expose no SQL handle, future or transaction callback.
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

## Source and cache publication continuation

The first record checkpoint remains commit
`d4a94d230da3f098eefaa846bf73f389f9d9965e` in draft PR #7. The source/cache
continuation is its append-only child
`da3f607ee56ee7bcb836ed868bb1b10fdbcbb7f6`. It changes no
root manifest, generated contract or migration schema.

Additional operations are `register_source`, `register_source_json`,
`read_cache_for_publication`, `prepare_cache_publication`,
`publish_prepared_generation`, `replace_cache_generation`,
`replace_cache_generation_json`, `record_prepared_cache_failure`, and legacy
`record_cache_failure`. Source registration
is immutable and scope-checked, validates the complete candidate graph, and creates
the partition epoch atomically. Configuration uses `ConfigureSource`; publication
state and writes use `PublishCache`, with trusted source selectors and identical
verified actor checks before commit. These capabilities require native access
adapter integration; they do not grant authority themselves.

`prepare_cache_publication` reads the actual cache generation, integer cache
epoch and retained projection rows in one transaction before provider GETs. It
selects a server-generated candidate UUID and returns `PreparedCachePublication`
with an opaque, non-cloneable `CachePublicationFence`. Its immutable getters are
`partition`, `baseline_generation_id`, `baseline_cache_epoch` and
`reserved_generation_id`. The fence is bound to its issuing open store instance
and is consumed by `publish_prepared_generation`. Closing or reopening the store
requires a new prepare before fetching. The candidate ID becomes permanently
reserved only on successful publication; prepare does not write a durable
reservation or a presence witness.

The provider/service owner must first establish completeness using its opaque
complete-generation boundary. The storage wrapper accepts already-proved cache
and row values; their raw slice types do not prove that all provider pages were
fetched. Publication compares the fence's exact baseline generation and SQLite
epoch, binds the selected candidate UUID, validates owner/partition/timestamps and
the complete final graph, and atomically replaces only that partition's
projections, stores status, reserves its generation ID and advances its epoch.
`CacheEpoch` is a storage-constructed newtype, distinct from the access boundary's
opaque authority epoch/handle. The raw trusted publication envelope retains the
published integer epoch representation. No adapter may reread a newer epoch or
rebase a completed fetch.

`record_prepared_cache_failure` consumes the original issuing-store fence and
compares its full durable registration, baseline generation and cache epoch in
the failure write transaction before recording sanitized metadata. It advances
the partition epoch while retaining the successful generation and projection
rows, and does not reserve the selected candidate generation UUID. Native source
adapters use this fenced path; `record_cache_failure` remains a legacy unfenced
entry point. Revoked status is sticky until a complete fresh publication succeeds.
Cache writes do
not create Atlas record audits or mutation receipts. Empty complete generations
clear only projection rows and retain records and binding reservations. All
these writes use the same connection and fixed internal SQL as bootstrap; no
second service framework or raw database handle is exposed.

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
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = { version = "=1.0.151", features = ["arbitrary_precision", "float_roundtrip", "raw_value"] }
jsonschema = { version = "=0.58.6", default-features = false, features = ["arbitrary-precision"] }
sha2 = "=0.10.9"
```

The compiler harness uses edition 2024 and Rust 1.99.0. Its lockfile is external
to the checkout; the resulting bundled SQLite is 3.53.2 through
`libsqlite3-sys 0.38.2`. The host SQLite CLI version is not application evidence.

## Healthy checkpoint

`checks/healthy.rs` compiles and executes the actual Rust storage source using a
fresh disposable file database. All three executables now compose actual AT51
native shapes/numeric classification with the check-only semantic peer.
`checks/oracle.mjs` supplies the exact published graph/transition/JCS functions
over child-process stdin/stdout; it opens no listener
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
It also validates the final committed snapshot, restored item, four ordered
item audits and committed circuit result through the exact native output shape
names used by the domain and service bridges. The circuit's original evidence
guard exercises the stock mapper's explicit `guard` shape dispatch.

An external Cargo harness named `houseatlas-at07-checkpoint` has these dependencies,
`src/lib.rs` containing the following, and a `healthy` binary pointing to the
checked-in checkpoint source:

```rust
#[path = "/tmp/houseatlas-at07-native-composition/peer/backend/src/contracts/mod.rs"]
pub mod contracts;
#[path = "/workspace/HouseAtlas/backend/src/storage/mod.rs"]
pub mod storage;
```

```toml
[[bin]]
name = "healthy"
path = "/workspace/HouseAtlas/backend/src/storage/checks/healthy.rs"
```

`checks/support.rs` shares only the synthetic check peers between the scoped
executables and is excluded from application modules. Add these harness binaries
for source/cache and accepted numeric checkpoints:

```toml
[[bin]]
name = "cache-healthy"
path = "/workspace/HouseAtlas/backend/src/storage/checks/cache-healthy.rs"
[[bin]]
name = "numeric-healthy"
path = "/workspace/HouseAtlas/backend/src/storage/checks/numeric-healthy.rs"
```

After inspecting the check files, run only this scoped new lane:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo fmt --check --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml
cargo check --locked --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml
cargo clippy --locked --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml --all-targets -- -D warnings
node --check backend/src/storage/checks/oracle.mjs
HOUSEATLAS_ROOT=/workspace/HouseAtlas cargo run --locked --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml --bin healthy -- /tmp/houseatlas-at07-native-record-1
HOUSEATLAS_ROOT=/workspace/HouseAtlas cargo run --locked --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml --bin cache-healthy -- /tmp/houseatlas-at07-native-cache-1
HOUSEATLAS_ROOT=/workspace/HouseAtlas cargo run --locked --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml --bin numeric-healthy -- /tmp/houseatlas-at07-native-numeric-1
```

The output directory must be fresh. The successful run records 9 committed
commands, 9 audits, 9 exact-JCS-hash child receipts, 2 exact-hash batch receipts,
4 retained binding reservations, 24 contexts matching the published extractor,
and 9 calls each to transition/guard/final-command validation. Read-only SQL
checks inspect the committed rows, and the evidence JSON contains synthetic
results/history/snapshot, exact callback counts, lineage and SQLite version.

The cache executable successfully publishes four complete synthetic generations,
including an empty HomeBox generation, a newly registered empty source and a
Network relation-only generation. Two successful synthetic timeout-status writes
retain prior rows without transport or injected faults. The executable verifies
fractional/offset timestamp ordering with unchanged source dates, partition epochs
3/1/2, five permanently retained generation IDs, fourteen retained records,
three retained binding reservations, zero Atlas audits/receipts and healthy
reopen. It uses no actual HomeBox/Network peer, authorization grant or source
access. Successful examples do not qualify rejection or concurrent publication.

The accepted-numeric executable covers decimal/exponent schema versions,
single/batch revisions and guards, record/audit/result/publication carriers and
the maximum safe cache epoch. It commits three commands and one complete
publication, verifies a typed available asset's `16.0` byte size against sixteen
immutable in-memory synthetic bytes, and checks that stored single/batch receipt
hashes match the original numeric inputs' published JCS digests. Numeric payload
and projection comparisons use the contract's canonical semantics, because
serde JSON distinguishes integer and floating representations internally.
No negative input or held control is executed; the synthetic bytes do not
qualify real staged-media/filesystem integration.

## Remaining integration and qualification

The full native semantic Contract and branded Authorization/Runtime peers remain
required before application integration. AT51 must reconcile carriers/dependencies
and connect the crate module; this lane does not change its manifests or generated types.
The HomeBox service owner must reconcile its expanded publication fence and
opaque complete generation with the store's consuming fence; a native compiled
cross-owner adapter has not been exercised. Durable Network sidecars and sanitized
wire3/generation/epoch witness schemas are absent from the published inputs.
No storage context, projection or caller source-state claim grants new provider
presence admission.

Replay, rejection, guard reversal, mutation/omission, adversarial, failure
injection, crash, concurrency and negative-consumer controls remain explicitly
deferred and unrun. No legacy broad test aggregate was invoked. Ordinary success
does not qualify real authorization, staged media, filesystem/power-loss recovery,
provider/native routes, targets, deployment, pilots or production operation.
