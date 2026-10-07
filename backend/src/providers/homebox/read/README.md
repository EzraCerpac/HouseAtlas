# AT08 Rust HomeBox reads

This namespace is based only on published HouseAtlas commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. It supplies an embeddable component
for the modular monolith, with no HTTP server, credential store,
SQLite implementation, provider writes or attachment download.

## Interfaces for reconciliation

AT51 should expose `providers::homebox::read` through the shared module tree.
No shared manifests, locks, generated contracts or sibling namespaces are edited.
The task-owned compiler harness uses edition 2024 and these exact dependencies:

```toml
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.145"
chrono = { version = "=0.4.42", default-features = false, features = ["std"] }
url = "=2.5.7"
fluent-uri = { version = "=0.4.1", default-features = false }
tokio = { version = "=1.48.0", features = ["time", "rt", "macros", "net", "io-util"] }
reqwest = { version = "=0.13.5", default-features = false, features = ["rustls"] }
```

The external harness retains its own Cargo.lock. Tokio supplies timers and a
current-thread runtime and networking for the disposable loopback example. Chrono validates
RFC3339 strings without replacing their original precision or offset. These pins
are a narrow dependency proposal; shared application selection remains with AT51.
The feature-disabled `fluent-uri` parser validates a borrowed original RFC3986 URI
before WHATWG URL parsing; no normalization, resolution or retrieval is performed.

`HomeBoxReader::new(registration, transport, clock, limits, navigation)` freezes
the server-provided registration and navigation. `Transport::get(GetRequest)`
returns `GetResponse<Body>`; `Body::next_chunk` transfers owned byte vectors.
The request exposes GET, a fixed relative path, repeated query pairs, exact scope,
the `X-Tenant` value, a redirect refusal policy and an absolute monotonic deadline.
It has no credentials, arbitrary headers, URL override or write operation.

`fetch_generation(previous, server_generation_id)` returns either a privately
constructed `CompleteGeneration` or `FailedRead`. A complete result exposes
cache, projections, unresolved missing external IDs, stats and retained quarantine.
It is a staged publication candidate, with a `revalidation-candidate` transition
and `deletion_confirmed() == false`. Missing rows never delete Atlas records or
prove upstream deletion. A successful empty collection has a fresh generation.

`fetch_view(parent_ids)` returns a different `FilteredView` type containing only
projections and stats. It has no cache, generation, missing-record evidence or
publication method. Its successful quarantine transition is `preserve`. Parent
filters are unavailable on the full-generation method. Source-scope/auth failures
offer `quarantine`; unrelated view failures leave quarantine unchanged. Full-read
failures propose failure metadata only and preserve prior generation/success times.
An invalid prior state produces no cache proposal. Failure objects contain only
fixed error codes/messages; response data and driver diagnostics are not exposed.

`CompleteGeneration::publish(publisher, fence)` checks the full scope then hands
the immutable candidate to `GenerationPublisher::commit_complete`. The fence
contains full scope and captured source epoch. AT07 must implement one transaction
which verifies current authority/epoch, atomically replaces cache and projections,
retains Atlas identities and unresolved bindings, and preserves quarantine. A failed
commit must leave the previous generation intact. Only complete generations can
enter this port; there is no filtered-view publication operation. The synthetic
publisher example checks the handoff only, not these storage guarantees.

The compiled fence is provisional and currently carries only scope/source epoch.
That is insufficient to prevent an older read from replacing a newer committed
generation. Proposed AT07 reconciliation, with exact epoch types to be agreed:

```rust
struct PublicationFence {
    scope: SourceScope,
    source_epoch: u64,
    baseline_generation_id: Option<Uuid>, // durable generation before any GET
    baseline_cache_epoch: u64,            // AT07 cacheEpoch captured with it
    reserved_generation_id: Uuid,        // reserved by storage before any GET
}
```

AT07 should return this capture together with the matching `PreviousGeneration`.
The coordinator passes `reserved_generation_id` into `fetch_generation`; the
publication transaction must compare current source authority, baseline generation
and cacheEpoch with the capture, verify the reserved ID equals the staged cache ID,
and consume the reservation exactly once. Epoch comparison/increment, reservation
lifecycle and atomic rejection are AT07 responsibilities. This proposal does not
add fabricated storage enforcement; the port must be reconciled before integration.

`PreviousGeneration::new(cache, entities, quarantine)` accepts typed storage
state and the reader rechecks schema/graph/scope invariants before issuing GETs.
`cache_freshness` returns an aged copy and never persists timestamps or authorizes
cached access. Output structs serialize to the published schema-1 field names.
The enclosing JS result envelope is not recreated; shared integration should map
these typed variants to its established service/HTTP envelopes.

## Decoding and bounded reads

Lists use `/api/v1/entities` with explicit `isLocation=true/false`,
`includeArchived=true`, bounded pages and repeated `parentIds` for views. Authorized
rows use `/api/v1/entities/{id}` and `/api/v1/entities/{id}/maintenance`. Each response
requires a full scope receipt from the trusted bound transport. A raw provider
response is not assumed to contain that receipt. Off-allowlist rows are never
hydrated, and authorized parents must remain inside the registered allowlist.
Shared registration validation must enforce disjoint partitions across homes.

The reader bounds response and cumulative bytes, total pages, page size, per-request
time and whole-generation time using the frozen policy defaults, which may only be
tightened. Pending request/body futures are dropped at timeout; an actual driver
must make dropping cancel its work. Deadlines are also checked after synchronous
decode and during staging/graph traversal. Exclusive mutable borrowing serializes
reads on one reader; service/store serialization remains a separate obligation.

