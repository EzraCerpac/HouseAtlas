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

The new lineage is `houseatlas-rust-storage/1`, database version 4, distinct from
published JS database version 3 and record schema 1. `0001_rust_core.sql` starts
from an empty database, including published durable receipts/reservations/epochs
in its initial schema. Its own checksum ledger and lineage/contract metadata are
verified as an exact ordered prefix before an additive Rust-only upgrade.
`0002_stock_intents.sql` retains first-admitted stock envelopes, permanent
scope/actor key ownership, ordered operation groups, native receipt/audit links
and opaque history cursors. It does not backfill native-only receipts.
Unrecognized databases with existing schema objects,
altered history, other lineages and future versions are refused. There is no
JS import/adoption/downgrade path. WAL,
synchronous FULL, foreign keys and a configurable 0–60000 ms busy timeout are set
for the owned connection. Bootstrap defaults off and is restricted to an empty
disposable synthetic store; it creates no audit prehistory.

Proposed pinned direct dependencies for AT51:

```toml
rusqlite = { version = "=0.40.2", features = ["bundled", "backup"] }
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
cargo clippy --locked --manifest-path /tmp/houseatlas-at07-native-composition/Cargo.toml --lib --bin healthy --bin cache-healthy --bin numeric-healthy -- -D warnings
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

## Stock intent transactions and history

`execute_stock_json_with_authorization` requires the exact stock schema peer and
one borrowed `StockAuthorization` for the original principal. The published
domain planner and commit mapper supply accepted carriers and result schemas.
Stock intake precedes receipt lookup. Native and stock authority checks run at
each phase on the same transaction and captured original graph. Separate batch
root guards extend stock closure without changing child guards/native contexts.
Final graph and per-command checks still precede every write.

Single commands retain one server operation UUID. Batches retain a root UUID
and ordered child UUIDs. Key ownership spans root and child roles under
workspace/home/actor; a native-only receipt cannot be promoted to a stock
receipt. Retained envelopes, intent digests, actual native results and audit
links commit together. Replay code validates those rows and original native
digests, then renews only allowed root correlation fields in the returned
projection. It never reconstructs old outcomes from current records. Replay
behavior has not been executed as qualification.

`stock_history_json_with_authorization` uses actual audit sequence order and a
fixed watermark. Cursors are opaque server UUIDs stored with the actor, scope,
target and exact query. Every page reauthorizes history and output. Migration 4
adds a derived `stock_history_lookup`, populated once from existing immutable
audits and maintained atomically by audit/link insert triggers. Its partial
unlinked index checks every target audit before the watermark, including search
nonmatches; unavailable native prehistory is not silently omitted.

History reads use a deferred WAL snapshot. They retrieve and validate at most
`pageSize + 1` audit bodies and their complete retained roots, deduplicating root
validation within the page. Root groups, keys and linkage reads are capped at
their accepted maximum plus one, with an index for keys by root. Only a needed
continuation cursor takes a separate short IMMEDIATE transaction, after bounded
validation finishes; the original authority is checked again before commit and
output release. Immutable rows and the fixed watermark preserve the read facts
across that gap. No read-to-write upgrade or automatic retry is introduced.

`q` keeps literal case-sensitive substring semantics over original command IDs
and the committed state. The finite published domain operation catalogue supplies
matching IDs; each uses the target/command/sequence index with a bounded limit,
then sequences are merged before audit hydration. Sparse search therefore does
not scan arbitrary nonmatching history or change full-page/cursor behavior.
Both `includeArchived` values preserve historical tombstones and bind the query.

The bounded reader uses validated immutable persistence for unreturned envelopes
instead of exhaustively revalidating the entire history on every request. Page
and lookahead roots still receive the same receipt/hash/audit/projection checks.
`StockHistoryFrame.audits` now means those bounded validated inputs, not all
target audits. Complete recovery validation must verify derived lookup equality
and the retained catalogue/stock inputs; native-only recovery checks its NULL
lookup rows against every already validated native audit. Populated stock/queue
full-image recovery uses the explicit required peers described below.

`checks/stock-healthy.rs` executes fresh create/replace/ordered batch commands,
two history pages, matching search and reopened durable rows. Its schema peer
uses the actual published native stock validator and embedded offline wire3/Atlas
resources. Its graph/JCS/result/raw-transition/timestamp peer invokes the
published Rust semantic functions directly. Authority/runtime are synthetic.
No JS oracle,
provider call or held control runs in that checkpoint. Binding presence triggers
derive from actual original/candidate records through the domain predicate and
remain held until atomic witness qualification exists.

## Borrowed cache publication authority

The source lifecycle handoff uses `register_source_with_authorization`,
`prepare_cache_publication_with_authorization`,
`publish_prepared_generation_with_authorization`, and
`record_prepared_cache_failure_with_authorization`. Each borrows its required
`B: Authorization` and `B::Principal` only for the synchronous call; that
principal type may differ from the store's persistent read-authority principal.
Both configured and per-call methods use one private cache transaction engine on
the same store connection and instance. Preparation rechecks the original actor
before returning its fence; consuming success and failure keep that actual
issuer, full registration, generation and epoch guards inside the transaction.
No authorizer is replaced, fence reconstructed, or second store opened. The
actual PR25 authority interface `e86819b4a4103fa716b774e6dc97b81176011a30`
matches these signatures. Access-owner lifecycle grants and held transaction
authorization remain required host inputs. This handoff checkpoint is compiler
and source review only; no provider publication or failure path is executed.

## Native recovery images

`backup_recovery_to(&mut self, destination, check)` uses this store's owned
connection and SQLite backup API. It reserves an absent private staging file,
copies in bounded page steps, closes a standalone DELETE-journal image and
calls `validate_recovery_image(&self, database, check)` on read-only bytes.
`RecoveryImage` returns exact contract/lineage/schema metadata and all retained
asset records. Media owns physical originals, image hashes, sync and publication.
The required check callback is an authority/progress check and receives no SQL.
The deadline is cooperative between SQLite/contract calls.

`AtlasStore::validate_existing_recovery_image(database, &contract, check)` is
detached read-only validation and needs no original store. The caller uses its
concrete `AtlasStore<C,A,R>` type. `open_existing_recovery_image(database,
contract, authorization, runtime, options, &expected, check)` uses READ_WRITE
without CREATE, rejects synthetic bootstrap, and never calls the migration
engine. It validates the selected current-lineage image on that same connection
with query-only enabled, compares every returned metadata/asset field to the
expected image, rechecks the external authority, then enables normal FK/FULL/WAL
runtime mode and creates a fresh store instance token. The ordinary constructor
is unchanged. Runtime authorization still requires newly supplied original
principal/witness handles; no image metadata is an authority grant.
Expected metadata does not authenticate every database byte: the media/host
owner must retain its independently verified image digest and exclusively owned
path binding throughout. These ports support closed standalone images, not a
hot-WAL restart. The original strict-opener checkpoint was source/compiler
review only; the populated healthy example below now exercises its shared
strict same-handle implementation. No foreign database or initialization/
migration control is executed.

Validation compares exact migration checksums, metadata and actual schema
catalog, integrity/FKs, every native body and SQL key, full unredacted graph,
binding reservations, asset manifests, cache generations/epochs, receipt/audit
chains and ordered batch linkage.
Adjacent retained versions also preserve tombstone/restore canonical payloads
and pass the required native transition peer's immutable-field and append-only
replacement rules. That check derives a transition projection from actual
retained outcomes; it supplies no original command or historical guard proof.
The first noncreate audit can follow an unaudited seed with no retained preimage.
Original native command/guard envelopes are
absent from v1 receipts, so their hashes cannot honestly be reconstructed; hash
syntax and persisted key/result/audit linkage are checked. These requested
native-only signatures lack stock/queue evidence peers and fail closed on a
nonempty stock journal or any registered queue state. The explicit full-image companion below enumerates and validates every
retained registration, stock intent and qualified evidence codec. A diagnostic
per-registration queue scan does not certify a complete recovery image.
`checks/recovery-healthy.rs` uses actual Rust native semantics and synthetic
authority/runtime for capture, read-only validation, all-row equality and native
reopen. No JS oracle, corruption/crash control or physical-original qualification
runs in this checkpoint. Root reconciliation must enable rusqlite `backup`.

## Populated native stock and queue recovery

`RecoveryValidationPeers<'a, S, D, E>` borrows the actual `StockContractPort`,
complete trusted `&[QueueConfig]` registry, `QueueDiscovery`, and mandatory
`QueueRecoveryEvidence`. Four companion methods use these peers:
`backup_recovery_to_with_peers`, `validate_recovery_image_with_peers`, detached
`validate_existing_recovery_image_with_peers`, and strict
`open_existing_recovery_image_with_peers`. Their other arguments and results
match the native-only methods, with the borrowed peer frame immediately before
`check`. The strict constructor accepts fresh owned Contract/Authorization/
Runtime values, options and expected `RecoveryImage` before that peer frame.
All share the same private backup/read-only/strict-open implementation. No
new schema version, migration, import or SQL/transaction callback is exposed.

