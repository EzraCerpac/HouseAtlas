# Network host binding

Concrete AT11 callbacks, PR36 callback ABI, same-store native publication and
original-authority browse disclosure. This is development code and local
synthetic evidence, not live provider qualification. The sole integration leaf is
`backend/src/providers/network/host_runtime/mod.rs`. Root mounts the accepted
peers and adopts the Network owner's `pub mod host_runtime;` declaration; manifests, locks, routers,
shared schemas and integrity declarations remain integrator-owned.

## Required owner interfaces

Mount the accepted Network provider and PR36 lifecycle runtime, closed provider
lifecycle authority/configured registry, AT11 lifecycle plus typed Network
link/observation/read-fence/SharedAccess interfaces, and the storage owner's
borrowed registered-cache partition read. These are actual owner code, not
interface substitutes. Historical input bytes and exact source mappings remain
in the external coordination receipt, outside tracked publication documentation.
Storage additionally supplies its immutable
`AtlasStore::configured_authorization(&self) -> &A` accessor. The leaf checks the
actual configured `app::ReadAuthority.0` allocation as well as `Core.access`;
public Core construction alone cannot establish that those issuers match.
Its additive `record_prepared_cache_failure_at_with_authorization` transaction
also accepts the provider's original pre-request attempt timestamp under the
same issuing-Store publication fence and borrowed original authorizer.

The external compiler also mounts accepted media, staged domain/stock,
queue-recovery and HTTP stock-read leaves for the storage/access dependencies.
No upload, stock or recovery action executes in this Network example. Root
reconciles their central module declarations.

## Entrypoints

`NetworkAccess::configure(&owning_core, &original_configure_principal, &source)`
borrows the owning Core and verifies both its canonical access allocation and
the Store's original configured ReadAuthority before either registry write.
Call it outside caller-held Core/Store/access guards.
There is no public raw-Store configuration entrypoint. Durable source
registration precedes AT11 registry installation; a subsequent Access failure
still reports incomplete configuration and may leave the durable registration.

`NetworkAccess::bind_accepted_original` returns `AcceptedNetworkAuthority`.
Its callback lease is exactly
`Arc<lifecycle::providers::network::NetworkAuthorityLease>`; pass the adapter and
`adapter.lease().clone()` to unchanged PR36 `NetworkRuntime::refresh`.

`HostNetworkRuntime::refresh` is the closed native publication entrypoint. It
uses actual `app::Core` and its existing `app::Store`. Preparation and successful
publication delegate to `NativeNetworkPublisher::new(the_same_store)` with a
private borrowed authorizer inside the genuine original AT11 lifecycle
transaction. Failure publication uses that Store's actual additive
`record_prepared_cache_failure_at_with_authorization` with the same original
fence, lease and borrowed authorizer. The original Network-owner check,
sanitized native code conversion and default failure status are retained.
The provider's captured `cache.error.at` must match its `last_attempt_at`; that
exact original string passes to durable failure metadata without replacement
by the commit-time clock. Original per-call/precommit checks, quarantine and
definite-commit-result handling remain. This path is coded and compiled; failed
transport, timeout and clock-change qualification remain held and unrun.
The original registration, partition, generation, epoch, issuing store and UUID
remain AT07 native fence/CAS checks. Actual durable staged receipt scope,
generation and digest are checked before consuming publication. PR36 quarantine
ordering precedes retained loading, credentials, transport and sidecar stage.
Final release checks the same original principal and grants.

`HostNetworkRuntime::read(&Arc<Mutex<app::Core>>, access, original_principal,
original_partition_grant, original_entity_grants, now)` performs a genuine
ReadCache partition read under AT11's actual read transaction. It requires the
exact stored registration selector, complete scope and original handles. Before
any access/database read, it borrows the owning Core and checks that the injected
SharedAccess is both its canonical access allocation and the Store's original
configured ReadAuthority allocation. Store is borrowed exclusively
from that Core for the entire synchronous read/capture/release call. The sidecar
is loaded outside the access lock and checked by the actual Network
reopen/projector against the native cache pointer, digest and exact relations.
The generation's whole typed entity closure is matched to original grants.
Actual AT11 captures raw link grants and observation grants; these matching
selectors are data, never a substitute membership issuer.

