# Network host binding

Concrete AT11 callbacks, PR36 callback ABI, same-store native publication and
original-authority browse disclosure. This is private development code and local
synthetic evidence, not live provider qualification. The sole integration leaf is
`backend/src/providers/network/host_runtime/mod.rs`. Root mounts the accepted
peers and adds `pub mod host_runtime;` to Network; manifests, locks, routers,
shared schemas and integrity declarations remain integrator-owned.

## Exact inputs

| Input | Source |
| --- | --- |
| PR36 ordering/quarantine | `529ecbcaf6e308b658a7f05fecc3214379fc707a` |
| Actual borrowed NativeNetworkPublisher | `37025316d419d9bf6dd3568cbcc883ee32fa6180` |
| Original accepted AT11 lifecycle | `4a0cd4da563a32d26677755a608180c960765353` |
| Original accepted same-store per-call storage | `2643eced79c5a581f72cc53634659d93da323cfb` |
| Closed authority/configured registry | `9b24642266a043d03d181e16c44ec0cc6fd8f5b8` |
| Actual AT11 typed link/observation and read-fence successor | `5e87c6c9152228ac4ae72814c6e6fc8f0ea8d7a2` |
| Actual storage PR58 borrowed partition/snapshot read successor | `04eb931d20cee8b04847543d167c3ee8efd6f98b` |

The two successors supply missing owner APIs; the historical inputs remain
preserved. Peer bytes are mounted externally without importing their ancestry.
The implementation uses the original lifecycle/per-call publication semantics,
the successor's genuine `NetworkLinkGrant`/`NetworkObservationGrant` and
`with_read_authorization`, and `RegisteredCacheRead` through the real
`read_cache_partition_with_authorization` engine.

The external compiler additionally mounts unchanged media
`f0d6b10f00bb93fc1c1dd4eb3ae66ee1fbe3f873`, staged domain/stock
`8a568fb6ccef5b0fa575b18d6181dcc524d4db99`, queue-recovery
`fd72542686112e594d9a6f63b4782a62b5d9e6ef`, and the actual HTTP stock-read
leaf from `4e695187a4dd045ccdc9729db5ca546682b40bdc`. They satisfy schema-5
storage and access compiler dependencies; no upload, stock or recovery action
executes in this Network example. Root reconciles their module declarations.

## Entrypoints

`OwnedNetworkAccess::bind_accepted_original` returns `AcceptedNetworkAuthority`.
Its callback lease is exactly
`Arc<lifecycle::providers::network::NetworkAuthorityLease>`; pass the adapter and
`adapter.lease().clone()` to unchanged PR36 `NetworkRuntime::refresh`.

`HostNetworkRuntime::refresh` is the closed native publication entrypoint. It
uses actual `app::Core` and its existing `app::Store`. Prepare, success and
failure delegate to `NativeNetworkPublisher::new(the_same_store)` with a private
borrowed authorizer inside the genuine original AT11 lifecycle transaction.
The original registration, partition, generation, epoch, issuing store and UUID
remain AT07 native fence/CAS checks. Actual durable staged receipt scope,
generation and digest are checked before consuming publication. PR36 quarantine
ordering precedes retained loading, credentials, transport and sidecar stage.
Final release checks the same original principal and grants.

`HostNetworkRuntime::read(&mut app::Store, access, original_principal,
original_partition_grant, original_entity_grants, now)` performs a genuine
ReadCache partition read under AT11's actual read transaction. It requires the
exact stored registration selector, complete scope and original handles. The
sidecar is loaded outside the access lock and checked by the actual Network
reopen/projector against the native cache pointer, digest and exact relations.
The generation's whole typed entity closure is matched to original grants.
Actual AT11 captures raw link grants and observation grants; these matching
selectors are data, never a substitute membership issuer.

The read returns a facet and opaque `OriginalNetworkDisclosure`. Release via
`HostNetworkRuntime::disclose(the_same_store, &original_disclosure, now)` enters
AT11's read fence, checks every original principal/partition/entity/link/
observation handle, invokes the actual borrowed native read on that application
Store, compares the complete `RegisteredCacheRead` with the captured baseline,
then builds and releases the facet after original-authority revalidation. The
comparison includes full registration, integer epoch, pointer/status/timestamps
and retained rows. The caller retains the same application Store across these
phases. A stale baseline requires a new request; release never refreshes grants,
changes registrations, reserves IDs or sends HTTP.

Raw links retain both original endpoints, including reversed normalized links
and hidden endpoints projected as unresolved. Observations have a separate
namespace even when their ID spells a link ID; the original collector, device
and interface tuple is bound by AT11. Collector text is provenance, not an issuer
or independent capability. Public SourceKind remains frozen. Availability
partition grants and PublishCache lifecycle grants do not grant entity browse.

## Authority and transport profile

`OwnedNetworkAccess` owns genuine `AccessBoundary::in_memory`, not a mirror of a
durable issuer. No path constructor, replacement/raw database, cached permit or
external authority callback is exposed. Typed startup/auth/admin methods delegate
to AT11. Explicit default-deny lifecycle policy is independent of registration
metadata. Limits are 256 policy rules and 10,000 original grants/allowlist IDs;
accepted Network projection bounds inventory and observation inputs. Lock
acquisition is `try_lock`; the normal AT11 clock is retained.

