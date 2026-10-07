# AI host UI

The checked-in frontend AI module supplies typed session, review, cancellation,
usage and canonical result presentation. This host namespace binds that module
to explicit Rust JSON endpoints and composes it with Settings. The application
contains the Rust AI module and optional native HTTP mount boundary. Its default
binary and browser entry supply no AI host, enrollment or bound UI port, so they
do not enable AI use. Real account/runtime and trusted human-review peers remain
required.

## Client and session composition

`createAiHostClient` implements all eight `AiClient` methods over explicit
same-origin endpoints and actual application-session mutation headers supplied
by the host. Requests use cookies, no-store and redirect-error. There is no
default endpoint, provider URL, credential storage, login helper or request
replay. `bindAiHostPort` also accepts explicit JSON ports without HTTP. Lifecycle
responses use the shared AI decoder; the other Rust DTOs are structurally decoded
before reaching React. Token counts must be exactly representable nonnegative
JavaScript integers or null. Arbitrary tool JSON uses the existing JavaScript
number model; full numeric fidelity remains unqualified.

`AiHost` keeps one shared `useAiSession` above page navigation.
`AiSettingsSection` renders `AiPanelView` in the existing Settings list.
`AiActivityStatus` displays a factual pending/result notice and Settings link
on other pages. Canonical output, typed errors, recorded operation IDs, usage,
review previews and original-ID reconciliation use the shared AI module.
Inference eligibility and paid-use policy are not reimplemented here.

After cancellation of an idle review returns a matching `confirmed` receipt,
the host composition performs one original-request status lookup through the
existing hook. The backend owns continuation retirement and the persisted
terminal cancellation with its original usage. The browser consumes that
outcome; it does not construct a terminal result or replace usage with unknown
counts. Consuming the terminal result clears the retained review and permits a
fresh request. Requested acknowledgements still wait for their final result;
domain-held operations retain their existing reconciliation semantics. An
unavailable lookup remains visible and the user can use Refresh request status;
there is no automatic polling loop.

Keep the bound client stable while its full scopeKey is unchanged. The host must
change scopeKey with actor, application session, qualified home, provider
registration or cancellation epoch changes; a home label or browser role is
insufficient. `AiApplicationPort.resolve(session, scope, homeLabel)` returns
that actual context or null. It is a view binding, not authority or inference
admission, and must not perform side effects during render. Removing the
committed authorized context invokes shared cleanup. Transport abort and
best-effort cancellation do not establish remote termination. Those invalidation
paths are retained code, not newly qualified controls.

Connection facts come only from trusted connection/action DTOs. Null binding
shows “AI host is unavailable.” The CSS uses the existing Settings geometry and
HouseAtlas colour/type tokens. All interface copy is English.

## Native host API

The qualified native base is
`/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/ai`. Configure explicit
endpoint paths only when the host is actually mounted. Responses are bare Rust
serde JSON values with the existing camelCase fields and kebab-case enum values;
there is no added success envelope or provider diagnostic disclosure.

| Relative route | Method | Input | Response |
| --- | --- | --- | --- |
| `/connection` | GET | No body | `ConnectionSnapshot` |
| `/connection/actions` | POST | `{actionId, command}` | `ConnectionActionResult` |
| `/connection/actions/{id}` | GET | Original action ID in path | Matching `ConnectionActionResult` |
| `/run` | POST | `{requestId, prompt}` | `RunOutcome` |
| `/requests/{id}/cancel` | POST | `{requestId}` matching path | Matching `CancelReceipt` |
| `/review` | POST | `{requestId, continuationId}` | `{status}` human review result |
| `/resume` | POST | Same review input | `RunOutcome` |
| `/requests/{id}` | GET | Original request ID in path | Matching `RequestStatus` |

`command` is `{action:'connect', route}` or
`{action:'consent'|'disconnect'|'manage-usage'}`. Connection actions use the host's
reviewed human surface; this DTO contains no launch URL or token. A connected
snapshot does not complete another pending workflow. The backend's persisted
disconnect receipt can be read under the new current cancellation epoch, while
request and continuation bindings keep both epochs.

`CancelReceipt.status` distinguishes requested/confirmed/already-finished/
unsupported. Human review status distinguishes pending/closed/ready-to-resume.
The UI resumes only after ready-to-resume. No approval receipt, changed call
arguments, policy epoch or actor authority is submitted. The separate trusted
human UI owns retained approval; the backend revalidates and claims the existing
continuation before dispatch.

