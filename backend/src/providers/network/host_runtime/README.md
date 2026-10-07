# Network host binding

This leaf supplies concrete AT11 callbacks, exact PR36 callback ABI, and a closed
same-store native publication runtime. It is development code, not live target
qualification. All changes are below `backend/src/providers/network/host_runtime/`.
Root manifests, locks, module declarations, routers and shared schemas are untouched.

## Exact inputs and mount

| Input | Exact source |
| --- | --- |
| PR36 Network runtime ordering/quarantine | `529ecbcaf6e308b658a7f05fecc3214379fc707a` |
| Borrowed NativeNetworkPublisher | `37025316d419d9bf6dd3568cbcc883ee32fa6180` |
| AT11 original lifecycle authority | `4a0cd4da563a32d26677755a608180c960765353` |
| Same-store per-call storage | `2643eced79c5a581f72cc53634659d93da323cfb` |
| Closed provider authority and configured registry | `9b24642266a043d03d181e16c44ec0cc6fd8f5b8` |

The peers remain byte-identical. The runtime is a fresh implementation of PR36's
phase ordering, not a modification of that accepted file. The exact integration
leaf is `backend/src/providers/network/host_runtime/mod.rs`. After mounting the
accepted peers, root adds only `pub mod host_runtime;` to the Network declaration.
The external compiler composition also mounts accepted config registry/settings
and lifecycle authority/runtime declarations; those are integrator-owned.

`OwnedNetworkAccess::bind_accepted_original` returns `AcceptedNetworkAuthority`,
whose `NetworkReadAuthority::Lease` is exactly
`Arc<lifecycle::providers::network::NetworkAuthorityLease>`. Pass that adapter and
`adapter.lease().clone()` to the unchanged PR36 `NetworkRuntime::refresh`.

`HostNetworkRuntime::refresh` is the closed native-publisher entry point. It takes
actual `app::Core`/`app::Store`, a `NetworkAuthority`, and its original
`OriginalNetworkLease`. Prepare, success and failure each call
`NativeNetworkPublisher::new(the_same_store).with_authorization(...)` inside the
original AT11 lifecycle transaction. No raw fence or caller authorizer escapes.
The actual durable receipt's partition/generation/digest is compared before
consuming publication. The original registration, partition, cache generation,
cache epoch and reserved UUID remain AT07's native issuing-store/CAS checks.
PR36's quarantine predicate precedes retained loading, credentials, transport
construction and staging. Publication also retains the closed quarantine check.
The final release revalidates the original principal and all original handles.

## Callback profile

`OwnedNetworkAccess` owns the genuine `AccessBoundary::in_memory` backend, not a
cache or mirror of another authority database. No file-backed constructor,
replacement boundary, raw connection or authority-issuing callback is exposed.
Its typed startup/auth/admin methods delegate to AT11. Lifecycle policy is explicit,
default-deny owner input; registration metadata never creates policy or a grant.
At most 256 policy rules and 10,000 original grants/allowlist IDs are admitted.
The authority lock uses `try_lock`; there is no waiting lock acquisition.

All transport callbacks use current AT11 session/user/restore epoch/expiry,
membership version/role, complete registration/enabled partition/version and
original-source checks on that same memory database. The clock is AT11's normal
system clock, with no injected callback. No filesystem work, network work,
credential acquisition, grant refresh or cached permit is hidden in a callback.
The Network transport checks its absolute deadline before and after callbacks;
synchronous CPU work is bounded by configured input sizes, not hard-preemptible.
Durable sidecar and Atlas SQLite work occurs in explicit outer phases, and no
store/access guard spans HTTPS. The held publication fence necessarily contains
explicit durable Atlas transaction I/O; it is not a transport callback.

This is an explicit **process-local authority profile**. It cannot accept a
principal issued by the existing root's file-backed boundary. Root must select
this one genuine issuer for Network authentication and admin updates, or obtain
an access-owner nonblocking current-authority API for its existing backend.
Rehoming existing sessions, importing credentials or silently mirroring durable
authority is not implemented or authorized. Login/provisioning methods are not
mounted automatically. Session material supplied to transport is already-held,
private, bounded and origin/lease-bound; this leaf never acquires it.

## Membership and disclosure boundary

Network's real `validate_state` reprojects all original source JSON against the
full registration and reviewed links, checking original grouping/interface
parents, raw link endpoints, normalized relations, observation IDs and device/
interface references. `generation_references` retains every supported typed
member, not just visible endpoints. Original AT11 entity grants cover groups,
devices, interfaces and segments. The genuine lifecycle grant covers internal
publication of the complete approved registration, including links/observations;
it does not authorize their public disclosure.

