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

- `schemaVersion: 1` or `2`. Schema 2 only adds the optional HomeBox fields
  described under [Schema 2](#schema-2-homebox-open-file-and-editor-refresh).
- `serverConfigurationDigest`: the existing ServerConfig.state_digest() value.
- `homeboxCached`: an array of registration/origin/limits entries.
- `networkCached`: an array of registration/origin/review/limits,
  connectTimeoutMs/idleTimeoutMs/staleAfterMs/privateDirectory/entities entries.
  Optional `collectorMeasurements` defaults to false;
  on persistent serve it enables process-local polling of stored collector
  health, measurements and results, independently of browsing.
  Collector origins must be exact literal loopback HTTP with an explicit port;
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
are rejected (schema 1 also refuses the two schema 2 fields). The original typed builders validate endpoints, limits and reviews;
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
`<dataDirectory>/provider-cache`. The partition-derived sidecar and raw-archive
SQLite files must already be regular 0600 files owned by the service user.
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

A selected profile is data, not a ConfigureSource/PublishCache/Read grant.
Startup does not install Access/Store registrations, enable a source, change
quarantine, publish a generation, fetch inventory, start a scan
or create lifecycle authority.
The optional collector task reads stored observations only,
without calling the durable inventory refresh owner. Missing durable registration, retained generation
or current grants still makes execution unavailable under existing read owners.
Source selection can describe Network command availability, but every actual
read must capture/revalidate its original principal and partition/member grants.

No authorization/header/password/token fields are accepted. Endpoints and reader
metadata are explicit owner configuration; credentials and live-GET custody remain
separate existing owners. This profile is not a live HomeBox/native-query mount
and is not a first-publication mechanism.

## Required operational inputs and remaining acceptance

Before activation, the existing owner must supply the reviewed profile and both
pins, existing native registration/grants and complete retained generations.
Network requires its existing sidecar/raw-archive custody and exact LinkReview.
Existing ConfigureSource/PublishCache lease APIs remain the only explicit setup/
publication path; two-database registration retains its ordered/non-atomic
semantics and quarantine rules. Nothing in serve calls those APIs.

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
  measurementReason, results}`.
  `status` is `available` or `unknown`;
  `results` is the closed collector v1 `{version, speed:{latest,recent},
  wifi:{latest}, actions}` document or null.
  Speed/action histories contain at most thirty newest entries each.
  Each source `recordedAt` stays separate from the backend `retrievedAt`.
  Wi-Fi `unavailable` and null visibility pass through unchanged.
  Device action entries require served membership and a matching observed revision;
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

## Inventory publication remains a separate install prerequisite

Persistent serve exposes cached Network reads;
there is no operational Network inventory import/refresh CLI or HTTP route.
The existing Rust setup API is `NetworkAccess::configure`,
under an original principal with explicit `ConfigureSource` approval.
Publication uses `NetworkAccess::retain_original`, `NetworkAuthority::new`
and `HostNetworkRuntime::refresh`,
under an original authenticated principal with explicit `PublishCache` approval
and the exact partition/entity grants.
The `healthy-network-root-router` example demonstrates this with a disposable
synthetic Editor and explicit lifecycle policy;
it is a verification fixture, not an installation tool.
Recorded documentary scene Network data is a separate reviewed original asset,
not a publication of the provider inventory cache.

The runtime's existing transport can GET the collector's `/api/inventory`
from a reviewed exact-loopback origin and decode its envelope.
That API can therefore publish collector inventory
when an authorized setup caller provides the original principal/grants
and the separately owned writable custody.
This stage supplies neither that caller nor writable stores;
persistent cached-provider mounting stays existing-only and read-only.
An install still needs that explicit setup/publication step from its owner.
