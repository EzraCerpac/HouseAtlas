# Native Rust React core and owned-media continuation

The first read slice landed through PR14 at main
`e9de66477c04c43eb74a29d932b22322115e33d5`, tree
`442de62b76aee515cfe1b56c37faccc77a337382`. This isolated development
continuation adds actual session/login/logout, frozen canonical reads and
fresh local Atlas single/batch writes and native owned-original delivery.
The separate PR16 core checkpoint remains pinned at
`915d9baae6710d23e29f34da488df1de493a2c0c`, tree
`f50c85c046f24690bdd10126c5dd277a6f495b2b`. Composition does not accept unfinished
modules or authorize another main merge. Existing JavaScript sources remain
references; the running Rust service invokes no JavaScript semantic oracle.

## Exact module inputs

| Namespace | Exact input |
| --- | --- |
| Baseline generation/protocol, retained from main | 07576e6be463dd481b49071071c66dec144b1e0c |
| Access, including original-grant revalidation inside held fence | 4967dd2d38c5749be35aa7e44728c4d691246730 |
| Combined native core/stock contracts and raw-current/timestamp peer exports | 49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c |
| Storage native dispatcher, stock transactions, precommit batch envelope and recovery transition source fix | 9425ffc54e45d4ee779f3282e8dc29414676c7ad |
| Domain direct native semantics/storage and stock schema bridges | f51bc7962b491faa1cc563f2ec0f737c471e4e26 |
| Jobs/stock boundaries | f35bcdc2d9c24646356bc080bfb1ef157120bcb3 |
| Media native access/storage/runtime, preview policy and native schema-2 recovery port | 80194a0e0f098cef85d71db602a78ae52db6bcad |
| React session shell, scoped-view corrections and configured Sign out | 0ddd0bf42a91d6ccf179dbd5bdb6735459d28f0c |
| HomeBox full durable-registration read/publication binding | 5ccbe1863728676cb8a8d51023f68a20121a8c18 |
| HomeBox native stock command component | c784be5776b614f8f0bb225fcb5355ecb9e90e0d |
| Network bounded HTTPS read and native fenced publisher; README-only clarification above be62191 | cf08025ed5b38ec3a8ded7db92db140493232a7a |

Feature runtime and fixture sources retain exact owner bytes. Domain's README
has the parent's approved privacy-only adaptation: private per-run paths and
evidence fingerprints stay in external provenance, while public API, dependency,
limitation and technical scope remain intact. Other owner documentation remains exact.
The generated frontend contract
file remains the baseline file because the React input does not carry it.
Integration owns root manifests/locks/module declarations, app/config/http/
lifecycle/main, narrow checks and central publication integrity. No feature
runtime correction is made here. HomeBox and Network compile as library
components; their provider operations are not mounted or executed. Native Atlas
stock record reads, fresh bounded writes and audit history are mounted below.

## Actual running core

The binary accepts explicit disposable settings, creates private scratch state
under `/tmp` and binds TLS only to IPv4 loopback. It checks actual request
origin/authority and headers, derives the login client key from the connection
IP, bounds actual body streams, and passes original opaque authority to domain
and storage. All responses retain the private no-store/header adapter documented
in [read-corrections.md](read-corrections.md).

The disposable binary establishes creation mask `0077` before starting runtime
worker threads, so owner-created temporary staging retains private modes without
depending on the launcher's mask. After creating the private disposable directory,
the host supplies its actual canonical directory identity to media and SQLite.
This accommodates system-level temporary-root aliases while preserving the
owners' canonical-path, inode, no-follow, private-mode and durability checks.
Media startup errors identify only the fixture phase and public error category;
they include no credentials or paths.

The root HTML supplies the React owner's session/login/logout and scoped-view
host attributes. Real React renders Home, Rooms & places, room/item details,
Settings, successful sign-out and successful sign-in. HomeBox edit capability,
media URLs and navigation links remain absent where no capability is issued.
The UI still has product placeholders and does not expose record editing forms.

The fixture provisions disposable viewer/editor users through real access APIs
with random passwords and salted scrypt verifiers. A mode-0600 scratch receipt
transfers credentials to the inspected healthy browser script; credentials,
cookies and CSRF never enter Git or emitted evidence. Both actual databases
reopen before HTTP. Initial state contains six published synthetic records,
two HomeBox projections and one cache in one home. Two generated public synthetic originals are prepared in the real private vault;
no asset record exists until its fresh healthy command commits through the native
runtime availability proof. No real source, account, grant, media or household
configuration is supplied.

