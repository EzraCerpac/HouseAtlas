# Passive Network inventory

AT09 ports the published Network inventory behavior into an embeddable Rust
component. Source base: `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. All implementation and healthy examples
are under this namespace. Root manifests, locks, router and generated contracts
remain owned by AT51/AT52. Accepted checkpoint `4fd2299a2e1789c3af84027d6d6799bae4cc7607`
is preserved; concrete transport and sidecar support are additive.

`InventoryGet` exposes only `GET /api/inventory`, with no caller-selected method,
path, query or body. The injected `InventoryTransport` remains available for
healthy fixture decoding. `HttpInventoryTransport` now supplies a concrete
Rust HTTPS client. Trusted host configuration provides an exact canonical
origin and source scope. The client verifies TLS certificates and hostnames,
uses WebPKI roots plus optional reviewed CA certificates, disables proxy
inheritance and redirect following, and rejects redirect/location responses.
Only an existing server-owned Cookie or Authorization header can be supplied
through `NetworkReadAuthority`; the component acquires no credentials or grants.
The original authority lease is revalidated before the request, at headers,
each stream chunk and before publication. Header material is private, sensitive,
bounded, and never included in DTOs or errors.

The client accepts HTTP/1 JSON with identity content encoding. Connect, read-idle,
and total time limits are bounded by trusted configuration; total time is at
most 60 seconds and body bytes at most 10 MiB. Each chunk is checked before
copying into the retained buffer. One monotonic absolute deadline is checked
before and after synchronous authority callbacks, including the callback after
EOF, and again before returning the transport result. Tokio's wait uses that
same deadline. Authority callbacks must be bounded/nonblocking: no file/network
I/O or unbounded lock waits. Synchronous callbacks cannot be preempted; an expired
callback result is rejected when it returns. An explicit cancellation token or
dropped refresh future drops the in-flight application future; no detached
refresh publishes later. Physical DNS termination and real target TLS/cancellation
qualification remain deferred. A 401/403 inventory status is classified as Auth
before Location/redirect response checks; no redirect is followed.
The component opens no application listener and performs no login, snapshot,
ARP, collector demand, diagnostics or upstream writes.
`project_capture` validates a complete inventory and revision-pinned `LinkReview`
and retains source IDs, verbatim source text, confidence, original link rows,
reported rates, distinct fact/snapshot/retrieval dates, observation values,
collector IDs, vantage and invalidation. Offline documents may contain retained
observations; there is no snapshot request capability. Graph positions are
validated and discarded. Groups remain source groups; segments remain abstract;
interfaces remain attachments. Names, addresses and graph positions establish
no physical placement. No Atlas ID, binding, circuit or geometry is created.

Membership is oriented member-to-segment, including when raw endpoints are
reversed. Ordinary connections retain their orientation. Historical associations
cannot become current connections. Source `observedAt` overrides the sidecar
fact date; notes are never interpreted as evidence. Reviewed unresolved targets
retain a description while the original link row retains both raw IDs.

`validate_state` reconstructs the entire generation from original retained rows
and its retained review before reads, proposals, facet building or sidecar
reopening. A configured review at the same revision must match. A newer review
does not reinterpret an older cached generation. Shared-home partitions require
explicit allowlisting of all inventory and observation IDs and their endpoints;
names and addresses never select a home.

`build_facet` performs no fetch. It exposes current claims separately from
historical/disputed/withdrawn relations, groups and abstract segments, computes
cache age and per-observation recent/stale/invalidated status, and preserves
unknown physical/device state. Revoked results withhold records while retaining
cache recovery metadata. Error codes/messages are fixed and cannot echo
transport details. Timeout, revocation, malformed-input, immutability-conflict,
rollback and concurrent behavior are coded but their stopped controls are unrun.

## Integration API

| Boundary | Proposed typed API |
| --- | --- |
| Trusted source input | `SourceRegistration`, `SourceScope`, `LinkReview`, `Limits` |
| Injected passive read | `InventoryTransport::get_inventory(InventoryGet, Limits)` returning a cancellable future of `InventoryResponse` |
| Authoritative cache browse | `NetworkProvider::read(&RetainedState)`; pure `build_facet(...)` |
| Preparation | `NetworkProvider::prepare_refresh(&mut self, prior, expected_cache_epoch, generation_id, transport, clock)` |
| Complete publication input | `RefreshOutcome::Complete(CompleteGenerationProposal)` with read-only `state()` and `precondition()` accessors |
| Failed attempt | `RefreshOutcome::Failed(RefreshFailure)` with sanitized error and retained internal state; never a complete proposal |
| Retained sidecar | `stage_row`, `validate_immutable_replay`, `reopen_sidecar`, `validate_sidecar_packet` |
| Concrete bounded HTTPS | `ReviewedNetworkOrigin`, `NetworkHttpConfig`, `HttpInventoryTransport` |
| Original current authority | `NetworkReadAuthority` and its opaque associated `Lease` |
| Durable immutable rows | `DurableNetworkSidecar`, native `SqliteNetworkSidecar`, opaque `DurableNetworkReceipt` |
| Consuming host publication | `refresh_network`, `NetworkCachePublisher<Lease>`, `NetworkPublicationFence`, `StagedNetworkPublication<Receipt>` |
| Native consuming transactions | `NativeNetworkPublisher`, `NativeNetworkLease`, `stage_complete_generation` |
| Retained failure proposal | `NetworkPublicationOutcome<Receipt, Fence, Lease>::SourceFailure(PendingNetworkFailure)`; no metadata write |

Preparation makes one GET and creates a complete proposal without changing
`prior` or publishing a cache pointer. The proposal includes the expected prior
generation ID and expected cache epoch. A successful same-revision inventory
must have the same canonical source contents; a revision cannot go backwards.
JSON numeric tokens are normalized at ingestion to finite IEEE-754 binary64
values, matching JavaScript `Number`. Retained data preserves that interpreted
value, not arbitrary-precision digits or the original integer/decimal/exponent
spelling. Negative zero is normalized to zero, matching canonical JSON output.
An integer Serde representation encodes the already-rounded binary64 value; it
never retains additional raw-token precision. Canonical sidecar serialization
and reopening therefore retain the same interpreted value. The `float_roundtrip`
Serde JSON feature supplies correctly rounded decimal parsing. Source and review
revisions accept all finite nonnegative safe integral numeric spellings,
including `42`, `42.0` and `42e0`, and are stored as `u64` after validation.
Canonical serialization uses ECMAScript number rendering and UTF-16 key ordering.
Shared-schema collection/allowlist IDs and cache error messages count Unicode
code points; upstream source labels/opaque IDs retain their pinned UTF-16 limits.

The immutable `SidecarRow` preserves the published
`houseatlas-network-sidecar/1` fields, canonical partition key, canonical body
and SHA-256 digest. Reopening requires the exact generation ID, published cache
success metadata, retained relation set and retained review. Full packet
validation precedes import. Bounds match the retained implementation: 10 MiB per
row, 10,000 rows and 16 MiB per packet. `stage_row` prepares bytes; it performs no
SQL write. Reopening returns validated **internal** state, preserving retained
generations even with revoked cache metadata so a subsequent authorized refresh
still compares revisions and same-revision inventory. Failed preparation also
keeps internal retention. The host must expose public data through `read`,
`public_read` or `build_facet`, which withhold revoked records; internal retained
state is not a browser DTO.

`SqliteNetworkSidecar` uses a dedicated trusted private database path and
immutable configured source registry. Native SQLite WAL/FULL commits complete
validated rows before returning an opaque receipt. It retains exact published
partition/generation/hash/body columns, rejects changed replay, validates packet
quotas against existing rows, bounds SQLite text lengths before materialization,
and reconstructs retained rows on load. Old generations remain available;
no cleanup/delete API is exposed. This store is separate from Atlas storage.
It is compatible with the published core-network sidecar table names/version,
not a migration of shared Atlas tables.

`refresh_network` captures one authority lease before storage preparation,
keeps AT07's original fence across the fetch, reopens the prior immutable row,
projects and authorizes a complete generation, durably stages it, and consumes
the original fence plus a sealed staged proposal at publication. Scope,
reserved generation ID, baseline generation ID and cache epoch must agree.
Cache epoch is distinct from access-registry authority epoch. No reread/rebase
replaces the original CAS witness. Source failure returns a sealed
`PendingNetworkFailure` containing sanitized failure/internal retention, the
original baseline generation/cache-epoch precondition, original fence and
original authority lease. It writes no cache metadata. No partial generation
crosses the complete-publication boundary. Published snapshots may contain
seeded Network relation rows before the first successful cache pointer. Those
rows remain native storage projections; with no pointer, the provider has no
retained inventory generation, matching the published sidecar's behavior.

`native.rs` binds directly to AT07's `AtlasStore<C, A, R>` at immutable
published commit `9b13f1e97635a3f531e8c14642cd3c5e94401fef`. It implements
`NetworkCachePublisher` with the ACTUAL `CachePublicationFence` and
`CacheStatus`, not a recreated witness. Source registration from the original
fence must equal reviewed Network configuration, including partition mode and
allowlist. The wrapper checks the original generation/cache-epoch precondition
and reserved candidate ID before consuming the original fence at native
`publish_prepared_generation`. The success transaction validates publication
against the current immutable source registration and compares the original
generation/cache epoch. The failure transaction explicitly compares the current
registration with the full registration captured in the original fence.

`NativeNetworkLease<A>` borrows the storage principal that retains the original
inventory authority lease. There is no default principal, grant acquisition,
authorization decision or handle replacement here. The actual store authorizer
must keep and revalidate that same branded handle at precommit; binding this
trait to the actual AT11 principal remains AT52 work.

`NativeNetworkPublisher::new(&mut original_store).with_authorization(&original_authorizer)`
returns `BorrowedNativeNetworkPublisher`, using AT07's per-call cache seam from
`e11c17a175eb73980c31b0b3f71d90dbbf816899`, retained in
`6754297d06a82b14c360ab7721295467d04eddb7`. Its prepare, complete publication
and fenced failure methods call only the corresponding
`*_with_authorization` native methods with that borrowed peer. Its lease
implements `NativeNetworkLease<B>`; `B::Principal` may differ from the configured
store authorizer's principal. The original open store, issuing-store identity
and opaque fence remain unchanged. Release this synchronous wrapper for the
provider await, then construct it over the same store and same original
borrowed authorizer for publication. Do not recreate authority or reopen Atlas
storage between these phases. Configured and borrowed adapters share the same
proposal/carrier checks; the configured API remains available. The existing
retained sidecar stages provider rows independently; the per-call seam creates
no database, connection, grant or fence replacement.

The external per-call healthy example compiles full published AT07 storage at
`6754297d06a82b14c360ab7721295467d04eddb7` with contract/domain/jobs sources
at published host `825c106a30cfdd5297878f2b169efcb483eeb308`. It uses actual
native contract DTOs and `NativeSemantics`, distinct positive configured and
per-call principal types, one original borrowed authorizer/principal, complete
synthetic inventory publication, and a valid fenced synthetic status write.
It checks epoch `0 -> 1 -> 2`, four retained relations, sidecar reopening,
unchanged scoped records and zero audits. The pending failed-read method is
compiled; failed reads and held failure/rejection/concurrency controls are not
executed. Actual AT11 handle binding and host wiring remain integration work.

For failures, `NativeNetworkPublisher::publish_pending_failure` consumes the
pending proposal's original fence, baseline precondition and original lease,
then calls the actual `record_prepared_cache_failure(principal, fence, failure)`.
The sibling `record_prepared_cache_failure(fence, code, lease)` supports explicit
server-owned sanitized status publication through that same native transaction.
Both require a Network-owned original registration; neither calls legacy
`record_cache_failure`. AT07 checks issuing store, captured full registration,
generation and SQLite epoch in its write transaction, retains prior success
metadata/rows, advances the epoch and does not reserve the unused candidate ID.
The generic controller still returns pending failures; a native host explicitly
consumes them through this bound method. No stale baseline is reread or rebased.

Use `NativeNetworkPublisher` only in synchronous prepare/commit phases. Release
its store borrow before provider GETs, retain the original fence/lease, and
recreate the wrapper over the SAME open store at commit. `stage_complete_generation`
consumes the provider's opaque complete proposal after native durable sidecar
staging; its sealed result is the native publisher's complete-publication input.
Authorize source/generation separately before staging and inside publication.
The existing async controller remains useful for injectable publisher ports;
the phased native binding lets Atlas browsing continue during provider work.

The external native healthy executable uses the unchanged published
`plan-free.snapshot.json`, including its seeded Network relations before a cache
pointer exists. It compiles actual Network code, this
exact AT07 source, and native AT51 contract types at
`6b3029cbbcf1462ecdeecc62a56c24f66e034057`. Its offline published semantic/JCS
oracle, authorization/runtime/principal and injected inventory are explicit
synthetic peers. It publishes one complete projected generation after actual
SQLite sidecar staging, writes one valid synthetic timeout status using a
current original fence, verifies epoch 0 -> 1 -> 2, retained generation/four
relations, no audit creation/no failure-candidate reservation, and native
store/sidecar close/reopen. No read fails and no stale-failure/race probe runs.
The pending failed-read consumer is compiled; failed transport execution remains
held. Actual AT11 authority, production Rust semantic Contract and AT52
route/configuration/coalescing remain host integration inputs.
Lane-local Serde models mirror published Network projections, `sourceRegistration`,
`cacheStatus` and `networkRelation`. They remain conversion boundaries for shared
Rust types; no contract or history/audit schema changes are made.
## Dependencies and verification

The external task-owned compiler harness uses edition 2024/Rust 1.99.0 and
imports this namespace's actual `mod.rs` alongside the exact published storage
and contract modules in its external library wrapper. It uses the inspected pins:

```toml
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = { version = "=1.0.151", features = ["float_roundtrip", "raw_value", "arbitrary_precision"] }
chrono = { version = "=0.4.42", default-features = false, features = ["std"] }
sha2 = "=0.10.9"
ryu-js = "=1.0.2"
tokio = { version = "=1.53.2", features = ["rt", "time", "macros", "sync"] }
reqwest = { version = "=0.12.24", default-features = false, features = ["rustls-tls-webpki-roots", "stream"] }
tokio-util = { version = "=0.7.16", features = ["rt"] }
url = "=2.5.7"
rusqlite = { version = "=0.40.2", features = ["bundled"] }
# Existing AT07/AT51 native contract dependency, defaults disable retrieval:
jsonschema = { version = "=0.58.6", default-features = false, features = ["arbitrary-precision"] }
```

AT52 owns dependency reconciliation and Cargo.lock. The strict JSON dispatcher
uses `raw_value` so arbitrary-precision feature unification does not alter the
published JavaScript binary64 interpretation or object-key validation.
The positive TLS fixture additionally needs Tokio `net`/`io-util`, and dev-only
`rcgen = =0.14.5` (defaults off; ring/crypto/pem) and `tokio-rustls = =0.26.4`
(defaults off; ring/tls12). Synthetic certificate/key material exists only in
memory for the one disposable loopback TLS fixture.

Seven pure/injected positive examples retain projection, membership, facet,
sidecar, source-text, observation, revision and numeric/Unicode coverage.
An eighth positive example runs the real client against one disposable
`127.0.0.1` HTTPS fixture, verifies its synthetic certificate, reads chunked
inventory, stages actual native SQLite, consumes a synthetic publisher fence,
closes/reopens the database, and deletes its private temporary directory.
That listener belongs only to the explicitly permitted healthy fixture; no
application listener or live provider is started. Internal revocation handling
and held failure/adversarial controls remain unexecuted.

With the external manifest and offline parity-script variables configured,
the scoped checks are:

```sh
cargo fmt --manifest-path "$AT09_HARNESS_MANIFEST" --check
cargo check --locked --manifest-path "$AT09_HARNESS_MANIFEST"
cargo clippy --locked --manifest-path "$AT09_HARNESS_MANIFEST" --all-targets -- -D warnings
cargo test --locked --manifest-path "$AT09_HARNESS_MANIFEST" --lib healthy::
cargo run --locked --manifest-path "$AT09_HARNESS_MANIFEST" --bin houseatlas-at09-harness
node "$AT09_PARITY_SCRIPT"
# AT09_STORAGE_PEER points to the exact external published storage/oracle tree.
# AT09_HEALTHY_OUTPUT is a fresh private synthetic directory.
cargo run --locked --manifest-path "$AT09_HARNESS_MANIFEST" --bin native-healthy -- "$AT09_HEALTHY_OUTPUT"
```

The external driver emits baseline, label, observation, numeric-normalization,
Unicode-collection and integral-revision scenarios. The offline
JS comparison uses the actual published projector, facet builder, canonical
serializer and schema validators: complete state, reopened state, fresh/stale
facets, sidecar canonical bytes and digest match exactly, and the relations join
a valid synthetic frozen snapshot. The numeric and Unicode observation example
also checks ECMAScript scalar rendering and UTF-16 key order. The native TLS/SQLite example at preserved checkpoint
`f52f14db07edad3aeb98c96e9ad0182f6169cc9b` is healthy synthetic execution; the
published-JS comparisons cover the decoder's supported published shape. The
subsequent static-review correction uses compiler-only verification of actual
source and all healthy targets; it adds or executes no auth, failure, deadline,
negative or network probes. Neither
qualifies a real target's native wire format, host authorization/atomic publication,
or durable recovery under faults. No legacy broad aggregate, stopped control,
live provider, grant/credential acquisition or deployment is used.

Behavioral references at the pinned base:

- `adapters/network/src/index.mjs` (projection, cache validation and facet)
- `adapters/network/fixtures/inventory.wire.json` and `fixtures/link-review.json`
- `server/src/network-sidecar.mjs` (immutable retained rows and pointer reopening)
- `packages/contracts/schemas/atlas.schema.json` and `policy/boundaries.json`
- `packages/contracts/src/index.mjs` (canonical scalar serialization and validation)

The published HTTP history schema remains unchanged; this lane emits no history
HTTP response or audit event. The AT52 route/config adapters, production semantic Contract,
AT11 authority mapping, real target wire review and held timeout/denial/failure/
concurrency/recovery qualification remain future integration work.

### Retained raw link binding

`validate_generation(source, generation)` reconstructs the entire capture with
its retained review and compares every qualified row and projected relation.
`validate_state` uses this same validation without changing its cache checks.
`retained_link_bindings(source, generation)` validates once and returns borrowed
`RetainedLinkBinding` rows containing the original link, original typed `from`
and `to` records, and the exact reviewed relation. Matching uses keyed indexes.
Raw direction is preserved for normalized segment memberships; an unresolved
projection keeps its null ID/description while the private binding still names
the actual hidden raw member. These are matching records, not permission.

Runtime and Store owners must use the original owning-Core grants and immutable
native cache baseline before disclosure. An unresolved projected endpoint
cannot replace raw-member binding or justify revoking the entire partition.
The original Network core exports this seam; no host-runtime/Store selector is
changed here. Saved stock output preserves the reviewed unknown and all other
authorized relations. Its healthy examples use actual validation/projection/
stock schemas with explicit synthetic authority peers, so they do not qualify
the genuine runtime composition or held controls.
