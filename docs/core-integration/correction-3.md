# Corrected development core

Core `0.1.1-at13.3` composes storage `0.1.3` / SQLite schema 3, web `0.1.1`
and the additive HTTP `1.1.0` history sidecar. Executable and fixture bytes are
preserved from the reviewed composition; publication-only script and metadata
adaptations are mapped separately in the external private ledger.

The six frozen HTTP operations retain contract `1.0.0` and record schema 1:

- GET `/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}/{recordId}` returns the record directly.
- POST the same path plus `/mutations` accepts the mutation directly, deriving its target from the path.
- POST the scoped `/mutations` path accepts the canonical batch envelope.
- GET scoped `/records`, `/homebox/entities` and `/network/relations` return exactly `{contractVersion, items, nextCursor, sourceStatuses}`.

List parameters are `limit` (1–100, default 50) and optional opaque `cursor`.
Cursors live in bounded server memory for five minutes and bind to session,
actor, authorized scope, collection, limit and the authorized snapshot. Restart
or a changed authorized snapshot requires a new first page. These choices add
no frozen payload or filter parameter. The scoped record path plus `/history`
returns the existing bare schema-1 audit array in durable ascending order,
without query parameters, pagination or a new UI. Existing contract constants,
snapshot schema and six path objects remain unchanged.

Browser assembly extensions are scoped `/view` and `/network/facet`, plus
`/api/atlas/homes`, auth and the session-authorized media mount. They do not
replace any frozen operation. Missing mutation revision/guard fields use
`revision-required` / 428. Stale record or guarded revisions use 412; identity,
idempotency and lifecycle conflicts retain 409. Only transaction-derived,
currently authorized revisions may enter `currentRevision`; unavailable or
foreign resources expose no revision. No automatic retry or rebasing occurs.

The storage authorization context supplies detached graph data from the actual
transaction under the synchronous access writer fence. Source-claim traversal
covers touched old/new records, submitted guards, recursively referenced owned
evidence/assets/identities, qualified binding and evidence sources, HomeBox
attachment references, geometry mappings and compatible binding/remap chains.
Retained unrelated history remains stored; using retained facts in a new claim
does not exempt it from current source authority. No nested storage transaction
or core-side SQL substitutes for this seam. See packages/storage/MUTATION-CONTEXT.md.

New explicit source-present admissions are blocked before writes. Triggers are
create-present, a nonpresent-to-present transition, restore to an active present
binding, and changed evidence membership while present. An unrelated review-only
revision with the same source, present value and evidence membership retains
its earlier observation; manual mapping acceptance alone is not a presence
assertion. Both still require the complete current source-grant closure.
Reordering the same unique evidence IDs retains the observation; adding,
removing or replacing membership requires a new witness. This comparison never
changes submitted arrays, request/receipt digests or ordered batch semantics.

The future admission policy requires the exact entity in the latest complete,
successfully published, currently authorized local generation, fresh under the
existing cache-age policy. A filtered view, failed/incomplete/unavailable state
or old accepted binding cannot establish new presence. Its observation describes
that generation at its recorded time, not live existence. No provider fetch or
second TTL is introduced. Frozen schema-1 binding/evidence/audit fields cannot
durably represent the generation and epoch witness. This version invents no
fields and overloads neither source revision nor evidence text. The separate
atomic storage/witness successor is absent and unqualified in this snapshot.

Private home configuration remains server-side. Choices and view homes contain
only `workspaceId`, `homeId`, `label`. Server-only view preparation and the core
independently apply the credential-key link predicate before serialization,
preserving original safe URL bytes. Unavailable external references retain a
null URL in the browser view. Canonical HomeBox projection schemas cannot contain
null URLs, so an unsafe external reference makes the read page explicitly
unavailable rather than returning an invalid projection, rewritten destination
or silently empty inventory. Output filters never fetch a provider URL. This
key-name predicate cannot prove arbitrary paths, fragments or parameter values
credential-free; wider credential-content qualification remains open.

The ordinary lane covers syntax, six module builds, local HTTP-history schema
compatibility with 14 fixed valid checks, and one healthy Request group. The group
uses canonical circuit revisions 1/2/3, an ordered evidence/identity/unresolved-
binding batch, referenced source evidence and attachment, bare ascending history,
paged record/HomeBox/Network reads, three-field home DTOs and native links.
Its source-backed binding remains `unresolved`, so new presence is unexercised.
It executes no missing/stale/revoked/denied/unsafe-URL input, guard reversal,
mutation/omission control, failure hook, adversarial replay or concurrency check.
Historical aggregate aliases and browser receipts are outside this verification
lane. Ordinary results do not certify application authority, full security,
provider/media/browser/target qualification or downstream deployment.

Recovery requires a quiesced destination, separately current authority and
configuration, and this exact compatible core release. Previous recovery
qualifications are not silently transferred to this successor.
