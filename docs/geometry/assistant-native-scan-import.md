# Assistant-managed native scan intake

`tools/geometry/native-scan-import.mjs` supplies reviewed files directly to the
existing native operations. It introduces no import page, navigation control,
backend route, account, persistent credential or permission grant. The command
compiles the real locked frontend clients and decoder; source and executed-module
hashes are recorded in the private journal. Node 26.10.0 and the existing locked
frontend dependencies are required. The scene phase is described in
[the scene adapter contract](assistant-native-scan-scene.md).

The agent selects a private manifest and its independent SHA-256. Every selected
file has an absolute canonical nonsymlink path, exact size, SHA-256 and filename.
The command reads owned immutable bytes, checks identity before/after reading,
and validates the original/derivative pair with the production authored-mesh
decoder and current converter pins before sign-in or an application write.

The closed manifest has schema `houseatlas.agent-native-scan-import.v1`, a
canonical HTTPS `origin`, actual `scope` (`workspaceId`, `homeId`), `buildingId`,
`semanticsId`, `reason`, `statement`, `sourceLicense`, an explicit complete
`expectedCurrentGeometryIds` list, `floors` and `scene`. Each of at most three
floors supplies `sourceFloorKey`, `sourceOriginalSha256`, `exportLabel`, `original`,
`derivative`, and `previousGeometryId` (null for an independent first version).
Each file pin supplies `path`, `bytes`, `sha256`, `filename`. Source-document
hashes and source keys remain separate from native USDZ hashes and floor keys.

The retained USDZ framing profile accepts its earlier central-directory form
and a mirrored alignment-padding form. Nonempty central extras must exactly
match the local extra bytes: one 4–67-byte `0x1986` field with its declared
length and zero-filled payload. All stored-member, CRC, offset, size, 64-byte
alignment, root-USDC/PNG and archive-closure checks still apply. This retains
original archive bytes; it does not execute USD or establish physical geometry.

`scene` is null for geometry only, or supplies `primary` and `historical` text
file pins, the complete selected `sourceFloors` source-key/hash pairs,
`roomMappings`, `statement`, `reason`, and deliberate `confirmDrawingSupport`.
Package room keys/UUIDs never become native room IDs. Physical scale, registration
and unreviewed fixture positions remain unknown. Preflight checks the reviewed
source envelope before geometry writes; the actual scene owner performs fresh
native guards, retained-document checks and current-head source reopening.

## Normal access and execution

The fixed existing route is `socks5h://127.0.0.1:11080`. Curl verifies ordinary
HTTPS certificates and disables `.curlrc`; it sends no caller identity headers
and follows no redirects. Normal `/auth/proxy` sign-in uses the existing gateway
WhoIs policy. Cookies/CSRF remain in memory and anonymous pipes, never arguments,
files or journals. Current session and Stock admission are read and checked.
The retained scene-head read uses the exact scoped native `/scene/v1/.../head`
GET. It accepts no selectors or mutation method. The server validates the entire
chain from one authenticated snapshot and returns only scoped head ID, revision
and canonical payload SHA-256 within 4096 bytes. Historical document payloads are
not downloaded together; metadata and document byte limits stay unchanged.
Native-only asset and scene commands are reported in the server's separate
`nativeCommandIds` metadata, under the same existing Editor/scope checks.
They remain absent from the generic Stock/MCP catalogue. The command requires
that genuine metadata and combines the two lists privately for the existing
native clients; it never supplies missing capabilities itself. Installed sources
without this field cannot run the command. Metadata grants no execution authority:
each existing POST route independently authorizes its current principal.
Every command attempts logout of its own expiring session. Sign-in can evict an
older same-user session at the existing five-session limit; logout cannot undo
that eviction. Unreadable issuance cannot confirm retirement of a new session.

Inspect the complete selected tool/transport/runtime and client source first:

```sh
node tools/geometry/native-scan-import.mjs validate --manifest /absolute/private/selection.json --sha256 ACTUAL_MANIFEST_SHA256
node tools/geometry/native-scan-import.mjs preflight --manifest /absolute/private/selection.json --sha256 ACTUAL_MANIFEST_SHA256 --origin https://SELECTED_HOST --proxy socks5h://127.0.0.1:11080
node tools/geometry/native-scan-import.mjs apply --manifest /absolute/private/selection.json --sha256 ACTUAL_MANIFEST_SHA256 --origin https://SELECTED_HOST --proxy socks5h://127.0.0.1:11080 --journal /absolute/private/new-journal
node tools/geometry/native-scan-import.mjs inspect --manifest /absolute/private/selection.json --sha256 ACTUAL_MANIFEST_SHA256 --origin https://SELECTED_HOST --proxy socks5h://127.0.0.1:11080 --journal /absolute/private/existing-journal
```

