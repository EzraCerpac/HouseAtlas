# Authenticated media and Atlas originals

Media 0.1.1 consumes contracts 1.0.0 / record schema 1, storage 0.1.2 /
database schema 3 and access 0.1.3. Node 26.10.0 and npm 11.19.1 are pinned.
It adds no dependency, listener, account, live source or deployment.

## Service interface


Exports: `createMediaService`, `AssetVault`, `captureRecovery`, `verifyRecovery`,
`restoreRecovery`, `MediaError`, `MAX_BYTES` and `MEDIA_VERSION`.

Create a vault with a trusted private server `root`, then an `AtlasStore` with
`verifyAvailableAsset: vault.verifyAvailableAsset`. Storage authorization must
route its capabilities and exact source/partition selectors to the actual
branded access boundary, as documented by AT-07/11. The package does not
reconstruct a principal, manufacture source permission or bootstrap users.

Create the access boundary with
`resolveMedia: (principal, descriptor) => media.resolveMetadata(principal, descriptor)`
through a late-bound server closure, then create the media service:

```js
media = createMediaService({
  boundary, store, vault,
  providers: boundHomeBoxProviders,
  sourceEpoch: readCurrentAuthorizedStorageEpoch,
  quarantineSource: persistSourceQuarantine,
});
const response = await media.deliver(request, {
  scope: {workspaceId, homeId},
  descriptor: {kind: 'atlas-asset', assetId},
  mode: 'download', // preview is the default
});
```

`deliver` takes a real Request and returns a Response. Selectors must be exactly
the frozen scope and one of the frozen `atlas-asset`/`homebox-attachment`
reference forms. It supports GET/HEAD, with ordinary AT-11 same-origin/session
requirements. Extra paths, URLs, URL query strings, client metadata, external
links and arbitrary asset storage keys cannot select bytes. HEAD performs the
same actual-byte verification and has no body. There is no Range/304/cache API.
All private successes and sanitized errors use private/no-store responses;
downloads have a fixed safe attachment filename, nosniff, same-origin resource
policy and sandbox CSP. No upstream URL, error text, title, secret or path is
copied into browser headers/errors. Access errors use the accepted sanitizer.

Every awaited operation precedes final `revalidateMedia`, an authoritative
metadata/token lookup, original source-grant revalidation and principal
revalidation. A source revoke/reenable invalidates the original grant. Asset
lifecycle/revision/content metadata and source projection/cache/epoch changes
reject in-flight bytes. A synchronous final check is the delivery authorization
point; bytes already delivered to a browser cannot be recalled. This does not
claim continuous authorization of an existing browser response or distributed
atomic rollback across access/storage databases.

### HomeBox bound-provider contract

Each trusted provider has `{registration, origin, readAttachment}`. Registration
is the exact existing frozen HomeBox partition; origin is an exact HTTPS origin
without path/query/credentials. One provider must match a descriptor's full
workspace/home/instance/collection partition. The callback receives only:

```js
{
  descriptor, sourceUpdatedAt,
  method: 'GET', headers: {'X-Tenant': exactCollectionId},
  redirect: 'error', maxBytes: 10485760, signal
}
```

It must implement a bound, allowlisted transport for its separately qualified
provider version, retaining credentials server-side. No client URL or frozen
`proxyRef` is fetched. A successful receipt is exactly identified by these
required fields (additional nonauthority fields are ignored):

```js
{
  status: 200, redirected: false, origin: registeredOrigin,
  descriptor: exactDescriptor, sourceUpdatedAt: exactExpectedRevision,
  contentType: exactMetadataType, contentLength: exactMetadataSize, // length optional
  body: Uint8ArrayOrByteStream
}
```

`body` may be Uint8Array, byte iterable/async iterable or ReadableStream.
Actual bytes and declared metadata must match, irrespective of Content-Length.
Zero redirects are accepted, and receipt URL/location fields are rejected.
Wrong origin/entity/attachment/revision and 401/403 require synchronous durable
quarantine before denial. `quarantineSource(principal, partition, code)` must
persist AT-11 disabled state and AT-07 failure state using separately authorized
internal callers; it cannot return a Promise. This callback is never a public
command. The tests compose both actual stores. Cross-store rollback of this
administrative operation is not claimed; AT-13 must retain failure-safe ordering.
404/410 returns unavailable bytes while preserving metadata and identities.
Timeouts, malformed bytes and unrelated errors do not freshen or delete cache.

