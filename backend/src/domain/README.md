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
This frozen binding does not persist stock root/child intent or stock receipts;
the actual atomic stock executor remains required for wire3 commands.

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
`/tmp/houseatlas-at36-wire3-harness/Cargo.toml`. The original domain harness and
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
cargo fmt --manifest-path /tmp/houseatlas-at36-wire3-harness/Cargo.toml --check
cargo check --manifest-path /tmp/houseatlas-at36-wire3-harness/Cargo.toml --locked --all-targets
cargo clippy --manifest-path /tmp/houseatlas-at36-wire3-harness/Cargo.toml --locked --all-targets -- -D warnings
cargo build --manifest-path /tmp/houseatlas-at36-wire3-harness/Cargo.toml --locked --all-targets
cargo test --manifest-path /tmp/houseatlas-at36-wire3-harness/Cargo.toml --locked --lib healthy::
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
`/tmp/houseatlas-at36-wire3-harness/Cargo.toml`; it includes the stock dependency
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

Historical compiler checkpoint: at AT36
`64da6ea293dbb7fd7798105e92e7c4a65be7262f`, the external
manifest `/tmp/houseatlas-at36-scoped-native-compiler-moanglpb/Cargo.toml` compiled
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
scrypt0.11.0 (no defaults), and subtle2.6.1. Its task-owned `Cargo.lock` SHA-256
is `ab69fa1b93535caddc2884551e32b862259465e8f10bd8255733aca0fef7ea58`.
Schema retrieval is disabled. Check, warning-strict Clippy and build passed
with unchanged Rust-source fingerprints; final frozen-source proof:
`/tmp/houseatlas-at36-scoped-command-final-checks/checks.json`, SHA-256
`dfe4f34e76450735dfcc5838f8cd09e955d8df2ff38a5ebace42909413c774b7`.
Earlier concurrent peer checks are retained separately and are not that proof.
The SQLite queue driver is compiled only. Older standalone/native bridge
harnesses retain their historical inputs and do not compile current scoped
source without the newer peer methods and contract numeric carriers.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path /tmp/houseatlas-at36-scoped-native-compiler-moanglpb/Cargo.toml --locked --offline --lib --bins
cargo clippy --manifest-path /tmp/houseatlas-at36-scoped-native-compiler-moanglpb/Cargo.toml --locked --offline --lib --bins -- -D warnings
cargo build --manifest-path /tmp/houseatlas-at36-scoped-native-compiler-moanglpb/Cargo.toml --locked --offline --lib --bins
```

The subsequent historical shape-compatible composition uses external manifest
`/tmp/houseatlas-at36-fixed-native-composed-6t9pdcxd/Cargo.toml` with exact AT07
`45e1e38e97a8e41536b4b6195449076d602589c0` and the same AT11/AT51 pins,
dependency versions/features and lock hash above. Locked/offline library and
compile-only queue-driver check, warning-strict Clippy and build passed. Rust
fingerprints stayed unchanged; the initial full-source interval records only a
concurrent README correction. That interval is retained as such.

The separate external consumer
`/tmp/houseatlas-at36-fixed-native-shapes-3ely7qql/Cargo.toml` also passed check,
warning-strict Clippy and build. It then executed exactly five accepted pure
shape calls once: snapshot, record, audit, guard and mutationResult. It uses the
published plan-free snapshot/create-circuit result and an integral `1e0` guard.
All shapes pass the actual typed AT51 decoder through genuine AT07
`NativeContract`; the required semantic peer returns explicit unavailable
errors and is never invoked. No storage transaction, access authorization,
graph validation, queue or provider runs in this example. Consumer proof:
`/tmp/houseatlas-at36-fixed-native-shapes-3ely7qql/checks-evidence.json`, SHA-256
`a457f95947bf4fbb5986b6003c192e1fb9fb430df415b3807b4c4c0411c28bb7`.

AT07's scoped frozen JSON methods and AT11's original `SourceGrant`/
`PartitionGrant` guard revalidation are delivered at those pins. Remaining
owner seams are concrete:

* AT07: typed durable stock-envelope and atomic queue/witness repository
  operations.
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
Exact source/fixture/check evidence:
`/tmp/houseatlas-at36-semantics-inspection-_91defwl/semantic-composition-evidence.json`,
SHA-256 `e4d9751ddca02995899800d374a091aaf6720371aee84fbf6190116a0da11da0`.

Historical root-source compiler manifest for that checkpoint:
`/tmp/houseatlas-at36-semantics-final-8je86aqp/Cargo.toml`, with actual AT07
`45e1e38e97a8e41536b4b6195449076d602589c0`, AT11
`4967dd2d38c5749be35aa7e44728c4d691246730` and AT51 semantics
`e8ee351152c15a619ea805b1ce32d8ae76a12957`. It retains the exact versions and
features above and adds `ryu-js =1.0.2` and `regex =1.13.1`. Its lock SHA-256 is
`6c403b6d843c4942a8fc6110b82210e016ec11af2fb34660047d49fc5ef27270`.
The library includes actual root domain/jobs source and compiler-only bindings
of this type to `NativeStorage` and `NativeScopedCommands`. The queue driver is
compiled only. Prior manifests/commands above require their captured historical
source; their older AT51 snapshots cannot compile this new semantic module.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path /tmp/houseatlas-at36-semantics-final-8je86aqp/Cargo.toml --locked --offline --lib --bins
cargo clippy --manifest-path /tmp/houseatlas-at36-semantics-final-8je86aqp/Cargo.toml --locked --offline --lib --bins -- -D warnings
cargo build --manifest-path /tmp/houseatlas-at36-semantics-final-8je86aqp/Cargo.toml --locked --offline --lib --bins
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

Harness `/tmp/houseatlas-at36-native-peer-api-buizmrmn/Cargo.toml` uses the
same exact dependency versions/features above. Manifest SHA-256:
`83e385546c96c69f9dfb8ec707d14681dbe13741aa04723dc423a8832cec508d`;
lock SHA-256:
`2f47c267839053a3075e2fdc2a77563305322da24c4ac73ea241e8a0aac593f2`.
Bridge SHA-256:
`8847b4c877a7d5cc08fc5122654723c61d7473e17c9d26a53b379c87491522ae`.
Exact proof `/tmp/houseatlas-at36-native-peer-api-buizmrmn/native-peer-positive-evidence.json`,
SHA-256 `7c43074759b710a759410a0d243bac246eeeeaf80459eee7748b3e15e37e5733`.
All then-owned Rust, harness, peer and lock bytes remained unchanged. That
scoped proof predates the native stock port; its captured `runtime-root-source`
is required to reproduce it against PR17 alone. The queue target was compiled
only. No SQLite, authority, provider, queue, JavaScript or held controls ran.
