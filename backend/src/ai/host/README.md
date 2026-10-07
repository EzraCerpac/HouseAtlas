# Rust AI host/runtime

This namespace implements the in-app runtime binding over accepted AI PR10
`edca73b09f879f167f7f2e258e534b734919290d`, with exact integration
`7e742505fd360901a3976a993774a4bbdf7e2eaf` as its immutable native peer. Only
`backend/src/ai/host/**` is changed. The donor is not copied into this publication
branch, and root module declarations, manifests/locks, application router,
shared schema and publication manifest are unchanged.

## Actual code

- `HttpResponses` implements real reqwest HTTP and incremental response I/O for
  the accepted `ResponsesAdapter`. Production endpoint selection is fixed to the
  public Responses API. Configuration can instead select an explicit IPv4
  loopback fixture, which accepts only the fixed synthetic marker. Redirects,
  proxy discovery and automatic retries are disabled. Complete donor history,
  stock function schemas, `store:false`, `stream:true`, bounded SSE decoding,
  structured diagnostics and terminal handling remain donor-owned.
- `StoredSession` implements current connection checks and credential leases over
  the donor's actual `CredentialBoundary`. Its `ConnectionFacts` source receives
  the exact loaded registration record; it must use the existing scoped model,
  eligibility, paid-use and runtime authorities. The HTTP adapter revalidates
  that same lease before submission and while awaiting/consuming response chunks.
  `StoredModels` and `HttpAccountModels` implement separate account-specific model
  discovery with the documented `models`/visibility/slug projection. Listing does
  not issue inference or paid-use admission.
- `LifecycleHost` calls the accepted OAuth begin/complete/refresh/disconnect
  implementation. It durably captures the original action before a host action,
  correlates callback state digests with that action, records pending/completed/
  unconfirmed workflow status, and polls without reissuing actions. Launch URLs
  and callback/code/token data stay in the trusted credential host. Selecting a
  runtime candidate grants no qualification or availability. Disconnect first
  requests local stop; the donor retains confirmed/unconfirmed revocation.
- `AiHost` runs/resumes the actual donor runner, with server-selected model settings
  and the one shared domain catalog/continuation/human-review composition. Resume
  checks the separate human surface before claiming, then the exact continuation
  independently verifies its original immutable prepared handles and approval.
  No model/browser approval receipt or altered command payload is admitted.
- `HostContinuations` retains opaque prepared handles in a bounded process-local
  registry, binds actor/home/registration/authority/cancellation epochs, checks
  expiry and the injected existing `ExactReviewReady` owner, and atomically claims
  once. Its journal records correlation metadata; it never serializes/recreates
  prepared handles or becomes a second durable domain queue. After restart, those
  continuations are unavailable and require deliberate reconciliation. This is
  a retained code limitation, not executed restart/replay/expiry qualification.
- `NativeReadStock` projects all 164 metadata entries from the existing shared
  wire3 catalog, uses the existing native schemas/catalog and original opaque
  AT11 principal, and executes qualified local Atlas reads through
  `NativeStockService`. Native request digest construction and exact output/error
  validation remain with the shared owners. Its explicit admissions exclude
  mutations/providers. Reviewed writes require the integrator's existing exact
  `SharedStockPort`, trusted review owner and durable dispatch; this namespace
  provides no substitute approval or write service.
- `StatusJournal` supplies actual SQLite request/action/usage/diagnostic/domain
  observation persistence in a dedicated host database. It commits an unconfirmed
  request before execution, retains each observation before proceeding, and
  persists observed outcomes. Dropped execution and local stream stop remain
  unconfirmed in status; no recovery poll replays anything. Because two donor
  usage callbacks return no result, storage failure latches cancellation before
  another tool can prepare and prevents a successful host response. Unknown usage
  remains null; no cost/quota/reset estimate is invented.
- `SessionHttpGate` binds same-origin HTTP to the original app session, qualified
  home and registration/epochs. `BridgeAdmission`/`BridgeHttpGate` separately
  enforce exact configured HTTPS Origin, loopback Host and constant-time
  per-install capability correlation. Those capability headers are local runtime
  bridge inputs, not browser/provider credentials. Neither gate creates a listener.