Transport callbacks check current session/user/restore epoch/expiry, membership
version/role, complete enabled registration/version and original source grants
on this sole memory authority. They perform no filesystem/network work,
credential acquisition or grant refresh. CPU work is bounded and cooperative,
not hard-preemptible. The accepted transport checks its deadline before/after
callbacks. No Store or access guard spans HTTPS. Explicit native publication/read
transactions contain Atlas filesystem I/O; durable sidecar I/O is outside access
locks and transport callbacks.

This is a process-local authority profile. Root must use this genuine issuer for
Network authentication and admin updates, or obtain an access-owner nonblocking
current-authority API for its durable issuer. Existing root-issued principals
cannot be imported or rehomed. These auth methods are not mounted automatically.
Private upstream session material, if provided, is already-held, bounded and
origin/lease-bound. No provider account or credential is acquired.

Use one normal verified client and the existing root lock:

```toml
reqwest = { version = "=0.13.5", default-features = false, features = ["blocking", "rustls"] }
```

This is the manifest proposal and already matches saved root. Reconcile the
owner's historical 0.12.24/WebPKI guidance to this shared Rustls platform profile
at integration. No manifest edit or parallel client is introduced. Actual
HttpInventoryTransport keeps certificate/hostname verification, reviewed extra
roots, HTTPS-only, no proxy/redirects, identity encoding and bounded streaming.
The only upstream operation is passive `GET /api/inventory`.

## Scoped development evidence

Inspect the example/script bodies before execution. In the disposable exact-peer
compiler tree, add the example target without changing saved root:

```toml
[[example]]
name = "healthy-network-host"
path = "src/providers/network/host_runtime/examples/healthy.rs"
```

With Rust 1.99.0 and CARGO_TARGET_DIR outside source, the named checks are:

```sh
rustfmt --edition 2024 --check backend/src/providers/network/host_runtime/*.rs backend/src/providers/network/host_runtime/examples/healthy.rs
cargo check --locked --offline --lib --example healthy-network-host
cargo clippy --locked --offline --lib --example healthy-network-host -- -D warnings
cargo build --locked --offline --example healthy-network-host
python3 backend/src/providers/network/host_runtime/examples/healthy-loopback.py "$CARGO_TARGET_DIR/debug/examples/healthy-network-host"
```

The inspected loopback fixture uses a disposable CA and signed CA:FALSE,
serverAuth/IP-SAN end entity, normal TLS verification and exactly one chunked
inventory GET. Its owned fixture preserves the entire accepted inventory and
revision, adding one explicitly synthetic observation with an ID also used by a
link. Genuine disposable AT11 scrypt logins, CSRF configuration, independent
lifecycle policy, original handles and real Atlas/sidecar SQLite are used. The
Store's unrelated configured authorizer has no publication privileges. A
separate genuine viewer with no lifecycle policy performs browse on that same
Store. Checks cover schema 5, epoch 0→1, exact pointer/four relations, five typed
entities/four raw link grants/one observation grant, original hidden/reversed
endpoints, distinct observation namespace and collector/members, three current
claims/one history row, original text/fact/retrieval timestamps and stale source
observation despite a fresh capture. Original-grant rerelease preserves epoch
and the preexisting generation reservations. Sidecar close/reopen remains checked.

Earlier evidence is preserved: the first intended healthy fixture unexpectedly
returned SourceFailure and consumed synthetic failure-status publication. Its
error category was not retained. Static inspection found the initial OpenSSL
CA:TRUE certificate was served as the end entity. A corrected separate CA/leaf
then passed one healthy GET with five entities/four links/four relations and no
observations; it did not qualify public disclosure. That accidental failure is
not a held-control campaign or healthy qualification. Failure-status qualification
remains open. The successor's compilation and healthy disclosure results are
recorded in the private development PR.

Historical stopped rejection/replay/fault/crash/concurrency/corruption/expiry/
revocation/adversarial controls remain held; broad aggregates are unrun. No real
provider/account/NAS call, new real credentials/grants, deployment, paid
inference, main merge or operational acceptance is supplied. Temporary local
keys, passwords and databases are removed; none are printed or committed.
The compiler lock SHA-256 remains
`7f70d4f7d57cd5c440a212429264d6399a808acbc71ca6f425b99c1af7e6e58a`,
identical to saved root. Root's unmounted checkout/integrity metadata is not
regenerated by this leaf.

Final successor evidence: Rust 1.99.0 locked offline library/example compilation,
warnings-denied Clippy, scoped rustfmt/diff checks and the named healthy TLS
example passed. The example printed successful same-store publication, schema 5,
genuine viewer resource-grant capture and original-grant rerelease with unchanged
epoch/reservations; the listener recorded exactly one inventory GET. Source audit
matched all 16 access, 55 storage, five migration, 18 media, 23 domain/stock,
five queue-recovery and 14 Network peer files to the pins above, allowing only
the explicit external Network module mount suffix. PR36 runtime and closed
authority/registry leaves also matched exactly. Those external peer mounts are
compiler inputs, not changes in this PR or additional qualification claims.
