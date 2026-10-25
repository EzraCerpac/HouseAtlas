# HouseAtlas MCP adapter — AT38

AT38 owns this namespace except the separately owned `lifecycle/` carve. This
local Atlas checkpoint is based on published dev
`256eff1ca38661fe09b4dacb0c44768a93ea2dc6`, whose sole publication root is
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. Root routes, startup configuration,
lifecycle, domain/access/storage handlers, contracts, manifests and locks are
unchanged by this checkpoint.

## Actual bindings

The existing public `http::agents::mcp::bind_read` composes the actual borrowed
root StockService with read admission: 30 Atlas list/get/history operations,
cached HomeBox reads, and configured HomeBox history. The separately owned
`lifecycle::mount_adapter::bind` also uses the host's read profile.

The existing private root Editor lifecycle binding selects the actual host
capability map under trusted `McpCommandProfile::ExistingEditorCommands`.
That map already includes 31 direct and six derived Atlas command IDs plus
ordered batches. These are real stock/SQLite handlers. AT38 adds no copy of
their transaction, graph, approval or result rules.

`bind_local_atlas(&Core, &access::RequestEvidence, &access::Scope)` exposes an
explicit in-process local Atlas binding. It returns
`Result<LocalAtlasSession<'_>, LocalAtlasBindError>`, where the session is the
existing `lifecycle::NativeSession<http::agents::mcp::StockService<'_>>`.
The error distinguishes actual Access issuance failure from protocol composition
failure, so the caller can use its existing error handling.

The binder obtains its retained AuthenticatedIdentity through the actual Access
POST issuance seam on `core.access`. That owner checks Cookie, Origin, current
CSRF, scope and Editor membership. Admission derives from the actual
`http::agents::capabilities::admitted(core, original)` and is narrowed to Atlas,
excluding asset download. At this source pin it admits 30 reads, 37 command IDs
and `atlas.batch.execute`. NativeCatalog checks the root and every ordered
child independently; schema family membership creates no admission.

For host composition, pass actual observed initial POST evidence to the binder.
On each subsequent frame, authenticate that frame with
`AuthenticatedIdentity::authenticate_post(core.access.clone(), observed, scope)`
and pass its identity and original bytes to `session.handle`. The unchanged
lifecycle checks the same Access Arc, credential binding and scope, retains the
original principal, and revalidates before delivery. The concrete stock service
forwards the full request to the shared native stock dispatcher. The existing
native mutation fence and result/disclosure checks still apply.
`session.control()` and `session.close()` are the existing lifecycle APIs.

This is a mount proposal for a trusted local caller. It changes no HTTP route,
startup profile, registry, main or listener. The root default read profile and
opt-in Editor binding remain separately owned.

`approvalReceiptId`, its omission/null distinction and the original stock intent
reach the native owner unchanged. This binding adds no consent issuer, receipt
minting or grant API. The positive uses ordinary local forms with a null receipt.
Source-presence claims, staged asset creation, rendered-media approval forms and
provider writes still require their existing owner inputs and qualification.
This Core-only composition has no download handle issuer/redemption owner.

## Catalog and result preservation

NativeContext retains opaque original authority. NativePrincipalPort delegates
provenance, scoped capability, mutation issuance and current revalidation to
Access. Annotations and client metadata establish no authority.

OperationMapping joins all 168 published IDs in the shared/domain catalogs.
ToolName wraps their existing ten-family enum. Mapping coverage is distinct
from actual host admission. NativeSchemas accepts the exact offline resources
and retains their transitive definitions and literal values:

- Agent schema SHA-256:
  `44afff94ad51135282e0a34c1efd1ad77e240dd55bd8dff13cfb8120cdf4b5ca`.
- Atlas schema SHA-256:
  `c7c380b317e3cc640c8c437bf360e5f04d443f91ec03a54cc0f23a98b5a13b0c`.

Full wire3 envelopes remain tools/call arguments. Shared StockRequest and domain
ValidatedRequest preserve original IDs, intent digests, explicit unknowns/nulls,
omissions, numeric tokens and ordered children. NativeCatalog validates the real
owner's StockResponse and ordered child results before rendering. Owner errors
use their canonical correlated stock DTO; generic failures expose static
categories without fabricating a successful outcome.

NativeStockService remains the generic owner-port composition. The independent
AssetDownloadCodec preserves canonical token/metadata and delegates release to
an actual download owner. UnavailableCommands and UnavailableAssetDownloads
remain explicit unavailable peers; this local binder uses neither.

MCP revision is `2025-11-25`, with initialize/initialized, ping, tools/list and
tools/call over a serialized host-framed session. The bounded decoder retains
arbitrary-precision Numbers, request IDs and literal object keys. The host owns
framing, connection lifetime, idle clocks and transport-level admission.

