# AT-11 access boundary

Version 0.1.3; frozen contracts 1.0.0; record schema 1; fixture
at06-synthetic/1; dedicated access SQLite schema 1. Tested runtime:
Node 26.10.0 / npm 11.19.1. This package adds no dependencies, listener,
account bootstrap, upstream client, production grants, OAuth provider or keys.
Tests provision disposable synthetic identities only.

## Exports and identity

`AccessStore`, `createAccessBoundary`, `hashPassword`, `AccessError`,
`errorResponse`, `readBoundedJson` and `SESSION_COOKIE` are actual exports.
The module consumes the sibling frozen contract helpers directly. Install those
exact dependencies with explicit `--ignore-scripts --no-audit --no-fund`.

`new AccessStore({filename})` uses Node's SQLite implementation. Omit filename
for disposable in-memory state. File-backed state persists credentials,
memberships, source quarantine/version, hashed sessions, restore epoch and rate
buckets. New/existing auth DB files are set to mode 0600; symlink DB paths and
unknown future DB versions are rejected. The operator must choose a private
directory and backup/recovery policy during target preflight. This is a separate
auth DB, not the Atlas record DB and not HomeBox's user database.

`hashPassword(password)` asynchronously derives a salted scrypt verifier
(N=32768, r=8, p=1, 32-byte result, 16-byte random salt). Passwords contain at
least 12 characters and at most 1024 UTF-8 bytes. Salt/verifier storage is server
only. Provisioning is an administrative seam requiring later approval for real
accounts; no provisioning route is implemented.

`createAccessBoundary({store, origins, resolveMedia?, now?, limits?})` accepts
only exact HTTPS origins. No wildcard, HTTP, forwarded-host inference or CORS
grant exists. `now` defaults to Date.now. Limits are trusted server config:
absoluteMs (default/max 7 days), idleMs (default 8 hours), maxBodyBytes (default
1 MiB, max 10 MiB), maxSessions (default 5), loginLimit (10 per 5 minutes per
trusted client and username), globalLoginLimit (60/minute), requestLimit
(300/minute per user, shared across all sessions, rotations and relogins). Login derivations are limited to four concurrent jobs
per boundary instance. Persistent rate buckets retain their own expiry windows.
Version 0.1.2 fixes review R1: request budgets use the stable server user ID,
not the rotating token hash. maxSessions remains an aggregate per-user count in
the persistent store across boundary instances. Token rotation retains the
original absolute session expiry and never resets either policy.

## Request and session functions

| Function | Behavior |
| --- | --- |
| `await boundary.login(request, {clientKey})` | POST JSON with exactly username/password. Trusted transport supplies clientKey, never an unvalidated forwarded header. Verifies server credential and rechecks user version after asynchronous derivation. Returns Response with actorId, CSRF nonce, absolute expiry and a new cookie. Any old presented session token is replaced. |
| `boundary.sessionInfo(request)` | GET returns actorId, expiry and a fresh CSRF nonce for page reload. This rotates the nonce; other tabs refetch before mutation. |
| `boundary.rotateSession(request)` | POST plus current CSRF rotates cookie/nonce, revokes old token, preserves original absolute expiry. |
| `boundary.logout(request)` | POST plus CSRF revokes token and expires cookie. |
| `await boundary.authorize(request, {workspaceId,homeId,action})` | Returns frozen `{principal,payload}`. Action is exactly read, history, media (GET/HEAD), or mutate (POST + CSRF). payload exists only for mutate. Viewer mutation is denied before body parsing or receipt replay. |

The cookie is `__Host-houseatlas-session`, Secure, HttpOnly, SameSite=Strict,
Path=/, without Domain. Random 256-bit token and nonce use base64url. Only SHA-256
token/nonce digests persist. Responses are private/no-store and do not enable
CORS. Duplicate cookies, bearer headers, URL token guesses, invalid sessions,
disabled users and version/epoch mismatches fail closed.

Every request URL must use a configured origin; its Origin header must match
that same origin. Unsafe requests require Origin and X-Atlas-CSRF. Safe browser
requests without Origin require both Sec-Fetch-Site: same-origin and a same-origin
Referer (including credential-free URL). Cross-site/sibling/null origins are
denied. This supports ordinary same-origin image/document GETs subject to the
integrated browser's headers; actual browser/proxy behavior is not yet tested.

Mutation bodies are read from the actual byte stream, not just Content-Length.
Version 0.1.2 fixes review R2: each accepted Uint8Array chunk is copied into owned
bytes before another read, so a producer may safely reuse its scratch buffer.
JSON requires application/json (optional UTF-8 charset), valid UTF-8, at most
64 nesting levels and no duplicate keys, including escaped duplicates. The
domain service must still apply frozen mutation/batch schema and graph checks;
body actor/role/home claims never select authority. The integrated HTTP server
must enforce connection/body timeouts, trusted TLS/proxy URL construction,
bounded concurrent requests and no credential logging.