Cancellation records a local stop request and observes the flag during pending
HTTP I/O. Dropping the stream is not proof of remote end. No background cancel
endpoint, remote completion inference, process waking or permanently available
companion is fabricated. The HTTP library owns its internal receive allocations;
the host bounds copied chunks/total/event bytes, not a qualified hard memory or
real-time deadline guarantee. Synchronous SQLite/native calls are not a qualified
hard-deadline or concurrency proof.

## Exact integrator API and PR42 reconciliation

The counterpart is PR42
`8ea0ebaf3a53740b5080ca4f6a80559582eeec8d`, inspected without modifying its nine
`frontend/src/ai/host/**` files. Its actual `client.ts`, decoder and README are
compatible with the following bare accepted serde DTOs. Agreement here is source
reconciliation and a healthy cross-language DTO check; it is not a live browser
and AT11/credential-host end-to-end qualification.

For a single host-resolved actor/session/home/registration/epoch, use a qualified
base such as `/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/ai`. The app
adapter must recover canonical full path/scope from the actual request and resolve
current registration on the server. Browser labels, scopeKey and cookies alone
are not provider or inference authority.

| PR42 endpoint key | Relative route | Method | Request | Bare response |
| --- | --- | --- | --- | --- |
| connection | `/connection` | GET | none | `ConnectionSnapshot` |
| connectionAction | `/connection/actions` | POST | `{actionId,command}` | `ConnectionActionResult` |
| connectionActionStatus(id) | `/connection/actions/{id}` | GET | none | same action result/ID |
| run | `/run` | POST | `{requestId,prompt}` | `RunOutcome` |
| cancel(id) | `/requests/{id}/cancel` | POST | `{requestId}` matching path | `CancelReceipt` |
| openReview | `/review` | POST | `{requestId,continuationId}` | `{status}` human review result |
| resume | `/resume` | POST | same review input | `RunOutcome` |
| requestStatus(id) | `/requests/{id}` | GET | none | `RequestStatus` |

The additional `/models` GET returns credential-free account model discovery.
Known runner terminal failures return the donor's canonical `RunOutcome::Failed`;
transport uncertainty remains a non-2xx response with an unconfirmed journal
record. Polls do not invoke inference/domain/connection actions. Rust JSON token
counts remain u64/null; PR42 deliberately refuses values not exactly representable
in JavaScript. The shared JavaScript number-model limitation remains.

Construct the actual router with root-owned implementations:

```rust
let ai_routes = crate::ai::host::http::router(
    std::sync::Arc::new(root_owned_ai_host),
    crate::ai::host::http::SessionHttpGate {
        application: original_app_http_authority,
        authority: original_registration_authority,
    },
);
// Only after the sole integrator applies the additive router proposal:
let application = crate::http::router_with_ai(existing_host, Some(ai_routes));
```

`original_app_http_authority` implements `ApplicationHttpAuthority`: retain the
existing checked Host/Origin/header admission, original AT11 session and qualified
home principal, current CSRF for POST, and original post-await release. The root
adapter must retain its admission permit across work, resolve the exact scope
from the canonical full URI, and never reconstruct authority from JSON IDs.
`NativeHostContext::capture` and `NativeHostAuthority` reuse the actual principal
and AT11 revalidation; `RegistrationAuthority` checks the exact current enrollment
and original epochs. `HostPeers` consumes those contexts with the one original
stock/domain and trusted human-review owners. No synthetic implementation is
exported from a production entrypoint. `ConnectionFacts` uses the supplied
registration under its retained lease; it must not reacquire that credential
lease recursively.

The browser's `createAiHostClient` uses same-origin cookies and its actual
`mutationHeaders` nonce, e.g. `X-Atlas-CSRF`. It needs no install-capability or
provider header. Rebuild its stable client/full scopeKey when actor, application
session, qualified home, registration or cancellation epoch changes. Configure
its endpoint functions with the table above and the captured qualified base.
Local companion IPC, if later chosen and qualified, instead uses `MountedHost`
with `BridgeHttpGate`; that bridge is not installed by the proposed app mount.

