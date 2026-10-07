# AI host composition

This local continuation composes the exact published AI source
`edca73b09f879f167f7f2e258e534b734919290d`, Rust host successor PR65
`849685e693f5df107847cf8527403c9493a2afe7`, and React host successor PR67
`07c7f2c45747dcb4f6aa99dd34f7681942cca74b` over identity-corrected upload PR52
`fa7c43621b6c6fa40d0199e795648bad804634a6`, tree
`86be04724059facc9e52e8a5732d3cad94b3aad1`.
The donor and both host namespaces retain exact owner bytes, except the
integrator-owned `pub mod host` declaration in the donor module root. The source
compiles actual Rust and TypeScript; it activates no live account or inference.

The root library includes the AI modules and explicitly compiles the host's
healthy protocol example. That example contains synthetic enrollment, account,
cryptography and other authority peers. It is not executed or claimed as an
actual application slice by this continuation. Its inclusion in Cargo's explicit
example list adds compilation, not test or runtime execution. The existing
source-check runner still executes only its three named native healthy examples.

## Native app mounting boundary

`http::ai::mounted_router` accepts the actual host API and an explicit enrollment
owner, then returns the owner's AI HTTP router. `router_with_ai` mounts a supplied
router beneath
`/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/ai`, inside the existing
checked-header, request-admission and private-response middleware. The current
binary calls `router(host)`, whose default mount remains absent.

The root `ApplicationAuthority` uses the actual `CheckedHeaders`, retains the
original admission permit across asynchronous work, and obtains the canonical
full path from Axum `OriginalUri`. That explicit existing-version feature is
enabled without a dependency-version or lock change. Nested route stripping
cannot replace the original home selector. Scope IDs pass the existing native
validator, the configured home must exist, and GET/POST use actual AT11 Read/
Mutate authorization with the existing Origin/cookie/CSRF rules before body
intake. Access and Core locks do not survive the async native-context capture.

The original principal reaches `NativeHostContext::capture`; no JSON actor,
registration, cookie label or copied grant can construct that private context.
The enrollment owner's `capture(original)` must resolve genuine current server
registration state, and its existing `RegistrationAuthority::revalidate` checks
that exact binding. Admission and ordinary final release revalidate the original Access principal
and unchanged enrollment binding. A successfully persisted disconnect receipt
uses the owner's narrow receipt proof: actor/home/registration/authority epoch
remain equal, while intentional cancellation-epoch rotation is allowed.
`ReceiptEnrollment` wraps the same enrollment owner for native host and lifecycle
registration authorities; the root HTTP authority uses that same proof. Host
construction must pass the same wrapped owner to every boundary. No host or
enrollment is configured by the current binary. The private wrapper retains
native context plus HTTP admission. The API adapter passes its borrowed native
context to the same actual host, preserving that host's credential/model/catalog/
continuation/trusted-human peers. No synthetic enrollment, inference admission,
credential store, review receipt or alternative stock service is provided.

The inherited actual upload regression completed all 44 healthy loopback requests
with the newly compiled binary and unchanged current application bundle. It
retains the original native/stock history, media and read-only SQLite linkage
checks. AI calls were absent; this is an upload/router regression, not AI runtime
evidence. The receipt-proof successor has source compilation evidence only; this earlier
healthy upload regression does not establish its runtime behavior.

## Remaining actual mounts

The current application has no configured enrollment owner, maintained identity
verification/OS-backed encrypted credential boundary, qualified connection-fact
provider, selected account model or trusted human-review surface. Their typed
ports remain required; application authentication alone supplies none of them.
Official SIWC/Responses implementation choice remains accepted. This limitation
is about concrete peers, not a request to choose another provider or authorize
live tokens/inference.

The exact published UI mount proposal is now applied to App, Settings pages,
SessionApp and the root browser entrypoint. The parent explicitly released this
owner proposal for composition with the UI successor. The actual AiHost and
settings/status components are compiled into the application bundle. The root
HostApplication accepts an optional genuine AiApplicationPort; the current
binary supplies none, so the mounted Settings section reports unavailable and
creates no fabricated client, registration, token or inference admission. A
future supplied port must preserve the full actor/session/home/registration/
cancellation-epoch scope key and stable client, with no render-time side effect.

The original UI successor confirms idle review cancellation by reading the
persisted terminal status once, retaining usage and clearing that review. Its
new explicit browser example is compiled, not executed by this integration.

## Verification and limits

The current root composition includes reviewed main
`87ad201140edb7b3afdb4396095a320c2926eafe`, preserving its actual original-reuse
and committed upload cleanup path, corrected method fallback, native reader,
calendar formatting and MCP lifecycle. Exact owner AI source remains unchanged.
The UI original-cancellation correlation and backend empty-completion findings
remain with their owners. This composition stays draft and cannot merge until
those exact successors and final review/CI clear.

Locked actual Rust library/binary/explicit-example compilation, rustfmt, strict
Clippy, generated contract/catalog/history checks, four explicitly named healthy
native examples, strict TypeScript and Vite pass. Both workflows are unchanged.
The actual rebuilt binary SHA256 is
`d44e95ef78db1fa051f50be7f89838ac29bf6775248f5476d8967693f09edae9`.
It passed the inspected 30-request browser classification/MCP read/history flow
with real SQLite linkage and actual Settings AI-unconfigured display. It also
passed the separate 51-request fresh attachment/reuse flow. Evidence SHA256 is
`3190ef885bcfe418fa7617ec142e54bc4ad3583997be9023696f80110b4ee598`
and `08d0812b45d7e377819079af607a5900c137736d8502604a3f28084937806743`
respectively. Vite retains its existing large-bundle warning.

No AI request, lifecycle action, model selection, credential peer, inference
spend, live account/grant, provider call, remote listener or deployment runs.
Cancellation/replay/review/protocol examples remain compiled only. All stopped
rejection, guard/mutation, adversarial, expiry/revocation, fault/crash/corruption,
concurrency and denial controls remain unrun. Actual enrollment, OS credentials,
model/catalog, canonical continuation and trusted human approval remain missing.
Compiler and ordinary unconfigured UI success do not qualify AI runtime behavior.