JSON validation rejects invalid UTF-8, duplicate keys (including extension objects),
nonfinite numbers, unpaired escaped surrogates and nesting beyond 64. Typed decoding
validates required metadata arrays, lengths, UUIDs, dates, attachment shapes and
maintenance. External references must preserve the literal lowercase `http://` or
`https://` prefix required by the published schema; normalized URL-parser scheme
checks alone are insufficient. The original ASCII URI grammar and percent-encoded
octets are validated before URL parsing can repair their representation. The exact
valid reference spelling is retained. Page counters and nullable attachment byte sizes
accept integral JSON float/exponent spellings, with finite/nonnegative/integral
and exclusive 2^64 range checks before converting floating values to u64.
Identical repeated entity rows collapse; conflicts, observed count
drift, list/detail changes and parent cycles abort publication. These coded guards
have not been exercised by rejection, fault, adversarial or concurrency controls.
Offset-page reads remain non-transactional and convey no CAS or history evidence.

UUID spelling normalizes without changing opaque collection spelling. Original
provider dates, retrieval dates, arbitrary container types, null types/parents and
explicit unknown metadata survive projection. External URLs remain references.
Stored-file proxy references are withheld pending AT11/12 media authorization.
Native links default to empty and require a scope-matched, explicitly verified
route configuration. Example routes are synthetic, not actual route qualification.

## Exact inputs and open peer integration

Published inputs are `packages/contracts/schemas/atlas.schema.json`,
`packages/contracts/policy/boundaries.json`, the minimal
`packages/contracts/fixtures/homebox-page.wire.json` and
`adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json`. The catalog pins
`atlas-normalized-synthetic-v1` and reference HomeBox `v0.26.2`. The old adapter
is a behavioral reference. It is not linked into the Rust implementation.
Published HTTP history schema `http-history.v1.1.0.schema.json` remains unchanged;
HomeBox metadata reads do not invent durable Atlas audit history.

No generated Rust contracts or AT07/11/51 Rust interfaces exist in this baseline.
The local typed schema-compatible structs are proposed integration types, not a
second generated contract authority. Exact shared type paths, durable source-epoch
representation, AT07 transaction API, AT11 current grant/quarantine API and trusted
transport receipt construction remain reconciliation inputs. No such peer is
stubbed as a working production implementation.

The fixture catalog explicitly says that actual detail/maintenance wire schemas
are unqualified. AT06/08/12/21 must review real wire samples and source-bound driver
behavior before claiming provider compatibility. AT11 permission checks do not
reenable a source. Only separately qualified administrative evidence plus staged
complete read-back may lift quarantine. Credentials, source grants and native route
qualification remain outside this module.

## Scoped checks

The external task-owned harness imports this actual `mod.rs` directly.
Activate the retained pinned runtime first. Set `AT08_HARNESS` to the external
harness directory. The authorized checks are:

```sh
cargo fmt --manifest-path "$AT08_HARNESS/Cargo.toml" --check
cargo check --manifest-path "$AT08_HARNESS/Cargo.toml" --locked
cargo build --manifest-path "$AT08_HARNESS/Cargo.toml" --locked
cargo clippy --manifest-path "$AT08_HARNESS/Cargo.toml" --locked --all-targets -- -D warnings
AT08_EVIDENCE_DIR="$AT08_HARNESS/evidence" cargo test --manifest-path "$AT08_HARNESS/Cargo.toml" --locked homebox_read::healthy:: -- --test-threads=1
```

The eleven explicitly named success-only examples exercise published synthetic
metadata, scoped GETs/pagination, filtered views, empty generations, pinned minimal
pages, provenance/UUID spelling, allowlists, pure freshness and synthetic native
navigation/publication handoff, integral numeric spellings, literal URL references
and valid escaped URI spelling (path/query/fragment, host case and IPv6 authority).
Emitted snapshots are checked against the published
shape and semantic validator; view projections are checked separately. The healthy HTTP example opens one ephemeral literal-loopback listener, closes it
after eight successful chunked GETs, and sends no authorization header. It calls no
provider. This exercises the concrete HTTP path, not TLS or provider compatibility. Legacy broad test aggregates and stopped
rejection, guard-reversal, mutation/omission, adversarial, fault/crash, concurrency and
negative-consumer controls remain unrun. Ordinary results do not qualify source
access, real wire compatibility, SQLite publication, recovery, security or deployment.

## Configured HTTP driver

`SourceEndpoint::https(origin, scope)` accepts a server-reviewed HTTPS origin and
full partition scope; request data cannot override either. `HttpTransport::new`
uses pinned reqwest with normal Rustls platform certificate verification. Proxy
discovery, redirects, retries and automatic decompression are disabled explicitly.
GETs send the configured opaque `X-Tenant`, JSON Accept and identity encoding.
`CredentialProvider::read_authorization` is a host-owned, cancellable port for
current original grants and configured source credentials. The opaque sensitive
`AuthorizationHeader` has no Debug, serialization or content accessor. Production
GETs require a credential header; none is embedded in source or fixtures.

The streaming body checks declared and observed per-response byte limits, bounds
each await by the request deadline, and drops the response on timeout/error/limit
or when its owner is dropped. The reader independently caps aggregate generation
bytes and time. Errors discard client diagnostic text and URLs. A scope receipt
identifies the configured endpoint, not independent proof of tenant enforcement.
The unauthenticated plain HTTP endpoint constructor exists only in test builds and
requires a literal loopback IP. Host source configuration and grant adapters remain
AT52/AT11 responsibilities; no live endpoint is activated by this component.