`mounting.patch` proposes exact additive changes to four integrator-owned files:
root library AI declaration, donor AI host declaration, explicit healthy example
entry, and optional `router_with_ai`. The router proposal places the qualified
nest before the existing shared response/admission middleware and defaults to no
AI mount. The patch is checked/compiled only in a disposable composition. Exact
preimages are:

| File | Peer | Base blob |
| --- | --- | --- |
| backend/src/lib.rs | integration 7e742505 | 7e0935ca453d79ff6fb22f9d34d335c3939d82a8 |
| backend/Cargo.toml | integration 7e742505 | f23edf6fb3ba99b372dec73b2329dddc93eab72a |
| backend/src/ai/mod.rs | accepted donor edca73b | b81939cd0c4953c84886975222a56e94d9133e63 |
| backend/src/http/mod.rs | integration 7e742505 | eadb91d303e1ce910f7c6063bdddb1fdc5ae6aa0 |

The root router's full preimage is pinned by the exact integration commit. Import
accepted AI donor bytes separately, reconcile root adapter/credential/security/
review enrollment peers, and add this namespace's exact files/modes/digests/logical
ownership to the publication manifest. Do not weaken that manifest/CI allowlist.
No new dependency feature, schema-owner file or lock change is required. Supply
`StatusJournal::new` a dedicated securely opened private database; the integrator
owns canonical path, no-follow/private modes, storage placement and retention.
It creates only `ai_host_*` tables in that supplied database, not the Atlas schema.

## Scoped verification

Read `healthy.rs` before running. Add the proposed declarations/example entry only
in a disposable copy of the exact integration and accepted donor sources; run:

```sh
cargo check --locked -p houseatlas-backend
cargo clippy --locked -p houseatlas-backend --lib --bins --example healthy-ai-host -- -D warnings
cargo run --locked -p houseatlas-backend --example healthy-ai-host
```

Rust 1.99.0 compiled the library/binary and the optional router proposal. Scoped
Clippy and rustfmt checks passed. The inspected healthy example exercises actual
HTTP model GET and chunked completed Responses SSE, actual same-origin session
and separate bridge routing, actual runner/run/status, dedicated SQLite usage and
healthy reopen, and actual OAuth begin/pending action correlation/status. Every
account/admission/encryption/security/native-session peer in this protocol example
is explicitly synthetic; no callback/token exchange, refresh, disconnect,
reviewed mutation, native stock operation or cancellation control is executed.
The fixture serves two provider-protocol requests on disposable IPv4 loopback,
opens no external URL, and stops both listeners. Its optional
`HOUSEATLAS_AI_HEALTHY_JSON` output is synthetic and belongs outside Git.

Actual Rust connection/action/run/request-status JSON was consumed successfully
by the exact donor and PR42 TypeScript decoders with Node 26.10.0; only disposable
relative import suffixes were adapted for native TypeScript execution. That is
positive serde/decoder evidence, not strict TypeScript/browser qualification.

`cargo clippy --all-targets` additionally tried compiling the retained Network
`transport_healthy.rs` at exact integration7e742505 and failed because that root
manifest does not declare its imported `tokio_rustls` and `rcgen` crates. No test
was executed and no owner file/dependency was changed to bypass the blocker.
Scoped library/binary/AI-example checks pass independently. The checked-in
publication verifier excludes this unintegrated namespace until the integrator's
additive manifest update; hosted allowlist failures are not permission to weaken
integrity checks or evidence that this unmounted Rust source ran in CI.

Official current protocol sources reviewed 2026-10-07:
[models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[background cancellation](https://developers.openai.com/api/docs/guides/background).
Official SIWC implementation GO remains. Implementation and synthetic success do
not establish eligibility or paid-use permission. OS-backed encrypted storage,
maintained identity verification, real registration/runtime/human-review binding,
actual root/browser/native integration, live provider and operational acceptance
remain separate qualifications. No live account, new credential/grant, inference
spend, support outreach or deployment occurred. All stopped rejection, replay,
fault/crash/corruption, concurrency, expiry/revocation and adversarial/mutation
controls remain held and unexecuted. Original inputs and stopped control files
are preserved.
