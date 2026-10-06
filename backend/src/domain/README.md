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
is the published 15 minutes. JSON numbers retain integer and supported floating
values without routing every value through `f64`. Serialization does not preserve
the original decimal or exponent spelling.

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
an explicit stub; production source-policy/version checks await AT11.
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

## Dependencies and scoped evidence

Current external compiler manifest:
`/tmp/houseatlas-at36-wire3-harness/Cargo.toml`. The original domain harness and
checkpoint evidence are preserved separately. No repository manifest/lock was
created. Verified with Rust 1.99.0. Direct production dependency pins:

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

The new composed compiler harness is
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
provider admission. AT52's published `ReadContracts` and `ReadAuthority` still
reject mutations. A future command-capable host must keep the original principal
and source grants current under the access transaction fence throughout all
AT07 phases; it must retain the new-presence hold. No route is mounted here.

The compiler-only native harness is
`/tmp/houseatlas-at36-native-adapter-harness/Cargo.toml`. It imports exact published
AT07 `da3f607ee56ee7bcb836ed868bb1b10fdbcbb7f6`, AT11
`3f83d8f35f2cc1948b5d361badfc77948745676d`, and AT51
`358ec380a82d6c9e9aac4ca039c0ab8a381cf011` sources. Its direct dependencies are
pinned to the published integration workspace
`a5d456c43ac59acfc0c4f8aceafb08bae6df0ac0`; JSON preserves arbitrary precision
and schema retrieval is disabled. The external harness owns its own lock. The
older standalone wire3 harness remains evidence for the published checkpoint;
current source needs the native storage module in the composed crate.

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo check --manifest-path /tmp/houseatlas-at36-native-adapter-harness/Cargo.toml --locked --lib
cargo clippy --manifest-path /tmp/houseatlas-at36-native-adapter-harness/Cargo.toml --locked --lib -- -D warnings
cargo build --manifest-path /tmp/houseatlas-at36-native-adapter-harness/Cargo.toml --locked --lib
```

Next owner seams are concrete:

* AT07: synchronous per-operation authorizer override on the same store
  connection, retaining every Intake/Validate/Candidate/Precommit/Replay check;
  typed durable stock-envelope and atomic queue/witness repository operations.
* AT11: original `SourceGrant` and `PartitionGrant` revalidation on the existing
  `TransactionAuthorization` guard, plus genuinely qualified registration/access
  facts needed by queue and witness admission. Freshly reacquired grants cannot
  replace the original handles.
* AT52: compose the scoped authorizer inside `with_mutation_authorization` and
  mount through its existing blocking owner. Do not reenter the same access
  mutex, reopen the store, manufacture epochs or interpret frozen receipts as
  durable stock/provider receipts.

The native bridge is compiled and statically reviewed, with no native runtime
exercise or additional held controls. It cannot enable new source presence;
atomic witness persistence and candidate/precommit rechecks remain required.
