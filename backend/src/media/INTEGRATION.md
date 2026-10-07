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
Owned upload-token issuance now directly uses the same pinned `getrandom = 0.3.4`.

## Compiled native peer composition

`native.rs` imports the monolith's `crate::{storage, access, contracts}`;
`native_recovery.rs` also requires the actual domain stock and queue ports. The
current external harness compiles exact published AT07
`06eb465f6fe4b99530ef1636b46ea3e01e537106`, AT11
`4a0cd4da563a32d26677755a608180c960765353` and AT51
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`, plus actual domain/jobs
`d9e2b59ffef4b7ac2b11705df735b89d8371fdc5`. Storage's current native schema is
4. These actual compiled
peer modules and embedded schema/fixture inputs remain outside this lane's Git
namespace and ancestry. The native healthy example uses actual AT30
`NativeSemantics::native()` bound to AT51 graph/transition/result/JCS/timestamp
functions. The prior pure JS semantic helper is retained as checkpoint source,
but this native example no longer invokes it. Host mounting belongs to AT52.
The accepted `80194a0e0f098cef85d71db602a78ae52db6bcad` packet and logs are
preserved separately: it used schema-2 AT07 `1b52c415710467407176eda4fe4b519ca51d840d`
and AT30 `f51bc7962b491faa1cc563f2ec0f737c471e4e26`, AT11
`4967dd2d38c5749be35aa7e44728c4d691246730` and the same AT51 pin.
The current adapter introduces no migration or compatibility fallback for that
older database schema.

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

## Owned upload staging and immutable asset-plan binding

`staged_upload::NativeUploadStages::open(&vault, &server_runtime)` is actual
filesystem/vault implementation, borrowing the existing `storage::Runtime` for
server asset-ID issuance. `stage_original(guard, original, admission, body,
budget)` returns `UploadReceipt { request_id, asset_id, staged }`. `staged` is the
published stock stage projection: `uploadToken`, `sha256`, `byteSize`,
`contentType`, `filename`. The new outer response is proposed host integration
data; it is not a newly generated shared contract or an approval.

`UploadAdmission` supplies request ID, original purpose, typed content type,
descriptive filename, actual source licence and ordered evidence IDs. Scope and
actor come from the actual original AT11 principal. Intrinsic licence, evidence
UUID/uniqueness/count, filename and encoded metadata checks precede reading or
retaining bytes. The vault measures and validates actual bytes and completes its
existing immutable retained-original barriers. A cryptographically random UUID
token is minted with `getrandom`; the asset ID is issued by the host runtime.
Issuance does not reserve that ID against AtlasStore. No caller asset ID or
approval flag is accepted at staging.

An immutable `stage.json` is published exclusively under
`<vault>/uploads/<sha256(token)>`, with private file/directory and parent barriers.
It binds the measured file, issued asset ID, request, original scope/actor,
purpose, licence and provenance. Original bytes remain in the existing scoped
vault; there is no duplicate blob store, SQL connection or separate database.
Files are bounded at 64 KiB, covering the published licence/evidence maxima;
the pending-authority map is capped at 10,000 entries per live owner. This cap
is not a disk-retention policy across owner reopen. Filenames are descriptive
metadata and never paths. The 1 byte–10 MiB stock stage range and the existing PNG,
PDF and plain-text content rules apply. Derived-preview upload is unsupported.

`bind_asset_plan(guard, original, token, &validated_request, budget)` reparses
the unchanged request with the actual `NativeStockContract`, requires
`atlas.asset.create`, and compares its request/home/target and every staged-file,
purpose/licence/provenance field. It reopens real bytes and establishes their
identity/barriers without fabricating an AssetRecord, audit ID or timestamp.
It then exclusively publishes `plan/binding.json` containing the complete
original envelope, including guards, reason, idempotency key and nullable
approval reference. Full binding and field comparisons use the domain's
`canonical_digest`; the separate original intent digest retains the published
`request_digest` exclusions. Licence/approval fields are retained data and grant
no authority. No submitted ID or envelope is rewritten.

Both calls require an actual `TransactionAuthorization` for the exact original
`RetainedPrincipal`, revalidate after final durability barriers, and retain its
opaque handle in memory. The host must keep that exact clone in its existing
prepared-operation context across phases. A freshly issued Principal, actor/home
DTO equality or a token cannot adopt that handle. Owner loss/restart leaves
durable bytes/data but no reconstructed authority; planning is unavailable until
an actual access-owner reauthorization contract exists.

The sealed `StagedAssetPlan` exposes `request()`, `asset_id()`, `payload()`,
`staged()`, `binding_digest()` and `original_principal()`. This is verified data
for the domain/storage owner, not the private `AtlasCommandPlan` or a consumed
SQLite receipt. It invokes no held mapper, frozen mutation or storage commit.
The accepted storage/domain pins have no token admission/lookup/consume API,
and the stock mapper still holds asset creation/review. Required owner work is
transactional stage-token association and consume with the existing
asset/manifest/audit/native+stock receipt commit, the qualified asset planner,
actual graph/evidence/approval checks, ID reservation if required, and matching
schema/recovery validation. A filesystem plan binding cannot supply that
transaction or permission. HTTP multipart and React ports remain host-owned.

### Exact proposed owner seam (not implemented here)

The minimal domain addition can remain a single qualified factory, with a
private wrapper borrowing this module's unforgeable staged data and the private
native plan. These are proposed signatures for reconciliation, not callable
symbols at the compiled peer pins:

```rust
pub fn plan_staged_atlas_commands<'u>(
    root: &stock::ValidatedRequest,
    staged: &'u media::staged_upload::StagedAssetPlan,
    native: &impl storage::Contract,
) -> stock::StockResult<StagedAtlasCommandPlan<'u>>;

