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
Detail and maintenance decode the pinned normalized synthetic dialect. JSON parsing
checks UTF-8, duplicate keys including extras, finite numbers, escaped surrogates
and depth 64. RawValue distinguishes actual JSON containers from arbitrary-precision
Serde numeric maps. AT51 classifies integral lexical tokens before checked u64
conversion; `.0`/exponent integer spellings remain accepted.

Native maintenance costs adopt the wire bridge's exact `serde_json::Number`
into `Maintenance.cost: Option<serde_json::Number>`. The workspace's existing
arbitrary-precision JSON feature preserves decimal/exponent tokens through
typed decoding and serialized cache-publication inputs. Retained-state decoding
preserves the numeric tokens supplied by Storage. The finite
admission check does not replace the stored number with its `f64` approximation;
large integers, long fractions and underflowing exponents retain their amount.
Normalized synthetic unknown costs remain null. Consumers should serialize the
number directly rather than convert it to a float or a string. No wire API or
contract/schema change is required; prior cache amounts already rounded by an
older reader cannot be recovered without a new source observation.

Maintenance validation reuses the actual contract `JsonNumber` deserializer for
its lexical processing envelope: at most 4,096 token bytes, explicit decimal
exponent magnitude at most 4,096, and exponent-minus-fraction-digit magnitude
at most 4,096. Unsupported spellings fail reader validation before a complete
generation is staged; they cannot first surface as a Store publication error.
The same check runs when validating retained projections. Accepted numbers keep
their exact tokens and the existing finite admission rule; no bound is copied
into a separate provider policy. Ordinary positive examples cover the accepted
token/exponent/decimal-shift limits; over-limit rejection controls remain unrun.

Durable amount preservation additionally needs Storage/contract-owner
reconciliation: `cache_repository::write_homebox` currently calls
`repository::json`, which uses the native contract's RFC 8785 `canonical_json`.
That canonicalizer intentionally applies the JavaScript `f64` model and can round
an exact decimal before storing the projection body. This reader correction does
not alter the published digest semantics or Storage's persistence codec. Its
positive examples exercise native intake, projection serialization, the frozen
contract codec and retained typed fields, not a SQLite persistence roundtrip.

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

The published fixture catalog marks actual detail/maintenance/attachment wire
unqualified. Exact missing inputs are sanitized healthy responses plus matching
HomeBox version/build/API evidence: location/item list pages including archived
rows; an entity detail with null metadata and stored-file/external-link attachments;
and maintenance with schedules/completions/cost. Capture method/path, pagination,
status/content type/encoding and tenant semantics, sanitizing headers. Therefore
this decoder still implements `atlas-normalized-synthetic-v1` with reference version
`v0.26.2`; it does not demonstrate native wire compatibility. TLS handshakes, actual
credential retrieval, tenant enforcement and native routes need separate authorized
qualification. Published Atlas/history schemas remain unchanged.

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

The exact-cost examples are registered as `homebox_read::healthy_numeric`, so
the documented `homebox_read::healthy` filter also selects both numeric tests.
The source filename remains `numeric_healthy.rs` for the existing publication
row; the test-only module name changes no production reader API.

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

## Original bounded native captures

`HomeBoxReader::capture_stock_entity(&Uuid)` captures exactly
`GET /api/v1/entities/{entityId}`. `capture_stock_maintenance(&Uuid)` captures
exactly `GET /api/v1/entities/{entityId}/maintenance?status=both`. Both require
the existing registered stock reader and its configured transport/clock/limits.
They enforce the reader's allowlist, response scope, redirect/status policy,
response/aggregate byte bounds and deadlines; detail parents retain the same
registered partition restriction. There is no caller-selected origin or route.

The returned sealed `NativeCapture<T>` exposes immutable scope, requested owner,
fixed method/path/query, actual status, host retrieval time, original body bytes,
parsed source JSON and native decoded value. Unknown fields, numeric spellings,
calendar dates and original attachment membership metadata survive in the raw
body/source. Captures can contain private inventory and belong in private owner
custody. No public publication or serialization adapter is supplied.

These are actual configured GET observations, not complete writable snapshots,
provider/build qualification, freshness proofs, grants, approvals or receipts.
The existing fresh writer adapter still requires its original qualified owner
evidence for preparation/readback and hidden PUT fields. A body from a registered
transport does not itself establish current credential custody or admission.

The file successor still needs the original `NativeStoredFileOwner` critical
section and correlated attachment body/version evidence. This source captures
original detail membership but does not fetch attachment bodies or invent a
version from paths, dates, hashes or cache generations. Media's original stage
API presently binds Atlas asset creation; Atlas tokens do not admit HomeBox bytes.

The integration owner must declare `mod native_capture` and export
`NativeCapture`, `CapturedStockEntity`, `CapturedStockMaintenance` in `read/mod.rs`.
The separate positive fixture requires `#[cfg(test)] mod native_capture_healthy`.
Module/Cargo/manifest composition stays with that owner. Once declared, its exact
permitted command is:

```sh
cargo test --locked -p houseatlas-backend --lib providers::homebox::read::native_capture_healthy::healthy_fixed_native_get_captures_preserve_originals -- --exact --test-threads=1
```

One ordinary synthetic case performs two successful chunked GETs over the actual
credential-free ephemeral loopback `HttpTransport`, then closes the listener.
It covers a reviewed entity/parent allowlist, exact paths/query/tenant, response
status and retrieval time, byte equality, large integers/exponent spelling,
original date spelling and maintenance costs. It creates no qualification owner,
write approval, stage token or source authority and makes no live provider call.

## Consuming conversion to existing fresh inputs

Both sealed capture types provide
`into_fresh(self, &write::stock::Context, write::stock::StockTarget)` returning
the existing `write::stock::FreshNativeCapture`. Conversion checks exact
workspace/home/source correlation, the successful fixed route/query and the
requested resource/owner. The canonical stock collection UUID spelling must
equal the original opaque registration `collection_id` string byte for byte;
the adapter never parses, normalizes or replaces that registration string.

An entity capture supports its exact entity target, or a field/attachment target
under that entity only when the original captured array has exactly one matching
member ID. A maintenance capture supports a matching maintenance member under
its original owner. Missing or ambiguous members remain `ResourceUnavailable`;
other resource kinds remain `UnsupportedCapability`. Entity targets must not
carry a member-owner field. No create target or missing member is inferred.

The consuming conversion moves the entire original body, scope, route and query
into the existing DTO and preserves the retrieval timestamp spelling. It does
not create qualification evidence, source freshness/completeness facts, hidden
PUT guarantees, stage admission, credentials or authority. The existing fresh
decoding/qualification adapters retain their mandatory original-owner inputs.
`FreshNativeCapture` remains a publicly constructible input DTO; using this
conversion does not certify every such DTO's provenance or implement a production
preparation/readback owner port.

The exact additional positive source case uses four in-process synthetic GETs
through the actual registered reader/public Transport contract, consumes three
detail captures for entity/field/attachment and one maintenance-owner capture,
and checks exact scope/target/routes/bytes/time plus numeric/date retention:

```sh
cargo test --locked -p houseatlas-backend --lib providers::homebox::read::native_capture_healthy::healthy_captured_members_into_existing_fresh_inputs -- --exact --test-threads=1
```

This case uses only actually captured synthetic members and introduces no
qualification owner, mismatch/denial control or provider write. The earlier
two-request socket fixture stays unchanged.
