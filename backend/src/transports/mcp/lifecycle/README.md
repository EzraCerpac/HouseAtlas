# Native MCP lifecycle supplement

This leaf starts at merged PR39 main
`501ccf6507d5924b7acf36675140294596e990a4` (tree
`027efbbe00688bea65560f20231ed17ac28fab2f`). All repository additions stay in
`backend/src/transports/mcp/lifecycle/**`. Accepted MCP owner input
`97a1335b1419a4c12b2134fec2195ed68d67ed52` is already recorded by the root;
its adapter, protocol, catalog, principal and stock service sources are unchanged.
No private owner ancestry is imported.

The mounted root at `http/agents/mcp_transport.rs` already supplies the actual
HTTP endpoint, observed POST authority, Origin/CSRF, request intake, JSON replies,
MCP session IDs, idle/cookie/session limits, 405 GET/DELETE and response marking.
The accepted adapter already implements initialization, used-ID retention,
tools/list and tools/call, native rendering and current authority release.
This supplement composes those owners; it does not replace their protocol or
authorization engines. It adds no listener, bearer/OAuth grant, provider client,
deployment, generic structured error or synthetic principal.

## Concrete interfaces

`AuthenticatedIdentity::authenticate_post(access, observed, scope)` replaces the
mount's existing `AccessBoundary::authorize(..., Action::Mutate)` call. It uses
the same actual Access owner and observed evidence, retains its opaque principal,
and binds the authenticated cookie plus URL origin to that Access instance.
The digest is a private session selector after authentication, not authority.
Every later message requires a newly authenticated identity from actual POST
evidence. Both that issuance and the original issuance are revalidated, including
initialization, ping and notifications. Scope, credential and issuer must match.
The current request cannot replace the catalog's retained NativeContext.

`mount_adapter::bind(identity, service)` supplies the root's actual
`capabilities::reads()` and the existing admitted native schema bytes. It accepts
the root's `StockService` or `OwnedStockService` through its real ServicePort.
It applies PR39's 256-request / 64-KiB ID retention profile with its existing
64-KiB message / 1-MiB response defaults. `NativeSession::new` also permits explicit
owner admission/configuration. Neither constructor derives admission from role
or descriptive annotations.

`NativeSession::handle(current, original_bytes)` serializes ordinary messages
through the accepted McpAdapter. Initialization negotiates `2025-11-25` and
transitions New → AwaitingInitialized → Ready using the existing initialized
notification. `Delivery::Reply` retains the owner's exact reply bytes, including
an identified terminal limit error when the owner closes its session. Empty
notifications produce Accepted; external logical closure produces Closed.
No JSON-RPC or stock result is rewrapped. String and accepted integer IDs remain
distinct, and canonical request UUID/scope/command/ordered-child correlation
stays with the actual StockResponse validator and native catalog renderer.
The original adapter's integer-ID range and all its existing decoder bounds
remain in force; this leaf does not broaden them.

`session.control()` returns a cloneable, host-private `SessionControl`. Root
can deliver a cancellation notification through `control.notification(current,
bytes)` without holding the serialized session/Core lock. The exact accepted
decoder checks notification shape and the target ID; malformed/unknown/completed
and uncancellable targets are ignored with no JSON-RPC response. Initialize and
mutations are uncancellable. Calls become cancellable only after the real native
catalog has prepared an operation whose root and every ordered child have actual
read effect. No annotation or raw arguments determine this classification.

Cancellation checks before read dispatch can skip not-yet-started owner work.
Already-started synchronous native work completes through its actual owner
transaction and release checks; a cancelled read then produces Cancelled without
a JSON-RPC result. The leaf never aborts an atomic write, invents rollback,
retries an operation or converts cancellation into an error DTO. Native synchronous
work has no interrupt primitive. The integrator must keep `spawn_blocking` owner
work alive to completion when the caller's HTTP connection disappears. A dropped
handling future closes its logical session; that closure is not owner rollback.
Cancellation intake/races and transaction behavior are source-reviewed only.