// Domain-owned; no public constructor or mutable/native-entry access.
pub struct StagedAtlasCommandPlan<'u> {
    staged: &'u media::staged_upload::StagedAssetPlan,
    plan: stock::AtlasCommandPlan,
}
```

For a single root, require its complete raw envelope equal `staged.request().raw()`.
For `atlas.batch.execute`, require exactly one asset-create child with that same
complete envelope and only explicit upload-related evidence-create children.
Keep root/child context, IDs, keys, digests, order, guards, reasons and nullable
approval references unchanged. Map only the native asset payload from the sealed
`staged.payload()`; the stock asset input omits server-owned storage/availability/
preview fields. Map evidence-create through the existing pure mapper, retaining
the submitted payload. Require each evidence child's actual submitted connection
through the asset's `evidenceIds` and/or an `atlas-asset` reference to its asset ID.
There is no required reciprocal link; invent no evidence, reciprocal reference,
target ID or approval. Native shape/transition/guard/final-graph and actual stock
authorization/approval checks remain required. The unqualified existing asset
mapper remains held.

The minimal storage public addition should internally parse and call that
qualified factory, retaining the same actual AT11 principal and borrowed stage:

```rust
// On AtlasStore<C, A, R>; A::Principal is access::Principal for this seam.
pub fn execute_staged_stock_json_with_authorization<B, S>(
    &mut self,
    authorization: &B,
    principal: &access::Principal,
    contracts: &S,
    raw: &serde_json::Value,
    staged: &media::staged_upload::StagedAssetPlan,
) -> storage::Result<storage::StockAtlasCommit>
where
    A: storage::Authorization<Principal = access::Principal>,
    B: storage::StockAuthorization<Principal = access::Principal>,
    S: stock::StockContractPort;
