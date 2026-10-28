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

## Catalog-to-admission parity, version 3

Source baseline: public main `21c769e2dc947396acffafca04278249d215d8c8`,
28 October 2026; related issue #288. The shared wire3 catalog contains 168
operations in ten families. This bounded change addresses discovery of admitted
request arms and batch children, not the complete operation qualification matrix.

Previously `NativeCatalog` published the full family input union even when the
host admitted only two reads. It now selects the host-admitted operation schema
references in canonical family order before materializing their offline
definition closure. Empty families remain absent. Both transports now also
intersect the canonical batch's 39 eligible child references with the complete
host-admitted command set, retaining canonical order and other constraints.
WebMCP receives that full set separately from the current family's top-level
references, so eligible children in other families are retained. No eligible
child produces `items: false`, preserving the canonical 1–100 item bound without
an invalid empty `oneOf`. Omitted WebMCP admission supplies no child support.
The shared catalog,
full `NativeSchemas::schema` API and family output schemas remain unchanged.

| Operation surface / class | Actual service and admission | Limits / disposition | Evidence boundary |
| --- | --- | --- | --- |
| All 168 IDs / ten families | OperationMapping joins shared/domain metadata; NativeCatalog selects host IDs and batch children | Metadata maps every ID; it supplies no execution authority | Existing descriptor fixtures; mapping is not operation acceptance |
| Atlas list/get/history reads | Borrowed StockService uses reads_for(core); native authorization/query owners execute | Thirty Atlas reads plus four cached HomeBox reads; configured history is conditional | Native circuit-list continuation and binding-history fixtures exist; no installed acceptance inferred |
| Mounted Network/HomeBox reads | OwnedStockService adds only scoped configured bindings; routes to saved Network or native HomeBox owners | Binding/partition and current principal must match; cached reads never demand collection | Provider #285 and installed-operation qualification remain separate |
| Atlas writes / ordered batches | Explicit Editor composition plus native direct/derived command planner | Each child must be admitted; domain guards/approval/atomic result owners remain unchanged | Existing real Access/SQLite synthetic command/batch/history and bounded-response cases; not broad live-write acceptance |
| Asset download | Mounted host has real issuer/redemption handles; Core-only local binding excludes it | A link/token is not completed original transfer | Full byte/expiry/current-authorization transfer matrix remains open |
| WebMCP / seven bindable families | Current session/admission intersected with owner-supplied executable IDs in bindCommandFamilies | Family presence is not service binding; canonical batch children also intersect full admission | Registered synthetic adapter/batch checks are separate from React/gateway and deferred browser/device acceptance |
| Bridge houseatlas_read / read effect | Fresh native admission intersected with shared catalog effect=read; native invoke owns domain validation | PageSize 1–8, envelope 16 KiB, query 32 KiB, response 2 MiB and JSON bounds | New public evidence-list examples and existing named bridge regression extensions are NOT RUN locally; no private probes |
| Bridge provider writes / generic upload / scene creation | No generic bridge owner for these surfaces; write facade permits only its existing Atlas WRITES/batch set | UNSUPPORTED through this facade; genericAssetUpload and genericSceneAssociationCreate are false | Dedicated native owners and #285/#287 qualification are not enabled by catalog/schema presence |
| Bridge unbounded records / chunked generic read | No qualified generic chunked/streaming owner | UNSUPPORTED; pageSize reduction cannot split an oversized single record | Source profile explicitly reports unboundedNativeReadComplete=false |
| Remap / receipt-dependent variants | Existing native owner and separate exact-impact confirmation owner | CONDITIONAL/UNBOUND when required owner/receipt is absent; no grant expansion here | Exact-impact and complete outcome/transfer acceptance remain open |

Static catalog disposition (not host admission): 154 operations are
`supported-pending-qualification`, nine are `unsupported-capability`, two are
`held-policy`, and three are `forbidden-append-only`. The nine metadata rows are
`homebox.entity.history`, `homebox.entity.restore-deleted`,
`homebox.location.history`, `homebox.location.restore-deleted`,
`homebox.file.replace-bytes`, `homebox.file.restore-deleted`,
`homebox.document-link.retarget`, `homebox.maintenance.attachment-upload` and
`homebox.maintenance.attachment-delete`. Configured HomeBox history has an actual
separate reads_for/core dispatch seam despite the catalog's unsupported metadata;
inspect current admission and that owner instead of treating metadata as either
a grant or a complete runtime support verdict. Provider restore/file/attachment
write forms are not bridge Atlas WRITES and remain unavailable through that facade.
Held IDs are `atlas.binding.reassign-identity` and `atlas.asset.hard-purge`.
Forbidden append-only forms are `atlas.evidence.replace`, `atlas.geometry.replace`
and `atlas.reconciliation.replace`; no transport-specific replacement is added.

The complete canonical ID/family/effect/disposition source remains
[operation-catalog.json](../../../../contracts/stock-wire3/agent/operation-catalog.json).
Runtime sources are [capabilities.rs](../../http/agents/capabilities.rs),
[the shared/mounted MCP executor](../../http/agents/mcp.rs),
[WebMCP bindings](../../../../frontend/src/webmcp/coverage/families.ts) and
[the bounded bridge](../../../../tools/houseatlas-mcp-bridge/bridge.py).
[Public bridge guidance](../../../../tools/houseatlas-mcp-bridge/README.md) explains
scope, target, cursor and correlation with synthetic evidence-list examples.
This version reconciles source support only; it does not close the full per-operation
qualification matrix. No local checks or live operations were run for this update.

`healthy_admitted_family_input_descriptors` checks single-arm selection with an
unrelated admitted family, unchanged reachable definitions, offline descriptor
compilation and an absent-family result. The existing
`healthy_native_catalog_context_and_core_reads` fixture now checks that its
two admitted read arms are exactly advertised, while another schema-valid read
is excluded without dispatching it. These are synthetic in-process unit cases
in the existing backend test lane. No local compilation, Clippy or tests were
run for this change; CI results must be tied to the eventual PR head. Existing
source fixtures are not evidence of installed or live acceptance.

The version 2 `synthetic_admitted_batch_child_descriptors` backend unit case and
`frontend/lantern-tests/webmcp-batch-discovery.mjs` consume the same fictional
`fixtures/integration/mcp-batch-discovery.json`. They cover cross-family and
child-only descriptor inputs, canonical eligibility versus admission, no-child
and no-batch profiles, unchanged non-admission constraints, valid offline
schemas and 0/1/100/101 child arrays. Validation uses schema bytes only, never a
stock dispatcher. New fixtures are NOT RUN locally. The backend case is in the
existing unit-test lane; the frontend case runs in ordinary CI through
`frontend/lantern-tests/run-healthy.mjs`. No new CI infrastructure is introduced.

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
