# AI host UI

This namespace adds host JSON transport and Settings/status composition to the
immutable accepted AI donor, PR10
`edca73b09f879f167f7f2e258e534b734919290d`, against integration
`7e742505fd360901a3976a993774a4bbdf7e2eaf` (tree
`027efbbe00688bea65560f20231ed17ac28fab2f`). Donor files are unchanged and are
not copied into this scoped commit. Integration must import the exact accepted
`frontend/src/ai/{AiPanel.tsx,README.md,ai.css,examples.tsx,index.ts,model.ts,types.ts,useAiSession.ts,wire.ts}`
bytes separately. No root manifest, shared declaration, router, schema or
publication manifest is changed here.

## Implementation

`createAiHostClient` implements all eight existing `AiClient` methods over
explicit same-origin endpoints and the actual application-session mutation
headers supplied by the host. Requests use cookies, no-store and redirect-error.
There is no default endpoint, provider URL, credential storage, login helper,
retry or request replay. `bindAiHostPort` also accepts explicit JSON ports without
HTTP. Lifecycle responses use the donor's existing decoder; the remaining Rust
DTOs are structurally decoded before reaching React. Token counts must be exactly
representable nonnegative JavaScript integers or null. Arbitrary tool JSON still
uses the existing JavaScript number model; full numeric fidelity is unqualified.

`AiHost` owns one donor `useAiSession` above page navigation. `AiSettingsSection`
renders the actual donor `AiPanelView` in the existing Settings list.
`AiActivityStatus` provides a factual pending/result notice and Settings link on
other pages. Canonical output, typed errors, recorded operation IDs, usage,
review previews, original-ID reconciliation and cancellation semantics remain
donor-owned. Inference eligibility and paid-use policy are not reimplemented.
Changing the full host scopeKey remounts the draft/session. Removing the committed
authorized context unmounts it and invokes donor cleanup; transport abort and
best-effort cancellation do not establish remote end. Those invalidation paths
are retained code, not newly qualified controls.

Keep the bound client stable while scopeKey is unchanged. The host must change
scopeKey with actor, application session, qualified home, provider registration or
cancellation epoch changes; a home label or browser role is insufficient.
`AiApplicationPort.resolve(session, scope, homeLabel)` returns that actual scoped
context or null. It is a view binding, not authority or an inference admission.
It must not perform side effects during render. Connection facts come exclusively
from the trusted `connection`/action DTOs. Null binding shows “AI host is unavailable.”
The CSS uses the existing Settings geometry and HouseAtlas colour/type tokens.
All interface copy is English.

## Rust API handoff to the parent/backend host owner

The following is the exact client contract for reconciliation with the backend
owner. Endpoint paths are explicit integrator configuration, not yet agreed or
mounted. No new shared DTO is proposed. Every response is the bare accepted Rust
serde JSON value, without an additional success envelope or provider diagnostics.

| Endpoint key | Method | Request | Accepted response |
| --- | --- | --- | --- |
| `connection` | GET | No body | `connection::ConnectionSnapshot` |
| `connectionAction` | POST | `runtime::ConnectionActionRequest`: `{actionId, command}` | `runtime::ConnectionActionResult` |
| `connectionActionStatus(actionId)` | GET | Original ID in configured path | `runtime::ConnectionActionResult`, matching `actionId` |
| `run` | POST | `types::RunInput`: `{requestId, prompt}` | `types::RunOutcome` |
| `cancel(requestId)` | POST | `{requestId}`; configured path carries the same original ID | `types::CancelReceipt`, matching `requestId` |
| `openReview` | POST | `runtime::ReviewInput`: `{requestId, continuationId}` | `runtime::HumanReviewResult`: `{status}` |
| `resume` | POST | The same `runtime::ReviewInput` | `types::RunOutcome` |
| `requestStatus(requestId)` | GET | Original ID in configured path | `runtime::RequestStatus`, matching `requestId` |

`command` is exactly `{action:'connect', route}` or
`{action:'consent'|'disconnect'|'manage-usage'}`. The existing kebab-case enum
values and camelCase fields are preserved. `CancelReceipt.status` distinguishes
requested/confirmed/already-finished/unsupported. `HumanReviewResult.status`
distinguishes pending/closed/ready-to-resume. No boolean approval, receipt,
policy epoch, changed call arguments or actor authority is submitted. The host's
separate human UI owns its retained approval and the backend claims/revalidates
the existing continuation before dispatch. Connection workflows likewise use the
host's reviewed human surface; this browser DTO contains no launch URL or token.
The UI only resumes after ready-to-resume and never treats a pending action as
completed from connected snapshot facts.

