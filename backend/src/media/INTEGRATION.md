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
`rusqlite = 0.40.2` (bundled, backup), `jsonschema = 0.58.6` (arbitrary-precision, no
defaults), `base64 = 0.22.1`, `getrandom = 0.3.4`, `scrypt = 0.11.0` (no
defaults), `subtle = 2.6.1` and `url = 2.5.7`. Actual native semantics also
requires `regex = 1.13.1` and `ryu-js = 1.0.2`; the compiled domain peer uses
`time = 0.3.44` (parsing, formatting) and `serde_jcs = 0.2.0`. The actual native backup API
requires rusqlite's `backup` feature. No application manifest/lock
is added by AT12; the earlier isolated harness and its logs are preserved.

## Compiled native peer composition

`native.rs` imports the monolith's `crate::{storage, access, contracts}`. Its
external harness compiles exact published AT07
`1b52c415710467407176eda4fe4b519ca51d840d`, AT11
`4967dd2d38c5749be35aa7e44728c4d691246730` and AT51
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`, plus AT30 domain
`f51bc7962b491faa1cc563f2ec0f737c471e4e26`. Schema-2 storage requires the
domain's stock types even for an empty stock journal. Those actual compiled
peer modules and embedded schema/fixture inputs remain outside this lane's Git
namespace and ancestry. The native healthy example uses actual AT30
`NativeSemantics::native()` bound to AT51 graph/transition/result/JCS/timestamp
functions. The prior pure JS semantic helper is retained as checkpoint source,
but this native example no longer invokes it. Host mounting belongs to AT52.

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

`NativeMediaStorage` implements `RecoveryDatabasePort` using two actual
storage-owned APIs published in [AT07's recovery checkpoint](https://github.com/EzraCerpac/HouseAtlas/commit/1b52c415710467407176eda4fe4b519ca51d840d):

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

The adapter borrows the existing store mutex without waiting, checks its
cooperative budget before/after acquisition, and passes that budget to storage's
progress callback. The callback acquires no access/vault locks. Storage backs up
its owned connection, normalizes and closes the standalone image, and validates
actual stored metadata, migration SQL hashes/catalog, integrity/FKs, the complete
unredacted graph through C, exact manifests and persisted history linkage.
Original native command/guard envelopes are not persisted, so their receipt
payload hashes cannot be recomputed; no envelope is invented. Both actual
`RecoveryImage` returns are checked against trusted compatibility metadata and
bounded before projecting asset records; their metadata is preserved verbatim.
The store guard is released before projection and media hashing/barriers.

Recovery paths belong to offline trusted administration and must be private,
operation-owned staging/image paths. Ordinary writable `open` and authorized
filtered `read_snapshot` are not image validators. Restore copies the validated
closed image, validates private staging through the same read-only port, syncs
originals/hierarchy and publishes a new destination. The healthy example then
opens it through the normal native store. Complete image copying preserves
records/reservations, ordered audits, single/batch receipts, source/cache/
projection/Network relation rows and cache generations/epochs. The current
schema-2 peer requires all five stock journal tables to be empty; nonempty
stock recovery needs its exact stock-aware validation peer. That error
propagates without filtering or legacy fallback. No nonempty stock/rejection
probe was run. Source supports no native schema-1 recovery/migration here.
Cancellation is cooperative between calls; synchronous SQLite/contract work,
filesystem sync and publication cannot be preempted by the callback. No hard
ten-second completion or concurrent-restore qualification is claimed.
Sanitized wire3/presence schemas are available published inputs, but durable
Network sidecars and atomic presence-witness persistence remain unimplemented;
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
`houseatlas-rust-owned-recovery/1` with compatibility fields taken from AT07's
compiled `CONTRACT_VERSION`, `DATABASE_VERSION` and `DATABASE_LINEAGE` exports.
This checkpoint supports native contract 1.0.0/schema 2 and required
`databaseLineage: houseatlas-rust-storage/1`, with empty stock journals only.
Media holds no native numeric schema constant. Unified algorithms freeze the
trusted profile per operation, require that exact identity from actual validated
peer metadata, and copy that actual metadata into the manifest. Bundle fields
never choose the profile. Healthy native capture/verify/restore uses this actual
port. Future durable source-presence witness/lineage input is not inferred.

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
into disposable native SQLite. Actual native online backup and read-only
closed-image validation now exercise schema-2 capture/verify/restore with that
graph, a missing original and retained text/PDF tombstones. The restored closed
database is byte-identical before normal opening enables WAL, preserving audit
and receipt bodies without replay. Retained originals, scoped graph reads and
ordered history are compared after native reopen; restored PNG delivery uses
actual native storage/access. The stock journals are empty. No stock operation
or rejection control runs. Both original and restored stores use actual Rust
`NativeSemantics::native()`; no JS semantic or database adapter executes in
this native example. Root dependency/type/CI reconciliation and trusted AT52
host composition remain required. Earlier JS database recovery evidence and
the separate retained JS SQLite example continue to qualify only explicit
legacy compatibility. The prior native composition's pure JS semantic helper
and logs remain preserved; this successor supplies no runtime semantic fallback.

A preliminary example invoked one same-payload synthetic receipt replay through
the published `AtlasStore.execute` API for an already committed tombstone, before
the history document's broader replay deferral was reconciled. That execution
remains in the historical log and is not erased by removing its invocation from
the retained check. The final run compares receipt bytes only; the preliminary
run supplies no replay qualification. No further validation runs during durable
source packaging. Prior harness results are not Rust integration/CI acceptance.
