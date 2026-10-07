# Rust AI host/runtime

The checked-in AI module and this namespace implement a configurable Rust host.
The application tree declares the module and healthy example, contains the native
HTTP adapter and optional `router_with_ai` mount, and includes host source in the
publication manifest. The default binary supplies no AI host or enrollment, so
it does not enable an AI route. Real account and runtime peers remain required.

`HttpResponses` performs actual reqwest HTTP and incremental response I/O for
`ResponsesAdapter`. The production target is the public Responses API; an
explicit IPv4 loopback target accepts only the fixed synthetic marker. Redirects,
proxy discovery and retries are disabled. Shared Responses encoding, complete
history, stock schemas, `store:false`, `stream:true`, bounded SSE decoding and
terminal handling remain in the AI module.

`StoredSession` obtains credential leases through the existing
`CredentialBoundary`. Its `ConnectionFacts` source must use current scoped model,
eligibility, paid-use and runtime authorities over that same leased record.
Submission and response consumption revalidate the lease. `StoredModels` and
`HttpAccountModels` implement separate account model discovery; listing does not
admit inference. Official SIWC implementation GO remains; neither eligibility
nor paid-use permission follows from implementation or synthetic success.

`LifecycleHost` invokes the shared OAuth begin/complete/refresh/disconnect logic.
It journals action correlation before side effects and keeps launch URLs,
callback codes and tokens inside the trusted credential host. Disconnect requests
local stop, then uses the lifecycle's durable credential retirement and existing
revocation semantics. Its response conservatively clears authorization,
permission, eligibility, paid-use and runtime availability from the previously
authorized snapshot; it claims no remote termination. The action receipt key
retains actor/workspace/home/registration/authority epoch and excludes only the
cancellation epoch, so a new current binding can poll that receipt. Request,
continuation and launch keys retain both epochs. Existing action rows written
with the former key are not migrated or replayed by this change.

`AiHost` runs and resumes the shared runner using server-selected model settings
and the original catalog, continuation and separate human review owners.
`HostContinuations` retains original opaque prepared handles in a bounded,
process-local registry. It binds both epochs, checks expiry and the existing
`ExactReviewReady` owner, and claims once. It never accepts approval in browser or
model JSON. Retained handles cannot be restored from journal metadata after a
restart; deliberate reconciliation remains necessary.

Cancelling an idle `ReviewRequired` request retires those retained handles and
persists a terminal `Cancelled` outcome with the original usage. Its receipt is
`Confirmed` because no run is active. Cancellation of an executing request
requests its existing stop flag and remains `Requested`; dropping HTTP processing
proves no remote end. Polls never replay inference or domain work. The journal
writes status, observed usage and diagnostics in a dedicated supplied SQLite
connection. Unknown usage remains null. Storage failure in infallible usage
callbacks latches cancellation before another tool can prepare.

`NativeHostContext`, `NativeHostAuthority` and `NativeReadStock` reuse the original
opaque AT11 principal, native schemas and shared stock catalog/service. Explicit
read admissions exclude providers and mutations. Reviewed writes still require
the original `SharedStockPort`, exact human review and durable dispatch owners;
this namespace supplies no alternative approval or domain authority.

## Mount API