```

Require pointer equality with `staged.original_principal().principal()` and the
same host-prepared witness/graph/fence, not actor/home DTO equality. This extends
the existing `AtlasStore::execute_stock_json_with_authorization` stock transaction;
it must not execute caller-created frozen mutations. The storage owner's private
`StockTransaction`/`CommandExtension` already supplies the required boundary:
`CommandTransaction::execute_entries` starts `BEGIN IMMEDIATE`, performs native
and stock intake authorization before `admit`, validates the one original and
final graph, writes records/manifests/audits/native receipts, calls `persist` for
stock receipts, performs final precommit authorization and commits once.

Within that same transaction, `admit` must check the token's durable consumption
association after authorization; `persist` must uniquely claim it and associate
the verified stage/binding with the actual stock root/group operation and asset
result. Store the token hash, workspace/home, verified actor, admitted request ID,
asset ID, measured file facts, licence/provenance, full binding digest, original
intent digest and actual commit/group linkage. A changed or previously consumed
association cannot create another asset. A lookup outside this transaction or a
filesystem rename after asset commit does not provide single consumption.
AT07 must own the SQL table/constraints/migration and strict recovery validation
of its links; this module supplies no migration or fallback database.

The corresponding narrow helpers belong privately inside AT07 and borrow that
already-open transaction (the `Connection` argument is its transaction coercion):

```rust
fn lookup_upload_use(
    db: &rusqlite::Connection,
    token_hash: &str,
) -> storage::Result<Option<ConsumedUpload>>;

fn admit_upload_use(
    db: &rusqlite::Connection,
    actor: &storage::VerifiedActor,
    request: &stock::ValidatedRequest,
    staged: &media::staged_upload::StagedAssetPlan,
) -> storage::Result<Option<ConsumedUpload>>;

fn consume_upload_use(
    db: &rusqlite::Connection,
    actor: &storage::VerifiedActor,
    request: &stock::ValidatedRequest,
    staged: &media::staged_upload::StagedAssetPlan,
    commit: &storage::StockAtlasCommit,
) -> storage::Result<()>;
```

`admit_upload_use` runs before any stock-receipt early return; matching only the
stock intent digest is insufficient because it excludes root transport and
approval references. Preserve the complete original binding. `ConsumedUpload`
is a proposed storage-owned, private-field checked row, not a deserializable
Principal or a grant. There is no public standalone consume/commit operation.

The existing retained-commit projection and stock recovery paths also replan
through the currently held mapper (`stock_projection.rs::validate_retained` and
`stock_recovery.rs`). They need a pure data-validation counterpart, for example:

```rust
pub fn plan_retained_staged_atlas_commands(
    root: &stock::ValidatedRequest,
    consumed: &storage::ConsumedUpload,
    native: &impl storage::Contract,
) -> stock::StockResult<stock::AtlasCommandPlan>;
```

It must validate the checked persisted stage, full original binding, canonical
asset payload and actual operation/group/record links, then use existing result
correlation. It restores neither a live `StagedAssetPlan` nor original authority.
That checked row and its strict loader/recovery validation must be implemented
together; a new live-only factory cannot by itself make committed stock uploads
valid after reopen. These signatures are proposals for the original owners,
not implemented peers or tested production contracts.

For the current retained-handle lifecycle, media's actual durable `stage.json`
and sealed plan already provide pending registration/lookup. No second public
pending-upload database/API is needed for the minimal consume seam. If the host
requires SQL-backed pending enumeration, reopen, expiry or token reauthorization,
those require exact additional AT07/AT11 contracts; no reconstructed grants or
cleanup policy are supplied here. Consumed-token/retained-receipt reconciliation
and its qualification belong to that owner and remain unexecuted here.

The existing published command is `atlas.asset.create`; new evidence is the
separate existing `atlas.evidence.create`, whose `references` accepts an
`atlas-asset` canonical ID, never an upload token. To commit both atomically use
the existing `atlas.batch.execute` with their unchanged original child envelopes.
Native guards exempt records created in that same batch, then validate the full
final graph; existing external dependencies still need their exact original
revision guards. This is a source-derived proposal, not an executed asset/evidence
commit or released capability. Root owns assembling the actual HTTP request and
prepared context; domain/storage owners must qualify and implement this seam.

Repeated binding conflicts; uncertain publication can leave retained files or
an immutable plan. No retry/consume recovery, expiry or cleanup policy is
invented. Pending stage/plan receipts are excluded from current recovery exports;
no source witness or restart authority is implied. The selected fresh healthy
example proves stage and immutable data binding only, with actual AT11 login,
native schema validation and vault bytes. It executes no asset-create command or
transactional token consumption and supplies no production upload acceptance.
Only this exact fresh upload example is selected for the staged-upload successor:

```sh
cargo test --locked --manifest-path "$AT12_MANIFEST" --lib \
  media::healthy_upload_examples::healthy_native_durable_upload_and_bound_asset_plan_data \
  -- --exact --nocapture --test-threads=1