`sourceEpoch(principal, exactPartition)` is synchronous and must authorize the
current branded principal/partition, then return AT-07's durable cache epoch
through a separately authorized internal publication read. The service checks
epochs around its scoped snapshot lookup and again at delivery. Never derive
epochs from timestamps, rebase a finished fetch, expose the internal caller or
let a successful media read enable a quarantined source. Cached metadata can
remain stale/error; each HomeBox byte request still contacts its owning provider.
There is no HomeBox media mirror, editable archive or media-cache freshness write.
An archived item may retain authorized references; archival does not authorize
access or imply deletion. External links remain unarchived external navigation.

AT-08 deliberately clears `proxyRef` and has no qualified media byte route.
This package defines an explicit service interface and synthetic receipt dialect,
not a fabricated native HomeBox route. AT-13/21 must implement and qualify the
actual version/routes/source access before any live use. Provider writes remain
separate AT-37 work; no unsupported live semantics are silently assumed.

## Content and resource policy

10 MiB actual input/output ceiling; 65,536 input chunks; at most four simultaneous
deliveries; 10 second total transport/read/render/revalidation deadline. Trusted
configuration may lower timeout/concurrency, never raise these limits. Cancelled
and timed-out reads signal providers and close cooperative byte iterators.
Late completions cannot publish. A noncooperating trusted provider may continue
its own work; the integrated server still needs connection/request limits.

The built-in raster renderer supports static noninterlaced 8-bit RGB/RGBA PNG
only. It validates signature, chunk lengths/order/CRC, mandatory chunks,
critical types, pixel count (25 million), exact inflated scanline length and all
five PNG filters. It re-encodes only IHDR/IDAT/IEND with fresh CRCs and zero-filter
scanlines, stripping ancillary metadata. APNG, transparency chunks, indexed/
grayscale/interlaced/16-bit variants, JPEG/WebP/GIF, SVG, HTML and other types are
explicitly unavailable pending a reviewed renderer. This conservative subset is
an explicit integration limitation; those references must remain visible with
honest unsupported-preview/download state and native navigation where available.
The 25 MP bound can require roughly 200 MiB of decoded working buffers. Synchronous
native compression/decompression cannot be forcibly interrupted mid-call; checks
before/after reject elapsed work, and target memory/CPU/browser qualification is
still required. No general image-library or full PNG implementation is claimed.

PNG chunk names and PDF header/EOF markers are validated without masking high
bits. PDF EOF trailing whitespace is limited to ASCII whitespace. PDF with a
valid header/EOF and valid UTF-8 text without NUL are attachment
downloads only. PDF structure is not executed, rendered or certified safe to
open in another program. Active content never passes through an inline preview.
Previews use the safe PNG derivative; original downloads preserve exact bytes.
Oversized/unavailable/unsupported HomeBox media remains a reference, not truncated
content or evidence of an upstream deletion.

## Atlas ownership and staging

`await vault.prepareOriginal({scope, purpose, contentType, body, signal})` is a
trusted internal staging seam for `evidence-original` or `geometry-original`.
It returns immutable content identity fields for a frozen asset payload. The
caller must add reviewed sourceLicense/evidenceIds and execute the ordinary
authorized storage mutation under the AT-11 mutation fence. There is no upload
route or new agent mutation vocabulary. Callers must not label HomeBox originals
as Atlas-owned originals. Geometry import does not follow from this seam.

Vault keys are derived from exact scope plus SHA-256. No caller path/key is opened;
keys must match the record's scope/digest. Scope partitions prevent cross-home
deduplication access. Newly installed files are mode 0400 inside mode 0700
directories; existing nonprivate directories and symlinks are rejected without
changing their permissions. Original files are fsynced and installed without
overwriting an existing digest; the directory is synced before availability can
commit. The synchronous verifier reopens/caps/hashes actual original bytes,
validates content and returns exact `{sha256,byteSize}` to AT-07. Client digest
claims cannot commit availability.

The vault pins the canonical root, blobs and staging directory device/inode
identities at construction, including existing scope directories. Each operation
rechecks its private directory hierarchy; newly used scopes stay pinned for that
vault instance. Publication rechecks the scope and its own staging transaction
after staged-byte work. Retained reads and the available-asset verifier reject
replaced ancestors even when the replacement contains matching original bytes.
Root, blobs, staging, scope and transaction symlink/private-directory replacement
cases are covered with synthetic fixtures. A rejected substitution cannot make
its outside bytes available through the storage verifier.

