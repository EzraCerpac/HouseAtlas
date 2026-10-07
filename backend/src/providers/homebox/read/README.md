# AT08 Rust HomeBox reads

This embeddable component descends only from published HouseAtlas baseline
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. AT08 edits only this namespace;
root manifests, locks, generated contracts and peer sources remain owner-managed.
There are no provider writes, embedded credentials, media downloads or HTTP server.

## Host dependencies and interfaces

The continuation's external compiler harness uses edition 2024 with these pins:

```toml
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = { version = "=1.0.151", features = ["arbitrary_precision", "float_roundtrip", "raw_value"] }
chrono = { version = "=0.4.42", default-features = false, features = ["std"] }
url = "=2.5.7"
fluent-uri = { version = "=0.4.1", default-features = false }
tokio = { version = "=1.53.2", features = ["time", "rt", "macros", "net", "io-util"] }
reqwest = { version = "=0.13.5", default-features = false, features = ["rustls"] }
```

AT51/52 should reconcile these in the shared manifest and expose this module.
`HomeBoxReader::new(registration, transport, clock, limits, navigation)` freezes
server-provided scope/registration. `Transport::get(GetRequest)` accepts only a
fixed relative GET path, repeated query pairs, full partition, tenant and monotonic
deadline. `Body::next_chunk` transfers owned byte vectors. No browser URL override,
arbitrary header or write operation is exposed. Clock timestamps retain spelling.

`fetch_generation(previous, server_generation_id)` returns an opaque
`CompleteGeneration` or sanitized `FailedRead`. Complete results expose cache,
projections, unresolved missing external IDs, stats and retained quarantine.
Missing entities never delete Atlas identities or prove upstream deletion.
A successful empty collection is a complete fresh generation.

`fetch_view(parent_ids)` returns a separate `FilteredView` with only projections
and stats. It has no generation, complete cache or publication method; successful
filtered reads never freshen the complete cache. Auth/scope failures propose
quarantine; unrelated failures preserve quarantine. Failure proposals retain
prior successful generation/timestamps and contain fixed messages, no response data.
`cache_freshness` is pure and confers no cached-access authority.

## Concrete bounded HTTP transport

`SourceEndpoint::https(origin, scope)` accepts a trusted configured HTTPS origin
and full partition. `HttpTransport::new` uses reqwest with normal Rustls platform
certificate verification. Redirects, retries, environment proxies and automatic
decompression are explicitly disabled. Requests send the configured `X-Tenant`,
JSON Accept and identity encoding. `CredentialProvider::read_authorization` is a
host-owned cancellable port for current original grants and configured credentials.
The opaque sensitive `AuthorizationHeader` exposes no Debug, serialization or
content accessor. Production GETs require a credential header.

The body bounds declared/observed response bytes and every await by the request
deadline, dropping the response on timeout/error/limit or when its owner is dropped.
The reader independently bounds aggregate generation bytes/time, pages and size.
Client diagnostics and URLs are discarded. The scope receipt identifies configured
source binding; it does not prove provider tenant enforcement. A credential-free
plain HTTP constructor exists only in test builds and requires a literal loopback
IP. This component activates no production source. Default DNS may leave blocking
resolver work running after timeout: deadlines bound awaited results and response
ownership, not physical termination of operating-system DNS work. That remains
transport qualification.

## Actual consuming SQLite publication fence

`reader.prepare_publication(store, principal)` calls AT07's actual
`AtlasStore::prepare_cache_publication` before GETs. The store-owned fence also captures the full durable
registration;
preparation compares owner, partition mode and the complete reviewed allowlist
alongside every scope component. `PreparedGeneration::fetch`
consumes captured state and the store-issued `CachePublicationFence`, passing its
selected ID into the full reader. It repeats the complete registration comparison
on the consuming reader before GETs, allowing equivalent allowlist ordering but
never different coverage. `StagedPublication::commit` consumes the same
fence and calls `publish_prepared_generation` with the opaque complete generation.
The original borrowed principal survives preparation, GET and commit. No principal
replacement, raw row construction, cloned fence or filtered publication is exposed.

AT07 binds its fence to the issuing store, full partition, baseline generation,
cache epoch and selected ID. Its immediate transaction reauthorizes, validates
schema/final graph, checks baselines/time ordering, replaces projections/cache,
permanently reserves the ID on successful commit, advances epoch, and revalidates
the actor. Preparation selects the ID; it does not permanently reserve it before
GETs. The storage fence does not replace current access-registry authority.

Retained rows pass actual `crate::contracts::decode` validation before reconstruction;
the reader repeats scope/allowlist/graph checks before GETs. Ordinary refresh
refuses retained quarantine and cannot reenable a source. Administrative revalidation
needs a separate qualified path. Failed full fetches return `RefreshError<'p, P>::Read(Box<FailedPublication<'p, P>>)`.
This handoff privately retains the unchanged original principal, actual pre-fetch
fence and immutable `FailedRead` proposal. `failure()`, `principal()` and `fence()`
allow borrowed inspection; it has no Clone, Deserialize, mutable accessor or raw
constructor. Display/Debug are sanitized without requiring the principal to be
Debug, Send or Sync. Pre-fetch publication checks remain `Publication` errors.