GET browser extensions are `/api/atlas/view`, `/rooms`, `/items`, `/homes`,
`/auth/session`, and `/homes/{workspaceId}/{homeId}/view`, under `/api/atlas`.
POST `/api/atlas/auth/login` and `/logout` use the actual access boundary.
Canonical routes under
`/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}` include GET `view`,
`records`, `homebox/entities`, `network/relations`,
`records/{recordType}/{recordId}` and its `history`; POST the record's
`mutations` endpoint or the home's `mutations` endpoint executes real commands.
The frozen history response stays a bare ordered audit array.

Pagination uses bounded opaque process-local cursors tied to the actual session,
actor, home, collection, page size and complete authorized snapshot digest. Each
page captures and releases its own original grants. It does not retain the first
page's authorization epoch across future requests. Only successful continuation
is demonstrated; stopped expiry/revocation/replay/concurrency controls remain unrun.

NativeContracts delegates the full storage contract to the accepted domain
NativeSemantics adapter and its exact shared contract owner, including the public
raw-current transition and finite timestamp exports. NativeScopedCommands and
NativeStorage supply the domain command/read adapters; their owner implementations
retain the original per-call authorizer. Write intake checks canonical
raw routes, original mutation authority and CSRF before bounded JSON body parsing.
The parser preserves literal object keys, rejects duplicate decoded keys and uses
the reference root-depth-zero limit of 64. Intake retains numeric values without
f64 rounding, although serde may normalize equivalent token spelling. Shared JCS
and persisted canonical JSON use the finite ECMAScript/f64 numeric model and its
rounding boundary; see the owner's [canonical numbers and timestamps](../../backend/src/contracts/semantics/README.md#canonical-numbers-and-timestamps).

Actual domain Commands call the actual SQLite command engine with a borrowed
per-call authorizer inside the access transaction fence. Source grants are
captured with the same mutation principal, then those original handles and the
independently computed native closure are revalidated at storage phases. Revision
errors use authorized transaction facts. Newly asserted source-presence claims
remain held; there is no replacement witness or source admission policy.

Owned media is delivered at
`/api/atlas/media/{workspaceId}/{homeId}/{descriptorDigest}/{preview|download}`.
The descriptor digest uses the shared native JCS implementation. The handler
authorizes the actual request through NativeMediaAccess, resolves only a scoped
stored asset, and passes the original retained principal to MediaService. Its
NativeMediaStorage adapter reads the same SQLite store; the vault verifies actual
retained bytes and applies the reviewed preview policy. Original opaque grants
are revalidated before release. GET and HEAD preserve content length, disposition,
sandbox CSP, same-origin resource policy and private no-store responses. The
request budget checks cancellation cooperatively; synchronous filesystem work
and async network release are not a qualified hard-deadline or concurrency proof.
HomeBox media transport, uploading and recovery remain unavailable.

The intake correction carries the root bounds and exact React successor in
[intake-correction.md](intake-correction.md). The stock read route and original
authority/snapshot binding are documented in [stock-reads.md](stock-reads.md).
The bounded fresh native stock transaction binding is documented in
[stock-writes.md](stock-writes.md).
Native audit search/paging is documented in [stock-history.md](stock-history.md).

## Ordinary verification

Inspect script bodies first; use Rust 1.99.0, Node 26.10.0 and npm 11.19.1.

    npm ci --ignore-scripts --no-audit --no-fund
    npm ci --prefix packages/contracts --ignore-scripts --no-audit --no-fund
    npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
    export CARGO_TARGET_DIR=/tmp/houseatlas-at52-target
    npm run verify:publication
    node tools/rust-integration/check-source.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-loopback.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-core-loopback.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-media-loopback.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-stock-loopback.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-stock-write-loopback.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-stock-history-loopback.mjs

