# Atlas storage

Storage `0.1.3` uses contract `1.0.0` / record schema 1 and SQLite schema 3.
It adds an immutable transaction-derived authorization context to mutation
callbacks and retains empty-source denial metadata. See MUTATION-CONTEXT.md
for the phase/field contract and replay limitations. This additive seam changes
no SQL migration; provisional admission profiles and future atomic witness
schemas are absent. Node 26.10.0 supplies `node:sqlite`; no new dependency,
network call, service or provider write is introduced.

## Server integration

Create one store per independently owned database path:

```js
const store = new AtlasStore({
  path: serverConfiguredDatabasePath,
  authorize: verifyStorageCapability,
  verifyAvailableAsset: verifyImmutableStagedAsset,
});
```

`authorize(opaquePrincipal, {scope, capability, source?, sourcePartition?, targets?})` must synchronously
verify the current session, origin/policy as applicable, home membership and
capability, then return `{actorId, workspaceId, homeId}`. There is no default
allow decision, role toggle or request-body actor. The callback must throw a
sanitized `ContractError` on denial. In particular, viewer, expired or revoked
principals must be rejected for `mutate`, including receipt replay. Capabilities
are `read`, `read-history`, `read-cache`, `read-asset-manifest`, `mutate`,
`publish-cache`, and `configure-source`. Cache publication and source registration
are trusted server operations; they must not be exposed as public edit commands.
access boundary owns real authorization; this package's test principal is synthetic.
Command authorization runs before receipt replay and again immediately before
commit, retaining the same verified actor. Trusted cache publication, failure
publication and source configuration also recheck the identical actor, scope and
capability immediately before commit; denial rolls back their data and epoch.
The access boundary wrapper should use its
instance-branded principal with `boundary.assertMutation` for `mutate` and
`boundary.revalidate` for reads, then return the verified claim fields. For
`read-cache`, the store first passes `request.sourcePartition` with exactly
`{workspaceId,homeId,sourceInstanceId,collectionId}` for **every configured
partition**, including complete empty generations and partitions without cache
rows. Invoke the access boundary `boundary.authorizeSourcePartition(principal, selectors)`
to authorize availability metadata from the current enabled/versioned server
registry. These selectors have no external ID and grant no entity permission.
Then `request.source` is the exact frozen `sourceRef`: invoke
`boundary.authorizeSource(principal, request.source)` for every projection and
the Network relation/endpoints. Source denial withholds that partition and
reports `access-revoked` in the returned view; expired principals still fail the
whole request. A denied configured partition with no persisted cache row gets a
response-only frozen `cacheStatus`: `status:'access-revoked'`, all success/attempt/
generation/error fields null, and `consistency:'non-transactional-offset-pages'`.
This distinguishes first-run denial from permitted empty inventory without
inventing fetch times or writing a cache row, generation, epoch or permission.
Existing cache metadata is retained with only its response status overridden.
This view does not change persisted access authority. It must
not rebuild a branded principal from JSON. Scoped record/history/asset reads and
commands provide target references; snapshot reads require whole-home graph
permission. Revocation in a separate access database is rechecked, but this
does not create cross-database transactional revocation guarantees.

Scopes have exactly `{workspaceId, homeId}`. Record targets have exactly
`{recordType, recordId}`. Methods return cloned frozen-contract objects:

| Method | Result / behavior |
| --- | --- |
| `execute(principal, scope, target, mutation)` | Frozen `mutationResult` |
| `executeBatch(principal, scope, batchMutation)` | Frozen `batchResult` |
| `readRecord(principal, scope, target)` | Frozen owned record including retained tombstones |
| `readSnapshot(principal, scope)` | Frozen scoped synthetic snapshot, source capabilities applied |
| `history(principal, scope, target)` | Ordered frozen audit entries for this target |
| `readAssetManifest(principal, scope, assetTarget)` | Scoped immutable asset identity/content plus current availability metadata |
| `registerSource(principal, sourceRegistration)` | Immutable registered partition, requiring `configure-source` |
| `readCacheForPublication(principal, scope, sourcePartition)` | Atomic trusted pre-fetch read of `{cache,homeboxEntities,networkRelations,cacheEpoch}` |
| `replaceCacheGeneration(principal, scope, generation)` | Frozen committed cache metadata |
| `recordCacheFailure(principal, scope, sourceKey, {code,status?})` | Frozen failure status with retained successful generation |
| `close()` | Close only this connection |

