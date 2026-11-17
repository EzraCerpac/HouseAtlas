# Explicit persistent cached-provider selection

References #285; broader acceptance remains open.

Persistent serve accepts the paired optional flags
`--provider-reads-profile /absolute/private/profile.json` and
`--provider-reads-sha256 <64 lowercase hex digits>`. Neither flag has a default.
They are refused for disposable startup, initialize, backup, restore-check,
origin rebind and receipt compatibility commands. No environment, directory
search, source enrollment or credential lookup supplies missing inputs.

The profile is a closed UTF-8 JSON object, at most 256 KiB, captured once with
the existing canonical-path, owner, 0600-mode, regular-file, no-symlink and
stable-inode startup reader. Its exact bytes must match the selected SHA256.
Its required top-level fields are:

- `schemaVersion: 1` or `2`. Schema 2 adds optional Network `refreshEditors`
  and `revalidateSource`, and the HomeBox fields
  described under [Schema 2](#schema-2-homebox-open-file-and-editor-refresh).
- `serverConfigurationDigest`: the existing ServerConfig.state_digest() value.
- `homeboxCached`: an array of registration/origin/limits entries.
- `networkCached`: an array of registration/origin/review/limits,
  connectTimeoutMs/idleTimeoutMs/staleAfterMs/privateDirectory/entities entries.
  Optional `collectorMeasurements` defaults to false;
  on persistent serve it enables process-local polling of stored collector
  health, measurements and results, independently of browsing.
  Collector origins must be exact literal loopback HTTP with an explicit port;
  profile capture and the fallible `with_collector_measurements` settings builder
  reject HTTPS with `Collector measurements require exact-loopback HTTP`,
  before constructing a peer or opening collector custody;
  cached inventory sources without this setting may still use HTTPS.
  Optional `collectorIntervalSeconds` is an integer 10–3600, default 60.
  Optional `collectorActionPorts` contains at most sixteen distinct nonzero
  integer ports, default `[22,80,443]`; `[]` disables port diagnostics.
  These two options require `collectorMeasurements: true`.
  The collector independently enforces its own port allowlist.
  See [collector read semantics](../geometry/native-scene-source.md#optional-collector-measurements).

Both arrays are required and together contain at most eight entries. Registrations
use the existing complete shared sourceRegistration shape. Each registration
must select an exact configured workspace/home, the correct owner for its array,
and a unique partition. The original ProviderRegistry validates shared identity,
partition mode and allowlists. Unknown fields, including credential fields,
are rejected (schema 1 also refuses populated Network refresh approvals and the
HomeBox schema 2 fields). The original typed builders validate endpoints, limits and reviews;
there are no relaxed versions of those validators.

## Reopen identity

The reopen pin is the pair of the explicit profile SHA256 and the existing
server configuration digest. A changed server scope, command profile, listener,
origin or authentication selection invalidates the profile's configuration
binding. Changed profile bytes invalidate the same command-line selection.
Changing either pin is an explicit owner startup selection, never automatic
adoption or receipt migration. Existing persistent state-receipt format/digest
behavior is unchanged, so omitting these flags preserves old startup behavior.

Capture and preparation run on the existing persistent reopen blocking worker.
They retain the original Core's Access and Store allocations through Host
construction; applying to replacement owners is refused. Both direct TLS and
trusted-gateway serving branches use this same handoff. No additional listener is started.
Only explicitly enabled collectors receive an observation polling task.

## Cached-only composition and authority

HomeBox entries contain:
`registration`, `origin`, and `limits` with all six existing reader bounds:
maxPageSize, maxPages, maxResponseBytes, maxGenerationBytes, requestTimeoutMs
and generationTimeoutMs. They reuse TrustedHomeBoxSource::new_stock for the
existing cached HTTP selectors. They create no NativeHomeBoxReadBinding,
credential provider or upstream GET client. Existing stock cached commands
remain governed by their own original current native registration/grant checks.
Opaque collections remain exact; this does not remove wire3's UUID constraint.

Network entries reuse NetworkSettings and NetworkBinding::from_trusted_configuration
against the same Core, then Host::with_network_bindings. Entities are exact
existing SourceRefs, validated by the original builder; no entity IDs or grants
are synthesized. The directory must be the canonical private existing
`<dataDirectory>/provider-cache`. By default, the partition-derived sidecar
and raw-archive SQLite files must already be regular 0600 files owned by the service user.
Startup selects an existing-only policy in the original opener. That policy
uses no CREATE flag for database or constructor-custody members, requires the
existing segment directory and custody locks, and opens both SQLite databases
read-only. It requires the complete original schema, including immutable-row
triggers; empty files and missing schema members fail without initialization or
repair. The reference schema is built in memory only. Explicit provisioning
continues to use the separate original creation path.

Database and segment inode leases stay held. The database path is checked
against the retained original inode before and after SQLite open, after schema/
archive validation, and by the existing owner checks on subsequent operations.
Removal or replacement fails closed, without recreating a database or segment
directory. Original database ownership, locks and full archive verification
still apply. Preparation performs no generation publication or inventory
request and creates no credential lease.

Source selectors are data, not a ConfigureSource/PublishCache/Read grant.
Schema 2 `refreshEditors` pairs are explicit owner-approved lifecycle policy.
Startup does not install Access/Store registrations, enable a source, change
quarantine, publish a generation, fetch inventory, start a scan
or issue lifecycle grants.
The optional collector task reads stored observations only,
without calling the durable inventory refresh owner. Missing durable registration, retained generation
or current grants still makes execution unavailable under existing read owners.
Source selection can describe Network command availability, but every actual
read must capture/revalidate its original principal and partition/member grants.

No authorization/header/password/token fields are accepted. Endpoints and reader
metadata are explicit owner configuration; credentials and live-GET custody remain
separate existing owners.
This profile mounts cached reads by default;
schema 2 explicitly adds the bridges and refresh paths described below.

## Required operational inputs and remaining acceptance

Before activation, the existing owner must supply the reviewed profile and both pins.
Cached-only selections also need existing native registration/grants
and complete retained generations.
Network requires its exact LinkReview;
without named refresh Editors it also requires existing sidecar/raw-archive custody.
Existing ConfigureSource/PublishCache lease APIs remain the only explicit setup/
publication path; two-database registration retains its ordered/non-atomic
semantics and quarantine rules.
Only the explicit refresh POST calls those APIs in serve.

Backup/restore custody of selected provider stores must be reconciled with the
existing recovery owner before operational use. This source increment does not
change backup/restore scope, private configuration, services, grants or providers.
It does not qualify an actual provider version, source, TLS target or credential.

The generated in-process fixture sources cover paired argument parsing,
closed shape/scope/owner/registration limits, profile/configuration pin changes,
same-owner cached mounting without enrollment, absent-selection identity,
replacement-owner refusal, missing Network custody without bootstrap, and
explicit existing synthetic Network custody. Additional regressions cover
zero-byte sidecar/archive files, missing database/segment members, missing
immutable triggers without repair, and removal/replacement while an original
database inode lease is retained around SQLite open. No listener or provider
exchange is used. New fixtures, formatting, build and Clippy are UNRUN locally and delegated
to existing CI. No runner/workflow change is included. Source/CI success does
not establish installed, live-provider or deferred browser/device acceptance.

## Schema 2: HomeBox Open file and Editor refresh

A schema 2 HomeBox entry may add:

- `credentialFile`: an absolute canonical path to an owner-only (0600) regular
  file, at most 8 KiB, holding the exact HomeBox `Authorization` header value.
  It is read once at startup through the same private startup reader; one
  trailing line ending is ignored. Its bytes are never logged, returned or
  written elsewhere, and a refused file reports only the generic profile error.
- `refreshEditors`: one to eight `{userId, actorId}` pairs. Requires
  `credentialFile`. Each pair becomes an Access `LifecycleRule` for
  `ConfigureSource` and `PublishCache` on that exact registration, issued only
  to a CSRF-checked Mutate (Editor) principal of that user and actor.
- `revalidateSource`: `true` adds a `RevalidateSource` rule for each of those
  pairs (same registration, Mutate only). Requires `refreshEditors`; absent or
  `false` adds nothing.

With `credentialFile`, the existing Open file routes get a
`PinnedHomeBoxFileBinding` for that source. With `refreshEditors` as well, the
Editor-only `POST /api/atlas/providers/homebox/workspaces/{workspace}/homes/{home}/refresh`
registers the source if it is not yet readable, then runs one
`homebox_refresh::refresh` with the configured header and answers
`refreshed`, `failed` (with a cache error code), `running` or `not-configured`.
At most one refresh runs per process. A rejected credential (401/403) is
recorded as `access-revoked`; the existing refresh owner then refuses every
later refresh before any GET (`reason: "access-revoked"`). A `GET` on the
same path is the button's admission read: it answers `available` (with
`recheck` saying whether `revalidateSource` is set) only to an Editor whose
actor is named in `refreshEditors` for a configured source, and the same
`unavailable` to every other caller whether or not a source is configured.

With `revalidateSource` as well, the Editor-only
`POST /api/atlas/providers/homebox/workspaces/{workspace}/homes/{home}/recheck`
is the only way to lift that quarantine. It shares the refresh's CSRF,
in-flight and Editor admission rules; the lease additionally captures the
`RevalidateSource` grant and revalidates it with `PublishCache` before the
read, after it and inside the storage commit. It runs one complete GET-only
read through the existing reader with the current header. Only a complete
generation of exactly the configured registration that still contains every
entity the quarantined generation retains is published; it replaces the
quarantined generation and its cache status in one storage transaction. A
reviewed allowlist skips other records, so without that last rule a credential
that sees only unrelated records would read an empty generation. Every failure
(`auth`, `wrong-scope`, `upstream`, `pagination`, `timeout`,
`records-missing`, `changed` when the stored cache moved meanwhile,
`not-approved`) writes nothing. It answers `rechecked`, `failed`, `not-needed` (not quarantined, or
never published here; nothing sent), `running` or `not-configured` (no
`revalidateSource`; nothing sent). The plain cache-replacement path stays
refused by the native Store authorization. It
sends nothing upstream and writes nothing. It is a display hint; the POST
is still decided by the Access lifecycle rules. Startup still enrolls nothing, issues
no grant and sends nothing upstream; there is no timer, retry or startup
refresh, and MCP/WebMCP do not expose the action. Without these fields the
behaviour is exactly schema 1.


## Ephemeral collector observations and Editor diagnostics

Each enabled source gets one task in both persistent TLS and Unix-gateway serve.
It immediately GETs `/api/health`, `/api/measurements`, then `/api/results`,
and follows fixed monotonic interval slots without jitter or catch-up.
A poll is awaited before another can start.
The whole poll has a 30-second deadline,
and each GET keeps the source's existing response and request bounds.
Failures skip 1, 3, 7, then 15 interval slots (maximum 16 times the interval);
a successful poll resets backoff.
Shutdown cancels the active future and joins the owned tasks;
startup/serve failure also drops and aborts them.
Absent `collectorMeasurements`, no polling task or collector client is created.

Only memory changes.
There is no principal, native registration, sidecar/archive access,
durable generation publication or request to start collector work.
A failed measurement read retains the last decoded measurement's original dates;
its facts age to stale under the existing collector freshness policy,
then become unknown after 24 hours without a successful measurement retrieval.
Results are retired before every poll,
so failed, cancelled or malformed results reads stay unknown
without disturbing inventory or retained measurements.
Restart starts with unknown observations.

Read-time joins require the caller's existing native grants,
exact source instance, exact served inventory revision and exact device ID.
Mismatch yields `inventory-revision-mismatch`, never a name/address inference.
The reviewed scene-device manifest still controls overlay enrichment.
`HostNetworkRuntime::refresh` retains its original behavior;
its generation-keyed measurements remain available as a fallback.
After polling begins, the snapshot with the newer measurement retrieval time wins
(ties prefer the observation holder),
including its unknowns and revision fence.
Only a legacy snapshot for the served generation can compete.
Both paths share the measurement decoder and HTTP transport bounds;
the service loop never invokes `refresh` or `/api/inventory`.

For a configured source, the new routes share the existing prefix
`/api/atlas/providers/network/workspaces/{workspace}/homes/{home}/sources/{source}`
and require `?collection=` with the exact encoded collection ID:

- `GET /results` requires an authenticated home Viewer or Editor
  and the same partition/member grants as the cached inventory read.
  It returns `{status, retrievedAt, inventoryRevision, servedInventoryRevision,
  measurementReason, mayRefresh, results}`.
  `status` is `available` or `unknown`;
  `results` is the closed collector v1 `{version, speed:{latest,recent},
  wifi:{latest}, actions}` document or null.
  Speed/action histories contain at most thirty newest entries each.
  Each source `recordedAt` stays separate from the backend `retrievedAt`.
  Wi-Fi `unavailable` and null visibility pass through unchanged.
  Device action entries require served membership, a matching observed revision
  and a per-action `inventoryRevision` equal to the served revision.
  Rows from older or unknown revisions are withheld;
  a retained measurement snapshot cannot qualify newly retrieved history by itself;
  speed and Wi-Fi facts are property-level and never enter the overlay frame.
- `POST /actions` reuses the HomeBox refresh mutation-authentication owner:
  current session, POST, Editor membership, same-origin checks and current CSRF.
  `Content-Type` must be exactly `application/json`, body at most 8192 bytes.
  It accepts only `{"kind":"ping","deviceId":"device-example"}`,
  `{"kind":"port","deviceId":"device-example","port":443}`,
  or `{"kind":"speed"}`.
  Unknown devices, absent/expired observations, revision mismatch and ports outside
  the backend allowlist are refused before collector dispatch.
  One action runs per process, with at least one second between admissions;
  the collector independently owns its one-at-a-time exclusion.
  The backend adds required `expectedInventoryRevision` for ping/port,
  taken from its native served snapshot, never from the browser body.
  The collector compares it synchronously with inventory selection before any await,
  retains the selected target across guard awaits,
  and returns 409 `inventory-revision-mismatch` without execution on mismatch.
  The backend maps that to `refused` with the same reason and collector status.
  New completed device results/history retain the selected `inventoryRevision`;
  the backend checks this revision again before disclosing a POST result.
  The forwarded JSON uses exact-loopback Host, no Origin and no credential.
  Waiting is bounded at 125 seconds to include the collector's speed-cycle drain.

Both routes answer `{"status":"unavailable"}` after authentication
when no collector is configured for the selected source.
HTTP errors retain authentication/CSRF/scope/body refusals.
Structured action outcomes are `completed` with the validated original collector
result and `collectorStatus:200`, `busy`, `refused`, `timeout`, or `unknown`.
Collector busy/refused outcomes retain their status and reason;
local refusals carry a reason without a fabricated collector status.
`completed` describes a returned action result,
which can itself be unmeasured, failed or unknown.
Timeout, transport failure or malformed response never implies no diagnostic ran;
clients must not retry automatically.
The existing comparable HomeBox refresh route has no suitable diagnostic journal;
no new durable journal or native mutation intent is invented here.
Completed diagnostics remain in the collector's own action history.

The UI-stage clients are `readNetworkCollectorResults`
and `requestNetworkCollectorAction` in `frontend/integration/network-collector.ts`,
with `decodeNetworkCollectorResults` and `decodeNetworkCollectorAction`.
The action client takes the current session's CSRF token explicitly.
HTTP refusal or transport failure throws;
the UI must retire failed reads and treat a lost POST response as uncertain.
There is no UI or installation change in this stage.

## Schema 2: named-Editor Network inventory refresh

A schema 2 Network entry may add `refreshEditors`,
at most eight `{userId, actorId}` pairs in the same shape as HomeBox.
Absent or empty keeps the existing-only, read-only mount and exposes no refresh.
Nonempty selects the original writable sidecar/archive opener
and adds owner-approved `ConfigureSource` and `PublishCache` rules
for each exact user/actor, registration and CSRF-checked Mutate principal.
An optional `revalidateSource:true` independently adds `RevalidateSource`
for those same named Editors; it requires nonempty `refreshEditors`.
Absent or false grants no recovery authority.
Startup still registers and publishes nothing.
The existing canonical private `provider-cache` directory is required;
the writable owner may create its own custody files there.
Naming Editors and selecting the changed profile pin on a real installation
remain owner-approved install steps outside this PR and release no G1–G5.

`POST /api/atlas/providers/network/workspaces/{workspace}/homes/{home}/sources/{source}/refresh?collection={collection}`
takes no body and requires the current session, Editor role, same-origin checks,
current `X-Atlas-CSRF` and that source's named refresh approval.
It uses `NetworkAccess::configure` if the source is not readable,
then `retain_original`, `NetworkAuthority::new` and the runtime’s Editor refresh entry
with the caller's original principal and exact configured partition/member grants.
Registration remains ordered across the two databases, not atomic.
Only one Network refresh POST runs per process;
the runtime's existing per-source single-flight owner also remains in place.
There is no scheduler, startup refresh, retry or offline CLI.
Browsing and observation polling never invoke this route or publish inventory.
For this Editor entry, before durable archive admission, a bounded `/api/inventory` preflight runs
through the existing producer and discards its complete proposal.
A review mismatch exits without an archive reservation or permanent archive ID.
On success the transport performs the final `/api/inventory` GET after admission,
repeating all review/content checks under the original Store fence.
These are preflight and final reads, not a retry after a failure.
The existing native `HostNetworkRuntime::refresh` retains its one-inventory-GET contract.
If measurements are enabled it also reads
the runtime's existing `/api/health` and `/api/measurements` reads.
It never asks the collector to probe.

Structured outcomes are HTTP 200:

- `refreshed` or `unchanged`, with `inventoryRevision`
  and `cache:{status,lastSuccessfulFetchAt,lastAttemptAt,errorCode}`.
  Both commit a fresh captured generation;
  `unchanged` means the inventory revision and content equal the previous capture,
  as verified by the existing producer.
- `running`, when another refresh owns the flight.
- `not-configured`, when the selected source has no named refresh Editors.
- `refused` with `reason:"not-approved"`, for an unnamed Editor
  or unavailable original publication grants.
- `needs-review`, with `reviewedInventoryRevision` and
  `collectorInventoryRevision`, when the validated inventory revision differs
  from the pinned profile's `LinkReview.revision`.
  It publishes no inventory and leaves the cache facts unchanged.
- `failed`, with a sanitized native `reason` and `quarantined` boolean,
  plus cache facts when the native owner recorded a source failure.
  Transport failure retains the previous generation;
  upstream authorization failure quarantines it.
  An already quarantined cache returns `reason:"access-revoked"`
  before transport unless separately authorized revalidation was explicitly requested.

HTTP authentication, role, CSRF and malformed selector failures remain errors.
Results retain `servedInventoryRevision`, collector `inventoryRevision`
and `measurementReason`, and add `mayRefresh` for the signed-in named Editor,
`reviewedInventoryRevision` from the pinned profile and `needsReview`.
The last flag compares the observed collector revision with that reviewed revision;
it is false when no collector revision is known.
These are hints; the POST checks the exact lifecycle policy
and validates the actual inventory again.
After a publication aligns the revisions,
the existing observation holder attaches matching measurements naturally,
without a poll or restart.
An inventory change during refresh can still leave a mismatch;
the UI must reread inventory/results and show the actual revisions.

The UI-stage client is `requestNetworkInventoryRefresh`,
with `decodeNetworkInventoryRefresh` and `NetworkInventoryRefreshResult`
in `frontend/integration/network-inventory-refresh.ts`.
It takes the current session's CSRF explicitly and sends one POST with no retry.
The UI should offer refresh from `mayRefresh`, show the returned outcome,
then reread inventory/results after a recorded publish or failure.
A lost POST response may follow a committed publication;
reconcile instead of automatically retrying.
No UI control, installation, private profile or live-provider acceptance is included.

### Adopting a changed inventory revision

`LinkReview.revision` must equal the collector inventory revision.
Refresh never infers, advances or bypasses that review.
When results report `needsReview:true`,
the UI can explain that the device list changed and needs review before refresh.
`mayRefresh` still describes the caller's named Editor eligibility,
not approval of that changed inventory.

1. The owner reviews the changed inventory and its links,
   updates the pinned profile's review to that exact revision,
   selects the new profile SHA256 and restarts the service.
   This is an owner-approved install/configuration step outside this PR.
2. The named Editor presses refresh.
   Matching reviewed inventory can then publish;
   matching stored measurements attach to the new served revision naturally.

The generated positive case closes/reopens the same native Store/Host with retained
synthetic Access and a review for revision 43 while retaining served revision 42.
Refresh publishes revision 43 and measurements attach without another reopen.
This is synthetic owner-lifetime coverage, not an installed service restart test.

### Pre-stage failure recovery

A refused or interrupted attempt retains its original same-Store fence
and optional native archive admission in the canonical runtime until staging starts.
The Store’s consuming `abandon_pre_stage_cache_candidate` takes the Store lock
before the canonical sidecar lock.
It verifies the original issuer, full registration, generation and unbound pin,
and requires absence of SQL current/history and native projected/raw/ambiguous stage.
Pin-only attempts retire only their proven empty candidate.
Admitted attempts also cancel the original native capacity reservation;
the archive’s permanent generation ID remains burned and cannot be reused.
A burned identifier alone does not block later unrelated admission.

Contention acquiring Core or the sidecar before staging retains these move-only handles.
The next explicit refresh retries disposition before preparing another candidate;
there is no background worker or automatic transport retry.
Failure metadata uses only the original Editor lease and original attempt time.
Contention remains retryable;
expired/revoked grants or a definitively stale CAS end that old write
and permit proven-empty disposition without giving the next Editor its authority.

An observed collector `auth` or `wrong-scope` refusal also arms a Store-owned,
per-registration read hold without acquiring Core.
A concrete 401/403 remains a denial if the outer deadline or cancellation fires
before adapter classification, with no response body or origin witness returned.
Other expired/cancelled outcomes remain timeouts and cannot publish inventory.
It survives empty-candidate disposal and blocks affected Snapshot/pack/cache reads
and disclosures retained before the refusal.
Unrelated partitions and authorized internal publication baselines remain usable.
This hold lasts only for the same open Store in RAM.
If the original authorized failure transaction commits,
its existing durable quarantine survives reopen.
Failed recovery responses retain the captured durable quarantine fact,
even after reopen when there is no new RAM hold.
Before baseline capture, status remains unknown unless a definite denial or
committed receipt establishes it.
An unknown failure, including registration failure, returns HTTP 503;
the existing client reports an unavailable/unknown outcome instead of false.
Known false/true facts after capture and committed success receipts are preserved,
with no additional cache read.
Mounted relation lists and offline packs withhold only the held partition
while qualifying other partitions and retaining their final release checks.
If expiry/revocation or contention prevents that transaction,
closing/reopening the Store before it commits loses the RAM hold;
this change supplies no principal-free durable quarantine write.

Explicit recovery appends `&revalidate=true` to the same bodyless Editor POST.
It requires independently captured `PublishCache` and `RevalidateSource`
from the current request and never enrolls a missing source.
The UI-stage `requestNetworkInventoryRevalidation` client sends that one POST
with the current session CSRF and uses the existing refresh result decoder.
The normal preflight and final inventory checks remain in place.
Recovery verifies the retained original inventory internally,
including same-revision equality,
without making quarantined rows readable first.
Only a successful guarded fresh publication may lift the matching hold;
a completion captured before a newer refusal cannot clear that newer hold.
A refusal, source failure, review mismatch or failed commit leaves reads closed.
No old failure write is replayed under the recovery Editor.

Once staging starts, bound/SQL/native/ambiguous references remain protected.
This supplies no ambiguous-publication recovery.
A process crash after archive admission can still leave a durable reservation
without its in-memory original token; this change does not claim crash recovery.

Synthetic cases cover same-Store recovery after preflight failure,
a final review mismatch, admitted transport failure and Core/sidecar contention,
expired/revoked original leases, stale metadata CAS, separately authorized recovery
and two partitions sharing one Store,
while retaining previous inventory and the final guarded revision check.
Separate Store controls refuse foreign issuers, bound pins, SQL current/history
and native staged/recovery/disclosure/ambiguous references.
The unchanged root-router TLS fixture still serves exactly one inventory GET
with its original deadlines and assertions.