After current original authority revalidation, the host may explicitly consume
`commit_failure(self, same_store)`. It calls AT07's actual
`record_prepared_cache_failure` with those original handles, translating only fixed
code/status. A missing cache proposal remains unavailable for persistence. The
native transaction checks current authority, issuing store, full registration and
baseline generation/cache epoch, preserves retained projections/generation/success
metadata, advances the cache epoch, and revalidates its actor before committing.
It supplies durable timestamps and sanitized messages; the candidate UUID is not
reserved by failure publication. No failure is published automatically, and no
unfenced status fallback or production authority is supplied. The host remains
responsible for its original branded grants and authority context.

The same-store per-call bindings are additive:
`prepare_publication_with_authorization(store, &B, &original_principal)`,
`StagedPublication::commit_with_authorization(store, &B)` and
`FailedPublication::commit_failure_with_authorization(store, &B)`. They delegate to
AT07's exact `_with_authorization` APIs; selected B is borrowed for that synchronous
call and uses the unchanged connection, contract, runtime and issuer. Configured A
is not replaced, and its Principal type need not equal B::Principal. The original
B principal is retained privately through fetch and either consuming result.
Registration/quarantine/proposal checks share the direct paths' private helpers.
No private fence extraction, second handle or authority implementation is added.
The host supplies its reviewed current original-grant B at each phase.

The failure handoff and native consuming call are compiled but unexecuted in the
ordinary evidence. Only successful prepared fetch/publication paths are exercised.
Store errors expose only a fixed publication failure.

## Decoder and provenance

Lists use `/api/v1/entities`, explicit `isLocation=true/false`,
`includeArchived=true`, bounded offset pages, and repeated `parentIds` for views.
The existing `new` constructor selects the pinned normalized synthetic dialect.
`new_stock(registration, transport, clock, limits, stock_navigation)` selects actual
`crate::providers::homebox::wire` v0.26.2 decoding for every list/detail/maintenance
endpoint after bounded raw body receipt. `metadata_dialect()` exposes that selection.
Both per-request and generation deadlines are checked before and after endpoint
decoding. Stock maintenance always requests `status=both`. The decoder receives
the reader response-byte ceiling, page-count × page-size entry ceiling and 16,384
text-character ceiling; aggregate bytes/pages remain reader-owned. Wire errors map
to the existing fixed reader error codes. JSON parsing
checks UTF-8, duplicate keys including extras, finite numbers, escaped surrogates
and depth 64. RawValue distinguishes actual JSON containers from arbitrary-precision
Serde numeric maps. AT51 classifies integral lexical tokens before checked u64
conversion; `.0`/exponent integer spellings remain accepted.

Identical repeated rows collapse; conflicts, count drift, list/detail changes and
parent cycles abort staging. These guards are coded but rejection/fault/race controls
remain deferred. Offset pages remain nontransactional upstream reads. UUID spelling
normalizes; opaque collection spelling, source dates/offsets, retrieval dates,
arbitrary container types, null parents/types and explicit unknowns survive.
External HTTP(S) URI references retain their exact validated spelling. Stored-file
proxy references are withheld pending media authorization. Native links default
to empty and require explicitly verified scope-matched route configuration.

## Reviewed peers and remaining integration

The external host harness compiles actual read-only published source snapshots:

- AT07 same-store per-call cache/failure APIs: `e11c17a175eb73980c31b0b3f71d90dbbf816899`.
- Actual supporting contracts/domain/jobs/access types and embedded resources:
  accepted root `52d6dce6b283b577d43083fb36bbea485303924f`.
- AT52 native read-contract adapter: `46047d0193fbce720bba7a1d209b5428c51dba94`.

No peer source/ancestry is copied into this branch. The host harness uses the actual
native frozen schema/graph and SQLite implementation, with synthetic authority,
clock and provider transport. The full actual domain/jobs modules compile the
storage owner's stock/queue type
requirements; no fabricated stock/queue peer is supplied or executed. The embedded
resource catalog and native semantics use the accepted root's regex/ryu-js pins.
The external full-peer harness enables the existing rusqlite `backup` feature.
These are existing peer requirements, not new reader dependencies.

The reviewed host leaves ConfigureSource/PublishCache unavailable. Production
needs AT52/AT11's current original branded source-authority adapter and a credential
provider bound to approved server configuration. The borrowed storage APIs are
bound here; the actual original-grant
provider authority B remains root/access host integration. No permissive replacement is
supplied. Publication futures impose no extra Send/Sync bounds on those borrowed
handles; the shared host must reconcile their execution context.