`sourceKey` for failure publication includes workspace/home/sourceInstanceId/
collectionId. `generation` is an internal publication envelope with `cache`,
`homeboxEntities`, `networkRelations`, `complete:true`, and required
`expectedGenerationId` (prior generation UUID or null) and `expectedCacheEpoch`
(the nonnegative durable partition epoch captured before fetching). This is a publication
seam, not another Atlas mutation language. Cache IDs cannot be reused, including
across failures/reopen/migration. Publishing requires the prior generation to
match, cache epoch to match, and successful time not to move backward. Every
failure, including repeated failures with identical or backward timestamps,
increments the partition epoch. Successful publication also increments it.
These updates are atomic with cache/projection/generation reservations; rejected
writes advance none. A fetch started before a later failure cannot publish its
completion even when generation IDs are unchanged. Clock times describe source
events; they do not establish authorization or ordering across transactions.
Complete empty generations
remove cached projections only. They never delete identities, bindings or source
reservations, and do not prove upstream deletion.

HomeBox adapter glue: call `readCacheForPublication` before starting the fetch, retain its
epoch separately, and publish only when `ok === true`,
`completeness === 'complete-generation'`, and `replaceCache === true`:

```js
const prior = store.readCacheForPublication(principal, scope, sourcePartition);
const result = await adapter.fetchGeneration({
  previous: prior.cache === null ? null : {
    cache: prior.cache, homeboxEntities: prior.homeboxEntities,
  },
});
// This call is reached only after the complete authorized/nonquarantined success checks.
store.replaceCacheGeneration(principal, scope, {
  cache: result.cache, homeboxEntities: result.homeboxEntities,
  networkRelations: [], complete: true,
  expectedGenerationId: prior.cache?.generationId ?? null,
  expectedCacheEpoch: prior.cacheEpoch,
});
```

Map full-generation failures to `recordCacheFailure` using the sanitized code;
the store derives attempt/error time from its server clock. Never copy raw
transport errors. Filtered `fetchView` results (`completeness:'filtered-view'`,
`replaceCache:false`, `cache:null`) do not replace or freshen the generation.
An auth/wrong-scope view failure must still quarantine the source through the
failure seam. Auth/wrong-scope quarantine is sticky through later timeouts or
transport failures. A successful HomeBox adapter result is a staged revalidation candidate;
its fresh metadata never reenables an access boundary source. Only complete publication
under currently qualified server source permission may clear storage quarantine;
source reenable/grant reacquisition remains the access boundary/admin boundary. The store
retains quarantined rows but denies returning their HomeBox/Network projections.
Network source publication uses the same internal generation envelope with its
frozen `networkRelations`, preserving their source qualifiers. Network adapter owns its
actual fetch/result convention.
This seam durably stores the frozen Network relation projection and cache
metadata. Network adapter's separate inventory/observation generation extension is not
represented by the frozen snapshot and is not silently serialized here.
Complete durable Network adapter facet sidecars need the owner's reviewed versioned
payload/publication convention at core; relations alone cannot reconstruct
that inventory or observations. Network integration is not accepted by this
package's synthetic relation-cache test.

`readCacheForPublication` is a trusted internal `publish-cache` capability and
may read retained quarantined rows for server reconciliation. It is never a
browser/model/end-user route. Its four-field sourcePartition selectors must
match a registered source. The read captures frozen prior state and epoch in
one SQLite read transaction. Never read a new epoch after fetching, rebase an
old result, or retry that result at a newer epoch. A conflict requires current
authorization, a new atomic pre-fetch read and a new complete fetch. access boundary source
denial remains independent; the returned epoch cannot enable or authorize it.