```

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
storage-owned APIs retained in [AT07's corrected recovery checkpoint](https://github.com/EzraCerpac/HouseAtlas/commit/06eb465f6fe4b99530ef1636b46ea3e01e537106):

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
originals/hierarchy and publishes a new destination. Complete image copying preserves
records/reservations, ordered audits, single/batch receipts, source/cache/
projection/Network relation rows and cache generations/epochs. The native-only
`NativeMediaStorage` recovery adapter requires empty stock journal/cursor tables
and absent queue state; it validates derived native audit lookup rows. Populated
images use the required-peer adapter below. Storage errors
propagate without filtering or legacy fallback; no rejection probe was run.
Cancellation is cooperative between calls; synchronous SQLite/contract work,
filesystem sync and publication cannot be preempted by the callback. No hard
ten-second completion or concurrent-restore qualification is claimed.
Sanitized wire3/presence schemas are available published inputs, but durable
Network sidecars and atomic presence-witness persistence remain unimplemented;
no profile field or claimed capture invents them.

## Populated native recovery and strict reopening

`native_recovery::NativeMediaRecovery` implements the same media recovery port
through AT07's actual `backup_recovery_to_with_peers`,
`validate_recovery_image_with_peers` and detached
`validate_existing_recovery_image_with_peers` APIs. All peers are explicit:

```rust
pub struct RecoveryValidationPeers<'a, S, D, E> {
    pub stock: &'a S,       // actual StockContractPort
    pub queues: &'a [QueueConfig], // complete trusted registry
    pub discovery: &'a D,  // actual QueueDiscovery
    pub evidence: &'a E,   // actual QueueRecoveryEvidence
}
// C: storage::Contract, A: storage::Authorization, R: storage::Runtime
// S: StockContractPort, D: QueueDiscovery, E: QueueRecoveryEvidence
let live = NativeMediaRecovery::new(&store, live_peers);
let detached = NativeMediaRecovery::<C, A, R, S, D, E>::validator(
    &contract, detached_peers,
);
// Both modes expose validate_image(path, budget) -> MediaResult<RecoveryImage>.
// Only the live-store mode can backup_image(path, budget).
```

The live mode borrows the existing store; detached verification/restoration
opens no new source store and uses no CREATE or migration. The frame borrows
its owners and requires no extra Send/Sync/static bounds or permissive defaults.
Peer callbacks execute under storage's store lock/read transaction and must be
bounded, avoid storage reentry and avoid an opposing access/vault lock order.
The media budget remains cooperative through the actual storage callback.

The host provides the complete registry, including empty registered queues,
and owner-qualified evidence codecs. `QueueRecoveryEvidence::validate_attempt`
receives the actual original request, leased job, optional prepared bytes and
journal, complete step/liability records and outcome-local cuts. The owner must
qualify those bytes, their correlation, local termination and reconciliation;
unavailable codecs cannot be treated as successful validation. Discovery must
validate the registration and exact original enqueue derivation. Media supplies
no surrogate validators, configuration, witness authority or dispatch adapters.

`backup_image` and `validate_image` preserve AT07's original `RecoveryImage`,
including raw ordered asset records and metadata. Projection happens only at
the media port boundary. The host must retain that raw return when calling
AT07's `open_existing_recovery_image_with_peers(path, contract, authority,
runtime, options, &image, &peers, check)`. The media manifest/projected assets
cannot reconstruct it. The strict opener is host-owned and uses fresh actual
authority/runtime, forbids bootstrap, and does not create or migrate a missing
database. Full-image digest and private exclusive path binding remain required;
the image identity alone does not bind every database byte. Successful validation
or reopening grants no recovered queue resume, dispatch or reconciliation
authority. The host's existing `NativeStockContract::new()` supplies the stock
port; production discovery/evidence implementations and the registry must come
from their actual owners. Separate access/config restore and future witness lineage remain
outside this component.

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
The current compiled peer supports native contract 1.0.0/schema 4 and required
`databaseLineage: houseatlas-rust-storage/1`. Populated stock/queue recovery
requires the explicit peer frame above.
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
and the named ordinary healthy examples below on a disposable private
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

The accepted recovery packet at `8eca841` selected exactly three positive library
examples. This successor adds the separate upload example above and runs only its
exact filter; the three earlier examples remain unrun in this upload continuation.
The two retained compatibility/content examples remain:
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
closed-image validation exercise the compiled native schema's capture/verify/restore with that
graph, a missing original and retained text/PDF tombstones. The restored closed
database is byte-identical before normal opening enables WAL, preserving audit
and receipt bodies without replay. Retained originals, scoped graph reads and
ordered history are compared after native reopen; restored PNG delivery uses
actual native storage/access. The stock journals are empty and queue state absent. No stock operation
or rejection control runs. Both original and restored stores use actual Rust
`NativeSemantics::native()`; no JS semantic or database adapter executes in
this native example. Root dependency/type/CI reconciliation and trusted AT52
host composition remain required. Earlier JS database recovery evidence and
the separate retained JS SQLite example continue to qualify only explicit
legacy compatibility. The prior native composition's pure JS semantic helper
and logs remain preserved; this successor supplies no runtime semantic fallback.

The selected external `healthy-populated-media-recovery` example adapts AT07's
published ordinary `queue-check.rs::run(true)` fixture. It uses the actual
native stock schema/semantic/domain/job/storage/media code, new stock
create/replace/ordered two-child batch, persisted history cursors/search and one
completed synthetic native queue dispatch. It invokes media capture, live and
detached verify, detached restore and raw-image validation, then the actual
strict existing opener with required peers and fresh synthetic authority/runtime.
Captured/restored closed database bytes match; all rows of all 28 tables match
across closed source, capture and restore before strict reopening. Stock graph,
history/page/search and the succeeded queue receipt survive opening. Later
history reads can add cursors; no post-read full-table equality is claimed.
The original empty-held read is excluded from this adapted example.

Its stock validator delegates to AT51's actual offline `StockValidation`, and
all four resource-map files have exact published Git-blob and map SHA-256 checks.
Recovery frames use the actual domain `NativeStockContract` as their stock port.
The discovery and evidence implementations validate one exact healthy fixture
and supply no production codec qualification. Identity/time/authority, the
in-memory prepared transport and original witness are synthetic. The witness is
supplied again from this process and is not reconstructed from the image. This
populated case has no physical originals; the separate media library examples
cover those. Unresolved liabilities, production evidence codecs, future witness
lineage and recovered queue dispatch remain unqualified. No provider or stopped
control executes. Harness source, adaptation, lock, peer manifests and logs remain
outside Git. Its selected command is:

```sh
cargo run --locked --manifest-path "$AT12_MANIFEST" \
  --example healthy-populated-media-recovery -- "$FRESH_PRIVATE_EVIDENCE_DIRECTORY"
```

A preliminary example invoked one same-payload synthetic receipt replay through
the published `AtlasStore.execute` API for an already committed tombstone, before
the history document's broader replay deferral was reconciled. That execution
remains in the historical log and is not erased by removing its invocation from
the retained check. The final run compares receipt bytes only; the preliminary
run supplies no replay qualification. Earlier logs remain unchanged; these
healthy checks do not supply Rust integration/CI acceptance.