Functions throw `AccessError`; `errorResponse(error)` produces frozen-schema
`apiError` with random requestId, null currentRevision and sanitized text. Unknown
errors become 503/upstream-unavailable. Statuses include 401 unauthenticated,
403 forbidden, 404 unavailable scope/resource, 405 wrong method, 413 byte limit,
415 content type, 422 invalid JSON/body and 429 rate limit. Contract code remains
invalid-contract or forbidden for the additional HTTP statuses; no schema edit
is required. Authentication helpers return Response; no router is mounted.

## Principal and synchronous transaction checks

Principal fields are exactly `{actorId,workspaceId,homeId,role}` with viewer or
editor role, derived from the verified credential and current server membership.
It is frozen and branded in one boundary instance's WeakMap. A copied object,
serialized principal, model claim or another boundary instance cannot use it.
Route workspace/home selectors are matched against server membership; they do
not grant scope. Missing membership yields 404 without foreign revision/details.

`boundary.revalidate(principal)` is synchronous and returns the same principal
after checking current persistent session, user, home membership/version,
expiry and restore epoch. `boundary.assertMutation(principal)` additionally
requires an editor principal issued by the mutate POST/CSRF path. An editor
read principal cannot become a write capability. Any membership change
invalidates old handles; fresh requests obtain current role. Handles expire
with their session and must not be serialized, persisted or sent to clients.

Storage's injected authorization callback must match its requested scope to
these server-derived fields, use assertMutation for mutate and revalidate for
read/history/asset-manifest reads, and authorizeSource for each cached source
reference. Cache publication/source configuration need separately authorized
internal server callers; an editor role does not grant these administrative
capabilities. HomeBox/Network writes are not access actions in this core package.

Storage must check before receipt replay and immediately before COMMIT,
including replay paths. Its record/audit/receipt transaction must roll back on
denial. Final graph validation and per-command assertFinalMutation remain
mandatory storage checks, independent of access validation.

`boundary.withMutationAuthorization(principal, synchronousCallback)` holds an
access-DB BEGIN IMMEDIATE writer fence around the callback. AT-13 can wrap
storage.execute/executeBatch with it. Other access-DB connections cannot commit
revocations/role changes until that fence releases. The callback must remain
synchronous and storage must still call assertMutation immediately before its
own COMMIT to detect elapsed expiry. Async functions are rejected; returning a
Promise is invalid. No callback may invoke access administrative mutations or
start external/provider work while holding this fence.

The tests prove an independent SQLite connection's revocation is blocked during
the fence, succeeds afterward, and then denies the existing principal. A separate
synthetic record transaction rolls back when the final access check detects
expiry. These are ordering/denial controls, **not distributed atomic rollback**
across the auth and storage DBs. Without the fence, a revocation can race between
a separate-store check and COMMIT. Authorization is evaluated at the final
precommit check while revocations are serialized by the fence; expiry after that
point does not retroactively cancel an already committed command. AT-13 must
compose and test this with AT-07. NAS lock/runtime behavior remains unqualified.

## Source partitions and sticky quarantine

Version 0.1.1 adds `boundary.authorizeSourcePartition(principal, selectors)` and
`boundary.revalidateSourcePartition(partitionGrant)`. Both are synchronous;
selectors must contain exactly `{workspaceId,homeId,sourceInstanceId,collectionId}`.
Version 0.1.3 counts collectionId's 4096-character ceiling in Unicode code points,
matching the frozen registration schema; astral characters retain their exact
opaque spelling and do not count as two UTF-16 units. No normalization occurs.
The selectors identify an existing server registration, whose enabled state and
version are checked together with the current branded principal. No externalId
is fabricated and no client registration/enable/owner claim supplies authority.
The result is an immutable instance-branded grant for partition availability
metadata only. It cannot become a principal, entity, media or mutation grant.
Copied grants, wrong scope/instance/collection, revoked state and changed source
versions fail closed. Revalidation returns the same grant and never re-enables
sources or clears quarantine.

AT-07 R3's exact internal callback is
`authorize(brandedPrincipal, {scope,capability:'read-cache',sourcePartition:
{workspaceId,homeId,sourceInstanceId,collectionId}})` for every configured scoped
partition, including cache rows with zero projections/complete empty generations.
The shared wrapper matches scope to principal and routes sourcePartition to
authorizeSourcePartition. Existing subsequent `read-cache` calls with
`source: <exact frozen sourceRef>` route to authorizeSource per entity/relation/
endpoint. Missing/ambiguous selector variants must fail closed. A successful
partition metadata check never replaces the per-entity checks. This additive
internal selector shape changes no frozen wire/source contract.