Use the application's `http::ai::mounted_router(existing_host, api,
registrations)`, then supply that router to `http::router_with_ai`. The qualified
base is `/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/ai`.
The native adapter captures the canonical original URI, original AT11 session,
checked Host/Origin, qualified home, POST CSRF and admission permit across await.
Browser labels and JSON IDs establish no authority.

| Relative route | Method | Input | Bare response |
| --- | --- | --- | --- |
| `/connection` | GET | none | `ConnectionSnapshot` |
| `/models` | GET | none | account model projection |
| `/connection/actions` | POST | `{actionId,command}` | `ConnectionActionResult` |
| `/connection/actions/{id}` | GET | none | same action result/ID |
| `/run` | POST | `{requestId,prompt}` | `RunOutcome` |
| `/requests/{id}/cancel` | POST | `{requestId}` matching path | `CancelReceipt` |
| `/requests/{id}` | GET | none | `RequestStatus` |
| `/review` | POST | `{requestId,continuationId}` | human review result |
| `/resume` | POST | same review input | `RunOutcome` |

Every result after successful HTTP authentication passes through the release
proof, including body-limit, decoding and host errors. Release failure overrides
the earlier result before disclosure. A successful persisted disconnect uses
`release_after_disconnect`; all other responses retain full epoch revalidation.
The receipt-only proof must retain the original session/principal, qualified
home, registration and authority epoch, resolve the current cancellation epoch
from the same enrollment owner and revalidate that current full binding. It
cannot authorize credentials, inference, continuation claims or dispatch.
The new trait methods conservatively default to full revalidation.

`mounting.patch` contains only the exact additive changes proposed for the
integrator-owned `backend/src/http/ai.rs`: the receipt release and authority
methods plus `ReceiptEnrollment<R>`. The sole integrator must apply it and use the
same wrapped enrollment owner for `NativeHostAuthority` and the lifecycle
`HostAuthority` receipt proof as well as the app mount. Wrapping the HTTP gate
alone cannot repair a stricter lifecycle or service proof. The wrapper delegates
normal operations to the original owner and validates a newly captured full
binding for receipt disclosure. No root file is changed by this namespace.
Custom continuation stores must implement `ContinuationRetirement` to discard
original handles without approving, claiming or dispatching them.

The browser client uses same-origin cookies and the existing `X-Atlas-CSRF`
transport. Rebuild its client/full scope when actor, session, qualified home,
registration or cancellation epoch changes. `BridgeHttpGate` and `MountedHost`
separately support a qualified local companion with configured Origin, Host and
per-install capability correlation; they create no listener or wake capability.
Supply `StatusJournal::new` a securely opened private host database; canonical
path, no-follow/private permissions and retention remain application-owned.
No Atlas schema or credential storage is created here.

## Verification scope

Run the integrated tree's normal compiler checks:

```sh
cargo fmt --all --check
cargo check --locked -p houseatlas-backend --lib --bins --examples
cargo clippy --locked -p houseatlas-backend --lib --bins --examples -- -D warnings
```

The source runner compiles examples and separately runs its three existing
healthy core examples. It does not run the AI example. Inspect `healthy.rs`, then
run the explicitly scoped positive fixture when authorized:

```sh
cargo run --locked -p houseatlas-backend --example healthy-ai-host
```

The fixture uses disposable IPv4 loopback and synthetic account, session,
enrollment, security and credential peers. It exercises actual models HTTP,
chunked completed Responses SSE, session/bridge routing, runner/status,
SQLite usage and healthy reopen, and pending OAuth begin/action correlation.
Its local review dismissal starts from a seeded synthetic waiting row and an
actual retained checkpoint, retires that checkpoint and persists cancelled
status with unchanged usage. Its no-token disconnect executes the actual local
lifecycle with synthetic epoch rotation and retrieves the same persisted receipt
under the new binding, including after a healthy reopen. Provider revocation,
callback exchange, refresh, approval, mutations and native stock dispatch are not
executed. Successful requests also count ordinary and disconnect release proofs.
Optional `HOUSEATLAS_AI_HEALTHY_JSON` output is synthetic and belongs outside Git.

The receipt adapter proposal is compiled only in a private disposable integrated
copy until the integrator applies it. Error-path release is inspected structurally;
no rejected/malformed/body-limit/fault inputs are executed. This evidence does
not qualify a live browser/native credential host, OS encryption, identity
verification, durable domain queue, hard memory/deadline bounds or concurrency.
No real account, credential/grant, paid inference, provider access, deployment,
support outreach or permanent awake-Mac assumption is used. Historical stopped
rejection, replay, fault, corruption, concurrency, expiry/revocation and
adversarial/mutation controls remain held. Original inputs remain preserved.

Official protocol references:
[models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[background cancellation](https://developers.openai.com/api/docs/guides/background).
