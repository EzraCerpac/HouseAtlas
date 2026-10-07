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
copying into the retained buffer. An explicit cancellation token or dropped
refresh future drops the in-flight application future; no detached refresh
publishes later. Real target DNS/TLS/cancellation qualification remains deferred.
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
replaces the original CAS witness. A sanitized source-failure port retains prior
rows; no partial generation crosses the complete-publication boundary.

The AT07 seam was inspected at immutable peer commit
`3b14f0362aa2161d51b99d71e7d52d50f27f07de`. Host mapping is narrow:

- Convert `prepare_cache_publication(principal, scope, partition).into_parts()`
  into `PreparedNetworkCache`, preserving the actual non-cloneable fence.
- Implement the fence getters using its original partition, baseline generation,
  `CacheEpoch.value()` and reserved generation. Do not serialize/recreate it.
- Consume `StagedNetworkPublication::into_parts()`, then call
  `publish_prepared_generation(principal, original_fence, cache, [], relations)`.
  Revalidate the same original access lease inside the host authorization/commit
  boundary; the sidecar receipt is proof of staging, never authority.
- Map source failure to AT07's original-scope sanitized failure write, retaining
  previous success metadata/rows and advancing cache epoch. Drop the obsolete
  fetch fence; never convert failure retention to a complete publication.

The healthy example implements this publisher port as a synthetic peer and
checks the native sidecar row is committed before the consuming call. The actual
AT07 transaction adapter, AT11 authority adapter, AT52 router/configuration and
source-partition coalescing are still host integration inputs. The controller
is coded; those peers are not silently supplied by permissive defaults.

Lane-local Serde models mirror published Network projections, `sourceRegistration`,
`cacheStatus` and `networkRelation`. They remain conversion boundaries for shared
Rust types; no contract or history/audit schema changes are made.
## Dependencies and verification

The external task-owned compiler harness uses edition 2024/Rust 1.99.0 and
imports this namespace's actual `mod.rs`. It now uses the inspected host pins:

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
cargo run --locked --manifest-path "$AT09_HARNESS_MANIFEST"
node "$AT09_PARITY_SCRIPT"
```

The external driver emits baseline, label, observation, numeric-normalization,
Unicode-collection and integral-revision scenarios. The offline
JS comparison uses the actual published projector, facet builder, canonical
serializer and schema validators: complete state, reopened state, fresh/stale
facets, sidecar canonical bytes and digest match exactly, and the relations join
a valid synthetic frozen snapshot. The numeric and Unicode observation example
also checks ECMAScript scalar rendering and UTF-16 key order. The native TLS/SQLite example is healthy synthetic execution; the
published-JS comparisons cover the decoder's supported published shape. Neither
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
HTTP response or audit event. The AT52 route/config adapters, AT07 consuming transaction mapping,
AT11 authority mapping, real target wire review and held timeout/denial/failure/
concurrency/recovery qualification remain future integration work.