If the partition check is denied, storage returns an access-revoked view and no
cached rows even when there were zero projections to check. Expired/missing
sessions fail the whole request. Source/cache status and prior snapshots never
authorize this check. AT-07 owns that view behavior; AT-13 must test the actual
wrapper composition. AT-11 verifies the partition boundary independently with
empty entity allowlists, forged grants, changed versions and revocation/expiry.

`boundary.authorizeSource(principal, sourceRef)` is synchronous. sourceRef is
the exact frozen `{workspaceId,homeId,key:{sourceInstanceId,collectionId,
sourceKind,externalId}}`. It returns a frozen opaque source grant after current
principal validation and server-registry checks. Home, workspace, instance,
collection, owner and reviewed entity allowlist must match. Exclusive-home
registrations permit that home only; shared registrations have disjoint reviewed
allowlists. HomeBox UUIDs are canonical lowercase. Wrong/unregistered/revoked
partitions return 404 before cached projections or media metadata are released.

`boundary.revalidateSource(sourceGrant)` synchronously returns the same grant
only while principal and registration enabled/version remain current. It does
not enable sources, validate upstream credentials, lift quarantine or publish
any cache generation. Reenabled sources still invalidate old grants by version;
callers must reacquire authorization for each entity.

On AT-08 auth/wrong-scope failures, the shared service must persist disabled
source state before releasing any cache, and keep the old generation privately
for recovery. A full successful generation is only a staged revalidation
candidate. Filtered views and unrelated errors preserve quarantine. No adapter
result, cache timestamp, complete-generation label or model assertion grants
access. Administrative reenable requires separately qualified G2/source evidence
and complete staged read-back under the current exact registry. This package has
no generation/qualification-proof model and does not manufacture that evidence.
AT-13 owns orchestration/publication; AT-21 qualifies real source access.

## Media authorization

`await boundary.authorizeMedia(principal, descriptor, {mode})` accepts only
the frozen-reference forms `{kind:'homebox-attachment',entity:sourceRef,
attachmentId}` or `{kind:'atlas-asset',assetId}`. mode is preview (default) or
download. resolveMedia is trusted injected server code doing a scoped metadata
lookup, returning matching workspace/home, kind and attachment/entity or asset
ID, availability, contentType, byteSize and previewPolicy. Client metadata is
never used as that lookup. Session/member/source are rechecked after awaiting it.

Only available, bounded (10 MiB) reviewed metadata passes. Previews allow
safe-rendered JPEG/PNG/WebP/GIF. Download allows those plus PDF/text/plain with
safe-rendered/download-only policy. SVG, active HTML, external links,
unreviewed/blocked content, missing manifests and mismatched attachment/entity
are denied. Results contain kind/contentType/byteSize/mode only: no URL,
storageKey, server path, proxy credential or upstream token.

`await boundary.revalidateMedia(mediaGrant)` repeats the authoritative lookup
and checks, returning a fresh grant. AT-12 must call this at byte delivery after
awaited work, enforce actual content/size/redirect limits (initially zero), verify
owned asset digests and deliver safe derivatives or download responses. It owns
actual bytes, decoding/rendering, delete/recovery semantics and bounded streams.
The metadata grants alone do not prove byte safety or continuous authorization
after a response has already been delivered.

## Store interface and restore

All AccessStore operations except credential hashing are synchronous. Trusted
administration: putUser({userId,actorId,username,passwordVerifier,enabled?}),
setUserEnabled(userId,enabled), setMembership({userId,workspaceId,homeId,role,
enabled?}), putSource(frozenRegistration,{enabled?}),
setSourceEnabled(workspaceId,homeId,instanceId,collectionId,enabled),
revokeUserSessions(userId), invalidateAllSessions(), close(). Actor ID is immutable.
Credential and registration replacements preserve existing disabled state when
enabled is omitted; only explicit trusted administration can reenable them.
Source partition replacement validates the full registry inside one transaction;
overlap/owner conflicts roll back. Revocations survive reopen.

Internal reads: user/userByName/membership/source/session and epoch. Internal
session writes: insertSession/touchSession/replaceCsrf/revokeSession. consumeRate
uses durable bounded buckets; transaction(fn) is a synchronous BEGIN IMMEDIATE
transaction. These are implementation/store integration seams, **never routes,
MCP tools, browser functions or user-controlled grant APIs**.

The restore owner must drain requests/writers, call invalidateAllSessions()
before accepting traffic, and reconcile latest account/membership/source
revocations against the restored configuration. That operation rotates the
persistent epoch and deletes sessions/rate state. Old session rows are denied
even if reintroduced. Copying an old DB cannot automatically reveal that it was
restored; this module does not claim automatic restore detection or restoration
of later revocations. Target restore tests and approved private recovery remain
downstream responsibilities.


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
