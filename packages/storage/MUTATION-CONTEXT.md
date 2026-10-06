# Storage 0.1.3 / schema-3 mutation authorization context

This additive server seam supplies the actual active Atlas transaction as deeply
frozen detached data. It exposes no connection, nested read or raw SQL seam.
Existing callbacks may ignore the additive field; doing so confers no source
authority or presence qualification. The current core consumes it for source
closure and HTTP precondition classification. SQL/migrations are unchanged.

## Exact callback shape

`authorize(principal, {scope,capability,source?,sourcePartition?,targets?,mutation?})`
remains synchronous and returns the currently verified `{actorId,workspaceId,
homeId}`. `mutation` appears only for execute/executeBatch's mutate callbacks.
Its property is nonwritable/nonconfigurable. The value is deeply frozen detached
data; no live graph, store, connection or callback is exposed. The principal is
still supplied by access boundary; neither this context nor contextId creates a brand/grant.
The full declaration is [src/index.d.mts](src/index.d.mts).

```ts
{
  format: 'atlas-mutation-authorization-context/1', schemaVersion: 1,
  contextId: string, phase: Phase, scope: {workspaceId,homeId},
  entries: Array<{target:{recordType,recordId},command:FrozenMutation}>,
  targets: Array<{recordType,recordId}>, batch: FrozenBatchMutation|null,
  original: FrozenSnapshot, candidate: FrozenSnapshot|null,
  cachePartitions: Array<{
    workspaceId:string,homeId:string,sourceInstanceId:string,
    collectionId:string,cacheEpoch:number
  }>,
  closure: {
    recordRefs: Array<{recordType,recordId}>,
    missingRecordRefs: Array<{recordType,recordId}>,
    sourceRefs: Array<FrozenSourceRef>,
    sourcePartitions: Array<{workspaceId,homeId,sourceInstanceId,collectionId}>
  },
  preconditions: Preconditions|null,
  replay: {results:Array<FrozenMutationResult>}|null
}
```

contextId is a fresh correlation UUID for one invocation, not a durable operation
identity or authorization token. entries/targets and guards keep submitted order.
Each callback gets a detached immutable copy. original always means the actual
transaction prestate of this invocation, including a retry's current prestate.
Every sources/records/homeboxEntities/caches/networkRelations row in original
and candidate is filtered to the exact workspace/home. These are unredacted
private server facts, including asset storage keys and retained quarantined data;
never serialize them to a browser/model or treat their existence as permission.

cachePartitions contains every registered partition in this exact home, including
partitions without a cache row. cacheEpoch is the persisted nonnegative epoch read
once from the existing schema3 cache_epochs table after BEGIN IMMEDIATE, alongside
the original snapshot and before intake. It is not inferred from time/status or
a generation UUID. Entries are canonical sorted detached data. The same captured
epochs and original generation pointers are supplied in every phase, including
candidate/precommit and replay; there is no reread/rebase. The Atlas writer
transaction serializes other Atlas cache publications until this transaction
ends. This does not fence provider writes or another access database.

The current core uses this transaction-local seam for complete qualified source
authority. New explicit source-present admissions remain blocked before writes:
frozen schema-1 payload/audit fields lack a typed durable generation/epoch witness.
The separate atomic witness successor is absent. These cache/projection facts
grant no source permission and cannot themselves qualify provider presence.
The future policy requires exact membership in the latest complete successfully
published authorized local generation and freshness under the existing cache-age
policy, without a provider fetch or nested storage read. See the core correction
document for the held capability and exact triggers.

## Phase ordering

| Phase | Timing and facts |
| --- | --- |
| `intake` | Inside BEGIN IMMEDIATE, before any durable receipt lookup. original plus submitted entries and guarded/referenced closure; candidate/preconditions/replay null. Current actor/home/editor/disclosure permission must pass. No fresh CAS/lifecycle/provider-presence check here. |
| `validate` | Only after receipt lookup finds no exact completion. Authoritative original target/guard facts before frozen helpers; candidate/replay null. Never runs for exact replay. |
| `candidate` | After all assertTransition/assertGuards checks, full validateSnapshot and assertFinalMutation for each raw command; before writing records/audits/receipts. Actual complete validated candidate plus original/preconditions. |
| `precommit` | After record/audit/raw/batch receipt writes, immediately before COMMIT. Identical original/validated candidate/entries; no reread or rebase. Current actor must still match. |
| `replay` | After exact durable hash match and historical result correlation. Current original graph plus exact retained results marked replayed:true. candidate/preconditions null. Current output disclosure, never historical CAS. |
| `replay-precommit` | Same retained results/current original immediately before returning/committing replay. No new writes or guard reapplication. |

