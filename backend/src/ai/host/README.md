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
permission, eligibility, paid-use and runtime availability from the cached,
credential-free display returned by `LifecycleEnvironment::cached_display`.
That required port is synchronous and infallible, accepts the original context
only for receipt display, and performs no provider/runtime observation or
credential acquisition. It is called after local stop-use and the host receipt
authority proof. A fallible `snapshot` observation never gates disconnect; no
remote termination is inferred. The action receipt key
retains actor/workspace/home/registration/authority epoch and excludes only the
cancellation epoch, so a new current binding can poll that receipt. Request,
continuation and launch keys retain both epochs. `StatusJournal::new` upgrades
existing six-field action keys to the five-field receipt scope in one SQLite
transaction before exposing the journal. Payloads, states, cancellation flags,
request rows and existing observations are preserved. Each upgraded action's
original six-field key is retained in an upgrade observation in that same
transaction. Ambiguous identities/collisions
fail the transaction without choosing a receipt or merging actions; their manual
reconciliation remains application-owned. Completion requires exactly one
updated action row, so a missing correlation cannot silently report success.
Opening/upgrading the journal performs no action or callback replay.

The trusted callback host calls `LifecycleHost::complete` with the original
launch/action correlation. Launches now journal the original nonce digest as
well as the state digest; completion backfills nonce correlation for an older
pending launch before its code can be consumed. Explicit host
`verify_received_exchange(context)` and the received-exchange branch of
`refresh(context)` recover that exact action from the retained original nonce.
A delegating credential boundary checks the same binding/nonce again under the
actual operation lease before the shared lifecycle verifies/activates anything.
No nested lease, code re-exchange, refresh grant or browser-provided action ID is
used for verification. The action is completed through the existing journal with
an infallible cached display, so unavailable fresh observation cannot orphan a
successfully verified workflow. Such receipts retain unknown permission,
eligibility and runtime availability and held paid use; current connection facts
remain a separate authority. Missing historical nonce/action correlation
requires trusted reconciliation; it is never guessed.

`checkpoint::encode`/`decode` implement a bounded, versioned private checkpoint
codec for all four variants, including the received exchange's original binding,
issued client, protected nonce and full raw token reply. `CheckpointPlaintext`
intentionally has no Debug, Display, Clone or Serialize implementation and is
exposed only for the encrypted credential adapter. This is plaintext encoding,
not encryption or activation authority. The root must authenticate/decrypt before
decoding and atomically encrypt the complete same-registration record, preserving
its previous credentials and checkpoint together. The codec supplies no path,
OS encryption, ciphertext authentication, zeroization qualification or plaintext
fallback. It must never be wired into HTTP/model/browser DTOs or diagnostics.

`AiHost` runs and resumes the shared runner using server-selected model settings
and the original catalog, continuation and separate human review owners.
`HostContinuations` retains original opaque prepared handles in a bounded,
process-local registry. It binds both epochs, checks expiry and the existing
`ExactReviewReady` owner, and claims once. It never accepts approval in browser or
model JSON. Retained handles cannot be restored from journal metadata after a
restart; deliberate reconciliation remains necessary.

Cancelling a persisted `ReviewRequired` request retires those retained handles
and persists a terminal `Cancelled` outcome with the original usage, even if
the completed caller still retains its `ActiveRun` guard during response release.
Its receipt is `Confirmed` because the runner has yielded its checkpoint.
Finished journal outcomes take precedence over the active map during status
reads; a lingering guard cannot conceal a review, cancellation or terminal
domain-held result as `Running`. Cancellation of an executing request
requests its existing stop flag and remains `Requested`; dropping HTTP processing
proves no remote end. Polls never replay inference or domain work. The journal
writes status, observed usage and diagnostics in a dedicated supplied SQLite
connection. Unknown usage remains null. Storage failure in infallible usage
callbacks latches cancellation before another tool can prepare.