One deferred read transaction validates the exact schema and native graph,
then every stock and queue row. Stock validation reparses and replans original
stock requests, checks each native receipt/audit against the actual ordered
root/child plan and batch envelope, proves exact group/key/link coverage,
validates lookup equality, and binds retained cursors to their scope, actor,
query, watermark and actual matching page boundary. It does not invent past
request identifiers, predecessor cursors, delivery, grants or satisfied guards.

The external queue registry must match every retained physical registration,
including empty registrations, with its original config digest, aliases and
owner. Each original request and derived enqueue must match the actual native
stock/discovery peer. Recovery validates canonical current carriers, contiguous
job sequences and attempt fences, exact original leases, prepared journal
bytes/digests/liabilities, step envelopes, immutable outcome-local evidence cuts,
shared finish invariants, retained reconciliation, liability maxima/sums, and
logical/physical blockers. Later positive end evidence cannot retroactively
qualify an earlier outcome. Validation performs no state update, cleanup,
release, retry, termination inference or dispatch; unresolved liabilities and
fences remain retained.

`QueueRecoveryEvidence::validate_attempt(config, QueueRecoveryAttempt)` receives
borrowed actual original request, leased job, optional prepared native/media
bytes and journal, all steps/liability origins, and every `QueueRecoveryOutcome`
with its original local cuts. The owner must qualify these exact codecs and
termination/reconciliation facts; unknown codecs or missing external evidence
must return an error. There is no permissive default. This pure synchronous
port receives no database handle or provider transport. Trusted deployment
configuration, credentials, immutable physical media proofs and original grants
stay outside the image. Reopened operations still reauthorize through the
provided runtime peers; image validity supplies no authority to resume a queue.
The host must independently preserve full-image digest and exclusive path
binding. Checks are cooperative between SQLite and codec calls, whose own
execution bounds belong to their owners.