The core captures actual branded access entity/partition grants at intake,
revalidates existing handles during later phases, and authorizes any additional
owner-derived refs before writes or replay output. At precommit it may only
revalidate captured handles, never reacquire/rebase to bless a version change.
Every source reference used by a new claim requires current qualified authority;
no general historical-only exception is supplied here. The core wraps the synchronous
store call in its existing withMutationAuthorization fence, with final current
principal/source checks. This is ordering across separate stores, not distributed
atomic rollback. No callback may invoke storage methods, access-administration
writes, provider HTTP or asynchronous work. A local transaction guard prevents
nested storage calls and closing the connection during an active transaction.

## Exact precondition facts

For validate/candidate/precommit only:

```ts
{
  createdInBatch: Array<{recordType,recordId}>,
  commands: Array<{
    target: {recordType,recordId},
    operation: 'create'|'replace'|'tombstone'|'restore',
    expectedRevision: number|null,
    current: {revision:number,lifecycle:'active'|'tombstoned'}|null,
    requiredGuards: Array<{recordType,recordId}>,
    guards: Array<{
      record:{recordType,recordId}, expectedRevision:number,
      currentRevision:number|null
    }>
  }>
}
```

requiredGuards mirrors the exact frozen helper's original and submitted payload
references, including accepted mapping binding/remap-chain reads. It excludes
the command's own target and same-batch-created refs. Additional submitted guards
remain in guards and the unchanged helper still checks them. Required refs are
deduplicated and sorted by lexical canonical JSON; command/guard order remains
submitted order. current/currentRevision comes only from actual original scoped
rows. Null means unavailable in that home and grants no foreign revision.

The core consumes these facts directly to classify a missing required guard as428,
a permitted stale target/guard revision as412, and an unavailable scoped target/
guard as404 without a revision. Lifecycle, revision exhaustion and permanent
identity conflicts retain frozen helper409 semantics. Classification must not
precede exact replay lookup or skip permission for revision disclosure. Storage
does not set HTTP status and these facts do not replace its unchanged helpers.

## Complete referenced/source closure

Closure starts with every ordered target and supplied guard, and follows both
original and submitted payloads, final candidate and retained replay results.
Owned references include evidence/supersession, Atlas assets, identities,
geometry original/previous assets/versions, endpoints and journals. Accepted
geometry also follows its exact retained compatible binding and complete
outgoing reconciliation chain. Reverse dependencies follow affected mutation
targets, including later binding destinations used by retained geometry; guards
do not turn unrelated records into affected targets. Missing referenced rows are
explicit and never synthesized. Same-batch-created refs can appear as submitted
payload shells before candidate validation.

Exact sourceRefs cover binding.source wrapped in record scope,
evidence.provenance.source, HomeBox attachment entities and geometry.homeboxEntity
references through the whole owned closure. Exact induced four-field partitions
need no fabricated externalId and work without any projection row. Graph cache
metadata preserves actual status and generationId. Network relations alone do
not prove device/group presence: the core must use its own separately qualified,
synchronous sidecar for that exact generation pointer. A snapshot/source row,
caller sourceState:'present', cached projection or contextId never grants access,
freshness, enablement or provider fact qualification.

The storage-owned extractor supplies the closure; access checks supplied refs
but cannot discover an omission. Scoped full graphs and exhaustive closure are
returned without truncation. No new graph-size limit or large-home performance
qualification is claimed by this correction; the existing batch limit is100.

## Replay disclosure and limits

Historical stored results are correlated to ordered incoming targets and command
mutationId/operation/expected previous revision/reason/payload before disclosure.
Their self-valid audit, scope and verified actor must match. These checks compare
historical facts, not today's CAS. Raw receipts retain the committed result/audit
plus beforeDigest/previousRevision, not historical before-payload bodies. Replay
therefore covers only the actual retained results, incoming hash-bound command
refs/guards and current scoped dependency graph. No old before-payload or old
source grant is reconstructed. Exact current source/output permission remains
required even for retained historical results. Any broader historical-only claim
policy remains a contract-owner decision.

## Ordinary verification and held checks

The root ordinary lane checks JavaScript/declaration syntax, exports and healthy
in-memory SQLite schema-3 creation, then one healthy core Request group. Node's
TypeScript parser is syntax-only; no tsc/type-resolution pass is claimed. The
retained storage context test alias is excluded from this lane. Current new
source-presence admission is blocked and unexercised, even though storage can
represent context facts about a submitted source-present binding.

Original SQL/migrations and retained control files are unchanged. Guard reversal,
mutation/omission controls, adversarial, denial, failure injection, concurrency,
crash/replay and other stopped checks remain unrun. No replay or HTTP 428/412/404
failure case is executed here. Provider, media, browser, target, full security
and production qualifications remain open; no downstream deployment is released.