A returned `Stopped` ends local processing, even though the durable request
remains unconfirmed about provider completion. The browser releases that local
inference slot while retaining the returned usage, request ID and uncertainty.
The host does not fabricate provider completion or change this journal state.

Candidate selection and callback selection are known synchronous prerequisites
before OAuth begin, credential acquisition or launch. If either fails, the host
atomically journals the original command/typed cause and a terminal local
workflow receipt under the original action ID, then returns the original typed
error. An original-ID status read can retire that failed workflow. Its
`Completed` status means only local workflow closure; cached identity display
is preserved but eligibility, permission, paid-use admission and runtime
qualification/readiness remain held. Later OAuth-begin/launch uncertainty is
not reclassified by this correction.

`prelaunch_failure_checks.rs` contains the explicitly requested candidate and
callback selection failure checks. It is an unmounted external test target,
outside ordinary healthy CI. A disposable manifest uses this exact source file
with `houseatlas-backend` as a path dependency and the already-approved Tokio,
rusqlite, serde_json and tempfile versions. Run the target locked/offline with
`--test-threads=1`. Its failing synchronous synthetic selectors invoke no
security, credential, provider, launch, snapshot-I/O or inference port. Two fresh
IDs per check yield terminal original-ID receipts with held admission; SQLite
reopen preserves receipts and original input/cause. Optional
`HOUSEATLAS_FOCUSED_PEER_OUTPUT` exports credential-free synthetic DTOs to an
explicit private folder for the focused browser check. Other held controls
remain unexecuted.

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

The checked-in integrator-owned `backend/src/http/ai.rs` contains receipt release
and authority methods plus `ReceiptEnrollment<R>`. `mounting.patch` retains the
additive adapter proposal already incorporated there; do not reapply it to this
tree. The composition must still use the same wrapped enrollment owner for
`NativeHostAuthority` and the lifecycle `HostAuthority` receipt proof as well as
the app mount. Runtime implementations must also supply `cached_display`
from existing cached/configured credential-free metadata. Wrapping the HTTP gate
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
No Atlas schema is changed. The explicit enrollment owner below creates only its private host table; encrypted credential storage remains in the credential adapter.

## Verification scope

Run the integrated tree's normal compiler checks:

```sh
cargo fmt --all --check
cargo check --locked -p houseatlas-backend --lib --bins --examples
cargo clippy --locked -p houseatlas-backend --lib --bins --examples -- -D warnings
```

The source runner compiles examples and separately runs its four named
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
under the new binding, including after a healthy reopen. Its display counter
proves cached display is collected after local stop and its observation count
proves disconnect invokes no fresh snapshot. Positive legacy receipt and pending
rows are upgraded during reopen, retain their original payload/state/flags, and
are polled under the current binding. Provider revocation,
callback exchange, refresh grants, approval, mutations and native stock dispatch
are not executed. A separate positive received-checkpoint fixture exercises the
actual private codec and host refresh-to-verification branch with a synthetic
identity verifier and serialized synthetic credential lease. It completes the
original action with identity-only scope, retains the validated synthetic session,
keeps paid inference held, and calls no exchange/refresh/revocation provider port.
It does not simulate verification failure, lost replies, replay or corruption. Successful requests also count ordinary and disconnect release proofs.
Optional `HOUSEATLAS_AI_HEALTHY_JSON` output is synthetic and belongs outside Git.

The integrated adapter and host are covered by compiler checks. Error-path
release, the finished-review interval with a lingering guard, pending callback
completion/backfill, checkpoint-change/correlation rejection, and migration
collision/failure behavior are inspected structurally.
The healthy fixture does not reproduce that concurrency interval or execute
callback/token exchange or rejected/malformed/body-limit/fault inputs. This evidence does
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


## Original enrollment and credential bridge

