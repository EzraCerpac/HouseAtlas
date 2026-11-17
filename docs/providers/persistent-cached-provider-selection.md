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
  it enables passive health/measurement GETs only when the existing owner
  explicitly refreshes inventory, never at cached-only startup or browse.
  Origins accept HTTPS or exact literal loopback HTTP with an explicit port.
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
trusted-gateway serving branches use this same handoff. No additional listener
or worker is started.

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
quarantine, publish a generation, fetch inventory, start a scan, schedule refresh
or create lifecycle authority. Missing durable registration, retained generation
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

