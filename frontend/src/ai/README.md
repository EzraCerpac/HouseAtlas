# AI panel

AT42 supplies a React island with a caller-provided `AiClient`. Import `AiPanel`
from `index.ts` and import `ai.css` from the host stylesheet entry. Provide a
stable `scopeKey` containing the full qualified context and its current epoch,
plus a factual `scopeLabel`. The client must already be scoped by the host.
These local boundary types are proposals for reconciliation with AT51 contracts.

The panel reads connection status on mount. A user submit creates a random UUID
and starts one request. Readiness requires connected authorization, a ready
runtime, no known ineligibility, and inference permission. Sign in with ChatGPT
requires granted permission; other methods also accept not-applicable permission.
Unknown eligibility stays visible and is checked when inference is requested.
The panel does not initiate login, configure credentials, contact providers,
assume local-runtime availability, or execute proposed tool calls.

Cancel sends a separate typed cancellation request and keeps the result
transport available for a terminal outcome. Requested cancellation and confirmed
terminal cancellation are distinct. Leaving the scope aborts stale transport and
sends best-effort cancellation; disposal does not establish provider completion.
A lost result retains its request ID and cancellation action. A trusted
`confirmed` receipt can resolve a lost result as cancelled with unknown token
counts. Requested, unsupported, or already-finished receipts do not recover a
lost terminal result; a later host request-status port is needed for that case.
Clients must only return `confirmed` after authoritative terminal confirmation.
Known terminal errors resolve a typed failed outcome with a bounded reason code;
diagnostics and provider identifiers stay out of the browser. A stopped outcome
reports local processing stopped with provider completion unconfirmed.

Model output and JSON tool arguments render as React text. Proposed tool calls
are previews without an approval action. Token counts preserve `null` as Unknown;
there is no price estimate. Connection timestamps preserve the supplied source
value, including explicit unknown freshness.

`examples.tsx` contains healthy synthetic ready, SIWC permission-granted with
unknown eligibility, completed, tool-review, cancellation-requested, and cancelled
render states. The review command body reproduces
`packages/contracts/fixtures/create-circuit.mutation.json`; its tool name is the
published `mutateAtlasRecord` operation ID. These examples execute no domain
mutation. Exact tool-routing argument envelopes remain an integration input.

The external AT42 compiler harness uses React/React DOM 19.2.0, TypeScript 5.9.3,
`@types/react`/`@types/react-dom` 19.2.2, and jsdom 26.1.0. Strict compilation enables
exact optional properties, unchecked indexed access, exhaustive returns, and
unused-symbol checks. Its local checks render all six healthy examples and mount
the actual panel for synthetic completion, review, and cancellation flows.
This does not qualify live authentication, inference, cancellation providers,
tool approval, security, faults, concurrent requests, or deployment.

Lifecycle implementation follows React's documented effect cleanup and scoped
response handling: <https://react.dev/reference/react/useEffect>. Abort behavior
follows the DOM interface, which is not proof of server-side inference completion:
<https://dom.spec.whatwg.org/#interface-abortcontroller>.