`EnrollmentOwner::new(private_connection, actual_access_boundary, journal)` owns
only private registration configuration and cancellation generations. The same
Arc must supply HTTP enrollment capture, native registration authority and
`NativeCredentialAuthority<NativeHostContext>`. `TrustedRegistration` accepts
configuration from an existing approved enrollment; construction is not approval.
`install_existing_approval` is an explicit trusted application operation with the
actual editor/CSRF mutation principal. External approval provenance is a trusted
input that the integrator must verify; the random local marker only correlates
an installation and does not establish provider approval or a grant. No HTTP Connect or empty-state fallback
installs an enrollment, native key, account or grant.

`NativeCredentialAuthority::enroll_initial_record` supplies the complete cleared
Disconnected record to PR98 `FileCredentialBoundary::enroll_atomic`. The adapter
uses its existing native key and exclusive lease, authenticates/encrypts the
record and publishes only an absent file. Current first enrollment requires
Linux atomic NOREPLACE; unsupported platforms fail closed. No native key lookup
was executed for this host change. IssuedWebsite configuration still needs an
explicitly authorized preprovisioned client-ID transition before OAuth begin;
this host does not invent that identifier or an account registration.

The retained proof owns the actual original AT11 principal, exact binding,
configuration, approval generation and instance capability. Persistence holds
AT11 and enrollment SQLite writer fences through a bounded synchronous file
commit. Stop latches journal cancellation before rotating the durable cancellation
epoch and creating a restricted stopped capability. The original proof is never
rebased. SQLite enrollment and encrypted-file commits are separate: a later
barrier/commit error remains uncertain and cannot authorize an automatic retry,
rollback claim or enrollment repair.

`mounting-enrollment.patch` proposes only two additive declarations and the HTTP
EnrollmentPort implementation against root `f3617902`. Root already contains
credential_boundary and its approved dependency graph. The integrator applies
and reviews this zero-context proposal (`git apply --unidiff-zero` after exact
preimage comparison), uses `RequestContext::native` when a credential context
is HTTP-backed, and supplies the actual API to `http::ai::mounted_router`.
The host creates no listener or default operational mount. Browser receipt recovery
also requires trusted `AiReceiptIdentity` from the same actor/workspace/home/
registration/authority fields; the opaque full scope still includes session and
both epochs. An omitted receipt identity keeps conservative full-scope isolation.

## Scoped lifecycle corrections

Request status first reads the exact current epoch and otherwise exposes one
uniquely owned previously cancelled receipt under the same five identity fields.
That path cannot claim a continuation or dispatch a command. Canonical local
Stopped receipts preserve usage and release the browser slot; their durable
journal state remains Unconfirmed about provider completion. A late review is
retained privately as an observation while Stopped is public. Already completed
or domain-held outcomes retain their actual evidence. The service returns the
journal's canonical receipt and preserves PR110's selected-model failure receipt.

Missing action rows use an optional query, allowing Unconfirmed disclosure.
Successful ManageUsage persists Completed before fetching a fresh display; a
subsequent snapshot error is returned unchanged and the original action ID can
still reconcile its completed receipt. Cached access/admission metadata remains
held or unknown until a successful fresh snapshot supplies it.

Eight explicit status cases, four explicit lifecycle cases and two browser cases
passed in the isolated synthetic concurrency/denial/failure lane authorized by
policy PR108. Earlier compiler/readiness/render-timing failures remain recorded
outside Git. These fixtures are intentionally unmounted and have no ordinary-CI
or broad-discovery alias. `enrollment_healthy.rs` separately passed actual native
principal/proof/fence/stop and SQL reopen. `credential_enrollment_healthy.rs` is a
positive disposable-facade example using actual native authority and PR98 codec,
lease and filesystem with an injected synthetic key; encrypted enrollment,
stopped terminal persistence and healthy reopen passed. Public native-key enrollment and the router composition
are compiler checked. Reconnect uses the exact PR112 source in that composition;
no reconnect/provider/native-key operational qualification is implied.

Replay, corruption, expiry/revocation, crash, mutation/adversarial and historical
held controls remain unrun. SIWC implementation GO does not establish account
eligibility, paid inference or operational runtime approval. Root mount, manifest
reseal and composed platform CI remain integrator-owned.