`validate` is entirely local. `preflight` signs in and reads current admission
and selected geometry, with no application write. `apply` requires a create-only
journal under an existing canonical mode0700 parent. It performs each original,
derivative and guarded association once, preserving exact requests and correlated
receipts. Identical current hash pairs reuse their genuine geometry identities
only when both retained source licenses match the selection. A license correction
requires an explicit predecessor and new guarded custody; it cannot silently
reuse differently licensed assets. Explicit predecessors also disambiguate
distinct native floors with identical bytes. A successor replaces only its
selected lineage head. Every building
evidence append refreshes ALL descriptor keys, including untouched floors.
Before the first asset upload, a GET-only capacity observation checks the entire
ordered nonreused floor set against the current building/classification evidence,
predecessors, 100-record/guard limits and 16 KiB association batches. It accounts
for every proposed evidence append and the maximum published revision width.
The journal records counts and observed revisions; this creates no records or
commit admission. Each actual association still rereads current records and
prepares its existing guarded batch after genuine asset custody.
For a scene-bearing selection, the host first projects the final current floor
set from retained heads, selected predecessors and independent additions. Every
untouched floor must be selected for reuse, and the complete final scene must
stay within three floors. Incomplete or oversized coverage stops before custody.
Before any geometry write, the same scene owner captures the qualified current
scene (or genuine absence) under its current session. After descriptor keys change,
it revalidates the complete authenticated native scene chain through its compact
head read, requiring the captured head's exact revision and canonical payload
digest. Unavailable references, archived or ambiguous chains and any newer head stop documentary
custody. This read observes one point in time; the command still submits its
predecessor guard; the backend still checks the actual current head atomically.
Before documentary custody, the actual scene owner performs a GET-only comparison
of the current scene, both exact retained documents, complete room mappings and
fresh native floor bindings. An identical verified scene reuses its native ID
without another upload or fabricated commit receipt.
After either save or reuse, the host checks every saved source-floor binding
against its final descriptor read, including the native key, geometry revision,
original asset ID and hash. Matching geometry IDs alone cannot produce a
completion event after an unrelated evidence append changes the descriptor keys.
A fresh GET-only scene owner then verifies the exact expected current ID/payload
and retained documents before the terminal event. These checks describe their
read points; a later independent write can supersede the scene afterward.

Journals are mode0600, exclusively created, hash chained and file/directory
synced before dispatch. Each of at most 128 events has an 8 MiB storage bound:
an individually bounded 1 MiB response can require six times as many bytes when
JSON escapes its control characters. JSON-string mutation bodies and individual
responses remain bounded to 1 MiB. Multipart uploads retain the existing 11 MiB
transport bound and file-specific limits; only their metadata (16 KiB) enters the
journal. Mutation paths are bounded to 8 KiB before dispatch.
The fully encoded event remains size-checked and exact bodies reopen unchanged.
Unknown, partial, timeout, invalidated or unverified
results stop the operation. Preserve that journal; do not start a new application
attempt to work around a hold. `inspect` only reads exact retained Stock intents,
current geometry and the original claimed scene ID/payload through the actual
scene/document readers. A lost multipart response lacks its server-issued asset
intent: its exact UUID/path/metadata remain explicitly unresolved. Scene commands
use their own exact current-head inspection and are never misread as Stock
requests. It reports whether that exact current scene was verified without
clearing an original hold or manufacturing a receipt. Missing records do not
prove rollback or retry safety.

## Bounded synthetic qualification

The README registers the exact local command below and each separately named
scene case. Inspect their complete bodies first. They use generated files and
fake responses through actual production factories, with no curl execution,
listener, browser, credentials, provider, household input or native database.

```sh
node --test --test-concurrency=1 tools/geometry/native-scan-import.test.mjs
```

It covers two-floor custody and descriptor refresh, identical no-POST reuse,
one explicit partial successor retaining the other floor/history, license-aware
reuse/correction, identical-byte predecessor selection, prior-scene capture before
custody, unavailable
custody and association holds with passive reconciliation, selected-file fences,
normal-context composition, setup-failure own logout, maximum escaped journal
body reopen, pre-custody full-record/UTF-8 batch/later-floor capacity and HTTPS
framing, plus omitted-current-floor and oversized projected-scene holds before
geometry custody. Those host checks use a scene orchestration marker; the
separately named scene cases exercise the real document parser and scene clients.
The later-floor check makes at most forty small fake GET-only observations
to find a full-set capacity threshold; it does not classify the refusal as the
byte ceiling versus another existing batch bound. No original is uploaded.
These
checks establish protocol composition, not live persistence or browser rendering.
