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
receipts. Identical current hash pairs reuse their genuine geometry identities;
an explicit successor replaces only its selected lineage head. Every building
evidence append refreshes ALL descriptor keys, including untouched floors.
Before documentary custody, the actual scene owner performs a GET-only comparison
of the current scene, both exact retained documents, complete room mappings and
fresh native floor bindings. An identical verified scene reuses its native ID
without another upload or fabricated commit receipt.

Journals are mode0600, exclusively created, hash chained and file/directory
synced before dispatch. Unknown, partial, timeout, invalidated or unverified
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
one explicit partial successor retaining the other floor/history, unavailable
custody and association holds with passive reconciliation, selected-file fences,
normal-context composition, setup-failure own logout and HTTPS framing. These
checks establish protocol composition, not live persistence or browser rendering.