The source runner checks deterministic generation/history, actual locked Rust
library/binary/module source, rustfmt and Clippy, strict TypeScript and Vite. It
runs exactly healthy-contracts, healthy-dependencies and healthy-native-semantics.
The six browser runners each use fresh real Chromium with a disposable certificate, inspect
actual SQLite rows read-only, stop gracefully and delete scratch state. The core
runner adds real auth, eight canonical page/read requests, a fresh circuit create
and one fresh two-identity batch with successful record/history readback. Each
command is submitted once in its disposable service. The media runner adds two
fresh asset creates, record/history readbacks, exact-original download GET/HEAD
for PNG and text, and safe-rendered PNG preview. It does not request text preview
or PNG preview HEAD. See [core-continuation.md](core-continuation.md) and
[owned-media.md](owned-media.md).
The stock runner retains that healthy flow and compares stock circuit/asset
GET results with actual frozen SQLite reads. It adds four sequential GETs and
no additional command or stopped control.
The stock write runner additionally submits one fresh circuit and one ordered
identity-create batch through the actual stock owner, followed by three frozen
record/history pairs and read-only stock journal counts. Each root is sent once.
The stock history runner adds three actual native first-page/search reads over
those stock-owned audits. Each target has one event; nonnull cursor continuation
is not demonstrated.
Optional screenshot/evidence outputs belong outside the source checkout.

CI checks exact PR-head source on Linux and macOS. Linux additionally runs all six
explicitly named positive loopback scripts. The full file allowlist, modes, digests, owners
and unconfigured deployment template remain verified. macOS source compilation
is separate from target NAS build/runtime and operational qualification.

## Explicit remaining areas

ConfigureSource and PublishCache have no trusted host authority binding. Storage
now supplies full durable registration access and the consuming failure CAS;
provider owners still need genuine publication authority and original-fence
handoff. No old unfenced failure publication method is used.

The Network owner documents reqwest 0.12/WebPKI roots, while the shared host pins
reqwest 0.13.5 with Rustls platform verification for HomeBox. Both compile; that
TLS profile discrepancy requires owner reconciliation before combined transport
acceptance. No actual provider request has been made by these runners.

Provider stock preparation, captured whole-collection authority, verified route/binding,
durable operation activity/liability/approval/remote-end state and qualified
physical dispatch/readback remain unbound. The separately accepted stock-contract
checkpoint is now consumed through the combined owner head above, preserving
both core peer exports and stock internals. Catalogue/schema compilation does
not establish executed operation completeness. Only ten Atlas record-get arms
have a root authority/read binding. Fresh circuit create and ordered identity
create batches additionally use actual domain preparation and the native atomic
stock executor under the original AT11 mutation fence. Native stock audit history
uses actual retained stock linkage, search and owner cursor transactions; other
commands remain unbound. StockTarget requires a UUID collection;
the legacy fixture's string collection ID is not normalized into one. Atlas
mutation receipts and the older synchronous jobs queue do not replace stock
activity or prove remote termination.

Storage validates its complete outer batch envelope before writes and commit.
Its error carrier lacks currentRevision; the root
adapter retains authorized Validate-phase precondition errors in a request-local
slot. The access fence and Atlas commit are two databases with an ordering
mechanism, not a distributed atomic commit or crash-recovery qualification.

Generated untagged mutation decoding can reject schema-admitted integers above
u64 within u128. The accepted domain successor preserves bounded integral decimal/exponent
carriers for cache/projection schemaVersion and attachment size; generated DTO
carrier limits remain. Full numeric fidelity remains unqualified;
no large-number or stopped negative-consumer probe is run.

Missing product areas include atomic presence witness admission/recovery, trusted
source setup and refresh, actual Network data/facet in the service, source-native
links and stock editing, HomeBox media/uploading, backup/image validation and
recovery/export, aliases/mobility/navigation extensions, geometry import, agent/
MCP/WebMCP/AI transports, complete generated host DTOs, record editing UI and full
product routes. Native recovery remains unmounted. Media now derives its native
profile from the compiled storage schema2 implementation and calls actual
native backup/image-validation ports. The native-only image validator refuses
nonempty stock journals pending a stock-aware companion. The published owner
source fix adds adjacent tombstone/restore payload-preservation and native
immutable/append-only transition checks. The parent independently accepted the
native core recovery peers within ordinary empty-stock scope; this host has not
mounted recovery or executed a modified-image probe. Operational recovery,
populated-stock images and target/runtime fault qualification remain unavailable.
No modified-image probe or substitute image validator is supplied. There is
no JavaScript database migration/adoption or demonstrated alternate home yet.
Sanitized stock wire3 and presence specifications remain adopted under
[contracts/stock-wire3](../../contracts/stock-wire3/README.md); specifications do
not activate credentials, providers, grants, paid usage or deployment.

All stopped guard reversal, omission/mutation, adversarial/rejection, replay,
expiry, revocation, injected fault, crash and concurrency checks remain unrun.
The jobs checkpoint contains replay and is not executed. No broad test alias,
remote listener, provider/NAS call, live login/grant, deployment or security/
recovery/target/product acceptance is supplied by this development composition.
