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

- `schemaVersion: 1`.
- `serverConfigurationDigest`: the existing ServerConfig.state_digest() value.
- `homeboxCached`: an array of registration/origin/limits entries.
- `networkCached`: an array of registration/origin/review/limits,
  connectTimeoutMs/idleTimeoutMs/staleAfterMs/privateDirectory/entities entries.

Both arrays are required and together contain at most eight entries. Registrations
use the existing complete shared sourceRegistration shape. Each registration
must select an exact configured workspace/home, the correct owner for its array,
and a unique partition. The original ProviderRegistry validates shared identity,
partition mode and allowlists. Unknown fields, including credential fields,
are rejected. The original typed builders validate endpoints, limits and reviews;
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
trusted-gateway serving branches use this same handoff, including the existing
measurement-enabled Host path. No additional listener or worker is started.

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
Startup refuses missing custody before invoking the original opener, rather
than bootstrapping a new sidecar/archive. Original database ownership, schema
validation, locks and SQLite reopening still apply. The existing opener may
perform its normal schema/connection maintenance; it performs no generation
publication or inventory request. Preparation creates no credential lease.

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

Seven generated in-process fixture sources cover paired argument parsing,
closed shape/scope/owner/registration limits, profile/configuration pin changes,
same-owner cached mounting without enrollment, absent-selection identity,
replacement-owner refusal, missing Network custody without bootstrap, and
explicit existing synthetic Network custody. No listener or provider exchange
is used. Fixtures, formatting, build and Clippy are UNRUN locally and delegated
to existing CI. No runner/workflow change is included. Source/CI success does
not establish installed, live-provider or deferred browser/device acceptance.
