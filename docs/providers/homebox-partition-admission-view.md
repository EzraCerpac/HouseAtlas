# HomeBox cached-partition admission metadata view

References #285; broader acceptance remains open.

The existing selected-home stock v3 admission route accepts one additional
GET representation: the exact raw query
`view=homebox-cached-partitions-v1`. There are no decoded aliases, additional
parameters, duplicates, selectors or cursors. Empty-query admission remains
unchanged; all other queries retain rejection. This adds no route, MCP tool name,
canonical command, provider binding or grant. It performs no provider request.

Success is the existing closed native catalog JSON, with private/no-store
headers and no second backend envelope or JSON reconstruction:

```json
{"schemaVersion":1,"scope":{"workspaceId":"10000000-0000-4000-8000-000000000001","homeId":"10000000-0000-4000-8000-000000000002"},"partitions":[{"owner":"homebox","sourceInstanceId":"10000000-0000-4000-8000-000000000008","collectionId":"Synthetic / α + %"}]}
```

Scope is the original authenticated selected home. Full durable Access/Store
registrations, including ordered allowlists, must match. Current original
partition grants, sealed capture, the complete registration cut and final native
fence remain required. The native limits remain 64 candidates, eight returned
targets, 64 KiB per registration in each store and 256 KiB encoded output.
Overflow, inconsistent registration, contention, expiry, cancellation or uncertain
cleanup returns fixed unavailability with no catalog bytes. Authentication errors
retain their existing mappings, including request-rate refusal.

A valid never-published target is eligible. A returned registration is no claim
about inventory, population, availability or freshness, and authorizes no later
read. Collection IDs remain exact opaque strings; the published wire3 HomeBox
commands currently require UUID collection IDs. Discovery does not guarantee
wire3 selectability. No filtering, normalization or synthetic UUID mapping bridges
that contract difference.

## Native issuance and cleanup

The dedicated async handler owns one immutable five-second monotonic budget and
sticky request-drop cancellation before scheduling its single blocking worker.
Queue time counts. The original Core, Store and Access are acquired once, in that
order, with fail-fast locks. Both native connection policies are installed before
authentication SQL. The original scoped Read principal is issued through the
existing origin, session, rate, membership and last_seen logic, with budget
checkpoints. Its rate transaction commits normally and last_seen retains its
ordinary autocommit behavior. These precede the catalog transaction, so later
catalog rollback does not undo successful authentication bookkeeping.

The same principal allocation then enters the immediate Access read fence.
There is no unchanged authorized_read wrapper, nested worker/policy, relock,
replacement connection/principal or deadline renewal. Both connection policies
are installed and cleaned up once. Callback removal, transaction completion,
idle/autocommit checks, exact timeout restoration and affected-original-owner
quarantine retain the internal catalog policy. Cleanup may overrun the budget;
expired success is discarded after cleanup and immediately before response
handoff. This is a cooperative result-acceptance deadline, not a hard kernel-I/O
or cleanup wall-clock guarantee.

## Bridge composition and failures

Only `houseatlas_capabilities` requests this metadata representation. Validated
success adds `homeboxCachedPartitions` containing the exact closed DTO. Closed
keys, selected scope, version 1, at most eight unique HomeBox targets, canonical
source UUIDs and opaque collection text are checked before release.

A positively identified non-success metadata response (403, 404, 405, 410, 501 or
503) instead adds:

```json
{"homeboxCachedPartitions":{"status":"unavailable","reason":"unsupported-or-unavailable"}}
```

An old server returns 403 for this query. This is ambiguous, not proof of
unsupported functionality or empty inventory. It causes no fallback lookup,
retry, configuration inspection or alternate discovery route. Authentication
refusal, rate refusal, uncertain/partial transport, overflow, malformed success
or changed session/scope fails the whole capabilities operation. Ordinary
selected-home admission and the original session are validated again before
releasing the combined result, including after an ambiguous metadata refusal.
No mid-operation login or cross-session retained catalog is used.

One cooperative 60-second capabilities budget begins before session preparation.
It includes any initial session issuance, ordinary admission, metadata and final
validation. Exchanges share that deadline; connect/header/body socket waits are
capped by remaining time. Existing per-response caps remain, metadata is limited
to 256 KiB, cumulative response input (headers plus bodies) to 4 MiB, and final
output stays below the existing output limit. Other bridge operations retain
their existing behavior.

## Synthetic coverage and evidence

Dedicated source fixtures cover exact-query rejection, ordinary admission,
real scoped issuance and committed bookkeeping after catalog failure, rate
refusal, pre-work cancellation, never-published opaque registrations, overflow,
old-server/unavailable responses, malformed/duplicate DTOs, changed session or
scope, shared preparation/deadline/input/output bounds and remaining-time socket
waits. Existing native catalog fixtures cover bounded lookups, callback cleanup,
timeout restoration and original-owner quarantine.

All added fixtures are UNRUN locally. No build, tests, Clippy, typecheck, audit or
local qualification gate ran. Existing CI owns compilation and verification;
this increment changes no runner or workflow. The dedicated bridge fixture
source is `tools/houseatlas-mcp-bridge/test_homebox_catalog.py`; its cases are
not added to any existing workflow or explicit bridge case list by this change.
Source/CI completion does not establish installation, live invocation, provider,
interactive browser/device or broader issue acceptance.
