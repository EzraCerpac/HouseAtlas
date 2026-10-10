# Contextual capture drafts

The authenticated shared web app connects contextual Add evidence to opt-in local
drafts. There is no background submission. JPEG, PNG, PDF and UTF-8 text remain
bounded to 10 MiB. HEIC is unsupported; there is no conversion, OCR, external
processing or native iOS wrapper. Browser-returned original bytes and selection
provenance stay unchanged. Selection time is not device capture time.

## User actions

Select a file in Add evidence, enter its statement, licence and reason, then check
the per-save local-storage choice and select Save local draft. This saves the
original and those values without uploading. The browser permits four local
files, 32 MiB total, with seven-day unsent expiry. Browser cleanup, storage failure
or eviction can remove files. Local storage is not a backup. No database is
opened by ordinary browsing, session reads or entering Add evidence.

View local drafts lists the current account, authorized home and exact qualified
place only. Review explicitly rereads the native session and place admission.
The saved form is read-only; the original can be downloaded locally for review.
Changes require removing the unsent draft and selecting the file again. A separate
checkbox and Confirm upload action consume that review. Cancel review, close,
target change, hiding the page or losing focus invalidates review handles without
submitting. Picker blur does not erase an unsent selection. Returning to the
foreground verifies the native session and never opens, reviews or submits a draft.

Confirmation repeats the canonical session GET and genuine fresh loadPlace.
The draft controller atomically stores an immutable outcome-unknown marker and
request/idempotency IDs before giving one synchronous foreground upload intent.
The adapter immediately invokes the existing upload client once, without copying,
retrying or retaining a second submission intent. Actual closed stock schema and
request/command/scope correlation guard acknowledgement. A committed receipt
removes local bytes before ordinary view refresh. A local cleanup failure after
known server commit is reported separately; it does not change the receipt to an
unconfirmed server outcome or authorize another attempt.

An interrupted handoff or unavailable reply leaves a locked unknown attempt.
Read saved information performs fresh session/place reads and exposes the original
request ID and current saved revision as observations. Retry safety remains
not-established; there is no retry button, synthesized retained native envelope
or automatic resend. Removing an unknown local file requires explicit loss consent
and does not cancel the server operation.

Sign out presents an explicit keep-or-delete choice. Keeping drafts hides them
from other accounts without deleting originals. Opt-in deletion removes this
actor's local captures in all homes, including unknown attempts, before the
session ends or authenticated UI unmounts. Failure reports unsuccessful cleanup
and leaves sign-out pending; the user can cancel or choose to keep the files.
Account/home switches never automatically delete stored originals.

## Host boundaries

The adapter is specific to the native session profile whose canonical GET derives
a private stable CSRF marker from the exact HttpOnly cookie. Password, local and
proxy sign-in normalize their issued receipt through a canonical GET before
publishing currentSession. Only the canonical actor/marker/expiry tuple can seed
a separate opaque memory-only epoch. No credential or marker enters DraftBoundary,
IndexedDB, UI, BroadcastChannel payloads or evidence. A healthy draft GET preserves
that epoch and the existing shared currentSession object. current() is null while
verification is pending and when root generation, actual committed ready scope,
read scope, foreground state or expiry fails its fence. Unavailable or different
session reads never default to success; late callbacks cannot publish a boundary.
A transport failure quarantines drafts while preserving the private tuple and
scope for an explicit foreground recheck. It invalidates review handles and exposes
no boundary, but does not force existing clients to reload or erase a picker
candidate. Only a decoded different or absent native session reloads the host.

App's existing committed-scope callback is forwarded through SessionApp. Main
masks drafts before any view read. PlaceEditor keys its stateful child by complete
workspace/home/source identity and invalidates on unmount. Session changes,
explicit logout and received cross-tab invalidations synchronously clear local
review capabilities, candidate files where the boundary changes, and owned signals.
Review-only invalidation on blur preserves the picker candidate. Mount-owned
BroadcastChannel messages contain only `{version:1,type:'invalidate'}`; recipients
treat them as signals and reread canonical session, never as identity proof.
Channels/listeners close on host unmount. Storage opens lazily for an explicit
save, list or consented cleanup action. If the browser cannot open BroadcastChannel,
local draft actions fail closed with an availability message; basic evidence picking
remains available. Existing quantity, pinned, topology, AI,
native naming and capability clients retain their current binding behavior.

## Proposed qualification commands

These bodies are source-only proposals. They are not ordinary-CI additions or
runtime permission. Independent review of exact source/imports and Root's exact
README command registration must precede each browser/listener/test execution.

`node frontend/capture-drafts-tests/combined-host.mjs --case NAME` permits only one
named fake-port case. Positive names are `healthy-save-review-commit` and
`healthy-canonical-published-binding`. Individually proposed regressions are
`pending-canonical-late-context`, `home-change-denies-reviewed-submit`,
`target-change-denies-submit`, `malformed-receipt-keeps-original`,
`noncommitted-receipt-keeps-original`, `lost-fake-reply-inspect-only`,
`cleanup-failure-known-commit`, `explicit-clear-before-signout` and
`cross-tab-invalidation-signal`, `unavailable-probe-explicit-recheck` and
`wrong-correlation-keeps-original`. They use a deterministic memory store, actual
closed schema, synthetic JPEG, injected session/editing ports and a fetch trap.
The reply-loss proposal and synthetic malformed/noncommitted/wrong-correlation
response mutations overlap held classes and each require an explicit lane assessment; no replay, expiry, crash or server revocation execution is implied.

`node frontend/capture-drafts-tests/combined-native-ui.mjs --case healthy-save-reopen-confirm`
proposes actual built React/native TLS in fresh disposable state/profile with a
generated JPEG, explicit local save, normal UI close/reload/reopen, read-only
review/download, fresh session/place reads, exactly one confirmed evidence POST,
durable marker observed before releasing the evidence POST, request-correlated
committed receipt, local deletion, native evidence/asset/download readback, then
a second unsent local save and consented normal logout cleanup with zero additional
uploads. It requires independently pinned source, actual locked binary and build,
inspected Chromium and OpenSSL. Requests stay on the disposable loopback origin;
the only additional URL is its local original blob. Owning cleanup covers scratch
allocation and OpenSSL preparation, with a 10-second preparation deadline. The
90-second harness budget reserves 83 seconds for preflight/body and seven for
parallel child cleanup; each synchronous Git preflight is bounded to five seconds:
bounded Browser.close or SIGINT, SIGTERM/SIGKILL escalation, and process/stdio
close confirmation plus owned process-group absence before scratch removal.
Unconfirmed shutdown retains scratch and reports cleanup failure; run failures
survive alongside any cleanup failure.
Scratch removal is synchronous; filesystem stalls can extend total wall time.
Use a registered `/tmp` TMPDIR for the native disposable-path requirement.
This is mobile emulation, not physical capture.

Strict TypeScript and Vite source checks are permitted separately. Runtime
composition, actual cross-tab browser qualification, Safari/iPhone Camera/Photos/
Files/standalone returned formats, resource/concurrency limits and unknown native
server outcomes remain open. No device/provider/NAS/deployment/publication access
or feature acceptance is established by source compilation.
