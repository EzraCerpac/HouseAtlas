# Passive Network inventory

AT09 ports the published Network inventory behavior into an embeddable Rust
component. Source base: `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. All implementation and healthy examples
are under this namespace. There is no application manifest or database adapter
in this lane.

The live request capability is `InventoryGet`, which exposes only `GET` and
`/api/inventory`. It accepts no caller-selected method, path, query, credentials,
headers or request body. `InventoryTransport` is injected. Its response scope
must be an attestation from reviewed server configuration. The host must pin the
reviewed HTTPS origin/path, prevent redirect following, bound streaming before
buffering and cancel when its future is dropped. Tokio bounds the wait and drops
the transport future on timeout. This module implements no upstream HTTP client,
listener, login, collector demand, ARP, diagnostic or write client.

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
| Failed attempt | `RefreshOutcome::Failed(RefreshFailure)` with sanitized error and retained public state; never a complete proposal |
| Retained sidecar | `stage_row`, `validate_immutable_replay`, `reopen_sidecar`, `validate_sidecar_packet` |

Preparation makes one GET and creates a complete proposal without changing
`prior` or publishing a cache pointer. The proposal includes the expected prior
generation ID and expected cache epoch. A successful same-revision inventory
must have the same canonical source contents; a revision cannot go backwards.
Source scalar serialization follows the published canonical JSON rules,
including ECMAScript number rendering and UTF-16 key ordering.

The immutable `SidecarRow` preserves the published
`houseatlas-network-sidecar/1` fields, canonical partition key, canonical body
and SHA-256 digest. Reopening requires the exact generation ID, published cache
success metadata, retained relation set and retained review. Full packet
validation precedes import. Bounds match the retained implementation: 10 MiB per
row, 10,000 rows and 16 MiB per packet. `stage_row` prepares bytes; it performs no
SQL write.

AT07/AT51 must supply authorization and source-grant revalidation, a durable
immutable sidecar store, atomic publication of the cache/relations with the CAS
witness, source-partition single-flight coalescing and quota enforcement against
existing rows. Stage the sidecar durably before publishing its pointer. Read
revocation metadata before exposing records. Retain the previous immutable row
for recovery even when public reads withhold the generation. Every new attempt
must receive the current authoritative state and epoch. Keep Atlas/HomeBox
browsing independent of Network refresh.

The lane-local Serde models mirror concrete published Network projections,
`sourceRegistration`, `cacheStatus` and `networkRelation`; they are not new shared
contracts. Exact missing integration inputs are the AT51 Rust contract import
paths/types, the authorized publication witness/trait, and the AT07 immutable
sidecar storage API. Replace or convert these local boundary types when those
interfaces arrive. No history/audit schema or shared manifest is changed.

## Dependencies and verification

The external task-owned harness pins:

```toml
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.145"
chrono = { version = "=0.4.42", default-features = false, features = ["std"] }
sha2 = "=0.10.9"
ryu-js = "=1.0.2"
tokio = { version = "=1.48.0", features = ["rt", "time", "macros"] }
```

`tokio` runtime/time support is needed by refresh; `macros` is only needed by the
healthy examples/harness and may be a dev feature in the shared manifest.
AT51 owns application dependency selection and Cargo.lock. The external harness
uses edition 2024 and Rust 1.99.0; it imports `mod.rs` directly as its library.

The `healthy` module contains exactly five positive synthetic examples and
includes only the published inventory/review fixtures. They cover membership,
facet/history separation, passive GET and complete proposal, retained sidecar
reopening/replay, partitioned observations and invalidation, source-valid blank
and Unicode text, and a retained older review followed by a healthy newer
revision. They do not run the legacy Network test aggregate or stopped controls.

The external harness points its library path at this module. Activate the pinned
runtime and set `AT09_HARNESS_MANIFEST` to the external harness manifest and
`AT09_PARITY_SCRIPT` to its offline comparison script. The checked commands are:

```sh
cargo fmt --manifest-path "$AT09_HARNESS_MANIFEST" --check
cargo check --locked --manifest-path "$AT09_HARNESS_MANIFEST"
cargo clippy --locked --manifest-path "$AT09_HARNESS_MANIFEST" --all-targets -- -D warnings
cargo test --locked --manifest-path "$AT09_HARNESS_MANIFEST" --lib healthy::
cargo build --locked --manifest-path "$AT09_HARNESS_MANIFEST"
cargo run --locked --manifest-path "$AT09_HARNESS_MANIFEST"
node "$AT09_PARITY_SCRIPT"
```

The external driver emits baseline, label and observation scenarios. The offline
JS comparison uses the actual published projector, facet builder, canonical
serializer and schema validators: complete state, reopened state, fresh/stale
facets, sidecar canonical bytes and digest match exactly, and the relations join
a valid synthetic frozen snapshot. The numeric and Unicode observation example
also checks ECMAScript scalar rendering and UTF-16 key order. This is healthy
synthetic evidence, not qualification of real transports or durable publication.
No legacy broad aggregate, stopped denial/fault/crash/concurrency/negative control,
live provider, credential, deployment or listener is used.

Behavioral references at the pinned base:

- `adapters/network/src/index.mjs` (projection, cache validation and facet)
- `adapters/network/fixtures/inventory.wire.json` and `fixtures/link-review.json`
- `server/src/network-sidecar.mjs` (immutable retained rows and pointer reopening)
- `packages/contracts/schemas/atlas.schema.json` and `policy/boundaries.json`
- `packages/contracts/src/index.mjs` (canonical scalar serialization and validation)

The published HTTP history schema remains unchanged; this lane emits no history
HTTP response or audit event. Provider route, authorization/storage integration,
timeout/denial/failure/concurrency qualification and durable recovery remain
future integration/qualification work.
