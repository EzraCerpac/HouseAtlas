# Rust source-presence content qualifier

This scoped development component implements published semantic amendment 1.1.0
and witness/qualification schema 1. It produces typed content using the existing
contract validator, storage carriers and HomeBox/Network read adapters. It does
not persist witnesses or enable runtime admission. The existing
`enforce_current_presence_hold` and storage hold are unchanged.

`component.rs` is deliberately not named `mod.rs`: the integrator-owned
`domain/presence.rs` already occupies that Rust module name. Integration can add
a child with `#[path = "presence/component.rs"] pub mod qualified;` in that
file. No repository module declaration, manifest, router, schema, migration or
publication integrity entry is changed by this component.

## Exact inputs

`accepted-inputs.json` pins 33 unchanged published/native peer and fixture
preimages at base commit `6214a015066de5733e0ab7664678019bae0cdf84`. Each pin is a
SHA-256 of the entire original file. The presence policy and typed contracts are
consumed directly; no schema or fixture is regenerated. The healthy runner
imports the original plan-free snapshot, stock presence metadata fixture,
Network inventory and link review with `include_str!`/`include_bytes!`.

## Implemented mapping

`current_presence_requirement` delegates to the accepted trigger predicate.
Create-present, nonpresent-to-present, active-present restoration and changed
evidence-ID membership require a new observation. Review acceptance alone and
reordered identical evidence membership retain historical observations. Submitted
payloads, evidence arrays and receipt digest semantics are not rewritten.

`CurrentPresenceRead::qualify_member` maps AT07's `CachePublicationState` plus
the exact registration. It requires fresh successful cache metadata, the exact
partition/generation/epoch, registration digest and allowed member. Age checks
use HomeBox's `cache_freshness` or Network's `build_facet` with the host's existing
configured threshold; no additional TTL or default threshold is introduced.

HomeBox membership comes from the exact saved projection. The entire original
JSON Value is canonical-hashed, including attachments, maintenance and native
links. The entity must be nonarchived and its explicit location/item flag must
match the final active Atlas identity. Unknown types stay unknown and supply no
positive compatible-type observation. Saved retrieval/update dates remain exact.

Network uses `reopen_sidecar` with the actual published pointer, cache, relations
and configured review. That peer checks the immutable full-state row digest and
generation before selecting exactly one corresponding device/group inventory
member. Relation endpoints and filtered facets supply no membership. The member
hash covers the full normalized inventory carrier, and the verified generation
hash comes from the immutable full-state row. Source revisions and nullable
source snapshot dates remain the provider's values.

`read_current_store` concretely borrows `AtlasStore` and invokes its trusted
`read_cache_for_publication` API; for Network it loads only that exact pointer
through `DurableNetworkSidecar`. Registration is supplied by the trusted caller,
not exported by this read. This API requires the existing PublishCache authority
and opens its own storage read transaction. It is a development/preflight
adapter, not an atomic mutation reader or an authority producer.

`NativePresenceQualifier` implements the existing `PresenceQualifier` port.
It retains candidate content, resolves each assertion from transaction graph
rows, checks the original principal borrow and all original entity/partition
grants via the actual `TransactionAuthorization` methods, and compares original
graph rows and qualification facts at precommit. It never issues replacement
grants, rebases a generation, fetches a provider or rewrites retained observations.
`NativePresenceContracts` binds the existing `PresenceContractPort` to the
accepted native qualification validator. These adapters are compiled; their live
atomic composition is not implemented or qualified here.

`CapturedPresenceContent::witness_content` builds the accepted typed
`contracts::stock::PresenceWitness` from final storage binding/audit rows. It
checks unchanged payload, scope/record identity, operation, actual revision
linkage, before/after canonical digests, audit ID and timestamp linkage. The
audit supplies actor/mutation IDs and `admittedAt`; the successful cache supplies
`observedAt`. The function generates no ID or time, grants no authority and
performs no durable write. Shape-valid content is not proof of persistence.

## Required atomic-storage seam

AT07 must implement `AtomicPresenceTransaction` on its opaque active mutation
handle, using the following four methods from `authority.rs`:

1. `binding_change(phase, assertion)` returns the actual original/candidate
   binding, final active identity and ordered operation from that transaction.
   Retain the same candidate rows through the qualifier's precommit phase;
   final audit/revision stamping is supplied separately to `witness_content`.
2. `assert_presence_graph` checks the entire actual original/candidate/touched/
   guarded/referenced/final graph under the same principal and captured handles.
   New presence and manual review acceptance remain independent checks.
3. `current_presence` returns the latest visible complete successful publication,
   integer cache epoch, full durable registration, saved HomeBox projections or
   exact immutable Network row/review under that same active transaction. The
   existing detached public read cannot implement this atomic requirement.
4. `original_presence_authority` obtains original context format/ID, genuine
   persisted opaque access epoch, access package version, enabled source-row
   registration version and canonical registration digest from the retained
   AT11 authority under its existing held guard. AT11 currently revalidates
   original grants but exposes neither persisted epoch nor registration version;
   it needs an owner-supplied read-only metadata export. A principal version,
   serialized grant or caller-provided authority DTO cannot substitute.

Inside the same active transaction, call `PresenceCapture::capture` with
`NativePresenceQualifier`/`NativePresenceContracts`, then
`PresenceCapture::revalidate` immediately before final commit. Recompute the
configured age and original grant/registration facts; any changed pointer,
epoch/member/digest/authority fails comparison. No provider fetch runs under
the lock. Stamp witness content only from actual final binding/audit rows, then
append witnesses atomically with binding, audit and receipt. Extend the storage
owner's immutable/append-only validation and export/recovery inventory to include
these rows; do not fabricate legacy witnesses. Recovery and historical read
disclosure require current authority, not a fresh existence requalification.

SQL representation, migrations, transaction orchestration and recovery remain
storage-owned. Module mounting and central file-allowlist updates remain
integrator-owned. Keep the existing runtime hold until that real composition is
accepted. No sourceRevision overload or service-side witness sidecar is supplied.

## Permitted verification

With the repository's retained Rust 1.99.0 environment activated and dependencies
available in its Cargo cache:

```sh
export CARGO_TARGET_DIR=/tmp/houseatlas-presence-target
python3 backend/src/domain/presence/check_healthy.py
```

The inspected script creates only a temporary external Cargo harness and imports
this scoped source with the actual backend dependency. Registry versions and
checksums remain those in the unchanged root lock; only external harness package
metadata and the dependency-package dev edge are adapted. It uses locked offline
check/Clippy, explicit rustfmt checks and exactly `examples/healthy.rs`.

The healthy executable successfully publishes HomeBox and Network generations
through the actual native SQLite cache APIs and reads their current state.
Its authority is fixture-only storage metadata; no AT11 credentials or grants are
created. Network GET and retained-row loading are in-memory synthetic peers.
Seven positive content cases cover the four triggers, compatible HomeBox location
and item types, Network device/group membership, original member/full-row hashes,
required null Network snapshot dates and typed witness/qualification round trips.
Two retained-observation examples cover evidence reordering and review-only change.
No witness table or new binding/audit/receipt admission is written.

Compilation and these healthy examples establish development behavior only.
Live source/authority admission, atomic witness persistence, recovery qualification
and production acceptance remain open. Historical rejection/replay/fault/crash/
concurrency/corruption/expiry/revocation/adversarial controls remain unrun. No
provider/account call, new credential/grant, deployment or paid inference is made.