The native decoder peer is pinned to published
`9eaab4bc39216de486fd8274e1503e3e9df86fad`. Maintenance date fields use its actual
`MaintenanceDate`, preserving calendar YYYY-MM-DD and existing timestamp spelling
without inventing a time or timezone. Source update/retrieval/cache timestamps
remain `Timestamp`. Existing numeric maintenance cost remains the reader's finite
number projection; native original string/decimal spelling is retained by the
decoder only during decoding, never automatically persisted as private evidence.

`StockNavigation` accepts independently qualified location and item navigation.
Validation checks full scope and verified templates against the pinned native
paths: location view/edit; item view/edit/maintenance. Unknown types have no native
links. Source-derived route candidates do not themselves qualify a route.

Calendar-date durable publication/reconstruction requires the contract owner's
additive `format: date` / `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` alternative alongside the
existing date-time/null alternatives for both maintenance date fields in
`packages/contracts/schemas/atlas.schema.json`, plus regenerated owned DTOs. The
reader does not bypass the actual contract validator or edit shared schema bytes.
Root must mount `providers::homebox::wire` beside `read`; no new dependency is
required. Direct and borrowed-authorizer publication/failure fences are unchanged.

The decoder's fixtures are source-derived synthetic examples, not installed target
captures. Exact remaining qualification inputs are sanitized healthy responses plus
matching version/build/API evidence, request paths/pagination, status/content type/
encoding and tenant semantics. TLS handshakes, actual credentials, tenant
enforcement, installed API/build and native routes require separate qualification.
Atlas/history schema adoption remains contract-owner managed.

## Scoped healthy verification

Activate the retained pinned runtime. The external host harness imports this actual
module plus exact reviewed peers. `AT08_HARNESS` names that external directory:

```sh
rustfmt --edition 2024 --check backend/src/providers/homebox/read/mod.rs
cargo check --manifest-path "$AT08_HARNESS/Cargo.toml" --locked
cargo build --manifest-path "$AT08_HARNESS/Cargo.toml" --locked
cargo clippy --manifest-path "$AT08_HARNESS/Cargo.toml" --locked --all-targets -- -D warnings
cargo test --manifest-path "$AT08_HARNESS/Cargo.toml" --locked homebox_read::healthy -- --test-threads=1
cargo test --manifest-path "$AT08_HARNESS/Cargo.toml" --locked --test healthy_publication -- --test-threads=1
```

Eleven reader examples cover synthetic metadata, pagination, views, empty/minimal
generations, provenance, allowlists, freshness, native navigation, integral spellings
and valid URI representation. The HTTP example opens one ephemeral loopback listener,
completes eight successful chunked GETs without credentials, and closes it. The
external SQLite example uses consuming fences for two successful generations,
reads published rows/cache, preserves six seeded Atlas records, checks epochs
0 → 1 → 2, reconstructs retained metadata,
and confirm a filtered view leaves SQLite unchanged. Another healthy example binds
an empty cache to the complete durable reviewed allowlist, then fetches through a
matching reader whose allowlist order differs. Another positive example uses one issuing connection and a borrowed fixture
authorizer whose principal type differs from configured store authority. It checks
unchanged original principal identity at all four authorization calls, exact
publication/readback, and the configured authorizer's continued use for reads.
Failure per-call handoff is type-checked only; no failure operation is invoked.
Authority/runtime remain explicit synthetic fixtures.
Emitted snapshots pass published shape/semantic validation as additional evidence;
no JavaScript oracle is used in the Rust publication path. Legacy broad aggregates,
stopped rejection/guard-reversal/mutation/adversarial/fault/crash/concurrency/negative
controls remain unrun. Ordinary success does not qualify deployment or security.

## Native stock consumption checkpoint

The external task-owned harness mounts the exact published native wire peer and
this reader, retaining the previously pinned actual storage/contracts/domain/jobs
peers. Two positive native reader examples consume source-derived fixtures with
owned 7-byte body chunks: a four-entity generation across three pages, native
attachments, archived/unknown types, original source timestamp, scheduled/completed
calendar dates, numeric costs, type-specific synthetic qualified routes and a
filtered view that preserves complete-cache metadata; existing timestamp maintenance
spelling also survives the additive type. No real provider or failure operation is
called. The actual wire's six healthy examples and existing eleven non-HTTP reader
examples plus three SQLite success examples remain explicitly selected.

```sh
cargo test --manifest-path "$AT08_HARNESS/Cargo.toml" --locked --test native_reader -- --test-threads=1
cargo test --manifest-path "$AT08_HARNESS/Cargo.toml" --locked --lib homebox_read::healthy:: -- --test-threads=1
cargo test --manifest-path "$AT08_HARNESS/Cargo.toml" --locked --lib providers::homebox::wire::healthy:: -- --test-threads=1
```

Stock calendar-date publication awaits the exact contract-owner schema successor;
no failing write or replacement authority/validator is used as a qualification
probe. Failure handoff remains compile-only. Native target and held controls remain
deferred. The existing shared-host mount and normal integration are root-owned.