`RunOutcome` carries completed, review-required, domain-held, cancelled, stopped
or failed state. The failed arm preserves its reason, earlier operationIds and
usage. Non-2xx or invalid transport rejects the promise and remains unconfirmed
in the shared hook; only an accepted terminal DTO is canonical completion/error.
Status reads do not resubmit work. Browser domain-held states are prepared,
queued, dispatching, rejected-before-dispatch, partial and unknown-held. The
Rust dispatch enum's internal observed/resolved values are not browser holds.

Current application authentication, original authority, home/provider binding,
CSRF, bounds, workflow/request storage and termination evidence stay backend
owned. The frontend issues no grants or inference admission. See the
[backend host documentation](../../../../backend/src/ai/host/README.md) for the
optional native mount, receipt release and continuation retirement contracts.

## Settings mounting proposal

`mounting.patch` is an unapplied additive proposal for four integrator-owned
files: App, SessionApp, the Settings page and the browser integration entry.
It places the provider around App's authorized view, adds AI before Session in
Settings, displays activity only outside Settings, forwards the authenticated
session to `AiApplicationPort` and imports the shared/host styles.
HostApplication gains an optional `ai` prop; its existing createRoot call
still supplies none. After providing the real host port, the integrator's
root substitution is:

```tsx
createRoot(root).render(<StrictMode><HostApplication ai={rootOwnedAiPort} /></StrictMode>);
```

Construct stable clients with `createAiHostClient({endpoints, mutationHeaders})`.
POST headers must use the actual current application nonce, for example
`{'X-Atlas-CSRF': currentSession.csrfToken}`, after confirming the retained
binding matches the current session. Labels and app authentication do not supply
registration/epoch identity or qualify provider use. No synthetic/default host
is exported from the production entrypoint.

Remaining actual UI mounts are the integrator patch, real endpoints/human
surfaces and full context/nonce port supplied to createRoot. Publication-manifest
updates remain integrator-owned. This namespace changes no app/root file,
backend policy, schema or manifest.

## Standalone setup and verification

Use the repository's pinned Node 26.10.0, npm 11.19.1 and Rust toolchain. Install
the existing frontend dependency lock without scripts, audit or funding:

```sh
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

These check the actual checked-in integrated source; they do not require copying
another source tree. Vite retains the existing large-chunk advisory. Shared root
mounts and full hosted integrity require the integrator's coordinated update.

Inspect the backend's positive fixture before running its scoped example:

```sh
HOUSEATLAS_AI_HEALTHY_JSON=/tmp/houseatlas-ai-peer.json \
  cargo run --locked -p houseatlas-backend --example healthy-ai-host
```

It uses actual Rust routing/journal/continuation code with disposable loopback
and explicit synthetic account, security, credential and enrollment peers. Its
idle-review dismissal retires an actual retained checkpoint and persists
cancelled status with unchanged usage. Its no-token disconnect rotates the
synthetic epoch and retrieves the persisted receipt after a healthy reopen.
The exported JSON is synthetic evidence and belongs outside Git. It does not
qualify real authentication, credentials, provider revocation, approval or domain
dispatch.

`healthy.examples.tsx` exports six sequential component groups and an explicit
synthetic fixture. `review-cancellation.healthy.tsx` additionally exports
`runHealthyReviewCancellationExample(container, peerJson)`. An isolated browser
entry can import these functions, the shared `ai.css`, `host.css` and existing
Atlas stylesheet, then pass the backend example's parsed JSON to the latter.
It first decodes the unmodified actual receipt/status pair and original ID.
The browser fixture rebinds only requestId to the hook's fresh synthetic request;
terminal state and usage remain the exact persisted peer values. It checks one
automatic status lookup, cleared review, preserved usage and a fresh request with
another ID, without opening review, resuming or replaying the original command.

These are healthy peer/browser checks, not a committed application root mount
or live backend/browser authority qualification. The terminal-error display
example supplies a typed DTO and injects no failure. Synthetic tool previews
perform no mutation or approval and do not exercise shared stock validation.
The correction passed the checked-in strict TypeScript/Vite checks and the
inspected Rust healthy example. Chromium 151.0.7922.173 passed the six existing
component groups and the persisted-dismissal group, retaining 2 input, 1 output
and 3 total tokens from the actual peer with one status lookup. No browser
runtime exception was observed; browser requests were static loopback assets
and the exported synthetic peer JSON.
No live login/inference/provider/account operation, new credential/grant,
spending or deployment occurs. Historical stopped rejection/replay/expiry/
revocation, fault/corruption, adversarial/mutation and concurrency controls remain
held. Product, security, actual user/runtime and production qualification remain
open.