The read returns a facet and opaque `OriginalNetworkDisclosure`. Release via
`HostNetworkRuntime::disclose(&owning_core, &original_disclosure, now)` checks
the lease's weak reference to its exact original Core, that Core's current
canonical issuer and the Store's original configured issuer before any Store
read, then enters AT11's read fence and checks
every original principal/partition/entity/link/observation handle, invokes the actual borrowed native read on that application
Store, compares the complete `RegisteredCacheRead` with the captured baseline,
then builds and releases the facet after original-authority revalidation. The
comparison includes full registration, integer epoch, pointer/status/timestamps
and retained rows. Raw Store injection is not exposed by either public browse
entrypoint. The private in-Store release is used while the validated Core borrow
is already held; it never reenters the public Core-locking method. A stale
baseline requires a new request; release never refreshes grants,
changes registrations, reserves IDs or sends HTTP.

Raw links retain both original endpoints, including reversed normalized links
and hidden endpoints projected as unresolved. Observations have a separate
namespace even when their ID spells a link ID; the original collector, device
and interface tuple is bound by AT11. Collector text is provenance, not an issuer
or independent capability. Public SourceKind remains frozen. Availability
partition grants and PublishCache lifecycle grants do not grant entity browse.

## Authority and transport profile

Root injects its existing genuine canonical issuer:

```rust
let network_access = NetworkAccess::from_shared(
    access::SharedAccess::from_existing(core.access.clone()),
);
```

`NetworkAccess` constructs no AccessBoundary, database, policy, credential,
session or replacement principal. The SharedAccess clone retains the exact
canonical allocation/mutex/private issuer and complete existing state.
`as_existing` preserves the accepted `&app::Access` ABI for ProviderLease capture;
`try_lock` supplies typed current-authority operations without waiting, clearing
poison, fallback or a peer. Refresh verifies pointer identity against Core.access
when entering each native Store phase, including browse/disclosure. Each phase
also compares the Store's original configured ReadAuthority using the actual
immutable Storage accessor; the comparison takes no authority lock and creates
no grant. Original disclosure handles additionally retain their owning Core
identity and check both issuers on independent revalidation. Call the public
Core-taking methods after releasing caller-owned Core/Store/access guards;
the methods acquire their own nonblocking Core borrow. Existing root principals and original
resource handles are moved into leases; no session rehoming or policy synthesis
occurs. The wrapper's trusted admin/auth methods delegate to that same issuer;
no authentication/admin route is installed here.

Transport callbacks retain full session/user/restore epoch/expiry, member
version/role, enabled registration/version and original source checks. A genuine
principal-bound lifecycle guard verifies every retained partition/entity handle
before the lease is exported and on callback revalidation. Indexed full-source
selectors perform bounded grant matching; index entries confer no permission.
Actual AT11 retains all provenance/current-state validation. Limits remain
10,000 original grants/allowlist IDs and the accepted projection input ceilings.
Already-held private upstream session bytes remain origin/lease-bound.

Inside held publication/read callbacks, only the supplied original transaction
authorizer is used. The Store's configured ReadAuthority points to the SAME
canonical mutex, so it must not be reentered. Sidecar/source-file/credential I/O
is outside authority locks, and no Core/Store/access guard spans HTTPS. Canonical
Access operations perform real synchronous SQLite and authentication work:
mutex acquisition is nonblocking; database/scrypt execution and deadline checks
remain cooperative, not hard-preemptible. Durable Atlas I/O is explicit within
native held Store phases. This code does not claim a hard deadline for a stalled
canonical filesystem or replace its authority checks with a mirror/cache.