`checks/populated-recovery-healthy.rs` shares the ordinary queue fixture through
`checks/queue-check.rs`; the original `checks/queue-healthy.rs` entrypoint keeps
its ordinary queue-only mode. The successful populated example uses four fresh
native stock commands in three roots, including a two-child ordered batch,
a retained history cursor and matching search, then one actual
`WriteQueue -> NativeHomeBoxWriter -> AtlasStore` synthetic success. It records
35 queue authority checks, two final dispatch checks and one invocation before
capture. All rows in all 28 tables match the closed source, captured image and
copied restore before strict open. Detached full validation, strict same-state
open with new storage authority/runtime, stock snapshot/history/search and a
currently authorized succeeded queue receipt read pass afterward. The restored
history read may create a new cursor, so final post-read row equality is not
claimed. Its native/media/response/end evidence qualifier is a fixture for this
one successful attempt only; it is not a production codec adapter.

Compile only the selected actual-source targets, then run the single fresh
ordinary example after inspecting its source:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo clippy --locked --manifest-path /tmp/houseatlas-at07-native-queue-composition/Cargo.toml --lib --bin queue-healthy --bin populated-recovery-healthy --bin recovery-healthy -- -D warnings
HOUSEATLAS_ROOT=/workspace/HouseAtlas HOUSEATLAS_STOCK_ROOT=/tmp/houseatlas-at07-native-queue-peer49 HOUSEATLAS_CONTRACT_PEER=49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c HOUSEATLAS_DOMAIN_PEER=f51bc7962b491faa1cc563f2ec0f737c471e4e26 cargo run --locked --manifest-path /tmp/houseatlas-at07-native-queue-composition/Cargo.toml --bin populated-recovery-healthy -- /tmp/houseatlas-at07-populated-recovery-healthy-1
```

The supplied peer labels are exact public source pins. This example qualifies
only successful zero-media, completed stock/queue state. Other coded queue
states and unresolved liability preservation have source/compiler review only;
held replay/retry/expiry, modified images, faults, crashes, corruption,
concurrency and negative controls remain deferred and unrun.

## Durable native write queue

Schema version 3 adds eight queue tables to the existing Rust lineage. Versions
1 and 2 retain their original SQL. This is an additive Rust schema checkpoint;
no legacy or live database is imported. `AtlasStore::queue_session` accepts a
`QueueSessionBinding` borrowing the original typed principal, witness, stock
request and receipt. Required `QueueAuthorization` callbacks check current
authority at entry, precommit and release. No bearer grant, principal or witness
is serialized. The immutable stock request remains data, without authority.

`QueueSession` implements the existing seven-method `jobs::QueueStore` port.
`into_handles()` returns a store handle and a narrow `QueueJournalPort` handle
sharing that session. Each synchronous handle borrow ends with its single SQL
operation. The existing `WriteQueue` and `NativeHomeBoxWriter` therefore claim,
journal, reauthorize, perform prepared transport I/O, and finish through the
same Atlas connection while transport runs outside SQL transactions. These
process-local handles are not `Send`; a host owns its synchronous dispatcher.
No alternate service framework, raw SQL port or provider transport is added.

Receipts permanently bind workspace/home/actor/mutation identity and the first
complete queue intent. Digest-equivalent enqueue replay retains the first stock
envelope and requires authorization of that retained original. Later worker
operations require its exact original envelope and original witness. Discovery
returns the retained FIFO intent only after required current discovery checks;
the owner reparses it with the stock schema peer and supplies the original
authority handles separately. A session cannot expire another receipt's waiter
or lease. An earlier waiter without its original witness remains held until its
owner can address it; this is an explicit capability/liveness limit.

Physical identity and complete registration/configuration remain immutable.
Admission reuses the native jobs policy inside the same IMMEDIATE transaction
that reserves the one physical slot and advances its checked fence. Counters,
timestamps and bytes retain the full `u64` domain as canonical decimal text.
Each attempt retains its full original lease. Claim, prepared journal and finish
liability events have distinct origins; maxima within an attempt and checked
sums across attempts conserve retained liabilities. All orphan references stay
in immutable events, although the current jobs summary exposes only its first
orphan identifier. This component performs no byte cleanup or automatic release.

The journal stores exact prepared native bytes, codec, qualified media evidence,
digests and liability. A request without a media reservation cannot journal
positive or incomplete media accounting. Its optional prepared evidence may
describe a qualified no-media preparation; it is not staged provider data.
Finish atomically stores actual step bytes, immutable full outcome, state and
liability. Every outcome binds the exact evidence/liability event cut available
at commit, so later steps cannot qualify an earlier outcome. Evidence envelopes
bind the exact leased job and journal digest. Response/readback, positive
no-effect and remote-end references require matching retained evidence.

The owner must qualify opaque provider/media evidence and the original approval,
graph, source grant and result disclosure through the mandatory authorization
ports. `authorize_dispatch(job, now)` rechecks current original authority and
lease before invocation; its returned digests are journal data. The native owner
must use the dispatcher authorization phase before constructing/invoking its
qualified operation. A lease or journal receipt supplies no provider authority.
Logical effect resolution preserves remote activity and liabilities; only
separately qualified positive end evidence releases a matching physical slot.
Per-value metadata and step payloads have a 1 MiB engineering bound; codecs have
a 128-byte bound. These are explicit internal storage limits.

`checks/queue-healthy.rs` runs fresh enqueue, original-intent discovery after
reopen, native dispatch, observed success and a second reopen, then scans the
retained queue. It uses the actual published contracts `49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`
and domain/jobs `f51bc7962b491faa1cc563f2ec0f737c471e4e26` with synthetic
authority, clock, prepared transport and evidence bytes. The external compiler
harness pins rusqlite 0.40.2 (bundled/backup), serde 1.0.229, serde_json 1.0.151
(arbitrary_precision/float_roundtrip/raw_value), jsonschema 0.58.6
(arbitrary-precision), sha2 0.10.9, serde_jcs 0.1.0, time 0.3.44, url 2.5.7,
ryu-js 1.0.2 and regex 1.13.1. Root manifests and locks remain owner-controlled.
The healthy executables record the supplied exact peer labels through
`HOUSEATLAS_CONTRACT_PEER` and, for queue, `HOUSEATLAS_DOMAIN_PEER`.

The queue example exercises no held replay, retry, expiry, fault or concurrency
control. Production grant/witness adapters, prepared provider/media evidence
qualification and host wiring remain required. Full stock/queue
recovery-image composition now requires those same explicit codec/discovery peers. Successful synthetic dispatch does not qualify those peers.

## Remaining integration and qualification

The full native semantic Contract and branded Authorization/Runtime peers remain
required before application integration. AT51 must reconcile carriers/dependencies
and connect the crate module; this lane does not change its manifests or generated types.
The HomeBox service owner must reconcile its expanded publication fence and
opaque complete generation with the store's consuming fence; a native compiled
cross-owner adapter has not been exercised in this storage lane. Durable Network
sidecars and atomic source-presence witness persistence remain unimplemented.
Sanitized wire3/presence schemas are available as published inputs.
No storage context, projection or caller source-state claim grants new provider
presence admission.

Replay, rejection, guard reversal, mutation/omission, adversarial, failure
injection, crash, concurrency and negative-consumer controls remain explicitly
deferred and unrun. No legacy broad test aggregate was invoked. Ordinary success
does not qualify real authorization, staged media, filesystem/power-loss recovery,
provider/native routes, targets, deployment, pilots or production operation.
