# Native Rust React core continuation

The first read slice landed through PR14 at main
`e9de66477c04c43eb74a29d932b22322115e33d5`, tree
`442de62b76aee515cfe1b56c37faccc77a337382`. This isolated development
continuation adds actual session/login/logout, frozen canonical reads and
fresh local Atlas single/batch writes. Composition does not accept unfinished
modules or authorize another main merge. Existing JavaScript sources remain
references; the running Rust service invokes no JavaScript semantic oracle.

## Exact module inputs

| Namespace | Exact input |
| --- | --- |
| Baseline generation/protocol, retained from main | 07576e6be463dd481b49071071c66dec144b1e0c |
| Access, including original-grant revalidation inside held fence | 4967dd2d38c5749be35aa7e44728c4d691246730 |
| Native semantics and documentation clarification | 003f9d6ae91418c793361894d47be0f8b258455c |
| Storage native dispatcher and borrowed per-call authorizer | 45e1e38e97a8e41536b4b6195449076d602589c0 |
| Domain and jobs, retained from main | 25813f1222c60379850da37b7bf7e97e0e2750db |
| React session shell and scoped-view corrections | a63f58529123e894b7c8709622c3c265cfb53b7c |
| HomeBox bounded HTTPS read and consuming publication proposal | 4db61b430797d528d4645c9958013a03af21ace3 |
| HomeBox native stock command component | c784be5776b614f8f0bb225fcb5355ecb9e90e0d |
| Network bounded HTTPS read and pending-failure proposal correction | 8b5f45531aef396e431a04e317ba60a29a54b513 |

Feature namespaces retain exact owner bytes. The generated frontend contract
file remains the baseline file because the React input does not carry it.
Integration owns root manifests/locks/module declarations, app/config/http/
lifecycle/main, narrow checks and central publication integrity. No feature
namespace correction is made here. HomeBox, Network and stock code compile as
library components; their provider operations are not mounted or executed.

## Actual running core

The binary accepts explicit disposable settings, creates private scratch state
under `/tmp` and binds TLS only to IPv4 loopback. It checks actual request
origin/authority and headers, derives the login client key from the connection
IP, bounds actual body streams, and passes original opaque authority to domain
and storage. All responses retain the private no-store/header adapter documented
in [read-corrections.md](read-corrections.md).

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
two HomeBox projections and one cache in one home. No real source, account,
grant, media or household configuration is supplied.

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

NativeContracts delegates schema, full graph, transition, guards, final candidate,
result and JCS semantics to the exact shared owner. Write intake checks canonical
raw routes, original mutation authority and CSRF before bounded JSON body parsing.
The parser preserves literal object keys, rejects duplicate decoded keys and uses
the reference root-depth-zero limit of 64. Numeric values avoid f64 rounding;
serde may normalize equivalent numeric token spelling before canonicalization.

Actual domain Commands call the actual SQLite command engine with a borrowed
per-call authorizer inside the access transaction fence. Source grants are
captured with the same mutation principal, then those original handles and the
independently computed native closure are revalidated at storage phases. Revision
errors use authorized transaction facts. Newly asserted source-presence claims
remain held; there is no replacement witness or source admission policy.

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

The source runner checks deterministic generation/history, actual locked Rust
library/binary/module source, rustfmt and Clippy, strict TypeScript and Vite. It
runs exactly healthy-contracts, healthy-dependencies and healthy-native-semantics.
The two browser runners use real Chromium with a disposable certificate, inspect
actual SQLite rows read-only, stop gracefully and delete scratch state. The core
runner adds real auth, eight canonical page/read requests, a fresh circuit create
and one fresh two-identity batch with successful record/history readback. Each
command is submitted once. See [core-continuation.md](core-continuation.md).
Optional screenshot/evidence outputs belong outside the source checkout.

CI checks exact PR-head source on Linux and macOS. Linux additionally runs both
named positive loopback scripts. The full file allowlist, modes, digests, owners
and unconfigured deployment template remain verified. macOS source compilation
is separate from target NAS build/runtime and operational qualification.

## Explicit remaining areas

The shared source-event timestamp parser has no public storage port yet;
NativeContracts returns typed unavailable instead of inventing another parser.
ConfigureSource and PublishCache have no trusted host authority binding. HomeBox
needs full durable registration access; Network needs the AT07 consuming failure
CAS. No old unfenced failure publication method is used.

The Network owner documents reqwest 0.12/WebPKI roots, while the shared host pins
reqwest 0.13.5 with Rustls platform verification for HomeBox. Both compile; that
TLS profile discrepancy requires owner reconciliation before combined transport
acceptance. No actual provider request has been made by these runners.

Stock preparation, captured whole-collection authority, verified route/binding,
durable operation activity/liability/approval/remote-end state and qualified
physical dispatch/readback remain unbound. StockTarget requires a UUID collection;
the legacy fixture's string collection ID is not normalized into one. Atlas
mutation receipts and the older synchronous jobs queue do not replace stock
activity or prove remote termination.

Storage validates its outer batch envelope after its transaction commits; this
owner correction is pending. Its error carrier lacks currentRevision; the root
adapter retains authorized Validate-phase precondition errors in a request-local
slot. The access fence and Atlas commit are two databases with an ordering
mechanism, not a distributed atomic commit or crash-recovery qualification.

Generated untagged mutation decoding can reject schema-admitted integers above
u64 within u128. Domain cache/projection schemaVersion and attachment size have
wider integral decimal/exponent limits. Full numeric fidelity remains unqualified;
no large-number or stopped negative-consumer probe is run.

Missing product areas include atomic presence witness admission/recovery, trusted
source setup and refresh, actual Network data/facet in the service, source-native
links and stock editing, immutable media delivery, backup/image validation and
recovery/export, aliases/mobility/navigation extensions, geometry import, agent/
MCP/WebMCP/AI transports, complete generated host DTOs, record editing UI and full
product routes. Media's unpublished policy correction is not mounted. There is
no JavaScript database migration/adoption or demonstrated alternate home yet.
Sanitized stock wire3 and presence specifications remain adopted under
[contracts/stock-wire3](../../contracts/stock-wire3/README.md); specifications do
not activate credentials, providers, grants, paid usage or deployment.

All stopped guard reversal, omission/mutation, adversarial/rejection, replay,
expiry, revocation, injected fault, crash and concurrency checks remain unrun.
The jobs checkpoint contains replay and is not executed. No broad test alias,
remote listener, provider/NAS call, live login/grant, deployment or security/
recovery/target/product acceptance is supplied by this development composition.