## Catalog-to-admission parity, version 1

Source baseline: public main `b7abc9d87b90d3a6eab9efb386edf252f72daf60`,
25 October 2026; related issue #288. The shared wire3 catalog contains 168
operations in ten families. This bounded change addresses discovery of top-level
request arms, not the complete operation qualification matrix.

Previously `NativeCatalog` published the full family input union even when the
host admitted only two reads. It now selects the host-admitted operation schema
references in canonical family order before materializing their offline
definition closure. Empty families remain absent. This matches WebMCP's existing
top-level arm selection in `frontend/src/webmcp/stock.ts`. The shared catalog,
full `NativeSchemas::schema` API and family output schemas remain unchanged.

| Surface | Actual admission/service owner | Disposition and evidence boundary |
| --- | --- | --- |
| Native discovery | `NativeCatalog` with the host's exact operation set | Only admitted top-level input arms; unadmitted arms are omitted. Synthetic descriptor fixtures cover all ten families and an admitted two-read catalog. Checks NOT RUN locally; existing CI owns execution. |
| Native read profile | `http::agents::mcp::bind_read`, shared StockService | Existing Atlas/cached HomeBox and configured-history admission retained; mapping an ID alone supplies no provider binding. |
| Mounted native profile | `bind_owned_admission`, OwnedStockService | Existing scoped Network/HomeBox bindings, Editor profile and download owner retained. No new admission or owner is supplied here. |
| Local Atlas profile | `bind_local_atlas`, shared native stock dispatcher | Existing Access/SQLite read, command, batch and reopened-history fixture retained. Core-only binding still has no asset-download issuer/redemption owner. |
| WebMCP | Current session/scope, injected schema/service/catalog/download owners | Existing top-level input selection retained. Browser registration, visible completion and installed integration remain NOT RUN here; interactive browser/device acceptance is DEFERRED. |
| Batch children | Canonical batch schema and native recursive admission | Nested request unions are unchanged in both transports; native `prepare` checks every ordered child separately. Nested discovery narrowing and full batch outcome qualification remain open. |
| Upload/remap/large operations | Existing dedicated capability/domain owners | No new binding or support claim. Complete transfer, limits, delayed/unknown outcomes and live qualification remain open under #288. Access lifecycle #289 and maintenance callers #290 are separate. |

`healthy_admitted_family_input_descriptors` checks single-arm selection with an
unrelated admitted family, unchanged reachable definitions, offline descriptor
compilation and an absent-family result. The existing
`healthy_native_catalog_context_and_core_reads` fixture now checks that its
two admitted read arms are exactly advertised, while another schema-valid read
is excluded without dispatching it. These are synthetic in-process unit cases
in the existing backend test lane. No local compilation, Clippy or tests were
run for this change; CI results must be tied to the eventual PR head. Existing
source fixtures are not evidence of installed or live acceptance.

## Exact ordinary positive

The complete `healthy_local_atlas.rs` body and fixture bootstrap helpers are
inspected separately before execution. It uses fresh private
`/tmp/houseatlas-at38-local-atlas-*` state, real Access login/per-frame POST
issuance and the actual StockService. It commits one circuit create, unresolved
binding create and binding review, then a fresh ordered two-circuit batch.
The review's `rejected` business status is an ordinary successful commit.

It checks wire3 correlation, intent digests, nullable circuit fields, unresolved
source state, record/audit ordering, text/structured-content equality and normal
session closure. After closing and strictly reopening the same SQLite Store,
MCP get/history checks record payloads and each committed audit ID, actor,
target and original child intent digest. It removes the private fixture.
No command, authority or result peer is stubbed in this body.

With pinned workspace dependencies and Rust/Cargo 1.99.0:

```sh
cargo fmt --all --check
cargo check --locked --offline -p houseatlas-backend --lib --bins
cargo clippy --locked --offline -p houseatlas-backend --lib --bins -- -D warnings
cargo test --locked --offline -p houseatlas-backend --lib transports::mcp::healthy_local_atlas::healthy_local_atlas_native_mutations_batch_and_reopened_history -- --exact --test-threads=1
```

The published root now declares its test dependencies. No external compiler
harness, dependency, manifest or lock change is needed. Test-binary compilation
does not execute other tests. Only this named positive body runs here. Older
fixture-peer examples remain representation proof and are not rerun as an
aggregate. Exact source/compiler/test evidence is in the integration packet.

Bounded independent Luna review is source-only. Lifecycle controls, replay,
expiry, revocation, guard reversal, adversarial/fault/crash/concurrency/denial
and negative-consumer controls remain deferred. No live provider, OAuth grant,
remote endpoint, private household data or deployment is used. Ordinary success
qualifies the reported synthetic path only.