The actual native consuming Store APIs recheck the original authorizer at
precommit and return a receipt only after COMMIT. Publication and failure-status
publication preserve that definite receipt even if AT11's automatic transaction
exit check or Access commit subsequently fails. Sanitized finalization evidence
is best-effort and emitted after releasing the access mutex; diagnostic I/O
failure cannot replace the committed result. Errors before native success still
propagate. Preparation retains ordinary entry/exit checks. A publication receipt
grants no browse permission; disclosure revalidates its own original grants.
Cancellation remains checked before durable generation staging and before
failure-status publication. Once staging succeeds, late request cancellation
does not abandon the immutable row: the same original authority and fence
continue to consuming native publication, with all current-authority and
precommit checks preserved. Core/Store acquisition and identity checks precede
durable staging, and that same borrow remains held through publication. A
contended Core therefore fails before creating an immutable row. HTTPS is
already complete and no authority lock spans sidecar I/O. A later cancellation
cannot replace the committed
outcome. Authority/storage failures still propagate; this does not add cleanup,
retry, bypass or retention semantics for those failures. Cancellation/fault/expiry
races are statically reviewed only; held control campaigns remain unrun.

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
Store's configured ReadAuthority shares the exact canonical Core mutex. Native
held callbacks use borrowed original authorization instead of reacquiring it. The
canonical disposable file-backed issuer creates the editor/read principals before
Network injection; the bridge preserves their original policy/session/provenance.
The accepted PR36 callback lease also uses that exact shared handle. A separate
genuine viewer with no lifecycle policy performs browse on that same Store. Checks cover schema 5, epoch 0→1, exact pointer/four relations, five typed
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
recorded in the development PR.

Historical stopped rejection/replay/fault/crash/concurrency/corruption/expiry/
revocation/adversarial controls remain held; broad aggregates are unrun. No real
provider/account/NAS call, new real credentials/grants, deployment, paid
inference, main merge or operational acceptance is supplied. Temporary local
keys, passwords and databases are removed; none are printed or committed.
The earlier peer compiler lock SHA-256 remains
`7f70d4f7d57cd5c440a212429264d6399a808acbc71ca6f425b99c1af7e6e58a`,
identical to saved root. Root's unmounted checkout/integrity metadata is not
regenerated by this leaf.

Previous disclosure successor evidence: Rust 1.99.0 locked offline
library/example compilation,
warnings-denied Clippy, scoped rustfmt/diff checks and the named healthy TLS
example passed. The example printed successful same-store publication, schema 5,
genuine viewer resource-grant capture and original-grant rerelease with unchanged
epoch/reservations; the listener recorded exactly one inventory GET. Source audit
matched all 16 access, 55 storage, five migration, 18 media, 23 domain/stock,
five queue-recovery and 14 Network peer files to the external source receipt,
allowing only the explicit external Network module mount suffix. PR36 runtime and closed
authority/registry leaves also matched exactly. Those external peer mounts are
compiler inputs, not changes in this PR or additional qualification claims.

Canonical shared-issuer successor evidence: locked offline warnings-denied
Clippy and build passed, followed by one fresh inspected healthy TLS example.
It verified the same canonical Core/access/Store allocation, a genuine original
principal issued before injection, the accepted PR36 lease ABI, real same-store
native publication, genuine viewer resource capture and original-grant rerelease.
Exactly one inventory GET completed; schema 5, epoch 0→1, durable reopen, five
entities/four links/four relations/one observation and unchanged read epoch/
reservations were observed. Source audit matched all 18 current access files and
the unchanged other peer namespaces to the external receipt; root lock stayed
identical. Principal-mixing, maximum-size, cancellation-race, mutex contention
and other held controls were not executed. The corresponding code corrections
are static review plus ordinary healthy evidence, not control qualification.