`RunOutcome` is completed, review-required, domain-held, cancelled, stopped or
failed with the donor fields. Browser domain-held states are prepared, queued,
dispatching, rejected-before-dispatch, partial and unknown-held. The Rust
`DomainDispatchState` additionally has internal observed/resolved values; those
are not browser holds and must not be serialized as such. The canonical failed
arm carries reason, earlier operationIds and usage. Non-2xx/invalid transport
rejects the promise and remains unconfirmed in the donor hook; only an accepted
terminal DTO is canonical completion/error. Status reads never resubmit work.

The backend retains current application authentication, original authority,
home/provider binding, CSRF, bounds, workflow/request storage and provider
termination evidence. These must be real host inputs. The frontend issues no
grants or inference admission. The parent must reconcile the final endpoint
paths, cancellation body/path shape, and actual registration/session/epoch
binding with the separate Rust host owner before mounting.

## Exact additive mounting proposal

`mounting.patch` applies cleanly to the pinned integration input and changes only
four integrator-owned files. It is a proposal, not an applied change:

| File | Base Git blob |
| --- | --- |
| `frontend/src/app/App.tsx` | `6c88052a1d72616cc10c2bd7d50069169c5c7e12` |
| `frontend/src/app/SessionApp.tsx` | `5807ea0721400c08dac28e153d0160631dbfe11c` |
| `frontend/src/app/pages.tsx` | `4b91b4af91159d0b72f5c773fb2f3f077640fbcb` |
| `frontend/integration/main.tsx` | `6df9827ca686a728512ac78b9856225781b56b61` |

It places the host provider inside App around the authorized view, adds the AI
section before Session in Settings, adds the notice only outside Settings,
forwards the authenticated session to `AiApplicationPort`, and imports donor/host
styles. HostApplication gains an optional `ai` prop. The existing createRoot call
still supplies none. After the backend owner supplies the actual port, the
integrator's final root substitution is exactly:

```tsx
createRoot(root).render(<StrictMode><HostApplication ai={rootOwnedAiPort} /></StrictMode>);
```

`rootOwnedAiPort` must be the agreed real `AiApplicationPort`. There is no
synthetic/default implementation exported from the production entrypoint.
Construct each stable client with `createAiHostClient({endpoints,
mutationHeaders})`, where POST headers use the actual current nonce, for example
`{'X-Atlas-CSRF': currentSession.csrfToken}` after confirming the retained binding
still matches the current host session. Labels and app authentication alone do
not supply registration/epoch identity or qualify provider use.

Remaining actual mounts: import immutable donor bytes, apply the integrator patch,
bind real Rust endpoints and human surfaces, supply the actual full context/nonce
port to createRoot, and update the integrator-owned publication manifest. No
default production AI mount is present in this scoped commit.

## Verification and limits

An inspected disposable composition used exact integration bytes plus exact donor
bytes, this namespace, and separately the proposed patch. Pinned Node 26.10.0,
npm 11.19.1, React/React DOM 19.3.0 and TypeScript 7.0.2 were used. Dependency
installation used the existing lock with scripts/audit/funding disabled. The
existing strict `typecheck` and Vite `build` scripts passed. The full proposed
application build retains the existing large-chunk advisory; code splitting is
integrator work.

`healthy.examples.tsx` exports `runHealthyAiHostExamples(container)` and an
explicit synthetic fixture. In Chromium 151.0.7922.173, six sequential healthy
component groups passed: held connection and original-action reconciliation;
terminal response/token counts; pending human review, page composition retention
and ready continuation; cancellation acknowledgement then terminal result;
original-request status completion; and supplied canonical error display with
recorded operation ID/null usage. All client calls used synthetic JSON transport.
The terminal-error group displays a supplied typed DTO; it injects no fault or
rejected transport. The call preview submits no stock/domain mutation and its
empty challenge list uses the donor's separate human-review example. The shared
stock input validator is not exercised by this namespace's example.

A separate disposable browser entry applied `mounting.patch` to actual
SessionApp/App and supplied explicit synthetic session/view/AI ports. Actual
Settings → Home → Settings navigation retained the pending review and displayed
the canonical resumed response, with one original run and one resume. Both
browser runs had zero runtime exceptions and only static loopback page requests.
The proposed Settings mount was also visually inspected at desktop and phone
widths with the existing stylesheet and explicit synthetic data.
This qualifies that proposed browser composition, not a committed root mount,
actual Rust HTTP execution, live account, provider, or approval system.

No Rust host example, live login/inference/provider/account operation, new
credential/grant, spending, deployment, stopped rejection/replay/expiry/revocation,
fault/corruption, adversarial/mutation or concurrency control was run. Security,
backend/browser end-to-end authority and actual user/runtime qualification remain
open. The publication verifier is not a qualification of this unintegrated delta:
its manifest is unchanged and requires the integrator's additive update.
