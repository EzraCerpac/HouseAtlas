# AT-08 HomeBox read adapter

This independently testable ES module implements the intermediate GET projection
boundary from contract 1.0.0 / record schema 1 / AT-06 fixture at06-synthetic/1.
The reference version is v0.26.2. It makes no network connection and accepts an
injected, source-bound transport. Full provider commands remain AT-33 onward.

## Exports and integration

`createHomeBoxAdapter({ registration, transport, clock?, monotonicClock?,
idFactory?, limits?, nativeNavigation? })` returns `fetchGeneration(options?)`
and `fetchView({ parentIds, signal? })`. `cacheFreshness(cache, { now,
staleAfterMs })` calculates age without changing stored times. Constants expose
adapter/reference version, consistency and frozen default limits.

Consume the server-controlled frozen `sourceRegistration` and verify the complete
registration set in the shared service before constructing adapters. The module
checks its registration and every full workspace/home/instance/collection receipt;
cross-home disjointness across separately constructed modules remains the shared
registration service's responsibility. Credential storage and principal checks
belong to AT-11 and the later shared service. Caller-supplied tenant/header/URL or
method overrides have no effect. No credential is accepted, persisted, returned
or placed in a browser URL by this module.

The injected `transport(request)` receives:

- `method: GET`, fixed relative `path`, query pairs, `headers: { X-Tenant }`;
- `redirect: error`, full qualified registration `scope`, and an `AbortSignal`.

It returns `{ status, scope, body, redirected? }`. Body is UTF-8 text, Uint8Array,
or an iterable/async iterable of Uint8Array chunks. The **trusted source-bound
transport** produces the full scope receipt from its approved configuration and
authorized tenant verification. A bare HomeBox HTTP response is not presumed to
contain this receipt. A driver must refuse redirects, honor cancellation and
preserve the tenant/header/source binding. This is an injection seam, not proof
of a real provider's tenant enforcement. AT-21 must qualify actual source access.

The adapter uses only `/api/v1/entities`, `/api/v1/entities/{entityId}` and
`/api/v1/entities/{entityId}/maintenance`. It explicitly requests location and
item lists, `includeArchived=true`, and bounded page/pageSize. Full generations
accept no parent filter. `fetchView` sends repeated `parentIds` and returns
`completeness: filtered-view`, `replaceCache: false`, `cache: null`. A filtered
view cannot freshen or replace the collection cache, and it supplies no missing
record evidence. Views always report `quarantineTransition: preserve` on success and unrelated
failures, with `quarantine: null` (leave existing state intact). View auth/scope
failures return `quarantineTransition: quarantine`, `quarantine: true` and sanitized
`error` for the service to handle; no projection is returned.

A successful full result has `ok: true`, `completeness: complete-generation`,
`replaceCache: true`, `cache`, `homeboxEntities`, `missingExternalIds`, internal service statistics (not browser output),
consistency, and `deletionConfirmed: false`. AT-07 must replace cache and records
in one complete-generation transaction. Missing IDs are unresolved candidates;
they do not delete, retire or tombstone bindings/identities. All output validates
against frozen snapshot/projection/cache shapes and the read/cache semantic
subset before publication. A linear parent-cycle validator avoids repeatedly
walking every ancestor chain; AT-07 still validates the full transaction graph.
A successful empty collection has a new generation and successful fetch time.

On failure, `replaceCache: false`, `homeboxEntities: null`, `retainPrevious: true`.
Only `lastAttemptAt` and sanitized error/status change in the returned cache.
Previous records/generation/retrieval/success timestamps remain intact in private
storage. Auth and wrong-scope failures quarantine the partition with
`access-revoked` status; quarantine persists across later failures until a complete
successful scope-validated staged fetch and a separately qualified administrative
source-reenable action. An adapter success preserves prior quarantine in its
`quarantine` flag; the returned fresh cache is a proposed complete generation. A full success is only
`quarantineTransition: revalidation-candidate`; it does not revalidate a principal
or grant access. AT-11 `revalidateSource(grant)` is only a current permission check;
it never enables a source or lifts quarantine. Administrative reenable is reserved
for separately qualified G2/source evidence plus complete staged read-back. Old
grants remain invalid after reenable and must be reacquired. Real evidence must come from the AT-21-qualified transport and
source/credential setup, not literal synthetic receipts. Retention is not permission to serve cached
records. AT-11 must deny revoked/quarantined cache and media. Transport/timeout
errors can still permit independently authorized cached browsing. Source failures
do not modify another adapter or Network facet.

Limits may be tightened below the frozen defaults by this intermediate module.
It bounds request and whole-generation time, pages, page size, each response and
cumulative bytes. Each request has a monotonic deadline capped by the remaining
generation time, checked through transport resolution, chunk consumption, assembly,
decoding/parsing and before successful return; timers still terminate pending
operations. Accepted stream chunks are copied into owned Uint8Array storage before
advancing the iterator, so reused Uint8Array or Buffer backing memory cannot alter
consumed bytes. JSON decoding rejects invalid UTF-8, duplicate keys, nonfinite
numbers unpaired Unicode surrogates, and nesting beyond 64. Conflicting duplicate UUIDs, observed count/page
or list-to-detail drift, wrong types and parent cycles abort. Identical repeated
rows collapse. Normalizing source UUID spelling does not alter opaque collection
spelling. Offset pages remain non-transactional even when every check passes.
Observed timestamp equality or list/detail agreement is not CAS or history proof.
Concurrent reads on one adapter are rejected; the service serializes publication.

## Synthetic metadata dialect and navigation

The frozen minimal raw-page fixture describes list fields, not a complete real
HomeBox detail/maintenance schema. `fixtures/catalog.json` pins the local
`atlas-normalized-synthetic-v1` extension: detail is the minimal entity object
plus required `attachments` in the frozen attachment shape; maintenance is an
array of the frozen maintenance shape. Explicit empty arrays represent successful
empty metadata reads. Missing/invalid metadata aborts instead of implying no files
or maintenance. The concrete fixture is `fixtures/metadata.normalized-synthetic-v1.json`.
This metadata decoder has **not** been qualified against a real
v0.26.2 deployment; the actual driver/decoder and any differing schema must be
reviewed through AT-06/08/12 before AT-21. No live service was called to populate it.

Arbitrary entity type ID/name/isLocation and null type/parent are preserved.
Unknown manufacturer, model, serial, quantity and dates remain null. Names/tree
depth do not classify floors or physical placement. Attachments retain metadata
and external URLs as references only; no external URL or attachment bytes are
fetched. Stored-file proxyRef is null pending AT-11/12 capability issuance.
Active content is not rendered. Maintenance is a source-owned scheduled/completed
reference, without a recurrence engine or notification authority. This frozen
shape has no separate maintenance attachment relation; no extra one is invented.

Native links default to empty. Optional server-reviewed `nativeNavigation` must
include the exact full registration scope, credential-free HTTP(S) origin and
`routes: { edit: { verified: true, path: '/entities/{entityId}' }, ... }`.
Only view/edit/maintenance intents and one path placeholder are accepted, with
no query/fragment or credential-bearing URL. Links are generated only for a
validated authorized entity. The example path in tests is synthetic; no actual
native route has been verified. AT-19/21 still own real route/access validation.


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
