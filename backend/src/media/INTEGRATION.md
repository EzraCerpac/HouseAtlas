# AT12 Rust media integration proposal

Base: published `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. AT12 owns only this directory.
Root manifests, locks and generated contracts belong to AT51. Host/router
mounting belongs to AT52.

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

The composed external compiler harness pins `serde = 1.0.229` (derive),
`serde_json = 1.0.151` (arbitrary_precision, float_roundtrip, raw_value),
`sha2 = 0.10.9`, `flate2 = 1.1.5`
(default features disabled, rust_backend), `crc32fast = 1.5.0`,
`rustix = 1.1.2` (fs) and `tempfile = 3.23.0`.
The source supports Linux and macOS with a small platform boundary; current
healthy checks run on Linux with Rust 1.99.0. The peer/backend manifest must
reconcile these pins. Actual AT07/AT11/AT51 composition also uses their pinned
`rusqlite = 0.40.2` (bundled), `jsonschema = 0.58.6` (arbitrary-precision, no
defaults), `base64 = 0.22.1`, `getrandom = 0.3.4`, `scrypt = 0.11.0` (no
defaults), `subtle = 2.6.1` and `url = 2.5.7`. The requested native backup API
will additionally need rusqlite's `backup` feature. No application manifest/lock
is added by AT12; the earlier isolated harness and its logs are preserved.

## Compiled native peer composition

`native.rs` imports the monolith's `crate::{storage, access, contracts}`. Its
external harness compiles exact published AT07
`45e1e38e97a8e41536b4b6195449076d602589c0`, AT11
`4967dd2d38c5749be35aa7e44728c4d691246730` and AT51
`07576e6be463dd481b49071071c66dec144b1e0c`; those compiled peer modules remain
outside this lane's Git namespace and ancestry. The pure semantic test helper
is adapted from AT07's published checkpoint oracle. Host mounting belongs to AT52.

`NativeMediaStorage::new(&Mutex<AtlasStore<C,A,R>>)` borrows the host's actual
store and calls its authorized `read_record` and `read_asset_manifest` APIs.
Shared `contracts::decode` checks the native asset record/payload before a narrow
media projection. Checked integral byte sizes/revisions are converted only in
that in-memory projection; persisted payloads, original receipt inputs and JCS
hashes are never rewritten. The media service compares the committed record and
manifest and rereads before release. `NativeMediaRuntime<R>` delegates server
IDs/time to R and supplies its availability callback with actual immutable vault
verification and durability barriers. Storage's Runtime API has no incoming
operation budget; each verification uses a ten-second cooperative budget, and
the host still owns whole-operation bounded I/O/cancellation.

`NativeMediaAccess` wraps the actual AT11 boundary. `authorize_request` invokes
AT11 with the actual request and `Action::Media`. `RetainedPrincipal` holds the
opaque issued Principal in a private Arc; clones retain the exact original.
Before creating a grant, preview requires `SafeRendered`; download requires
`SafeRendered` or `DownloadOnly`. All other policies return `NotFound`.
`NativeOwnedGrant` is a local descriptor/metadata/mode continuity binding around
that retained capability. Its release check uses Arc identity and exact metadata
before AT11 reads current session/user/membership/restore-epoch authority for the
retained original. DTO equality never creates or replaces authority. The trusted
host may wrap an existing AT11 handle with `RetainedPrincipal::new`; it must use
the actual media issuance action at its request boundary, since AT11 exposes no
public action accessor. Method rejection preserves AT11's 405 status.

`NativeReadAuthority` uses actual AT11 read/history/manifest capabilities. It
tries the access mutex without waiting while storage holds its mutex, so a held
access mutation fence cannot form an opposite-order wait with a media read.
Contention/poisoning returns sanitized unavailable; no contention/revocation test
was run. No mutation/publication authority is supplied by this read adapter.

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
descriptor, mode, metadata and revocation epochs. AT12 retains actual AT11
capabilities and supplies a local release binding; it creates no access authority.
Its local checks compare scope/ID, lifecycle/availability, record and
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

Native recovery remains blocked on two storage-owned APIs. They are requested
on [PR #7](https://github.com/EzraCerpac/HouseAtlas/pull/7#issuecomment-6028231268):

```rust
pub struct RecoveryImage {
    pub contract_version: String,
    pub database_lineage: String,
    pub database_schema: u32,
    pub assets: Vec<Record>,
}
// AtlasStore<C: Contract, A: Authorization, R: Runtime>:
pub fn backup_recovery_to(
    &mut self, destination: &Path,
    check: &mut dyn FnMut() -> storage::Result<()>,
) -> storage::Result<RecoveryImage>;
pub fn validate_recovery_image(
    &self, database: &Path,
    check: &mut dyn FnMut() -> storage::Result<()>,
) -> storage::Result<RecoveryImage>;
```

Neither API exists at the exact published AT07 head above. Media consequently
supplies no native RecoveryDatabasePort implementation or JS fallback. Storage
must back up its owned connection, normalize/close the standalone image, and
validate actual stored metadata/migration checksums, integrity/FKs, its complete
unredacted graph through C, and exact manifests. Its normal writable `open` and
authorized/filtered `read_snapshot` are unsuitable image validators. Restore
will copy the validated immutable image rather than reconstruct rows, validate
private staging through that same port, sync originals/hierarchy, publish a new
destination, then reopen through the native store. This preserves all actually
implemented tables: records/reservations, ordered audits, single/batch receipts,
source/cache/projection/Network relation rows and cache generations/epochs.
Current AT07 has no durable Network sidecar or presence-witness implementation;
no profile field or claimed capture invents them.

## Contracts and remaining integration

`types.rs` supplies narrow provisional media projections of frozen schema
1.0.0, not generated/shared contracts. Public field names/enums and safe integers
are preserved. Storage remains responsible for full timestamp and graph
validation. The native adapter checks AT51's generated types before projection;
further shared type reconciliation remains coordinated. No shared schema changes.
HTTP history 1.1.0 is additive. Trusted `RecoveryProfile::LegacyJsV1` preserves
the published `houseatlas-owned-recovery/1`, contract 1.0.0/database schema 3 and
its exact absent-lineage wire shape. `NativeRustV1` selects a distinct
`houseatlas-rust-owned-recovery/1`, schema 1 and required
`databaseLineage: houseatlas-rust-storage/1`. Unified algorithms freeze the
trusted profile per operation, require that exact identity from actual validated
peer metadata, and copy that actual metadata into the manifest. Bundle fields
never choose the profile. Native profile behavior is coded but has not executed
native capture/verify/restore while the storage port is missing.
Future source-presence witness/lineage input is missing and is not inferred.

HomeBox attachment transport and its durable quarantine/cache/source-grant ports
are pending peer reconciliation. No HomeBox byte delivery is implemented here.
Both profiles use the published limits. Manifests provide integrity, not
authenticity or encryption. Access DB,
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

The external task-owned compiler crate includes this directory as `media` along
with the exact native peer modules above. Its location, lock, peer hashes and
execution logs are retained outside Git; earlier logs remain unchanged.
After activating the verified toolchain, set `AT12_MANIFEST` to that external
manifest when reproducing the prior scoped commands:

```sh
node --check backend/src/media/checks/public-fixture.mjs
node --check backend/src/media/checks/semantic-oracle.mjs
cargo fmt --manifest-path "$AT12_MANIFEST" -- --check
cargo check --locked --manifest-path "$AT12_MANIFEST"
cargo clippy --locked --manifest-path "$AT12_MANIFEST" --all-targets -- -D warnings
cargo test --locked --manifest-path "$AT12_MANIFEST" --lib media::healthy_ -- --nocapture --test-threads=1
```

Exactly three named positive examples run. The two retained examples remain:
one independently builds ten static
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

`healthy_native_examples::healthy_native_owned_media_records_and_history` uses
the actual Rust AtlasStore, actual AT11 synthetic login and opaque principals,
and its held access mutation fence for two new healthy single/batch tombstones.
Real originals supply storage availability proofs; authorized `SafeRendered`
PNG GET/preview HEAD, an active `DownloadOnly` text GET before its tombstone,
and ordered history read through the native adapters. Existing published
optional-geometry graph/cache/projection/Network relation rows are bootstrapped
into disposable native SQLite. This executes no native backup/restore while its
peer API is missing. `checks/semantic-oracle.mjs` delegates pure published
graph/transition/result/JCS/timestamp behavior only; it opens no database. The
full native AT52 semantic Contract remains a required production peer, with no
runtime semantic fallback in `native.rs`. Earlier JS database recovery evidence
continues to qualify only the explicit legacy compatibility example.

A preliminary example invoked one same-payload synthetic receipt replay through
the published `AtlasStore.execute` API for an already committed tombstone, before
the history document's broader replay deferral was reconciled. That execution
remains in the historical log and is not erased by removing its invocation from
the retained check. The final run compares receipt bytes only; the preliminary
run supplies no replay qualification. No further validation runs during durable
source packaging. Prior harness results are not Rust integration/CI acceptance.