**Blocking peer gap:** AT11 `4a0cd4da` has no `network-link` or observation
`SourceKind`. Partition grants authorize availability metadata, and lifecycle
grants authorize publication, neither entity disclosure. `disclose` refuses a
generation containing links, relations or observations before returning payload.
It never relabels these as device/interface grants or invents a membership issuer.
This refusal is compiler/static-reviewed only; no rejected-request probe is run.
A complete facet needs a genuine owner extension for original grants covering
those kinds (including observation collector/member scope) and root's actual
same-store authorized read binding. The current `disclose` input must already
come from root's authorized retained snapshot; it is not a new storage read API.
The PR must remain draft while this completion gap and issuer selection remain.

## One verified TLS profile and manifest proposal

Use the root's existing single dependency and lock:

```toml
reqwest = { version = "=0.13.5", default-features = false, features = ["blocking", "rustls"] }
```

This is the proposed canonical declaration for both HomeBox and Network; it
already matches the saved root, so no root manifest/lock edit is necessary.
Replace the Network owner's historical 0.12.24/WebPKI dependency guidance with
this shared 0.13.5 Rustls platform-verification profile at integration. No parallel
0.12 client is introduced. The actual existing `HttpInventoryTransport` uses
that resolved client with certificate/hostname verification, reviewed additional
roots, HTTPS-only, no proxy, no redirects, identity encoding and bounded stream.
No insecure certificate/hostname option exists here. Root's stale profile note
is a documentation correction proposal, not an edited accepted input.
Only passive `GET /api/inventory` is sent. Snapshot, ARP, diagnostics, demand and
Network writes have no entry point in this leaf.

## Scoped checks

Inspect the example and Python fixture bodies first. In an external disposable
copy of the exact peers with this leaf mounted, root may add this example target:

```toml
[[example]]
name = "healthy-network-host"
path = "src/providers/network/host_runtime/examples/healthy.rs"
```

Use Rust 1.99.0 and the retained root lock. Set `CARGO_TARGET_DIR` outside source.
Only the named library/example targets and one inspected healthy fixture are in
this lane:

```sh
rustfmt --edition 2024 --check backend/src/providers/network/host_runtime/*.rs backend/src/providers/network/host_runtime/examples/healthy.rs
cargo check --locked --offline --lib --example healthy-network-host
cargo clippy --locked --offline --lib --example healthy-network-host -- -D warnings
cargo build --locked --offline --example healthy-network-host
python3 backend/src/providers/network/host_runtime/examples/healthy-loopback.py "$CARGO_TARGET_DIR/debug/examples/healthy-network-host"
```

The loopback fixture uses an ephemeral OpenSSL CA and signed end-entity certificate with an IP SAN,
verifies it through the normal merged trust profile, and permits exactly one
chunked passive inventory GET. It supplies genuine synthetic AT11 policy,
scrypt login, CSRF-checked configuration principal, read principal, membership,
original partition/entity/lifecycle grants and real disposable Atlas/sidecar
SQLite. The Atlas default authorizer has no lifecycle rights; the actual borrowed
per-call native authorizer performs publication on the same open Store.
Read-only inspection checks epoch 0→1, exact cache pointer, four relation rows,
retained source text/date, and durable close/reopen. No public link disclosure is
executed. Temporary certificates, keys, passwords and databases are removed;
no secret or household value is printed or committed.

Historical stopped rejection/replay/fault/crash/concurrency/corruption/expiry/
revocation/adversarial controls remain held. Quarantine and unsupported-disclosure paths are compiled/static-reviewed, not exercised.
An initial intended-healthy fixture unexpectedly returned SourceFailure and
therefore executed the consuming synthetic failure-status publication. Its error
category was not retained. Source inspection found OpenSSL's default CA:TRUE
certificate had been served as the end entity. The fixture now generates a
separate CA and proper CA:FALSE/serverAuth/IP-SAN leaf, retaining normal TLS
verification. That accidental result is not a held-control campaign or healthy
qualification; failure-status qualification remains open. No real provider/account/NAS call,
new real credential/grant, deployment, paid inference, security qualification,
main merge or operational acceptance is supplied.

## Observed development result

Rust 1.99.0 locked offline library/example compilation, warnings-denied Clippy
and scoped rustfmt passed in the external composition. The successful corrected
fixture made exactly one verified loopback inventory GET and observed genuine
AT11 original grants, same-store native publication, SQLite epoch 0→1, exact
pointer and durable reopen, five typed entities, four retained links, four
relations and zero observations. These results do not qualify public disclosure
or a live provider. The initial unintended SourceFailure is recorded above.

The final source audit compared all 51 storage files to `2643eced`, all 12 access
files to `4a0cd4da` and all 14 Network owner files to `37025316`; all matched
exactly, excluding the explicit external module mount suffix. PR36 runtime and
closed authority/registry files retain their exact accepted bytes. The compiler
copy's lock SHA-256 is
`7f70d4f7d57cd5c440a212429264d6399a808acbc71ca6f425b99c1af7e6e58a`,
byte-identical to the saved root lock. No 0.12 client or new dependency is used.
The saved checkout remains intentionally unmounted; its central integrity
manifest is integrator-owned and is not regenerated by this leaf.
