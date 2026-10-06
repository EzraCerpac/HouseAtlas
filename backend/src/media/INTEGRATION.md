# AT12 Rust media integration proposal

Base: published `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. AT12 owns only this directory.
Root manifests, locks, generated contracts and router wiring belong to AT51.

The component has no listener, provider client, credentials, migrations or
production configuration. It implements local owned-original preparation,
verification, PNG previews, original downloads, HEAD and offline owned recovery.
The small synchronous interfaces compose into the monolith without another
service framework. Local deadline/cancellation checks are cooperative; a stalled
integrator `Read` or peer call needs its own bounded/cancellable I/O. The HTTP
owner validates method, canonical descriptors, query/fragment policy and access
before invoking these typed operations, and maps errors to private responses.
It must emit immediately after final authorization revalidation.

## Dependencies for AT51

The external compiler harness pins `serde = 1.0.228` (derive),
`serde_json = 1.0.145`, `sha2 = 0.10.9`, `flate2 = 1.1.5`
(default features disabled, rust_backend), `crc32fast = 1.5.0`,
`rustix = 1.1.2` (fs) and `tempfile = 3.23.0`.
The source supports Linux and macOS with a small platform boundary; current
healthy checks run on Linux with Rust 1.99.0. The peer/backend manifest must
reconcile these pins. No application manifest/lock is added by AT12.

## Typed peer ports

`vault::AvailableAssetVerifier::verify_available_asset(record, budget)` returns
`BlobIdentity { sha256, byte_size }` after reopening actual scope-bound retained
bytes, checking content, and completing the same retained-member and
scope/blobs/staging/root durability barriers used by installation. Verification
establishes these barriers on every call, including bytes retained by an earlier
installation that returned a sync error; no cached preparation flag substitutes
for them. A barrier error prevents the identity from returning.
AT07 must use this inside its availability commit;
preparation alone never publishes an available asset record. Storage owns atomic
record, asset manifest, audit and receipt commits.

`service::MediaStoragePort<P>::read_owned_asset(principal, scope, asset_id)`
returns `StoredAsset { record, manifest }` under current storage authorization.
The record and durable manifest must describe the same committed state.
`service::MediaAccessPort<P>` owns opaque `P` and associated `Grant`; its
`authorize_owned_media`/`revalidate_owned_media` check current access, scope,
descriptor, mode, metadata and revocation epochs. AT12 does not create principals
or grants. Its local checks compare scope/ID, lifecycle/availability, record and
manifest, then reread after byte work and revalidate access before returning.

`recovery::RecoveryDatabasePort::backup_to(destination, budget)` uses SQLite's
backup API and closes a private standalone DELETE-journal copy.
`validate_recovery_database(path, budget)` returns `ValidatedDatabase` only after
checking actual stored contract version, schema/migration SQL hashes, integrity,
foreign keys, frozen snapshot graph and exact one-to-one asset-manifest agreement.
AT07 owns those semantics. Media rechecks the closed image before/after the port,
hashes it, sorts exact assets and binds every declared original or absence.
Recovery preserves audit/receipt bytes in the copied database; it does not
independently validate history rows or claim future witness lineage.

## Contracts and remaining integration

`types.rs` supplies narrow provisional media projections of frozen schema
1.0.0, not generated/shared contracts. Public field names/enums and safe integers
are preserved. Storage remains responsible for full timestamp and graph
validation. Replace/adapt these projections to AT51's generated types in a
coordinated delta; do not change the shared schema from this lane.
HTTP history 1.1.0 is additive; recovery remains contract 1.0.0/database schema 3.
Future source-presence witness/lineage input is missing and is not inferred.

HomeBox attachment transport and its durable quarantine/cache/source-grant ports
are pending peer reconciliation. No HomeBox byte delivery is implemented here.
The format is exactly the published `houseatlas-owned-recovery/1` field set and
limits. Manifests provide integrity, not authenticity or encryption. Access DB,
sessions, credentials/config, HomeBox originals and Network state remain excluded.
AT15 must compose its separate access/config restore and invalidate sessions.

The vault uses descriptor-relative no-follow member opens/links, directory inode
pins, private modes, synced original bytes and no-overwrite installation. New
root, child and temporary directories sync themselves and their bound parents
before returning, including existing-directory retries. Parent mode is checked
as an existing directory rather than forced to the child vault's 0700 mode.
File writes sync bytes and their directory; installed/reused originals sync
again before scope/blobs/staging/root barriers. Capture syncs the peer-created
closed database. Restore syncs the complete nested vault bottom-up, including
empty directories, before outer staging publication. Barrier errors propagate.
Bundle publication syncs its staging directory immediately before exclusive
rename and its parent after rename.
The integrator must exclusively own and serialize configured directories;
ordinary synthetic examples do not qualify hostile same-owner interference,
target power-loss/rename behavior, security, deployment or retention.
Only operation-owned staging is cleaned when its directory identities still
match. Installed originals have no delete/GC API. Staging left after process
death needs a future drained offline cleanup owner.

## macOS portability and remaining native checks

`platform_fs.rs` is the platform boundary: both platforms use descriptor-relative
exclusive rename through pinned rustix. Linux uses `RENAME_NOREPLACE`; macOS uses
`renameatx_np` with `RENAME_EXCL`. macOS runtimes without that API fail rather
than fall back to an overwriting rename. The sync helper propagates `fsync` on
both platforms and additionally `F_FULLFSYNC` on macOS, including directory
barriers. Unsupported filesystem sync operations fail; they are never ignored
or replaced with weaker success. Apple describes this cache-flush requirement
in its [fsync documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html).
Private file creation accepts rustix `Mode` directly so the Darwin `mode_t`
width is respected. Synthetic temporary paths are canonicalized to handle
macOS `/tmp` and `/var` aliases without relaxing production directory pins.

The selected environment has only the Linux standard-library target and no
Apple SDK, xcrun or cross-toolchain; Darwin compilation/runtime checks were not
run and no compiler/SDK was installed. Source-level macOS support is not native
target qualification. The macOS target follow-up is native Rust 1.99 compilation
and the two named ordinary healthy examples below on a disposable private
directory on the intended Mac filesystem. Those examples must successfully
exercise directory/file `F_FULLFSYNC`, scope creation/reopen, immutable hard
links, and new-destination exclusive rename/capture/restore; record macOS
version, architecture, volume/filesystem and actual errors outside Git.
The exact APFS/volume directory/full-sync behavior remains unverified here.
Crash/fault/power-loss, adversarial, concurrency, rejection and replay checks
remain deferred and are not substituted by these healthy examples.

## Behavioral references inspected

- `packages/media/src/{bytes,content,vault,index,recovery}.mjs`
- `packages/contracts/schemas/atlas.schema.json` asset payload/record definitions
- `packages/contracts/history/http-history.v1.1.0.schema.json`
- `packages/media/test/support.mjs` independently built healthy 2x2 PNG
- `packages/contracts/fixtures/{plan-free,optional-geometry}.snapshot.json`

Legacy module test aggregates and stopped rejection/guard-reversal/mutation,
adversarial, fault/crash, concurrency, replay and negative-consumer controls are deferred.

## Scoped healthy verification

The external task-owned compiler manifest points its library target directly at
this `mod.rs`. Its location and exact execution logs are retained outside Git.
After activating the verified toolchain, set `AT12_MANIFEST` to that external
manifest when reproducing the prior scoped commands:

```sh
node --check backend/src/media/checks/public-fixture.mjs
cargo fmt --manifest-path "$AT12_MANIFEST" -- --check
cargo check --locked --manifest-path "$AT12_MANIFEST"
cargo clippy --locked --manifest-path "$AT12_MANIFEST" --all-targets -- -D warnings
cargo test --locked --manifest-path "$AT12_MANIFEST" --lib healthy_ -- --nocapture --test-threads=1
```

Exactly two new positive examples run. One independently builds ten static
RGB/RGBA PNG inputs covering filters 0–4, then checks dimensions/pixels and
metadata-free output. The other checks actual original verification/immutable
retry, PNG preview/download/HEAD/private headers, exact PDF/text downloads,
and capture/verify/restore of the frozen optional-geometry fixture's missing
asset plus active originals and a healthy retained tombstone.
`checks/public-fixture.mjs` is a test-only compatibility adapter using actual
SQLite backup and the published core's schema/migration/graph/manifest validation.
It checks restored database bytes, ordered history and receipt-byte preservation, opens no
listener and calls no provider. The delivery storage/access peers are explicit
stubs; this check does not exercise the Rust AT07/AT11 adapters. No legacy test
file, test glob, stopped control or readiness listener is invoked.

A preliminary example invoked one same-payload synthetic receipt replay through
the published `AtlasStore.execute` API for an already committed tombstone, before
the history document's broader replay deferral was reconciled. That execution
remains in the historical log and is not erased by removing its invocation from
the retained check. The final run compares receipt bytes only; the preliminary
run supplies no replay qualification. No further validation runs during durable
source packaging. Prior harness results are not Rust integration/CI acceptance.
