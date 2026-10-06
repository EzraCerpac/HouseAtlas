# Network reads and facet

This module consumes contract 1.0.0 and record schema 1 with synthetic fixtures.
Its package version is 0.1.0. It uses an injected passive transport and contains
no source login, credential, collector lease, diagnostic or write client.



## Exports and integration

Import `adapters/network/src/index.mjs` from the shared server. The integrator
mounts it after server-side authorization for the full workspace/home/source/
collection tuple. `NETWORK_READ_ROUTES` contains only `/api/inventory`.

| Export | Input and result |
| --- | --- |
| `assertNetworkReadRequest(request)` | Accepts exactly `{method: 'GET', path: '/api/inventory'}`; rejects additional keys, queries, alternate methods and routes |
| `projectNetworkCapture({registration, capture, review, limits})` | Pure offline validation and projection of an inventory document or captured snapshot; returns qualified inventory, frozen `networkRelation` records, retained observations and provenance |
| `createNetworkReadAdapter({registration, transport, review, clock, newGenerationId, limits, initialState})` | Returns only `read()` and `refresh()`. `read()` returns a detached cache state. `refresh()` makes one bounded GET, atomically publishes a complete generation, or retains the previous generation with a sanitized error |
| `buildNetworkFacet({registration, state, now, staleAfterMs})` | Pure read-only view model with separate current claims, historical/disputed/withdrawn relations, abstract segments, source groups, observations and truthful cache age; makes no source requests |
| `NetworkReadError`, `ADAPTER_VERSION` | Typed validation error and package version |

`registration` uses the frozen `sourceRegistration` shape and owner `network`.
The injected transport receives `(request, {signal})` and returns:

```js
{
  status: 200,
  source: {workspaceId, homeId, sourceInstanceId, collectionId},
  body: inventoryDocument, // JSON string or JSON data
  sourceSnapshotAt: null  // actual capture timestamp if known; never inferred
}
```

The upstream wire API does not contain Atlas scope IDs. The transport's `source`
tuple is an attestation from the reviewed server configuration and approved
source instance, not a client-supplied claim. The integrator must constrain that
transport to the reviewed origin and path, disable redirects before any follow,
bound response streaming before buffering, honor cancellation, and keep any
approved existing server-side session private. This module does not acquire a
session or accept credential headers or collector tokens. It also rejects
redirect indications in a transport response and performs an additional byte
check before JSON parsing. A transport that ignores its signal can continue its
own operation; late completion cannot publish a generation here.

An offline `capture` contains `{source, document, retrievedAt, sourceSnapshotAt}`.
`document` uses the original Network `revision/inventory` shape, optionally with
captured `observations`. Observation IDs, original timestamps, collector IDs,
vantage, values and invalidation are retained. Diagnostics, discoveries, viewer
identity and collector control objects from a captured snapshot are discarded.
Graph positions are validated and discarded from the facet; they never become
Atlas geometry. Inventory groups remain Network groups, interfaces remain
attachments, and segments remain abstract objects. No Atlas IDs or bindings are
created. The package fails on unknown inventory-record fields so a source
extension requires compatibility review before publication.

`review` is a server-owned sidecar pinned to the exact source revision. Every
link ID needs explicit `kind`, `evidenceBasis`, `temporalStatus`, `factAt` and
`vantage`. An explicit `unresolvedTo` description can retain a reviewed path gap;
the original source link and IDs remain in the inventory projection. Original
link `observedAt`, when present, takes precedence over a sidecar fact date.
No note parsing, name inference or confidence upgrade is performed. A changed
source revision requires an updated reviewed sidecar and a new adapter instance
with the retained state. A source link's `confirmed` confidence can therefore
remain `confirmed` with `evidenceBasis: 'owner-report'`. Historical associations
cannot be reclassified as current connections. Segment membership is oriented
member-to-segment and never expanded into a chain or electrical circuit.

Generations retain that sidecar as `linkReview`. Cache reopening and facet
validation reconstruct every relation from its original source link with the
same projector and require an exact match, including endpoint IDs, orientation
and unresolved-target description. Only reviewed membership orientation can
reverse raw endpoints; an ordinary connection cannot be rewired or reversed.
Nonmembership relations cannot use raw segment endpoints, including when a
reviewed unresolved target would hide that segment. The adapter also compares
retained and configured reviews when they have the same revision. Older cached
generations retain their own reviewed metadata while a newer source read is
unavailable. Earlier candidate caches missing `linkReview` fail closed and need
a newly validated generation; no deployed-cache compatibility is asserted.

Source labels use the pinned Network text rule: strings up to 2,000 characters,
including empty strings, preserved verbatim. Names and device kind remain
separate from nonempty opaque identity validation. A renderer may provide a
display fallback without changing the retained source value.

Exclusive-home source registration is supported. For a reviewed shared-source
allowlist, every returned entity/link/observation and each endpoint must be
explicitly allowed. A mixed-home generation fails closed without partial
publication. The current broad upstream inventory route does not provide an
Atlas home filter, so deployments that share an inventory must supply a reviewed
partition transport or hold that connection until its returned generation is
properly partitioned. Names, IPs, group labels and graph positions never choose
an Atlas home.

## Cache and failure behavior

Successful results retain distinct source revision, optional source snapshot
time, per-record retrieval time, fact time, vantage and source confidence.
The cache keeps `lastSuccessfulFetchAt`, `lastAttemptAt`, `generationId`, status
and a sanitized error. Failure never freshens facts or discards an authorized
previous generation. Identical source revisions must retain identical inventory
contents. Concurrent refreshes coalesce into one request.

The frozen `cacheStatus` shape supplies its shared
`consistency: 'non-transactional-offset-pages'` marker. This Network adapter reads
one inventory document and does not perform offset pagination or claim an
upstream transaction spanning sources. The Network generation's provenance
identifies its actual input as `network-inventory-document`.

HTTP 401/403 marks `access-revoked`: public `read()`/facet results withhold all
records while preserving recovery metadata. An intervening transport outage
does not lift that denial. A successful newly authorized read can restore access.
An injected initial state and all facet queries are checked against their full
source scope. Persistence and atomic durable cache replacement belong to AT-07;
this package keeps disposable in-memory state and returns complete-generation
results for that boundary. It does not write a database or a disconnected queue.

Facet reads never refresh a source, so Atlas/HomeBox room and document browsing
can consume their own results independently. The integrator should render the
Network facet separately and avoid awaiting its refresh before displaying those
views. Stale observations mean device state is unknown. Invalidated observations
retain that state; a recent observation is not upgraded to a physical fact.


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