`rotate_confirmed(access, observed)` calls the actual Access `rotate_session`
and returns its unchanged SessionReceipt plus an opaque ConfirmedRotation only
after successful native commit. The event contains no replacement principal,
cookie, CSRF or public actor DTO. Deliver it after releasing Core/Access locks.
`control.on_rotation(event)` closes sessions using precisely that old credential,
origin and Access instance, across their scopes. Other credentials/issuers do
not match. The fixed-context native catalog cannot be rebound to a new issuance;
the caller authenticates with the real new receipt and initializes a fresh
MCP session. This is a host-local confirmed notice, not an invented MCP wire
notification or tools/list_changed capability. The parent's browser session-change
producer remains a root/UI integration responsibility.

## Integrator proposal

`mount-proposal.patch` is an apply-checkable proposal against the exact PR39
preimages, not an applied root edit. `mount_adapter.rs` is the concrete compiled
adapter. The patch proposes five root-owned changes:

- Declare `mcp::lifecycle`; replace only the root-private owned binding with the
  lifecycle adapter while retaining borrowed `bind_read` and stock execution.
- Store an independent SessionControl beside each serialized HTTP entry. Keep
  the existing registry, route, bounds, cookie/scope binding and original checks.
- Authenticate MCP POSTs directly against the same Access Arc using host-configured
  scopes captured at startup, so cancellation intake does not first queue behind
  Core's synchronous stock lock. This requires parent reconciliation if runtime
  scope configuration ever becomes mutable.
- Route authenticated cancellation notifications through the control handle;
  use empty 202 for those notifications. Map normal replies through the existing
  marked byte response. Map cancelled requests to an empty HTTP 204 with no
  JSON-RPC result; remove/404 closed sessions. This transport completion choice
  requires the root owner's acceptance; it is not positive HTTP runtime evidence.
- Call the real rotation producer from the existing auth route, then invalidate
  matching controls after native commit. Preserve the real rotation receipt even
  if the transient MCP registry is poisoned; that branch is source-only.

The patch leaves router paths, HTTP ownership, GET/DELETE 405 behavior and
all deployment settings intact. It does not change Cargo manifests, lockfiles,
the central publication manifest, frontend code or CI. The parent must integrate
the declarations and add the new exact source entries to central integrity. The
unchanged publication verifier will reject this unregistered leaf until that
owner integration; CI success is not claimed for an unmounted input PR.

## Selected specification

The selected official revision is MCP `2025-11-25`:

- [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle):
  negotiation, initialized readiness and transport-owned shutdown.
- [Base protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic):
  distinct request IDs, exact result/error correlation and response-free notifications.
- [Cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation):
  same-direction in-progress IDs, no initialize cancellation, optional handling
  for uncancellable work and no result after accepted cancellation.
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports):
  single-message intake, notification 202, negotiated session/version headers
  and root session termination. This leaf adds no SSE or client-directed DELETE.

## Validation scope

The root module declaration and the proposed root edits were applied only to a
disposable source compiler harness copied from the exact base. Its source is the
actual root/library/peers plus these exact leaves and the proposed mounts; no
stub authority, domain, catalog or service was substituted. The only harness
manifest addition selects `healthy.rs` as the explicitly named
`healthy-mcp-lifecycle` example. Its Cargo.lock remains byte-identical to PR39.

`healthy.rs` uses a 0700 disposable synthetic fixture, actual Access login and
POST+CSRF issuance, the actual root StockService, real SQLite and the concrete
mount adapter. It runs two healthy init/initialized/list/identity-get sessions,
with one real Access rotation and confirmed old-session closure between them.
The second session uses genuine freshly issued authority from the real new
receipt. The example never sends a request with the old credential after rotation.
It checks string `"1"` and numeric `1` separately, signed/unsigned integer ID
correlation, exact text/structured content equality and owner-validated canonical
request UUID/command/scope correlation. Scratch state is closed and removed;
no password, cookie, nonce or protocol session header is printed.

`VALIDATION.md` records exact compiler/runtime commands and outcomes. These
checks do not establish mounted HTTP, browser/remote client or security readiness.
Previously held rejection, replay, expiry, revocation, fault, crash, resource-denial,
concurrency, adversarial, guard-reversal and mutation/omission controls remain
unrun. No replacement test wrapper, aggregate cargo test, real source/grant,
credential, external listener, target NAS or deployment is introduced.