The HTTP/domain service must reject duplicate JSON keys before passing parsed
objects, enforce request limits, and supply verified principals. It must derive
expected cache generation from the generation read before fetching. A fresh
database may use null only when there is no successful prior generation.
The core integrator owns shared routes and the explicit root ordinary lane.

## Transactions and recovery

Every write takes `BEGIN IMMEDIATE`, reads one original full graph and checks
pre-transaction CAS/reference guards with the frozen `assertTransition` and
`assertGuards`. It constructs every result against its original preimage,
validates the final graph with `validateSnapshot`, then calls
`assertFinalMutation` for **each command** before any durable write. Records,
permanent qualified source reservations, audits, individual receipts, batch
receipts and owned asset manifest availability commit together. Rejected batches
and write failures commit none. SQLite serializes writers; revisions are per
record, with no global optimistic revision that conflicts unrelated edits.

Receipts bind actor/workspace/home/UUID plus RFC 8785 SHA-256 of the complete
target and command; batch children also bind full ordered batch/reason/hash.
Exact retries replay original results (possibly an older revision) without new
audit; changed/partial/reordered batches and split-out batch children conflict.
No receipt expiry or deletion API is provided. Audit and receipt tables prohibit
update/delete. Tombstones retain record IDs, payloads and qualified binding
reservations permanently. Multiple bindings remain separate rows for one stable
Atlas identity. Append-only evidence/geometry/journals use the frozen guards.

Available assets require `verifyAvailableAsset(record)` to return the verified
immutable staged bytes' `{sha256,byteSize}` synchronously. A missing verifier,
mismatch or thrown error rolls back all record/audit/receipt/manifest writes.
The callback must use trusted server media storage rather than echo client
claims. media owns staged bytes, safe media delivery, owned-file cleanup and
coherent DB/media recovery; the storage package persists the manifest, never
uploads or opens an arbitrary request path. The test verifier is synthetic.

Database schema versions 1, 2 and 3 are storage-owned, distinct from record schema
1. Migrations run in one transaction with a checksum ledger and user_version;
version 2 adds durable receipts, asset manifests/backfill and generation
reservations. Version 3 adds per-partition cache epochs, initially zero for
existing configured partitions. Versions 1 and 2 retain their exact reviewed SQL
checksums; migrations from either predecessor preserve receipts, records and
cache state. Unknown databases (including view-only state or user objects whose
names merely resemble SQLite's literal `sqlite_` prefix), altered migration
history, incompatible contract
versions and future schemas fail closed. Compatible code rollback preserves the
schema; incompatible downgrade from schema 3 to schema 1/2 is rejected. SQLite runs WAL with
synchronous FULL and a bounded busy timeout. Crash/failure/concurrency controls
are unrun in the ordinary lane. No target filesystem, backup or power-loss
qualification is transferred from historical evidence.

## Ordinary scope

The root ordinary lane runs this package's inspected build body: JavaScript and
declaration syntax, exports and healthy in-memory SQLite schema-3 creation.
No tsc type-resolution pass is claimed. Its explicit core Request group covers
healthy transaction-local claims and leaves source-backed bindings `unresolved`.
The retained storage test alias and other controls are not ordinary CI commands.
New explicit source-presence admission remains blocked pending a separate atomic
witness extension. Guard reversal, mutation/omission controls, adversarial,
denial, failure injection, replay, concurrency and crash checks remain stopped.
Provider, target, actual media, power-loss and full security checks remain open.

`allowSyntheticBootstrap:true` permits offline seeding only for empty disposable
databases; the default disables it. There is no bootstrap endpoint or fabricated
audit prehistory. Frozen snapshots require `synthetic:true`; this package does
not relax that guard or claim production readiness.
