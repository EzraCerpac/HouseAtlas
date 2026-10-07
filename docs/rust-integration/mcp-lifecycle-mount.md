# Native MCP lifecycle mount

This continuation starts at corrected main
`ba20a24deedd780e4ddd00bc7446aa484257970a`, tree
`b6a2dadee4f16a83beb5c9635a93a74700ed32f8`. It copies the six exact MCP
lifecycle Rust source files from the public scoped branch head
`288f0cc011a0a3a97b5dfe97ddd36210de9bc5ac`. The input's historical README,
validation report and superseded mount proposal remain external references;
this document describes the integrated tree and its actual checks.
The root applies the owner mount and the two HTTP review corrections to the
root HTTP service and shared module declaration. Formatting follows the existing Rust
formatter; feature source remains unchanged. Cargo.lock and both workflows are
unchanged. The healthy lifecycle example is explicitly compiled and can be run
by name; it is not added to an aggregate test or ordinary runtime runner.

The mounted service authenticates every POST through the actual Access owner,
using the original method, Origin, cookie and CSRF evidence. It binds the same
original opaque principal to the native catalog and actual owned stock service.
Configured scopes and the original Access Arc are retained from trusted startup
state; no runtime home configuration mutation is supplied by this application.
The existing three read/history families and transport bounds remain in force.

Each serialized session has a separate private control handle. Confirmed Access
rotation closes matching controls after the real native rotation commits and
after releasing Access/Core locks. The response retains the actual rotation
receipt. Registry insertion revalidates the original principal while holding
the same registry lock used by rotation delivery. A rotation committed before
that check prevents publication; one committed after the check must observe
the inserted control when its confirmed event acquires the registry lock.
Rotation releases Access before waiting for the registry.

Subsequent healthy use initializes a fresh MCP session using the real new
issuance. Cancellation intake uses the supplied owner controls. For the pinned
JSON-only 2025 transport, a genuine cancelled-request disposition terminates
the original POST with its unchanged request ID and a `-32800` JSON-RPC error.
This follows the [2025 transport response requirement](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and the [official SDK's legacy cancellation completion](https://py.sdk.modelcontextprotocol.io/migration/#cancelled-requests-are-no-longer-answered).
It creates no tool result or rollback. Cancellation and concurrency behavior
have not been exercised. Synchronous owner work remains alive through completion.

## Ordinary evidence

Locked actual library/binary/explicit-example compilation, rustfmt, strict
Clippy, generated Rust/TypeScript contract checks, TypeScript and Vite pass.
The inspected native lifecycle executable completes two init/list/get sessions
and one genuine Access rotation, using actual Access, schemas, catalog, stock
service and SQLite. It checks original text/integer and canonical correlation.

`healthy-mcp-lifecycle-loopback.mjs` exercises the actual TLS HTTP routes with
two fresh initialize/initialized/list/read sessions separated by one real
rotation. Each result preserves canonical request ID, command, scope and equal
text/structured content. It makes no request with the old credential or old MCP
session after rotation. Read-only SQLite observation finds six unchanged
records, no audits and no stock operations. Its initial ordinary harness run
missed the required MCP Accept header and returned 400; the corrected flow
explicitly supplies both accepted media types. Only the complete corrected
positive flow is success evidence.

The existing actual browser regression also completes cached-only HomeBox read,
native WebMCP classification, React receipt display and mounted MCP read/history.
It observes the real durable classification/audit linkage; it uses no synthetic
peer. The native WebMCP family count remains three and its admission remains
the root's existing supported list.

## Separate owner continuations

HomeBox wire input `9eaab4bc39216de486fd8274e1503e3e9df86fad` and WebMCP coverage
input `2186af9c58a79f9c7a36c4930ab215dc6137da61` are fetched separately; they are
not included in this merge candidate. The six named wire healthy decoder tests
pass in their exact owner harness. Actual stock reader adoption needs the reader
and contract owners to preserve native calendar maintenance dates, select the
stock dialect after bounded raw intake and request complete maintenance with
`status=both`. The root can then mount that actual reader without replacing its
generation byte accounting, deadlines, authorization or publication proofs.

Coverage mounting needs the original UI owner to apply the leaf's narrow
`StockApplication.tsx` proposal. It replaces the existing boundary in its
committed scope/session facade; adding a second document mount would be wrong.
The root supplies the existing exact admitted service support list. Provider
families remain unbound and provider writes remain disabled.

No credential/source activation, provider call, remote listener, NAS, inference
spend, deployment or operational gate occurs. Rejection, replay, expiry,
revocation, guard/mutation controls, fault/crash, denial and concurrency tests
remain stopped. Healthy success does not qualify those behaviors.

## Pending read cancellation successor

The exact owner patch `fd1dc2b29388646c7b40a2b25acdc3b3849dcfcd` replaces
only lifecycle control. A matching cancellation is retained before native read
classification and becomes effective when the actual service confirms a read.
Write/initialize execution remains uncancelled. Root rotation publication and
correlated transport completion remain unchanged. New cancellation/concurrency
controls are not run; the actual healthy login/rotation/read flow is checked
separately from that source correction.
