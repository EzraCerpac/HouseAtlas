# Native evidence upload observations

Each newly dispatched native evidence attempt retains an in-memory browser
observation. The pending-attempt UI shows its last phase, received HTTP status,
elapsed milliseconds and a fixed failure category. Phases distinguish transport
startup, waiting for headers, reading/decoding the response and validating the
response for the exact request. Times are relative to the commit call and
saturate at 2,147,483,647 ms. They measure neither bytes sent nor server progress.

The original thrown value stays in the client's private custody and is rethrown
unchanged. Pending views contain no exception message, stack, request headers,
cookies, CSRF, filename, statement, reason or file bytes. Nothing is persisted
or logged. Scope/session visibility and the existing bounded attempt map apply;
older attempts created before this implementation have no retrospective detail.

Fixed categories distinguish the commit deadline, a changed context, caller
cancellation, response idle, transport failure, response reading/decoding failure
and response validation failure. These are browser observations, not wire
receipts. An unvalidated HTTP 408 remains UNKNOWN. Only the existing closed,
correlated intake outcome can establish not-committed, and only the existing
closed committed result can acknowledge the upload. UNKNOWN continues to block
another upload in the home; inspection cannot infer rollback or safe retry.

The 90-second commit and 15-second response-idle limits, response size limit,
format policy, original custody and one-shot POST are unchanged. A terminal
observation is frozen before the caller receives the failure. A late response
cannot replace it or acknowledge a canceled attempt.

## Focused synthetic checks

The integration owner registers these individually named commands in README
before general use. The repair authorization permits this finite set of local
failure cases. Inspect the complete body and imports first:

```sh
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs waiting-headers-transport
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs waiting-headers-deadline
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs caller-canceled
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs context-changed
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs reading-response-transport
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs reading-response-idle
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs response-validation
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs correlated-intake-rejection
```

Each command creates one synthetic PDF and admission, runs the actual client
against fake Responses and sends exactly one fake POST. No listener, network,
credentials, browser, native store, household data or filesystem scratch is used.
The deadline and idle cases deterministically trigger only the source's existing
90-second or 15-second timer callbacks; they do not change production bounds.
The context case changes only a synthetic binding and owner, not an account,
expiry or revocation policy. UNKNOWN cases check that preparation stays blocked;
they never resend a prepared request.

Checks retain thrown error identity where the transport supplies it, verify
phase/status and bounded observations, and statically render the actual pending
UI. The unopened picker and unrelated evidence-link component are explicit
no-op view fixtures. The static UI proves the diagnostic and no-resend text is
present and private fixture contents are absent. It does not prove interactive
browser behavior, real multipart delivery, server phase logging or historical
request disposition. This finite set is separate from ordinary CI and does not
release another failure, replay, expiry, revocation, crash or private-intake case.