Owning-Core browse successor evidence: actual Storage API union and the actual
Network-owner parent declaration compile with the unchanged accepted peers.
Locked offline warnings-denied Clippy/library+named example, build, scoped
rustfmt/diff checks and one fresh healthy TLS run passed. Initial browse obtains
Store only from its checked canonical Core; original-grant rerelease through an
Arc alias of that exact Core returned the identical facet without epoch or
generation-reservation changes. Genuine viewer/link/observation and all prior
healthy publication/reopen assertions remain checked. The exercised Store uses
the union's default schema-5 profile; optional profile-6/upload/recovery behavior
is compiled but unexercised here. The external byte receipt matched 66 Storage
files/six SQL migrations, 18 access and the unchanged other accepted peer bodies,
with the parent module taken exactly from its owner's published correction.
Root module/manifest adoption is still integrator work. Cross-Core, issuer
substitution, revocation, contention and all other held controls were not run.

Commit-result/configuration successor evidence uses the actual root integration
candidate archive rather than the earlier peer compiler. Its unchanged root
lock SHA-256 is
`3cf336251020c03f844c7739a27189c3cc7aa8e04843ee6a0fc5c8e2b19ebfe6`.
The named leaf library/example Clippy and build checks compile the actual
integrated dependencies. One inspected healthy TLS run exercises owning-Core
configuration and retains all prior healthy publication, disclosure and reopen
assertions. Expiry/finalization-failure and cross-Core rejection cases remain
held; these corrections have static API review and normal healthy evidence.
Root's existing `tools/rust-integration/examples/healthy_network_host.rs` caller
must replace its raw-Store configuration block with
`access.configure(&core, &configure_principal, &source)?;` outside any held Core
guard. That file and full root checks remain integrator-owned. No parent module
declaration change is required for this successor.

Staged-generation cancellation correction: the request-cancellation exit after
durable staging is removed. Actual current root integration code and this
runtime were compared at the preimage before editing. Locked library/named
example Clippy and build, scoped formatting/diff/source audit and one inspected
healthy TLS/native publication run verify the scoped successor. No late-cancel
probe, quota-exhaustion campaign or other held control was executed; cancellation
correctness here is static review against the actual durable-stage and native
publication APIs. Current root already adopts the owning-Core configuration
caller; this correction changes no public API or parent declaration. Root's
separate snapshot unresolved-endpoint preservation
finding is not corrected or qualified by this runtime change.

Configured-Store authority/Core-borrow successor evidence: the actual published
Storage accessor is mounted byte-for-byte over the current integration archive.
The leaf checks both the Core issuer and that Store's original configured issuer
before configuration or any native Store phase, and during independent original
disclosure revalidation. Successful refresh holds the same checked Core/Store
borrow from before durable staging through consuming publication; there is no
post-stage Core acquisition. Root library/named-example warnings-denied Clippy,
locked offline build, scoped formatting/diff/source audit and one fresh inspected
healthy TLS/native run passed. All prior genuine configuration, publication,
viewer disclosure and durable reopen assertions remain exercised. Public leaf
signatures are unchanged; root must adopt the actual immutable Storage accessor
with this leaf. Mismatched issuer, Core contention, cancellation/quota and other
held controls were not executed; these corrections have static review and
normal healthy evidence. Source-manifest adoption, configured review/CI and final
integration disposition remain the integrator's responsibility.

Refresh arbitration is shared by the exact Core allocation and complete accepted
source partition, using a private process-local weak registry. Different runtime
objects sharing that Core/partition obtain the same nonblocking flight mutex
before native preparation and retain it through transport and publication.
Registry bookkeeping grants no authority, performs no file I/O and holds no
Core/Store/access mutex; it removes expired weak entries and caps active entries
at 10,000. The refresh's retained Core/flight handles prevent address reuse while
a flight is active. Registry contention/poison/capacity errors precede provider
work; an already held source flight returns the existing `AlreadyRunning` result.
This does not replace native issuing-Store/registration/epoch/pointer CAS or
coordinate distinct processes/independently opened native Stores. Multiple-runtime
overlap, capacity and other concurrency controls remain held; compilation and
one normal healthy refresh provide scoped development evidence only.
