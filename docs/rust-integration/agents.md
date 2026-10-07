# Native stock agent composition

The root host binds accepted MCP, WebMCP and React boundaries to actual native
stock dispatch. Credentials and access remain with the actual access owner;
the binding grants no provider permission and replaces no principal, grant or
semantic peer. Existing JavaScript modules remain references. Feature source
retains its exact owner bytes; four READMEs
have separately recorded privacy adaptations: Domain, Storage, MCP and WebMCP.
This is a development candidate for independent composition review.

## Actual HTTP and browser flow

After an authorized home view commits, React requests the server's scoped
`GET /api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/admission`.
The server advertises the twenty Atlas record/history reads. A genuine editor
session additionally admits `atlas.circuit.create` and
`atlas.location-semantics.replace`. The catalog describes admission; each
request obtains actual AT11 authorization again.

Reads use `GET /api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/invoke`
with one `request` query parameter containing the complete wire3 JSON envelope.
GET remains a read-authorized route. Encoded query bytes are bounded at 32768
and decoded request bytes at 16384, with duplicate-key, lexical and depth checks.
The caller UUID and selected scope remain intact. The existing scoped
`POST commands` route handles admitted mutations with actual session cookie,
Origin and CSRF checks. The browser never automatically resubmits a command.

The shared wire schema admits reason strings up to 4096 code points. The native
Atlas mapper supports 1024 for the root and every batch child, copies the
complete reason unchanged, and holds larger requests before a mutation fence
or native write transaction. The root returns the caller-correlated shared
`capability-held` error with no retry or invented operation ID. That hold is source-reviewed only;
no oversized or rejection flow has been run.

One shared native executor selects the existing root read or mutation bridge.
The read bridge implements the genuine `StockHistoryPort` over AT07's stock-owned
audit repository. It pins the owner's exact result and full bounded audit frame,
and retains the same opaque request principal and captured grants across owner
authorizations. A page without a new cursor requires three authorization pairs;
creating a cursor requires five. The host marks history committed only after
the owner returns from its transaction and final release check. Nonnull
continuation has not been executed in this slice.

React supplies the unchanged shared stock and frozen Atlas schemas to an offline
strict Ajv validator. The UI boundary commits each canonical result before
acknowledging tool completion. It registers tools through actual
`document.modelContext`; no substitute model context is installed. Availability
follows the actual committed scope and admitted catalog. A failed optional
catalog load leaves the authorized home visible with tools unavailable.

