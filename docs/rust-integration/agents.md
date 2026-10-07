# Native stock agent composition

The root host binds accepted MCP, WebMCP and React boundaries to actual native
stock dispatch. It introduces no provider, credential issuance, replacement
principal, grant or semantic peer. Existing JavaScript modules remain references.
Feature source retains its exact owner bytes; only three READMEs have separately
recorded privacy adaptations. This is a development candidate for independent
protocol, authority and composition review.

## Actual HTTP and browser flow

After an authorized home view commits, React requests the server's scoped
`GET /api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/admission`.
The server advertises the twenty Atlas record/history reads. A genuine editor
session additionally admits `atlas.circuit.create`. The catalog is admission
information; each request obtains actual AT11 authorization again.

Reads use `GET /api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/invoke`
with a `request` query parameter containing the complete wire3 JSON envelope.
GET remains a read-authorized route. Query bytes are bounded at 32768 and decoded
request bytes at 16384, with duplicate-key, lexical and depth checks. Both the
caller UUID and selected scope remain intact. The existing scoped `POST commands`
route handles the admitted mutation with the actual session cookie, Origin and
CSRF checks. The browser never automatically resubmits a command.

The shared wire schema admits reason strings up to 4096 code points. The
accepted native Atlas mapper supports 1024 for the root and every batch child,
copies the complete reason unchanged, and holds larger requests before any
mutation fence or transaction. The root returns the caller-correlated shared
`capability-held` error with no retry or invented operation ID. That hold is
source-reviewed only; no oversized/rejection flow has been run.

One shared native executor selects the existing root read or mutation bridge.
The read bridge now implements the required genuine `StockHistoryPort` over
AT07's stock-owned audit repository. It pins the owner's exact result and full
bounded audit frame, and retains the same opaque request principal and captured
grants across all owner authorizations. A page without a new cursor requires
three authorization pairs; creating a cursor requires five. The host marks
history committed only after the owner returns from its transaction and final
release check. Nonnull continuation has not been executed in this slice.

React supplies the unchanged shared stock and frozen Atlas schemas to an offline
strict Ajv validator. The accepted UI boundary commits each canonical result
before acknowledging tool completion. It registers tools through actual
`document.modelContext`; no substitute model context is installed. Tool
availability follows the actual committed scope and admitted catalog. A failed
optional catalog load leaves the authorized home visible with tools unavailable.

The healthy browser runner supports three source-inspected native releases:
[Chromium 151.0.7922.173](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/third_party/blink/renderer/core/script_tools/model_context.idl)
[154.0.8037.57](https://chromium.googlesource.com/chromium/src/+/refs/tags/154.0.8037.57/third_party/blink/renderer/core/script_tools/model_context.idl)
and [154.0.8037.97](https://chromium.googlesource.com/chromium/src/+/refs/tags/154.0.8037.97/third_party/blink/renderer/core/script_tools/model_context.idl).
All accept JSON text through `executeTool`; the two 154 patch release IDLs are
byte-identical. A browser version change requires
source inspection before the runner continues.

## Genuine embeddable MCP flow

`http::agents::mcp::bind_read` accepts an already issued opaque access principal
and creates an actual native MCP session with its twenty read operations. Its
service constructs one request-local capture carrier from that same issuance,
executes native stock synchronously, and passes the original request and owner
result to the accepted MCP catalog for validation and rendering. The adapter
performs its final access revalidation. No borrowed capture carrier crosses an
await, and no MCP network endpoint or bearer-login scheme is introduced.

The explicitly named `healthy-agent-stock` example uses fresh private scratch
stores and the existing synthetic editor fixture. It performs one genuine
native stock circuit commit, then real MCP initialization, tool discovery,
record read and first-page stock history through the bound service. It verifies
the canonical text/structured content and actual durable audit linkage. Native
request evidence is constructed for the access API in this example; it proves
no MCP HTTP listener.

## Verification boundary and missing areas

The source runner executes three existing inspected healthy examples explicitly.
It compiles the new genuine MCP example on both platforms; Linux CI executes
that separate named example. Linux CI
retains all six existing browser flows and adds the genuine WebMCP identity
read, fresh circuit create, record readback and first audit page. Each runner
uses a new disposable fixture and graceful shutdown. Locked source compilation,
rustfmt, warnings-denied Clippy, strict TypeScript, Vite and the central source
manifest remain required. The Rust workflow also checks exact main push commits.

Shared error outputs and alternate numeric spellings are source-reviewed only.
Stopped rejection, guard mutation, denial, adversarial, replay, expiry,
revocation, fault, crash and concurrency controls remain unrun. Owner examples
with synthetic authority, queue replay or broader aggregates are not executed.
The shared wire3 error paths introduce no automatic retry or acceptance claim.

MCP has an in-process binding only. Confirmed session-rotation notification
wiring, batch tool admission, complete editing and attachment flows, provider
hosts, real source setup, remote AI clients and recovery are still missing.
This candidate compiles schema4 storage and queue source but executes no queue
or restore flow. Historical schema2 recovery evidence does not establish
schema4 or populated stock/queue image compatibility. The strict storage/access
reopen and full-image validators remain with their original owners. Target NAS,
live credentials/grants, remote listeners, deployment and product/security
acceptance remain unreleased. The offline schema bundle currently produces a
large Vite chunk; splitting it remains future work.
