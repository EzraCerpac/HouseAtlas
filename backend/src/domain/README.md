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
cursor policy. `CurrentOutput` is a proposed browser extension, not a replacement
for canonical HomeBox list responses or the frozen history schema.
Domain errors retain all frozen code categories and authorized revision/guard
conflict revisions, so adapters can preserve the published 401/409/412/428
classification. Canonical HomeBox list assembly must also retain the published
unsafe-external-URL rejection behavior; browser projection alone uses null URLs.

## Dependencies and scoped evidence

External compiler manifest: `/tmp/houseatlas-at36-domain-harness/Cargo.toml`.
No repository manifest/lock was created. Verified with Rust 1.99.0. Direct pins:

```toml
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.145"
time = { version = "=0.3.44", features = ["parsing"] }
url = "=2.5.7"
```

`healthy.rs` contains exactly four healthy synthetic examples. Read/access/
command adapters are explicit fixture stubs. They prove query/projection and
delegation behavior, not production access or durable Atlas mutations. The
fixture command validator accepts only those exact fixed values. The separately
inspected `healthy-schema.mjs` validates the same published single/batch values,
two healthy snapshots and three history arrays using the actual published
schema and pure graph validator. It invokes no retained test alias or control.

Run only these scoped new-source checks after inspecting them:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
cargo fmt --manifest-path /tmp/houseatlas-at36-domain-harness/Cargo.toml --check
cargo check --manifest-path /tmp/houseatlas-at36-domain-harness/Cargo.toml --locked
cargo clippy --manifest-path /tmp/houseatlas-at36-domain-harness/Cargo.toml --locked --all-targets -- -D warnings
cargo build --manifest-path /tmp/houseatlas-at36-domain-harness/Cargo.toml --locked
cargo test --manifest-path /tmp/houseatlas-at36-domain-harness/Cargo.toml --locked --lib healthy::
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

Missing exact inputs: AT51 generated Rust/HTTP contracts, AT07's Rust transaction
adapter, AT11's Rust principal/authority adapter, and full reviewed wire3
HomeBox operation/precondition/receipt/acknowledgement schemas. Network facet,
geometry, aliases/mobility/navigation peers are not synthesized. Queue payload
preparation awaits wire3; no HTTP writer or provider credential path exists.
See `../jobs/README.md` for the global queue and its real synthetic SQLite
consumer. Fault/crash/rejection/adversarial/concurrency qualification and all
legacy broad aggregates remain deferred and unrun. No remote push, PR, merge,
listener, provider call or deployment is part of this patch.