The healthy browser runners support three source-inspected native releases:
[Chromium 151.0.7922.173](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/third_party/blink/renderer/core/script_tools/model_context.idl),
[154.0.8037.57](https://chromium.googlesource.com/chromium/src/+/refs/tags/154.0.8037.57/third_party/blink/renderer/core/script_tools/model_context.idl)
and [154.0.8037.97](https://chromium.googlesource.com/chromium/src/+/refs/tags/154.0.8037.97/third_party/blink/renderer/core/script_tools/model_context.idl).
All accept JSON text through `executeTool`; the two 154 patch-release IDLs are
byte-identical. A browser version change requires source inspection before a
runner continues.

## Mounted and embeddable MCP flow

The actual JSON-only HTTP endpoint is
`/api/atlas/mcp/workspaces/{workspaceId}/homes/{homeId}`. Every POST preserves
its observed method and obtains genuine AT11 `Action::Mutate` authorization with
the actual Editor cookie, Origin and current CSRF. Its catalog admits only the
twenty record/history reads. This transport profile adds no access grant or
bearer-login scheme.

Initialization negotiates MCP `2025-11-25`, returns HTTP 200 JSON and the actual
`MCP-Session-Id` response header. `notifications/initialized` returns an empty
202. Subsequent POSTs carry that session ID, `MCP-Protocol-Version`, current CSRF,
and acceptance of both `application/json` and `text/event-stream`. Requests run
sequentially in the same protocol session. `tools/list` returns the three read
families `atlas_records`, `atlas_bindings` and `atlas_media_geometry`, without a
continuation cursor. The profile supports JSON replies, not an SSE stream or
client-directed session deletion.

The HTTP body limit is 64 KiB with ten-second intake; the native response bound
is 1 MiB. The host allows 32 protocol sessions, at most four per cookie, a
128-byte protocol-session header and fifteen minutes of idle lifetime. A mounted
session retains at most 256 request IDs with a 64 KiB cumulative ID budget.
Bounds and idle/rejection/replay behavior are source-only; this healthy flow
does not exercise lifecycle or limit controls.

Calls supply the complete canonical wire3 envelope as `arguments` to its family
tool. The outer JSON-RPC ID and canonical request UUID correlate independently.
Successful text content decodes to the exact canonical `structuredContent`,
including the unchanged command ID, request UUID, resolved scope and owner data.
The mounted service revalidates the original authority before and after each
message and preserves the native owner's result validation and rendering.

The existing `http::agents::mcp::bind_read` also accepts an already issued opaque
access principal and creates an embeddable native MCP session with twenty read
operations. Its synchronous stock execution retains the same issuance; no
borrowed capture carrier crosses an await. The separate `healthy-agent-stock`
Rust example performs a fresh synthetic circuit commit and in-process MCP
initialization, discovery, record read and first stock audit page. Its constructed
access request evidence does not exercise an HTTP listener.

## Observed local healthy flows

The new `tools/rust-integration/healthy-agent-host-loopback.mjs` covers the mounted
endpoint and actual native browser API on a fresh disposable Rust TLS host. Its
local run observed 30 browser requests. A cached-only HomeBox GET
returned two canonical stored projections and cache metadata while preserving
source facts, original dates and stored unverified links. It made zero provider
calls and performed no native navigation.

After ordinary editor sign-in, the flow reads actual classification admission,
then submits one qualified Room-to-Floor `atlas.location-semantics.replace`
through native WebMCP. It preserves the full admitted payload and all three
reference guards, changing only the semantic kind. The record advances from
revision 1 to 2; React displays the canonical receipt before the native tool
returns. Native record/history reads, ordinary record/admission/view reads and
mounted MCP reads retain the saved record and its linked durable audit. The
refreshed view preserves the qualified source and unchanged HomeBox entity.

Mounted MCP initialization, the initialized notification, read-only discovery,
record read and first matching history page complete with canonical correlation
and equal text/structured content. Read-only persistence observation records six
records, one audit and one stock operation, with no history cursor. It confirms
the complete submitted reason and audit linkage were retained without clipping.
No session cookie, CSRF nonce or protocol-session header is included in the
runner's result evidence.

This thirty-request flow covers native classification and React canonical
completion. The accepted UI input
`1dd31f4935390b719958612a003d5c8add78c0a7` now exposes the human PlaceEditor
independently of passive HomeBox `canEdit`, with actual host admission required
for classification. Both reason fields display and enforce 1024 Unicode code
points without clipping. The root retains the editing client across admission
refresh. The separately named
`healthy-human-host-loopback.mjs` completed 35 loopback requests on its own fresh
fixture. One actual React form submits a Room-to-Floor classification through
the real editing HTTP client, preserving its 73-codepoint reason, full payload
and original guards. The canonical receipt survives ordinary view/catalog
refresh; the form reloads actual admission and revision 2. Native WebMCP and
mounted MCP reread the record and first linked audit, and read-only SQLite
retains the full reason. HomeBox `canEdit` stays false. No upload client is bound.
Each flow submits its classification once; no retry or replay is exercised.

## Verification boundary and missing areas

The seven existing browser scripts remain: `healthy-loopback`,
`healthy-core-loopback`, `healthy-media-loopback`, `healthy-stock-loopback`,
`healthy-stock-write-loopback`, `healthy-stock-history-loopback` and
`healthy-agent-loopback`. Together with `healthy-agent-host-loopback` and `healthy-human-host-loopback`,
these are nine scripts under `tools/rust-integration`, each with the `.mjs` extension.
The source runner and named Rust example are separate. Each browser runner uses
a new disposable fixture and graceful shutdown. This document records local
healthy coverage; exact-candidate hosted CI status is reported separately.

Locked source compilation, rustfmt, warnings-denied Clippy, strict TypeScript,
Vite and the central source manifest remain required. Accepted populated-recovery,
native media-recovery and provider-authority leaves compile in the root source.
That compilation establishes no provider-refresh, Network or recovery runtime
coverage. The cached HomeBox route reads existing saved state; it does not
collect, refresh or publish provider state.

Shared error outputs and alternate numeric spellings remain source-reviewed only.
Stopped rejection, guard reversal, mutation/omission, denial, adversarial, replay,
expiry, revocation, fault, failure-injection, crash and concurrency controls remain
unrun and excluded from ordinary CI. Owner examples with synthetic authority,
queue replay or broader aggregates are not executed. Wire3 errors add no
automatic retry or acceptance claim.

The root exposes a transient session-change notification hook; external confirmed
rotation-event producers and their positive runtime evidence remain missing.
Batch tool admission, complete human editing and attachment flows, provider
refresh, actual Network/recovery
execution, real source setup and remote AI clients remain missing. Access's
separately accepted recovery successor remains unadopted because its
`domain::queue_recovery` dependency is absent from the accepted Domain input.
No queue,
restore or reopened-host runtime flow has run in this slice. Historical schema2
recovery evidence does not establish schema4 or populated stock/queue image
compatibility. Populated recovery requires independently qualified discovery,
original-enqueue, queued-media and retained-native evidence owners; image validity
supplies none of those permissions or proofs.

Target NAS, live credentials/grants, remote listeners, deployment and
product/security acceptance remain unreleased. The offline schema bundle still
produces a large Vite chunk; splitting it remains future work.

For future concurrency, denial and failure-injection cases, the separate
regression lane in the root README.md permits only exact reviewed tests in
isolated disposable synthetic environments with fake/local-only transports.
It excludes real credentials, live providers, user data, populated production
restore and deployment, releases no G1–G5, and grants no new secrets or network
permissions. Other held classes and broad runtime aliases remain held; an
overlapping case must genuinely fit the exact approved scope and lane safeguards.
The unrun statements above record coverage, not a blanket prohibition of these
three classes under that lane. Ordinary CI and historical results are unchanged.
