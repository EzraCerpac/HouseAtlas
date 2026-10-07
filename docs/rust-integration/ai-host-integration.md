# AI host composition

This local continuation composes the exact accepted AI donor
`edca73b09f879f167f7f2e258e534b734919290d`, Rust host PR51
`f4d34ad5b2acdbd621511a3eb7a5bcb12aabe7d8`, and React host PR42
`8ea0ebaf3a53740b5080ca4f6a80559582eeec8d` over identity-corrected upload PR52
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
that exact binding. Both admission and final release revalidate the original
Access principal and unchanged enrollment binding. The private wrapper retains
native context plus HTTP admission. The API adapter passes its borrowed native
context to the same actual host, preserving that host's credential/model/catalog/
continuation/trusted-human peers. No synthetic enrollment, inference admission,
credential store, review receipt or alternative stock service is provided.

The inherited actual upload regression completed all 44 healthy loopback requests
with the newly compiled binary and unchanged current application bundle. It
retains the original native/stock history, media and read-only SQLite linkage
checks. AI calls were absent; this is an upload/router regression, not AI runtime
evidence. Identity-only ancestry reconciliation preserved source trees and all
51 dirty work files. Application tests were not repeated for that metadata change.

## Remaining actual mounts

The current application has no configured enrollment owner, maintained identity
verification/OS-backed encrypted credential boundary, qualified connection-fact
provider, selected account model or trusted human-review surface. Their typed
ports remain required; application authentication alone supplies none of them.
Official SIWC/Responses implementation choice remains accepted. This limitation
is about concrete peers, not a request to choose another provider or authorize
live tokens/inference.

PR42's exact `frontend/src/ai/host/mounting.patch` changes three UI-owned files:
`App.tsx`, `pages.tsx` and `SessionApp.tsx`. It places the AI provider above page
navigation and the settings panel inside Settings. Those files are preserved
until their original owner publishes the proposed mount. The root main-entry
proposal can then pass the real `AiApplicationPort` with a stable client and
full actor/session/home/registration/cancellation-epoch scope key. No render-time
side effect, browser-generated registration or default synthetic client is used.
The composed UI libraries typecheck but are not in the current application
bundle or demonstrated as a mounted AI panel.

## Verification and limits

Locked Rust library/binary/explicit-example compilation and strict Clippy pass
with the actual sources. Strict TypeScript and Vite pass. Both hosted workflow
files remain the exact CI40 files; the separate AI protocol example is not added
to ordinary runtime CI. The central publication manifest includes the exact composed files, modes,
digests and logical ownership. Hosted evidence remains separate from these local
source checks.

No new live account, credential/grant, provider call, inference spend, operational
listener or deployment is attempted. Cancellation/replay/review examples are not
run here. All stopped rejection, guard/mutation, adversarial, expiry/revocation,
fault/crash/corruption, concurrency and resource-denial controls remain unrun.
Compiler success does not qualify actual AI/browser/credential/runtime behavior.
