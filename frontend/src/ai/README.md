# AI panel

AT42 supplies a React island with authenticated, caller-provided `AiClient`
ports. Import `AiPanel` from `index.ts` and import `ai.css` from the host
stylesheet entry. Provide a stable `scopeKey` containing the full qualified
actor/home/provider context and its cancellation epoch, plus a factual
`scopeLabel`. The host scopes every port; the browser does not supply authority.
These narrow boundary types require reconciliation with AT51 generated contracts.

Connection status includes the active account/workspace, granted inference
permission, paid-use admission and runtime route/qualification. Inference needs
a bound active account, connected authorization, a ready qualified selected
runtime, no known ineligibility, permission and either verified zero paid use or specific approved
credit spending. Initial state keeps paid use held and the runtime unset and
held. The panel cannot derive plan use from identity or change these gates.
Unknown eligibility remains visible and is checked by the trusted runtime.

Connect, consent, disconnect and Manage usage call the host's injected
`connectionAction` port with an action ID retained before submission. Refresh
queries the separate `connectionActionStatus` port for every retained original
ID; only a matching completed workflow clears its pending status. Auxiliary
Manage usage and Disconnect preserve other unresolved IDs. New Connect/consent
is disabled until existing actions reconcile. Lookup uncertainty stays visible;
connected snapshot facts cannot resolve an action. The three runtime candidates
remain explicit: a local
sign-in helper, an issued website client and a local inference companion.
Selecting a candidate does not qualify or adopt it. A local companion's computer
availability and unqualified phone relay are visible before Connect. The host
opens its reviewed sign-in/consent or usage surface; the panel has no provider
URLs, browser tokens, automatic login, inference on sign-in or paid fallback.
Disconnect immediately disables inference while retaining any operation for
reconciliation. Pending actions and unconfirmed disconnect/revocation remain
visible; a failed disconnect stays disabled until the host supplies current status.

A submit creates a random UUID and starts one scoped request. Cancellation uses
a separate typed request while retaining the result transport. Disposal aborts
stale transport and sends best-effort cancellation without claiming remote end.
The required `requestStatus` port recovers the original identifier and its
server-owned outcome; it never replays the command. A trusted `confirmed`
cancellation receipt can resolve a lost result with unknown token counts only
when the host has established terminal cancellation without unresolved domain
holds. Accepting an authoritative request outcome clears obsolete recovery progress
and aborts its stale lookup. Known domain-held operations retain their identifiers and prepared, queued,
dispatching, rejected-before-dispatch, partial or unknown-held state; they never
become completed writes from a cancellation receipt.

Stock.2 wire3 tool review includes the server's continuation ID and exact narrow
challenge projection. The Open human review action calls `openReview` to open a
separate trusted host UI. Only its `ready-to-resume` result triggers `resume` with
the existing request/continuation IDs. The host retains and consumes its own
receipt and revalidates authority, intent and impact. No model/browser receipt
body, approval authority, policy epoch or grant is sent by this island. Review
and held operations block a second panel request until authoritative recovery.

Model output and JSON arguments render as React text. Tool calls remain
previews. Token counts preserve `null` as Unknown; no quota, reset time, price or
unlimited-plan promise is inferred. Provider diagnostics remain outside the
browser DTO. Typed failures preserve earlier recorded operation IDs. Freshness timestamps retain their supplied value or Unknown.

`examples.tsx` contains six healthy synthetic render states. Its review uses the
actual `atlas_records` family and `atlas.circuit.create` wire3 request envelope
from the supplied `0.3.0-at34.stock.2` language-neutral contract input. It executes
no mutation; its empty challenge array represents a separate UI review without
an impact challenge. Synthetic qualified runtime/zero-paid-use values do not
qualify an account or deployment. The safe held initial snapshot is separate.

The earlier external harness used React/React DOM 19.2.0, TypeScript 5.9.3,
`@types/react`/`@types/react-dom` 19.2.2 and jsdom 26.1.0. This follow-up targets the
same strict settings and passed on React/React DOM 19.3.0, TypeScript 7.0.2 and
`@types/react`/`@types/react-dom` 19.3.0. Six healthy render examples and mounted
completion, review-preview, cancellation and sequential Connect → Manage usage →
Refresh reconciliation flows passed in an isolated harness. This
component does not establish live authentication, provider cancellation,
security, fault/concurrency behavior or runtime qualification. The actual
Rust-serde lifecycle JSON was consumed through `wire.ts` decoders and
`bindAiLifecyclePort`, including its object-shaped human-review result and
correlated action request/results. The healthy preview validated against the
exact stock wire3 input schema with frozen Atlas resources registered offline.
The actual compiled hook's action request also deserialized using the Rust
`ConnectionActionRequest` DTO, checking the other direction of the wire binding.
Only valid examples ran; no negative-decoder, revocation or concurrency probes
were executed.

Connection decisions follow the supplied AI policy and official references:
<https://developers.openai.com/siwc/ui-ux-guidelines>,
<https://developers.openai.com/siwc/token-sharing-open-source/sign-in>, and
<https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>.
The static supplied policy does not newly verify provider availability.
Lifecycle cleanup follows <https://react.dev/reference/react/useEffect>.
Abort behavior follows <https://dom.spec.whatwg.org/#interface-abortcontroller>;
transport abort does not establish server-side completion.
