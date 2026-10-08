# Network constructor ownership source

This leaf closes the independent typed-constructor custody gap without changing
NetworkSettings, NetworkBinding, HostNetworkRuntime or SameStore disclosure APIs.
Every SqliteNetworkSidecar and NetworkImmutableArchive constructor takes a
nonblocking exclusive flock on the actual database inode before SQLite opens.
The archive also locks its actual private segment-directory descriptor. These
original leases remain alive through connection close; independent opens fail
with the existing Upstream availability error. Binding/runtime Arc clones keep
the original owner. Read-only evidence connections confer no custody authority.

The implementation uses accepted Media PrivateDir descriptor checks and durable
writes, SQLite NOFOLLOW, bounded descriptor-relative segment reads and NOREPLACE
sealing. Exact source bodies, archive headers/receipts, catalog and permanent
burned generation IDs retain their original checks. Sidecar schema validation
precedes raw archive construction. Private permissions are checked rather than
repaired. Existing segment modes remain accepted inside the required private
0700 directory; new segments are 0600. No process mask is changed.

Root mounts two declarations only:

```rust
// backend/src/media/mod.rs
pub(crate) use private_fs::PrivateDir;
// backend/src/providers/network/mod.rs
#[path = "host_runtime/native_owner.rs"]
mod native_owner;
```

No root configuration or public constructor signature changes are required.
Root already uses rustix 1.1.2 fs/process and rusqlite 0.40.2, and the normal verified
reqwest 0.13.5 profile is untouched. Source Cargo manifests and root declarations
are excluded from this donor. Root may add these explicit example targets:

```toml
[[example]]
name = "network-constructor-ownership"
path = "src/providers/network/host_runtime/examples/ownership.rs"
[[example]]
name = "network-constructor-exclusivity"
path = "src/providers/network/host_runtime/examples/ownership-exclusivity.rs"
```

The first target is healthy-only: fresh explicit 0700 synthetic root, original
unchanged inventory/link-review inputs, actual native capture and receipt,
independent identities coexisting, settings/runtime close/reopen and full logical
row/catalog/reservation/ID comparisons, then cleanup. No HTTP endpoint is called.
It does not qualify Core/Store authorization; accepted disclosure pin checks are
separate. Previously delivered pin-lifetime.rs is excluded, preserving root's
explicit 0700 fixture and media_policy_evidence Core literal adaptations.

The second target is a separate isolated regression, never ordinary CI. Review
its exact source and imported ownership-fixture.rs before each permitted run.
Only --exact sidecar-duplicate, archive-duplicate, runtime-duplicate and
process-sidecar-duplicate are allowed. The sidecar case includes direct derived
archive construction while the original sidecar owns it. The process case invokes
only this executable's internal --probe-owned helper, gated to its parent's fresh
temp-prefix root and random marker; this gate is fixture scope, not authentication.
Child lifetime is bounded 10 seconds, timeout termination is resource containment.
All cases use empty fresh native stores, no credentials/grants/provider fallback,
compare applicable full logical inventory, close owners and remove temporary
state. No broad suite, alias, crash, replay, expiry, revocation or path attack runs.

The lock is a cooperative typed-constructor contract, not a claim against
arbitrary external SQLite or same-UID filesystem tooling. SQLite still opens by
path under the original private directory with inode checks before/after; a
hostile external replacement race is not qualified here. Linux synthetic proof
does not establish macOS qualification. External native archive origins, actual
recovery/export/future producers still need their own exclusive-owner and lifetime
binding. Production reference coverage remains Unknown and protects everything.
There is no Complete claim, retention window, deletion, maintenance or executor.