The integrator must exclusively own and serialize changes to these server
directories. Mode 0700 prevents access by other users, but does not isolate
processes running as the same owner. Node pathname operations and final-component
`O_NOFOLLOW` checks are not descriptor-relative atomic protection against a
hostile same-UID process swapping ancestors between validation and a syscall.
The identity checks detect deterministic replacement, including the after-stage
fault seam, under this directory-owner assumption. Reopen a vault deliberately
only after resolving a directory replacement offline; no live repinning occurs.

Failures remove only their own unlinked temporary staging when its root/staging/
transaction identities still match. Replaced or unreachable staging is retained
for offline diagnosis rather than followed or recursively removed. An installed orphan
from a lost/failed transaction remains retained and can be reused by a retry;
it cannot be delivered without an active authorized available manifest.
`cleanupStagingAfterDrain()` is an offline restart seam requiring the integrator
to drain **all** vault writers first. It rechecks the pinned hierarchy and removes
only the staging contents, preserving the staging directory identity;
there is no installed-original purge, quota GC or deletion API. Tombstones deny
normal byte delivery but retain original bytes/IDs/manifests/audit/receipts.
Restore can reuse the same verified immutable bytes. Reference archival does not
change byte ownership, and original availability remains explicit.

## Coherent owned recovery

These are offline trusted administrative interfaces, never HTTP/MCP/WebMCP tools:

* `await captureRecovery({databasePath, vault, destination, signal})`
* `verifyRecovery({bundle})`
* `restoreRecovery({bundle, destination})`

Paths come from trusted server recovery configuration. Destination must be absent
under an existing private parent directory. Capture uses SQLite's backup API,
normalizes the copied DB to standalone DELETE journal mode, and validates schema
3, migration checksums, the actual stored `atlas_metadata.contractVersion` against
frozen contract 1.0.0, integrity/foreign keys, the frozen graph and exact
record/asset-manifest agreement. Its database SHA-256 pins records, bindings,
cache epochs, history, tombstones and payload-bound receipts together.
The captured DB's referenced immutable originals are copied and independently
hashed, including retained tombstoned originals. Later database commits cannot
remove these bytes; capture can therefore describe one coherent database state.
It does not claim that hashing a hot raw SQLite file constitutes a backup.

Versioned manifest `houseatlas-owned-recovery/1` binds each exact asset ID/scope/
revision/lifecycle/payload to a fixed relative blob member or explicit absence.
Missing legacy metadata remains missing; bytes are not fabricated. Nonmissing
originals must exist and match. Limits are 64 MiB DB, 10,000 asset records,
256 MiB aggregate DB/original bytes and 16 MiB manifest. Unknown members, path
selectors, hash mismatches, manifest disagreements and future schemas fail.
Missing or incompatible stored contract metadata fails capture, verification and
restore before destination publication, even when a forged bundle recomputes
its database digest and claims the running contract version in its manifest.
Manifests provide integrity checks, not signed authenticity or encryption.
An operator must protect recovery storage and apply the later approved retention
policy. Capture has no provider activity and excludes HomeBox originals, access
DB/sessions, secrets/configuration and actual Network source state.

Restore verifies everything into a private temporary sibling and publishes one
new directory containing `atlas.sqlite` and `media/`. It never overwrites existing
state or mutates an upstream. Interrupted captures/restores do not publish a
complete destination, and retries use a new absent destination. Private partial
sibling directories can remain after process death; cleanup requires a drained
recovery owner. Target power-loss/rename/permission behavior is unqualified.
AT-15 must compose complete config/access recovery, reconcile later revocations,
invalidate sessions before traffic and perform its independent restore/rollback
drill. This owned DB/blob bundle is not a household or multi-store recovery claim.


## Publication verification boundary

Use the explicit commands in the root README: verify:publication,
build:ordinary, the history check syntax command, check:http:ordinary and
test:ordinary. Other module test/control aliases and preview/demo harnesses are
outside this lane. Historical owner evidence is external and is not a CI result
for this tree. Canonical HTTP, transaction-local source authority and browser
DTO corrections are integrated. New explicit source-presence admission remains
blocked and unexercised; URL credential-key filtering remains heuristic.
Stopped guard reversal, mutation/omission controls, adversarial, denial, failure
injection and concurrency checks remain unrun. Ordinary healthy mutations are
not those control categories. Actual provider/native routes, full security,
target/HTTPS, recovery-fault, retention, actual-user/pilot and production
qualifications remain open.
