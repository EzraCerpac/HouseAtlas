# Native AI startup consumers

This namespace supplies concrete native consumers over the existing
`TrustedAiStartup`, accepted AI runtime, encrypted `FileCredentialBoundary`,
native authority, generated stock schemas, shared stock executor and exact
review continuation. It does not replace their policies. The default concrete
stock factory admits the application's existing native Atlas reads only.
Reviewed writes require the existing reviewed stock owner and genuine review
owner as typed inputs.

`NativeStartup::assemble_native_reads(StartupOwners, StartupInputs<R,O>)`
constructs the concrete read composition. `NativeStartup::assemble` accepts a
factory for an existing `SharedStockPort` owner instead. Both retain the same
actual Host access allocation, EnrollmentOwner, StatusJournal, original review
Arc and encrypted credential boundary. The security and provider consumers
implement the supported official local public-client SIWC path; the existing
models and Responses HTTP transports use that same credential boundary.

Construction starts no listener, browser, worker, key lookup, enrollment,
OAuth exchange, account query or inference. It validates the existing encrypted
directory and creates inert HTTP clients. NativeBrowser construction inspects
an explicitly supplied existing native opener executable. These constructors
have not been executed for this source delivery.

## Integrator contract

The existing root `host/trusted_startup.rs` assembly and five-field
`AiReceiptIdentity` projection are retained. The returned AI router is mounted
through the existing root API:

```rust,ignore
let startup = NativeStartup::assemble_native_reads(owners, inputs)?;
let router = crate::http::router_with_ai(host, Some(startup.mounted_router()));
```

`host` must retain the same original Host as `owners.host`. Root decides whether
to assemble/mount this router and keeps the startup owner alive for explicit
native operations. This snippet is an API contract, not a production mount.

`integration.patch` is an exact, unapplied additive proposal against the inspected
composition baseline. It declares `host::startup`, adds maintained JWT dependency
`jsonwebtoken =11.1.0` with AWS-LC and its generated lock delta, and exposes the
existing root `stock_failure` conversion as `pub(crate)`. It changes no routing
behavior. Root alone applies shared declarations, manifests, mount configuration,
and the publication manifest. This donor leaves those actual files untouched.

The explicit native methods are:

- `receipt_identity(&NativeHostContext)`: configured enrollment verification and
  the existing trusted receipt projection; cancellation rotation never grants
  credential or dispatch authority.
- `choose_model(original_context, slug)`: genuine AT11 mutation authority plus
  fresh membership observed from this registration's original credential session.
- `enroll_existing_approval(original Principal)`: trusted administrative input
  only; reuses installed approval and actual original encrypted first-record seal.
  It is absent from mounted Connect/browser routes and never provisions a key.
- `process_next_callback(cancel)`: explicit native worker consumer of the bounded
  local socket capture and original principal, binding and durable action ID.
- `refresh(original_context)`: the accepted lifecycle's durable refresh operation;
  no automatic timer, rotating-grant replay or background inference is installed.

Connect/Consent reserves a genuine loopback socket and launches the official
authorization URL only through the existing lifecycle action. The native helper
captures a bounded HTTP callback on that same socket. Browser callback data
cannot install an enrollment, change the original principal, select a model,
qualify a runtime or authorize spending. The helper lasts at most ten minutes;
it requires the current process to be available and implies no permanently awake
computer. Existing cancellation, usage/status journaling and exact review
continuation semantics remain with the accepted runtime owners.

## Original production inputs

`StartupConfiguration::read_pinned(path, expected_sha256)` reads an explicitly
selected private configuration through the existing secure file reader. The
separately supplied SHA256 is a custody pin from the trusted input owner;
it is not evidence of external approval. This non-deserializable startup object
also checks the exact configuration already installed in the EnrollmentOwner.
No browser DTO can create it. The strict private file fields are `schemaVersion`
(1), `applicationOrigin`, `stableHostId`, `appName`, `credentialDirectory` and
`registrations`. Each registration has `registrationId`, `actorId`, `workspaceId`,
`homeId`, `authorityEpoch`, `cancellationEpoch` and optional `modelSlug`.

An optional `modelSlug` is an explicit candidate, not a default. Actual official
account discovery must list it for this exact credential session before the host
can select it. An explicit native choice may replace it; refresh retains that
choice only within the same original binding and bearer and fresh membership.
Missing or stale selection fails through the accepted runtime's persisted failure
receipt. No fallback model, reused account session or paid path is supplied.

Production inputs still include the externally approved private configuration
and digest, genuine AT11 principal and approved registration, securely opened
existing host database/journal, existing encrypted directory/native key and
trusted opener executable, original human review/stock owner and independently
qualified observation/admission owner. These are original inputs, not invented
credentials or new policy implementations. `HeldConnectionFacts` is an explicit
source-only observation owner: eligibility stays unknown, runtime qualification
and paid-use admission stay held. Sign-in, scope or discovery never upgrades it.
SQLite and encrypted-file enrollment commits remain separate; this code supplies
no automatic repair/retry or cross-store atomicity claim.

## Verification scope

This source was composed in a disposable artifact with the exact proposed root
additions for locked offline compilation, strict Clippy of the backend library,
binaries and configured examples, and whole-workspace formatter checks. Examples
were compiled only. The actual source checkout remains unmounted until root
applies its proposal. No constructor, enrollment, OAuth, native key, model
discovery, provider/account request, inference, paid use, deployment, callback
runtime or held control was executed. Compiler success is source evidence only.

Protocol sources: official [SIWC sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
and [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
