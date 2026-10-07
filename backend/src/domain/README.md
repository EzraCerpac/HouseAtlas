# AT36 domain component

Base: published `EzraCerpac/HouseAtlas`
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`; local branch `codex/rust-at36`.
Only `backend/src/domain/**` and the companion `backend/src/jobs/**` are
changed. Root manifests, locks, generated contracts and routing remain AT51's.

`Queries<R, A>` assembles one current snapshot and provides typed record/history
reads. `CurrentOutput` offers room/item/children/unplaced/search selections over
that snapshot. A HomeBox location type yields a place; only an active accepted
room annotation joined through an active accepted qualified binding yields a
room. Names, arbitrary container types and tree depth establish no placement.
Parent references retain their source instance, collection, scope and external
ID. Source update/retrieval dates remain separate; the display freshness window
is the published 15 minutes. Payload, quantity and cost numbers retain their
accepted parsed JSON numbers. Integer deserialization uses AT51's exact integral
classification, so decimal/exponent spellings of revisions and counters retain
their numeric value within published bounds. Typed bounded counters serialize
as integers; immutable command envelopes remain unchanged. Attachment byte sizes
have no frozen schema maximum and retain AT51's `JsonInteger` carrier through
current-output projection.

Current output removes stored-file `proxyRef` and accepts only exact scoped
injected media capabilities. It preserves allowed external URL bytes, returns
explicit unknown/missing file capability values and emits native links only
when editor authority, present binding, fresh cache, exact qualified key and
verified route all apply. Cache errors expose code/time; revoked caches expose
only a generic marker. Public homes have exactly workspaceId/homeId/label.

`Commands<S, A, C>` forwards canonical single/batch operations unchanged to
storage. Its immutable decoded values distinguish required-null create revision
from an omitted property and preserve required guards. The component does not
compute candidate graphs, digests, audit sequences or replay authority.
Recorded history is a bare audit vector in storage order, including the valid
empty and retained-tombstone cases; no prehistory is fabricated.

`stock` adds the supplied stock `0.3.0-at34.stock.2` / wire3 domain boundary.
Its closed registry covers all 164 operations and 21 grouped feature routes.
Prepared values retain the exact accepted JSON and ordered child requests. The
domain computes the published canonical intent digest, checks result/request
correlation and delegates graph resolution, schema validation, captured
authority and concrete storage/provider work through narrow owner ports. Every
transport uses this same boundary. Native absent/held/append-only forms have
explicit pre-dispatch dispositions. See `stock/README.md` for the API and scope.

`presence.rs` implements semantic amendment 1.1.0 trigger detection on validated
storage-supplied binding graphs. Review acceptance is not a trigger condition.
Evidence membership comparison leaves submitted arrays unchanged. Typed
qualifier facts contain exactly the six qualifier-owned fields; required-null
observation dates retain their omission distinction. Candidate/precommit
captures require the same exact qualified facts. The retained witness DTO adds
storage-owned commit linkage without minting it. New admission stays held until
reviewed Rust storage/access/recovery composition is complete. There is no
presence endpoint or transaction implementation here.

## Proposed integration interfaces

```rust
// Add these module declarations in AT51's backend crate.
pub mod domain;
pub mod jobs;

// P is AT11's opaque verified principal type.
// DomainResult is an internal adapter result, not the HTTP error envelope.
trait AccessPort<P> {
    fn authorize(&self, principal: &P, scope: &Scope, capability: Capability)
        -> DomainResult<AuthorizedHome>;
    fn revalidate(&self, principal: &P, scope: &Scope, capability: Capability)
        -> DomainResult<()>;
}
trait ReadPort<P> {
    fn snapshot(&mut self, principal: &P, scope: &Scope) -> DomainResult<Snapshot>;
    fn record(&mut self, principal: &P, scope: &Scope, target: &RecordRef)
        -> DomainResult<Record>;
    fn history(&mut self, principal: &P, scope: &Scope, target: &RecordRef)
        -> DomainResult<Vec<Audit>>;
}
// CommandPort<P>::execute / execute_batch retain the exact validated JSON.
// ContractPort::validate resolves published recordRef/mutation/batchMutation.
```

`native_storage::NativeScopedCommands::from_store(store, authorization)` binds
the frozen command port to AT07's actual synchronous scoped authorizer methods.
AT52 must construct it inside the existing access mutation callback with the
original principal and retained grants. The native engine checks every phase
using that same borrowed authorizer on its existing private connection; the
adapter neither reenters the read fence nor rebinds the store's contract/runtime.
The authorizer still must bind exact mutation context, phase and graph closure.
When using the outer `Commands` service inside that callback, its `AccessPort`
must also borrow the same guard; a mutex-backed global access adapter would
reenter the held fence during the service's initial or final access checks.
This frozen binding does not persist stock root/child intent or stock receipts.
`stock::NativeAtlasCommands` separately binds the delivered atomic wire3 stock
executor; `stock::NativeStockReads` binds durable paged/searchable history.

Read models in `model.rs` are local projections and adapter values. Full schema
and graph validation uses the existing published schema; these Rust structs do
not replace that schema or constitute AT51 generated contracts. Record payloads
stay opaque canonical JSON except for the narrow binding/semantics read joins.
AT51 can reconcile aliases with generated types without altering the wire.

AT07 must validate frozen shapes and graphs, authorize within transactions,
scope reads to current source grants, check existence before history, enforce
old/new referenced guards, atomically retain record/audit/receipts, and return
audit commit order. Keep the published hold on new explicit source-presence
admissions until the separately reviewed atomic witness extension exists.

AT11 must derive actor, home and grants from a server-verified principal. The
access adapter checks current authority before and after each operation; its
principal must bind captured session/role/source policy versions and fail when
they change. The storage snapshot must use the same captured authority. Home
and media capabilities are trusted adapter results, never browser inputs.
Current-output release compares the initial/final home decisions and performs
the required captured-policy revalidation. The access fixture's revalidator is
an explicit stub. Production host composition must use AT11's published captured
principal/version checks and original-grant revalidation on the live guard.
The HTTP owner must enforce duplicate-key/body limits before passing parsed
JSON, map error categories, and implement the frozen list envelopes/opaque
cursor policy. Wire3 owner adapters separately produce public Atlas record,
HomeBox resource-view, download and history envelopes; public assets omit
`storageKey`. Frozen HTTP history remains a bare audit vector. `CurrentOutput`
is a proposed browser extension, not a replacement for either contract.
Domain errors retain all frozen code categories and authorized revision/guard
conflict revisions, so adapters can preserve the published 401/409/412/428
classification. Canonical HomeBox list assembly must also retain the published
unsafe-external-URL rejection behavior; browser projection alone uses null URLs.

## Historical dependencies and scoped evidence

The historical standalone wire3 compiler manifest was
`$HOUSEATLAS_WIRE3_MANIFEST`. The original domain harness and
checkpoint evidence are preserved separately. These pins describe the earlier
synthetic checks, not the current composed source or production qualification.
AT36 introduced no repository manifest/lock; AT51 owns those files. Historical
external dependency pins, verified with Rust 1.99.0:

```toml
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.145"
time = { version = "=0.3.44", features = ["parsing"] }
url = "=2.5.7"
serde_jcs = "=0.1.0"
sha2 = "=0.10.9"
```

`healthy.rs` contains exactly four healthy synthetic examples. Read/access/
command adapters are explicit fixture stubs. They prove query/projection and
delegation behavior, not production access or durable Atlas mutations. The
fixture command validator accepts only those exact fixed values. The separately
inspected `healthy-schema.mjs` validates the same published single/batch values,
two healthy snapshots and three history arrays using the actual published
schema and pure graph validator. It invokes no retained test alias or control.

The published `246ff32999b5931f8c2418869494e6afc78f8897` wire3 checkpoint
was verified with these scoped checks against its then-current source:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo fmt --manifest-path "$HOUSEATLAS_WIRE3_MANIFEST" --check
cargo check --manifest-path "$HOUSEATLAS_WIRE3_MANIFEST" --locked --all-targets
cargo clippy --manifest-path "$HOUSEATLAS_WIRE3_MANIFEST" --locked --all-targets -- -D warnings
cargo build --manifest-path "$HOUSEATLAS_WIRE3_MANIFEST" --locked --all-targets
cargo test --manifest-path "$HOUSEATLAS_WIRE3_MANIFEST" --locked --lib healthy::
node --check backend/src/domain/healthy-schema.mjs
node backend/src/domain/healthy-schema.mjs
```

Healthy source inputs: `packages/contracts/schemas/atlas.schema.json`,
`packages/contracts/fixtures/plan-free.snapshot.json`,
`create-circuit.mutation.json`, `create-circuit.result.json` and
`packages/contracts/history/fixtures/{contexts,empty.audit-array,
recorded.audit-array,tombstone.audit-array}.json`. The plan-free fixture contains
zero reviewed rooms; the room example changes only its synthetic accepted
semantic annotation in memory. Original fixture files remain unchanged.
Behavioral references: `web/src/{prepare,model}.mjs`,
`server/src/{http-contract,public-dto,service}.mjs` and
`docs/contracts/history/http-history.v1.1.0.md`.

The exact stock wire3 and source-presence language-neutral inputs have now been
adopted as application routing/correlation/qualification logic; shared schemas
and generated contracts remain AT51-owned. Native AT07 storage and AT11 access
APIs are published; the remaining stock, queue and presence composition is
described below. Network inventory, geometry, aliases/mobility/navigation
implementations remain owner-supplied.
No HTTP writer or provider credential path exists. HomeBox wire3 collection IDs
require canonical UUIDs; the earlier frozen fixture's opaque collection string
is not passed unchanged as a wire3 example.

The historical wire3 compiler harness was
`$HOUSEATLAS_WIRE3_MANIFEST`; it includes the stock dependency
pins above and compiles the synthetic SQLite consumer using
`rusqlite = { version = "=0.40.2", features = ["bundled"] }`.
The original checkpoint evidence is retained separately. The SQLite queue
example contains receipt replay and is currently compile-only. See
`../jobs/README.md` and `stock/README.md` for exact later source/evidence scope.
Fault/crash/rejection/adversarial/concurrency/negative-consumer qualification
and all legacy broad aggregates remain deferred and unrun. No merge, listener,
provider call or deployment is implemented by this component.

## Native storage bridge and coordinated composition

`native_storage::NativeStorage::from_store(&mut store, &contracts)` implements
the existing frozen `ReadPort` and `CommandPort` over AT07's actual `AtlasStore`.
It forwards the opaque original `A::Principal` without serializing it, retains
the store's private connection and authorizer, and forwards the entire canonical
single/batch command `Value` without rebuilding entries. Snapshot shape and graph,
record shape, and each audit shape are validated before read release. Empty
history and storage order are retained. Pure persisted-output validation failures
are upstream incompleteness, separately from store authorization/command errors.
The host supplies the same configured schema/profile as the store's contract;
the private store does not expose that instance for this bridge to inspect.
`NativeCanonicalContracts` delegates the three frozen input shapes to the same
pure native contract policy; HTTP lexical and size admission remains AT51/52-owned.

This composes the frozen storage APIs, not stock wire3 execution or durable
provider admission. At the inspected AT52 checkpoint
`fde9586f41c32924543fe7066fb0481b02744b8c`, `ReadContracts` and `ReadAuthority`
reject mutations. A command-capable host must keep the original principal
and source grants current under the access transaction fence throughout all
AT07 phases; it must retain the new-presence hold. No route is mounted here.

The manifest variables below select caller-supplied external harnesses for
their captured historical source. Per-run paths and evidence remain outside Git.

Historical compiler checkpoint: at AT36
`64da6ea293dbb7fd7798105e92e7c4a65be7262f`, the external
manifest `$HOUSEATLAS_SCOPED_NATIVE_MANIFEST` compiled
the owned domain/jobs source against exact published AT07
`3b14f0362aa2161d51b99d71e7d52d50f27f07de`, AT11
`4967dd2d38c5749be35aa7e44728c4d691246730`, and AT51
`07576e6be463dd481b49071071c66dec144b1e0c`. These are reproducible compiler
inputs, not production qualification or proposed root-manifest changes.

The composed manifest pins serde1.0.229 (`derive`), serde_json1.0.151
(`arbitrary_precision`, `float_roundtrip`, `raw_value`), serde_jcs0.2.0,
sha2 0.10.9, time0.3.44 (`parsing`, `formatting`), url2.5.7,
rusqlite0.40.2 (`bundled`, no defaults), jsonschema0.58.6
(`arbitrary-precision`, no defaults), base64 0.22.1, getrandom0.3.4,
scrypt0.11.0 (no defaults), and subtle2.6.1. The external harness lock and
its private evidence are retained outside publication.
Schema retrieval is disabled. Check, warning-strict Clippy and build passed
with unchanged Rust-source fingerprints. The final frozen-source proof is
retained outside publication.
Earlier concurrent peer checks are retained separately and are not that proof.
The SQLite queue driver is compiled only. Older standalone/native bridge
harnesses retain their historical inputs and do not compile current scoped
source without the newer peer methods and contract numeric carriers.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path "$HOUSEATLAS_SCOPED_NATIVE_MANIFEST" --locked --offline --lib --bins
cargo clippy --manifest-path "$HOUSEATLAS_SCOPED_NATIVE_MANIFEST" --locked --offline --lib --bins -- -D warnings
cargo build --manifest-path "$HOUSEATLAS_SCOPED_NATIVE_MANIFEST" --locked --offline --lib --bins
```

The subsequent historical shape-compatible composition uses external manifest
`$HOUSEATLAS_COMPOSED_NATIVE_MANIFEST` with exact AT07
`45e1e38e97a8e41536b4b6195449076d602589c0` and the same AT11/AT51 pins,
dependency versions/features above and its retained external lock. Locked/offline library and
compile-only queue-driver check, warning-strict Clippy and build passed. Rust
fingerprints stayed unchanged; the initial full-source interval records only a
concurrent README correction. That interval is retained as such.

The separate external consumer
`$HOUSEATLAS_SHAPE_MANIFEST` also passed check,
warning-strict Clippy and build. It then executed exactly five accepted pure
shape calls once: snapshot, record, audit, guard and mutationResult. It uses the
published plan-free snapshot/create-circuit result and an integral `1e0` guard.
All shapes pass the actual typed AT51 decoder through genuine AT07
`NativeContract`; the required semantic peer returns explicit unavailable
errors and is never invoked. No storage transaction, access authorization,
graph validation, queue or provider runs in this example. Consumer evidence is
retained outside publication.

AT07's scoped frozen JSON methods and AT11's original `SourceGrant`/
`PartitionGrant` guard revalidation are delivered at those pins. Remaining
owner seams are concrete:

* AT07: atomic queue/witness repository operations. The durable stock-envelope
  executor and history APIs were subsequently delivered at `d5161c6` below.
* AT11/host: genuinely qualified registration/access facts needed by queue and
  witness admission. Freshly reacquired grants cannot replace original handles.
* AT52: compose the scoped authorizer inside `with_mutation_authorization` and
  bind both storage authorization and domain access to the same live guard and
  original principal/grants, with exact mutation context/phase/closure checks.
  The callback returns `Result<(), E>`; capture owned output locally and release
  it only after the fence succeeds. This does not establish cross-store atomic
  rollback. No access-mutex reentry, reopened store, manufactured epochs or
  relabeled frozen stock/provider receipts supplies this composition.

The earlier inspected AT07 `3b14f0362aa2161d51b99d71e7d52d50f27f07de`
`NativeContract::validate_shape` lacked the five mappings below. Published AT07
`45e1e38e97a8e41536b4b6195449076d602589c0`, tree
`c7604784f4163b4792070b15340ce45b2d74b6f9`, now supplies all five through its
existing `checked::<schema::Type>(value)` helper and actual AT51 typed decode.
The unknown-name error and required semantic delegates are unchanged:

| Shape name | AT51 generated type | Required domain caller |
| --- | --- | --- |
| `snapshot` | `contracts::Snapshot` | `NativeStorage::snapshot` |
| `record` | `contracts::AtlasRecord` (`Record` alias) | `NativeStorage::record` |
| `audit` | `contracts::Audit` | `NativeStorage::history` |
| `guard` | `contracts::Guard` | `plan_atlas_commands` |
| `mutationResult` | `contracts::MutationResult` | `map_atlas_commit` |

Direct `validate_snapshot`/`validate_result` semantic delegation does not replace
these named shape checks. Domain validation remains mandatory; unknown-name
success or permissive fallback does not resolve this compatibility requirement.

The native bridge is compiled and statically reviewed. The five pure shape
calls above exercise generated decoding only; native mutation execution and
additional held controls remain unrun. It cannot enable new source presence;
atomic witness persistence and candidate/precommit rechecks remain required.

## Native Rust semantic composition

`native_semantics::NativeSemantics` is a thin development binding of AT07's
`Contract` to published AT51 semantic functions. Wrap it in the actual
`storage::NativeContract`; its shape method reuses that closed typed matcher.
Snapshot, guards, final create decisions, results and canonical JSON call the
real Rust semantic functions. It supplies no authorization, SQL connection,
provider transport, source-presence admission or default semantic peer.

AT51 semantic peer `a2f76f9b8b0a3dbd56fbd358a8e80b15490cbb05`
publishes both previously required functions. `NativeSemantics::native()` binds
them directly; the timestamp adapter only wraps the owner's `Option<i64>` in
AT07's `Result`. It creates no clock, parser, default or authority. The explicit
injected constructor is retained for hosts and synthetic consumers:

```rust
NativeSemantics::new(
    timestamp_millis: fn(&str) -> storage::Result<Option<i64>>,
    transition_from_value: fn(
        Option<&serde_json::Value>,
        &contracts::Mutation,
        &contracts::semantics::MutationTarget,
    ) -> Result<contracts::semantics::Transition, contracts::semantics::SemanticError>,
)
```

The actual AT51 exports are `timestamp_millis(&str) -> Option<i64>` using its
published format predicate and existing parser, and `assert_transition_from_value`
with the second signature above. The raw-current entry point preserves the
owner's original target/command/current processing order. Generated
`AtlasRecord` has typed payloads; converting the
current record first can preempt scoped-existence or create-existing decisions.
This binding retains current as raw detached JSON until that required function.
It copies no parser, error decision or transition rule and has no defaults.

Standalone guard/reference calls require a shape-validated current. Guards
explicitly validate it here; AT07 calls transition first in actual transactions.
The owner validates the complete final graph before ordered final create
decisions and retains each original preimage. Result priors preserve
unspecified/absent/record distinctions. Actual AT07 execution supplies previously
checked priors; standalone malformed-prior conversion/error ordering remains
unqualified. Semantic error categories are retained with the static sanitized
message required by AT07's error carrier.

The historical injected adapter at `f35bcdc2d9c24646356bc080bfb1ef157120bcb3`, SHA-256
`b75aac8eec9595b985692bb884936b857167b204bc1524c982a2dfb26e8a1bf6`, passed
external source check, warning-strict Clippy, build and accepted pure examples.
Six available adapter methods ran, plus the genuine typed create precondition
function with absent current. Canonical bytes matched a literal golden. Both
missing-peer call counters stayed zero; their example stubs return explicit
errors. No store, authority, queue, provider, JavaScript or held controls ran.
Exact source/fixture/check evidence is retained outside publication.

Historical root-source compiler manifest for that checkpoint:
`$HOUSEATLAS_SEMANTICS_MANIFEST`, with actual AT07
`45e1e38e97a8e41536b4b6195449076d602589c0`, AT11
`4967dd2d38c5749be35aa7e44728c4d691246730` and AT51 semantics
`e8ee351152c15a619ea805b1ce32d8ae76a12957`. It retains the exact versions and
features above and adds `ryu-js =1.0.2` and `regex =1.13.1`. Its external lock
and proof fingerprint are retained outside publication.
The library includes actual root domain/jobs source and compiler-only bindings
of this type to `NativeStorage` and `NativeScopedCommands`. The queue driver is
compiled only. Prior manifests/commands above require their captured historical
source; their older AT51 snapshots cannot compile this new semantic module.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path "$HOUSEATLAS_SEMANTICS_MANIFEST" --locked --offline --lib --bins
cargo clippy --manifest-path "$HOUSEATLAS_SEMANTICS_MANIFEST" --locked --offline --lib --bins -- -D warnings
cargo build --manifest-path "$HOUSEATLAS_SEMANTICS_MANIFEST" --locked --offline --lib --bins
```

The two owner exports are now supplied at the PR17 pin above. Atomic
stock/authority/presence/recovery composition remains required. This adapter
does not mount a production path or turn pure checks into native execution
qualification. The historical manifests above require their captured source;
they do not compile the later direct native constructor.

## Genuine PR17 semantic binding proof

The direct constructor above passed check, warning-strict Clippy, build and one
accepted pure consumer against exact AT51
`a2f76f9b8b0a3dbd56fbd358a8e80b15490cbb05`, AT07
`45e1e38e97a8e41536b4b6195449076d602589c0` and AT11
`4967dd2d38c5749be35aa7e44728c4d691246730`. All eight `Contract` methods
were exercised through genuine `NativeContract` and `NativeSemantics::native()`.
Published create/import-remap fixtures gave revisions `1` and `[2, 1, 1]`,
retained original priors, validated current shapes before standalone guards,
and validated the complete final graph before ordered final decisions. Owner
timestamp `1767355200000` and a literal canonical JSON golden matched.

Harness selected with `$HOUSEATLAS_NATIVE_PEER_MANIFEST` uses the
same exact dependency versions/features above. Its captured manifest, lock,
bridge and exact proof fingerprints are retained outside publication.
All then-owned Rust, harness, peer and lock bytes remained unchanged. That
scoped proof predates the native stock port; its captured `runtime-root-source`
is required to reproduce it against PR17 alone. The queue target was compiled
only. No SQLite, authority, provider, queue, JavaScript or held controls ran.

## Native stock schema development composition

`stock::NativeStockContract` binds the genuine offline `StockValidation` port
with fallible initialization and exact schema/value delegation. Existing
`ValidatedRequest::parse` consumes the host-admitted `Value` in its original
decision order; HTTP lexical/body/duplicate-key admission remains separate.
`stock::operational_time` now returns `StockResult<i64>` owner milliseconds,
retaining `InvalidClock` and original timestamp strings. Existing result
validation call sites retain their order. Downstream clock users must compare
these milliseconds; no calendar conversion introduces another accepted-range
or precision restriction.

The historical `f01bbb8` candidate used a caller-supplied
`$HOUSEATLAS_NATIVE_STOCK_MANIFEST` with the exact dependency versions/features
above, AT51 stock base `ece8f43fc726dc90857b316e7379e809b774853b` and the
same AT07/AT11 pins. AT51 subsequently published the combined peer at
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`, tree
`eb886fd1ddc4adfe5065f4308f56933796b70142`. Historical external reconciliation
provenance remains outside publication. No contracts edit is made in this lane;
root manifests and allowlists remain integrator work.

Locked/offline check, warning-strict Clippy and build passed against actual
root domain/jobs. The actual stock example then passed its same six healthy
cases through the native validator with synthetic authority/graph/owners.
Two literal accepted clocks checked compact-offset and submillisecond forms
against owner integer-millisecond goldens. All captured source remained
unchanged. This historical healthy proof records its exact source interval
outside publication; it does not claim a clean committed HEAD. The separate
final compiler-only proof remains outside publication.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path "$HOUSEATLAS_NATIVE_STOCK_MANIFEST" --locked --offline --lib --bins
cargo clippy --manifest-path "$HOUSEATLAS_NATIVE_STOCK_MANIFEST" --locked --offline --lib --bins -- -D warnings
cargo build --manifest-path "$HOUSEATLAS_NATIVE_STOCK_MANIFEST" --locked --offline --lib --bins
```

The queue target remains compiled only; the build commands above execute no
examples. Presence helpers validate shape only. Actual current authority,
freshness, atomic original-witness persistence, stock transactions and restart
admission remain owner duties. Neither catalogue/schema coverage nor these
healthy cases establish complete executed operations. Held controls remain
unrun.

## Historical published native core and stock composition

The earlier combined AT51 peer is
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`, tree
`eb886fd1ddc4adfe5065f4308f56933796b70142`, independently accepted
within ordinary scope. This earlier proof used AT07
`45e1e38e97a8e41536b4b6195449076d602589c0`; AT11 was
`4967dd2d38c5749be35aa7e44728c4d691246730`.
The actual published contracts import directly from the captured peer tree;
no owner overlay, copied export patch or substitute adapter is mounted.

The caller-supplied `$HOUSEATLAS_COMBINED_MANIFEST` retains the exact dependency
versions/features above. Check, warning-strict Clippy and build passed against
actual root domain/jobs with this published peer. The captured manifest, lock
and exact compiler proof remain outside publication.

All 76 captured owner contract/resource/package files exactly match the
previous tested union. The exact comparison proof remains outside publication.
All 31 current owned Rust files also match the actual stock/clock healthy
proof above. Those positive results are retained without runtime repetition;
the previously separate semantic proof remains preserved. The published
owner resolves the historical reconciliation dependency. Root dependency and
allowlist changes remain integrator-owned; actual authority, freshness,
atomic stock/witness transactions, restart and provider/queue runtime remain
separate duties. Held controls remain unrun.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path "$HOUSEATLAS_COMBINED_MANIFEST" --locked --offline --lib --bins
cargo clippy --manifest-path "$HOUSEATLAS_COMBINED_MANIFEST" --locked --offline --lib --bins -- -D warnings
cargo build --manifest-path "$HOUSEATLAS_COMBINED_MANIFEST" --locked --offline --lib --bins
```

## Concrete native stock execution and history

AT07 `d5161c6f86217cddb57113f952576d7f33fa1381` (tree
`5bbf6b7bca2a9a85654d554ac56d7581c60b30c9`) now supplies atomic original
root/child intents, intent digests, permanent keys and audit links through
`execute_stock_json_with_authorization`. It also supplies authorized stock
history with fixed watermarks and actor/scope/query-bound cursors through
`stock_history_json_with_authorization`. Earlier missing-stock descriptions
refer to older owner pins; these delivered APIs are bound here.

`stock::NativeAtlasCommands` forwards the same original principal and exact
prepared request to that executor, then returns `StockAtlasCommit::owner_result`
without rebuilding receipts. `stock::NativeStockReads` supplies the required
`StockHistoryPort`; `AtlasReads` delegates all ten history forms unchanged,
including cursor and literal command/state search. Frozen record-get methods
still use the store's configured authorizer A. The history/command authorizer B
is separately borrowed; the host must keep A guard-safe or perform frozen reads
outside B's held access fence.

`stock::CapturedAccess` seals initial AT11 entity and independent partition
handles from the exact original opaque principal. `NativeStockAuthority` binds
the same capture and prepared request to AT11's actual read boundary or live
`TransactionAuthorization`, implements native/stock storage authorization and
frozen `AccessPort`, and checks exact request/plan/child/commit correlation.
Its required `GraphAuthorization` receives the actual native facts, complete
augmented stock closure (including root guards), history audits/output and
original prepared witness/graph. That owner must prove the sealed capture belongs
to the original witness; initial capture is never an authority refresh.
There is no default or permissive graph checker. The full outer
`StockAuthorityPort` producer/disclosure implementation remains host-owned and
must also use the same live fence for mutation release.

`dispatch_prepared` borrows that same prepared value so the native authorizer
can retain it through every phase. The existing consuming `dispatch` delegates
to the same release checks. The host captures owned results locally inside
AT11's unit callback and releases them after the fence succeeds. This does not
provide atomic rollback across the access and Atlas databases.

Current peer compilation uses AT11
`4967dd2d38c5749be35aa7e44728c4d691246730` and genuine combined AT51
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c` with the AT07 pin above.
The task-owned manifest is
`$HOUSEATLAS_FINAL_NATIVE_MANIFEST`;
`rusqlite = "=0.40.2"` requires `bundled` and `backup` for this owner source.
No repository manifest, lock, generated contract, router or owner source changes
are included. Scoped check, warning-strict Clippy and build commands and exact
source/peer fingerprints are delivered separately.

`stock/examples/native_storage_healthy.rs` is an inspected fresh SQLite consumer:
create, replace, two ordered batch children, two recorded history pages and one
matching search. It uses actual native storage/schema/semantic/adapters and
`dispatch_prepared`, with explicitly synthetic authority, graph and clock/IDs.
It requires a new output directory and published synthetic fixture files through
`HOUSEATLAS_FIXTURE_ROOT`. AT11 guard binding is compiler/static evidence only;
no credential, session or grant setup runs in this consumer. Fixed-watermark
behavior is inspected owner code; no insertion-between-pages control is run.

Production durable `QueueStore`, complete graph/disclosure qualification and
atomic presence-witness composition remain integration duties. Provider dispatch
and new source-presence admission remain held. The queue example is compile-only;
no replay/negative/guard-reversal/fault/crash/concurrency controls, legacy broad
aggregates, provider calls, listeners or deployment are run.
